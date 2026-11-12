import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ClientMeasurementCoverage, { measurementCoverageRows, type MeasurementCoverageFile } from './ClientMeasurementCoverage';

const source = (kind: string, year = 2026): MeasurementCoverageFile => ({
  kind, status: 'DOWNLOADED', periodYear: year, periodMonth: 5, targetPeriod: '2025-05', dataSource: 'Plik XLSX od klienta',
});
const render = (files: MeasurementCoverageFile[]) => renderToStaticMarkup(
  React.createElement(ClientMeasurementCoverage, { rows: measurementCoverageRows(files, ['2025-05']) }));

test('maj 2025 pokazuje dostępność poboru i oddania z żółtą informacją dane 2026', () => {
  const html = render([source('ACTIVE_IMPORT'), source('ACTIVE_EXPORT')]);
  assert.match(html, /05\.2025/);
  assert.match(html, /data-ready="true" data-estimated="true"/);
  assert.match(html, /Pobór dostępny/);
  assert.match(html, /Oddanie dostępne/);
  assert.match(html, />dane 2026</);
  assert.doesNotMatch(html, /Brak poboru/);
});

test('pomiar z właściwego roku pozostaje rzeczywisty, a opis wskazuje oddanie z innego roku', () => {
  const html = render([source('ACTIVE_IMPORT', 2025), source('ACTIVE_EXPORT')]);
  assert.match(html, /Oddanie: dane 2026/);
  assert.doesNotMatch(html, /Pobór: dane/);
  const actual = render([source('ACTIVE_IMPORT', 2025), source('ACTIVE_EXPORT', 2025)]);
  assert.match(actual, /data-estimated="false"/);
  assert.doesNotMatch(actual, /energy-coverage-note/);
});

test('uzupełnienia modelowe mają etykietę i nie udają w całości pomiarów', () => {
  const html = render([{ ...source('ACTIVE_IMPORT', 2025), dataSource: 'Model CRM — 336 godzin uzupełnionych' }]);
  assert.match(html, /uzupełniono szacunkiem/);
  assert.match(html, /336 godzin uzupełnionych/);
  assert.match(html, /Brak oddania/);
});

test('nieudany plik i plik innego miesiąca nie zwiększają dostępności', () => {
  const files = [{ ...source('ACTIVE_IMPORT'), status: 'FAILED' }, { ...source('ACTIVE_EXPORT'), targetPeriod: '2025-06' }];
  const rows = measurementCoverageRows(files, ['2025-05']);
  assert.equal(rows.filter(row => row.importFile).length, 0);
  assert.match(render(files), /Brak poboru/);
  assert.match(render(files), /Brak oddania/);
});
