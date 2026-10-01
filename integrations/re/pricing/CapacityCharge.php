<?php
declare(strict_types=1);

namespace OnRevolt\Pricing;

/** Regulated Polish capacity-charge rules attached to business tariff snapshots. */
final class CapacityCharge
{
    private const YEARLY_NET_RATES = [
        2021 => ['flat' => [1.87, 4.48, 7.47, 10.46], 'variable' => 0.0762],
        2022 => ['flat' => [2.37, 5.68, 9.46, 13.25], 'variable' => 0.1026],
        2023 => ['flat' => [2.38, 5.72, 9.54, 13.35], 'variable' => 0.1024],
        2024 => ['flat' => [2.66, 6.39, 10.64, 14.90], 'variable' => 0.12673],
        2025 => ['flat' => [2.86, 6.86, 11.44, 16.01], 'variable' => 0.1412],
        2026 => ['flat' => [4.29, 10.31, 17.18, 24.05], 'variable' => 0.2194],
    ];

    public static function attach(array $tariff, string $date): array
    {
        $year = (int)substr($date, 0, 4);
        $rates = self::YEARLY_NET_RATES[$year] ?? null;
        $rateYear = $year;
        $forecast = false;
        $latestRateYear = max(array_keys(self::YEARLY_NET_RATES));
        if ($rates === null && $year > $latestRateYear && ($tariff['clientPeriodSource'] ?? null) === 'TARGET') {
            $rateYear = $latestRateYear;
            $rates = self::YEARLY_NET_RATES[$rateYear];
            $forecast = true;
        }
        $segment = strtolower((string)($tariff['segment'] ?? 'household'));
        $code = strtoupper(trim((string)($tariff['code'] ?? '')));
        if ($segment === 'household' || !str_starts_with($code, 'C')) {
            unset($tariff['capacity_charge']);
            return $tariff;
        }

        $capacityRow = null;
        foreach (($tariff['variable'] ?? []) as $row) {
            if (preg_match('/op(?:ł|l)ata\s+mocowa/ui', (string)($row['label'] ?? ''))) {
                $capacityRow = $row;
                break;
            }
        }
        if ($capacityRow === null) {
            unset($tariff['capacity_charge']);
            return $tariff;
        }
        if ($rates === null) {
            throw new \RuntimeException('Wymaga uzupełnienia: brak stawki opłaty mocowej dla roku ' . $year . '.');
        }

        $storedVariableRate = (float)($capacityRow['price'] ?? 0);
        $basisMultiplier = $storedVariableRate / $rates['variable'];
        $flat = array_map(
            static fn(float $net): float => round($net * $basisMultiplier, 6),
            $rates['flat']
        );

        $tariff['capacity_charge'] = [
            'model' => 'pl_capacity_charge',
            'year' => $year,
            'rate_year' => $rateYear,
            'forecast' => $forecast,
            'effective_from' => sprintf('%04d-01-01', $year),
            'effective_until' => sprintf('%04d-01-01', $year + 1),
            'flat_eligible' => $segment === 'nn_le_40',
            'flat_max_power_kw' => 16.0,
            'flat_monthly' => [
                ['annual_usage_min_kwh' => null, 'annual_usage_max_kwh' => 500.0, 'amount' => $flat[0]],
                ['annual_usage_min_kwh' => 500.0, 'annual_usage_max_kwh' => 1200.0, 'amount' => $flat[1]],
                ['annual_usage_min_kwh' => 1200.0, 'annual_usage_max_kwh' => 2800.0, 'amount' => $flat[2]],
                ['annual_usage_min_kwh' => 2800.0, 'annual_usage_max_kwh' => null, 'amount' => $flat[3]],
            ],
            'variable_rate' => round($storedVariableRate, 6),
            'qualifying_hour_from' => 7,
            'qualifying_hour_until' => 22,
            'exclude_weekends' => true,
            'exclude_public_holidays' => true,
            'profile_factors' => [
                ['difference_max_percent' => 5.0, 'factor' => 0.17, 'group' => 'K1'],
                ['difference_max_percent' => 10.0, 'factor' => 0.50, 'group' => 'K2'],
                ['difference_max_percent' => 15.0, 'factor' => 0.83, 'group' => 'K3'],
                ['difference_max_percent' => null, 'factor' => 1.00, 'group' => 'K4'],
            ],
            'source' => $forecast
                ? 'Prognoza na podstawie ostatniej stawki URE z roku ' . $rateYear
                : 'URE / ustawa o rynku mocy',
        ];
        return $tariff;
    }
}
