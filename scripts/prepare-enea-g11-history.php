<?php
declare(strict_types=1);

use OnRevolt\Pricing\CatalogHistory;
use OnRevolt\Pricing\ClientTariffs;

/**
 * Prepare, verify, or import the verified ENEA G11 catalog history.
 *
 * plan/check are read-only. apply is guarded by a state hash printed by plan,
 * writes a scoped pricing_catalog_revision backup first, and calls the same
 * CatalogHistory::record path used by the catalog editor inside one transaction.
 */
final class HistoricalEneaG11Importer
{
    private const TARIFF_ID = 1;
    private const OSD_ID = 1;
    private const EXPECTED_BASE_FINGERPRINT = 'ce45f072658bc954990eb592309b40e4d58f998a2736db74e4d7d1f2a6ed4f70';

    private const SOURCE_2025 = [
        'https://www.operator.enea.pl/media/385/decyzja-prezesa-ure-o-zatwierdzeniu-taryfy-na-2025-rokpdf.pdf',
        'https://www.operator.enea.pl/uslugi-dystrybucyjne/taryfy-i-cenniki',
        'https://www.enea.pl/dla-domu/zamrozenie-cen',
    ];

    private const SOURCE_2026 = [
        'https://www.operator.enea.pl/uslugi-dystrybucyjne/taryfy-i-cenniki',
        'https://www.enea.pl/dla-domu/zamrozenie-cen',
    ];

    private const CAPACITY_TIERS = [
        ['min' => null, 'max' => 500.0],
        ['min' => 500.0, 'max' => 1200.0],
        ['min' => 1200.0, 'max' => 2800.0],
        ['min' => 2800.0, 'max' => null],
    ];

    private const TRANSITION_TIERS = [
        ['min' => null, 'max' => 500.0, 'net' => 0.02],
        ['min' => 500.0, 'max' => 1200.0, 'net' => 0.10],
        ['min' => 1200.0, 'max' => null, 'net' => 0.33],
    ];

    /** @return array{plan:array,state:array,baselineHash:string,basePayload:array} */
    public static function inspect(PDO $db): array
    {
        $state = self::collectState($db, false);
        $basePayload = self::validateBaseline($state);
        $snapshots = self::buildSnapshots($basePayload);
        $baselineHash = self::hashState($state);

        return [
            'plan' => self::makePlan($snapshots, $baselineHash),
            'state' => $state,
            'baselineHash' => $baselineHash,
            'basePayload' => $basePayload,
        ];
    }

    /** @return array<string,mixed> */
    public static function collectState(PDO $db, bool $forUpdate): array
    {
        $lock = $forUpdate ? ' FOR UPDATE' : '';
        $tariff = $db->prepare('SELECT * FROM tariff WHERE id=?' . $lock);
        $tariff->execute([self::TARIFF_ID]);
        $tariffRow = $tariff->fetch(PDO::FETCH_ASSOC);
        if (!is_array($tariffRow)) throw new RuntimeException('Brak taryfy o ID 1.');

        $fixed = $db->prepare('SELECT * FROM tariff_fixed_cost WHERE tariff_id=? AND active=1 ORDER BY id' . $lock);
        $fixed->execute([self::TARIFF_ID]);
        // Unlike tariff_fixed_cost, tariff_variable_cost has no active column in this schema.
        $variable = $db->prepare('SELECT * FROM tariff_variable_cost WHERE tariff_id=? ORDER BY id' . $lock);
        $variable->execute([self::TARIFF_ID]);
        $revisions = $db->prepare('SELECT * FROM pricing_catalog_revision WHERE tariff_id=? ORDER BY valid_from,id' . $lock);
        $revisions->execute([self::TARIFF_ID]);

        return [
            'tariff' => $tariffRow,
            'fixedRows' => $fixed->fetchAll(PDO::FETCH_ASSOC),
            'variableRows' => $variable->fetchAll(PDO::FETCH_ASSOC),
            'revisions' => $revisions->fetchAll(PDO::FETCH_ASSOC),
        ];
    }

    public static function hashState(array $state): string
    {
        return hash('sha256', json_encode($state, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION));
    }

