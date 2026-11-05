import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(path.resolve(__dirname, '../../app/api/crm/clients/energy-account/route.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

function fixture(projectAllowed = true) {
  const accounts: any[] = [{ id: 'old-account', clientId: 'client', projectId: 'original', operator: 'ENEA', encryptedPassword: 'preserved' }];
  const prisma = {
    client: { findUnique: async () => ({ id: 'client' }) },
    project: { findFirst: async () => projectAllowed ? { id: 'new-project' } : null },
    energyPortalAccount: {
      findFirst: async ({ where }: any) => accounts.find(a => Object.entries(where).every(([k, v]) => a[k] === v)),
      create: async ({ data }: any) => { const a = { id: 'new-account', ...data }; accounts.push(a); return a; },
      update: async ({ where, data }: any) => { const a = accounts.find(a => a.id === where.id); Object.assign(a, data); return a; },
    },
  };
  const modules: Record<string, any> = {
    'lib/onrevolt/api': {
      readJsonObject: (req: Request) => req.json(), requireString: (b: any, k: string) => b[k],
      optionalString: (b: any, k: string) => b[k] || undefined,
      jsonResponse: (b: any) => Response.json(b), notFound: (error: string) => Response.json({ error }, { status: 404 }),
      serverError: (_msg: string, e: unknown) => { throw e; },
    },
    'lib/onrevolt/credentials': { encryptCredential: () => 'encrypted' },
    'lib/onrevolt/energy-tariffs': { isEnergyOperator: () => true },
    'lib/onrevolt/prisma': { prisma },
    'lib/onrevolt/staff-server': { authorizeStaffRequest: async () => ({ ok: true, user: { id: 'admin' } }) },
    'lib/onrevolt/offer-workspace-server': { offerWorkspaceProjectWhere: (id: string) => ({ id }) },
    'lib/onrevolt/project-analysis-measurements': {},
  };
  const exports: any = {};
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (!(name in modules)) throw new Error(name);
    return modules[name];
  } });
  return { accounts, run: (body: any = {}) => exports.POST(new Request('https://test/api', {
    method: 'POST', body: JSON.stringify({ clientId: 'client', projectId: 'new-project', operator: 'ENEA', ...body }),
  })) };
}

test('saving a new project does not move an existing client operator account', async () => {
  const f = fixture(); assert.equal((await f.run()).status, 200);
  assert.equal(f.accounts.length, 2);
  assert.equal(f.accounts[0].projectId, 'original'); assert.equal(f.accounts[0].encryptedPassword, 'preserved');
  assert.equal(f.accounts[1].projectId, 'new-project');
  await f.run({ tariff: 'G11' });
  assert.equal(f.accounts.length, 2); assert.equal(f.accounts[1].tariff, 'G11');
});

test('explicit account ID from another project is rejected without writes', async () => {
  const f = fixture(); assert.equal((await f.run({ id: 'old-account' })).status, 404);
  assert.equal(f.accounts.length, 1); assert.equal(f.accounts[0].projectId, 'original');
});

test('project ownership is checked before writing an account', async () => {
  const f = fixture(false); assert.equal((await f.run()).status, 404); assert.equal(f.accounts.length, 1);
});
