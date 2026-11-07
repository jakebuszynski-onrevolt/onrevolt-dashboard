import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClientTariffHistory, ClientTariffPayload } from './client-tariffs';
import {
  billOfferWorkspaceScenario,
  calculateOfferWorkspaceBilling,
  continueOfferNetBillingScenario,
  resolveOfferBillingRates,
  resolveOfferBillingRateSeries,
  priceOfferWorkspaceGrid,
  type NetBillingPolicy,
  type NetMeteringPolicy,
  type OfferWorkspaceScenarioResult,
  type OfferBillingIntervalInput,
  type OfferWorkspaceBillingScenarioInput,
  type OfferWorkspaceGridIntervalInput,
} from './offer-workspace-billing';

const context = { annualUsageKwh: 6000, billingCycleMonths: 1, connectionPowerKw: 12 };

function tariff(overrides: { energy?: number; distribution?: number; fixed?: number; vatRate?: number } = {}) {
  const energy = overrides.energy ?? 0.5;
  const distribution = overrides.distribution ?? 0.1;
  const fixed = overrides.fixed ?? 31;
  const vatRate = overrides.vatRate ?? 0.23;
  const variableNet = [
    { component_key: 'energy', label: 'Energia czynna', net: energy, gross: energy * (1 + vatRate), vatRate, window_code: 'all' },
    { component_key: 'distribution', label: 'Opłata sieciowa zmienna', net: distribution, gross: distribution * (1 + vatRate), vatRate, window_code: 'all' },
  ];
  return {
    osd_id: 1, tariff_id: 1, code: 'G11', name: 'G11', segment: 'G',
    zone_model: 'all', use_monthly: false,
    fixed: [{ component_key: 'subscription', label: 'Abonament', amount: fixed * (1 + vatRate) }],
    variable: variableNet.map(row => ({ ...row, price: row.gross })),
    pricing: { tariffStorage: {
      priceBasis: 'net', vatRate, validFrom: '2026-01-01',
      fixed: [{ component_key: 'subscription', label: 'Abonament', net: fixed, gross: fixed * (1 + vatRate), vatRate }],
      variable: variableNet,
    } },
  } as unknown as ClientTariffPayload;
}

function semanticTariff(options: { duplicateFixedIdentity?: boolean } = {}): ClientTariffPayload {
  const vatRate = 0.23;
  const fixed = options.duplicateFixedIdentity
    ? [
      { key: 'fixed-a', label: 'Opłata stała', amount_mode: 'flat_month', billing_cycle_months: null,
        annual_usage_min_kwh: null, annual_usage_max_kwh: null, net: 1 },
      { key: 'fixed-b', label: 'Opłata stała', amount_mode: 'flat_month', billing_cycle_months: null,
        annual_usage_min_kwh: null, annual_usage_max_kwh: null, net: 2 },
    ]
    : [
      { key: 'network', label: 'Opłata sieciowa', amount_mode: 'flat_month', billing_cycle_months: null,
        annual_usage_min_kwh: null, annual_usage_max_kwh: null, net: 14.56 },
      { key: 'subscription-1', label: 'Opłata abonamentowa', amount_mode: 'flat_month', billing_cycle_months: 1,
        annual_usage_min_kwh: null, annual_usage_max_kwh: null, net: 3.84 },
      { key: 'subscription-2', label: 'Opłata abonamentowa', amount_mode: 'flat_month', billing_cycle_months: 2,
        annual_usage_min_kwh: null, annual_usage_max_kwh: null, net: 1.92 },
    ];
  const variable = [
    { key: 'energy-low', label: 'Energia czynna', window_code: 'low', net: 0.28 },
    { key: 'energy-high', label: 'Energia czynna', window_code: 'high', net: 0.65 },
    { key: 'distribution-low', label: 'Opłata sieciowa', window_code: 'low', net: 0.073 },
    { key: 'distribution-high', label: 'Opłata sieciowa', window_code: 'high', net: 0.3032 },
    { key: 'quality', label: 'Opłata jakościowa', window_code: 'all', net: 0.0332 },
  ];
  const withGross = <T extends { key: string; net: number }>(row: T) => ({
    ...row, gross: row.net * (1 + vatRate), vatRate, component_key: row.key,
  });
  return {
    osd_id: 1, tariff_id: 1, code: 'G13', name: 'G13', segment: 'G',
    zone_model: 'highmidlow', use_monthly: true,
    monthly: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [String(index + 1), Array(24).fill(1)])),
    fixed: fixed.map(({ key: _key, net, ...row }) => ({ ...row, amount: net * (1 + vatRate) })),
    variable: variable.map(({ key: _key, net, ...row }) => ({ ...row, price: net * (1 + vatRate) })),
    pricing: { tariffStorage: {
      priceBasis: 'net', vatRate, validFrom: '2026-01-01',
      fixed: [...fixed].reverse().map(withGross),
      variable: [...variable].reverse().map(withGross),
    } },
  } as unknown as ClientTariffPayload;
}

function rdnTariff() {
  const value = tariff() as ClientTariffPayload & Record<string, any>;
  value.sell_method = 'rdn';
  value.osd_add_rdn = 0.1 * 1.23;
  value.osd_add_akcyza = 0.02 * 1.23;
  (value.pricing.tariffStorage as unknown as Record<string, unknown>).market = {
    verified: true,
    margin: { net: 0.1, gross: 0.123, vatRate: 0.23 },
    excise: { net: 0.02, gross: 0.0246, vatRate: 0.23 },
  };
  return value as unknown as ClientTariffPayload;
}

function history(dates: string[], value = tariff()): ClientTariffHistory {
  return {
    strict: true, revision: 1, byDate: Object.fromEntries(dates.map((date) => [date, value])),
    tariffs: {}, issues: [],
  };
}

function makeIntervals(
  startUtc: string,
  endUtc: string,
  minutes: 15 | 60,
  flow: (index: number, start: string) => Pick<OfferBillingIntervalInput, 'importKwh' | 'exportKwh'> = () => ({ importKwh: 0, exportKwh: 0 }),
): OfferBillingIntervalInput[] {
  const intervals: OfferBillingIntervalInput[] = [];
  const end = Date.parse(endUtc);
  for (let start = Date.parse(startUtc), index = 0; start < end; start += minutes * 60000, index += 1) {
    const next = start + minutes * 60000;
    const startIso = new Date(start).toISOString();
    intervals.push({ startUtc: startIso, endUtc: new Date(next).toISOString(), ...flow(index, startIso) });
  }
  return intervals;
}

function netMetering(overrides: Partial<NetMeteringPolicy> = {}): NetMeteringPolicy {
  return {
    mode: 'NET_METERING', netMeteringRatio: 0.8, initialCreditKwh: 0,
    initialCreditLots: [], creditExpiryMonths: 12,
    coverage: 'ENERGY_ONLY', fixedChargeTreatment: 'ALWAYS_BILLED', ...overrides,
  };
}

function netBilling(
  startUtc: string,
  endUtc: string,
  overrides: Partial<NetBillingPolicy> = {},
): NetBillingPolicy {
  return {
    mode: 'NET_BILLING', initialDeposit: [],
    exportUnitPrices: [{ startUtc, endUtc, depositCreditPricePlnPerKwh: 0.8, refundCapPricePlnPerKwh: 0.8 }],
    exportPriceMethod: 'RCE',
    creditingDelayMonths: 1, depositExpiryMonths: 12, expiredRefundRate: 0,
    depositCoverage: 'ENERGY_ONLY', fixedChargeTreatment: 'ALWAYS_BILLED',
    ...overrides,
  };
}

function scenario(
  tariffHistory: ClientTariffHistory,
  settlement: NetMeteringPolicy | NetBillingPolicy,
  intervals: OfferBillingIntervalInput[],
): OfferWorkspaceBillingScenarioInput {
  return { tariffHistory, settlement, intervals };
}

function ready<T extends { status: string }>(value: T): asserts value is T & { status: 'ready' } {
  assert.equal(value.status, 'ready', JSON.stringify(value));
}