    /** @return array<string,mixed> */
    private static function validateBaseline(array $state): array
    {
        $tariff = $state['tariff'];
        if ((int)($tariff['id'] ?? 0) !== self::TARIFF_ID
            || (int)($tariff['osd_id'] ?? 0) !== self::OSD_ID
            || strtoupper(trim((string)($tariff['code'] ?? ''))) !== 'G11') {
            throw new RuntimeException('Taryfa docelowa nie odpowiada ENEA G11 (tariff_id=1, osd_id=1).');
        }

        $revisions = $state['revisions'];
        if (count($revisions) !== 1) {
            throw new RuntimeException('Oczekiwano dokładnie jednej istniejącej rewizji taryfy 1; import zatrzymany.');
        }
        $revision = $revisions[0];
        if ((int)$revision['osd_id'] !== self::OSD_ID
            || $revision['valid_from'] !== '2026-02-01'
            || $revision['valid_until'] !== null
            || (int)$revision['superseded'] !== 0
            || !hash_equals(self::EXPECTED_BASE_FINGERPRINT, (string)$revision['fingerprint'])
            || !hash_equals(self::EXPECTED_BASE_FINGERPRINT, hash('sha256', (string)$revision['payload_json']))) {
            throw new RuntimeException('Rewizja bazowa 2026-02-01 nie ma oczekiwanej daty, statusu lub dokładnego fingerprintu.');
        }

        $payload = json_decode((string)$revision['payload_json'], true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($payload)
            || (int)($payload['tariff_id'] ?? 0) !== self::TARIFF_ID
            || (int)($payload['osd_id'] ?? 0) !== self::OSD_ID
            || strtoupper(trim((string)($payload['code'] ?? ''))) !== 'G11') {
            throw new RuntimeException('Zawartość rewizji bazowej nie opisuje taryfy ENEA G11.');
        }

        $storage = $payload['pricing']['tariffStorage'] ?? null;
        if (!is_array($storage) || ($storage['priceBasis'] ?? null) !== 'net' || !self::sameNumber($storage['vatRate'] ?? null, 0.23)) {
            throw new RuntimeException('Rewizja bazowa nie zawiera zweryfikowanego katalogu netto z VAT 23%.');
        }
        self::validateLabelCounts($storage['fixed'] ?? [], [
            'Opłata sieciowa' => 1,
            'Opłata mocowa' => 4,
            'Opłata abonamentowa' => 4,
        ], 'fixed');
        self::validateLabelCounts($storage['variable'] ?? [], [
            'Energia czynna' => 1,
            'Opłata sieciowa' => 1,
            'Opłata jakościowa' => 1,
            'Opłata OZE' => 1,
            'Opłata kogeneracyjna' => 1,
        ], 'variable');
        self::validateCurrentRows($state, $payload);
        self::validateFixedShape($storage['fixed'], false);
        self::validateVariableShape($storage['variable']);
        self::validateLegacyMatchesStorage($payload, $storage, true);

        return $payload;
    }

    private static function validateCurrentRows(array $state, array $payload): void
    {
        $storage = $payload['pricing']['tariffStorage'];
        foreach ([
            ['fixedRows', 'fixed', 'amount'],
            ['variableRows', 'variable', 'price'],
        ] as [$stateKey, $group, $rateField]) {
            $liveRows = $state[$stateKey];
            $catalogRows = $storage[$group];
            if (count($liveRows) !== count($catalogRows)) {
                throw new RuntimeException('Aktywne pozycje bazy i rewizji nie mają tej samej liczby w grupie ' . $group . '.');
            }
            $byKey = [];
            foreach ($liveRows as $row) {
                $key = (string)($row['component_key'] ?? '');
                if ($key === '' || isset($byKey[$key])) throw new RuntimeException('Brakujący lub powtórzony component_key w aktywnym cenniku.');
                $byKey[$key] = $row;
            }
            foreach ($catalogRows as $row) {
                $key = (string)($row['component_key'] ?? '');
                if ($key === '' || !isset($byKey[$key])) throw new RuntimeException('Rewizja bazowa nie odpowiada aktywnemu component_key.');
                $live = $byKey[$key];
                if ((string)$live['label'] !== (string)$row['label']
                    || !self::sameNumber($live[$rateField], $row['net'] ?? null)
                    || !self::sameNumber($live['vat_rate'] ?? null, $row['vatRate'] ?? null)) {
                    throw new RuntimeException('Aktywna pozycja ' . $row['label'] . ' różni się od rewizji bazowej.');
                }
                if ($group === 'fixed') {
                    foreach (['amount_mode', 'billing_cycle_months', 'annual_usage_min_kwh', 'annual_usage_max_kwh'] as $field) {
                        if (!self::sameNullableValue($live[$field] ?? null, $row[$field] ?? null)) {
                            throw new RuntimeException('Aktywny wiersz stały ' . $row['label'] . ' zmienił definicję progu lub cyklu.');
                        }
                    }
                } elseif ((string)($live['window_code'] ?? '') !== (string)($row['window_code'] ?? '')) {
                    throw new RuntimeException('Aktywna pozycja zmienna ' . $row['label'] . ' zmieniła strefę.');
                }
            }
        }
    }

