import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = process.argv[2];
if (!root) throw new Error('Podaj katalog wygenerowanych plików my.onrevolt.com.');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
for (const file of ['js/scripts.js', 'js/prosumer-engine.js', 're/js/scripts.js', 're/js/script_on.js']) new vm.Script(read(file), { filename: file });
const dashboard = read('js/scripts.js');
const ast = ts.createSourceFile('dashboard.js', dashboard, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function declarations(name: string) {
  const out: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) out.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast); return out;
}
const setup = readFileSync('public/shared/re-tariff-engine.js', 'utf8') + readFileSync('integrations/re/client-tariff-browser.js', 'utf8');
const notice: any = { textContent: '', hidden: true };
const context: any = vm.createContext({ console, document: {
  getElementById: (id: string) => id === 'client-tariff-completeness' ? notice : null,
  createElement: () => notice,
  querySelectorAll: () => [],
  body: { prepend: () => undefined, dataset: {} },
} });
context.window = context;
vm.runInContext(setup, context);
const tariff = (price: number, fixed: number) => ({ zone_model: 'daynight', dn_night: [0, 1, 2], po_off: [],
  variable: [{ label: 'Energia czynna', window_code: 'day', price }, { label: 'Energia czynna', window_code: 'night', price: price / 2 },
    { label: 'Dystrybucja', window_code: 'all', price: 0.2 }], fixed: [{ amount: fixed }] });
