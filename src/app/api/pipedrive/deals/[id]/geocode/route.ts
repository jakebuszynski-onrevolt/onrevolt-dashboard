import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DOMAIN = process.env.PIPEDRIVE_DOMAIN;
const BASE =
  process.env.PIPEDRIVE_BASE_URL ??
  (DOMAIN ? `https://${DOMAIN}.pipedrive.com/api/v1` : "");
const TOKEN = process.env.PIPEDRIVE_API_TOKEN || "";

async function fetchJson(url: string) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

// minimalna wersja „snake ASCII”
function snakeAscii(input: string, maxLen = 120) {
  if (!input || typeof input !== "string") return "field";
  let s = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (!s) s = "field";
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

const STRIP_PREFIX = /\b(ul\.?|ulica|al\.?|aleja|pl\.?|plac|os\.?|osiedle)\b\.?/gi;

function firstNonEmpty<T>(...vals: T[]): T | undefined {
  for (const v of vals) {
    if (v != null && v !== "" && !(typeof v === "string" && v.trim() === "")) return v;
  }
  return undefined;
}

function cleanStreet(s: string): string {
  s = (s || "").trim();
  s = s.replace(STRIP_PREFIX, "").replace(/\s{2,}/g, " ").replace(/\s*,\s*/g, " ");
  return s;
}

// fuzzy-get po „nazwach” kluczy (snake); zwraca { key, value }
function getByFuzzy(obj: Record<string, any>, candidates: string[]) {
  const lc = (x: string) => x.toLowerCase();
  const set = new Set(candidates.map(lc));
  for (const [k, v] of Object.entries(obj || {})) {
    if (set.has(lc(k))) return { key: k, value: v };
  }
  for (const [k, v] of Object.entries(obj || {})) {
    const kk = lc(k);
    if (candidates.some((c) => kk.includes(lc(c)))) return { key: k, value: v };
  }
  return { key: "", value: undefined };
}

const toNum = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** pobierz wszystkie pola deala i zbuduj mapy: key->snake(name), snake(name)->key */
async function buildFieldMaps() {
  let start = 0;
  const limit = 500;
  const fields: any[] = [];
  for (;;) {
    const jf = await fetchJson(`${BASE}/dealFields?api_token=${TOKEN}&start=${start}&limit=${limit}`);
    fields.push(...(jf?.data ?? []));
    const more = jf?.additional_data?.pagination?.more_items_in_collection;
    if (!more) break;
    start = jf?.additional_data?.pagination?.next_start ?? start + limit;
  }
  const keyToSnake = new Map<string, string>();
  const snakeToKey = new Map<string, string>();
  for (const f of fields) {
    const snake = snakeAscii(f?.name || "");
    if (f?.key) {
      keyToSnake.set(String(f.key), snake);
      snakeToKey.set(snake, String(f.key));
    }
  }
  return { keyToSnake, snakeToKey };
}

/** geokodowanie Nominatim (kilka wariantów zapytań) */
async function geocodeCandidates(candidates: string[]) {
  const triedQueries: string[] = [];
  let best: any = null;

  for (const q of candidates) {
    const compact = q.trim();
    if (!compact) continue;
    triedQueries.push(compact);
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(
      compact
    )}`;
    const g = await fetch(url, {
      headers: { "User-Agent": "WindyOne-Panel/1.0 (+https://onrevolt.com)" },
    });
    if (!g.ok) continue;
    const arr = await g.json();
    if (Array.isArray(arr) && arr.length) {
      best = arr[0];
      break;
    }
    // krótki delay – uprzejmość dla OSM
    await new Promise((r) => setTimeout(r, 250));
  }
  return { best, triedQueries };
}

function pickKeyBySnake(snakeToKey: Map<string, string>, names: string[]): string | undefined {
  for (const n of names) {
    const exact = snakeToKey.get(n);
    if (exact) return exact;
  }
  for (const [snake, key] of snakeToKey.entries()) {
    if (names.some((nn) => snake.includes(nn))) return key;
  }
  return undefined;
}

/** ================ ROUTE ================ */
export async function POST(req: Request, ctx: any) {
  try {
    if (!TOKEN) return NextResponse.json({ error: "Missing PIPEDRIVE_API_TOKEN" }, { status: 500 });
    if (!BASE)  return NextResponse.json({ error: "Missing PIPEDRIVE_BASE_URL or PIPEDRIVE_DOMAIN" }, { status: 500 });

    const dealId: string | undefined = ctx?.params?.id;
    if (!dealId) return NextResponse.json({ error: "Missing deal id" }, { status: 400 });

    const url = new URL(req.url);

    // 1) Pobierz DEAL (customy są na top-level)
    const deal = (await fetchJson(`${BASE}/deals/${dealId}?api_token=${TOKEN}`))?.data;

    // 2) dealFields → mapowanie key -> snake(name)
    const { keyToSnake, snakeToKey } = await buildFieldMaps();

    // 3) custom_by_name z top-level deala
    const custom_by_name: Record<string, any> = {};
    for (const [k, v] of Object.entries(deal || {})) {
      if (keyToSnake.has(k)) custom_by_name[keyToSnake.get(k)!] = v;
    }

    // 4) Złóż ADRES (priorytet: custom_by_name z deala → ewent. person.*)
    const personId =
      deal?.person_id?.value ??
      deal?.person_id?.id ??
      (typeof deal?.person_id === "number" ? deal.person_id : null);

    // pobierz PERSON wyłącznie jako fallback dla adresu (lat/lon zapisujemy w DEAL)
    const person = personId
      ? (await fetchJson(`${BASE}/persons/${personId}?api_token=${TOKEN}`))?.data
      : null;

    const addr = getByFuzzy(custom_by_name, ["lokalizacja_instalacji", "adres_instalacji", "adres", "address", "ulica"]);
    const city = getByFuzzy(custom_by_name, ["miasto_miejscow", "miejscow", "miasto", "city"]);
    const post = getByFuzzy(custom_by_name, ["kod_poczt", "kod", "postal"]);

    const street = cleanStreet(firstNonEmpty(addr.value, person?.address));
    const cityVal = firstNonEmpty(city.value, person?.city);
    const postal  = firstNonEmpty(post.value,  person?.postal_code);

    const candidates = [
      [street, cityVal, postal, "Polska"],
      [street, postal, cityVal, "Polska"],
      [cityVal, postal, "Polska"],
      [street, cityVal, "Polska"],
    ]
      .map(parts => parts.filter(Boolean).join(", "))
      .filter(Boolean);

    // 5) Geokoduj (Nominatim) – kilka wariantów
    const { best, triedQueries } = await geocodeCandidates(candidates);
    if (!best) {
      return NextResponse.json({ error: "Nie znaleziono współrzędnych", triedQueries, street, city: cityVal, postal }, { status: 404 });
    }

    const lat = Number(best.lat);
    const lon = Number(best.lon);

    // 6) Znajdź PRAWDZIWE klucze custom fields w DEAL dla 'lat' i 'lon' po NAME (snake)
    const latKey = pickKeyBySnake(snakeToKey, ["lat", "latitude"]);
    const lonKey = pickKeyBySnake(snakeToKey, ["lon", "lng", "long", "longitude"]);

    if (!latKey || !lonKey) {
      return NextResponse.json(
        { error: "Na dealu nie znaleziono pól 'lat'/'lon' (po nazwie). Utwórz je lub sprawdź nazwy pól w Pipedrive.", triedQueries },
        { status: 400 }
      );
    }

    // 7) Zapisz LAT/LON do DEAL (to było u Ciebie i działało)
    const updDeal = await fetch(`${BASE}/deals/${dealId}?api_token=${TOKEN}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [latKey]: lat, [lonKey]: lon }),
    });
    if (!updDeal.ok) {
      return NextResponse.json({ error: `Pipedrive update deal error ${updDeal.status}`, triedQueries }, { status: 502 });
    }

    // 8) POLICZ i pobierz statystyki (średnie + histogramy + windrose) z Twojego endpointu
    let yieldWind: number | null = null;
    let yieldPV: number | null = null;
    let hist: any[] | null = null;
    let histPV: any[] | null = null;
    let windrose: any[] | null = null;

    try {
      // Jeżeli wolisz absolutny host, zostaw poniższą linię:
      // const statsUrl = new URL(`https://onrevolt.com/api/stats/energy?lat=${lat}&lon=${lon}`, url);
      // A jeśli chcesz działać też lokalnie, użyj względnego względem bieżącego zapytania:
      const statsUrl = new URL(`https://onrevolt.com/api/stats/energy?lat=${lat}&lon=${lon}`, url);
      const stats = await fetchJson(statsUrl.toString());

      yieldWind = Number(stats?.wind?.avg_kWh ?? null);
      yieldPV   = Number(stats?.pv?.avg_pv_kWh ?? null);
      if (!Number.isFinite(yieldWind)) yieldWind = null;
      if (!Number.isFinite(yieldPV))   yieldPV = null;

      hist = Array.isArray(stats?.hist) ? stats.hist : null;
      histPV = Array.isArray(stats?.histPV) ? stats.histPV : null;
      windrose = Array.isArray(stats?.windrose) ? stats.windrose : null;
    } catch {
      yieldWind = null;
      yieldPV = null;
      hist = null;
      histPV = null;
      windrose = null;
    }

