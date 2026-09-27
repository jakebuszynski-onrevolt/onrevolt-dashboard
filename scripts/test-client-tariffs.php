<?php
declare(strict_types=1);
require __DIR__ . '/../integrations/re/pricing/CatalogHistory.php';
use OnRevolt\Pricing\ClientTariffs as T;
use OnRevolt\Pricing\CatalogHistory as C;

$tests = 0;
function check(bool $ok, string $message): void { global $tests; $tests++; if (!$ok) throw new RuntimeException($message); }
function rejects(callable $fn, string $message): void { try { $fn(); } catch (Throwable $e) { check(true, $message); return; } check(false, $message); }
function period(?string $from = null, ?string $until = null, int $tariff = 1): array {
    return T::period(['validFrom' => $from, 'validUntil' => $until, 'osdId' => 1, 'tariffId' => $tariff]);
}
$p = period();
$history = T::changeFrom([$p], period('2026-05-15', null, 27));
check($history[0]['validUntil'] === '2026-05-15' && $history[1]['tariffId'] === 27, 'Change splits the previous interval');
check(T::changeFrom([$p], period('2026-05-15', '2026-06-01', 27))[1]['validUntil'] === '2026-06-01', 'Explicit end of a new tariff is not replaced by an open end');
check(T::changeFrom($history, period('2026-03-01'))[1]['validUntil'] === '2026-05-15', 'Insertion respects the next scheduled period');
$correction = $history[1]; $correction['validFrom'] = '2026-05-16';
check(T::correct($history, $correction)[0]['validUntil'] === '2026-05-16', 'Boundary correction also closes the previous interval');
rejects(fn() => T::changeFrom($history, period('2026-05-15')), 'Duplicate change date rejected');
rejects(fn() => T::validatePeriods([$p, period('2026-05-01')]), 'Overlap rejected');
rejects(fn() => period('2026-02-30'), 'Invalid calendar date rejected');
rejects(fn() => period('2026-02-01', '2026-02-01'), 'Empty interval rejected');
check(count(T::validatePeriods([period(null, '2026-01-01'), period('2026-02-01')])) === 2, 'Gap retained for explicit incomplete status');
$schedule = ['zone_model' => 'daynight', 'monthly' => array_fill(1, 12, array_fill(0, 24, 1)), 'cheap_saturday' => true];
check(T::schedule($schedule)['cheap_saturday'], 'Weekend override preserved');
$bad = $schedule; $bad['monthly'][1][0] = 3;
rejects(fn() => T::schedule($bad), 'Unknown zone rejected');
rejects(fn() => T::schedule(['zone_model'=>'all', 'monthly'=>[]]), 'Incomplete hours rejected');
$payload = ['osd_id' => 1, 'tariff_id' => 1, 'zone_model' => 'daynight', 'fixed' => [], 'variable' => [['label'=>'Energia czynna', 'window_code'=>'all', 'price'=>1.23]],
    'pricing' => ['tariffStorage' => ['priceBasis'=>'net', 'fixed'=>[], 'variable'=>[['component_key'=>'energy', 'label'=>'Energia czynna', 'net'=>1.0, 'vatRate'=>0.23]]]]];
$custom = $p; $custom['overrides'] = ['energy'=>['net'=>0.5, 'vatRate'=>0.23]];
$result = T::apply($payload, $custom);
check(abs($result['variable'][0]['price'] - 0.615) < 1e-10, 'Gross override is computed once');
check($payload['variable'][0]['price'] === 1.23, 'Catalog payload unchanged');
$custom['overrides']['deleted'] = ['net'=>1,'vatRate'=>0.23];
rejects(fn() => T::apply($payload, $custom), 'Deleted catalog component is a conflict');
check(C::prepareKeys(['fixed'=>[['label'=>'A','component_key'=>'fixed-a']]], false, 'fixed', [['component_key'=>'fixed-a']]) === ['fixed-a'], 'Stable key survives edits');
rejects(fn() => C::prepareKeys(['fixed'=>[['label'=>'A','component_key'=>'wrong']]], false, 'fixed', []), 'Foreign component rejected');

