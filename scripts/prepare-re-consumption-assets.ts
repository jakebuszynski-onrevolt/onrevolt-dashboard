import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const sourceRoot = process.argv.find((arg) => arg.startsWith('--source-root='))?.slice(14);
const outputRoot = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9);
if (!sourceRoot || !outputRoot) throw new Error('Podaj --source-root= i --output=');
const version = '20260909-shared-profile';

function replaceFunction(source: string, name: string, replacement: string) {
  const ast = ts.createSourceFile('scripts.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (declarations.length !== 1) throw new Error(`Oczekiwano jednej funkcji ${name}`);
  const node = declarations[0];
  return source.slice(0, node.getStart(ast)) + replacement + source.slice(node.end);
}

function write(relative: string, source: string) {
  const destination = path.join(outputRoot, relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, source, 'utf8');
}

function replaceOnce(source: string, before: string, after: string, label: string) {
  if (source.split(before).length !== 2) throw new Error(`Niejednoznaczny fragment RE: ${label}`);
  return source.replace(before, () => after);
}

function replacePhpFragment(source: string, before: string, after: string, label: string) {
  const pattern = new RegExp(before.split(/\r?\n/)
    .map(line => line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\r?\\n'), 'g');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Niejednoznaczny fragment RE: ${label}`);
  const newline = matches[0][0].includes('\r\n') ? '\r\n' : '\n';
  return source.replace(pattern, () => after.replace(/\r?\n/g, newline));
}

let script = readFileSync(path.join(sourceRoot, 're/js/scripts.js'), 'utf8');
script = replaceFunction(script, 'buildReActualHourlyMapFromPayload', `function buildReActualHourlyMapFromPayload(payload) {
  return ReConsumptionEngine.buildActualMap(payload);
}`);
script = replaceFunction(script, 'buildReUsageForecastModel', `function buildReUsageForecastModel(payload) {
  return ReConsumptionEngine.buildForecastModel(payload);
}`);
script = replaceFunction(script, 'buildHourlyUseForDay', `function buildHourlyUseForDay(dayDate, annualUsageKWh = getAnnualUsageKWh(getAnnualUsageInput()?.value), use24Profile = USE24, options = {}) {
  const dayKey = typeof dayDate === 'string' ? dayDate.slice(0, 10) : reActualDateKey(dayDate);
  const monthIndex = Number(dayKey.slice(5, 7)) - 1;
  const sources = currentUsageMonthSources();
  const actualDay = getReActualDay(dayDate);
  const complete = actualDay?.isComplete && actualDay.hours.every(hour => hour.hasUse);
  const detailed = sources[monthIndex] !== 'standard';
  const hourlyProfile = !complete && detailed ? getHourlyUsageProfileForDay(dayDate, options) : null;
  const learnedHours = !detailed && reUsageForecastModel ? reUsageForecastModel.monthlyHours[monthIndex] : null;
  if (!complete && !hourlyProfile && !learnedHours) assertUsageHourlyProfileIsHealthy();
  return ReConsumptionEngine.resolveDay({
    dayKey, annualKwh: annualUsageKWh, monthlyKwh: normalizeMonthlyUsageProfile(usageMonthlyProfileKWh),
    sources, defaultHourlyPercent: use24Profile, hourlyProfile, learnedHours, actualDay,
  });
}`);
const pvFormula = `return values.map((importKwh, hour) => {
    const pvKWh = getProfilePvKWhForHour(hour, { ...options, dayDate, pvOffset });
    const exportKwh = Math.max(0, Number(exportValues[hour]) || 0);
    return Math.max(0, Number(importKwh) || 0) + Math.max(0, pvKWh - exportKwh);
  });`;
const normalized = script.replace(/\r\n/g, '\n');
if (!normalized.includes(pvFormula)) throw new Error('Zmienił się wzór rekonstrukcji PV w RE; sprawdź zgodność');
script = normalized.replace(pvFormula, `return ReConsumptionEngine.resolveDay({
    dayKey, annualKwh: 0, sources: Array(12).fill('xlsx'), hourlyProfile: values, hasExport: true,
    exportHourlyKwh: exportValues,
    pvHourlyKwh: Array.from({ length: 24 }, (_, hour) => getProfilePvKWhForHour(hour, { ...options, dayDate, pvOffset })),
  });`);
write('re/js/scripts.js', script);

let dashboard = readFileSync(path.join(sourceRoot, 'js/scripts.js'), 'utf8');
const loader = /await loadDashboardReScript\(new URL\("js\/scripts\.js\?v=[^"]+", baseUrl\)\.href\);/g;
if ([...dashboard.matchAll(loader)].length !== 1) throw new Error('Nie znaleziono jednoznacznego ładowania RE');
dashboard = dashboard.replace(loader, `await loadDashboardReScript(new URL("js/re-consumption-engine.js?v=${version}", baseUrl).href);
      await loadDashboardReScript(new URL("js/scripts.js?v=${version}", baseUrl).href);`);
write('js/scripts.js', dashboard);

let dashboardIndex = readFileSync(path.join(sourceRoot, 'index.html'), 'utf8');
const dashboardTag = /<script src="js\/scripts\.js\?v=[^"]+"><\/script>/g;
if ([...dashboardIndex.matchAll(dashboardTag)].length !== 1) {
  throw new Error('Nie znaleziono jednoznacznego znacznika dashboardu w index.html');
}
dashboardIndex = dashboardIndex.replace(dashboardTag, `<script src="js/scripts.js?v=${version}"></script>`);
write('index.html', dashboardIndex);

for (const relative of ['re/index.php', 're/GetRe_site.php']) {
  let index = readFileSync(path.join(sourceRoot, relative), 'utf8');
  const tag = /^([ \t]*)<script src="js\/scripts\.js\?v=[^"]+"><\/script>/gm;
  if ([...index.matchAll(tag)].length !== 1) {
    throw new Error(`Nie znaleziono jednoznacznego znacznika RE w ${relative}`);
  }
  const newline = index.includes('\r\n') ? '\r\n' : '\n';
  index = index.replace(tag, (_, indent) => `${indent}<script src="js/re-consumption-engine.js?v=${version}"></script>${newline}${indent}<script src="js/scripts.js?v=${version}"></script>`);
  write(relative, index);
}

let api = readFileSync(path.join(sourceRoot, 'api/dashboard.php'), 'utf8');
const auth = /function dashboardCurrentUserCanAccessStationToken\(array \$config, string \$stationInput\): bool\r?\n\{/;
if (!auth.test(api)) throw new Error('Nie znaleziono ochrony dostępu dashboardu');
api = api.replace(auth, `function dashboardCurrentUserCanAccessStationToken(array $config, string $stationInput): bool
{
    if (PHP_SAPI === 'cli'
        && defined('ONREVOLT_CRM_READ_ONLY_PROFILE')
        && ONREVOLT_CRM_READ_ONLY_PROFILE === true
        && ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
        return true;
    }`);
write('api/dashboard.php', api);

let setup = readFileSync(path.join(sourceRoot, 're/setup_func.php'), 'utf8');
const setupNewline = setup.includes('\r\n') ? '\r\n' : '\n';
const php = (value: string) => value.replace(/\r?\n/g, setupNewline);
const originalDateParser = `function parse_osd_xlsx_datetime($value): ?DateTimeImmutable {
  $raw = trim((string)$value);
  if ($raw === '') return null;
  foreach (['Y-m-d H:i:s', 'Y-m-d H:i', 'd.m.Y H:i:s', 'd.m.Y H:i'] as $fmt) {
    $dt = DateTimeImmutable::createFromFormat($fmt, $raw, new DateTimeZone('Europe/Warsaw'));
    if ($dt instanceof DateTimeImmutable) return $dt;
  }`;
const dstDateParser = `function parse_osd_xlsx_datetime($value): ?DateTimeImmutable {
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
  }`;
setup = replacePhpFragment(setup, originalDateParser, dstDateParser, 'oznaczenie powtórzonej godziny OSD');
const originalDateRow = `      $dt = parse_osd_xlsx_datetime($values[$dateCol] ?? '');
      if (!$dt) continue;`;
const validatedDateRow = String.raw`      $rawDate = trim((string)($values[$dateCol] ?? ''));
      $dt = parse_osd_xlsx_datetime($rawDate);
      if (!$dt) {
        if (preg_match('/^(?:\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})/', $rawDate)
            || is_osd_xlsx_data_status(trim((string)($values[$statusCol] ?? '')))) {
          throw new InvalidArgumentException('Nieprawidłowa data lub dopisek godziny w arkuszu XLSX: ' . $rawDate);
        }
        continue;
      }`;
setup = replacePhpFragment(setup, originalDateRow, validatedDateRow, 'odrzucenie nieparsowalnego wiersza pomiarowego');
const lockHelper = `function with_user_consumption_lock(PDO $pdo, string $station, callable $operation) {
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
`;
setup = replaceOnce(setup, 'function normalize_user_station($station): string {',
  php(lockHelper) + 'function normalize_user_station($station): string {', 'blokada profilu');
for (const operation of [
  'load_user_consumption_profile($pdo, $station)',
  'save_user_consumption_profile($pdo, $station, $months, $sources)',
  "save_user_consumption_xlsx($pdo, $station, $_FILES['file'])",
  'reset_user_consumption_month($pdo, $station, $month, $direction)',
]) {
  const guardedOperation = operation.startsWith('save_user_consumption_xlsx(')
    ? "save_user_consumption_xlsx($pdo, $station, $_FILES['file'], (string)($_POST['reject_existing'] ?? '') === '1')"
    : operation.startsWith('save_user_consumption_profile(')
    ? "save_user_consumption_profile($pdo, $station, $months, $sources, ($body['protect_detailed'] ?? false) === true)"
    : operation;
  setup = replaceOnce(setup, `'data'=>${operation}], JSON_UNESCAPED_UNICODE);`,
    `'data'=>with_user_consumption_lock($pdo, $station, fn() => ${guardedOperation})], JSON_UNESCAPED_UNICODE);`,
    operation.split('(')[0]);
}
setup = replaceOnce(setup,
  'function save_user_consumption_profile(PDO $pdo, $station, $months, $sources = null): array {',
  'function save_user_consumption_profile(PDO $pdo, $station, $months, $sources = null, bool $protectDetailed = false): array {',
  'parametr ochrony miesięcy szczegółowych');
const monthlyWrite = `  $annualUsageKwh = round(array_sum($months), 3);
  assert_user_station_exists($pdo, $station);
  upsert_user_consumption_profile_row($pdo, $station, $months, $sources);`;
const protectedMonthlyWrite = `  $annualUsageKwh = round(array_sum($months), 3);
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
  upsert_user_consumption_profile_row($pdo, $station, $months, $sources);`;
setup = replacePhpFragment(setup, monthlyWrite, protectedMonthlyWrite, 'kontrola miesięcy szczegółowych przed zapisem');
const saveCatch = `\t\t} catch (Throwable $e) {
\t\t\thttp_response_code(400);
\t\t\techo json_encode(['ok'=>false, 'error'=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
\t\t}
\t\texit;
\t}

\tif ($action === 'user_consumption_xlsx_upload')`;
setup = replacePhpFragment(setup, saveCatch,
  saveCatch.replace('http_response_code(400);', 'http_response_code($e->getCode() === 409 ? 409 : 400);'),
  'odpowiedź konfliktu miesięcy szczegółowych');
setup = replaceOnce(setup,
  'function save_user_consumption_xlsx(PDO $pdo, string $station, array $file): array {',
  'function save_user_consumption_xlsx(PDO $pdo, string $station, array $file, bool $rejectExisting = false): array {',
  'parametr ochrony XLSX');
const parsedProfile = `  $parsed = parse_osd_consumption_xlsx($tmp);
  [$months, $sources, $exportSources] = load_existing_or_default_consumption_profile($pdo, $station);
  $channels = is_array($parsed['channels'] ?? null) ? $parsed['channels'] : [];
  if (!$channels) {
    throw new InvalidArgumentException('Arkusz nie zawiera danych pobranych ani oddanych');
  }`;
const guardedProfile = `  $parsed = parse_osd_consumption_xlsx($tmp);
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
  [$months, $sources, $exportSources] = load_existing_or_default_consumption_profile($pdo, $station);`;
setup = replacePhpFragment(setup, parsedProfile, guardedProfile, 'kontrola miesiąca przed zapisem');
const uploadCatch = `\t\t} catch (Throwable $e) {
\t\t\thttp_response_code(400);
\t\t\techo json_encode(['ok'=>false, 'error'=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
\t\t}
\t\texit;
\t}

\tif ($action === 'user_consumption_month_reset')`;
const conflictCatch = `\t\t} catch (Throwable $e) {
\t\t\thttp_response_code($e->getCode() === 409 ? 409 : 400);
\t\t\t$error = ['ok'=>false, 'error'=>$e->getMessage()];
\t\t\tif ($e->getCode() === 409) $error['code'] = 'RE_MONTH_EXISTS';
\t\t\techo json_encode($error, JSON_UNESCAPED_UNICODE);
\t\t}
\t\texit;
\t}

\tif ($action === 'user_consumption_month_reset')`;
setup = replacePhpFragment(setup, uploadCatch, conflictCatch, 'odpowiedź konfliktu XLSX');
write('re/setup_func.php', setup);
copyFileSync(path.resolve('public/shared/re-consumption-engine.js'), path.join(outputRoot, 're/js/re-consumption-engine.js'));
console.log(`Przygotowano wspólny profil RE w ${outputRoot}`);
