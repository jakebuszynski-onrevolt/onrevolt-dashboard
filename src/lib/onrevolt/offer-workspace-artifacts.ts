import { createHash, timingSafeEqual } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { prisma } from './prisma';

const envelopeMagic = Buffer.from('OWA1', 'ascii');
const envelopeHeaderBytes = 4 + 4 + 32;
export const MAX_OFFER_WORKSPACE_ARTIFACT_BYTES = 64 * 1024 * 1024;

export type OfferWorkspaceArtifactIdentity = {
  projectId: string;
  kind: string;
  key: unknown;
};

type OfferWorkspaceArtifactRow = {
  id: string;
  projectId: string;
  kind: string;
  sourceKey: string;
  payload: Uint8Array;
};

export type OfferWorkspaceArtifactRepository = {
  findUnique(args: { where: { id: string }; select: { payload: true } }): Promise<Pick<OfferWorkspaceArtifactRow, 'payload'> | null>;
  upsert(args: {
    where: { id: string };
    create: OfferWorkspaceArtifactRow;
    update: { payload: Uint8Array };
  }): Promise<unknown>;
};

function assertJsonValue(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Offer workspace artifact JSON cannot contain non-finite numbers');
    return;
  }
  if (typeof value !== 'object') throw new TypeError('Offer workspace artifact must contain JSON values only');
  if (ancestors.has(value)) throw new TypeError('Offer workspace artifact JSON cannot contain cycles');
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype) throw new TypeError('Offer workspace artifact arrays must be plain arrays');
    ancestors.add(value);
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new TypeError('Offer workspace artifact JSON cannot contain sparse arrays');
      assertJsonValue(value[index], ancestors);
    }
    ancestors.delete(value);
    return;
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Offer workspace artifact JSON cannot contain Date, Map, or class instances');
  }
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError('Offer workspace artifact JSON cannot contain symbol keys');
  ancestors.add(value);
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw new TypeError('Offer workspace artifact JSON cannot contain accessors');
    assertJsonValue(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

function canonicalJson(value: unknown): string {
  assertJsonValue(value);
  const encode = (current: unknown): string => {
    if (Array.isArray(current)) return `[${current.map(encode).join(',')}]`;
    if (current && typeof current === 'object') {
      const object = current as Record<string, unknown>;
      return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${encode(object[key])}`).join(',')}}`;
    }
    const serialized = JSON.stringify(current);
    if (serialized === undefined) throw new TypeError('Offer workspace artifact key must contain JSON values only');
    return serialized;
  };
  return encode(value);
}

function sha256(value: Uint8Array | string): Buffer {
  return createHash('sha256').update(value).digest();
}

function identityHashes(identity: OfferWorkspaceArtifactIdentity) {
  if (!identity.projectId || typeof identity.projectId !== 'string') throw new TypeError('Offer workspace artifact requires a projectId');
  if (!identity.kind || typeof identity.kind !== 'string' || identity.kind.length > 32) {
    throw new TypeError('Offer workspace artifact kind must contain 1 to 32 characters');
  }
  const keyJson = canonicalJson(identity.key);
  const sourceKey = sha256(keyJson).toString('hex');
  const id = sha256(canonicalJson({ projectId: identity.projectId, kind: identity.kind, sourceKey })).toString('hex');
  return { id, sourceKey };
}

function encodeArtifact(data: unknown): Buffer {
  if (data === null) throw new TypeError('Offer workspace artifact data cannot be null');
  assertJsonValue(data);
  const json = JSON.stringify(data);
  if (json === undefined) throw new TypeError('Offer workspace artifact data is not JSON serializable');
  const raw = Buffer.from(json, 'utf8');
  if (raw.length > MAX_OFFER_WORKSPACE_ARTIFACT_BYTES) throw new RangeError('Offer workspace artifact exceeds the 64 MiB uncompressed limit');
  const compressed = gzipSync(raw);
  const envelopeLength = envelopeHeaderBytes + compressed.length;
  if (envelopeLength > MAX_OFFER_WORKSPACE_ARTIFACT_BYTES) throw new RangeError('Offer workspace artifact exceeds the 64 MiB stored limit');
  const envelope = Buffer.allocUnsafe(envelopeLength);
  envelopeMagic.copy(envelope, 0);
  envelope.writeUInt32BE(raw.length, 4);
  sha256(raw).copy(envelope, 8);
  compressed.copy(envelope, envelopeHeaderBytes);
  return envelope;
}

function decodeArtifact<T>(payload: Uint8Array): T {
  const envelope = Buffer.from(payload);
  if (envelope.length < envelopeHeaderBytes || envelope.length > MAX_OFFER_WORKSPACE_ARTIFACT_BYTES) {
    throw new Error('Invalid offer workspace artifact envelope length');
  }
  if (!envelope.subarray(0, envelopeMagic.length).equals(envelopeMagic)) throw new Error('Invalid offer workspace artifact envelope version');
  const expectedLength = envelope.readUInt32BE(4);
  if (expectedLength > MAX_OFFER_WORKSPACE_ARTIFACT_BYTES) throw new Error('Offer workspace artifact exceeds the 64 MiB uncompressed limit');
  const raw = gunzipSync(envelope.subarray(envelopeHeaderBytes), { maxOutputLength: MAX_OFFER_WORKSPACE_ARTIFACT_BYTES });
  if (raw.length !== expectedLength) throw new Error('Offer workspace artifact length integrity check failed');
  const expectedDigest = envelope.subarray(8, envelopeHeaderBytes);
  const actualDigest = sha256(raw);
  if (!timingSafeEqual(expectedDigest, actualDigest)) throw new Error('Offer workspace artifact SHA-256 integrity check failed');
  const parsed: unknown = JSON.parse(raw.toString('utf8'));
  assertJsonValue(parsed);
  return parsed as T;
}

export function createOfferWorkspaceArtifactStore(repository: OfferWorkspaceArtifactRepository) {
  return {
    async get<T>(identity: OfferWorkspaceArtifactIdentity): Promise<T | null> {
      const { id } = identityHashes(identity);
      const row = await repository.findUnique({ where: { id }, select: { payload: true } });
      return row ? decodeArtifact<T>(row.payload) : null;
    },
    async put(identity: OfferWorkspaceArtifactIdentity, data: unknown): Promise<void> {
      const { id, sourceKey } = identityHashes(identity);
      const payload = encodeArtifact(data);
      try {
        await repository.upsert({
          where: { id },
          create: { id, projectId: identity.projectId, kind: identity.kind, sourceKey, payload },
          update: { payload },
        });
      } catch (error) {
        // MySQL Prisma upserts can race on the first insert. Accept only the
        // identical artifact written concurrently, not another database error.
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') throw error;
        const winner = await repository.findUnique({ where: { id }, select: { payload: true } });
        if (!winner) throw error;
        const winnerData = decodeArtifact(winner.payload);
        // PDF metadata timestamps and live map image bytes may differ between
        // concurrent producers of the same immutable source identity.
        if (!['document-pdf', 'document-map'].includes(identity.kind)
          && canonicalJson(winnerData) !== canonicalJson(data)) throw error;
      }
    },
  };
}

function prismaArtifactRepository(): OfferWorkspaceArtifactRepository {
  const model = (prisma as unknown as { offerWorkspaceArtifact?: OfferWorkspaceArtifactRepository }).offerWorkspaceArtifact;
  if (!model) throw new Error('OfferWorkspaceArtifact Prisma model is unavailable; regenerate the Prisma client');
  return model;
}

export async function getOfferWorkspaceArtifact<T>(identity: OfferWorkspaceArtifactIdentity): Promise<T | null> {
  return createOfferWorkspaceArtifactStore(prismaArtifactRepository()).get<T>(identity);
}

export async function putOfferWorkspaceArtifact(identity: OfferWorkspaceArtifactIdentity, data: unknown): Promise<void> {
  await createOfferWorkspaceArtifactStore(prismaArtifactRepository()).put(identity, data);
}
