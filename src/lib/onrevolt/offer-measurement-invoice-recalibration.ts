import type { OfferMeasurementInterval, OfferMeasurementSeries } from './offer-measurements';

export type OfferMeasurementInvoiceTarget = {
  id: string;
  /** Inclusive local date, YYYY-MM-DD. */
  fromDate: string;
  /** Inclusive local date, YYYY-MM-DD. */
  toDate: string;
  /** Physical grid import after hourly balancing, before opust. */
  importKwh: number;
  /** Grid export after hourly balancing, before opust. */
  exportKwh: number;
};

export type OfferMeasurementInvoiceWeights = {
  startUtc: string;
  importKwh?: number | null;
  exportKwh?: number | null;
};

export type OfferMeasurementInvoiceRecalibrationInput = {
  series: OfferMeasurementSeries;
  invoices: readonly OfferMeasurementInvoiceTarget[];
  /** Optional customer-shaped hourly weights. Must align by unique startUtc. */
  weights?: readonly OfferMeasurementInvoiceWeights[];
};

export type OfferMeasurementInvoiceRecalibrationInvoiceProvenance = {
  invoiceId: string;
  fromDate: string;
  toDate: string;
  targetImportKwh: number;
  targetExportKwh: number;
  beforeImportKwh: number;
  beforeExportKwh: number;
  afterImportKwh: number;
  afterExportKwh: number;
  importScale: number | null;
  exportScale: number | null;
  changedIntervals: number;
  preservedMeasuredIntervals: number;
  preservedEstimatedIntervals: number;
};

export type OfferMeasurementInvoiceRecalibrationResult = {
  series: OfferMeasurementSeries;
  provenance: {
    method: 'invoice-constrained-customer-hourly-shape';
    invoiceResults: OfferMeasurementInvoiceRecalibrationInvoiceProvenance[];
    changedIntervals: number;
    preservedMeasuredIntervals: number;
    preservedEstimatedIntervals: number;
  };
};

export type OfferMeasurementInvoiceRecalibrationErrorCode =
  | 'INVALID_INPUT'
  | 'OVERLAPPING_INVOICES'
  | 'TARGET_BELOW_FIXED_READINGS'
  | 'NO_ELIGIBLE_WEIGHTS'
  | 'UNBALANCED_FIXED_READINGS'
  | 'TARGET_NOT_REACHED';

export class OfferMeasurementInvoiceRecalibrationError extends Error {
  constructor(message: string, public readonly code: OfferMeasurementInvoiceRecalibrationErrorCode) {
    super(message);
    this.name = 'OfferMeasurementInvoiceRecalibrationError';
  }
}

const KWH_TOLERANCE = 1e-6;

function fail(message: string, code: OfferMeasurementInvoiceRecalibrationErrorCode): never {
  throw new OfferMeasurementInvoiceRecalibrationError(message, code);
}

function finiteNonnegative(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${label} musi być nieujemną, skończoną liczbą kWh.`, 'INVALID_INPUT');
  }
}

function validDate(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${label} musi mieć format RRRR-MM-DD.`, 'INVALID_INPUT');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    fail(`${label} jest nieprawidłową datą.`, 'INVALID_INPUT');
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function closeEnough(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= KWH_TOLERANCE;
}

function sourceValue(interval: OfferMeasurementInterval, direction: 'import' | 'export'): number {
  return interval[direction]?.valueKwh ?? 0;
}

function canChange(interval: OfferMeasurementInterval, direction: 'import' | 'export'): boolean {
  const source = interval[direction]?.source;
  return source == null || source === 'modelled';
}

