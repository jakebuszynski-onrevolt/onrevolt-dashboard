<?php
declare(strict_types=1);

function re_measurement_history_days_in_month(int $year, int $month): int
{
    if ($year < 1 || $month < 1 || $month > 12) {
        throw new InvalidArgumentException('Nieprawidłowy rok lub miesiąc');
    }
    $first = new DateTimeImmutable(sprintf('%04d-%02d-01', $year, $month));
    return (int)$first->modify('last day of this month')->format('j');
}

function re_measurement_history_normalize_rows(int $year, int $month, array $rows): ?array
{
    $expected = re_measurement_history_days_in_month($year, $month) * 24;
    if (count($rows) !== $expected) {
        return null;
    }

    $normalized = [];
    foreach ($rows as $row) {
        $day = (int)($row['day'] ?? 0);
        $hour = (int)($row['hour'] ?? -1);
        $rawKwh = $row['kwh'] ?? null;
        if ($day < 1 || $day > re_measurement_history_days_in_month($year, $month)
            || $hour < 0 || $hour > 23 || !is_numeric($rawKwh) || (float)$rawKwh < 0) {
            return null;
        }
        $key = sprintf('%02d-%02d', $day, $hour);
        if (isset($normalized[$key])) {
            return null;
        }
        $normalized[$key] = ['day' => $day, 'hour' => $hour, 'kwh' => (float)$rawKwh];
    }
    if (count($normalized) !== $expected) {
        return null;
    }
    ksort($normalized, SORT_STRING);
    return array_values($normalized);
}

function re_measurement_history_complete_channels(array $groups): array
{
    $complete = [];
    foreach ($groups as $group) {
        $year = (int)($group['year'] ?? 0);
        $month = (int)($group['month'] ?? 0);
        $direction = (string)($group['direction'] ?? '');
        if (!in_array($direction, ['import', 'export'], true)) {
            continue;
        }
        $rows = re_measurement_history_normalize_rows($year, $month, (array)($group['rows'] ?? []));
        if ($rows === null) {
            continue;
        }
        $complete[] = [
            'year' => $year,
            'month' => $month,
            'direction' => $direction,
            'rows' => $rows,
            'totalKwh' => round(array_sum(array_column($rows, 'kwh')), 3),
        ];
    }
    usort($complete, static fn(array $a, array $b): int =>
        [$a['year'], $a['month'], $a['direction']] <=> [$b['year'], $b['month'], $b['direction']]
    );
    return $complete;
}

function re_measurement_history_complete_summaries(array $groups): array
{
    $complete = [];
    foreach ($groups as $group) {
        $year = (int)($group['year'] ?? 0);
        $month = (int)($group['month'] ?? 0);
        $direction = (string)($group['direction'] ?? '');
        $rows = (int)($group['rows'] ?? 0);
        $totalKwh = $group['totalKwh'] ?? null;
        if ($year < 1 || $month < 1 || $month > 12 || !in_array($direction, ['import', 'export'], true)
            || $rows !== re_measurement_history_days_in_month($year, $month) * 24
            || !is_numeric($totalKwh) || (float)$totalKwh < 0) {
            continue;
        }
        $complete[] = [
            'year' => $year,
            'month' => $month,
            'direction' => $direction,
            'rows' => $rows,
            'totalKwh' => round((float)$totalKwh, 3),
        ];
    }
    usort($complete, static fn(array $a, array $b): int =>
        [$a['year'], $a['month'], $a['direction']] <=> [$b['year'], $b['month'], $b['direction']]
    );
    return $complete;
}

function re_measurement_history_should_update_legacy(?int $legacyYear, int $incomingYear, bool $explicitReplace): bool
{
    return $legacyYear === null || $incomingYear > $legacyYear || ($incomingYear === $legacyYear && $explicitReplace);
}

function re_measurement_history_overlay_row(?array $legacy, array $history): ?array
{
    $row = [];
    foreach (['import', 'export'] as $direction) {
        if (array_key_exists($direction, $history)) {
            $row[$direction] = (float)$history[$direction];
        } elseif ($legacy !== null && array_key_exists($direction, $legacy)) {
            $row[$direction] = $legacy[$direction] === null ? null : (float)$legacy[$direction];
        } else {
            $row[$direction] = null;
        }
    }
    return $row['import'] === null && $row['export'] === null ? null : $row;
}

function re_measurement_history_row_has_import(?array $row): bool
{
    return $row !== null && array_key_exists('import', $row) && $row['import'] !== null;
}

function re_measurement_history_should_seed_profile(bool $profileExists, bool $importWillUpdate, bool $exportWillUpdate): bool
{
    return !$profileExists && !$importWillUpdate && $exportWillUpdate;
}

