import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateClientEnergyCostSummaryOnServer, completeHistoryForSummary } from './client-energy-cost-summary-server';
import type { ClientTariffHistory, ClientTariffPayload } from './client-tariffs';

function tariff(id: number): ClientTariffPayload {
  const variable = [
    { component_key: 'energy', label: 'Energia czynna', net: 0.503, gross: 0.61869, vatRate: 0.23, window_code: 'all' },
    { component_key: 'distribution', label: 'Dystrybucja', net: 0.2456, gross: 0.302088, vatRate: 0.23, window_code: 'all' },
  ];
  return {
    osd_id: 4, tariff_id: id, osd_name: 'ENEA', code: id === 11 ? 'G11' : 'G12', name: 'Tariff', segment: 'G',
    zone_model: 'all', use_monthly: false,
    fixed: [{ component_key: 'subscription', label: 'Abonament', amount: 1.23 }],
    variable: [...variable].reverse().map(({ component_key: _key, ...row }) => ({
      ...row, price: row.label === 'Energia czynna' ? Number(row.gross.toFixed(4)) : row.gross,
    })),
    pricing: { tariffStorage: { priceBasis: 'net', vatRate: 0.23, validFrom: '2025-01-01',
      fixed: [{ component_key: 'subscription', label: 'Abonament', net: 1, gross: 1.23, vatRate: 0.23 }],
      variable,
    } },
  };
}

test('missing dates use only the exact profile period and preserve its price and schedule overrides', async () => {
  const original: ClientTariffHistory = {
    strict: true, revision: 18, byDate: { '2026-01-01': tariff(11) }, tariffs: {}, issues: [
      ...['2026-01-02', '2026-01-03', '2026-01-04'].map(date => ({ date, message: `Wymaga uzupełnienia: brak jednoznacznych cen dla ${date}` })),
    ],
  };
  const calls: Array<Record<string, unknown>> = [];
  const profile = {
    profile: { periods: [
      { id: 'period-a', validFrom: '2026-01-01', validUntil: '2026-01-03', osdId: 4, tariffId: 11,
        source: 'MANUAL', overrides: { energy: { net: 0.7, vatRate: 0.23 } },
        schedule: { zone_model: 'all', use_monthly: true, monthly: { '1': Array(24).fill(1) }, cheap_saturday: false, cheap_sunday: false }, note: '' },
      { id: 'period-b', validFrom: '2026-01-03', validUntil: '2026-01-04', osdId: 4, tariffId: 11,
        source: 'MANUAL', overrides: { energy: { net: 0.9, vatRate: 0.23 } }, schedule: null, note: '' },
      { id: 'period-c', validFrom: '2026-01-04', validUntil: null, osdId: 4, tariffId: 12,
        source: 'ENEA', overrides: {}, schedule: null, note: '' },
    ] },
  };
  const result = await completeHistoryForSummary({
    history: original, clientId: 'client-1', projectId: 'project-1', dates: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'],
  }, {
    clientTariffScope: async () => ({ clientId: 'client-1', projectId: 'project-1' } as any),
    callClientTariffs: async <T>(request: Record<string, unknown>) => {
      calls.push(request);
      if (request.action === 'get') return profile as T;
      return tariff(Number(request.tariffId)) as T;
    },
    tariffToday: () => '2026-10-31',
  });

  const jan2 = result.history.byDate['2026-01-02'] as ClientTariffPayload;
  const jan3 = result.history.byDate['2026-01-03'] as ClientTariffPayload;
  const jan4 = result.history.byDate['2026-01-04'] as ClientTariffPayload;
  assert.equal(jan2.tariff_id, 11);
  assert.equal(jan2.pricing.tariffStorage.variable[0].net, 0.7);
  const jan2Energy = jan2.variable.find(row => row.label === 'Energia czynna');
  const jan2Distribution = jan2.variable.find(row => row.label === 'Dystrybucja');
  assert.equal(jan2Energy?.component_key, 'energy');
  assert.equal(jan2Energy?.price, 0.861);
  assert.equal(jan2Distribution?.component_key, 'distribution');
  assert.equal(jan2Distribution?.price, 0.302088);
  assert.equal(jan2.use_monthly, true);
  assert.equal(jan3.tariff_id, 11);
  assert.equal(jan3.pricing.tariffStorage.variable[0].net, 0.9);
  assert.equal(jan3.variable.find(row => row.component_key === 'energy')?.price, 1.107);
  assert.equal(jan4.tariff_id, 12);
  assert.equal(jan4.variable.find(row => row.component_key === 'energy')?.price, 0.61869);
  assert.equal(jan4.variable.find(row => row.component_key === 'distribution')?.price, 0.302088);
  assert.equal(jan2.variable[0].component_key, 'distribution');
  assert.deepEqual(calls.map(call => call.action), ['get', 'catalog', 'catalog']);
  assert.deepEqual(calls.filter(call => call.action === 'catalog').map(call => [call.osdId, call.tariffId]), [[4, 11], [4, 12]]);
  assert.equal(Object.keys(original.byDate).length, 1);
  assert.ok(result.assumptions[0].includes('3 dni'));
});

