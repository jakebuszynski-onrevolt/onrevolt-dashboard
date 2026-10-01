<?php
// setup_func.php — DB, schema, API (?act=...), akcje POST i kontekst do widoku
declare(strict_types=1);
require_once __DIR__ . '/pricing/TariffStorage.php';

/* ========= DB ========= */
// Twoje dane dostępu (dokładnie jak podałeś)
function get_pdo(): PDO {
  $host = 'localhost:3306';
  $user = 'datbuser27';
  $pass = '3!mOn47D74b';
  $dbname = 'data_stats';
  $charset = 'utf8mb4';
  $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=$charset", $user, $pass, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
  ]);
  return $pdo;
}

if (isset($_GET['test'])) {
	$pdo=get_pdo();
	$a=load_tariff($pdo, 1, 1);
	print_r($a);
	exit;
}
if (isset($_GET['action'])) {

    $action = $_GET['action'];
    if ($action === 'json_osds') {
		$pdo=get_pdo();
		header('Content-Type: application/json; charset=utf-8');
		$rows = $pdo->query("SELECT id, name, slug, add_rdn, add_akcyza FROM osd ORDER BY name")->fetchAll();
		echo json_encode(['ok'=>true, 'osds'=>$rows], JSON_UNESCAPED_UNICODE);
		exit;
	}
		// --- JSON: taryfy dla OSD ---
	if ($action === 'json_tariffs') {
		$pdo = get_pdo();	
		header('Content-Type: application/json; charset=utf-8');
		$osd_id = (int)($_GET['osd'] ?? 0);
	
		if (!$osd_id) { echo json_encode(['ok'=>false,'error'=>'missing osd']); exit; }
	  
		$stmt = $pdo->prepare("SELECT id, code, name, segment, sell_method, use_monthly FROM tariff WHERE osd_id=? ORDER BY code");
		$stmt->execute([$osd_id]);
		$rows = $stmt->fetchAll();
		echo json_encode(['ok'=>true, 'tariffs'=>$rows], JSON_UNESCAPED_UNICODE);
		exit;
	}

	if ($action === 'user_consumption_get') {
		$pdo = get_pdo();
		header('Content-Type: application/json; charset=utf-8');
		try {
			$station = trim((string)($_GET['station'] ?? ''));
			$station = resolve_user_station($pdo, $station);
			echo json_encode(['ok'=>true, 'data'=>with_user_consumption_lock($pdo, $station, fn() => load_user_consumption_profile($pdo, $station))], JSON_UNESCAPED_UNICODE);
		} catch (Throwable $e) {
			http_response_code(500);
			echo json_encode(['ok'=>false, 'error'=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
		}
		exit;
	}

	if ($action === 'user_consumption_save') {
		$pdo = get_pdo();
		header('Content-Type: application/json; charset=utf-8');
		try {
			$body = json_decode(file_get_contents('php://input'), true);
			if (!is_array($body)) $body = $_POST;
			$station = trim((string)($body['station'] ?? $_GET['station'] ?? ''));
			$station = resolve_user_station($pdo, $station);
			$months = $body['months'] ?? null;
			$sources = $body['sources'] ?? null;
			echo json_encode(['ok'=>true, 'data'=>with_user_consumption_lock($pdo, $station, fn() => save_user_consumption_profile($pdo, $station, $months, $sources, ($body['protect_detailed'] ?? false) === true))], JSON_UNESCAPED_UNICODE);
		} catch (Throwable $e) {
			http_response_code($e->getCode() === 409 ? 409 : 400);
			echo json_encode(['ok'=>false, 'error'=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
		}
		exit;
	}

	if ($action === 'user_consumption_xlsx_upload') {
		$pdo = get_pdo();
		header('Content-Type: application/json; charset=utf-8');
		try {
			$station = trim((string)($_POST['station'] ?? $_GET['station'] ?? ''));
			$station = resolve_user_station($pdo, $station);
			if (!isset($_FILES['file']) || !is_array($_FILES['file'])) {
				throw new InvalidArgumentException('Brak pliku XLSX');
			}
			echo json_encode(['ok'=>true, 'data'=>with_user_consumption_lock($pdo, $station, fn() => save_user_consumption_xlsx($pdo, $station, $_FILES['file'], (string)($_POST['reject_existing'] ?? '') === '1'))], JSON_UNESCAPED_UNICODE);
		} catch (Throwable $e) {
			http_response_code($e->getCode() === 409 ? 409 : 400);
			$error = ['ok'=>false, 'error'=>$e->getMessage()];
			if ($e->getCode() === 409) $error['code'] = 'RE_MONTH_EXISTS';
			echo json_encode($error, JSON_UNESCAPED_UNICODE);
		}
		exit;
	}

	if ($action === 'user_consumption_month_reset') {
		$pdo = get_pdo();
		header('Content-Type: application/json; charset=utf-8');
		try {
			$body = json_decode(file_get_contents('php://input'), true);
			if (!is_array($body)) $body = $_POST;
			$station = trim((string)($body['station'] ?? $_GET['station'] ?? ''));
			$station = resolve_user_station($pdo, $station);
			$month = (int)($body['month'] ?? $_GET['month'] ?? 0);
			$direction = trim((string)($body['direction'] ?? $_GET['direction'] ?? 'import'));
			echo json_encode(['ok'=>true, 'data'=>with_user_consumption_lock($pdo, $station, fn() => reset_user_consumption_month($pdo, $station, $month, $direction))], JSON_UNESCAPED_UNICODE);
		} catch (Throwable $e) {
			http_response_code(400);
			echo json_encode(['ok'=>false, 'error'=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
		}
		exit;
	}

}

// Wrapper dla zgodności z setup.php (tam wywołujesz pdo())
if (!function_exists('pdo')) {
  function pdo(): PDO { return get_pdo(); }
}

/* ========= Helpery ogólne ========= */
if (!function_exists('h')) {
  function h($v): string {
    return htmlspecialchars((string)$v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
  }
}

// Zawsze zrób z wiersza 24-elementową tablicę liczb 1..$maxVal, indeksy 0..23
function normalizeMonthRow(array $row, int $maxVal = 3): array {
  // reindeksuj, usuń „dziury”
  $row = array_values($row);
  $norm = [];
  for ($h = 0; $h < 24; $h++) {
    $v = isset($row[$h]) ? (int)$row[$h] : 2;     // domyślnie 2
    if ($v < 1) $v = 1;
    if ($v > $maxVal) $v = $maxVal;
    $norm[$h] = $v;
  }
  return $norm;
}

// Zrób zakresy [code, from, to] z gotowego wiersza 24 wartości
function rangesFromRow(array $row): array {
  if (count($row) < 24) { $row = normalizeMonthRow($row, 3); }
  $res = [];
  $cur = $row[0];
  $a   = 0;
  for ($h = 1; $h < 24; $h++) {
    if ($row[$h] !== $cur) {
      $res[] = [$cur, $a, $h - 1];
      $cur = $row[$h];
      $a   = $h;
    }
  }
  $res[] = [$cur, $a, 23];
  return $res;
}


function redirect302(string $url): void {
  header('Location: ' . $url, true, 302);
  exit;
}
function post_val(string $key, $default=null) {
  return $_POST[$key] ?? $default;
}
function json_ok($data){ header('Content-Type: application/json; charset=utf-8'); echo json_encode(['ok'=>true,'data'=>$data], JSON_UNESCAPED_UNICODE); exit; }
function json_err($msg,$code=400){ header('Content-Type: application/json; charset=utf-8'); http_response_code($code); echo json_encode(['ok'=>false,'error'=>$msg], JSON_UNESCAPED_UNICODE); exit; }
function ensure_user_data_table(PDO $pdo): void {
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS EnergyMeter_users_data (
      station VARCHAR(64) NOT NULL,
      data_type VARCHAR(64) NOT NULL DEFAULT 'consumption_profile',
      month_01_kwh DECIMAL(12,3) NULL,
      month_02_kwh DECIMAL(12,3) NULL,
      month_03_kwh DECIMAL(12,3) NULL,
      month_04_kwh DECIMAL(12,3) NULL,
      month_05_kwh DECIMAL(12,3) NULL,
      month_06_kwh DECIMAL(12,3) NULL,
      month_07_kwh DECIMAL(12,3) NULL,
      month_08_kwh DECIMAL(12,3) NULL,
      month_09_kwh DECIMAL(12,3) NULL,
      month_10_kwh DECIMAL(12,3) NULL,
      month_11_kwh DECIMAL(12,3) NULL,
      month_12_kwh DECIMAL(12,3) NULL,
      month_01_source VARCHAR(16) NULL,
      month_02_source VARCHAR(16) NULL,
      month_03_source VARCHAR(16) NULL,
      month_04_source VARCHAR(16) NULL,
      month_05_source VARCHAR(16) NULL,
      month_06_source VARCHAR(16) NULL,
      month_07_source VARCHAR(16) NULL,
      month_08_source VARCHAR(16) NULL,
      month_09_source VARCHAR(16) NULL,
      month_10_source VARCHAR(16) NULL,
      month_11_source VARCHAR(16) NULL,
      month_12_source VARCHAR(16) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (station, data_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  ");
}
function ensure_user_data_source_columns(PDO $pdo): void {
  ensure_user_data_table($pdo);
  for ($i = 1; $i <= 12; $i++) {
    $col = sprintf('month_%02d_source', $i);
    if (!db_has_column($pdo, 'EnergyMeter_users_data', $col)) {
      $pdo->exec("ALTER TABLE `EnergyMeter_users_data` ADD COLUMN `$col` VARCHAR(16) NULL DEFAULT NULL");
    }
    $exportCol = sprintf('month_%02d_export_source', $i);
    if (!db_has_column($pdo, 'EnergyMeter_users_data', $exportCol)) {
      $pdo->exec("ALTER TABLE `EnergyMeter_users_data` ADD COLUMN `$exportCol` VARCHAR(16) NULL DEFAULT NULL");
    }
  }
}
function ensure_user_usage_hourly_table(PDO $pdo): void {
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS EnergyMeter_users_usage_hourly (
      station VARCHAR(64) NOT NULL,
      month_no TINYINT UNSIGNED NOT NULL,
      day_no TINYINT UNSIGNED NOT NULL,
      hour_no TINYINT UNSIGNED NOT NULL,
      kwh DECIMAL(12,6) NOT NULL DEFAULT 0,
      source VARCHAR(16) NOT NULL DEFAULT 'standard',
      source_year SMALLINT NULL,
      export_kwh DECIMAL(12,6) NOT NULL DEFAULT 0,
      export_source VARCHAR(16) NOT NULL DEFAULT 'standard',
      export_source_year SMALLINT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (station, month_no, day_no, hour_no),
      KEY station_source (station, source),
      KEY station_export_source (station, export_source)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  ");
  if (!db_has_column($pdo, 'EnergyMeter_users_usage_hourly', 'export_kwh')) {
    $pdo->exec("ALTER TABLE `EnergyMeter_users_usage_hourly` ADD COLUMN `export_kwh` DECIMAL(12,6) NOT NULL DEFAULT 0 AFTER `source_year`");
  }
  if (!db_has_column($pdo, 'EnergyMeter_users_usage_hourly', 'export_source')) {
    $pdo->exec("ALTER TABLE `EnergyMeter_users_usage_hourly` ADD COLUMN `export_source` VARCHAR(16) NOT NULL DEFAULT 'standard' AFTER `export_kwh`");
  }
  if (!db_has_column($pdo, 'EnergyMeter_users_usage_hourly', 'export_source_year')) {
    $pdo->exec("ALTER TABLE `EnergyMeter_users_usage_hourly` ADD COLUMN `export_source_year` SMALLINT NULL AFTER `export_source`");
  }
}
function with_user_consumption_lock(PDO $pdo, string $station, callable $operation) {
  $lockName = 're-consumption:' . substr(hash('sha256', $station), 0, 48);
  $lock = $pdo->prepare('SELECT GET_LOCK(?, 30)');
  $lock->execute([$lockName]);
  if ((int)$lock->fetchColumn() !== 1) {
    throw new RuntimeException('Nie udało się uzyskać blokady profilu stacji');
  }
  try {
    return $operation();
  } finally {
    $release = $pdo->prepare('SELECT RELEASE_LOCK(?)');
    $release->execute([$lockName]);
  }
}
function normalize_user_station($station): string {
  $station = trim((string)$station);
  if ($station === '') {
    throw new InvalidArgumentException('Brak numeru stacji');
  }
  if (!preg_match('/^[0-9A-Za-z_-]{1,64}$/', $station)) {
    throw new InvalidArgumentException('Nieprawidłowy numer stacji');
  }
  return $station;
}
function resolve_user_station(PDO $pdo, $station): string {
  $station = normalize_user_station($station);

  if (preg_match('/^\d+$/', $station)) {
    $stmt = $pdo->prepare('SELECT station FROM EnergyMeter_users WHERE station=? LIMIT 1');
    $stmt->execute([$station]);
    $row = $stmt->fetch();
    if ($row && trim((string)($row['station'] ?? '')) !== '') {
      return (string)$row['station'];
    }
  }

  if (db_has_column($pdo, 'EnergyMeter_users', 'station_hash')) {
    $stmt = $pdo->prepare(
      'SELECT station
       FROM EnergyMeter_users
       WHERE station_hash=?
       ORDER BY
         CASE
           WHEN station REGEXP "^[1-9][0-9]*$" THEN 0
           WHEN station REGEXP "^[0-9]+$" THEN 1
           ELSE 2
         END,
         CAST(station AS UNSIGNED),
         station
       LIMIT 1'
    );
    $stmt->execute([$station]);
    $row = $stmt->fetch();
    if ($row && trim((string)($row['station'] ?? '')) !== '') {
      return (string)$row['station'];
    }
  }

  return $station;
}
function normalize_consumption_months($months): array {
  if (!is_array($months) || count($months) !== 12) {
    throw new InvalidArgumentException('Profil musi mieć 12 miesięcy');
  }
  $out = [];
  $sum = 0.0;
  for ($i = 0; $i < 12; $i++) {
    $raw = str_replace(',', '.', (string)($months[$i] ?? ''));
    if ($raw === '' || !is_numeric($raw)) {
      throw new InvalidArgumentException('Nieprawidłowa wartość miesiąca ' . ($i + 1));
    }
    $value = (float)$raw;
    if ($value < 0) {
      throw new InvalidArgumentException('Zużycie miesięczne nie może być ujemne');
    }
    $out[] = round($value, 3);
    $sum += $value;
  }
  if ($sum <= 0) {
    throw new InvalidArgumentException('Suma zużycia musi być większa od zera');
  }
  return $out;
}
function normalize_annual_usage_kwh($value): float {
  $raw = str_replace(',', '.', trim((string)$value));
  if ($raw === '' || !is_numeric($raw)) {
    throw new InvalidArgumentException('Nieprawidłowe zużycie roczne');
  }
  $annual = (float)$raw;
  if ($annual <= 0) {
    throw new InvalidArgumentException('Zużycie roczne musi być większe od zera');
  }
  return round($annual, 3);
}
function user_annual_usage_column_candidates(): array {
  return [
    'annual_usage_kwh',
    'annualUsageKwh',
    'annual_consumption_kwh',
    'annualConsumptionKwh',
    'usage_annual_kwh'
  ];
}
function db_has_column(PDO $pdo, string $table, string $column): bool {
  $stmt = $pdo->prepare("SHOW COLUMNS FROM `$table` LIKE ?");
  $stmt->execute([$column]);
  return (bool)$stmt->fetch();
}
function ensure_user_annual_usage_column(PDO $pdo): string {
  foreach (user_annual_usage_column_candidates() as $column) {
    if (db_has_column($pdo, 'EnergyMeter_users', $column)) {
      return $column;
    }
  }
  $column = 'annual_usage_kwh';
  $pdo->exec("ALTER TABLE `EnergyMeter_users` ADD COLUMN `$column` DECIMAL(12,3) NULL DEFAULT NULL");
  return $column;
}
function load_user_annual_usage_kwh(PDO $pdo, string $station): ?float {
  $column = ensure_user_annual_usage_column($pdo);
  $stmt = $pdo->prepare("SELECT `$column` AS annual_usage_kwh FROM EnergyMeter_users WHERE station=? LIMIT 1");
  $stmt->execute([$station]);
  $row = $stmt->fetch();
  if (!$row || $row['annual_usage_kwh'] === null || $row['annual_usage_kwh'] === '') {
    return null;
  }
  return (float)$row['annual_usage_kwh'];
}
function assert_user_station_exists(PDO $pdo, string $station): void {
  $stmtCheck = $pdo->prepare('SELECT station FROM EnergyMeter_users WHERE station=? LIMIT 1');
  $stmtCheck->execute([$station]);
  if (!$stmtCheck->fetch()) {
    throw new RuntimeException('Nie znaleziono stacji w EnergyMeter_users: ' . $station);
  }
}
function save_user_annual_usage_kwh(PDO $pdo, string $station, float $annualUsageKwh): void {
  $column = ensure_user_annual_usage_column($pdo);
  assert_user_station_exists($pdo, $station);
  $stmt = $pdo->prepare("UPDATE EnergyMeter_users SET `$column`=? WHERE station=? LIMIT 1");
  $stmt->execute([normalize_annual_usage_kwh($annualUsageKwh), $station]);
}
function user_consumption_columns(): array {
  $cols = [];
  for ($i = 1; $i <= 12; $i++) {
    $cols[] = sprintf('month_%02d_kwh', $i);
  }
  return $cols;
}
function user_consumption_source_columns(): array {
  $cols = [];
  for ($i = 1; $i <= 12; $i++) {
    $cols[] = sprintf('month_%02d_source', $i);
  }
  return $cols;
}
function user_consumption_export_source_columns(): array {
  $cols = [];
  for ($i = 1; $i <= 12; $i++) {
    $cols[] = sprintf('month_%02d_export_source', $i);
  }
  return $cols;
}
function normalize_usage_source($source): string {
  $source = strtolower(trim((string)$source));
  return in_array($source, ['standard', 'manual', 'xlsx'], true) ? $source : 'manual';
}
function normalize_usage_direction($direction): string {
  return strtolower(trim((string)$direction)) === 'export' ? 'export' : 'import';
}
function normalize_consumption_sources($sources, string $default = 'manual'): array {
  $default = normalize_usage_source($default);
  $out = [];
  for ($i = 0; $i < 12; $i++) {
    $out[] = normalize_usage_source(is_array($sources) && array_key_exists($i, $sources) ? $sources[$i] : $default);
  }
  return $out;
}
function usage_profile_year(): int {
  return 2025;
}
function usage_days_in_month(int $month): int {
  if ($month < 1 || $month > 12) {
    throw new InvalidArgumentException('Nieprawidłowy miesiąc');
  }
  $dt = new DateTimeImmutable(sprintf('%04d-%02d-01', usage_profile_year(), $month), new DateTimeZone('Europe/Warsaw'));
  return (int)$dt->modify('last day of this month')->format('j');
}
function usage_default_use24(): array {
  return [
    2.97, 2.89, 2.89, 2.89, 2.97, 3.4, 4.25, 5.1,
    4.67, 4.25, 4.08, 3.82, 3.82, 3.91, 3.99, 4.25,
    6.63, 6.37, 5.78, 5.1, 4.67, 4.25, 3.82, 3.23,
  ];
}
function build_default_usage_months(float $annualUsageKwh): array {
  $annualUsageKwh = max(0.0, $annualUsageKwh);
  $months = [];
  for ($month = 1; $month <= 12; $month++) {
    $months[] = round($annualUsageKwh * usage_days_in_month($month) / 365.0, 3);
  }
  return $months;
}
function estimate_standard_month_usage_kwh(array $months, array $sources, int $month, ?float $annualUsageKwh = null): float {
  $standardKwh = 0.0;
  $standardDays = 0;
  for ($i = 0; $i < 12; $i++) {
    if ($i === $month - 1) {
      continue;
    }
    if (normalize_usage_source($sources[$i] ?? 'manual') !== 'standard') {
      continue;
    }
    $standardKwh += max(0.0, (float)($months[$i] ?? 0));
    $standardDays += usage_days_in_month($i + 1);
  }

  if ($standardDays > 0 && $standardKwh > 0) {
    return round(($standardKwh / $standardDays) * usage_days_in_month($month), 3);
  }

  $annual = $annualUsageKwh !== null ? max(0.0, $annualUsageKwh) : max(0.0, array_sum($months));
  return round(($annual / 365.0) * usage_days_in_month($month), 3);
}
function build_standard_usage_hour_rows(int $month, float $monthKwh, string $source): array {
  $days = usage_days_in_month($month);
  $profile = usage_default_use24();
  $profileSum = array_sum($profile);
  if ($profileSum <= 0) {
    throw new RuntimeException('Nieprawidłowy profil USE24');
  }
  $dayKwh = $monthKwh / $days;
  $rows = [];
  for ($day = 1; $day <= $days; $day++) {
    for ($hour = 0; $hour < 24; $hour++) {
      $rows[] = [
        'day' => $day,
        'hour' => $hour,
        'kwh' => round($dayKwh * ((float)$profile[$hour] / $profileSum), 6),
        'source' => $source,
        'source_year' => usage_profile_year(),
      ];
    }
  }
  return $rows;
}
function save_user_usage_hourly_month(PDO $pdo, string $station, int $month, array $rows, string $source, ?int $sourceYear = null, string $direction = 'import'): void {
  $station = normalize_user_station($station);
  $direction = normalize_usage_direction($direction);
  if ($month < 1 || $month > 12) {
    throw new InvalidArgumentException('Nieprawidłowy miesiąc');
  }
  ensure_user_usage_hourly_table($pdo);
  $expected = usage_days_in_month($month) * 24;
  if (count($rows) !== $expected) {
    throw new InvalidArgumentException('Miesiąc musi mieć komplet ' . $expected . ' godzin');
  }

  $pdo->beginTransaction();
  try {
    if ($direction === 'export') {
      $ins = $pdo->prepare('
        INSERT INTO EnergyMeter_users_usage_hourly
          (station, month_no, day_no, hour_no, export_kwh, export_source, export_source_year)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          export_kwh=VALUES(export_kwh),
          export_source=VALUES(export_source),
          export_source_year=VALUES(export_source_year)
      ');
    } else {
      $ins = $pdo->prepare('
        INSERT INTO EnergyMeter_users_usage_hourly
          (station, month_no, day_no, hour_no, kwh, source, source_year)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          kwh=VALUES(kwh),
          source=VALUES(source),
          source_year=VALUES(source_year)
      ');
    }
    foreach ($rows as $row) {
      $day = (int)($row['day'] ?? 0);
      $hour = (int)($row['hour'] ?? -1);
      $kwh = (float)($row['kwh'] ?? 0);
      if ($day < 1 || $day > usage_days_in_month($month) || $hour < 0 || $hour > 23 || $kwh < 0) {
        throw new InvalidArgumentException('Nieprawidłowy wiersz godzinowy zużycia');
      }
      $ins->execute([
        $station,
        $month,
        $day,
        $hour,
        sprintf('%.6F', $kwh),
        normalize_usage_source($row['source'] ?? $source),
        $row['source_year'] ?? $sourceYear,
      ]);
    }
    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $e;
  }
}
function user_usage_hourly_month_count(PDO $pdo, string $station, int $month, string $direction = 'import', ?string $source = null): int {
  ensure_user_usage_hourly_table($pdo);
  $direction = normalize_usage_direction($direction);
  $sourceCol = $direction === 'export' ? 'export_source' : 'source';
  $sql = 'SELECT COUNT(*) AS c FROM EnergyMeter_users_usage_hourly WHERE station=? AND month_no=?';
  $params = [$station, $month];
  if ($source !== null) {
    $sql .= " AND `$sourceCol`=?";
    $params[] = normalize_usage_source($source);
  }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return (int)($stmt->fetch()['c'] ?? 0);
}
function rebuild_user_usage_hourly_from_months(PDO $pdo, string $station, array $months, array $sources): void {
  ensure_user_usage_hourly_table($pdo);
  for ($i = 0; $i < 12; $i++) {
    $month = $i + 1;
    $source = normalize_usage_source($sources[$i] ?? 'manual');
    if ($source === 'xlsx') {
      $count = user_usage_hourly_month_count($pdo, $station, $month, 'import', 'xlsx');
      if ($count === usage_days_in_month($month) * 24) {
        continue;
      }
      throw new RuntimeException('Brak pełnego profilu XLSX dla miesiąca ' . $month);
    }
    save_user_usage_hourly_month(
      $pdo,
      $station,
      $month,
      build_standard_usage_hour_rows($month, (float)$months[$i], $source),
      $source,
      usage_profile_year()
    );
  }
}
function load_user_hourly_profile_meta(PDO $pdo, string $station): array {
  ensure_user_usage_hourly_table($pdo);
  $stmt = $pdo->prepare('SELECT COUNT(*) AS rows_count, MIN(updated_at) AS first_update, MAX(updated_at) AS last_update FROM EnergyMeter_users_usage_hourly WHERE station=?');
  $stmt->execute([$station]);
  $row = $stmt->fetch() ?: [];
  $count = (int)($row['rows_count'] ?? 0);
  return [
    'exists' => $count > 0,
    'rows' => $count,
    'firstUpdate' => $row['first_update'] ?? null,
    'lastUpdate' => $row['last_update'] ?? null,
  ];
}
function load_user_consumption_profile(PDO $pdo, $station): array {
  $station = normalize_user_station($station);
  ensure_user_data_source_columns($pdo);
  $cols = user_consumption_columns();
  $sourceCols = user_consumption_source_columns();
  $exportSourceCols = user_consumption_export_source_columns();
  $sql = 'SELECT ' . implode(', ', array_merge($cols, $sourceCols, $exportSourceCols)) . ', updated_at FROM EnergyMeter_users_data WHERE station=? AND data_type=? LIMIT 1';
  $stmt = $pdo->prepare($sql);
  $stmt->execute([$station, 'consumption_profile']);
  $row = $stmt->fetch();
  if (!$row) {
    return [
      'station'=>$station,
      'months'=>null,
      'sources'=>null,
      'exportSources'=>null,
      'annualUsageKwh'=>load_user_annual_usage_kwh($pdo, $station),
      'hourlyProfile'=>load_user_hourly_profile_meta($pdo, $station),
      'updated_at'=>null
    ];
  }
  $months = [];
  foreach ($cols as $col) {
    $months[] = isset($row[$col]) ? (float)$row[$col] : 0.0;
  }
  $sources = [];
  foreach ($sourceCols as $col) {
    $sources[] = normalize_usage_source($row[$col] ?? 'manual');
  }
  $exportSources = [];
  foreach ($exportSourceCols as $col) {
    $exportSources[] = normalize_usage_source($row[$col] ?? 'standard');
  }
  $hourlyMeta = load_user_hourly_profile_meta($pdo, $station);
  if (!$hourlyMeta['exists'] && array_sum($months) > 0) {
    rebuild_user_usage_hourly_from_months($pdo, $station, $months, $sources);
    $hourlyMeta = load_user_hourly_profile_meta($pdo, $station);
  }
  return [
    'station'=>$station,
    'months'=>$months,
    'sources'=>$sources,
    'exportSources'=>$exportSources,
    'annualUsageKwh'=>load_user_annual_usage_kwh($pdo, $station),
    'hourlyProfile'=>$hourlyMeta,
    'updated_at'=>$row['updated_at'] ?? null
  ];
}
function upsert_user_consumption_profile_row(PDO $pdo, string $station, array $months, array $sources): void {
  ensure_user_data_source_columns($pdo);
  $cols = user_consumption_columns();
  $sourceCols = user_consumption_source_columns();
  $insertCols = array_merge(['station', 'data_type'], $cols, $sourceCols);
  $placeholders = implode(', ', array_fill(0, count($insertCols), '?'));
  $updates = implode(', ', array_map(fn($col) => "$col=VALUES($col)", array_merge($cols, $sourceCols)));
  $sql = 'INSERT INTO EnergyMeter_users_data (' . implode(', ', $insertCols) . ') VALUES (' . $placeholders . ')
    ON DUPLICATE KEY UPDATE ' . $updates . ', updated_at=CURRENT_TIMESTAMP';
  $stmt = $pdo->prepare($sql);
  $stmt->execute(array_merge([$station, 'consumption_profile'], $months, $sources));
}
function upsert_user_consumption_export_sources(PDO $pdo, string $station, array $exportSources): void {
  ensure_user_data_source_columns($pdo);
  $exportSources = normalize_consumption_sources($exportSources, 'standard');
  $cols = user_consumption_export_source_columns();
  $insertCols = array_merge(['station', 'data_type'], $cols);
  $placeholders = implode(', ', array_fill(0, count($insertCols), '?'));
  $updates = implode(', ', array_map(fn($col) => "$col=VALUES($col)", $cols));
  $sql = 'INSERT INTO EnergyMeter_users_data (' . implode(', ', $insertCols) . ') VALUES (' . $placeholders . ')
    ON DUPLICATE KEY UPDATE ' . $updates . ', updated_at=CURRENT_TIMESTAMP';
  $stmt = $pdo->prepare($sql);
  $stmt->execute(array_merge([$station, 'consumption_profile'], $exportSources));
}
function save_user_consumption_profile(PDO $pdo, $station, $months, $sources = null, bool $protectDetailed = false): array {
  $station = normalize_user_station($station);
  $months = normalize_consumption_months($months);
  $sources = normalize_consumption_sources($sources, 'manual');
  $annualUsageKwh = round(array_sum($months), 3);
  assert_user_station_exists($pdo, $station);
  if ($protectDetailed) {
    $monthColumns = user_consumption_columns();
    $sourceColumns = user_consumption_source_columns();
    $check = $pdo->prepare('SELECT ' . implode(', ', array_merge($monthColumns, $sourceColumns)) . ' FROM EnergyMeter_users_data WHERE station=? AND data_type=? LIMIT 1');
    $check->execute([$station, 'consumption_profile']);
    $current = $check->fetch();
    if ($current) {
      foreach ($monthColumns as $index => $column) {
        $currentSource = normalize_usage_source($current[$sourceColumns[$index]] ?? 'manual');
        $currentValue = (float)($current[$column] ?? 0);
        if ($currentSource !== 'standard' && ($sources[$index] !== $currentSource || $months[$index] !== $currentValue)) {
          throw new RuntimeException('Profil szczegółowy miesiąca ' . ($index + 1) . ' zmienił się. Odśwież profil przed zapisem.', 409);
        }
      }
    }
  }
  upsert_user_consumption_profile_row($pdo, $station, $months, $sources);
  save_user_annual_usage_kwh($pdo, $station, $annualUsageKwh);
  rebuild_user_usage_hourly_from_months($pdo, $station, $months, $sources);
  return load_user_consumption_profile($pdo, $station);
}
function xlsx_col_index(string $cellRef): int {
  if (!preg_match('/^([A-Z]+)/i', $cellRef, $m)) {
    return 0;
  }
  $letters = strtoupper($m[1]);
  $index = 0;
  for ($i = 0; $i < strlen($letters); $i++) {
    $index = $index * 26 + (ord($letters[$i]) - 64);
  }
  return $index;
}
function xlsx_open_archive(string $path): array {
  $data = file_get_contents($path);
  if ($data === false) {
    throw new InvalidArgumentException('Nie można odczytać pliku XLSX');
  }
  $eocd = strrpos($data, "\x50\x4b\x05\x06");
  if ($eocd === false) {
    throw new InvalidArgumentException('Plik nie wygląda jak XLSX/ZIP');
  }
  $eocdData = unpack('vdisk/vstartDisk/ventriesDisk/ventries/Vsize/Voffset/vcommentLen', substr($data, $eocd + 4, 18));
  $pos = (int)$eocdData['offset'];
  $entries = [];
  for ($i = 0; $i < (int)$eocdData['entries']; $i++) {
    if (substr($data, $pos, 4) !== "\x50\x4b\x01\x02") {
      throw new InvalidArgumentException('Uszkodzona central directory w XLSX');
    }
    $h = unpack(
      'vverMade/vverNeed/vflags/vmethod/vtime/vdate/Vcrc/VcompSize/VuncompSize/vnameLen/vextraLen/vcommentLen/vdisk/vintAttr/VextAttr/VlocalOffset',
      substr($data, $pos + 4, 42)
    );
    $name = substr($data, $pos + 46, (int)$h['nameLen']);
    $entries[$name] = [
      'method' => (int)$h['method'],
      'compSize' => (int)$h['compSize'],
      'localOffset' => (int)$h['localOffset'],
    ];
    $pos += 46 + (int)$h['nameLen'] + (int)$h['extraLen'] + (int)$h['commentLen'];
  }
  return ['data' => $data, 'entries' => $entries];
}
function xlsx_archive_get(array $archive, string $name) {
  if (!isset($archive['entries'][$name])) return false;
  $data = $archive['data'];
  $entry = $archive['entries'][$name];
  $offset = (int)$entry['localOffset'];
  if (substr($data, $offset, 4) !== "\x50\x4b\x03\x04") {
    throw new InvalidArgumentException('Uszkodzony wpis XLSX: ' . $name);
  }
  $h = unpack('vver/vflags/vmethod/vtime/vdate/Vcrc/VcompSize/VuncompSize/vnameLen/vextraLen', substr($data, $offset + 4, 26));
  $start = $offset + 30 + (int)$h['nameLen'] + (int)$h['extraLen'];
  $compressed = substr($data, $start, (int)$entry['compSize']);
  if ((int)$entry['method'] === 0) {
    return $compressed;
  }
  if ((int)$entry['method'] === 8) {
    $plain = gzinflate($compressed);
    if ($plain === false) {
      throw new InvalidArgumentException('Nie można rozpakować wpisu XLSX: ' . $name);
    }
    return $plain;
  }
  throw new InvalidArgumentException('Nieobsługiwany typ kompresji XLSX: ' . $entry['method']);
}
function xlsx_shared_strings(array $archive): array {
  $xmlText = xlsx_archive_get($archive, 'xl/sharedStrings.xml');
  if ($xmlText === false || trim($xmlText) === '') return [];
  $xml = simplexml_load_string($xmlText);
  if (!$xml) return [];
  $xml->registerXPathNamespace('m', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
  $strings = [];
  foreach ($xml->si as $si) {
    $si->registerXPathNamespace('m', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
    $parts = $si->xpath('.//m:t') ?: [];
    $text = '';
    foreach ($parts as $part) {
      $text .= (string)$part;
    }
    $strings[] = $text;
  }
  return $strings;
}
function xlsx_first_sheet_path(array $archive): string {
  $fallback = 'xl/worksheets/sheet1.xml';
  $workbookText = xlsx_archive_get($archive, 'xl/workbook.xml');
  $relsText = xlsx_archive_get($archive, 'xl/_rels/workbook.xml.rels');
  if ($workbookText === false || $relsText === false) return $fallback;
  $workbook = simplexml_load_string($workbookText);
  $rels = simplexml_load_string($relsText);
  if (!$workbook || !$rels) return $fallback;
  $workbook->registerXPathNamespace('m', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
  $sheets = $workbook->xpath('//m:sheets/m:sheet');
  if (!$sheets) return $fallback;
  $relId = (string)$sheets[0]->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships')['id'];
  if ($relId === '') return $fallback;
  foreach ($rels->Relationship as $rel) {
    if ((string)$rel['Id'] !== $relId) continue;
    $target = (string)$rel['Target'];
    if ($target === '') break;
    if (strpos($target, '/') === 0) return ltrim($target, '/');
    return 'xl/' . ltrim($target, '/');
  }
  return $fallback;
}
function xlsx_cell_value(SimpleXMLElement $cell, array $sharedStrings) {
  $type = (string)$cell['t'];
  if ($type === 's') {
    $idx = (int)((string)$cell->v);
    return $sharedStrings[$idx] ?? '';
  }
  if ($type === 'inlineStr') {
    return (string)($cell->is->t ?? '');
  }
  return (string)($cell->v ?? '');
}
function xlsx_row_values(SimpleXMLElement $row, array $sharedStrings): array {
  $values = [];
  foreach ($row->c as $cell) {
    $ref = (string)$cell['r'];
    $col = xlsx_col_index($ref);
    if ($col < 1) continue;
    $values[$col] = xlsx_cell_value($cell, $sharedStrings);
  }
  return $values;
}
function parse_osd_xlsx_datetime($value): ?DateTimeImmutable {
  $raw = trim((string)$value);
  if ($raw === '') return null;
  $winterSuffix = ' czasu zimowego';
  $winterTime = str_ends_with($raw, $winterSuffix);
  if ($winterTime) $raw = substr($raw, 0, -strlen($winterSuffix));
  foreach (['Y-m-d H:i:s', 'Y-m-d H:i', 'd.m.Y H:i:s', 'd.m.Y H:i'] as $fmt) {
    $dt = DateTimeImmutable::createFromFormat($fmt, $raw, new DateTimeZone('Europe/Warsaw'));
    if (!$dt instanceof DateTimeImmutable) continue;
    if ($winterTime) {
      $errors = DateTimeImmutable::getLastErrors();
      $fallback = osd_xlsx_fallback_transition((int)$dt->format('Y'), (int)$dt->format('m'), (int)$dt->format('d'));
      if (($errors && ($errors['warning_count'] || $errors['error_count']))
          || !$fallback || $dt->format('H:i:s') !== '03:00:00'
          || $dt->getOffset() !== (int)$fallback['new_offset']) {
        throw new InvalidArgumentException('Dopisek czasu zimowego jest dozwolony tylko o 03:00 w dniu cofnięcia czasu');
      }
    }
    return $dt;
  }
  if ($winterTime) {
    throw new InvalidArgumentException('Nieprawidłowa data z dopiskiem czasu zimowego');
  }
  if (is_numeric($raw)) {
    $serial = (float)$raw;
    if ($serial > 20000 && $serial < 80000) {
      $seconds = (int)round(($serial - 25569) * 86400);
      return (new DateTimeImmutable('@' . $seconds))->setTimezone(new DateTimeZone('Europe/Warsaw'));
    }
  }
  return null;
}
function parse_osd_xlsx_number($value): float {
  $raw = str_replace(',', '.', trim((string)$value));
  if ($raw === '') return 0.0;
  if (!is_numeric($raw)) {
    throw new InvalidArgumentException('Nieprawidłowa wartość kWh w arkuszu: ' . $value);
  }
  $num = (float)$raw;
  if ($num < 0) {
    throw new InvalidArgumentException('Ujemne zużycie w arkuszu XLSX');
  }
  return $num;
}
function osd_xlsx_days_in_month(int $year, int $month): int {
  $dt = new DateTimeImmutable(sprintf('%04d-%02d-01', $year, $month), new DateTimeZone('Europe/Warsaw'));
  return (int)$dt->modify('last day of this month')->format('j');
}
function osd_xlsx_fallback_transition(int $year, int $month, int $day): ?array {
  $tz = new DateTimeZone('Europe/Warsaw');
  $dayStart = new DateTimeImmutable(sprintf('%04d-%02d-%02d 00:00:00', $year, $month, $day), $tz);
  $dayEnd = $dayStart->modify('+1 day');
  $transitions = $tz->getTransitions($dayStart->getTimestamp(), $dayEnd->getTimestamp());
  $previous = null;
  foreach ($transitions as $transition) {
    if ($previous !== null && (int)$transition['offset'] < (int)$previous['offset']) {
      $local = (new DateTimeImmutable('@' . $transition['ts']))->setTimezone($tz);
      return [
        'hour' => (int)$local->format('H'),
        'new_offset' => (int)$transition['offset'],
        'old_offset' => (int)$previous['offset'],
        'delta' => (int)$previous['offset'] - (int)$transition['offset'],
      ];
    }
    $previous = $transition;
  }
  return null;
}
function osd_xlsx_period_start(DateTimeImmutable $dt): DateTimeImmutable {
  $tz = new DateTimeZone('Europe/Warsaw');
  $local = $dt->setTimezone($tz);
  $fallback = osd_xlsx_fallback_transition(
    (int)$local->format('Y'),
    (int)$local->format('m'),
    (int)$local->format('d')
  );
  if ($fallback
      && (int)$local->format('H') === (int)$fallback['hour']
      && $local->getOffset() === (int)$fallback['new_offset']) {
    $local = (new DateTimeImmutable('@' . ($local->getTimestamp() - (int)$fallback['delta'])))->setTimezone($tz);
  }
  return $dt
    ->setTimestamp($local->getTimestamp())
    ->setTimezone(new DateTimeZone('UTC'))
    ->modify('-1 hour')
    ->setTimezone($tz);
}
function osd_xlsx_is_missing_dst_hour(int $year, int $month, int $day, int $hour): bool {
  $tz = new DateTimeZone('Europe/Warsaw');
  $local = DateTimeImmutable::createFromFormat(
    '!Y-m-d H:i:s',
    sprintf('%04d-%02d-%02d %02d:00:00', $year, $month, $day, $hour),
    $tz
  );
  return $local instanceof DateTimeImmutable && (int)$local->format('H') !== $hour;
}
function osd_xlsx_fill_missing_dst_hour(array &$rowsByKey, int $year, int $month, int $expected): void {
  if (count($rowsByKey) !== $expected - 1) return;

  $missing = [];
  for ($day = 1; $day <= usage_days_in_month($month); $day++) {
    for ($hour = 0; $hour < 24; $hour++) {
      $key = sprintf('%02d-%02d', $day, $hour);
      if (!isset($rowsByKey[$key])) {
        $missing[] = [$key, $day, $hour];
      }
    }
  }
  if (count($missing) !== 1) return;

  [$key, $day, $hour] = $missing[0];
  if (!osd_xlsx_is_missing_dst_hour($year, $month, $day, $hour)) return;

  $rowsByKey[$key] = [
    'day' => $day,
    'hour' => $hour,
    'kwh' => 0.0,
    'source' => 'xlsx',
    'source_year' => $year,
  ];
}
function osd_xlsx_is_repeated_dst_hour(int $year, int $month, int $day, int $hour): bool {
  $fallback = osd_xlsx_fallback_transition($year, $month, $day);
  return $fallback !== null && (int)$fallback['hour'] === $hour;
}
function is_osd_xlsx_data_status(string $status): bool {
  return in_array($status, ['Dane rzeczywiste', 'Dane szacowane'], true);
}
function parse_osd_consumption_xlsx(string $path): array {
  if (!is_file($path)) {
    throw new InvalidArgumentException('Nie znaleziono pliku XLSX');
  }
  $archive = xlsx_open_archive($path);
  try {
    $shared = xlsx_shared_strings($archive);
    $sheetPath = xlsx_first_sheet_path($archive);
    $sheetText = xlsx_archive_get($archive, $sheetPath);
    if ($sheetText === false) {
      throw new InvalidArgumentException('Nie znaleziono arkusza w XLSX');
    }
    $sheet = simplexml_load_string($sheetText);
    if (!$sheet) {
      throw new InvalidArgumentException('Nie można odczytać arkusza XLSX');
    }

    $headerFound = false;
    $dateCol = 0;
    $statusCol = 0;
    $valueColsByDirection = [
      'import' => [],
      'export' => [],
    ];
    $rowsByDirection = [
      'import' => [],
      'export' => [],
    ];
    $yearMonth = null;
    $sourceYear = null;
    $invalidStatus = 0;

    foreach ($sheet->sheetData->row as $row) {
      $values = xlsx_row_values($row, $shared);
      if (!$headerFound) {
        foreach ($values as $col => $text) {
          $label = trim((string)$text);
          $labelLower = strtolower($label);
          if ($dateCol === 0 && strpos($labelLower, 'dzie') !== false) {
            $dateCol = $col;
          }
          if ($statusCol === 0 && strpos($labelLower, 'status') !== false) {
            $statusCol = $col;
          }
          if (strpos($labelLower, 'energia czynna pobrana') !== false && strpos($labelLower, 'po bilansowaniu') !== false) {
            $valueColsByDirection['import'][] = $col;
          }
          if (strpos($labelLower, 'energia czynna oddana') !== false && strpos($labelLower, 'po bilansowaniu') !== false) {
            $valueColsByDirection['export'][] = $col;
          }
        }
        if ($dateCol && $statusCol && ($valueColsByDirection['import'] || $valueColsByDirection['export'])) {
          $headerFound = true;
        }
        continue;
      }

      $rawDate = trim((string)($values[$dateCol] ?? ''));
      $dt = parse_osd_xlsx_datetime($rawDate);
      if (!$dt) {
        if (preg_match('/^(?:\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})/', $rawDate)
            || is_osd_xlsx_data_status(trim((string)($values[$statusCol] ?? '')))) {
          throw new InvalidArgumentException('Nieprawidłowa data lub dopisek godziny w arkuszu XLSX: ' . $rawDate);
        }
        continue;
      }
      $periodStart = osd_xlsx_period_start($dt);
      $ym = $periodStart->format('Y-m');
      if ($yearMonth === null) {
        $yearMonth = $ym;
        $sourceYear = (int)$periodStart->format('Y');
      } elseif ($yearMonth !== $ym) {
        throw new InvalidArgumentException('Arkusz zawiera dane z więcej niż jednego miesiąca');
      }

      $status = trim((string)($values[$statusCol] ?? ''));
      if (!is_osd_xlsx_data_status($status)) {
        $invalidStatus++;
        continue;
      }

      $key = $periodStart->format('d-H');
      foreach ($valueColsByDirection as $direction => $valueCols) {
        if (!$valueCols) continue;
        $kwh = 0.0;
        foreach ($valueCols as $col) {
          $kwh += parse_osd_xlsx_number($values[$col] ?? '');
        }
        if (isset($rowsByDirection[$direction][$key])) {
          if (osd_xlsx_is_repeated_dst_hour(
            (int)$periodStart->format('Y'),
            (int)$periodStart->format('m'),
            (int)$periodStart->format('d'),
            (int)$periodStart->format('H')
          )) {
            $rowsByDirection[$direction][$key]['kwh'] = round((float)$rowsByDirection[$direction][$key]['kwh'] + $kwh, 6);
            continue;
          }
          throw new InvalidArgumentException('Zdublowana godzina w XLSX: ' . $periodStart->format('Y-m-d H:00'));
        }
        $rowsByDirection[$direction][$key] = [
          'day' => (int)$periodStart->format('d'),
          'hour' => (int)$periodStart->format('H'),
          'kwh' => round($kwh, 6),
          'source' => 'xlsx',
          'source_year' => $sourceYear,
        ];
      }
    }

    if (!$headerFound) {
      throw new InvalidArgumentException('Nie znaleziono kolumn: Dzień, Status i Energia czynna pobrana/oddana po bilansowaniu');
    }
    if ($yearMonth === null) {
      throw new InvalidArgumentException('Arkusz nie zawiera godzinowych danych zużycia');
    }
    [$yearRaw, $monthRaw] = array_map('intval', explode('-', $yearMonth));
    $month = (int)$monthRaw;
    $actualDays = osd_xlsx_days_in_month((int)$yearRaw, $month);
    if ($actualDays !== usage_days_in_month($month)) {
      throw new InvalidArgumentException('Profil roczny ma 365 dni, arkusz z 29 lutego nie jest obsługiwany');
    }
    $expected = usage_days_in_month($month) * 24;
    if ($invalidStatus > 0) {
      throw new InvalidArgumentException('Arkusz zawiera godziny bez statusu Dane rzeczywiste/Dane szacowane');
    }

    $channels = [];
    foreach ($rowsByDirection as $direction => $rowsByKey) {
      if (!$valueColsByDirection[$direction]) continue;
      osd_xlsx_fill_missing_dst_hour($rowsByKey, (int)$yearRaw, $month, $expected);
      if (count($rowsByKey) !== $expected) {
        throw new InvalidArgumentException('Arkusz nie ma pełnego miesiąca realnych danych: ' . count($rowsByKey) . '/' . $expected . ' godzin');
      }
      $rows = [];
      $total = 0.0;
      for ($day = 1; $day <= usage_days_in_month($month); $day++) {
        for ($hour = 0; $hour < 24; $hour++) {
          $key = sprintf('%02d-%02d', $day, $hour);
          if (!isset($rowsByKey[$key])) {
            throw new InvalidArgumentException('Brak godziny w XLSX: dzień ' . $day . ', godzina ' . $hour);
          }
          $rows[] = $rowsByKey[$key];
          $total += (float)$rowsByKey[$key]['kwh'];
        }
      }
      $channels[$direction] = [
        'month' => $month,
        'sourceYear' => $sourceYear,
        'totalKwh' => round($total, 3),
        'hours' => $rows,
      ];
    }

    return [
      'month' => $month,
      'sourceYear' => $sourceYear,
      'channels' => $channels,
    ];
  } catch (Throwable $e) {
    throw $e;
  }
}
function load_existing_or_default_consumption_profile(PDO $pdo, string $station): array {
  $profile = load_user_consumption_profile($pdo, $station);
  $months = is_array($profile['months'] ?? null)
    ? normalize_consumption_months($profile['months'])
    : build_default_usage_months(load_user_annual_usage_kwh($pdo, $station) ?? 5000.0);
  $sources = is_array($profile['sources'] ?? null)
    ? normalize_consumption_sources($profile['sources'], 'standard')
    : normalize_consumption_sources(null, 'standard');
  $exportSources = is_array($profile['exportSources'] ?? null)
    ? normalize_consumption_sources($profile['exportSources'], 'standard')
    : normalize_consumption_sources(null, 'standard');
  return [$months, $sources, $exportSources];
}
function save_user_consumption_xlsx(PDO $pdo, string $station, array $file, bool $rejectExisting = false): array {
  $station = normalize_user_station($station);
  assert_user_station_exists($pdo, $station);
  $err = (int)($file['error'] ?? UPLOAD_ERR_NO_FILE);
  if ($err !== UPLOAD_ERR_OK) {
    throw new InvalidArgumentException('Błąd uploadu XLSX: ' . $err);
  }
  $tmp = (string)($file['tmp_name'] ?? '');
  $parsed = parse_osd_consumption_xlsx($tmp);
  $channels = is_array($parsed['channels'] ?? null) ? $parsed['channels'] : [];
  if (!$channels) {
    throw new InvalidArgumentException('Arkusz nie zawiera danych pobranych ani oddanych');
  }
  if ($rejectExisting) {
    $importColumns = user_consumption_source_columns();
    $exportColumns = user_consumption_export_source_columns();
    $check = $pdo->prepare('SELECT ' . implode(', ', array_merge($importColumns, $exportColumns)) . ' FROM EnergyMeter_users_data WHERE station=? AND data_type=? LIMIT 1');
    $check->execute([$station, 'consumption_profile']);
    $current = $check->fetch() ?: [];
    foreach ($channels as $direction => $channel) {
      $columns = $direction === 'export' ? $exportColumns : $importColumns;
      $column = $columns[((int)$channel['month']) - 1];
      if (normalize_usage_source($current[$column] ?? 'standard') === 'xlsx') {
        throw new RuntimeException('Profil XLSX dla wskazanego miesiąca już istnieje', 409);
      }
    }
  }
  [$months, $sources, $exportSources] = load_existing_or_default_consumption_profile($pdo, $station);

  if (isset($channels['import'])) {
    $idx = ((int)$channels['import']['month']) - 1;
    $months[$idx] = (float)$channels['import']['totalKwh'];
    $sources[$idx] = 'xlsx';
  }
  if (isset($channels['export'])) {
    $idx = ((int)$channels['export']['month']) - 1;
    $exportSources[$idx] = 'xlsx';
  }

  upsert_user_consumption_profile_row($pdo, $station, $months, $sources);
  upsert_user_consumption_export_sources($pdo, $station, $exportSources);
  save_user_annual_usage_kwh($pdo, $station, round(array_sum($months), 3));
  if (isset($channels['import'])) {
    save_user_usage_hourly_month($pdo, $station, (int)$channels['import']['month'], $channels['import']['hours'], 'xlsx', (int)$channels['import']['sourceYear'], 'import');
  }
  if (isset($channels['export'])) {
    save_user_usage_hourly_month($pdo, $station, (int)$channels['export']['month'], $channels['export']['hours'], 'xlsx', (int)$channels['export']['sourceYear'], 'export');
  }
  rebuild_user_usage_hourly_from_months($pdo, $station, $months, $sources);
  $result = load_user_consumption_profile($pdo, $station);
  if (isset($channels['import'])) {
    $result['imported'] = [
      'month' => (int)$channels['import']['month'],
      'sourceYear' => (int)$channels['import']['sourceYear'],
      'totalKwh' => (float)$channels['import']['totalKwh'],
    ];
  }
  if (isset($channels['export'])) {
    $result['exported'] = [
      'month' => (int)$channels['export']['month'],
      'sourceYear' => (int)$channels['export']['sourceYear'],
      'totalKwh' => (float)$channels['export']['totalKwh'],
    ];
  }
  return $result;
}
function reset_user_consumption_month(PDO $pdo, string $station, int $month, string $direction = 'import'): array {
  $station = normalize_user_station($station);
  $direction = normalize_usage_direction($direction);
  if ($month < 1 || $month > 12) {
    throw new InvalidArgumentException('Nieprawidłowy miesiąc');
  }
  assert_user_station_exists($pdo, $station);
  [$months, $sources, $exportSources] = load_existing_or_default_consumption_profile($pdo, $station);
  if ($direction === 'export') {
    $exportSources[$month - 1] = 'standard';
    upsert_user_consumption_profile_row($pdo, $station, $months, $sources);
    upsert_user_consumption_export_sources($pdo, $station, $exportSources);
    save_user_usage_hourly_month(
      $pdo,
      $station,
      $month,
      build_standard_usage_hour_rows($month, 0.0, 'standard'),
      'standard',
      usage_profile_year(),
      'export'
    );
    return load_user_consumption_profile($pdo, $station);
  }
  $sources[$month - 1] = 'standard';
  $months[$month - 1] = estimate_standard_month_usage_kwh(
    $months,
    $sources,
    $month,
    load_user_annual_usage_kwh($pdo, $station)
  );
  upsert_user_consumption_profile_row($pdo, $station, $months, $sources);
  upsert_user_consumption_export_sources($pdo, $station, $exportSources);
  save_user_annual_usage_kwh($pdo, $station, round(array_sum($months), 3));
  rebuild_user_usage_hourly_from_months($pdo, $station, $months, $sources);
  return load_user_consumption_profile($pdo, $station);
}
function normalize_fixed_amount_mode($value): string {
  $mode = strtolower(trim((string)$value));
  return $mode === 'per_kw_month' ? 'per_kw_month' : 'flat_month';
}
function normalize_billing_cycle_months($value): ?int {
  $raw = trim((string)$value);
  if ($raw === '') return null;
  $n = (int)$raw;
  return in_array($n, [1, 2, 6, 12], true) ? $n : null;
}
function normalize_nullable_non_negative_float($value): ?float {
  if ($value === null) return null;
  $raw = trim((string)$value);
  if ($raw === '') return null;
  $raw = str_replace(',', '.', $raw);
  if (!is_numeric($raw)) return null;
  $n = (float)$raw;
  return $n < 0 ? 0.0 : $n;
}

/* ========= SCHEMA ========= */
function bootstrap_schema(PDO $pdo){
  $schema = <<<SQL
CREATE TABLE IF NOT EXISTS osd (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE,
  slug VARCHAR(32) NOT NULL UNIQUE,
  add_rdn DECIMAL(10,6) DEFAULT 0,
  add_akcyza DECIMAL(10,6) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tariff (
  id INT AUTO_INCREMENT PRIMARY KEY,
  osd_id INT NOT NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(128) DEFAULT '',
  segment ENUM('household','nn_le_40','nn_gt_40','sn_le_40','sn_gt_40','wn') NOT NULL DEFAULT 'household',
  sell_method ENUM('rdn','fixed') NOT NULL DEFAULT 'rdn',
  use_monthly TINYINT(1) NOT NULL DEFAULT 0,
  zone_model ENUM('all','daynight','peakoffpeak','highmidlow') NOT NULL DEFAULT 'all',
  cheap_saturday TINYINT(1) NOT NULL DEFAULT 0,
  cheap_sunday   TINYINT(1) NOT NULL DEFAULT 0,
  buy_base DECIMAL(10,6) NOT NULL DEFAULT 0,
  sell_fixed_price DECIMAL(10,6) NOT NULL DEFAULT 0,
  notes TEXT,
  UNIQUE KEY uq_osd_code(osd_id, code),
  FOREIGN KEY (osd_id) REFERENCES osd(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tariff_window (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tariff_id INT NOT NULL,
  code VARCHAR(32) NOT NULL,
  label VARCHAR(64) NOT NULL,
  from_h TINYINT NOT NULL,
  to_h   TINYINT NOT NULL,
  ord    TINYINT NOT NULL DEFAULT 0,
  -- nowa definicja klucza unikalnego (po 4 kolumnach)
  UNIQUE KEY uq_tw (tariff_id, code, from_h, to_h),
  INDEX idx_tw_ord (tariff_id, ord),
  FOREIGN KEY (tariff_id) REFERENCES tariff(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tariff_fixed_cost (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tariff_id INT NOT NULL,
  label VARCHAR(128) NOT NULL,
  amount DECIMAL(10,6) NOT NULL,
  amount_mode ENUM('flat_month','per_kw_month') NOT NULL DEFAULT 'flat_month',
  billing_cycle_months TINYINT NULL DEFAULT NULL,
  annual_usage_min_kwh DECIMAL(10,3) NULL DEFAULT NULL,
  annual_usage_max_kwh DECIMAL(10,3) NULL DEFAULT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (tariff_id) REFERENCES tariff(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tariff_variable_cost (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tariff_id INT NOT NULL,
  label VARCHAR(128) NOT NULL,
  window_code VARCHAR(32) NOT NULL,
  price DECIMAL(10,6) NOT NULL,
  ord TINYINT NOT NULL DEFAULT 0,
  FOREIGN KEY (tariff_id) REFERENCES tariff(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tariff_window_monthly (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tariff_id INT NOT NULL,
  month TINYINT NOT NULL,
  code  VARCHAR(32) NOT NULL,
  from_h TINYINT NOT NULL,
  to_h   TINYINT NOT NULL,
  ord    TINYINT NOT NULL DEFAULT 0,
  INDEX idx_twm (tariff_id, month, code),
  FOREIGN KEY (tariff_id) REFERENCES tariff(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
SQL;
  $pdo->exec($schema);

  // defensywne ALTER-y (stare bazy)
  try { $pdo->exec("ALTER TABLE tariff ADD COLUMN use_monthly TINYINT(1) NOT NULL DEFAULT 0 AFTER sell_method"); } catch(Exception $e){}
  try { $pdo->exec("ALTER TABLE tariff ADD COLUMN zone_model ENUM('all','daynight','peakoffpeak','highmidlow') NOT NULL DEFAULT 'all' AFTER use_monthly"); } catch(Exception $e){}
  // „Tania Sobota / Tania Niedziela” (wymuszenie strefy taniej na cały dzień)
  try { $pdo->exec("ALTER TABLE tariff ADD COLUMN cheap_saturday TINYINT(1) NOT NULL DEFAULT 0 AFTER zone_model"); } catch(Exception $e){}
  try { $pdo->exec("ALTER TABLE tariff ADD COLUMN cheap_sunday   TINYINT(1) NOT NULL DEFAULT 0 AFTER cheap_saturday"); } catch(Exception $e){}
  try { $pdo->exec("ALTER TABLE tariff ADD COLUMN buy_base DECIMAL(10,6) NOT NULL DEFAULT 0 AFTER zone_model"); } catch(Exception $e){}
  try { $pdo->exec("ALTER TABLE tariff ADD COLUMN sell_fixed_price DECIMAL(10,6) NOT NULL DEFAULT 0 AFTER buy_base"); } catch(Exception $e){}
  try { $pdo->exec("ALTER TABLE tariff_fixed_cost ADD COLUMN amount_mode ENUM('flat_month','per_kw_month') NOT NULL DEFAULT 'flat_month' AFTER amount"); } catch(Exception $e){}
  try { $pdo->exec("ALTER TABLE tariff_fixed_cost ADD COLUMN billing_cycle_months TINYINT NULL DEFAULT NULL AFTER amount_mode"); } catch(Exception $e){}
  try { $pdo->exec("ALTER TABLE tariff_fixed_cost ADD COLUMN annual_usage_min_kwh DECIMAL(10,3) NULL DEFAULT NULL AFTER billing_cycle_months"); } catch(Exception $e){}
  try { $pdo->exec("ALTER TABLE tariff_fixed_cost ADD COLUMN annual_usage_max_kwh DECIMAL(10,3) NULL DEFAULT NULL AFTER annual_usage_min_kwh"); } catch(Exception $e){}

  // >>>>>>>>>> kluczowa migracja dla tariff_window <<<<<<<<<<
  // 1) Spróbuj usunąć stary unikalny indeks (tariff_id, code)
  try { $pdo->exec("ALTER TABLE tariff_window DROP INDEX uq_tw"); } catch(Exception $e){}
  // 2) Dodaj nowy UNIQUE po (tariff_id, code, from_h, to_h) + pomocniczy index po ord
  try { $pdo->exec("ALTER TABLE tariff_window ADD UNIQUE KEY uq_tw (tariff_id, code, from_h, to_h)"); } catch(Exception $e){}
  try { $pdo->exec("ALTER TABLE tariff_window ADD INDEX idx_tw_ord (tariff_id, ord)"); } catch(Exception $e){}
}


/* ========= Narzędzia godzin/kalendarza ========= */
function hoursToRanges(array $hours): array {
  sort($hours, SORT_NUMERIC);
  $hours = array_values(array_unique(array_map('intval', $hours)));
  $ranges = [];
  $start = null; $prev = null;
  foreach ($hours as $h){
    if ($start===null){ $start=$h; $prev=$h; continue; }
    if ($h === $prev+1){ $prev=$h; continue; }
    $ranges[] = [$start, $prev];
    $start = $h; $prev = $h;
  }
  if ($start!==null) $ranges[] = [$start, $prev];
  return $ranges;
}
function compressMonthRow(array $row): array {
  // 1) reindeksuj do 0..N (array_values) — to kluczowe!
  $row = array_values($row);

  // 2) zapewnij dokładnie 24 liczby i znormalizuj do 1..3
  $norm = [];
  for ($i=0; $i<24; $i++) {
    $v = isset($row[$i]) ? (int)$row[$i] : 2;
    if ($v < 1) $v = 1;
    if ($v > 3) $v = 3;   // dla HML max=3; dla 2-stref i tak wpiszesz 1/2
    $norm[$i] = $v;
  }

  // 3) kompresja [code, from, to]
  $out = [];
  $cur = $norm[0];
  $a   = 0;
  for ($h=1; $h<24; $h++) {
    if ($norm[$h] !== $cur) {
      $out[] = [$cur, $a, $h-1];
      $cur = $norm[$h];
      $a   = $h;
    }
  }
  $out[] = [$cur, $a, 23];
  return $out;
}


/* ========= Załaduj „spójny” obiekt taryfy do JS/API ========= */
function load_tariff(PDO $pdo, int $osd_id, int $tariff_id){
  $t = $pdo->prepare("SELECT * FROM tariff_legacy WHERE id=? AND osd_id=?");
  $t->execute([$tariff_id, $osd_id]);
  $tariff = $t->fetch();
  if (!$tariff) json_err('Nie znaleziono taryfy', 404);

  // Windows 2-stref
  $w = $pdo->prepare("SELECT * FROM tariff_window WHERE tariff_id=? ORDER BY ord,id");
  $w->execute([$tariff_id]);
  $win = $w->fetchAll();

  // Fixed/Variable
  $fc = $pdo->prepare("SELECT label, amount, amount_mode, billing_cycle_months, annual_usage_min_kwh, annual_usage_max_kwh FROM tariff_fixed_cost_legacy WHERE tariff_id=? AND active=1 ORDER BY id");
  $fc->execute([$tariff_id]);
  $fixed = $fc->fetchAll();

  $vc = $pdo->prepare("SELECT label, window_code, price FROM tariff_variable_cost_legacy WHERE tariff_id=? ORDER BY ord,id");
  $vc->execute([$tariff_id]);
  $variable = $vc->fetchAll();

  // Monthly -> 12×24
  $m = $pdo->prepare("SELECT month, code, from_h, to_h FROM tariff_window_monthly WHERE tariff_id=? ORDER BY month, ord, id");
  $m->execute([$tariff_id]);
  $monthly = [];
  for($mm=1;$mm<=12;$mm++){ $monthly[$mm] = array_fill(0,24, 2); }
  while($row = $m->fetch()){
    $mm=(int)$row['month']; $code=max(1,min(3,(int)$row['code']));
    for($h=(int)$row['from_h']; $h<=(int)$row['to_h']; $h++){
      if ($h>=0 && $h<24) $monthly[$mm][$h] = $code;
    }
  }

  // DN/PO godziny z windows
  $dn_night=[]; $po_off=[];
  foreach($win as $r){
    $from=(int)$r['from_h']; $to=(int)$r['to_h'];
    for($h=$from;$h<=$to;$h++){
      if ($r['code']==='night')   $dn_night[]=$h;
      if ($r['code']==='offpeak') $po_off[]=$h;
    }
  }
  $dn_night = array_values(array_unique($dn_night)); sort($dn_night);
  $po_off   = array_values(array_unique($po_off)); sort($po_off);

  return [
    'osd_id'   => (int)$tariff['osd_id'],
    'tariff_id'=> (int)$tariff['id'],
    'code'     => (string)$tariff['code'],
    'name'     => (string)$tariff['name'],
    'segment'  => (string)$tariff['segment'],
    'zone_model' => $tariff['zone_model'],
    'use_monthly'=> (int)$tariff['use_monthly']===1,
    'cheap_saturday' => (int)($tariff['cheap_saturday'] ?? 0) === 1,
    'cheap_sunday'   => (int)($tariff['cheap_sunday']   ?? 0) === 1,
    'buy_base'  => (float)$tariff['buy_base'],
    'sell_method'=> $tariff['sell_method'],
    'sell_fixed_price' => (float)$tariff['sell_fixed_price'],
    'dn_night'  => $dn_night,
    'po_off'    => $po_off,
    'monthly'   => $monthly,
    'fixed'     => array_map(fn($r)=>[
      'label'=>$r['label'],
      'amount'=>(float)$r['amount'],
      'amount_mode'=>normalize_fixed_amount_mode($r['amount_mode'] ?? 'flat_month'),
      'billing_cycle_months'=>normalize_billing_cycle_months($r['billing_cycle_months'] ?? null),
      'annual_usage_min_kwh'=>normalize_nullable_non_negative_float($r['annual_usage_min_kwh'] ?? null),
      'annual_usage_max_kwh'=>normalize_nullable_non_negative_float($r['annual_usage_max_kwh'] ?? null)
    ], $fixed),
    'variable'  => array_map(fn($r)=>['label'=>$r['label'], 'window_code'=>strtolower($r['window_code']), 'price'=>(float)$r['price']], $variable),
    'sell_variable' => [] // zostawiamy miejsce na przyszłość
  ];
}

/* ========= Zapis z JSON (AJAX ?act=save) – opcjonalnie używane przez js/setup.js ========= */
function save_tariff(PDO $pdo, array $input){
  $id = (int)($input['tariff_id'] ?? 0);
  $pdo->beginTransaction();
  try {
    [$input, $pricePlan] = \OnRevolt\Pricing\TariffStorage::prepareInput($pdo, $id, $input, false);
    save_tariff_legacy_write($pdo, $input);
    \OnRevolt\Pricing\TariffStorage::finishSave($pdo, $id, $pricePlan);
    $pdo->commit();
    return load_tariff($pdo, (int)$input['osd_id'], $id);
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $e;
  }
}
function save_tariff_legacy_write(PDO $pdo, array $input){
  $osd_id    = (int)($input['osd_id']??0);
  $tariff_id = (int)($input['tariff_id']??0);
  if(!$osd_id || !$tariff_id) json_err('Brak osd_id/tariff_id');

  $use_monthly = isset($_POST['use_monthly']) ? 1 : 0;
  $zone_model  = (string)($_POST['zone_model_ui'] ?? 'all');
  if ($zone_model === 'highmidlow') { $use_monthly = 1; }
  $cheap_saturday = isset($_POST['cheap_saturday']) ? 1 : 0;
  $cheap_sunday   = isset($_POST['cheap_sunday'])   ? 1 : 0;
  $dn_night     = array_map('intval', $input['dn_night'] ?? []);
  $po_off       = array_map('intval', $input['po_off'] ?? []);
  $monthly_json = $input['monthly_json'] ?? '{}';
  $fixed        = $input['fixed'] ?? [];
  $variable     = $input['variable'] ?? [];

  // Update nagłówka
  $upd = $pdo->prepare("UPDATE tariff SET zone_model=?, use_monthly=?, cheap_saturday=?, cheap_sunday=? WHERE id=? AND osd_id=?");
  $upd->execute([$zone_model, $use_monthly, $cheap_saturday, $cheap_sunday, $tariff_id, $osd_id]);

  // czyść szczegóły
  $pdo->prepare("DELETE FROM tariff_window WHERE tariff_id=?")->execute([$tariff_id]);
  $pdo->prepare("DELETE FROM tariff_fixed_cost WHERE tariff_id=?")->execute([$tariff_id]);
  $pdo->prepare("DELETE FROM tariff_variable_cost WHERE tariff_id=?")->execute([$tariff_id]);
  $pdo->prepare("DELETE FROM tariff_window_monthly WHERE tariff_id=?")->execute([$tariff_id]);

  // 2-strefy (tylko gdy nie używasz monthly)
  if ($zone_model==='daynight' && !$use_monthly && $dn_night){
    $ranges = hoursToRanges($dn_night);
    $ins = $pdo->prepare("INSERT INTO tariff_window (tariff_id, code, label, from_h, to_h, ord) VALUES (?,?,?,?,?,?)");
    $ord=0; foreach($ranges as [$a,$b]){ $ins->execute([$tariff_id,'night','NOC',$a,$b,$ord++]); }
  }
  if ($zone_model==='peakoffpeak' && !$use_monthly && $po_off){
    $ranges = hoursToRanges($po_off);
    $ins = $pdo->prepare("INSERT INTO tariff_window (tariff_id, code, label, from_h, to_h, ord) VALUES (?,?,?,?,?,?)");
    $ord=0; foreach($ranges as [$a,$b]){ $ins->execute([$tariff_id,'offpeak','OFF-PEAK',$a,$b,$ord++]); }
  }

  // monthly 12×24 -> zakresy
  $monthly = json_decode($monthly_json, true) ?: [];
  if ($use_monthly && is_array($monthly)){
    $ins = $pdo->prepare("INSERT INTO tariff_window_monthly (tariff_id, month, code, from_h, to_h, ord) VALUES (?,?,?,?,?,?)");
    for($m=1;$m<=12;$m++){
      if (empty($monthly[$m]) || !is_array($monthly[$m])) continue;
      $ranges = compressMonthRow($monthly[$m]); // [[code,from,to],...]
      $ord=0; foreach($ranges as [$code,$from,$to]){
        $ins->execute([$tariff_id, $m, (string)$code, (int)$from, (int)$to, $ord++]);
      }
    }
  }

  // fixed
  if (is_array($fixed)){
    $ins = $pdo->prepare("
      INSERT INTO tariff_fixed_cost (
        tariff_id, label, amount, amount_mode, billing_cycle_months, annual_usage_min_kwh, annual_usage_max_kwh, active
      ) VALUES (?,?,?,?,?,?,?,1)
    ");
    foreach($fixed as $f){
      $label = trim((string)($f['label']??'')); if ($label==='') continue;
      $amount= (float)($f['amount']??0);
      $mode  = normalize_fixed_amount_mode($f['amount_mode'] ?? 'flat_month');
      $cycle = normalize_billing_cycle_months($f['billing_cycle_months'] ?? null);
      $usageMin = normalize_nullable_non_negative_float($f['annual_usage_min_kwh'] ?? null);
      $usageMax = normalize_nullable_non_negative_float($f['annual_usage_max_kwh'] ?? null);
      if ($usageMin !== null && $usageMax !== null && $usageMax <= $usageMin) {
        $usageMax = null;
      }
      $ins->execute([$tariff_id, $label, $amount, $mode, $cycle, $usageMin, $usageMax]);
    }
  }
  // variable
  if (is_array($variable)){
    $ins = $pdo->prepare("INSERT INTO tariff_variable_cost (tariff_id, label, window_code, price, ord) VALUES (?,?,?,?,?)");
    $ord=0;
    foreach($variable as $v){
      $label = trim((string)($v['label']??'')); if ($label==='') continue;
      $price = (float)($v['price']??0);
      $wc    = strtolower(trim((string)($v['window_code']??'all')));
      if (!in_array($wc, ['all','day','night','peak','offpeak','high','mid','low'], true)) $wc='all';
      $ins->execute([$tariff_id, $label, $wc, $price, $ord++]);
    }
  }

  // zwróć spójny obiekt
  return load_tariff($pdo, $osd_id, $tariff_id);
}

/* ========= Akcje i API ========= */
function handle_actions(PDO $pdo){
  
  /* --- 1) Endpointy JSON (?act=...) dla JS --- */
  if (isset($_GET['act'])) {
    $act = $_GET['act'];
    try{
      if ($act==='list'){
        header('Content-Type: application/json; charset=utf-8');
        $osd_id = (int)($_GET['osd_id'] ?? 0);
        if (!$osd_id){ json_ok([]); }
        $s = $pdo->prepare("SELECT id, code, name FROM tariff WHERE osd_id=? ORDER BY id");
        $s->execute([$osd_id]);
        json_ok($s->fetchAll());
      }

	  if ($act === 'get') {
		  header('Content-Type: application/json; charset=utf-8');
		  try {
			$osd_id    = (int)($_GET['osd_id'] ?? 0);
			$tariff_id = (int)($_GET['tariff_id'] ?? 0);
			if (!$osd_id || !$tariff_id) {
			  echo json_encode(['ok'=>false, 'error'=>'Brak osd_id/tariff_id']); exit;
			}

			// 1) Pełny obiekt taryfy (jak dotychczas)
			$data = load_tariff($pdo, $osd_id, $tariff_id);

			// 2) Dołóż dodatki z OSD (ułatwia getTariffPrice* w JS)
			$q = $pdo->prepare("SELECT add_rdn, add_akcyza FROM osd WHERE id=?");
			$q->execute([$osd_id]);
			if ($osd = $q->fetch()) {
			  $data['osd_add_rdn']    = (float)$osd['add_rdn'];
			  $data['osd_add_akcyza'] = (float)$osd['add_akcyza'];
			} else {
			  $data['osd_add_rdn'] = 0.0;
			  $data['osd_add_akcyza'] = 0.0;
			}

require_once __DIR__ . '/pricing/PricingRepository.php';
            $data['pricing'] = (new \OnRevolt\Pricing\PricingRepository($pdo))->describe($data, date('Y-m-d'));
            if (\OnRevolt\Pricing\TariffStorage::state($pdo, $tariff_id)['price_basis'] === 'net') {
                $data['pricing']['tariffStorage'] = \OnRevolt\Pricing\TariffStorage::attachCanonical($pdo, $data);
            }
            $effectiveDate = \OnRevolt\Pricing\ClientTariffs::date((string)($_GET['date'] ?? \OnRevolt\Pricing\ClientTariffs::today()));
            $dated = (new \OnRevolt\Pricing\ClientTariffs($pdo))->catalog($osd_id, $tariff_id, $effectiveDate);
            if (!$dated) throw new RuntimeException('Wymaga uzupełnienia: brak cen katalogowych dla ' . $effectiveDate);
            echo json_encode(['ok'=>true,'data'=>$dated], JSON_UNESCAPED_UNICODE);
		  } catch (Throwable $e) {
			http_response_code(500);
			echo json_encode(['ok'=>false,'error'=>$e->getMessage()]);
		  }
		  exit; // <<< BARDZO WAŻNE
	  }
      if ($act==='save'){
        header('Content-Type: application/json; charset=utf-8');
        $body = json_decode(file_get_contents('php://input'), true) ?? [];
        $data = save_tariff($pdo, $body);
        json_ok($data);
      }
      json_err('Nieznane polecenie', 404);
    } catch(Throwable $e){
      json_err('Błąd: '.$e->getMessage(), 500);
    }
  }

  /* --- 2) Akcje formularzy POST z setup.php --- */
  if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    $action = $_POST['action'];

    // ADD OSD
    if ($action === 'add_osd') {
      $name = trim((string)post_val('name',''));
      $slug = trim((string)post_val('slug',''));
      $add_rdn = (float)post_val('add_rdn', 0);
      $add_akcyza = (float)post_val('add_akcyza', 0);
      if ($name === '' || $slug === '') redirect302('setup.php?err=osd_empty');
      $slug = strtolower(preg_replace('~[^a-z0-9_-]+~', '-', $slug));
      try {
        $ins = $pdo->prepare("INSERT INTO osd (name, slug, add_rdn, add_akcyza) VALUES (?,?,?,?)");
        $ins->execute([$name, $slug, $add_rdn, $add_akcyza]);
        $new_id = (int)$pdo->lastInsertId();
        redirect302('setup.php?osd=' . $new_id);
      } catch (Throwable $e) {
        redirect302('setup.php?err=osd_insert');
      }
    }

    // DEL OSD
    if ($action === 'del_osd') {
      $id = (int)post_val('id', 0);
      if ($id > 0) {
        try {
          $del = $pdo->prepare("DELETE FROM osd WHERE id=?");
          $del->execute([$id]); // ON DELETE CASCADE usunie też taryfy
        } catch(Throwable $e) {}
      }
      redirect302('setup.php');
    }

    // ADD TARIFF
    if ($action === 'add_tariff') {
      $osd_id = (int)post_val('osd_id', 0);
      $code   = trim((string)post_val('code',''));
      $name   = trim((string)post_val('name',''));
      $segment= (string)post_val('segment','household');
      $sell_method = (string)post_val('sell_method','rdn');
      $notes  = (string)post_val('notes','');

      if ($osd_id<=0 || $code==='') redirect302('setup.php?err=tariff_empty');

      try {
        $ins = $pdo->prepare("
          INSERT INTO tariff (osd_id, code, name, segment, sell_method, use_monthly, zone_model, cheap_saturday, cheap_sunday, buy_base, sell_fixed_price, notes)
          VALUES (?,?,?,?,?,0,'all',0,0,0,0,?)
        ");
        $pdo->beginTransaction();
        $ins->execute([$osd_id, $code, $name, $segment, $sell_method, $notes]);
        $new_id = (int)$pdo->lastInsertId();
        \OnRevolt\Pricing\TariffStorage::initializeTariff($pdo, $new_id);
        $pdo->commit();
        redirect302('setup.php?osd='.$osd_id.'&tariff='.$new_id);
      } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        redirect302('setup.php?osd='.$osd_id.'&err=tariff_insert');
      }
    }

    // DEL TARIFF
    if ($action === 'del_tariff') {
      $id = (int)post_val('id', 0);
      $osd_id = 0;
      if ($id>0) {
        try {
          $q = $pdo->prepare("SELECT osd_id FROM tariff WHERE id=?");
          $q->execute([$id]);
          if ($row = $q->fetch()) $osd_id = (int)$row['osd_id'];
          $del = $pdo->prepare("DELETE FROM tariff WHERE id=?");
          $del->execute([$id]);
        } catch(Throwable $e){}
      }
      $url = 'setup.php';
      if ($osd_id>0) $url .= '?osd='.$osd_id;
      redirect302($url);
    }

    // SAVE TARIFF
    if ($action === 'save_tariff') {
      $tariff_id = (int)post_val('tariff_id', 0);
      if ($tariff_id<=0) redirect302('setup.php?err=save_id');

      // osd_id do powrotu
      $q = $pdo->prepare("SELECT osd_id FROM tariff WHERE id=?");
      $q->execute([$tariff_id]);
      $row = $q->fetch();
      if (!$row) redirect302('setup.php?err=save_notfound');
      $osd_id = (int)$row['osd_id'];
      $pdo->beginTransaction();
      try {
      [$_POST, $pricePlan] = \OnRevolt\Pricing\TariffStorage::prepareInput($pdo, $tariff_id, $_POST, true);

      // nagłówek
      $name   = trim((string)post_val('name',''));
      $segment= (string)post_val('segment','household');
      $sell_method = (string)post_val('sell_method','rdn');
$use_monthly = isset($_POST['use_monthly']) ? 1 : 0;
$zone_model  = (string)($_POST['zone_model_ui'] ?? 'all');
if ($zone_model === 'highmidlow') { $use_monthly = 1; }
      // weekendowe "tanie" dni (w sobotę/niedzielę obowiązuje niższa strefa)
      $cheap_saturday = isset($_POST['cheap_saturday']) ? 1 : 0;
      $cheap_sunday   = isset($_POST['cheap_sunday'])   ? 1 : 0;
      if (!in_array($zone_model, ['all','daynight','peakoffpeak','highmidlow'], true)) $zone_model = 'all';

      $upd = $pdo->prepare("UPDATE tariff SET name=?, segment=?, sell_method=?, use_monthly=?, zone_model=?, cheap_saturday=?, cheap_sunday=? WHERE id=?");
      $upd->execute([$name, $segment, $sell_method, $use_monthly, $zone_model, $cheap_saturday, $cheap_sunday, $tariff_id]);

      // czyść szczegóły
      $pdo->prepare("DELETE FROM tariff_fixed_cost WHERE tariff_id=?")->execute([$tariff_id]);
      $pdo->prepare("DELETE FROM tariff_variable_cost WHERE tariff_id=?")->execute([$tariff_id]);
      $pdo->prepare("DELETE FROM tariff_window WHERE tariff_id=?")->execute([$tariff_id]);
      $pdo->prepare("DELETE FROM tariff_window_monthly WHERE tariff_id=?")->execute([$tariff_id]);

      // FIXED
      $fc_labels = $_POST['fc_label']  ?? [];
      $fc_amounts= $_POST['fc_amount'] ?? [];
      $fc_modes  = $_POST['fc_mode']   ?? [];
      $fc_cycles = $_POST['fc_billing_cycle_months'] ?? [];
      $fc_usage_min = $_POST['fc_usage_min_kwh'] ?? [];
      $fc_usage_max = $_POST['fc_usage_max_kwh'] ?? [];
      if (is_array($fc_labels) && is_array($fc_amounts)) {
        $ins = $pdo->prepare("
          INSERT INTO tariff_fixed_cost (
            tariff_id, label, amount, amount_mode, billing_cycle_months, annual_usage_min_kwh, annual_usage_max_kwh, active
          ) VALUES (?,?,?,?,?,?,?,1)
        ");
        for ($i=0; $i<count($fc_labels); $i++){
          $lbl = trim((string)$fc_labels[$i]); if ($lbl==='') continue;
          $amt = (float)($fc_amounts[$i] ?? 0);
          $mode = normalize_fixed_amount_mode($fc_modes[$i] ?? 'flat_month');
          $cycle = normalize_billing_cycle_months($fc_cycles[$i] ?? null);
          $usageMin = normalize_nullable_non_negative_float($fc_usage_min[$i] ?? null);
          $usageMax = normalize_nullable_non_negative_float($fc_usage_max[$i] ?? null);
          if ($usageMin !== null && $usageMax !== null && $usageMax <= $usageMin) {
            $usageMax = null;
          }
          $ins->execute([$tariff_id, $lbl, $amt, $mode, $cycle, $usageMin, $usageMax]);
        }
      }

      // VARIABLE
      $vc_label = $_POST['vc_label']  ?? [];
      $vc_window= $_POST['vc_window'] ?? [];
      $vc_price = $_POST['vc_price']  ?? [];
      $vc_ord   = $_POST['vc_ord']    ?? [];
      if (is_array($vc_label) && is_array($vc_window) && is_array($vc_price)) {
        $ins = $pdo->prepare("INSERT INTO tariff_variable_cost (tariff_id, label, window_code, price, ord) VALUES (?,?,?,?,?)");
        for ($i=0; $i<count($vc_label); $i++){
          $lbl = trim((string)$vc_label[$i]); if ($lbl==='') continue;
          $wc  = strtolower(trim((string)($vc_window[$i] ?? 'all')));
          if (!in_array($wc, ['all','day','night','high','mid','low','peak','offpeak'], true)) $wc='all';
          $pr  = (float)($vc_price[$i] ?? 0);
          $ord = (int)($vc_ord[$i] ?? 0);
          $ins->execute([$tariff_id, $lbl, $wc, $pr, $ord]);
        }
      }

      // 2-strefowe pickery z formularza (tylko gdy brak monthly)
      if ($zone_model === 'daynight' && !$use_monthly) {
        $night_hours_json = $_POST['night_hours_json'] ?? '[]';
        $hours = json_decode($night_hours_json, true) ?: [];
        if ($hours) {
          sort($hours, SORT_NUMERIC);
          $ranges = hoursToRanges($hours);
          $ins = $pdo->prepare("INSERT INTO tariff_window (tariff_id, code, label, from_h, to_h, ord) VALUES (?,?,?,?,?,?)");
          $ord=0; foreach ($ranges as [$a,$b]) { $ins->execute([$tariff_id,'night','NOC',(int)$a,(int)$b,$ord++]); }
        }
      }
      if ($zone_model === 'peakoffpeak' && !$use_monthly) {
        $offpeak_hours_json = $_POST['offpeak_hours_json'] ?? '[]';
        $hours = json_decode($offpeak_hours_json, true) ?: [];
        if ($hours) {
          sort($hours, SORT_NUMERIC);
          $ranges = hoursToRanges($hours);
          $ins = $pdo->prepare("INSERT INTO tariff_window (tariff_id, code, label, from_h, to_h, ord) VALUES (?,?,?,?,?,?)");
          $ord=0; foreach ($ranges as [$a,$b]) { $ins->execute([$tariff_id,'offpeak','OFF-PEAK',(int)$a,(int)$b,$ord++]); }
        }
      }

      // MONTHLY kalendarz 12×24 -> zakresy (gdy włączony)
$monthly_json = $_POST['monthly_calendar_json'] ?? '{}';
$monthly = json_decode($monthly_json, true);
if ($use_monthly && is_array($monthly)) {
  $ins = $pdo->prepare("INSERT INTO tariff_window_monthly (tariff_id, month, code, from_h, to_h, ord) VALUES (?,?,?,?,?,?)");
  for($m=1; $m<=12; $m++){
    // klucze w JSON mogą być '1'..'12' lub 1..12
    $row = $monthly[$m] ?? $monthly[(string)$m] ?? null;
    if (!is_array($row)) continue;

    // HML ma 3 poziomy, pozostałe 2. Wymuś 24 elementy 1..max
    $maxVal = ($zone_model === 'highmidlow') ? 3 : 2;
    $norm   = normalizeMonthRow($row, $maxVal);

    // Zrób zakresy i zapisz
    $ranges = rangesFromRow($norm);   // [[code,from,to],...]
    $ord = 0;
    foreach ($ranges as [$code,$from,$to]) {
      $ins->execute([$tariff_id, $m, (string)$code, (int)$from, (int)$to, $ord++]);
    }
  }
}

      \OnRevolt\Pricing\TariffStorage::finishSave($pdo, $tariff_id, $pricePlan);
      $pdo->commit();
      } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
      }
      redirect302('setup.php?osd='.$osd_id.'&tariff='.$tariff_id.'&saved=1');
    }

    // Nieznana akcja POST
    redirect302('setup.php?err=unknown_action');
  }

  /* --- 3) Brak akcji — widok ma się wyrenderować --- */
  return;
}

/* ========= Kontekst do widoku (setup.php) ========= */
function get_context(PDO $pdo): array {
  // Lista OSD
  $osds = $pdo->query("SELECT id, name, slug FROM osd ORDER BY name")->fetchAll();

  // Wybrany OSD: obsługujemy ?osd= i ?osd_id=
  $osd_id = isset($_GET['osd_id']) ? (int)$_GET['osd_id']
           : (isset($_GET['osd']) ? (int)$_GET['osd'] : 0);
  if (!$osd_id && !empty($osds)) $osd_id = (int)$osds[0]['id'];

  // Lista taryf
  $tariffs = [];
  if ($osd_id){
    $stmt = $pdo->prepare("SELECT id, code, name FROM tariff WHERE osd_id=? ORDER BY id");
    $stmt->execute([$osd_id]);
    $tariffs = $stmt->fetchAll();
  }

  // Wybrana taryfa: obsługujemy ?tariff= i ?tariff_id=
  $tariff_id = isset($_GET['tariff_id']) ? (int)$_GET['tariff_id']
              : (isset($_GET['tariff']) ? (int)$_GET['tariff'] : 0);
  if (!$tariff_id && !empty($tariffs)) $tariff_id = (int)$tariffs[0]['id'];

  // Szczegóły taryfy (nagłówek)
  $tariff = null;
  if ($tariff_id){
    $t = $pdo->prepare("SELECT * FROM tariff WHERE id=?");
    $t->execute([$tariff_id]);
    $tariff = $t->fetch();
  }

  // Windows (2-stref), Fixed, Variable
  $wins=[]; $fcs=[]; $vcs=[];
  if ($tariff_id){
    $w = $pdo->prepare("SELECT id, code, label, from_h, to_h, ord FROM tariff_window WHERE tariff_id=? ORDER BY ord,id");
    $w->execute([$tariff_id]); $wins = $w->fetchAll();

    $f = $pdo->prepare("SELECT id, component_key, label, amount, amount_mode, billing_cycle_months, annual_usage_min_kwh, annual_usage_max_kwh, active, vat_rate, price_basis FROM tariff_fixed_cost WHERE tariff_id=? ORDER BY id");
    $f->execute([$tariff_id]); $fcs = $f->fetchAll();

    $v = $pdo->prepare("SELECT id, component_key, label, window_code, price, ord, vat_rate, price_basis FROM tariff_variable_cost WHERE tariff_id=? ORDER BY ord,id");
    $v->execute([$tariff_id]); $vcs = $v->fetchAll();
  }

  // Monthly jako LISTA ZAKRESÓW (łatwa do debugowania) – setup.php zbuduje z tego 12×24
  // Monthly: wczytaj zakresy -> zbuduj też 12×24 (łatwe do JS)
  $monthly = [];          // lista zakresów: [miesiąc => [ ['code'=>..,'from_h'=>..,'to_h'=>..], ... ]]
  $monthly12 = [];        // 12×24: [1..12] => [0..23] wartości 1..3 (domyślnie 2)

  if ($tariff_id){
    // zainicjuj domyślną siatkę
    for ($mm=1; $mm<=12; $mm++) { $monthly12[$mm] = array_fill(0, 24, 2); }

    // czytamy zakresy z DB
    $m = $pdo->prepare("SELECT month, code, from_h, to_h, ord
                          FROM tariff_window_monthly
                         WHERE tariff_id=?
                         ORDER BY month, ord, id");
    $m->execute([$tariff_id]);
    while($row = $m->fetch()){
      $mm  = (int)$row['month'];
      $code= (int)$row['code'];
      $from= (int)$row['from_h'];
      $to  = (int)$row['to_h'];

      // lista zakresów (do debug/ew. innych widoków)
      if (!isset($monthly[$mm])) $monthly[$mm] = [];
      $monthly[$mm][] = ['code'=>$code, 'from_h'=>$from, 'to_h'=>$to, 'ord'=>(int)$row['ord']];

      // 12×24 dla JS (źródło prawdy dla kalendarza)
      $code = max(1, min(3, $code));
      for ($h=$from; $h <= $to; $h++){
        if ($h>=0 && $h<24) $monthly12[$mm][$h] = $code;
      }
    }
  }

  return compact('osds','osd_id','tariffs','tariff_id','tariff','wins','fcs','vcs','monthly','monthly12');

}

// Pozwól wywołać API także bezpośrednio przez setup_func.php
if (php_sapi_name() !== 'cli'
    && basename($_SERVER['SCRIPT_NAME'] ?? '') === 'setup_func.php'
    && isset($_GET['act'])) {

  @ini_set('display_errors','0');  // żeby JSON był czysty
  $pdo = get_pdo();
  bootstrap_schema($pdo);
  handle_actions($pdo); // ta funkcja sama zrobi echo JSON i exit
  exit;
}


?>
