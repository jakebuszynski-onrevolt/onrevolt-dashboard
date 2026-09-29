import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const directory = process.argv[2];
if (!directory) throw new Error('Podaj katalog przygotowanego dashboardu.');
const source = readFileSync(path.join(directory, 'js/scripts.js'), 'utf8');
const parsed = ts.createSourceFile('scripts.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = new Set(['getProsumerRangeEnergy', 'createZoneTotals', 'subtractZoneTotals', 'buildTariffModels', 'buildTariffBreakdown', 'buildUsageDetailsForNextTariff']);
const functions = new Map<string, string>();
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) {
    functions.set(node.name.text, source.slice(node.getStart(parsed), node.end));
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.equal(functions.size, names.size);

const firstNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (value != null && value !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
};
const range = { start: '2026-10-01', end: '2026-10-31', days: 31 };
const tariff = {
  code: 'G12', zone_model: 'daynight',
  variable: [
    { label: 'Energia', window_code: 'day', price: 0.8 },
    { label: 'Energia', window_code: 'night', price: 0.4 },
    { label: 'Sieciowa', window_code: 'day', price: 0.3 },
    { label: 'Sieciowa', window_code: 'night', price: 0.1 },
    { label: 'Jakościowa', window_code: 'all', price: 0.04 },
    { label: 'OZE', window_code: 'all', price: 0.01 }
  ], fixed: [{ value: 2 }]
};
const baseline = {
  code: 'G11', zone_model: 'all',
  variable: [{ label: 'Energia', window_code: 'all', price: 0.6 }, { label: 'Sieciowa', window_code: 'all', price: 0.4 }],
  fixed: [{ value: 2 }]
};
const simulation = { days: [{ dateKey: '2026-10-01', hours: [
  { hour: 2, demandKwh: 5, billedGridPurchaseForLoadKwh: 5, gridTopupKwh: 17.56, bankToLoadKwh: 0 },
  { hour: 18, demandKwh: 22.59, billedGridPurchaseForLoadKwh: 5.2, gridTopupKwh: 0, bankToLoadKwh: 17.39 }
] }] };
const context: Record<string, any> = {
  firstNumber, numberOrNull: firstNumber, formatDateKey: String,
  clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
  normalizeText: (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
  getSummarySimulationForRange: () => simulation,
  getSummaryForecastSimulation: () => simulation,
  getZoneCodeForDateHour: (_tariff: unknown, _date: string, hour: number) => hour < 6 || hour >= 22 ? 'night' : 'day',
  buildZoneTotalsFromTotal: (value: number) => ({ ...context.createZoneTotals(), all: value || 0 }),
  isTwoZoneTariff: (value: typeof tariff) => value.zone_model === 'daynight',
  getTariffZoneDefinitions: () => [{ code: 'day' }, { code: 'night' }],
  calculateFixedRowsForRange: (rows: unknown[]) => rows,
  sumTariffVariableRows: (rows: typeof tariff.variable, filter: (value: string) => boolean, zone: string) => rows
    .filter(row => filter(context.normalizeText(row.label)) && (row.window_code === 'all' || row.window_code === zone))
    .reduce((total, row) => total + row.price, 0),
  getRangeWindow: () => range,
  aggregateUsageForRange: () => ({ usageKwh: 27.59, pvKwh: 0, storageKwh: 0, purchaseKwh: 27.59, usageByZone: { all: 27.59, day: 22.59, night: 5 }, purchaseByZone: { all: 27.59, day: 22.59, night: 5 } }),
  DASHBOARD_DATA_MODE_REAL: 'real', getDashboardDataMode: () => 'usage_only',
  getBankRangeTotals: () => null, buildPowerFeeUsageByMonth: () => ({}),
  getFixedCostOptions: () => ({}), buildTariffInfo: () => ({}),
  buildMeasuredDepositLedger: () => null, buildSimulationDepositLedger: () => null,
  buildUsageDetailsForCurrentTariff: () => [],
  createTariffCardModel: (total: number, usageKwh: number, usageDetails: unknown[], purchaseKwh: number, breakdown: unknown, savingsPln: number) => ({ total, usageKwh, usageDetails, purchaseKwh, breakdown, savingsPln }),
  state: { range: 'month', anchorDate: '2026-10-01' }
};
vm.createContext(context);
vm.runInContext([...functions.values()].join('\n'), context);
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log(`OK: ${name}`); };

check('G12: zakup i dystrybucja obejmują ładowanie w strefie nocnej', () => {
  const result = context.buildTariffModels({ tariffData: { current: baseline, next: tariff } });
  close(result.next.purchaseKwh, 27.76);
  close(result.next.breakdown.purchaseCost, 22.56 * 0.4 + 5.2 * 0.8);
  close(result.next.breakdown.distributionCost, 22.56 * 0.1 + 5.2 * 0.3 + 27.76 * 0.05);
  close(result.next.total, 20.388);
  close(result.current.total, 29.59);
  close(result.next.usageKwh, 27.59);
  close(result.next.usageDetails[0].value, 27.59);
  close(result.next.usageDetails[1].value, 0);
  close(result.next.usageDetails[2].value, 0);
});

check('przy PV rozpiska zachowuje autokonsumpcję i energię oddaną z magazynu', () => {
  const hours = simulation.days[0].hours;
  simulation.days[0].hours = [{ hour: 12, demandKwh: 10, billedGridPurchaseForLoadKwh: 2, pvToLoadKwh: 5, bankToLoadKwh: 3, gridTopupKwh: 0 } as any];
  const result = context.buildTariffModels({
    tariffData: { current: baseline, next: tariff },
    rawEnergy: { selfConsumptionKwh: 5 }
  });
  close(result.next.usageDetails[0].value, 2);
  close(result.next.usageDetails[1].value, 5);
  close(result.next.usageDetails[2].value, 3);
  simulation.days[0].hours = hours;
});

check('dzień, tydzień, miesiąc i rok używają tej samej pełnej agregacji', () => {
  for (const mode of ['day', 'week', 'month', 'year']) {
    context.state.range = mode;
    close(context.buildTariffModels({ tariffData: { current: baseline, next: tariff } }).next.total, 20.388);
  }
  context.state.range = 'month';
});

check('pobór rozliczony ma pierwszeństwo, ładowanie nie jest liczone podwójnie', () => {
  const hours = simulation.days[0].hours;
  simulation.days[0].hours = [{ hour: 2, demandKwh: 5, billedGridPurchaseForLoadKwh: 3, billedGridTopupKwh: 7, gridTopupKwh: 20, billedGridPurchaseKwh: 10, bankToLoadKwh: 0 } as any];
  const result = context.getProsumerRangeEnergy(range, tariff);
  close(result.gridLoadKwh, 3);
  close(result.gridPurchaseKwh, 10);
  close(result.gridPurchaseByZone.night, 10);
  (simulation.days[0].hours[0] as any).billedGridTopupKwh = 0;
  close(context.getProsumerRangeEnergy(range, tariff).gridPurchaseKwh, 3);
  simulation.days[0].hours = hours;
});

check('ładowanie z PV nie jest zakupem z sieci', () => {
  const hours = simulation.days[0].hours;
  simulation.days[0].hours = [{ hour: 2, demandKwh: 5, billedGridPurchaseForLoadKwh: 5, gridTopupKwh: 0, chargeFromPvKwh: 16, bankToLoadKwh: 0 } as any];
  close(context.getProsumerRangeEnergy(range, tariff).gridPurchaseKwh, 5);
  simulation.days[0].hours = hours;
});

check('format kwartalny silnika prosumenckiego i zakres dat', () => {
  const days = simulation.days;
  (simulation as any).days = [
    { dateKey: '2026-09-30', slots: [{ hour: 2, load: 100, gridBuyLoad: 100, gridBuyBank: 100 }] },
    { dateKey: '2026-10-01', slots: [{ hour: 2, load: 5, gridBuyLoad: 5, billedGridTopupKwh: 16, bankToLoad: 0 }, { hour: 18, actual: false, load: 100, gridBuyLoad: 100 }] }
  ];
  const result = context.getProsumerRangeEnergy(range, tariff);
  close(result.usageKwh, 5); close(result.gridPurchaseKwh, 21); close(result.gridPurchaseByZone.night, 21);
  simulation.days = days;
});

check('historia rzeczywista pozostaje poza ścieżką prognozy magazynu', () => {
  const rangeAggregator = context.getProsumerRangeEnergy;
  context.getDashboardDataMode = () => 'real';
  context.getSummaryForecastSimulation = () => null;
  context.getProsumerRangeEnergy = () => { throw new Error('Nie wolno symulować pomiarów historycznych'); };
  const result = context.buildTariffModels({ tariffData: { current: baseline, next: tariff } });
  close(result.next.purchaseKwh, 27.59);
  close(result.next.total, 5 * 0.4 + 22.59 * 0.8 + 5 * 0.1 + 22.59 * 0.3 + 27.59 * 0.05 + 2);
  context.getProsumerRangeEnergy = rangeAggregator;
});

console.log(`Weryfikacja podsumowania: ${checks}/${checks} OK`);
