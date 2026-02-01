import { NextResponse } from "next/server";
import { statsPool } from '@/lib/dbStats';

export const dynamic = "force-dynamic";

type Nearest = { id: number; lat: number; lon: number; distance_km: number };

const deg2rad = (d: number) => d * Math.PI / 180;
const rad2deg = (r: number) => r * 180 / Math.PI;

/** Pozycja słońca (UTC) – port z Twojego PHP */
function calcSunPos(date: Date, lat: number, lon: number) {
  const rad = (x: number) => x * Math.PI / 180;

  const ts = date.getTime();
  const julian = ts / 86400000 + 2440587.5;
  const d = julian - 2451545.0;

  const M = 357.5291 + 0.98560028 * d;
  const L = M + 1.9148 * Math.sin(rad(M)) + 0.0200 * Math.sin(2 * rad(M));

  const Jt = 2451545.0 + 0.0009 + (lon / 360) + d + 0.0053 * Math.sin(rad(M)) - 0.0069 * Math.sin(2 * rad(L));
  const decl = rad2deg(Math.asin(Math.sin(rad(L)) * Math.sin(rad(23.44))));
  const solarTime = 24 * (julian - Jt);
  const H = 15 * (solarTime - 12);

  const latR = deg2rad(lat);
  const declR = deg2rad(decl);
  const HR = deg2rad(H);

  const elevation = rad2deg(
    Math.asin(Math.sin(latR) * Math.sin(declR) + Math.cos(latR) * Math.cos(declR) * Math.cos(HR))
  );
  const azimuth = rad2deg(
    Math.atan2(-Math.sin(HR), (Math.cos(latR) * Math.tan(declR) - Math.sin(latR) * Math.cos(HR)))
  );

  return { elevation, azimuth };
}

function calcPV(area: number, directRadiation: number, panelTilt: number, sunElev: number, sunAz: number, eff: number) {
  const beta = deg2rad(panelTilt);
  const alpha = deg2rad(sunElev);
  const gamma = deg2rad(sunAz);
  const thetaDot = Math.sin(beta) * Math.sin(alpha) + Math.cos(beta) * Math.cos(alpha) * Math.cos(gamma);
  const clamped = Math.max(0, Math.min(1, thetaDot));
  // fizycznie poprawnie byłoby: const projected = clamped;
  // PHP-compat (cos(cos(...))):
  const projected = Math.cos(clamped);
  const power = area * directRadiation * projected * eff;
  return Math.max(0, power);
}


async function findNearest(lat: number, lon: number): Promise<Nearest | null> {
  const sql = `
    SELECT id, lat, lon,
      (6371 * acos(
        cos(radians(?)) * cos(radians(lat)) * cos(radians(lon) - radians(?)) +
        sin(radians(?)) * sin(radians(lat))
      )) AS distance
    FROM maps
    ORDER BY distance ASC
    LIMIT 1
  `;
  const [rows] = await statsPool.query<any[]>(sql, [lat, lon, lat]);
  const r = rows?.[0];
  if (!r) return null;
  return { id: r.id, lat: Number(r.lat), lon: Number(r.lon), distance_km: Number(r.distance) };
}

// Typ zgodny z Twoim użyciem
//type Nearest = { id: number; lat: number; lon: number; distance_km: number };

const MONTH_PL = [
  "styczeń","luty","marzec","kwiecień","maj","czerwiec",
  "lipiec","sierpień","wrzesień","październik","listopad","grudzień"
];

