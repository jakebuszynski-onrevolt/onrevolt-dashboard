import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, serverError, unauthorized } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';
import { getCurrentStaffUser, serializeStaffUser, staffUserInclude } from 'lib/onrevolt/staff-server';

export const runtime = 'nodejs';

const allowedMimeTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const maxUploadBytes = 5 * 1024 * 1024;

function sanitizeFileName(fileName: string) {
  return fileName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const currentUser = await getCurrentStaffUser(req);
    if (!currentUser) return unauthorized();
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return badRequest('Brak pliku avatara');
    if (file.size <= 0) return badRequest('Plik jest pusty');
    if (file.size > maxUploadBytes) return badRequest('Avatar przekracza limit 5 MB');
    const extension = allowedMimeTypes.get(file.type);
    if (!extension) return badRequest('Dozwolone są tylko obrazy JPG, PNG i WEBP');

    const originalName = sanitizeFileName(file.name || `avatar.${extension}`);
    const storedName = `${randomUUID()}-${originalName || `avatar.${extension}`}`;
    const relativeDir = path.join('uploads', 'staff', 'avatars', currentUser.id);
    const absoluteDir = path.join(process.cwd(), 'public', relativeDir);
    const absolutePath = path.join(absoluteDir, storedName);
    await fs.mkdir(absoluteDir, { recursive: true });
    await fs.writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

    const avatarUrl = `/${relativeDir.replace(/\\/g, '/')}/${encodeURIComponent(storedName)}`;
    const user = await prisma.staffUser.update({
      where: { id: currentUser.id },
      data: { avatarUrl },
      include: staffUserInclude,
    });
    return jsonResponse({ ok: true, data: serializeStaffUser(user), avatarUrl });
  } catch (error) {
    return serverError('Nie udało się zapisać avatara', error);
  }
}
