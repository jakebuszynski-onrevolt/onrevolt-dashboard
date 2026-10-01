<?php
declare(strict_types=1);

const DASHBOARD_WEATHER_STATION_ID = '10793';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$configPath = __DIR__ . '/dashboard.config.php';
if (!is_file($configPath)) {
    respondJson(500, [
        'error' => 'Missing dashboard.config.php',
    ]);
}

$config = require $configPath;
if (!is_array($config)) {
    respondJson(500, [
        'error' => 'Invalid dashboard.config.php',
    ]);
}

$authPath = __DIR__ . '/auth.php';
if (is_file($authPath)) {
    require_once $authPath;
}

date_default_timezone_set((string)($config['timezone'] ?? 'Europe/Warsaw'));

$cacheTtlSeconds = max(0, (int)($config['cache_ttl_seconds'] ?? 15));
$cacheDir = trim((string)($config['cache_dir'] ?? (__DIR__ . '/cache')));
$daysRequested = max(1, (int)($_GET['days'] ?? 91));
$bypassCache = isset($_GET['_ts']) || isset($_GET['nocache']);
$liveOnly = isset($_GET['live']) || strtolower((string)($_GET['mode'] ?? '')) === 'live';
$dashboardAction = strtolower(trim((string)($_GET['action'] ?? $_POST['action'] ?? '')));
$requestedRange = null;
try {
    $requestedRange = dashboardRequestedDateRange($_GET['from'] ?? null, $_GET['to'] ?? null);
} catch (InvalidArgumentException $e) {
    respondJson(400, [
        'error' => 'Invalid dashboard date range',
        'message' => $e->getMessage(),
    ]);
}
$rangeRequest = $requestedRange !== null;
$includeContext = !$rangeRequest || !isset($_GET['context']) || (string)$_GET['context'] !== '0';

$stationInput = trim((string)($_GET['station'] ?? $_POST['station'] ?? ''));
if ($dashboardAction === 'station_list') {
    handleDashboardStationList($config, $stationInput);
}

if ($stationInput === '') {
    respondJson(400, [
        'error' => 'Missing station parameter',
    ]);
}

$stationKey = $stationInput;
$stationConfig = null;

try {
    $stationConfig = dashboardStationConfigFromDatabase($config, $stationInput);
    if ($stationConfig !== null) {
        $stationKey = (string)$stationConfig['energy_station'];
    }
} catch (Throwable $e) {
    respondJson(500, [
        'error' => 'Station lookup failed',
        'message' => $e->getMessage(),
    ]);
}

if ($stationConfig === null) {
    respondJson(404, [
        'error' => 'Unknown station',
        'station' => $stationInput,
    ]);
}

if (!dashboardCurrentUserCanAccessStationToken($config, $stationInput)) {
    respondJson(403, [
        'error' => 'Access denied',
    ]);
}

$energyStation = trim((string)($stationConfig['energy_station'] ?? $stationKey));
$energyApiKey = trim((string)($stationConfig['energy_api_key'] ?? ''));
$weatherStation = trim((string)($stationConfig['weather_station'] ?? DASHBOARD_WEATHER_STATION_ID));
$weatherApiKey = trim((string)($stationConfig['weather_api_key'] ?? ''));
$userTariffSettings = $energyStation !== ''
    ? loadDashboardUserTariffSettings($config, $energyStation)
    : null;
$upstreamDaysRequested = limitDashboardDaysToHistoryStart($daysRequested, $userTariffSettings);

if (($energyStation === '' || $energyApiKey === '') && ($weatherStation === '' || $weatherApiKey === '')) {
    respondJson(500, [
        'error' => 'Missing API configuration for station',
        'station' => $stationKey,
    ]);
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    handleDashboardSettingsPost($config, $stationConfig, $stationKey);
}

if ($liveOnly) {
    if ($energyStation === '' || $energyApiKey === '') {
        respondJson(500, [
            'error' => 'Missing energy API configuration for station',
            'station' => $stationKey,
        ]);
    }

    try {
        $liveEnvelope = fetchDashboardObject(buildUrl(
            (string)($config['energy_endpoint'] ?? ''),
            [
                'station' => $energyStation,
                'api_key' => $energyApiKey,
                'live' => '1',
            ]
        ));
        $livePaths = extractPayloadObject($liveEnvelope, 'livePaths');
        $account = extractPayloadObject($liveEnvelope, 'account');
        $userTariffSettings = loadDashboardUserTariffSettings($config, $energyStation);
        if ($userTariffSettings !== null) {
            $account = is_array($account) ? $account : [];
            $account = array_merge($account, $userTariffSettings);
        }
        $history = extractPayloadObject($liveEnvelope, 'history');
        respondJson(200, [
            'source' => 'remote-live',
            'station' => $stationKey,
            'account' => $account,
            'history' => $history,
            'livePaths' => $livePaths,
        ]);
    } catch (Throwable $e) {
        respondJson(502, [
            'error' => 'Live dashboard data fetch failed',
            'details' => ['energy: ' . $e->getMessage()],
        ]);
    }
}

require_once __DIR__ . '/../re/pricing/DashboardTariffs.php';
$clientTariffContext = \OnRevolt\Pricing\DashboardTariffs::context(energyMeterPdo($config), $energyStation);
$cacheFile = '';
if (!$bypassCache && $cacheTtlSeconds > 0 && $cacheDir !== '') {
    $cacheRangeKey = $rangeRequest
        ? '_r' . $requestedRange['from']->format('Ymd') . '_' . $requestedRange['to']->format('Ymd') . '_c' . ($includeContext ? '1' : '0')
        : '_d' . $daysRequested;
    $cacheFile = rtrim($cacheDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR
        . 'dashboard_netmeta_v2_' . preg_replace('/[^a-zA-Z0-9_-]/', '_', $stationKey) . $cacheRangeKey . '_' . $clientTariffContext['cacheKey'] . '.json';
    respondFreshCacheFile($cacheFile, $cacheTtlSeconds);
}

$energyEnvelope = null;
$weatherEnvelope = null;
$errors = [];

if ($energyStation !== '' && $energyApiKey !== '') {
    try {
        $energyBaseQuery = [
            'station' => $energyStation,
            'api_key' => $energyApiKey,
        ];
        $energyEnvelope = $rangeRequest
            ? fetchDashboardObject(buildUrl((string)($config['energy_endpoint'] ?? ''), $energyBaseQuery + [
                'from' => $requestedRange['from']->format('Y-m-d'),
                'to' => $requestedRange['to']->format('Y-m-d'),
            ]))
            : fetchDashboardObjectForHistoryRange(
                (string)($config['energy_endpoint'] ?? ''),
                $energyBaseQuery,
                $daysRequested,
                $upstreamDaysRequested,
                $userTariffSettings,
                true
            );
    } catch (Throwable $e) {
        $errors[] = 'energy: ' . $e->getMessage();
    }
}

if ($includeContext && $weatherStation !== '' && $weatherApiKey !== '') {
    try {
        $weatherEnvelope = fetchDashboardObjectForHistoryRange(
            (string)($config['weather_endpoint'] ?? ''),
            [
                'station' => $weatherStation,
                'api_key' => $weatherApiKey,
            ],
            $daysRequested,
            $upstreamDaysRequested,
            $userTariffSettings,
            false
        );
    } catch (Throwable $e) {
        $errors[] = 'weather: ' . $e->getMessage();
    }
}

$energy = extractPayloadObject($energyEnvelope, 'energy');
$weather = extractPayloadObject($weatherEnvelope, 'weather');
$usageData = extractUsageDataObject($energyEnvelope);
$reUsageData = null;
if ($energyStation !== '') {
    try {
        $reUsageData = $rangeRequest
            ? fetchDashboardReUsageDatasetRange(
                $energyStation,
                $requestedRange['from'],
                $requestedRange['to']
            )
            : fetchDashboardReUsageDataset($energyStation, $userTariffSettings);
    } catch (Throwable $e) {
        $errors[] = 're-usage: ' . $e->getMessage();
    }
}
if ($reUsageData !== null) {
    $usageData = mergeDashboardRecordDatasets([$reUsageData, $usageData]);
}
$storageData = extractRecordDatasetObject($energyEnvelope, 'storageData');
$pvData = extractRecordDatasetObject($energyEnvelope, 'pvData');
$livePaths = extractPayloadObject($energyEnvelope, 'livePaths');
$dataQuality = extractPayloadObject($energyEnvelope, 'dataQuality');
$account = extractPayloadObject($energyEnvelope, 'account');
$history = extractPayloadObject($energyEnvelope, 'history');
if ($userTariffSettings !== null) {
    $account = is_array($account) ? $account : [];
    $account = array_merge($account, $userTariffSettings);
}
$weatherData = extractWeatherDataObject($weatherEnvelope);
$rce = null;
$priceHistory = null;
$tariffData = null;
$purchaseData = null;
$rceRows = null;

if ($includeContext) {
    try {
        $rceRows = fetchJson(buildUrl(
            (string)($config['rce_endpoint'] ?? ''),
            ['date' => date('Y-m-d')]
        ));
        $rce = buildRcePayload($rceRows);
    } catch (Throwable $e) {
        $errors[] = 'rce: ' . $e->getMessage();
    }
}

try {
    $priceHistory = buildPriceHistoryPayload($config, $cacheDir, $usageData, $rceRows);
} catch (Throwable $e) {
    $errors[] = 'price-history: ' . $e->getMessage();
}

if ($includeContext) {
    try {
        $tariffData = fetchTariffPayload($config, $cacheDir, is_array($account) ? $account : null, $bypassCache);
    } catch (Throwable $e) {
        $errors[] = 'tariff: ' . $e->getMessage();
    }

    try {
        $purchaseData = buildPurchaseDataPayload(
            is_array($tariffData) ? ($tariffData['next'] ?? null) : null,
            $rce,
            date('Y-m-d')
        );
    } catch (Throwable $e) {
        $errors[] = 'purchase: ' . $e->getMessage();
    }
}

if ($energy === null && is_array($energyEnvelope) && !array_key_exists('energy', $energyEnvelope)) {
    $energy = isAssoc($energyEnvelope) ? $energyEnvelope : null;
}
if ($weather === null && is_array($weatherEnvelope) && !array_key_exists('weather', $weatherEnvelope)) {
    $weather = isAssoc($weatherEnvelope) ? $weatherEnvelope : null;
}

if ($energy === null && $weather === null && $usageData === null) {
    respondJson(502, [
        'error' => 'No dashboard data returned from upstream APIs',
        'details' => $errors,
    ]);
}

$payload = [
    'source' => 'remote',
    'energy' => $energy ?? (object)[],
    'weather' => $weather ?? (object)[],
    'account' => $account ?? (object)[],
    'history' => $history ?? (object)[],
    'rce' => $rce,
    'useRandomUsageData' => true,
];
if ($rangeRequest) {
    $payload['range'] = [
        'from' => $requestedRange['from']->format('Y-m-d'),
        'to' => $requestedRange['to']->format('Y-m-d'),
    ];
}

if ($usageData !== null && isset($usageData['records']) && is_array($usageData['records'])) {
    $payload['usageData'] = $usageData;
    $payload['useRandomUsageData'] = false;
}

if ($storageData !== null) {
    $payload['storageData'] = $storageData;
}

if ($pvData !== null) {
    $payload['pvData'] = $pvData;
}

if ($livePaths !== null) {
    $payload['livePaths'] = $livePaths;
}

if ($dataQuality !== null) {
    $payload['dataQuality'] = $dataQuality;
}

$payload['dataMode'] = resolveDashboardDataMode(
    $payload['usageData'] ?? null,
    $payload['pvData'] ?? null,
    $payload['storageData'] ?? null,
    is_array($energy ?? null) ? $energy : null,
    (bool)($payload['useRandomUsageData'] ?? true)
);

if ($weatherData !== null && isset($weatherData['records']) && is_array($weatherData['records'])) {
    $payload['weatherData'] = $weatherData;
}

if ($includeContext) {
    $weatherSources = buildWeatherSourcesPayload($weather, $weatherData);
    if ($weatherSources !== null) {
        $payload['weatherSources'] = $weatherSources;
    }
}

if ($tariffData !== null) {
    $payload['tariffData'] = $tariffData;
}
if ($purchaseData !== null) {
    $payload['purchaseData'] = $purchaseData;
}
if ($priceHistory !== null) {
    $payload['priceHistory'] = $priceHistory;
}

if ($includeContext) \OnRevolt\Pricing\DashboardTariffs::attach($payload, $clientTariffContext);
$payloadBody = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($payloadBody === false) {
    respondJson(500, ['error' => 'Dashboard payload encoding failed']);
}

if (!$bypassCache && $cacheFile !== '' && writeCacheBody($cacheFile, $payloadBody)) {
    unset($payload, $payloadBody);
    respondFreshCacheFile($cacheFile, max(1, $cacheTtlSeconds));
    respondJson(500, ['error' => 'Dashboard cache response failed']);
}

unset($payload);
respondJsonBody(200, $payloadBody);

function buildUrl(string $baseUrl, array $query): string
{
    $trimmedBaseUrl = trim($baseUrl);
    if ($trimmedBaseUrl === '') {
        throw new RuntimeException('Missing upstream endpoint URL');
    }

    return $trimmedBaseUrl . (strpos($trimmedBaseUrl, '?') !== false ? '&' : '?') . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
}

function fetchDashboardObject(string $url): ?array
{
    $decoded = fetchJson($url);

    if (!isAssoc($decoded)) {
        for ($i = count($decoded) - 1; $i >= 0; $i--) {
            $row = $decoded[$i] ?? null;
            if (is_array($row) && isAssoc($row)) {
                return $row;
            }
        }
        return null;
    }

    $nestedData = $decoded['data'] ?? null;
    if (is_array($nestedData) && isAssoc($nestedData)) {
        return $nestedData;
    }

    $nestedLatest = $decoded['latest'] ?? null;
    if (is_array($nestedLatest) && isAssoc($nestedLatest)) {
        return $nestedLatest;
    }

    return $decoded;
}

function fetchDashboardObjectForHistoryRange(
    string $endpoint,
    array $baseQuery,
    int $daysRequested,
    int $safeDaysRequested,
    ?array $settings,
    bool $useMonthlyRanges
): ?array {
    $historyStart = $useMonthlyRanges ? dashboardHistoryStartDate($settings) : null;
    if ($historyStart !== null) {
        $rangeEnd = new DateTimeImmutable('tomorrow');
        if ($historyStart < $rangeEnd) {
            $objects = [];
            foreach (dashboardMonthlyDateChunks($historyStart, $rangeEnd) as $chunk) {
                $object = fetchDashboardObject(buildUrl($endpoint, $baseQuery + [
                    'from' => $chunk['from']->format('Y-m-d'),
                    'to' => $chunk['to']->format('Y-m-d'),
                ]));
                if ($object !== null) {
                    $objects[] = $object;
                }
            }

            return mergeDashboardObjectChunks($objects);
        }
    }

    return fetchDashboardObject(buildUrl($endpoint, $baseQuery + [
        'days' => (string)max(1, min($daysRequested, $safeDaysRequested)),
    ]));
}

function dashboardHistoryStartDate(?array $settings): ?DateTimeImmutable
{
    $historyStart = is_array($settings)
        ? normalizeDashboardDataStart($settings['historyStart'] ?? ($settings['dateStart'] ?? null))
        : null;
    if ($historyStart === null) {
        return null;
    }

    try {
        return new DateTimeImmutable($historyStart);
    } catch (Throwable $e) {
        return null;
    }
}

function dashboardRequestedDateRange($fromValue, $toValue): ?array
{
    $fromText = trim((string)($fromValue ?? ''));
    $toText = trim((string)($toValue ?? ''));
    if ($fromText === '' && $toText === '') {
        return null;
    }
    if ($fromText === '' || $toText === '') {
        throw new InvalidArgumentException('Parametry from i to muszą występować razem.');
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $fromText) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $toText)) {
        throw new InvalidArgumentException('Parametry from i to muszą mieć format RRRR-MM-DD.');
    }

    $from = DateTimeImmutable::createFromFormat('!Y-m-d', $fromText);
    $to = DateTimeImmutable::createFromFormat('!Y-m-d', $toText);
    if (!$from || !$to || $from->format('Y-m-d') !== $fromText || $to->format('Y-m-d') !== $toText) {
        throw new InvalidArgumentException('Nieprawidłowa data zakresu.');
    }
    if ($to <= $from) {
        throw new InvalidArgumentException('Parametr to musi być późniejszy niż from.');
    }
    if ((int)$from->diff($to)->days > 31) {
        throw new InvalidArgumentException('Jedno żądanie może obejmować najwyżej jeden miesiąc.');
    }

    return [
        'from' => $from,
        'to' => $to,
    ];
}

