import type { OfferMeasurementInterval } from './offer-measurements';

export type ClientEnergyInvoice = {
  id?: string | null;
  invoiceNumber?: string | null;
  billingPeriodFrom?: string | Date | null;
  billingPeriodTo?: string | Date | null;
  amountGross?: number | string | { toString(): string } | null;
};

export type ClientEnergyInvoiceRow = {
  id: string;
  invoiceNumber: string;
  periodFrom: string;
  periodTo: string;
  amountGross: number;
};

export type ClientEnergyInvoiceSummary = {
  totalGross: number | null;
  included: ClientEnergyInvoiceRow[];
  overlappingIds: string[];
  invalidPeriodIds: string[];
  missingAmountIds: string[];
};

export type ClientEnergyActualDay = {
  date: string;
  period: string;
  hours: Array<{ hour: number; importKwh: number | null; exportKwh: number | null }>;
};

function dateKey(value: string | Date | null | undefined): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  }
  if (typeof value !== 'string') return null;
  const key = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const parsed = new Date(`${key}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key ? key : null;
}

function grossAmount(value: ClientEnergyInvoice['amountGross']): number | null {
  if (value == null) return null;
  const number = Number(typeof value === 'object' ? value.toString() : value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function energyInvoicesInAnalysisPeriod<T extends { billingPeriodFrom?: string | Date | null; billingPeriodTo?: string | Date | null }>(
  invoices: readonly T[], period?: { startMonth: string; endDate: string } | null,
): { included: T[]; crossingCount: number; undatedCount: number } {
  if (!period) return { included: [], crossingCount: 0, undatedCount: 0 };
  const start = `${period.startMonth}-01`;
  const included: T[] = [];
  let crossingCount = 0, undatedCount = 0;
  for (const invoice of invoices) {
    const from = dateKey(invoice.billingPeriodFrom), to = dateKey(invoice.billingPeriodTo);
    if (!from || !to || from > to) { undatedCount += 1; continue; }
    if (from >= start && to <= period.endDate) included.push(invoice);
    else if (from <= period.endDate && to >= start) crossingCount += 1;
  }
  return { included, crossingCount, undatedCount };
}

export function summarizeClientEnergyInvoices(invoices: readonly ClientEnergyInvoice[]): ClientEnergyInvoiceSummary {
  const invalidPeriodIds: string[] = [];
  const missingAmountIds: string[] = [];
  const periods: Array<ClientEnergyInvoiceRow & { inputIndex: number }> = [];

  invoices.forEach((invoice, inputIndex) => {
    const id = invoice.id?.trim() || `invoice-${inputIndex + 1}`;
    const periodFrom = dateKey(invoice.billingPeriodFrom);
    const periodTo = dateKey(invoice.billingPeriodTo);
    if (!periodFrom || !periodTo || periodFrom > periodTo) {
      invalidPeriodIds.push(id);
      return;
    }
    const amountGross = grossAmount(invoice.amountGross);
    if (amountGross == null) missingAmountIds.push(id);
    periods.push({
      id,
      invoiceNumber: invoice.invoiceNumber?.trim() || 'Bez numeru',
      periodFrom,
      periodTo,
      amountGross: amountGross ?? 0,
      inputIndex,
    });
  });

  const overlapping = new Set<string>();
  for (let i = 0; i < periods.length; i += 1) {
    for (let j = i + 1; j < periods.length; j += 1) {
      if (periods[i].periodFrom <= periods[j].periodTo && periods[j].periodFrom <= periods[i].periodTo) {
        overlapping.add(periods[i].id);
        overlapping.add(periods[j].id);
      }
    }
  }

  const included = periods
    .filter((invoice) => !overlapping.has(invoice.id) && !missingAmountIds.includes(invoice.id))
    .sort((a, b) => a.periodFrom.localeCompare(b.periodFrom) || a.periodTo.localeCompare(b.periodTo) || a.inputIndex - b.inputIndex)
    .map(({ inputIndex: _inputIndex, ...invoice }) => invoice);

  return {
    totalGross: included.length
      ? included.reduce((sum, invoice) => sum + Math.round(invoice.amountGross * 100), 0) / 100
      : null,
    included,
    overlappingIds: [...overlapping].sort(),
    invalidPeriodIds,
    missingAmountIds,
  };
}

export function clientEnergyProfileSourceLabel(source: unknown, direction: 'import' | 'export'): string {
  const labels: Record<string, string> = {
    xlsx: 'XLSX',
    real: 'real',
    part: 'part',
    forecast: 'prognoza',
    manual: 'ręcznie',
  };
  if (source === 'standard' && direction === 'import') labels.standard = 'roczne';
  const label = typeof source === 'string' ? labels[source] : undefined;
  return `${direction === 'import' ? '↓' : '↑'} ${label || '--'}`;
}

function validMeasuredReading(reading: OfferMeasurementInterval['import']): number | null {
  if (!reading || reading.source !== 'measured' || !Number.isFinite(reading.valueKwh) || reading.valueKwh < 0) return null;
  return reading.valueKwh;
}

function validDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function buildClientEnergyActualDays(intervals: readonly OfferMeasurementInterval[]): ClientEnergyActualDay[] {
  const byDate = new Map<string, OfferMeasurementInterval[]>();
  for (const interval of intervals) {
    const date = interval.localStart.slice(0, 10);
    if (!validDateKey(date)) continue;
    const rows = byDate.get(date) || [];
    rows.push(interval);
    byDate.set(date, rows);
  }

  const days: ClientEnergyActualDay[] = [];
  for (const [date, rows] of byDate) {
    if (rows.length !== 24) continue;
    const byHour = new Map<number, OfferMeasurementInterval>();
    const sorted = [...rows].sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
    let completeTimeline = true;
    for (let index = 0; index < sorted.length; index += 1) {
      const interval = sorted[index];
      const local = interval.localStart.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2})(?:[+-]\d{2}:\d{2}|Z)$/);
      const start = Date.parse(interval.startUtc);
      const end = Date.parse(interval.endUtc);
      if (!local || Number(local[1]) > 23 || Number(local[2]) !== 0 || Number(local[3]) !== 0
        || !Number.isFinite(start) || end - start !== 60 * 60 * 1000
        || (index > 0 && start !== Date.parse(sorted[index - 1].endUtc))
        || byHour.has(Number(local[1]))) {
        completeTimeline = false;
        break;
      }
      byHour.set(Number(local[1]), interval);
    }
    if (!completeTimeline || byHour.size !== 24) continue;

    const ordered = Array.from({ length: 24 }, (_, hour) => byHour.get(hour)!);
    const importComplete = ordered.every((interval) => validMeasuredReading(interval.import) != null);
    const exportComplete = ordered.every((interval) => validMeasuredReading(interval.export) != null);
    if (!importComplete && !exportComplete) continue;

    days.push({
      date,
      period: date.slice(0, 7),
      hours: ordered.map((interval, hour) => ({
        hour,
        importKwh: validMeasuredReading(interval.import),
        exportKwh: validMeasuredReading(interval.export),
      })),
    });
  }

  return days.sort((a, b) => a.date.localeCompare(b.date));
}
