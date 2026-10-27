import assert from 'node:assert/strict';
import test from 'node:test';
import { SiteAuditDrafts } from './site-audit-drafts';

function fixture() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const posts: any[] = [];
  let records: any[] = [];
  let offline = false;
  let dropReply = false;
  let release: (() => void) | undefined;
  let delay = false;
  let failure = 0;
  let count = 0;
  const request = async (_url: any, options?: RequestInit) => {
    if (offline) throw new TypeError('offline');
    if (options?.method !== 'POST') return Response.json({ ok: true, data: records });
    const body = JSON.parse(String(options.body));
    posts.push(body);
    if (failure) return Response.json({ ok: false, error: 'Zmieniono na serwerze' }, { status: failure });
    const previous = records.find((record) => record.id === (body.id || `draft-${body.clientDraftId}`));
    const record = previous?.formData._autosaveMutationId === body.mutationId ? previous : {
      ...body, id: body.id || `draft-${body.clientDraftId}`, updatedAt: `version-${posts.length}`,
      formData: { ...body.formData, _autosaveMutationId: body.mutationId },
    };
    records = [record, ...records.filter((item) => item.id !== record.id)];
    if (delay) await new Promise<void>((resolve) => { release = resolve; });
    if (dropReply) { dropReply = false; throw new TypeError('Response lost'); }
    return Response.json({ ok: true, data: record });
  };
  const create = (key = 'user/project', project = 'project') => new SiteAuditDrafts(key, project, storage, request as typeof fetch, () => `uuid-${++count}`, 'user');
  return { create, posts, values, storage, setOffline: (value: boolean) => { offline = value; },
    loseReply: () => { dropReply = true; }, delay: () => { delay = true; }, release: () => { delay = false; release?.(); },
    fail: (code: number) => { failure = code; }, records: () => records };
}

test('each edit is durable before a network call and restores offline', async () => {
  const f = fixture(); const store = f.create();
  await store.load({ client_name: 'Żaneta' });
  store.edit({ formData: { client_name: 'Łódź — zapis', loads: [{ device: 'Piec' }] }, currentStep: 4, completedSteps: [1, 2] });
  assert.equal(f.posts.length, 0);
  f.setOffline(true);
  const restored = f.create(); restored.restore(); await restored.load({});
  assert.equal(restored.current?.record.formData.client_name, 'Łódź — zapis');
  assert.deepEqual(restored.current?.record.completedSteps, [1, 2]);
  assert.equal(restored.current?.dirty, true);
  assert.equal(restored.loaded, true);
});

test('lost response retry after reload uses identical mutation and creates only one audit', async () => {
  const f = fixture(); const store = f.create(); await store.load({ visit_date: '2026-10-27' });
  store.edit({ formData: { notes: 'pierwszy zapis' } }); f.loseReply();
  await assert.rejects(store.flush());
  store.edit({ formData: { notes: 'nowsza treść' } });
  const restored = f.create(); restored.restore(); await restored.load({});
  await restored.flush();
  assert.deepEqual(f.posts[0], f.posts[1]);
  assert.equal(restored.current?.record.formData.notes, 'nowsza treść');
  assert.equal(restored.current?.dirty, true);
  await restored.flush();
  assert.equal(f.records().length, 1);
  assert.equal(restored.current?.dirty, false);
  assert.equal(f.posts[2].expectedUpdatedAt, 'version-1');
});

test('typing during save is not replaced by the old response', async () => {
  const f = fixture(); const store = f.create(); await store.load({ notes: '' });
  store.edit({ formData: { notes: 'A' } }); f.delay();
  const saving = store.flush();
  store.edit({ formData: { notes: 'AB' } });
  f.release(); await saving;
  assert.equal(store.current?.record.formData.notes, 'AB');
  assert.equal(store.current?.dirty, true);
  await store.flush();
  assert.equal(f.records()[0].formData.notes, 'AB');
});

test('manual and automatic calls are serialized without duplicate creation', async () => {
  const f = fixture(); const store = f.create(); await store.load({}); store.edit({ currentStep: 2 });
  f.delay(); const first = store.flush(); const second = store.flush(); f.release();
  await Promise.all([first, second]); assert.equal(f.posts.length, 1);
});

