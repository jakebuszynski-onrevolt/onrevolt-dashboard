import { NextRequest } from 'next/server';
import { jsonResponse, optionalString, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

export async function GET() {
  try {
    const documents = await prisma.document.findMany({
      include: { client: true, project: true },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return jsonResponse({ ok: true, data: documents });
  } catch (error) {
    return serverError('Nie udało się pobrać dokumentów', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    const document = await prisma.document.create({
      data: {
        type: requireString(body, 'type') as any,
        title: requireString(body, 'title'),
        fileName: requireString(body, 'fileName'),
        mimeType: optionalString(body, 'mimeType'),
        sizeBytes: Number.isInteger(Number(body.sizeBytes)) ? Number(body.sizeBytes) : undefined,
        sha256: optionalString(body, 'sha256'),
        storagePath: requireString(body, 'storagePath'),
        clientId: optionalString(body, 'clientId'),
        projectId: optionalString(body, 'projectId'),
        offerId: optionalString(body, 'offerId'),
        contractId: optionalString(body, 'contractId'),
        installationId: optionalString(body, 'installationId'),
        installedDeviceId: optionalString(body, 'installedDeviceId'),
        uploadedById: optionalString(body, 'uploadedById'),
        visibleToClient: Boolean(body.visibleToClient),
        notes: optionalString(body, 'notes'),
      },
    });
    return jsonResponse({ ok: true, data: document }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać dokumentu', error);
  }
}

