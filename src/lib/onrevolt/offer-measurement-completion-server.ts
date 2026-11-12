import { createHash } from 'node:crypto';
import { prisma } from './prisma';
import type { EnergyMeasurementInterval } from './energy-measurement-document';
import type { OfferMeasurementSeries } from './offer-measurements';
import { completeOfferMeasurementGaps } from './offer-measurement-gap-model';
import { readReferenceProfileCatalog } from './reference-profile-catalog-server';
import {
  getReferenceProfileCalculationEligibility,
  type CatalogProfile,
} from './reference-profile-comparison';
import {
  resolveSelectedReferenceProfile,
  type ProjectReferenceProfileSelection,
} from './project-reference-profile';
import { profileContentHash } from '../../../scripts/profile-catalog/storage-core';
import { buildAnnualOfferConsumptionProfile } from './offer-workspace-annual-profile';
import { getOfferPvSourceRevision } from './offer-pv-source-revision';
import { readOfferPvProfileWithSourceRevision } from './offer-pv-profile';
import type { ProjectAnalysisPeriod } from './project-analysis-period';
import { recalibrateOfferMeasurementInvoices } from './offer-measurement-invoice-recalibration';

const COMPLETION_VERSION = 'project-offer-measurement-completion-v2-invoice-recalibration';
const SHAPE_ANNUAL_KWH = 10_000;
const HOUR_MS = 60 * 60 * 1000;
const MAX_CACHED_SHAPES = 32;

export type CompleteProjectOfferMeasurementsInput = {
  projectId: string;
  clientId: string;
  clientType: string;
  period: ProjectAnalysisPeriod;
  series: OfferMeasurementSeries | null;
  ppeNumber: string | null;
  heatingSource: string | null;
  heatingSourceDetail: string | null;
  existingBatteryPresent: boolean | null;
  pv: {
    powerKw: number | null;
    tiltDegrees: number | null;
    azimuthDegrees: number | null;
    lossPercent: number | null;
    latitude: number | null;
    longitude: number | null;
  };
  selectedProfile?: ProjectReferenceProfileSelection | null;
  sourceRevision?: string;
};

export type CompleteProjectOfferMeasurementsResult = {
  series: OfferMeasurementSeries | null;
  issues: string[];
  revisionKey: unknown;
};

type InvoiceRow = {
  id: string;
  sha256: string | null;
  updatedAt: Date | string;
  billingPeriodFrom: Date | string | null;
  billingPeriodTo: Date | string | null;
  invoicePpeNumber: string | null;
  invoiceRecognition: unknown;
};

type InvoiceObservation = {
  id: string;
  documentId: string;
  sourceYear: number;
  sourceMonth: number;
  sourcePeriod: string;
  scope: 'calendar-month' | 'actual-range';
  fromDate: string;
  toDate: string;
  importKwh: number;
  exportKwh?: number;
};

type Candidate = { key: string; name: string; contentHash: string; loadShape: number[] };
type CalendarHour = Pick<EnergyMeasurementInterval, 'startUtc' | 'endUtc' | 'localStart' | 'localEnd' | 'occurrence'>;

type RefreshContext = {
  baseInput: CompleteProjectOfferMeasurementsInput;
  usedPvSignature: string;
};

const refreshContexts = new WeakMap<OfferMeasurementSeries, RefreshContext>();
const projectedShapeCache = new Map<string, number[]>();

const householdProfileKeys = ['bdew-2025-h25', 'vdew-1999-h0'];
const businessProfileKeys = ['bdew-2025-g25', ...Array.from({ length: 7 }, (_, index) => `vdew-1999-g${index}`)];
const electricHeatPumpProfileKeys = [
  'opsd_20200415_de_kn_residential4_household_heat_pump',
];
const deviceHeatPumpProfileKeys = [
  'opsd_20200415_de_kn_residential1_heat_pump',
  'opsd_20200415_de_kn_residential4_heat_pump',
];

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

function sourceSeriesDigest(series: OfferMeasurementSeries | null): string | null {
  if (!series) return null;
  return createHash('sha256').update(JSON.stringify(series)).digest('hex');
}

function requestRevision(input: CompleteProjectOfferMeasurementsInput, additions: Record<string, unknown> = {}) {
  return {
    version: COMPLETION_VERSION,
    projectId: input.projectId,
    clientId: input.clientId,
    clientType: input.clientType,
    ppeNumber: input.ppeNumber,
    period: {
      startMonth: input.period.startMonth,
      endMonth: input.period.endMonth,
      periodKeys: input.period.periodKeys,
      fromUtc: input.period.fromUtc,
      untilUtc: input.period.untilUtc,
    },
    seriesSha256: sourceSeriesDigest(input.series),
    sourceRevision: input.sourceRevision || null,
    heatingSource: input.heatingSource,
    heatingSourceDetail: input.heatingSourceDetail,
    selectedProfile: input.selectedProfile || null,
    pv: input.pv,
    ...additions,
  };
}

