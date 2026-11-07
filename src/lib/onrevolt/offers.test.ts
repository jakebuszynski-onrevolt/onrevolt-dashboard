import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOfferScenarioInput,
  mergeConfigurationLineItems,
  normalizeOfferConfigurationIds,
  offerDeleteBlockReason,
  OfferRecalculationError,
  resolveOfferBillingCycleMonths,
  recalculateOfferFromCurrentData,
  selectOfferInvoiceForAnalysisPeriod,
} from './offers';
import { DEFAULT_OFFER_BILLING_CYCLE_MONTHS } from './offer-workspace';
import { calculateEnergyScenario } from './energy-scenario';

test('unlinked reference profile passes daily shape and provenance to the legacy scenario', () => {
  const referenceProfile = { key: 'vdew-1999-g1', name: 'Firma', contentHash: 'a'.repeat(64) };
  const dailyConsumptionKwh = { '2026-01-01': new Array(24).fill(0) };
  const usageProfile: any = { annualKwh: 1200, referenceProfile, dailyConsumptionKwh, warnings: [],
    months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, year: 2026, totalKwh: 100, hourly: new Array(24).fill(100 / 24) })) };
  const input = buildOfferScenarioInput({ annualConsumptionKwh: 1200, profileSource: 'ANNUAL_DECLARATION', usageProfile,
    configurations: [], investmentGross: 0 });
  assert.equal(input.dailyConsumptionKwh, dailyConsumptionKwh);
  assert.equal(input.consumptionProfileProvenance, referenceProfile);
  assert.deepEqual(input.monthlyConsumptionKwh, new Array(12).fill(100));
  assert.throws(() => buildOfferScenarioInput({ annualConsumptionKwh: 1200, profileSource: 'ANNUAL_DECLARATION',
    usageProfile: { ...usageProfile, dailyConsumptionKwh: undefined }, configurations: [], investmentGross: 0 }), /rozkładu dziennego/);
});

test('daily reference profile has a calendar for ordinary tariff snapshots without client history', () => {
  const year = 2026;
  const monthlyTariff = {
    source: 'WINDYONE_RE' as const,
    sourceUrl: 'https://example.test/tariff',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    operator: 'ENEA',
    code: 'G11',
    name: 'G11',
    zoneModel: 'all',
    monthlyZoneCodes: Array.from({ length: 12 }, () => new Array(24).fill('all')),
    zoneRates: [{ code: 'all', label: 'Cała doba', energyGrossPerKwh: 0.6,
      distributionGrossPerKwh: 0.3, totalGrossPerKwh: 0.9 }],
    fixedMonthlyGross: 0,
    fixedCosts: [],
    billingCycleMonths: 1,
  };
  const dailyConsumptionKwh: Record<string, number[]> = {};
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= days; day += 1) {
      dailyConsumptionKwh[`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`]
        = new Array(24).fill(100 / days / 24);
    }
    return { month, year, totalKwh: 100, hourly: new Array(24).fill(100 / 24) };
  });
  const usageProfile: any = { annualKwh: 1200,
    referenceProfile: { key: 'vdew-1999-g1', name: 'Firma', contentHash: 'a'.repeat(64) },
    dailyConsumptionKwh, warnings: [], months };

  const input = buildOfferScenarioInput({ annualConsumptionKwh: 1200, profileSource: 'ANNUAL_DECLARATION', usageProfile,
    configurations: [], investmentGross: 0, currentTariff: monthlyTariff, targetTariff: monthlyTariff });

  assert.equal(input.currentTariffHistory, undefined);
  assert.equal(input.scenarioYear, year);
  assert.deepEqual(input.calendarYearsByMonth, new Array(12).fill(year));
  assert.equal(calculateEnergyScenario(input).annualConsumptionKwh, 1200);
});

test('oferta zachowuje konfigurację główną i usuwa powtórzenia', () => {
  assert.deepEqual(
    normalizeOfferConfigurationIds(['pv', 'battery', 'pv'], 'battery'),
    ['battery', 'pv'],
  );
});

test('pozycje kilku konfiguracji tworzą jeden uporządkowany snapshot', () => {
  const lines = mergeConfigurationLineItems([
    {
      id: 'battery',
      name: 'Magazyn 32 kWh',
      kind: 'ENERGY_STORAGE',
      targetCapacityKwh: 32,
      items: [
        { position: 2, description: 'Falownik', quantity: 1, saleNet: 1000, saleGross: 1080, saleVatRate: 0.08 },
        { position: 1, description: 'Magazyn', quantity: 1, saleNet: 2000, saleGross: 2160, saleVatRate: 0.08 },
      ],
    },
    {
      id: 'pv',
      name: 'Instalacja PV 6 kWp',
      kind: 'PV',
      items: [
        { position: 1, description: 'Panele PV', quantity: 12, saleNet: 3000, saleGross: 3240, saleVatRate: 0.08 },
      ],
    },
  ]);

  assert.deepEqual(lines.map((line) => line.position), [1, 2, 3]);
  assert.deepEqual(lines.map((line) => line.description), ['Magazyn', 'Falownik', 'Panele PV']);
  assert.deepEqual(lines.map((line) => line.sourceConfigurationId), ['battery', 'battery', 'pv']);
  assert.equal(lines[0].sourceConfigurationCapacityKwh, 32);
  assert.equal(lines[2].sourceConfigurationName, 'Instalacja PV 6 kWp');
});

