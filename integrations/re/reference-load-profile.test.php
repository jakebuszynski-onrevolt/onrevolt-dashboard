<?php
declare(strict_types=1);

ini_set('memory_limit', '512M');

require_once __DIR__ . '/reference-load-profile.php';

function expect_reference_profile_exception(callable $callback, string $message): void
{
    try {
        $callback();
    } catch (RuntimeException $error) {
        if (str_contains($error->getMessage(), $message)) {
            return;
        }
        throw $error;
    }
    throw new RuntimeException('Expected profile validation to fail: ' . $message);
}

$profile = json_decode('{"key":"fixture-h0","sourceKey":"fixture","name":"Dom","category":"household","kind":"STANDARD_PATTERN","quantity":"load","unit":"W","timeBasis":"TYPICAL_DAY","resolutionMinutes":60,"start":null,"end":null,"series":[{"month":1,"dayType":"workday","hour":0,"value":1}],"metadata":{},"quality":{}}');
$canonicalFields = new stdClass();
foreach (['sourceKey', 'name', 'category', 'kind', 'quantity', 'unit', 'timeBasis', 'resolutionMinutes', 'start', 'end', 'series', 'metadata', 'quality'] as $field) {
    $canonicalFields->{$field} = $profile->{$field};
}
$contentHash = hash('sha256', re_reference_load_profile_canonical_json($canonicalFields));
$row = [
    'profileKey' => 'fixture-h0', 'contentHash' => $contentHash, 'payloadJson' => json_encode($profile),
    'annualKwh' => '3600.000', 'projectionVersion' => '1',
];
$selected = re_reference_load_profile_validate_row($row);
if (!$selected || $selected['profile']->key !== 'fixture-h0' || $selected['annualKwh'] !== 3600.0) {
    throw new RuntimeException('Selected RE profile payload was not read correctly');
}

$catalogPath = dirname(__DIR__, 2) . '/output/profile-catalog-20261106/catalog.json';
$catalog = json_decode((string)file_get_contents($catalogPath));
$catalogProfile = null;
foreach (($catalog->profiles ?? []) as $candidate) {
    if (($candidate->key ?? null) === 'bdew-2025-h25') {
        $catalogProfile = clone $candidate;
        break;
    }
}
if (!$catalogProfile) {
    throw new RuntimeException('The BDEW fixture is missing from the profile catalog');
}
$catalogHash = '162e5e3a18117f0dceca45771565eb044d8ea7ed569251564461b78058b99b89';
$catalogRow = re_reference_load_profile_validate_row([
    'profileKey' => $catalogProfile->key, 'contentHash' => $catalogHash,
    'payloadJson' => json_encode($catalogProfile, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    'annualKwh' => '6000.000', 'projectionVersion' => '1',
]);
if (!$catalogRow || $catalogRow['contentHash'] !== $catalogHash) {
    throw new RuntimeException('A real BDEW catalog profile did not pass the PHP hash check');
}

$reset = re_reference_load_profile_validate_row([
    'profileKey' => null, 'contentHash' => null, 'payloadJson' => null,
    'annualKwh' => '4200.000', 'projectionVersion' => '1',
]);
if (!$reset || $reset['profile'] !== null || $reset['annualKwh'] !== 4200.0) {
    throw new RuntimeException('Default/reset row did not retain the annual overlay');
}
if (re_reference_load_profile_validate_row(null) !== null) {
    throw new RuntimeException('Missing profile row should remain unselected');
}

expect_reference_profile_exception(static function () use ($row): void {
    $bad = $row;
    $bad['profileKey'] = 'another-profile';
    re_reference_load_profile_validate_row($bad);
}, 'JSON');
expect_reference_profile_exception(static function () use ($row): void {
    $bad = $row;
    $bad['contentHash'] = str_repeat('0', 64);
    re_reference_load_profile_validate_row($bad);
}, 'Suma kontrolna');
expect_reference_profile_exception(static function (): void {
    re_reference_load_profile_validate_row([
        'profileKey' => null, 'contentHash' => 'invalid', 'payloadJson' => null,
        'annualKwh' => '100', 'projectionVersion' => '1',
    ]);
}, 'Niespójny');
expect_reference_profile_exception(static function (): void {
    re_reference_load_profile_validate_row([
        'profileKey' => null, 'contentHash' => null, 'payloadJson' => null,
        'annualKwh' => '100', 'projectionVersion' => '2',
    ]);
}, 'wersji');

fwrite(STDOUT, "reference-load-profile validation OK\n");
