import * as XLSX from 'xlsx';

type SheetRow = Array<string | number | boolean | Date | null | undefined>;

export class EnergyMeasurementIncompleteError extends Error {
  constructor(message: string, public readonly userMessage: string) {
    super(message);
    this.name = 'EnergyMeasurementIncompleteError';
  }
}

function incompleteDayRanges(days: Set<string>) {
  const sorted = [...days].sort();
  const ranges: string[][] = [];
  for (const day of sorted) {
    const last = ranges.at(-1);
    if (last && Date.parse(day) - Date.parse(last[1]) === 86400000) last[1] = day;
    else ranges.push([day, day]);
  }
  const format = (day: string) => day.split('-').reverse().join('.');
  return ranges.map(([from, to]) => from === to ? format(from) : `${format(from)}–${format(to)}`).join(', ');
}

export type EnergyMeasurementWorkbookInfo = {
  kind: 'ACTIVE_IMPORT' | 'ACTIVE_EXPORT';
  ppeNumber: string;
  periodFrom: string;
  periodTo: string;
  periodYear: number;
  periodMonth: number;
  aggregation: '60 min';
  totalKwh: number;
  rowsCount: number;
  sheetName: string;
  modelledRows?: number;
  modelDescription?: string;
  tariffRegisterPeriods?: Array<{
    validFrom: string;
    mode: 'total' | 'zoned';
  }>;
};

/** ENEA labels interval ends; UTC bounds are authoritative and local values include the Warsaw offset. */
export type EnergyMeasurementInterval = {
  localStart: string;
  localEnd: string;
  startUtc: string;
  endUtc: string;
  valueKwh: number;
  source: 'measured' | 'estimated' | 'modelled';
  occurrence: number;
};

export type EnergyMeasurementWorkbookWithIntervals = {
  info: EnergyMeasurementWorkbookInfo;
  intervals: EnergyMeasurementInterval[];
};

type ParsedMeasurementRow = { localEndEpoch: number; valueKwh: number; source: EnergyMeasurementInterval['source']; winterLabel: boolean };

const warsawFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function warsawParts(epoch: number) {
  const parts = Object.fromEntries(warsawFormatter.formatToParts(new Date(epoch)).map(({ type, value }) => [type, value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

function sameCivilTime(parts: ReturnType<typeof warsawParts>, wallEpoch: number) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) === wallEpoch;
}

function resolveWarsawInstants(wallEpoch: number) {
  const candidates: number[] = [];
  for (const shiftMinutes of [-180, -120, -60, 0, 60, 120, 180]) {
    const candidate = wallEpoch + shiftMinutes * 60_000;
    if (sameCivilTime(warsawParts(candidate), wallEpoch)) candidates.push(candidate);
  }
  return Array.from(new Set(candidates)).sort((a, b) => a - b);
}

function formatWarsawInstant(epoch: number) {
  const parts = warsawParts(epoch);
  const localEpoch = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offsetMinutes = Math.round((localEpoch - epoch) / 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absoluteOffset = Math.abs(offsetMinutes);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
    + `T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`
    + `${sign}${String(Math.floor(absoluteOffset / 60)).padStart(2, '0')}:${String(absoluteOffset % 60).padStart(2, '0')}`;
}

function intervalsFromRows(rows: ParsedMeasurementRow[]): EnergyMeasurementInterval[] {
  const firstEndCandidates = resolveWarsawInstants(rows[0].localEndEpoch);
  if (firstEndCandidates.length !== 1) throw new Error('Niejednoznaczny początek miesiąca pomiarowego');
  const occurrences = new Map<number, number>();
  return rows.map(({ localEndEpoch, valueKwh, source, winterLabel }, index) => {
    const endUtc = firstEndCandidates[0] + index * 60 * 60_000;
    const startUtc = endUtc - 60 * 60_000;
    const endParts = warsawParts(endUtc);
    const startParts = warsawParts(startUtc);
    const endWall = Date.UTC(endParts.year, endParts.month - 1, endParts.day, endParts.hour, endParts.minute, endParts.second);
    const startWall = Date.UTC(startParts.year, startParts.month - 1, startParts.day, startParts.hour, startParts.minute, startParts.second);
    // ENEA can label both autumn 02:00 intervals as 03:00, marking the second "czasu zimowego".
    // Validate those nominal end labels against an uninterrupted UTC timeline, not two identical UTC ends.
    if (localEndEpoch !== endWall && localEndEpoch !== startWall + 60 * 60_000) {
      throw new Error('Nie można jednoznacznie rozwinąć chronologii pomiarów w strefie Europe/Warsaw');
    }
    if (winterLabel && (startParts.month !== 10 || startParts.hour !== 2 || endParts.hour !== 3
      || (startWall - startUtc) !== 60 * 60_000
      || new Date(startWall).getUTCDay() !== 0
      || startParts.day < 25)) {
      throw new Error('Nieprawidłowe oznaczenie godziny czasu zimowego');
    }
    const occurrence = (occurrences.get(endWall) || 0) + 1;
    occurrences.set(endWall, occurrence);
    return {
      localStart: formatWarsawInstant(startUtc),
      localEnd: formatWarsawInstant(endUtc),
      startUtc: new Date(startUtc).toISOString(),
      endUtc: new Date(endUtc).toISOString(),
      valueKwh,
      source,
      occurrence,
    };
  });
}

function normalizedText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function numericCell(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const raw = value.trim().replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function civilTimestamp(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds());
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0);
  }

  const text = String(value ?? '').trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0));
  }
  match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6] || 0));
  }
  return undefined;
}

