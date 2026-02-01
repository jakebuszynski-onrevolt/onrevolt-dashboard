import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DOMAIN = process.env.PIPEDRIVE_DOMAIN;
const BASE =
  process.env.PIPEDRIVE_BASE_URL ??
  (DOMAIN ? `https://${DOMAIN}.pipedrive.com/api/v1` : '');
const TOKEN = process.env.PIPEDRIVE_API_TOKEN || '';

type Entity = 'deal' | 'person';

type CopyBody = {
  entity: Entity;
  from_key: string;
  to_key: string;
  start?: number;
  limit?: number;
};

type PipedriveListResponse = {
  data: any[] | null;
  additional_data?: {
    pagination?: {
      more_items_in_collection?: boolean;
      next_start?: number;
    };
  };
};

function isEmptyValue(v: any): boolean {
  return (
    v === null ||
    v === undefined ||
    (typeof v === 'string' && v.trim() === '')
  );
}

export async function POST(req: NextRequest) {
  if (!TOKEN || !BASE) {
    return NextResponse.json(
      { error: 'Pipedrive config missing' },
      { status: 500 }
    );
  }

  let body: CopyBody;
  try {
    body = (await req.json()) as CopyBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const entity = body.entity || 'deal';
  const fromKey = body.from_key;
  const toKey = body.to_key;

  if (!fromKey || !toKey) {
    return NextResponse.json(
      { error: 'from_key and to_key are required' },
      { status: 400 }
    );
  }

  const start = body.start ?? 0;
  const LIMIT = Math.min(body.limit ?? 20, 50); // bardzo konserwatywnie

  const collection = entity === 'person' ? 'persons' : 'deals';

  const listUrl = `${BASE}/${collection}?api_token=${TOKEN}&start=${start}&limit=${LIMIT}`;

  const listRes = await fetch(listUrl, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!listRes.ok) {
    const txt = await listRes.text().catch(() => '');
    return NextResponse.json(
      {
        error: 'Pipedrive list error',
        status: listRes.status,
        details: txt,
      },
      { status: 500 }
    );
  }

  const json = (await listRes.json()) as PipedriveListResponse;
  const items: any[] = json?.data || [];
  const pagination = json?.additional_data?.pagination;

  if (!items.length) {
    return NextResponse.json({
      moved: 0,
      processed: 0,
      hasMore: pagination?.more_items_in_collection ?? false,
      nextStart: pagination?.next_start ?? null,
    });
  }

  let movedCount = 0;

  for (const item of items) {
    const id = item?.id;
    if (!id) continue;

    const src = item[fromKey];
    if (isEmptyValue(src)) continue; // stare puste

    const dest = item[toKey];
    if (!isEmptyValue(dest)) continue; // nowe już ma wartość

    const updateUrl = `${BASE}/${collection}/${id}?api_token=${TOKEN}`;
    const updateBody = { [toKey]: src };

    const updRes = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateBody),
    });

    if (updRes.ok) {
      movedCount++;
    } else {
      const txt = await updRes.text().catch(() => '');
      console.error(
        `Pipedrive update error for ${collection}/${id}:`,
        updRes.status,
        txt
      );
    }

    // malutkie opóźnienie, żeby „rozrzedzić” ruch i nie dobijać limitu
    await new Promise((r) => setTimeout(r, 50)); // 100 ms
  }

  return NextResponse.json({
    moved: movedCount,
    processed: items.length,
    hasMore: pagination?.more_items_in_collection ?? false,
    nextStart: pagination?.next_start ?? null,
  });
}