    /** @return list<array{from:string,until:string,source:string,payload:array}> */
    public static function buildSnapshots(array $base): array
    {
        $jan2025 = self::build2025Snapshot($base, '2025-01-01', [0.0, 0.0, 0.0, 0.0]);
        $jul2025 = self::build2025Snapshot($base, '2025-07-01', [2.86, 6.86, 11.44, 16.01]);
        $jan2026 = self::build2026Snapshot($base);

        self::validateSnapshot($jan2025, '2025-01-01', true, [0.0, 0.0, 0.0, 0.0]);
        self::validateSnapshot($jul2025, '2025-07-01', true, [2.86, 6.86, 11.44, 16.01]);
        self::validateSnapshot($jan2026, '2026-01-01', false, [4.29, 10.31, 17.18, 24.05]);

        return [
            ['from' => '2025-01-01', 'until' => '2025-07-01', 'source' => 'ENEA official distribution tariff 2025', 'payload' => $jan2025],
            ['from' => '2025-07-01', 'until' => '2026-01-01', 'source' => 'ENEA official distribution tariff 2025', 'payload' => $jul2025],
            ['from' => '2026-01-01', 'until' => '2026-02-01', 'source' => 'ENEA 2026 pre-February clone', 'payload' => $jan2026],
        ];
    }

    private static function build2025Snapshot(array $base, string $date, array $capacityNet): array
    {
        $payload = $base;
        $storage =& $payload['pricing']['tariffStorage'];
        $storage['validFrom'] = $date;
        $storage['sources'] = self::SOURCE_2025;

        self::setFixedRate($storage['fixed'], 'Opłata sieciowa', 'flat_month', null, null, null, 10.14);
        foreach (self::CAPACITY_TIERS as $index => $tier) {
            self::setFixedRate($storage['fixed'], 'Opłata mocowa', 'flat_month', null, $tier['min'], $tier['max'], $capacityNet[$index]);
        }
        foreach ([1 => 3.84, 2 => 1.92, 6 => 0.64, 12 => 0.32] as $cycle => $net) {
            self::setFixedRate($storage['fixed'], 'Opłata abonamentowa', 'flat_month', $cycle, null, null, $net);
        }
        foreach ([
            'Energia czynna' => 0.505,
            'Opłata sieciowa' => 0.2456,
            'Opłata jakościowa' => 0.0321,
            'Opłata OZE' => 0.0035,
            'Opłata kogeneracyjna' => 0.0030,
        ] as $label => $net) {
            self::setVariableRate($storage['variable'], $label, 'all', $net);
        }

        foreach (self::TRANSITION_TIERS as $index => $tier) {
            $key = self::transitionKey($index + 1);
            $row = self::newFixedRow($key, 'Opłata przejściowa', $tier['net'], $tier['min'], $tier['max']);
            $storage['fixed'][] = $row;
            $payload['fixed'][] = [
                'label' => $row['label'],
                'amount' => $row['net'],
                'amount_mode' => $row['amount_mode'],
                'billing_cycle_months' => null,
                'annual_usage_min_kwh' => $row['annual_usage_min_kwh'],
                'annual_usage_max_kwh' => $row['annual_usage_max_kwh'],
                'active' => 1,
                'price_basis' => 'net',
                'vat_rate' => '0.230000',
                'component_key' => $key,
            ];
        }
        unset($storage);

        return self::synchronizeLegacy($payload);
    }

    private static function build2026Snapshot(array $base): array
    {
        $payload = $base;
        $storage =& $payload['pricing']['tariffStorage'];
        $storage['validFrom'] = '2026-01-01';
        $storage['sources'] = self::SOURCE_2026;
        self::setVariableRate($storage['variable'], 'Opłata jakościowa', 'all', 0.0331);
        unset($storage);
        return self::synchronizeLegacy($payload);
    }

    private static function synchronizeLegacy(array $payload): array
    {
        $period = [
            'id' => '00000000-0000-4000-8000-000000000000',
            'source' => 'ENEA',
            'overrides' => [],
            'schedule' => null,
        ];
        $payload = ClientTariffs::apply($payload, $period);
        unset($payload['clientPeriodId'], $payload['clientPeriodSource']);
        return $payload;
    }

    private static function newFixedRow(string $key, string $label, float $net, ?float $min, ?float $max): array
    {
        return [
            'label' => $label,
            'amount' => $net,
            'amount_mode' => 'flat_month',
            'billing_cycle_months' => null,
            'annual_usage_min_kwh' => $min,
            'annual_usage_max_kwh' => $max,
            'active' => 1,
            'price_basis' => 'net',
            'vat_rate' => '0.230000',
            'component_key' => $key,
            'net' => $net,
            'gross' => $net * 1.23,
            'vatRate' => 0.23,
            'priceBasis' => 'net',
        ];
    }