const first = tariff(1, 31), next = tariff(2, 62);
const byDate = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`2026-01-${String(i + 1).padStart(2, '0')}`, i < 15 ? first : next]));
const history = { strict: true, revision: 1, byDate };
const payload = { tariffHistory: history, tariffData: { current: next, next: tariff(99, 99) } };
const wrapped = context.clientTariffActual(payload, null);
for (const source of declarations('resolveEnergyPurchaseRate')) {
  vm.runInContext(source, context);
  assert.equal(context.resolveEnergyPurchaseRate(wrapped, '2026-01-01', 12, 0), 1);
  assert.equal(context.resolveEnergyPurchaseRate(wrapped, '2026-01-16', 12, 0), 2);
  assert.equal(context.resolveEnergyPurchaseRate(wrapped, '2026-01-16', 1, 0), 1);
  assert.throws(() => context.resolveEnergyPurchaseRate(wrapped, '2025-01-01', 1, 0), /brak cen/);
}
for (const source of declarations('getZoneCodeForDateHour')) {
  vm.runInContext(source, context);
  assert.equal(context.getZoneCodeForDateHour(wrapped, '2026-01-01', 1), 'night');
  assert.equal(context.getZoneCodeForDateHour(wrapped, '2026-01-16', 12), 'day');
}
for (const name of ['getPurchaseTariff', 'getDepositTariff']) {
  vm.runInContext(declarations(name)[0], context);
  assert.equal(context[name](payload).clientTariffHistory, history);
}
assert.equal(context.clientTariffFixedCosts(payload, { start: new Date(2026, 0, 1), end: new Date(2026, 0, 31) }, 300), 47);
const banded = { ...first, fixed: [{ amount: 31, annual_usage_max_kwh: 2800 }, { amount: 62, annual_usage_min_kwh: 2800 }] };
const annualPayload = { ...payload, account: { annualUsageKwh: 6000 }, tariffHistory: { strict: true, byDate: Object.fromEntries(Object.keys(byDate).map(date => [date, banded])) } };
assert.equal(context.clientTariffAnnualUsage(annualPayload), 6000);
assert.equal(context.clientTariffFixedCosts(annualPayload, { start: new Date(2026, 0, 1), end: new Date(2026, 0, 31) }, 500), 62);
assert.throws(() => context.clientTariffFixedCosts({ ...annualPayload, account: {} }, { start: new Date(2026, 0, 1), end: new Date(2026, 0, 31) }, 500), /rocznego zużycia/);
const measured = { ...payload, usageData: { records: [{ date: '2026-01-01', quarters: [{ gridPhysical: 2, gridBilled: 1, storage: 3, pv: 4 }] }] } };
const range = { start: new Date(2026, 0, 1), end: new Date(2026, 0, 1) };
assert.equal(context.clientTariffDashboardCost(measured, range, {}, () => 12).purchaseCost, 9);
assert.equal(context.clientTariffDashboardCost(measured, range, { gridOnly: true }, () => 12).purchaseCost, 1);
const powerTariff = { ...first, fixed: [{ amount: 2, amount_mode: 'per_kw_month' }] };
const powerPayload = { ...measured, tariffHistory: { strict: true, byDate: { '2026-01-01': powerTariff } } };
assert.equal(context.clientTariffDashboardCost(powerPayload, range, {}, () => 12), null);
assert.equal(notice.hidden, false);
assert.match(notice.textContent, /Brak danych do opłaty stałej/);
assert.equal(context.clientTariffDashboardCost(powerPayload, range, { connectionPowerKw: 16 }, () => 12).fixedCost, 32 / 31);
assert.equal(notice.hidden, true);
const capacityTariff = {
  ...first,
  code: 'C13active',
  segment: 'nn_le_40',
  variable: [...first.variable, { label: 'Opłata mocowa', window_code: 'all', price: 0.269862 }],
  capacity_charge: {
    model: 'pl_capacity_charge', effective_from: '2026-01-01', effective_until: '2027-01-01',
    flat_eligible: true, flat_max_power_kw: 16, variable_rate: 0.269862,
    qualifying_hour_from: 7, qualifying_hour_until: 22, exclude_weekends: true, exclude_public_holidays: true,
    flat_monthly: [
      { annual_usage_min_kwh: null, annual_usage_max_kwh: 500, amount: 5.2767 },
      { annual_usage_min_kwh: 500, annual_usage_max_kwh: 1200, amount: 12.6813 },
      { annual_usage_min_kwh: 1200, annual_usage_max_kwh: 2800, amount: 21.1314 },
      { annual_usage_min_kwh: 2800, annual_usage_max_kwh: null, amount: 29.5815 },
    ],
    profile_factors: [
      { difference_max_percent: 5, factor: 0.17, group: 'K1' },
      { difference_max_percent: 10, factor: 0.5, group: 'K2' },
      { difference_max_percent: 15, factor: 0.83, group: 'K3' },
      { difference_max_percent: null, factor: 1, group: 'K4' },
    ],
  },
};
assert.equal(context.ReTariffEngine.fixedMonthly(capacityTariff, {
  annualUsageKwh: 1500, billingCycleMonths: 1, connectionPowerKw: 10,
}), first.fixed[0].amount + 21.1314);
const capacityRate = context.ReTariffEngine.rates(capacityTariff, '2026-01-02', 12, undefined, {
  annualUsageKwh: 6000, billingCycleMonths: 1, connectionPowerKw: 20, dayProfileKwh: Array(24).fill(1),
});
assert.ok(Math.abs(capacityRate.capacityChargeRate - 0.269862 * 0.17) < 1e-9);
assert.equal(context.ReTariffEngine.rates(capacityTariff, '2026-01-01', 12, undefined, {
  annualUsageKwh: 6000, billingCycleMonths: 1, connectionPowerKw: 20, dayProfileKwh: Array(24).fill(1),
}).capacityChargeRate, 0);
for (const source of declarations('buildTariffModels')) {
  assert.ok(source.includes('ReTariffEngine.resolve(payload.tariffHistory, formatDateKey(state.anchorDate), null)'));
  assert.ok(!source.includes('annualUsageKwh: Object.values'));
}
vm.runInContext(read('re/pricing/dashboard-pricing.js'), context);
const business = { ...first, segment: 'business', buy_base: 1.23, sell_fixed_price: 0,
  pricing: { tariffStorage: { priceBasis: 'net', vatRate: 0.23,
    fixed: first.fixed.map(row => ({ ...row, net: row.amount / 1.23, vatRate: 0.23 })),
    variable: first.variable.map(row => ({ ...row, net: row.price / 1.23, vatRate: 0.23 })),
    buyBase: { net: 1 }, sellFixedPrice: { net: 0 } } } };
