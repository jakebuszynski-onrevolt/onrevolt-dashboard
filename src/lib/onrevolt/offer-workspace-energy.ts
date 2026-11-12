import type { OfferMeasurementInterval, OfferMeasurementSeries } from './offer-measurements';
import type { OfferWorkspaceDayProfile } from './offer-workspace-chart-data';
import type { OfferWorkspaceMeasurements } from './offer-workspace-server';
import type { OfferAnnualConsumptionProfile } from './offer-workspace-annual-profile';

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
  modelledMeasurements?: {
    provenance: {
      kind: 'annual-consumption'; source: string; annualConsumptionKwh: number;
      referenceProfile?: NonNullable<OfferAnnualConsumptionProfile['referenceProfile']>;
    };
    months: OfferWorkspaceMeasurements['months'];
    dayProfiles: OfferWorkspaceDayProfile[];
    totalsImportKwh: number;
    totalsExportKwh: number;
    intervalCount: number;
  };
};

export function overlayOfferWorkspaceMeasurements(
  measurements: OfferWorkspaceMeasurements,
  energy: OfferWorkspaceEnergy | null | undefined,
): OfferWorkspaceMeasurements {
  const modelled = energy?.modelledMeasurements;
  if (!modelled) return measurements;
  return {
    ...measurements,
    months: modelled.months.map(month => ({ ...month })),
    dayProfiles: modelled.dayProfiles.map(day => ({ ...day, hours: day.hours.map(hour => ({ ...hour })) })),
    totalsImportKwh: modelled.totalsImportKwh,
    totalsExportKwh: modelled.totalsExportKwh,
    intervalCount: null,
    missingDirections: [],
    issues: [...measurements.issues, `Model rocznego zużycia: ${modelled.provenance.source}. To profil szacunkowy, nie dane pomiarowe.`],
  };
}

export type AnnualOfferMeasurementSeries = OfferMeasurementSeries & {
  modelProvenance: {
    kind: 'annual-consumption'; modelId: 'annual-profile-re' | 'annual-reference-profile'; source: string; annualConsumptionKwh: number;
    referenceProfile?: NonNullable<OfferAnnualConsumptionProfile['referenceProfile']>;
  };
};

/** Adapt ephemeral annual-profile flows for valuation services that consume measurement-series intervals. */
export function annualOfferMeasurementSeries(
  profile: OfferAnnualConsumptionProfile,
  energy: OfferWorkspaceEnergy,
): AnnualOfferMeasurementSeries {
  if (energy.modelledMeasurements?.provenance.kind !== 'annual-consumption' || !energy.intervals
    || profile.intervals.length !== energy.intervals.length) {
    throw new Error('Nie można zbudować serii modelowanej bez zgodnego profilu rocznego energii.');
  }
  const intervals = profile.intervals.map((interval, index) => {
    const modeled = energy.intervals![index];
    if (modeled.startUtc !== interval.startUtc || modeled.importKwh == null || modeled.exportKwh == null) {
      throw new Error('Roczna seria modelowana nie ma kompletnych godzin importu i oddania.');
    }
    const reading = (valueKwh: number) => ({ valueKwh, source: 'estimated' as const, fileIds: [] });
    return {
      localStart: interval.localStart, localEnd: interval.localEnd,
      startUtc: interval.startUtc, endUtc: interval.endUtc, occurrence: interval.occurrence,
      import: reading(modeled.importKwh), export: reading(modeled.exportKwh),
    };
  });
  const periods = energy.modelledMeasurements.months.map(month => ({
    period: month.period, hasImport: month.importKwh !== null, hasExport: month.exportKwh !== null, missingDirections: [],
  }));
  return {
    ppeNumber: 'MODELLED_ANNUAL_PROFILE',
    periods,
    missingMonths: [], missingDirections: [], intervals, files: [],
    modelProvenance: {
      kind: 'annual-consumption', modelId: profile.referenceProfile ? 'annual-reference-profile' : 'annual-profile-re',
      source: energy.modelledMeasurements.provenance.source,
      annualConsumptionKwh: energy.modelledMeasurements.provenance.annualConsumptionKwh,
      ...(profile.referenceProfile ? { referenceProfile: profile.referenceProfile } : {}),
    },
  };
}

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

