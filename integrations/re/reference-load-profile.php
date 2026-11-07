<?php
declare(strict_types=1);

const RE_REFERENCE_LOAD_PROFILE_TABLE = 'EnergyMeter_reference_load_profiles';
const RE_REFERENCE_LOAD_PROFILE_VERSION = 1;

function re_reference_load_profile_canonical_json($value): string
{
    if (is_object($value)) {
        $properties = get_object_vars($value);
        ksort($properties, SORT_STRING);
        $parts = [];
        foreach ($properties as $key => $entry) {
            $parts[] = json_encode((string)$key, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                . ':' . re_reference_load_profile_canonical_json($entry);
        }
        return '{' . implode(',', $parts) . '}';
    }
    if (is_array($value)) {
        return '[' . implode(',', array_map('re_reference_load_profile_canonical_json', $value)) . ']';
    }
    $encoded = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($encoded === false) {
        throw new RuntimeException('Nie można sprawdzić sumy kontrolnej profilu referencyjnego RE');
    }
    return $encoded;
}

function re_reference_load_profile_content_hash(stdClass $profile): string
{
    $fields = new stdClass();
    foreach ([
        'sourceKey', 'name', 'category', 'kind', 'quantity', 'unit',
        'timeBasis', 'resolutionMinutes', 'start', 'end', 'series', 'metadata', 'quality',
    ] as $field) {
        if (!property_exists($profile, $field)) {
            throw new RuntimeException('Brak pola wymaganego do sprawdzenia profilu referencyjnego RE');
        }
        $fields->{$field} = $profile->{$field};
    }
    return hash('sha256', re_reference_load_profile_canonical_json($fields));
}

/** Validate the value read from EnergyMeter_reference_load_profiles. */
function re_reference_load_profile_validate_row(?array $row): ?array
{
    if ($row === null) {
        return null;
    }

    $profileKey = $row['profileKey'] ?? null;
    $contentHash = $row['contentHash'] ?? null;
    $payloadJson = $row['payloadJson'] ?? null;
    $rawAnnual = $row['annualKwh'] ?? null;
    $version = (int)($row['projectionVersion'] ?? 0);
    if ($version !== RE_REFERENCE_LOAD_PROFILE_VERSION) {
        throw new RuntimeException('Zapisany profil referencyjny RE wymaga nieobsługiwanej wersji projekcji');
    }
    $annualKwh = null;
    if ($rawAnnual !== null) {
        if (!is_numeric($rawAnnual) || !is_finite((float)$rawAnnual) || (float)$rawAnnual < 0) {
            throw new RuntimeException('Nieprawidłowe roczne zużycie zapisane dla profilu RE');
        }
        $annualKwh = (float)$rawAnnual;
    }

    if ($profileKey === null) {
        if ($contentHash !== null || $payloadJson !== null) {
            throw new RuntimeException('Niespójny zapis domyślnego profilu RE');
        }
        return [
            'profile' => null,
            'contentHash' => null,
            'annualKwh' => $annualKwh,
            'projectionVersion' => RE_REFERENCE_LOAD_PROFILE_VERSION,
        ];
    }

    if (!is_string($profileKey) || $profileKey === ''
        || !is_string($contentHash) || !preg_match('/^[a-f0-9]{64}$/', $contentHash)
        || !is_string($payloadJson) || $annualKwh === null) {
        throw new RuntimeException('Nieprawidłowe dane wybranego profilu referencyjnego RE');
    }
    $profile = json_decode($payloadJson);
    if (!($profile instanceof stdClass) || !isset($profile->key) || $profile->key !== $profileKey
        || !isset($profile->series) || !is_array($profile->series)
        || !isset($profile->metadata) || !($profile->metadata instanceof stdClass)
        || !isset($profile->quality) || !($profile->quality instanceof stdClass)) {
        throw new RuntimeException('Nieprawidłowy JSON wybranego profilu referencyjnego RE');
    }
    if (!hash_equals($contentHash, re_reference_load_profile_content_hash($profile))) {
        throw new RuntimeException('Suma kontrolna wybranego profilu referencyjnego RE jest niezgodna');
    }

    return [
        'profile' => $profile,
        'contentHash' => $contentHash,
        'annualKwh' => $annualKwh,
        'projectionVersion' => RE_REFERENCE_LOAD_PROFILE_VERSION,
    ];
}

/** Read-only companion to user_consumption_get. Missing migration is an explicit error. */
function re_reference_load_profile_for_station(PDO $pdo, string $station): ?array
{
    $tables = $pdo->query("SHOW TABLES LIKE '" . RE_REFERENCE_LOAD_PROFILE_TABLE . "'");
    if (!$tables || $tables->fetchColumn() === false) {
        throw new RuntimeException('Brak tabeli ' . RE_REFERENCE_LOAD_PROFILE_TABLE
            . '; zastosuj reference-load-profile-migration.sql przed użyciem profilu referencyjnego');
    }

    $stmt = $pdo->prepare(
        'SELECT profileKey, contentHash, payloadJson, annualKwh, projectionVersion'
        . ' FROM ' . RE_REFERENCE_LOAD_PROFILE_TABLE . ' WHERE station=? LIMIT 1'
    );
    $stmt->execute([$station]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return re_reference_load_profile_validate_row($row ?: null);
}