test('compares separate historical and target tariff histories and settlement policies over the same UTC axis', () => {
  const startUtc = '2026-01-30T23:00:00.000Z';
  const endUtc = '2026-01-31T23:00:00.000Z';
  const baseline = makeIntervals(startUtc, endUtc, 60, (index) => index === 0
    ? { importKwh: 2, exportKwh: 0 } : { importKwh: 0, exportKwh: 0 });
  const after = makeIntervals(startUtc, endUtc, 60, (index) => index === 0
    ? { importKwh: 3, exportKwh: 1 } : { importKwh: 0, exportKwh: 0 });
  const result = calculateOfferWorkspaceBilling({
    context, vatBasis: 'NET',
    baseline: scenario(history(['2026-01-31'], tariff()), netMetering(), baseline),
    after: scenario(history(['2026-01-31'], tariff({ energy: 0.8, distribution: 0.2 })),
      netBilling(startUtc, endUtc), after),
  });

  ready(result);
  assert.equal(result.baseline.settlement, 'NET_METERING');
  assert.equal(result.after.settlement, 'NET_BILLING');
  assert.match(result.baseline.warnings.join(' '), /saldo początkowe wynosi 0 kWh/iu);
  assert.equal(result.baseline.result.months[0].energyCostPln, 1);
  assert.equal(result.baseline.result.months[0].distributionCostPln, 0.2);
  assert.ok(Math.abs(result.after.result.months[0].energyCostPln - 1.6) < 1e-10);
  assert.ok(Math.abs(result.after.result.months[0].distributionCostPln - 0.4) < 1e-10);
  assert.equal(result.after.result.months[0].exportValuePln, 0);
  assert.equal(result.after.result.months[0].pendingDepositPln, 0);
  assert.equal(result.after.result.intervals[0].billedImportKwh, 2);
  assert.match(result.after.warnings.join(' '), /dłuższego niż 15 minut/iu);
});

test('net-metering nets later 15-minute exports across the monthly cycle and keeps fees visible', () => {
  const startUtc = '2026-01-01T23:00:00.000Z';
  const endUtc = '2026-01-02T23:00:00.000Z';
  const intervals = makeIntervals(startUtc, endUtc, 15, (index) => {
    if (index === 0) return { importKwh: 1, exportKwh: 0 };
    if (index === 4) return { importKwh: 1, exportKwh: 0 };
    if (index === 8) return { importKwh: 0, exportKwh: 2 };
    return { importKwh: 0, exportKwh: 0 };
  });
  const result = billOfferWorkspaceScenario({
    tariffHistory: history(['2026-01-02']), context, vatBasis: 'NET',
    settlement: netMetering(), intervals,
  });

  ready(result);
  const month = result.result.months[0];
  assert.equal(month.billedExportKwh, 2);
  assert.ok(Math.abs(month.billedImportKwh - 0.4) < 1e-10);
  assert.equal(month.creditAddedKwh, 1.6);
  assert.equal(month.creditUsedKwh, 1.6);
  assert.ok(Math.abs(month.energyCostPln - 0.2) < 1e-10);
  assert.ok(Math.abs(month.distributionCostPln - 0.2) < 1e-10);
  assert.ok(Math.abs(month.fixedCostPln - 1) < 1e-10);
  assert.equal(month.creditBalanceKwh, 0);
});

test('net-billing applies deposits chronologically, oldest first, with explicit expiry and refund cap', () => {
  const startUtc = '2026-01-30T23:00:00Z';
  const endUtc = '2026-01-31T23:00:00Z';
  const allStart = startUtc;
  const allEnd = '2026-02-01T23:00:00Z';
  const intervals = makeIntervals(allStart, allEnd, 60, (index) => {
    if (index === 0) return { importKwh: 1, exportKwh: 0 };
    if (index === 1) return { importKwh: 0, exportKwh: 2 };
    if (index === 24) return { importKwh: 1, exportKwh: 0 };
    return { importKwh: 0, exportKwh: 0 };
  });
  const policy = netBilling(allStart, allEnd, {
    initialDeposit: [{ amountPln: 2, creditedMonth: '2025-12', expiresMonth: '2026-02', refundCapPln: 0.5 }],
    exportUnitPrices: [{ startUtc: allStart, endUtc: allEnd,
      depositCreditPricePlnPerKwh: 1.23, refundCapPricePlnPerKwh: 1 }],
    expiredRefundRate: 0.3,
  });
  const tariffHistory = history(['2026-01-31', '2026-02-01']);
  const result = billOfferWorkspaceScenario({
    tariffHistory, context, vatBasis: 'NET', settlement: policy, intervals,
  });

  ready(result);
  const [january, february] = result.result.months;
  assert.equal(january.depositUsedPln, 0.5);
  assert.ok(Math.abs(january.depositEarnedPln - 2.46) < 1e-10);
  assert.equal(january.depositBalancePln, 1.5);
  assert.ok(Math.abs(january.pendingDepositPln - 2.46) < 1e-10);
  assert.ok(Math.abs(february.depositExpiredPln - 1.35) < 1e-10);
  assert.ok(Math.abs(february.depositRefundedPln - 0.15) < 1e-10);
  assert.equal(february.depositUsedPln, 0.5);
  assert.ok(Math.abs(february.depositBalancePln - 1.96) < 1e-10);
  assert.equal(result.result.intervals[0].depositUsedPln, 0.5);
  assert.equal(result.result.intervals[24].depositUsedPln, 0.5);
});

test('net-billing carries active and pending deposit lots continuously across December, January and the following month', () => {
  const startUtc = '2026-11-30T23:00:00Z';
  const endUtc = '2027-02-28T23:00:00Z';
  const intervals = makeIntervals(startUtc, endUtc, 60, (index) => {
    if (index === 30 * 24) return { importKwh: 0, exportKwh: 1 };
    if (index === 31 * 24) return { importKwh: 1, exportKwh: 0 };
    if (index === 61 * 24) return { importKwh: 0, exportKwh: 2 };
    if (index === 62 * 24) return { importKwh: 2, exportKwh: 0 };
    return { importKwh: 0, exportKwh: 0 };
  });
  const dates = Array.from({ length: 90 }, (_, day) =>
    new Date(Date.UTC(2026, 11, 1 + day)).toISOString().slice(0, 10));
  const result = billOfferWorkspaceScenario({
    tariffHistory: history(dates), context, vatBasis: 'NET', intervals,
    settlement: netBilling(startUtc, endUtc, {
      initialDeposit: [{ amountPln: 2, creditedMonth: '2026-01', expiresMonth: '2027-01', refundCapPln: 0.5 }],
      expiredRefundRate: 0.3,
    }),
  });

  ready(result);
  const [december, january, february] = result.result.months;
  assert.deepEqual([december.month, january.month, february.month], ['2026-12', '2027-01', '2027-02']);

  assert.equal(december.depositBalancePln, 2);
  assert.ok(Math.abs(december.depositEarnedPln - 0.8) < 1e-10);
  assert.equal(december.depositUsedPln, 0);
  assert.ok(Math.abs(december.pendingDepositPln - 0.8) < 1e-10);

  assert.ok(Math.abs(january.depositExpiredPln - 1.85) < 1e-10);
  assert.ok(Math.abs(january.depositRefundedPln - 0.15) < 1e-10);
  assert.ok(Math.abs(january.depositEarnedPln - 1.6) < 1e-10);
  assert.ok(Math.abs(january.depositUsedPln - 0.5) < 1e-10);
  assert.equal(january.energyCostPln, 0);
  assert.ok(Math.abs(january.depositBalancePln - 0.3) < 1e-10);
  assert.ok(Math.abs(january.pendingDepositPln - 1.6) < 1e-10);

  assert.ok(Math.abs(february.depositUsedPln - 1) < 1e-10);
  assert.equal(february.energyCostPln, 0);
  assert.ok(Math.abs(february.depositBalancePln - 0.9) < 1e-10);
  assert.equal(february.pendingDepositPln, 0);

  for (const month of [december, january, february]) {
    assert.ok(Math.abs(month.cashDuePln - month.energyCostPln - month.distributionCostPln - month.fixedCostPln) < 1e-9);
  }
  assert.ok(Math.abs(result.result.totals.depositEarnedPln - 2.4) < 1e-10);
  assert.ok(Math.abs(result.result.totals.depositUsedPln - 1.5) < 1e-10);
  assert.ok(Math.abs(result.result.totals.depositRefundedPln - 0.15) < 1e-10);
  assert.ok(Math.abs(result.result.totals.cashDuePln
    - december.cashDuePln - january.cashDuePln - february.cashDuePln) < 1e-9);
});

