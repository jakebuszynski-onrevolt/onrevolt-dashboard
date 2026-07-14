import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

const hiddenKeys = /password|secret|token|cookie|authorization|session/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return redact((value as { toJSON: () => unknown }).toJSON());
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      hiddenKeys.test(key) && item ? '[UKRYTO]' : redact(item),
    ]),
  );
}

function jsonValue(value: unknown) {
  if (value == null) return undefined;
  return redact(value) as Prisma.InputJsonValue;
}

export async function writeAuditLog(input: {
  actorId?: string | null;
  clientId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}) {
  return prisma.auditLog.create({
    data: {
      actorId: input.actorId || undefined,
      clientId: input.clientId || undefined,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      before: jsonValue(input.before),
      after: jsonValue(input.after),
    },
  });
}
