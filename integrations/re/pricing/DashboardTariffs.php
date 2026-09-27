<?php
declare(strict_types=1);
namespace OnRevolt\Pricing;

require_once __DIR__ . '/ClientTariffs.php';

final class DashboardTariffs
{
    public static function context(\PDO $pdo, string $station): array
    {
        $repository = new ClientTariffs($pdo);
        $profile = $repository->byStation($station);
        $revision = (int)$pdo->query('SELECT COALESCE(MAX(id),0) FROM pricing_catalog_revision')->fetchColumn();
        return ['repository' => $repository, 'profile' => $profile,
            'cacheKey' => 'ct' . ($profile['revision'] ?? 0) . '-c' . $revision];
    }

    public static function attach(array &$payload, array $context): void
    {
        $profile = $context['profile'];
        $repository = $context['repository'];
        if (!$profile || (!$profile['periods'] && !$repository->evidence($profile['id']))) return;
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
        $payload['tariffHistory'] = ClientTariffs::packHistory($history);
        $payload['tariffHistory']['cacheKey'] = $context['cacheKey'];
        // Missing historical prices are explicit nulls; the existing basic selection is not substituted.
        $current = $history['byDate'][$today] ?? null;
        if (isset($payload['tariffData'])) $payload['tariffData']['current'] = $current;
        if (isset($payload['energy'])) foreach (['dailyBillPln','dailySavingsPln','purchasePricePln'] as $key) $payload['energy'][$key] = null;
    }
}