function missingSeries(input: CompleteProjectOfferMeasurementsInput): OfferMeasurementSeries {
  const periods = input.period.periodKeys.map((period) => ({
    period,
    hasImport: false,
    hasExport: false,
    missingDirections: ['ACTIVE_IMPORT' as const, 'ACTIVE_EXPORT' as const],
  }));
  return {
    ppeNumber: input.ppeNumber || '',
    projectId: input.projectId,
    hasExistingPv: input.pv.powerKw == null ? undefined : input.pv.powerKw > 0,
    periods,
    missingMonths: periods.map(({ period }) => period),
    missingDirections: periods.flatMap(({ period }) => [
      { period, kind: 'ACTIVE_IMPORT' as const },
      { period, kind: 'ACTIVE_EXPORT' as const },
    ]),
    intervals: [],
    files: [],
  };
}

function isCompleteSeries(series: OfferMeasurementSeries | null, period: ProjectAnalysisPeriod): boolean {
  if (!series || !Array.isArray(series.intervals) || !Array.isArray(series.periods)) return false;
  const start = Date.parse(period.fromUtc);
  const until = Date.parse(period.untilUtc);
  if (!Number.isFinite(start) || !Number.isFinite(until) || until <= start || (until - start) % HOUR_MS !== 0) return false;
  const expectedHours = (until - start) / HOUR_MS;
  if (series.intervals.length !== expectedHours || series.periods.length !== period.periodKeys.length) return false;
  const periodsByKey = new Map(series.periods.map((item) => [item.period, item]));
  if (!period.periodKeys.every((key) => {
    const item = periodsByKey.get(key);
    return item?.hasImport === true && item.hasExport === true && item.missingDirections.length === 0;
  })) return false;
  const sorted = [...series.intervals].sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  return sorted.every((interval, index) => {
    const expectedStart = new Date(start + index * HOUR_MS).toISOString();
    const expectedEnd = new Date(start + (index + 1) * HOUR_MS).toISOString();
    return interval.startUtc === expectedStart && interval.endUtc === expectedEnd
      && typeof interval.import?.valueKwh === 'number' && Number.isFinite(interval.import.valueKwh)
      && typeof interval.export?.valueKwh === 'number' && Number.isFinite(interval.export.valueKwh);
  });
}

function exactPeriodCalendar(period: ProjectAnalysisPeriod): CalendarHour[] {
  const start = Date.parse(period.fromUtc);
  const until = Date.parse(period.untilUtc);
  if (!Number.isFinite(start) || !Number.isFinite(until) || until <= start || (until - start) % HOUR_MS !== 0) {
    throw new Error('Okres analizy nie zawiera pełnych godzin czasu Europe/Warsaw.');
  }
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const occurrences = new Map<string, number>();
  const calendar: CalendarHour[] = [];
  for (let epoch = start; epoch < until; epoch += HOUR_MS) {
    const endEpoch = epoch + HOUR_MS;
    const startLocal = formatter.format(new Date(epoch)).replace(' ', 'T');
    const endLocal = formatter.format(new Date(endEpoch)).replace(' ', 'T');
    const endKey = endLocal.slice(0, 13);
    const occurrence = (occurrences.get(endKey) || 0) + 1;
    occurrences.set(endKey, occurrence);
    calendar.push({
      startUtc: new Date(epoch).toISOString(), endUtc: new Date(endEpoch).toISOString(),
      localStart: startLocal, localEnd: endLocal, occurrence,
    });
  }
  return calendar;
}

