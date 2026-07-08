import { NextRequest } from 'next/server';
import { badRequest, jsonResponse, notFound, optionalString, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { encryptCredential } from 'lib/onrevolt/credentials';
import { prisma } from 'lib/onrevolt/prisma';

const energyOperators = new Set(['ENEA', 'PGE', 'TAURON', 'ENERGA', 'STOEN', 'INNY']);

function validateOperator(value: unknown) {
  if (value == null || value === '') return 'ENEA';
  if (typeof value !== 'string' || !energyOperators.has(value)) {
    throw new Error('Nieprawidłowy operator energii');
  }
  return value;
}

function accountSelect() {
  return {
    id: true,
    clientId: true,
    projectId: true,
    operator: true,
    login: true,
    encryptedPassword: true,
    ppeNumber: true,
    portalPpeId: true,
    meterNumber: true,
    notes: true,
    lastSyncAt: true,
    lastSyncStatus: true,
    lastSyncMessage: true,
    createdAt: true,
    updatedAt: true,
    measurementFiles: {
      include: { document: true },
      orderBy: [{ periodYear: 'desc' as const }, { periodMonth: 'desc' as const }, { kind: 'asc' as const }],
      take: 40,
    },
  };
}

function publicAccount(account: any) {
  const { encryptedPassword, ...rest } = account;
  return {
    ...rest,
    hasPassword: Boolean(encryptedPassword),
  };
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const clientId = url.searchParams.get('clientId');
    if (!clientId) return badRequest('Brak clientId');

    const accounts = await prisma.energyPortalAccount.findMany({
      where: { clientId },
      select: accountSelect(),
      orderBy: { updatedAt: 'desc' },
    });

    return jsonResponse({ ok: true, data: accounts.map(publicAccount) });
  } catch (error) {
    return serverError('Nie udało się pobrać kont operatorów', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    const clientId = requireString(body, 'clientId');
    const operator = validateOperator(body.operator);
    const projectId = optionalString(body, 'projectId');
    const id = optionalString(body, 'id');

    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!client) return notFound('Nie znaleziono klienta');

    const password = optionalString(body, 'password');
    const clearPassword = body.clearPassword === true;
    const data: any = {
      clientId,
      projectId,
      operator,
      login: optionalString(body, 'login'),
      ppeNumber: optionalString(body, 'ppeNumber'),
      portalPpeId: optionalString(body, 'portalPpeId'),
      meterNumber: optionalString(body, 'meterNumber'),
      notes: optionalString(body, 'notes'),
    };

    if (password) data.encryptedPassword = encryptCredential(password);
    if (clearPassword) data.encryptedPassword = null;

    const existing = id
      ? await prisma.energyPortalAccount.findUnique({ where: { id }, select: { id: true } })
      : await prisma.energyPortalAccount.findFirst({
        where: { clientId, operator: operator as any },
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
      });

    const account = existing
      ? await prisma.energyPortalAccount.update({
        where: { id: existing.id },
        data,
        select: accountSelect(),
      })
      : await prisma.energyPortalAccount.create({
        data,
        select: accountSelect(),
      });

    return jsonResponse({ ok: true, data: publicAccount(account) });
  } catch (error) {
    return serverError('Nie udało się zapisać konta operatora', error);
  }
}