test('net-billing continuation matches one continuous run across two and three full-month periods', () => {
  const startUtc = '2026-11-30T23:00:00Z';
  const endUtc = '2027-02-28T23:00:00Z';
  const intervals = makeIntervals(startUtc, endUtc, 60, (index) => {
    if (index === 30 * 24) return { importKwh: 0, exportKwh: 1 };
    if (index === 31 * 24) return { importKwh: 0.25, exportKwh: 0 };
    if (index === 61 * 24) return { importKwh: 0, exportKwh: 2 };
    if (index === 62 * 24) return { importKwh: 0.25, exportKwh: 0 };
    return { importKwh: 0, exportKwh: 0 };
  });
  const dates = Array.from({ length: 90 }, (_, day) =>
    new Date(Date.UTC(2026, 11, 1 + day)).toISOString().slice(0, 10));
  const initialDeposit = [
    { amountPln: 0.2, creditedMonth: '2026-12', expiresMonth: '2027-03', refundCapPln: 0.1 },
    { amountPln: 0.3, creditedMonth: '2026-12', expiresMonth: '2027-03', refundCapPln: 0.3 },
    { amountPln: 2, creditedMonth: '2026-01', expiresMonth: '2027-01', refundCapPln: 0.5 },
  ];
  const continuous = billOfferWorkspaceScenario({
    tariffHistory: history(dates), context, vatBasis: 'NET', intervals,
    settlement: netBilling(startUtc, endUtc, { initialDeposit, expiredRefundRate: 0.3 }),
  });
  ready(continuous);

  for (const cuts of [[31 * 24], [31 * 24, 62 * 24]]) {
    const boundaries = [0, ...cuts, intervals.length];
    const periods: OfferWorkspaceScenarioResult[] = [];
    for (let periodIndex = 0; periodIndex < boundaries.length - 1; periodIndex += 1) {
      const periodIntervals = intervals.slice(boundaries[periodIndex], boundaries[periodIndex + 1]);
      const periodInput = {
        tariffHistory: history(dates), context, vatBasis: 'NET' as const, intervals: periodIntervals,
        settlement: netBilling(startUtc, endUtc, {
          initialDeposit: periodIndex === 0 ? initialDeposit : [], expiredRefundRate: 0.3,
        }),
      };
      const previous = periods.at(-1);
      const period = previous
        ? continueOfferNetBillingScenario(previous, periodInput)
        : billOfferWorkspaceScenario(periodInput);
      ready(period);
      periods.push(period);
    }

    assert.deepEqual(periods.flatMap((period) => period.result.intervals), continuous.result.intervals);
    assert.deepEqual(periods.flatMap((period) => period.result.months), continuous.result.months);
    assert.deepEqual(
      periods.at(-1)!.result.netBillingContinuation?.lots,
      continuous.result.netBillingContinuation?.lots,
    );
  }

  const ending = continuous.result.netBillingContinuation!;
  assert.equal(ending.currency, 'PLN');
  assert.equal(ending.vatBasis, 'NET');
  assert.deepEqual(ending.lots.map(({ status }) => status), ['active', 'active', 'active']);
  assert.deepEqual(ending.lots.map(({ fifoOrder }) => fifoOrder), [1, 3, 4]);
  assert.deepEqual(ending.lots.map(({ creditedMonth, expiresMonth, refundCapPln }) =>
    [creditedMonth, expiresMonth, refundCapPln]), [
    ['2026-12', '2027-03', 0.3],
    ['2027-01', '2028-01', 0.8],
    ['2027-02', '2028-02', 1.6],
  ]);
  assert.ok(Math.abs(ending.lots[0].amountPln - 0.25) < 1e-10);
  assert.ok(Math.abs(continuous.result.months[1].depositExpiredPln - 1.85) < 1e-10);
  assert.ok(Math.abs(continuous.result.months[1].depositRefundedPln - 0.15) < 1e-10);
  assert.ok(Math.abs(continuous.result.months[1].depositUsedPln - 0.125) < 1e-10);
  assert.ok(Math.abs(continuous.result.months[2].depositUsedPln - 0.125) < 1e-10);
});

test('two full hourly years split at New Year match continuous net-billing with December carry and year-two expiry', () => {
  const startUtc = '2025-12-31T23:00:00Z';
  const firstYearEndUtc = '2026-12-31T23:00:00.000Z';
  const endUtc = '2027-12-31T23:00:00Z';
  const events = new Map<string, Pick<OfferBillingIntervalInput, 'importKwh' | 'exportKwh'>>([
    ['2026-11-29T23:00:00.000Z', { importKwh: 0, exportKwh: 2 }],
    ['2026-12-30T23:00:00.000Z', { importKwh: 0, exportKwh: 1 }],
    ['2026-12-31T23:00:00.000Z', { importKwh: 1, exportKwh: 0 }],
    ['2027-12-30T23:00:00.000Z', { importKwh: 0, exportKwh: 1.5 }],
  ]);
  const intervals = makeIntervals(startUtc, endUtc, 60, (_index, intervalStart) =>
    events.get(intervalStart) || { importKwh: 0, exportKwh: 0 });
  assert.equal(intervals.length, 2 * 365 * 24);
  const splitIndex = intervals.findIndex((interval) => interval.startUtc === firstYearEndUtc);
  assert.equal(splitIndex, 365 * 24);
  const dates = Array.from({ length: 730 }, (_, day) =>
    new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10));
  const initialDeposit = [{
    amountPln: 2, creditedMonth: '2026-01', expiresMonth: '2027-01', refundCapPln: 0.5,
  }];
  const continuous = billOfferWorkspaceScenario({
    tariffHistory: history(dates), context, vatBasis: 'NET', intervals,
    settlement: netBilling(startUtc, endUtc, { initialDeposit, expiredRefundRate: 0.3 }),
  });
  ready(continuous);

  const firstYear = billOfferWorkspaceScenario({
    tariffHistory: history(dates), context, vatBasis: 'NET', intervals: intervals.slice(0, splitIndex),
    settlement: netBilling(startUtc, firstYearEndUtc, { initialDeposit, expiredRefundRate: 0.3 }),
  });
  ready(firstYear);
  const secondYear = continueOfferNetBillingScenario(firstYear, {
    tariffHistory: history(dates), context, vatBasis: 'NET', intervals: intervals.slice(splitIndex),
    settlement: netBilling(firstYearEndUtc, endUtc, { expiredRefundRate: 0.3 }),
  });
  ready(secondYear);

  assert.deepEqual([...firstYear.result.intervals, ...secondYear.result.intervals], continuous.result.intervals);
  assert.deepEqual([...firstYear.result.months, ...secondYear.result.months], continuous.result.months);
  assert.deepEqual(secondYear.result.netBillingContinuation?.lots, continuous.result.netBillingContinuation?.lots);

  const months = new Map(continuous.result.months.map((month) => [month.month, month]));
  const december2026 = months.get('2026-12')!;
  const january2027 = months.get('2027-01')!;
  const december2027 = months.get('2027-12')!;
  assert.ok(Math.abs(december2026.depositEarnedPln - 0.8) < 1e-10);
  assert.ok(Math.abs(december2026.pendingDepositPln - 0.8) < 1e-10);
  assert.ok(Math.abs(january2027.depositExpiredPln - 1.85) < 1e-10);
  assert.ok(Math.abs(january2027.depositRefundedPln - 0.15) < 1e-10);
  assert.ok(Math.abs(january2027.depositUsedPln - 0.5) < 1e-10);
  assert.ok(Math.abs(january2027.depositBalancePln - 1.9) < 1e-10);
  assert.ok(Math.abs(december2027.depositExpiredPln - 0.62) < 1e-10);
  assert.ok(Math.abs(december2027.depositRefundedPln - 0.48) < 1e-10);

  const endingLots = continuous.result.netBillingContinuation!.lots;
  assert.deepEqual(endingLots.map(({ creditedMonth, expiresMonth, status }) =>
    [creditedMonth, expiresMonth, status]), [
    ['2027-01', '2028-01', 'active'],
    ['2028-01', '2029-01', 'pending'],
  ]);
  assert.ok(Math.abs(endingLots[0].amountPln - 0.8) < 1e-10);
  assert.equal(endingLots[0].refundCapPln, 0.8);
  assert.ok(Math.abs(endingLots[1].amountPln - 1.2) < 1e-10);
  assert.ok(Math.abs(endingLots[1].refundCapPln! - 1.2) < 1e-10);
});

