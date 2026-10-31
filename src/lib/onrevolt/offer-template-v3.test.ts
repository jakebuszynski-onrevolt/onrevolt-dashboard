import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import {
  OFFER_TEMPLATE_V3_KEY,
  OFFER_TEMPLATE_V3_LIMITATIONS,
  inspectOfferTemplateV3,
  renderOfferTemplateV3Page,
  type OfferTemplateV3PageNumber,
} from './offer-template-v3';

const templateRoot = path.join(
  process.cwd(),
  'assets',
  'offer-templates',
  'REFORM_B2C',
  '2026_10_V3',
);

function hash(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function completeValues(page: OfferTemplateV3PageNumber, value = 'Przykładowa wartość testowa') {
  const manifest = inspectOfferTemplateV3().pages[page - 1];
  return Object.fromEntries(
    manifest.textBindings
      .filter((binding) => binding.dynamic)
      .map((binding) => [binding.fieldKey!, value]),
  );
}

function parseSvg(svg: string) {
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (level, message) => {
    if (level === 'error' || level === 'fatalError') errors.push(`${level}: ${message}`);
  } }).parseFromString(svg, 'image/svg+xml');
  assert.deepEqual(errors, []);
  return doc;
}

test('v3 manifest is ten source-hashed SVGs with original page geometry', () => {
  const manifest = inspectOfferTemplateV3();
  assert.equal(manifest.key, OFFER_TEMPLATE_V3_KEY);
  assert.equal(manifest.pageCount, 10);
  assert.equal(manifest.pages.length, 10);
  assert.equal(manifest.fontFamily, 'DM Sans');

  for (const page of manifest.pages) {
    const source = fs.readFileSync(path.join(templateRoot, page.file));
    const doc = parseSvg(source.toString('utf8'));
    const root = doc.documentElement!;
    assert.equal(hash(source), page.sourceSha256);
    assert.equal(root.getAttribute('width'), String(page.width));
    assert.equal(root.getAttribute('height'), String(page.height));
    assert.equal(root.getAttribute('viewBox'), page.viewBox);
    assert.ok(page.textBindings.length > 0, `strona ${page.page} ma tekst`);
    assert.ok(page.textBindings.some((binding) => binding.dynamic), `strona ${page.page} ma dynamiczne pola`);
    assert.equal(
      new Set(page.textBindings.map((binding) => binding.selector)).size,
      page.textBindings.length,
      `selektory tekstu strony ${page.page} są unikalne`,
    );
    assert.equal(
      new Set(page.groupBindings.map((binding) => binding.selector)).size,
      page.groupBindings.length,
      `selektory grup strony ${page.page} są unikalne`,
    );
    assert.ok(page.textBindings.every((binding) => !('sourceText' in binding)), 'manifest nie ujawnia treści wzorcowych');
    assert.ok(page.groupBindings.every((group) => group.scope === 'text-only'));
  }
});

test('dynamic inventory covers client fields, prose, monthly charts, prices, and product rows', () => {
  const pages = inspectOfferTemplateV3().pages;
  const hasDynamicHint = (page: number, predicate: (hint: string) => boolean) =>
    pages[page - 1].textBindings.some((binding) => binding.dynamic && binding.idHints.some(predicate));

  assert.ok(hasDynamicHint(1, (hint) => hint === '#numer_oferty'));
  assert.ok(hasDynamicHint(2, (hint) => hint.includes('_opis_oferty_opis')));
  assert.ok(hasDynamicHint(3, (hint) => /^XXX(?:_\d+)?$/i.test(hint)));
  assert.ok(hasDynamicHint(5, (hint) => hint.toLowerCase().includes('adres')));
  assert.ok(hasDynamicHint(9, (hint) => hint.toLowerCase().includes('rachunek')));
  assert.ok(hasDynamicHint(10, (hint) => hint.toLowerCase().includes('nazwa_modelu')));
  assert.ok(hasDynamicHint(10, (hint) => hint.toLowerCase().includes('cena_jednostkowa')));
  assert.ok(pages[0].textBindings.some((binding) => binding.fieldKey?.includes('numer-oferty')));
});

test('renderer requires every non-empty dynamic value and rejects unknown keys', () => {
  const manifest = inspectOfferTemplateV3().pages[0];
  const key = manifest.textBindings.find((binding) => binding.dynamic)!.fieldKey!;
  assert.throws(() => renderOfferTemplateV3Page(1, {}), new RegExp(key));

  const values = completeValues(1);
  const firstKey = Object.keys(values)[0];
  assert.throws(() => renderOfferTemplateV3Page(1, { ...values, [firstKey]: '  ' }), /Puste dynamiczne wartości/);
  assert.throws(() => renderOfferTemplateV3Page(1, { ...values, extra: 'nieznane' }), /Nieznane pola/);
});

test('renderer escapes XML text, keeps root geometry, and does not mutate source bytes', () => {
  const page = 2;
  const filePath = path.join(templateRoot, 'page-02.svg');
  const sourceBefore = fs.readFileSync(filePath);
  const sourceHashBefore = hash(sourceBefore);
  const manifest = inspectOfferTemplateV3().pages[page - 1];
  const target = manifest.textBindings.find((binding) => binding.dynamic && binding.idHints.some((hint) => hint.startsWith('#tytu')))!;
  const value = 'Jan & Anna <Nowy> "klient"';
  const values = completeValues(page);
  values[target.fieldKey!] = value;

  const result = renderOfferTemplateV3Page(page, values);
  assert.match(result.svg, /&amp;/);
  assert.match(result.svg, /&lt;/);
  assert.deepEqual(result.limitations, OFFER_TEMPLATE_V3_LIMITATIONS);

  const rendered = parseSvg(result.svg);
  const root = rendered.documentElement!;
  const matchingText = Array.from(rendered.getElementsByTagName('text')).some((element) => element.textContent === value);
  assert.ok(matchingText, 'wartość po XML round-trip zachowuje treść');
  assert.equal(root.getAttribute('width'), String(manifest.width));
  assert.equal(root.getAttribute('height'), String(manifest.height));
  assert.equal(root.getAttribute('viewBox'), manifest.viewBox);
  assert.equal(hash(fs.readFileSync(filePath)), sourceHashBefore);
});

test('rendered pages replace embedded narrative, tariff, and product examples', () => {
  const narrative = renderOfferTemplateV3Page(2, completeValues(2, 'Pole uzupełnione jawnie'));
  assert.equal(narrative.svg.includes('18 078 kWh'), false);
  assert.equal(narrative.svg.includes('G13 Active'), false);
  assert.equal(narrative.svg.includes('net-metering'), false);

  const costPage = renderOfferTemplateV3Page(10, completeValues(10, 'Pole uzupełnione jawnie'));
  assert.equal(costPage.svg.includes('Dyness Stack 314'), false);
  assert.equal(costPage.svg.includes('75 000,00 PLN'), false);
  assert.equal(costPage.svg.includes('15 600,00 PLN'), false);
});

test('all ten pages resolve every dynamic text path through XML render', () => {
  const manifest = inspectOfferTemplateV3();
  for (const page of manifest.pages) {
    const values = completeValues(page.page, 'Jawna wartość pola');
    const result = renderOfferTemplateV3Page(page.page, values);
    assert.equal(result.replacedFieldKeys.length, Object.keys(values).length, `strona ${page.page}`);
    assert.equal(parseSvg(result.svg).documentElement!.localName, 'svg');
  }
});

