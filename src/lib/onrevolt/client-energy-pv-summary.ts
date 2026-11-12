import { annualPvProductionKwh } from './project-pv-settings';
import { buildOfferWorkspaceEnergy } from './offer-workspace-energy';
import type { OfferMeasurementSeries } from './offer-measurements';

export type ClientEnergyPvSummary = {
  loadKwh: number | null;
  productionKwh: number | null;
  selfConsumptionKwh: number | null;
  coveredMonths: number;
  totalMonths: number;
  coveredHours: number;
  totalHours: number;
  modelUrl: string | null;
  note: string;
  issues: string[];
};

type ClientEnergyPvMonth = { period: string; importKwh: number | null; exportKwh: number | null };
type ClientEnergyPvHour = { startUtc: string; pvKwh: number };

const warsawMonthFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
});

function monthKeyAtUtc(epochMs: number): string {
  const parts = Object.fromEntries(warsawMonthFormatter.formatToParts(new Date(epochMs)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}`;
}

function utcHourKey(value: string): string | null {
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) return null;
  return new Date(Math.floor(epochMs / 3_600_000) * 3_600_000).toISOString();
}

function fullPeriodModelHours(
  hours: ClientEnergyPvHour[] | null,
  fromUtc: string,
  untilUtc: string,
): ClientEnergyPvHour[] {
  if (!hours) throw new Error('Brak godzinowego profilu PV.');
  const from = Date.parse(fromUtc);
  const until = Date.parse(untilUtc);
  const expectedCount = (until - from) / 3_600_000;
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || hours.length !== expectedCount) {
    throw new Error('Profil PV nie obejmuje pełnego okresu analizy.');
  }
  return hours.map((hour, index) => {
    const epochMs = Date.parse(hour.startUtc);
    if (!Number.isFinite(epochMs) || epochMs !== from + index * 3_600_000
      || !Number.isFinite(hour.pvKwh) || hour.pvKwh < 0) {
      throw new Error('Profil PV zawiera brakującą, nieuporządkowaną lub nieprawidłową godzinę.');
    }
    return hour;
  });
}

function uniqueIssues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

/** Dane energetyczne: an empty existing-battery capacity means no battery.
 * The offer's historical battery choice is separate from this saved field. */
export function resolveClientEnergyBatteryPresence(auditBatteryKwh: unknown): boolean | null {
  if (auditBatteryKwh == null || (typeof auditBatteryKwh === 'string' && auditBatteryKwh.trim() === '')) return false;
  const value = typeof auditBatteryKwh === 'object' && auditBatteryKwh !== null
    && 'toNumber' in auditBatteryKwh && typeof auditBatteryKwh.toNumber === 'function'
    ? auditBatteryKwh.toNumber()
    : Number(auditBatteryKwh);
  if (!Number.isFinite(value) || value < 0) return null;
  return value > 0;
}

export function buildClientEnergyPvSummary(input: {
  periodKeys: readonly string[];
  fromUtc: string;
  untilUtc: string;
  modelHours: ClientEnergyPvHour[] | null;
  modelError?: string | null;
  modelUrl?: string | null;
  measurementSeries?: OfferMeasurementSeries | null;
  months: ClientEnergyPvMonth[];
  existingBatteryPresent: boolean | null;
}): ClientEnergyPvSummary {
  const totalMonths = input.periodKeys.length;
  const periodDurationHours = (Date.parse(input.untilUtc) - Date.parse(input.fromUtc)) / 3_600_000;
  const totalHours = Number.isInteger(periodDurationHours) && periodDurationHours > 0 ? periodDurationHours : 0;
  const issues: string[] = [];
  let modelHours: ClientEnergyPvHour[] | null = null;
  let productionKwh: number | null = null;
  let modelUrl: string | null = input.modelUrl || null;

  try {
    modelHours = fullPeriodModelHours(input.modelHours, input.fromUtc, input.untilUtc);
    productionKwh = annualPvProductionKwh(modelHours);
  } catch (error) {
    issues.push(input.modelError?.trim()
      || (error instanceof Error ? error.message : 'Nie udało się obliczyć produkcji PV.'));
  }

  if (input.existingBatteryPresent === null) {
    issues.push('Pojemność istniejącego magazynu energii jest nieprawidłowa. Popraw ją w danych energetycznych, aby wyliczyć autokonsumpcję.');
  } else if (input.existingBatteryPresent) {
    issues.push('W okresie działał magazyn energii; bez danych o przepływach magazynu autokonsumpcja pozostaje nieznana.');
  }

  let selfConsumptionKwh: number | null = null;
  let loadKwh: number | null = null;
  let coveredMonths = 0;
  let coveredHours = 0;
  if (modelHours && input.measurementSeries?.intervals.length) {
    try {
      const energy = buildOfferWorkspaceEnergy({
        intervals: input.measurementSeries.intervals,
        months: input.months,
        dayProfiles: [],
        pvHours: modelHours,
        noPv: false,
        existingBatteryPresent: input.existingBatteryPresent,
        source: 'Model PV',
        model: 'Profil godzinowy',
      });
      issues.push(...energy.issues);
      const completeLoad = energy.intervals?.length === totalHours
        && energy.intervals.every((row, index) => Date.parse(row.startUtc) === Date.parse(input.fromUtc) + index * 3_600_000
          && row.loadKwh != null && Number.isFinite(row.loadKwh));
      if (input.existingBatteryPresent === false && completeLoad && energy.totals.loadKwh != null) {
        loadKwh = energy.totals.loadKwh;
      }

      const allowedMonths = new Set(input.periodKeys);
      const exportMonths = new Set(input.measurementSeries.periods
        .filter((period) => period.hasExport && allowedMonths.has(period.period)
          && input.months.some((month) => month.period === period.period && month.exportKwh !== null))
        .map((period) => period.period));
      const expectedHours = new Map<string, number>();
      for (const hour of modelHours) {
        const month = monthKeyAtUtc(Date.parse(hour.startUtc));
        if (allowedMonths.has(month)) expectedHours.set(month, (expectedHours.get(month) || 0) + 1);
      }

      const periodByUtcHour = new Map<string, string>();
      for (const interval of input.measurementSeries.intervals) {
        const hourKey = utcHourKey(interval.startUtc);
        if (hourKey) periodByUtcHour.set(hourKey, interval.localStart.slice(0, 7));
      }
      const actualHours = new Map<string, number>();
      const totals = new Map<string, number>();
      for (const interval of energy.intervals || []) {
        const period = periodByUtcHour.get(interval.startUtc);
        if (!period || !exportMonths.has(period) || interval.pvKwh === null || interval.exportKwh === null) continue;
        actualHours.set(period, (actualHours.get(period) || 0) + 1);
        totals.set(period, (totals.get(period) || 0) + Math.max(0, interval.pvKwh - interval.exportKwh));
      }
      const completeExportMonths = [...exportMonths].filter((period) =>
        (actualHours.get(period) || 0) === (expectedHours.get(period) || -1) && (expectedHours.get(period) || 0) > 0,
      );
      coveredMonths = completeExportMonths.length;
      coveredHours = [...actualHours.values()].reduce((sum, count) => sum + count, 0);
      if (input.existingBatteryPresent === false && coveredHours > 0) {
        selfConsumptionKwh = Math.round([...totals.values()].reduce((sum, value) => sum + value, 0) * 1000) / 1000;
      }
    } catch (error) {
      issues.push(`Nie udało się oszacować autokonsumpcji godzinowej: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (input.existingBatteryPresent === false && coveredHours === 0) {
    issues.push('Brak zmierzonych godzin oddania ENEA; autokonsumpcji nie oszacowano.');
  } else if (input.existingBatteryPresent === false && coveredHours < totalHours) {
    issues.push(`Autokonsumpcja obejmuje ${coveredHours}/${totalHours} zmierzonych godzin; brakujące godziny pominięto bez ekstrapolacji.`);
  }
  if (!input.measurementSeries?.intervals.length) {
    issues.push('Brak godzinowych pomiarów ENEA do oszacowania autokonsumpcji.');
  }

  const note = productionKwh === null
    ? 'Produkcja PV nie jest dostępna: nie udało się uzyskać kompletnego profilu modelowego dla okresu.'
    : input.existingBatteryPresent === null
      ? 'Produkcja PV jest szacunkiem modelowym; wyliczenie autokonsumpcji wymaga poprawnej pojemności istniejącego magazynu.'
      : input.existingBatteryPresent
        ? 'Produkcja PV jest szacunkiem modelowym; przy istniejącym magazynie autokonsumpcja wymaga pomiarów produkcji i przepływów magazynu.'
      : coveredHours === 0
        ? 'Produkcja PV jest szacunkiem modelowym; autokonsumpcja nie jest dostępna bez pełnych miesięcy pomiaru oddania.'
        : `Autokonsumpcja to suma godzinowych max(model PV − oddanie ENEA, 0) dla ${coveredHours}/${totalHours} zmierzonych godzin; brakujące godziny pominięto.`;

  return {
    loadKwh,
    productionKwh,
    selfConsumptionKwh,
    coveredMonths,
    totalMonths,
    coveredHours,
    totalHours,
    modelUrl,
    note,
    issues: uniqueIssues(issues),
  };
}