test('two-year continuation preserves a positive floating-point deposit remainder without rounding', () => {
  const startUtc = '2025-12-31T23:00:00Z';
  const firstYearEndUtc = '2026-12-31T23:00:00.000Z';
  const endUtc = '2027-12-31T23:00:00Z';
  const events = new Map<string, Pick<OfferBillingIntervalInput, 'importKwh' | 'exportKwh'>>([
    ['2026-12-30T23:00:00.000Z', { importKwh: 0, exportKwh: 0.1 }],
    ['2026-12-31T00:00:00.000Z', { importKwh: 0, exportKwh: 0.2 }],
    ['2026-12-31T23:00:00.000Z', { importKwh: 0.6, exportKwh: 0 }],
  ]);
  const intervals = makeIntervals(startUtc, endUtc, 60, (_index, intervalStart) =>
    events.get(intervalStart) || { importKwh: 0, exportKwh: 0 });
  assert.equal(intervals.length, 2 * 365 * 24);
  const splitIndex = intervals.findIndex((interval) => interval.startUtc === firstYearEndUtc);
  assert.equal(splitIndex, 365 * 24);
  const dates = Array.from({ length: 730 }, (_, day) =>
    new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10));
  const exportUnitPrices = [{ startUtc, endUtc, depositCreditPricePlnPerKwh: 1 }];
  const continuous = billOfferWorkspaceScenario({
    tariffHistory: history(dates), context, vatBasis: 'NET', intervals,
    settlement: netBilling(startUtc, endUtc, { exportUnitPrices }),
  });
  ready(continuous);

  const firstYear = billOfferWorkspaceScenario({
    tariffHistory: history(dates), context, vatBasis: 'NET', intervals: intervals.slice(0, splitIndex),
    settlement: netBilling(startUtc, firstYearEndUtc, { exportUnitPrices }),
  });
  ready(firstYear);
  const firstYearPending = firstYear.result.netBillingContinuation!.lots[0];
  assert.equal(firstYearPending.status, 'pending');
  assert.equal(firstYearPending.refundCapPln, null);
  assert.equal(firstYearPending.amountPln, 0.1 + 0.2);

  const secondYear = continueOfferNetBillingScenario(firstYear, {
    tariffHistory: history(dates), context, vatBasis: 'NET', intervals: intervals.slice(splitIndex),
    settlement: netBilling(firstYearEndUtc, endUtc, { exportUnitPrices }),
  });
  ready(secondYear);
  assert.deepEqual([...firstYear.result.intervals, ...secondYear.result.intervals], continuous.result.intervals);
  assert.deepEqual([...firstYear.result.months, ...secondYear.result.months], continuous.result.months);
  assert.deepEqual(secondYear.result.netBillingContinuation?.lots, continuous.result.netBillingContinuation?.lots);

  const remainder = secondYear.result.netBillingContinuation!.lots[0];
  assert.equal(remainder.status, 'active');
  assert.equal(remainder.refundCapPln, null);
  assert.equal(remainder.amountPln, 0.1 + 0.2 - 0.3);
  assert.ok(remainder.amountPln > 0);
});

test('net-billing continuation preserves unknown refund caps and blocks unsafe or non-contiguous resumes', () => {
  const decemberStart = '2026-11-30T23:00:00Z';
  const januaryStart = '2026-12-31T23:00:00Z';
  const februaryStart = '2027-01-31T23:00:00Z';
  const marchStart = '2027-02-28T23:00:00Z';
  const decemberIntervals = makeIntervals(decemberStart, januaryStart, 60, (index) =>
    index === 0 ? { importKwh: 0, exportKwh: 1 } : { importKwh: 0, exportKwh: 0 });
  const dates = Array.from({ length: 90 }, (_, day) =>
    new Date(Date.UTC(2026, 11, 1 + day)).toISOString().slice(0, 10));
  const december = billOfferWorkspaceScenario({
    tariffHistory: history(dates), context, vatBasis: 'NET', intervals: decemberIntervals,
    settlement: netBilling(decemberStart, januaryStart, {
      exportUnitPrices: [{ startUtc: decemberStart, endUtc: januaryStart, depositCreditPricePlnPerKwh: 0.8 }],
    }),
  });
  ready(december);
  assert.equal(december.result.netBillingContinuation?.lots[0].refundCapPln, null);
  assert.equal(december.result.netBillingContinuation?.lots[0].status, 'pending');

  const januaryIntervals = makeIntervals(januaryStart, februaryStart, 60);
  const januaryInput = (overrides: Partial<NetBillingPolicy> = {}) => ({
    tariffHistory: history(dates), context, vatBasis: 'NET' as const, intervals: januaryIntervals,
    settlement: netBilling(januaryStart, februaryStart, overrides),
  });
  const continued = continueOfferNetBillingScenario(december, januaryInput());
  ready(continued);
  assert.equal(continued.result.netBillingContinuation?.lots[0].refundCapPln, null);
  assert.equal(continued.result.netBillingContinuation?.lots[0].status, 'active');

  const withRefund = continueOfferNetBillingScenario(december, januaryInput({
    expiredRefundRate: 0.3,
    exportUnitPrices: [{ startUtc: januaryStart, endUtc: februaryStart,
      depositCreditPricePlnPerKwh: 0.8, refundCapPricePlnPerKwh: 0.8 }],
  }));
  assert.equal(withRefund.status, 'blocked');
  if (withRefund.status === 'blocked') assert.match(withRefund.reasons[0], /refundCap/u);

  const wrongBasis = continueOfferNetBillingScenario(december, {
    ...januaryInput(), vatBasis: 'GROSS',
  });
  assert.equal(wrongBasis.status, 'blocked');
  if (wrongBasis.status === 'blocked') assert.match(wrongBasis.reasons[0], /NET\/GROSS/u);

  const wrongMode = continueOfferNetBillingScenario(december, {
    ...januaryInput(), settlement: netMetering(),
  });
  assert.equal(wrongMode.status, 'blocked');
  if (wrongMode.status === 'blocked') assert.match(wrongMode.reasons[0], /NET_BILLING/u);

  const duplicateOpeningBalance = continueOfferNetBillingScenario(december, januaryInput({
    initialDeposit: [{ amountPln: 1, creditedMonth: '2026-12', expiresMonth: '2027-12', refundCapPln: 1 }],
  }));
  assert.equal(duplicateOpeningBalance.status, 'blocked');
  if (duplicateOpeningBalance.status === 'blocked') assert.match(duplicateOpeningBalance.reasons[0], /initialDeposit/u);

  const missingMonth = continueOfferNetBillingScenario(december, {
    ...januaryInput(), intervals: makeIntervals(februaryStart, marchStart, 60),
  });
  assert.equal(missingMonth.status, 'blocked');
  if (missingMonth.status === 'blocked') assert.match(missingMonth.reasons[0], /luka lub nakładanie/u);

  const overlappingMonth = continueOfferNetBillingScenario(december, {
    ...januaryInput(), intervals: decemberIntervals,
  });
  assert.equal(overlappingMonth.status, 'blocked');
  if (overlappingMonth.status === 'blocked') assert.match(overlappingMonth.reasons[0], /luka lub nakładanie/u);

  const partialMonth = continueOfferNetBillingScenario(december, {
    ...januaryInput(), intervals: januaryIntervals.slice(24),
  });
  assert.equal(partialMonth.status, 'blocked');
  if (partialMonth.status === 'blocked') assert.match(partialMonth.reasons[0], /Europe\/Warsaw/u);
});

