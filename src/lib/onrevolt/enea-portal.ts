export type EneaMeasurementKind = 'ACTIVE_IMPORT' | 'ACTIVE_EXPORT';

export type EneaPortalAccountInput = {
  login?: string | null;
  password?: string | null;
  portalPpeId?: string | null;
  ppeNumber?: string | null;
};

export type EneaPortalPpe = {
  id: number | string;
  name?: string;
  code?: string;
  ppeNumber?: string;
  meterNumber?: string;
};

export type ClosedMonth = {
  year: number;
  month: number;
  dateFrom: string;
  dateTo: string;
};

export type EneaDownloadedMeasurement = {
  kind: EneaMeasurementKind;
  year: number;
  month: number;
  ppe: EneaPortalPpe;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
};

type EneaFetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  accept?: string;
};

type EneaFetchResult = {
  response: Response;
  buffer: Buffer;
  data: unknown;
};

const eneaBaseUrl = 'https://portalodbiorcy.operator.enea.pl/portalOdbiorcy/';
const eneaApiUrl = `${eneaBaseUrl}api/`;
const eneaUserAgent = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/126.0.0.0 Safari/537.36',
].join(' ');

const measurementConfig: Record<EneaMeasurementKind, { id: number; label: string; documentSuffix: string }> = {
  ACTIVE_IMPORT: {
    id: 1,
    label: 'Energia czynna pobrana',
    documentSuffix: 'pobrana',
  },
  ACTIVE_EXPORT: {
    id: 5,
    label: 'Energia czynna oddana',
    documentSuffix: 'oddana',
  },
};

class EneaCookieJar {
  private cookies = new Map<string, string>();

  storeFrom(headers: Headers) {
    for (const header of getSetCookieHeaders(headers)) {
      const cookiePart = header.split(';')[0];
      const index = cookiePart.indexOf('=');
      if (index <= 0) continue;

      const name = cookiePart.slice(0, index).trim();
      const value = cookiePart.slice(index + 1).trim();
      const expired = /\bmax-age=0\b/i.test(header) || /\bexpires=Thu,\s*01 Jan 1970/i.test(header);
      if (expired) this.cookies.delete(name);
      else if (name) this.cookies.set(name, value);
    }
  }

