<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

try {
    $root = realpath($argv[1] ?? '');
    if (!$root || !is_file($root . '/re/setup_func.php')) throw new RuntimeException('Nieprawidłowy katalog RE.');
    $_GET = $_POST = [];
    $_SERVER['REQUEST_METHOD'] = 'GET';
    require $root . '/re/setup_func.php';
    require_once $root . '/re/pricing/ClientTariffs.php';
    $input = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
    $db = get_pdo();
    $repo = new \OnRevolt\Pricing\ClientTariffs($db);
    $scope = $input['scope'] ?? [];
    $action = $input['action'] ?? 'get';
    foreach (['clientId','projectId'] as $key) if (!preg_match('/^[a-zA-Z0-9_-]{1,64}$/D', (string)($scope[$key] ?? ''))) throw new InvalidArgumentException('Nieprawidłowy projekt lub klient.');
    $profile = $repo->profile($scope['projectId']);
    if ($profile && $profile['client_id'] !== $scope['clientId']) throw new RuntimeException('Profil należy do innego klienta.', 409);
    if ($profile && $profile['ppe'] && $profile['ppe'] !== ($scope['ppe'] ?? null)) throw new RuntimeException('PPE projektu różni się od PPE profilu taryfowego. Wyjaśnij powiązanie przed użyciem historii.', 409);
    if ($action === 'get') {
        $data = ['profile' => $profile, 'assignedStation' => $scope['station'] ?? null, 'evidence' => $profile ? $repo->evidence($profile['id']) : [], 'resolved' => []];
        $data['catalog'] = $db->query('SELECT id,name,slug FROM osd ORDER BY name')->fetchAll(PDO::FETCH_ASSOC);
        $tariffs = $db->query('SELECT id,osd_id,code,name FROM tariff ORDER BY code')->fetchAll(PDO::FETCH_ASSOC);
        foreach ($data['catalog'] as &$osd) {
            $osd['id'] = (int)$osd['id'];
            $osd['tariffs'] = array_values(array_map(function ($t) { $t['id'] = (int)$t['id']; return $t; }, array_filter($tariffs, fn($t) => (int)$t['osd_id'] === $osd['id'])));
        }
        unset($osd);
        foreach ($profile['periods'] ?? [] as $period) {
            $data['resolved'][$period['id']] = $repo->completeness($profile, $period, $scope['dataFrom'] ?? null);
        }
    } elseif ($action === 'catalog') {
        $data = $repo->catalog((int)$input['osdId'], (int)$input['tariffId'], \OnRevolt\Pricing\ClientTariffs::date($input['date']));
        if (!$data) throw new RuntimeException('Wymaga uzupełnienia: brak cen katalogowych dla tej daty.', 422);
    } elseif ($action === 'history') {
        if ($profile && ($profile['station'] ?? null) !== ($scope['station'] ?? null)) throw new RuntimeException('Powiązanie taryf ze stacją zmieniło się. Użyj „Połącz z EMS” w zakładce Taryfy.', 409);
        $data = $profile && ($profile['periods'] || $repo->evidence($profile['id'])) ? $repo->history($profile, $input['from'], $input['until']) : null;
        if ($data) $data = \OnRevolt\Pricing\ClientTariffs::packHistory($data);
    } elseif ($action === 'import') {
        $data = $repo->importEvidence($scope, $input['evidence'], (string)$input['actorId']);
    } elseif ($action === 'sync-context') {
        $data = $repo->syncContext($scope, (string)$input['actorId']);
    } elseif (in_array($action, ['save','preview','bind'], true)) {
        $periods = $input['periods'] ?? $profile['periods'] ?? [];
        if (isset($input['period'])) $input['period']['source'] = 'MANUAL';
        if (($input['operation'] ?? '') === 'change') $periods = \OnRevolt\Pricing\ClientTariffs::changeFrom($profile['periods'] ?? [], $input['period']);
        if (($input['operation'] ?? '') === 'correct') $periods = \OnRevolt\Pricing\ClientTariffs::correct($profile['periods'] ?? [], $input['period']);
        $data = $repo->save($scope, (int)$input['revision'], $periods, (string)$input['actorId'], $action === 'bind' ? 'BIND' : 'MANUAL', $action === 'preview', $input['evidenceId'] ?? null);
    } else {
        throw new InvalidArgumentException('Nieznana operacja taryf.');
    }
    echo json_encode(['ok' => true, 'data' => $data], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    echo json_encode(['ok' => false, 'error' => $e->getMessage(), 'status' => in_array($e->getCode(), [409,422], true) ? $e->getCode() : 400], JSON_UNESCAPED_UNICODE);
    exit(0);
}
