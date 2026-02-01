import { NextRequest, NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { createPool, Pool } from "mysql2/promise";

export const dynamic = "force-dynamic";

// ───────────────── DB (data_stats) ─────────────────
let statsPool: Pool | null = null;
function getStatsPool() {
  if (!statsPool) {
    statsPool = createPool({
      host: process.env.DATA_STATS_HOST || "localhost",
      port: Number(process.env.DATA_STATS_PORT || 3306),
      user: process.env.DATA_STATS_USER || "datbuser27",
      password: process.env.DATA_STATS_PASS || "3!mOn47D74b",
      database: process.env.DATA_STATS_DB || "data_stats",
      connectionLimit: 5,
      supportBigNumbers: true,
      decimalNumbers: true,
      timezone: "Z",
    });
  }
  return statsPool;
}

// ───────────────── Helpers ─────────────────
function num(x: any, def: number) {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
}

// GET /api/stats/windrose?lat=..&lon=..[&year=2024]
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get("lat"));
    const lon = Number(searchParams.get("lon"));
    const year = num(searchParams.get("year"), 2024);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: "Brak/niepoprawne lat/lon" }, { status: 400 });
    }

    const pool = getStatsPool();

    // 1) Najbliższy punkt z tabeli `maps` (Haversine)
    const [nearest] = await pool.query<RowDataPacket[]>(
      `
      SELECT id, lat, lon,
             (6371 * ACOS(
               COS(RADIANS(?)) * COS(RADIANS(lat)) * COS(RADIANS(lon) - RADIANS(?)) +
               SIN(RADIANS(?)) * SIN(RADIANS(lat))
             )) AS distance
      FROM maps
      ORDER BY distance ASC
      LIMIT 1
      `,
      [lat, lon, lat]
    );

    if (!nearest.length) {
      return NextResponse.json({ error: "Nie znaleziono punktu w maps." }, { status: 404 });
    }

    const { id, distance } = nearest[0] as { id: number; distance: number };
    if (!Number.isFinite(distance) || distance > 3) {
      return NextResponse.json({ error: "Brak danych pogodowych w wybranym miejscu ( >3 km )." }, { status: 404 });
    }

    // 2) Róża wiatrów z tabeli `weather`
    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT 
        ROUND(wind_direction_10m / 22.5) * 22.5 AS sector,
        COUNT(*)                              AS cnt,
        SUM(wind_speed_10m)                   AS sum_speed,
        AVG(wind_speed_10m)                   AS avg_speed
      FROM weather
      WHERE parent_id = ? AND YEAR(time) = ?
      GROUP BY sector
      ORDER BY sector
      `,
      [id, year]
    );

    const data = rows.map((r) => ({
      sector: Number(r.sector),
      cnt: Number(r.cnt),
      sum_speed: Number(r.sum_speed),
      avg_speed: Number(r.avg_speed),
    }));

    return NextResponse.json({
      parent_id: id,
      year,
      data,
    });
  } catch (e: any) {
    console.error("windrose error:", e);
    return NextResponse.json({ error: "Server error", detail: String(e?.message || e) }, { status: 500 });
  }
}