async function computeEnergyCore(
  lat: number,
  lon: number,
  yearStart: number,
  yearEnd: number,
  maxKm: number
) {
  const nearest = await findNearest(lat, lon);
  if (!nearest) return { error: "Brak punktów maps" };
  if (nearest.distance_km > maxKm) {
    return { error: "Brak danych pogodowych w wybranym miejscu", nearest };
  }

  // --- WIATR (Twoja formuła)
  const windYears: { year: number; total_kWh: number }[] = [];
  let windSumWh = 0, windYearsCnt = 0;

  for (let y = yearStart; y <= yearEnd; y++) {
    const [rows] = await statsPool.query<any[]>(
      `SELECT SUM(ROUND(0.6398189 * POW(wind_speed_10m, 3.466507))) AS total
       FROM weather WHERE parent_id = ? AND YEAR(time)=?`,
      [nearest.id, y]
    );
    const totalWh = Number(rows?.[0]?.total || 0);
    if (totalWh > 0) { windYearsCnt++; windSumWh += totalWh; }
    windYears.push({ year: y, total_kWh: Math.round(totalWh / 1000) });
  }
  const windAvg_kWh = windYearsCnt ? Math.round((windSumWh / windYearsCnt) / 1000) : 0;

  // --- PV (Twoje parametry + korekta 1.12)
  const area = 2 * 1.1 * 3;
  const panelTilt = 35;
  const eff = 0.2133;

  const pvYears: { year: number; pv_kWh: number; heliostat_kWh: number }[] = [];
  let pvSum = 0, heliostatSum = 0, pvYearsCnt = 0;

  for (let y = yearStart; y <= yearEnd; y++) {
    const [rows] = await statsPool.query<any[]>(
      `SELECT time, direct_radiation
       FROM weather WHERE parent_id = ? AND YEAR(time)=?`,
      [nearest.id, y]
    );
    let totalPV = 0, totalHelio = 0, cnt = 0;
    for (const r of rows) {
      const date = new Date(r.time);
      date.setUTCHours(12, 0, 0, 0);
      const sun = calcSunPos(date, lat, lon);
      const dr = Number(r.direct_radiation || 0);
      totalPV += calcPV(area, dr, panelTilt, sun.elevation, sun.azimuth, eff);
      totalHelio += area * dr * eff;
      cnt++;
    }
    const pv_kWh = cnt ? (totalPV / 1000) : 0;
    const heliostat_kWh = cnt ? (totalHelio / 1000) : 0;
    const pvAdj = Math.round(pv_kWh * 1.12);
    const helAdj = Math.round(heliostat_kWh * 1.12);
    pvYears.push({ year: y, pv_kWh: pvAdj, heliostat_kWh: helAdj });
    if (cnt) { pvYearsCnt++; pvSum += pvAdj; heliostatSum += helAdj; }
  }
  const pvAvg_kWh = pvYearsCnt ? Math.round(pvSum / pvYearsCnt) : 0;
  const heliostatAvg_kWh = pvYearsCnt ? Math.round(heliostatSum / pvYearsCnt) : 0;

  // --- RÓŻA WIATRÓW (Twoje zapytanie – rok 2024)
  const [roseRows] = await statsPool.query<any[]>(
    `SELECT ROUND(wind_direction_10m/22.5)*22.5 AS sector,
            COUNT(*) AS cnt,
            SUM(wind_speed_10m) AS sum_speed,
            AVG(wind_speed_10m) AS avg_speed
     FROM weather
     WHERE parent_id = ? AND YEAR(time)=?
     GROUP BY sector
     ORDER BY sector`,
    [nearest.id, 2024]
  );
  const windrose = (roseRows || []).map(r => ({
    sector: Number(r.sector),
    cnt: Number(r.cnt),
    sum_speed: Number(r.sum_speed),
    avg_speed: Number(r.avg_speed),
  }));

  // --- HISTOGRAM MIESIĘCZNY — WIATR (średnie z lat)
  // Zapis per (rok, miesiąc), potem średnia po latach z wartości > 0.
  const [windMonthRows] = await statsPool.query<any[]>(
    `SELECT YEAR(time) AS y, MONTH(time) AS m,
            SUM(ROUND(0.6398189 * POW(wind_speed_10m, 3.466507))) AS s
     FROM weather
     WHERE parent_id = ? AND YEAR(time) BETWEEN ? AND ?
     GROUP BY y, m
     ORDER BY y, m`,
    [nearest.id, yearStart, yearEnd]
  );

  const windByMonth: Record<number, number[]> = {};
  for (const r of windMonthRows ?? []) {
    const m = Number(r.m);
    const s = Number(r.s || 0);
    if (!windByMonth[m]) windByMonth[m] = [];
    windByMonth[m].push(s);
  }

  const hist = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const arr = (windByMonth[month] || []).filter(v => v > 0);
    const avg_kWh = arr.length ? Math.round((arr.reduce((a,b)=>a+b,0) / arr.length) / 1000) : 0;
    return { month, label: MONTH_PL[i], avg_kWh };
  });

  // --- HISTOGRAM MIESIĘCZNY — PV (średnie z lat) z korektą 1.12
  // Liczymy dokładnie tak, jak w części rocznej, tylko rozbijamy na miesiące.
  const pvMonthTotalsPerYear: Record<number, number[]> = {}; // month -> [kWh w danym roku]
  for (let y = yearStart; y <= yearEnd; y++) {
    const [rows] = await statsPool.query<any[]>(
      `SELECT time, direct_radiation
       FROM weather
       WHERE parent_id = ? AND YEAR(time)=?`,
      [nearest.id, y]
    );
    // suma PV per miesiąc w konkretnym roku
    const perMonthWh: Record<number, number> = {}; // month -> Wh
    for (const r of rows ?? []) {
      const date = new Date(r.time);
      date.setUTCHours(12, 0, 0, 0);
      const m = date.getUTCMonth() + 1;
      const sun = calcSunPos(date, lat, lon);
      const dr = Number(r.direct_radiation || 0);
      const pvWh = calcPV(area, dr, panelTilt, sun.elevation, sun.azimuth, eff);
      perMonthWh[m] = (perMonthWh[m] || 0) + pvWh;
    }
    // przelicz na kWh i zastosuj *1.12 jak u Ciebie
    for (let m = 1; m <= 12; m++) {
      const kWh = (perMonthWh[m] || 0) / 1000;
      const adj = Math.round(kWh * 1.12);
      if (!pvMonthTotalsPerYear[m]) pvMonthTotalsPerYear[m] = [];
      if (adj > 0) pvMonthTotalsPerYear[m].push(adj);
    }
  }

  const histPV = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const arr = pvMonthTotalsPerYear[month] || [];
    const avg_kWh = arr.length ? Math.round(arr.reduce((a,b)=>a+b,0) / arr.length) : 0;
    return { month, label: MONTH_PL[i], avg_kWh };
  });

  return {
    nearest,
    wind: { years: windYears, avg_kWh: windAvg_kWh },
    pv: { years: pvYears, avg_pv_kWh: pvAvg_kWh, avg_heliostat_kWh: heliostatAvg_kWh },
    windrose,
    hist,     // ⬅️ miesięczne średnie dla wiatru
    histPV,   // ⬅️ miesięczne średnie dla PV (z *1.12)
  };
}


// ──────────────────────────────────────────────────────────────
// GET – żeby działało /api/stats/energy?lat=..&lon=..
// ──────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    const yearStart = Number(url.searchParams.get("yearStart") || 2015);
    const yearEnd = Number(url.searchParams.get("yearEnd") || 2024);
    const maxKm = Number(url.searchParams.get("maxKm") || 5);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: "lat/lon required" }, { status: 400 });
    }

    const result = await computeEnergyCore(lat, lon, yearStart, yearEnd, maxKm);
    if ("error" in result) {
      return NextResponse.json(result, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("stats/energy GET error", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}