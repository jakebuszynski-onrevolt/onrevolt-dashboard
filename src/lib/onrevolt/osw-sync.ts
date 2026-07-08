import { prisma } from 'lib/onrevolt/prisma';

export type OswReviewItem = {
  supplierSku?: string;
  name?: string;
  reason: string;
};

type OswProductPayload = {
  localProductId?: string;
  supplierSku: string;
  name?: string;
  priceNet?: number;
  availabilityRaw: string;
  supplierUrl?: string;
  currency?: string;
};

type OswFetchedProducts = {
  productsSeen: number;
  products: OswProductPayload[];
  requiresReview: OswReviewItem[];
};

export type OswSyncResult = {
  productsSeen: number;
  matchedProducts: number;
  pricesWouldUpdate: number;
  pricesUpdated: number;
  availabilityWouldUpdate: number;
  availabilityUpdated: number;
  availableCount: number;
  unavailableCount: number;
  requiresReview: OswReviewItem[];
};

export type OswSyncStatus = {
  lastSyncedAt: string | null;
  syncedProducts: number;
};

type OswDefaults = {
  purchaseVatRate?: number;
  operatingCostNet?: number;
  marginRate?: number;
  saleVatRate?: number;
};

type OswLoginForm = {
  action: string;
  method: string;
  fields: Record<string, string>;
  emailField: string;
  passwordField: string;
};

type OswSession = {
  baseUrl: string;
  jar: OswCookieJar;
  token?: string;
  oswApiToken?: string;
  email?: string;
  password?: string;
  defaultDistrictId?: number;
  loginAttempted: boolean;
  loginError?: string;
};

type OswFetchOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  accept?: string;
  referer?: string;
};

type OswFetchResult = {
  response: Response;
  body: string;
  finalUrl: string;
};

const supplierSkuKeys = ['supplierSku', 'sku', 'SKU', 'code', 'itemCode', 'partNumber'];
const nameKeys = ['name', 'productName', 'description', 'title'];
const priceKeys = ['priceNet', 'netPrice', 'purchaseNet', 'price', 'unitPrice'];
const availabilityKeys = ['availability', 'stockStatus', 'stock', 'status'];
const urlKeys = ['url', 'productUrl', 'supplierUrl', 'link'];
const currencyKeys = ['currency', 'Currency'];
const oswBrowserUserAgent = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/126.0.0.0 Safari/537.36',
].join(' ');
const oswPublicBaseUrl = 'https://osw.energy';

class OswCookieJar {
  private cookies = new Map<string, string>();

  constructor(initialCookie?: string) {
    if (initialCookie) this.applyCookieHeader(initialCookie);
  }

  applyCookieHeader(cookieHeader: string) {
    for (const part of cookieHeader.split(';')) {
      const index = part.indexOf('=');
      if (index <= 0) continue;
      const name = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

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

  hasCookies() {
    return this.cookies.size > 0;
  }
}

function envString(key: string) {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : undefined;
}

function envNumber(key: string) {
  const value = envString(key);
  if (!value) return undefined;
  const number = Number(value.replace(',', '.'));
  if (!Number.isFinite(number)) {
    throw new Error(`Zmienna ${key} musi być liczbą`);
  }
  return number;
}

function oswDefaults(): OswDefaults {
  return {
    purchaseVatRate: envNumber('OSW_DEFAULT_PURCHASE_VAT_RATE'),
    operatingCostNet: envNumber('OSW_DEFAULT_OPERATING_COST_NET'),
    marginRate: envNumber('OSW_DEFAULT_MARGIN_RATE'),
    saleVatRate: envNumber('OSW_DEFAULT_SALE_VAT_RATE'),
  };
}

function hasCompleteDefaults(defaults: OswDefaults) {
  return (
    defaults.purchaseVatRate !== undefined &&
    defaults.operatingCostNet !== undefined &&
    defaults.marginRate !== undefined &&
    defaults.saleVatRate !== undefined
  );
}

function pickString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function pickNumber(row: Record<string, unknown>, keys: string[]) {
  const raw = pickString(row, keys);
  if (!raw) return undefined;
  return parsePriceNumber(raw);
}

function rowsFromJson(payload: unknown) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const object = payload as Record<string, unknown>;
  for (const key of ['data', 'products', 'items', 'results']) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  return [];
}

function mapOswRows(rows: unknown[]): OswFetchedProducts {
  const requiresReview: OswReviewItem[] = [];
  const products: OswProductPayload[] = [];

  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      requiresReview.push({ reason: 'Wiersz OSW nie jest obiektem produktu' });
      continue;
    }

