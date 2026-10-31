import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as projectAnalysisPeriod from './project-analysis-period';

const helperPath = path.resolve(__dirname, './project-analysis-period-server.ts');
const helperCode = ts.transpileModule(readFileSync(helperPath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: helperPath,
}).outputText;

function fixture(rows: Array<{ analysisStartMonth: string | null }>) {
  let query = '';
  let values: unknown[] = [];
  const modules: Record<string, unknown> = {
    './prisma': {
      prisma: {
        $queryRaw: async (strings: TemplateStringsArray, ...params: unknown[]) => {
          query = strings.join('?');
          values = params;
          return rows;
        },
      },
    },
    './project-analysis-period': projectAnalysisPeriod,
  };
  const exports: any = {};
  vm.runInNewContext(helperCode, {
    exports,
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected helper import: ${name}`);
      return modules[name];
    },
  });
  return { read: exports.readProjectAnalysisPeriod, getQuery: () => query, getValues: () => values };
}

test('server helper reads only the selected month with a parameterized project id', async () => {
  const state = fixture([{ analysisStartMonth: '2025-10' }]);
  const result = await state.read('project-id', new Date('2026-10-30T12:00:00.000Z'));

  assert.equal(state.getQuery().trim(), 'SELECT analysisStartMonth FROM Project WHERE id = ? LIMIT 1');
  assert.deepEqual(state.getValues(), ['project-id']);
  assert.equal(result.projectId, 'project-id');
  assert.equal(result.storedStartMonth, '2025-10');
  assert.equal(result.period.endMonth, '2026-09');
});

test('server helper preserves null legacy value and returns null for a missing project', async () => {
  const legacy = fixture([{ analysisStartMonth: null }]);
  const result = await legacy.read('project-id', new Date('2026-10-30T12:00:00.000Z'));
  assert.equal(result.storedStartMonth, null);
  assert.equal(result.period.startMonth, '2025-10');

  const missing = fixture([]);
  assert.equal(await missing.read('missing-project'), null);
});
