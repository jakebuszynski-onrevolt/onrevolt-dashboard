<?php
declare(strict_types=1);
namespace OnRevolt\Pricing;

require_once __DIR__ . '/ClientTariffs.php';

final class DashboardTariffs
{
    private static function extendAfterMeasuredHistory(
        array &$history,
        array $profile,
        ClientTariffs $repository,
        ?array $targetSelection,
        string $until
    ): void
    {
        $targetOsd = (int)($targetSelection['osdId'] ?? 0);
        $targetTariff = (int)($targetSelection['tariffId'] ?? 0);
        if ($targetOsd <= 0 || $targetTariff <= 0) return;
        $lastUntil = null;
        foreach ($profile['periods'] as $period) {
            if ($period['validUntil'] === null) return;
            if ($lastUntil === null || $period['validUntil'] > $lastUntil) $lastUntil = $period['validUntil'];
        }
        if ($lastUntil === null) return;
        $missing = [];
        foreach ($history['issues'] as $issue) {
            if ($issue['date'] >= $lastUntil && str_contains($issue['message'], 'brak jednoznacznej taryfy')) {
                $missing[$issue['date']] = true;
            }
        }
        if (!$missing) return;

        $forecastProfile = $profile;
        $forecastProfile['periods'][] = [
            'id' => "forecast-target-$targetOsd-$targetTariff",
            'validFrom' => $lastUntil,
            'validUntil' => null,
            'osdId' => $targetOsd,
            'tariffId' => $targetTariff,
            'source' => 'TARGET',
            'overrides' => [],
            'schedule' => null,
            'note' => null,
        ];
        $forecast = $repository->history($forecastProfile, $lastUntil, $until);
        $filled = [];
        foreach (array_keys($missing) as $date) {
            $tariff = $forecast['byDate'][$date] ?? null;
            if ($tariff === null) continue;
            $history['byDate'][$date] = $tariff;
            $filled[$date] = true;
        }
        $history['issues'] = array_values(array_filter($history['issues'],
            static fn(array $issue): bool => !isset($filled[$issue['date']])));
    }

    public static function context(\PDO $pdo, string $station): array
    {
        $repository = new ClientTariffs($pdo);
        $profile = $repository->byStation($station);
        $revision = (int)$pdo->query('SELECT COALESCE(MAX(id),0) FROM pricing_catalog_revision')->fetchColumn();
        $query = $pdo->prepare('SELECT tariff_target_osd_id, tariff_target_tariff_id FROM EnergyMeter_users WHERE station=?');
        $query->execute([$station]);
        $target = $query->fetch(\PDO::FETCH_ASSOC) ?: [];
        $targetSelection = [
            'osdId' => (int)($target['tariff_target_osd_id'] ?? 0),
            'tariffId' => (int)($target['tariff_target_tariff_id'] ?? 0),
        ];
        return ['repository' => $repository, 'profile' => $profile,
            'targetSelection' => $targetSelection,
            'cacheKey' => 'ct' . ($profile['revision'] ?? 0) . '-c' . $revision
                . '-t' . $targetSelection['osdId'] . '.' . $targetSelection['tariffId']];
    }

    public static function attach(array &$payload, array $context): void
    {
        $profile = $context['profile'];
        $repository = $context['repository'];
        // A profile created only to store ENEA evidence is not an enabled tariff history yet.
        // Keep using the station's saved current/target tariffs until the first period is confirmed.
        if (!$profile || !$profile['periods']) return;
        $today = ClientTariffs::today();
        $year = (int)substr($today, 0, 4);
        $from = ($year - 1) . '-01-01';
        $until = ($year + 2) . '-01-01';
        foreach ($payload['usageData']['records'] ?? [] as $record) {
            $date = ClientTariffs::date($record['date']);
            $from = min($from, $date);
            $until = max($until, (new \DateTimeImmutable($date))->modify('+1 day')->format('Y-m-d'));
        }
        $history = $repository->history($profile, $from, $until);
        self::extendAfterMeasuredHistory(
            $history,
            $profile,
            $repository,
            $context['targetSelection'] ?? null,
            $until
        );
        $payload['tariffHistory'] = ClientTariffs::packHistory($history);
        $payload['tariffHistory']['cacheKey'] = $context['cacheKey'];
        $fixedCostContext = $profile['context'] ?? [];
        if ($fixedCostContext) {
            if (!isset($payload['account']) || !is_array($payload['account'])) $payload['account'] = [];
            foreach (['connectionPowerKw' => 'contractPowerKw', 'annualUsageKwh' => 'annualUsageKwh',
                'billingCycleMonths' => 'billingCycleMonths'] as $source => $target) {
                if (array_key_exists($source, $fixedCostContext)) $payload['account'][$target] = $fixedCostContext[$source];
            }
        }
        // Missing historical prices are explicit nulls; the existing basic selection is not substituted.
        $current = $history['byDate'][$today] ?? null;
        if (isset($payload['tariffData'])) $payload['tariffData']['current'] = $current;
        if (isset($payload['energy'])) foreach (['dailyBillPln','dailySavingsPln','purchasePricePln'] as $key) $payload['energy'][$key] = null;
    }
}