function re_measurement_history_ensure_table(PDO $pdo): void
{
    if ($pdo->inTransaction()) {
        throw new RuntimeException('Tabela historii musi być przygotowana przed transakcją');
    }
    $pdo->exec("CREATE TABLE IF NOT EXISTS EnergyMeter_users_usage_history (
        station VARCHAR(64) NOT NULL,
        year_no SMALLINT UNSIGNED NOT NULL,
        month_no TINYINT UNSIGNED NOT NULL,
        day_no TINYINT UNSIGNED NOT NULL,
        hour_no TINYINT UNSIGNED NOT NULL,
        direction ENUM('import','export') NOT NULL,
        kwh DECIMAL(12,6) NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (station, year_no, month_no, day_no, hour_no, direction),
        KEY station_period (station, year_no, month_no)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function re_measurement_history_archive_channels(PDO $pdo, string $station, array $channels, bool $replace = false, bool $ensureTable = true): void
{
    if ($ensureTable) {
        re_measurement_history_ensure_table($pdo);
    }
    $groups = [];
    foreach ($channels as $key => $channel) {
        $direction = (string)($channel['direction'] ?? $key);
        if (!in_array($direction, ['import', 'export'], true)) {
            throw new InvalidArgumentException('Nieprawidłowy kierunek kanału');
        }
        $year = (int)($channel['sourceYear'] ?? 0);
        $month = (int)($channel['month'] ?? 0);
        $rows = re_measurement_history_normalize_rows($year, $month, (array)($channel['hours'] ?? []));
        if ($rows === null) {
            throw new InvalidArgumentException('Archiwizowany kanał musi zawierać pełny miesiąc godzin');
        }
        $groups[] = ['year' => $year, 'month' => $month, 'direction' => $direction, 'rows' => $rows];
    }
    if (count($groups) !== count($channels)) {
        throw new InvalidArgumentException('Nieprawidłowy zestaw kanałów do archiwizacji');
    }

    $suffix = $replace
        ? ' ON DUPLICATE KEY UPDATE kwh=VALUES(kwh), updated_at=CURRENT_TIMESTAMP'
        : ' ON DUPLICATE KEY UPDATE updated_at=updated_at';
    $insert = $pdo->prepare('INSERT INTO EnergyMeter_users_usage_history
        (station, year_no, month_no, day_no, hour_no, direction, kwh)
        VALUES (?, ?, ?, ?, ?, ?, ?)' . $suffix);
    $ownsTransaction = !$pdo->inTransaction();
    if ($ownsTransaction) {
        $pdo->beginTransaction();
    }
    try {
        foreach ($groups as $group) {
            foreach ($group['rows'] as $row) {
                $insert->execute([
                    $station,
                    $group['year'],
                    $group['month'],
                    $row['day'],
                    $row['hour'],
                    $group['direction'],
                    sprintf('%.6F', $row['kwh']),
                ]);
            }
        }
        if ($ownsTransaction) {
            $pdo->commit();
        }
    } catch (Throwable $e) {
        if ($ownsTransaction && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

function re_measurement_history_channel_exists(PDO $pdo, string $station, int $year, int $month, string $direction): bool
{
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM EnergyMeter_users_usage_history
        WHERE station=? AND year_no=? AND month_no=? AND direction=?');
    $stmt->execute([$station, $year, $month, $direction]);
    return (int)$stmt->fetchColumn() === re_measurement_history_days_in_month($year, $month) * 24;
}

function re_measurement_history_legacy_current_year(PDO $pdo, string $station, int $month, string $direction, int $expectedRows): ?int
{
    if (!in_array($direction, ['import', 'export'], true)) {
        throw new InvalidArgumentException('Nieprawidłowy kierunek kanału');
    }
    $yearCol = $direction === 'export' ? 'export_source_year' : 'source_year';
    $sourceCol = $direction === 'export' ? 'export_source' : 'source';
    $stmt = $pdo->prepare("SELECT `$yearCol` AS source_year, COUNT(*) AS rows_count
        FROM EnergyMeter_users_usage_hourly
        WHERE station=? AND month_no=? AND `$sourceCol`='xlsx' AND `$yearCol` IS NOT NULL
        GROUP BY `$yearCol` HAVING COUNT(*)=? ORDER BY `$yearCol` DESC LIMIT 1");
    $stmt->execute([$station, $month, $expectedRows]);
    $year = $stmt->fetchColumn();
    return $year === false || $year === null ? null : (int)$year;
}

function re_measurement_history_backfill_legacy(PDO $pdo, string $station): void
{
    $archive = [];
    foreach ([
        'import' => ['source' => 'source', 'year' => 'source_year', 'value' => 'kwh'],
        'export' => ['source' => 'export_source', 'year' => 'export_source_year', 'value' => 'export_kwh'],
    ] as $direction => $columns) {
        $sourceCol = $columns['source'];
        $yearCol = $columns['year'];
        $valueCol = $columns['value'];
        $summary = $pdo->prepare("SELECT month_no, `$yearCol` AS source_year, COUNT(*) AS rows_count
            FROM EnergyMeter_users_usage_hourly
            WHERE station=? AND `$sourceCol`='xlsx' AND `$yearCol` IS NOT NULL
            GROUP BY month_no, `$yearCol`");
        $summary->execute([$station]);
        foreach ($summary->fetchAll(PDO::FETCH_ASSOC) as $candidate) {
            $year = (int)$candidate['source_year'];
            $month = (int)$candidate['month_no'];
            if ($year < 1 || $month < 1 || $month > 12
                || (int)$candidate['rows_count'] !== re_measurement_history_days_in_month($year, $month) * 24
                || re_measurement_history_channel_exists($pdo, $station, $year, $month, $direction)) {
                continue;
            }
            $rowsStmt = $pdo->prepare("SELECT day_no, hour_no, `$valueCol` AS kwh
                FROM EnergyMeter_users_usage_hourly
                WHERE station=? AND month_no=? AND `$sourceCol`='xlsx' AND `$yearCol`=?
                ORDER BY day_no, hour_no");
            $rowsStmt->execute([$station, $month, $year]);
            $rows = [];
            foreach ($rowsStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $rows[] = ['day' => (int)$row['day_no'], 'hour' => (int)$row['hour_no'], 'kwh' => (float)$row['kwh']];
            }
            $normalized = re_measurement_history_normalize_rows($year, $month, $rows);
            if ($normalized !== null) {
                $archive[] = ['direction' => $direction, 'sourceYear' => $year, 'month' => $month, 'hours' => $normalized];
            }
        }
    }
    if ($archive) {
        re_measurement_history_archive_channels($pdo, $station, $archive, false, false);
    }
}

function re_measurement_history_load(PDO $pdo, string $station): array
{
    re_measurement_history_ensure_table($pdo);
    re_measurement_history_backfill_legacy($pdo, $station);
    $stmt = $pdo->prepare('SELECT year_no AS year, month_no AS month, direction,
            COUNT(*) AS rows_count, SUM(kwh) AS totalKwh
        FROM EnergyMeter_users_usage_history WHERE station=?
        GROUP BY year_no, month_no, direction ORDER BY year_no, month_no, direction');
    $stmt->execute([$station]);
    $groups = array_map(static fn(array $row): array => [
        'year' => (int)$row['year'],
        'month' => (int)$row['month'],
        'direction' => (string)$row['direction'],
        'rows' => (int)$row['rows_count'],
        'totalKwh' => (float)$row['totalKwh'],
    ], $stmt->fetchAll(PDO::FETCH_ASSOC));
    return re_measurement_history_complete_summaries($groups);
}

function re_measurement_history_mysqli_overlay(mysqli $conn, string $station, DateTimeImmutable $from, DateTimeImmutable $until): array
{
    $exists = $conn->query("SHOW TABLES LIKE 'EnergyMeter_users_usage_history'");
    if (!$exists || $exists->num_rows === 0 || $until <= $from) {
        return [];
    }
    $query = $conn->prepare('SELECT day_no, hour_no, direction, kwh
        FROM EnergyMeter_users_usage_history WHERE station=? AND year_no=? AND month_no=?
        ORDER BY day_no, hour_no, direction');
    $overlay = [];
    $cursor = $from->setDate((int)$from->format('Y'), (int)$from->format('m'), 1)->setTime(0, 0);
    while ($cursor < $until) {
        $year = (int)$cursor->format('Y');
        $month = (int)$cursor->format('m');
        $query->bind_param('sii', $station, $year, $month);
        $query->execute();
        $result = $query->get_result();
        $groups = ['import' => [], 'export' => []];
        while ($row = $result->fetch_assoc()) {
            $direction = (string)$row['direction'];
            if (isset($groups[$direction])) {
                $groups[$direction][] = [
                    'day' => (int)$row['day_no'],
                    'hour' => (int)$row['hour_no'],
                    'kwh' => (float)$row['kwh'],
                ];
            }
        }
        foreach ($groups as $direction => $rows) {
            $completeRows = re_measurement_history_normalize_rows($year, $month, $rows);
            if ($completeRows === null) {
                continue;
            }
            foreach ($completeRows as $row) {
                $timestamp = sprintf('%04d-%02d-%02d %02d:00:00', $year, $month, $row['day'], $row['hour']);
                $at = new DateTimeImmutable($timestamp, $from->getTimezone());
                if ($at >= $from && $at < $until) {
                    $overlay[$timestamp][$direction] = $row['kwh'];
                }
            }
        }
        $cursor = $cursor->modify('+1 month');
    }
    $query->close();
    return $overlay;
}
