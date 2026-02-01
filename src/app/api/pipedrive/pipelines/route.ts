import { NextResponse } from 'next/server';
import { apis } from '../client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { pipelines } = apis();
    const r = await pipelines.getPipelines({ limit: 200 });
    return NextResponse.json(r?.data ?? []);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
