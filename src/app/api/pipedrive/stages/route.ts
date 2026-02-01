import { NextRequest, NextResponse } from 'next/server';
import { apis } from '../client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { stages } = apis();
    const url = new URL(req.url);
    const pipelineId = url.searchParams.get('pipeline_id');

    if (pipelineId) {
      const r = await stages.getStages({ pipelineId: Number(pipelineId) as any });
      return NextResponse.json(r?.data ?? []);
    }
    const r = await stages.getStages();
    return NextResponse.json(r?.data ?? []);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
