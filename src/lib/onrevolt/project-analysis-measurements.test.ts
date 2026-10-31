import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const helperPath = path.resolve(__dirname, './project-analysis-measurements.ts');
const helperCode = ts.transpileModule(readFileSync(helperPath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: helperPath,
}).outputText;
const periodKeys = Array.from({ length: 12 }, (_, index) => {
  const date = new Date(Date.UTC(2025, 9 + index, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
});

type MeasurementFixture = { id: string; accountId: string; accountProjectId: string; projectId: string | null; periodYear: number; periodMonth: number };

function measurementReader(options: { missingProject?: boolean; fileCount?: number; files?: MeasurementFixture[] } = {}) {
  const state: { query?: any; calls: number } = { calls: 0 };
  const modules: Record<string, unknown> = {
    './prisma': {
      prisma: {
        energyMeasurementFile: {
          findMany: async (query: any) => {
            state.calls += 1;
            state.query = query;
            const fixtures = options.files ?? Array.from({ length: options.fileCount ?? 0 }, (_, index) => ({
              id: `file-${index}`, accountId: 'account-3', accountProjectId: 'project-7', projectId: 'project-7',
              periodYear: 2026, periodMonth: 1,
            }));
            const periodFilter = query.where.AND.find((entry: any) => entry.OR?.[0]?.periodYear !== undefined);
            const projectFilter = query.where.AND.find((entry: any) => entry.OR?.some((condition: any) => Object.hasOwn(condition, 'projectId')));
            return fixtures.filter(file => file.accountId === query.where.accountId
              && file.accountProjectId === query.where.account.projectId
              && projectFilter.OR.some((condition: any) => condition.projectId === file.projectId)
              && periodFilter.OR.some((period: any) => period.periodYear === file.periodYear && period.periodMonth === file.periodMonth))
              .map(({ id }) => ({ id }));
          },
        },
      },
    },
    './project-analysis-period-server': {
      readProjectAnalysisPeriod: async (projectId: string) => {
        assert.equal(projectId, 'project-7');
        return options.missingProject ? null : {
          projectId,
          storedStartMonth: '2025-10',
          period: { startMonth: '2025-10', endMonth: '2026-09', periodKeys },
        };
      },
    },
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
  assert.deepEqual(result.period.periodKeys, periodKeys);
  assert.equal(fixture.state.calls, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.state.query.where)), {
    accountId: 'account-3',
    account: { projectId: 'project-7' },
    AND: [
      { OR: periodKeys.map(key => {
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
