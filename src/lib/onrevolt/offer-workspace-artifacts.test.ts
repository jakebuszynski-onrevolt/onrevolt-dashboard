import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOfferWorkspaceArtifactStore,
  type OfferWorkspaceArtifactRepository,
} from './offer-workspace-artifacts';

function memoryRepository() {
  const rows = new Map<string, { id: string; projectId: string; kind: string; sourceKey: string; payload: Uint8Array }>();
  const repository: OfferWorkspaceArtifactRepository = {
    async findUnique({ where }) {
      const row = rows.get(where.id);
      return row ? { payload: row.payload } : null;
    },
    async upsert({ where, create, update }) {
      const existing = rows.get(where.id);
      rows.set(where.id, { ...(existing || create), payload: existing ? update.payload : create.payload });
    },
  };
  return { repository, rows };
}

test('canonical key pozwala odczytać JSON payload z gzip envelope', async () => {
  const { repository, rows } = memoryRepository();
  const store = createOfferWorkspaceArtifactStore(repository);
  const identity = {
    projectId: 'project-1', kind: 'measurements',
    key: { algorithmVersion: 'v1', periodKeys: ['2026-01'], source: { z: 2, a: 1 } },
  };
  const data = { schemaVersion: 1, measurements: { totalsImportKwh: 12.5 }, series: { intervals: [] } };

  await store.put(identity, data);
  const reorderedIdentity = {
    ...identity,
    key: { source: { a: 1, z: 2 }, periodKeys: ['2026-01'], algorithmVersion: 'v1' },
  };
  assert.deepEqual(await store.get(reorderedIdentity), data);
  assert.equal(rows.size, 1);
  const row = [...rows.values()][0];
  assert.equal(row.id.length, 64);
  assert.equal(row.sourceKey.length, 64);
  assert.equal(row.projectId, 'project-1');
  assert.equal(row.kind, 'measurements');
  const envelope = Buffer.from(row.payload);
  assert.equal(envelope.subarray(0, 4).toString('ascii'), 'OWA1');
});

test('projekt, rodzaj i algorytm wyznaczają odrębne klucze, a równoległy upsert jest idempotentny', async () => {
  const { repository, rows } = memoryRepository();
  const store = createOfferWorkspaceArtifactStore(repository);
  const identity = { projectId: 'project-1', kind: 'measurements', key: { algorithmVersion: 'v1' } };
  await Promise.all([store.put(identity, { result: 1 }), store.put(identity, { result: 1 })]);

  assert.equal(rows.size, 1);
  assert.deepEqual(await store.get(identity), { result: 1 });
  assert.equal(await store.get({ ...identity, projectId: 'project-2' }), null);
  assert.equal(await store.get({ ...identity, kind: 'dayProfiles' }), null);
  assert.equal(await store.get({ ...identity, key: { algorithmVersion: 'v2' } }), null);
});

test('wyścig MySQL P2002 akceptuje tylko identyczny artefakt zapisany pod tym samym kluczem', async () => {
  const { repository } = memoryRepository();
  const identity = { projectId: 'p', kind: 'energy', key: { version: 1 } };
  await createOfferWorkspaceArtifactStore(repository).put(identity, { result: 1 });
  const conflict = Object.assign(new Error('concurrent insert'), { code: 'P2002' });
  const racing = createOfferWorkspaceArtifactStore({ ...repository, upsert: async () => { throw conflict; } });
  await racing.put(identity, { result: 1 });
  await assert.rejects(racing.put(identity, { result: 2 }), error => error === conflict);
  await assert.rejects(racing.put({ ...identity, projectId: 'other' }, { result: 1 }), error => error === conflict);
});

test('równoczesny PDF z innym znacznikiem czasu zachowuje poprawny zapis zwycięzcy', async () => {
  const { repository } = memoryRepository();
  const identity = { projectId: 'p', kind: 'document-pdf', key: { pagesHash: 'same-pages' } };
  const stored = { base64: Buffer.from('%PDF first timestamp').toString('base64') };
  await createOfferWorkspaceArtifactStore(repository).put(identity, stored);
  const racing = createOfferWorkspaceArtifactStore({ ...repository, upsert: async () => {
    throw Object.assign(new Error('concurrent insert'), { code: 'P2002' });
  } });
  await racing.put(identity, { base64: Buffer.from('%PDF other timestamp').toString('base64') });
  assert.deepEqual(await racing.get(identity), stored);
});

test('cache odrzuca wartości spoza JSON i sprawdza integralność payloadu', async () => {
  const { repository, rows } = memoryRepository();
  const store = createOfferWorkspaceArtifactStore(repository);
  const identity = { projectId: 'project-1', kind: 'measurements', key: { algorithmVersion: 'v1' } };

  await assert.rejects(() => store.put(identity, { createdAt: new Date() }), /Date, Map/);
  await assert.rejects(() => store.put(identity, { values: new Map() }), /Date, Map/);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  await assert.rejects(() => store.put(identity, circular), /cycles/);

  await store.put(identity, { result: 'ok' });
  const [id, row] = [...rows.entries()][0];
  const corrupted = Buffer.from(row.payload);
  corrupted[corrupted.length - 1] ^= 0xff;
  rows.set(id, { ...row, payload: corrupted });
  await assert.rejects(() => store.get(identity));
});

test('awarie repo są przekazywane wywołującemu', async () => {
  const failure = new Error('database unavailable');
  const store = createOfferWorkspaceArtifactStore({
    findUnique: async () => { throw failure; },
    upsert: async () => { throw failure; },
  });
  const identity = { projectId: 'project-1', kind: 'measurements', key: { algorithmVersion: 'v1' } };

  await assert.rejects(store.get(identity), (error) => error === failure);
  await assert.rejects(store.put(identity, { result: 1 }), (error) => error === failure);
});
