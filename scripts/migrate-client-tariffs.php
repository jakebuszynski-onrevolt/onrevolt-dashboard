<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$root = realpath($argv[1] ?? '');
if (!$root || !is_file($root . '/re/setup_func.php') || !in_array($argv[2] ?? '', ['--check', '--apply'], true)) {
    fwrite(STDERR, "Użycie: migrate-client-tariffs.php RE_ROOT --check|--apply\n"); exit(1);
}
$_GET = $_POST = [];
$_SERVER['REQUEST_METHOD'] = 'GET';
require $root . '/re/setup_func.php';
require_once $root . '/re/pricing/CatalogHistory.php';
require_once $root . '/re/pricing/PriceModel.php';
$db = get_pdo();
$tariffs = $db->query('SELECT id,price_basis,prices_valid_from FROM tariff ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
foreach ($tariffs as $tariff) if ($tariff['price_basis'] === 'net') \OnRevolt\Pricing\ClientTariffs::date($tariff['prices_valid_from']);
$versions = $db->query('SELECT source_json,canonical_json FROM pricing_tariff_version')->fetchAll(PDO::FETCH_ASSOC);
foreach ($versions as $version) \OnRevolt\Pricing\PriceModel::project(
    json_decode($version['source_json'], true, 512, JSON_THROW_ON_ERROR),
    json_decode($version['canonical_json'], true, 512, JSON_THROW_ON_ERROR), 'gross');
if ($argv[2] === '--check') {
    echo json_encode(['ok'=>true, 'tariffs'=>count($tariffs), 'auditedVersions'=>count($versions), 'writes'=>false], JSON_UNESCAPED_UNICODE), "\n";
    exit;
}
foreach (explode(';', file_get_contents(__DIR__ . '/../integrations/re/pricing/client-tariffs.sql')) as $sql) {
    if (trim($sql) !== '') $db->exec($sql);
}
if (!$db->query("SHOW COLUMNS FROM pricing_client_profile LIKE 'context_json'")->fetch()) {
    $db->exec('ALTER TABLE pricing_client_profile ADD context_json LONGTEXT NULL AFTER station');
}
foreach (['tariff_fixed_cost','tariff_variable_cost'] as $table) {
    if (!$db->query("SHOW COLUMNS FROM $table LIKE 'component_key'")->fetch()) $db->exec("ALTER TABLE $table ADD component_key CHAR(36) NULL");
    $db->exec("UPDATE $table SET component_key=UUID() WHERE component_key IS NULL");
}
$ids = $db->query("SELECT id, prices_valid_from FROM tariff WHERE price_basis='net' ORDER BY id")->fetchAll(PDO::FETCH_ASSOC);
$count = 0;
foreach ($ids as $tariff) {
    $q = $db->prepare('SELECT id FROM pricing_catalog_revision WHERE tariff_id=? LIMIT 1');
    $q->execute([$tariff['id']]);
    if ($q->fetchColumn()) continue;
    $db->beginTransaction();
    try {
        $old = $db->prepare('SELECT id,valid_from,valid_until,source_json,canonical_json FROM pricing_tariff_version WHERE tariff_id=? AND valid_from<? ORDER BY valid_from,id');
        $old->execute([$tariff['id'], $tariff['prices_valid_from']]);
        foreach ($old->fetchAll(PDO::FETCH_ASSOC) as $version) {
            $source = json_decode($version['source_json'], true, 512, JSON_THROW_ON_ERROR);
            $canonical = json_decode($version['canonical_json'], true, 512, JSON_THROW_ON_ERROR);
            $payload = \OnRevolt\Pricing\PriceModel::project($source, $canonical, 'gross');
            $storage = ['priceBasis'=>'net','validFrom'=>$version['valid_from'],'fixed'=>[],'variable'=>[]];
            foreach (['fixed'=>'amount','variable'=>'price'] as $group=>$field) {
                $q = $db->prepare('SELECT * FROM tariff_' . $group . '_cost WHERE tariff_id=?');
                $q->execute([$tariff['id']]);
                $currentRows = $q->fetchAll(PDO::FETCH_ASSOC);
                foreach ($source[$group] ?? [] as $index=>$row) {
                    $identity = static fn($r) => array_map(static fn($field) => (string)($r[$field] ?? ''), ['label','window_code','amount_mode','billing_cycle_months','annual_usage_min_kwh','annual_usage_max_kwh']);
                    $matching = array_values(array_filter($currentRows, static fn($r) => $identity($r) === $identity($row)));
                    $sourceMatches = array_filter($source[$group], static fn($r) => $identity($r) === $identity($row));
                    $key = count($matching) === 1 && count($sourceMatches) === 1 ? $matching[0]['component_key'] : null;
                    if ($key === null) {
                        // An immutable audited snapshot gets its own key when identity cannot be proven.
                        $hex = hash('sha256', 'audit:' . $version['id'] . ':' . $group . ':' . $index);
                        $key = substr($hex,0,8).'-'.substr($hex,8,4).'-'.substr($hex,12,4).'-'.substr($hex,16,4).'-'.substr($hex,20,12);
                    }
                    $price = $canonical['components'][$group . '.' . $index . '.' . $field];
                    $storage[$group][] = array_merge($row, ['component_key'=>$key,'net'=>$price['net'],'gross'=>$price['gross'],'vatRate'=>$price['vatRate'],'priceBasis'=>'net']);
                }
            }
            $storage['vatRate'] = $canonical['components']['buy_base']['vatRate'];
            $storage['buyBase'] = $canonical['components']['buy_base'];
            $storage['sellFixedPrice'] = $canonical['components']['sell_fixed_price'];
            $storage['market'] = ['verified'=>true, 'source'=>'verified-audit:' . $version['id'],
                'margin'=>$canonical['components']['osd_add_rdn'], 'excise'=>$canonical['components']['osd_add_akcyza']];
            $payload['pricing']['tariffStorage'] = $storage;
            \OnRevolt\Pricing\CatalogHistory::record($db, $payload, $version['valid_from'], 'verified-audit:' . $version['id']);
            if ($version['valid_until'] !== null) {
                $db->prepare('UPDATE pricing_catalog_revision SET valid_until=? WHERE tariff_id=? AND valid_from=? AND superseded=0')->execute([$version['valid_until'],$tariff['id'],$version['valid_from']]);
            }
        }
        \OnRevolt\Pricing\CatalogHistory::capture($db, (int)$tariff['id'], $tariff['prices_valid_from'], 'net-storage-migration');
        $db->commit(); $count++;
    } catch (Throwable $e) { $db->rollBack(); throw $e; }
}
echo json_encode(['ok' => true, 'catalogSnapshots' => $count, 'measurementTablesChanged' => false], JSON_UNESCAPED_UNICODE), "\n";