    private static function transitionKey(int $tier): string
    {
        $hex = substr(hash('sha256', 'enea-g11-2025-transition-tier-' . $tier), 0, 32);
        $hex[12] = '5';
        $hex[16] = '8';
        return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20, 12);
    }

    private static function setFixedRate(array &$rows, string $label, string $mode, ?int $cycle, ?float $min, ?float $max, float $net): void
    {
        $indexes = [];
        foreach ($rows as $index => $row) {
            if ((string)($row['label'] ?? '') === $label
                && (string)($row['amount_mode'] ?? '') === $mode
                && self::sameNullableValue($row['billing_cycle_months'] ?? null, $cycle)
                && self::sameNullableValue($row['annual_usage_min_kwh'] ?? null, $min)
                && self::sameNullableValue($row['annual_usage_max_kwh'] ?? null, $max)) $indexes[] = $index;
        }
        if (count($indexes) !== 1) throw new RuntimeException('Oczekiwano dokładnie jednego wiersza stałego: ' . $label . '.');
        self::setNet($rows[$indexes[0]], 'amount', $net);
    }

    private static function setVariableRate(array &$rows, string $label, string $window, float $net): void
    {
        $indexes = [];
        foreach ($rows as $index => $row) {
            if ((string)($row['label'] ?? '') === $label && (string)($row['window_code'] ?? '') === $window) $indexes[] = $index;
        }
        if (count($indexes) !== 1) throw new RuntimeException('Oczekiwano dokładnie jednego wiersza zmiennego: ' . $label . '.');
        self::setNet($rows[$indexes[0]], 'price', $net);
    }

    private static function setNet(array &$row, string $field, float $net): void
    {
        $vat = $row['vatRate'] ?? null;
        if (!self::sameNumber($vat, 0.23)) throw new RuntimeException('Nieoczekiwana stawka VAT dla pozycji ' . ($row['label'] ?? '?') . '.');
        $row['net'] = $net;
        $row[$field] = $net;
        $row['gross'] = $net * (1 + (float)$vat);
        $row['priceBasis'] = 'net';
        $row['price_basis'] = 'net';
    }

    private static function validateSnapshot(array $payload, string $date, bool $withTransition, array $capacityNet): void
    {
        $storage = $payload['pricing']['tariffStorage'] ?? [];
        if (($storage['validFrom'] ?? null) !== $date || ($storage['priceBasis'] ?? null) !== 'net'
            || !self::sameNumber($storage['vatRate'] ?? null, 0.23)) {
            throw new RuntimeException('Nieprawidłowa data, podstawa cen lub VAT migawki ' . $date . '.');
        }
        self::validateLabelCounts($storage['fixed'] ?? [], [
            'Opłata sieciowa' => 1,
            'Opłata mocowa' => 4,
            'Opłata abonamentowa' => 4,
            'Opłata przejściowa' => $withTransition ? 3 : 0,
        ], 'fixed ' . $date);
        self::validateLabelCounts($storage['variable'] ?? [], [
            'Energia czynna' => 1,
            'Opłata sieciowa' => 1,
            'Opłata jakościowa' => 1,
            'Opłata OZE' => 1,
            'Opłata kogeneracyjna' => 1,
        ], 'variable ' . $date);
        self::validateFixedShape($storage['fixed'], $withTransition);
        self::validateVariableShape($storage['variable']);
        self::validateLegacyMatchesStorage($payload, $storage);

        self::assertFixedRate($storage['fixed'], 'Opłata sieciowa', 'flat_month', null, null, null, $date < '2026-01-01' ? 10.14 : 10.41);
        foreach (self::CAPACITY_TIERS as $index => $tier) {
            self::assertFixedRate($storage['fixed'], 'Opłata mocowa', 'flat_month', null, $tier['min'], $tier['max'], $capacityNet[$index]);
        }
        foreach ([1 => 3.84, 2 => 1.92, 6 => 0.64, 12 => 0.32] as $cycle => $net) {
            self::assertFixedRate($storage['fixed'], 'Opłata abonamentowa', 'flat_month', $cycle, null, null, $net);
        }
        if ($withTransition) {
            foreach (self::TRANSITION_TIERS as $index => $tier) {
                self::assertFixedRate($storage['fixed'], 'Opłata przejściowa', 'flat_month', null, $tier['min'], $tier['max'], $tier['net']);
                $row = self::findFixed($storage['fixed'], 'Opłata przejściowa', 'flat_month', null, $tier['min'], $tier['max']);
                if (($row['component_key'] ?? null) !== self::transitionKey($index + 1)) throw new RuntimeException('Nieprawidłowy stabilny klucz opłaty przejściowej.');
            }
        }
        $variableRates = [
            'Energia czynna' => $date === '2026-01-01' ? 0.503 : 0.505,
            'Opłata sieciowa' => 0.2456,
            'Opłata jakościowa' => $date === '2026-01-01' ? 0.0331 : 0.0321,
            'Opłata OZE' => $date === '2026-01-01' ? 0.0073 : 0.0035,
            'Opłata kogeneracyjna' => 0.0030,
        ];
        foreach ($variableRates as $label => $net) self::assertVariableRate($storage['variable'], $label, 'all', $net);
        $expectedSources = $date < '2026-01-01' ? self::SOURCE_2025 : self::SOURCE_2026;
        if (($storage['sources'] ?? null) !== $expectedSources) throw new RuntimeException('Brak źródeł URL przypisanych do rewizji ' . $date . '.');
    }

    private static function validateFixedShape(array $rows, bool $withTransition): void
    {
        $expectedCount = $withTransition ? 12 : 9;
        if (count($rows) !== $expectedCount) throw new RuntimeException('Nieoczekiwana liczba pozycji stałych.');
        $keys = [];
        foreach ($rows as $row) {
            $key = (string)($row['component_key'] ?? '');
            if ($key === '' || isset($keys[$key])) throw new RuntimeException('Brakujący lub powtórzony component_key dla stawki stałej.');
            $keys[$key] = true;
            if (!self::sameNumber($row['vatRate'] ?? null, 0.23) || ($row['priceBasis'] ?? null) !== 'net') {
                throw new RuntimeException('Nieprawidłowa podstawa lub VAT pozycji stałej.');
            }
        }
    }

    private static function validateVariableShape(array $rows): void
    {
        if (count($rows) !== 5) throw new RuntimeException('Nieoczekiwana liczba pozycji zmiennych.');
        $keys = [];
        foreach ($rows as $row) {
            $key = (string)($row['component_key'] ?? '');
            if ($key === '' || isset($keys[$key])) throw new RuntimeException('Brakujący lub powtórzony component_key dla stawki zmiennej.');
            $keys[$key] = true;
            if (!self::sameNumber($row['vatRate'] ?? null, 0.23) || ($row['priceBasis'] ?? null) !== 'net') {
                throw new RuntimeException('Nieprawidłowa podstawa lub VAT pozycji zmiennej.');
            }
        }
    }

    private static function validateLabelCounts(array $rows, array $expected, string $group): void
    {
        if (!array_is_list($rows)) throw new RuntimeException('Nieprawidłowa lista wierszy taryfy (' . $group . ').');
        $actual = [];
        foreach ($rows as $row) {
            if (!is_array($row) || trim((string)($row['label'] ?? '')) === '') throw new RuntimeException('Wiersz taryfy bez etykiety (' . $group . ').');
            $label = (string)$row['label'];
            $actual[$label] = ($actual[$label] ?? 0) + 1;
        }
        $expected = array_filter($expected, static fn(int $count): bool => $count > 0);
        ksort($actual);
        ksort($expected);
        if ($actual !== $expected) throw new RuntimeException('Etykiety lub liczby pozycji nie zgadzają się w grupie ' . $group . '.');
    }

    private static function validateLegacyMatchesStorage(array $payload, array $storage, bool $allowKnownBaselineRounding = false): void
    {
        foreach ([['fixed', 'amount'], ['variable', 'price']] as [$group, $field]) {
            $legacy = $payload[$group] ?? null;
            $canonical = $storage[$group] ?? null;
            if (!is_array($legacy) || !is_array($canonical) || count($legacy) !== count($canonical)) {
                throw new RuntimeException('Wiersze legacy i tariffStorage nie są zsynchronizowane w grupie ' . $group . '.');
            }
            foreach ($canonical as $index => $row) {
                $old = $legacy[$index] ?? null;
                if (!is_array($old) || (string)($old['label'] ?? '') !== (string)($row['label'] ?? '')) {
                    throw new RuntimeException('Wiersz legacy nie odpowiada canonical ' . $group . '[' . $index . '].');
                }
                $matchesGross = self::sameNumber($old[$field] ?? null, $row['gross'] ?? null);
                if (!$matchesGross && $allowKnownBaselineRounding) {
                    $roundedDigits = $group === 'fixed' && $row['label'] === 'Opłata mocowa' ? 2
                        : ($group === 'variable' && $row['label'] === 'Energia czynna' ? 4 : null);
                    if ($roundedDigits !== null) $matchesGross = self::sameNumber($old[$field] ?? null, round((float)$row['gross'], $roundedDigits));
                }
                if (!$matchesGross) throw new RuntimeException('Wiersz legacy nie odpowiada canonical ' . $group . '[' . $index . '].');
                if (isset($old['component_key']) && (string)$old['component_key'] !== (string)($row['component_key'] ?? '')) {
                    throw new RuntimeException('component_key legacy nie odpowiada canonical ' . $group . '[' . $index . '].');
                }
            }
        }
    }

    private static function assertFixedRate(array $rows, string $label, string $mode, ?int $cycle, ?float $min, ?float $max, float $net): void
    {
        $row = self::findFixed($rows, $label, $mode, $cycle, $min, $max);
        if (!self::sameNumber($row['net'] ?? null, $net)) throw new RuntimeException('Nieoczekiwana stawka netto dla ' . $label . '.');
    }

    private static function assertVariableRate(array $rows, string $label, string $window, float $net): void
    {
        $matches = array_values(array_filter($rows, static fn(array $row): bool => ($row['label'] ?? null) === $label && ($row['window_code'] ?? null) === $window));
        if (count($matches) !== 1 || !self::sameNumber($matches[0]['net'] ?? null, $net)) {
            throw new RuntimeException('Nieoczekiwana stawka netto dla ' . $label . '.');
        }
    }

    private static function findFixed(array $rows, string $label, string $mode, ?int $cycle, ?float $min, ?float $max): array
    {
        $matches = array_values(array_filter($rows, static fn(array $row): bool => (string)($row['label'] ?? '') === $label
            && (string)($row['amount_mode'] ?? '') === $mode
            && self::sameNullableValue($row['billing_cycle_months'] ?? null, $cycle)
            && self::sameNullableValue($row['annual_usage_min_kwh'] ?? null, $min)
            && self::sameNullableValue($row['annual_usage_max_kwh'] ?? null, $max)));
        if (count($matches) !== 1) throw new RuntimeException('Nie znaleziono jednoznacznej pozycji: ' . $label . '.');
        return $matches[0];
    }

    private static function sameNullableValue(mixed $left, mixed $right): bool
    {
        if ($left === null || $left === '') return $right === null || $right === '';
        if ($right === null || $right === '') return false;
        if (is_numeric($left) && is_numeric($right)) return self::sameNumber($left, $right);
        return (string)$left === (string)$right;
    }

    private static function sameNumber(mixed $left, mixed $right): bool
    {
        return is_numeric($left) && is_numeric($right)
            && is_finite((float)$left) && is_finite((float)$right)
            && abs((float)$left - (float)$right) <= 0.000000001;
    }

    private static function makePlan(array $snapshots, string $baselineHash): array
    {
        $review = [];
        foreach ($snapshots as $snapshot) {
            $payload = $snapshot['payload'];
            $storage = $payload['pricing']['tariffStorage'];
            $fixed = [];
            foreach ($storage['fixed'] as $row) {
                $label = (string)$row['label'];
                if ($label === 'Opłata sieciowa' || $label === 'Opłata mocowa' || $label === 'Opłata abonamentowa' || $label === 'Opłata przejściowa') {
                    $fixed[] = [
                        'label' => $label,
                        'minKwh' => $row['annual_usage_min_kwh'] ?? null,
                        'maxKwh' => $row['annual_usage_max_kwh'] ?? null,
                        'cycleMonths' => $row['billing_cycle_months'] ?? null,
                        'net' => (float)$row['net'],
                        'componentKey' => $label === 'Opłata przejściowa' ? $row['component_key'] : null,
                    ];
                }
            }
            $variable = [];
            foreach ($storage['variable'] as $row) $variable[(string)$row['label']] = (float)$row['net'];
            $review[] = [
                'validFrom' => $snapshot['from'],
                'validUntil' => $snapshot['until'],
                'sourceRecord' => $snapshot['source'],
                'fixedNet' => $fixed,
                'variableNet' => $variable,
                'vatRate' => (float)$storage['vatRate'],
                'sourceUrls' => $storage['sources'],
            ];
        }

        return [
            'target' => ['osdId' => self::OSD_ID, 'tariffId' => self::TARIFF_ID, 'code' => 'G11'],
            'baselineSha256' => $baselineHash,
            'existingRevision' => ['validFrom' => '2026-02-01', 'fingerprint' => self::EXPECTED_BASE_FINGERPRINT, 'payloadBytesPreserved' => true],
            'phaseAssumption' => 'Zachowano istniejącą pozycję miesięcznej opłaty sieciowej bez zmiany jej założeń fazowych.',
            'scope' => ['writeTable' => 'pricing_catalog_revision', 'tariffId' => self::TARIFF_ID, 'currentTariffTablesChanged' => false],
            'snapshots' => $review,
        ];
    }

    public static function runApply(PDO $db, array $inspection, string $expectedHash, string $backupPath): array
    {
        if (!preg_match('/^[a-f0-9]{64}$/D', strtolower($expectedHash))) throw new RuntimeException('Podaj --baseline-hash jako 64-znakowy SHA-256 z planu.');
        if (!hash_equals($inspection['baselineHash'], strtolower($expectedHash))) throw new RuntimeException('Bieżący stan nie odpowiada przekazanemu baseline-hash.');

        $backupTarget = self::normalizeNewPath($backupPath);
        $db->beginTransaction();
        try {
            // CatalogHistory also locks the tariff row; take that same lock before rechecking.
            $lock = $db->prepare('SELECT id FROM tariff WHERE id=? FOR UPDATE');
            $lock->execute([self::TARIFF_ID]);
            $lockedState = self::collectState($db, true);
            self::validateBaseline($lockedState);
            $lockedHash = self::hashState($lockedState);
            if (!hash_equals(strtolower($expectedHash), $lockedHash)) throw new RuntimeException('Stan zmienił się przed apply; transakcja zatrzymana bez zapisu.');

            self::writeBackup($backupTarget, $lockedState, $lockedHash);
            $snapshots = self::buildSnapshots(json_decode((string)$lockedState['revisions'][0]['payload_json'], true, 512, JSON_THROW_ON_ERROR));
            foreach ($snapshots as $snapshot) CatalogHistory::record($db, $snapshot['payload'], $snapshot['from'], $snapshot['source']);

            self::validateAppliedState($db, $lockedState, $snapshots);
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) $db->rollBack();
            throw $error;
        }

        return [
            'ok' => true,
            'mode' => 'apply',
            'writes' => true,
            'backupPath' => $backupTarget,
            'baselineSha256' => $lockedHash,
            'insertedValidFrom' => ['2025-01-01', '2025-07-01', '2026-01-01'],
            'preservedRevision' => ['validFrom' => '2026-02-01', 'fingerprint' => self::EXPECTED_BASE_FINGERPRINT],
            'writeScope' => 'pricing_catalog_revision rows for tariff_id=1 only',
        ];
    }

    private static function validateAppliedState(PDO $db, array $before, array $snapshots): void
    {
        $after = self::collectState($db, true);
        foreach (['tariff', 'fixedRows', 'variableRows'] as $key) {
            if (json_encode($before[$key], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION)
                !== json_encode($after[$key], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION)) {
                throw new RuntimeException('Zmieniono poza zakresem bieżący wiersz taryfy lub aktywne ceny.');
            }
        }
        $revisions = $after['revisions'];
        if (count($revisions) !== 4) throw new RuntimeException('Po apply oczekiwano dokładnie czterech aktywnych rewizji taryfy 1.');
        $expectedFrom = ['2025-01-01', '2025-07-01', '2026-01-01', '2026-02-01'];
        $expectedUntil = ['2025-07-01', '2026-01-01', '2026-02-01', null];
        foreach ($expectedFrom as $index => $from) {
            $row = $revisions[$index];
            if ($row['valid_from'] !== $from || $row['valid_until'] !== $expectedUntil[$index] || (int)$row['superseded'] !== 0) {
                throw new RuntimeException('Nieoczekiwane granice rewizji po apply dla ' . $from . '.');
            }
        }
        $original = $before['revisions'][0];
        $preserved = $revisions[3];
        foreach (['id', 'tariff_id', 'osd_id', 'valid_from', 'valid_until', 'payload_json', 'fingerprint', 'source', 'superseded', 'created_at'] as $field) {
            if (($original[$field] ?? null) !== ($preserved[$field] ?? null)) throw new RuntimeException('Istniejąca rewizja 2026-02-01 została zmieniona w polu ' . $field . '.');
        }
        foreach (array_slice($revisions, 0, 3) as $index => $row) {
            $payload = json_decode((string)$row['payload_json'], true, 512, JSON_THROW_ON_ERROR);
            if (!hash_equals((string)$row['fingerprint'], hash('sha256', (string)$row['payload_json']))) throw new RuntimeException('Fingerprint nowej rewizji nie odpowiada payload_json.');
            $expectedPayload = $snapshots[$index]['payload'];
            if ((string)$row['payload_json'] !== ClientTariffs::json($expectedPayload)) throw new RuntimeException('Zapisany payload różni się od przygotowanej migawki.');
            self::validateSnapshot($payload, $expectedFrom[$index], $index < 2, $index === 0 ? [0.0, 0.0, 0.0, 0.0] : ($index === 1 ? [2.86, 6.86, 11.44, 16.01] : [4.29, 10.31, 17.18, 24.05]));
        }
    }

    private static function writeBackup(string $path, array $state, string $baselineHash): void
    {
        $backup = [
            'format' => 'enea-g11-pricing-catalog-revision-backup-v1',
            'scope' => ['table' => 'pricing_catalog_revision', 'tariff_id' => self::TARIFF_ID],
            'baselineSha256' => $baselineHash,
            'createdAt' => gmdate('Y-m-d\TH:i:s\Z'),
            'rows' => $state['revisions'],
            'restoreNote' => 'Restore only pricing_catalog_revision rows for tariff_id=1 from rows; the other tariff tables are not part of this import.',
        ];
        $json = json_encode($backup, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_PRESERVE_ZERO_FRACTION) . "\n";
        $partialPath = $path . '.partial';
        if (file_exists($partialPath)) throw new RuntimeException('Istnieje plik kopii częściowej; zachowano go bez zmian: ' . $partialPath);
        $handle = @fopen($partialPath, 'x');
        if ($handle === false) throw new RuntimeException('Nie można utworzyć kopii zakresowej: ' . $partialPath);
        try {
            $written = fwrite($handle, $json);
            if ($written !== strlen($json) || !fflush($handle)) {
                throw new RuntimeException('Nie udało się zapisać pełnej kopii zakresowej; częściowy plik pozostawiono: ' . $partialPath);
            }
        } catch (Throwable $error) {
            fclose($handle);
            throw $error;
        }
        fclose($handle);
        if (file_exists($path) || !@rename($partialPath, $path)) {
            throw new RuntimeException('Nie udało się opublikować kopii zakresowej; plik częściowy zachowano: ' . $partialPath);
        }
    }

    private static function normalizeNewPath(string $path): string
    {
        $path = trim($path);
        if ($path === '') throw new RuntimeException('Podaj --backup jako nową ścieżkę pliku kopii.');
        $parent = realpath(dirname($path));
        if ($parent === false || !is_dir($parent) || !is_writable($parent)) throw new RuntimeException('Katalog kopii nie istnieje lub nie jest zapisywalny.');
        $name = basename($path);
        if ($name === '' || $name === '.' || $name === '..') throw new RuntimeException('Nieprawidłowa nazwa pliku kopii.');
        $target = $parent . DIRECTORY_SEPARATOR . $name;
        if (file_exists($target)) throw new RuntimeException('Plik kopii już istnieje; podaj nową ścieżkę.');
        return $target;
    }
}