function dashboardMonthlyDateChunks(DateTimeImmutable $from, DateTimeImmutable $to): array
{
    $chunks = [];
    $cursor = $from;
    while ($cursor < $to) {
        $monthEnd = $cursor->modify('first day of next month');
        $chunkTo = $monthEnd < $to ? $monthEnd : $to;
        if ($chunkTo <= $cursor) {
            break;
        }
        $chunks[] = [
            'from' => $cursor,
            'to' => $chunkTo,
        ];
        $cursor = $chunkTo;
    }

    return $chunks;
}

function mergeDashboardRecordDatasets(array $datasets): ?array
{
    $merged = null;
    $recordsByDate = [];
    foreach ($datasets as $dataset) {
        if (!is_array($dataset) || !isset($dataset['records']) || !is_array($dataset['records'])) {
            continue;
        }
        if ($merged === null) {
            $merged = $dataset;
        } else {
            foreach ($dataset as $key => $value) {
                if ($key !== 'records') {
                    $merged[$key] = $value;
                }
            }
        }
        foreach ($dataset['records'] as $record) {
            if (!is_array($record)) {
                continue;
            }
            $dateKey = dashboardRecordDateKey($record);
            if ($dateKey === null) {
                continue;
            }
            $recordsByDate[$dateKey] = $record;
        }
    }

    if ($merged === null || $recordsByDate === []) {
        return null;
    }

    ksort($recordsByDate);
    $records = array_values($recordsByDate);
    $merged['records'] = $records;
    $merged['totalDays'] = count($records);
    $merged['oldestDate'] = array_key_first($recordsByDate);
    $merged['latestDate'] = array_key_last($recordsByDate);

    return $merged;
}

function mergeDashboardObjectChunks(array $objects): ?array
{
    $merged = null;
    $usageDatasets = [];
    $storageDatasets = [];
    $pvDatasets = [];
    $qualityIssues = [];
    $qualityPayload = null;

    foreach ($objects as $object) {
        if (!is_array($object)) {
            continue;
        }

        if ($merged === null) {
            $merged = $object;
        } else {
            foreach ($object as $key => $value) {
                if (in_array($key, ['usageData', 'storageData', 'pvData', 'dataQuality'], true)) {
                    continue;
                }
                $merged[$key] = $value;
            }
        }

        $usageDataset = $object['usageData'] ?? null;
        if (is_array($usageDataset) && isset($usageDataset['records']) && is_array($usageDataset['records'])) {
            $usageDatasets[] = $usageDataset;
        }
        $storageDataset = $object['storageData'] ?? null;
        if (is_array($storageDataset) && isset($storageDataset['records']) && is_array($storageDataset['records'])) {
            $storageDatasets[] = $storageDataset;
        }
        $pvDataset = $object['pvData'] ?? null;
        if (is_array($pvDataset) && isset($pvDataset['records']) && is_array($pvDataset['records'])) {
            $pvDatasets[] = $pvDataset;
        }

        $dataQuality = $object['dataQuality'] ?? null;
        if (is_array($dataQuality)) {
            $qualityPayload = $dataQuality;
            if (isset($dataQuality['issues']) && is_array($dataQuality['issues'])) {
                foreach ($dataQuality['issues'] as $issue) {
                    if (is_array($issue)) {
                        $qualityIssues[] = $issue;
                    }
                }
            }
        }
    }

    if ($merged === null) {
        return null;
    }

    $usageData = mergeDashboardRecordDatasets($usageDatasets);
    if ($usageData !== null) {
        $merged['usageData'] = $usageData;
    }
    $storageData = mergeDashboardRecordDatasets($storageDatasets);
    if ($storageData !== null) {
        $merged['storageData'] = $storageData;
    }
    $pvData = mergeDashboardRecordDatasets($pvDatasets);
    if ($pvData !== null) {
        $merged['pvData'] = $pvData;
    }

    if ($qualityPayload !== null) {
        $qualityPayload['issues'] = $qualityIssues;
        $qualityPayload['issueCount'] = count($qualityIssues);
        $qualityPayload['ok'] = count($qualityIssues) === 0;
        $qualityPayload['status'] = count($qualityIssues) === 0 ? 'ok' : 'error';
        $merged['dataQuality'] = $qualityPayload;
    }

    return $merged;
}

function dashboardRecordDateKey(array $record): ?string
{
    foreach (['date', 'day', 'dateKey', 'timestamp', 'datetime'] as $key) {
        $value = trim((string)($record[$key] ?? ''));
        if ($value !== '' && preg_match('/^(\d{4}-\d{2}-\d{2})/', $value, $matches)) {
            return $matches[1];
        }
    }

    return null;
}

function fetchDashboardReUsageDataset(string $station, ?array $settings): ?array
{
    $historyStart = dashboardHistoryStartDate($settings);
    if ($historyStart === null) {
        return null;
    }

    $rangeEnd = new DateTimeImmutable('tomorrow');
    if ($historyStart >= $rangeEnd) {
        return null;
    }

    $datasets = [];
    foreach (dashboardMonthlyDateChunks($historyStart, $rangeEnd) as $chunk) {
        $rows = fetchJson(buildUrl('https://my.onrevolt.com/re/get_dbdata.php', [
            'api' => 'usage',
            'station' => $station,
            'from' => $chunk['from']->format('Y-m-d'),
            'to' => $chunk['to']->format('Y-m-d'),
        ]));
        $dataset = is_array($rows) && $rows !== []
            ? buildDashboardUsageDatasetFromReRows($rows)
            : null;
        if ($dataset !== null) {
            $datasets[] = $dataset;
        }
    }

    return mergeDashboardRecordDatasets($datasets);
}

function fetchDashboardReUsageDatasetRange(
    string $station,
    DateTimeImmutable $from,
    DateTimeImmutable $to
): ?array {
    $rows = fetchJson(buildUrl('https://my.onrevolt.com/re/get_dbdata.php', [
        'api' => 'usage',
        'station' => $station,
        'from' => $from->format('Y-m-d'),
        'to' => $to->format('Y-m-d'),
    ]));

    return $rows !== [] ? buildDashboardUsageDatasetFromReRows($rows) : null;
}

function buildDashboardUsageDatasetFromReRows(array $rows): ?array
{
    $timezone = new DateTimeZone('Europe/Warsaw');
    $byDate = [];

    foreach ($rows as $row) {
        if (!is_array($row) || count($row) < 2) {
            continue;
        }
        $timestamp = trim((string)($row[0] ?? ''));
        if (!preg_match('/^(\d{4}-\d{2}-\d{2})\s+(\d{2}):/', $timestamp, $matches)) {
            continue;
        }
        $dateKey = $matches[1];
        $hour = max(0, min(23, (int)$matches[2]));
        $importKwh = max(0.0, (float)($row[1] ?? 0));
        $exportKwh = max(0.0, (float)($row[2] ?? 0));

        if (!isset($byDate[$dateKey])) {
            $byDate[$dateKey] = [];
        }

        for ($quarter = 0; $quarter < 4; $quarter++) {
            $slotIndex = ($hour * 4) + $quarter;
            $slotStart = new DateTimeImmutable(
                sprintf('%s %02d:%02d:00', $dateKey, $hour, $quarter * 15),
                $timezone
            );
            $slotEnd = $slotStart->modify('+15 minutes');
            $gridImportKwh = round($importKwh / 4, 6);
            $gridExportKwh = round($exportKwh / 4, 6);
            $byDate[$dateKey][$slotIndex] = [
                'hour' => $hour,
                'quarter' => $quarter,
                'label' => sprintf('%02d:%02d', $hour, $quarter * 15),
                'slotIndex' => $slotIndex,
                'localBucketIndex' => $slotIndex,
                'slotOccurrence' => 0,
                'slotStart' => $slotStart->format('c'),
                'slotEnd' => $slotEnd->format('c'),
                'timezoneOffsetMinutes' => (int)($slotStart->getOffset() / 60),
                'grid' => $gridImportKwh,
                'storage' => 0,
                'pv' => 0,
                'gridToLoadKwh' => $gridImportKwh,
                'gridToStorageKwh' => 0,
                'pvToLoadKwh' => 0,
                'pvToStorageKwh' => 0,
                'pvToBatteryKwh' => 0,
                'pvToGridKwh' => $gridExportKwh,
                'storageToLoadKwh' => 0,
                'storageToGridKwh' => 0,
                'chargeFromPvKwh' => 0,
                'chargeFromGridKwh' => 0,
                'load' => $gridImportKwh,
                'totalLoadKwh' => $gridImportKwh,
                'gridNetKwh' => round($gridImportKwh - $gridExportKwh, 6),
                'gridImportKwh' => $gridImportKwh,
                'gridExportKwh' => $gridExportKwh,
                'storageNetKwh' => 0,
                'storageChargeKwh' => 0,
                'storageDischargeKwh' => 0,
                'pvGenerationKwh' => $gridExportKwh,
                'pvPowerW' => null,
                'storageSocPercent' => null,
                'storageLevelKwh' => null,
                'storageCapacityKwh' => null,
            ];
        }
    }

    if ($byDate === []) {
        return null;
    }

    ksort($byDate);
    $records = [];
    foreach ($byDate as $dateKey => $quartersByIndex) {
        ksort($quartersByIndex);
        $records[] = [
            'date' => $dateKey,
            'slotCount' => count($quartersByIndex),
            'timezone' => 'Europe/Warsaw',
            'quarters' => array_values($quartersByIndex),
        ];
    }

    return [
        'source' => 're-usage-hourly',
        'latestDate' => array_key_last($byDate),
        'totalDays' => count($records),
        'records' => $records,
    ];
}

function limitDashboardDaysToHistoryStart(int $daysRequested, ?array $settings): int
{
    $historyStart = is_array($settings)
        ? normalizeDashboardDataStart($settings['historyStart'] ?? ($settings['dateStart'] ?? null))
        : null;
    if ($historyStart === null) {
        return $daysRequested;
    }

    try {
        $start = new DateTimeImmutable($historyStart);
        $today = new DateTimeImmutable('today');
    } catch (Throwable $e) {
        return $daysRequested;
    }

    if ($start >= $today) {
        return 1;
    }

    $daysSinceStart = (int)$start->diff($today)->days;
    $maxUpstreamDays = max(1, $daysSinceStart - 2);

    return min($daysRequested, $maxUpstreamDays);
}

function fetchJson(string $url): array
{
    $response = httpRequest($url);
    $decoded = json_decode($response, true);

    if (!is_array($decoded)) {
        throw new RuntimeException('Invalid JSON response from ' . $url);
    }

    return $decoded;
}

