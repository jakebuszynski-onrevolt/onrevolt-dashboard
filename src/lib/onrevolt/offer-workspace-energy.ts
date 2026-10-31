import type { OfferMeasurementInterval } from './offer-measurements';
import type { OfferWorkspaceDayProfile } from './offer-workspace-chart-data';

const consumptionEngine = require('../../../public/shared/re-consumption-engine.js') as {
  reconstructPvLoad(imported: number[], pv: number[], exported: number[]): number[] | null;
};

export type OfferEnergyValues = {
  loadKwh: number | null;
  pvKwh: number | null;
  directKwh: number | null;
};
export type OfferWorkspaceEnergy = {
  quality: 'MODELLED' | 'MEASURED_IMPORT';
  source: string;
  model: string;
  months: Array<OfferEnergyValues & { period: string }>;
  dayProfiles: Array<{ date: string; hours: Array<OfferEnergyValues & { hour: number }> }>;
  totals: OfferEnergyValues;
  issues: string[];
  modelBelowExportKwh: number;
  intervals?: Array<OfferEnergyValues & { startUtc: string; endUtc: string; importKwh: number | null; exportKwh: number | null }>;
};

function sum(values: Array<number | null>): number | null {
  if (!values.length || values.some(value => value == null)) return null;
  return values.reduce<number>((total, value) => total + value!, 0);
}

function aggregate(values: OfferEnergyValues[]): OfferEnergyValues {
  return {
    loadKwh: sum(values.map(value => value.loadKwh)),
    pvKwh: sum(values.map(value => value.pvKwh)),
    directKwh: sum(values.map(value => value.directKwh)),
  };
}

function hourlyIntervals(intervals: OfferMeasurementInterval[]): OfferMeasurementInterval[] {
  const groups = new Map<number, OfferMeasurementInterval[]>();
  for (const interval of intervals) {
    const time = Date.parse(interval.startUtc);
    const hour = Math.floor(time / 3_600_000) * 3_600_000;
    if (!groups.has(hour)) groups.set(hour, []);
    groups.get(hour)!.push(interval);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([hour, readings]) => {
    const sorted = readings.sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
    const step = sorted.length === 4 ? 900_000 : 3_600_000;
    if (![1, 4].includes(sorted.length) || sorted.some((row, index) =>
      Date.parse(row.startUtc) !== hour + index * step || Date.parse(row.endUtc) !== hour + (index + 1) * step)) {
      throw new Error('Niepełna lub zduplikowana godzina pomiarowa.');
    }
    const direction = (key: 'import' | 'export') => sorted.some(row => row[key]?.source !== 'measured') ? null : {
      valueKwh: sorted.reduce((total, row) => total + row[key]!.valueKwh, 0), source: 'measured' as const,
      fileIds: [...new Set(sorted.flatMap(row => row[key]!.fileIds))],
    };
    return { ...sorted[0], startUtc: new Date(hour).toISOString(), endUtc: new Date(hour + 3_600_000).toISOString(), import: direction('import'), export: direction('export') };
  });
}

