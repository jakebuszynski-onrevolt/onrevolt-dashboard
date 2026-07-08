import { createHash, randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { NextRequest } from 'next/server';
import { jsonResponse, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

export async function POST(req: NextRequest) {
  try {
    const uploadDir = process.env.ONREVOLT_UPLOAD_DIR;
    if (!uploadDir) throw new Error('Missing ONREVOLT_UPLOAD_DIR');

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('Brak pliku w polu file');

    const type = String(form.get('type') || '').trim();
    const title = String(form.get('title') || '').trim();
    if (!type || !title) throw new Error('Upload wymaga pól type i title');

    const bytes = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const month = new Date().toISOString().slice(0, 7);
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, '_');
    const relativePath = path.join(type.toLowerCase(), month, `${randomUUID()}-${safeName}`);
    const absolutePath = path.join(uploadDir, relativePath);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);

    const document = await prisma.document.create({
      data: {
        type: type as any,
        title,
        fileName: file.name,
        mimeType: file.type || undefined,
        sizeBytes: bytes.length,
        sha256,
        storagePath: relativePath,
        clientId: String(form.get('clientId') || '') || undefined,
        projectId: String(form.get('projectId') || '') || undefined,
        offerId: String(form.get('offerId') || '') || undefined,
        contractId: String(form.get('contractId') || '') || undefined,
        installationId: String(form.get('installationId') || '') || undefined,
        installedDeviceId: String(form.get('installedDeviceId') || '') || undefined,
        uploadedById: String(form.get('uploadedById') || '') || undefined,
        visibleToClient: String(form.get('visibleToClient') || '') === 'true',
        notes: String(form.get('notes') || '') || undefined,
      },
    });

    return jsonResponse({ ok: true, data: document }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się wysłać dokumentu', error);
  }
}

