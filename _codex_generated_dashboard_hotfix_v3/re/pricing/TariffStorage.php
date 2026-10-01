<?php
declare(strict_types=1);
namespace OnRevolt\Pricing;

require_once __DIR__ . '/CatalogHistory.php';

use InvalidArgumentException;
use PDO;
use RuntimeException;

/** Canonical table values are net; the *_legacy views expose the frozen pre-migration contract. */
final class TariffStorage
{
    public static function state(PDO $pdo, int $tariffId): array
    {
        $query = $pdo->prepare('SELECT price_basis, vat_rate, prices_valid_from FROM tariff WHERE id=?' . ($pdo->inTransaction() ? ' FOR UPDATE' : ''));
        $query->execute([$tariffId]);
        $row = $query->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new InvalidArgumentException('Nie znaleziono taryfy.');
        return $row;
    }

    public static function vat($rate): float
    {
        if (!is_numeric($rate) || !is_finite((float)$rate) || (float)$rate < 0 || (float)$rate > 1) {
            throw new InvalidArgumentException('Nieprawidłowa stawka VAT.');
        }
        return (float)$rate;
    }

    public static function initializeTariff(PDO $pdo, int $tariffId): void
    {
        $config = $pdo->query('SELECT price_basis, vat_rate, effective_from FROM pricing_storage_config WHERE id=1 FOR UPDATE')->fetch(PDO::FETCH_ASSOC);
        if (!$config || $config['price_basis'] !== 'net') throw new RuntimeException('Migracja taryf nie jest jeszcze zakończona.');
        $query = $pdo->prepare("UPDATE tariff SET price_basis='net', vat_rate=?, prices_valid_from=?, legacy_buy_base=0, legacy_sell_fixed_price=0 WHERE id=? AND buy_base=0 AND sell_fixed_price=0");
        $query->execute([self::vat($config['vat_rate']), $config['effective_from'], $tariffId]);
        if ($query->rowCount() !== 1) throw new RuntimeException('Nie można zainicjalizować taryfy netto.');
    }

    public static function prepareInput(PDO $pdo, int $tariffId, array $input, bool $form): array
    {
        $state = self::state($pdo, $tariffId);
        $basis = (string)($input['price_basis'] ?? 'legacy');
        if (!in_array($basis, ['legacy', 'net', 'gross'], true)) throw new InvalidArgumentException('Nieprawidłowa podstawa cen.');
        if ($state['price_basis'] !== 'net') throw new RuntimeException('Taryfa nie została jeszcze przeniesiona na netto.');
        $defaultVat = self::vat($state['vat_rate']);
        $plan = ['fixed' => [], 'variable' => [], 'basis' => $basis, 'validFrom' => ClientTariffs::date((string)($input['prices_valid_from'] ?? ClientTariffs::today()))];
        foreach (['fixed' => ['fc_label', 'fc_amount', 'fc_vat_rate', 'amount'],
            'variable' => ['vc_label', 'vc_price', 'vc_vat_rate', 'price']] as $group => $fields) {
            [$labelKey, $amountKey, $vatKey, $field] = $fields;
            $existingQuery = $pdo->prepare('SELECT * FROM tariff_' . ($group === 'fixed' ? 'fixed' : 'variable') . '_cost WHERE tariff_id=? ORDER BY id');
            $existingQuery->execute([$tariffId]);
            $existingRows = $existingQuery->fetchAll(PDO::FETCH_ASSOC);
            $keys = CatalogHistory::prepareKeys($input, $form, $group, $existingRows);
            $rows = $form ? ($input[$labelKey] ?? []) : ($input[$group] ?? []);
            foreach ($rows as $i => $row) {
                $label = trim((string)($form ? $row : ($row['label'] ?? '')));
                if ($label === '') continue;
                $amount = $form ? ($input[$amountKey][$i] ?? null) : ($row[$field] ?? null);
                if (!is_numeric($amount) || !is_finite((float)$amount)) throw new InvalidArgumentException('Nieprawidłowa kwota: ' . $label);
                $vat = self::vat($form ? ($input[$vatKey][$i] ?? $defaultVat) : ($row['vat_rate'] ?? $defaultVat));
                $net = $basis === 'net' ? (float)$amount : (float)$amount / (1 + $vat);
                $legacy = $basis === 'net' ? (float)$amount * (1 + $vat) : (float)$amount;
                foreach ($existingRows as $existing) {
                    if ($basis === 'net' && $existing['label'] === $label
                        && (float)$existing['vat_rate'] === $vat && abs((float)$existing[$field] - $net) < 0.0000000000005) {
                        $legacy = (float)$existing['legacy_' . $field];
                        break;
                    }
                }
                $plan[$group][] = ['net' => $net, 'legacy' => $legacy, 'vat' => $vat, 'key' => $keys[count($plan[$group])]];
                // Existing save code continues to receive legacy values, with canonical values applied before commit.
                if ($form) $input[$amountKey][$i] = $legacy;
                else $input[$group][$i][$field] = $legacy;
            }
        }
        return [$input, $plan];
    }