test('net-billing nets quarter-hour import and export within one hour and counts deposit use once in cash due', () => {
  const startUtc = '2026-01-01T23:00:00Z';
  const endUtc = '2026-01-02T23:00:00Z';
  const intervals = makeIntervals(startUtc, endUtc, 15, (index) => {
    if (index === 0) return { importKwh: 3, exportKwh: 0 };
    if (index === 3) return { importKwh: 0, exportKwh: 1 };
    return { importKwh: 0, exportKwh: 0 };
  });
  const result = billOfferWorkspaceScenario({
    tariffHistory: history(['2026-01-02']), context, vatBasis: 'NET', intervals,
    settlement: netBilling(startUtc, endUtc, {
      initialDeposit: [{ amountPln: 0.5, creditedMonth: '2025-12', expiresMonth: '2026-12', refundCapPln: 0 }],
    }),
  });

  ready(result);
  const month = result.result.months[0];
  assert.equal(month.billedImportKwh, 2);
  assert.equal(month.billedExportKwh, 0);
  assert.equal(month.depositEarnedPln, 0);
  assert.equal(month.depositUsedPln, 0.5);
  assert.equal(month.energyCostPln, 0.5);
  assert.ok(Math.abs(month.distributionCostPln - 0.2) < 1e-10);
  assert.ok(Math.abs(month.cashDuePln - 1.7) < 1e-10);
});

test('net-billing keeps the two autumn repeated hours separate when balancing quarter-hour flows', () => {
  const startUtc = '2026-10-24T22:00:00Z';
  const endUtc = '2026-10-25T23:00:00Z';
  const intervals = makeIntervals(startUtc, endUtc, 15, (index) => {
    if (index === 8) return { importKwh: 3, exportKwh: 0 };
    if (index === 12) return { importKwh: 0, exportKwh: 1 };
    return { importKwh: 0, exportKwh: 0 };
  });
  const result = billOfferWorkspaceScenario({
    tariffHistory: history(['2026-10-25']), context, vatBasis: 'NET', intervals,
    settlement: netBilling(startUtc, endUtc),
  });

  ready(result);
  assert.equal(result.result.months[0].billedImportKwh, 3);
  assert.equal(result.result.months[0].billedExportKwh, 1);
  assert.equal(result.result.months[0].exportValuePln, 0.8);
});

test('spring and autumn DST preserve every 15-minute UTC interval and full local-day fixed fee', () => {
  const days = [
    { date: '2026-03-29', start: '2026-03-28T23:00:00Z', end: '2026-03-29T22:00:00Z', count: 92 },
    { date: '2026-10-25', start: '2026-10-24T22:00:00Z', end: '2026-10-25T23:00:00Z', count: 100 },
  ];
  for (const day of days) {
    const intervals = makeIntervals(day.start, day.end, 15, () => ({ importKwh: 0.25, exportKwh: 0 }));
    const result = billOfferWorkspaceScenario({
      tariffHistory: history([day.date]), context, vatBasis: 'NET',
      settlement: netMetering(), intervals,
    });
    ready(result);
    assert.equal(result.result.intervals.length, day.count);
    assert.equal(result.result.months[0].importKwh, day.count * 0.25);
    assert.ok(Math.abs(result.result.months[0].fixedCostPln - 1) < 1e-10);
  }
});

test('hourly autumn DST repeated wall-clock hour remains two distinct chronological intervals', () => {
  const intervals = makeIntervals('2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z', 60,
    () => ({ importKwh: 1, exportKwh: 0 }));
  const result = billOfferWorkspaceScenario({
    tariffHistory: history(['2026-10-25']), context, vatBasis: 'NET',
    settlement: netMetering(), intervals,
  });

  ready(result);
  assert.equal(intervals.length, 25);
  assert.equal(result.result.months[0].importKwh, 25);
  assert.equal(result.result.months[0].energyCostPln, 12.5);
});

test('month boundary splits fixed charges and preserves imported grid charging energy', () => {
  const startUtc = '2026-01-30T23:00:00Z';
  const endUtc = '2026-02-01T23:00:00Z';
  const intervals = makeIntervals(startUtc, endUtc, 60, (index) => index === 4
    ? { importKwh: 5, exportKwh: 0 } : { importKwh: 0, exportKwh: 0 });
  const result = billOfferWorkspaceScenario({
    tariffHistory: history(['2026-01-31', '2026-02-01']), context, vatBasis: 'GROSS',
    settlement: netBilling(startUtc, endUtc), intervals,
  });

  ready(result);
  assert.deepEqual(result.result.months.map((month) => month.month), ['2026-01', '2026-02']);
  assert.equal(result.result.intervals[4].billedImportKwh, 5);
  assert.ok(Math.abs(result.result.intervals[4].energyCostPln - 5 * 0.5 * 1.23) < 1e-10);
  assert.ok(Math.abs(result.result.months[0].fixedCostPln - 1.23) < 1e-10);
  assert.ok(Math.abs(result.result.months[1].fixedCostPln - (31 / 28) * 1.23) < 1e-10);
});

test('public rate helper returns shared-engine purchase, distribution, export and fixed rates', () => {
  const startUtc = '2026-01-01T23:00:00Z';
  const endUtc = '2026-01-02T00:00:00Z';
  const result = resolveOfferBillingRates({
    tariffHistory: history(['2026-01-02']), context, vatBasis: 'GROSS',
    settlement: netBilling(startUtc, endUtc),
    interval: { startUtc, endUtc, importKwh: 0, exportKwh: 0 },
  });

  ready(result);
  assert.equal(result.energyBuyPlnPerKwh, 0.615);
  assert.equal(result.distributionBuyPlnPerKwh, 0.123);
  assert.equal(result.depositCreditPricePlnPerKwh, 0.8);
  assert.equal(result.refundCapPricePlnPerKwh, 0.8);
  assert.ok(Math.abs(result.fixedDailyPln - 1.23) < 1e-10);
});

test('gross PHP client-tariff payload is canonicalized from net metadata before shared-engine pricing', () => {
  const startUtc = '2026-01-01T23:00:00Z';
  const endUtc = '2026-01-02T00:00:00Z';
  const tariffHistory = history(['2026-01-02'], rdnTariff());
  const interval = { startUtc, endUtc, importKwh: 0, exportKwh: 0, marketPriceNetPlnPerKwh: 0.5 };
  const net = resolveOfferBillingRates({
    tariffHistory, context, vatBasis: 'NET', settlement: netMetering(), interval,
  });
  const gross = resolveOfferBillingRates({
    tariffHistory, context, vatBasis: 'GROSS', settlement: netMetering(), interval,
  });

  ready(net);
  ready(gross);
  assert.ok(Math.abs(net.energyBuyPlnPerKwh - 0.62) < 1e-10);
  assert.ok(Math.abs(gross.energyBuyPlnPerKwh - 0.7626) < 1e-10);
  assert.equal(net.distributionBuyPlnPerKwh, 0.1);
  assert.equal(gross.distributionBuyPlnPerKwh, 0.123);
  assert.equal(net.fixedDailyPln, 1);
  assert.ok(Math.abs(gross.fixedDailyPln - 1.23) < 1e-10);
});

test('real tariff rows without component_key match reordered NET metadata by complete semantic identity', () => {
  const startUtc = '2026-01-01T23:00:00Z';
  const endUtc = '2026-01-02T00:00:00Z';
  const result = resolveOfferBillingRates({
    tariffHistory: history(['2026-01-02'], semanticTariff()), context, vatBasis: 'NET',
    settlement: netMetering(), interval: { startUtc, endUtc, importKwh: 1, exportKwh: 0 },
  });

  ready(result);
  assert.equal(result.energyBuyPlnPerKwh, 0.65);
  assert.ok(Math.abs(result.distributionBuyPlnPerKwh - (0.3032 + 0.0332)) < 1e-10);
  assert.ok(result.fixedDailyPln > 0);
});

