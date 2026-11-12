import type { OfferMeasurementInterval, OfferMeasurementKind, OfferMeasurementSeries, OfferMeasurementSource } from './offer-measurements';

export type OfferMeasurementGapCalendarInterval = Pick<
  OfferMeasurementInterval,
  'localStart' | 'localEnd' | 'startUtc' | 'endUtc' | 'occurrence'
>;

export type OfferMeasurementGapCandidate = {
  key: string;
  name: string;
  contentHash: string;
  /** Hourly reference load shape aligned with `calendar`; its absolute scale is fitted here. */
  loadShape: number[];
};

export type OfferMeasurementGapInvoice = {
  id: string;
  fromDate: string;
  toDate: string;
  /** Physical grid import only; the caller must not pass a billed amount after export offset. */
  importKwh: number;
  exportKwh?: number;
};

export type OfferMeasurementGapInput = {
  series: OfferMeasurementSeries;
  calendar: OfferMeasurementGapCalendarInterval[];
  /** PV generation aligned one-to-one with `calendar`; use zero only when no PV is confirmed. */
  pvKwh: number[];
  candidates: OfferMeasurementGapCandidate[];
  invoices: OfferMeasurementGapInvoice[];
};

export type OfferMeasurementGapProvenance = {
  profileKey: string | null;
  profileName: string | null;
  profileHash: string | null;
  calibrationHours: number;
  measuredCalibrationHours: number;
  estimatedCalibrationHours: number;
  reusedCalibrationHours: number;
  invoiceIds: string[];
  modelledHours: number;
  confidence: 'low' | 'medium';
  fitError: number;
  notes: string[];
};

export type OfferMeasurementGapResult = {
  series: OfferMeasurementSeries;
  provenance: OfferMeasurementGapProvenance;
};

export type OfferMeasurementGapErrorCode = 'INVALID_INPUT' | 'NO_ANCHORS' | 'OVERLAPPING_INVOICES' | 'INVOICE_CONFLICT';

export class OfferMeasurementGapError extends Error {
  constructor(message: string, public readonly code: OfferMeasurementGapErrorCode) {
    super(message);
    this.name = 'OfferMeasurementGapError';
  }
}

type IndexedInvoice = {
  invoice: OfferMeasurementGapInvoice;
  indexes: number[];
  importIndexes: number[];
  exportIndexes: number[];
};

type Fit = {
  candidate: OfferMeasurementGapCandidate;
  scale: number;
  error: number;
  calibrationHours: number;
  measuredCalibrationHours: number;
  estimatedCalibrationHours: number;
  reusedCalibrationHours: number;
  method: 'measurements' | 'invoices';
};

const HOUR_MS = 60 * 60 * 1000;
const ENERGY_TOLERANCE_KWH = 0.05;

function gapError(message: string, code: OfferMeasurementGapErrorCode = 'INVALID_INPUT'): never {
  throw new OfferMeasurementGapError(message, code);
}

function finiteNonnegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) gapError(`${label} musi być skończoną, nieujemną wartością kWh.`);
}

function intervalKey(interval: Pick<OfferMeasurementInterval, 'startUtc' | 'endUtc'>) {
  return `${interval.startUtc}/${interval.endUtc}`;
}

