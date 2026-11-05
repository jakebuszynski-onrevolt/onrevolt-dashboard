import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const routePath = path.resolve(__dirname, '../../app/api/activities/[id]/route.ts');
const routeCode = ts.transpileModule(readFileSync(routePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: routePath,
}).outputText;

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function fixture(options: {
  authorized?: boolean;
  permission?: boolean;
  activity?: any;
  clientNotes?: string | null;
  clientExists?: boolean;
  projectAccessible?: boolean;
  deleteCount?: number;
  clearCount?: number;
} = {}) {
  const state = {
    authorization: [] as unknown[],
    activity: options.activity === undefined
      ? { id: 'activity-1', type: 'NOTE', title: 'Notatka', body: 'Treść', clientId: 'client-1', projectId: null, occurredAt: new Date('2026-01-02T03:04:05.000Z') }
      : options.activity,
    clientNotes: options.clientNotes === undefined ? 'Stara notatka' : options.clientNotes,
    clientExists: options.clientExists !== false,
    projectAccessible: options.projectAccessible !== false,
    deleteCount: options.deleteCount ?? 1,
    clearCount: options.clearCount ?? 1,
    activityDeleteCalls: [] as unknown[],
    activityUpdateCalls: [] as any[],
    clientUpdateCalls: [] as unknown[],
    auditLogs: [] as any[],
    projectQueries: [] as unknown[],
    clientQueries: [] as unknown[],
    transactions: 0,
  };

  const tx = {
    activity: {
      findUnique: async () => state.activity ? { ...state.activity } : null,
      updateMany: async (args: any) => {
        state.activityUpdateCalls.push(args);
        if (state.clearCount === 1) state.activity = { ...state.activity, ...args.data };
        return { count: state.clearCount };
      },
      deleteMany: async (args: unknown) => {
        state.activityDeleteCalls.push(args);
        if (state.deleteCount === 1) state.activity = null;
        return { count: state.deleteCount };
      },
    },
    client: {
      findUnique: async (args: any) => {
        state.clientQueries.push(args);
        if (!state.clientExists) return null;
        if (args.select?.notes) return { id: args.where.id, notes: state.clientNotes };
        return { id: args.where.id };
      },
      updateMany: async (args: any) => {
        state.clientUpdateCalls.push(args);
        if (state.clearCount === 1 && state.clientNotes === args.where.notes) state.clientNotes = args.data.notes;
        return { count: state.clearCount };
      },
    },
    project: {
      findFirst: async (args: unknown) => {
        state.projectQueries.push(args);
        return state.projectAccessible ? { id: 'project-1' } : null;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        state.auditLogs.push(data);
        return data;
      },
    },
  };

  const prisma = {
    $transaction: async (callback: (transaction: typeof tx) => unknown) => {
      state.transactions++;
      return callback(tx);
    },
  };
  const modules: Record<string, unknown> = {
    'lib/onrevolt/api': {
      badRequest: (message: string) => Response.json({ ok: false, error: message }, { status: 400 }),
      jsonResponse: (value: unknown, init?: ResponseInit) => Response.json(value, init),
      notFound: (message: string) => Response.json({ ok: false, error: message }, { status: 404 }),
      readJsonObject: async (req: any) => {
        const value = await req.json();
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Oczekiwano obiektu JSON');
        return value;
      },
      serverError: (context: string) => Response.json({ ok: false, error: context }, { status: 500 }),
    },
    'lib/onrevolt/offer-workspace-server': {
      offerWorkspaceProjectWhere: (id: string, user: { id: string; systemRole: string }) => ({
        id,
        ...(user.systemRole === 'ADMIN' || user.systemRole === 'MODERATOR' ? {} : { ownerId: user.id }),
      }),
    },
    'lib/onrevolt/prisma': { prisma },
    'lib/onrevolt/staff-server': {
      authorizeStaffRequest: async (_req: unknown, permission: string) => {
        state.authorization.push(permission);
        if (options.authorized === false) return { ok: false, response: Response.json({ ok: false }, { status: 401 }) };
        if (options.permission === false) return { ok: false, response: Response.json({ ok: false }, { status: 403 }) };
        return { ok: true, user: { id: 'staff-1', systemRole: 'USER' } };
      },
    },
  };
  const exports: any = {};
  vm.runInNewContext(routeCode, {
    exports,
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected route import: ${name}`);
      return modules[name];
    },
    Response,
  });

  function request(options: { query?: Record<string, string>; body?: unknown } = {}) {
    const searchParams = new URLSearchParams(options.query);
    return {
      nextUrl: { searchParams },
      body: options.body === undefined ? null : {},
      json: async () => options.body,
    };
  }

  async function remove(id = 'activity-1', requestOptions: Parameters<typeof request>[0] = {}) {
    return exports.DELETE(request(requestOptions), { params: Promise.resolve({ id }) });
  }

  async function edit(id = 'activity-1', requestOptions: Parameters<typeof request>[0] = {}) {
    return exports.PATCH(request(requestOptions), { params: Promise.resolve({ id }) });
  }
  return { state, remove, edit };
}

const editRequest = { query: { clientId: 'client-1' }, body: { title: 'Nowy tytuł', body: 'Zażółć gęślą jaźń', expectedTitle: 'Notatka', expectedBody: 'Treść' } };
test('PATCH updates the same note with audit and preserves author/date/linkage', async () => {
  const f = fixture();
  const before = { ...f.state.activity };
  assert.equal((await f.edit('activity-1', editRequest)).status, 200);
  assert.deepEqual(plain(f.state.activityUpdateCalls[0].data), { title: 'Nowy tytuł', body: 'Zażółć gęślą jaźń' });
  assert.equal(f.state.activity.id, before.id);
  assert.equal(f.state.activity.occurredAt, before.occurredAt);
  assert.equal(f.state.auditLogs[0].action, 'UPDATE');
  assert.equal(f.state.activityDeleteCalls.length, 0);
});
test('PATCH requires authentication, crm.write, correct client and NOTE type', async () => {
  assert.equal((await fixture({ authorized: false }).edit('activity-1', editRequest)).status, 401);
  assert.equal((await fixture({ permission: false }).edit('activity-1', editRequest)).status, 403);
  assert.equal((await fixture().edit('activity-1', { ...editRequest, query: { clientId: 'other' } })).status, 404);
  assert.equal((await fixture({ activity: { type: 'CALL', clientId: 'client-1' } }).edit('activity-1', editRequest)).status, 400);
  assert.equal((await fixture({ activity: { type: 'NOTE', clientId: 'client-1', projectId: 'other' }, projectAccessible: false }).edit('activity-1', editRequest)).status, 404);
});
test('PATCH rejects empty text, stale data and concurrent update without audit', async () => {
  assert.equal((await fixture().edit('activity-1', { ...editRequest, body: { ...editRequest.body, body: '   ' } })).status, 400);
  for (const f of [fixture({ clearCount: 0 }), fixture({ activity: { id: 'activity-1', type: 'NOTE', clientId: 'client-1', title: 'Ktoś zmienił', body: 'Treść' } })]) {
    assert.equal((await f.edit('activity-1', editRequest)).status, 409);
    assert.equal(f.state.auditLogs.length, 0);
  }
});
test('PATCH edits legacy general note without creating an activity', async () => {
  const f = fixture();
  const request = { ...editRequest, body: { ...editRequest.body, expectedBody: 'Stara notatka' } };
  assert.equal((await f.edit('legacy-client-note', request)).status, 200);
  assert.equal(f.state.clientNotes, 'Zażółć gęślą jaźń');
  assert.equal(f.state.auditLogs[0].entityType, 'Client');
  assert.equal(f.state.activityUpdateCalls.length, 0);
  assert.equal((await f.edit('legacy-client-note', request)).status, 409);
});

test('DELETE requires authentication and crm.write', async () => {
  const unauthenticated = fixture({ authorized: false });
  assert.equal((await unauthenticated.remove()).status, 401);
  assert.deepEqual(unauthenticated.state.authorization, ['crm.write']);
  assert.equal(unauthenticated.state.transactions, 0);

  const forbidden = fixture({ permission: false });
  assert.equal((await forbidden.remove()).status, 403);
  assert.deepEqual(forbidden.state.authorization, ['crm.write']);
  assert.equal(forbidden.state.transactions, 0);
});

test('DELETE rejects missing or mismatched expectedClientId', async () => {
  const missing = fixture();
  assert.equal((await missing.remove()).status, 400);
  assert.equal(missing.state.transactions, 0);

  const wrongClient = fixture();
  const response = await wrongClient.remove('activity-1', { query: { expectedClientId: 'other-client' } });
  assert.equal(response.status, 404);
  assert.equal(wrongClient.state.activityDeleteCalls.length, 0);
});

test('DELETE rejects non-note activities and unknown ids', async () => {
  const nonNote = fixture({ activity: { id: 'activity-1', type: 'CALL', clientId: 'client-1', projectId: null } });
  assert.equal((await nonNote.remove('activity-1', { body: { expectedClientId: 'client-1' } })).status, 400);
  assert.equal(nonNote.state.activityDeleteCalls.length, 0);

  const missing = fixture({ activity: null });
  assert.equal((await missing.remove('missing', { body: { expectedClientId: 'client-1' } })).status, 404);
  assert.equal(missing.state.auditLogs.length, 0);
});

test('DELETE verifies the project belongs to the expected client', async () => {
  const scoped = fixture({
    activity: { id: 'activity-1', type: 'NOTE', clientId: 'client-1', projectId: 'project-1' },
    projectAccessible: false,
  });
  const response = await scoped.remove('activity-1', { body: { expectedClientId: 'client-1' } });
  assert.equal(response.status, 404);
  assert.deepEqual(plain(scoped.state.projectQueries), [{ where: { id: 'project-1', clientId: 'client-1' }, select: { id: true } }]);
  assert.equal(scoped.state.activityDeleteCalls.length, 0);
});

test('DELETE removes only a scoped NOTE and writes its before audit in the transaction', async () => {
  const scoped = fixture({
    activity: { id: 'activity-1', type: 'NOTE', title: 'Notatka', body: 'Treść', clientId: 'client-1', projectId: 'project-1', occurredAt: new Date('2026-01-02T03:04:05.000Z') },
  });
  const response = await scoped.remove('activity-1', {
    query: { clientId: 'client-1' },
    body: { expectedBody: 'Treść' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(plain(scoped.state.activityDeleteCalls), [{ where: { id: 'activity-1', type: 'NOTE', clientId: 'client-1', projectId: 'project-1' } }]);
  assert.equal(scoped.state.auditLogs.length, 1);
  assert.equal(scoped.state.auditLogs[0].action, 'DELETE');
  assert.equal(scoped.state.auditLogs[0].entityType, 'Activity');
  assert.equal(scoped.state.auditLogs[0].before.body, 'Treść');
  assert.equal(scoped.state.auditLogs[0].actorId, 'staff-1');
  assert.equal(scoped.state.transactions, 1);
});

test('DELETE supports the legacy client note with compare-and-clear and audit', async () => {
  const legacy = fixture();
  const response = await legacy.remove('legacy-client-note', {
    query: { clientId: 'client-1' },
    body: { expectedBody: 'Stara notatka' },
  });
  assert.equal(response.status, 200);
  assert.equal(legacy.state.clientNotes, null);
  assert.deepEqual(plain(legacy.state.clientUpdateCalls), [{
    where: { id: 'client-1', notes: 'Stara notatka' },
    data: { notes: null },
  }]);
  assert.equal(legacy.state.auditLogs.length, 1);
  assert.equal(legacy.state.auditLogs[0].entityType, 'Client');
  assert.equal(legacy.state.auditLogs[0].action, 'UPDATE');
  assert.equal(legacy.state.auditLogs[0].before.notes, 'Stara notatka');
  assert.deepEqual(plain(legacy.state.auditLogs[0].after), { id: 'client-1', notes: null });
});

test('legacy client note deletion returns 409 without overwriting a changed note', async () => {
  const changed = fixture({ clientNotes: 'Nowa treść' });
  const response = await changed.remove('legacy-client-note', {
    query: { clientId: 'client-1' },
    body: { expectedBody: 'Stara notatka' },
  });
  assert.equal(response.status, 409);
  assert.equal(changed.state.clientNotes, 'Nowa treść');
  assert.equal(changed.state.clientUpdateCalls.length, 0);
  assert.equal(changed.state.auditLogs.length, 0);
});

test('legacy client note deletion requires a client that exists', async () => {
  const missing = fixture({ clientExists: false });
  const response = await missing.remove('legacy-client-note', {
    query: { clientId: 'missing-client' },
    body: { expectedBody: 'Stara notatka' },
  });
  assert.equal(response.status, 404);
  assert.equal(missing.state.clientUpdateCalls.length, 0);
  assert.equal(missing.state.auditLogs.length, 0);
});

test('legacy compare-and-clear race returns 409 and does not audit', async () => {
  const changedDuringUpdate = fixture({ clearCount: 0 });
  const response = await changedDuringUpdate.remove('legacy-client-note', {
    query: { clientId: 'client-1' },
    body: { expectedBody: 'Stara notatka' },
  });
  assert.equal(response.status, 409);
  assert.equal(changedDuringUpdate.state.auditLogs.length, 0);
});
