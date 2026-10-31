import {
  parseEnergyMeasurementIntervals,
  type EnergyMeasurementInterval,
} from './energy-measurement-document';

export type OfferMeasurementKind = 'ACTIVE_IMPORT' | 'ACTIVE_EXPORT';
export type OfferMeasurementFileInput = {
  id: string;
  expectedPeriod: string;
  expectedKind: OfferMeasurementKind;
  bytes: Buffer;
  projectId?: string;
};

export type OfferMeasurementSource = {
  valueKwh: number;
  source: EnergyMeasurementInterval['source'];
  fileIds: string[];
};

export type OfferMeasurementInterval = {
  localStart: string;
  localEnd: string;
  startUtc: string;
  endUtc: string;
  occurrence: number;
  import: OfferMeasurementSource | null;
  export: OfferMeasurementSource | null;
};

export type OfferMeasurementSeries = {
  ppeNumber: string;
  projectId?: string;
  hasExistingPv?: boolean;
  periods: Array<{
    period: string;
    hasImport: boolean;
    hasExport: boolean;
    missingDirections: OfferMeasurementKind[];
  }>;
  missingMonths: string[];
  missingDirections: Array<{ period: string; kind: OfferMeasurementKind }>;
  intervals: OfferMeasurementInterval[];
  files: Array<{
    id: string;
    period: string;
    kind: OfferMeasurementKind;
    ppeNumber: string;
    totalKwh: number;
    rowsCount: number;
  }>;
};

export type BuildOfferMeasurementSeriesOptions = {
  ppeNumber: string;
  periodKeys: readonly string[];
  projectId?: string;
  hasExistingPv?: boolean;
};

type DirectionReading = {
  interval: EnergyMeasurementInterval;
  fileId: string;
};

function intervalKey(interval: EnergyMeasurementInterval) {
  return `${interval.startUtc}/${interval.endUtc}`;
}

function addReading(
  target: Map<string, { interval: EnergyMeasurementInterval; fileIds: string[] }>,
  reading: DirectionReading,
) {
  const key = intervalKey(reading.interval);
  const current = target.get(key);
  if (!current) {
    target.set(key, { interval: reading.interval, fileIds: [reading.fileId] });
    return;
  }
  if (current.interval.valueKwh !== reading.interval.valueKwh || current.interval.source !== reading.interval.source) {
    throw new Error(`Sprzeczne duplikaty pomiaru ${reading.interval.localEnd} (${current.fileIds.join(', ')} i ${reading.fileId}); wartości nie są sumowane`);
  }
  if (!current.fileIds.includes(reading.fileId)) current.fileIds.push(reading.fileId);
}

function sourceOf(reading: { interval: EnergyMeasurementInterval; fileIds: string[] } | undefined): OfferMeasurementSource | null {
  return reading ? {
    valueKwh: reading.interval.valueKwh,
    source: reading.interval.source,
    fileIds: reading.fileIds.slice().sort(),
  } : null;
}