function readFreshCache(string $cacheFile, int $ttlSeconds): ?array
{
    if (!is_file($cacheFile)) {
        return null;
    }

    $modifiedAt = @filemtime($cacheFile);
    if ($modifiedAt === false || (time() - $modifiedAt) > $ttlSeconds) {
        return null;
    }

    $body = @file_get_contents($cacheFile);
    if ($body === false || trim($body) === '') {
        return null;
    }

    $decoded = json_decode($body, true);
    return is_array($decoded) ? $decoded : null;
}

function readFreshCacheBody(string $cacheFile, int $ttlSeconds): ?string
{
    if (!is_file($cacheFile)) {
        return null;
    }

    $modifiedAt = @filemtime($cacheFile);
    if ($modifiedAt === false || (time() - $modifiedAt) > $ttlSeconds) {
        return null;
    }

    $body = @file_get_contents($cacheFile);
    if ($body === false || trim($body) === '') {
        return null;
    }

    $trimmed = trim($body);
    if ($trimmed === '' || $trimmed[0] !== '{' || substr($trimmed, -1) !== '}') {
        return null;
    }

    return $body;
}

function respondFreshCacheFile(string $cacheFile, int $ttlSeconds): void
{
    if (!is_file($cacheFile)) {
        return;
    }

    clearstatcache(true, $cacheFile);
    $modifiedAt = @filemtime($cacheFile);
    $size = @filesize($cacheFile);
    if ($modifiedAt === false || $size === false || $size < 2 || (time() - $modifiedAt) > $ttlSeconds) {
        return;
    }

    $handle = @fopen($cacheFile, 'rb');
    if (!$handle) {
        return;
    }

    $first = fread($handle, 1);
    if (@fseek($handle, -1, SEEK_END) !== 0) {
        fclose($handle);
        return;
    }
    $last = fread($handle, 1);
    fclose($handle);

    if ($first !== '{' || $last !== '}') {
        return;
    }

    http_response_code(200);
    header('Content-Length: ' . $size);
    @readfile($cacheFile);
    exit;
}

function readCachePayload(string $cacheFile): ?array
{
    if (!is_file($cacheFile)) {
        return null;
    }

    $body = @file_get_contents($cacheFile);
    if ($body === false || trim($body) === '') {
        return null;
    }

    $decoded = json_decode($body, true);
    return is_array($decoded) ? $decoded : null;
}

function writeCache(string $cacheFile, array $payload): void
{
    $directory = dirname($cacheFile);
    if (!is_dir($directory)) {
        @mkdir($directory, 0775, true);
    }

    $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($body === false) {
        return;
    }

    writeCacheBody($cacheFile, $body);
}

function writeCacheBody(string $cacheFile, string $body): bool
{
    $directory = dirname($cacheFile);
    if (!is_dir($directory)) {
        @mkdir($directory, 0775, true);
    }

    $tmpFile = $cacheFile . '.tmp.' . getmypid() . '.' . uniqid('', true);
    $written = @file_put_contents($tmpFile, $body, LOCK_EX);
    if ($written === false) {
        @unlink($tmpFile);
        return false;
    }

    @chmod($tmpFile, 0664);
    if (!@rename($tmpFile, $cacheFile)) {
        @unlink($tmpFile);
        return false;
    }

    return true;
}

function resolveUserTariffSelection(?array $account): array
{
    $settings = is_array($account['tariffSettings'] ?? null) ? $account['tariffSettings'] : [];
    $current = is_array($settings['current'] ?? null) ? $settings['current'] : [];
    $target = is_array($settings['target'] ?? null) ? $settings['target'] : [];

    return [
        'current' => [
            'osdId' => parseDashboardInt($current['osdId'] ?? ($account['tariffCurrentOsdId'] ?? null)),
            'tariffId' => parseDashboardInt($current['tariffId'] ?? ($account['tariffCurrentTariffId'] ?? null)),
        ],
        'target' => [
            'osdId' => parseDashboardInt($target['osdId'] ?? ($account['tariffTargetOsdId'] ?? null)),
            'tariffId' => parseDashboardInt($target['tariffId'] ?? ($account['tariffTargetTariffId'] ?? null)),
        ],
    ];
}

function getTariffSelectionCacheKey(array $selection): string
{
    $current = is_array($selection['current'] ?? null) ? $selection['current'] : [];
    $target = is_array($selection['target'] ?? null) ? $selection['target'] : [];
    $key = implode('_', [
        'c',
        (string)($current['osdId'] ?? 0),
        (string)($current['tariffId'] ?? 0),
        't',
        (string)($target['osdId'] ?? 0),
        (string)($target['tariffId'] ?? 0),
    ]);

    return preg_replace('/[^a-zA-Z0-9_-]/', '_', $key) ?: 'default';
}

function resolveTariffEndpointFromSelection(array $config, ?array $selection, string $fallbackConfigKey): string
{
    $osdId = parseDashboardInt($selection['osdId'] ?? null);
    $tariffId = parseDashboardInt($selection['tariffId'] ?? null);
    if ($osdId !== null && $osdId > 0 && $tariffId !== null && $tariffId > 0) {
        $baseUrl = resolveTariffCatalogBaseUrl($config);
        if ($baseUrl !== '') {
            return buildUrl($baseUrl, [
                'act' => 'get',
                'osd_id' => (string)$osdId,
                'tariff_id' => (string)$tariffId,
            ]);
        }
    }

    return trim((string)($config[$fallbackConfigKey] ?? ''));
}

function resolveTariffProviderName(?array $account, array $config): string
{
    $settings = is_array($account['tariffSettings'] ?? null) ? $account['tariffSettings'] : [];
    $target = is_array($settings['target'] ?? null) ? $settings['target'] : [];
    $provider = trim((string)($target['operator'] ?? ''));
    if ($provider !== '') {
        return $provider;
    }

    return trim((string)($config['tariff_provider'] ?? 'ENEA')) ?: 'ENEA';
}

function fetchTariffPayload(array $config, string $cacheDir, ?array $account = null, bool $bypassCache = false): ?array
{
    $selection = resolveUserTariffSelection($account);
    $currentEndpoint = resolveTariffEndpointFromSelection($config, $selection['current'] ?? null, 'tariff_current_endpoint');
    $nextEndpoint = resolveTariffEndpointFromSelection($config, $selection['target'] ?? null, 'tariff_next_endpoint');
    if ($currentEndpoint === '' && $nextEndpoint === '') {
        return null;
    }

    $cacheFile = '';
    if ($cacheDir !== '') {
        $cacheFile = rtrim($cacheDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'dashboard_tariffs_netmeta_v2_' . getTariffSelectionCacheKey($selection) . '.json';
    }

    $ttlSeconds = max(0, (int)($config['tariff_cache_ttl_seconds'] ?? 86400));
    $cachedPayload = (!$bypassCache && $cacheFile !== '') ? readCachePayload($cacheFile) : null;
    $freshCachedPayload = (!$bypassCache && $cacheFile !== '' && $ttlSeconds > 0)
        ? readFreshCache($cacheFile, $ttlSeconds)
        : null;

    if ($freshCachedPayload !== null) {
        if (isset($freshCachedPayload['catalog'])) {
            return $freshCachedPayload;
        }
    }

    $currentTariff = null;
    $nextTariff = null;
    $catalog = null;

    if ($currentEndpoint !== '') {
        $currentTariff = fetchDashboardObject($currentEndpoint);
    }
    if ($nextEndpoint !== '') {
        $nextTariff = fetchDashboardObject($nextEndpoint);
    }
    $catalog = fetchTariffCatalogPayload($config, $cacheDir, $bypassCache);

    if ($currentTariff === null && isset($cachedPayload['current']) && is_array($cachedPayload['current'])) {
        $currentTariff = $cachedPayload['current'];
    }
    if ($nextTariff === null && isset($cachedPayload['next']) && is_array($cachedPayload['next'])) {
        $nextTariff = $cachedPayload['next'];
    }
    if ($catalog === null && isset($cachedPayload['catalog']) && is_array($cachedPayload['catalog'])) {
        $catalog = $cachedPayload['catalog'];
    }

    if ($currentTariff === null && $nextTariff === null && $catalog === null) {
        return $cachedPayload;
    }

    $payload = [
        'provider' => resolveTariffProviderName($account, $config),
        'source' => trim((string)($config['tariff_source'] ?? 'windyone_setup')) ?: 'windyone_setup',
        'fetchedAt' => date(DATE_ATOM),
        'selection' => $selection,
    ];

    if ($currentTariff !== null) {
        $payload['current'] = $currentTariff;
    }
    if ($nextTariff !== null) {
        $payload['next'] = $nextTariff;
    }
    if ($catalog !== null) {
        $payload['catalog'] = $catalog;
    }

    if ($cacheFile !== '') {
        writeCache($cacheFile, $payload);
    }

    return $payload;
}

function fetchTariffCatalogPayload(array $config, string $cacheDir, bool $bypassCache = false): ?array
{
    $baseUrl = resolveTariffCatalogBaseUrl($config);
    if ($baseUrl === '') {
        return null;
    }

    $cacheFile = '';
    if ($cacheDir !== '') {
        $cacheFile = rtrim($cacheDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'dashboard_tariff_catalog.json';
    }

    $ttlSeconds = max(0, (int)($config['tariff_catalog_cache_ttl_seconds'] ?? ($config['tariff_cache_ttl_seconds'] ?? 86400)));
    $cachedPayload = (!$bypassCache && $cacheFile !== '') ? readCachePayload($cacheFile) : null;
    $freshCachedPayload = (!$bypassCache && $cacheFile !== '' && $ttlSeconds > 0)
        ? readFreshCache($cacheFile, $ttlSeconds)
        : null;
    if ($freshCachedPayload !== null) {
        return $freshCachedPayload;
    }

    $osdPayload = fetchJson(buildUrl($baseUrl, ['action' => 'json_osds']));
    $osds = $osdPayload['osds'] ?? null;
    if (!is_array($osds) || $osds === []) {
        return $cachedPayload;
    }

    $operators = [];
    $warnings = [];

    foreach ($osds as $osd) {
        if (!is_array($osd)) {
            continue;
        }
        $osdId = parseDashboardInt($osd['id'] ?? null);
        $osdName = trim((string)($osd['name'] ?? ''));
        if ($osdId === null || $osdId <= 0 || $osdName === '') {
            continue;
        }

        $operator = [
            'id' => $osdId,
            'name' => $osdName,
            'slug' => trim((string)($osd['slug'] ?? '')),
            'tariffs' => [],
        ];

        try {
            $tariffPayload = fetchJson(buildUrl($baseUrl, [
                'action' => 'json_tariffs',
                'osd' => (string)$osdId,
            ]));
        } catch (Throwable $e) {
            $warnings[] = 'tariffs ' . $osdName . ': ' . $e->getMessage();
            $tariffPayload = [];
        }

        $tariffs = $tariffPayload['tariffs'] ?? null;
        if (is_array($tariffs)) {
            foreach ($tariffs as $tariff) {
                if (!is_array($tariff)) {
                    continue;
                }
                $tariffId = parseDashboardInt($tariff['id'] ?? null);
                if ($tariffId === null || $tariffId <= 0) {
                    continue;
                }

                $entry = [
                    'id' => $tariffId,
                    'key' => 'catalog:' . $osdId . ':' . $tariffId,
                    'code' => trim((string)($tariff['code'] ?? '')),
                    'name' => trim((string)($tariff['name'] ?? '')),
                    'segment' => trim((string)($tariff['segment'] ?? '')),
                    'sell_method' => trim((string)($tariff['sell_method'] ?? '')),
                    'use_monthly' => !empty($tariff['use_monthly']),
                ];

                try {
                    $detail = fetchDashboardObject(buildUrl($baseUrl, [
                        'act' => 'get',
                        'osd_id' => (string)$osdId,
                        'tariff_id' => (string)$tariffId,
                    ]));
                    if (is_array($detail)) {
                        $detail['osd_id'] = $osdId;
                        $detail['tariff_id'] = $tariffId;
                        $detail['provider'] = $osdName;
                        $entry['detail'] = $detail;
                    }
                } catch (Throwable $e) {
                    $warnings[] = 'tariff ' . $osdName . '/' . $tariffId . ': ' . $e->getMessage();
                }

                $operator['tariffs'][] = $entry;
            }
        }

        $operators[] = $operator;
    }

    if ($operators === []) {
        return $cachedPayload;
    }

    $payload = [
        'source' => trim((string)($config['tariff_source'] ?? 'windyone_setup')) ?: 'windyone_setup',
        'fetchedAt' => date(DATE_ATOM),
        'operators' => $operators,
    ];
    if ($warnings !== []) {
        $payload['warnings'] = array_slice($warnings, 0, 12);
    }

    if ($cacheFile !== '') {
        writeCache($cacheFile, $payload);
    }

    return $payload;
}

function resolveTariffCatalogBaseUrl(array $config): string
{
    $explicit = trim((string)($config['tariff_catalog_endpoint'] ?? ''));
    if ($explicit !== '') {
        return $explicit;
    }

    foreach (['tariff_current_endpoint', 'tariff_next_endpoint'] as $key) {
        $endpoint = trim((string)($config[$key] ?? ''));
        if ($endpoint === '') {
            continue;
        }
        $parts = parse_url($endpoint);
        if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host']) || empty($parts['path'])) {
            continue;
        }
        return $parts['scheme'] . '://' . $parts['host'] . $parts['path'];
    }

    return 'https://windyone.pl/re/setup_func.php';
}

function buildPurchaseDataPayload($tariff, ?array $rcePayload, string $businessDate): ?array
{
    if (!is_array($tariff)) {
        return null;
    }

    $hourlyRates = [];
    $currentHour = (int)date('G');
    $currentPrice = null;
    $lowestEntry = null;

    for ($hour = 0; $hour < 24; $hour++) {
        $price = resolveTariffPurchasePrice($tariff, $businessDate, $hour, $rcePayload);
        $windowCode = resolveTariffWindowCodeForDateHour($tariff, $businessDate, $hour);
        $entry = [
            'hour' => $hour,
            'windowCode' => $windowCode,
        ];

        if ($price !== null) {
            $entry['pricePln'] = round($price, 6);
            if ($currentHour === $hour) {
                $currentPrice = $price;
            }
            if ($lowestEntry === null || $price < $lowestEntry['pricePln']) {
                $lowestEntry = [
                    'hour' => $hour,
                    'pricePln' => $price,
                    'windowCode' => $windowCode,
                ];
            }
        }

        $hourlyRates[] = $entry;
    }

    if ($currentPrice === null) {
        foreach ($hourlyRates as $entry) {
            if (isset($entry['pricePln']) && is_numeric($entry['pricePln'])) {
                $currentPrice = (float)$entry['pricePln'];
                break;
            }
        }
    }

    if ($lowestEntry === null) {
        return null;
    }

    $payload = [
        'businessDate' => $businessDate,
        'currentHour' => $currentHour,
        'tariffCode' => trim((string)($tariff['code'] ?? '')),
        'tariffName' => trim((string)($tariff['name'] ?? '')),
        'hourlyRates' => $hourlyRates,
        'lowestHour' => $lowestEntry['hour'],
        'lowestPricePln' => round((float)$lowestEntry['pricePln'], 6),
        'lowestWindowCode' => $lowestEntry['windowCode'],
    ];

    if ($currentPrice !== null) {
        $payload['currentPricePln'] = round((float)$currentPrice, 6);
    }

    return $payload;
}

function resolveTariffPurchasePrice(array $tariff, string $dateKey, int $hour, ?array $rcePayload): ?float
{
    $windowCode = resolveTariffWindowCodeForDateHour($tariff, $dateKey, $hour);
    $sellMethod = strtolower(trim((string)($tariff['sell_method'] ?? 'fixed')));

    if ($sellMethod === 'rdn') {
        $rdnPrice = resolveRcePriceForHour($rcePayload, $hour);
        if ($rdnPrice === null) {
            return null;
        }

        return sumTariffVariableRowsForWindow(
            is_array($tariff['variable'] ?? null) ? $tariff['variable'] : [],
            $windowCode,
            false
        ) + $rdnPrice;
    }

    return sumTariffVariableRowsForWindow(
        is_array($tariff['variable'] ?? null) ? $tariff['variable'] : [],
        $windowCode,
        true
    );
}

function resolveRcePriceForHour(?array $rcePayload, int $hour): ?float
{
    if (!is_array($rcePayload) || !isset($rcePayload['hourlyRates']) || !is_array($rcePayload['hourlyRates'])) {
        return null;
    }

    foreach ($rcePayload['hourlyRates'] as $entry) {
        if (!is_array($entry)) {
            continue;
        }

        $entryHour = parseDashboardInt($entry['hour'] ?? null);
        if ($entryHour !== $hour) {
            continue;
        }

        $price = $entry['pricePln'] ?? null;
        return is_numeric($price) ? (float)$price : null;
    }

    return null;
}

function resolveTariffWindowCodeForDateHour(array $tariff, string $dateKey, int $hour): string
{
    $zoneModel = strtolower(trim((string)($tariff['zone_model'] ?? 'all')));
    if ($zoneModel === '' || $zoneModel === 'all') {
        return 'all';
    }

    $timestamp = strtotime($dateKey . sprintf(' %02d:00:00', $hour));
    if ($timestamp !== false) {
        $weekday = (int)date('w', $timestamp);
        $cheapSaturday = !empty($tariff['cheap_saturday']);
        $cheapSunday = !empty($tariff['cheap_sunday']);
        if (($weekday === 6 && $cheapSaturday) || ($weekday === 0 && $cheapSunday)) {
            if ($zoneModel === 'daynight') {
                return 'night';
            }
            if ($zoneModel === 'peakoffpeak') {
                return 'offpeak';
            }
            if ($zoneModel === 'highmidlow') {
                return 'low';
            }
        }
    }

    if (!empty($tariff['use_monthly']) && isset($tariff['monthly']) && is_array($tariff['monthly'])) {
        $month = (int)substr($dateKey, 5, 2);
        $row = $tariff['monthly'][(string)$month] ?? $tariff['monthly'][$month] ?? null;
        if (is_array($row) && array_key_exists($hour, $row)) {
            $value = (int)$row[$hour];
            if ($zoneModel === 'highmidlow') {
                return $value === 1 ? 'high' : ($value === 3 ? 'low' : 'mid');
            }
            if ($zoneModel === 'daynight') {
                return $value === 1 ? 'night' : 'day';
            }
            if ($zoneModel === 'peakoffpeak') {
                return $value === 1 ? 'offpeak' : 'peak';
            }
        }
    }

    if ($zoneModel === 'daynight') {
        $nightHours = isset($tariff['dn_night']) && is_array($tariff['dn_night']) ? $tariff['dn_night'] : [];
        return in_array($hour, array_map('intval', $nightHours), true) ? 'night' : 'day';
    }

    if ($zoneModel === 'peakoffpeak') {
        $offPeakHours = isset($tariff['po_off']) && is_array($tariff['po_off']) ? $tariff['po_off'] : [];
        return in_array($hour, array_map('intval', $offPeakHours), true) ? 'offpeak' : 'peak';
    }

    if ($zoneModel === 'highmidlow') {
        return 'mid';
    }

    return 'all';
}

function sumTariffVariableRowsForWindow(array $rows, string $windowCode, bool $includeEnergyActive): float
{
    $normalizedWindowCode = strtolower(trim($windowCode));
    $sum = 0.0;

    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }

        $rowWindowCode = strtolower(trim((string)($row['window_code'] ?? 'all')));
        if ($normalizedWindowCode === 'all') {
            if ($rowWindowCode !== 'all') {
                continue;
            }
        } elseif ($rowWindowCode !== 'all' && $rowWindowCode !== $normalizedWindowCode) {
            continue;
        }

        $label = normalizeDashboardLabel((string)($row['label'] ?? ''));
        if (!$includeEnergyActive && isEnergyActiveTariffLabel($label)) {
            continue;
        }

        $price = $row['price'] ?? null;
        if (!is_numeric($price)) {
            continue;
        }

        $sum += (float)$price;
    }

    return $sum;
}