    const object = row as Record<string, unknown>;
    const supplierSku = pickString(object, supplierSkuKeys);
    const name = pickString(object, nameKeys);
    const availabilityRaw = pickString(object, availabilityKeys);
    if (!supplierSku) {
      requiresReview.push({ name, reason: 'Brak supplierSku/SKU w danych OSW' });
      continue;
    }
    if (!availabilityRaw) {
      requiresReview.push({ supplierSku, name, reason: 'Brak statusu dostępności w danych OSW' });
      continue;
    }

    products.push({
      supplierSku,
      name,
      availabilityRaw,
      priceNet: pickNumber(object, priceKeys),
      supplierUrl: pickString(object, urlKeys),
      currency: pickString(object, currencyKeys),
    });
  }

  return { productsSeen: rows.length, products, requiresReview };
}

function baseHeaders(accept = 'application/json, text/plain;q=0.9, */*;q=0.8') {
  return {
    Accept: accept,
    'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8',
    'User-Agent': oswBrowserUserAgent,
  };
}

function oswApiBaseUrl() {
  const host = envString('OSW_API_HOST') || 'https://plapi.solarbrain.com.au';
  const prefix = envString('OSW_API_PREFIX') || '/api';
  const normalizedHost = host.endsWith('/') ? host : `${host}/`;
  const normalizedPrefix = prefix.replace(/^\/?/, '/').replace(/\/?$/, '/');

  return new URL(normalizedPrefix, normalizedHost).toString().replace(/\/$/, '');
}

