import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { completeOfferMeasurementGaps } from './offer-measurement-gap-model';
import { recalibrateOfferMeasurementInvoices } from './offer-measurement-invoice-recalibration';
import { resolveProjectAnalysisPeriod } from './project-analysis-period';
import type { OfferMeasurementSeries } from './offer-measurements';

const filename = path.resolve(__dirname, 'offer-measurement-completion-server.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: filename,
}).outputText;
const ppe = '590310600030743962';
const allProfileKeys = [
  'bdew-2025-h25', 'vdew-1999-h0', 'bdew-2025-g25',
  ...Array.from({ length: 7 }, (_, index) => `vdew-1999-g${index}`),
  'opsd_20200415_de_kn_residential1_heat_pump', 'opsd_20200415_de_kn_residential4_heat_pump',
  'opsd_20200415_de_kn_residential4_household_heat_pump',
];

function period(startMonth = '2025-01') {
  return resolveProjectAnalysisPeriod(startMonth, new Date('2028-02-15T12:00:00.000Z'));
}

function hourlyCalendar(periodValue: ReturnType<typeof period>) {
  const start = Date.parse(periodValue.fromUtc);
  const count = (Date.parse(periodValue.untilUtc) - start) / 3_600_000;
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const occurrences = new Map<string, number>();
  return Array.from({ length: count }, (_, index) => {
    const startUtc = new Date(start + index * 3_600_000).toISOString();
    const endUtc = new Date(start + (index + 1) * 3_600_000).toISOString();
    const localStart = formatter.format(new Date(startUtc)).replace(' ', 'T');
    const localEnd = formatter.format(new Date(endUtc)).replace(' ', 'T');
    const key = localEnd.slice(0, 13);
    const occurrence = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, occurrence);
    return { startUtc, endUtc, localStart, localEnd, occurrence };
  });
}

function fullSeries(periodValue: ReturnType<typeof period>): OfferMeasurementSeries {
  const calendar = hourlyCalendar(periodValue);
  const periods = periodValue.periodKeys.map((key) => ({ period: key, hasImport: true, hasExport: true, missingDirections: [] }));
  return {
    ppeNumber: ppe, projectId: 'project-1', hasExistingPv: false, periods, missingMonths: [], missingDirections: [], files: [],
    intervals: calendar.map((interval) => ({ ...interval,
      import: { valueKwh: 1, source: 'measured' as const, fileIds: [] },
      export: { valueKwh: 0, source: 'measured' as const, fileIds: [] },
    })),
  };
}