function safeWeights(
  values: readonly number[],
  target: number,
  label: string,
  invoiceId: string,
): number[] {
  const eligibleWeight = sum(values);
  if (target > KWH_TOLERANCE && eligibleWeight <= 0) {
    fail(`Faktura ${invoiceId}: brak godzin z dodatnim profilem do dopasowania ${label}.`, 'NO_ELIGIBLE_WEIGHTS');
  }
  if (eligibleWeight <= 0) return values.map(() => 0);
  const scale = target / eligibleWeight;
  const adjusted = values.map((value) => value * scale);
  // Put the floating remainder in one eligible interval so the requested sum is exact.
  const remainder = target - sum(adjusted);
  if (remainder !== 0) {
    for (let index = adjusted.length - 1; index >= 0; index -= 1) {
      if (values[index] > 0) {
        adjusted[index] += remainder;
        break;
      }
    }
  }
  if (adjusted.some((value) => value < -KWH_TOLERANCE || !Number.isFinite(value))) {
    fail(`Faktura ${invoiceId}: nie udało się dopasować ${label}.`, 'TARGET_NOT_REACHED');
  }
  return adjusted.map((value) => Math.max(0, value));
}

function validateSeries(series: OfferMeasurementSeries) {
  if (!series || !Array.isArray(series.intervals) || !Array.isArray(series.periods)) {
    fail('Brak prawidłowego szeregu pomiarów.', 'INVALID_INPUT');
  }
  const starts = new Set<string>();
  for (const interval of series.intervals) {
    if (!interval || typeof interval.startUtc !== 'string' || !Number.isFinite(Date.parse(interval.startUtc))
      || !Number.isFinite(Date.parse(interval.endUtc)) || Date.parse(interval.endUtc) - Date.parse(interval.startUtc) !== 3_600_000
      || starts.has(interval.startUtc) || !/^\d{4}-\d{2}-\d{2}T/.test(interval.localStart)) {
      fail('Szereg pomiarów zawiera nieprawidłowe lub powtórzone godziny.', 'INVALID_INPUT');
    }
    validDate(interval.localStart.slice(0, 10), `Data pomiaru ${interval.startUtc}`);
    starts.add(interval.startUtc);
    for (const direction of ['import', 'export'] as const) {
      const source = interval[direction];
      if (source) finiteNonnegative(source.valueKwh, `${direction} ${interval.localStart}`);
    }
  }
}

const warsawFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function warsawMidnightUtc(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const wallEpoch = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = wallEpoch;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const parts = Object.fromEntries(warsawFormatter.formatToParts(new Date(candidate))
      .map(({ type, value }) => [type, value]));
    const localEpoch = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second));
    const adjustment = wallEpoch - localEpoch;
    if (adjustment === 0) return candidate;
    candidate += adjustment;
  }
  fail(`Nie udało się ustalić północy w strefie Europe/Warsaw dla ${date}.`, 'INVALID_INPUT');
}

function nextDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function validateInvoices(invoices: readonly OfferMeasurementInvoiceTarget[]) {
  if (!Array.isArray(invoices) || invoices.length === 0) fail('Brak faktur do dopasowania.', 'INVALID_INPUT');
  const ids = new Set<string>();
  const ordered = invoices.map((invoice) => {
    if (!invoice || typeof invoice.id !== 'string' || invoice.id.trim() === '' || ids.has(invoice.id)) {
      fail('Faktura ma puste lub powtórzone ID.', 'INVALID_INPUT');
    }
    ids.add(invoice.id);
    validDate(invoice.fromDate, `Początek okresu faktury ${invoice.id}`);
    validDate(invoice.toDate, `Koniec okresu faktury ${invoice.id}`);
    if (invoice.fromDate > invoice.toDate) fail(`Faktura ${invoice.id} ma odwrócony zakres dat.`, 'INVALID_INPUT');
    finiteNonnegative(invoice.importKwh, `Import faktury ${invoice.id}`);
    finiteNonnegative(invoice.exportKwh, `Eksport faktury ${invoice.id}`);
    return invoice;
  }).sort((left, right) => left.fromDate.localeCompare(right.fromDate) || left.toDate.localeCompare(right.toDate));
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].fromDate <= ordered[index - 1].toDate) {
      fail(`Okresy faktur ${ordered[index - 1].id} i ${ordered[index].id} nachodzą na siebie.`, 'OVERLAPPING_INVOICES');
    }
  }
}

/**
 * Fits only missing/CRM-modelled hours to non-overlapping, already hour-balanced invoices.
 * Actual readings and OSD estimates are immutable. Hourly weights are rescaled independently
 * by direction after making mutable import/export weights mutually exclusive.
 */
