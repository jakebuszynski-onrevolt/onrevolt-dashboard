import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {
  offerWorkspaceProjectWhere,
  readOfferWorkspaceMeasurement,
  resolveOfferWorkspaceStoragePath,
  savedDraft,
  summarizeOfferMeasurementSeries,
  createServerOfferWorkspacePricingSnapshot,
} from './offer-workspace-server';
import { buildOfferWorkspaceDayProfiles } from './offer-workspace-chart-data';
import type { OfferMeasurementSeries } from './offer-measurements';
import { emptyOfferWorkspaceDraft } from './offer-workspace';
import { automaticOfferCommercialBreakdown } from './offer-workspace-commercial-pricing';
import { resolveClientEnergyBatteryPresence } from './client-energy-pv-summary';
import { projectGeneralTariff } from './client-tariffs';
import * as energyIntake from './energy-intake';
import { resolveProjectAnalysisPeriod, type ProjectAnalysisPeriod } from './project-analysis-period';
import { configurationEditsContainPricing } from './offer-workspace-configuration-edits';

const serverPath = path.resolve(__dirname, 'offer-workspace-server.ts');
test('automatyczny podział pozwala zapisać szkic przed wyborem urządzeń', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.commercialPricing = automaticOfferCommercialBreakdown();
  assert.doesNotThrow(() => createServerOfferWorkspacePricingSnapshot(draft, [], 'B2C'));
  draft.commercialPricing = { schemaVersion: 1, allocations: [], batteryInstallationScopeConfirmed: true };
  assert.throws(() => createServerOfferWorkspacePricingSnapshot(draft, [], 'B2C'));
});
const serverCode = ts.transpileModule(readFileSync(serverPath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  fileName: serverPath,
}).outputText;