function isValidKwh(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function physicalKwh(consumption: Record<string, unknown>, afterKey: string): number | null {
  const after = consumption[afterKey];
  return isValidKwh(after) ? after : null;
}

function dateKey(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === match[1] ? match[1] : null;
}

function monthKey(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function monthDateRange(period: string) {
  const [year, month] = period.split('-').map(Number);
  const last = new Date(0);
  last.setUTCFullYear(year, month, 0);
  last.setUTCHours(0, 0, 0, 0);
  return { fromDate: `${period}-01`, toDate: `${period}-${String(last.getUTCDate()).padStart(2, '0')}` };
}

function fullCalendarMonth(fromDate: string, toDate: string): { year: number; month: number } | null {
  const fromMatch = /^(\d{4})-(0[1-9]|1[0-2])-01$/.exec(fromDate);
  if (!fromMatch) return null;
  const year = Number(fromMatch[1]);
  const month = Number(fromMatch[2]);
  return monthDateRange(monthKey(year, month)).toDate === toDate ? { year, month } : null;
}

function invoiceRowsToObservations(rows: readonly InvoiceRow[], input: CompleteProjectOfferMeasurementsInput): {
  observations: InvoiceObservation[];
  revision: Array<Record<string, unknown>>;
  warnings: string[];
} {
  const ppeRows = rows.map((row) => {
    const fields = record(record(row.invoiceRecognition)?.fields);
    const documentPpe = typeof row.invoicePpeNumber === 'string' ? row.invoicePpeNumber.trim() : '';
    const recognizedPpe = typeof fields?.ppeNumber === 'string' ? fields.ppeNumber.trim() : '';
    const ppes = [documentPpe, recognizedPpe].filter(Boolean);
    return { row, ppes, conflicting: new Set(ppes).size > 1 };
  });
  let allowedPpe = input.ppeNumber;
  if (!allowedPpe) {
    const distinct = new Set(ppeRows.flatMap(({ ppes, conflicting }) => conflicting ? [] : ppes));
    if (distinct.size > 1) throw new Error('Faktury projektu zawierają różne numery PPE; nie można mieszać ich zużycia.');
    allowedPpe = [...distinct][0] || null;
  }
  let skippedPpeRows = false;
  const scopedRows = ppeRows.filter(({ ppes, conflicting }) => {
    const use = !conflicting && Boolean(allowedPpe) && ppes.length > 0 && ppes.every((ppe) => ppe === allowedPpe);
    if (!use) skippedPpeRows = true;
    return use;
  }).map(({ row }) => row);

  const uniqueRows: InvoiceRow[] = [];
  const seenHashes = new Set<string>();
  for (const row of [...scopedRows].sort((a, b) => a.id.localeCompare(b.id))) {
    if (row.sha256 && seenHashes.has(row.sha256)) continue;
    if (row.sha256) seenHashes.add(row.sha256);
    uniqueRows.push(row);
  }

  const observations: InvoiceObservation[] = [];
  let sawBeforeOnlyInvoice = false;
  const revision = rows.map((row) => ({
    id: row.id,
    sha256: row.sha256,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    billingPeriodFrom: dateKey(row.billingPeriodFrom),
    billingPeriodTo: dateKey(row.billingPeriodTo),
    invoicePpeNumber: row.invoicePpeNumber,
  }));

  for (const row of uniqueRows) {
    const recognition = record(row.invoiceRecognition);
    const fields = record(recognition?.fields);
    const consumption = record(fields?.consumption);
    if (!fields || !consumption) continue;
    const ppeNumbers = [row.invoicePpeNumber, fields.ppeNumber]
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
    if (input.ppeNumber && ppeNumbers.some((ppe) => ppe !== input.ppeNumber)) continue;

    const monthly = Array.isArray(consumption.monthly) ? consumption.monthly : [];
    const usableMonthly: InvoiceObservation[] = [];
    for (const rawMonth of monthly) {
      const item = record(rawMonth);
      if (!item) continue;
      const year = Number(item.year);
      const month = Number(item.month);
      if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 1 || month > 12) continue;
      const key = monthKey(year, month);
      if (typeof item.period === 'string' && item.period !== key) continue;
      if (!isValidKwh(item.consumptionAfterBalancingKwh)
        && isValidKwh(item.consumptionBeforeBalancingKwh)) sawBeforeOnlyInvoice = true;
      const importKwh = physicalKwh(item, 'consumptionAfterBalancingKwh');
      if (importKwh === null) continue;
      const range = monthDateRange(key);
      const exportKwh = physicalKwh(item, 'exportedAfterBalancingKwh');
      usableMonthly.push({ id: `${row.id}#${key}`, documentId: row.id, sourceYear: year, sourceMonth: month,
        sourcePeriod: key, scope: 'calendar-month', ...range, importKwh,
        ...(exportKwh === null ? {} : { exportKwh }) });
    }
    if (usableMonthly.length) {
      observations.push(...usableMonthly);
      continue;
    }

    const fromDate = dateKey(fields.periodFrom) || dateKey(row.billingPeriodFrom);
    const toDate = dateKey(fields.periodTo) || dateKey(row.billingPeriodTo);
    if (!isValidKwh(consumption.totalAfterBalancingKwh)
      && isValidKwh(consumption.totalBeforeBalancingKwh)) sawBeforeOnlyInvoice = true;
    // Ordinary meter totals can anchor a known no-PV property. They are not
    // evidence of hourly balancing for a prosumer or an unknown PV setup.
    const importKwh = consumption.importBasis === 'METERED'
      ? (input.pv.powerKw === 0 ? physicalKwh(consumption, 'meteredImportKwh') : null)
      : physicalKwh(consumption, 'totalAfterBalancingKwh');
    if (!fromDate || !toDate || importKwh === null) continue;
    const exportKwh = physicalKwh(consumption, 'exportedAfterBalancingKwh');

    const oneMonth = fullCalendarMonth(fromDate, toDate);
    if (oneMonth) {
      const sourcePeriod = monthKey(oneMonth.year, oneMonth.month);
      observations.push({ id: `${row.id}#${sourcePeriod}`, documentId: row.id,
        sourceYear: oneMonth.year, sourceMonth: oneMonth.month, sourcePeriod, scope: 'calendar-month',
        fromDate, toDate, importKwh, ...(exportKwh === null ? {} : { exportKwh }) });
      continue;
    }

    const fromYear = Number(input.period.startMonth.slice(0, 4));
    const fromMonth = Number(input.period.startMonth.slice(5, 7));
    const actualStart = `${input.period.startMonth}-01`;
    const actualEnd = input.period.endDate;
    const analysisEndMonth = input.period.endMonth;
    const analysisYear = Number(analysisEndMonth.slice(0, 4));
    const analysisMonth = Number(analysisEndMonth.slice(5, 7));
    if (fromDate === actualStart && toDate === actualEnd
      && oneMonth === null && fromYear > 0 && fromMonth > 0 && analysisYear > 0 && analysisMonth > 0) {
      observations.push({ id: `${row.id}#${fromDate}_${toDate}`, documentId: row.id,
        sourceYear: fromYear, sourceMonth: fromMonth, sourcePeriod: `${fromDate.slice(0, 7)}–${toDate.slice(0, 7)}`,
        scope: 'actual-range',
        fromDate, toDate, importKwh, ...(exportKwh === null ? {} : { exportKwh }) });
      continue;
    }

    if (fromDate >= actualStart && toDate <= actualEnd && fromDate < toDate) {
      const sourcePeriod = `${fromDate.slice(0, 7)}–${toDate.slice(0, 7)}`;
      observations.push({ id: `${row.id}#${fromDate}_${toDate}`, documentId: row.id,
        sourceYear: Number(fromDate.slice(0, 4)), sourceMonth: Number(fromDate.slice(5, 7)),
        sourcePeriod, scope: 'actual-range', fromDate, toDate, importKwh,
        ...(exportKwh === null ? {} : { exportKwh }) });
    }
  }
  return { observations, revision,
    warnings: [
      ...(sawBeforeOnlyInvoice ? ['Pominięto faktury bez zużycia po bilansowaniu; wartości przed bilansowaniem nie zostały użyte.'] : []),
      ...(skippedPpeRows ? ['Pominięto faktury bez zgodnego numeru PPE.'] : []),
    ],
  };
}

function targetInvoices(observations: readonly InvoiceObservation[], period: ProjectAnalysisPeriod): InvoiceObservation[] {
  const actualStart = `${period.startMonth}-01`;
  const result = observations.filter((observation) => observation.scope === 'actual-range'
    && observation.fromDate >= actualStart && observation.toDate <= period.endDate);

  for (const targetPeriod of period.periodKeys) {
    const [targetYear, targetMonth] = targetPeriod.split('-').map(Number);
    const candidates = observations.filter((observation) => observation.scope === 'calendar-month'
      && observation.sourceMonth === targetMonth);
    if (!candidates.length) continue;
    const years = [...new Set(candidates.map((candidate) => candidate.sourceYear))];
    const selectedYear = years.includes(targetYear) ? targetYear : years.reduce((best, year) => {
      const distance = Math.abs(year - targetYear);
      const bestDistance = Math.abs(best - targetYear);
      return distance < bestDistance || (distance === bestDistance && year < best) ? year : best;
    });
    const range = monthDateRange(targetPeriod);
    for (const observation of candidates) {
      if (observation.sourceYear === selectedYear) {
        result.push({ ...observation, fromDate: range.fromDate, toDate: range.toDate });
      }
    }
  }
  return result;
}

function invoicesWithMissingImportHours(
  invoices: readonly InvoiceObservation[],
  series: OfferMeasurementSeries,
  calendar: readonly CalendarHour[],
): InvoiceObservation[] {
  const readingsByStart = new Map(series.intervals.map((interval) => [interval.startUtc, interval]));
  return invoices.filter((invoice) => {
    const hours = calendar.filter(hour => {
      const date = hour.localStart.slice(0, 10);
      return date >= invoice.fromDate && date <= invoice.toDate;
    });
    const historical = invoice.scope === 'calendar-month' && invoice.sourcePeriod !== invoice.fromDate.slice(0, 7);
    // A total from a different year must never constrain actual target-year readings.
    if (historical && hours.some(hour => {
      const reading = readingsByStart.get(hour.startUtc)?.import;
      return reading && reading.source !== 'modelled';
    })) return false;
    return hours.some(hour => readingsByStart.get(hour.startUtc)?.import?.valueKwh == null);
  });
}

function readProjectInvoices(input: CompleteProjectOfferMeasurementsInput): Promise<InvoiceRow[]> {
  return prisma.document.findMany({
    where: { projectId: input.projectId, clientId: input.clientId, type: 'FAKTURA_PRAD' },
    select: {
      id: true, sha256: true, updatedAt: true, billingPeriodFrom: true, billingPeriodTo: true,
      invoicePpeNumber: true, invoiceRecognition: true,
    },
    orderBy: [{ id: 'asc' }],
  }) as Promise<InvoiceRow[]>;
}

function automaticProfileKeys(input: CompleteProjectOfferMeasurementsInput): string[] {
  if (input.clientType === 'B2B') return businessProfileKeys;
  if (input.clientType !== 'B2C') return [];
  // These aliases remain accepted by the client form for older imported records.
  if (['HEAT_PUMP', 'heat_pump'].includes(input.heatingSource || '')) return electricHeatPumpProfileKeys;
  if (['ELECTRICITY', 'ELECTRIC', 'electric'].includes(input.heatingSource || '')) {
    return input.heatingSourceDetail === 'HEAT_PUMP_AIR' || input.heatingSourceDetail === 'HEAT_PUMP_GROUND'
      ? electricHeatPumpProfileKeys
      : [];
  }
  return input.heatingSource ? householdProfileKeys : [];
}

async function loadCandidates(input: CompleteProjectOfferMeasurementsInput): Promise<Candidate[]> {
  const catalog = await readReferenceProfileCatalog();
  const selected = input.selectedProfile?.key ? await resolveSelectedReferenceProfile(input.selectedProfile) : null;
  const allowedKeys = automaticProfileKeys(input);
  const requestedKeys = selected ? [selected.profile.key] : allowedKeys;
  if (!requestedKeys.length) {
    throw new Error(input.clientType === 'B2C' && ['ELECTRICITY', 'ELECTRIC', 'electric'].includes(input.heatingSource || '')
      ? 'Brak dobranej rodziny profili dla ogrzewania elektrycznego bez rozpoznanej pompy ciepła. Wskaż jawny profil referencyjny.'
      : 'Brak profilu domyślnego dla typu klienta i źródła ogrzewania. Wybierz profil referencyjny.');
  }

  const profiles = new Map(catalog.map((profile) => [profile.key, profile]));
  if (selected) profiles.set(selected.profile.key, selected.profile);
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const key of requestedKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const profile = profiles.get(key);
    if (!profile) continue;
    const eligibility = getReferenceProfileCalculationEligibility(profile);
    if (!eligibility.eligible) continue;
    const contentHash = selected?.profile.key === key ? selected.contentHash : profileContentHash(profile as any);
    const shapeKey = JSON.stringify([profile.key, contentHash, input.period.periodKeys, input.period.fromUtc,
      input.period.untilUtc, 'reference-profile-projection-v1']);
    let loadShape = projectedShapeCache.get(shapeKey);
    if (loadShape) {
      projectedShapeCache.delete(shapeKey);
      projectedShapeCache.set(shapeKey, loadShape);
    } else {
      const projected = buildAnnualOfferConsumptionProfile({
        annualConsumptionKwh: SHAPE_ANNUAL_KWH,
        period: input.period,
        referenceProfile: { profile, contentHash },
      });
      loadShape = Object.freeze(projected.intervals.map((interval) => interval.loadKwh)) as unknown as number[];
      projectedShapeCache.set(shapeKey, loadShape);
      while (projectedShapeCache.size > MAX_CACHED_SHAPES) {
        const oldest = projectedShapeCache.keys().next().value;
        if (oldest === undefined) break;
        projectedShapeCache.delete(oldest);
      }
    }
    if (!loadShape.length || loadShape.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error(`Profil ${profile.name} nie zwrócił kompletnego kształtu zużycia.`);
    }
    candidates.push({ key: profile.key, name: profile.name, contentHash, loadShape });
  }
  if (!candidates.length) throw new Error('Nie znaleziono kwalifikującego się profilu zużycia w katalogu.');
  return candidates;
}

