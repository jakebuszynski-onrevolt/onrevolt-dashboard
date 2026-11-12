import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

type MockModules = Record<string, unknown>;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

function loadRoute(relativePath: string, modules: MockModules, globals: Record<string, unknown> = {}) {
  const filename = path.resolve(__dirname, `../../app/api/${relativePath}`);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: filename,
  }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(code, {
    exports,
    Buffer,
    console,
    require: (key: string) => {
      if (!(key in modules)) throw new Error(`Unexpected module: ${key}`);
      return modules[key];
    },
    ...globals,
  });
  return exports;
}

function responseModules(user: any, requireProject: (user: any, projectId: string) => Promise<void>) {
  return {
    'lib/onrevolt/api': {
      jsonResponse: (value: unknown, init?: { status?: number }) => ({ status: init?.status || 200, value }),
      notFound: (message: string) => ({ status: 404, value: { ok: false, error: message } }),
      forbidden: (message: string) => ({ status: 403, value: { ok: false, error: message } }),
      badRequest: (message: string) => ({ status: 400, value: { ok: false, error: message } }),
      optionalString: (body: any, key: string) => body[key] || undefined,
      parseDate: () => null,
      readJsonObject: async (req: any) => req.body,
      requireString: (body: any, key: string) => body[key],
      serverError: (message: string, error: unknown) => ({
        status: 500,
        value: { ok: false, error: message, message: error instanceof Error ? error.message : String(error) },
      }),
    },
    'lib/onrevolt/staff-server': {
      authorizeSiteVisitRequest: async () => ({ ok: true, user }),
      isSiteVisitOnlyUser: (value: any) => Boolean(value?.restricted),
      serializeStaffUser: (value: any) => ({ id: value.id, name: value.name, permissions: ['site-visits.access'] }),
      staffAuthorizationResponse: (error: any) => error?.status
        ? { status: error.status, value: { ok: false, error: error.message } }
        : null,
    },
    'lib/onrevolt/site-visit-access': {
      SITE_VISIT_STAGE_CODE: 'CRM_WIZJA_LOKALNA',
      requireSiteVisitProject: requireProject,
    },
    'lib/onrevolt/invoice-recognition/consumption': { invoiceImportField: () => 'totalAfterBalancingKwh' },
  };
}

function request(search = '') {
  return { nextUrl: new URL(`https://crm.example/api/site-visits${search}`) };
}

const restrictedUser = { id: 'staff-1', name: 'Wizjoner', restricted: true };

test('site visit list is stage-filtered, allowlisted, and uncapped', async () => {
  let query: any;
  const route = loadRoute('site-visits/route.ts', {
    ...responseModules(restrictedUser, async (_user, projectId) => assert.equal(projectId, 'project-1')),
    'lib/onrevolt/prisma': {
      prisma: {
        project: { findMany: async (args: unknown) => {
          query = args;
          return [{
            id: 'project-1', title: 'Wizja', clientId: 'client-1',
            client: { id: 'client-1', displayName: 'Klient', clientType: 'B2C', contacts: [] },
            investmentSite: null, locationAddress: 'Łódź',
          }];
        } },
      },
    },
  });

  const result = await route.GET(request('?q=%C5%81%C3%B3d%C5%BA'));
  assert.equal(result.status, 200);
  assert.deepEqual(plain(result.value.data.stage), { name: 'Wizja Lokalna' });
  assert.equal(result.value.data.projects[0].locationAddress, 'Łódź');
  assert.deepEqual(plain(query.where.stage), { is: { code: 'CRM_WIZJA_LOKALNA', isActive: true } });
  assert.equal(query.take, undefined);
  assert.match(JSON.stringify(query.where.OR), /Łódź/);
  assert.equal(query.select.client.select.taxId, undefined);
  assert.equal(query.select.notes, undefined);
});