test('server conflict preserves local draft and requires explicit resolution', async () => {
  const f = fixture(); const store = f.create(); await store.load({ notes: 'A' }); store.edit({ currentStep: 2 }); await store.flush();
  store.edit({ formData: { notes: 'local' } }); f.fail(409);
  await assert.rejects(store.flush());
  await store.load({});
  assert.equal(store.current?.record.formData.notes, 'local');
  store.edit({ currentStep: 3 }); await assert.rejects(store.flush(), /Konflikt/);
  assert.equal(f.posts.length, 2);
  await store.discardLocal(); assert.equal(store.current?.dirty, false);
  assert.equal(store.current?.record.formData.notes, 'A');
});

test('changing audit selection preserves independent offline drafts and late response stays in its audit', async () => {
  const f = fixture(); const store = f.create(); await store.load({ notes: 'first' });
  const key = store.selected; store.edit({ currentStep: 2 }); f.delay(); const saving = store.flush();
  store.create({ notes: 'second' }); store.edit({ currentStep: 3 });
  f.release(); await saving;
  assert.equal(store.current?.record.formData.notes, 'second');
  store.select(key); assert.equal(store.current?.record.formData.notes, 'first');
  const other = f.create('different-user/project'); other.restore(); assert.equal(other.drafts.length, 0);
  const otherProject = f.create('user/other', 'other'); otherProject.restore(); assert.equal(otherProject.drafts.length, 0);
});

test('storage quota failure is visible while the in-memory draft survives', async () => {
  const f = fixture(); const store = f.create(); await store.load({});
  f.storage.setItem = () => { throw new Error('quota'); };
  store.edit({ formData: { notes: 'do not lose' } });
  assert.match(store.storageError, /Nie można zachować/);
  assert.equal(store.current?.record.formData.notes, 'do not lose');
});

test('a GET started before a new save cannot remove the new audit', async () => {
  let resolveGet!: (response: Response) => void;
  let slow = false;
  const storage = { getItem: () => null, setItem: () => {} };
  const request = async (_url: any, options?: RequestInit) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(String(options.body));
      return Response.json({ ok: true, data: { ...body, id: `draft-${body.clientDraftId}`, updatedAt: '2026-10-27T12:00:00Z' } });
    }
    if (slow) return new Promise<Response>((resolve) => { resolveGet = resolve; });
    return Response.json({ ok: true, data: [] });
  };
  const store = new SiteAuditDrafts('key', 'project', storage, request as typeof fetch, () => crypto.randomUUID(), 'user');
  await store.load({});
  slow = true;
  const refresh = store.load({});
  store.edit({ formData: { notes: 'new' } }); await store.flush();
  resolveGet(Response.json({ ok: true, data: [] })); await refresh;
  assert.equal(store.drafts.length, 1);
  assert.equal(store.current?.record.formData.notes, 'new');
  assert.ok(store.current?.record.id);
});

test('rejected completion stays a draft and does not retry until edited', async () => {
  const f = fixture(); const store = f.create(); await store.load({});
  store.edit({ status: 'COMPLETED', completedSteps: [1, 2, 3, 4, 5, 6, 7] }); f.fail(400);
  await assert.rejects(store.flush());
  assert.equal(store.current?.record.status, 'DRAFT');
  assert.deepEqual(store.current?.record.completedSteps, [1, 2, 3, 4, 5, 6]);
  await assert.rejects(store.flush()); assert.equal(f.posts.length, 1);
});

test('closed store cannot overwrite the next lock owner through a late load', async () => {
  const f = fixture(); const old = f.create(); await old.load({ notes: 'old' }); old.close();
  const current = f.create(); current.restore(); current.edit({ formData: { notes: 'new offline data' } });
  await old.load({}); old.create({ notes: 'late' }); old.edit({ formData: { notes: 'late' } });
  const restored = f.create(); restored.restore();
  assert.equal(restored.current?.record.formData.notes, 'new offline data');
  assert.equal(restored.drafts.length, 1);
});