function pvSignature(pv: CompleteProjectOfferMeasurementsInput['pv']): string {
  return JSON.stringify(pv);
}

function blocked(input: CompleteProjectOfferMeasurementsInput, issue: string): CompleteProjectOfferMeasurementsResult {
  return { series: input.series, issues: [issue], revisionKey: requestRevision(input) };
}

function annualPostBalancedInvoiceTargets(
  rows: readonly InvoiceRow[],
  input: CompleteProjectOfferMeasurementsInput,
): {
  revision: Array<Record<string, unknown>>;
  targets: Array<{ id: string; fromDate: string; toDate: string; importKwh: number; exportKwh: number }>;
  issue: string | null;
} {
  const fromDate = `${input.period.startMonth}-01`;
  const toDate = input.period.endDate;
  const revision = rows.map((row) => ({
    id: row.id,
    sha256: row.sha256,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    billingPeriodFrom: dateKey(row.billingPeriodFrom),
    billingPeriodTo: dateKey(row.billingPeriodTo),
    invoicePpeNumber: row.invoicePpeNumber,
    recognition: row.invoiceRecognition,
  }));
  if (!input.ppeNumber) return { revision, targets: [], issue: null };
  const ppe = input.ppeNumber.trim().replace(/\s+/g, '').toUpperCase();
  const candidates: Array<{ id: string; fromDate: string; toDate: string; importKwh: number; exportKwh: number }> = [];
  for (const row of rows) {
    const recognition = record(row.invoiceRecognition);
    if (recognition?.provider !== 'ENEA') continue;
    const fields = record(recognition.fields);
    const consumption = record(fields?.consumption);
    const documentPpe = typeof row.invoicePpeNumber === 'string'
      ? row.invoicePpeNumber.trim().replace(/\s+/g, '').toUpperCase() : '';
    const recognizedPpe = typeof fields?.ppeNumber === 'string'
      ? fields.ppeNumber.trim().replace(/\s+/g, '').toUpperCase() : '';
    if (documentPpe !== ppe || recognizedPpe !== ppe) continue;
    const confirmation = record(recognition.confirmation);
    if (typeof confirmation?.confirmedAt !== 'string' || !confirmation.confirmedAt.trim()
      || typeof confirmation.confirmedById !== 'string' || !confirmation.confirmedById.trim()) continue;

    const documentFrom = dateKey(row.billingPeriodFrom);
    const documentTo = dateKey(row.billingPeriodTo);
    const recognizedFrom = dateKey(fields?.periodFrom as string | undefined);
    const recognizedTo = dateKey(fields?.periodTo as string | undefined);
    const documentMatches = documentFrom === fromDate && documentTo === toDate;
    const recognizedMatches = recognizedFrom === fromDate && recognizedTo === toDate;
    if (!documentMatches && !recognizedMatches) continue;
    if (!documentMatches || !recognizedMatches) {
      return { revision, targets: [], issue: 'Daty na potwierdzonej fakturze ENEA i w jej rozpoznanych danych są sprzeczne z okresem pomiarów; szacunków nie zmieniono.' };
    }
    const importKwh = consumption?.totalAfterBalancingKwh;
    const exportKwh = consumption?.exportedAfterBalancingKwh;
    if (!isValidKwh(importKwh) || !isValidKwh(exportKwh)) {
      return { revision, targets: [], issue: 'Potwierdzona faktura ENEA nie zawiera obu sum po bilansowaniu godzinowym; szacunków nie zmieniono.' };
    }
    candidates.push({ id: row.id, fromDate, toDate, importKwh, exportKwh });
  }
  if (candidates.length > 1) {
    const first = candidates[0];
    if (candidates.some((item) => item.importKwh !== first.importKwh || item.exportKwh !== first.exportKwh)) {
      return { revision, targets: [], issue: 'Potwierdzone faktury ENEA zawierają sprzeczne roczne sumy; szacunków nie zmieniono.' };
    }
    candidates.splice(1);
  }
  return { revision, targets: candidates, issue: null };
}