test('site visit detail includes only matching projects, current staff user, and safe configuration fields', async () => {
  const projectReads: any[] = [];
  const scopedIds = ['project-1', 'project-2'];
  const projects = scopedIds.map((id) => ({
    id, title: id, clientId: 'client-1', clientType: 'B2C', locationAddress: null,
    investmentSite: null, energyAudits: [], existingAssets: [],
  }));
  let read = 0;
  let staffReads = 0;
  let configurationQuery: any;
  const route = loadRoute('site-visits/route.ts', {
    ...responseModules(restrictedUser, async (_user, projectId) => {
      assert.ok(scopedIds.includes(projectId));
    }),
    'lib/onrevolt/prisma': {
      prisma: {
        project: { findMany: async (args: unknown) => {
          projectReads.push(args);
          return read++ === 0 ? scopedIds.map((id) => ({ id })) : projects;
        } },
        client: { findUnique: async () => ({ id: 'client-1', displayName: 'Klient', clientType: 'B2C', contacts: [] }) },
        staffUser: { findMany: async () => { staffReads++; return []; } },
        configuration: { findMany: async (args: unknown) => {
          configurationQuery = args;
          return [{ id: 'config-1', name: 'PV', kind: 'PV' }];
        } },
      },
    },
  });

  const result = await route.GET(request('?clientId=client-1'));
  assert.equal(result.status, 200);
  assert.deepEqual(plain(result.value.data.client.projects), [{ id: 'project-1', title: 'project-1' }, { id: 'project-2', title: 'project-2' }]);
  assert.deepEqual(plain(result.value.data.staffUsers), [{ id: 'staff-1', name: 'Wizjoner' }]);
  assert.equal(staffReads, 0);
  assert.deepEqual(plain(configurationQuery.select), { id: true, name: true, kind: true, projectId: true });
  assert.equal(configurationQuery.where.project.is.stage.is.code, 'CRM_WIZJA_LOKALNA');
  assert.equal(projectReads[1].select.energyAudits.select.annualConsumptionKwh, undefined);
  assert.equal(projectReads[1].select.existingAssets.select.parameters, undefined);
});

test('stage change between list read and scope check rejects before returning projects', async () => {
  const route = loadRoute('site-visits/route.ts', {
    ...responseModules(restrictedUser, async (_user, projectId) => {
      if (projectId === 'moved-project') throw Object.assign(new Error('Projekt nie jest na etapie Wizja Lokalna'), { status: 403 });
    }),
    'lib/onrevolt/prisma': {
      prisma: { project: { findMany: async () => [{ id: 'moved-project' }] } },
    },
  });

  const result = await route.GET(request());
  assert.equal(result.status, 403);
  assert.equal(result.value.error, 'Projekt nie jest na etapie Wizja Lokalna');
});

test('file download rejects a foreign audit before reading file bytes', async () => {
  let documentReads = 0;
  let byteReads = 0;
  class MockNextResponse {
    static json(value: unknown, init?: { status?: number }) { return { status: init?.status || 200, value }; }
    constructor(public body: unknown, public init?: unknown) {}
  }
  const route = loadRoute('documents/[id]/file/route.ts', {
    ...responseModules(restrictedUser, async (_user, projectId) => {
      assert.equal(projectId, 'foreign-project');
      throw Object.assign(new Error('Projekt nie jest na etapie Wizja Lokalna'), { status: 403 });
    }),
    'lib/onrevolt/prisma': {
      prisma: { document: { findUnique: async () => {
        documentReads++;
        return { id: 'doc-1', type: 'INNE', siteAuditId: 'audit-1', siteAudit: { projectId: 'foreign-project' } };
      } } },
    },
    'next/server': { NextResponse: MockNextResponse },
    'fs/promises': { readFile: async () => { byteReads++; return Buffer.from('secret'); } },
    path: { resolve: (...parts: string[]) => parts.join('/'), sep: '/' },
    process: { env: { ONREVOLT_UPLOAD_DIR: '/uploads' } },
  });

  const result = await route.GET({ nextUrl: new URL('https://crm.example/api/documents/doc-1/file') }, { params: Promise.resolve({ id: 'doc-1' }) });
  assert.equal(result.status, 403);
  assert.equal(documentReads, 1);
  assert.equal(byteReads, 0);
});