function isEnergyActiveTariffLabel(string $label): bool
{
    return strpos($label, 'energia czynna') !== false;
}

function normalizeDashboardLabel(string $value): string
{
    $value = trim(function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value));
    $transliterated = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
    if (is_string($transliterated) && $transliterated !== '') {
        $value = $transliterated;
    }

    return preg_replace('/\s+/', ' ', $value) ?? $value;
}

function httpRequest(string $url): string
{
    $headers = [
        'Accept: application/json, text/plain, */*',
        'User-Agent: OnRevoltDashboardProxy/1.0',
    ];

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_HTTPHEADER => $headers,
        ]);

        $body = curl_exec($ch);
        $statusCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            throw new RuntimeException($error !== '' ? $error : 'HTTP request failed');
        }

        if ($statusCode < 200 || $statusCode >= 300) {
            throw new RuntimeException('HTTP ' . $statusCode . ' from ' . $url);
        }

        return (string)$body;
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 20,
            'header' => implode("\r\n", $headers),
            'ignore_errors' => true,
        ],
    ]);

    $body = @file_get_contents($url, false, $context);
    if ($body === false) {
        throw new RuntimeException('HTTP request failed for ' . $url);
    }

    $statusCode = 0;
    foreach ($http_response_header ?? [] as $header) {
        if (preg_match('/^HTTP\/\S+\s+(\d{3})\b/', $header, $matches)) {
            $statusCode = (int)$matches[1];
            break;
        }
    }

    if ($statusCode < 200 || $statusCode >= 300) {
        throw new RuntimeException('HTTP ' . $statusCode . ' from ' . $url);
    }

    return $body;
}

function httpPostJson(string $url, array $payload): array
{
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($body === false) {
        throw new RuntimeException('Cannot encode JSON payload');
    }

    $headers = [
        'Accept: application/json, text/plain, */*',
        'Content-Type: application/json; charset=utf-8',
        'User-Agent: OnRevoltDashboardProxy/1.0',
    ];

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
        ]);

        $responseBody = curl_exec($ch);
        $statusCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($responseBody === false) {
            throw new RuntimeException($error !== '' ? $error : 'HTTP POST failed');
        }
        if ($statusCode < 200 || $statusCode >= 300) {
            throw new RuntimeException('HTTP ' . $statusCode . ' from ' . $url . ': ' . (string)$responseBody);
        }

        $decoded = json_decode((string)$responseBody, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('Invalid JSON response from ' . $url);
        }

        return $decoded;
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'timeout' => 20,
            'header' => implode("\r\n", $headers),
            'content' => $body,
            'ignore_errors' => true,
        ],
    ]);

    $responseBody = @file_get_contents($url, false, $context);
    if ($responseBody === false) {
        throw new RuntimeException('HTTP POST failed for ' . $url);
    }

    $statusCode = 0;
    foreach ($http_response_header ?? [] as $header) {
        if (preg_match('/^HTTP\/\S+\s+(\d{3})\b/', $header, $matches)) {
            $statusCode = (int)$matches[1];
            break;
        }
    }
    if ($statusCode < 200 || $statusCode >= 300) {
        throw new RuntimeException('HTTP ' . $statusCode . ' from ' . $url . ': ' . (string)$responseBody);
    }

    $decoded = json_decode((string)$responseBody, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('Invalid JSON response from ' . $url);
    }

    return $decoded;
}