export function buildAnnualProfileOfferWorkspaceEnergy(input: {
  profile: OfferAnnualConsumptionProfile;
  pvHours: Array<{ startUtc: string; pvKwh: number }>;
  noPv: boolean;
  pvSource?: string;
  pvModel?: string;
}): OfferWorkspaceEnergy {
  const pv = new Map<string, number>();
  for (const hour of input.pvHours) {
    const time = Date.parse(hour.startUtc);
    if (!Number.isFinite(time) || time % 3_600_000 || pv.has(hour.startUtc)
      || !Number.isFinite(hour.pvKwh) || hour.pvKwh < 0) throw new Error('Nieprawidłowy godzinowy profil PV.');
    pv.set(hour.startUtc, hour.pvKwh);
  }
  const rows = input.profile.intervals.map(interval => {
    const pvKwh = input.noPv ? 0 : pv.get(interval.startUtc);
    if (pvKwh == null) throw new Error(`Brak modelu PV dla ${interval.startUtc}.`);
    const directKwh = Math.min(interval.loadKwh, pvKwh);
    return {
      startUtc: interval.startUtc, endUtc: interval.endUtc,
      loadKwh: interval.loadKwh, pvKwh, directKwh,
      importKwh: Math.max(0, interval.loadKwh - pvKwh),
      exportKwh: Math.max(0, pvKwh - interval.loadKwh),
      date: interval.date, period: interval.period, hour: interval.hour,
    };
  });
  const byMonth = new Map<string, typeof rows>();
  const byDate = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!byMonth.has(row.period)) byMonth.set(row.period, []);
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byMonth.get(row.period)!.push(row);
    byDate.get(row.date)!.push(row);
  }
  const energyMonths = [...byMonth].sort(([left], [right]) => left.localeCompare(right)).map(([period, values]) => ({
    period,
    ...aggregate(values.map(({ loadKwh, pvKwh, directKwh }) => ({ loadKwh, pvKwh, directKwh }))),
  }));
  const measuredMonths = [...byMonth].sort(([left], [right]) => left.localeCompare(right)).map(([period, values]) => ({
    period,
    importKwh: values.reduce((sum, row) => sum + row.importKwh, 0),
    exportKwh: values.reduce((sum, row) => sum + row.exportKwh, 0),
  }));
  const selectedDays = input.profile.dayProfiles.map(day => {
    const dayRows = byDate.get(day.date) || [];
    const hours = Array.from({ length: 24 }, (_, hour) => {
      const matching = dayRows.filter(row => row.hour === hour);
      return {
        hour,
        loadKwh: matching.reduce((sum, row) => sum + row.loadKwh, 0),
        pvKwh: matching.reduce((sum, row) => sum + row.pvKwh, 0),
        directKwh: matching.reduce((sum, row) => sum + row.directKwh, 0),
        importKwh: matching.reduce((sum, row) => sum + row.importKwh, 0),
        exportKwh: matching.reduce((sum, row) => sum + row.exportKwh, 0),
      };
    });
    return { period: day.period, dayType: day.dayType, date: day.date, hours };
  });
  const totals = aggregate(energyMonths);
  const totalImportKwh = measuredMonths.reduce((sum, month) => sum + month.importKwh!, 0);
  const totalExportKwh = measuredMonths.reduce((sum, month) => sum + month.exportKwh!, 0);
  const source = input.profile.source;
  const loadShapeLabel = input.profile.referenceProfile
    ? `Profil referencyjny ${input.profile.referenceProfile.name}`
    : 'RE DEFAULT_HOURLY_PERCENT';
  const loadShapeIssue = input.profile.referenceProfile
    ? `Zużycie jest szacowane z jawnej rocznej deklaracji według profilu referencyjnego ${input.profile.referenceProfile.name}.`
    : 'Zużycie jest szacowane z jawnej rocznej deklaracji według profilu godzinowego RE.';
  return {
    quality: 'MODELLED', source,
    model: `${loadShapeLabel}${input.noPv ? ' · bez instalacji PV' : ` · ${input.pvSource || 'model PV'} · ${input.pvModel || 'model PV'}`}`,
    months: energyMonths,
    dayProfiles: selectedDays.map(day => ({ date: day.date, hours: day.hours.map(({ hour, loadKwh, pvKwh, directKwh }) => ({ hour, loadKwh, pvKwh, directKwh })) })),
    totals, issues: [`${loadShapeIssue} Import, oddanie, autokonsumpcja i produkcja PV są modelowane; nie są pomiarami.`],
    modelBelowExportKwh: 0,
    intervals: rows.map(({ date: _date, period: _period, hour: _hour, ...row }) => row),
    modelledMeasurements: {
      provenance: {
        kind: 'annual-consumption', source, annualConsumptionKwh: input.profile.annualConsumptionKwh,
        ...(input.profile.referenceProfile ? { referenceProfile: input.profile.referenceProfile } : {}),
      },
      months: measuredMonths, dayProfiles: selectedDays.map(day => ({ period: day.period, dayType: day.dayType, date: day.date,
        hours: day.hours.map(({ hour, importKwh, exportKwh }) => ({ hour, importKwh, exportKwh })) })),
      totalsImportKwh: totalImportKwh, totalsExportKwh: totalExportKwh, intervalCount: rows.length,
    },
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
    const direction = (key: 'import' | 'export') => sorted.some(row => row[key] == null) ? null : {
      valueKwh: sorted.reduce((total, row) => total + row[key]!.valueKwh, 0),
      source: sorted.some(row => row[key]!.source === 'modelled') ? 'modelled' as const
        : sorted.some(row => row[key]!.source === 'estimated') ? 'estimated' as const : 'measured' as const,
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
      const imported = interval.import?.valueKwh ?? null;
      const exported = interval.export?.valueKwh ?? null;
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
        importKwh: interval.import?.valueKwh ?? null,
        exportKwh: input.noPv ? 0 : interval.export?.valueKwh ?? null,
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
  const modelledHours = intervals.filter(row => row.import?.source === 'modelled' || row.export?.source === 'modelled');
  if (modelledHours.length) issues.push(`Uzupełnienie luk — Model CRM: ${modelledHours.length} godz. z ${intervals.length}. Zachowano dostępne pomiary; brakujące godziny są szacunkiem, nie danymi operatora.`);
  const estimatedHours = intervals.filter(row => row.import?.source === 'estimated' || row.export?.source === 'estimated');
  if (estimatedHours.length) issues.push(`Symulacja uwzględnia wartości szacowane przez operatora: ${estimatedHours.length} godz. (pierwsza: ${estimatedHours[0].localStart.slice(0, 16).replace('T', ' ')}). Nie są to brakujące pomiary ani wartości dopisane przez CRM.`);
  if (!canReconstruct) issues.push(input.existingBatteryPresent == null
    ? 'Potwierdź, czy w okresie pomiarów działał magazyn energii. Bez tego nie odtwarzamy zużycia budynku.'
    : 'Instalacja miała magazyn: odtworzenie zużycia wymaga pomiarów produkcji i przepływów magazynu.');
  if (modelBelowExportKwh > 0.01) issues.push(`W części interwałów oddanie ENEA przewyższa model PV (łącznie ${modelBelowExportKwh.toFixed(1)} kWh). RE przyjmuje tam zerową autokonsumpcję; produkcja i zużycie są szacunkiem, nie odczytem falownika.`);
  if (input.acceptMeasuredExportReconstruction) issues.push('Zaakceptowany model prognozy: produkcja PV = zmierzony eksport + modelowana autokonsumpcja; zużycie = zmierzony import + modelowana autokonsumpcja. To szacunek, nie pomiar produkcji PV.');
  return {
    quality: input.noPv && !modelledHours.length ? 'MEASURED_IMPORT' : 'MODELLED',
    source: modelledHours.length ? `${input.source} · uzupełnienie luk Model CRM` : input.source, model: input.model,
    months, totals: aggregate(months), modelBelowExportKwh, issues,
    intervals: rows.map(({ date: _date, hour: _hour, period: _period, ...row }) => row),
    dayProfiles: input.dayProfiles.map(day => ({ date: day.date,
      hours: day.hours.map(({ hour }) => ({ hour, ...aggregate((byDate.get(day.date) || []).filter(row => row.hour === hour)) })),
    })),
  };
}