test('billing exposes reconciled zone and fee components without changing NET/GROSS settlement amounts', () => {
  const startUtc = '2026-01-01T23:00:00.000Z';
  const endUtc = '2026-01-02T23:00:00.000Z';
  const zonedTariff = semanticTariff() as ClientTariffPayload & {
    energy_schedule: { model: 'monthly_codes'; monthly: Record<string, string[]> };
  };
  zonedTariff.energy_schedule = {
    model: 'monthly_codes',
    monthly: Object.fromEntries(Array.from({ length: 12 }, (_, month) => [String(month + 1), Array(24).fill('low')])),
  };
  const tariffHistory = history(['2026-01-02'], zonedTariff);
  const intervals = makeIntervals(startUtc, endUtc, 60, (index) => index === 0
    ? { importKwh: 2, exportKwh: 0 } : { importKwh: 0, exportKwh: 0 });

  const metering = billOfferWorkspaceScenario({
    tariffHistory, context, vatBasis: 'GROSS', intervals,
    settlement: netMetering({
      initialCreditKwh: 1,
      initialCreditLots: [{ kwh: 1, expiresMonth: '2026-02' }],
      coverage: 'ENERGY_AND_VARIABLE_DISTRIBUTION',
    }),
  });
  ready(metering);
  const meteredMonth = metering.result.months[0];
  assert.equal(metering.result.intervalTariffs?.length, 1);
  assert.equal(metering.result.intervalTariffs?.[0].energyZone, 'low');
  assert.equal(metering.result.intervalTariffs?.[0].distributionZone, 'high');
  assert.ok(Math.abs(meteredMonth.energyCostPln - 0.28 * 1.23) < 1e-10);
  assert.ok(Math.abs(meteredMonth.distributionCostPln - (0.3032 + 0.0332) * 1.23) < 1e-10);
  assert.ok(Math.abs(meteredMonth.fixedCostPln - (14.56 + 3.84) / 31 * 1.23) < 1e-10);
  assert.equal(meteredMonth.fixedComponents?.some((component) => component.componentKey === 'subscription-2'), false);
  assert.ok(Math.abs((meteredMonth.distributionComponents || []).reduce((sum, component) => sum + component.amountPln, 0)
    - meteredMonth.distributionCostPln) < 1e-10);
  assert.ok(Math.abs((meteredMonth.fixedComponents || []).reduce((sum, component) => sum + component.amountPln, 0)
    - meteredMonth.fixedCostPln) < 1e-10);

  const billing = billOfferWorkspaceScenario({
    tariffHistory, context, vatBasis: 'GROSS', intervals,
    settlement: netBilling(startUtc, endUtc, {
      initialDeposit: [{ amountPln: 0.1, creditedMonth: '2025-12', expiresMonth: '2026-12', refundCapPln: 0 }],
    }),
  });
  ready(billing);
  const billedMonth = billing.result.months[0];
  assert.ok(Math.abs(billedMonth.energyCostPln - (2 * 0.28 * 1.23 - 0.1)) < 1e-10);
  assert.ok(Math.abs(billedMonth.distributionCostPln - 2 * (0.3032 + 0.0332) * 1.23) < 1e-10);
  assert.ok(Math.abs((billedMonth.distributionComponents || []).reduce((sum, component) => sum + component.amountPln, 0)
    - billedMonth.distributionCostPln) < 1e-10);
  assert.ok(Math.abs((billing.result.totals.fixedComponents || []).reduce((sum, component) => sum + component.amountPln, 0)
    - billing.result.totals.fixedCostPln) < 1e-10);
});

test('flat capacity charge uses the selected annual-usage band once in fixed-fee details', () => {
  const startUtc = '2026-01-01T23:00:00.000Z';
  const endUtc = '2026-01-02T23:00:00.000Z';
  const flatCapacity = tariff() as ClientTariffPayload & Record<string, any>;
  const capacityRow = {
    component_key: 'capacity-charge', label: 'Opłata mocowa', window_code: 'all',
    price: 0.15 * 1.23,
  };
  flatCapacity.variable.push(capacityRow);
  flatCapacity.pricing.tariffStorage.variable.push({
    component_key: 'capacity-charge', label: 'Opłata mocowa', window_code: 'all',
    net: 0.15, gross: 0.15 * 1.23, vatRate: 0.23,
  });
  flatCapacity.capacity_charge = {
    model: 'pl_capacity_charge', effective_from: '2026-01-01', effective_until: '2027-01-01',
    flat_eligible: true, flat_max_power_kw: 16, variable_rate: 0.2,
    flat_monthly: [
      { annual_usage_min_kwh: 0, annual_usage_max_kwh: 6000, amount: 5 },
      { annual_usage_min_kwh: 6000, annual_usage_max_kwh: null, amount: 10 },
    ],
    qualifying_hour_from: 17, qualifying_hour_until: 22,
    exclude_weekends: false, exclude_public_holidays: false, profile_factors: [],
  };
  const result = billOfferWorkspaceScenario({
    tariffHistory: history(['2026-01-02'], flatCapacity), context, vatBasis: 'GROSS',
    settlement: netMetering(),
    intervals: makeIntervals(startUtc, endUtc, 60, (index) => index === 18
      ? { importKwh: 1, exportKwh: 0 } : { importKwh: 0, exportKwh: 0 }),
  });

  ready(result);
  const month = result.result.months[0];
  const capacity = month.fixedComponents?.filter((component) => component.category === 'capacity') || [];
  assert.equal(capacity.length, 1);
  assert.equal(capacity[0].componentKey, 'capacity-charge-flat');
  assert.ok(Math.abs(capacity[0].amountPln - 10 / 31 * 1.23) < 1e-10);
  assert.ok(Math.abs(month.fixedCostPln - 41 / 31 * 1.23) < 1e-10);
  assert.ok(Math.abs(capacity.reduce((sum, component) => sum + component.amountPln, 0) +
    (month.fixedComponents || []).filter((component) => component.category !== 'capacity')
      .reduce((sum, component) => sum + component.amountPln, 0) - month.fixedCostPln) < 1e-10);
});

test('fixed PHP display amounts rounded to cents retain canonical net precision', () => {
  const value = tariff({ fixed: 24.05 });
  value.fixed[0].amount = 29.58;
  const input = { tariffHistory: history(['2026-01-02'], value), context, vatBasis: 'NET' as const,
    settlement: netMetering(), interval: { startUtc: '2026-01-01T23:00:00Z', endUtc: '2026-01-02T00:00:00Z', importKwh: 1, exportKwh: 0 } };
  const result = resolveOfferBillingRates(input);
  ready(result);
  assert.ok(Math.abs(result.fixedDailyPln - 24.05 / 31) < 1e-10);
  value.fixed[0].amount = 29.59;
  assert.equal(resolveOfferBillingRates(input).status, 'blocked');
});

test('PGE G11 energy accepts the four-decimal gross display price and keeps semantic guards', () => {
  const pgeTariff = (runtimePrice: number, runtimeLabel = 'Energia czynna', includeRuntimeKey = false) => {
    const value = tariff() as ClientTariffPayload & Record<string, any>;
    const runtimeEnergy = value.variable[0] as Record<string, any>;
    const storedRows = value.pricing.tariffStorage.variable as Array<Record<string, any>>;
    const storedEnergy = storedRows.find((row) => row.component_key === 'energy')!;
    const componentKey = 'f27d0dd5-ef5e-4a83-9fe7-4b8354731a60';

    runtimeEnergy.label = runtimeLabel;
    runtimeEnergy.price = runtimePrice;
    storedEnergy.component_key = componentKey;
    storedEnergy.net = 0.5032;
    storedEnergy.gross = 0.6189359999999999;
    storedEnergy.vatRate = 0.23;
    if (includeRuntimeKey) runtimeEnergy.component_key = componentKey;
    else delete runtimeEnergy.component_key;

    return value as unknown as ClientTariffPayload;
  };
  const interval = {
    startUtc: '2026-01-01T23:00:00Z', endUtc: '2026-01-02T00:00:00Z', importKwh: 1, exportKwh: 0,
  };
  const resolve = (value: ClientTariffPayload) => resolveOfferBillingRates({
    tariffHistory: history(['2026-01-02'], value), context, vatBasis: 'NET',
    settlement: netMetering(), interval,
  });

  const roundedGross = resolve(pgeTariff(0.6189));
  ready(roundedGross);
  assert.equal(roundedGross.energyBuyPlnPerKwh, 0.5032);

  const nearbyWrongPrice = resolve(pgeTariff(0.6188));
  assert.equal(nearbyWrongPrice.status, 'blocked');
  if (nearbyWrongPrice.status === 'blocked') {
    assert.match(nearbyWrongPrice.reasons.join(' '), /nie odpowiada jej zweryfikowanym wartościom netto\/brutto/iu);
  }

  const impreciselyRoundedGross = resolve(pgeTariff(0.618900001));
  assert.equal(impreciselyRoundedGross.status, 'blocked');

  const mismatchedIdentity = resolve(pgeTariff(0.6189, 'Energia bierna', true));
  assert.equal(mismatchedIdentity.status, 'blocked');
  if (mismatchedIdentity.status === 'blocked') {
    assert.match(mismatchedIdentity.reasons.join(' '), /nie odpowiada semantycznie metadanym taryfy/iu);
  }
});