function clearDashboardStationCache(string $cacheDir, string $stationKey): void
{
    if ($cacheDir === '' || !is_dir($cacheDir)) {
        return;
    }

    $safeStation = preg_replace('/[^a-zA-Z0-9_-]/', '_', $stationKey);
    foreach (glob(rtrim($cacheDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'dashboard_' . $safeStation . '_d*.json') ?: [] as $path) {
        if (is_file($path)) {
            @unlink($path);
        }
    }
}

function dashboardTariffSettingColumns(): array
{
    return [
        'tariff_current_osd_id',
        'tariff_current_tariff_id',
        'tariff_target_osd_id',
        'tariff_target_tariff_id',
    ];
}

function dashboardDataStartColumns(): array
{
    return [
        'dateStart',
        'historyStart',
        'date_start',
        'history_start',
        'start_date',
        'data_start',
        'dataStart',
        'startData',
        'start_data',
        'data_start_date',
    ];
}

function dashboardLocationColumnCandidates(): array
{
    return [
        'locationLabel' => ['location_label', 'locationLabel', 'location_name', 'locationName', 'address', 'adres', 'description', 'opis'],
        'lat' => ['lat', 'latitude'],
        'lon' => ['lon', 'lng', 'longitude'],
    ];
}

function dashboardLocationColumnDefaults(): array
{
    return [
        'locationLabel' => ['name' => 'location_label', 'definition' => 'VARCHAR(255) NULL DEFAULT NULL'],
        'lat' => ['name' => 'lat', 'definition' => 'DECIMAL(10,6) NULL DEFAULT NULL'],
        'lon' => ['name' => 'lon', 'definition' => 'DECIMAL(10,6) NULL DEFAULT NULL'],
    ];
}

function dashboardCurrentUserCanSwitchStations(?PDO $pdo = null): bool
{
    $user = function_exists('onrevoltAuthCurrentUser') ? onrevoltAuthCurrentUser($pdo) : null;
    if (!is_array($user)) {
        return false;
    }

    if (function_exists('onrevoltAuthUserCanSwitchStations')) {
        return onrevoltAuthUserCanSwitchStations($user, $pdo);
    }

    $userType = strtolower(trim((string)($user['user_type'] ?? '')));
    if (in_array($userType, ['moderator', 'admin'], true)) {
        return true;
    }

    $stationHash = trim((string)($user['station_hash'] ?? ''));
    if ($pdo === null || $stationHash === '' || !dashboardDbHasColumn($pdo, 'EnergyMeter_users', 'user_type')) {
        return false;
    }

    $stmt = $pdo->prepare('SELECT user_type FROM EnergyMeter_users WHERE station_hash = :hash LIMIT 1');
    $stmt->execute([':hash' => $stationHash]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    $dbUserType = strtolower(trim((string)($row['user_type'] ?? '')));
    return in_array($dbUserType, ['moderator', 'admin'], true);
}

function dashboardCurrentUserCanAccessStationToken(array $config, string $stationInput): bool
{
    if (PHP_SAPI === 'cli'
        && defined('ONREVOLT_CRM_READ_ONLY_PROFILE')
        && ONREVOLT_CRM_READ_ONLY_PROFILE === true
        && ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
        return true;
    }
    $pdo = null;
    try {
        $pdo = energyMeterPdo($config);
    } catch (Throwable $e) {
        $pdo = null;
    }

    $user = function_exists('onrevoltAuthCurrentUser') ? onrevoltAuthCurrentUser($pdo) : null;
    if (!is_array($user)) {
        return false;
    }

    if (function_exists('onrevoltAuthUserCanSwitchStations') && onrevoltAuthUserCanSwitchStations($user, $pdo)) {
        return true;
    }

    $stationInput = function_exists('onrevoltAuthNormalizeStationToken')
        ? onrevoltAuthNormalizeStationToken($stationInput)
        : trim($stationInput);
    if ($stationInput === '' || preg_match('/^\d+$/', $stationInput)) {
        return false;
    }

    $stationHash = trim((string)($user['station_hash'] ?? ''));
    return $stationHash !== '' && hash_equals($stationHash, $stationInput);
}

function handleDashboardStationList(array $config, string $currentStation): void
{
    $user = function_exists('onrevoltAuthCurrentUser') ? onrevoltAuthCurrentUser() : null;
    if (!is_array($user)) {
        respondJson(200, [
            'ok' => true,
            'allowed' => false,
            'stations' => [],
        ]);
    }
    if ($currentStation === '') {
        $sessionStation = trim((string)($user['station'] ?? ''));
        if ($sessionStation !== '') {
            $currentStation = $sessionStation;
        }
    }

    try {
        $pdo = energyMeterPdo($config);
        if (function_exists('onrevoltAuthEnsureSchema')) {
            onrevoltAuthEnsureSchema($pdo);
        }

        if (!dashboardCurrentUserCanSwitchStations($pdo)) {
            respondJson(200, [
                'ok' => true,
                'allowed' => false,
                'stations' => [],
            ]);
        }

        $locationColumns = dashboardLocationColumns($pdo);
        $labelColumn = $locationColumns['locationLabel'] ?? null;
        $nameColumn = dashboardDbHasColumn($pdo, 'EnergyMeter_users', 'name') ? 'name' : null;
        if (!dashboardDbHasColumn($pdo, 'EnergyMeter_users', 'api_key')) {
            throw new RuntimeException('Brak kolumny api_key w EnergyMeter_users.');
        }
        $select = ['station', 'station_hash'];
        if ($nameColumn !== null) {
            $select[] = "`$nameColumn` AS station_name";
        }
        if ($labelColumn !== null) {
            $select[] = "`$labelColumn` AS station_label";
        }

        $stmt = $pdo->prepare(
            'SELECT ' . implode(', ', $select) . '
             FROM EnergyMeter_users
             WHERE station IS NOT NULL
               AND station_hash IS NOT NULL
               AND station_hash <> ""
               AND api_key IS NOT NULL
               AND TRIM(api_key) <> ""
             ORDER BY CAST(station AS UNSIGNED), station'
        );
        $stmt->execute();

        $stations = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $station = trim((string)($row['station'] ?? ''));
            $stationHash = trim((string)($row['station_hash'] ?? ''));
            if ($station === '' || $stationHash === '') {
                continue;
            }

            $stationName = normalizeDashboardLocationLabel($row['station_name'] ?? null);
            $locationLabel = normalizeDashboardLocationLabel($row['station_label'] ?? null);
            $isCurrent = hash_equals((string)$station, (string)$currentStation)
                || hash_equals($stationHash, (string)$currentStation);

            $stations[] = [
                'stationHash' => $stationHash,
                'stationName' => $stationName,
                'name' => $stationName,
                'locationLabel' => $locationLabel,
                'location' => $locationLabel,
                'label' => $locationLabel !== null ? $station . ' - ' . $locationLabel : 'Stacja ' . $station,
                'current' => $isCurrent,
            ];
        }

        respondJson(200, [
            'ok' => true,
            'allowed' => true,
            'currentStation' => $currentStation,
            'stations' => $stations,
        ]);
    } catch (Throwable $e) {
        respondJson(500, [
            'ok' => false,
            'error' => 'Station list failed',
            'message' => $e->getMessage(),
        ]);
    }
}

function energyMeterPdo(array $config): PDO
{
    $db = $config['energy_meter_db'] ?? null;
    if (!is_array($db)) {
        throw new RuntimeException('Brak konfiguracji bazy EnergyMeter_users.');
    }

    $host = trim((string)($db['host'] ?? ''));
    $user = trim((string)($db['user'] ?? ''));
    $pass = (string)($db['pass'] ?? '');
    $dbname = trim((string)($db['dbname'] ?? ''));
    $charset = trim((string)($db['charset'] ?? 'utf8mb4')) ?: 'utf8mb4';

    if ($host === '' || $user === '' || $dbname === '') {
        throw new RuntimeException('Niepełna konfiguracja bazy EnergyMeter_users.');
    }

    return new PDO(
        "mysql:host=$host;dbname=$dbname;charset=$charset",
        $user,
        $pass,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );
}

function dashboardDbHasColumn(PDO $pdo, string $table, string $column): bool
{
    $stmt = $pdo->prepare("SHOW COLUMNS FROM `$table` LIKE :column");
    $stmt->execute([':column' => $column]);
    return (bool)$stmt->fetch(PDO::FETCH_ASSOC);
}

function dashboardDbHasTable(PDO $pdo, string $table): bool
{
    $stmt = $pdo->prepare('SHOW TABLES LIKE :table');
    $stmt->execute([':table' => $table]);
    return (bool)$stmt->fetch(PDO::FETCH_NUM);
}

function dashboardStationConfigFromDatabase(array $config, string $stationInput): ?array
{
    $stationInput = trim($stationInput);
    if ($stationInput === '') {
        return null;
    }

    $pdo = energyMeterPdo($config);
    if (function_exists('onrevoltAuthEnsureSchema')) {
        onrevoltAuthEnsureSchema($pdo);
    }

    if (!dashboardDbHasColumn($pdo, 'EnergyMeter_users', 'api_key')) {
        throw new RuntimeException('Brak kolumny api_key w EnergyMeter_users.');
    }

    $hasStationHash = dashboardDbHasColumn($pdo, 'EnergyMeter_users', 'station_hash');
    $optionalColumns = ['station_hash', 'weather_station', 'weather_api_key'];
    $select = ['station', 'api_key'];
    foreach ($optionalColumns as $column) {
        if (dashboardDbHasColumn($pdo, 'EnergyMeter_users', $column)) {
            $select[] = $column;
        }
    }

    $columnSql = implode(', ', array_map(static function (string $column): string {
        return '`' . $column . '`';
    }, array_unique($select)));

    if (ctype_digit($stationInput)) {
        $stmt = $pdo->prepare(
            'SELECT ' . $columnSql . '
             FROM EnergyMeter_users
             WHERE station = :station
             LIMIT 1'
        );
        $stmt->bindValue(':station', $stationInput, PDO::PARAM_INT);
    } elseif ($hasStationHash) {
        $stmt = $pdo->prepare(
            'SELECT ' . $columnSql . '
             FROM EnergyMeter_users
             WHERE station_hash = :station_hash
             LIMIT 1'
        );
        $stmt->bindValue(':station_hash', $stationInput, PDO::PARAM_STR);
    } else {
        return null;
    }

    $stmt->execute();
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($row)) {
        return null;
    }

    $station = trim((string)($row['station'] ?? ''));
    if ($station === '') {
        return null;
    }

    $energyApiKey = trim((string)($row['api_key'] ?? ''));
    if ($energyApiKey === '') {
        throw new RuntimeException('Brak api_key w EnergyMeter_users dla stacji ' . $station . '.');
    }

    $weatherStation = trim((string)($row['weather_station'] ?? ($config['weather_station'] ?? DASHBOARD_WEATHER_STATION_ID)));
    $weatherApiKey = trim((string)($row['weather_api_key'] ?? ''));
    if ($weatherApiKey === '') {
        $weatherApiKey = $energyApiKey;
    }

    return [
        'energy_station' => $station,
        'energy_api_key' => $energyApiKey,
        'weather_station' => $weatherStation,
        'weather_api_key' => $weatherApiKey,
    ];
}

function dashboardTariffColumnsExist(PDO $pdo): bool
{
    foreach (dashboardTariffSettingColumns() as $column) {
        if (!dashboardDbHasColumn($pdo, 'EnergyMeter_users', $column)) {
            return false;
        }
    }

    return true;
}

function dashboardDataStartColumn(PDO $pdo): ?string
{
    foreach (dashboardDataStartColumns() as $column) {
        if (dashboardDbHasColumn($pdo, 'EnergyMeter_users', $column)) {
            return $column;
        }
    }

    return null;
}

function dashboardFindColumn(PDO $pdo, array $candidates): ?string
{
    foreach ($candidates as $column) {
        if (dashboardDbHasColumn($pdo, 'EnergyMeter_users', $column)) {
            return $column;
        }
    }

    return null;
}

function dashboardLocationColumns(PDO $pdo): array
{
  $columns = [];
  foreach (dashboardLocationColumnCandidates() as $key => $candidates) {
        $column = dashboardFindColumn($pdo, $candidates);
        if ($column !== null) {
            $columns[$key] = $column;
        }
    }

  return $columns;
}

function dashboardAnnualUsageColumnCandidates(): array
{
    return [
        'annual_usage_kwh',
        'annualUsageKwh',
        'annual_consumption_kwh',
        'annualConsumptionKwh',
        'usage_annual_kwh',
    ];
}

function dashboardAnnualUsageColumn(PDO $pdo): ?string
{
    return dashboardFindColumn($pdo, dashboardAnnualUsageColumnCandidates());
}

function dashboardPvSizeColumnCandidates(): array
{
    return [
        'pv_size_kwp',
        'pvSizeKwp',
        'pv_kwp',
        'pvKwp',
        'pv_power_kwp',
    ];
}

function dashboardPvSizeColumn(PDO $pdo): ?string
{
    return dashboardFindColumn($pdo, dashboardPvSizeColumnCandidates());
}

function ensureDashboardAnnualUsageColumn(PDO $pdo): string
{
    $column = dashboardAnnualUsageColumn($pdo);
    if ($column !== null) {
        return $column;
    }

    $column = 'annual_usage_kwh';
    $pdo->exec("ALTER TABLE `EnergyMeter_users` ADD COLUMN `$column` DECIMAL(12,3) NULL DEFAULT NULL");
    return $column;
}

function ensureDashboardPvSizeColumn(PDO $pdo): string
{
    $column = dashboardPvSizeColumn($pdo);
    if ($column !== null) {
        return $column;
    }

    $column = 'pv_size_kwp';
    $pdo->exec("ALTER TABLE `EnergyMeter_users` ADD COLUMN `$column` DECIMAL(8,3) NULL DEFAULT NULL");
    return $column;
}

function loadDashboardConsumptionProfileAnnualUsage(PDO $pdo, string $energyStation): ?float
{
    if (!dashboardDbHasTable($pdo, 'EnergyMeter_users_data')) {
        return null;
    }

    $cols = [];
    for ($i = 1; $i <= 12; $i++) {
        $cols[] = sprintf('month_%02d_kwh', $i);
    }

    foreach ($cols as $col) {
        if (!dashboardDbHasColumn($pdo, 'EnergyMeter_users_data', $col)) {
            return null;
        }
    }

    $stmt = $pdo->prepare(
        'SELECT ' . implode(', ', array_map(fn($col) => "`$col`", $cols)) . '
         FROM EnergyMeter_users_data
         WHERE station = :station AND data_type = :data_type
         LIMIT 1'
    );
    $stmt->bindValue(':station', $energyStation, PDO::PARAM_STR);
    $stmt->bindValue(':data_type', 'consumption_profile', PDO::PARAM_STR);
    $stmt->execute();
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return null;
    }

    $total = 0.0;
    foreach ($cols as $col) {
        $value = normalizeDashboardAnnualUsageKwh($row[$col] ?? null, false);
        if ($value !== null) {
            $total += $value;
        }
    }

    return $total > 0 ? round($total, 3) : null;
}

function ensureDashboardLocationColumns(PDO $pdo): array
{
    $columns = dashboardLocationColumns($pdo);
    foreach (dashboardLocationColumnDefaults() as $key => $default) {
        if (!isset($columns[$key])) {
            $column = (string)$default['name'];
            $definition = (string)$default['definition'];
            $pdo->exec("ALTER TABLE `EnergyMeter_users` ADD COLUMN `$column` $definition");
            $columns[$key] = $column;
        }
    }

    return $columns;
}

function ensureDashboardDataStartColumn(PDO $pdo): string
{
    $column = dashboardDataStartColumn($pdo);
    if ($column !== null) {
        return $column;
    }

    $column = 'date_start';
    $pdo->exec("ALTER TABLE `EnergyMeter_users` ADD COLUMN `$column` DATE NULL DEFAULT NULL");
    return $column;
}

function normalizeDashboardDataStart($value): ?string
{
    if ($value instanceof DateTimeInterface) {
        return $value->format('Y-m-d');
    }
    if ($value === null || is_array($value) || is_object($value)) {
        return null;
    }

    $trimmed = trim((string)$value);
    if ($trimmed === '') {
        return null;
    }

    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $trimmed, $matches)) {
        $year = (int)$matches[1];
        $month = (int)$matches[2];
        $day = (int)$matches[3];
        if (checkdate($month, $day, $year)) {
            return sprintf('%04d-%02d-%02d', $year, $month, $day);
        }
    }

    if (preg_match('/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/', $trimmed, $matches)) {
        $day = (int)$matches[1];
        $month = (int)$matches[2];
        $year = (int)$matches[3];
        if (checkdate($month, $day, $year)) {
            return sprintf('%04d-%02d-%02d', $year, $month, $day);
        }
    }

    throw new InvalidArgumentException('Niepoprawna data startu danych.');
}

function ensureDashboardTariffColumns(PDO $pdo): void
{
    foreach (dashboardTariffSettingColumns() as $column) {
        if (!dashboardDbHasColumn($pdo, 'EnergyMeter_users', $column)) {
            $pdo->exec("ALTER TABLE `EnergyMeter_users` ADD COLUMN `$column` INT NULL DEFAULT NULL");
        }
    }
}

function validateDashboardTariffSelection(PDO $pdo, ?int $osdId, ?int $tariffId, string $label): ?array
{
    if ($osdId === null && $tariffId === null) {
        return null;
    }
    if ($osdId === null || $osdId <= 0 || $tariffId === null || $tariffId <= 0) {
        throw new InvalidArgumentException('Niepełna taryfa: ' . $label);
    }

    $stmt = $pdo->prepare(
        'SELECT t.id, t.osd_id, t.code, t.name, o.name AS osd_name
         FROM tariff t
         JOIN osd o ON o.id = t.osd_id
         WHERE t.id = :tariff_id AND t.osd_id = :osd_id
         LIMIT 1'
    );
    $stmt->execute([
        ':tariff_id' => $tariffId,
        ':osd_id' => $osdId,
    ]);

    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        throw new InvalidArgumentException('Taryfa nie należy do operatora: ' . $label);
    }

    return [
        'osdId' => (int)$row['osd_id'],
        'tariffId' => (int)$row['id'],
        'operator' => (string)$row['osd_name'],
        'code' => (string)$row['code'],
        'name' => (string)$row['name'],
    ];
}

