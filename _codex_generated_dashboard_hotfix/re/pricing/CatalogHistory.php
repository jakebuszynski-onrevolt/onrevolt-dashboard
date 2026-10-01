<?php
declare(strict_types=1);
namespace OnRevolt\Pricing;

require_once __DIR__ . '/ClientTariffs.php';

use InvalidArgumentException;
use PDO;
use RuntimeException;

final class CatalogHistory
{
    public static function record(PDO $pdo, array $payload, string $from, string $source): void
    {
        ClientTariffs::date($from);
        if (!$pdo->inTransaction()) throw new RuntimeException('Historia katalogu wymaga transakcji.');
        $id = (int)$payload['tariff_id'];
        $lock = $pdo->prepare('SELECT id FROM tariff WHERE id=? FOR UPDATE');
        $lock->execute([$id]);
        if (!$lock->fetchColumn()) throw new InvalidArgumentException('Brak taryfy.');
        $json = ClientTariffs::json($payload);
        $fingerprint = hash('sha256', $json);
        $q = $pdo->prepare('SELECT * FROM pricing_catalog_revision WHERE tariff_id=? AND superseded=0 ORDER BY valid_from');
        $q->execute([$id]);
        $rows = $q->fetchAll(PDO::FETCH_ASSOC);
        $until = null;
        foreach ($rows as $row) {
            if ($row['valid_from'] === $from && hash_equals($row['fingerprint'], $fingerprint)) return;
            if ($row['valid_from'] > $from && ($until === null || $until > $row['valid_from'])) $until = $row['valid_from'];
        }
        $componentKeys = array_merge(array_column($payload['pricing']['tariffStorage']['fixed'], 'component_key'), array_column($payload['pricing']['tariffStorage']['variable'], 'component_key'));
        $q = $pdo->prepare('SELECT overrides_json FROM pricing_client_period WHERE tariff_id=? AND (valid_until IS NULL OR valid_until>?)' . ($until === null ? '' : ' AND (valid_from IS NULL OR valid_from<?)'));
        $q->execute($until === null ? [$id, $from] : [$id, $from, $until]);
        foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $overrides) {
            $missing = array_diff(array_keys(json_decode($overrides, true, 512, JSON_THROW_ON_ERROR)), $componentKeys);
            if ($missing) throw new RuntimeException('Nie można usunąć pozycji z indywidualną korektą klienta: ' . implode(', ', $missing));
        }
        $q = $pdo->prepare('UPDATE pricing_catalog_revision SET superseded=1 WHERE tariff_id=? AND valid_from=? AND superseded=0');
        $q->execute([$id, $from]);
        $q = $pdo->prepare('UPDATE pricing_catalog_revision SET valid_until=? WHERE tariff_id=? AND superseded=0 AND valid_from<? AND (valid_until IS NULL OR valid_until>?)');
        $q->execute([$from, $id, $from, $from]);
        $q = $pdo->prepare('INSERT INTO pricing_catalog_revision (tariff_id,osd_id,valid_from,valid_until,payload_json,fingerprint,source) VALUES (?,?,?,?,?,?,?)');
        $q->execute([$id, (int)$payload['osd_id'], $from, $until, $json, $fingerprint, $source]);
    }

    public static function capture(PDO $pdo, int $id, string $date, string $source): void
    {
        $q = $pdo->prepare('SELECT osd_id FROM tariff WHERE id=?');
        $q->execute([$id]);
        $osd = (int)$q->fetchColumn();
        $payload = \load_tariff($pdo, $osd, $id);
        $q = $pdo->prepare('SELECT name,add_rdn,add_akcyza FROM osd WHERE id=?');
        $q->execute([$osd]);
        $market = $q->fetch(PDO::FETCH_ASSOC);
        $payload['osd_name'] = $market['name'];
        $payload['osd_add_rdn'] = (float)$market['add_rdn'];
        $payload['osd_add_akcyza'] = (float)$market['add_akcyza'];
        $payload['pricing']['tariffStorage'] = TariffStorage::attachCanonical($pdo, $payload);
        self::record($pdo, $payload, $date, $source);
    }

    /** The editor must return keys, not positions or ambiguous labels. */
    public static function prepareKeys(array $input, bool $form, string $group, array $existingRows): array
    {
        $prefix = $group === 'fixed' ? 'fc' : 'vc';
        $rows = $form ? ($input[$prefix . '_label'] ?? []) : ($input[$group] ?? []);
        $existing = array_column($existingRows, null, 'component_key');
        $keys = [];
        $seen = [];
        foreach ($rows as $i => $row) {
            $label = trim((string)($form ? $row : ($row['label'] ?? '')));
            if ($label === '') continue;
            $key = (string)($form ? ($input[$prefix . '_component_key'][$i] ?? '') : ($row['component_key'] ?? ''));
            if ($key !== '' && !isset($existing[$key])) throw new InvalidArgumentException('Nieznany identyfikator pozycji taryfy. Odśwież edytor.');
            if ($key === '') $key = ClientTariffs::uuid();
            if (isset($seen[$key])) throw new InvalidArgumentException('Powtórzony identyfikator opłaty.');
            $seen[$key] = true;
            $keys[] = $key;
        }
        return $keys;
    }
}