function oswApiUrl(path: string) {
  return `${oswApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

function oswApiHeaders(session: OswSession, referer?: string, json = false) {
  const headers: Record<string, string> = {
    ...baseHeaders('application/json, text/plain;q=0.9, */*;q=0.8'),
    Origin: oswPublicBaseUrl,
    Referer: referer || new URL('/pl/sign-in', oswPublicBaseUrl).toString(),
  };

  const token = session.oswApiToken || session.token;
  if (token) headers.token = token;
  if (json) headers['Content-Type'] = 'application/json';

  return headers;
}

function oswApiResponseBody(payload: unknown) {
  if (!payload || typeof payload !== 'object') return undefined;

  const root = payload as Record<string, unknown>;
  const response = root.response && typeof root.response === 'object'
    ? root.response as Record<string, unknown>
    : undefined;
  const body = response?.body ?? root.body ?? root.data;

  return body && typeof body === 'object' ? body as Record<string, unknown> : undefined;
}

function numberFromOswApiValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) return parsePriceNumber(value);
  return undefined;
}

function stringFromOswApiValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function oswProductIdFromUrl(url: string) {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    return path.match(/-(\d+)\/?$/)?.[1];
  } catch {
    return undefined;
  }
}

function createOswSession(baseUrl: string): OswSession {
  return {
    baseUrl,
    jar: new OswCookieJar(envString('OSW_SESSION_COOKIE') || envString('OSW_COOKIE')),
    token: envString('OSW_API_TOKEN'),
    email: envString('OSW_EMAIL'),
    password: envString('OSW_PASSWORD'),
    loginAttempted: false,
  };
}

function authHeaders(session: OswSession, accept?: string) {
  const headers: Record<string, string> = baseHeaders(accept);

  if (session.token) {
    headers.Authorization = `Bearer ${session.token}`;
  } else if (session.email && session.password && envString('OSW_BASIC_AUTH') === 'true') {
    const basic = Buffer.from(`${session.email}:${session.password}`, 'utf8').toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }

  const cookie = session.jar.header();
  if (cookie) headers.Cookie = cookie;

  return headers;
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

function fetchErrorReason(error: unknown) {
  if (!(error instanceof Error)) return String(error);

  const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code && cause.message) return `${error.message} (${cause.code}: ${cause.message})`;
  if (cause?.code) return `${error.message} (${cause.code})`;
  if (cause?.message) return `${error.message} (${cause.message})`;
  return error.message;
}

function redirectedMethod(status: number, method: string) {
  if (status === 303) return 'GET';
  if ((status === 301 || status === 302) && method !== 'GET' && method !== 'HEAD') return 'GET';
  return method;
}

async function fetchWithOswSession(session: OswSession, url: string, options: OswFetchOptions = {}): Promise<OswFetchResult> {
  let currentUrl = url;
  let method = (options.method || 'GET').toUpperCase();
  let body = options.body;

  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const headers: Record<string, string> = {
      ...authHeaders(session, options.accept),
      ...(options.headers || {}),
    };
    if (options.referer) headers.Referer = options.referer;
    if (body === undefined) delete headers['Content-Type'];

    const response = await fetch(currentUrl, {
      cache: 'no-store',
      method,
      body,
      headers,
      redirect: 'manual',
    });
    session.jar.storeFrom(response.headers);

    const location = response.headers.get('location');
    if (location && response.status >= 300 && response.status < 400) {
      currentUrl = new URL(location, currentUrl).toString();
      const nextMethod = redirectedMethod(response.status, method);
      if (nextMethod === 'GET' || nextMethod === 'HEAD') body = undefined;
      method = nextMethod;
      continue;
    }

    return {
      response,
      body: await response.text(),
      finalUrl: currentUrl,
    };
  }

  throw new Error('OSW przekroczyło limit przekierowań HTTP');
}

function isOswHtmlBlockade(body: string) {
  const normalized = body.toLowerCase();
  return (
    normalized.includes('<html') && (
      normalized.includes('human verification') ||
      normalized.includes('captcha') ||
      normalized.includes('awswaf') ||
      normalized.includes('sign in') ||
      normalized.includes('login') ||
      normalized.includes('zaloguj')
    )
  );
}

function oswAuthReview(reason: string): OswFetchedProducts {
  return {
    productsSeen: 0,
    products: [],
    requiresReview: [{ reason }],
  };
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function attributesFromTag(tag: string) {
  const attributes: Record<string, string> = {};
  const matches = tag.matchAll(/([:\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g);

  for (const match of matches) {
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(match[3] ?? match[4] ?? match[5] ?? '');
  }

  return attributes;
}

function htmlInputs(html: string) {
  return [...html.matchAll(/<input\b[^>]*>/gi)].map((match) => attributesFromTag(match[0]));
}

function findLoginName(inputs: Array<Record<string, string>>) {
  const configured = envString('OSW_LOGIN_EMAIL_FIELD');
  if (configured) return configured;

  const emailInput = inputs.find((input) => {
    const name = input.name || '';
    const type = (input.type || '').toLowerCase();
    return name && type !== 'password' && /(email|username|login\[username\]|customer\[email\]|user\[email\])/i.test(name);
  });

  return emailInput?.name || 'email';
}

function extractOswLoginForm(html: string, pageUrl: string): OswLoginForm | undefined {
  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map((match) => match[0]);
  const candidates = forms.length ? forms : [html];

  for (const formHtml of candidates) {
    const inputs = htmlInputs(formHtml);
    const passwordInput = inputs.find((input) => input.name && (input.type || '').toLowerCase() === 'password');
    if (!passwordInput?.name) continue;

    const formTag = formHtml.match(/<form\b[^>]*>/i)?.[0] || '';
    const formAttributes = attributesFromTag(formTag);
    const fields: Record<string, string> = {};

    for (const input of inputs) {
      const name = input.name;
      const type = (input.type || '').toLowerCase();
      if (!name || ['button', 'image', 'reset', 'submit'].includes(type)) continue;
      fields[name] = input.value || '';
    }

    return {
      action: new URL(formAttributes.action || pageUrl, pageUrl).toString(),
      method: (formAttributes.method || 'POST').toUpperCase(),
      fields,
      emailField: findLoginName(inputs),
      passwordField: envString('OSW_LOGIN_PASSWORD_FIELD') || passwordInput.name,
    };
  }

  return undefined;
}

function oswLoginExtraFields() {
  const raw = envString('OSW_LOGIN_EXTRA_FIELDS');
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
      );
    }
  } catch {
    // OSW_LOGIN_EXTRA_FIELDS może być też zapisane jak querystring: a=1&b=2.
  }

  return Object.fromEntries(new URLSearchParams(raw).entries());
}

function loginUrlCandidates(baseUrl: string) {
  const configured = envString('OSW_LOGIN_URL');
  if (configured) return [new URL(configured, baseUrl).toString()];

  return [
    new URL('/customer/account/login/', baseUrl).toString(),
    new URL('/customer/account/', baseUrl).toString(),
    new URL('/login', baseUrl).toString(),
  ];
}

function looksLikeLoginFailure(body: string) {
  const normalized = body.toLowerCase();
  return (
    /<input\b[^>]*type=["']?password/i.test(body) && (
      normalized.includes('login') ||
      normalized.includes('sign in') ||
      normalized.includes('zaloguj') ||
      normalized.includes('incorrect') ||
      normalized.includes('invalid')
    )
  );
}

async function loginOswApiSession(session: OswSession) {
  if (session.oswApiToken) {
    session.loginError = undefined;
    return true;
  }

  if (session.token) {
    session.oswApiToken = session.token;
    session.loginError = undefined;
    return true;
  }

  if (!session.email || !session.password) {
    session.loginError = 'brak OSW_EMAIL/OSW_PASSWORD albo OSW_SESSION_COOKIE';
    return false;
  }

  try {
    const response = await fetch(oswApiUrl('/osw/account/v1/sessions'), {
      cache: 'no-store',
      method: 'POST',
      headers: oswApiHeaders(session, new URL('/pl/sign-in', oswPublicBaseUrl).toString(), true),
      body: JSON.stringify({
        email: session.email,
        password: session.password,
      }),
    });
    const body = await response.text();
    const payload = body ? JSON.parse(body) : undefined;

    if (!response.ok) {
      session.loginError = `API logowania OSW zwróciło HTTP ${response.status}`;
      return false;
    }

    const account = oswApiResponseBody(payload);
    const token = stringFromOswApiValue(account?.token);
    if (!token) {
      session.loginError = 'API logowania OSW nie zwróciło tokenu sesji';
      return false;
    }

    session.oswApiToken = token;
    const districtId = Number(account?.district_id);
    if (Number.isFinite(districtId)) session.defaultDistrictId = districtId;
    session.loginError = undefined;
    return true;
  } catch (error) {
    session.loginError = `API logowania OSW: ${fetchErrorReason(error)}`;
    return false;
  }
}

async function ensureOswLogin(session: OswSession) {
  if (session.loginAttempted) return !session.loginError;
  session.loginAttempted = true;

  const apiLoggedIn = await loginOswApiSession(session);
  if (apiLoggedIn) return true;
  const apiLoginError = session.loginError;

  if (!session.email || !session.password) {
    session.loginError = apiLoginError || 'brak OSW_EMAIL/OSW_PASSWORD albo OSW_SESSION_COOKIE';
    return false;
  }

  let lastError = '';
  for (const loginUrl of loginUrlCandidates(session.baseUrl)) {
    try {
      const loginPage = await fetchWithOswSession(session, loginUrl, {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      });
      if (!loginPage.response.ok && loginPage.response.status !== 405) {
        lastError = `login URL zwrócił HTTP ${loginPage.response.status}`;
        continue;
      }

      const form = extractOswLoginForm(loginPage.body, loginPage.finalUrl);
      const fields = {
        ...(form?.fields || {}),
        ...oswLoginExtraFields(),
      };
      const emailField = form?.emailField || envString('OSW_LOGIN_EMAIL_FIELD') || 'email';
      const passwordField = form?.passwordField || envString('OSW_LOGIN_PASSWORD_FIELD') || 'password';
      fields[emailField] = session.email;
      fields[passwordField] = session.password;

      const params = new URLSearchParams(fields);
      let action = form?.action || loginPage.finalUrl;
      const method = (form?.method || 'POST').toUpperCase();
      let body: BodyInit | undefined = params;

      if (method === 'GET') {
        const target = new URL(action);
        params.forEach((value, key) => target.searchParams.set(key, value));
        action = target.toString();
        body = undefined;
      }

      const loginResponse = await fetchWithOswSession(session, action, {
        method,
        body,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
        referer: loginPage.finalUrl,
      });

      if (!looksLikeLoginFailure(loginResponse.body)) {
        session.loginError = undefined;
        return true;
      }

      lastError = 'OSW zwróciło formularz logowania po próbie logowania';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  session.loginError = apiLoginError || lastError || 'nie udało się zalogować do OSW';
  return false;
}

async function fetchAuthenticatedOswUrl(session: OswSession, url: string, accept?: string) {
  let result = await fetchWithOswSession(session, url, { accept });

  if ((result.response.status === 401 || result.response.status === 403 || isOswHtmlBlockade(result.body)) && !session.token) {
    const loggedIn = await ensureOswLogin(session);
    if (loggedIn) {
      result = await fetchWithOswSession(session, url, { accept });
    }
  }

  return result;
}

function parseOswJson(body: string) {
  try {
    return JSON.parse(body);
  } catch {
    if (isOswHtmlBlockade(body)) return undefined;
    throw new Error('OSW_PRODUCTS_URL nie zwrócił poprawnego JSON');
  }
}

function parsePriceNumber(raw: string) {
  const cleaned = raw
    .replace(/&nbsp;/g, ' ')
    .replace(/[^\d.,\s-]/g, '')
    .trim();
  if (!/\d/.test(cleaned)) return undefined;

  const compact = cleaned.replace(/\s/g, '');
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    normalized = compact.replace(new RegExp(`\\${thousandsSeparator}`, 'g'), '').replace(decimalSeparator, '.');
  } else if (lastComma >= 0) {
    normalized = compact.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = compact.replace(/,/g, '');
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

function htmlToText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

function availabilityFromText(text: string) {
  if (/limited\s*stock/i.test(text)) return 'Limited Stock';
  if (/\bin\s*stock\b|\binstock\b/i.test(text)) return 'InStock';
  if (/on\s*request|onrequest/i.test(text)) return 'On Request';
  if (/out\s*of\s*stock|outofstock/i.test(text)) return 'Out of Stock';
  return undefined;
}

function traverseJson(value: unknown, visit: (object: Record<string, unknown>) => void) {
  if (Array.isArray(value)) {
    value.forEach((item) => traverseJson(item, visit));
    return;
  }
  if (!value || typeof value !== 'object') return;

  const object = value as Record<string, unknown>;
  visit(object);
  Object.values(object).forEach((item) => traverseJson(item, visit));
}

function jsonLdProductData(html: string) {
  const result: { priceNet?: number; currency?: string; availabilityRaw?: string } = {};
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

  for (const script of scripts) {
    try {
      const payload = JSON.parse(decodeHtmlEntities(script[1].trim()));
      traverseJson(payload, (object) => {
        const price = typeof object.price === 'string' || typeof object.price === 'number'
          ? parsePriceNumber(String(object.price))
          : undefined;
        const currency = typeof object.priceCurrency === 'string' ? object.priceCurrency : undefined;
        const availability = typeof object.availability === 'string'
          ? availabilityFromText(object.availability.replace(/^https?:\/\/schema\.org\//i, ''))
          : undefined;

        if (price !== undefined && result.priceNet === undefined) result.priceNet = price;
        if (currency && !result.currency) result.currency = currency;
        if (availability && !result.availabilityRaw) result.availabilityRaw = availability;
      });
    } catch {
      // Nie każdy sklep pilnuje poprawnego JSON-LD; pozostałe parsowanie nadal działa.
    }
  }

  return result;
}

function metaContent(html: string, namePattern: RegExp) {
  const tags = html.matchAll(/<(meta|span|div|input)\b[^>]*>/gi);
  for (const tag of tags) {
    const attributes = attributesFromTag(tag[0]);
    const name = [attributes.name, attributes.property, attributes.itemprop, attributes.class, attributes.id]
      .filter(Boolean)
      .join(' ');
    const content = attributes.content || attributes.value || attributes['data-price-amount'];
    if (content && namePattern.test(name)) return content;
  }
  return undefined;
}

function priceFromText(text: string) {
  const patterns = [
    /(?:net|excl\.?\s*tax|excluding\s*tax|price|cena)[^\d]{0,50}(-?\d[\d\s.,]*)/i,
    /(-?\d[\d\s.,]*)\s*(?:PLN|zł|EUR|€)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const price = parsePriceNumber(match[1]);
    if (price !== undefined) return price;
  }

  return undefined;
}

function currencyFromText(text: string) {
  if (/\bPLN\b|zł/i.test(text)) return 'PLN';
  if (/\bEUR\b|€/i.test(text)) return 'EUR';
  return undefined;
}

function parseOswProductPage(html: string) {
  const text = htmlToText(html);
  const jsonLd = jsonLdProductData(html);
  const metaPrice = metaContent(html, /(price|amount)/i);
  const metaCurrency = metaContent(html, /(currency|pricecurrency)/i);

  return {
    availabilityRaw: jsonLd.availabilityRaw || availabilityFromText(text) || availabilityFromText(html),
    priceNet: jsonLd.priceNet ?? (metaPrice ? parsePriceNumber(metaPrice) : undefined) ?? priceFromText(text),
    currency: jsonLd.currency || metaCurrency || currencyFromText(text),
  };
}

export function normalizeOswAvailability(raw: string) {
  const normalized = raw.replace(/\s+/g, '').toLowerCase();
  if (normalized === 'onrequest' || normalized === 'outofstock') return { label: 'Niedostępny', available: false };
  if (normalized === 'instock' || normalized === 'limitedstock') return { label: 'Dostępny', available: true };
  return undefined;
}

function pickOswApiDistrict(product: Record<string, unknown>, session: OswSession) {
  const districts = Array.isArray(product.districts)
    ? product.districts.filter((district): district is Record<string, unknown> => (
      !!district && typeof district === 'object' && !Array.isArray(district)
    ))
    : [];

  if (!districts.length) return undefined;

  return (
    districts.find((district) => Number(district.id) === session.defaultDistrictId) ||
    districts.find((district) => Boolean(district.is_default)) ||
    districts[0]
  );
}

function availabilityFromOswApiProduct(product: Record<string, unknown>, session: OswSession) {
  const district = pickOswApiDistrict(product, session);
  const status = stringFromOswApiValue(district?.stock_status) || stringFromOswApiValue(product.stock_status);
  if (status) return status;

  const stock = numberFromOswApiValue(district?.stock ?? product.stock);
  if (stock !== undefined) return stock > 0 ? 'InStock' : 'On Request';

  return undefined;
}

function mapOswApiProduct(
  localProduct: { id: string; sku: string | null; supplierSku: string | null; name: string },
  supplierUrl: string,
  product: Record<string, unknown>,
  session: OswSession,
): OswProductPayload | undefined {
  const availabilityRaw = availabilityFromOswApiProduct(product, session);
  if (!availabilityRaw) return undefined;

  return {
    localProductId: localProduct.id,
    supplierSku: localProduct.supplierSku || stringFromOswApiValue(product.item_id) || localProduct.sku || localProduct.id,
    name: stringFromOswApiValue(product.display_name) || localProduct.name,
    supplierUrl,
    availabilityRaw,
    priceNet: (
      numberFromOswApiValue(product.real_price) ??
      numberFromOswApiValue(product.display_price) ??
      numberFromOswApiValue(product.base_price)
    ),
    currency: stringFromOswApiValue(product.currency) || 'PLN',
  };
}

async function fetchOswApiProduct(session: OswSession, productId: string, referer: string) {
  const loggedIn = await ensureOswLogin(session);
  if (!loggedIn || !(session.oswApiToken || session.token)) {
    throw new Error(`OSW wymaga zalogowania: ${session.loginError || 'brak tokenu API'}`);
  }

  const response = await fetch(oswApiUrl(`/osw/v1/products/${encodeURIComponent(productId)}`), {
    cache: 'no-store',
    headers: oswApiHeaders(session, referer),
  });
  const body = await response.text();
  const payload = body ? JSON.parse(body) : undefined;

  if (!response.ok) {
    throw new Error(`API produktu OSW zwróciło HTTP ${response.status}`);
  }

  const product = oswApiResponseBody(payload);
  if (!product) {
    throw new Error('API produktu OSW nie zwróciło danych produktu');
  }

  return product;
}

async function fetchOswProductsFromProductsUrl(url: string): Promise<OswFetchedProducts> {
  const session = createOswSession(url);
  let result: OswFetchResult;

  try {
    result = await fetchAuthenticatedOswUrl(session, url);
  } catch (error) {
    return oswAuthReview(`Nie udało się pobrać OSW_PRODUCTS_URL: ${fetchErrorReason(error)}`);
  }

  const body = result.body;

  if (isOswHtmlBlockade(body)) {
    return oswAuthReview(
      session.loginError
        ? `OSW wymaga zalogowanej sesji. Próba logowania nie powiodła się: ${session.loginError}.`
        : 'OSW zwróciło stronę logowania albo CAPTCHA zamiast danych. Ustaw OSW_EMAIL/OSW_PASSWORD, OSW_SESSION_COOKIE lub OSW_API_TOKEN.',
    );
  }

  if (!result.response.ok) {
    throw new Error(`OSW zwróciło HTTP ${result.response.status}`);
  }

  const payload = parseOswJson(body);
  if (!payload) {
    return oswAuthReview(
      session.loginError
        ? `OSW wymaga zalogowanej sesji. Próba logowania nie powiodła się: ${session.loginError}.`
        : 'OSW wymaga zalogowanej sesji. Ustaw OSW_EMAIL/OSW_PASSWORD, OSW_SESSION_COOKIE albo OSW_API_TOKEN.',
    );
  }

  const rows = rowsFromJson(payload);
  if (!rows.length) {
    throw new Error('OSW_PRODUCTS_URL nie zwrócił tablicy produktów JSON');
  }

  return mapOswRows(rows);
}

function productUrlHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isLikelyOswProduct(product: { supplier?: string | null; supplierUrl?: string | null }) {
  const supplier = product.supplier?.trim().toLowerCase() || '';
  const host = product.supplierUrl ? productUrlHost(product.supplierUrl) : '';
  const urlLooksLikeOsw = host.includes('osw') || host.includes('onestopwarehouse');

  if (supplier) {
    return supplier === 'osw' || supplier.includes('one stop') || urlLooksLikeOsw;
  }

  return urlLooksLikeOsw;
}

async function fetchOswProductsFromLocalUrls(): Promise<OswFetchedProducts> {
  const localProducts = await prisma.product.findMany({
    where: { supplierUrl: { not: null } },
    select: {
      id: true,
      sku: true,
      supplierSku: true,
      name: true,
      supplier: true,
      supplierUrl: true,
    },
    orderBy: { name: 'asc' },
  });
  const candidates = localProducts.filter((product) => product.supplierUrl && isLikelyOswProduct(product));

  if (!candidates.length) {
    return oswAuthReview('Pominięto synchronizację OSW: brak OSW_PRODUCTS_URL i brak lokalnych produktów z URL dostawcy OSW');
  }

  const sessions = new Map<string, OswSession>();
  const products: OswProductPayload[] = [];
  const requiresReview: OswReviewItem[] = [];

  for (const localProduct of candidates) {
    const supplierUrl = localProduct.supplierUrl?.trim();
    if (!supplierUrl) continue;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(supplierUrl);
    } catch {
      requiresReview.push({
        supplierSku: localProduct.supplierSku || localProduct.sku || undefined,
        name: localProduct.name,
        reason: 'Niepoprawny URL dostawcy OSW',
      });
      continue;
    }

    const origin = parsedUrl.origin;
    let session = sessions.get(origin);
    if (!session) {
      session = createOswSession(origin);
      sessions.set(origin, session);
    }

    const productId = oswProductIdFromUrl(supplierUrl);
    if (productId) {
      try {
        const apiProduct = await fetchOswApiProduct(session, productId, supplierUrl);
        const mappedProduct = mapOswApiProduct(localProduct, supplierUrl, apiProduct, session);
        if (mappedProduct) {
          products.push(mappedProduct);
          continue;
        }

        requiresReview.push({
          supplierSku: localProduct.supplierSku || localProduct.sku || undefined,
          name: localProduct.name,
          reason: 'API produktu OSW nie zwróciło statusu dostępności',
        });
        continue;
      } catch (error) {
        requiresReview.push({
          supplierSku: localProduct.supplierSku || localProduct.sku || undefined,
          name: localProduct.name,
          reason: `Nie udało się pobrać danych API OSW: ${fetchErrorReason(error)}`,
        });
        continue;
      }
    }

    let page: OswFetchResult;
    try {
      page = await fetchAuthenticatedOswUrl(session, supplierUrl, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
    } catch (error) {
      requiresReview.push({
        supplierSku: localProduct.supplierSku || localProduct.sku || undefined,
        name: localProduct.name,
        reason: `Nie udało się pobrać strony OSW: ${fetchErrorReason(error)}`,
      });
      continue;
    }

    if (isOswHtmlBlockade(page.body)) {
      requiresReview.push({
        supplierSku: localProduct.supplierSku || localProduct.sku || undefined,
        name: localProduct.name,
        reason: session.loginError
          ? `OSW wymaga zalogowania: ${session.loginError}`
          : 'OSW zwróciło stronę logowania albo CAPTCHA zamiast strony produktu',
      });
      continue;
    }

    if (!page.response.ok) {
      requiresReview.push({
        supplierSku: localProduct.supplierSku || localProduct.sku || undefined,
        name: localProduct.name,
        reason: `Strona produktu OSW zwróciła HTTP ${page.response.status}`,
      });
      continue;
    }

    const parsed = parseOswProductPage(page.body);
    if (!parsed.availabilityRaw) {
      requiresReview.push({
        supplierSku: localProduct.supplierSku || localProduct.sku || undefined,
        name: localProduct.name,
        reason: 'Nie znaleziono statusu dostępności na stronie produktu OSW',
      });
      continue;
    }

    products.push({
      localProductId: localProduct.id,
      supplierSku: localProduct.supplierSku || localProduct.sku || localProduct.id,
      name: localProduct.name,
      supplierUrl,
      availabilityRaw: parsed.availabilityRaw,
      priceNet: parsed.priceNet,
      currency: parsed.currency,
    });
  }

  return { productsSeen: candidates.length, products, requiresReview };
}

export async function fetchOswProducts(): Promise<OswFetchedProducts> {
  const url = envString('OSW_PRODUCTS_URL');
  if (url) return fetchOswProductsFromProductsUrl(url);
  return fetchOswProductsFromLocalUrls();
}

export async function getOswSyncStatus(): Promise<OswSyncStatus> {
  const status = await prisma.product.aggregate({
    where: { supplierSyncedAt: { not: null } },
    _max: { supplierSyncedAt: true },
    _count: { _all: true },
  });

  return {
    lastSyncedAt: status._max.supplierSyncedAt?.toISOString() ?? null,
    syncedProducts: status._count._all,
  };
}

function decimalNumber(value: unknown) {
  if (value == null) return null;
  if (typeof value === 'object' && 'toString' in value) return Number(value.toString());
  return Number(value);
}

function buildPriceData(localProduct: any, oswProduct: OswProductPayload, defaults: OswDefaults) {
  if (oswProduct.priceNet === undefined) return undefined;
  const latest = localProduct.prices[0];
  if (latest) {
    return {
      productId: localProduct.id,
      purchaseNet: oswProduct.priceNet,
      currentPurchaseNet: oswProduct.priceNet,
      purchaseVatRate: decimalNumber(latest.purchaseVatRate) ?? 0,
      operatingCostNet: decimalNumber(latest.operatingCostNet) ?? 0,
      marginRate: decimalNumber(latest.marginRate) ?? 0,
      saleVatRate: decimalNumber(latest.saleVatRate) ?? 0,
      currency: oswProduct.currency || latest.currency || 'PLN',
    };
  }

  if (!hasCompleteDefaults(defaults)) return undefined;

  return {
    productId: localProduct.id,
    purchaseNet: oswProduct.priceNet,
    currentPurchaseNet: oswProduct.priceNet,
    purchaseVatRate: defaults.purchaseVatRate,
    operatingCostNet: defaults.operatingCostNet,
    marginRate: defaults.marginRate,
    saleVatRate: defaults.saleVatRate,
    currency: oswProduct.currency || 'PLN',
  };
}

function priceNeedsUpdate(latest: any, priceData: ReturnType<typeof buildPriceData>) {
  if (!priceData) return false;
  if (!latest) return true;
  return (
    decimalNumber(latest.purchaseNet) !== priceData.purchaseNet ||
    decimalNumber(latest.currentPurchaseNet) !== priceData.currentPurchaseNet ||
    latest.currency !== priceData.currency
  );
}

async function findLocalProduct(oswProduct: OswProductPayload) {
  if (oswProduct.localProductId) {
    const product = await prisma.product.findUnique({
      where: { id: oswProduct.localProductId },
      include: { prices: { orderBy: { validFrom: 'desc' }, take: 1 } },
    });
    return product ? [product] : [];
  }

  return prisma.product.findMany({
    where: { supplierSku: oswProduct.supplierSku },
    include: { prices: { orderBy: { validFrom: 'desc' }, take: 1 } },
    take: 2,
  });
}

export async function syncOswProducts(options: { apply: boolean }): Promise<OswSyncResult> {
  const fetched = await fetchOswProducts();
  const defaults = oswDefaults();
  const result: OswSyncResult = {
    productsSeen: fetched.productsSeen,
    matchedProducts: 0,
    pricesWouldUpdate: 0,
    pricesUpdated: 0,
    availabilityWouldUpdate: 0,
    availabilityUpdated: 0,
    availableCount: 0,
    unavailableCount: 0,
    requiresReview: [...fetched.requiresReview],
  };

  for (const oswProduct of fetched.products) {
    const availability = normalizeOswAvailability(oswProduct.availabilityRaw);
    if (!availability) {
      result.requiresReview.push({
        supplierSku: oswProduct.supplierSku,
        name: oswProduct.name,
        reason: `Nieznany status OSW: ${oswProduct.availabilityRaw}`,
      });
      continue;
    }

    if (availability.available) result.availableCount += 1;
    else result.unavailableCount += 1;

    const localMatches = await findLocalProduct(oswProduct);

    if (!localMatches.length) {
      result.requiresReview.push({
        supplierSku: oswProduct.supplierSku,
        name: oswProduct.name,
        reason: 'Brak produktu lokalnego z dokładnym supplierSku',
      });
      continue;
    }
    if (localMatches.length > 1) {
      result.requiresReview.push({
        supplierSku: oswProduct.supplierSku,
        name: oswProduct.name,
        reason: 'Więcej niż jeden produkt lokalny ma ten supplierSku',
      });
      continue;
    }

    const localProduct = localMatches[0];
    result.matchedProducts += 1;

    if (!oswProduct.supplierUrl && !localProduct.supplierUrl) {
      result.requiresReview.push({
        supplierSku: oswProduct.supplierSku,
        name: oswProduct.name || localProduct.name,
        reason: 'Pominięto produkt bez URL dostawcy',
      });
      continue;
    }

    const productUpdate: Record<string, unknown> = {
      supplier: 'OSW',
      supplierUrl: oswProduct.supplierUrl || localProduct.supplierUrl,
      supplierSyncedAt: new Date(),
    };

    if (localProduct.availability !== availability.label) {
      result.availabilityWouldUpdate += 1;
      productUpdate.availability = availability.label;
    }

    const priceData = buildPriceData(localProduct, oswProduct, defaults);
    if (oswProduct.priceNet !== undefined && !priceData) {
      result.requiresReview.push({
        supplierSku: oswProduct.supplierSku,
        name: oswProduct.name,
        reason: 'Brak lokalnej ceny bazowej oraz pełnych zmiennych OSW_DEFAULT_* dla VAT/marży',
      });
    }

    const latestPrice = localProduct.prices[0];
    const shouldCreatePrice = priceNeedsUpdate(latestPrice, priceData);
    if (shouldCreatePrice) result.pricesWouldUpdate += 1;

    if (options.apply) {
      await prisma.$transaction(async (tx) => {
        await tx.product.update({ where: { id: localProduct.id }, data: productUpdate });
        if (shouldCreatePrice && priceData) {
          await tx.productPrice.create({ data: priceData });
        }
      });

      if ('availability' in productUpdate) result.availabilityUpdated += 1;
      if (shouldCreatePrice) result.pricesUpdated += 1;
    }
  }

  return result;
}

export const __oswSyncTestUtils = {
  extractOswLoginForm,
  mapOswApiProduct,
  oswProductIdFromUrl,
  parseOswProductPage,
  splitSetCookieHeader,
};