export function recalibrateOfferMeasurementInvoices(
  input: OfferMeasurementInvoiceRecalibrationInput,
): OfferMeasurementInvoiceRecalibrationResult {
  validateSeries(input.series);
  validateInvoices(input.invoices);

  const intervals = input.series.intervals;
  const weightByStart = new Map<string, OfferMeasurementInvoiceWeights>();
  for (const weights of input.weights ?? []) {
    if (!weights || !startsWithUtc(weights.startUtc) || weightByStart.has(weights.startUtc)) {
      fail('Wagi mają nieprawidłowy lub powtórzony czas UTC.', 'INVALID_INPUT');
    }
    for (const direction of ['importKwh', 'exportKwh'] as const) {
      if (weights[direction] != null) finiteNonnegative(weights[direction], `${direction} ${weights.startUtc}`);
    }
    weightByStart.set(weights.startUtc, weights);
  }
  const copied = intervals.map((interval) => ({ ...interval,
    import: interval.import ? { ...interval.import, fileIds: [...interval.import.fileIds] } : null,
    export: interval.export ? { ...interval.export, fileIds: [...interval.export.fileIds] } : null,
  }));
  const invoiceResults: OfferMeasurementInvoiceRecalibrationInvoiceProvenance[] = [];

  for (const invoice of input.invoices) {
    const indices = copied.map((interval, index) => ({ interval, index }))
      .filter(({ interval }) => interval.localStart.slice(0, 10) >= invoice.fromDate
        && interval.localStart.slice(0, 10) <= invoice.toDate)
      .map(({ index }) => index);
    if (indices.length === 0) fail(`Faktura ${invoice.id} nie przecina szeregu pomiarów.`, 'INVALID_INPUT');
    const coveredDates = new Set(indices.map((index) => copied[index].localStart.slice(0, 10)));
    if (!coveredDates.has(invoice.fromDate) || !coveredDates.has(invoice.toDate)) {
      fail(`Faktura ${invoice.id} wykracza poza dostępny szereg godzinowy.`, 'INVALID_INPUT');
    }
    const presentStarts = new Set(indices.map((index) => Date.parse(copied[index].startUtc)));
    const expectedUntil = warsawMidnightUtc(nextDate(invoice.toDate));
    for (let cursor = warsawMidnightUtc(invoice.fromDate); cursor < expectedUntil; cursor += 3_600_000) {
      if (!presentStarts.has(cursor)) {
        fail(`Faktura ${invoice.id}: brakuje godziny pomiarowej w okresie faktury.`, 'INVALID_INPUT');
      }
    }

    const beforeImport = sum(indices.map((index) => sourceValue(copied[index], 'import')));
    const beforeExport = sum(indices.map((index) => sourceValue(copied[index], 'export')));
    const fixedImport = sum(indices.filter((index) => !canChange(copied[index], 'import'))
      .map((index) => sourceValue(copied[index], 'import')));
    const fixedExport = sum(indices.filter((index) => !canChange(copied[index], 'export'))
      .map((index) => sourceValue(copied[index], 'export')));

    if (indices.some((index) => !canChange(copied[index], 'import')
      && !canChange(copied[index], 'export')
      && sourceValue(copied[index], 'import') > KWH_TOLERANCE
      && sourceValue(copied[index], 'export') > KWH_TOLERANCE)) {
      fail(`Faktura ${invoice.id}: istniejące odczyty stałe poboru i oddania są jednocześnie dodatnie w tej samej godzinie.`, 'UNBALANCED_FIXED_READINGS');
    }
    if (invoice.importKwh < fixedImport - KWH_TOLERANCE || invoice.exportKwh < fixedExport - KWH_TOLERANCE) {
      fail(`Faktura ${invoice.id}: suma z faktury jest mniejsza od zachowywanych odczytów klienta.`, 'TARGET_BELOW_FIXED_READINGS');
    }
    const importTarget = Math.max(0, invoice.importKwh - fixedImport);
    const exportTarget = Math.max(0, invoice.exportKwh - fixedExport);

    const mutableImport: number[] = [];
    const mutableExport: number[] = [];
    for (const index of indices) {
      const interval = copied[index];
      const external = weightByStart.get(interval.startUtc);
      const importMutable = canChange(interval, 'import');
      const exportMutable = canChange(interval, 'export');
      let importWeight = importMutable
        ? (external?.importKwh ?? sourceValue(interval, 'import')) : 0;
      let exportWeight = exportMutable
        ? (external?.exportKwh ?? sourceValue(interval, 'export')) : 0;

      if (importMutable && exportMutable) {
        const netImport = Math.max(0, importWeight - exportWeight);
        const netExport = Math.max(0, exportWeight - importWeight);
        importWeight = netImport;
        exportWeight = netExport;
      } else if (importMutable && sourceValue(interval, 'export') > KWH_TOLERANCE) {
        importWeight = 0;
      } else if (exportMutable && sourceValue(interval, 'import') > KWH_TOLERANCE) {
        exportWeight = 0;
      }
      mutableImport.push(importWeight);
      mutableExport.push(exportWeight);
    }

    const scaledImport = safeWeights(mutableImport, importTarget, 'importu', invoice.id);
    const scaledExport = safeWeights(mutableExport, exportTarget, 'eksportu', invoice.id);
    let changedIntervals = 0;
    let preservedMeasuredIntervals = 0;
    let preservedEstimatedIntervals = 0;
    for (let position = 0; position < indices.length; position += 1) {
      const index = indices[position];
      const previous = copied[index];
      const nextImport = canChange(previous, 'import') ? scaledImport[position] : sourceValue(previous, 'import');
      const nextExport = canChange(previous, 'export') ? scaledExport[position] : sourceValue(previous, 'export');
      const didChange = (canChange(previous, 'import') && !closeEnough(nextImport, sourceValue(previous, 'import')))
        || (canChange(previous, 'export') && !closeEnough(nextExport, sourceValue(previous, 'export')));
      if (didChange) changedIntervals += 1;
      if (previous.import?.source === 'measured' || previous.export?.source === 'measured') preservedMeasuredIntervals += 1;
      if (previous.import?.source === 'estimated' || previous.export?.source === 'estimated') preservedEstimatedIntervals += 1;
      copied[index] = {
        ...previous,
        import: canChange(previous, 'import')
          ? { valueKwh: nextImport, source: 'modelled', fileIds: previous.import?.fileIds.slice() ?? [] }
          : previous.import,
        export: canChange(previous, 'export')
          ? { valueKwh: nextExport, source: 'modelled', fileIds: previous.export?.fileIds.slice() ?? [] }
          : previous.export,
      };
    }
    const afterImport = sum(indices.map((index) => sourceValue(copied[index], 'import')));
    const afterExport = sum(indices.map((index) => sourceValue(copied[index], 'export')));
    if (!closeEnough(afterImport, invoice.importKwh) || !closeEnough(afterExport, invoice.exportKwh)) {
      fail(`Faktura ${invoice.id}: nie udało się odtworzyć obu sum po dopasowaniu.`, 'TARGET_NOT_REACHED');
    }
    invoiceResults.push({
      invoiceId: invoice.id, fromDate: invoice.fromDate, toDate: invoice.toDate,
      targetImportKwh: invoice.importKwh, targetExportKwh: invoice.exportKwh,
      beforeImportKwh: beforeImport, beforeExportKwh: beforeExport,
      afterImportKwh: afterImport, afterExportKwh: afterExport,
      importScale: sum(mutableImport) > 0 ? importTarget / sum(mutableImport) : null,
      exportScale: sum(mutableExport) > 0 ? exportTarget / sum(mutableExport) : null,
      changedIntervals, preservedMeasuredIntervals, preservedEstimatedIntervals,
    });
  }

  const measurementSeries = { ...input.series, intervals: copied };
  return {
    series: measurementSeries,
    provenance: {
      method: 'invoice-constrained-customer-hourly-shape',
      invoiceResults,
      changedIntervals: invoiceResults.reduce((total, result) => total + result.changedIntervals, 0),
      preservedMeasuredIntervals: invoiceResults.reduce((total, result) => total + result.preservedMeasuredIntervals, 0),
      preservedEstimatedIntervals: invoiceResults.reduce((total, result) => total + result.preservedEstimatedIntervals, 0),
    },
  };
}

function startsWithUtc(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}
