import { NextRequest, NextResponse } from 'next/server';
import { parseOfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import {
  renderOfferWorkspaceDocument,
  type OfferWorkspaceDocumentData,
} from 'lib/onrevolt/offer-workspace-document';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const maxRequestBytes = 256 * 1024;

class RequestTooLargeError extends Error {}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNullableNumber(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isWorkspaceFixture(value: unknown): value is OfferWorkspaceDocumentData {
  if (!isRecord(value) || !isRecord(value.input) || !isRecord(value.measurements)) return false;
  if (typeof value.projectId !== 'string' || typeof value.clientId !== 'string' || typeof value.clientName !== 'string'
    || typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision)) return false;
  if (!Array.isArray(value.measurements.months) || !Array.isArray(value.templates)) return false;
  if (!value.measurements.months.every((month: unknown) => isRecord(month) && typeof month.period === 'string'
    && isNullableNumber(month.importKwh) && isNullableNumber(month.exportKwh))) return false;
  if (value.measurements.dayProfiles !== undefined && !Array.isArray(value.measurements.dayProfiles)) return false;
  if (!value.templates.every((template: unknown) => isRecord(template) && typeof template.id === 'string'
    && typeof template.name === 'string' && Array.isArray(template.items)
    && template.items.every((item: unknown) => isRecord(item) && Number.isFinite(item.quantity)))) return false;
  if (value.input.reportDetails !== undefined && value.input.reportDetails !== null && !isRecord(value.input.reportDetails)) return false;
  if (value.input.location !== undefined && value.input.location !== null && !isRecord(value.input.location)) return false;
  return true;
}

async function readBoundedJsonObject(req: NextRequest) {
  const reader = req.body?.getReader();
  if (!reader) throw new SyntaxError('Oczekiwano obiektu JSON.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxRequestBytes) {
      await reader.cancel();
      throw new RequestTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (!isRecord(body)) throw new SyntaxError('Oczekiwano obiektu JSON.');
  return body;
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') return new NextResponse(null, { status: 404 });
  try {
    const body = await readBoundedJsonObject(req);
    if (!isWorkspaceFixture(body.workspace)) return NextResponse.json({ ok: false, error: 'Nieprawidłowe workspace fixture.' }, { status: 400 });
    let draft;
    try {
      draft = parseOfferWorkspaceDraft(body.draft);
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
    const document = renderOfferWorkspaceDocument(body.workspace, draft, { templateKey: 'REFORM_B2C/2026_10_V4' });
    return NextResponse.json({ ok: true, document });
  } catch (error) {
    if (error instanceof RequestTooLargeError) return NextResponse.json({ ok: false, error: 'Żądanie przekracza limit 256 KiB.' }, { status: 413 });
    if (error instanceof SyntaxError) return NextResponse.json({ ok: false, error: 'Nieprawidłowy JSON.' }, { status: 400 });
    return NextResponse.json({ ok: false, error: 'Nie udało się wyrenderować fixture.' }, { status: 500 });
  }
}
