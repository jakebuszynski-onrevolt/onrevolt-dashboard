import { NextRequest } from 'next/server';
import { jsonResponse, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

function optionalNumber(value: unknown) {
  if (value == null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Nieprawidłowa wartość liczbowa: ${value}`);
  return number;
}

function optionalInt(value: unknown) {
  const number = optionalNumber(value);
  if (number == null) return undefined;
  if (!Number.isInteger(number)) throw new Error(`Nieprawidłowa liczba całkowita: ${value}`);
  return number;
}

function optionalString(value: unknown) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`Oczekiwano tekstu, otrzymano: ${typeof value}`);
  return value.trim();
}

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get('projectId');
    if (!projectId) throw new Error('Brak projectId');

    const assets = await prisma.projectExistingAsset.findMany({
      where: { projectId },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
    });

    return jsonResponse({ ok: true, data: assets });
  } catch (error) {
    return serverError('Nie udało się pobrać stanu obecnego projektu', error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    const projectId = requireString(body, 'projectId');
    const rawAssets = Array.isArray(body.assets) ? body.assets : [];

    const assets = await prisma.$transaction(async (tx) => {
      await tx.projectExistingAsset.deleteMany({ where: { projectId } });
      if (rawAssets.length > 0) {
        await tx.projectExistingAsset.createMany({
          data: rawAssets.map((asset, index) => ({
            projectId,
            productId: typeof asset.productId === 'string' && asset.productId ? asset.productId : undefined,
            kind: (typeof asset.kind === 'string' ? asset.kind : 'OTHER') as any,
            name: String(asset.name || `Sprzęt klienta ${index + 1}`),
            producer: optionalString(asset.producer),
            model: optionalString(asset.model),
            powerKw: optionalNumber(asset.powerKw),
            capacityKwh: optionalNumber(asset.capacityKwh),
            quantity: optionalNumber(asset.quantity),
            voltageKind: optionalString(asset.voltageKind),
            phaseCount: optionalInt(asset.phaseCount),
            parameters: asset.parameters && typeof asset.parameters === 'object' ? asset.parameters : undefined,
            verificationStatus: (typeof asset.verificationStatus === 'string' ? asset.verificationStatus : 'DECLARED') as any,
            compatibilityStatus: (typeof asset.compatibilityStatus === 'string' ? asset.compatibilityStatus : 'UNKNOWN') as any,
            notes: optionalString(asset.notes),
          })),
        });
      }

      return tx.projectExistingAsset.findMany({
        where: { projectId },
        orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
      });
    });

    return jsonResponse({ ok: true, data: assets });
  } catch (error) {
    return serverError('Nie udało się zapisać stanu obecnego projektu', error);
  }
}
