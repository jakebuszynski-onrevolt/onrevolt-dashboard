import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const filename = path.resolve(__dirname, '../../app/api/site-audits/route.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

type FixtureOptions = { denied?: boolean; createRace?: 'same' | 'different' };

function fixture(options: FixtureOptions = {}) {
  const records = new Map<string, any>();
  const logs: any[] = [];
  const energyUpserts: any[] = [];
  const updateManyCalls: any[] = [];
  const dbCalls = { projectReads: 0, auditReads: 0, writes: 0 };
  let sequence = 0;
  let now = Date.parse('2026-10-27T10:00:00.000Z');
  let raceHandled = false;
  const nextDate = () => new Date(++now);
  const copy = (value: any) => value == null ? value : structuredClone(value);

  const prisma: any = {
    project: {
      findUnique: async () => {
        dbCalls.projectReads += 1;
        return { id: 'project', clientId: 'client' };
      },
    },
    staffUser: {
      findFirst: async () => ({ id: 'auditor' }),
    },
    energyAudit: {
      upsert: async (input: unknown) => { energyUpserts.push(input); },
    },
    siteAudit: {
      findUnique: async ({ where }: any) => {
        dbCalls.auditReads += 1;
        return copy(records.get(where.id) || null);
      },
      create: async ({ data }: any) => {
        dbCalls.writes += 1;
        if (options.createRace && !raceHandled) {
          raceHandled = true;
          const formData = { ...data.formData };
          if (options.createRace === 'different') {
            formData._autosaveMutationId = '00000000-0000-4000-8000-000000000099';
          }
          const concurrent = {
            ...data,
            formData,
            id: data.id,
            createdAt: nextDate(),
            updatedAt: nextDate(),
          };
          records.set(data.id, concurrent);
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        const id = data.id || `generated-${++sequence}`;
        if (records.has(id)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        const saved = { ...data, id, createdAt: nextDate(), updatedAt: nextDate() };
        records.set(id, saved);
        return copy(saved);
      },
      update: async ({ where, data }: any) => {
        dbCalls.writes += 1;
        const current = records.get(where.id);
        const saved = { ...current, ...data, updatedAt: nextDate() };
        records.set(where.id, saved);
        return copy(saved);
      },
      updateMany: async ({ where, data }: any) => {
        dbCalls.writes += 1;
        updateManyCalls.push(copy({ where, data }));
        const current = records.get(where.id);
        if (!current || current.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
        records.set(where.id, { ...current, ...data, updatedAt: nextDate() });
        return { count: 1 };
      },
    },
    $transaction: async (callback: (tx: any) => unknown) => callback(prisma),
  };

  const modules: Record<string, unknown> = {
    '@prisma/client': {
      ConfigurationRoofType: { FLAT: 'FLAT' },
      SiteAuditStatus: { DRAFT: 'DRAFT', COMPLETED: 'COMPLETED' },
    },
    'lib/onrevolt/api': {
      forbidden: (error: string) => ({ status: 403, value: { ok: false, error } }),
      jsonResponse: (value: unknown, init?: { status?: number }) => ({ status: init?.status || 200, value }),
      readJsonObject: async (request: any) => {
        if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
          throw new Error('Oczekiwano obiektu JSON');
        }
        return request.body;
      },
      requireString: (body: any, key: string) => {
        if (typeof body[key] !== 'string' || !body[key].trim()) throw new Error(`Brak ${key}`);
        return body[key].trim();
      },
      serverError: (message: string, error: unknown) => ({
        status: 500,
        value: { ok: false, error: message, message: error instanceof Error ? error.message : String(error) },
      }),
    },
    'lib/onrevolt/audit': { writeAuditLog: async (entry: unknown) => { logs.push(entry); } },
    'lib/onrevolt/prisma': { prisma },
    'lib/onrevolt/staff-server': {
      authorizeStaffRequest: async () => options.denied
        ? { ok: false, response: { status: 403 } }
        : { ok: true, user: { id: 'staff' } },
      isAdminUser: () => true,
    },
    'lib/onrevolt/site-audit': {
      normalizeSiteAuditFormData: (value: Record<string, unknown>) => ({ ...value }),
      SITE_AUDIT_SCHEMA_VERSION: 1,
      siteAuditCompletionErrors: () => [],
    },
  };

  const exports: any = {};
  vm.runInNewContext(code, {
    exports,
    Buffer,
    require: (key: string) => {
      if (!(key in modules)) throw new Error(`Unexpected module: ${key}`);
      return modules[key];
    },
    console,
  });

  const request = (body: unknown) => ({ body });
  const resetDbCalls = () => {
    dbCalls.projectReads = 0;
    dbCalls.auditReads = 0;
    dbCalls.writes = 0;
  };
  return { exports, request, records, logs, energyUpserts, updateManyCalls, dbCalls, resetDbCalls };
}

const draftId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const mutationA = '550e8400-e29b-41d4-a716-446655440000';
const mutationB = '550e8400-e29b-41d4-a716-446655440001';

function draftBody(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'project',
    draftOwnerId: 'staff',
    clientDraftId: draftId,
    mutationId: mutationA,
    expectedUpdatedAt: null,
    formData: { client_name: 'Łódź' },
    ...overrides,
  };
}

test('new draft uses a deterministic ID and a repeated mutation returns the saved audit without side effects', async () => {
  const state = fixture();
  const body = draftBody({ formData: { client_name: 'Łódź', connection_power_kw: '12.5' } });
  const first = await state.exports.POST(state.request(body));
  assert.equal(first.status, 201);
  assert.equal(first.value.data.id, `draft-${draftId}`);
  assert.equal(first.value.data.formData._autosaveMutationId, mutationA);
  assert.equal(state.records.size, 1);
  assert.equal(state.logs.length, 1);
  assert.equal(state.energyUpserts.length, 1);
  assert.equal(state.energyUpserts[0].create.connectionPowerKw, 12.5);

  const retry = await state.exports.POST(state.request(body));
  assert.equal(retry.status, 200);
  assert.equal(retry.value.data.id, first.value.data.id);
  assert.equal(state.logs.length, 1);
  assert.equal(state.records.size, 1);
  assert.equal(state.energyUpserts.length, 1);
});

test('explicit missing audit ID returns 404 and never creates a replacement', async () => {
  const state = fixture();
  const result = await state.exports.POST(state.request(draftBody({ id: 'missing-audit' })));
  assert.equal(result.status, 404);
  assert.match(result.value.error, /Nie znaleziono wizji lokalnej/);
  assert.equal(state.records.size, 0);
});

test('draft owner mismatch or invalid owner is rejected before an idempotent replay reads or writes', async () => {
  const state = fixture();
  const body = draftBody();
  const saved = await state.exports.POST(state.request(body));
  assert.equal(saved.status, 201);
  state.resetDbCalls();

  const mismatch = await state.exports.POST(state.request({ ...body, draftOwnerId: 'another-user' }));
  assert.equal(mismatch.status, 403);
  assert.deepEqual(state.dbCalls, { projectReads: 0, auditReads: 0, writes: 0 });
  assert.equal(state.logs.length, 1);
  assert.equal(state.records.size, 1);

  const invalidType = await state.exports.POST(state.request({ ...body, draftOwnerId: 17 }));
  assert.equal(invalidType.status, 403);
  assert.deepEqual(state.dbCalls, { projectReads: 0, auditReads: 0, writes: 0 });

  const missingOwner = await state.exports.POST(state.request({ ...body, draftOwnerId: undefined }));
  assert.equal(missingOwner.status, 403);
  assert.deepEqual(state.dbCalls, { projectReads: 0, auditReads: 0, writes: 0 });
});

test('expectedUpdatedAt performs an atomic update and rejects a stale autosave', async () => {
  const state = fixture();
  const created = await state.exports.POST(state.request(draftBody()));
  const expected = created.value.data.updatedAt.toISOString();
  const updated = await state.exports.POST(state.request(draftBody({
    id: created.value.data.id,
    mutationId: mutationB,
    expectedUpdatedAt: expected,
    formData: { client_name: 'Nowa nazwa', connection_power_kw: '13' },
  })));
  assert.equal(updated.status, 200);
  assert.equal(state.updateManyCalls.length, 1);
  assert.equal(state.updateManyCalls[0].where.id, created.value.data.id);
  assert.equal(state.updateManyCalls[0].where.updatedAt.toISOString(), expected);
  assert.equal(updated.value.data.formData.client_name, 'Nowa nazwa');

  const stale = await state.exports.POST(state.request(draftBody({
    id: created.value.data.id,
    mutationId: '550e8400-e29b-41d4-a716-446655440002',
    expectedUpdatedAt: expected,
    formData: { client_name: 'Nadpisanie', connection_power_kw: '14' },
  })));
  assert.equal(stale.status, 409);
  assert.match(stale.value.error, /zmieniona w innej sesji/);
  assert.equal(state.records.get(created.value.data.id).formData.client_name, 'Nowa nazwa');
  assert.equal(state.logs.length, 2);
  assert.equal(state.energyUpserts.length, 1);
});

test('different mutation cannot reuse an existing deterministic draft with expectedUpdatedAt null', async () => {
  const state = fixture();
  await state.exports.POST(state.request(draftBody()));
  const result = await state.exports.POST(state.request(draftBody({
    mutationId: mutationB,
    formData: { client_name: 'Konkurencyjny zapis' },
  })));
  assert.equal(result.status, 409);
  assert.match(result.value.error, /Szkic istnieje już/);
  assert.equal(state.logs.length, 1);
  assert.equal(state.records.get(`draft-${draftId}`).formData.client_name, 'Łódź');
});

test('a concurrent create P2002 retries successfully only for the same mutation token', async () => {
  const sameMutation = fixture({ createRace: 'same' });
  const saved = await sameMutation.exports.POST(sameMutation.request(draftBody()));
  assert.equal(saved.status, 200);
  assert.equal(saved.value.data.id, `draft-${draftId}`);
  assert.equal(sameMutation.records.size, 1);
  assert.equal(sameMutation.logs.length, 0);

  const differentMutation = fixture({ createRace: 'different' });
  const conflict = await differentMutation.exports.POST(differentMutation.request(draftBody()));
  assert.equal(conflict.status, 409);
  assert.match(conflict.value.error, /zapisany w innej sesji/);
  assert.equal(differentMutation.logs.length, 0);
});

test('legacy existing-audit updates remain available without an expectedUpdatedAt field', async () => {
  const state = fixture();
  const created = await state.exports.POST(state.request(draftBody()));
  const updated = await state.exports.POST(state.request({
    id: created.value.data.id,
    projectId: 'project',
    formData: { client_name: 'Aktualizacja starego klienta' },
  }));
  assert.equal(updated.status, 200);
  assert.equal(updated.value.data.formData.client_name, 'Aktualizacja starego klienta');
  assert.equal(state.updateManyCalls.length, 0);
});

test('malformed requests and completion validation return 400 instead of a retryable server error', async () => {
  const invalidJson = fixture();
  assert.equal((await invalidJson.exports.POST(invalidJson.request(null))).status, 400);

  const missingProject = fixture();
  assert.equal((await missingProject.exports.POST(missingProject.request(draftBody({ projectId: '' })))).status, 400);

  const invalidForm = fixture();
  assert.equal((await invalidForm.exports.POST(invalidForm.request(draftBody({ formData: null })))).status, 400);

  const invalidVisitDate = fixture();
  assert.equal((await invalidVisitDate.exports.POST(invalidVisitDate.request(draftBody({ visitDate: 'not-a-date' })))).status, 400);

  const incomplete = fixture();
  const completion = await incomplete.exports.POST(incomplete.request(draftBody({
    status: 'COMPLETED',
    auditorId: 'auditor',
    completedSteps: [],
  })));
  assert.equal(completion.status, 400);
  assert.equal(incomplete.records.size, 0);
});
