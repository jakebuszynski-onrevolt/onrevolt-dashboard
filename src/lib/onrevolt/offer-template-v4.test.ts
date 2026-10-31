import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import {
  inspectOfferTemplateV4,
  OFFER_TEMPLATE_V4_KEY,
  OFFER_TEMPLATE_V4_PAGE_COUNT,
  renderOfferTemplateV4Page,
} from './offer-template-v4';

const templateRoot = path.join(process.cwd(), 'assets', 'offer-templates', 'REFORM_B2C', '2026_10_V4');

function hash(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function parseSvg(svg: string) {
  const errors: string[] = [];
  const document = new DOMParser({ onError: (level, message) => {
    if (level === 'error' || level === 'fatalError') errors.push(`${level}: ${message}`);
  } }).parseFromString(svg, 'image/svg+xml');
  assert.deepEqual(errors, []);
  return document;
}

test('V4 manifest pins all ten original SVGs, geometry, and explicit hash fields', () => {
  const manifest = inspectOfferTemplateV4();
  assert.equal(manifest.key, OFFER_TEMPLATE_V4_KEY);
  assert.equal(manifest.pageCount, OFFER_TEMPLATE_V4_PAGE_COUNT);
  assert.equal(manifest.pages.length, 10);
  const allFieldIds: string[] = [];

  for (const page of manifest.pages) {
    const source = fs.readFileSync(path.join(templateRoot, page.file));
    const root = parseSvg(source.toString('utf8')).documentElement!;
    assert.equal(hash(source), page.sourceSha256, page.file);
    assert.equal(root.getAttribute('width'), String(page.width));
    assert.equal(root.getAttribute('height'), String(page.height));
    assert.equal(root.getAttribute('viewBox'), page.viewBox);
    assert.ok(page.fields.length > 0, `strona ${page.page} ma pola V4`);
    assert.ok(page.fields.every((field) => field.id.startsWith('#b2c_')
      && field.id.match(/_strona_(\d{2})(?:_\d+)?$/)?.[1] === String(page.page).padStart(2, '0')));
    const sourceFieldIds = Array.from(root.getElementsByTagName('*'))
      .map((element) => element.getAttribute('id'))
      .filter((id) => /^#b2c_.+_strona_\d{2}(?:_\d+)?$/.test(id))
      .sort();
    assert.deepEqual(page.fields.map((field) => field.id).sort(), sourceFieldIds, `manifest obejmuje wszystkie pola strony ${page.page}`);
    assert.equal(new Set(page.fields.map((field) => field.id)).size, page.fields.length);
    assert.equal(new Set(page.fields.map((field) => field.selector)).size, page.fields.length);
    assert.equal(new Set(page.semanticGroups.map((group) => group.id)).size, page.semanticGroups.length);
    allFieldIds.push(...page.fields.map((field) => field.id));
  }
  assert.equal(new Set(allFieldIds).size, allFieldIds.length);
});

test('duplicate decorative IDs on pages 5-8 do not make #b2c fields or semantic panels ambiguous', () => {
  const manifest = inspectOfferTemplateV4();
  for (const pageNumber of [5, 6, 7, 8] as const) {
    const page = manifest.pages[pageNumber - 1];
    const source = fs.readFileSync(path.join(templateRoot, page.file), 'utf8');
    const document = parseSvg(source);
    const ids = Array.from(document.getElementsByTagName('*'))
      .map((element) => element.getAttribute('id'))
      .filter(Boolean);
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    const duplicates = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
    const duplicateOccurrences = [...counts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
    assert.equal(duplicateOccurrences, 396, `strona ${pageNumber} ma 396 powtórzonych wystąpień dekoracyjnych ID`);
    assert.ok(duplicates.every((id) => !id.startsWith('#b2c_') && !/^(?:sekcja|blok|grafika)\s*\//i.test(id)));

    const currentPanel = Array.from(document.getElementsByTagName('*'))
      .find((element) => element.getAttribute('id') === 'sekcja / stan_aktualny');
    const currentPlot = Array.from(currentPanel?.getElementsByTagName('*') || [])
      .filter((element) => element.getAttribute('id') === 'Group 1298_2');
    const futurePlot = Array.from(document.getElementsByTagName('*'))
      .filter((element) => element.getAttribute('id') === 'Group 1298');
    assert.equal(currentPlot.length, 1, 'wykres bieżący jest zakotwiczony w sekcji semantycznej');
    assert.equal(futurePlot.length, 1, 'wykres przyszły ma odrębny, jednoznaczny cel');
  }
});

test('V4 renderer requires every semantic field and replaces text without changing page geometry', () => {
  const manifest = inspectOfferTemplateV4().pages[9];
  const values = Object.fromEntries(manifest.fields.map((field) => [field.id, 'Pole wypełnione']));
  const missingKey = manifest.fields[0].id;
  assert.throws(() => renderOfferTemplateV4Page(10, Object.fromEntries(Object.entries(values).slice(1))), new RegExp(missingKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const file = path.join(templateRoot, manifest.file);
  const before = fs.readFileSync(file);
  const rendered = renderOfferTemplateV4Page(10, values);
  const root = parseSvg(rendered.svg).documentElement!;
  assert.equal(root.getAttribute('width'), String(manifest.width));
  assert.equal(root.getAttribute('height'), String(manifest.height));
  assert.equal(root.getAttribute('viewBox'), manifest.viewBox);
  assert.equal(hash(fs.readFileSync(file)), hash(before), 'asset źródłowy pozostaje bez zmian');
  assert.equal(rendered.replacedFieldIds.length, manifest.fields.length);
  assert.ok(rendered.svg.includes('Pole wypełnione'));
  assert.ok(!rendered.svg.includes('Dyness Stack 314 16.07 kWh'), 'przykładowy model nie pozostaje po podmianie wszystkich pól');
});
