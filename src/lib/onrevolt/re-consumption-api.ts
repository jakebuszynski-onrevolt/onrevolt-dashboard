import * as XLSX from 'xlsx';
import {
  closedMeasurementPeriodKeys,
  inspectEnergyMeasurementWorkbook,
  type EnergyMeasurementWorkbookInfo,
} from './energy-measurement-document';

export const RE_CONSUMPTION_TOLERANCE_KWH = 0.001;
const defaultUrl = 'https://my.onrevolt.com/re/setup_func.php';
const xlsxMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type ReConsumptionSource = 'standard' | 'manual' | 'xlsx';
export type ReConsumptionProfile = {
  station: string;
  months: number[] | null;
  sources: ReConsumptionSource[] | null;
  exportSources: ReConsumptionSource[] | null;
  annualUsageKwh: number | null;
  hourlyProfile: { exists: boolean; rows: number; firstUpdate?: string | null; lastUpdate?: string | null };
};
export type ReConsumptionApiOptions = {
  fetch?: typeof fetch;
  baseUrl?: string;
  now?: Date;
};
export type ReConsumptionPreflight = {
  status: 'ready' | 'existing';
  station: string | null;
  message: string;
};

export class ReConsumptionConflictError extends Error {
  readonly code = 'RE_MONTH_EXISTS';
  constructor(readonly station: string, message: string) {
    super(message);
    this.name = 'ReConsumptionConflictError';
  }
}

export function reConsumptionPeriod(workbook: Pick<EnergyMeasurementWorkbookInfo, 'periodYear' | 'periodMonth'>) {
  return `${workbook.periodYear}-${String(workbook.periodMonth).padStart(2, '0')}`;
}

export function validateReConsumptionPeriod(workbook: EnergyMeasurementWorkbookInfo, now = new Date()) {
  if (!['ACTIVE_IMPORT', 'ACTIVE_EXPORT'].includes(workbook.kind)
    || !Number.isInteger(workbook.periodYear) || !Number.isInteger(workbook.periodMonth)
    || !Number.isFinite(workbook.totalKwh) || workbook.totalKwh < 0) {
    throw new Error('Nieprawidłowe metadane raportu XLSX dla RE');
  }
  const period = reConsumptionPeriod(workbook);
  if (!closedMeasurementPeriodKeys(12, now).has(period)) {
    throw new Error(`Miesiąc ${period} jest poza zakresem ostatnich 12 zamkniętych miesięcy`);
  }
}

export function inspectReConsumptionWorkbook(bytes: Buffer, now = new Date()) {
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('Nieprawidłowy rozmiar XLSX (limit 25 MB)');
  const info = inspectEnergyMeasurementWorkbook(bytes);
  validateReConsumptionPeriod(info, now);
  // RE reads only the first sheet and can write both channels in one request.
  const workbook = XLSX.read(bytes, { type: 'buffer' });
  if (workbook.SheetNames[0] !== info.sheetName) throw new Error('Raport RE musi znajdować się w pierwszym arkuszu XLSX');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[info.sheetName], { header: 1 });
  const opposite = info.kind === 'ACTIVE_IMPORT' ? /energia czynna (oddana|wprowadzona)/ : /energia czynna pobrana/;
  if (rows.some((row) => row.some((cell) => {
    const label = String(cell ?? '').toLowerCase().replace(/\s+/g, ' ');
    return opposite.test(label) && label.includes('po bilansowaniu');
  }))) throw new Error('Plik RE musi zawierać tylko jeden kierunek energii: pobraną albo oddaną');
  return info;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function sameTotal(actual: number, expected: number) {
  return Math.abs(actual - expected) <= RE_CONSUMPTION_TOLERANCE_KWH + Number.EPSILON * Math.max(1, actual, expected) * 4;
}

function parseProfile(data: Record<string, unknown>): ReConsumptionProfile {
  const sourcesValid = (value: unknown) => value === null || (
    Array.isArray(value) && value.length === 12 && value.every((source) => ['standard', 'manual', 'xlsx'].includes(source))
  );
  if (typeof data.station !== 'string' || !/^\d+$/.test(data.station)
    || !(data.months === null || (Array.isArray(data.months) && data.months.length === 12 && data.months.every(validNumber)))
    || !sourcesValid(data.sources) || !sourcesValid(data.exportSources)
    || (data.months === null) !== (data.sources === null)
    || (data.months === null) !== (data.exportSources === null)
    || !(data.annualUsageKwh === null || validNumber(data.annualUsageKwh))
    || !object(data.hourlyProfile) || typeof data.hourlyProfile.exists !== 'boolean'
    || !Number.isInteger(data.hourlyProfile.rows) || !validNumber(data.hourlyProfile.rows)) {
    throw new Error('Nieprawidłowa odpowiedź profilu RE; synchronizacja nie została potwierdzona');
  }
  return data as unknown as ReConsumptionProfile;
}

