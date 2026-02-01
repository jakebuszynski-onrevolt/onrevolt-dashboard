// /src/lib/windrose.ts
export type WindrosePointV1 = { sector: number; cnt?: number; sum_speed?: number; avg_speed?: number };
export type WindrosePointV2 = { dir: string; count?: number; percent?: number };
export type WindrosePoint = WindrosePointV1 | WindrosePointV2;

const ROSE_LABELS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];

function parseMaybeJSON<T>(val: any): T | null {
  if (val == null) return null;
  if (typeof val === "object") return val as T;
  if (typeof val !== "string") return null;
  try { return JSON.parse(val) as T; } catch { return null; }
}

function pickVal(item: any): number {
  if (Number.isFinite(Number(item?.sum_speed))) return Number(item.sum_speed);
  if (Number.isFinite(Number(item?.cnt))) return Number(item.cnt);
  if (Number.isFinite(Number(item?.percent))) return Number(item.percent);
  if (Number.isFinite(Number(item?.count))) return Number(item.count);
  if (Number.isFinite(Number(item?.avg_speed))) return Number(item.avg_speed);
  return 0;
}

export function getWindroseFromPd(pdValues: Record<string, any>): WindrosePoint[] | null {
  if (!pdValues || typeof pdValues !== "object") return null;

  const candidates: any[] = [];

  // 1) top-level: windrose (lub podobnie nazwane)
  for (const [k, v] of Object.entries(pdValues)) {
    if (/windrose/i.test(k)) candidates.push(v);
  }

  // 2) custom_by_name / customByName
  const cbn: Record<string, any> = (pdValues as any).custom_by_name || (pdValues as any).customByName || {};
  for (const [k, v] of Object.entries(cbn)) {
    if (/windrose/i.test(k)) candidates.push(v);
  }

  // 3) popularne "płytkie" gałęzie (bez pełnego deep-scan)
  const shallowKeys = ["deal", "person", "data", "custom", "extras", "details"];
  for (const sk of shallowKeys) {
    const o = (pdValues as any)[sk];
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        if (/windrose/i.test(k)) candidates.push(v);
      }
    }
  }

  // 4) wybierz pierwszy kandydata, który jest tablicą (lub stringiem-JSON tablicy)
  for (const cand of candidates) {
    const arr = parseMaybeJSON<any[]>(cand) ?? (Array.isArray(cand) ? cand : null);
    if (arr && arr.length) return arr as any;
  }

  return null;
}

/** 16 sektorów w kolejności ROSE_LABELS; brak danych ⇒ null */
export function buildRoseArray16(pdValues: Record<string, any>): number[] | null {
  const src = getWindroseFromPd(pdValues);
  if (!src || src.length === 0) return null;

  // przygotuj 16 kubełków N,NNE,...,NNW
  const buckets = new Array<number>(16).fill(0);

  for (const item of src as any[]) {
    // warianty: {sector: number, ...} lub {dir: "NNE", ...}
    let idx: number | null = null;

    if (typeof (item as any).sector === "number") {
      const secRaw = Number((item as any).sector);
      // normalizacja: 360 -> 0, wartości ujemne -> modulo 360
      let sec = ((secRaw % 360) + 360) % 360;
      if (sec === 360) sec = 0;
      // 0=N, 22.5= NNE, ... => indeks 0..15
      idx = Math.round(sec / 22.5) % 16;
    } else if ((item as any).dir) {
      const label = String((item as any).dir).toUpperCase();
      const i = ROSE_LABELS.indexOf(label);
      if (i >= 0) idx = i;
    }

    if (idx == null) continue;
    buckets[idx] += pickVal(item);
  }

  // gdyby wszystko było 0, zwróć choć pustą różę zamiast null
  const hasAny = buckets.some(v => Number(v) > 0);
  return hasAny ? buckets : buckets;
}