function localDate(value: string, label: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match || !Number.isFinite(Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`))) {
    gapError(`${label} nie zawiera prawidłowej daty lokalnej.`);
  }
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (parsed.toISOString().slice(0, 10) !== date) gapError(`${label} nie zawiera prawidłowej daty lokalnej.`);
  return date;
}

function periodAtLocalStart(value: string) {
  return value.slice(0, 7);
}

function nextDate(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 24 * HOUR_MS).toISOString().slice(0, 10);
}

function validReading(reading: OfferMeasurementSource | null, label: string) {
  if (reading === null) return;
  finiteNonnegative(reading.valueKwh, label);
  if (!['measured', 'estimated', 'modelled'].includes(reading.source) || !Array.isArray(reading.fileIds)) {
    gapError(`${label} ma nieprawidłowe źródło lub listę plików.`);
  }
}

function validateInput(input: OfferMeasurementGapInput, requireCandidates: boolean) {
  if (!input || !input.series || !Array.isArray(input.calendar) || !Array.isArray(input.pvKwh)
    || !Array.isArray(input.candidates) || !Array.isArray(input.invoices)) {
    gapError('Brakuje danych wejściowych do uzupełnienia luk pomiarowych.');
  }
  if (!Array.isArray(input.series.intervals) || !Array.isArray(input.series.periods)
    || !Array.isArray(input.series.files) || !Array.isArray(input.series.missingMonths)
    || !Array.isArray(input.series.missingDirections)) {
    gapError('Szereg pomiarów ma niekompletną strukturę.');
  }
  if (input.calendar.length !== input.pvKwh.length) gapError('Liczba godzin profilu PV nie zgadza się z kalendarzem pomiarów.');
  if (requireCandidates && !input.candidates.length) gapError('Brak profili referencyjnych do uzupełnienia brakujących godzin.', 'NO_ANCHORS');

  const calendarKeys = new Set<string>();
  let previousStart = -Infinity;
  for (let index = 0; index < input.calendar.length; index += 1) {
    const interval = input.calendar[index];
    const start = Date.parse(interval.startUtc);
    const end = Date.parse(interval.endUtc);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== HOUR_MS
      || start <= previousStart || !Number.isInteger(interval.occurrence) || interval.occurrence < 1) {
      gapError('Kalendarz luk musi zawierać uporządkowane, pełne godziny UTC z poprawnym numerem wystąpienia.');
    }
    if (!Number.isFinite(Date.parse(interval.localStart)) || !Number.isFinite(Date.parse(interval.localEnd))) {
      gapError('Kalendarz luk zawiera nieprawidłowy czas lokalny.');
    }
    localDate(interval.localStart, 'Kalendarz luk');
    localDate(interval.localEnd, 'Kalendarz luk');
    const key = intervalKey(interval);
    if (calendarKeys.has(key)) gapError('Kalendarz luk zawiera powtórzoną godzinę.');
    calendarKeys.add(key);
    previousStart = start;
    finiteNonnegative(input.pvKwh[index], `Produkcja PV dla godziny ${interval.localStart}`);
  }

  const existingKeys = new Set<string>();
  for (const interval of input.series.intervals) {
    const start = Date.parse(interval.startUtc);
    const end = Date.parse(interval.endUtc);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) gapError('Istniejący szereg zawiera nieprawidłowy przedział pomiaru.');
    const key = intervalKey(interval);
    if (existingKeys.has(key)) gapError('Istniejący szereg zawiera powtórzony przedział pomiaru.');
    existingKeys.add(key);
    validReading(interval.import, `Import ${interval.localEnd}`);
    validReading(interval.export, `Eksport ${interval.localEnd}`);
  }

  const candidateKeys = new Set<string>();
  for (const candidate of input.candidates) {
    if (!candidate.key.trim() || !candidate.name.trim() || !candidate.contentHash.trim() || candidateKeys.has(candidate.key)) {
      gapError('Profil referencyjny ma brakujący lub powtórzony klucz, nazwę albo hash.');
    }
    candidateKeys.add(candidate.key);
    if (candidate.loadShape.length !== input.calendar.length) {
      gapError(`Profil referencyjny ${candidate.name} nie jest wyrównany z kalendarzem pomiarów.`);
    }
    let total = 0;
    for (const value of candidate.loadShape) {
      finiteNonnegative(value, `Profil referencyjny ${candidate.name}`);
      total += value;
    }
    if (!(total > 0) || !Number.isFinite(total)) gapError(`Profil referencyjny ${candidate.name} nie zawiera dodatniego zużycia.`);
  }

  const invoiceIds = new Set<string>();
  for (const invoice of input.invoices) {
    if (!invoice.id.trim() || invoiceIds.has(invoice.id)) gapError('Faktura ma brakujące lub powtórzone ID.');
    invoiceIds.add(invoice.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice.fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(invoice.toDate)
      || localDate(invoice.fromDate, `Data początkowa faktury ${invoice.id}`) !== invoice.fromDate
      || localDate(invoice.toDate, `Data końcowa faktury ${invoice.id}`) !== invoice.toDate
      || invoice.fromDate > invoice.toDate) {
      gapError(`Faktura ${invoice.id} ma nieprawidłowy zakres dat.`);
    }
    finiteNonnegative(invoice.importKwh, `Fizyczny import z faktury ${invoice.id}`);
    if (invoice.exportKwh !== undefined) finiteNonnegative(invoice.exportKwh, `Eksport z faktury ${invoice.id}`);
  }
}

function calendarAndExisting(input: OfferMeasurementGapInput) {
  const existing = new Map(input.series.intervals.map((interval) => [intervalKey(interval), interval]));
  const entries = input.calendar.map((calendarInterval, index) => ({
    calendarInterval,
    index,
    period: periodAtLocalStart(calendarInterval.localStart),
    existing: existing.get(intervalKey(calendarInterval)) || null,
  }));
  return { existing, entries };
}

function invoiceIndexes(input: OfferMeasurementGapInput, entries: ReturnType<typeof calendarAndExisting>['entries']): IndexedInvoice[] {
  const byDate = new Map<string, number[]>();
  for (const entry of entries) {
    const date = localDate(entry.calendarInterval.localStart, 'Kalendarz luk');
    const indexes = byDate.get(date) || [];
    indexes.push(entry.index);
    byDate.set(date, indexes);
  }
  const indexed = input.invoices.map((invoice): IndexedInvoice => {
    const dates: string[] = [];
    for (let date = invoice.fromDate; date <= invoice.toDate; date = nextDate(date)) dates.push(date);
    if (dates.some((date) => !byDate.has(date))) {
      gapError(`Faktura ${invoice.id} wykracza poza pełny kalendarz godzin objęty modelem.`, 'INVOICE_CONFLICT');
    }
    const indexes = dates.flatMap((date) => byDate.get(date) || []);
    return { invoice, indexes, importIndexes: [], exportIndexes: [] };
  }).sort((a, b) => a.invoice.fromDate.localeCompare(b.invoice.fromDate) || a.invoice.toDate.localeCompare(b.invoice.toDate));

  for (let index = 1; index < indexed.length; index += 1) {
    if (indexed[index].invoice.fromDate <= indexed[index - 1].invoice.toDate) {
      gapError(`Zakresy faktur ${indexed[index - 1].invoice.id} i ${indexed[index].invoice.id} nachodzą na siebie.`, 'OVERLAPPING_INVOICES');
    }
  }
  for (const invoice of indexed) {
    invoice.importIndexes = invoice.indexes.filter((hourIndex) => entries[hourIndex].existing?.import == null);
    invoice.exportIndexes = invoice.indexes.filter((hourIndex) => entries[hourIndex].existing?.export == null);
  }
  return indexed;
}

function calibrationAnchors(
  entries: ReturnType<typeof calendarAndExisting>['entries'],
  pvKwh: number[],
  series: OfferMeasurementSeries,
) {
  const reusedFileIds = new Set(series.files.filter((file) => Boolean(file.sourcePeriod)).map(({ id }) => id));
  return entries.flatMap((entry) => {
    const interval = entry.existing;
    if (!interval) return [];
    const imported = interval.import;
    const exported = interval.export;
    const importEligible = imported !== null && (imported.source !== 'modelled' || imported.fileIds.some((id) => reusedFileIds.has(id)));
    const exportEligible = exported !== null && (exported.source !== 'modelled' || exported.fileIds.some((id) => reusedFileIds.has(id)));
    const pv = pvKwh[entry.index];
    let loadKwh: number | null = null;
    let sourceKind: 'measured' | 'estimated' | 'reused' | null = null;
    if (importEligible && exportEligible) {
      loadKwh = imported!.valueKwh + Math.max(0, pv - exported!.valueKwh);
      sourceKind = imported!.source === 'modelled' || exported!.source === 'modelled'
        ? 'reused'
        : imported!.source === 'estimated' || exported!.source === 'estimated' ? 'estimated' : 'measured';
    } else if (importEligible) {
      if (imported!.valueKwh > 0 || pv === 0) loadKwh = imported!.valueKwh + pv;
      sourceKind = imported!.source === 'modelled' ? 'reused' : imported!.source;
    } else if (exportEligible && exported!.valueKwh > 0) {
      loadKwh = Math.max(0, pv - exported!.valueKwh);
      sourceKind = exported!.source === 'modelled' ? 'reused' : exported!.source;
    }
    return loadKwh === null || sourceKind === null ? [] : [{ index: entry.index, loadKwh, sourceKind }];
  });
}

function relativeError(actual: number, expected: number) {
  return Math.abs(actual - expected) / Math.max(1, Math.abs(expected));
}

function tolerance(expected: number) {
  return Math.max(ENERGY_TOLERANCE_KWH, Math.abs(expected) * 0.001);
}

function predictedImport(loadKwh: number, pvKwh: number) {
  return Math.max(0, loadKwh - pvKwh);
}

function predictedExport(loadKwh: number, pvKwh: number) {
  return Math.max(0, pvKwh - loadKwh);
}

function knownInvoiceTotal(indexes: number[], entries: ReturnType<typeof calendarAndExisting>['entries'], direction: 'import' | 'export') {
  return indexes.reduce((sum, index) => sum + (entries[index].existing?.[direction]?.valueKwh || 0), 0);
}

function solveIncreasingScale(predict: (scale: number) => number, target: number, label: string) {
  if (target <= tolerance(target)) return 0;
  let high = 1;
  let highValue = predict(high);
  for (let attempt = 0; highValue < target && attempt < 100; attempt += 1) {
    high *= 2;
    highValue = predict(high);
    if (!Number.isFinite(highValue)) break;
  }
  if (!Number.isFinite(highValue) || highValue < target) {
    gapError(`${label}: brak modelowanych godzin pozwalających uzgodnić energię z fakturą.`, 'INVOICE_CONFLICT');
  }
  let low = 0;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const middle = (low + high) / 2;
    if (predict(middle) < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function solveDecreasingScale(predict: (scale: number) => number, target: number, label: string) {
  const atZero = predict(0);
  if (target > atZero + tolerance(target)) {
    gapError(`${label}: eksport z faktury przekracza energię możliwą do oddania w modelowanych godzinach.`, 'INVOICE_CONFLICT');
  }
  if (target >= atZero - tolerance(target)) return 0;
  let high = 1;
  let highValue = predict(high);
  for (let attempt = 0; highValue > target && attempt < 100; attempt += 1) {
    high *= 2;
    highValue = predict(high);
  }
  if (!Number.isFinite(highValue) || highValue > target + tolerance(target)) {
    gapError(`${label}: brak modelowanych godzin pozwalających uzgodnić eksport z fakturą.`, 'INVOICE_CONFLICT');
  }
  let low = 0;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const middle = (low + high) / 2;
    if (predict(middle) > target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function invoiceImportResidual(invoice: IndexedInvoice, entries: ReturnType<typeof calendarAndExisting>['entries']) {
  const known = knownInvoiceTotal(invoice.indexes, entries, 'import');
  const residual = invoice.invoice.importKwh - known;
  if (residual < -tolerance(invoice.invoice.importKwh)) {
    gapError(`Znany import w okresie faktury ${invoice.invoice.id} przekracza jej fizyczny import.`, 'INVOICE_CONFLICT');
  }
  return Math.max(0, residual);
}

function invoiceExportResidual(invoice: IndexedInvoice, entries: ReturnType<typeof calendarAndExisting>['entries']) {
  const exportKwh = invoice.invoice.exportKwh;
  if (exportKwh === undefined) return null;
  const known = knownInvoiceTotal(invoice.indexes, entries, 'export');
  const residual = exportKwh - known;
  return Math.max(0, residual);
}

function fitOnMeasurements(
  candidate: OfferMeasurementGapCandidate,
  anchors: ReturnType<typeof calibrationAnchors>,
) {
  let observedTotal = 0;
  let denominator = 0;
  for (const anchor of anchors) {
    observedTotal += anchor.loadKwh;
    denominator += candidate.loadShape[anchor.index];
  }
  const scale = denominator > 0 ? Math.max(0, observedTotal / denominator) : 0;
  const meanObserved = anchors.reduce((sum, anchor) => sum + anchor.loadKwh, 0) / anchors.length;
  const rmse = Math.sqrt(anchors.reduce((sum, anchor) => {
    const residual = scale * candidate.loadShape[anchor.index] - anchor.loadKwh;
    return sum + residual * residual;
  }, 0) / anchors.length);
  return {
    scale,
    error: rmse / Math.max(1, meanObserved),
    measuredCalibrationHours: anchors.filter((anchor) => anchor.sourceKind === 'measured').length,
    estimatedCalibrationHours: anchors.filter((anchor) => anchor.sourceKind === 'estimated').length,
    reusedCalibrationHours: anchors.filter((anchor) => anchor.sourceKind === 'reused').length,
  };
}

function fitOnInvoices(
  candidate: OfferMeasurementGapCandidate,
  invoices: IndexedInvoice[],
  entries: ReturnType<typeof calendarAndExisting>['entries'],
  pvKwh: number[],
) {
  const importConstraints = invoices.map((invoice) => ({ invoice, target: invoiceImportResidual(invoice, entries) }));
  const importUnknownCount = importConstraints.reduce((sum, row) => sum + row.invoice.importIndexes.length, 0);
  let scale: number;
  let direction: 'import' | 'export';
  let constraints: Array<{ invoice: IndexedInvoice; target: number }>;

  if (importUnknownCount > 0) {
    direction = 'import';
    constraints = importConstraints;
    const totalTarget = constraints.reduce((sum, row) => sum + row.target, 0);
    if (totalTarget <= tolerance(totalTarget)) {
      const exportConstraints = invoices.flatMap((invoice) => {
        const target = invoiceExportResidual(invoice, entries);
        return target === null || !invoice.exportIndexes.length ? [] : [{ invoice, target }];
      });
      const exportTarget = exportConstraints.reduce((sum, row) => sum + row.target, 0);
      if (!exportConstraints.length || exportTarget <= tolerance(exportTarget)) {
        gapError('Faktury z zerowym importem nie pozwalają wyznaczyć rocznego obciążenia; potrzebny jest dodatni odczyt lub eksport.', 'NO_ANCHORS');
      }
      direction = 'export';
      constraints = exportConstraints;
      scale = solveDecreasingScale((factor) => constraints.reduce((sum, row) => sum + row.invoice.exportIndexes.reduce((subtotal, index) => (
        subtotal + predictedExport(factor * candidate.loadShape[index], pvKwh[index])
      ), 0), 0), exportTarget, 'Faktury');
    } else {
      scale = solveIncreasingScale((factor) => constraints.reduce((sum, row) => sum + row.invoice.importIndexes.reduce((subtotal, index) => (
        subtotal + predictedImport(factor * candidate.loadShape[index], pvKwh[index])
      ), 0), 0), totalTarget, 'Faktury');
    }
  } else {
    const exportConstraints = invoices.map((invoice) => ({ invoice, target: invoiceExportResidual(invoice, entries) }));
    if (!exportConstraints.length || exportConstraints.some((row) => row.target === null || row.invoice.exportIndexes.length === 0)) {
      gapError('Faktury nie zawierają brakującego fizycznego importu ani eksportu, który mógłby skalibrować profil.', 'NO_ANCHORS');
    }
    direction = 'export';
    constraints = exportConstraints as Array<{ invoice: IndexedInvoice; target: number }>;
    const totalTarget = constraints.reduce((sum, row) => sum + row.target, 0);
    scale = solveDecreasingScale((factor) => constraints.reduce((sum, row) => sum + row.invoice.exportIndexes.reduce((subtotal, index) => (
      subtotal + predictedExport(factor * candidate.loadShape[index], pvKwh[index])
    ), 0), 0), totalTarget, 'Faktury');
  }

  const error = constraints.reduce((sum, row) => {
    const predicted = direction === 'import'
      ? knownInvoiceTotal(row.invoice.indexes, entries, 'import') + row.invoice.importIndexes.reduce((subtotal, index) => (
        subtotal + predictedImport(scale * candidate.loadShape[index], pvKwh[index])
      ), 0)
      : knownInvoiceTotal(row.invoice.indexes, entries, 'export') + row.invoice.exportIndexes.reduce((subtotal, index) => (
        subtotal + predictedExport(scale * candidate.loadShape[index], pvKwh[index])
      ), 0);
    const expected = direction === 'import' ? row.invoice.invoice.importKwh : row.invoice.invoice.exportKwh!;
    return sum + relativeError(predicted, expected);
  }, 0) / Math.max(1, constraints.length);
  return { scale, error, method: 'invoices' as const };
}

function selectFit(
  candidates: OfferMeasurementGapCandidate[],
  anchors: ReturnType<typeof calibrationAnchors>,
  invoices: IndexedInvoice[],
  entries: ReturnType<typeof calendarAndExisting>['entries'],
  pvKwh: number[],
): Fit {
  if (!anchors.length && !invoices.length) {
    gapError('Nie ma odczytów godzinowych ani fizycznych faktur, które pozwoliłyby skalibrować profil referencyjny.', 'NO_ANCHORS');
  }
  let best: Fit | null = null;
  for (const candidate of candidates) {
    const fit = anchors.length
      ? { ...fitOnMeasurements(candidate, anchors), calibrationHours: anchors.length, method: 'measurements' as const }
      : {
        ...fitOnInvoices(candidate, invoices, entries, pvKwh),
        calibrationHours: 0,
        measuredCalibrationHours: 0,
        estimatedCalibrationHours: 0,
        reusedCalibrationHours: 0,
      };
    if (!best || fit.error < best.error - 1e-9) best = { candidate, ...fit };
  }
  if (!best) gapError('Nie udało się dobrać profilu referencyjnego.', 'NO_ANCHORS');
  return best;
}

function emptyCompletionResult(series: OfferMeasurementSeries): OfferMeasurementGapResult {
  return {
    series,
    provenance: {
      profileKey: null,
      profileName: null,
      profileHash: null,
      calibrationHours: 0,
      measuredCalibrationHours: 0,
      estimatedCalibrationHours: 0,
      reusedCalibrationHours: 0,
      invoiceIds: [],
      modelledHours: 0,
      confidence: 'low',
      fitError: 0,
      notes: ['Szereg pomiarów jest kompletny; nie dodano modelowanych odczytów.'],
    },
  };
}

function hasBroadMeasuredCoverage(anchors: ReturnType<typeof calibrationAnchors>, entries: ReturnType<typeof calendarAndExisting>['entries']) {
  const expectedByMonth = new Map<string, number>();
  for (const entry of entries) expectedByMonth.set(entry.period, (expectedByMonth.get(entry.period) || 0) + 1);
  const measuredByMonth = new Map<string, number>();
  for (const anchor of anchors) {
    if (anchor.sourceKind !== 'measured') continue;
    const period = entries[anchor.index].period;
    measuredByMonth.set(period, (measuredByMonth.get(period) || 0) + 1);
  }
  const reasonablyCoveredMonths = [...measuredByMonth].filter(([period, count]) => (
    count / (expectedByMonth.get(period) || 1) >= 0.5
  )).length;
  const hasPositiveSignal = anchors.some((anchor) => anchor.sourceKind === 'measured' && anchor.loadKwh > 0);
  return reasonablyCoveredMonths >= 2 && hasPositiveSignal;
}

function periodMetadata(
  series: OfferMeasurementSeries,
  intervals: OfferMeasurementInterval[],
  entries: ReturnType<typeof calendarAndExisting>['entries'],
) {
  const oldPeriods = new Map(series.periods.map((period) => [period.period, period]));
  const intervalsByKey = new Map(intervals.map((interval) => [intervalKey(interval), interval]));
  const byPeriod = new Map<string, OfferMeasurementInterval[]>();
  for (const entry of entries) {
    const list = byPeriod.get(entry.period) || [];
    list.push(intervalsByKey.get(intervalKey(entry.calendarInterval))!);
    byPeriod.set(entry.period, list);
  }
  const periods = [...new Set([...series.periods.map(({ period }) => period), ...byPeriod.keys()])].sort().map((period) => {
    const rows = byPeriod.get(period);
    if (!rows?.length) return oldPeriods.get(period) || {
      period,
      hasImport: false,
      hasExport: false,
      missingDirections: ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'] as OfferMeasurementKind[],
    };
    const old = oldPeriods.get(period);
    const hasImport = rows.every((interval) => interval.import !== null);
    const hasExport = rows.every((interval) => interval.export !== null);
    return {
      period,
      hasImport,
      hasExport,
      missingDirections: [
        ...(!hasImport ? ['ACTIVE_IMPORT' as const] : []),
        ...(!hasExport ? ['ACTIVE_EXPORT' as const] : []),
      ],
      ...(old && Object.keys(old).some((key) => !['period', 'hasImport', 'hasExport', 'missingDirections'].includes(key)) ? old : {}),
    };
  });
  const missingMonths = periods.filter(({ hasImport, hasExport }) => !hasImport && !hasExport).map(({ period }) => period);
  const missingDirections = periods.flatMap(({ period, missingDirections: missing }) => missing.map((kind) => ({ period, kind })));
  return { periods, missingMonths, missingDirections };
}

/** Fills only absent hourly directions from the closest caller-selected reference profile. */
export function completeOfferMeasurementGaps(input: OfferMeasurementGapInput): OfferMeasurementGapResult {
  validateInput(input, false);
  const { entries } = calendarAndExisting(input);
  const hasGaps = entries.some(({ existing: interval }) => !interval || interval.import === null || interval.export === null);
  if (!hasGaps) return emptyCompletionResult(input.series);
  if (!input.candidates.length) gapError('Brak profili referencyjnych do uzupełnienia brakujących godzin.', 'NO_ANCHORS');

  const invoices = invoiceIndexes(input, entries);
  const anchors = calibrationAnchors(entries, input.pvKwh, input.series);
  const fit = selectFit(input.candidates, anchors, invoices, entries, input.pvKwh);
  if (!(fit.scale > 0)) {
    gapError('Kotwice wskazują wyłącznie zerowe obciążenie; nie można przenieść go na niezmierzone godziny bez dodatniego sygnału.', 'NO_ANCHORS');
  }
  const hourMultipliers = new Map<number, number>();

  const exportInvoiceNotes: string[] = [];
  for (const invoice of invoices) {
    const importResidual = invoiceImportResidual(invoice, entries);
    const exportResidual = invoiceExportResidual(invoice, entries);
    let multiplier: number | null = null;
    if (invoice.importIndexes.length) {
      multiplier = solveIncreasingScale((factor) => invoice.importIndexes.reduce((sum, index) => (
        sum + predictedImport(fit.scale * factor * fit.candidate.loadShape[index], input.pvKwh[index])
      ), 0), importResidual, `Faktura ${invoice.invoice.id}`);
    } else if (exportResidual !== null && invoice.exportIndexes.length) {
      multiplier = solveDecreasingScale((factor) => invoice.exportIndexes.reduce((sum, index) => (
        sum + predictedExport(fit.scale * factor * fit.candidate.loadShape[index], input.pvKwh[index])
      ), 0), exportResidual, `Faktura ${invoice.invoice.id}`);
    }

    if (multiplier !== null) {
      for (const index of invoice.indexes) {
        const interval = entries[index].existing;
        if (!interval || interval.import === null || interval.export === null) hourMultipliers.set(index, multiplier);
      }
    }
  }

  const completed = new Map<string, OfferMeasurementInterval>();
  let modelledHours = 0;
  for (const entry of entries) {
    const key = intervalKey(entry.calendarInterval);
    const old = entry.existing;
    const multiplier = hourMultipliers.get(entry.index) ?? 1;
    const loadKwh = fit.scale * multiplier * fit.candidate.loadShape[entry.index];
    const importValue = old?.import ?? { valueKwh: predictedImport(loadKwh, input.pvKwh[entry.index]), source: 'modelled' as const, fileIds: [] };
    const exportValue = old?.export ?? { valueKwh: predictedExport(loadKwh, input.pvKwh[entry.index]), source: 'modelled' as const, fileIds: [] };
    if (!old || old.import === null || old.export === null) modelledHours += 1;
    completed.set(key, {
      ...(old || entry.calendarInterval),
      import: importValue,
      export: exportValue,
    });
  }

  for (const invoice of invoices) {
    const actualImport = invoice.indexes.reduce((sum, index) => sum + completed.get(intervalKey(entries[index].calendarInterval))!.import!.valueKwh, 0);
    if (Math.abs(actualImport - invoice.invoice.importKwh) > tolerance(invoice.invoice.importKwh)) {
      gapError(`Modelowany import w okresie faktury ${invoice.invoice.id} nie zgadza się z jej wartością fizycznego importu.`, 'INVOICE_CONFLICT');
    }
    if (invoice.invoice.exportKwh !== undefined) {
      const actualExport = invoice.indexes.reduce((sum, index) => sum + completed.get(intervalKey(entries[index].calendarInterval))!.export!.valueKwh, 0);
      if (Math.abs(actualExport - invoice.invoice.exportKwh) > tolerance(invoice.invoice.exportKwh)) {
        exportInvoiceNotes.push(
          `Eksport z tego samego modelu obciążenia i profilu PV wynosi ${actualExport.toFixed(3)} kWh, a faktura ${invoice.invoice.id} podaje ${invoice.invoice.exportKwh.toFixed(3)} kWh; pozostawiono eksport modelu bez sztucznego bilansowania.`,
        );
      }
    }
  }

  const calendarKeys = new Set(entries.map((entry) => intervalKey(entry.calendarInterval)));
  const intervals = [
    ...entries.map((entry) => completed.get(intervalKey(entry.calendarInterval))!),
    ...input.series.intervals.filter((interval) => !calendarKeys.has(intervalKey(interval))),
  ];
  const metadata = periodMetadata(input.series, intervals, entries);
  const resultSeries: OfferMeasurementSeries = { ...input.series, ...metadata, intervals };
  const notes = [
    fit.method === 'measurements'
      ? `Skalę profilu dopasowano do ${fit.calibrationHours} godzin z odtworzonym obciążeniem na podstawie odczytów klienta.`
      : 'Skalę profilu dopasowano do sum fizycznego importu lub eksportu z faktur; pewność pozostaje niska.',
    fit.estimatedCalibrationHours ? `Kalibracja objęła ${fit.estimatedCalibrationHours} godzin z odczytami oznaczonymi przez OSD jako szacowane.` : '',
    fit.reusedCalibrationHours ? `Do kalibracji użyto ${fit.reusedCalibrationHours} godzin z przeniesionych pomiarów źródłowych; obniża to pewność wyniku.` : '',
    invoices.length ? 'Faktury uzgodniono przez jeden wspólny mnożnik obciążenia godzin modelowanych w każdym okresie.' : 'W uzupełnianiu nie użyto faktur.',
    fit.method === 'invoices' && invoices.length === 1 ? 'Jedna faktura kalibruje sumę energii, ale nie identyfikuje samodzielnie godzinowego kształtu profilu.' : '',
    'Istniejące odczyty, w tym wartości zerowe i wcześniejsze wartości modelowane, zachowano bez zmian.',
    ...exportInvoiceNotes,
  ].filter(Boolean);
  return {
    series: resultSeries,
    provenance: {
      profileKey: fit.candidate.key,
      profileName: fit.candidate.name,
      profileHash: fit.candidate.contentHash,
      calibrationHours: fit.calibrationHours,
      measuredCalibrationHours: fit.measuredCalibrationHours,
      estimatedCalibrationHours: fit.estimatedCalibrationHours,
      reusedCalibrationHours: fit.reusedCalibrationHours,
      invoiceIds: input.invoices.map(({ id }) => id),
      modelledHours,
      confidence: fit.method === 'measurements' && fit.estimatedCalibrationHours === 0
        && fit.reusedCalibrationHours === 0 && hasBroadMeasuredCoverage(anchors, entries) ? 'medium' : 'low',
      fitError: fit.error,
      notes,
    },
  };
}