function findPpe(rows: SheetRow[]) {
  for (const row of rows.slice(0, 20)) {
    for (const cell of row) {
      const compact = String(cell ?? '').replace(/\s/g, '');
      const match = compact.match(/(?:PPE[^0-9]*)?(\d{18})/i);
      if (match?.[1]) return match[1];
    }
  }
  return undefined;
}

function findPeriod(rows: SheetRow[]) {
  for (const row of rows.slice(0, 20)) {
    for (const cell of row) {
      const text = String(cell ?? '');
      const match = text.match(/(20\d{2}-\d{2}-\d{2})\s*(?:-|–|—)\s*(20\d{2}-\d{2}-\d{2})/);
      if (match) return { periodFrom: match[1], periodTo: match[2] };
    }
  }
  return undefined;
}

function periodParts(periodFrom: string, periodTo: string) {
  const [fromYear, fromMonth, fromDay] = periodFrom.split('-').map(Number);
  const [toYear, toMonth, toDay] = periodTo.split('-').map(Number);
  const lastDay = new Date(Date.UTC(fromYear, fromMonth, 0)).getUTCDate();
  if (fromYear !== toYear || fromMonth !== toMonth || fromDay !== 1 || toDay !== lastDay) {
    throw new Error('Plik musi obejmować dokładnie jeden pełny miesiąc');
  }
  return { periodYear: fromYear, periodMonth: fromMonth, daysInMonth: lastDay };
}

function findTotal(rows: SheetRow[], headerIndex: number, valueIndexes: number[]) {
  for (const row of rows.slice(headerIndex + 1)) {
    if (normalizedText(row[0]) !== 'suma') continue;
    let total = 0;
    let found = false;
    for (const valueIndex of valueIndexes) {
      const value = numericCell(row[valueIndex]);
      if (value != null) {
        total += value;
        found = true;
      }
    }
    if (found) return Math.round(total * 1000) / 1000;
  }
  return undefined;
}