function emptyDashboardTariffSelection(?int $osdId, ?int $tariffId): array
{
    return [
        'osdId' => $osdId,
        'tariffId' => $tariffId,
    ];
}

function dashboardStationParams(string $energyStation): array
{
    $station = trim($energyStation);
    if ($station === '') {
        throw new RuntimeException('Brak numeru stacji EnergyMeter_users.');
    }

    return [
        'value' => ctype_digit($station) ? (int)$station : $station,
        'type' => ctype_digit($station) ? PDO::PARAM_INT : PDO::PARAM_STR,
    ];
}

function loadDashboardUserTariffSettings(array $config, string $energyStation): ?array
{
    $pdo = energyMeterPdo($config);
    if (!dashboardTariffColumnsExist($pdo)) {
        return null;
    }
    $dataStartColumn = dashboardDataStartColumn($pdo);
    $dataStartSelect = $dataStartColumn !== null ? ", `$dataStartColumn` AS dashboard_data_start" : "";
    if (!dashboardDbHasColumn($pdo, 'EnergyMeter_users', 'depositStart')) {
        throw new RuntimeException('Brak kolumny depositStart w EnergyMeter_users.');
    }
    $depositStartSelect = ", `depositStart` AS dashboard_deposit_start";
    $annualUsageColumn = dashboardAnnualUsageColumn($pdo);
    $annualUsageSelect = $annualUsageColumn !== null ? ", `$annualUsageColumn` AS dashboard_annual_usage_kwh" : "";
    $pvSizeColumn = dashboardPvSizeColumn($pdo);
    $pvSizeSelect = $pvSizeColumn !== null ? ", `$pvSizeColumn` AS dashboard_pv_size_kwp" : "";
    $accountNameColumn = dashboardDbHasColumn($pdo, 'EnergyMeter_users', 'name') ? 'name' : null;
    $accountNameSelect = $accountNameColumn !== null ? ", `$accountNameColumn` AS dashboard_account_name" : "";
    $locationColumns = dashboardLocationColumns($pdo);
    $locationSelect = "";
    foreach ($locationColumns as $key => $column) {
        $locationSelect .= ", `$column` AS dashboard_location_$key";
    }

    $station = dashboardStationParams($energyStation);
    $stmt = $pdo->prepare(
         'SELECT tariff_current_osd_id,
                 tariff_current_tariff_id,
                 tariff_target_osd_id,
                 tariff_target_tariff_id' . $dataStartSelect . $depositStartSelect . $annualUsageSelect . $pvSizeSelect . $accountNameSelect . $locationSelect . '
          FROM EnergyMeter_users
          WHERE station = :station
          LIMIT 1'
    );
    $stmt->bindValue(':station', $station['value'], $station['type']);
    $stmt->execute();

    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return null;
    }

    $currentOsdId = parseDashboardInt($row['tariff_current_osd_id'] ?? null);
    $currentTariffId = parseDashboardInt($row['tariff_current_tariff_id'] ?? null);
    $targetOsdId = parseDashboardInt($row['tariff_target_osd_id'] ?? null);
    $targetTariffId = parseDashboardInt($row['tariff_target_tariff_id'] ?? null);
    $dateStart = $dataStartColumn !== null ? normalizeDashboardDataStart($row['dashboard_data_start'] ?? null) : null;
    $depositStartRaw = $row['dashboard_deposit_start'] ?? null;
    if (!is_numeric($depositStartRaw) || !is_finite((float)$depositStartRaw) || (float)$depositStartRaw < 0) {
        throw new RuntimeException('Nieprawidłowa wartość depositStart w EnergyMeter_users.');
    }
    $depositStartPln = round((float)$depositStartRaw, 2);
    $current = validateDashboardTariffSelection($pdo, $currentOsdId, $currentTariffId, 'dotychczasowa');
    $target = validateDashboardTariffSelection($pdo, $targetOsdId, $targetTariffId, 'docelowa');

    $result = [
        'tariffCurrentOsdId' => $currentOsdId,
        'tariffCurrentTariffId' => $currentTariffId,
        'tariffTargetOsdId' => $targetOsdId,
        'tariffTargetTariffId' => $targetTariffId,
        'depositStart' => $depositStartPln,
        'depositStartPln' => $depositStartPln,
        'tariffSettings' => [
            'current' => $current ?? emptyDashboardTariffSelection($currentOsdId, $currentTariffId),
            'target' => $target ?? emptyDashboardTariffSelection($targetOsdId, $targetTariffId),
        ],
    ];
    if ($dateStart !== null) {
        $result['dateStart'] = $dateStart;
        $result['historyStart'] = $dateStart;
    }
    $annualUsageKwh = $annualUsageColumn !== null
        ? normalizeDashboardAnnualUsageKwh($row['dashboard_annual_usage_kwh'] ?? null, false)
        : null;
    if ($annualUsageKwh === null) {
        $annualUsageKwh = loadDashboardConsumptionProfileAnnualUsage($pdo, $energyStation);
    }
    if ($annualUsageKwh !== null) {
        $result['annualUsageKwh'] = $annualUsageKwh;
        $result['annualConsumptionKwh'] = $annualUsageKwh;
    }
    $pvSizeKwp = $pvSizeColumn !== null
        ? normalizeDashboardPvSizeKwp($row['dashboard_pv_size_kwp'] ?? null, false)
        : null;
    if ($pvSizeKwp !== null) {
        $result['pvSizeKwp'] = $pvSizeKwp;
        $result['pvKwp'] = $pvSizeKwp;
        $result['pvPowerKwp'] = $pvSizeKwp;
    }
    if ($accountNameColumn !== null) {
        $accountName = normalizeDashboardLocationLabel($row['dashboard_account_name'] ?? null);
        if ($accountName !== null) {
            $result['name'] = $accountName;
        }
    }
    if (array_key_exists('locationLabel', $locationColumns)) {
        $locationLabel = normalizeDashboardLocationLabel($row['dashboard_location_locationLabel'] ?? null);
        if ($locationLabel !== null) {
            $result['locationLabel'] = $locationLabel;
            $result['locationName'] = $locationLabel;
        }
    }
    if (array_key_exists('lat', $locationColumns)) {
        $lat = normalizeDashboardCoordinate($row['dashboard_location_lat'] ?? null, -90, 90, false);
        if ($lat !== null) {
            $result['lat'] = $lat;
            $result['latitude'] = $lat;
        }
    }
    if (array_key_exists('lon', $locationColumns)) {
        $lon = normalizeDashboardCoordinate($row['dashboard_location_lon'] ?? null, -180, 180, false);
        if ($lon !== null) {
            $result['lon'] = $lon;
            $result['lng'] = $lon;
            $result['longitude'] = $lon;
        }
    }

    return $result;
}