function transactionFixture(options: {
  createConflict?: boolean;
  updateMiss?: boolean;
  activeTemplateIds?: string[];
  activeTemplates?: Array<{ id: string; kind: string }>;
  templates?: any[];
  validTariff?: boolean;
  initialDraft?: any;
  canReadEnergy?: boolean;
  canReadPricing?: boolean;
  canManageOffers?: boolean;
  missingEnergyAudit?: boolean;
  ppeNumber?: string | null;
  projectAccount?: boolean;
  accountOperator?: string;
  reOperator?: string;
  oldEneaAccount?: boolean;
  profileSource?: string;
  clientAccount?: boolean;
  existingPvKw?: number | null;
  roofTiltDeg?: number | null;
  roofOrientation?: string | null;
  existingBatteryKwh?: number | string | null;
  projectClientType?: string;
  clientType?: string;
  measurementFiles?: any[];
  nonDownloadedMeasurementFiles?: Array<{ id: string; status: string }>;
  siteAudit?: any;
  analysisPeriod?: ProjectAnalysisPeriod;
  referenceProfile?: { key: string | null; revision: number; contentHash: string | null; profileName: string | null };
} = {}) {
  const state = {
    fileUnavailable: false,
    fileBytes: Buffer.from('verified fixture bytes'),
    row: options.initialDraft ? structuredClone(options.initialDraft) : null as any,
    transactionCount: 0,
    updateCalls: [] as any[],
    auditCalls: [] as any[],
    tariffCalls: [] as any[],
    accountQueries: [] as any[],
    measurementQuery: null as any,
    nonDownloadedMeasurementQuery: null as any,
    siteAuditQuery: null as any,
    templateQuery: null as any,
    templateValidationQuery: null as any,
    draftReadCount: 0,
    seriesCalls: [] as any[],
    artifactReads: [] as any[],
    artifactWrites: [] as any[],
    artifactData: null as any,
    rePrismaCalls: 0,
    referenceProfileReads: 0,
  };
  const clone = (value: any) => value == null ? null : structuredClone(value);
  const project = {
    dashboardStationNumber: options.reOperator ? '123' : null, id: 'project-1', clientId: 'client-1', title: 'Projekt', clientType: options.projectClientType || 'B2C', locationAddress: null,
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    client: { displayName: 'Klient', clientType: options.clientType || 'B2C', updatedAt: new Date('2026-10-01T00:00:00.000Z'), contacts: [{ email: 'klient@example.invalid', phone: '123456789' }] },
    investmentSite: null,
  };
  const now = new Date('2026-10-29T12:00:00.000Z');
  const analysisPeriod = options.analysisPeriod || resolveProjectAnalysisPeriod(null, now);
  const forbidden = () => { throw new Error('Unexpected query in energy-only section'); };
  const findWorkspace = async () => { state.draftReadCount += 1; return clone(state.row); };
  const prisma = {
    project: { findFirst: async () => project },
    energyPortalAccount: { findMany: async ({ where }: any) => {
      state.accountQueries.push(where);
      if (where.projectId === 'project-1' && options.projectAccount !== false) return [{
        id: 'account-1', operator: options.accountOperator || 'ENEA', ppeNumber: options.ppeNumber === undefined ? '590310600030743962' : options.ppeNumber,
        projectId: 'project-1', tariff: null, updatedAt: new Date('2026-10-01T00:00:00.000Z'),
      }, ...(options.oldEneaAccount ? [{ id: 'old-enea', operator: 'ENEA', projectId: 'project-1', ppeNumber: 'old', tariff: 'G11', updatedAt: new Date('2025-01-01') }] : [])];
      if (where.projectId === null && options.clientAccount) return [{
        id: 'client-account', ppeNumber: 'client-ppe', projectId: null, tariff: null, updatedAt: new Date('2026-10-01T00:00:00.000Z'),
      }];
      return [];
    } },
    energyAudit: { findUnique: async () => options.missingEnergyAudit ? null : ({
      id: 'audit-1', profileSource: options.profileSource || 'ANNUAL_DECLARATION', annualConsumptionKwh: 1200, settlementSystem: 'NET_BILLING',
      existingPvKw: options.existingPvKw === undefined ? null : options.existingPvKw,
      existingBatteryKwh: options.existingBatteryKwh === undefined ? null : options.existingBatteryKwh,
      roofTiltDeg: options.roofTiltDeg ?? null, roofOrientation: options.roofOrientation ?? null,
      connectionPowerKw: 16, roofShape: 'GABLE',
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    }) },
    siteAudit: { findFirst: async (args: any) => { state.siteAuditQuery = args; return clone(options.siteAudit || null); } },
    energyMeasurementFile: { findMany: async (args: any) => {
      if (args.where.status === 'DOWNLOADED') { state.measurementQuery = args; return options.measurementFiles || []; }
      if (args.where.status?.not === 'DOWNLOADED') {
        state.nonDownloadedMeasurementQuery = args;
        return options.nonDownloadedMeasurementFiles || [];
      }
      return [];
    } },
    configurationTemplate: { findMany: async (args: any) => { state.templateQuery = args; return options.templates || []; } },
    offerWorkspace: { findUnique: findWorkspace },
    $transaction: async (callback: (tx: any) => Promise<any>) => {
      state.transactionCount += 1;
      const tx = {
        project: { findFirst: async () => ({ id: project.id, clientId: project.clientId, clientType: project.clientType, client: { clientType: project.client.clientType } }) },
        configurationTemplate: { findMany: async (args: any) => {
          state.templateValidationQuery = args;
          return options.activeTemplates || (options.activeTemplateIds || []).map((id) => ({ id, kind: 'MAGAZYN' }));
        } },
        offerWorkspace: {
          findUnique: findWorkspace,
          create: async ({ data }: any) => {
            if (options.createConflict) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
            state.row = { ...data, revision: 1, createdAt: new Date('2026-10-29T10:00:00.000Z'), updatedAt: new Date('2026-10-29T10:00:00.000Z') };
            return clone(state.row);
          },
          updateMany: async ({ where, data }: any) => {
            state.updateCalls.push({ where, data });
            if (options.updateMiss || !state.row || state.row.revision !== where.revision) return { count: 0 };
            state.row = {
              ...state.row, ...data, revision: state.row.revision + data.revision.increment,
              updatedAt: new Date('2026-10-29T10:01:00.000Z'),
            };
            return { count: 1 };
          },
          findUniqueOrThrow: findWorkspace,
        },
        auditLog: { create: async ({ data }: any) => { state.auditCalls.push(data); return data; } },
      };
      return callback(tx);
    },
  };
  const modules: Record<string, unknown> = {
    'node:crypto': { createHash },
    'node:fs/promises': { readFile: async () => {
      if (state.fileUnavailable) throw new Error('Nie można odczytać pliku');
      return state.fileBytes;
    }, realpath: async (value: string) => value, stat: async () => ({ isFile: () => true, size: state.fileBytes.length }) },
    'node:path': path,
    '@prisma/client': { Prisma: { JsonNull: { __jsonNull: true } } },
    './project-analysis-period-server': { readProjectAnalysisPeriod: async (projectId: string) => ({
      projectId, storedStartMonth: options.analysisPeriod?.startMonth || null, period: analysisPeriod,
    }) },
    './project-reference-profile': { readProjectReferenceProfileSelection: async () => {
      state.referenceProfileReads += 1;
      return options.referenceProfile || { key: null, revision: 0, contentHash: null, profileName: null };
    } },
    './offer-measurements': { buildOfferMeasurementSeries: (files: unknown[], buildOptions: unknown) => {
      state.seriesCalls.push({ files, options: buildOptions });
      return { periods: [{ period: '2026-09', hasImport: false, hasExport: false, missingDirections: ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'] }],
        missingMonths: ['2026-09'], missingDirections: [{ period: '2026-09', kind: 'ACTIVE_IMPORT' }, { period: '2026-09', kind: 'ACTIVE_EXPORT' }], intervals: [], files: [] };
    } },
    './offer-workspace-chart-data': { buildOfferWorkspaceDayProfiles },
    './energy-intake': energyIntake,
    './client-energy-pv-summary': { resolveClientEnergyBatteryPresence },
    './configuration-templates': { configurationInvestmentScope: (kind: string) => kind === 'MAGAZYN'
      ? 'BATTERY' : ['PV_DACH_PLASKI', 'PV_DACH_SKOSNY'].includes(kind) ? 'PV' : null },
    './offer-workspace-configuration-edits': {
      applyOfferWorkspaceConfigurationEdits: (templates: any[]) => templates,
      validateOfferWorkspaceConfigurationEdits: () => undefined,
      configurationEditsContainPricing,
    },
    './offer-workspace': {
      OFFER_WORKSPACE_SCHEMA_VERSION: 1,
      parseOfferWorkspaceDraft: (value: unknown) => value,
      offerWorkspaceDraftWithBatteryPresence: (draft: any, existingBatteryPresent: boolean | null) => ({ ...draft, existingBatteryPresent }),
    },
    './prisma': { prisma },
    './client-tariffs': { projectGeneralTariff },
    './client-tariffs-server': { readProjectGeneralTariffs: async (scope: any) => ({ generalTariff: options.reOperator ? { operator: options.reOperator, code: 'G11', osdId: 7 } : scope.generalTariff }) },
    './offer-workspace-artifacts': {
      getOfferWorkspaceArtifact: async (identity: unknown) => { state.artifactReads.push(identity); return clone(state.artifactData); },
      putOfferWorkspaceArtifact: async (identity: unknown, data: unknown) => {
        state.artifactWrites.push(identity);
        state.artifactData = clone(data);
      },
    },
    './re-stations': { resolveReStation: async () => ({ station: '123' }), rePrisma: () => { state.rePrismaCalls += 1; return { $queryRawUnsafe: async (...args: any[]) => {
      if (String(args[0]).startsWith('SELECT slug FROM osd')) return [{ slug: options.reOperator?.toLowerCase() }];
      state.tariffCalls.push(args);
      return options.validTariff === false ? [] : [{ id: args[2] }];
    } }; } },
    './staff-server': { hasStaffPermission: (_user: unknown, permission: string) => permission === 'energy.manage'
      ? options.canReadEnergy !== false
      : permission === 'offers.manage' ? options.canManageOffers !== false
        : permission === 'pricing.read' ? options.canReadPricing !== false : false },
  };
  const exports: any = {};
  vm.runInNewContext(serverCode, {
    exports, Buffer, Date, Error, process: { env: { ONREVOLT_UPLOAD_DIR: path.resolve('uploads-fixture') } },
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected server import: ${name}`);
      return modules[name];
    },
  });
  const user = { id: 'seller', systemRole: 'USER' };
  const workspace = () => exports.loadProjectOfferWorkspace('project-1', user, now);
  const save = async (patch: Record<string, unknown> = {}) => {
    const current = await workspace();
    return exports.saveProjectOfferWorkspaceDraft({
      projectId: 'project-1', user, expectedRevision: 0, sourceRevision: current.revision,
      input: emptyOfferWorkspaceDraft(), now, ...patch,
    });
  };
  return { state, workspace, save };
}

test('zakres projektu ogranicza zwykłego użytkownika do właściciela, a admin/moderator widzi wszystkie', () => {
  assert.deepEqual(offerWorkspaceProjectWhere('project', { id: 'seller', systemRole: 'USER' }), { id: 'project', ownerId: 'seller' });
  assert.deepEqual(offerWorkspaceProjectWhere('project', { id: 'admin', systemRole: 'ADMIN' }), { id: 'project' });
  assert.deepEqual(offerWorkspaceProjectWhere('project', { id: 'moderator', systemRole: 'MODERATOR' }), { id: 'project' });
});

test('ścieżka pomiaru pozostaje w katalogu uploadów', () => {
  const root = path.resolve('test-upload-root');
  assert.equal(resolveOfferWorkspaceStoragePath(root, path.join('client', 'measurement.xlsx')), path.join(root, 'client', 'measurement.xlsx'));
  for (const value of ['../outside.xlsx', '..\\outside.xlsx', 'C:\\outside.xlsx', '/outside.xlsx', '']) {
    assert.throws(() => resolveOfferWorkspaceStoragePath(root, value), /ścieżk|względn/i);
  }
});

test('bezpieczny odczyt sprawdza SHA-256 przed zwróceniem XLSX', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'crm-offer-workspace-'));
  try {
    const relative = path.join('project', 'measurement.xlsx');
    const target = path.join(root, relative);
    const bytes = Buffer.from('fixture xlsx bytes');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    const file = {
      id: 'measurement-1', clientId: 'client-1', projectId: 'project-1', accountId: 'account-1',
      kind: 'ACTIVE_IMPORT' as const, periodYear: 2026, periodMonth: 1, aggregation: '60 min',
      storagePath: relative, fileName: 'measurement.xlsx',
      document: {
        clientId: 'client-1', projectId: 'project-1', storagePath: relative, fileName: 'measurement.xlsx',
        sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    };
    assert.deepEqual(await readOfferWorkspaceMeasurement(file, root), bytes);
    await assert.rejects(() => readOfferWorkspaceMeasurement({
      ...file, document: { ...file.document, sha256: '0'.repeat(64) },
    }, root), /SHA-256/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('odpowiedź pomiarów zawiera sumy i braki, ale nie wysyła interwałów', () => {
  const series: OfferMeasurementSeries = {
    ppeNumber: '590310600030743962', projectId: 'project-1', periods: [
      { period: '2026-01', hasImport: true, hasExport: false, missingDirections: ['ACTIVE_EXPORT'] },
      { period: '2026-02', hasImport: false, hasExport: true, missingDirections: ['ACTIVE_IMPORT'] },
    ], missingMonths: [], missingDirections: [], files: [],
    intervals: [{
      localStart: '2026-01-01T00:00:00+01:00', localEnd: '2026-01-01T01:00:00+01:00',
      startUtc: '2025-12-31T23:00:00.000Z', endUtc: '2026-01-01T00:00:00.000Z', occurrence: 1,
      import: { valueKwh: 1.25, source: 'measured', fileIds: ['import-1'] }, export: null,
    }, {
      localStart: '2026-02-01T00:00:00+01:00', localEnd: '2026-02-01T01:00:00+01:00',
      startUtc: '2026-01-31T23:00:00.000Z', endUtc: '2026-02-01T00:00:00.000Z', occurrence: 1,
      import: null, export: { valueKwh: 0, source: 'measured', fileIds: ['export-1'] },
    }],
  };
  const summary = summarizeOfferMeasurementSeries(series);
  assert.equal(summary.totalsImportKwh, 1.25);
  assert.equal(summary.totalsExportKwh, 0);
  assert.deepEqual(summary.months, [
    { period: '2026-01', importKwh: 1.25, exportKwh: null },
    { period: '2026-02', importKwh: null, exportKwh: 0 },
  ]);
  assert.equal(summary.intervalCount, 2);
  assert.equal('intervals' in summary, false);
  assert.equal('dayProfiles' in summary, false);
});

test('podsumowanie dodaje profil pierwszego kompletnego dnia bez zmiany sum miesięcznych', () => {
  const intervals = Array.from({ length: 24 }, (_, hour) => {
    const localStart = `2026-05-04T${String(hour).padStart(2, '0')}:00:00+02:00`;
    const start = Date.parse(localStart);
    return {
      localStart,
      localEnd: `2026-05-04T${String(hour + 1).padStart(2, '0')}:00:00+02:00`,
      startUtc: new Date(start).toISOString(),
      endUtc: new Date(start + 60 * 60_000).toISOString(),
      occurrence: 1,
      import: { valueKwh: 1, source: 'measured' as const, fileIds: ['private-source-id'] },
      export: null,
    };
  });
  const series: OfferMeasurementSeries = {
    ppeNumber: 'not-exposed',
    periods: [{ period: '2026-05', hasImport: true, hasExport: false, missingDirections: ['ACTIVE_EXPORT'] }],
    missingMonths: [], missingDirections: [], intervals, files: [],
  };

  const summary = summarizeOfferMeasurementSeries(series);
  assert.equal(summary.totalsImportKwh, 24);
  assert.equal(summary.totalsExportKwh, null);
  assert.deepEqual(summary.months, [{ period: '2026-05', importKwh: 24, exportKwh: null }]);
  assert.deepEqual(summary.dayProfiles, [{
    period: '2026-05', dayType: 'workday', date: '2026-05-04',
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, importKwh: 1, exportKwh: null })),
  }]);
  assert.equal('intervals' in summary, false);
  assert.equal(JSON.stringify(summary).includes('private-source-id'), false);
  assert.equal(JSON.stringify(summary).includes('not-exposed'), false);
});

test('bez pricing.read nie pyta ani nie zwraca kosztów i marż, a rewizja nie odtwarza wcześniejszych cen', async () => {
  const template = {
    id: 'template-1', familyKey: 'battery', name: 'Magazyn', version: 3, isActive: true,
    kind: 'MAGAZYN', clientType: 'B2C', roofType: null, goal: null, powerKw: null, capacityKwh: 10,
    sortOrder: 1, requiresExistingPv: false, requiresExistingInverter: false, notes: null,
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    items: [{
      id: 'item-1', position: 1, description: 'Magazyn', quantity: 1, role: 'BATTERY', supplyMode: 'ONREVOLT_SUPPLIED',
      unitPurchaseNet: 10000, purchaseVatRate: 0.23, operatingCostNet: 200, marginRate: 0.2, saleVatRate: 0.23,
      isOptional: false, requiresReview: false,
      product: {
        id: 'product-1', name: 'Bateria', sku: 'BAT-1', legacySku: null, category: 'BATTERY', producer: 'Producent',
        availability: 'Dostępny', powerCapacity: '10 kWh',
        prices: [{ id: 'price-1', purchaseNet: 9000, currentPurchaseNet: 8800, purchaseVatRate: 0.23,
          operatingCostNet: 100, marginRate: 0.2, saleVatRate: 0.23, currency: 'PLN',
          validFrom: new Date('2026-09-01T00:00:00.000Z'), createdAt: new Date('2026-09-01T00:00:00.000Z') }],
      },
    }],
  };
  const withoutPricing = transactionFixture({ templates: [template], canReadPricing: false });
  const restricted = await withoutPricing.workspace();
  assert.equal(restricted.templates[0].items[0].unitPurchaseNet, null);
  assert.equal(restricted.templates[0].items[0].marginRate, null);
  assert.equal(restricted.templates[0].items[0].product?.prices.length, 0);
  const restrictedItemSelect = withoutPricing.state.templateQuery.include.items.select;
  assert.equal('unitPurchaseNet' in restrictedItemSelect, false);
  assert.deepEqual(Object.keys(restrictedItemSelect.product.select.prices.select).sort(), ['createdAt', 'id', 'validFrom']);
  assert.ok(restrictedItemSelect.product.select.prices.where.validFrom.lte instanceof Date);

  const pricedFixture = transactionFixture({ templates: [template], canReadPricing: true });
  const withPricing = await pricedFixture.workspace();
  assert.ok(pricedFixture.state.templateQuery.include.items.include.product.include.prices.where.validFrom.lte instanceof Date);
  assert.equal(withPricing.templates[0].items[0].product?.prices[0].purchaseNet, 9000);
  assert.notEqual(restricted.revision, withPricing.revision);
  const changedPrice = structuredClone(template);
  changedPrice.items[0].product.prices[0].purchaseNet = 9500;
  assert.notEqual((await transactionFixture({ templates: [changedPrice], canReadPricing: true }).workspace()).revision, withPricing.revision);

  const changedProductMetadata = structuredClone(template);
  changedProductMetadata.items[0].product.name = 'Bateria po zmianie';
  changedProductMetadata.items[0].product.availability = 'Niedostępny';
  changedProductMetadata.items[0].product.powerCapacity = '12 kWh';
  const changedMetadataWorkspace = await transactionFixture({ templates: [changedProductMetadata], canReadPricing: false }).workspace();
  assert.notEqual(changedMetadataWorkspace.revision, restricted.revision);
});

test('pobiera miesięczne pliki ENEA w projekcie bez stacji RE i nie sumuje braku danych do zera', async () => {
  const fixture = transactionFixture({ canReadEnergy: true });
  const workspace = await fixture.workspace();
  assert.equal(workspace.ppeNumber, '590310600030743962');
  assert.equal(workspace.input.energyProfileSource, 'ANNUAL_DECLARATION');
  assert.equal(workspace.measurements.totalsImportKwh, null);
  assert.equal(workspace.measurements.totalsExportKwh, null);
  assert.equal(workspace.measurements.intervalCount, 0);
  assert.deepEqual(workspace.measurements.months.map((month: any) => month.period), workspace.period.periodKeys);
  assert.deepEqual(workspace.period.periodKeys, fixture.state.seriesCalls[0].options.periodKeys);
  assert.ok(workspace.measurements.months.every((month: any) => month.importKwh === null && month.exportKwh === null));
  assert.equal(fixture.state.measurementQuery.where.status, 'DOWNLOADED');
  assert.equal(fixture.state.measurementQuery.where.operator, 'ENEA');
  assert.deepEqual(Array.from(fixture.state.measurementQuery.where.accountId.in), ['account-1']);
  assert.equal(fixture.state.accountQueries.length, 1);
  assert.equal(fixture.state.accountQueries[0].projectId, 'project-1');
  assert.ok(fixture.state.measurementQuery.where.AND[0].OR.length > 0);
  assert.deepEqual(Array.from(fixture.state.templateQuery.where.clientType.in), ['B2C', 'B2C_B2B']);
  assert.equal(fixture.state.seriesCalls.length, 1);
  assert.equal(fixture.state.artifactReads.length, 1);
  assert.equal(fixture.state.artifactWrites.length, 1);
  assert.equal(fixture.state.artifactReads[0].kind, 'measurements');
  assert.equal(fixture.state.artifactReads[0].key.energyPermission, true);
  assert.equal(fixture.state.artifactReads[0].key.sourceRevision, workspace.revision);
  assert.equal(fixture.state.rePrismaCalls, 0);
});

test('wybrany profil trafia do workspace i zmienia rewizję, a odczyt respektuje energy.manage', async () => {
  const selection = { key: 'bdew-2025-h25', revision: 3, contentHash: 'a'.repeat(64), profileName: 'Gospodarstwo domowe — BDEW H25' };
  const selected = transactionFixture({ canReadEnergy: true, referenceProfile: selection });
  const workspace = await selected.workspace();
  assert.deepEqual(workspace.input.referenceProfile, selection);
  assert.equal(selected.state.referenceProfileReads, 1);

  const changed = await transactionFixture({ canReadEnergy: true, referenceProfile: { ...selection, revision: 4 } }).workspace();
  assert.notEqual(changed.revision, workspace.revision, 'profile selection revision participates in source revision');

  const restrictedFixture = transactionFixture({ canReadEnergy: false, referenceProfile: selection });
  const restricted = await restrictedFixture.workspace();
  assert.equal(restricted.input.referenceProfile, undefined);
  assert.equal(restrictedFixture.state.referenceProfileReads, 0, 'unauthorized workspaces never query profile selection');
});

test('cache używa zweryfikowanych miesięcznych pomiarów i pomija ponowne parsowanie serii', async () => {
  const fixture = transactionFixture({ canReadEnergy: true });
  const first = await fixture.workspace();
  const second = await fixture.workspace();
  assert.equal(JSON.stringify(second.measurements), JSON.stringify(first.measurements));
  assert.equal(fixture.state.seriesCalls.length, 1);
  assert.equal(fixture.state.artifactReads.length, 2);
  assert.equal(fixture.state.artifactWrites.length, 1);
});

test('brak odczytu XLSX ma inną rewizję niż pełne dane, także po odzyskaniu pliku', async () => {
  const bytes = Buffer.from('verified fixture bytes');
  const file = { id: 'file-1', clientId: 'client-1', projectId: 'project-1', accountId: 'account-1',
    kind: 'ACTIVE_IMPORT', periodYear: 2026, periodMonth: 9, aggregation: '60 min',
    storagePath: 'measurement.xlsx', fileName: 'measurement.xlsx',
    document: { clientId: 'client-1', projectId: 'project-1', storagePath: 'measurement.xlsx', fileName: 'measurement.xlsx',
      sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
  for (const startsUnavailable of [false, true]) {
    const fixture = transactionFixture({ measurementFiles: [file] });
    fixture.state.fileUnavailable = startsUnavailable;
    const first = await fixture.workspace();
    fixture.state.fileUnavailable = !startsUnavailable;
    const second = await fixture.workspace();
    assert.notEqual(first.revision, second.revision);
    fixture.state.fileUnavailable = false;
    const recovered = await fixture.workspace();
    assert.equal(recovered.revision, startsUnavailable ? second.revision : first.revision);
    assert.equal(fixture.state.artifactWrites.length, 1);
    assert.equal(fixture.state.artifactReads.length, 2);
  }
});

test('zmiana wybranego okresu trafia do rewizji źródeł obliczenia', async () => {
  const now = new Date('2026-10-29T12:00:00.000Z');
  const current = await transactionFixture().workspace();
  const previousRange = await transactionFixture({
    analysisPeriod: resolveProjectAnalysisPeriod('2025-09', now),
  }).workspace();
  assert.notEqual(current.revision, previousRange.revision);
  assert.equal(previousRange.period.startMonth, '2025-09');
});

test('przekazuje kontakt i parametry pierwszej strony z CRM, bez domyślnych danych obiektu', async () => {
  const workspace = await transactionFixture({ canReadEnergy: true }).workspace();
  assert.equal(workspace.input.reportDetails.email, 'klient@example.invalid');
  assert.equal(workspace.input.reportDetails.phone, '123456789');
  assert.equal(workspace.input.reportDetails.connectionPowerKw, 16);
  assert.equal(workspace.input.reportDetails.heatingSource, null);
  const restricted = await transactionFixture({ canReadEnergy: false }).workspace();
  assert.equal(restricted.input.reportDetails.connectionPowerKw, null);
});

test('reportDetails używa ostatniej zapisanej wizji lokalnej bez domyślnych obliczeń mocy', async () => {
  const siteAudit = {
    id: 'site-audit-2', updatedAt: new Date('2026-10-15T10:00:00.000Z'),
    formData: {
      has_pv_now: 'yes', existing_pv_place: 'GROUND',
      heating_source: 'Pompa ciepła', heating_params: '8 kW',
      loads: [{ device: 'Ładowarka', params: '16A', power_kw: '11' }],
      planned_demand: '',
    },
  };
  const fixture = transactionFixture({ canReadEnergy: true, siteAudit });
  const workspace = await fixture.workspace();
  assert.equal(JSON.stringify(fixture.state.siteAuditQuery.orderBy), JSON.stringify([{ updatedAt: 'desc' }, { id: 'desc' }]));
  assert.equal(workspace.input.reportDetails.pvInstallationPlace, 'Grunt');
  assert.equal(workspace.input.reportDetails.highLoadDevices, 'Pompa ciepła 8 kW; Ładowarka, 16A, 11 kW');
  assert.equal(workspace.input.reportDetails.plannedHighLoadDevices, null);

  const changed = structuredClone(siteAudit);
  changed.formData.loads[0].power_kw = '12';
  const changedWorkspace = await transactionFixture({ canReadEnergy: true, siteAudit: changed }).workspace();
  assert.notEqual(changedWorkspace.revision, workspace.revision);

  const restricted = await transactionFixture({ canReadEnergy: false, siteAudit }).workspace();
  assert.equal(restricted.input.reportDetails.highLoadDevices, null);
  assert.notEqual(restricted.revision, workspace.revision);
});

test('nie pobiera PPE klienta bez projektu i akceptuje szablony wspólne B2C/B2B', async () => {
  const strictProjectScope = transactionFixture({ canReadEnergy: true, projectAccount: false, clientAccount: true });
  const workspace = await strictProjectScope.workspace();
  assert.equal(workspace.ppeNumber, null);
  assert.equal(workspace.measurements.availability, 'NO_FILES');
  assert.equal(strictProjectScope.state.accountQueries.length, 1);
  assert.equal(strictProjectScope.state.accountQueries[0].projectId, 'project-1');

  const sharedTemplate = transactionFixture({ activeTemplateIds: ['shared-template'] });
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['shared-template'];
  await sharedTemplate.save({ input: draft });
  assert.deepEqual(Array.from(sharedTemplate.state.templateValidationQuery.where.clientType.in), ['B2C', 'B2C_B2B']);

  const unknownProject = transactionFixture({ projectClientType: 'UNKNOWN', clientType: 'B2B' });
  await unknownProject.workspace();
  assert.deepEqual(Array.from(unknownProject.state.templateQuery.where.clientType.in), ['B2B', 'B2C_B2B']);
});

test('geometria istniejącej PV jest opisana jako pochodząca z danych dachu', async () => {
  const southeast = transactionFixture({ canReadEnergy: true, existingPvKw: 8.2, roofTiltDeg: 35, roofOrientation: 'SE' });
  const workspace = await southeast.workspace();
  assert.equal(workspace.input.existingPv.powerKw, 8.2);
  assert.equal(workspace.input.existingPv.tiltDegrees, 35);
  assert.equal(workspace.input.existingPv.azimuthDegrees, 135);
  assert.ok(workspace.input.issues.some((issue: string) => issue.includes('danych dachu')));

  const eastWest = transactionFixture({ canReadEnergy: true, existingPvKw: 8.2, roofTiltDeg: 35, roofOrientation: 'E_W' });
  const eastWestWorkspace = await eastWest.workspace();
  assert.equal(eastWestWorkspace.input.existingPv.azimuthDegrees, null);
  assert.ok(eastWestWorkspace.input.issues.some((issue: string) => issue.includes('E_W')));
});

test('geometria dachu dla nowej PV jest dostępna również u klienta bez istniejących paneli', async () => {
  const workspace = await transactionFixture({ canReadEnergy: true, existingPvKw: 0, roofTiltDeg: 30, roofOrientation: 'S' }).workspace();
  assert.equal(workspace.input.roofGeometry.tiltDegrees, 30);
  assert.equal(workspace.input.roofGeometry.azimuthDegrees, 180);
  assert.equal(workspace.input.existingPv.tiltDegrees, null);
  const split = await transactionFixture({ canReadEnergy: true, existingPvKw: 0, roofTiltDeg: 30, roofOrientation: 'E_W' }).workspace();
  assert.equal(split.input.roofGeometry.azimuthDegrees, null, 'dwie połacie nie wyznaczają pojedynczego azymutu');
  const hidden = await transactionFixture({ canReadEnergy: false, roofTiltDeg: 30, roofOrientation: 'S' }).workspace();
  assert.equal(hidden.input.roofGeometry.tiltDegrees, null);
  assert.equal(hidden.input.roofGeometry.azimuthDegrees, null);
});

test('pojemność magazynu z danych energetycznych ustala stan i rewizję workspace', async () => {
  const absent = await transactionFixture({ existingBatteryKwh: null }).workspace();
  const zero = await transactionFixture({ existingBatteryKwh: 0 }).workspace();
  const present = await transactionFixture({ existingBatteryKwh: 8.5 }).workspace();
  const invalid = await transactionFixture({ existingBatteryKwh: -1 }).workspace();
  const noAudit = await transactionFixture({ missingEnergyAudit: true }).workspace();

  assert.equal(absent.input.existingBatteryKwh, null);
  assert.equal(absent.input.existingBatteryPresent, false);
  assert.equal(zero.input.existingBatteryPresent, false);
  assert.equal(present.input.existingBatteryPresent, true);
  assert.equal(present.input.existingBatteryKwh, 8.5);
  assert.equal(invalid.input.existingBatteryPresent, null);
  assert.ok(invalid.input.issues.some((issue: string) => issue.includes('Nieprawidłowa pojemność istniejącego magazynu')));
  assert.equal(noAudit.input.existingBatteryPresent, false, 'an authorized workspace with no EnergyAudit has no confirmed battery');
  assert.notEqual(absent.revision, present.revision, 'battery capacity is part of the workspace source revision');
});

test('rewizja zweryfikowanych źródeł nie jest używana bez odczytu energii', async () => {
  const withEnergyPermission = await transactionFixture({ canReadEnergy: true }).workspace();
  const restrictedFixture = transactionFixture({ canReadEnergy: false });
  const withoutEnergyPermission = await restrictedFixture.workspace();
  assert.notEqual(withEnergyPermission.revision, withoutEnergyPermission.revision);
  assert.equal(withoutEnergyPermission.ppeNumber, null);
  assert.equal(withoutEnergyPermission.measurements.totalsImportKwh, null);
  assert.equal(restrictedFixture.state.artifactReads.length, 0);
});

test('serwis nie odczytuje draftu ani nie zapisuje bez offers.manage i energy.manage', async () => {
  const input = emptyOfferWorkspaceDraft();
  input.existingPv = { powerKw: 9.9, tiltDegrees: 40, azimuthDegrees: 170, lossPercent: 12 };
  input.targetOperatorId = 7;
  input.targetTariffId = 42;
  input.description.before = 'Prywatny opis draftu';
  const existingDraft = {
    projectId: 'project-1', revision: 4, schemaVersion: 1, sourceRevision: 'b'.repeat(64), input,
    createdById: 'seller', updatedById: 'seller',
    createdAt: new Date('2026-10-28T10:00:00.000Z'), updatedAt: new Date('2026-10-29T10:00:00.000Z'),
  };
  const restricted = transactionFixture({ canReadEnergy: false, initialDraft: existingDraft });
  const workspace = await restricted.workspace();
  assert.equal(workspace.draft, null);
  assert.equal(restricted.state.draftReadCount, 0);
  await assert.rejects(() => restricted.save(), /offers.manage i energy.manage/);
  assert.equal(restricted.state.transactionCount, 0);
  assert.equal(restricted.state.draftReadCount, 0);
});

test('saved draft redacts per-offer prices without pricing.read and refuses writes that could erase hidden edits', async () => {
  const input = {
    ...emptyOfferWorkspaceDraft(),
    selectedTemplateIds: ['battery-1'],
    configurationEdits: [{ templateId: 'battery-1', items: [{ itemId: 'manual-line', description: 'Dodatkowy koszt',
      pricing: { unitPurchaseNet: 900, operatingCostNet: 80, marginRate: 0.2 } }],
      addedItems: [{ id: 'added-service', description: 'Montaż', quantity: 1, role: 'LABOR', supplyMode: 'SERVICE_ONLY',
        pricing: { unitPurchaseNet: 0, purchaseVatRate: 0, operatingCostNet: 100, operatingCostBasis: 'PER_LINE', marginRate: 0.1, saleVatRate: 0.23 } }] }],
  };
  const row = { revision: 1, sourceRevision: 'a'.repeat(64), updatedAt: new Date('2026-10-29T10:00:00.000Z'), input };
  const restrictedDraft = savedDraft(row as any, false);
  assert.equal(restrictedDraft.input.configurationEdits?.[0]?.items?.[0]?.pricing, undefined);
  assert.equal(restrictedDraft.input.configurationEdits?.[0]?.addedItems, undefined);
  const pricedDraft = savedDraft(row as any, true);
  assert.equal(pricedDraft.input.configurationEdits?.[0]?.items?.[0]?.pricing?.unitPurchaseNet, 900);

  const existing = { projectId: 'project-1', revision: 4, schemaVersion: 1, sourceRevision: 'old', input,
    createdById: 'seller', updatedById: 'seller', createdAt: new Date('2026-10-28T10:00:00.000Z'),
    updatedAt: new Date('2026-10-29T10:00:00.000Z') };
  const fixture = transactionFixture({ initialDraft: existing, activeTemplateIds: ['battery-1'], canReadPricing: false });
  await assert.rejects(() => fixture.save({ expectedRevision: 4 }), /pricing.read/);
  assert.equal(fixture.state.updateCalls.length, 0);
});

test('brak PPE i przekroczenie limitu plików pozostają jawnie nieustalone', async () => {
  const missingPpe = transactionFixture({ canReadEnergy: true, ppeNumber: null });
  const withoutPpe = await missingPpe.workspace();
  assert.equal(withoutPpe.ppeNumber, null);
  assert.equal(withoutPpe.measurements.totalsImportKwh, null);
  assert.equal(withoutPpe.measurements.months.length, 12);
  assert.equal(withoutPpe.measurements.availability, 'NO_FILES');
  assert.ok(withoutPpe.measurements.issues.some((issue: string) => issue.includes('numeru PPE')));
  assert.equal(missingPpe.state.seriesCalls.length, 0);

  const tooManyFiles = transactionFixture({ canReadEnergy: true, measurementFiles: Array.from({ length: 25 }, (_, index) => ({
    id: `file-${index}`, clientId: 'client-1', projectId: 'project-1', accountId: 'account-1', kind: 'ACTIVE_IMPORT',
    periodYear: 2026, periodMonth: 9, aggregation: '60 min', storagePath: null, fileName: null,
    updatedAt: new Date('2026-10-01T00:00:00.000Z'), document: null,
  })) });
  const overflow = await tooManyFiles.workspace();
  assert.equal(overflow.measurements.intervalCount, null);
  assert.equal(overflow.measurements.months.length, 12);
  assert.equal(overflow.measurements.totalsImportKwh, null);
  assert.ok(overflow.measurements.issues.some((issue: string) => issue.includes('więcej niż 24')));
  assert.equal(tooManyFiles.state.seriesCalls.length, 0);
});

test('rekord pliku ENEA poza statusem DOWNLOADED blokuje oznaczenie okresu jako bez plików', async () => {
  const failedRecord = transactionFixture({ canReadEnergy: true, nonDownloadedMeasurementFiles: [{ id: 'file-failed', status: 'FAILED' }] });
  const workspace = await failedRecord.workspace();
  assert.equal(workspace.measurements.availability, 'FILES_PRESENT');
  assert.equal(failedRecord.state.nonDownloadedMeasurementQuery.where.status.not, 'DOWNLOADED');
  assert.ok(workspace.measurements.issues.some((issue: string) => issue.includes('poza statusem DOWNLOADED')));
  assert.equal(failedRecord.state.seriesCalls.length, 1, 'the data loader still reports the empty downloaded set; availability carries the failed-record fact');
});

test('transakcja tworzy szkic rewizją 1 i zapisuje audyt atomowo', async () => {
  const fixture = transactionFixture();
  const saved = await fixture.save();
  assert.equal(saved.revision, 1);
  assert.equal(fixture.state.transactionCount, 1);
  assert.equal(fixture.state.updateCalls.length, 0);
  assert.equal(fixture.state.auditCalls[0].action, 'CREATE');
});

test('zapis normalizuje szkic na podstawie danych energetycznych bez zmiany starego wiersza przed zapisem', async () => {
  const staleInput = emptyOfferWorkspaceDraft();
  staleInput.existingBatteryPresent = true;
  const fixture = transactionFixture({ initialDraft: {
    projectId: 'project-1', revision: 4, schemaVersion: 1, sourceRevision: 'old', input: staleInput,
    createdById: 'seller', updatedById: 'seller',
    createdAt: new Date('2026-10-28T10:00:00.000Z'), updatedAt: new Date('2026-10-28T10:00:00.000Z'),
  }, existingBatteryKwh: 0 });
  const loaded = await fixture.workspace();
  assert.equal(loaded.draft?.input.existingBatteryPresent, false);
  assert.equal(fixture.state.row.input.existingBatteryPresent, true, 'GET does not rewrite the saved row');
  assert.equal(fixture.state.updateCalls.length, 0);

  staleInput.targetOperatorId = 7;
  staleInput.targetTariffId = 42;
  const saved = await fixture.save({ expectedRevision: 4, input: staleInput });
  assert.equal(saved.input.existingBatteryPresent, false);
  assert.equal(fixture.state.updateCalls[0].data.input.existingBatteryPresent, false);
});

test('aktualizacja używa updateMany po projectId i rewizji oraz zapisuje audyt w transakcji', async () => {
  const fixture = transactionFixture({ initialDraft: {
    projectId: 'project-1', revision: 4, schemaVersion: 1, sourceRevision: 'old',
    input: emptyOfferWorkspaceDraft(), createdById: 'seller', updatedById: 'seller',
    createdAt: new Date('2026-10-28T10:00:00.000Z'), updatedAt: new Date('2026-10-28T10:00:00.000Z'),
  } });
  const saved = await fixture.save({ expectedRevision: 4 });
  assert.equal(saved.revision, 5);
  assert.equal(fixture.state.updateCalls[0].where.projectId, 'project-1');
  assert.equal(fixture.state.updateCalls[0].where.revision, 4);
  assert.equal(fixture.state.updateCalls[0].data.revision.increment, 1);
  assert.equal(fixture.state.auditCalls[0].action, 'UPDATE');
});

test('nieaktualne źródło, przegrany compare-and-swap i kolizja create zwracają konflikt', async () => {
  const staleSource = transactionFixture();
  await assert.rejects(() => staleSource.save({ sourceRevision: 'b'.repeat(64) }), /zmieniły się/);
  assert.equal(staleSource.state.transactionCount, 0);

  const lostRace = transactionFixture({
    updateMiss: true,
    initialDraft: {
      projectId: 'project-1', revision: 4, schemaVersion: 1, sourceRevision: 'old',
      input: emptyOfferWorkspaceDraft(), createdById: 'seller', updatedById: 'seller',
      createdAt: new Date('2026-10-28T10:00:00.000Z'), updatedAt: new Date('2026-10-28T10:00:00.000Z'),
    },
  });
  await assert.rejects(() => lostRace.save({ expectedRevision: 4 }), /nowszą rewizję/);

  const duplicateCreate = transactionFixture({ createConflict: true });
  await assert.rejects(() => duplicateCreate.save(), /utworzony w innej karcie/);
});

test('weryfikuje aktywność szablonów i parę ID operatora/taryfy przed zapisem', async () => {
  const inactive = transactionFixture({ activeTemplateIds: [] });
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['template-1'];
  await assert.rejects(() => inactive.save({ input: draft }), /nieaktywny lub niedostępny/);
  assert.equal(inactive.state.auditCalls.length, 0);

  const tariff = transactionFixture();
  const target = emptyOfferWorkspaceDraft();
  target.targetOperatorId = 7;
  target.targetTariffId = 42;
  await tariff.save({ input: target });
  assert.deepEqual(tariff.state.tariffCalls[0].slice(1), [42, 7]);

  const invalidTariff = transactionFixture({ validTariff: false });
  await assert.rejects(() => invalidTariff.save({ input: target }), /nie należy do operatora/);
  assert.equal(invalidTariff.state.transactionCount, 0);
});

test('wybrane zestawy muszą mieć unikalny scope PV/magazyn zgodny ze strategią PV', async () => {
  const twoBatteries = transactionFixture({ activeTemplates: [
    { id: 'battery-1', kind: 'MAGAZYN' }, { id: 'battery-2', kind: 'MAGAZYN' },
  ] });
  const duplicateScope = emptyOfferWorkspaceDraft();
  duplicateScope.selectedTemplateIds = ['battery-1', 'battery-2'];
  await assert.rejects(() => twoBatteries.save({ input: duplicateScope }), /jeden szablon PV i jeden szablon magazynu/);
  assert.equal(twoBatteries.state.auditCalls.length, 0);

  const pvWithKeepStrategy = transactionFixture({ activeTemplates: [{ id: 'pv-1', kind: 'PV_DACH_SKOSNY' }] });
  const invalidStrategy = emptyOfferWorkspaceDraft();
  invalidStrategy.selectedTemplateIds = ['pv-1'];
  await assert.rejects(() => pvWithKeepStrategy.save({ input: invalidStrategy }), /strategii dodania PV/);

  const pvAndBattery = transactionFixture({ activeTemplates: [
    { id: 'pv-1', kind: 'PV_DACH_PLASKI' }, { id: 'battery-1', kind: 'MAGAZYN' },
  ] });
  const validPair = emptyOfferWorkspaceDraft();
  validPair.pvStrategy = 'ADD_TEMPLATE';
  validPair.selectedTemplateIds = ['pv-1', 'battery-1'];
  await pvAndBattery.save({ input: validPair });
  assert.equal(pvAndBattery.state.auditCalls.length, 1);
});


test('PGE z deklaracją roczną nie wymaga konta ENEA; import operatora opisuje PGE', async () => {
  const annual = await transactionFixture({ canReadEnergy: true, accountOperator: 'PGE', existingPvKw: 0 }).workspace();
  assert.equal(annual.measurements.availability, 'NO_FILES');
  assert.deepEqual(Array.from(annual.measurements.issues), []);
  const operator = await transactionFixture({ canReadEnergy: true, accountOperator: 'PGE', profileSource: 'OPERATOR' }).workspace();
  assert.ok(operator.measurements.issues.some((issue: string) => issue.includes('operatora PGE')));
  assert.ok(!operator.measurements.issues.some((issue: string) => issue.includes('ENEA')));
});


test('wybór operatora z katalogu taryf RE wyklucza stare konto innego operatora', async () => {
  const fixture = transactionFixture({ canReadEnergy: true, accountOperator: 'PGE', reOperator: 'PGE', oldEneaAccount: true });
  const workspace = await fixture.workspace();
  assert.equal(workspace.measurements.availability, 'NO_FILES');
  assert.equal(fixture.state.measurementQuery, null);
  assert.deepEqual(Array.from(workspace.measurements.issues), []);
});