if (in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    class TestDb extends PDO {
        public function prepare(string $query, array $options = []): PDOStatement|false {
            return parent::prepare(str_replace([' FOR UPDATE', 'CURRENT_TIMESTAMP(3)'], ['', 'CURRENT_TIMESTAMP'], $query), $options);
        }
    }
    $db = new TestDb('sqlite::memory:', options: [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
    foreach ([
      'CREATE TABLE pricing_client_profile (id TEXT PRIMARY KEY,project_id TEXT UNIQUE,client_id TEXT,ppe TEXT,station TEXT UNIQUE,revision INTEGER,updated_at TEXT)',
      'CREATE TABLE pricing_client_period (id TEXT PRIMARY KEY,profile_id TEXT,valid_from TEXT,valid_until TEXT,osd_id INTEGER,tariff_id INTEGER,source TEXT,overrides_json TEXT,schedule_json TEXT,note TEXT)',
      'CREATE TABLE pricing_client_change (id INTEGER PRIMARY KEY,profile_id TEXT,revision INTEGER,actor_id TEXT,action TEXT,before_json TEXT,after_json TEXT)',
      'CREATE TABLE pricing_client_evidence (id TEXT PRIMARY KEY,profile_id TEXT,valid_from TEXT,valid_until TEXT,tariff_code TEXT,state TEXT,evidence_json TEXT)',
      'CREATE TABLE pricing_catalog_revision (id INTEGER PRIMARY KEY,tariff_id INTEGER,osd_id INTEGER,valid_from TEXT,valid_until TEXT,payload_json TEXT,fingerprint TEXT,source TEXT,superseded INTEGER DEFAULT 0)',
      'CREATE TABLE tariff (id INTEGER PRIMARY KEY,osd_id INTEGER,code TEXT)', "INSERT INTO tariff VALUES (1,1,'G11'),(27,1,'G13active')",
      'CREATE TABLE osd (id INTEGER PRIMARY KEY,slug TEXT)', "INSERT INTO osd VALUES (1,'enea')",
      'CREATE TABLE EnergyMeter_users (station TEXT PRIMARY KEY)', "INSERT INTO EnergyMeter_users VALUES ('35')",
    ] as $sql) $db->exec($sql);
    $repo = new T($db);
    $scope = ['projectId'=>'project','clientId'=>'client','ppe'=>'123','station'=>null];
    $preview = $repo->save($scope, 0, $history, 'staff', 'MANUAL', true);
    check($repo->profile('project') === null, 'Preview does not persist');
    $saved = $repo->save($scope, 0, $history, 'staff', 'MANUAL');
    check($saved['revision'] === 1 && $saved['station'] === null, 'Profile works without a station');
    rejects(fn() => $repo->save([...$scope, 'ppe'=>null], 1, $history, 'staff', 'MANUAL'), 'A known PPE cannot silently be cleared from history');
    rejects(fn() => $repo->save([...$scope, 'ppe'=>'OTHER'], 1, $history, 'staff', 'MANUAL'), 'History cannot migrate to a different PPE');
    rejects(fn() => $repo->save($scope, 0, $history, 'staff', 'MANUAL'), 'Optimistic concurrency rejects stale write');
    $scope['station'] = '35';
    $saved = $repo->save($scope, 1, $history, 'staff', 'BIND');
    check($repo->byStation('35')['id'] === $saved['id'], 'Binding uses the same profile');
    rejects(fn() => $repo->save(['projectId'=>'other','clientId'=>'client','ppe'=>null,'station'=>'35'], 0, [], 'staff', 'BIND'), 'Station cannot silently migrate to another project');
    check((int)$db->query('SELECT COUNT(*) FROM pricing_client_change')->fetchColumn() === 2, 'Audit matches committed revisions');
    $db->beginTransaction(); C::record($db, $payload, '2026-01-01', 'fixture'); $db->commit();
    check($repo->history($saved,'2026-01-01','2026-01-03')['issues'] === [], 'Covered dates resolve');
    $packed = T::packHistory($repo->history($saved,'2026-01-01','2026-01-03'));
    check(count($packed['tariffs']) === 1 && $packed['byDate']['2026-01-01'] === $packed['byDate']['2026-01-02'], 'Repeated dates transmit one shared tariff snapshot');
    check(count($repo->history($saved,'2025-12-31','2026-01-01')['issues']) === 1, 'Historical missing rates are not replaced with current rates');
    $changed = $payload; $changed['variable'][0]['price'] = 2.46; $changed['pricing']['tariffStorage']['variable'][0]['net'] = 2;
    $db->beginTransaction(); C::record($db, $changed, '2026-02-01', 'fixture'); $db->commit();
    check($repo->resolve($saved,'2026-01-31')['variable'][0]['price'] === 1.23, 'Older catalog price preserved');
    check($repo->resolve($saved,'2026-02-01')['variable'][0]['price'] === 2.46, 'Catalog price changes at date boundary');
    $db->beginTransaction(); C::record($db, $payload, '2026-02-01', 'correction'); $db->commit();
    check((int)$db->query('SELECT COUNT(*) FROM pricing_catalog_revision')->fetchColumn() === 3, 'Catalog correction retains prior snapshot');
    check($repo->resolve($saved,'2026-02-01')['variable'][0]['price'] === 1.23, 'Correction resolves unambiguously');
    check(!$repo->completeness($saved, $saved['periods'][0], '2025-12-01')['ok'], 'Missing early prices do not show a complete period');
    check($repo->completeness($saved, $saved['periods'][0], '2026-01-01')['ok'], 'All dated catalog revisions within a period are checked');
    $scope2 = ['projectId'=>'new','clientId'=>'client','ppe'=>'456','station'=>null];
    $evidence = ['validFrom'=>'2026-01-01','validUntil'=>'2026-02-01','tariffCode'=>'G11','certain'=>true,'source'=>'ENEA_CONSUMPTION_RANGE'];
    check($repo->importEvidence($scope2, $evidence, 'staff')['state'] === 'CONFIRMED', 'Reliable ENEA range imported');
    check($repo->importEvidence($scope2, $evidence, 'staff')['duplicate'], 'ENEA repeat is idempotent');
    $en = $repo->profile('new');
    $en['periods'][0]['overrides'] = ['energy'=>['net'=>0.2,'vatRate'=>0.23]];
    $repo->save($scope2, $en['revision'], $en['periods'], 'staff', 'MANUAL');
    $repo->importEvidence($scope2, $evidence, 'staff');
    check($repo->profile('new')['periods'][0]['overrides']['energy']['net'] === 0.2, 'ENEA does not erase manual prices');
    $conflict = $evidence; $conflict['tariffCode'] = 'G13active';
    check($repo->importEvidence($scope2, $conflict, 'staff')['state'] === 'REVIEW', 'Conflicting ENEA code requires review');
    rejects(fn() => $repo->resolve($repo->profile('new'), '2026-01-15'), 'Unresolved evidence blocks price calculation');
    $en = $repo->profile('new');
    $repo->save($scope2, $en['revision'], $en['periods'], 'staff', 'MANUAL', false, $repo->evidence($en['id'])[0]['id']);
    check($repo->resolve($repo->profile('new'), '2026-01-15')['variable'][0]['price'] === 0.246, 'Confirmation retains existing manual price');
    $removed = $payload; $removed['variable'] = []; $removed['pricing']['tariffStorage']['variable'] = [];
    $db->beginTransaction();
    rejects(fn() => C::record($db, $removed, '2026-01-15', 'removal'), 'Catalog component with a customer override cannot be removed');
    $db->rollBack();
    $ambiguous = $evidence; $ambiguous['validFrom'] = '2026-02-01'; $ambiguous['validUntil'] = '2026-03-01'; $ambiguous['certain'] = false;
    check($repo->importEvidence($scope2, $ambiguous, 'staff')['state'] === 'REVIEW', 'Uncertain boundaries are not inferred');
    check(count($repo->profile('new')['periods']) === 1, 'Ambiguous import leaves periods intact');
} else { throw new RuntimeException('Testy repozytorium wymagają rozszerzenia PDO SQLite.'); }
echo "OK: $tests assertions\n";