test('billing blocks duplicate semantic tariff identities instead of choosing by row order', () => {
  const startUtc = '2026-01-01T23:00:00Z';
  const endUtc = '2026-01-02T00:00:00Z';
  const result = resolveOfferBillingRates({
    tariffHistory: history(['2026-01-02'], semanticTariff({ duplicateFixedIdentity: true })),
    context, vatBasis: 'NET', settlement: netMetering(),
    interval: { startUtc, endUtc, importKwh: 1, exportKwh: 0 },
  });

  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') assert.match(result.reasons.join(' '), /jednoznacznego dopasowania semantycznego/iu);
});

test('net-meter monthly cycles use later same-month exports, but never retro-offset a closed month', () => {
  const startUtc = '2025-12-31T23:00:00Z';
  const endUtc = '2026-02-28T23:00:00Z';
  const intervals = makeIntervals(startUtc, endUtc, 60, (index) => {
    if (index === 0) return { importKwh: 1, exportKwh: 0 };
    if (index === 31 * 24) return { importKwh: 0, exportKwh: 1 };
    return { importKwh: 0, exportKwh: 0 };
  });
  const dates = Array.from({ length: 59 }, (_, day) =>
    new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10));
  const result = billOfferWorkspaceScenario({
    tariffHistory: history(dates), context: { ...context, billingCycleMonths: 1 },
    vatBasis: 'NET', settlement: netMetering(), intervals,
  });

  ready(result);
  const [january, february] = result.result.months;
  assert.equal(january.billedImportKwh, 1);
  assert.equal(january.creditUsedKwh, 0);
  assert.equal(january.energyCostPln, 0.5);
  assert.equal(february.creditAddedKwh, 0.8);
  assert.equal(february.creditBalanceKwh, 0.8);
});

test('multi-month net-meter cycle requires an anchor, nets across its months, and blocks mid-cycle expiry', () => {
  const startUtc = '2025-12-31T23:00:00Z';
  const endUtc = '2026-02-28T23:00:00Z';
  const intervals = makeIntervals(startUtc, endUtc, 60, (index) => {
    if (index === 0) return { importKwh: 1, exportKwh: 0 };
    if (index === 31 * 24) return { importKwh: 0, exportKwh: 1 };
    return { importKwh: 0, exportKwh: 0 };
  });
  const dates = Array.from({ length: 59 }, (_, day) =>
    new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10));
  const cycleContext = { ...context, billingCycleMonths: 2 };
  const missingAnchor = billOfferWorkspaceScenario({
    tariffHistory: history(dates), context: cycleContext, vatBasis: 'NET',
    settlement: netMetering(), intervals,
  });
  assert.equal(missingAnchor.status, 'blocked');
  if (missingAnchor.status === 'blocked') assert.match(missingAnchor.reasons[0], /billingCycleStartMonth/);

  const result = billOfferWorkspaceScenario({
    tariffHistory: history(dates), context: cycleContext, vatBasis: 'NET',
    settlement: netMetering({ billingCycleStartMonth: '2026-01' }), intervals,
  });
  ready(result);
  const [january, february] = result.result.months;
  assert.ok(Math.abs(january.billedImportKwh - 0.2) < 1e-10);
  assert.equal(january.creditBalanceKwh, null);
  assert.equal(february.creditAddedKwh, 0.8);
  assert.equal(february.creditUsedKwh, 0);
  assert.equal(february.creditBalanceKwh, 0);

  const expiringVintage = billOfferWorkspaceScenario({
    tariffHistory: history(dates), context: cycleContext, vatBasis: 'NET',
    settlement: netMetering({ billingCycleStartMonth: '2026-01', initialCreditKwh: 1,
      initialCreditLots: [{ kwh: 1, expiresMonth: '2026-02' }] }), intervals,
  });
  assert.equal(expiringVintage.status, 'blocked');
  if (expiringVintage.status === 'blocked') assert.match(expiringVintage.reasons[0], /wygasa wewnątrz cyklu/);
});

test('net-meter opening vintages are consumed FIFO before expiry', () => {
  const startUtc = '2025-12-31T23:00:00Z';
  const endUtc = '2026-02-28T23:00:00Z';
  const intervals = makeIntervals(startUtc, endUtc, 60, (index) => {
    if (index === 0 || index === 31 * 24) return { importKwh: 0.5, exportKwh: 0 };
    return { importKwh: 0, exportKwh: 0 };
  });
  const dates = Array.from({ length: 59 }, (_, day) =>
    new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10));
  const result = billOfferWorkspaceScenario({
    tariffHistory: history(dates), context: { ...context, billingCycleMonths: 1 }, vatBasis: 'NET',
    settlement: netMetering({ initialCreditKwh: 1, initialCreditLots: [
      { kwh: 0.5, expiresMonth: '2026-02' }, { kwh: 0.5, expiresMonth: '2026-03' },
    ] }), intervals,
  });

  ready(result);
  assert.equal(result.result.months[0].creditUsedKwh, 0.5);
  assert.equal(result.result.months[1].creditUsedKwh, 0.5);
  assert.equal(result.result.months[1].creditExpiredKwh, 0);
  assert.equal(result.result.months[1].creditBalanceKwh, 0);
});

test('rate series resolves a full year and interval-specific export prices without quadratic scans', () => {
  const startUtc = '2025-12-31T23:00:00.000Z';
  const endUtc = '2026-12-31T23:00:00.000Z';
  const intervals = makeIntervals(startUtc, endUtc, 60, () => ({ importKwh: 1, exportKwh: 0 }));
  assert.equal(intervals.length, 8760);
  const dates = Array.from({ length: 365 }, (_, day) =>
    new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10));
  const settlement = netBilling(startUtc, endUtc, {
    exportUnitPrices: intervals.map((interval) => ({
      startUtc: interval.startUtc, endUtc: interval.endUtc,
      depositCreditPricePlnPerKwh: 0.8, refundCapPricePlnPerKwh: 0.8,
    })),
  });

  const started = Date.now();
  const result = resolveOfferBillingRateSeries({
    tariffHistory: history(dates), context, vatBasis: 'NET', settlement, intervals,
  });
  const elapsedMs = Date.now() - started;

  ready(result);
  assert.equal(result.rates.length, 8760);
  assert.equal(result.rates[0].depositCreditPricePlnPerKwh, 0.8);
  assert.equal(result.rates.at(-1)!.depositCreditPricePlnPerKwh, 0.8);
  assert.ok(elapsedMs < 12000, `8760-rate series took ${elapsedMs}ms`);
});

