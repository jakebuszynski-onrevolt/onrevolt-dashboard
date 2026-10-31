import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveProjectAnalysisPeriod } from '../../lib/onrevolt/project-analysis-period';

(require as any).extensions['.css'] = (module: any) => {
  module.exports = { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
};

test('wybór początku pokazuje 12 miesięcy i koniec w maju kolejnego roku', async () => {
  const { default: Period } = await import('./ClientAnalysisPeriod');
  const period = resolveProjectAnalysisPeriod('2023-06');
  const html = renderToStaticMarkup(createElement(Period, { state: {
    source: { projectId: 'test', storedStartMonth: '2023-06', period }, period,
    loading: false, saving: false, error: '', reload() {}, async change() {},
  } }));
  assert.match(html, /Początek analizowanego okresu/);
  assert.match(html, /type="month"/);
  assert.match(html, /value="2023-06"/);
  assert.match(html, /12 miesięcy · do 2024-05-31/);
});

test('odczyt okresu nie wyświetla dat poprzedniego projektu i blokuje edycję', async () => {
  const { default: Period } = await import('./ClientAnalysisPeriod');
  const html = renderToStaticMarkup(createElement(Period, { state: {
    source: null, period: undefined, loading: true, saving: false, error: '', reload() {}, async change() {},
  } }));
  assert.match(html, /Odczytywanie okresu/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /12 miesięcy · do/);
});

test('zapis zmiany okresu pokazuje postęp zamiast starej daty końca', async () => {
  const { default: Period } = await import('./ClientAnalysisPeriod');
  const period = resolveProjectAnalysisPeriod('2023-06');
  const html = renderToStaticMarkup(createElement(Period, { state: {
    source: { projectId: 'test', storedStartMonth: '2023-06', period }, period,
    loading: false, saving: true, error: '', reload() {}, async change() {},
  } }));
  assert.match(html, /Zmieniam okres analizy/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /12 miesięcy · do/);
});