export function buildOfferMeasurementSeries(
  files: OfferMeasurementFileInput[],
  options: BuildOfferMeasurementSeriesOptions,
): OfferMeasurementSeries {
  if (!options.ppeNumber.trim()) throw new Error('Wymagany numer PPE do sprawdzenia plików pomiarowych');
  if (files.length > 24) throw new Error('Dla oferty można przetworzyć maksymalnie 24 miesięczne pliki ENEA');

  const allowedPeriods = new Set(options.periodKeys);
  if (!options.periodKeys.length || options.periodKeys.some((period) => !/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))
    || allowedPeriods.size !== options.periodKeys.length) {
    throw new Error('Nieprawidłowa lista miesięcy okresu analizy');
  }
  const importReadings = new Map<string, { interval: EnergyMeasurementInterval; fileIds: string[] }>();
  const exportReadings = new Map<string, { interval: EnergyMeasurementInterval; fileIds: string[] }>();
  const availableDirections = new Set<string>();
  const ids = new Set<string>();
  const fileInfo: OfferMeasurementSeries['files'] = [];

  for (const file of files) {
    if (!file.id.trim() || ids.has(file.id)) throw new Error(`Brak lub powtórzone ID pliku pomiarowego: ${file.id}`);
    ids.add(file.id);
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(file.expectedPeriod) || !allowedPeriods.has(file.expectedPeriod)) {
      throw new Error(`Okres pliku ${file.id} nie należy do wybranego okresu analizy`);
    }
    if (options.projectId && file.projectId !== options.projectId) {
      throw new Error(`Plik ${file.id} nie należy do wskazanego projektu`);
    }

    let parsed: ReturnType<typeof parseEnergyMeasurementIntervals>;
    try {
      parsed = parseEnergyMeasurementIntervals(file.bytes);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'nieznany błąd XLSX';
      throw new Error(`Nie można użyć pliku pomiarowego ${file.id}: ${detail}`);
    }
    const { info, intervals } = parsed;
    const parsedPeriod = `${info.periodYear}-${String(info.periodMonth).padStart(2, '0')}`;
    if (info.kind !== file.expectedKind || parsedPeriod !== file.expectedPeriod) {
      throw new Error(`Metadane pliku ${file.id} nie zgadzają się z raportem ENEA`);
    }
    if (info.ppeNumber !== options.ppeNumber) {
      throw new Error(`Numer PPE w pliku ${file.id} nie zgadza się z numerem PPE projektu`);
    }

    availableDirections.add(`${parsedPeriod}/${info.kind}`);
    const target = info.kind === 'ACTIVE_IMPORT' ? importReadings : exportReadings;
    for (const interval of intervals) addReading(target, { interval, fileId: file.id });
    fileInfo.push({
      id: file.id,
      period: parsedPeriod,
      kind: info.kind,
      ppeNumber: info.ppeNumber,
      totalKwh: info.totalKwh,
      rowsCount: info.rowsCount,
    });
  }

  const monthKeys = [...allowedPeriods].sort();
  const periods = monthKeys.map((period) => {
    const hasImport = availableDirections.has(`${period}/ACTIVE_IMPORT`);
    const hasExport = availableDirections.has(`${period}/ACTIVE_EXPORT`);
    return {
      period,
      hasImport,
      hasExport,
      missingDirections: [
        ...(!hasImport ? ['ACTIVE_IMPORT' as const] : []),
        ...(!hasExport ? ['ACTIVE_EXPORT' as const] : []),
      ],
    };
  });
  const missingMonths = periods.filter(({ hasImport, hasExport }) => !hasImport && !hasExport).map(({ period }) => period);
  const missingDirections = periods.flatMap(({ period, missingDirections: missing }) => missing.map((kind) => ({ period, kind })));
  const intervalKeys = new Set([...importReadings.keys(), ...exportReadings.keys()]);
  const intervals = Array.from(intervalKeys).sort((a, b) => {
    const [aStart] = a.split('/');
    const [bStart] = b.split('/');
    return aStart.localeCompare(bStart);
  }).map((key): OfferMeasurementInterval => {
    const imported = importReadings.get(key);
    const exported = exportReadings.get(key);
    const base = (imported || exported)!.interval;
    return {
      localStart: base.localStart,
      localEnd: base.localEnd,
      startUtc: base.startUtc,
      endUtc: base.endUtc,
      occurrence: base.occurrence,
      import: sourceOf(imported),
      export: sourceOf(exported),
    };
  });

  return {
    ppeNumber: options.ppeNumber,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.hasExistingPv == null ? {} : { hasExistingPv: options.hasExistingPv }),
    periods,
    missingMonths,
    missingDirections,
    intervals,
    files: fileInfo.sort((a, b) => a.period.localeCompare(b.period) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
  };
}
