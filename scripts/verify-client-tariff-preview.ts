import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = process.argv[2];
if (!root) throw new Error('Podaj katalog wygenerowanego dashboardu.');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const source = read('js/scripts.js');
for (const file of ['js/scripts.js', 'js/client-tariff-preview.js', 're/pricing/dashboard-pricing.js']) new vm.Script(read(file), { filename: file });
const ast = ts.createSourceFile('dashboard.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function declaration(name: string) {
  const matches: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(matches.length, 1, name); return matches[0];
}
const context: any = vm.createContext({ console }); context.window = context;
vm.runInContext(readFileSync('public/shared/re-tariff-engine.js', 'utf8') + readFileSync('integrations/re/client-tariff-browser.js', 'utf8'), context);
vm.runInContext(read('js/client-tariff-preview.js'), context);
vm.runInContext(read('re/pricing/dashboard-pricing.js'), context);
const preview = context.ClientTariffPreview;
const real = { osd_id: 1, tariff_id: 27, code: 'G13active', segment: 'household', zone_model: 'all', variable: [{ label: 'Energia czynna', window_code: 'all', price: 0.4 }], fixed: [] };
const other = { ...real, tariff_id: 1, code: 'G11', variable: [{ label: 'Energia czynna', window_code: 'all', price: 0.8 }] };
const data = { account: { station: 'fixture', tariffSettings: { current: { osdId: 1, tariffId: 1 }, target: { osdId: 1, tariffId: 27 } } },
  tariffData: { current: real, next: other, catalog: { operators: [{ id: 1, name: 'ENEA', tariffs: [{ id: 1, detail: other }] }] } },
  tariffHistory: { strict: true, byDate: { '2026-09-27': real } } };
let projected = preview.project(data);
context.updateDashboardPayload = (input: unknown) => { projected = preview.project(input); };
for (const name of ['getPurchaseTariff', 'getDepositTariff', 'readCurrentFormSettings']) vm.runInContext(declaration(name), context);
assert.equal(context.getPurchaseTariff(projected).clientTariffHistory, data.tariffHistory);
preview.choose('catalog:1:1');
assert.equal(context.getPurchaseTariff(projected), other);
assert.equal(context.getDepositTariff(projected), other);
assert.equal(context.ReTariffEngine.rates(context.getPurchaseTariff(projected), '2026-09-27', 12, 0).energy, 0.8);
assert.equal(context.ReTariffEngine.rates(context.ReTariffEngine.resolve(projected.tariffHistory, '2026-09-27'), '2026-09-27', 12, 0).energy, 0.4);
context.fields = { locationLabel: { value: 'Test' }, annualUsage: { value: '6500' }, targetTariff: { value: '1' } };
const saved = context.readCurrentFormSettings();
assert.equal(saved.targetTariffId, 27); assert.equal(saved.currentTariffId, 1); assert.equal(saved.annualUsageKwh, '6500');
preview.choose('real');
assert.equal(context.DashboardPricing.projectReResponse({ ok: true, data: { ...real, variable: other.variable } }, true).data, real);
assert.ok(source.includes('!payload.clientTariffPreview && !useForecastRange && hasMeasuredUsageSplit'));
assert.ok(source.includes('clientTariffPreview: payload.clientTariffPreview === true'));
assert.ok(source.includes('window.ClientTariffPreview.cacheKey()'));
assert.ok(read('index.html').indexOf('src="js/client-tariff-preview.js?') < read('index.html').indexOf('src="js/scripts.js?'));
const withoutHistory = { ...data, tariffHistory: null, tariffData: { ...data.tariffData, current: other, next: real } };
preview.project(withoutHistory); preview.choose('catalog:1:1');
context.getCatalogOperators = (p: any) => p.tariffData.catalog.operators;
context.getAccountTariffSettings = (p: any) => ({ currentOperatorId: p.account.tariffSettings.current.osdId, currentTariffId: p.account.tariffSettings.current.tariffId,
  targetOperatorId: p.account.tariffSettings.target.osdId, targetTariffId: p.account.tariffSettings.target.tariffId });
context.fillSelect = (field: any, _options: unknown, id: unknown) => { field.value = String(id); };
context.populateTariffSelect = (_p: unknown, _o: unknown, field: any, id: unknown) => { field.value = String(id); };
context.fields = { currentOperator: {}, currentTariff: {}, targetOperator: {}, targetTariff: {}, annualUsage: { value: '6500' } };
vm.runInContext(declaration('populateTariffs'), context);
context.populateTariffs({}, projected);
assert.equal(context.fields.targetTariff.value, '27');
assert.equal(context.readCurrentFormSettings().targetTariffId, '27');
context.fields.targetTariff.value = '23';
assert.equal(context.readCurrentFormSettings().targetTariffId, '23');
preview.choose('real'); assert.equal(projected.tariffData.next, real);
console.log('Preview integration: syntax, prices, real history, settings persistence, native RE, cache invalidation OK');