export function buildOfferWorkspaceEnergy(input: {
  intervals: OfferMeasurementInterval[];
  months: Array<{ period: string; importKwh: number | null; exportKwh: number | null }>;
  dayProfiles: OfferWorkspaceDayProfile[];
  pvHours: Array<{ startUtc: string; pvKwh: number }>;
  noPv: boolean;
  existingBatteryPresent: boolean | null;
  acceptMeasuredExportReconstruction?: boolean;
  source: string;
  model: string;
}): OfferWorkspaceEnergy {
  const pv = new Map<number, number>();
  for (const hour of input.pvHours) {
    const time = Date.parse(hour.startUtc);
    if (!Number.isFinite(time) || time % 3_600_000 || pv.has(time)
      || !Number.isFinite(hour.pvKwh) || hour.pvKwh < 0) throw new Error('Nieprawidłowy godzinowy profil PV.');
    pv.set(time, hour.pvKwh);
  }
  const rows: Array<OfferEnergyValues & { date: string; hour: number; period: string; startUtc: string; endUtc: string; importKwh: number | null; exportKwh: number | null }> = [];
  const intervals = hourlyIntervals(input.intervals);
  const canReconstruct = input.existingBatteryPresent === false;
  let modelBelowExportKwh = 0;
  // Keep the same reconstruction as RE: import + max(0, modelled PV - measured export).
  // A climatological PV profile is not an inverter measurement; discrepancies remain explicit.
  for (let offset = 0; offset < intervals.length; offset += 24) {
    const chunk = intervals.slice(offset, offset + 24);
    const imports = new Array<number>(24).fill(0);
    const exports = new Array<number>(24).fill(0);
    const production = new Array<number>(24).fill(0);
    const valid = new Set<number>();
    chunk.forEach((interval, index) => {
      const start = Date.parse(interval.startUtc), end = Date.parse(interval.endUtc);
      const duration = (end - start) / 3_600_000;
      const hourStart = Math.floor(start / 3_600_000) * 3_600_000;
      if (![0.25, 1].includes(duration) || end > hourStart + 3_600_000) throw new Error('Nieprawidłowy interwał energii.');
      const modelled = input.noPv ? 0 : pv.get(hourStart);
      if (modelled == null) throw new Error(`Brak modelu PV dla ${interval.startUtc}.`);
      production[index] = modelled * duration;
      const imported = interval.import?.source === 'measured' ? interval.import.valueKwh : null;
      const exported = interval.export?.source === 'measured' ? interval.export.valueKwh : null;
      if (imported != null && Number.isFinite(imported) && imported >= 0
        && (input.noPv || exported != null && Number.isFinite(exported) && exported >= 0)) {
        imports[index] = imported;
        exports[index] = input.noPv ? 0 : exported!;
        valid.add(index);
      }
      if (input.noPv && exported != null && exported > 0.001) throw new Error('Zadeklarowano brak PV, ale pomiary zawierają oddanie energii. Sprawdź dane instalacji.');
      if (!input.noPv && exported != null) modelBelowExportKwh += Math.max(0, exported - production[index]);
    });
    const reconstructed = canReconstruct ? consumptionEngine.reconstructPvLoad(imports, production, exports) : null;
    chunk.forEach((interval, index) => {
      const loadKwh = valid.has(index) && reconstructed ? reconstructed[index] : null;
      rows.push({
        startUtc: interval.startUtc, endUtc: interval.endUtc,
        importKwh: interval.import?.source === 'measured' ? interval.import.valueKwh : null,
        exportKwh: input.noPv ? 0 : interval.export?.source === 'measured' ? interval.export.valueKwh : null,
        date: interval.localStart.slice(0, 10), period: interval.localStart.slice(0, 7),
        hour: Number(interval.localStart.slice(11, 13)),
        loadKwh, pvKwh: input.acceptMeasuredExportReconstruction && valid.has(index) && reconstructed
          ? exports[index] + Math.max(0, production[index] - exports[index]) : production[index],
        directKwh: loadKwh == null ? null : loadKwh - imports[index],
      });
    });
  }
  const byMonth = new Map<string, typeof rows>();
  const byDate = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!byMonth.has(row.period)) byMonth.set(row.period, []);
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byMonth.get(row.period)!.push(row);
    byDate.get(row.date)!.push(row);
  }
  const months = input.months.map(month => {
    const values = aggregate(byMonth.get(month.period) || []);
    const complete = month.importKwh != null && (input.noPv || month.exportKwh != null);
    return { period: month.period, ...values,
      loadKwh: complete ? values.loadKwh : null, directKwh: complete ? values.directKwh : null,
      pvKwh: month.importKwh != null || month.exportKwh != null ? values.pvKwh : null };
  });
  const issues: string[] = [];
  if (!canReconstruct) issues.push(input.existingBatteryPresent == null
    ? 'Potwierdź, czy w okresie pomiarów działał magazyn energii. Bez tego nie odtwarzamy zużycia budynku.'
    : 'Instalacja miała magazyn: odtworzenie zużycia wymaga pomiarów produkcji i przepływów magazynu.');
  if (modelBelowExportKwh > 0.01) issues.push(`W części interwałów oddanie ENEA przewyższa model PV (łącznie ${modelBelowExportKwh.toFixed(1)} kWh). RE przyjmuje tam zerową autokonsumpcję; produkcja i zużycie są szacunkiem, nie odczytem falownika.`);
  if (input.acceptMeasuredExportReconstruction) issues.push('Zaakceptowany model prognozy: produkcja PV = zmierzony eksport + modelowana autokonsumpcja; zużycie = zmierzony import + modelowana autokonsumpcja. To szacunek, nie pomiar produkcji PV.');
  return {
    quality: input.noPv ? 'MEASURED_IMPORT' : 'MODELLED', source: input.source, model: input.model,
    months, totals: aggregate(months), modelBelowExportKwh, issues,
    intervals: rows.map(({ date: _date, hour: _hour, period: _period, ...row }) => row),
    dayProfiles: input.dayProfiles.map(day => ({ date: day.date,
      hours: day.hours.map(({ hour }) => ({ hour, ...aggregate((byDate.get(day.date) || []).filter(row => row.hour === hour)) })),
    })),
  };
}