function historicalEneaG11Main(array $argv): never
{
    try {
        if (PHP_SAPI !== 'cli') throw new RuntimeException('Skrypt jest dostępny wyłącznie w CLI.');
        if (count($argv) < 3) throw new RuntimeException('Użycie: prepare-enea-g11-history.php SITE_ROOT plan|check|apply [--baseline-hash=SHA256] [--backup=PATH]');
        $siteRoot = realpath($argv[1]);
        $mode = $argv[2];
        if (!$siteRoot || !is_file($siteRoot . '/re/setup_func.php')
            || !is_file($siteRoot . '/re/pricing/CatalogHistory.php')
            || !is_file($siteRoot . '/re/pricing/ClientTariffs.php')) {
            throw new RuntimeException('SITE_ROOT musi zawierać re/setup_func.php i re/pricing.');
        }
        if (!in_array($mode, ['plan', 'check', 'apply'], true)) throw new RuntimeException('Tryb musi być plan, check albo apply.');

        $options = [];
        for ($index = 3; $index < count($argv); $index++) {
            $argument = (string)$argv[$index];
            if (str_starts_with($argument, '--baseline-hash=')) $options['baselineHash'] = substr($argument, strlen('--baseline-hash='));
            elseif ($argument === '--baseline-hash' && isset($argv[$index + 1])) $options['baselineHash'] = (string)$argv[++$index];
            elseif (str_starts_with($argument, '--backup=')) $options['backup'] = substr($argument, strlen('--backup='));
            elseif ($argument === '--backup' && isset($argv[$index + 1])) $options['backup'] = (string)$argv[++$index];
            else throw new RuntimeException('Nieznany lub niekompletny argument: ' . $argument);
        }
        if ($mode === 'apply' && (!isset($options['baselineHash'], $options['backup']))) {
            throw new RuntimeException('Tryb apply wymaga --baseline-hash i --backup.');
        }
        if ($mode !== 'apply' && isset($options['backup'])) throw new RuntimeException('Kopia jest tworzona wyłącznie w trybie apply.');

        $_GET = $_POST = [];
        $_SERVER['REQUEST_METHOD'] = 'GET';
        require $siteRoot . '/re/setup_func.php';
        require_once $siteRoot . '/re/pricing/ClientTariffs.php';
        require_once $siteRoot . '/re/pricing/CatalogHistory.php';
        $db = get_pdo();
        if (!$db instanceof PDO) throw new RuntimeException('get_pdo() nie zwrócił PDO.');
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        $inspection = HistoricalEneaG11Importer::inspect($db);
        if ($mode === 'apply') {
            $result = HistoricalEneaG11Importer::runApply($db, $inspection, (string)$options['baselineHash'], (string)$options['backup']);
            $result['plan'] = $inspection['plan'];
        } else {
            if (isset($options['baselineHash']) && !hash_equals($inspection['baselineHash'], strtolower((string)$options['baselineHash']))) {
                throw new RuntimeException('Bieżący stan nie odpowiada przekazanemu baseline-hash.');
            }
            $result = $inspection['plan'];
            $result['ok'] = true;
            $result['mode'] = $mode;
            $result['writes'] = false;
            if ($mode === 'check') $result['check'] = 'passed';
        }
        echo json_encode($result, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_PRESERVE_ZERO_FRACTION), "\n";
    } catch (Throwable $error) {
        fwrite(STDERR, json_encode(['ok' => false, 'error' => $error->getMessage()], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n");
        exit(1);
    }
    exit(0);
}

if (isset($_SERVER['SCRIPT_FILENAME']) && realpath((string)$_SERVER['SCRIPT_FILENAME']) === __FILE__) historicalEneaG11Main($argv);