const projected = context.DashboardPricing.projectPayload({ tariffData: { current: business, next: business }, tariffHistory: {
  strict: true, format: 'client-tariffs-v1', tariffs: { first: business }, byDate: { '2026-01-01': 'first', '2026-01-02': 'first', '2026-01-03': null } } });
assert.equal(projected.tariffHistory.byDate['2026-01-01'].variable[0].price, 1 / 1.23);
assert.equal(projected.tariffHistory.byDate['2026-01-01'], projected.tariffHistory.byDate['2026-01-02']);
assert.equal(projected.tariffHistory.byDate['2026-01-03'], null);
const capacityBusiness = {
  ...capacityTariff,
  segment: 'business',
  buy_base: 1.23,
  sell_fixed_price: 0,
  pricing: { tariffStorage: {
    priceBasis: 'net', vatRate: 0.23,
    fixed: capacityTariff.fixed.map((row: any) => ({ ...row, net: row.amount / 1.23, vatRate: 0.23 })),
    variable: capacityTariff.variable.map((row: any) => ({
      ...row, net: row.label === 'Opłata mocowa' ? 0.2194 : row.price / 1.23, vatRate: 0.23,
    })),
    buyBase: { net: 1 }, sellFixedPrice: { net: 0 },
  } },
};
const projectedCapacity = context.DashboardPricing.projectTariff(capacityBusiness);
assert.equal(projectedCapacity.capacity_charge.variable_rate, 0.2194);
assert.ok(Math.abs(projectedCapacity.capacity_charge.flat_monthly[0].amount - 4.29) < 1e-9);
assert.ok(read('js/prosumer-engine.js').includes('context && context.useActualTariffHistory ? payload.tariffHistory : null'));
assert.ok(read('js/prosumer-engine.js').includes('resolveCapacityCharge(tariff, dateKey, hour'));
const capacityProfileSource = declarations('buildCapacityChargeProfile')[0];
assert.ok(capacityProfileSource.includes('clampNumber('));
assert.ok(!capacityProfileSource.includes('const hour = clamp('));
assert.ok(read('re/js/scripts.js').includes('await window.loadCurrentTariff(osdId, tariffId)'));
assert.ok(read('re/js/scripts.js').indexOf('window.loadCurrentTariff = async function') < read('re/js/scripts.js').indexOf('refreshTariffDerivedState({ reloadCurrentTariff: true }).catch(console.error)'));
assert.ok(read('js/scripts.js').includes('contractPowerInput.value = String(input.contractPowerKw)'));
assert.ok(read('js/scripts.js').includes('billingCycleSelect.value = billingValue'));
assert.ok(read('js/scripts.js').includes('days: request.range.coverageDays || request.range.days,'));
assert.ok(read('re/pricing/CapacityCharge.php').includes("'rate_year' => $rateYear"));
assert.ok(read('re/pricing/CapacityCharge.php').includes('Prognoza na podstawie ostatniej stawki URE'));
assert.ok(read('re/pricing/CapacityCharge.php').includes("($tariff['clientPeriodSource'] ?? null) === 'TARGET'"));
assert.ok(read('re/pricing/ClientTariffs.php').includes("$tariff['clientPeriodSource'] = $period['source']"));
assert.ok(read('index.html').includes('js/scripts.js?v=20260930-capacity-charge-3'));
assert.ok(read('js/scripts.js').includes('new URL("js/scripts.js?v=20260930-capacity-charge-3", baseUrl)'));
assert.equal((read('js/scripts.js').match(/account: account \? Object\.assign\(\{\}, \(window\.dashboardLatestPayload && window\.dashboardLatestPayload\.account\) \|\| \{\}, account\)/g) || []).length, 2);
assert.ok(!read('js/scripts.js').includes('20260926-client-tariffs-1'));
console.log('RE assets: syntax, actual rates, zone hours, interval boundaries, prorated fees, separate target scenario and asset versions OK');