export function closedMeasurementPeriodKeys(count = 12, now = new Date()) {
  const keys = new Set<string>();
  const localNow = warsawParts(now.getTime());
  const cursor = new Date(Date.UTC(localNow.year, localNow.month - 2, 1));
  for (let index = 0; index < count; index += 1) {
    keys.add(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return keys;
}

function parseEnergyMeasurementWorkbook(bytes: Buffer, includeIntervals: boolean): EnergyMeasurementWorkbookWithIntervals {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true });
  } catch {
    throw new Error('Nie można odczytać pliku XLSX');
  }

  // CRM reconstructions are explicit, separate from estimates supplied by the OSD.
  let modelDescription: string | undefined;
  if (workbook.Sheets['Model CRM']) {
    const metadata = XLSX.utils.sheet_to_json<SheetRow>(workbook.Sheets['Model CRM'], { header: 1, raw: true });
    if (metadata[0]?.[0] !== 'ONREVOLT_MEASUREMENT_MODEL_V1'
      || typeof metadata[1]?.[0] !== 'string' || !metadata[1][0].trim()) {
      throw new Error('Brak opisu pochodzenia uzupełnień Model CRM.');
    }
    modelDescription = metadata[1][0].trim();
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<SheetRow>(sheet, { header: 1, raw: true, defval: null });
    const normalizedRows = rows.map((row) => row.map(normalizedText));
    const headerIndex = normalizedRows.findIndex((row) => (
      row.some((cell) => cell === 'dzien' || cell.includes('data'))
      && row.some((cell) => cell.includes('energia czynna'))
    ));
    if (headerIndex < 0) continue;

    const headers = normalizedRows[headerIndex];
    const dateIndex = headers.findIndex((cell) => cell === 'dzien' || cell.includes('data'));
    const statusIndex = headers.findIndex((cell) => cell.includes('status'));
    const importIndexes = headers
      .map((header, index) => ({ header, index }))
      .filter(({ header }) => header.includes('energia czynna pobrana') && header.includes('po bilansowaniu'))
      .map(({ index }) => index);
    const exportIndexes = headers
      .map((header, index) => ({ header, index }))
      .filter(({ header }) => (
        (header.includes('energia czynna oddana') || header.includes('energia czynna wprowadzona'))
        && header.includes('po bilansowaniu')
      ))
      .map(({ index }) => index);
    if (dateIndex < 0 || importIndexes.length === exportIndexes.length) {
      throw new Error('Plik musi zawierać jeden godzinowy raport: energię pobraną albo oddaną po bilansowaniu');
    }
    if (statusIndex < 0) {
      throw new Error('Brak kolumny Status w raporcie. Każdy pomiar wymaga statusu Dane rzeczywiste lub Dane szacowane');
    }

    const period = findPeriod(rows);
    if (!period) throw new Error('Nie znaleziono miesięcznego zakresu dat w pliku XLSX');
    const parts = periodParts(period.periodFrom, period.periodTo);
    const ppeNumber = findPpe(rows);
    if (!ppeNumber) throw new Error('Nie znaleziono numeru PPE w pliku XLSX');

    const valueIndexes = importIndexes.length ? importIndexes : exportIndexes;
    const registerPrefix = importIndexes.length ? '1' : '2';
    const registers = valueIndexes.map((index) => headers[index].match(/\(([12])\.8\.(\d+)\)/));
    const isZonedReport = valueIndexes.length > 1
      && registers.every((match) => match?.[1] === registerPrefix)
      && new Set(registers.map((match) => match?.[2])).size === valueIndexes.length;
    const totalRegisterIndex = registers.findIndex((match) => match?.[2] === '0');
    const tariffRegisterPeriods: NonNullable<EnergyMeasurementWorkbookInfo['tariffRegisterPeriods']> = [];
    const daylightSavingAdjustment = parts.periodMonth === 3 ? -1 : parts.periodMonth === 10 ? 1 : 0;
    const expectedRows = parts.daysInMonth * 24 + daylightSavingAdjustment;
    const timestamps: number[] = [];
    let calculatedTotal = 0;
    let validRows = 0;
    let invalidStatusRows = 0;
    let invalidValueRows = 0;
    let modelledRows = 0;
    let firstInvalidRow: string | undefined;
    const invalidDays = new Set<string>();
    const parsedRows: ParsedMeasurementRow[] = [];
    for (const row of rows.slice(headerIndex + 1)) {
      const timestamp = civilTimestamp(row[dateIndex]);
      if (timestamp == null) continue;
      if (includeIntervals && typeof row[dateIndex] === 'string'
        && !/^(?:\d{4}-\d{1,2}-\d{1,2}[ T]|\d{1,2}[./-]\d{1,2}[./-]\d{4}\s+)\d{1,2}:\d{2}(?::\d{2})?(?:\s+czasu zimowego)?$/.test(String(row[dateIndex]).trim())) {
        throw new Error('Nieobsługiwane lub sprzeczne oznaczenie czasu w pomiarze godzinowym');
      }
      timestamps.push(timestamp);
      const status = String(row[statusIndex] ?? '').trim();
      if (status === 'Model CRM' && !modelDescription) throw new Error('Wartości Model CRM wymagają arkusza z opisem pochodzenia.');
      const validStatus = status === 'Dane rzeczywiste' || status === 'Dane szacowane' || status === 'Model CRM';
      // ENEA leaves inactive OBIS tariff zones empty, including after a tariff change mid-month.
      const populatedIndexes = valueIndexes.filter((index) => String(row[index] ?? '').trim() !== '');
      const values = (isZonedReport ? populatedIndexes : valueIndexes).map((index) => numericCell(row[index]));
      if (isZonedReport && populatedIndexes.length > 1 && totalRegisterIndex >= 0
        && populatedIndexes.includes(valueIndexes[totalRegisterIndex])) {
        throw new Error('W jednej godzinie podano jednocześnie energię łączną i strefową. Nie można ich sumować bez podwójnego naliczenia');
      }
      const validValues = values.length > 0 && values.every((value) => value !== undefined && value >= 0);
      if (!validStatus) invalidStatusRows += 1;
      if (!validValues) invalidValueRows += 1;
      if (!validStatus || !validValues) {
        // ENEA timestamps describe interval ends; midnight belongs to the prior day.
        invalidDays.add(new Date(timestamp - 1).toISOString().slice(0, 10));
        if (!firstInvalidRow) {
          const reasons = [
            !validStatus ? 'wymagany status Dane rzeczywiste lub Dane szacowane' : null,
            !validValues ? 'wymagana niepusta, poprawna i nieujemna wartość kWh' : null,
          ].filter(Boolean).join('; ');
          firstInvalidRow = `${new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19)} (${reasons})`;
        }
        continue;
      }
      validRows += 1;
      if (status === 'Model CRM') modelledRows += 1;
      if (isZonedReport && totalRegisterIndex >= 0) {
        const mode = populatedIndexes.includes(valueIndexes[totalRegisterIndex]) ? 'total' : 'zoned';
        if (tariffRegisterPeriods.at(-1)?.mode !== mode) {
          tariffRegisterPeriods.push({
            validFrom: new Date(timestamp - 60 * 60_000).toISOString().slice(0, 10),
            mode,
          });
        }
      }
      for (const value of values) calculatedTotal += value!;
      parsedRows.push({
        localEndEpoch: timestamp,
        valueKwh: values.reduce((sum, value) => sum + value!, 0),
        source: status === 'Dane rzeczywiste' ? 'measured' : status === 'Model CRM' ? 'modelled' : 'estimated',
        winterLabel: typeof row[dateIndex] === 'string' && /\s+czasu zimowego$/.test(String(row[dateIndex]).trim()),
      });
    }
    if (firstInvalidRow) {
      throw new EnergyMeasurementIncompleteError(`Niepełne dane godzinowe: ${validRows}/${expectedRows} poprawnych pomiarów. `
        + `Wiersze z brakującym lub nieprawidłowym statusem: ${invalidStatusRows}; wartością kWh: ${invalidValueRows}. `
        + `Pierwszy niepoprawny pomiar: ${firstInvalidRow}.`,
        `Nie dodano pliku: miesiąc ${period.periodFrom.slice(0, 7)} jest niepełny (${validRows} z ${expectedRows} godzin). `
        + `Brak lub niepoprawne pomiary: ${incompleteDayRanges(invalidDays)}. Pobierz pełny miesięczny raport ENEA.`);
    }
    if (timestamps.length < 2) throw new Error('Plik nie zawiera pomiarów godzinowych');

    const intervals: number[] = [];
    const intervalCounts = new Map<number, number>();
    for (let index = 1; index < timestamps.length; index += 1) {
      const minutes = Math.round((timestamps[index] - timestamps[index - 1]) / 60_000);
      intervals.push(minutes);
      if (minutes > 0) intervalCounts.set(minutes, (intervalCounts.get(minutes) || 0) + 1);
    }
    const dominantInterval = Array.from(intervalCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (dominantInterval !== 60) throw new Error('Plik nie zawiera danych godzinowych (agregacja 60 min)');

    const shifted = timestamps.map((timestamp) => timestamp - 60 * 60_000);
    const expectedStart = Date.UTC(parts.periodYear, parts.periodMonth - 1, 1);
    const expectedEnd = Date.UTC(parts.periodYear, parts.periodMonth, 1) - 60 * 60_000;
    const regularIntervals = intervals.filter((minutes) => minutes === 60).length;
    const expectedDstIntervals = parts.periodMonth === 3
      ? intervals.filter((minutes) => minutes === 120).length === 1
      : parts.periodMonth === 10
        ? intervals.filter((minutes) => minutes === 0).length === 1
        : true;
    if (
      shifted[0] !== expectedStart
      || shifted[shifted.length - 1] !== expectedEnd
      || timestamps.length !== expectedRows
      || regularIntervals !== intervals.length - Math.abs(daylightSavingAdjustment)
      || !expectedDstIntervals
    ) {
      throw new Error(`Plik nie zawiera pełnego miesiąca pomiarów godzinowych (${validRows}/${expectedRows} poprawnych pomiarów)`);
    }

    const totalKwh = Math.round(calculatedTotal * 1000) / 1000;
    const reportedTotal = findTotal(rows, headerIndex, valueIndexes);
    if (isZonedReport && reportedTotal != null && Math.abs(reportedTotal - totalKwh) > 0.001000001) {
      throw new Error('Suma energii w strefach nie zgadza się z pomiarami godzinowymi');
    }
    return {
      info: {
        kind: importIndexes.length ? 'ACTIVE_IMPORT' : 'ACTIVE_EXPORT',
        ppeNumber,
        ...period,
        periodYear: parts.periodYear,
        periodMonth: parts.periodMonth,
        aggregation: '60 min',
        totalKwh: reportedTotal ?? totalKwh,
        rowsCount: timestamps.length,
        sheetName,
        ...(modelledRows ? { modelledRows, modelDescription } : {}),
        ...(tariffRegisterPeriods.length > 1 ? { tariffRegisterPeriods } : {}),
      },
      intervals: includeIntervals ? intervalsFromRows(parsedRows) : [],
    };
  }

  throw new Error('Plik nie zawiera miesięcznego raportu godzinowego ENEA');
}

export function inspectEnergyMeasurementWorkbook(bytes: Buffer): EnergyMeasurementWorkbookInfo {
  return parseEnergyMeasurementWorkbook(bytes, false).info;
}

export function parseEnergyMeasurementIntervals(bytes: Buffer): EnergyMeasurementWorkbookWithIntervals {
  return parseEnergyMeasurementWorkbook(bytes, true);
}
