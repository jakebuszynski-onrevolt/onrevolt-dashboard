import assert from 'node:assert/strict';
import test from 'node:test';
import { offerTariffCatalogKey, resolveCurrentOfferTariff } from './offer-workspace-tariffs';
import type { ClientTariffPayload, ClientTariffPeriod } from './client-tariffs';

const period = (patch: Partial<ClientTariffPeriod> = {}): ClientTariffPeriod => ({
  id: '12345678-1234-1234-1234-123456789012',
  validFrom: '2026-01-01',
  validUntil: '2027-01-01',
  osdId: 4,
  tariffId: 12,
  source: 'MANUAL',
  overrides: {},
  schedule: null,
  note: '',
  ...patch,
});

test('bieżące stawki pochodzą wyłącznie z okresu historycznego obowiązującego w podanej dacie', () => {
  const historicalPeriod = period();
  const tariff = { code: 'C12', pricing: { tariffStorage: { validFrom: '2026-01-01' } } } as unknown as ClientTariffPayload;
  const result = resolveCurrentOfferTariff({
    periods: [historicalPeriod],
    resolved: { [historicalPeriod.id]: { ok: true, tariff } },
  }, '2026-10-29');

  assert.equal(result.period, historicalPeriod);
  assert.equal(result.state.status, 'ready');
  if (result.state.status === 'ready') assert.equal(result.state.tariff, tariff);
});

test('brak rozwiązania dla okresu historycznego nie podstawia taryfy scenariusza', () => {
  const historicalPeriod = period();
  const result = resolveCurrentOfferTariff({
    periods: [historicalPeriod],
    resolved: { [historicalPeriod.id]: { ok: false, error: 'Brak cen dla okresu.' } },
  }, '2026-10-29');

  assert.equal(result.period, historicalPeriod);
  assert.deepEqual(result.state, { status: 'unavailable', message: 'Brak cen dla okresu.' });
});

test('granica okresu historycznego jest wyłączna, a brak historii jawny', () => {
  const result = resolveCurrentOfferTariff({ periods: [period()], resolved: {} }, '2027-01-01');

  assert.equal(result.hasHistory, true);
  assert.equal(result.period, null);
  assert.equal(result.state.status, 'unavailable');
});

test('luka w istniejącej historii pozostaje brakiem bieżącej taryfy', () => {
  const result = resolveCurrentOfferTariff({ periods: [period({ validUntil: '2026-10-01' })], resolved: {} }, '2026-10-29');

  assert.equal(result.hasHistory, true);
  assert.equal(result.period, null);
  assert.deepEqual(result.state, { status: 'unavailable', message: 'Brak potwierdzonej taryfy historycznej dla bieżącej daty.' });
});

test('klucz pobrania cen katalogowych wiąże operatora, taryfę i datę', () => {
  assert.equal(offerTariffCatalogKey(4, 12, '2026-10-29'), '4:12:2026-10-29');
  assert.equal(offerTariffCatalogKey(null, 12, '2026-10-29'), null);
});