test('unknown profile identity leaves historical tariff date missing instead of borrowing the latest tariff', async () => {
  const original: ClientTariffHistory = { strict: true, revision: 18, byDate: { '2026-01-01': tariff(11) }, tariffs: {},
    issues: [{ date: '2026-01-02', message: 'Wymaga uzupełnienia: brak jednoznacznych cen dla 2026-01-02' }] };
  const actions: string[] = [];
  const result = await completeHistoryForSummary({
    history: original, clientId: 'client-1', projectId: 'project-1', dates: ['2026-01-02'],
  }, {
    clientTariffScope: async () => ({ clientId: 'client-1', projectId: 'project-1' } as any),
    callClientTariffs: async <T>(request: Record<string, unknown>) => {
      actions.push(String(request.action));
      return { profile: { periods: [] } } as T;
    },
    tariffToday: () => '2026-10-31',
  });
  assert.equal(result.history.byDate['2026-01-02'], undefined);
  assert.deepEqual(actions, ['get']);
  assert.ok(result.issues.some(issue => issue.includes('brak jednoznacznej datowanej tożsamości')));
  assert.equal(result.assumptions.length, 0);
});

test('ENEA evidence conflicts are never filled from the current catalogue', async () => {
  const history: ClientTariffHistory = {
    strict: true, revision: 18, byDate: { '2026-01-01': tariff(11) }, tariffs: {},
    issues: [{ date: '2026-01-02', message: 'Wymaga uzupełnienia: konflikt ENEA dla 2026-01-02' }],
  };
  let profileReads = 0;
  const result = await completeHistoryForSummary({
    history, clientId: 'client-1', projectId: 'project-1', dates: ['2026-01-02'],
  }, {
    clientTariffScope: async () => ({ clientId: 'client-1', projectId: 'project-1' } as any),
    callClientTariffs: async <T>() => { profileReads += 1; return { profile: { periods: [] } } as T; },
    tariffToday: () => '2026-10-31',
  });
  assert.equal(profileReads, 0);
  assert.equal(result.history.byDate['2026-01-02'], undefined);
  assert.equal(result.assumptions.length, 0);
  assert.ok(result.issues.some(issue => issue.includes('konflikt ENEA')));
});

test('four-decimal catalog normalization does not accept a genuinely different price', async () => {
  const original: ClientTariffHistory = {
    strict: true, revision: 18, byDate: {}, tariffs: {},
    issues: [{ date: '2026-01-02', message: 'Wymaga uzupełnienia: brak jednoznacznych cen dla 2026-01-02' }],
  };
  const mismatchedCatalog = tariff(11);
  mismatchedCatalog.variable = mismatchedCatalog.variable.map(row => row.label === 'Energia czynna'
    ? { ...row, price: 0.6188 }
    : row);
  const result = await completeHistoryForSummary({
    history: original, clientId: 'client-1', projectId: 'project-1', dates: ['2026-01-02'],
  }, {
    clientTariffScope: async () => ({ clientId: 'client-1', projectId: 'project-1' } as any),
    callClientTariffs: async <T>(request: Record<string, unknown>) => {
      if (request.action === 'get') return { profile: { periods: [
        { id: 'period', validFrom: '2026-01-01', validUntil: null, osdId: 4, tariffId: 11,
          source: 'ENEA', overrides: {}, schedule: null, note: '' },
      ] } } as T;
      return mismatchedCatalog as T;
    },
    tariffToday: () => '2026-10-31',
  });
  assert.equal(result.history.byDate['2026-01-02'], undefined);
  assert.ok(result.issues.some(issue => issue.includes('nie odpowiada jej zweryfikowanym wartościom netto/brutto')));
});