try {
  const payload2: Record<string, any> = {};

  // znajdź klucze pól po snake(name)
  const yieldKey    = pickKeyBySnake(snakeToKey, ["yield"]);
  const yieldPVKey  = pickKeyBySnake(snakeToKey, ["yieldpv", "yield_pv", "pv_yield"]);
  const histKey     = pickKeyBySnake(snakeToKey, ["hist"]);
  const histPVKey   = pickKeyBySnake(snakeToKey, ["histpv", "hist_pv"]);
  const windroseKey = pickKeyBySnake(snakeToKey, ["windrose", "wind_rose", "roza_wiatrow", "roza_wiatrowa"]);

  if (yieldKey && yieldWind != null)   payload2[yieldKey]    = yieldWind;           // liczba
  if (yieldPVKey && yieldPV != null)   payload2[yieldPVKey]  = yieldPV;             // liczba
  if (histKey && hist)                 payload2[histKey]     = JSON.stringify(hist);      // JSON jako tekst
  if (histPVKey && histPV)             payload2[histPVKey]   = JSON.stringify(histPV);    // JSON jako tekst
  if (windroseKey && windrose)         payload2[windroseKey] = JSON.stringify(windrose);  // JSON jako tekst

  if (Object.keys(payload2).length) {
    const updDeal2 = await fetch(`${BASE}/deals/${dealId}?api_token=${TOKEN}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload2),
    });
    // brak throw — jeśli się nie uda, i tak lat/lon już zapisane
  }
} catch {
  // celowo ignorujemy — lat/lon już zapisane; UI i tak pokaże dane z 'saved'
}


    // 9) Odpowiedź — "saved" zawiera teraz WSZYSTKO, co front wyświetla
    return NextResponse.json({
      deal_id: Number(dealId),
      lat, lon,
      lat_key: latKey,
      lon_key: lonKey,
      triedQueries,
      saved: {
        "yield": yieldWind ?? 0,        // średnia wiatr 2015–2024
        "yieldPV": yieldPV ?? 0,        // średnia PV 2015–2024
        hist,                           // histogram miesięczny wiatru
        histPV,                         // histogram miesięczny PV
        windrose,                       // róża wiatrów
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "error" }, { status: 500 });
  }
}