function saveDashboardUserTariffSettings(array $config, string $energyStation, array $settings): array
{
    $pdo = energyMeterPdo($config);
    ensureDashboardTariffColumns($pdo);

    $station = dashboardStationParams($energyStation);
    $stmtCheck = $pdo->prepare('SELECT station FROM EnergyMeter_users WHERE station = :station LIMIT 1');
    $stmtCheck->bindValue(':station', $station['value'], $station['type']);
    $stmtCheck->execute();
    if (!$stmtCheck->fetch(PDO::FETCH_ASSOC)) {
        throw new RuntimeException('Nie znaleziono stacji w EnergyMeter_users: ' . $energyStation);
    }

    $current = validateDashboardTariffSelection(
        $pdo,
        $settings['currentOsdId'] ?? null,
        $settings['currentTariffId'] ?? null,
        'dotychczasowa'
    );
    $target = validateDashboardTariffSelection(
        $pdo,
        $settings['targetOsdId'] ?? null,
        $settings['targetTariffId'] ?? null,
        'docelowa'
    );
    $hasDataStartInput = array_key_exists('dateStart', $settings) || array_key_exists('historyStart', $settings);
    $dateStart = $hasDataStartInput
        ? normalizeDashboardDataStart($settings['dateStart'] ?? ($settings['historyStart'] ?? null))
        : null;
    $dataStartColumn = $hasDataStartInput ? ensureDashboardDataStartColumn($pdo) : null;
    if ($hasDataStartInput && $dateStart === null) {
        throw new InvalidArgumentException('Brak daty startu danych.');
    }
    $hasAnnualUsageInput = array_key_exists('annualUsageKwh', $settings)
        || array_key_exists('annualUsage', $settings)
        || array_key_exists('annual_usage_kwh', $settings);
    $annualUsageKwh = $hasAnnualUsageInput
        ? normalizeDashboardAnnualUsageKwh(
            $settings['annualUsageKwh'] ?? ($settings['annualUsage'] ?? ($settings['annual_usage_kwh'] ?? null)),
            true
        )
        : null;
    $annualUsageColumn = $hasAnnualUsageInput ? ensureDashboardAnnualUsageColumn($pdo) : null;
    $hasPvSizeInput = array_key_exists('pvSizeKwp', $settings)
        || array_key_exists('pvKwp', $settings)
        || array_key_exists('pv_size_kwp', $settings);
    $pvSizeKwp = $hasPvSizeInput
        ? normalizeDashboardPvSizeKwp(
            $settings['pvSizeKwp'] ?? ($settings['pvKwp'] ?? ($settings['pv_size_kwp'] ?? null)),
            true
        )
        : null;
    $pvSizeColumn = $hasPvSizeInput ? ensureDashboardPvSizeColumn($pdo) : null;

    $hasLocationLabelInput = array_key_exists('locationLabel', $settings);
    $hasLatInput = array_key_exists('lat', $settings);
    $hasLonInput = array_key_exists('lon', $settings);
    $locationColumns = ($hasLocationLabelInput || $hasLatInput || $hasLonInput)
        ? ensureDashboardLocationColumns($pdo)
        : [];
    $locationSet = "";
    $locationBinds = [];
    if ($hasLocationLabelInput) {
        $locationSet .= ", `" . $locationColumns['locationLabel'] . "` = :location_label";
        $locationBinds[':location_label'] = normalizeDashboardLocationLabel($settings['locationLabel'] ?? null);
    }
    if ($hasLatInput) {
        $locationSet .= ", `" . $locationColumns['lat'] . "` = :lat";
        $locationBinds[':lat'] = normalizeDashboardCoordinate($settings['lat'] ?? null, -90, 90, true);
    }
    if ($hasLonInput) {
        $locationSet .= ", `" . $locationColumns['lon'] . "` = :lon";
        $locationBinds[':lon'] = normalizeDashboardCoordinate($settings['lon'] ?? null, -180, 180, true);
    }

    $dataStartSet = $hasDataStartInput ? ", `$dataStartColumn` = :date_start" : "";
    $annualUsageSet = $hasAnnualUsageInput ? ", `$annualUsageColumn` = :annual_usage_kwh" : "";
    $pvSizeSet = $hasPvSizeInput ? ", `$pvSizeColumn` = :pv_size_kwp" : "";
    $stmt = $pdo->prepare(
        'UPDATE EnergyMeter_users
         SET tariff_current_osd_id = :current_osd_id,
             tariff_current_tariff_id = :current_tariff_id,
             tariff_target_osd_id = :target_osd_id,
             tariff_target_tariff_id = :target_tariff_id' . $dataStartSet . $annualUsageSet . $pvSizeSet . $locationSet . '
         WHERE station = :station
         LIMIT 1'
    );
    $stmt->bindValue(':current_osd_id', $current['osdId'] ?? null, $current === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
    $stmt->bindValue(':current_tariff_id', $current['tariffId'] ?? null, $current === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
    $stmt->bindValue(':target_osd_id', $target['osdId'] ?? null, $target === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
    $stmt->bindValue(':target_tariff_id', $target['tariffId'] ?? null, $target === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
    if ($hasDataStartInput) {
        $stmt->bindValue(':date_start', $dateStart, PDO::PARAM_STR);
    }
    if ($hasAnnualUsageInput) {
        if ($annualUsageKwh === null) {
            $stmt->bindValue(':annual_usage_kwh', null, PDO::PARAM_NULL);
        } else {
            $stmt->bindValue(':annual_usage_kwh', sprintf('%.3F', $annualUsageKwh), PDO::PARAM_STR);
        }
    }
    if ($hasPvSizeInput) {
        if ($pvSizeKwp === null) {
            $stmt->bindValue(':pv_size_kwp', null, PDO::PARAM_NULL);
        } else {
            $stmt->bindValue(':pv_size_kwp', sprintf('%.3F', $pvSizeKwp), PDO::PARAM_STR);
        }
    }
    foreach ($locationBinds as $name => $value) {
        if ($value === null) {
            $stmt->bindValue($name, null, PDO::PARAM_NULL);
        } else {
            $stmt->bindValue($name, $name === ':location_label' ? (string)$value : sprintf('%.6F', (float)$value), PDO::PARAM_STR);
        }
    }
    $stmt->bindValue(':station', $station['value'], $station['type']);
    $stmt->execute();

    $result = [
        'updated' => $stmt->rowCount(),
        'tariffCurrentOsdId' => $current['osdId'] ?? null,
        'tariffCurrentTariffId' => $current['tariffId'] ?? null,
        'tariffTargetOsdId' => $target['osdId'] ?? null,
        'tariffTargetTariffId' => $target['tariffId'] ?? null,
        'tariffSettings' => [
            'current' => $current ?? emptyDashboardTariffSelection(null, null),
            'target' => $target ?? emptyDashboardTariffSelection(null, null),
        ],
    ];
    if ($hasDataStartInput) {
        $result['dateStart'] = $dateStart;
        $result['historyStart'] = $dateStart;
    }
    if ($hasAnnualUsageInput) {
        $result['annualUsageKwh'] = $annualUsageKwh;
        $result['annualConsumptionKwh'] = $annualUsageKwh;
    }
    if ($hasPvSizeInput) {
        $result['pvSizeKwp'] = $pvSizeKwp;
        $result['pvKwp'] = $pvSizeKwp;
        $result['pvPowerKwp'] = $pvSizeKwp;
    }
    if ($hasLocationLabelInput) {
        $result['locationLabel'] = $locationBinds[':location_label'];
        $result['locationName'] = $locationBinds[':location_label'];
    }
    if ($hasLatInput) {
        $result['lat'] = $locationBinds[':lat'];
        $result['latitude'] = $locationBinds[':lat'];
    }
    if ($hasLonInput) {
        $result['lon'] = $locationBinds[':lon'];
        $result['lng'] = $locationBinds[':lon'];
        $result['longitude'] = $locationBinds[':lon'];
    }

    return $result;
}

function handleDashboardSettingsPost(array $config, array $stationConfig, string $stationKey): void
{
    $input = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($input)) {
        respondJson(400, ['ok' => false, 'error' => 'Invalid JSON payload']);
    }

    $energyStation = trim((string)($stationConfig['energy_station'] ?? $stationKey));
    if ($energyStation === '') {
        respondJson(500, ['ok' => false, 'error' => 'Missing station settings configuration']);
    }

    $settings = [
        'currentOsdId' => parseDashboardInt($input['currentOperatorId'] ?? ($input['tariff_current_osd_id'] ?? null)),
        'currentTariffId' => parseDashboardInt($input['currentTariffId'] ?? ($input['tariff_current_tariff_id'] ?? null)),
        'targetOsdId' => parseDashboardInt($input['targetOperatorId'] ?? ($input['tariff_target_osd_id'] ?? null)),
        'targetTariffId' => parseDashboardInt($input['targetTariffId'] ?? ($input['tariff_target_tariff_id'] ?? null)),
    ];
    if (array_key_exists('startDate', $input) || array_key_exists('dateStart', $input) || array_key_exists('historyStart', $input)) {
        $settings['dateStart'] = $input['startDate'] ?? ($input['dateStart'] ?? ($input['historyStart'] ?? null));
    }
    if (array_key_exists('annualUsageKwh', $input) || array_key_exists('annualUsage', $input) || array_key_exists('annual_usage_kwh', $input)) {
        $settings['annualUsageKwh'] = $input['annualUsageKwh'] ?? ($input['annualUsage'] ?? ($input['annual_usage_kwh'] ?? null));
    }
    if (array_key_exists('pvSizeKwp', $input) || array_key_exists('pvKwp', $input) || array_key_exists('pv_size_kwp', $input)) {
        $settings['pvSizeKwp'] = $input['pvSizeKwp'] ?? ($input['pvKwp'] ?? ($input['pv_size_kwp'] ?? null));
    }
    if (array_key_exists('locationLabel', $input) || array_key_exists('location_label', $input)) {
        $settings['locationLabel'] = $input['locationLabel'] ?? ($input['location_label'] ?? null);
    }
    if (array_key_exists('lat', $input) || array_key_exists('latitude', $input)) {
        $settings['lat'] = $input['lat'] ?? ($input['latitude'] ?? null);
    }
    if (array_key_exists('lon', $input) || array_key_exists('lng', $input) || array_key_exists('longitude', $input)) {
        $settings['lon'] = $input['lon'] ?? ($input['lng'] ?? ($input['longitude'] ?? null));
    }

    try {
        $result = saveDashboardUserTariffSettings($config, $energyStation, $settings);
        clearDashboardStationCache((string)($config['cache_dir'] ?? ''), $stationKey);
        respondJson(200, [
            'ok' => true,
            'station' => $stationKey,
            'settings' => $result,
        ]);
    } catch (Throwable $e) {
        respondJson(500, [
            'ok' => false,
            'error' => 'Dashboard settings save failed',
            'details' => $e->getMessage(),
        ]);
    }
}

function extractPayloadObject(?array $container, string $key): ?array
{
    if ($container === null) {
        return null;
    }

    $value = $container[$key] ?? null;
    return is_array($value) && isAssoc($value) ? $value : null;
}

function extractUsageDataObject(?array $container): ?array
{
    if ($container === null) {
        return null;
    }

    $usageData = $container['usageData'] ?? null;
    if (is_array($usageData) && isset($usageData['records']) && is_array($usageData['records'])) {
        return $usageData;
    }

    $data = $container['data'] ?? null;
    if (is_array($data) && isset($data['records']) && is_array($data['records'])) {
        return $data;
    }

    if (isset($container['records']) && is_array($container['records'])) {
        return $container;
    }

    return null;
}

function extractRecordDatasetObject(?array $container, string $key): ?array
{
    if ($container === null) {
        return null;
    }

    $value = $container[$key] ?? null;
    if (is_array($value) && isset($value['records']) && is_array($value['records'])) {
        return $value;
    }

    return null;
}

function resolveDashboardDataMode(?array $usageData, ?array $pvData, ?array $storageData, ?array $energy, bool $useRandomUsageData): string
{
    if ($useRandomUsageData) {
        return 'demo';
    }

    $hasMeasuredUsage = isMeasuredUsageDataset($usageData);
    $hasRealPv = boolValue($energy['hasRealPvState'] ?? null)
        || datasetHasAnyNumericField($pvData, ['productionKwh', 'production', 'powerW', 'acPowerW'])
        || datasetHasAnyNumericField($usageData, ['pvGenerationKwh', 'pvPowerW']);
    $hasRealStorage = boolValue($energy['hasRealStorageState'] ?? null)
        || datasetHasAnyNumericField($storageData, ['energyKwh', 'socPercent', 'powerW', 'chargePowerW', 'dischargePowerW'])
        || datasetHasAnyNumericField($usageData, ['storageLevelKwh', 'storageSocPercent', 'storageChargeKwh', 'storageDischargeKwh', 'storageNetKwh']);

    if ($hasMeasuredUsage && $hasRealPv && $hasRealStorage) {
        return 'real';
    }

    if ($hasMeasuredUsage) {
        return 'usage-only';
    }

    return 'demo';
}

function boolValue($value): bool
{
    if (is_bool($value)) {
        return $value;
    }

    if (is_numeric($value)) {
        return (float)$value !== 0.0;
    }

    if (is_string($value)) {
        return in_array(strtolower(trim($value)), ['1', 'true', 'yes', 'tak'], true);
    }

    return false;
}

function isMeasuredUsageDataset(?array $usageData): bool
{
    $source = strtolower(trim((string)($usageData['source'] ?? '')));
    if ($source !== '' && (strpos($source, 'victron') !== false || strpos($source, 'measured') !== false || strpos($source, 'actual') !== false)) {
        return true;
    }

    return datasetHasAnyNumericField($usageData, [
        'gridNetKwh',
        'gridImportKwh',
        'gridExportKwh',
        'storageDischargeKwh',
        'storageChargeKwh',
        'pvGenerationKwh',
        'pvPowerW',
        'storageSocPercent',
        'storageLevelKwh',
    ]);
}

function datasetHasAnyNumericField(?array $dataset, array $fields): bool
{
    $records = $dataset['records'] ?? null;
    if (!is_array($records)) {
        return false;
    }

    foreach ($records as $record) {
        if (!is_array($record)) {
            continue;
        }

        $quarters = $record['quarters'] ?? null;
        if (!is_array($quarters)) {
            continue;
        }

        foreach ($quarters as $quarter) {
            if (!is_array($quarter)) {
                continue;
            }

            foreach ($fields as $field) {
                if (!array_key_exists($field, $quarter)) {
                    continue;
                }

                $value = $quarter[$field];
                if (is_numeric($value) && is_finite((float)$value)) {
                    return true;
                }
            }
        }
    }

    return false;
}

function extractWeatherDataObject(?array $container): ?array
{
    if ($container === null) {
        return null;
    }

    $records = $container['records'] ?? null;
    if (!is_array($records) || $records === []) {
        return null;
    }

    $byDate = [];
    foreach ($records as $record) {
        if (!is_array($record)) {
            continue;
        }

        $readingTime = trim((string)($record['reading_time'] ?? ''));
        if ($readingTime === '' || strlen($readingTime) < 16) {
            continue;
        }

        $dateKey = substr($readingTime, 0, 10);
        $hour = parseDashboardInt(substr($readingTime, 11, 2));
        $minute = parseDashboardInt(substr($readingTime, 14, 2));
        if ($hour === null || $hour < 0 || $hour > 23 || $minute === null || $minute < 0 || $minute > 59) {
            continue;
        }

        $minuteBucket = intdiv($minute, 15) * 15;
        $bucketKey = $dateKey . ' ' . str_pad((string)$hour, 2, '0', STR_PAD_LEFT) . ':' . str_pad((string)$minuteBucket, 2, '0', STR_PAD_LEFT);
        if (!isset($byDate[$dateKey])) {
            $byDate[$dateKey] = [];
        }
        if (!isset($byDate[$dateKey][$bucketKey])) {
            $byDate[$dateKey][$bucketKey] = [
                'date' => $dateKey,
                'hour' => $hour,
                'minute' => $minuteBucket,
                'temperature_sum' => 0.0,
                'temperature_count' => 0,
                'humidity_sum' => 0.0,
                'humidity_count' => 0,
                'wind_avg_sum' => 0.0,
                'wind_avg_count' => 0,
                'uvi_sum' => 0.0,
                'uvi_count' => 0,
                'light_lux_sum' => 0.0,
                'light_lux_count' => 0,
                'wind_max' => null,
                'rain_mm' => null,
                'reading_time' => $readingTime,
                'station_id' => $record['station_id'] ?? null,
                'model' => $record['model'] ?? null,
                'channel' => $record['channel'] ?? null,
                'condition' => $record['condition'] ?? null,
                'label' => $record['label'] ?? null,
            ];
        }

        $bucket = &$byDate[$dateKey][$bucketKey];

        if (isset($record['temperature_C']) && is_numeric($record['temperature_C'])) {
            $bucket['temperature_sum'] += (float)$record['temperature_C'];
            $bucket['temperature_count'] += 1;
        }
        if (isset($record['humidity']) && is_numeric($record['humidity'])) {
            $bucket['humidity_sum'] += (float)$record['humidity'];
            $bucket['humidity_count'] += 1;
        }
        if (isset($record['wind_avg_km_h']) && is_numeric($record['wind_avg_km_h'])) {
            $bucket['wind_avg_sum'] += (float)$record['wind_avg_km_h'];
            $bucket['wind_avg_count'] += 1;
        }
        if (isset($record['uvi']) && is_numeric($record['uvi'])) {
            $bucket['uvi_sum'] += (float)$record['uvi'];
            $bucket['uvi_count'] += 1;
        }
        if (isset($record['light_lux']) && is_numeric($record['light_lux'])) {
            $bucket['light_lux_sum'] += (float)$record['light_lux'];
            $bucket['light_lux_count'] += 1;
        }
        if (isset($record['wind_max_km_h']) && is_numeric($record['wind_max_km_h'])) {
            $windMax = (float)$record['wind_max_km_h'];
            $bucket['wind_max'] = $bucket['wind_max'] === null ? $windMax : max($bucket['wind_max'], $windMax);
        }
        if (isset($record['rain_mm']) && is_numeric($record['rain_mm'])) {
            $rain = (float)$record['rain_mm'];
            $bucket['rain_mm'] = $bucket['rain_mm'] === null ? $rain : max($bucket['rain_mm'], $rain);
        }

        if ($readingTime > (string)$bucket['reading_time']) {
            $bucket['reading_time'] = $readingTime;
        }

        unset($bucket);
    }

    if ($byDate === []) {
        return null;
    }

    ksort($byDate);
    $datasetRecords = [];
    foreach ($byDate as $dateKey => $hourBuckets) {
        ksort($hourBuckets);
        $points = [];
        foreach ($hourBuckets as $bucket) {
            $hour = (int)$bucket['hour'];
            $minuteBucket = (int)$bucket['minute'];
            $point = [
                'reading_time' => $bucket['reading_time'],
                'hour' => $hour,
                'minute' => $minuteBucket,
                'label' => sprintf('%02d:%02d', $hour, $minuteBucket),
                'isNight' => $hour < 5 || $hour >= 20,
            ];

            if ($bucket['temperature_count'] > 0) {
                $point['temperature_C'] = round($bucket['temperature_sum'] / $bucket['temperature_count'], 3);
            }
            if ($bucket['humidity_count'] > 0) {
                $point['humidity'] = round($bucket['humidity_sum'] / $bucket['humidity_count'], 3);
            }
            if ($bucket['wind_avg_count'] > 0) {
                $point['wind_avg_km_h'] = round($bucket['wind_avg_sum'] / $bucket['wind_avg_count'], 3);
            }
            if ($bucket['uvi_count'] > 0) {
                $point['uvi'] = round($bucket['uvi_sum'] / $bucket['uvi_count'], 3);
            }
            if ($bucket['light_lux_count'] > 0) {
                $point['light_lux'] = round($bucket['light_lux_sum'] / $bucket['light_lux_count'], 3);
            }
            if ($bucket['wind_max'] !== null) {
                $point['wind_max_km_h'] = round((float)$bucket['wind_max'], 3);
            }
            if ($bucket['rain_mm'] !== null) {
                $point['rain_mm'] = round((float)$bucket['rain_mm'], 3);
            }
            $point['condition'] = inferWeatherCondition(
                $point['temperature_C'] ?? null,
                $point['rain_mm'] ?? null,
                $point['uvi'] ?? null,
                $point['light_lux'] ?? null,
                $hour
            );

            foreach (['station_id', 'model', 'channel'] as $field) {
                if ($bucket[$field] !== null && $bucket[$field] !== '') {
                    $point[$field] = $bucket[$field];
                }
            }

            $points[] = $point;
        }

        $datasetRecords[] = [
            'date' => $dateKey,
            'hours' => $points,
        ];
    }

    return [
        'latestDate' => array_key_last($byDate),
        'totalDays' => count($datasetRecords),
        'records' => $datasetRecords,
    ];
}

function buildWeatherSourcesPayload(?array $remoteWeather, ?array $remoteWeatherData): ?array
{
    $sources = [];

    if ($remoteWeather !== null || $remoteWeatherData !== null) {
        $sources['remote'] = [];
        if ($remoteWeather !== null) {
            $sources['remote']['weather'] = $remoteWeather;
        }
        if ($remoteWeatherData !== null) {
            $sources['remote']['data'] = $remoteWeatherData;
        }
    }

    return $sources !== [] ? $sources : null;
}

function inferWeatherCondition($temperatureC, $rainMm, $uvi, $lightLux, int $hour): string
{
    $temperature = is_numeric($temperatureC) ? (float)$temperatureC : null;
    $uviValue = is_numeric($uvi) ? (float)$uvi : null;
    $lightValue = is_numeric($lightLux) ? (float)$lightLux : null;

    if ($hour < 5 || $hour >= 20) {
        return 'clear';
    }

    if (($lightValue !== null && $lightValue >= 20000.0) || ($uviValue !== null && $uviValue >= 2.0)) {
        return 'clear';
    }

    if (($lightValue !== null && $lightValue >= 5000.0) || ($uviValue !== null && $uviValue >= 1.0)) {
        return 'partly cloudy';
    }

    if ($lightValue === null && $uviValue === null && $temperature !== null && $temperature >= 18.0) {
        return 'clear';
    }

    if ($lightValue === null && $uviValue === null && $temperature !== null && $temperature >= 10.0) {
        return 'partly cloudy';
    }

    return 'cloudy';
}

function buildRcePayload(array $rows): ?array
{
    $sourceRows = [];
    if (!isAssoc($rows)) {
        $sourceRows = $rows;
    } elseif (isset($rows['data']) && is_array($rows['data'])) {
        $sourceRows = $rows['data'];
    } elseif (isset($rows['records']) && is_array($rows['records'])) {
        $sourceRows = $rows['records'];
    }

    if ($sourceRows === []) {
        return null;
    }

    $hourlyTotals = [];
    $hourlyCounts = [];
    $quarterRates = [];

    foreach ($sourceRows as $row) {
        if (!is_array($row)) {
            continue;
        }

        $hour = parseDashboardInt($row['hour'] ?? null);
        $rawPrice = $row['rce_pln'] ?? null;
        if (!is_numeric($rawPrice) || $hour === null || $hour < 0 || $hour > 23) {
            continue;
        }

        if (!isset($hourlyTotals[$hour])) {
            $hourlyTotals[$hour] = 0.0;
            $hourlyCounts[$hour] = 0;
        }

        $hourlyTotals[$hour] += (float)$rawPrice;
        $hourlyCounts[$hour] += 1;

        $quarter = parseDashboardInt($row['quarter'] ?? null);
        if ($quarter !== null && $quarter >= 0 && $quarter <= 3) {
            // Keep each source interval, including the repeated hour on DST days.
            $quarterRates[] = [
                'hour' => $hour,
                'quarter' => $quarter,
                'pricePln' => round((float)$rawPrice / 1000.0, 6),
                'period' => $row['period'] ?? null,
                'endUtc' => $row['dtime_utc'] ?? null,
            ];
        }
    }

    if ($hourlyTotals === []) {
        return null;
    }

    $hourlyRates = [];
    $currentHour = (int)date('G');
    $currentPrice = null;

    for ($hour = 0; $hour < 24; $hour++) {
        $pricePln = null;
        if (isset($hourlyTotals[$hour], $hourlyCounts[$hour]) && $hourlyCounts[$hour] > 0) {
            $pricePln = ($hourlyTotals[$hour] / $hourlyCounts[$hour]) / 1000.0;
        }

        $row = ['hour' => $hour];
        if ($pricePln !== null) {
            $row['pricePln'] = round($pricePln, 6);
            $row['sampleCount'] = $hourlyCounts[$hour];
        }

        $hourlyRates[] = $row;

        if ($hour === $currentHour && $pricePln !== null) {
            $currentPrice = $pricePln;
        }
    }

    if ($currentPrice === null) {
        for ($hour = min($currentHour, 23); $hour >= 0; $hour--) {
            if (isset($hourlyTotals[$hour], $hourlyCounts[$hour]) && $hourlyCounts[$hour] > 0) {
                $currentPrice = ($hourlyTotals[$hour] / $hourlyCounts[$hour]) / 1000.0;
                break;
            }
        }
    }

    if ($currentPrice === null) {
        foreach ($hourlyRates as $hourlyRate) {
            if (isset($hourlyRate['pricePln'])) {
                $currentPrice = (float)$hourlyRate['pricePln'];
                break;
            }
        }
    }

    $payload = [
        'businessDate' => date('Y-m-d'),
        'currentHour' => $currentHour,
        'hourlyRates' => $hourlyRates,
        'quarterRates' => $quarterRates,
    ];

    if ($currentPrice !== null) {
        $payload['currentPricePln'] = round($currentPrice, 6);
    }

    return $payload;
}

function collectUsageDateKeys(?array $usageData): array
{
    $dates = [];
    if ($usageData !== null) {
        $latestDate = trim((string)($usageData['latestDate'] ?? ''));
        if ($latestDate !== '') {
            $dates[$latestDate] = true;
        }

        $records = $usageData['records'] ?? null;
        if (is_array($records)) {
            foreach ($records as $record) {
                if (!is_array($record)) {
                    continue;
                }
                $dateKey = trim((string)($record['date'] ?? ''));
                if ($dateKey !== '') {
                    $dates[$dateKey] = true;
                }
            }
        }
    }

    if ($dates === []) {
        $dates[date('Y-m-d')] = true;
    }

    $result = array_keys($dates);
    sort($result);
    return $result;
}

function fetchRcePayloadForDate(array $config, string $cacheDir, string $dateKey, ?array $prefetchedRows = null, bool $allowDailyFetch = true): ?array
{
    $trimmedDateKey = trim($dateKey);
    if ($trimmedDateKey === '') {
        return null;
    }

    $cacheFile = '';
    if ($cacheDir !== '') {
        $cacheFile = rtrim($cacheDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR
            . 'rce_' . preg_replace('/[^0-9-]/', '_', $trimmedDateKey) . '.json';
        $cached = readFreshCache($cacheFile, 86400);
        if ($cached !== null && isset($cached['quarterRates']) && is_array($cached['quarterRates'])) {
            return $cached;
        }
    }

    $rows = $prefetchedRows;
    if ($rows === null && $allowDailyFetch) {
        $rows = fetchJson(buildUrl(
            (string)($config['rce_endpoint'] ?? ''),
            ['date' => $trimmedDateKey]
        ));
    }
    if ($rows === null) {
        return null;
    }

    $payload = buildRcePayload($rows);
    if ($payload !== null) {
        $payload['businessDate'] = $trimmedDateKey;
        if ($cacheFile !== '') {
            writeCache($cacheFile, $payload);
        }
    }

    return $payload;
}

function dashboardRceMonthRanges(array $dateKeys): array
{
    $ranges = [];
    foreach ($dateKeys as $dateKey) {
        $trimmedDateKey = trim((string)$dateKey);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $trimmedDateKey)) {
            continue;
        }

        try {
            $date = new DateTimeImmutable($trimmedDateKey);
        } catch (Throwable $e) {
            continue;
        }

        $from = $date->modify('first day of this month')->format('Y-m-d');
        $to = $date->modify('first day of next month')->format('Y-m-d');
        $ranges[$from] = [
            'from' => $from,
            'to' => $to,
        ];
    }

    ksort($ranges);
    return array_values($ranges);
}

function dashboardRceRowDateKey(array $row): string
{
    foreach (['business_date', 'date', 'dtime'] as $key) {
        $value = trim((string)($row[$key] ?? ''));
        if (strlen($value) >= 10) {
            $candidate = substr($value, 0, 10);
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $candidate)) {
                return $candidate;
            }
        }
    }

    return '';
}

