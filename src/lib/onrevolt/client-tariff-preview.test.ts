import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const createPreview = createRequire(import.meta.url)('../../../integrations/re/client-tariff-preview.js');
const real = { osd_id: 1, tariff_id: 27, code: 'G13active', custom: 'customer-override', variable: [{ price: 0.4 }] };
const catalog = { osd_id: 1, tariff_id: 1, code: 'G11', variable: [{ price: 0.6 }] };
const history = { strict: true, byDate: { '2026-09-27': real } };
function payload(station = '41') { return { account: { station, tariffSettings: { current: { osdId: 1, tariffId: 1 }, target: { osdId: 1, tariffId: 27 } } },
  tariffHistory: history, tariffData: { current: real, next: catalog, catalog: { operators: [{ id: 1, name: 'ENEA', tariffs: [{ id: 1, detail: catalog }] }] } }, energy: { station } }; }
test('real preview uses the CRM snapshot including individual prices, not the catalog duplicate', () => {
  const state = createPreview({}), source = payload();
  const result = state.project(source);
  assert.equal(result.tariffData.next, real);
  assert.equal(result.tariffHistory, history);
  assert.equal(result.clientTariffPreview, false);
  assert.equal(source.tariffData.next, catalog);
});
test('testing a tariff changes only the projected target and preserves actual history and persisted settings', () => {
  const root: any = {}, state = createPreview(root), source = payload(), serialized = JSON.stringify(source);
  let result: any; root.updateDashboardPayload = (data: unknown) => { result = state.project(data); };
  state.project(source); state.choose('catalog:1:1');
  assert.equal(result.tariffData.next, catalog); assert.equal(result.clientTariffPreview, true);
  assert.equal(result.tariffHistory, history); assert.equal(result.tariffData.current, real);
  assert.deepEqual(state.savedTariffFields(), { currentOperatorId: 1, currentTariffId: 1, targetOperatorId: 1, targetTariffId: 27 });
  assert.equal(JSON.stringify(source), serialized);
  state.choose('real'); assert.equal(result.tariffData.next, real); assert.equal(result.clientTariffPreview, false);
});
test('incremental readings and refresh do not turn a temporary test into the actual tariff', () => {
  const state = createPreview({}); state.project(payload()); state.choose('catalog:1:1');
  assert.equal(state.project({ usageData: { records: [] } }, true).clientTariffPreview, true);
  assert.equal(state.project(payload()).tariffData.current, real);
  assert.equal(createPreview({}).project(payload()).clientTariffPreview, false);
  assert.equal(state.project(payload('42')).clientTariffPreview, false);
});
test('missing target selection stays missing; unavailable test prices cannot be silently substituted', () => {
  const state = createPreview({}), source = { account: { station: '41' }, tariffData: { current: catalog } };
  assert.equal(state.project(source), source); assert.deepEqual(state.savedTariffFields(), {});
  assert.equal(state.project(source).tariffData.next, undefined);
  assert.throws(() => state.choose('catalog:1:1'), /Brak kompletnych/);
  state.project(payload()); assert.throws(() => state.choose('catalog:1:99'), /Brak kompletnych/);
});

test('a station without CRM history can test tariffs and return to its saved RE simulation', () => {
  const source: any = payload(); delete source.tariffHistory;
  source.tariffData.current = catalog; source.tariffData.next = real;
  const root: any = {}, state = createPreview(root);
  let result: any; root.updateDashboardPayload = (data: unknown) => { result = state.project(data); };
  const unchanged = JSON.stringify(source);
  assert.equal(state.project(source), source);
  state.choose('catalog:1:1');
  assert.equal(result.tariffData.next, catalog); assert.equal(state.isTesting(), true);
  assert.equal(state.setupPayload(result), source);
  assert.equal(state.setupPayload(result).account.tariffSettings.target.tariffId, 27);
  assert.deepEqual(state.savedTariffFields(), {});
  assert.ok(state.cacheKey());
  state.project({ energy: { station: '41' } }, true);
  assert.equal(state.isTesting(), true);
  state.choose('real'); assert.equal(result.tariffData.next, real); assert.equal(state.isTesting(), false);
  assert.equal(JSON.stringify(source), unchanged);
  state.choose('catalog:1:1');
  assert.equal(createPreview({}).project(source).tariffData.next, real);
});

test('native RE uses the same custom rates as the dashboard and invalidates cached simulations', () => {
  const state = createPreview({}); state.project(payload());
  const catalogReal = { ...real, custom: null, variable: [{ price: 0.9 }] };
  const response = { ok: true, data: catalogReal };
  assert.equal(state.projectReResponse(response).data, real);
  const realKey = state.cacheKey();
  state.choose('catalog:1:1');
  assert.notEqual(state.cacheKey(), realKey);
  assert.equal(state.projectReResponse(response), response);
  state.choose('real'); assert.equal(state.cacheKey(), realKey);
  const updated = payload(); updated.tariffData.current = { ...real, variable: [{ price: 0.5 }] };
  state.project(updated); assert.notEqual(state.cacheKey(), realKey);
});

test('a gap in CRM history does not select the saved catalog target as the real tariff', () => {
  const source: any = payload(); source.tariffData.current = null;
  const state = createPreview({}), result = state.project(source);
  assert.equal(result.tariffData.next, null);
  assert.equal(result.clientTariffPreview, false);
  assert.equal(source.tariffData.next, catalog);
});