    public static function finishSave(PDO $pdo, int $tariffId, array $plan): void
    {
        foreach (['fixed' => ['tariff_fixed_cost', 'amount'], 'variable' => ['tariff_variable_cost', 'price']] as $group => $spec) {
            [$table, $field] = $spec;
            $query = $pdo->prepare('SELECT id FROM ' . $table . ' WHERE tariff_id=? ORDER BY id');
            $query->execute([$tariffId]);
            $ids = $query->fetchAll(PDO::FETCH_COLUMN);
            if (count($ids) !== count($plan[$group])) throw new RuntimeException('Niespójna liczba składników podczas zapisu taryfy.');
            $save = $pdo->prepare('UPDATE ' . $table . ' SET ' . $field . '=?, legacy_' . $field . '=?, vat_rate=?, price_basis=\'net\', component_key=? WHERE id=?');
            foreach ($ids as $i => $id) {
                $row = $plan[$group][$i];
                $save->execute([sprintf('%.12F', $row['net']), sprintf('%.12F', $row['legacy']), $row['vat'], $row['key'], $id]);
            }
        }
        $date = $plan['validFrom'];
        $pdo->prepare('UPDATE tariff SET prices_valid_from=? WHERE id=?')->execute([$date, $tariffId]);
        CatalogHistory::capture($pdo, $tariffId, $date, 'catalog-editor');
    }

    public static function attachCanonical(PDO $pdo, array $legacy): array
    {
        $state = self::state($pdo, (int)$legacy['tariff_id']);
        $canonical = ['priceBasis' => $state['price_basis'], 'vatRate' => (float)$state['vat_rate'],
            'validFrom' => $state['prices_valid_from'], 'fixed' => [], 'variable' => []];
        $headerQuery = $pdo->prepare('SELECT buy_base, sell_fixed_price FROM tariff WHERE id=?');
        $headerQuery->execute([(int)$legacy['tariff_id']]);
        $header = $headerQuery->fetch(PDO::FETCH_ASSOC);
        foreach (['buy_base' => 'buyBase', 'sell_fixed_price' => 'sellFixedPrice'] as $field => $key) {
            $net = (float)$header[$field];
            $canonical[$key] = ['net' => $net, 'gross' => $net * (1 + $canonical['vatRate']),
                'vatRate' => $canonical['vatRate'], 'priceBasis' => 'net'];
        }
        $marketRules = json_decode(file_get_contents(__DIR__ . '/market-price-basis.json'), true, 512, JSON_THROW_ON_ERROR);
        $rule = $marketRules[(string)$legacy['osd_id']] ?? null;
        if ($rule !== null) {
            $vat = $canonical['vatRate'];
            $market = ['verified' => true, 'rateAmountsAudited' => false, 'source' => $rule['source']];
            foreach (['osd_add_rdn' => ['margin', 'marginBasis'], 'osd_add_akcyza' => ['excise', 'exciseBasis']] as $field => $spec) {
                $value = (float)($legacy[$field] ?? 0);
                $basis = $rule[$spec[1]];
                if (!in_array($basis, ['net', 'gross'], true)) throw new RuntimeException('Nieznana podstawa dodatku RDN.');
                $net = $basis === 'net' ? $value : $value / (1 + $vat);
                $market[$spec[0]] = ['net' => $net, 'gross' => $net * (1 + $vat), 'vatRate' => $vat, 'sourcePriceBasis' => $basis];
            }
            $canonical['market'] = $market;
        }
        foreach (['fixed' => ['tariff_fixed_cost', 'amount', ' AND active=1 ORDER BY id'],
            'variable' => ['tariff_variable_cost', 'price', ' ORDER BY ord,id']] as $group => $spec) {
            [$table, $field, $order] = $spec;
            $query = $pdo->prepare('SELECT * FROM ' . $table . ' WHERE tariff_id=?' . $order);
            $query->execute([(int)$legacy['tariff_id']]);
            foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $row) {
                if ($row['price_basis'] !== 'net') throw new RuntimeException('Niespójna podstawa składników taryfy.');
                $net = (float)$row[$field];
                $rate = self::vat($row['vat_rate']);
                $row[$field] = $net;
                $row['net'] = $net;
                $row['gross'] = $net * (1 + $rate);
                $row['vatRate'] = $rate;
                $row['priceBasis'] = 'net';
                unset($row['legacy_' . $field]);
                $canonical[$group][] = $row;
            }
        }
        return $canonical;
    }
}