function seriesWithOneAnchor(periodValue: ReturnType<typeof period>): OfferMeasurementSeries {
  const first = hourlyCalendar(periodValue)[0];
  return {
    ppeNumber: ppe, projectId: 'project-1', hasExistingPv: false,
    periods: periodValue.periodKeys.map((key) => ({ period: key, hasImport: false, hasExport: false, missingDirections: ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'] })),
    missingMonths: [...periodValue.periodKeys],
    missingDirections: periodValue.periodKeys.flatMap((period) => [
      { period, kind: 'ACTIVE_IMPORT' as const }, { period, kind: 'ACTIVE_EXPORT' as const },
    ]),
    files: [],
    intervals: [{ ...first,
      import: { valueKwh: 1, source: 'measured', fileIds: [] },
      export: { valueKwh: 0, source: 'measured', fileIds: [] },
    }],
  };
}

function invoice(options: { id?: string; sha256?: string; year?: number; month?: number; after?: number | null;
  before?: number; ppeNumber?: string | null; monthly?: any[] } = {}) {
  const year = options.year ?? 2024;
  const month = options.month ?? 1;
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const after = options.after === undefined ? 1000 : options.after;
  const consumption: Record<string, unknown> = { monthly: options.monthly ?? [] };
  if (after !== null) consumption.totalAfterBalancingKwh = after;
  if (options.before !== undefined) consumption.totalBeforeBalancingKwh = options.before;
  return {
    id: options.id ?? 'invoice-1', sha256: options.sha256 ?? 'a'.repeat(64), updatedAt: new Date('2026-01-01T00:00:00Z'),
    billingPeriodFrom: new Date(`${key}-01T00:00:00Z`), billingPeriodTo: new Date(`${key}-${last}T00:00:00Z`),
    invoicePpeNumber: options.ppeNumber === undefined ? ppe : options.ppeNumber,
    energyConsumptionKwh: 999999,
    invoiceRecognition: { fields: {
      ppeNumber: options.ppeNumber === undefined ? ppe : options.ppeNumber,
      periodFrom: `${key}-01`, periodTo: `${key}-${last}`,
      consumption: {
        ...consumption,
        ...(after === null && options.before !== undefined ? { billedAfterDiscountKwh: 25 } : {}),
      },
    } },
  };
}

function confirmedAnnualInvoice(periodValue: ReturnType<typeof period>, options: {
  id?: string; importKwh?: number; exportKwh?: number; ppeNumber?: string; confirmed?: boolean; provider?: string;
} = {}) {
  const ppeNumber = options.ppeNumber ?? ppe;
  const fromDate = `${periodValue.startMonth}-01`;
  const toDate = periodValue.endDate;
  return {
    id: options.id ?? 'annual-invoice', sha256: 'b'.repeat(64), updatedAt: new Date('2026-08-01T00:00:00Z'),
    billingPeriodFrom: `${fromDate}T00:00:00.000Z`, billingPeriodTo: `${toDate}T00:00:00.000Z`,
    invoicePpeNumber: ppeNumber,
    invoiceRecognition: {
      provider: options.provider ?? 'ENEA',
      fields: { ppeNumber, periodFrom: fromDate, periodTo: toDate,
        consumption: { totalAfterBalancingKwh: options.importKwh ?? 8761,
          exportedAfterBalancingKwh: options.exportKwh ?? 5 } },
      ...(options.confirmed === false ? {} : { confirmation: { confirmedAt: '2026-08-01T00:00:00.000Z', confirmedById: 'staff-1' } }),
    },
  };
}

function modeledFullSeries(periodValue: ReturnType<typeof period>): OfferMeasurementSeries {
  const result = fullSeries(periodValue);
  result.intervals[0].import = { valueKwh: 10, source: 'modelled', fileIds: [] };
  result.intervals[0].export = { valueKwh: 1, source: 'modelled', fileIds: [] };
  result.intervals[1].import = { valueKwh: 1, source: 'modelled', fileIds: [] };
  result.intervals[1].export = { valueKwh: 5, source: 'modelled', fileIds: [] };
  return result;
}

function fixture(options: { period?: ReturnType<typeof period>; invoices?: any[]; catalogKeys?: string[]; pvKwh?: number;
  selectedProfile?: any } = {}) {
  const selectedPeriod = options.period || period();
  const catalog = (options.catalogKeys || allProfileKeys).map((key) => ({ key, name: `Profil ${key}` }));
  const state = {
    period: selectedPeriod, invoices: options.invoices || [], queries: [] as any[], catalogReads: 0, candidates: [] as string[], modelInputs: [] as any[],
    modelCalls: 0, pvCalls: 0, annualBuilds: [] as string[], resolverCalls: 0, pvSourceRevision: 'pv-source-1',
  };
  const modules: Record<string, unknown> = {
    'node:crypto': { createHash },
    './prisma': { prisma: { document: { findMany: async (query: unknown) => {
      state.queries.push(query);
      return state.invoices;
    } } } },
    './offer-measurement-gap-model': { completeOfferMeasurementGaps: (input: any) => {
      state.modelCalls += 1;
      state.modelInputs.push(input);
      state.candidates = input.candidates.map((candidate: any) => candidate.key);
      return completeOfferMeasurementGaps(input);
    } },
    './offer-measurement-invoice-recalibration': { recalibrateOfferMeasurementInvoices },
    './reference-profile-catalog-server': { readReferenceProfileCatalog: async () => {
      state.catalogReads += 1;
      return catalog;
    } },
    './reference-profile-comparison': { getReferenceProfileCalculationEligibility: () => ({ eligible: true, reason: null, method: 'test' }) },
    './project-reference-profile': { resolveSelectedReferenceProfile: async (selection: any) => {
      state.resolverCalls += 1;
      const profile = catalog.find((item) => item.key === selection?.key);
      if (!profile) throw new Error('unknown profile');
      return { profile, contentHash: `hash-${profile.key}` };
    } },
    '../../../scripts/profile-catalog/storage-core': { profileContentHash: (profile: any) => `hash-${profile.key}` },
    './offer-workspace-annual-profile': { buildAnnualOfferConsumptionProfile: (input: any) => {
      const count = (Date.parse(input.period.untilUtc) - Date.parse(input.period.fromUtc)) / 3_600_000;
      const key = input.referenceProfile.profile.key;
      state.annualBuilds.push(key);
      return { intervals: Array.from({ length: count }, () => ({ loadKwh: 1 })) };
    } },
    './offer-pv-source-revision': { getOfferPvSourceRevision: () => state.pvSourceRevision },
    './offer-pv-profile': { readOfferPvProfileWithSourceRevision: async (input: any) => {
      state.pvCalls += 1;
      const count = (Date.parse(input.untilUtc) - Date.parse(input.fromUtc)) / 3_600_000;
      return { profile: { hours: Array.from({ length: count }, (_, index) => ({
        startUtc: new Date(Date.parse(input.fromUtc) + index * 3_600_000).toISOString(), pvKwh: options.pvKwh ?? 0.1,
      })) }, sourceRevision: state.pvSourceRevision };
    } },
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected completion-server import: ${name}`);
      return modules[name];
    },
  });
  const baseInput: any = {
    projectId: 'project-1', clientId: 'client-1', clientType: 'B2C', period: selectedPeriod,
    series: null, ppeNumber: ppe, heatingSource: 'NATURAL_GAS', heatingSourceDetail: 'GAS_CONDENSING',
    existingBatteryPresent: false,
    pv: { powerKw: 0, tiltDegrees: null, azimuthDegrees: null, lossPercent: null, latitude: null, longitude: null },
    selectedProfile: options.selectedProfile,
  };
  return {
    state,
    input: baseInput,
    complete: (input: any = baseInput) => exports.completeProjectOfferMeasurements(input),
    refresh: (series: OfferMeasurementSeries, pv: any) => exports.refreshCompletedOfferMeasurements(series, pv),
  };
}

test('complete full-period data returns immediately without invoice, catalog, or PV reads', async () => {
  const f = fixture();
  const series = fullSeries(f.state.period);
  const result = await f.complete({ ...f.input, series, existingBatteryPresent: null, pv: { ...f.input.pv, powerKw: null } });
  assert.equal(result.series, series);
  assert.equal(result.issues.length, 0);
  assert.equal(f.state.queries.length + f.state.catalogReads + f.state.pvCalls, 0);
});

test('confirmed exact-period ENEA invoice recalibrates only prior modelled hours and then remains stable', async () => {
  const selectedPeriod = period('2025-07');
  const annual = confirmedAnnualInvoice(selectedPeriod);
  const f = fixture({ period: selectedPeriod, invoices: [annual] });
  const series = modeledFullSeries(selectedPeriod);
  series.intervals[2].export = { valueKwh: 0, source: 'estimated', fileIds: [] };
  const measuredBefore = series.intervals.map((item) => ({ import: item.import, export: item.export }));
  const result = await f.complete({ ...f.input, period: selectedPeriod, series });
  assert.ok(result.series);
  const importTotal = result.series.intervals.reduce((sum, item) => sum + (item.import?.valueKwh ?? 0), 0);
  const exportTotal = result.series.intervals.reduce((sum, item) => sum + (item.export?.valueKwh ?? 0), 0);
  assert.ok(Math.abs(importTotal - 8761) < 0.000001);
  assert.ok(Math.abs(exportTotal - 5) < 0.000001);
  assert.equal(result.series.intervals[0].import?.source, 'modelled');
  assert.equal(result.series.intervals[1].export?.source, 'modelled');
  for (let index = 2; index < series.intervals.length; index += 1) {
    assert.deepEqual(result.series.intervals[index].import, measuredBefore[index].import);
    assert.deepEqual(result.series.intervals[index].export, measuredBefore[index].export);
  }
  assert.ok(result.issues.some((issue: string) => issue.includes('uzgodniono z fakturą ENEA')));
  assert.equal(f.state.queries[0].where.projectId, 'project-1');
  assert.equal(f.state.queries[0].where.clientId, 'client-1');
  assert.equal(f.state.queries[0].where.type, 'FAKTURA_PRAD');
  const repeated = await f.complete({ ...f.input, period: selectedPeriod, series: result.series });
  assert.equal(repeated.series, result.series, 'an already matched invoice must not rewrite saved hourly estimates');
  assert.ok(repeated.issues.some((issue: string) => issue.includes('już uzgodnione')));
});

test('an exact invoice still nets same-hour modeled import and export when yearly sums already match', async () => {
  const selectedPeriod = period('2025-07');
  const annual = confirmedAnnualInvoice(selectedPeriod, { importKwh: 8769, exportKwh: 6 });
  const f = fixture({ period: selectedPeriod, invoices: [annual] });
  const series = modeledFullSeries(selectedPeriod);
  series.intervals[2].export = { valueKwh: 0, source: 'estimated', fileIds: [] };
  const result = await f.complete({ ...f.input, period: selectedPeriod, series });
  assert.ok(result.series);
  const importTotal = result.series.intervals.reduce((sum, item) => sum + (item.import?.valueKwh ?? 0), 0);
  const exportTotal = result.series.intervals.reduce((sum, item) => sum + (item.export?.valueKwh ?? 0), 0);
  assert.ok(Math.abs(importTotal - 8769) < 0.000001);
  assert.ok(Math.abs(exportTotal - 6) < 0.000001);
  assert.ok(result.series.intervals.slice(0, 2).every((item) =>
    !(item.import?.valueKwh && item.export?.valueKwh)), 'modelled import and export must not overlap in the same hour');
  assert.ok(result.issues.some((issue: string) => issue.includes('operatora oznaczone jako szacowane pozostały bez zmian')));
  assert.equal(result.series.intervals[2].export?.source, 'estimated');
  assert.equal(typeof (result.revisionKey as any).outputSeriesSha256, 'string');
});

test('a confirmed invoice for a legitimate overlapping billing cycle is ignored', async () => {
  const selectedPeriod = period('2025-04');
  const otherCycle = confirmedAnnualInvoice(period('2025-07'));
  const f = fixture({ period: selectedPeriod, invoices: [otherCycle] });
  const series = modeledFullSeries(selectedPeriod);
  const result = await f.complete({ ...f.input, period: selectedPeriod, series });
  assert.equal(result.series, series);
  assert.equal(result.issues.length, 0);
});

test('changing a matched invoice changes the completion revision', async () => {
  const selectedPeriod = period('2025-07');
  const f = fixture({ period: selectedPeriod, invoices: [confirmedAnnualInvoice(selectedPeriod)] });
  const series = modeledFullSeries(selectedPeriod);
  const first = await f.complete({ ...f.input, period: selectedPeriod, series });
  f.state.invoices = [confirmedAnnualInvoice(selectedPeriod, { id: 'annual-invoice', importKwh: 8800, exportKwh: 25 })];
  const second = await f.complete({ ...f.input, period: selectedPeriod, series });
  assert.notDeepEqual(second.revisionKey, first.revisionKey);
  assert.equal(second.series?.intervals.reduce((sum, item) => sum + (item.import?.valueKwh ?? 0), 0), 8800);
  assert.equal(second.series?.intervals.reduce((sum, item) => sum + (item.export?.valueKwh ?? 0), 0), 25);
});

test('unconfirmed invoices and PPE mismatches do not alter complete modelled series', async () => {
  const selectedPeriod = period('2025-07');
  for (const annual of [
    confirmedAnnualInvoice(selectedPeriod, { confirmed: false }),
    confirmedAnnualInvoice(selectedPeriod, { ppeNumber: '111111111111111111' }),
  ]) {
    const f = fixture({ period: selectedPeriod, invoices: [annual] });
    const series = modeledFullSeries(selectedPeriod);
    const result = await f.complete({ ...f.input, period: selectedPeriod, series });
    assert.equal(result.series, series);
    assert.equal(result.issues.length, 0);
  }
});

test('an invalid invoice period blocks only modelled hours while retaining measured readings', async () => {
  const selectedPeriod = period('2025-07');
  const annual = confirmedAnnualInvoice(selectedPeriod);
  annual.invoiceRecognition.fields.periodFrom = '2025-06-01';
  const f = fixture({ period: selectedPeriod, invoices: [annual] });
  const series = modeledFullSeries(selectedPeriod);
  const result = await f.complete({ ...f.input, period: selectedPeriod, series });
  assert.ok(result.series);
  assert.equal(result.series.intervals[0].import, null);
  assert.equal(result.series.intervals[0].export, null);
  assert.equal(result.series.intervals[1].import, null);
  assert.equal(result.series.intervals[1].export, null);
  assert.equal(result.series.intervals[2].import?.valueKwh, 1);
  assert.equal(result.series.intervals[2].import?.source, 'measured');
  assert.ok(result.issues.some((issue: string) => issue.includes('sprzeczne z okresem pomiarów')));
});

test('no source readings and no physical invoice observations return a quiet null result', async () => {
  const f = fixture();
  const result = await f.complete();
  assert.equal(result.series, null);
  assert.equal(result.issues.length, 0);
  assert.equal(result.revisionKey, null);
  assert.equal(f.state.queries.length, 1);
  assert.equal(f.state.catalogReads, 0);
  assert.equal(f.state.pvCalls, 0);
});

test('partial real target-year readings take precedence over the same-month invoice from another year', async () => {
  const f = fixture({ invoices: [invoice({ after: 1 })] });
  const series = seriesWithOneAnchor(f.state.period);
  series.intervals[0].import!.valueKwh = 10;
  const result = await f.complete({ ...f.input, series });
  assert.ok(result.series);
  assert.equal(result.series.intervals.length, 8760);
  assert.equal(result.series.intervals[0].import.valueKwh, 10);
  assert.equal(f.state.modelInputs[0].invoices.length, 0);
});

test('unknown or present existing battery and unknown PV block reconstruction before catalog reads', async () => {
  for (const patch of [
    { existingBatteryPresent: null },
    { existingBatteryPresent: true },
    { pv: { powerKw: null, tiltDegrees: null, azimuthDegrees: null, lossPercent: null, latitude: null, longitude: null } },
  ]) {
    const f = fixture({ invoices: [invoice()] });
    const result = await f.complete({ ...f.input, ...patch });
    assert.equal(result.series, null);
    assert.equal(result.issues.length, 1);
    assert.equal(f.state.catalogReads, 0);
    assert.equal(f.state.pvCalls, 0);
  }
});

test('single historical invoice month can anchor a complete modeled year and reports its source month', async () => {
  const f = fixture({ invoices: [invoice()] });
  const result = await f.complete();
  assert.ok(result.series);
  assert.equal(result.series.intervals.length, 8760);
  assert.ok(result.series.periods.every((item: any) => item.hasImport && item.hasExport));
  assert.ok(result.series.intervals.every((interval: any) => interval.import.source === 'modelled' && interval.export.source === 'modelled'));
  assert.ok(result.issues.some((issue: string) => issue.includes('profilu Profil bdew-2025-h25')));
  assert.ok(result.issues.some((issue: string) => issue.includes('2024-01 → 2025-01')));
  assert.equal(f.state.modelInputs[0].invoices.length, 1);
  assert.equal(f.state.modelInputs[0].invoices[0].id, 'invoice-1#2024-01');
  assert.equal(f.state.modelInputs[0].invoices[0].fromDate, '2025-01-01');
  assert.equal(f.state.queries[0].where.projectId, 'project-1');
  assert.equal(f.state.queries[0].where.clientId, 'client-1');
  assert.equal(f.state.queries[0].where.type, 'FAKTURA_PRAD');
  assert.equal(f.state.pvCalls, 0, 'confirmed no-PV uses exact zero values');
});

test('ordinary metered invoice anchors a known no-PV property without pretending hourly balancing', async () => {
  const row = invoice({ after: null });
  row.invoiceRecognition.fields.consumption.meteredImportKwh = 845;
  row.invoiceRecognition.fields.consumption.importBasis = 'METERED';
  const f = fixture({ invoices: [row] });
  const result = await f.complete();
  assert.ok(result.series);
  assert.equal(f.state.modelInputs[0].invoices[0].importKwh, 845);
  assert.equal(row.invoiceRecognition.fields.consumption.totalAfterBalancingKwh, undefined);
  for (const powerKw of [null, 13]) {
    const other = fixture({ invoices: [row] });
    const blocked = await other.complete({ ...other.input, pv: { ...other.input.pv, powerKw } });
    assert.equal(blocked.series, null);
    assert.equal(other.state.modelCalls, 0);
  }
});

test('profile families follow client and heating source, while a saved profile is the sole candidate', async () => {
  const cases = [
    { clientType: 'B2C', heatingSource: 'NATURAL_GAS', heatingSourceDetail: 'GAS_CONDENSING', expected: ['bdew-2025-h25', 'vdew-1999-h0'] },
    { clientType: 'B2C', heatingSource: 'ELECTRICITY', heatingSourceDetail: 'HEAT_PUMP_GROUND', expected: [
      'opsd_20200415_de_kn_residential4_household_heat_pump',
    ] },
    { clientType: 'B2C', heatingSource: 'HEAT_PUMP', heatingSourceDetail: null, expected: [
      'opsd_20200415_de_kn_residential4_household_heat_pump',
    ] },
    { clientType: 'B2C', heatingSource: 'heat_pump', heatingSourceDetail: null, expected: [
      'opsd_20200415_de_kn_residential4_household_heat_pump',
    ] },
    { clientType: 'B2B', heatingSource: 'NATURAL_GAS', heatingSourceDetail: 'GAS_CONDENSING', expected: [
      'bdew-2025-g25', ...Array.from({ length: 7 }, (_, index) => `vdew-1999-g${index}`),
    ] },
  ];
  for (const item of cases) {
    const f = fixture();
    await f.complete({ ...f.input, series: seriesWithOneAnchor(f.state.period), ...item });
    assert.deepEqual(Array.from(f.state.candidates), item.expected);
  }
  const f = fixture({ selectedProfile: { key: 'vdew-1999-g6', revision: 2, contentHash: 'saved-hash', profileName: 'Wybrany' } });
  await f.complete({ ...f.input, series: seriesWithOneAnchor(f.state.period) });
  assert.deepEqual(Array.from(f.state.candidates), ['vdew-1999-g6']);
  assert.equal(f.state.resolverCalls, 1);
});

test('duplicate invoice content is deduplicated and distinct monthly observations receive unique IDs', async () => {
  const monthly = [
    { year: 2024, month: 1, period: '2024-01', consumptionAfterBalancingKwh: 1000 },
    { year: 2024, month: 2, period: '2024-02', consumptionAfterBalancingKwh: 900 },
  ];
  const duplicate = invoice({ id: 'invoice-1-copy', monthly });
  const first = invoice({ id: 'invoice-1', monthly });
  const f = fixture({ invoices: [duplicate, first] });
  await f.complete();
  assert.equal(f.state.modelInputs[0].invoices.length, 2);
  assert.deepEqual(Array.from(f.state.modelInputs[0].invoices, (item: any) => item.id), ['invoice-1#2024-01', 'invoice-1#2024-02']);
});

test('PPE mismatch and before-only billing quantities are not used as physical invoice anchors', async () => {
  const mismatch = fixture({ invoices: [invoice({ ppeNumber: '111111111111111111' })] });
  const mismatchResult = await mismatch.complete();
  assert.ok(mismatchResult.issues.some((issue: string) => issue.includes('zgodnego numeru PPE')));
  assert.equal(mismatch.state.modelCalls, 0);

  const beforeOnly = fixture({ invoices: [invoice({ after: null, before: 1200 })] });
  const beforeResult = await beforeOnly.complete();
  assert.ok(beforeResult.issues.some((issue: string) => issue.includes('przed bilansowaniem')));
  assert.equal(beforeOnly.state.modelCalls, 0);
});

test('refresh regenerates from the original series for changed unsaved PV geometry and memoizes shapes', async () => {
  const f = fixture({ invoices: [invoice()] });
  const initial = await f.complete();
  assert.ok(initial.series);
  const pv = { powerKw: 3, tiltDegrees: 35, azimuthDegrees: 180, lossPercent: 14, latitude: 52.2, longitude: 21.0 };
  const refreshed = await f.refresh(initial.series, pv);
  assert.notEqual(refreshed, initial.series);
  assert.equal(f.state.modelCalls, 2);
  assert.equal(f.state.pvCalls, 1);
  const second = await f.refresh(refreshed, pv);
  assert.equal(second, refreshed);
  assert.equal(f.state.modelCalls, 2);
  assert.equal(f.state.annualBuilds.length, 2, 'candidate shapes are projected once and reused from the bounded cache');
});
