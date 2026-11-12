import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { selectOfferMeasurementFilesForPeriod } from './offer-measurement-month-reuse';

const helperPath = path.resolve(__dirname, './project-analysis-measurements.ts');
const helperCode = ts.transpileModule(readFileSync(helperPath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: helperPath,
}).outputText;
const defaultPeriodKeys = Array.from({ length: 12 }, (_, index) => {
  const date = new Date(Date.UTC(2025, 9 + index, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
});

type MeasurementFixture = {
  id: string;
  accountId: string;
  accountProjectId: string;
  projectId: string | null;
  periodYear: number;
  periodMonth: number;
  kind?: string;
  status?: string;
};

function measurementReader(options: {
  missingProject?: boolean;
  fileCount?: number;
  files?: MeasurementFixture[];
  periodKeys?: string[];
} = {}) {
  const state: { query?: any; queries: any[]; calls: number } = { calls: 0, queries: [] };
  const periodKeys = options.periodKeys ?? defaultPeriodKeys;
  const modules: Record<string, unknown> = {
    './prisma': {
      prisma: {
        energyMeasurementFile: {
          findMany: async (query: any) => {
            state.calls += 1;
            state.query = query;
            state.queries.push(query);
            const fixtures = options.files ?? Array.from({ length: options.fileCount ?? 0 }, (_, index) => ({
              id: `file-${index}`, accountId: 'account-3', accountProjectId: 'project-7', projectId: 'project-7',
              periodYear: 2026, periodMonth: 1,
            }));
            const periodFilter = query.where.AND.find((entry: any) => entry.OR?.[0]?.periodYear !== undefined);
            const projectFilter = query.where.AND.find((entry: any) => entry.OR?.some((condition: any) => Object.hasOwn(condition, 'projectId')));
            return fixtures.filter(file => file.accountId === query.where.accountId
              && file.accountProjectId === query.where.account.projectId
              && projectFilter.OR.some((condition: any) => condition.projectId === file.projectId)
              && (!periodFilter || periodFilter.OR.some((period: any) => period.periodYear === file.periodYear && period.periodMonth === file.periodMonth))
              && (!query.where.status || query.where.status === file.status)
              && (!query.where.kind || query.where.kind.in.includes(file.kind)))
              .map(file => ({ ...file }));
          },
        },
      },
    },
    './project-analysis-period-server': {
      readProjectAnalysisPeriod: async (projectId: string) => {
        assert.equal(projectId, 'project-7');
        return options.missingProject ? null : {
          projectId,
          storedStartMonth: periodKeys[0],
          period: { startMonth: periodKeys[0], endMonth: periodKeys.at(-1), periodKeys },
        };
      },
    },
    './offer-measurement-month-reuse': { selectOfferMeasurementFilesForPeriod },
  };
  const exports: any = {};
  vm.runInNewContext(helperCode, {
    exports,
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected helper import: ${name}`);
      return modules[name];
    },
  });
  return { read: exports.readAnalysisAccountMeasurements, state };
}

test('analysis measurements query all selected months, scoped to both account and project', async () => {
  const fixture = measurementReader({ fileCount: 57 });
  const result = await fixture.read('account-3', 'project-7');

  assert.equal(result.files.length, 57);
  assert.deepEqual(result.period.periodKeys, defaultPeriodKeys);
  assert.equal(Object.hasOwn(result, 'coverageFiles'), false);
  assert.equal(fixture.state.calls, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.state.query.where)), {
    accountId: 'account-3',
    account: { projectId: 'project-7' },
    AND: [
      { OR: defaultPeriodKeys.map(key => {
        const [periodYear, periodMonth] = key.split('-').map(Number);
        return { periodYear, periodMonth };
      }) },
      { OR: [{ projectId: 'project-7' }, { projectId: null }] },
    ],
  });
  assert.equal(Object.hasOwn(fixture.state.query, 'take'), false);
  assert.equal(Object.hasOwn(fixture.state.query, 'skip'), false);
});

test('measurement scope excludes prior-project files after account reassignment but keeps unassigned legacy files', async () => {
  const fixture = measurementReader({ files: [
    { id: 'current', accountId: 'account-3', accountProjectId: 'project-7', projectId: 'project-7', periodYear: 2026, periodMonth: 1 },
    { id: 'legacy', accountId: 'account-3', accountProjectId: 'project-7', projectId: null, periodYear: 2026, periodMonth: 1 },
    { id: 'former-project', accountId: 'account-3', accountProjectId: 'project-7', projectId: 'project-6', periodYear: 2026, periodMonth: 1 },
  ] });

  const result = await fixture.read('account-3', 'project-7');
  assert.deepEqual(result.files.map((file: { id: string }) => file.id), ['current', 'legacy']);
});

test('coverage reuses May 2025 for missing May 2026 while exact-period failures remain visible only in portal files', async () => {
  const fixture = measurementReader({ files: [
    { id: 'failed-may-2026', accountId: 'account-3', accountProjectId: 'project-7', projectId: 'project-7', periodYear: 2026, periodMonth: 5, kind: 'ACTIVE_IMPORT', status: 'FAILED' },
    { id: 'ready-may-2025', accountId: 'account-3', accountProjectId: 'project-7', projectId: 'project-7', periodYear: 2025, periodMonth: 5, kind: 'ACTIVE_IMPORT', status: 'DOWNLOADED' },
    { id: 'wrong-kind-may-2025', accountId: 'account-3', accountProjectId: 'project-7', projectId: 'project-7', periodYear: 2025, periodMonth: 5, kind: 'REACTIVE_IMPORT', status: 'DOWNLOADED' },
  ] });

  const result = await fixture.read('account-3', 'project-7', { includeReusable: true });

  assert.deepEqual(result.files.map((file: MeasurementFixture) => file.id), ['failed-may-2026']);
  assert.deepEqual(result.coverageFiles.map((file: MeasurementFixture & { targetPeriod: string }) => [
    file.id, file.targetPeriod, file.periodYear, file.periodMonth,
  ]), [['ready-may-2025', '2026-05', 2025, 5]]);
  assert.equal(fixture.state.calls, 2);
  assert.equal(fixture.state.queries[1].where.status, 'DOWNLOADED');
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.state.queries[1].where.kind)), { in: ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'] });
});

test('coverage prefers an actual May 2025 file over the reusable May 2026 file', async () => {
  const fixture = measurementReader({
    periodKeys: ['2025-05'],
    files: [
      { id: 'real-may-2025', accountId: 'account-3', accountProjectId: 'project-7', projectId: 'project-7', periodYear: 2025, periodMonth: 5, kind: 'ACTIVE_IMPORT', status: 'DOWNLOADED' },
      { id: 'later-may-2026', accountId: 'account-3', accountProjectId: 'project-7', projectId: 'project-7', periodYear: 2026, periodMonth: 5, kind: 'ACTIVE_IMPORT', status: 'DOWNLOADED' },
    ],
  });

  const result = await fixture.read('account-3', 'project-7', { includeReusable: true });

  assert.deepEqual(result.files.map((file: MeasurementFixture) => file.id), ['real-may-2025']);
  assert.deepEqual(result.coverageFiles.map((file: MeasurementFixture & { targetPeriod: string }) => [file.id, file.targetPeriod, file.periodYear]), [
    ['real-may-2025', '2025-05', 2025],
  ]);
});

test('coverage keeps account and file project boundaries across years', async () => {
  const fixture = measurementReader({ files: [
    { id: 'current-project-file', accountId: 'account-3', accountProjectId: 'project-7', projectId: 'project-7', periodYear: 2025, periodMonth: 5, kind: 'ACTIVE_IMPORT', status: 'DOWNLOADED' },
    { id: 'former-project-file', accountId: 'account-3', accountProjectId: 'project-7', projectId: 'project-6', periodYear: 2025, periodMonth: 5, kind: 'ACTIVE_IMPORT', status: 'DOWNLOADED' },
    { id: 'other-account-file', accountId: 'account-4', accountProjectId: 'project-7', projectId: 'project-7', periodYear: 2025, periodMonth: 5, kind: 'ACTIVE_IMPORT', status: 'DOWNLOADED' },
  ] });

  const result = await fixture.read('account-3', 'project-7', { includeReusable: true });

  assert.deepEqual(result.coverageFiles.map((file: MeasurementFixture) => file.id), ['current-project-file']);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.state.queries[1].where)), {
    accountId: 'account-3',
    account: { projectId: 'project-7' },
    status: 'DOWNLOADED',
    operator: 'ENEA',
    kind: { in: ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'] },
    AND: [{ OR: [{ projectId: 'project-7' }, { projectId: null }] }],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.state.queries[1].select)), {
    kind: true, status: true, periodYear: true, periodMonth: true, dataSource: true,
  }, 'coverage must not expose document or storage metadata');
});

test('missing analysis project fails before querying measurement files', async () => {
  const fixture = measurementReader({ missingProject: true });
  await assert.rejects(() => fixture.read('account-3', 'project-7'), /Nie znaleziono projektu okresu analizy/u);
  assert.equal(fixture.state.calls, 0);
});

test('RE sync re-reads the selected period after locking the project and uses it for upload validation', () => {
  const syncPath = path.resolve(__dirname, './re-consumption-sync.ts');
  const source = readFileSync(syncPath, 'utf8');
  const lockIndex = source.indexOf('const locked = await lockProject(tx, loaded.clientId, project.id)');
  const lockedPeriodIndex = source.indexOf('const lockedPeriodResult = await readProjectAnalysisPeriod(project.id)', lockIndex);
  const storedValidationIndex = source.indexOf('inspectStoredMeasurement(current, new Date(), lockedPeriodResult.period.periodKeys)', lockedPeriodIndex);
  const preflightIndex = source.indexOf('preflightReConsumptionWorkbook({ station, workbook, replaceExisting: options.replaceExisting }, { periodKeys: lockedPeriodResult.period.periodKeys })', storedValidationIndex);
  const uploadIndex = source.indexOf('uploadReConsumptionWorkbook({ station, bytes, fileName, replaceExisting: options.replaceExisting }, { periodKeys: lockedPeriodResult.period.periodKeys })', preflightIndex);

  assert.ok(lockIndex >= 0, 'project lock must be acquired');
  assert.ok(lockedPeriodIndex > lockIndex, 'effective period must be re-read after acquiring the lock');
  assert.ok(storedValidationIndex > lockedPeriodIndex, 'stored XLSX must be checked against the locked period');
  assert.ok(preflightIndex > storedValidationIndex, 'RE same-month preflight must use the locked period');
  assert.ok(uploadIndex > preflightIndex, 'RE upload must retain the locked-period validation');
});
