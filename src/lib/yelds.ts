// /src/lib/yelds.ts
export type MonthItem = { month?: number; label?: string; avg_kWh?: number };

function parseMaybeJSON<T>(v: any): T | null {
  if (v == null) return null;
  if (typeof v === "object") return v as T;
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return null; }
  }
  return null;
}

const LABELS_PL = ["styczeń","luty","marzec","kwiecień","maj","czerwiec","lipiec","sierpień","wrzesień","październik","listopad","grudzień"];

function monthIndex(x: MonthItem): number | null {
  if (typeof x.month === "number" && x.month >= 1 && x.month <= 12) return x.month - 1;
  if (x.label) {
    const i = LABELS_PL.findIndex(l => l.toLowerCase() === String(x.label).toLowerCase());
    if (i >= 0) return i;
  }
  return null;
}

function toArray12(src: any): number[] | null {
  const arr = parseMaybeJSON<MonthItem[]>(src) ?? (Array.isArray(src) ? (src as MonthItem[]) : null);
  if (!arr) return null;
  const out = Array(12).fill(0);
  for (const it of arr) {
    const i = monthIndex(it);
    if (i == null) continue;
    const v = Number((it as any).avg_kWh);
    if (Number.isFinite(v)) out[i] = v;
  }
  return out;
}

function pickWide(pdValues: Record<string, any>, keyNeedle: string): any | undefined {
  // 1) exact top-level
  for (const [k, v] of Object.entries(pdValues ?? {})) {
    if (k.toLowerCase() === keyNeedle.toLowerCase()) return v;
  }
  // 2) custom_by_name / customByName
  const cbn = (pdValues as any)?.custom_by_name || (pdValues as any)?.customByName || {};
  for (const [k, v] of Object.entries(cbn)) {
    if (k.toLowerCase() === keyNeedle.toLowerCase()) return v;
  }
  // 3) podobne klucze (contain) – hist, histpv bywają różnie nazywane
  const needles = [
    keyNeedle,
    keyNeedle.replace(/_/g, ""), // hist_pv → histpv
  ];
  const shallowObjs: any[] = [
    pdValues,
    cbn,
    (pdValues as any).deal,
    (pdValues as any).person,
    (pdValues as any).data,
    (pdValues as any).custom,
    (pdValues as any).extras,
    (pdValues as any).details,
  ].filter(Boolean);
  for (const obj of shallowObjs) {
    for (const [k, v] of Object.entries(obj)) {
      const kk = k.toLowerCase();
      if (needles.some(n => kk.includes(n.toLowerCase()))) return v;
    }
  }
  return undefined;
}

/** Zwraca parę [hist, histpv] – każda tablica 12 liczb (0..200). */
export function buildYeldsPair(pdValues: Record<string, any>): { hist: number[]; histpv: number[] } {
  const rawHist   = pickWide(pdValues, "hist");
  const rawHistPv = pickWide(pdValues, "histpv");

  let a = toArray12(rawHist)   ?? Array(12).fill(0);
  let b = toArray12(rawHistPv) ?? Array(12).fill(0);

  // clip do 0..200 (skala stała)
  const clip = (n: number) => Math.max(0, Math.min(200, Number(n) || 0));
  a = a.map(clip);
  b = b.map(clip);

  // DEBUG (w dev) – pokaż gdzie znaleziono
  if (typeof window !== "undefined" && (window as any)?.location?.hostname) {
    const dbg = (window as any).__yelds_dbg ?? ((window as any).__yelds_dbg = {});
    dbg.found = {
      hist: rawHist ? (Array.isArray(rawHist) ? "array" : typeof rawHist) : null,
      histpv: rawHistPv ? (Array.isArray(rawHistPv) ? "array" : typeof rawHistPv) : null,
      sample_hist: a.slice(0, 3),
      sample_histpv: b.slice(0, 3),
    };
    // eslint-disable-next-line no-console
    console.debug("[yelds] found", dbg.found);
  }

  return { hist: a, histpv: b };
}
