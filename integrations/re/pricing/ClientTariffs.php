<?php
declare(strict_types=1);

namespace OnRevolt\Pricing;

use DateTimeImmutable;
use DateTimeZone;
use InvalidArgumentException;
use PDO;
use RuntimeException;
use Throwable;

/** Shared by the authenticated CRM CLI bridge and the RE dashboard. No device writes. */
final class ClientTariffs
{
    public function __construct(private PDO $pdo) {}

    public static function json(mixed $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    }

    public static function uuid(): string
    {
        $hex = bin2hex(random_bytes(16));
        return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
    }

    public static function date(mixed $date): string
    {
        if (!is_string($date)) throw new InvalidArgumentException('Nieprawidłowa data.');
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date, new DateTimeZone('Europe/Warsaw'));
        if (!$parsed || $parsed->format('Y-m-d') !== $date) throw new InvalidArgumentException('Nieprawidłowa data: ' . $date);
        return $date;
    }

    public static function today(): string
    {
        return (new DateTimeImmutable('now', new DateTimeZone('Europe/Warsaw')))->format('Y-m-d');
    }

    public static function context(array $scope, array $current = []): array
    {
        $result = $current;
        foreach (['connectionPowerKw', 'annualUsageKwh'] as $key) {
            if (!array_key_exists($key, $scope)) continue;
            $value = $scope[$key];
            if ($value === null || $value === '') { unset($result[$key]); continue; }
            if (!is_numeric($value) || !is_finite((float)$value) || (float)$value <= 0) {
                throw new InvalidArgumentException($key === 'connectionPowerKw'
                    ? 'Moc przyłączeniowa musi być dodatnią liczbą.'
                    : 'Roczne zużycie musi być dodatnią liczbą.');
            }
            $result[$key] = (float)$value;
        }
        if (array_key_exists('billingCycleMonths', $scope)) {
            $value = $scope['billingCycleMonths'];
            if ($value === null || $value === '') unset($result['billingCycleMonths']);
            elseif (!is_int($value) || $value <= 0 || $value > 24) throw new InvalidArgumentException('Nieprawidłowy cykl rozliczeniowy.');
            else $result['billingCycleMonths'] = $value;
        }
        return $result;
    }

    public static function schedule(mixed $input): ?array
    {
        if ($input === null) return null;
        if (!is_array($input)) throw new InvalidArgumentException('Nieprawidłowy harmonogram.');
        $model = $input['zone_model'] ?? '';
        $max = ['all' => 1, 'daynight' => 2, 'peakoffpeak' => 2, 'highmidlow' => 3][$model] ?? null;
        if (!$max) throw new InvalidArgumentException('Nieprawidłowy model stref.');
        $monthly = [];
        for ($month = 1; $month <= 12; $month++) {
            $hours = $input['monthly'][$month] ?? null;
            if (!is_array($hours) || !array_is_list($hours) || count($hours) !== 24) throw new InvalidArgumentException('Każdy miesiąc musi mieć dokładnie 24 godziny stref.');
            foreach ($hours as $value) if (!is_int($value) || $value < 1 || $value > $max) throw new InvalidArgumentException('Każda godzina musi należeć do jednej strefy.');
            $monthly[$month] = $hours;
        }
        return ['zone_model' => $model, 'use_monthly' => true, 'monthly' => $monthly,
            'cheap_saturday' => ($input['cheap_saturday'] ?? false) === true,
            'cheap_sunday' => ($input['cheap_sunday'] ?? false) === true];
    }

    public static function period(array $input): array
    {
        $from = isset($input['validFrom']) ? self::date($input['validFrom']) : null;
        $until = isset($input['validUntil']) ? self::date($input['validUntil']) : null;
        if ($from !== null && $until !== null && $until <= $from) throw new InvalidArgumentException('Koniec okresu musi wypadać po jego początku.');
        foreach (['osdId', 'tariffId'] as $field) if (!is_int($input[$field] ?? null) || $input[$field] <= 0) throw new InvalidArgumentException('Wybierz operatora i taryfę.');
        $overrides = $input['overrides'] ?? [];
        if (!is_array($overrides) || count($overrides) > 200) throw new InvalidArgumentException('Nieprawidłowe indywidualne stawki.');
        foreach ($overrides as $key => &$price) {
            if (!preg_match('/^[a-zA-Z0-9:_-]{1,100}$/D', (string)$key) || !is_array($price)) throw new InvalidArgumentException('Nieprawidłowy identyfikator opłaty.');
            foreach (['net', 'vatRate'] as $field) if (!isset($price[$field]) || !is_numeric($price[$field]) || !is_finite((float)$price[$field]) || (float)$price[$field] < 0) throw new InvalidArgumentException('Nieprawidłowa stawka opłaty.');
            if ((float)$price['vatRate'] > 1) throw new InvalidArgumentException('Nieprawidłowy VAT.');
            $price = ['net' => (float)$price['net'], 'vatRate' => (float)$price['vatRate']];
        }
        unset($price);
        $id = $input['id'] ?? self::uuid();
        if (!is_string($id) || !preg_match('/^[a-f0-9-]{36}$/D', $id)) throw new InvalidArgumentException('Nieprawidłowy identyfikator okresu.');
        preg_match('/^.{0,1000}/us', trim((string)($input['note'] ?? '')), $note);
        return ['id' => $id, 'validFrom' => $from, 'validUntil' => $until, 'osdId' => $input['osdId'],
            'tariffId' => $input['tariffId'], 'overrides' => $overrides, 'schedule' => self::schedule($input['schedule'] ?? null),
            'source' => ($input['source'] ?? 'MANUAL') === 'ENEA' ? 'ENEA' : 'MANUAL',
            'note' => $note[0] ?? ''];
    }

    public static function validatePeriods(array $periods): array
    {
        if (count($periods) > 500) throw new InvalidArgumentException('Za dużo okresów taryfowych.');
        $periods = array_map(self::period(...), $periods);
        usort($periods, fn($a, $b) => ($a['validFrom'] ?? '') <=> ($b['validFrom'] ?? ''));
        $ids = [];
        foreach ($periods as $i => $period) {
            if (isset($ids[$period['id']])) throw new InvalidArgumentException('Powtórzony identyfikator okresu.');
            $ids[$period['id']] = true;
            if ($i > 0 && ($periods[$i-1]['validUntil'] === null || $period['validFrom'] === null
                || $periods[$i-1]['validUntil'] > $period['validFrom'])) throw new InvalidArgumentException('Okresy taryf nie mogą się nakładać.');
        }
        return $periods;
    }

    public static function changeFrom(array $periods, array $input): array
    {
        $new = self::period($input);
        $from = $new['validFrom'];
        if ($from === null && $periods) throw new InvalidArgumentException('Podaj datę zmiany taryfy.');
        foreach ($periods as &$period) {
            if ($period['validFrom'] === $from) throw new InvalidArgumentException('Taryfa od tej daty już istnieje. Użyj korekty.');
            if (($period['validFrom'] === null || $period['validFrom'] < $from)
                && ($period['validUntil'] === null || $period['validUntil'] > $from)) {
                if ($period['validUntil'] !== null && ($new['validUntil'] === null || $new['validUntil'] > $period['validUntil'])) $new['validUntil'] = $period['validUntil'];
                $period['validUntil'] = $from;
            } elseif ($period['validFrom'] > $from && ($new['validUntil'] === null || $new['validUntil'] > $period['validFrom'])) {
                $new['validUntil'] = $period['validFrom'];
            }
        }
        unset($period);
        $periods[] = $new;
        return self::validatePeriods($periods);
    }

    public static function correct(array $periods, array $input): array
    {
        $replacement = self::period($input);
        $index = array_search($replacement['id'], array_column($periods, 'id'), true);
        if ($index === false) throw new InvalidArgumentException('Nie znaleziono okresu do korekty.');
        $old = $periods[$index];
        // Move a shared boundary atomically; existing gaps are never silently filled.
        if ($index > 0 && $periods[$index - 1]['validUntil'] === $old['validFrom']) $periods[$index - 1]['validUntil'] = $replacement['validFrom'];
        if (isset($periods[$index + 1]) && $periods[$index + 1]['validFrom'] === $old['validUntil']) $periods[$index + 1]['validFrom'] = $replacement['validUntil'];
        $periods[$index] = $replacement;
        return self::validatePeriods($periods);
    }

    public static function apply(array $tariff, array $period): array
    {
        $storage = $tariff['pricing']['tariffStorage'] ?? null;
        if (!is_array($storage) || ($storage['priceBasis'] ?? '') !== 'net') throw new RuntimeException('Brak zweryfikowanych cen netto dla okresu.');
        $unused = $period['overrides'];
        foreach (['fixed' => 'amount', 'variable' => 'price'] as $group => $field) {
            foreach ($storage[$group] as $index => &$row) {
                $key = $row['component_key'] ?? '';
                if (!$key) throw new RuntimeException('Brak trwałego identyfikatora pozycji taryfy.');
                if (array_key_exists($key, $unused)) {
                    $row['net'] = $unused[$key]['net'];
                    $row['vatRate'] = $unused[$key]['vatRate'];
                    unset($unused[$key]);
                }
                $row['gross'] = $row['net'] * (1 + $row['vatRate']);
                $row[$field] = $row['net'];
                $row['vat_rate'] = $row['vatRate'];
                $tariff[$group][$index] = array_merge($tariff[$group][$index], ['component_key' => $key, $field => $row['gross']]);
            }
            unset($row);
        }
        if ($unused) throw new RuntimeException('W katalogu brakuje pozycji z indywidualną korektą: ' . implode(', ', array_keys($unused)));
        $tariff['pricing']['tariffStorage'] = $storage;
        if ($period['schedule'] !== null) {
            if ($period['schedule']['zone_model'] !== $tariff['zone_model']) throw new RuntimeException('Model stref w katalogu zmienił się. Zweryfikuj własny harmonogram.');
            $tariff = array_replace($tariff, $period['schedule']);
        }
        $tariff['clientPeriodId'] = $period['id'];
        return $tariff;
    }

    public function profile(string $projectId, bool $lock = false): ?array
    {
        $q = $this->pdo->prepare('SELECT * FROM pricing_client_profile WHERE project_id=?' . ($lock ? ' FOR UPDATE' : ''));
        $q->execute([$projectId]);
        $row = $q->fetch(PDO::FETCH_ASSOC);
        if (!$row) return null;
        $row['context'] = $row['context_json'] === null
            ? []
            : json_decode($row['context_json'], true, 512, JSON_THROW_ON_ERROR);
        unset($row['context_json']);
        $q = $this->pdo->prepare('SELECT * FROM pricing_client_period WHERE profile_id=? ORDER BY valid_from');
        $q->execute([$row['id']]);
        $row['periods'] = array_map(fn($p) => ['id' => $p['id'], 'validFrom' => $p['valid_from'], 'validUntil' => $p['valid_until'],
            'osdId' => (int)$p['osd_id'], 'tariffId' => (int)$p['tariff_id'], 'source' => $p['source'], 'note' => $p['note'],
            'overrides' => json_decode($p['overrides_json'], true, 512, JSON_THROW_ON_ERROR),
            'schedule' => $p['schedule_json'] === null ? null : json_decode($p['schedule_json'], true, 512, JSON_THROW_ON_ERROR)], $q->fetchAll(PDO::FETCH_ASSOC));
        $row['revision'] = (int)$row['revision'];
        return $row;
    }

    public function byStation(string $station): ?array
    {
        $q = $this->pdo->prepare('SELECT project_id FROM pricing_client_profile WHERE station=?');
        $q->execute([$station]);
        $project = $q->fetchColumn();
        return $project === false ? null : $this->profile($project);
    }

    public function catalog(int $osd, int $tariff, string $date): ?array
    {
        self::date($date);
        $q = $this->pdo->prepare('SELECT * FROM pricing_catalog_revision WHERE osd_id=? AND tariff_id=? AND superseded=0 AND valid_from<=? AND (valid_until IS NULL OR valid_until>?) ORDER BY valid_from DESC LIMIT 2');
        $q->execute([$osd, $tariff, $date, $date]);
        $rows = $q->fetchAll(PDO::FETCH_ASSOC);
        if (count($rows) > 1) throw new RuntimeException('Nakładające się wersje katalogu.');
        if (!$rows) return null;
        $data = json_decode($rows[0]['payload_json'], true, 512, JSON_THROW_ON_ERROR);
        $data['catalogRevision'] = (int)$rows[0]['id'];
        return $data;
    }

    public function resolve(array $profile, string $date): array
    {
        self::date($date);
        $pending = $this->pdo->prepare("SELECT id FROM pricing_client_evidence WHERE profile_id=? AND state='REVIEW' AND valid_from<=? AND valid_until>? LIMIT 1");
        $pending->execute([$profile['id'], $date, $date]);
        if ($pending->fetchColumn()) throw new RuntimeException('Wymaga uzupełnienia: konflikt danych taryfowych ENEA dla ' . $date);
        $periods = array_values(array_filter($profile['periods'], fn($p) => ($p['validFrom'] === null || $p['validFrom'] <= $date)
            && ($p['validUntil'] === null || $p['validUntil'] > $date)));
        if (count($periods) !== 1) throw new RuntimeException('Wymaga uzupełnienia: brak jednoznacznej taryfy dla ' . $date);
        $p = $periods[0];
        $catalog = $this->catalog($p['osdId'], $p['tariffId'], $date);
        if (!$catalog) throw new RuntimeException('Wymaga uzupełnienia: brak cen katalogowych dla ' . $date);
        return self::apply($catalog, $p);
    }

    public function completeness(array $profile, array $period, ?string $dataFrom): array
    {
        $from = $period['validFrom'] ?? $dataFrom;
        if ($from === null) return ['ok' => false, 'error' => 'Nie ustalono początku danych. Wskaż datę początkową lub pobierz pomiary.'];
        self::date($from);
        $until = $period['validUntil'];
        $q = $this->pdo->prepare('SELECT valid_from,valid_until FROM pricing_catalog_revision WHERE osd_id=? AND tariff_id=? AND superseded=0 ORDER BY valid_from');
        $q->execute([$period['osdId'], $period['tariffId']]);
        $dates = [$from];
        foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $row) foreach (['valid_from', 'valid_until'] as $key) {
            $date = $row[$key];
            if ($date !== null && $date >= $from && ($until === null || $date < $until)) $dates[] = $date;
        }
        foreach ($this->evidence($profile['id']) as $row) if ($row['valid_until'] > $from && ($until === null || $row['valid_from'] < $until)) $dates[] = max($from, $row['valid_from']);
        try {
            foreach (array_unique($dates) as $date) $this->resolve($profile, $date);
            $displayDate = self::today();
            if ($displayDate < $from || ($until !== null && $displayDate >= $until)) $displayDate = $from;
            return ['ok' => true, 'tariff' => $this->resolve($profile, $displayDate)];
        } catch (RuntimeException $e) { return ['ok' => false, 'error' => $e->getMessage()]; }
    }

    public function history(array $profile, string $from, string $until): array
    {
        $from = self::date($from);
        $until = self::date($until);
        $days = (int)(new DateTimeImmutable($from))->diff(new DateTimeImmutable($until))->format('%r%a');
        if ($days <= 0 || $days > 3660) throw new InvalidArgumentException('Nieprawidłowy zakres historii taryf.');
        $out = ['strict' => true, 'revision' => $profile['revision'], 'byDate' => [], 'issues' => []];
        $ids = array_values(array_unique(array_column($profile['periods'], 'tariffId')));
        $versions = [];
        if ($ids) {
            $q = $this->pdo->prepare('SELECT * FROM pricing_catalog_revision WHERE superseded=0 AND tariff_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ') AND valid_from<? AND (valid_until IS NULL OR valid_until>?)');
            $q->execute([...$ids, $until, $from]);
            $versions = $q->fetchAll(PDO::FETCH_ASSOC);
        }
        $evidence = $this->evidence($profile['id']);
        $resolved = [];
        for ($d = new DateTimeImmutable($from); $d->format('Y-m-d') < $until; $d = $d->modify('+1 day')) {
            $key = $d->format('Y-m-d');
            try {
                foreach ($evidence as $e) if ($e['valid_from'] <= $key && $e['valid_until'] > $key) throw new RuntimeException('Wymaga uzupełnienia: konflikt ENEA dla ' . $key);
                $periods = array_values(array_filter($profile['periods'], fn($p) => ($p['validFrom'] === null || $p['validFrom'] <= $key) && ($p['validUntil'] === null || $p['validUntil'] > $key)));
                if (count($periods) !== 1) throw new RuntimeException('Wymaga uzupełnienia: brak jednoznacznej taryfy dla ' . $key);
                $p = $periods[0];
                $candidates = array_values(array_filter($versions, fn($v) => (int)$v['tariff_id'] === $p['tariffId'] && (int)$v['osd_id'] === $p['osdId'] && $v['valid_from'] <= $key && ($v['valid_until'] === null || $v['valid_until'] > $key)));
                if (count($candidates) !== 1) throw new RuntimeException('Wymaga uzupełnienia: brak jednoznacznych cen dla ' . $key);
                $v = $candidates[0];
                $cacheKey = $p['id'] . ':' . $v['id'];
                if (!isset($resolved[$cacheKey])) {
                    $payload = json_decode($v['payload_json'], true, 512, JSON_THROW_ON_ERROR);
                    $payload['catalogRevision'] = (int)$v['id'];
                    $resolved[$cacheKey] = self::apply($payload, $p);
                }
                $out['byDate'][$key] = $resolved[$cacheKey];
            }
            catch (RuntimeException $e) { $out['byDate'][$key] = null; $out['issues'][] = ['date' => $key, 'message' => $e->getMessage()]; }
        }
        return $out;
    }

    public static function packHistory(array $history): array
    {
        $tariffs = [];
        foreach ($history['byDate'] as &$tariff) {
            if ($tariff === null) continue;
            $key = $tariff['clientPeriodId'] . ':' . $tariff['catalogRevision'];
            $tariffs[$key] = $tariff;
            $tariff = $key;
        }
        unset($tariff);
        $history['tariffs'] = $tariffs;
        $history['format'] = 'client-tariffs-v1';
        return $history;
    }

    public function save(array $scope, int $revision, array $periods, string $actor, string $action, bool $preview = false, ?string $evidenceId = null): array
    {
        $periods = self::validatePeriods($periods);
        $ownsTransaction = !$this->pdo->inTransaction();
        if ($ownsTransaction) $this->pdo->beginTransaction();
        try {
            // Unique project and station constraints also protect concurrent first writes.
            $before = $this->profile($scope['projectId'], true);
            if (($before['revision'] ?? 0) !== $revision) throw new RuntimeException('Dane zmieniły się podczas edycji. Odśwież taryfy.', 409);
            if ($before && $before['client_id'] !== $scope['clientId']) throw new RuntimeException('Profil należy do innego klienta.', 409);
            if ($before && $before['ppe'] && $before['ppe'] !== $scope['ppe']) throw new RuntimeException('Zmieniono PPE projektu. Nie można przepisać historii do innego punktu.', 409);
            foreach ($periods as $p) {
                $q = $this->pdo->prepare('SELECT id FROM tariff WHERE id=? AND osd_id=?');
                $q->execute([$p['tariffId'], $p['osdId']]);
                if (!$q->fetchColumn()) throw new InvalidArgumentException('Taryfa nie należy do wskazanego operatora.');
            }
            $station = $scope['station'] ?? null;
            if ($station !== null) {
                $q = $this->pdo->prepare('SELECT station FROM EnergyMeter_users WHERE station=?');
                $q->execute([$station]);
                if (!$q->fetchColumn()) throw new InvalidArgumentException('Stacja RE nie istnieje.');
                $q = $this->pdo->prepare('SELECT project_id FROM pricing_client_profile WHERE station=? AND project_id<>? FOR UPDATE');
                $q->execute([$station, $scope['projectId']]);
                if ($q->fetchColumn()) throw new RuntimeException('Stacja ma już profil taryfowy innego projektu. Najpierw rozstrzygnij powiązanie.', 409);
            }
            $fixedCostContext = self::context($scope, $before['context'] ?? []);
            $after = ['id' => $before['id'] ?? self::uuid(), 'project_id' => $scope['projectId'], 'client_id' => $scope['clientId'],
                'ppe' => $scope['ppe'], 'station' => $station, 'context' => $fixedCostContext,
                'revision' => $revision + 1, 'periods' => $periods];
            if ($preview) {
                if (!$ownsTransaction) throw new RuntimeException('Podgląd wymaga osobnej transakcji.');
                $this->pdo->rollBack(); return $after;
            }
            if ($before) {
                $q = $this->pdo->prepare('UPDATE pricing_client_profile SET ppe=?, station=?, context_json=?, revision=?, updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND revision=?');
                $q->execute([$scope['ppe'], $station, self::json($fixedCostContext), $after['revision'], $after['id'], $revision]);
            } else {
                $q = $this->pdo->prepare('INSERT INTO pricing_client_profile (id, project_id, client_id, ppe, station, context_json, revision) VALUES (?,?,?,?,?,?,?)');
                $q->execute([$after['id'], $scope['projectId'], $scope['clientId'], $scope['ppe'], $station, self::json($fixedCostContext), $after['revision']]);
            }
            $q = $this->pdo->prepare('DELETE FROM pricing_client_period WHERE profile_id=?');
            $q->execute([$after['id']]);
            $q = $this->pdo->prepare('INSERT INTO pricing_client_period (id,profile_id,valid_from,valid_until,osd_id,tariff_id,source,overrides_json,schedule_json,note) VALUES (?,?,?,?,?,?,?,?,?,?)');
            foreach ($periods as $p) $q->execute([$p['id'], $after['id'], $p['validFrom'], $p['validUntil'], $p['osdId'], $p['tariffId'], $p['source'], self::json($p['overrides']), $p['schedule'] === null ? null : self::json($p['schedule']), $p['note']]);
            if ($evidenceId !== null) {
                $q = $this->pdo->prepare("UPDATE pricing_client_evidence SET state='RESOLVED' WHERE id=? AND profile_id=? AND state='REVIEW'");
                $q->execute([$evidenceId, $after['id']]);
                if ($q->rowCount() !== 1) throw new RuntimeException('Zgłoszenie ENEA zmieniło się podczas edycji.', 409);
            }
            $q = $this->pdo->prepare('INSERT INTO pricing_client_change (profile_id,revision,actor_id,action,before_json,after_json) VALUES (?,?,?,?,?,?)');
            $q->execute([$after['id'], $after['revision'], $actor, $action, self::json($before), self::json($after)]);
            if ($ownsTransaction) $this->pdo->commit();
            return $after;
        } catch (Throwable $e) {
            if ($ownsTransaction && $this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $e;
        }
    }

    public function syncContext(array $scope, string $actor): ?array
    {
        $profile = $this->profile($scope['projectId']);
        if (!$profile) return null;
        if ($profile['client_id'] !== $scope['clientId']) throw new RuntimeException('Profil należy do innego klienta.', 409);
        if ($profile['ppe'] && $profile['ppe'] !== ($scope['ppe'] ?? null)) {
            throw new RuntimeException('PPE projektu różni się od PPE profilu taryfowego.', 409);
        }
        if (($profile['station'] ?? null) !== ($scope['station'] ?? null)) {
            throw new RuntimeException('Powiązanie profilu taryfowego ze stacją zmieniło się. Użyj zakładki EMS.', 409);
        }
        $context = self::context($scope, $profile['context'] ?? []);
        if ($context === ($profile['context'] ?? []) && $profile['ppe'] === ($scope['ppe'] ?? null)) return $profile;
        return $this->save($scope, $profile['revision'], $profile['periods'], $actor, 'CONTEXT');
    }

    public function evidence(string $profileId): array
    {
        $q = $this->pdo->prepare("SELECT id,valid_from,valid_until,tariff_code,state,evidence_json FROM pricing_client_evidence WHERE profile_id=? AND state='REVIEW' ORDER BY valid_from");
        $q->execute([$profileId]);
        return array_map(function ($row) { $row['evidence'] = json_decode($row['evidence_json'], true, 512, JSON_THROW_ON_ERROR); unset($row['evidence_json']); return $row; }, $q->fetchAll(PDO::FETCH_ASSOC));
    }

    public function importEvidence(array $scope, array $input, string $actor): array
    {
        $from = self::date($input['validFrom'] ?? null);
        $until = self::date($input['validUntil'] ?? null);
        if ($until <= $from) throw new InvalidArgumentException('Nieprawidłowy zakres ENEA.');
        $code = trim((string)($input['tariffCode'] ?? ''));
        if (strlen($code) > 100 || ($input['source'] ?? '') !== 'ENEA_CONSUMPTION_RANGE') throw new InvalidArgumentException('Nieprawidłowe metadane ENEA.');
        $rawSegments = $input['segments'] ?? [['validFrom' => $from, 'validUntil' => $until, 'tariffCode' => $code]];
        if (!is_array($rawSegments) || !array_is_list($rawSegments) || !$rawSegments || count($rawSegments) > 10) {
            throw new InvalidArgumentException('Nieprawidłowe okresy taryfowe ENEA.');
        }
        $segments = [];
        $cursor = $from;
        foreach ($rawSegments as $raw) {
            if (!is_array($raw)) throw new InvalidArgumentException('Nieprawidłowy okres taryfowy ENEA.');
            $segmentFrom = self::date($raw['validFrom'] ?? null);
            $segmentUntil = self::date($raw['validUntil'] ?? null);
            $segmentCode = trim((string)($raw['tariffCode'] ?? ''));
            if ($segmentFrom !== $cursor || $segmentUntil <= $segmentFrom || $segmentUntil > $until || strlen($segmentCode) > 100) {
                throw new InvalidArgumentException('Okresy taryfowe ENEA muszą dokładnie i kolejno pokrywać raport.');
            }
            $segments[] = ['validFrom' => $segmentFrom, 'validUntil' => $segmentUntil, 'tariffCode' => $segmentCode];
            $cursor = $segmentUntil;
        }
        if ($cursor !== $until) throw new InvalidArgumentException('Okresy taryfowe ENEA nie pokrywają całego raportu.');
        $id = hash('sha256', self::json([$scope['projectId'], $scope['ppe'], $from, $until, $input]));
        $this->pdo->beginTransaction();
        try {
            $profile = $this->profile($scope['projectId'], true);
            if (!$profile) $profile = $this->save($scope, 0, [], $actor, 'ENEA_PROFILE');
            $q = $this->pdo->prepare('SELECT state FROM pricing_client_evidence WHERE id=?');
            $q->execute([$id]);
            if ($state = $q->fetchColumn()) {
                if ($state === 'CONFIRMED') {
                    $q = $this->pdo->prepare("UPDATE pricing_client_evidence SET state='RESOLVED' WHERE profile_id=? AND state='REVIEW' AND valid_from=? AND valid_until=?");
                    $q->execute([$profile['id'], $from, $until]);
                }
                $this->pdo->commit(); return ['state' => $state, 'duplicate' => true];
            }
            $certain = ($input['certain'] ?? false) === true;
            foreach ($segments as &$segment) {
                $q = $this->pdo->prepare("SELECT t.id,t.osd_id FROM tariff t JOIN osd o ON o.id=t.osd_id WHERE LOWER(o.slug)='enea' AND LOWER(t.code)=LOWER(?)");
                $q->execute([$segment['tariffCode']]);
                $candidates = $q->fetchAll(PDO::FETCH_ASSOC);
                if (count($candidates) !== 1) $certain = false;
                else $segment['candidate'] = ['id' => (int)$candidates[0]['id'], 'osd_id' => (int)$candidates[0]['osd_id']];
            }
            unset($segment);
            $periods = $profile['periods'];
            foreach ($segments as $segment) {
                $candidate = $segment['candidate'] ?? null;
                $overlaps = array_values(array_filter($periods, fn($p) => ($p['validFrom'] === null || $p['validFrom'] < $segment['validUntil'])
                    && ($p['validUntil'] === null || $p['validUntil'] > $segment['validFrom'])));
                foreach ($overlaps as $p) if (!$certain || $candidate === null
                    || $p['tariffId'] !== $candidate['id'] || $p['osdId'] !== $candidate['osd_id']) $certain = false;
            }
            if ($certain) {
                foreach ($segments as $index => $segment) {
                    $candidate = $segment['candidate'];
                    $segmentCursor = $segment['validFrom'];
                    $overlaps = array_values(array_filter($periods, fn($p) => ($p['validFrom'] === null || $p['validFrom'] < $segment['validUntil'])
                        && ($p['validUntil'] === null || $p['validUntil'] > $segment['validFrom'])));
                    foreach ($overlaps as $p) {
                        if ($p['validFrom'] !== null && $p['validFrom'] > $segmentCursor) {
                            $periods[] = self::period(['validFrom' => $segmentCursor, 'validUntil' => $p['validFrom'],
                                'osdId' => $candidate['osd_id'], 'tariffId' => $candidate['id'], 'source' => 'ENEA']);
                        }
                        $segmentCursor = $p['validUntil'] === null ? $segment['validUntil']
                            : max($segmentCursor, min($segment['validUntil'], $p['validUntil']));
                    }
                    if ($segmentCursor < $segment['validUntil']) {
                        $segmentEnd = $segment['validUntil'];
                        if (($input['continueLast'] ?? false) === true && $index === count($segments) - 1) {
                            $future = array_values(array_filter(array_column($periods, 'validFrom'), fn($date) => $date !== null && $date >= $segmentEnd));
                            sort($future);
                            $segmentEnd = $future[0] ?? null;
                        }
                        $periods[] = self::period(['validFrom' => $segmentCursor, 'validUntil' => $segmentEnd,
                            'osdId' => $candidate['osd_id'], 'tariffId' => $candidate['id'], 'source' => 'ENEA']);
                    }
                }
            }
            $state = $certain ? 'CONFIRMED' : 'REVIEW';
            $q = $this->pdo->prepare('INSERT INTO pricing_client_evidence (id,profile_id,valid_from,valid_until,tariff_code,state,evidence_json) VALUES (?,?,?,?,?,?,?)');
            $q->execute([$id, $profile['id'], $from, $until, $code, $state, self::json($input)]);
            $this->save($scope, $profile['revision'], $periods, $actor, 'ENEA_' . $state);
            if ($state === 'CONFIRMED') {
                $q = $this->pdo->prepare("UPDATE pricing_client_evidence SET state='RESOLVED' WHERE profile_id=? AND id<>? AND state='REVIEW' AND valid_from=? AND valid_until=?");
                $q->execute([$profile['id'], $id, $from, $until]);
            }
            $this->pdo->commit();
            return ['state' => $state, 'duplicate' => false];
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $e;
        }
    }
}