test('settled net-metering export does not claim the cost is before export settlement', async () => {
  const tariffHistory: ClientTariffHistory = { strict: true, revision: 1, byDate: {}, tariffs: {}, issues: [] };
  const start = Date.UTC(2026, 0, 1);
  const intervals = Array.from({ length: 24 }, (_, hour) => ({
    localStart: `2026-01-01T${String(hour).padStart(2, '0')}:00:00`,
    localEnd: `2026-01-01T${String(hour + 1).padStart(2, '0')}:00:00`,
    startUtc: new Date(start + hour * 3_600_000).toISOString(),
    endUtc: new Date(start + (hour + 1) * 3_600_000).toISOString(), occurrence: 0,
    import: { valueKwh: 1, source: hour === 20 ? 'estimated' as const : 'measured' as const, fileIds: ['import'] },
    export: { valueKwh: 0.5, source: hour === 19 ? 'estimated' as const : 'measured' as const, fileIds: ['export'] },
  }));
  const summary = await calculateClientEnergyCostSummaryOnServer({
    project: {
      id: 'project-1', clientId: 'client-1', clientType: 'B2C',
      offerWorkspace: { input: { calculation: { billingCycleMonths: 1 } } },
      energyAudits: [{ annualConsumptionKwh: 1000, settlementSystem: 'net-metering', existingPvKw: 5, connectionPowerKw: 10 }],
    },
    period: { startMonth: '2026-01', endMonth: '2026-01', endDate: '2026-01-31',
      fromUtc: '2026-01-01T00:00:00.000Z', untilUtc: '2026-01-02T00:00:00.000Z', periodKeys: ['2026-01'] },
    series: {
      ppeNumber: 'ppe', periods: [{ period: '2026-01', hasImport: true, hasExport: true, missingDirections: [] }],
      missingMonths: [], missingDirections: [], intervals, files: [],
    },
    months: [{ period: '2026-01', importKwh: 24, exportKwh: 12, importAvailable: true, exportAvailable: true }],
  }, {
    invoiceBillingCycleForPeriod: async () => ({ cycleMonths: 1, startMonth: null, crossingCount: 0 }),
    currentScenario: async () => ({ tariffHistory, issues: [] }),
    hourlyMarketPrices: async () => ({ prices: new Map(), issue: null }),
    completeHistoryForSummary: async ({ history }) => ({ history, assumptions: [], issues: [] }),
    priceOfferWorkspaceGrid: () => ({ status: 'ready', vatBasis: 'GROSS', energyPln: 100, distributionPln: 20,
      fixedPln: 10, exportValuePln: null, pricedHours: 24, totalHours: 24, tariffLabels: ['ENEA G11'], issues: [] }),
    billOfferWorkspaceScenario: () => ({ status: 'ready', settlement: 'NET_METERING', vatBasis: 'GROSS',
      period: { startUtc: '2026-01-01T00:00:00.000Z', endUtc: '2026-01-02T00:00:00.000Z' }, warnings: [],
      result: { totals: { cashDuePln: 95 } } } as any),
  } as any);

  assert.equal(summary.settled, true);
  assert.equal(summary.totalPln, 95);
  assert.ok(!summary.assumptions.some(assumption => assumption.includes('przed rozliczeniem oddania')));
  assert.ok(summary.assumptions.includes(
    'Liczba interwałów z danymi oznaczonymi w plikach OSD jako szacowane (import lub eksport): 2. Wynik należy traktować jako szacunek.',
  ));
});
