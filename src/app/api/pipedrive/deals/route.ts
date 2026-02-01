import { NextResponse } from 'next/server';
import { apis } from '../client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { deals } = apis();
    const LIMIT = 500;        // max na request wg Pipedrive
    let start = 0;
    const all: any[] = [];

    for (;;) {
      const r = await deals.getDeals({ limit: LIMIT, start, count_total: 1 });
      const items = r?.data ?? [];
      all.push(...items);

      const more = r?.additional_data?.pagination?.more_items_in_collection;
      if (!more) break;
      start = r?.additional_data?.pagination?.next_start ?? (start + LIMIT);
    }

    return NextResponse.json(all);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