async function request(action: string, station: string, options: ReConsumptionApiOptions, body?: FormData | {
  months: number[];
  sources: ReConsumptionSource[];
  protect_detailed?: boolean;
}) {
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(station)) throw new Error('Nieprawidłowy numer albo token stacji RE');
  const url = new URL(options.baseUrl ?? (process.env.ONREVOLT_RE_PROFILE_URL?.trim() || defaultUrl));
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Nieprawidłowy adres API profilu RE');
  url.searchParams.set('action', action);
  url.searchParams.delete('station');
  if (!body) url.searchParams.set('station', station);
  const response = await (options.fetch ?? fetch)(url, {
    method: body ? 'POST' : 'GET',
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify({ station, ...body }) } : {}),
    headers: { Accept: 'application/json', ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`RE HTTP ${response.status}: odpowiedź nie jest poprawnym JSON`);
  }
  if (response.status === 409 && object(payload) && payload.code === 'RE_MONTH_EXISTS') {
    throw new ReConsumptionConflictError(station, typeof payload.error === 'string'
      ? payload.error : 'W RE zapisano już XLSX tego miesiąca. Potwierdź zastąpienie.');
  }
  if (!response.ok || !object(payload) || payload.ok !== true || !object(payload.data)) {
    const detail = object(payload) && typeof payload.error === 'string' ? `: ${payload.error.slice(0, 1000)}` : '';
    throw new Error(`RE HTTP ${response.status}: importer odrzucił żądanie${detail}`);
  }
  const profile = parseProfile(payload.data);
  if (/^\d+$/.test(station) && profile.station !== station) throw new Error('RE zwróciło profil innej stacji');
  return { data: payload.data, profile };
}

export async function readReConsumptionProfile(station: string, options: ReConsumptionApiOptions = {}) {
  return (await request('user_consumption_get', station, options)).profile;
}

export async function saveReConsumptionProfile(
  station: string,
  months: number[],
  sources: ReConsumptionSource[],
  options: ReConsumptionApiOptions = {},
) {
  if (!Array.isArray(months) || months.length !== 12 || !months.every(validNumber)
    || !Array.isArray(sources) || sources.length !== 12
    || !sources.every((source) => ['standard', 'manual', 'xlsx'].includes(source))) {
    throw new Error('Profil RE wymaga 12 poprawnych wartości miesięcznych i źródeł');
  }
  const { profile } = await request('user_consumption_save', station, options, { months, sources, protect_detailed: true });
  if (!profile.months || !profile.sources || !months.every((value, index) => (
    sameTotal(value, profile.months[index]) && sources[index] === profile.sources[index]
  ))) throw new Error('RE nie potwierdziło miesięcznych wartości lub źródeł zapisanego profilu');
  return profile;
}

export async function preflightReConsumptionWorkbook(input: {
  station: string;
  workbook: EnergyMeasurementWorkbookInfo;
  replaceExisting?: boolean;
}, options: ReConsumptionApiOptions = {}): Promise<ReConsumptionPreflight> {
  validateReConsumptionPeriod(input.workbook, options.now);
  const profile = await readReConsumptionProfile(input.station, options);
  const sources = input.workbook.kind === 'ACTIVE_IMPORT' ? profile.sources : profile.exportSources;
  if (sources?.[input.workbook.periodMonth - 1] === 'xlsx' && input.replaceExisting !== true) {
    return {
      status: 'existing', station: profile.station,
      message: `RE ma już XLSX (${input.workbook.kind === 'ACTIVE_IMPORT' ? 'pobór' : 'oddanie'}) za miesiąc ${input.workbook.periodMonth}. Potwierdź zastąpienie profilu w RE.`,
    };
  }
  return { status: 'ready', station: profile.station, message: `RE: można zaimportować ${reConsumptionPeriod(input.workbook)}` };
}

export async function uploadReConsumptionWorkbook(input: {
  station: string;
  bytes: Buffer;
  fileName: string;
  replaceExisting?: boolean;
}, options: ReConsumptionApiOptions = {}) {
  if (!/\.xlsx$/i.test(input.fileName)) throw new Error('Plik RE musi mieć rozszerzenie .xlsx');
  const workbook = inspectReConsumptionWorkbook(input.bytes, options.now);
  const preflight = await preflightReConsumptionWorkbook({ ...input, workbook }, options);
  if (preflight.status === 'existing') throw new ReConsumptionConflictError(preflight.station, preflight.message);
  const form = new FormData();
  form.set('station', preflight.station);
  if (!input.replaceExisting) form.set('reject_existing', '1');
  form.set('file', new Blob([new Uint8Array(input.bytes)], { type: xlsxMimeType }), input.fileName);
  const { data, profile } = await request('user_consumption_xlsx_upload', preflight.station, options, form);
  const receipt = data[workbook.kind === 'ACTIVE_IMPORT' ? 'imported' : 'exported'];
  const otherReceipt = data[workbook.kind === 'ACTIVE_IMPORT' ? 'exported' : 'imported'];
  const sources = workbook.kind === 'ACTIVE_IMPORT' ? profile.sources : profile.exportSources;
  if (!object(receipt) || receipt.month !== workbook.periodMonth || receipt.sourceYear !== workbook.periodYear
    || !validNumber(receipt.totalKwh) || !sameTotal(receipt.totalKwh, workbook.totalKwh)
    || otherReceipt != null || sources?.[workbook.periodMonth - 1] !== 'xlsx'
    || !profile.hourlyProfile.exists || profile.hourlyProfile.rows === 0
    || (workbook.kind === 'ACTIVE_IMPORT' && !sameTotal(profile.months[workbook.periodMonth - 1], workbook.totalKwh))) {
    throw new Error(`RE nie potwierdziło kierunku, okresu lub sumy ${workbook.totalKwh} kWh za ${reConsumptionPeriod(workbook)} (tolerancja 1 Wh). Zapis mógł nastąpić. Sprawdź dane i potwierdź zastąpienie profilu w RE.`);
  }
  return { profile, workbook };
}
