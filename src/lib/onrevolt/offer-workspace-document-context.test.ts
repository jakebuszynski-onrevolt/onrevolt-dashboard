import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const filename = path.resolve(__dirname, 'offer-workspace-document-context.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exportsContext: any = {};
vm.runInNewContext(code, { exports: exportsContext, require: () => ({}) });
const labels = exportsContext.offerDocumentTariffLabels;
const data: any = {
  catalog: [{ id: 1, name: 'ENEA', tariffs: [{ id: 1, code: 'G11' }, { id: 27, code: 'G13active' }] }],
  generalTariff: { operator: 'ENEA', code: 'G11' }, profile: null,
};
const period = { startMonth: '2025-06', endDate: '2026-05-31' };
const draft = { targetOperatorId: 1, targetTariffId: 27 };

test('document names general current tariff and actual selected target, not raw IDs', () => {
  assert.equal(JSON.stringify(labels(data, period, draft)), JSON.stringify({ current: 'G11', currentOperator: 'ENEA', proposed: 'G13active' }));
});

test('history names only tariffs intersecting analysis period and preserves change order', () => {
  const history = { ...data, profile: { periods: [
    { osdId: 1, tariffId: 1, validFrom: '2025-06-01', validUntil: '2026-01-01' },
    { osdId: 1, tariffId: 27, validFrom: '2026-01-01', validUntil: '2026-06-01' },
    { osdId: 1, tariffId: 999, validFrom: '2026-06-01', validUntil: null },
  ] } };
  assert.equal(labels(history, period, draft).current, 'G11 / G13active');
  assert.equal(labels(history, period, draft).currentOperator, 'ENEA');
});

test('missing history coverage or unknown IDs do not fall back to general/current target', () => {
  const history = { ...data, profile: { periods: [{ osdId: 1, tariffId: 999, validFrom: null, validUntil: null }] } };
  assert.equal(labels(history, period, draft).current, null);
  assert.equal(labels(data, period, { targetOperatorId: 1, targetTariffId: 999 }).proposed, null);
  history.profile.periods[0] = { osdId: 1, tariffId: 1, validFrom: '2026-06-01', validUntil: null } as any;
  assert.equal(labels(history, period, draft).current, null);
});