function hasModelledReadings(series: OfferMeasurementSeries): boolean {
  return series.intervals.some((interval) => interval.import?.source === 'modelled' || interval.export?.source === 'modelled');
}

function blockModelledReadings(series: OfferMeasurementSeries): OfferMeasurementSeries {
  const intervals = series.intervals.map((interval) => ({
    ...interval,
    import: interval.import?.source === 'modelled' ? null : interval.import,
    export: interval.export?.source === 'modelled' ? null : interval.export,
  }));
  const periods = series.periods.map((period) => {
    const rows = intervals.filter((interval) => interval.localStart.slice(0, 7) === period.period);
    const hasImport = rows.every((interval) => interval.import !== null);
    const hasExport = rows.every((interval) => interval.export !== null);
    return { ...period, hasImport, hasExport, missingDirections: [
      ...(!hasImport ? ['ACTIVE_IMPORT' as const] : []),
      ...(!hasExport ? ['ACTIVE_EXPORT' as const] : []),
    ] };
  });
  return { ...series, intervals, periods,
    missingMonths: periods.filter((period) => !period.hasImport && !period.hasExport).map((period) => period.period),
    missingDirections: periods.flatMap((period) => period.missingDirections.map((kind) => ({ period: period.period, kind }))),
  };
}

async function recalibrateCompleteModelledSeries(
  input: CompleteProjectOfferMeasurementsInput,
): Promise<CompleteProjectOfferMeasurementsResult> {
  const series = input.series!;
  let revisionKey: unknown = requestRevision(input, { complete: true });
  let invoiceDocuments: unknown = null;
  let invoiceTargets: unknown = null;
  let invoiceTargetIssue: string | null = null;
  try {
    const rows = await readProjectInvoices(input);
    const invoices = annualPostBalancedInvoiceTargets(rows, input);
    invoiceDocuments = invoices.revision;
    invoiceTargets = invoices.targets;
    invoiceTargetIssue = invoices.issue;
    revisionKey = requestRevision(input, { complete: true, invoiceDocuments: invoices.revision,
      invoiceTargets: invoices.targets, invoiceTargetIssue: invoices.issue });
    if (invoices.issue) {
      const blockedSeries = blockModelledReadings(series);
      revisionKey = requestRevision(input, { complete: true, invoiceDocuments: invoices.revision,
        invoiceTargets: invoices.targets, invoiceTargetIssue: invoices.issue,
        outputSeriesSha256: sourceSeriesDigest(blockedSeries) });
      return { series: blockedSeries, issues: [invoices.issue], revisionKey };
    }
    if (!invoices.targets.length) {
      revisionKey = requestRevision(input, { complete: true, invoiceDocuments: invoices.revision,
        invoiceTargets: invoices.targets, outputSeriesSha256: sourceSeriesDigest(series) });
      return { series, issues: [], revisionKey };
    }
    const invoice = invoices.targets[0];
    const result = recalibrateOfferMeasurementInvoices({ series, invoices: invoices.targets });
    revisionKey = requestRevision(input, { complete: true, invoiceDocuments: invoices.revision,
      invoiceTargets: invoices.targets, invoiceRecalibration: result.provenance,
      outputSeriesSha256: sourceSeriesDigest(result.series) });
    const item = result.provenance.invoiceResults[0];
    if (item.changedIntervals === 0) {
      return { series, issues: ['Istniejące szacunki są już uzgodnione z fakturą ENEA; w tym okresie nie ma dodatniego nakładania się modelowanego poboru i oddania.'], revisionKey };
    }
    return {
      series: result.series,
      issues: [`Szacunki CRM uzgodniono z fakturą ENEA za ${invoice.fromDate}–${invoice.toDate}: pobór ${item.afterImportKwh} kWh, oddanie ${item.afterExportKwh} kWh. Odczyty rzeczywiste i operatora oznaczone jako szacowane pozostały bez zmian.`,
        `Zmiana objęła ${item.changedIntervals} godzin modelowanych; profil godzinowy zachowano i przeskalowano osobno dla poboru oraz oddania.`],
      revisionKey,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const blockedSeries = blockModelledReadings(series);
    revisionKey = requestRevision(input, { complete: true, invoiceDocuments, invoiceTargets,
      invoiceTargetIssue, invoiceRecalibrationError: reason,
      outputSeriesSha256: sourceSeriesDigest(blockedSeries) });
    return { series: blockedSeries, issues: [`Nie można uzgodnić szacunków z fakturą ENEA: ${reason} Szacunki odłączono od obliczeń do czasu uzupełnienia danych.`], revisionKey };
  }
}

export async function completeProjectOfferMeasurements(
  input: CompleteProjectOfferMeasurementsInput,
): Promise<CompleteProjectOfferMeasurementsResult> {
  if (isCompleteSeries(input.series, input.period)) {
    if (input.series && hasModelledReadings(input.series)) return recalibrateCompleteModelledSeries(input);
    return { series: input.series, issues: [], revisionKey: requestRevision(input, { complete: true }) };
  }

  const hasOriginalReadings = input.series?.intervals.some((interval) => interval.import !== null || interval.export !== null) || false;
  let prefetchedRows: InvoiceRow[] | null = null;
  let prefetchedInvoices: ReturnType<typeof invoiceRowsToObservations> | null = null;
  if (!hasOriginalReadings) {
    try {
      prefetchedRows = await readProjectInvoices(input);
      prefetchedInvoices = invoiceRowsToObservations(prefetchedRows, input);
      if (!targetInvoices(prefetchedInvoices.observations, input.period).length) {
        return {
          series: prefetchedInvoices.warnings.length ? input.series : null,
          issues: prefetchedInvoices.warnings,
          revisionKey: null,
        };
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { series: input.series, issues: [`Nie można sprawdzić faktur projektu: ${reason}`], revisionKey: null };
    }
  }

  if (input.existingBatteryPresent == null) {
    return blocked(input, 'Brak potwierdzenia, czy projekt ma istniejący magazyn energii; brakujące pomiary nie zostały zamodelowane.');
  }
  if (input.existingBatteryPresent) {
    return blocked(input, 'Projekt ma istniejący magazyn energii, którego przepływów historycznych nie odtwarza model; pomiary nie zostały uzupełnione.');
  }
  if (input.pv.powerKw == null) {
    return blocked(input, 'Brak potwierdzonej mocy istniejącej instalacji PV (0 kW, jeśli jej nie ma); pomiary nie zostały uzupełnione.');
  }
  if (input.pv.powerKw > 0 && (input.pv.tiltDegrees == null || input.pv.azimuthDegrees == null
    || input.pv.lossPercent == null || input.pv.latitude == null || input.pv.longitude == null)) {
    return blocked(input, 'Brak pełnej geometrii lub lokalizacji istniejącej PV; pomiary nie zostały uzupełnione.');
  }

  let revisionKey: unknown = requestRevision(input);
  let invoiceWarnings: string[] = [];
  try {
    if (!input.projectId.trim() || !input.clientId.trim()) throw new Error('Wymagane jest powiązanie z klientem i projektem.');
    const [rows, candidates] = await Promise.all([
      prefetchedRows ? Promise.resolve(prefetchedRows) : readProjectInvoices(input),
      loadCandidates(input),
    ]);
    const parsedInvoices = prefetchedInvoices || invoiceRowsToObservations(rows, input);
    invoiceWarnings = parsedInvoices.warnings;
    revisionKey = requestRevision(input, {
      invoiceDocuments: parsedInvoices.revision,
      invoiceWarnings,
    });
    const candidateInvoices = targetInvoices(parsedInvoices.observations, input.period);

    const firstShape = candidates[0].loadShape;
    const calendar = exactPeriodCalendar(input.period);
    if (firstShape.length !== calendar.length || candidates.some((candidate) => candidate.loadShape.length !== calendar.length)) {
      throw new Error('Profile i kalendarz analizy nie mają tego samego zakresu godzin.');
    }

    let pvKwh: number[];
    let pvSourceRevision: string | null;
    if (input.pv.powerKw === 0) {
      pvKwh = new Array(calendar.length).fill(0);
      pvSourceRevision = null;
    } else {
      const location = { latitude: input.pv.latitude!, longitude: input.pv.longitude! };
      const sourceBefore = getOfferPvSourceRevision(location);
      const profileRead = await readOfferPvProfileWithSourceRevision({
        ...location,
        powerKw: input.pv.powerKw,
        tiltDegrees: input.pv.tiltDegrees!,
        azimuthDegrees: input.pv.azimuthDegrees!,
        lossPercent: input.pv.lossPercent!,
        fromUtc: input.period.fromUtc,
        untilUtc: input.period.untilUtc,
      });
      const sourceAfter = getOfferPvSourceRevision(location);
      if (!profileRead.sourceRevision || profileRead.sourceRevision !== sourceAfter
        || (sourceBefore !== null && sourceBefore !== profileRead.sourceRevision)) {
        throw new Error('Źródło danych PV zmieniło się podczas tworzenia modelu. Ponów obliczenia.');
      }
      if (profileRead.profile.hours.length !== calendar.length
        || profileRead.profile.hours.some((hour, index) => hour.startUtc !== calendar[index].startUtc)) {
        throw new Error('Profil PV nie pokrywa się z godzinami okresu analizy.');
      }
      pvKwh = profileRead.profile.hours.map((hour) => hour.pvKwh);
      pvSourceRevision = profileRead.sourceRevision;
    }

    const baseSeries = input.series || missingSeries(input);
    const invoices = invoicesWithMissingImportHours(candidateInvoices, baseSeries, calendar);
    const modelInvoices = invoices.map(({ id, fromDate, toDate, importKwh, exportKwh }) => ({
      id, fromDate, toDate, importKwh, ...(exportKwh === undefined ? {} : { exportKwh }),
    }));
    const outcome = completeOfferMeasurementGaps({
      series: baseSeries,
      calendar,
      pvKwh,
      candidates,
      invoices: modelInvoices,
    }) as { series: OfferMeasurementSeries; provenance: Record<string, any> };
    const provenance = outcome.provenance || {};
    const chosenCandidate = candidates.find((candidate) => candidate.key === provenance.profileKey);
    const modelledHours = Number(provenance.modelledHours) || 0;
    const modelName = typeof provenance.profileName === 'string'
      ? provenance.profileName
      : chosenCandidate?.name || 'profilu referencyjnego';
    const confidence = provenance.confidence;
    const issues = [
      `Brakujące pomiary uzupełniono jako modelowany szacunek na podstawie profilu ${modelName} (${modelledHours} godzin).`,
    ];
    if (confidence === 'low') issues.push('Niska pewność modelu: dopasowanie ma ograniczone dane kalibracyjne.');
    if (parsedInvoices.warnings.length) issues.push(...parsedInvoices.warnings);
    const historicOrigins = [...new Set(invoices.flatMap((invoice) => (
      invoice.scope === 'calendar-month' && invoice.sourcePeriod !== invoice.fromDate.slice(0, 7)
        ? [`${invoice.sourcePeriod} → ${invoice.fromDate.slice(0, 7)}`]
        : []
    )))].sort();
    if (historicOrigins.length) issues.push(`Historyczne dane miesięczne użyto jako wzorzec dla: ${historicOrigins.join(', ')}.`);
    if (chosenCandidate && deviceHeatPumpProfileKeys.includes(chosenCandidate.key)) {
      const home = chosenCandidate.key.includes('residential1_') ? 'Dom 1' : 'Dom 4';
      issues.push(`Profil pompy ciepła OPSD ${home} jest słabym, sezonowym przybliżeniem profilu całego domu; nie stanowi pełnego profilu pomiarowego gospodarstwa.`);
    }
    if (chosenCandidate && electricHeatPumpProfileKeys.includes(chosenCandidate.key)) {
      issues.push('Profil całego domu z pompą wyznaczono z bilansu energii jednego domu OPSD, bez zmierzonego ładowania auta. Dopasowanie do klienta jest szacunkiem.');
    }
    if (Array.isArray(provenance.notes)) {
      for (const note of provenance.notes) {
        if (typeof note !== 'string' || !note.startsWith('Eksport z tego samego modelu obciążenia')) continue;
        const mismatch = /wynosi ([\d.]+) kWh, a faktura .* podaje ([\d.]+) kWh/u.exec(note);
        issues.push(mismatch
          ? `Eksport z modelu (${mismatch[1]} kWh) różni się od faktury (${mismatch[2]} kWh); zachowano wynik modelu.`
          : 'Eksport z modelu różni się od faktury; zachowano wynik modelu.');
      }
    }

    revisionKey = requestRevision(input, {
      invoiceDocuments: parsedInvoices.revision,
      invoiceWarnings: parsedInvoices.warnings,
      matchedInvoices: invoices.map(({ id, documentId, sourcePeriod, fromDate, toDate, importKwh, exportKwh }) => ({
        id, documentId, sourcePeriod, fromDate, toDate, importKwh, exportKwh: exportKwh ?? null,
      })),
      candidates: candidates.map(({ key, contentHash }) => ({ key, contentHash })),
      profileSelection: input.selectedProfile || null,
      chosenProfile: chosenCandidate ? { key: chosenCandidate.key, contentHash: chosenCandidate.contentHash } : null,
      pvSourceRevision,
    });

    if (outcome.series !== baseSeries) {
      refreshContexts.set(outcome.series, {
        baseInput: { ...input, series: input.series },
        usedPvSignature: pvSignature(input.pv),
      });
    }
    return { series: outcome.series, issues, revisionKey };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      series: input.series,
      issues: [...invoiceWarnings, `Nie udało się uzupełnić brakujących pomiarów: ${reason}`],
      revisionKey,
    };
  }
}

export async function refreshCompletedOfferMeasurements(
  series: OfferMeasurementSeries,
  pv: CompleteProjectOfferMeasurementsInput['pv'],
): Promise<OfferMeasurementSeries> {
  const context = refreshContexts.get(series);
  if (!context || context.usedPvSignature === pvSignature(pv)) return series;
  const result = await completeProjectOfferMeasurements({ ...context.baseInput, pv });
  if (!result.series || result.series === context.baseInput.series) {
    throw new Error(result.issues.join(' ') || 'Nie udało się odtworzyć modelu pomiarów dla nowej geometrii PV.');
  }
  return result.series;
}