function dashboardGroupRceRowsByDate(array $rows): array
{
    $result = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }

        $dateKey = dashboardRceRowDateKey($row);
        if ($dateKey === '') {
            continue;
        }

        if (!isset($result[$dateKey])) {
            $result[$dateKey] = [];
        }
        $result[$dateKey][] = $row;
    }

    return $result;
}

function fetchRceRowsByDateForMonths(array $config, array $dateKeys): array
{
    $rowsByDate = [];
    foreach (dashboardRceMonthRanges($dateKeys) as $range) {
        $rows = fetchJson(buildUrl(
            (string)($config['rce_endpoint'] ?? ''),
            [
                'from' => $range['from'],
                'to' => $range['to'],
            ]
        ));
        foreach (dashboardGroupRceRowsByDate(is_array($rows) ? $rows : []) as $dateKey => $dayRows) {
            $rowsByDate[$dateKey] = $dayRows;
        }
    }

    return $rowsByDate;
}

function buildPriceHistoryPayload(array $config, string $cacheDir, ?array $usageData, ?array $todayRceRows): ?array
{
    $dateKeys = collectUsageDateKeys($usageData);
    $rceByDate = [];
    $rowsByDate = fetchRceRowsByDateForMonths($config, $dateKeys);
    $today = date('Y-m-d');
    if ($todayRceRows !== null) {
        $rowsByDate[$today] = $todayRceRows;
    }

    foreach ($dateKeys as $dateKey) {
        $dayPayload = fetchRcePayloadForDate(
            $config,
            $cacheDir,
            $dateKey,
            $rowsByDate[$dateKey] ?? null,
            false
        );
        if ($dayPayload === null) {
            continue;
        }

        $rceByDate[$dateKey] = $dayPayload;
    }

    if ($rceByDate === []) {
        return null;
    }

    return [
        'rceByDate' => $rceByDate,
    ];
}

function isAssoc(array $value): bool
{
    if ($value === []) {
        return true;
    }

    return array_keys($value) !== range(0, count($value) - 1);
}

function parseDashboardInt($value): ?int
{
    if (is_int($value)) {
        return $value;
    }

    if (is_float($value)) {
        return floor($value) === $value ? (int)$value : null;
    }

    if (!is_string($value)) {
        return null;
    }

    $trimmed = trim($value);
    if ($trimmed === '' || !preg_match('/^-?\d+$/', $trimmed)) {
        return null;
    }

    return (int)$trimmed;
}

function normalizeDashboardCoordinate($value, float $min, float $max, bool $strict): ?float
{
    if ($value === null || is_array($value) || is_object($value)) {
        return null;
    }

    if (is_int($value) || is_float($value)) {
        $numeric = (float)$value;
    } else {
        $trimmed = trim(str_replace(',', '.', (string)$value));
        if ($trimmed === '') {
            return null;
        }
        if (!is_numeric($trimmed)) {
            if ($strict) {
                throw new InvalidArgumentException('Niepoprawna wspolrzedna.');
            }
            return null;
        }
        $numeric = (float)$trimmed;
    }

    if (!is_finite($numeric) || $numeric < $min || $numeric > $max) {
        if ($strict) {
            throw new InvalidArgumentException('Wspolrzedna poza zakresem.');
        }
        return null;
    }

    return round($numeric, 6);
}

function normalizeDashboardAnnualUsageKwh($value, bool $strict): ?float
{
    if ($value === null || is_array($value) || is_object($value)) {
        return null;
    }

    if (is_int($value) || is_float($value)) {
        $numeric = (float)$value;
    } else {
        $trimmed = trim(str_replace(',', '.', (string)$value));
        if ($trimmed === '') {
            return null;
        }
        if (!is_numeric($trimmed)) {
            if ($strict) {
                throw new InvalidArgumentException('Niepoprawne zużycie roczne.');
            }
            return null;
        }
        $numeric = (float)$trimmed;
    }

    if (!is_finite($numeric) || $numeric < 0) {
        if ($strict) {
            throw new InvalidArgumentException('Zużycie roczne poza zakresem.');
        }
        return null;
    }

    return round($numeric, 3);
}

function normalizeDashboardPvSizeKwp($value, bool $strict): ?float
{
    if ($value === null || is_array($value) || is_object($value)) {
        return null;
    }

    if (is_int($value) || is_float($value)) {
        $numeric = (float)$value;
    } else {
        $trimmed = trim(str_replace(',', '.', (string)$value));
        if ($trimmed === '') {
            return null;
        }
        if (!is_numeric($trimmed)) {
            if ($strict) {
                throw new InvalidArgumentException('Niepoprawna moc PV.');
            }
            return null;
        }
        $numeric = (float)$trimmed;
    }

    if (!is_finite($numeric) || $numeric < 0) {
        if ($strict) {
            throw new InvalidArgumentException('Moc PV poza zakresem.');
        }
        return null;
    }

    return round($numeric, 3);
}

function normalizeDashboardLocationLabel($value): ?string
{
    if ($value === null || is_array($value) || is_object($value)) {
        return null;
    }

    $label = trim((string)$value);
    if ($label === '') {
        return null;
    }

    if (function_exists('mb_substr')) {
        return mb_substr($label, 0, 255, 'UTF-8');
    }

    return substr($label, 0, 255);
}

function respondJson(int $statusCode, array $payload): void
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function respondJsonBody(int $statusCode, string $body): void
{
    http_response_code($statusCode);
    $output = @fopen('php://output', 'wb');
    if ($output) {
        fwrite($output, $body);
        fclose($output);
    } else {
        echo $body;
    }
    exit;
}