test('ofertę można usunąć tylko bez dalszych powiązań', () => {
  assert.equal(offerDeleteBlockReason({ contracts: 0, installations: 0, purchaseOrders: 0 }), null);
  assert.match(offerDeleteBlockReason({ contracts: 1, installations: 0, purchaseOrders: 0 }) || '', /umowę/);
  assert.match(offerDeleteBlockReason({ contracts: 0, installations: 1, purchaseOrders: 0 }) || '', /montażu/);
  assert.match(offerDeleteBlockReason({ contracts: 0, installations: 0, purchaseOrders: 1 }) || '', /zamówieniem/);
});

test('przeliczenie tworzy pełny scenariusz z rocznego zużycia i dwóch konfiguracji', () => {
  const input = buildOfferScenarioInput({
    annualConsumptionKwh: 5220,
    profileSource: 'ANNUAL_DECLARATION',
    configurations: [
      { name: 'Instalacja PV 5,7 kWp', kind: 'PV_DACH_SKOSNY', targetPowerKw: 5.7 },
      { name: 'Magazyn 16 kWh', kind: 'MAGAZYN', targetPowerKw: 10, targetCapacityKwh: 16 },
    ],
    investmentGross: 40059.12,
  });

  assert.equal(Math.round(input.monthlyConsumptionKwh.reduce((sum, value) => sum + value, 0)), 5220);
  assert.equal(input.pvPowerKw, 5.7);
  assert.equal(input.batteryCapacityKwh, 16);
  assert.equal(input.batteryMaxChargeKw, 10);
  assert.equal(input.investmentGross, 40059.12);
});

test('przeliczenie uwzględnia istniejącą instalację klienta', () => {
  const input = buildOfferScenarioInput({
    annualConsumptionKwh: 6000,
    profileSource: 'ANNUAL_DECLARATION',
    configurations: [
      { name: 'Rozbudowa PV', kind: 'PV_DACH_PLASKI', targetPowerKw: 4 },
      { name: 'Nowy magazyn', kind: 'MAGAZYN', targetPowerKw: 8, targetCapacityKwh: 12 },
    ],
    existingPvKw: 5,
    existingBatteryKwh: 4,
    investmentGross: 30000,
  });

  assert.equal(input.pvPowerKw, 9);
  assert.equal(input.batteryCapacityKwh, 16);
});

test('przeliczenie wskazuje niekompletną konfigurację zamiast używać starej mocy', () => {
  assert.throws(() => buildOfferScenarioInput({
    annualConsumptionKwh: 5000,
    configurations: [{ name: 'PV bez mocy', kind: 'PV_DACH_SKOSNY', targetPowerKw: null }],
    investmentGross: 20000,
  }), /moc docelowa PV/);
});

test('cykl rozliczeniowy oferty pochodzi wyłącznie z faktur w całości objętych okresem analizy', () => {
  const invoices = [
    { id: 'inside', billingCycleMonths: 2, billingPeriodFrom: '2025-10-01', billingPeriodTo: '2025-11-30' },
    { id: 'cross-start', billingCycleMonths: 6, billingPeriodFrom: '2025-09-15', billingPeriodTo: '2025-10-15' },
    { id: 'cross-end', billingCycleMonths: 3, billingPeriodFrom: '2026-09-30', billingPeriodTo: '2026-10-15' },
    { id: 'undated', billingCycleMonths: 12, billingPeriodFrom: null, billingPeriodTo: null },
  ];
  const period = { startMonth: '2025-10', endDate: '2026-09-30' };

  assert.equal(selectOfferInvoiceForAnalysisPeriod(invoices, period)?.id, 'inside');
  assert.equal(selectOfferInvoiceForAnalysisPeriod(invoices.slice(1), period), null);
});

test('tworzenie i przeliczenie oferty przyjmują 2 miesiące tylko bez cyklu na fakturze', () => {
  const period = { startMonth: '2025-10', endDate: '2026-09-30' };
  const withoutInvoice = selectOfferInvoiceForAnalysisPeriod([], period);
  const withExplicitCycle = selectOfferInvoiceForAnalysisPeriod([
    { billingCycleMonths: 6, billingPeriodFrom: '2025-10-01', billingPeriodTo: '2025-11-30' },
  ], period);

  assert.equal(resolveOfferBillingCycleMonths(withoutInvoice?.billingCycleMonths), DEFAULT_OFFER_BILLING_CYCLE_MONTHS);
  assert.equal(resolveOfferBillingCycleMonths(withExplicitCycle?.billingCycleMonths), 6);
  assert.equal(resolveOfferBillingCycleMonths(1), 1);
});

test('zaakceptowana oferta nie przechodzi do odczytu źródeł okresu ani przeliczenia', async () => {
  let invoiceReads = 0;
  const prisma: any = {
    offer: { findUnique: async () => ({ status: 'ACCEPTED' }) },
    document: { findMany: async () => { invoiceReads += 1; return []; } },
  };
  await assert.rejects(() => recalculateOfferFromCurrentData(prisma, 'accepted-offer'), OfferRecalculationError);
  assert.equal(invoiceReads, 0);
});