test('document delete rejects an out-of-stage audit before mutation or unlink', async () => {
  let documentReads = 0;
  let transactions = 0;
  let unlinks = 0;
  const route = loadRoute('documents/route.ts', {
    ...responseModules(restrictedUser, async (_user, projectId) => {
      assert.equal(projectId, 'foreign-project');
      throw Object.assign(new Error('Projekt nie jest na etapie Wizja Lokalna'), { status: 403 });
    }),
    'lib/onrevolt/prisma': {
      prisma: {
        document: { findUnique: async () => {
          documentReads++;
          return documentReads === 1
            ? { id: 'doc-1', type: 'INNE', clientId: 'client-1', siteAuditId: 'audit-1', siteAudit: { projectId: 'foreign-project' } }
            : { id: 'doc-1', storagePath: 'audit/photo.jpg' };
        } },
        $transaction: async (callback: (tx: any) => unknown) => { transactions++; return callback({ document: { delete: async () => undefined } }); },
      },
    },
    'lib/onrevolt/audit': { writeAuditLog: async () => undefined },
    path: { resolve: (...parts: string[]) => parts.join('/'), sep: '/' },
    'fs/promises': { unlink: async () => { unlinks++; } },
    process: { env: { ONREVOLT_UPLOAD_DIR: '/uploads' } },
  });

  const result = await route.DELETE({ body: { id: 'doc-1' } });
  assert.equal(result.status, 403);
  assert.equal(documentReads, 1);
  assert.equal(transactions, 0);
  assert.equal(unlinks, 0);
});

test('restricted upload checks the audit stage before reading the uploaded file', async () => {
  let fileBytesRead = 0;
  let uploadWrites = 0;
  let siteAuditReads = 0;
  class FakeFile {
    name = 'photo.jpg';
    size = 3;
    type = 'image/jpeg';
    async arrayBuffer() { fileBytesRead++; return new Uint8Array([1, 2, 3]).buffer; }
  }
  const values: Record<string, unknown> = {
    type: 'ZDJECIE_MONTAZU', title: 'Zdjęcie wizji', clientId: 'client-1', projectId: 'project-1',
    siteAuditId: 'audit-1', auditFieldKey: 'roof.photo', file: new FakeFile(),
  };
  const mockPath = {
    extname: () => '.jpg', join: (...parts: string[]) => parts.join('/'),
    resolve: (...parts: string[]) => parts.join('/'), dirname: () => '/uploads/photo', sep: '/',
  };
  const route = loadRoute('documents/upload/route.ts', {
    ...responseModules(restrictedUser, async (_user, projectId) => {
      assert.equal(projectId, 'project-1');
      throw Object.assign(new Error('Projekt nie jest na etapie Wizja Lokalna'), { status: 403 });
    }),
    'lib/onrevolt/prisma': {
      prisma: {
        siteAudit: { findUnique: async () => {
          siteAuditReads++;
          return { projectId: 'project-1', project: { clientId: 'client-1' } };
        } },
        document: { create: async () => { uploadWrites++; } },
        $transaction: async () => { uploadWrites++; },
      },
    },
    'lib/onrevolt/audit': { writeAuditLog: async () => undefined },
    'lib/onrevolt/document-image': { prepareDocumentFile: async () => ({ bytes: Buffer.from([1]), fileName: 'photo.jpg', mimeType: 'image/jpeg' }) },
    'lib/onrevolt/invoice-recognition': { recognizeInvoicePdf: async () => null },
    'lib/onrevolt/invoice-recognition/consumption': { invoiceImportField: () => 'totalAfterBalancingKwh' },
    crypto: { createHash: () => ({ update() { return this; }, digest: () => 'hash' }), randomUUID: () => 'uuid' },
    path: { extname: () => '.jpg', join: (...parts: string[]) => parts.join('/'), resolve: (...parts: string[]) => parts.join('/'), dirname: () => '/uploads/photo' , sep: '/' },
    'fs/promises': { mkdir: async () => { uploadWrites++; }, writeFile: async () => { uploadWrites++; }, unlink: async () => undefined },
    process: { env: { ONREVOLT_UPLOAD_DIR: '/uploads' } },
  }, { File: FakeFile, process: { env: { ONREVOLT_UPLOAD_DIR: '/uploads' } } });

  const result = await route.POST({ formData: async () => ({ get: (key: string) => values[key] }) });
  assert.equal(result.status, 403);
  assert.equal(siteAuditReads, 1);
  assert.equal(fileBytesRead, 0);
  assert.equal(uploadWrites, 0);
});