  header() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

export class EneaPortalSession {
  readonly jar = new EneaCookieJar();
}

function splitSetCookieHeader(header: string) {
  const parts: string[] = [];
  let start = 0;

  for (let index = 0; index < header.length; index += 1) {
    if (header[index] !== ',') continue;

    const rest = header.slice(index + 1);
    if (/^\s*[\w!#$%&'*+.^`|~-]+=/.test(rest)) {
      parts.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(header.slice(start).trim());
  return parts.filter(Boolean);
}

function getSetCookieHeaders(headers: Headers) {
  const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') return getSetCookie.call(headers);

  const header = headers.get('set-cookie');
  return header ? splitSetCookieHeader(header) : [];
}

function apiUrl(path: string) {
  return path.startsWith('http') ? path : `${eneaApiUrl}${path.replace(/^\/+/, '')}`;
}

function responseText(buffer: Buffer) {
  return buffer.toString('utf8').replace(/\s+/g, ' ').trim();
}

function eneaErrorMessage(result: EneaFetchResult) {
  if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    const object = result.data as Record<string, unknown>;
    for (const key of ['message', 'error', 'code']) {
      if (typeof object[key] === 'string' && object[key]) return object[key];
    }
  }

  const text = responseText(result.buffer)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  return text || `HTTP ${result.response.status}`;
}

async function fetchWithEneaSession(
  session: EneaPortalSession,
  path: string,
  options: EneaFetchOptions = {},
): Promise<EneaFetchResult> {
  const headers: Record<string, string> = {
    Accept: options.accept || 'application/json, text/plain;q=0.9, */*;q=0.8',
    'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
    Origin: 'https://portalodbiorcy.operator.enea.pl',
    Referer: eneaBaseUrl,
    'User-Agent': eneaUserAgent,
    ...(options.headers || {}),
  };
  const cookie = session.jar.header();
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(apiUrl(path), {
    cache: 'no-store',
    method: options.method || 'GET',
    body: options.body,
    headers,
    redirect: 'manual',
  });
  session.jar.storeFrom(response.headers);

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';
  let data: unknown = null;

  if (contentType.includes('json') || contentType.includes('text')) {
    const text = responseText(buffer);
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
  }

  return { response, buffer, data };
}

export function getClosedMonths(count: number, now = new Date()): ClosedMonth[] {
  const months: ClosedMonth[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  for (let index = 0; index < count; index += 1) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

    months.push({
      year,
      month,
      dateFrom: `${year}-${String(month).padStart(2, '0')}-01`,
      dateTo: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    });

    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }

  return months;
}

export async function loginEneaPortal(login: string, password: string) {
  const session = new EneaPortalSession();
  await fetchWithEneaSession(session, eneaBaseUrl, {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  });

  const loginResult = await fetchWithEneaSession(session, 'auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({ username: login, password }),
  });
  if (!loginResult.response.ok) {
    throw new Error(`Logowanie ENEA nie powiodło się: ${eneaErrorMessage(loginResult)}`);
  }

  const ping = await fetchWithEneaSession(session, `auth/ping?ts=${Date.now()}`);
  if (!ping.response.ok || !ping.data) {
    throw new Error(`Portal ENEA nie potwierdził sesji: ${eneaErrorMessage(ping)}`);
  }

  return session;
}

function normalizePpes(payload: unknown): EneaPortalPpe[] {
  if (!Array.isArray(payload)) return [];

  const ppes: EneaPortalPpe[] = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const object = item as Record<string, any>;

    if (Array.isArray(object.items)) {
      for (const child of object.items) {
        if (!child || typeof child !== 'object' || Array.isArray(child)) continue;
        ppes.push(normalizePpe(child as Record<string, any>));
      }
      continue;
    }

    ppes.push(normalizePpe(object));
  }

  return ppes;
}

function normalizePpe(object: Record<string, any>): EneaPortalPpe {
  return {
    id: object.id,
    name: object.name,
    code: object.code,
    ppeNumber: object.ppeNumber || object.number || object.code || object.name,
    meterNumber: object.meterNumber || object.meterNr,
  };
}

export async function listEneaPpes(session: EneaPortalSession) {
  const result = await fetchWithEneaSession(session, 'user/ppes');
  if (!result.response.ok) {
    throw new Error(`Nie udało się pobrać punktów PPE z ENEA: ${eneaErrorMessage(result)}`);
  }

  return normalizePpes(result.data);
}

export function selectEneaPpe(account: EneaPortalAccountInput, ppes: EneaPortalPpe[]) {
  if (!ppes.length) {
    throw new Error('Konto ENEA nie ma żadnego punktu PPE');
  }

  const preferredId = account.portalPpeId?.trim();
  if (preferredId) {
    const found = ppes.find((ppe) => String(ppe.id) === preferredId);
    if (found) return found;
  }

  const preferredNumber = account.ppeNumber?.replace(/\s+/g, '').trim();
  if (preferredNumber) {
    const found = ppes.find((ppe) => (
      [ppe.ppeNumber, ppe.code, ppe.name]
        .filter(Boolean)
        .some((value) => String(value).replace(/\s+/g, '') === preferredNumber)
    ));
    if (found) return found;
  }

  return ppes[0];
}

export function eneaMeasurementLabel(kind: EneaMeasurementKind) {
  return measurementConfig[kind].label;
}

export function eneaMeasurementDocumentSuffix(kind: EneaMeasurementKind) {
  return measurementConfig[kind].documentSuffix;
}

export async function downloadEneaMeasurementXlsx(
  session: EneaPortalSession,
  ppe: EneaPortalPpe,
  month: ClosedMonth,
  kind: EneaMeasurementKind,
): Promise<EneaDownloadedMeasurement> {
  const config = measurementConfig[kind];
  const component = {
    name: 'consumption',
    ppeId: ppe.id,
    groupId: null,
    timeRange: 3,
    day: month.dateFrom,
    secondDay: month.dateTo,
    dataSourceTemplateId: config.id,
    dataSource: 2,
    ppeIds: null,
    groupIds: null,
    typeId: null,
    ppesWithDates: null,
    groupsWithDates: null,
    aggregation: 2,
  };

  const result = await fetchWithEneaSession(session, 'report/xlsx', {
    method: 'POST',
    accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify(component),
  });
  const mimeType = result.response.headers.get('content-type') || '';
  if (!result.response.ok || !mimeType.includes('spreadsheetml')) {
    throw new Error(`ENEA nie zwróciła XLS (${config.label}, ${month.year}-${String(month.month).padStart(2, '0')}): ${eneaErrorMessage(result)}`);
  }

  return {
    kind,
    year: month.year,
    month: month.month,
    ppe,
    fileName: `enea-${config.documentSuffix}-${month.year}-${String(month.month).padStart(2, '0')}.xlsx`,
    mimeType,
    bytes: result.buffer,
  };
}