test('missing strict dates, fixed prices, or export prices block instead of producing a zero bill', () => {
  const startUtc = '2026-01-01T23:00:00Z';
  const endUtc = '2026-01-02T23:00:00Z';
  const intervals = makeIntervals(startUtc, endUtc, 60, (index) => index === 0
    ? { importKwh: 0, exportKwh: 1 } : { importKwh: 0, exportKwh: 0 });

  const missingTariff = billOfferWorkspaceScenario({
    tariffHistory: history([]), context, vatBasis: 'NET', settlement: netMetering(), intervals,
  });
  assert.equal(missingTariff.status, 'blocked');
  if (missingTariff.status === 'blocked') assert.match(missingTariff.reasons[0], /brak cen taryfy/iu);

  const noFixed = { ...tariff(), fixed: undefined } as unknown as ClientTariffPayload;
  const missingFixed = billOfferWorkspaceScenario({
    tariffHistory: history(['2026-01-02'], noFixed), context, vatBasis: 'NET',
    settlement: netMetering(), intervals,
  });
  assert.equal(missingFixed.status, 'blocked');
  if (missingFixed.status === 'blocked') assert.match(missingFixed.reasons[0], /opłat stałych/iu);

  const missingExportPrice = billOfferWorkspaceScenario({
    tariffHistory: history(['2026-01-02']), context, vatBasis: 'NET',
    settlement: netBilling(startUtc, endUtc, { exportUnitPrices: [] }), intervals,
  });
  assert.equal(missingExportPrice.status, 'blocked');
  if (missingExportPrice.status === 'blocked') assert.match(missingExportPrice.reasons[0], /ceny eksportu/iu);
});

test('positive opening net-meter credit requires itemized expiry vintages', () => {
  const startUtc = '2026-01-01T23:00:00Z';
  const endUtc = '2026-01-02T23:00:00Z';
  const intervals = makeIntervals(startUtc, endUtc, 60);
  const result = billOfferWorkspaceScenario({
    tariffHistory: history(['2026-01-02']), context, vatBasis: 'NET',
    settlement: netMetering({ initialCreditKwh: 4 }), intervals,
  });
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') assert.match(result.reasons[0], /initialCreditLots/);
});

test('refund assumptions enforce the selected RCE or RCEm ceiling and require a raw cap basis', () => {
  const startUtc = '2026-01-01T23:00:00Z';
  const endUtc = '2026-01-02T23:00:00Z';
  const intervals = makeIntervals(startUtc, endUtc, 60);
  const invalidRcem = billOfferWorkspaceScenario({
    tariffHistory: history(['2026-01-02']), context, vatBasis: 'NET', intervals,
    settlement: netBilling(startUtc, endUtc, { exportPriceMethod: 'RCEm', expiredRefundRate: 0.3 }),
  });
  assert.equal(invalidRcem.status, 'blocked');
  if (invalidRcem.status === 'blocked') assert.match(invalidRcem.reasons[0], /limit 0.2/);

  const missingCap = billOfferWorkspaceScenario({
    tariffHistory: history(['2026-01-02']), context, vatBasis: 'NET', intervals,
    settlement: netBilling(startUtc, endUtc, {
      expiredRefundRate: 0.3,
      exportUnitPrices: [{ startUtc, endUtc, depositCreditPricePlnPerKwh: 1.23 }],
    }),
  });
  assert.equal(missingCap.status, 'blocked');
  if (missingCap.status === 'blocked') assert.match(missingCap.reasons[0], /refundCapPricePlnPerKwh/);
});

test('net-meter credits remain available through the twelfth following month and are labeled non-invoice-exact', () => {
  const startUtc = '2026-01-30T23:00:00.000Z';
  const endUtc = '2027-01-31T23:00:00.000Z';
  const dates = Array.from({ length: 366 }, (_, day) =>
    new Date(Date.UTC(2026, 0, 31 + day)).toISOString().slice(0, 10));
  const intervals = makeIntervals(startUtc, endUtc, 60, (index) => {
    if (index === 0) return { importKwh: 0, exportKwh: 1 };
    if (index === 365 * 24) return { importKwh: 1, exportKwh: 0 };
    return { importKwh: 0, exportKwh: 0 };
  });
  const result = billOfferWorkspaceScenario({
    tariffHistory: history(dates), context, vatBasis: 'NET', settlement: netMetering(), intervals,
  });

  ready(result);
  const finalJanuary = result.result.months.at(-1)!;
  assert.equal(finalJanuary.month, '2027-01');
  assert.equal(finalJanuary.creditUsedKwh, 0.8);
  assert.equal(finalJanuary.creditExpiredKwh, 0);
  assert.match(result.warnings.join(' '), /nie dokładnym odtworzeniem faktury/iu);
});

test('grid pricing batches the selected intervals, follows date-specific tariffs, VAT and one fixed fee per local day', () => {
  const intervals: OfferWorkspaceGridIntervalInput[] = [
    { startUtc: '2026-01-01T23:00:00.000Z', endUtc: '2026-01-02T00:00:00.000Z', importKwh: 2, exportKwh: 0 },
    { startUtc: '2026-01-02T23:00:00.000Z', endUtc: '2026-01-03T00:00:00.000Z', importKwh: 2, exportKwh: 0 },
  ];
  const result = priceOfferWorkspaceGrid({
    tariffHistory: {
      strict: true, revision: 1,
      byDate: { '2026-01-02': tariff({ energy: 0.5, distribution: 0.1, fixed: 31 }),
        '2026-01-03': tariff({ energy: 0.8, distribution: 0.1, fixed: 62 }) },
      tariffs: {}, issues: [],
    },
    context, vatBasis: 'GROSS', intervals,
    expectedLocalDates: ['2026-01-02', '2026-01-03'], totalHours: 2,
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.pricedHours, 2);
  assert.ok(Math.abs(result.energyPln! - (2 * 0.5 + 2 * 0.8) * 1.23) < 1e-9);
  assert.ok(Math.abs(result.distributionPln! - 4 * 0.1 * 1.23) < 1e-9);
  assert.ok(Math.abs(result.fixedPln! - (1 + 2) * 1.23) < 1e-9);
  assert.ok(result.tariffLabels.includes('1 G11'));
});

test('grid pricing remains partial for missing tariff dates and handles export values by settlement mode', () => {
  const base: OfferWorkspaceGridIntervalInput = {
    startUtc: '2026-01-01T23:00:00.000Z', endUtc: '2026-01-02T00:00:00.000Z',
    importKwh: 1, exportKwh: 2, exportPriceNetPlnPerKwh: 0.8,
  };
  const second: OfferWorkspaceGridIntervalInput = {
    startUtc: '2026-01-02T23:00:00.000Z', endUtc: '2026-01-03T00:00:00.000Z',
    importKwh: 1, exportKwh: null,
  };
  const tariffHistory = history(['2026-01-02']);
  const netBilling = priceOfferWorkspaceGrid({
    tariffHistory, context, vatBasis: 'GROSS', intervals: [base, second],
    expectedLocalDates: ['2026-01-02', '2026-01-03'], totalHours: 2, settlementMode: 'NET_BILLING',
  });
  assert.equal(netBilling.status, 'partial');
  assert.equal(netBilling.pricedHours, 1);
  assert.ok(Math.abs(netBilling.exportValuePln! - 2 * 0.8 * 1.23) < 1e-9);
  assert.ok(netBilling.issues.some(issue => issue.includes('2026-01-03')));

  const netMetering = priceOfferWorkspaceGrid({
    tariffHistory, context, vatBasis: 'NET', intervals: [base], expectedLocalDates: ['2026-01-02'],
    totalHours: 1, settlementMode: 'NET_METERING',
  });
  assert.equal(netMetering.exportValuePln, null);
  assert.equal(netMetering.issues.some(issue => issue.includes('NET_METERING')), false);
  const zeroExport: OfferWorkspaceGridIntervalInput = { ...base, exportKwh: 0, exportPriceNetPlnPerKwh: null };
  const zeroPriced = priceOfferWorkspaceGrid({
    tariffHistory, context, vatBasis: 'NET', intervals: [zeroExport], expectedLocalDates: ['2026-01-02'],
    totalHours: 1, settlementMode: 'NET_BILLING',
  });
  assert.equal(zeroPriced.exportValuePln, 0);
  assert.equal(zeroPriced.issues.some(issue => issue.includes('RCE')), false);
  const negativeRce = priceOfferWorkspaceGrid({
    tariffHistory, context, vatBasis: 'NET',
    intervals: [{ ...base, exportPriceNetPlnPerKwh: -0.4 }],
    expectedLocalDates: ['2026-01-02'], totalHours: 1, settlementMode: 'NET_BILLING',
  });
  assert.equal(negativeRce.exportValuePln, 0);
});