test('restricted upload creates only an audit attachment and rechecks project scope in its write transaction', async () => {
  let fileBytesRead = 0;
  let scopeChecks = 0;
  let created: any;
  class FakeFile {
    name = 'photo.jpg';
    size = 3;
    type = 'image/jpeg';
    async arrayBuffer() { fileBytesRead++; return new Uint8Array([1, 2, 3]).buffer; }
  }
  const values: Record<string, unknown> = {
    type: 'ZDJECIE_MONTAZU', title: 'Zdjęcie wizji', clientId: 'client-1', projectId: 'project-1',
    siteAuditId: 'audit-1', auditFieldKey: 'roof.photo', file: new FakeFile(),
  };
  const mockPath = {
    extname: () => '.jpg', join: (...parts: string[]) => parts.join('/'),
    resolve: (...parts: string[]) => parts.join('/'), dirname: () => '/uploads/photo', sep: '/',
  };
  const route = loadRoute('documents/upload/route.ts', {
    ...responseModules(restrictedUser, async (_user, projectId) => {
      assert.equal(projectId, 'project-1');
      scopeChecks++;
    }),
    'lib/onrevolt/prisma': {
      prisma: {
        siteAudit: { findUnique: async () => ({ projectId: 'project-1', project: { clientId: 'client-1' } }) },
        $transaction: async (callback: (tx: any) => unknown) => callback({
          document: { create: async ({ data }: any) => { created = data; return { id: 'doc-1', ...data }; } },
        }),
      },
    },
    'lib/onrevolt/audit': { writeAuditLog: async () => undefined },
    'lib/onrevolt/document-image': { prepareDocumentFile: async () => ({ bytes: Buffer.from([1, 2, 3]), fileName: 'photo.jpg', mimeType: 'image/jpeg' }) },
    'lib/onrevolt/invoice-recognition': { recognizeInvoicePdf: async () => null },
    crypto: { createHash: () => ({ update() { return this; }, digest: () => 'hash' }), randomUUID: () => 'uuid' },
    path: { ...mockPath, default: mockPath },
    'fs/promises': { mkdir: async () => undefined, writeFile: async () => undefined, unlink: async () => undefined },
  }, { File: FakeFile, process: { env: { ONREVOLT_UPLOAD_DIR: '/uploads' } } });

  const result = await route.POST({ formData: async () => ({ get: (key: string) => values[key] }) });
  assert.equal(result.status, 201, JSON.stringify(result.value));
  assert.equal(fileBytesRead, 1);
  assert.equal(scopeChecks, 3);
  assert.equal(created.siteAuditId, 'audit-1');
  assert.equal(created.auditFieldKey, 'roof.photo');
  assert.equal(created.visibleToClient, false);
  assert.equal(created.offerId, undefined);
  assert.equal(created.invoiceRecognition, undefined);
  assert.equal(created.amountGross, undefined);
  assert.equal(result.value.data.storagePath, undefined);
  assert.equal(result.value.data.sha256, undefined);
});
