import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(require as any).extensions['.css'] = (module: any) => {
  module.exports = { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
};

async function render(overrides: Record<string, unknown> = {}) {
  const { default: Component } = await import('./ClientEnergyPv');
  const state: any = {
    source: { projectId: 'p1', revision: 1, latitude: 0, longitude: 0,
      existingPv: { powerKw: 9.9, tiltDegrees: 0, azimuthDegrees: 0, lossPercent: 0 } },
    geometry: { tiltDegrees: '0', azimuthDegrees: '0', lossPercent: '0' }, setGeometry() {},
    loading: false, error: '', reload() {}, saveSettings() {}, saved() {}, calculating: false, complete: true,
    estimate: { key: 'fixture', data: { annualKwh: 9876, source: 'Model testowy', model: 'PV', fromUtc: '', untilUtc: '' } },
    ...overrides,
  };
  return renderToStaticMarkup(<Component power="9.9" onPowerChange={() => {}} state={state} />);
}

test('PV pokazuje geometrię, współrzędne zero i szacowaną produkcję, nie pomiar', async () => {
  const html = await render();
  for (const text of ['Nachylenie paneli', 'Azymut paneli', 'Założone straty PV', 'Lat ·', 'Lon ·', 'Roczna produkcja PV', 'nie pomiar z falownika']) assert.ok(html.includes(text));
  assert.match(html, /9\s*876/);
  assert.ok(!html.includes('Uzupełnij:'));
  assert.match(html, /readOnly=""[^>]*value="0"/);
  assert.ok(!html.includes('Model testowy'));
  const href = html.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
  assert.ok(href);
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, 'https://my.onrevolt.com/pv/');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    mode: 'manual', layout: 'single', lat: '0', lon: '0', capacityKwp: '9.9', tilt: '0', azimuth: '0', lossPercent: '0',
  });
});

test('nie wyświetla wymyślonej produkcji dla brakujących współrzędnych', async () => {
  const html = await render({ source: null, estimate: null });
  assert.match(html, /Uzupełnij: współrzędne w Danych klienta/);
  assert.ok(!html.includes('9 876'));
  assert.ok(!html.includes('href='));
});
