import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(require as any).extensions['.css'] = (module: any) => {
  module.exports = {
    __esModule: true,
    default: new Proxy({}, { get: (_target, key) => String(key) }),
  };
};

test('panel SSR keeps the calculation choice at the existing RE default and leaves comparison empty', async () => {
  const { default: Comparison } = await import('./ReferenceProfileComparison');
  const html = renderToStaticMarkup(createElement(Comparison, { annualKwh: 4321.5 }));
  assert.match(html, /Porównanie profili zużycia/);
  assert.match(html, /4.?321,5/);
  assert.match(html, /Żadna nie jest zaznaczona automatycznie/);
  assert.match(html, /Profil do obliczeń RE/);
  assert.match(html, /Dotychczasowy profil domyślny RE/);
  assert.match(html, /Porównanie do 6 profili pozostaje podglądem/);
  assert.match(html, /miesiąc × dzień roboczy\/weekend × godzina/);
  assert.match(html, /Dostępne pomiary rzeczywiste nadal mają pierwszeństwo/);
  assert.match(html, /nie są prognozą rzeczywistego poboru z sieci ani pełnego zużycia budynku/);
  assert.doesNotMatch(html, /3000/);
  assert.doesNotMatch(html, /checked=/);
  assert.doesNotMatch(html, /type="radio"/);
  assert.match(html, /disabled=""[^>]*>Zapisz profil i zużycie roczne/);
});

test('initial SSR with a project waits for the persisted selection instead of assigning the RE default', async () => {
  const { default: Comparison } = await import('./ReferenceProfileComparison');
  const html = renderToStaticMarkup(createElement(Comparison, { annualKwh: 4321.5, projectId: 'project-1' }));
  assert.match(html, /Wczytywanie zapisanego wyboru/);
  assert.match(html, /value="__loading__"/);
  assert.doesNotMatch(html, /Dotychczasowy profil domyślny RE/);
  assert.match(html, /disabled=""[^>]*>Zapisz profil i zużycie roczne/);
});

test('panel SSR asks for annual energy when the supplied value is invalid', async () => {
  const { default: Comparison } = await import('./ReferenceProfileComparison');
  const html = renderToStaticMarkup(createElement(Comparison, { annualKwh: Number.NaN }));
  assert.match(html, /Uzupełnij dodatnie roczne zużycie/);
  assert.match(html, /Porównanie nie podstawia wartości domyślnej/);
  assert.match(html, /Dotychczasowy profil domyślny RE/);
  assert.match(html, /Do zapisu podaj dodatnie roczne zużycie/);
  assert.doesNotMatch(html, /Roczne zużycie przyjęte do porównania/);
});
