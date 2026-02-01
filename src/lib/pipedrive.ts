// src/lib/pipedrive.ts
const PIPEDRIVE_API = process.env.PIPEDRIVE_API_BASE || 'https://api.pipedrive.com/v1';
const PIPEDRIVE_TOKEN = process.env.PIPEDRIVE_API_TOKEN as string;

type DealField = { id: number; key: string; name: string };

async function pdFetch(path: string, init?: RequestInit) {
  const url = `${PIPEDRIVE_API}${path}${path.includes('?') ? '&' : '?'}api_token=${encodeURIComponent(PIPEDRIVE_TOKEN)}`;
  const r = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Pipedrive ${r.status}: ${await r.text()}`);
  return r.json();
}

let _dealFieldsCache: Record<string, string> | null = null;
/** Zwraca mapę: lowercased(field.name) -> field.key  (+fallback z prefixem raport_) */
export async function getDealFieldKeyMap(): Promise<Record<string, string>> {
  if (_dealFieldsCache) return _dealFieldsCache;
  const data = await pdFetch('/dealFields?limit=500');
  const map: Record<string, string> = {};
  (data?.data as DealField[] | undefined)?.forEach((f) => {
    if (!f?.name || !f?.key) return;
    map[f.name.toLowerCase()] = f.key;
  });
  _dealFieldsCache = map;
  return map;
}

/** Aktualizacja pól po _nazwach_ (np. "yield", "histPV"); ignoruje nieistniejące. */
export async function updateDealByFieldNames(
  dealId: string | number,
  valuesByName: Record<string, any>
) {
  const nameToKey = await getDealFieldKeyMap();

  const payload: Record<string, any> = {};
  for (const [name, val] of Object.entries(valuesByName)) {
    const lc = name.toLowerCase();
    let key = nameToKey[lc];

    // Fallback na "raport_" jeśli ktoś ma stare pola
    if (!key) key = nameToKey[`raport_${lc}`];

    if (key != null) {
      payload[key] = val;
    }
  }

  if (Object.keys(payload).length === 0) {
    return { updated: 0, usedKeys: [], ignoredNames: Object.keys(valuesByName) };
  }

  await pdFetch(`/deals/${dealId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

  return { updated: Object.keys(payload).length, usedKeys: Object.keys(payload), ignoredNames: [] };
}
