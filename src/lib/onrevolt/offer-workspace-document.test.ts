import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DOMParser, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom';
import { parse as parseFont } from 'opentype.js';
import { emptyOfferWorkspaceDraft, parseOfferWorkspaceDraft, createOfferWorkspacePricingSnapshot } from './offer-workspace';
import { monthlyCellFill } from './monthly-cell-shading';
import { priceOfferWorkspaceConfiguration } from './offer-workspace-pricing';
import { renderOfferWorkspaceDocument, type OfferWorkspaceDocumentData } from './offer-workspace-document';
import type { OfferWorkspaceEnergy } from './offer-workspace-energy';
import { inspectOfferTemplateV3 } from './offer-template-v3';
import { OFFER_TEMPLATE_V4_KEY, inspectOfferTemplateV4 } from './offer-template-v4';
import type { OfferBillingCostComponent, OfferBillingIntervalResult, OfferBillingScenarioResult } from './offer-workspace-billing';

const assetRoot = path.join(process.cwd(), 'assets', 'offer-templates', 'REFORM_B2C', '2026_10_V3');

function hash(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function workspace(): OfferWorkspaceDocumentData {
  return {
    projectId: 'project-1',
    clientId: 'client-1',
    projectName: 'Instalacja dla Anny & Jana',
    clientName: 'Anna & Jan <Test>',
    clientType: 'B2C',
    ppeNumber: null,
    revision: 'a'.repeat(64),
    input: {
      existingPv: { powerKw: 8.2, tiltDegrees: 35, azimuthDegrees: 180 },
      location: { address: 'Łódź, ul. Żółta 4', latitude: 51.76, longitude: 19.45 },
      settlementMode: null,
      annualConsumptionKwh: null,
      issues: [],
      reportDetails: {
        email: 'fixture@example.invalid', phone: '000000000', terrain: 'Działka testowa', buildingType: 'Budynek testowy',
        roofType: 'Dach testowy', connectionType: 'Przyłącze testowe', heatingSource: 'Źródło testowe',
        heatingDetails: 'Opis testowy', supplier: 'Sprzedawca testowy', connectionPowerKw: 12.5,
      },
    },
    measurements: {
      periods: [],
      months: Array.from({ length: 12 }, (_, index) => ({
        period: new Date(Date.UTC(2025, 9 + index, 1)).toISOString().slice(0, 7),
        importKwh: index === 5 ? 840 : 200 + index * 10,
        exportKwh: 50 + index,
      })),
      totalsImportKwh: 3660,
      totalsExportKwh: 666,
      intervalCount: null,
      missingDirections: [],
      issues: [],
      dayProfiles: [
        { period: '2026-05', dayType: 'workday', date: '2026-05-12', hours: Array.from({ length: 24 }, (_, hour) => ({ hour, importKwh: 0.5 + hour / 100, exportKwh: hour === 12 ? 0.4 : 0 })) },
        { period: '2026-05', dayType: 'free', date: '2026-05-11', hours: Array.from({ length: 24 }, (_, hour) => ({ hour, importKwh: 0.4, exportKwh: 0.2 })) },
        { period: '2026-01', dayType: 'workday', date: '2026-01-13', hours: Array.from({ length: 24 }, (_, hour) => ({ hour, importKwh: 0.8, exportKwh: 0 })) },
        { period: '2026-01', dayType: 'free', date: '2026-01-12', hours: Array.from({ length: 24 }, (_, hour) => ({ hour, importKwh: 0.7, exportKwh: 0 })) },
      ],
    },
    templates: [{
      id: 'battery-kit', familyKey: 'battery', name: 'Zestaw magazynu A', version: 1,
      kind: 'MAGAZYN', clientType: 'B2C', roofType: null, goal: null, powerKw: null, capacityKwh: 10,
      sortOrder: 0, requiresExistingPv: true, requiresExistingInverter: false, notes: null,
      items: [{
        id: 'item-1', position: 1, description: 'Magazyn energii', quantity: 1,
        role: 'CORE', supplyMode: 'ONREVOLT_SUPPLIED', unitPurchaseNet: 12345, purchaseVatRate: 0.23,
        operatingCostNet: 0, marginRate: 0.1, saleVatRate: 0.23, isOptional: false, requiresReview: false,
        product: {
          id: 'product-1', name: 'Battery Model X', sku: 'BAT-X', legacySku: null, category: 'BATTERY', producer: 'Acme', availability: 'AVAILABLE', powerCapacity: '10 kWh',
          prices: [{ purchaseNet: 12345, currentPurchaseNet: 12500, purchaseVatRate: 0.23, operatingCostNet: 0, marginRate: 0.1, saleVatRate: 0.08, currency: 'PLN', validFrom: '2026-10-01T00:00:00.000Z' }],
        },
      }],
    } as unknown as OfferWorkspaceDocumentData['templates'][number]],
  };
}

function energyFixture(data = workspace()): OfferWorkspaceEnergy {
  return {
    quality: 'MODELLED',
    source: 'Profil testowy · 2020–2024',
    model: 'Model PV testowy',
    months: data.measurements.months.map(({ period }) => ({ period, loadKwh: 300, pvKwh: 400, directKwh: 100 })),
    dayProfiles: data.measurements.dayProfiles.map(({ date, hours }) => ({
      date,
      hours: hours.map(({ hour }) => ({ hour, loadKwh: 0.5, pvKwh: 0.8, directKwh: 0.3 })),
    })),
    totals: { loadKwh: 3600, pvKwh: 4800, directKwh: 1200 },
    issues: ['Wartości PV pochodzą z profilu modelowego, nie z falownika.'],
    modelBelowExportKwh: 0,
  };
}

test('four commercial rows survive draft parsing, change the snapshot and reconcile page 10 without changing details', () => {
  const data = workspace();
  const base = data.templates[0].items[0];
  const rows = [
    { id: 'battery', category: 'MAGAZYN_ENERGII', role: 'MAIN_EQUIPMENT', gross: 49295, purchase: 30000 },
    { id: 'inverter', category: 'FALOWNIK', role: 'MAIN_EQUIPMENT', gross: 8000, purchase: 6936 },
    { id: 'ems', category: 'SYSTEM_MONITORUJACY', role: 'MONITORING', gross: 2000, purchase: 1200 },
    { id: 'transport', category: 'USLUGA', role: 'LOGISTICS', gross: 705, purchase: 300 },
  ];
  data.templates[0].items = rows.map((row, index) => ({ ...base, id: row.id, position: index + 1,
    description: `Szczegółowa pozycja ${row.id}`, quantity: 1, role: row.role,
    pricingMode: 'INDIVIDUAL', unitSaleNet: row.gross / 1.08, unitPurchaseNet: row.purchase,
    marginRate: 0, saleVatRate: 0.08,
    product: { ...base.product!, id: row.id, name: `Model ${row.id}`, category: row.category, prices: [] },
  }));
  const draft = emptyOfferWorkspaceDraft();
  draft.saleVatMode = 'REDUCED_8';
  draft.selectedTemplateIds = ['battery-kit'];
  const pricing = priceOfferWorkspaceConfiguration(data.templates, draft.saleVatMode, 'B2C');
  const oldSnapshot = createOfferWorkspacePricingSnapshot(draft, 'B2C', pricing, data.templates);
  draft.commercialPricing = { schemaVersion: 1, batteryInstallationScopeConfirmed: true,
    allocations: rows.map((row, i) => ({ templateId: 'battery-kit', itemId: row.id,
      group: (['STORAGE_INSTALLATION', 'INVERTER', 'EMS', 'TRANSPORT'] as const)[i] })) };
  const parsed = parseOfferWorkspaceDraft(JSON.parse(JSON.stringify(draft)));
  assert.deepEqual(parsed.commercialPricing, draft.commercialPricing);
  const nextSnapshot = createOfferWorkspacePricingSnapshot(parsed, 'B2C', pricing, data.templates);
  assert.notEqual(nextSnapshot.revision, oldSnapshot.revision);
  assert.deepEqual(nextSnapshot.totals, oldSnapshot.totals);
  const detailsBefore = structuredClone(data.templates);
  const result = renderOfferWorkspaceDocument(data, parsed, { templateKey: OFFER_TEMPLATE_V4_KEY });
  const page = parseSvg(result.pages[9].svg);
  assert.equal(result.pageCount, 10);
  for (const [index, expected] of ['49 804,12', '7 490,88', '2 000,00', '705,00'].entries()) {
    assert.equal(textById(page, `#b2c_kosztorys_wartosc_brutto_${index + 1}_strona_10`), expected);
  }
  assert.equal(textById(page, '#b2c_kosztorys_pozycja_1_strona_10'), 'Magazyn energii wraz z montażem');
  assert.equal(textById(page, '#b2c_kosztorys_pozycja_2_strona_10'), 'Falownik');
  assert.equal(textById(page, '#b2c_kosztorys_pozycja_5_strona_10'), '');
  assert.equal(textById(page, '#b2c_koszt_systemu_strona_10'), '60 000,00');
  assert.deepEqual(data.templates, detailsBefore);
  const pv = { ...data.templates[0], id: 'pv-kit', kind: 'PV_DACH_PLASKI', name: 'PV 5,7 kWp', powerKw: 5.7,
    items: [
      { ...data.templates[0].items[0], id: 'modules', quantity: 12, unitSaleNet: 500, unitPurchaseNet: 329,
        product: { ...base.product!, id: 'modules', name: 'Moduł 475 W', category: 'FOTOWOLTAIKA', prices: [] } },
      { ...data.templates[0].items[0], id: 'mount', role: 'LABOR', quantity: 1, unitSaleNet: 1000, unitPurchaseNet: 500,
        product: { ...base.product!, id: 'mount', name: 'Montaż', category: 'USLUGA_MONTAZOWA', prices: [] } },
    ] };
  data.templates.push(pv);
  const grouped = parseOfferWorkspaceDraft({ ...parsed, selectedTemplateIds: ['battery-kit', 'pv-kit'],
    commercialPricing: { schemaVersion: 2, allocations: [], batteryInstallationScopeConfirmed: true } });
  const fiveRows = renderOfferWorkspaceDocument(data, grouped, { templateKey: OFFER_TEMPLATE_V4_KEY });
  const fivePage = parseSvg(fiveRows.pages[9].svg);
  assert.equal(textById(fivePage, '#b2c_kosztorys_pozycja_5_strona_10'), 'Moduły fotowoltaiczne');
  assert.equal(textById(fivePage, '#b2c_kosztorys_wartosc_brutto_5_strona_10'), '4 263,84');
  assert.equal(textById(fivePage, '#b2c_kosztorys_pozycja_6_strona_10'), '');
  assert.equal(textById(fivePage, '#b2c_koszt_systemu_strona_10'), '67 560,00');
  const discounted = parseOfferWorkspaceDraft({ ...grouped, configurationEdits: [{ templateId: 'battery-kit', addedItems: [{
    id: 'discount', kind: 'DISCOUNT', description: 'Upust', quantity: 1, role: 'OTHER', supplyMode: 'SERVICE_ONLY',
    pricing: { unitSaleNet: -5000 / 1.08, unitPurchaseNet: 0, purchaseVatRate: 0, operatingCostNet: 0, operatingCostBasis: 'PER_UNIT', saleVatRate: 0.08 },
  }] }] });
  const discountDocument = renderOfferWorkspaceDocument(data, discounted, { templateKey: OFFER_TEMPLATE_V4_KEY });
  const discountPage = parseSvg(discountDocument.pages[9].svg);
  assert.equal(textById(discountPage, '#b2c_koszt_systemu_strona_10'), '62 560,00');
  assert.equal(textById(discountPage, '#b2c_kosztorys_pozycja_6_strona_10'), '');
  assert.equal(textById(discountPage, '#b2c_kosztorys_wartosc_brutto_5_strona_10'), '4 263,84');
});

test('annual-model document labels grid flows as estimates and keeps their model provenance', () => {
  const data = workspace();
  data.energy = energyFixture(data);
  data.energy.modelledMeasurements = {
    provenance: { kind: 'annual-consumption', source: 'Roczne zużycie · profil godzinowy RE', annualConsumptionKwh: 3600 },
    months: data.measurements.months, dayProfiles: data.measurements.dayProfiles,
    totalsImportKwh: data.measurements.totalsImportKwh!, totalsExportKwh: data.measurements.totalsExportKwh!, intervalCount: 8760,
  };
  const result = renderOfferWorkspaceDocument(data, emptyOfferWorkspaceDraft(), { templateKey: OFFER_TEMPLATE_V4_KEY });
  assert.match(result.pages[2].svg, /Zużycie, pobór i oddanie są szacunkami, nie pomiarami/);
  assert.ok(result.sourceFieldsUsed.some(source => source.includes('energy.modelledMeasurements.totalsImportKwh')), result.sourceFieldsUsed.join('\n'));
  assert.ok(!result.sourceFieldsUsed.includes('measurements.totalsImportKwh'));
});

function parseSvg(source: string) {
  const errors: string[] = [];
  const document = new DOMParser({ onError: (level, message) => {
    if (level === 'error' || level === 'fatalError') errors.push(`${level}: ${message}`);
  } }).parseFromString(source, 'image/svg+xml');
  assert.deepEqual(errors, []);
  return document;
}

function textById(document: XmlDocument, id: string) {
  return Array.from(document.getElementsByTagName('*'))
    .find((element) => element.getAttribute('id') === id)?.textContent?.trim() || '';
}

function textLinesById(document: XmlDocument, id: string) {
  const element = elementById(document, id);
  return element ? Array.from(element.getElementsByTagName('tspan')).map((span) => span.textContent || '').filter(Boolean) : [];
}

function moneyValue(value: string) {
  return Number(value.replace(/\s/g, '').replace('PLN', '').replace(/\./g, '').replace(',', '.'));
}

function elementById(document: XmlDocument, id: string) {
  return Array.from(document.getElementsByTagName('*'))
    .find((element) => element.getAttribute('id') === id) as XmlElement | undefined;
}

function absoluteTextX(element: XmlElement) {
  const span = element.getElementsByTagName('tspan')[0] as XmlElement | undefined;
  const translate = /translate\(\s*([-+\d.]+)(?:[ ,]+([-+\d.]+))?\s*\)/.exec(element.getAttribute('transform') || '');
  return Number(span?.getAttribute('x') || 0) + (translate ? Number(translate[1]) : 0);
}

function visibleUnitTextElement(element: XmlElement) {
  return (element.localName || element.tagName) === 'text'
    ? element
    : Array.from(element.getElementsByTagName('text')).find((text) => (text.textContent || '').trim()) as XmlElement | undefined;
}

function monthlyCellBackground(document: XmlDocument, id: string) {
  const text = elementById(document, id);
  let sibling = text?.previousSibling || null;
  while (sibling && sibling.nodeType !== 1) sibling = sibling.previousSibling;
  return sibling as XmlElement | null;
}

function pathMoveY(document: XmlDocument, id: string) {
  const path = elementById(document, id)?.getAttribute('d') || '';
  const match = /^M\s*[-+\d.]+[ ,]+([-+\d.]+)/.exec(path);
  assert.ok(match, `SVG path ${id} should define its first Y coordinate`);
  return Number(match[1]);
}

function geometryTree(element: XmlElement): unknown {
  const attributes = Array.from(element.attributes)
    .map((attribute) => [attribute.name, attribute.value])
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
  const children = Array.from(element.childNodes)
    .filter((child) => child.nodeType === 1)
    .map((child) => geometryTree(child as XmlElement));
  return [element.localName, attributes, children];
}

function shapeGeometryTree(element: XmlElement): unknown {
  const attributes = Array.from(element.attributes)
    .map((attribute) => [attribute.name, attribute.value])
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
  const children = Array.from(element.childNodes)
    .filter((child) => child.nodeType === 1 && (child as XmlElement).localName !== 'text')
    .map((child) => shapeGeometryTree(child as XmlElement));
  return [element.localName, attributes, children];
}

test('renders ten source-hashed SVG pages using project data and the current draft', () => {
  const originalHashes = inspectOfferTemplateV3().pages.map((page) => hash(fs.readFileSync(path.join(assetRoot, page.file))));
  const draft = emptyOfferWorkspaceDraft();
  draft.existingPv.powerKw = 8.2;
  draft.currentSettlement = 'NET_METERING';
  draft.selectedTemplateIds = ['battery-kit'];
  draft.description.before = 'Roczne zużycie energii wynosi 3 660 kWh.';
  draft.description.after = 'Szkic obejmuje zestaw magazynu energii.';

  const result = renderOfferWorkspaceDocument(workspace(), draft);
  assert.equal(result.pageCount, 10);
  assert.equal(result.pages.length, 10);
  assert.equal(result.sourceRevision, 'a'.repeat(64));
  assert.ok(result.sourceFieldsUsed.includes('measurements.totalsImportKwh'));
  assert.ok(result.sourceFieldsUsed.includes('measurements.months.importKwh'));
  assert.ok(result.sourceFieldsUsed.includes('measurements.dayProfiles.exportKwh'));
  assert.ok(result.sourceFieldsUsed.includes('input.reportDetails.email'));
  assert.ok(result.sourceFieldsUsed.includes('draft.description.after'));
  assert.deepEqual(result.pages.map((page) => page.page), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  result.pages.forEach((page, index) => {
    const document = parseSvg(page.svg);
    assert.equal(document.documentElement?.localName, 'svg');
    assert.equal(page.sourceSha256, originalHashes[index]);
    assert.ok(page.replacedFieldKeys.length > 0);
    assert.equal(page.svg.includes('__OW_DOC_MISSING_'), false);
    assert.match(page.svg, /@font-face/);
    assert.doesNotMatch(page.svg, /<script\b|<foreignObject\b|\son[a-z]+=/i);
    assert.doesNotMatch(page.svg, /(?:href|src)="https?:/i);
  });

  const pageOne = parseSvg(result.pages[0].svg);
  assert.ok(Array.from(pageOne.getElementsByTagName('text')).some((node) => node.textContent === 'Anna & Jan <Test>'));
  assert.equal(textById(pageOne, '_nazwa_firmy_2'), 'Anna & Jan <Test>');
  assert.equal(textById(pageOne, '_dane_osobowe_tytul'), 'Dane osobowe');
  assert.equal(textById(pageOne, '_energia_cieplna_tytul'), 'Energia cieplna');
  assert.equal(textById(pageOne, '_roczny_rachunek_za_energie_tytul'), 'Roczny rachunek za energię');
  assert.equal(textById(pageOne, '_twoj_rachunek_tytul'), 'Twój rachunek');
  assert.equal(textById(pageOne, '#moc_instalacji_fotowoltaicznej'), '8,2');
  assert.equal(textById(pageOne, '_moc_instalacji_fotowoltaicznej_kwp'), 'kWp');
  assert.equal(textById(pageOne, '#instalacja_fotowoltaiczna'), 'Tak');
  assert.equal(textById(pageOne, '#miejsce_instalacji_fotowoltaicznej'), '', 'project address is not reused as PV installation type');
  const pageTwoText = parseSvg(result.pages[1].svg).documentElement?.textContent || '';
  assert.ok(pageTwoText.includes('Roczne zużycie energii wynosi 3 660 kWh.'));
  assert.ok(pageTwoText.includes('Szkic obejmuje zestaw magazynu energii.'));
  assert.equal(pageTwoText.includes('18 078 kWh'), false);
  const pageTen = parseSvg(result.pages[9].svg);
  const pageTenText = pageTen.documentElement?.textContent || '';
  assert.ok(pageTenText.includes('Battery Model X'));
  assert.ok(pageTenText.includes('Magazyn energii'));
  assert.ok(pageTenText.includes('Dotacja do potwierdzenia'));
  assert.ok(pageTenText.includes('Ulga do potwierdzenia'));
  assert.equal(
    textById(pageTen, '_opis_oferty_opis').replace(/\s+/g, ' ').trim(),
    'Przedstawiony kosztorys może ulec korekcie po wizji lokalnej, w zależności od rzeczywistych warunków montażu i zakresu niezbędnych prac instalacyjnych',
  );
  assert.equal(pageTenText.includes('75 000,00 PLN'), false);
  const pageOneText = pageOne.documentElement?.textContent || '';
  assert.ok(pageOneText.includes('fixture@example.invalid'));
  assert.ok(pageOneText.includes('Dach testowy'));
  assert.ok(pageOneText.includes('12,5 kW'));

  const pageThree = parseSvg(result.pages[2].svg);
  assert.ok(pageThree.getElementById('Group 1193'));
  assert.ok(pageThree.getElementById('_linie_wykres_aktualny'));
  for (const pageNumber of [3, 4]) {
    const annualTableText = parseSvg(result.pages[pageNumber - 1].svg).documentElement?.textContent || '';
    for (const label of [
      'Produkcja z PV', 'Energia oddana do sieci', 'Całkowite użycie energii',
      'Energia pobrana z sieci', 'Autokonsumpcja z PV', 'Autokonsumpcja z magazynu',
    ]) assert.ok(annualTableText.includes(label), `page ${pageNumber} annual table label: ${label}`);
    assert.ok(annualTableText.includes('(kWh)'), `page ${pageNumber} annual table unit`);
  }
  const pageFive = parseSvg(result.pages[4].svg);
  assert.ok(pageFive.getElementById('_nazwa_firmy_2'));
  assert.ok(pageFive.getElementById('Group 1298'));
  assert.ok((pageFive.documentElement?.textContent || '').includes('(2026-05-12)'));
  assert.equal((pageFive.documentElement?.textContent || '').includes('NR XX/XX/XX/XX/X'), false);
  assert.ok((pageFive.documentElement?.textContent || '').includes('(Taryfa: —, Fotowoltaika: 8,2 kWp)'));

  assert.deepEqual(
    inspectOfferTemplateV3().pages.map((page) => hash(fs.readFileSync(path.join(assetRoot, page.file)))),
    originalHashes,
    'renderer nie zmienia oryginalnych SVG',
  );
});

test('missing financial and simulation data is reported while chart framing is retained', () => {
  const draft = emptyOfferWorkspaceDraft();
  const result = renderOfferWorkspaceDocument(workspace(), draft);
  assert.ok(result.missingData.some((item) => item.page === 9 && item.reason.includes('usunięto')));
  assert.ok(result.missingData.some((item) => item.page === 2 && item.fieldKeys.includes('draft.description.before')));
  assert.ok(result.suppressedCharts.some((item) => item.page === 5));
  assert.ok(result.suppressedCharts.some((item) => item.page === 9));
  assert.ok(result.suppressedCharts.some((item) => item.page === 4 && item.reason.includes('osie') === false));
  const pageNine = parseSvg(result.pages[8].svg);
  assert.ok(pageNine.getElementById('_kosszt_zakupu_1kwh_aktualny'));
  assert.ok(pageNine.getElementById('_aktualny_rachunek_roczny'));
  for (const pageNumber of [3, 4, 5, 6, 7, 8, 9, 10]) {
    const svg = result.pages[pageNumber - 1].svg;
    assert.equal(svg.includes('75 000,00 PLN'), false, `sample pricing removed on page ${pageNumber}`);
    assert.equal(svg.includes('G13 Active'), false, `sample tariff removed on page ${pageNumber}`);
  }
});

test('actual monthly readings populate measured summaries without deriving PV or price values', () => {
  const result = renderOfferWorkspaceDocument(workspace(), emptyOfferWorkspaceDraft());
  const pageThreeDocument = parseSvg(result.pages[2].svg);
  const pageThree = pageThreeDocument.documentElement?.textContent || '';
  assert.ok(pageThree.includes('3 660 kWh'));
  assert.ok(pageThree.includes('666 kWh'));
  assert.ok(result.missingData.some((item) => item.page === 3 && item.idHint.includes('wartosc_energii')));
  assert.equal(result.pages[2].svg.includes('10 390'), false);
  assert.ok(result.pages[2].svg.includes('workspace-measured-monthly-series'));
  assert.ok(result.pages[4].svg.includes('workspace-measured-hourly-series'));
  assert.equal(textById(pageThreeDocument, '_srednia_cana_oddanej_aktualny_pln'), '—');
  assert.equal(textById(pageThreeDocument, '_srednia_cana_pobranej_aktualny_pln'), '—');
  assert.equal(textById(pageThreeDocument, '_wartosc_energii_oddanej_aktualny_tytul'), 'Wartość energii oddanej');
  assert.equal(textById(pageThreeDocument, '_wartosc_energii_pobranej_aktualny_tytul'), 'Wartość energii pobranej');
  assert.ok((pageThreeDocument.documentElement?.textContent || '').includes('Średnia cena sprzedaży 1 kWh/PLN'));
  assert.ok((pageThreeDocument.documentElement?.textContent || '').includes('Średnia cena zakupu 1 kWh/PLN'));
  assert.ok(pageThree.includes('2025-10 - 2026-09'));
  assert.equal(pageThree.includes('Okres pomiarów'), false);
  assert.ok(pageThree.includes('Paź 25'));
  assert.ok(pageThree.includes('Wrz 26'));
  assert.equal(textById(pageThreeDocument, '_rok_wykres_aktualny'), '');
  assert.equal(textById(pageThreeDocument, '_rok_wykres_aktualny_2'), '');
  assert.ok(pageThree.includes('Największy pobór z sieci'));
  assert.ok(pageThree.includes('Średni pobór'));
  assert.ok(pageThree.includes('Najmniejszy pobór'));
  assert.ok(pageThree.includes('Zużycie energii'));

  const pageNineText = parseSvg(result.pages[8].svg).documentElement?.textContent || '';
  for (const label of [
    'Koszt zakupu 1 kWh', 'Stała cena abonamentu / miesiąc', 'Całkowity koszt zakupu 1 kWh',
    'Twój nowy rachunek z systemem', 'Twój aktualny rachunek roczny', 'Łączna zgromadzona wartość depozytu',
    'Łączna wykorzystana wartość depozytu na pokrycie energii pobranej', 'Niewykorzystana wartość depozytu',
    'Zwrot 30% wartości', 'Wartość energii pobranej niepokrytej z depozytu', 'Całkowity rachunek',
    'Autokonsumpcja z PV', 'Zakup z sieci', 'Zakup energii', 'Dystrybucja energii', 'Opłaty stałe',
    'Energia zakupiona z sieci', 'Energia oddana do depozytu', 'Pokryte z depozytu',
    'Autokonsumpcja z magazynu', 'Energia wykorzystana z depozytu', 'Wartość skumulowanego depozytu',
    'Oszczędność brutto', 'Całkowity rachunek brutto', 'Rachunek po zwrocie z depozytu',
  ]) assert.ok(pageNineText.includes(label), `static page 9 label preserved: ${label}`);
  assert.ok(pageNineText.includes('brutto'));
  assert.ok(pageNineText.includes('PLN'));
  assert.equal(pageNineText.includes('Oszczędność 85%'), false, 'illustrative saving is not preserved as a label');
  assert.equal(pageNineText.includes('Przedstawiony kosztorys może ulec korekcie'), false, 'page 10 warning is not copied to page 9');
  assert.equal(pageNineText.includes('19.10.2026'), false, 'dated page 9 tariff sample is removed');
  const pageNine = parseSvg(result.pages[8].svg);
  assert.equal(textById(pageNine, '_oplata_zmienna_sieciowa_aktualna_cena'), '—');
  assert.equal(textById(pageNine, '_zakup_energii_aktualny_cena'), '—');
  const remainingPlaceholders = result.pages.flatMap((page) => Array.from(
    page.svg.matchAll(/X,(?:XX|XXXX)(?:\s*PLN(?:\/kWh)?)?/g),
    (match) => `page ${page.page}: ${match[0]}`,
  ));
  assert.deepEqual(remainingPlaceholders, []);

  const series = Array.from(pageThreeDocument.getElementsByTagName('g'))
    .find((element) => element.getAttribute('id') === 'workspace-measured-monthly-series');
  const bars = Array.from(series?.getElementsByTagName('rect') || []);
  assert.equal(bars.length, 24);
  assert.ok(Math.abs(Number(bars[10].getAttribute('height')) - 148.68) < 0.01, 'measured 840 kWh import sets the expected bar height');

  const pageFour = parseSvg(result.pages[3].svg);
  assert.ok(pageFour.getElementById('Group 1205'), 'future chart framing is retained');
  assert.equal(pageFour.getElementById('workspace-measured-monthly-series'), null, 'historical measurements are not rendered as a forecast');

  const pageTen = parseSvg(result.pages[9].svg);
  assert.equal(textById(pageTen, '_nazwa_pozycji_4'), 'Pozycja');
  assert.equal(textById(pageTen, '_nazwa_modelu_4'), 'Model');
  assert.equal(textById(pageTen, '_ilosc_4'), 'Ilość');
  assert.equal(textById(pageTen, '_cena_jednostkowa_brutto_4'), 'brutto\nCena jednostkowa');
  assert.equal(textById(pageTen, '_nazwa_modelu_3_2'), '', 'unused product rows stay empty instead of getting a dash');
  assert.ok((pageTen.documentElement?.textContent || '').includes('—'), 'unknown selected-product price is marked with a dash');
});

test('V4 page 3 monthly chart rounds a 2670 kWh peak to a 3000 kWh axis ceiling', () => {
  const data = workspace();
  data.measurements.months = data.measurements.months.map((month, index) => ({
    ...month,
    importKwh: index === 5 ? 2670 : 300,
    exportKwh: 100,
  }));
  const result = renderOfferWorkspaceDocument(data, emptyOfferWorkspaceDraft(), { templateKey: OFFER_TEMPLATE_V4_KEY });
  const pageThree = parseSvg(result.pages[2].svg);
  assert.equal(textById(pageThree, '_1200'), '3 000');
});

test('renders model energy summaries and monthly/hourly series with explicit provenance', () => {
  const data = workspace();
  data.energy = energyFixture(data);
  data.energy.modelBelowExportKwh = 969;
  const draft = emptyOfferWorkspaceDraft();
  draft.existingBatteryPresent = false;
  const result = renderOfferWorkspaceDocument(data, draft);
  const pageThree = parseSvg(result.pages[2].svg);
  const pageFive = parseSvg(result.pages[4].svg);
  const sourcePageThree = parseSvg(fs.readFileSync(path.join(assetRoot, 'page-03.svg'), 'utf8'));
  const sourcePageFive = parseSvg(fs.readFileSync(path.join(assetRoot, 'page-05.svg'), 'utf8'));

  assert.equal(textById(pageThree, '_zuzycie_energii_aktualny_kwh'), '3 600 kWh');
  assert.equal(textById(pageThree, '_produkcja_pv_aktaulny_kwh'), '4 800 kWh');
  assert.equal(textById(pageThree, '_autokonsumpcja_pv_aktualny_kwh'), '1 200 kWh / 25,0 %');
  assert.equal(textById(pageThree, '_autokonsumpcja_magazyn_aktualny_kwh'), '0 kWh');
  assert.equal(textById(pageThree, 'XXX_13'), '400', 'January PV output follows the calendar month column');
  assert.equal(textById(pageThree, 'XXX'), '300', 'January load follows the calendar month column');
  assert.equal(textById(pageThree, 'XXX_25'), '100', 'January PV self-consumption is modelled');
  assert.equal(textById(pageThree, 'XXX_37'), '230', 'January grid import remains measured');
  assert.equal(textById(pageThree, 'XXX_49'), '53', 'January grid export remains measured');
  assert.ok(textById(pageThree, '_nazwa').includes('MODEL'));
  assert.deepEqual(
    geometryTree(elementById(sourcePageThree, '_nazwa')!),
    geometryTree(elementById(pageThree, '_nazwa')!),
    'oznaczenie źródła nie zmienia geometrii ani stylu pola nagłówka',
  );
  assert.deepEqual(
    geometryTree(elementById(sourcePageThree, 'Group 1229')!),
    geometryTree(elementById(pageThree, 'Group 1229')!),
    'wypełnienie miesięcznej tabeli zmienia wyłącznie tekst oryginalnych komórek',
  );
  const pageFour = parseSvg(result.pages[3].svg);
  assert.notEqual(textById(pageFour, '_zuzycie_energii_aktualny_kwh'), '3 600 kWh', 'forecast page does not receive current load');
  assert.equal((pageFour.documentElement?.textContent || '').includes('4 800 kWh'), false, 'forecast page does not receive current PV');
  for (const [id, currentValue] of [
    ['_zuzycie_energii_aktualny_kwh', '3 600 kWh'],
    ['_produkcja_pv_aktaulny_kwh', '4 800 kWh'],
    ['_autokonsumpcja_pv_aktualny_kwh', '1 200 kWh / 25,0 %'],
    ['_autokonsumpcja_magazyn_aktualny_kwh', '0 kWh'],
  ]) assert.notEqual(textById(pageFour, id), currentValue, `page 4 must not show current value ${id}`);

  const monthlySeries = Array.from(pageThree.getElementsByTagName('g'))
    .find((element) => element.getAttribute('id') === 'workspace-modelled-monthly-series');
  const monthlyBars = Array.from(monthlySeries?.getElementsByTagName('rect') || []);
  assert.equal(monthlyBars.length, 36);
  assert.deepEqual(monthlyBars.slice(0, 3).map((bar) => bar.getAttribute('fill')), ['#FED17F', '#FC7C00', '#006C30']);
  assert.equal(monthlyBars[0].getAttribute('x'), '77');
  assert.equal(monthlyBars[0].getAttribute('width'), '18.3896');
  assert.ok(Math.abs(Number(monthlyBars[0].getAttribute('y')) + Number(monthlyBars[0].getAttribute('height')) - 308.028) < 0.001,
    'monthly stack ends on the source chart baseline');
  const monthlyLines = Array.from(monthlySeries?.getElementsByTagName('path') || []);
  assert.deepEqual(monthlyLines.map((line) => [line.getAttribute('data-series'), line.getAttribute('stroke')]), [
    ['pv', '#FED17F'], ['load', '#A3AED0'],
  ]);
  assert.match(monthlyLines[0].getAttribute('d') || '', /^M72,/);
  assert.match(monthlyLines[0].getAttribute('d') || '', /H552$/);
  assert.equal(pageThree.getElementById('Vector (Stroke)'), null);
  assert.equal(pageThree.getElementById('Vector (Stroke)_2'), null);

  const hourlySeries = Array.from(pageFive.getElementsByTagName('g'))
    .find((element) => element.getAttribute('id') === 'workspace-modelled-hourly-series');
  const hourlyBars = Array.from(hourlySeries?.getElementsByTagName('rect') || []);
  assert.equal(hourlyBars.length, 72);
  assert.deepEqual(hourlyBars.slice(0, 3).map((bar) => bar.getAttribute('fill')), ['#FED17F', '#FC7C00', '#006C30']);
  assert.equal(hourlyBars[0].getAttribute('x'), '70');
  assert.equal(hourlyBars[0].getAttribute('width'), '10');
  assert.ok(Math.abs(Number(hourlyBars[0].getAttribute('y')) + Number(hourlyBars[0].getAttribute('height')) - 268) < 0.001,
    'hourly stack ends on the current plot baseline, not the lower forecast baseline');
  const hourlyLines = Array.from(hourlySeries?.getElementsByTagName('path') || []);
  assert.deepEqual(hourlyLines.map((line) => [line.getAttribute('data-series'), line.getAttribute('stroke')]), [
    ['pv', '#FED17F'], ['load', '#A3AED0'],
  ]);
  assert.match(hourlyLines[0].getAttribute('d') || '', /^M65,/);
  assert.match(hourlyLines[0].getAttribute('d') || '', /H543$/);
  const lowerPlot = pageFive.getElementById('Group 1298');
  assert.ok(lowerPlot);
  const lowerDataShapes = Array.from(lowerPlot.getElementsByTagName('*')).filter((shape) => {
    const tag = (shape.localName || shape.tagName).toLowerCase();
    const fill = (shape.getAttribute('fill') || '').toLowerCase();
    return ['path', 'rect', 'polygon', 'polyline', 'circle', 'ellipse', 'use'].includes(tag)
      && (['#fed17f', '#fc7c00', '#006c30', '#44e09c', '#00bdff', '#ff3b30', '#f7c948'].includes(fill)
        || fill.startsWith('url(#pattern'));
  });
  assert.equal(lowerDataShapes.length, 0, 'forecast panel contains no current model or illustrative data shapes');
  assert.equal(pageFive.getElementById('Union'), null, 'illustrative forecast load line is removed');
  assert.equal(pageFive.getElementById('Union_2'), null, 'illustrative forecast PV line is removed');
  assert.equal(pageFive.getElementById('Union_3'), null);
  assert.equal(pageFive.getElementById('Union_4'), null);
  const socGroup = pageFive.getElementById('Group 1278');
  assert.equal(Array.from(socGroup?.getElementsByTagName('text') || []).some((label) => /^\d{1,3}%$/.test((label.textContent || '').trim())), false,
    'illustrative SOC percentages are removed');
  assert.ok((pageFive.documentElement?.textContent || '').includes('(Taryfa: —, Fotowoltaika: —, Magazyn energii: —)'));
  assert.ok((pageFive.documentElement?.textContent || '').includes('(Taryfa: —, Fotowoltaika: 8,2 kWp)'));
  assert.ok((pageFive.documentElement?.textContent || '').includes('SZKIC ROBOCZY · obliczenia finansowe i prognoza systemu niekompletne'));
  assert.ok((pageThree.documentElement?.textContent || '').includes('PV i autokonsumpcja: model Model PV testowy; rozbieżność modelu z eksportem: 969 kWh'));
  assert.ok((pageThree.documentElement?.textContent || '').includes('SZKIC ROBOCZY · obliczenia finansowe i prognoza systemu niekompletne'));

  const pathData = (group: XmlElement) => Array.from(group.getElementsByTagName('path')).map((shape) => shape.getAttribute('d'));
  for (const groupId of ['Group 1299', 'Group 1245']) {
    const sourceZones = elementById(sourcePageFive, groupId);
    const renderedZones = elementById(pageFive, groupId);
    assert.deepEqual(pathData(renderedZones!), pathData(sourceZones!), `${groupId} geometry remains unchanged`);
    const zoneFills = Array.from(renderedZones!.getElementsByTagName('path')).map((shape) => shape.getAttribute('fill'));
    assert.ok(zoneFills.length > 0 && zoneFills.every((fill) => fill === '#FFFFFF'), `${groupId} illustrative zones are white`);
  }
  for (const pageNumber of [6, 7, 8]) {
    const dailyPage = parseSvg(result.pages[pageNumber - 1].svg);
    const futurePanel = dailyPage.getElementById('Group 1298');
    assert.ok(futurePanel, `page ${pageNumber} retains its future panel`);
    assert.equal(dailyPage.getElementById('Union'), null, `page ${pageNumber} clears the example load curve`);
    assert.equal(dailyPage.getElementById('Union_2'), null, `page ${pageNumber} clears the example PV curve`);
    const exampleFills = Array.from(futurePanel.getElementsByTagName('*')).filter((shape) => {
      const fill = (shape.getAttribute('fill') || '').toLowerCase();
      return ['#fed17f', '#fc7c00', '#006c30', '#44e09c', '#00bdff', '#ff3b30', '#f7c948'].includes(fill)
        || fill.startsWith('url(#pattern');
    });
    assert.equal(exampleFills.length, 0, `page ${pageNumber} future panel has no illustrative series`);
    const sourceDaily = parseSvg(fs.readFileSync(
      path.join(assetRoot, `page-${String(pageNumber).padStart(2, '0')}.svg`), 'utf8',
    ));
    for (const groupId of ['Group 1299', 'Group 1245']) {
      const sourceZones = elementById(sourceDaily, groupId)!;
      const renderedZones = elementById(dailyPage, groupId)!;
      assert.deepEqual(pathData(renderedZones), pathData(sourceZones), `page ${pageNumber} ${groupId} keeps its original geometry`);
      assert.ok(Array.from(renderedZones.getElementsByTagName('path')).every((shape) => shape.getAttribute('fill') === '#FFFFFF'),
        `page ${pageNumber} ${groupId} has no unverified hourly-zone colors`);
    }
  }
  assert.ok((pageFive.documentElement?.textContent || '').includes('Profil modelowany'));
  assert.ok(result.sourceFieldsUsed.includes('energy.quality'));
  assert.ok(result.sourceFieldsUsed.includes('energy.source'));
  assert.ok(result.sourceFieldsUsed.includes('energy.model'));
  assert.ok(result.sourceFieldsUsed.includes('energy.totals.loadKwh'));
  assert.ok(result.sourceFieldsUsed.includes('energy.dayProfiles.directKwh'));
  assert.ok(result.sourceFieldsUsed.includes('energy.modelBelowExportKwh'));
  assert.ok(result.limitations.some((item) => item.includes('Profil testowy')));
  assert.ok(result.limitations.some((item) => item.includes('Model PV testowy')));
  assert.ok(result.limitations.some((item) => item.includes('nie z falownika')));
});

test('keeps missing model values explicit and never falls back to meter data', () => {
  const data = workspace();
  const energy = energyFixture(data);
  energy.months = energy.months.map(({ period }) => ({ period, loadKwh: null, pvKwh: null, directKwh: null }));
  energy.dayProfiles = energy.dayProfiles.map(({ date, hours }) => ({
    date,
    hours: hours.map(({ hour }) => ({ hour, loadKwh: null, pvKwh: null, directKwh: null })),
  }));
  energy.totals = { loadKwh: null, pvKwh: null, directKwh: null };
  data.energy = energy;
  const draft = emptyOfferWorkspaceDraft();
  draft.existingBatteryPresent = false;
  const result = renderOfferWorkspaceDocument(data, draft);
  const pageThree = parseSvg(result.pages[2].svg);
  const pageFive = parseSvg(result.pages[4].svg);

  assert.equal(textById(pageThree, '_zuzycie_energii_aktualny_kwh'), '—');
  assert.equal(textById(pageThree, '_produkcja_pv_aktaulny_kwh'), '—');
  assert.equal(textById(pageThree, '_autokonsumpcja_pv_aktualny_kwh'), '— kWh / — %');
  assert.equal(textById(pageThree, 'XXX'), '—', 'missing monthly model values stay visible as dashes');
  assert.ok(result.missingData.some((item) => item.reason.includes('Brak wymaganej wartości loadKwh')));
  assert.ok(result.missingData.some((item) => item.fieldKeys.includes('energy.months')));
  assert.ok(result.missingData.some((item) => item.fieldKeys.includes('energy.dayProfiles')));
  assert.ok(result.missingData.some((item) => item.reason.includes('directKwh')));
  assert.equal(pageThree.getElementById('workspace-measured-monthly-series'), null);
  assert.equal(pageFive.getElementById('workspace-measured-hourly-series'), null);
  assert.equal(Array.from(pageFive.getElementById('workspace-modelled-hourly-series')?.getElementsByTagName('rect') || []).length, 0);
});

test('an explicit null energy result does not render measured profiles as an energy-model fallback', () => {
  const data = workspace();
  data.energy = null;
  const result = renderOfferWorkspaceDocument(data, emptyOfferWorkspaceDraft());
  const pageThree = parseSvg(result.pages[2].svg);
  const pageFive = parseSvg(result.pages[4].svg);

  assert.equal(textById(pageThree, '_zuzycie_energii_aktualny_kwh'), '—');
  assert.equal(textById(pageThree, '_produkcja_pv_aktaulny_kwh'), '—');
  assert.equal(textById(pageThree, '_energia_pobrana_z_sieci_aktualny_kwh'), '3 660 kWh', 'raw meter import stays distinct');
  assert.equal(pageThree.getElementById('workspace-measured-monthly-series'), null);
  assert.ok(pageThree.getElementById('workspace-missing-energy-monthly-series'));
  assert.equal(pageFive.getElementById('workspace-measured-hourly-series'), null);
  assert.ok((pageFive.documentElement?.textContent || '').includes('Brak obliczenia energii'));
  assert.ok(result.sourceFieldsUsed.includes('energy.unavailable'));
  assert.ok(result.limitations.some((item) => item.includes('Obliczenie energii jest niedostępne')));
});

test('page 10 product rows follow visual order and header labels stay in the header', () => {
  const data = workspace();
  const template = data.templates[0];
  const first = template.items[0];
  template.items = [
    { ...first, description: 'Pierwsza pozycja' },
    {
      ...first,
      id: 'item-2',
      position: 2,
      description: 'Druga pozycja',
      product: { ...first.product!, id: 'product-2', name: 'Battery Model Y' },
    },
  ];
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['battery-kit'];
  const result = renderOfferWorkspaceDocument(data, draft);
  const pageTen = parseSvg(result.pages[9].svg);

  assert.equal(textById(pageTen, '_nazwa_pozycji_4'), 'Pozycja');
  assert.equal(textById(pageTen, '_nazwa_modelu_4'), 'Model');
  assert.equal(textById(pageTen, '_ilosc_4'), 'Ilość');
  assert.equal(textById(pageTen, '_nazwa_pozycji_1_2'), 'Pierwsza pozycja');
  assert.equal(textById(pageTen, '_nazwa_modelu_1_2'), 'Acme Battery Model X');
  assert.equal(textById(pageTen, '_nazwa_pozycji_2_2'), 'Druga pozycja');
  assert.equal(textById(pageTen, '_nazwa_modelu_2_2'), 'Acme Battery Model Y');
  assert.equal(textById(pageTen, '_nazwa_pozycji_3_2'), '', 'unused next row remains blank');
  assert.equal(textById(pageTen, '_nazwa_pozycji_3_4'), '', 'later product rows do not receive header labels');
});

test('wraps long page 10 product text within the original table columns', () => {
  const data = workspace();
  const item = data.templates[0].items[0];
  const product = item.product!;
  item.description = 'Longi LR7-54HVB 475W Hi-MO X10';
  item.quantity = 24;
  item.product = { ...product, producer: 'OSW', name: 'Longi LR7-54HVB 475W Hi-MO X10' };
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['battery-kit'];
  const result = renderOfferWorkspaceDocument(data, draft);
  const pageTen = parseSvg(result.pages[9].svg);
  const modelElement = elementById(pageTen, '_nazwa_modelu_1_2')!;
  const descriptionElement = elementById(pageTen, '_nazwa_pozycji_1_2')!;
  const modelLines = Array.from(modelElement.getElementsByTagName('tspan')) as XmlElement[];
  const descriptionLines = Array.from(descriptionElement.getElementsByTagName('tspan')) as XmlElement[];
  const italicBytes = fs.readFileSync(path.join(process.cwd(), 'public', 'fonts', 'dm-sans', 'DMSans-Italic.ttf'));
  const regularBytes = fs.readFileSync(path.join(process.cwd(), 'public', 'fonts', 'dm-sans', 'DMSans-Regular.ttf'));
  const italic = parseFont(italicBytes.buffer.slice(italicBytes.byteOffset, italicBytes.byteOffset + italicBytes.byteLength) as ArrayBuffer);
  const regular = parseFont(regularBytes.buffer.slice(regularBytes.byteOffset, regularBytes.byteOffset + regularBytes.byteLength) as ArrayBuffer);

  assert.ok(modelLines.length > 1, 'long model names wrap instead of reaching the quantity column');
  assert.equal(modelLines.map((line) => (line.textContent || '').trim()).join(' '), 'OSW Longi LR7-54HVB 475W Hi-MO X10');
  assert.equal(descriptionLines.map((line) => (line.textContent || '').trim()).join(' '), 'Longi LR7-54HVB 475W Hi-MO X10');
  for (const line of modelLines) {
    const size = Number(line.getAttribute('font-size'));
    assert.equal(line.getAttribute('x'), '198');
    assert.ok(italic.getAdvanceWidth((line.textContent || '').trim(), size) <= 132.01, 'model line fits before the quantity column');
  }
  for (const line of descriptionLines) {
    const size = Number(line.getAttribute('font-size'));
    assert.equal(line.getAttribute('x'), '59');
    assert.ok(regular.getAdvanceWidth((line.textContent || '').trim(), size) <= 130.01, 'description line fits before the model column');
  }
  assert.equal(textById(pageTen, '_ilosc_1_2'), '24');
  assert.equal(Array.from(elementById(pageTen, '_ilosc_1_2')!.getElementsByTagName('tspan'))[0].getAttribute('x'), '339.5');
});

test('page 10 shows catalog prices and pre-financing system cost without changing source table geometry', () => {
  const data = workspace();
  data.templates[0].items[0].quantity = 2;
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['battery-kit'];
  draft.saleVatMode = 'REDUCED_8';
  const result = renderOfferWorkspaceDocument(data, draft);
  const pageTen = parseSvg(result.pages[9].svg);
  const pageTenText = pageTen.documentElement?.textContent || '';
  const sourcePageTen = parseSvg(fs.readFileSync(path.join(assetRoot, 'page-10.svg'), 'utf8'));

  assert.equal(textById(pageTen, '_cena_jednostkowa_brutto_1_2'), '14 850,00 PLN');
  assert.equal(textById(pageTen, '_wartoÅÄ_brutto_1_2'), '29 700,00 PLN');
  assert.equal(textById(pageTen, '_kwota_koszt_systemu_2'), '29 700,00 PLN');
  assert.equal(textById(pageTen, '_kwota_dotacja_2'), '—');
  assert.equal(textById(pageTen, '_kwota_ulga_2'), '—');
  assert.equal(textById(pageTen, '_kwota_po_dofinansowaniach_2'), '—');
  assert.ok(pageTenText.includes('Dotacja do potwierdzenia'));
  assert.ok(pageTenText.includes('Ulga do potwierdzenia'));
  assert.ok(pageTenText.includes('Koszt po finansowaniu do ustalenia'));
  assert.ok(!pageTenText.includes('75 000,00 PLN'));
  assert.ok(!pageTenText.includes('15 600,00 PLN'));
  assert.ok(!pageTenText.includes('7 131,60 PLN'));
  assert.ok(result.sourceFieldsUsed.includes('workspace.clientType'));
  assert.ok(result.sourceFieldsUsed.includes('draft.saleVatMode'));
  assert.ok(result.sourceFieldsUsed.includes('templates.items.product.prices'));
  assert.ok(result.missingData.some((item) => item.page === 10 && item.reason.includes('Kwota dotacji pozostaje nieznana')));
  assert.ok(result.missingData.some((item) => item.page === 10 && item.reason.includes('Kwota ulgi pozostaje nieznana')));
  assert.ok(result.limitations.some((item) => item.includes('Kosztorys korzysta z wyceny wybranych pozycji')));

  assert.deepEqual(
    shapeGeometryTree(elementById(sourcePageTen, '_tabela_kosztorys')!),
    shapeGeometryTree(elementById(pageTen, '_tabela_kosztorys')!),
    'zawijanie tekstu nie zmienia oryginalnej geometrii tabeli',
  );
});

test('page 10 labels B2B catalog prices as net and keeps financing amounts unknown', () => {
  const data = workspace();
  data.clientType = 'B2B' as OfferWorkspaceDocumentData['clientType'];
  data.templates[0].items[0].quantity = 2;
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['battery-kit'];
  draft.saleVatMode = 'STANDARD_23';
  const result = renderOfferWorkspaceDocument(data, draft);
  const pageTen = parseSvg(result.pages[9].svg);

  assert.equal(textById(pageTen, '_cena_jednostkowa_brutto_1_2'), '13 750,00 PLN');
  assert.equal(textById(pageTen, '_wartoÅÄ_brutto_1_2'), '27 500,00 PLN');
  assert.equal(textById(pageTen, '_kwota_koszt_systemu_2'), '27 500,00 PLN');
  assert.match(textById(pageTen, '_cena_jednostkowa_brutto_4'), /netto/);
  assert.match(textById(pageTen, '_wartoÅÄ_brutto_4'), /netto/);
  assert.equal(textById(pageTen, '_kwota_po_dofinansowaniach_2'), '—');
});

test('aggregates overflow into the final row and reconciles displayed totals to system cost', () => {
  const data = workspace();
  const template = data.templates[0];
  const item = template.items[0];
  template.items = Array.from({ length: 9 }, (_, index) => ({
    ...item, id: `item-${index + 1}`, position: index + 1,
    description: `Pozycja ${index + 1}`, quantity: index + 1,
  }));
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['battery-kit'];
  draft.saleVatMode = 'REDUCED_8';
  const result = renderOfferWorkspaceDocument(data, draft);
  const pageTen = parseSvg(result.pages[9].svg);
  const suffixes = ['1_2', '2_2', '3_2', '3_4', '3_6', '3_8', '3_10'];

  for (let index = 0; index < 6; index += 1) {
    assert.equal(textById(pageTen, `_nazwa_pozycji_${suffixes[index]}`), `Pozycja ${index + 1}`);
  }
  assert.equal(textById(pageTen, '_nazwa_pozycji_3_10'), 'Pozostałe pozycje zestawu (3)');
  assert.equal(textById(pageTen, '_nazwa_modelu_3_10'), '', 'aggregate row has no misleading single product model');
  assert.equal(textById(pageTen, '_ilosc_3_10'), '1');
  assert.equal(textById(pageTen, '_cena_jednostkowa_brutto_3_10'), textById(pageTen, '_wartoÅÄ_brutto_3_10'));
  const displayedLineSum = suffixes.reduce((sum, suffix) => (
    sum + moneyValue(textById(pageTen, `_wartoÅÄ_brutto_${suffix}`))
  ), 0);
  assert.ok(Math.abs(displayedLineSum - moneyValue(textById(pageTen, '_kwota_koszt_systemu_2'))) < 0.01,
    'all displayed line totals, including the overflow aggregate, equal the pre-financing system cost');
  assert.ok(result.missingData.some((item) => item.page === 10 && item.fieldKeys.includes('draft.selectedTemplateIds.overflow')));
  assert.ok(result.limitations.some((item) => item.includes('nadmiar pozycji jest agregowany')));
  assert.ok(result.limitations.some((item) => item.includes('Dokument pozostaje szkicem roboczym')));
});

test('shows dashes for an incomplete overflow aggregate instead of partial prices', () => {
  const data = workspace();
  const template = data.templates[0];
  const item = template.items[0];
  template.items = Array.from({ length: 8 }, (_, index) => ({
    ...item, id: `item-${index + 1}`, position: index + 1, quantity: 1,
  }));
  template.items[7].product = null;
  template.items[7].unitPurchaseNet = null;
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['battery-kit'];
  draft.saleVatMode = 'REDUCED_8';
  const result = renderOfferWorkspaceDocument(data, draft);
  const pageTen = parseSvg(result.pages[9].svg);

  assert.equal(textById(pageTen, '_nazwa_pozycji_3_10'), 'Pozostałe pozycje zestawu (2)');
  assert.equal(textById(pageTen, '_cena_jednostkowa_brutto_3_10'), '—');
  assert.equal(textById(pageTen, '_wartoÅÄ_brutto_3_10'), '—');
  assert.equal(textById(pageTen, '_kwota_koszt_systemu_2'), '—');
  assert.ok(result.missingData.some((entry) => entry.fieldKeys.includes('draft.selectedTemplateIds.overflow.pricing')));
});

test('zero PV capacity is rendered as no existing PV and leaves installation type unknown', () => {
  const data = workspace();
  data.input.existingPv = { powerKw: 0, tiltDegrees: null, azimuthDegrees: null };
  const result = renderOfferWorkspaceDocument(data, emptyOfferWorkspaceDraft());
  const pageOne = parseSvg(result.pages[0].svg);
  assert.equal(textById(pageOne, '#instalacja_fotowoltaiczna'), 'Nie');
  assert.equal(textById(pageOne, '#miejsce_instalacji_fotowoltaicznej'), '');
});

test('V4 maps month hash fields by calendar month and never copies current energy to forecast page', () => {
  const data = workspace();
  data.measurements.months.reverse();
  const energy = energyFixture(data);
  energy.months = energy.months.map((month) => {
    const monthNumber = Number(month.period.slice(5, 7));
    return { ...month, loadKwh: monthNumber * 100, pvKwh: monthNumber * 10, directKwh: monthNumber * 5 };
  }).reverse();
  data.energy = energy;
  const draft = emptyOfferWorkspaceDraft();
  draft.existingBatteryPresent = false;
  draft.saleVatMode = 'REDUCED_8';
  draft.selectedTemplateIds = ['battery-kit'];

  const result = renderOfferWorkspaceDocument(data, draft, { templateKey: OFFER_TEMPLATE_V4_KEY });
  const pageThree = parseSvg(result.pages[2].svg);
  const pageFour = parseSvg(result.pages[3].svg);

  assert.equal(result.templateKey, OFFER_TEMPLATE_V4_KEY);
  assert.equal(textById(pageThree, '#b2c_calkowite_uzycie_energii_kwh_styczen_strona_03'), '100');
  assert.equal(textById(pageThree, '#b2c_produkcja_z_pv_grudzien_strona_03'), '120');
  assert.equal(textById(pageThree, '#b2c_autokonsumpcja_z_pv_kwh_maj_strona_03'), '25');
  assert.equal(textById(pageThree, '#b2c_autokonsumpcja_z_magazynu_kwh_styczen_strona_03'), '0');
  const consumptionValues = Array.from({ length: 12 }, (_, index) => (index + 1) * 100);
  const januaryConsumptionCell = monthlyCellBackground(pageThree, '#b2c_calkowite_uzycie_energii_kwh_styczen_strona_03');
  const decemberConsumptionCell = monthlyCellBackground(pageThree, '#b2c_calkowite_uzycie_energii_kwh_grudzien_strona_03');
  assert.equal(januaryConsumptionCell?.getAttribute('fill'), monthlyCellFill('consumption', 100, consumptionValues));
  assert.equal(decemberConsumptionCell?.getAttribute('fill'), monthlyCellFill('consumption', 1200, consumptionValues));
  assert.equal(
    monthlyCellBackground(pageThree, '#b2c_produkcja_z_pv_styczen_strona_03')?.getAttribute('fill'),
    monthlyCellFill('pv', 10, Array.from({ length: 12 }, (_, index) => (index + 1) * 10)),
    'the PV row uses its own values and gold palette',
  );
  assert.notEqual(
    januaryConsumptionCell?.getAttribute('fill'),
    decemberConsumptionCell?.getAttribute('fill'),
    'monthly fills follow each calendar month after the source arrays are reversed',
  );
  assert.notEqual(
    elementById(pageThree, '_autokonsumpcja_magazyn_aktualny_styczen_kolor')?.getAttribute('fill'),
    '#F7F7F7',
    'a real zero receives a pale storage tint rather than the missing-data neutral',
  );
  assert.equal(textById(pageThree, '#b2c_zuzycie_energii_rok_strona_03'), '3 600');
  assert.equal(textById(pageFour, '#b2c_energia_pobrana_z_sieci_prognozowana_strona_04'), '—');
  assert.equal(textById(pageFour, '#b2c_produkcja_z_pv_grudzien_prognozowana_strona_04'), '—');
  const annualSummary = elementById(pageFour, 'sekcja / podsumowanie_roczne')!;
  const exampleFills = new Set(['#fed17f', '#8d96aa', '#006c30', '#fc7c00', '#44e09c', '#00d477']);
  const remainingTableFills = Array.from(annualSummary.getElementsByTagName('*'))
    .filter((element) => ['path', 'rect', 'polygon', 'polyline', 'circle', 'ellipse', 'use'].includes((element as XmlElement).localName || ''))
    .filter((element) => exampleFills.has(((element as XmlElement).getAttribute('fill') || '').toLowerCase()));
  assert.equal(remainingTableFills.length, 0, 'missing forecast values leave neutral cell fills instead of template examples');
  assert.equal(elementById(pageFour, 'Vector_129')?.getAttribute('fill'), '#F7F7F7');
  assert.equal(elementById(pageFour, 'workspace-calculated-forecast-monthly-series'), undefined,
    'no forecast bars are added without a completed calculation');
  assert.ok(annualSummary.getElementsByTagName('text').length > 0, 'monthly labels and table framing remain');
  assert.ok(result.missingData.some((item) => item.page === 4 && item.fieldKeys.includes('simulation.futureMonthlySeries')));
});

test('V4 daily modeled series are scoped to current panels and future panels stay empty', () => {
  const data = workspace();
  data.energy = energyFixture(data);
  const result = renderOfferWorkspaceDocument(data, emptyOfferWorkspaceDraft(), { templateKey: OFFER_TEMPLATE_V4_KEY });
  const pageFive = parseSvg(result.pages[4].svg);
  const pageFiveText = Array.from(pageFive.getElementsByTagName('text')).map((element) => element.textContent || '').join(' ');
  assert.match(pageFiveText, /\(Taryfa:\s*/);
  assert.doesNotMatch(pageFiveText, /Taryfa (?:jednostrefowa|trójstrefowa)/);
  const currentPanel = elementById(pageFive, 'sekcja / stan_aktualny')!;
  const futurePanel = elementById(pageFive, 'Group 1298')!;
  const currentSeries = Array.from(currentPanel.getElementsByTagName('*'))
    .find((element) => element.getAttribute('id') === 'workspace-modelled-hourly-series');

  assert.ok(currentSeries, 'series is nested under the semantic current panel');
  assert.equal(elementById(futurePanel as unknown as XmlDocument, 'workspace-modelled-hourly-series'), undefined);
  assert.equal(textById(pageFive, '#b2c_moc_instalacji_fotowoltaicznej_strona_05'), '8,2', 'current PV stays in the current panel');
  assert.equal(textById(pageFive, '#b2c_moc_pv_prognozowana_strona_05'), '8,2', 'KEEP_EXISTING carries known PV capacity into the future panel');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_zuzycie_energii_suma_kwh_strona_05'), '12,00');
  assert.equal(textById(pageFive, '#b2c_taryfa_prognozowana_strona_05'), '—');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_oszczednosc_pln_strona_05'), '—');
  assert.equal(Array.from(futurePanel.getElementsByTagName('*')).some((element) => element.getAttribute('data-series')), false);
});

test('V4 daily tariff headers reflow long labels and retain known PV under KEEP_EXISTING', () => {
  const data = workspace();
  data.energy = energyFixture(data);
  data.input.existingPv!.powerKw = 9.99;
  const draft = emptyOfferWorkspaceDraft();
  draft.existingPv.powerKw = 9.99;
  draft.pvStrategy = 'KEEP_EXISTING';
  const result = renderOfferWorkspaceDocument(data, draft, {
    templateKey: OFFER_TEMPLATE_V4_KEY,
    tariffLabels: { proposed: 'G13active' },
  });
  assert.ok(result.sourceFieldsUsed.includes('draft.existingPv.powerKw'));
  assert.ok(!result.sourceFieldsUsed.includes('templates.powerKw'));
  const italicBytes = fs.readFileSync(path.join(process.cwd(), 'public', 'fonts', 'dm-sans', 'DMSans-Italic.ttf'));
  const italic = parseFont(italicBytes.buffer.slice(italicBytes.byteOffset, italicBytes.byteOffset + italicBytes.byteLength) as ArrayBuffer);
  const width = (element: XmlElement) => {
    const span = element.getElementsByTagName('tspan')[0] as XmlElement;
    const size = Number(span.getAttribute('font-size') || element.getAttribute('font-size') || 8);
    return italic.getAdvanceWidth((element.textContent || '').trim(), size);
  };
  const bounds = (element: XmlElement) => {
    const span = element.getElementsByTagName('tspan')[0] as XmlElement;
    const x = Number(span.getAttribute('x'));
    const textWidth = width(element);
    return span.getAttribute('text-anchor') === 'end'
      ? { start: x - textWidth, end: x }
      : { start: x, end: x + textWidth };
  };

  for (const page of [5, 6, 7, 8]) {
    const suffix = String(page).padStart(2, '0');
    const document = parseSvg(result.pages[page - 1].svg);
    const tariff = elementById(document, `#b2c_taryfa_prognozowana_strona_${suffix}`)!;
    const tariffFollowing = elementById(document, 'stale / tekst_3')!;
    const pv = elementById(document, `#b2c_moc_pv_prognozowana_strona_${suffix}`)!;
    const pvFollowing = elementById(document, 'stale / tekst_4')!;
    const capacity = elementById(document, `#b2c_pojemnosc_magazynu_prognozowana_strona_${suffix}`)!;
    const capacityUnit = elementById(document, 'stale / jednostka lub dopisek_2')!;
    const tariffBounds = bounds(tariff);
    const followingBounds = bounds(tariffFollowing);
    const pvBounds = bounds(pv);
    const pvFollowingBounds = bounds(pvFollowing);
    const capacityBounds = bounds(capacity);

    assert.equal(tariff.textContent?.trim(), 'G13active');
    assert.equal(pv.textContent?.trim(), '10,0', '9.99 kWp is rendered at the established one-decimal precision');
    assert.ok(followingBounds.start >= tariffBounds.end + 1.5, `page ${page}: tariff does not collide with Fotowoltaika`);
    assert.ok(pvBounds.start >= followingBounds.end + 1.5, `page ${page}: Fotowoltaika label does not collide with its value`);
    assert.ok(pvFollowingBounds.start >= pvBounds.end + 1.5, `page ${page}: PV value does not collide with kWp label`);
    assert.ok(capacityBounds.start >= pvFollowingBounds.end + 1.5, `page ${page}: Magazyn energii label does not collide with capacity`);
    assert.ok(bounds(capacityUnit).start >= capacityBounds.end + 1.5, `page ${page}: capacity does not collide with kWh unit`);
    assert.ok(bounds(capacityUnit).end < 550, `page ${page}: daily tariff header stays inside its panel`);
  }
});

test('V4 page 10 uses selected catalog pricing and keeps finance outcomes unknown', () => {
  const data = workspace();
  data.templates[0].items[0].quantity = 2;
  data.templates[0].items[0].product!.name = 'Battery Model X with an intentionally long catalogue description for line wrapping';
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['battery-kit'];
  draft.saleVatMode = 'REDUCED_8';
  const result = renderOfferWorkspaceDocument(data, draft, { templateKey: OFFER_TEMPLATE_V4_KEY });
  const pageTen = parseSvg(result.pages[9].svg);
  const pageTenText = pageTen.documentElement?.textContent || '';

  assert.equal(textById(pageTen, '#b2c_kosztorys_pozycja_1_strona_10'), 'Magazyn energii');
  const modelLines = textLinesById(pageTen, '#b2c_kosztorys_model_1_strona_10');
  assert.ok(modelLines.length > 1);
  assert.equal(modelLines.join(' '), 'Acme Battery Model X with an intentionally long catalogue description for line wrapping');
  const modelYs = modelLines.map((_, index) => Number(elementById(pageTen, '#b2c_kosztorys_model_1_strona_10')!
    .getElementsByTagName('tspan')[index].getAttribute('y')));
  assert.ok(modelYs.every((y, index) => index === 0 || y > modelYs[index - 1]), 'wrapped model lines use distinct baselines');
  assert.equal(textById(pageTen, '#b2c_kosztorys_ilosc_1_strona_10'), '2');
  assert.equal(textById(pageTen, '#b2c_kosztorys_cena_jednostkowa_brutto_1_strona_10'), '14 850,00');
  assert.equal(textById(pageTen, '#b2c_kosztorys_wartosc_brutto_1_strona_10'), '29 700,00');
  assert.equal(textById(pageTen, '#b2c_koszt_systemu_strona_10'), '29 700,00');
  for (const id of ['#b2c_kosztorys_cena_jednostkowa_brutto_1_strona_10',
    '#b2c_kosztorys_wartosc_brutto_1_strona_10', '#b2c_koszt_systemu_strona_10']) {
    assert.doesNotMatch(textById(pageTen, id), /PLN/, 'amount text excludes the separate static PLN unit');
  }
  assert.equal(textById(pageTen, '#b2c_prognozowana_kwota_dotacji_z_programu_strona_10'), '—');
  assert.equal(textById(pageTen, '#b2c_prognozowana_ulga_termomodernizacyjna_strona_10'), '—');
  assert.equal(textById(pageTen, '#b2c_prognozowany_koszt_sytemu_po_dofinansowaniach_strona_10'), '—');
  assert.ok(!pageTenText.includes('Dyness Stack 314 16.07 kWh'));
  assert.ok(!pageTenText.includes('75 000,00'));
  assert.ok(result.sourceFieldsUsed.includes('templates.items.product.prices'));
  assert.ok(result.limitations.some((item) => item.includes('system cost jest przed finansowaniem')));
  assert.equal(inspectOfferTemplateV4().pages[9].fields.length, result.pages[9].replacedFieldKeys.length);
});

test('V4 keeps dimension arrows on the dedicated STACK314 and cabinet photographs', () => {
  for (const [sku, count, prefix, height, width, depth] of [
    ['ES-Dyness-STACK314-16.04kWh-EU', 3, 'stack314', 983, 770, 425],
    ['ES-Dyness-BF100-C100-EU', 2, 'cabinet', 2260, 725, 1200],
  ] as const) {
    const data = workspace();
    const item = data.templates[0].items[0];
    item.product!.sku = sku;
    item.quantity = count;
    if (prefix === 'stack314') data.templates[0].items.push({
      ...item, id: 'bdu', quantity: 1, product: { ...item.product!, id: 'bdu-product', sku: 'ES-Dyness-STACK314-BDU-EU' },
    });
    const draft = { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['battery-kit'], saleVatMode: 'REDUCED_8' as const };
    const result = renderOfferWorkspaceDocument(data, draft, { templateKey: OFFER_TEMPLATE_V4_KEY });
    const page = parseSvg(result.pages[1].svg);
    assert.equal(elementById(page, 'grafika / magazyn')!.getElementsByTagName('image').length, 1);
    for (const [dimension, expected] of [['height', height], ['width', width], ['depth', depth]] as const) {
      assert.equal(textById(page, `${prefix}-dimension-${dimension}-label`).replace(/\s/g, ''), `${expected}mm`);
      assert.equal(elementById(page, `${prefix}-dimension-${dimension}`)!.getElementsByTagName('path').length, 3);
    }
    assert.ok(!result.missingData.some(item => item.page === 2 && item.reason.includes('ilustracji')));
  }
});

test('removed main battery stays visible in the quote and cannot drive forecast metrics or illustrations', () => {
  const data = workspace();
  data.templates[0].items[0].role = 'MAIN_EQUIPMENT';
  data.templates[0].items[0].product!.sku = 'ES-Dyness-LV-PowerBrick-Plus-16.07kWh-EU';
  const draft = {
    ...emptyOfferWorkspaceDraft(),
    selectedTemplateIds: ['battery-kit'],
    saleVatMode: 'MIXED' as const,
    configurationEdits: [{ templateId: 'battery-kit', items: [{ itemId: 'item-1', removed: true }] }],
  };
  const v3 = renderOfferWorkspaceDocument(data, draft);
  const pageTen = parseSvg(v3.pages[9].svg).documentElement?.textContent || '';
  assert.ok(pageTen.includes('USUNIĘTA'));
  assert.ok(pageTen.includes('Magazyn energii'));

  const v4 = renderOfferWorkspaceDocument(data, draft, { templateKey: OFFER_TEMPLATE_V4_KEY });
  const pageTwo = parseSvg(v4.pages[1].svg).documentElement?.textContent || '';
  assert.ok(pageTwo.includes('Nie pokazano ilustracji, ponieważ usunięto główne urządzenie magazynu.'));
  const storageGraphic = parseSvg(v4.pages[1].svg).getElementById('grafika / magazyn');
  assert.equal(storageGraphic?.getElementsByTagName('image').length, 0);
  assert.ok(v4.missingData.some(item => item.page === 2 && item.reason.includes('Usunięto główne urządzenie magazynu')));
  assert.ok(v4.sourceFieldsUsed.includes('draft.configurationEdits'));
});

function billingInterval(
  startUtc: string,
  endUtc: string,
  amounts: Partial<OfferBillingIntervalResult> = {},
): OfferBillingIntervalResult {
  return {
    startUtc, endUtc, month: '2026-05', importKwh: 1, exportKwh: 1, billedImportKwh: 1, billedExportKwh: 1,
    energyCostPln: 10, distributionCostPln: 2, fixedCostPln: 1, totalCostPln: 13, coveredKwh: 0,
    coveredEnergyPln: 0, coveredDistributionPln: 0, exportValuePln: 2, depositEarnedPln: 2, depositUsedPln: 0,
    depositExpiredPln: 0, depositRefundedPln: 0, depositBalancePln: 0, pendingDepositPln: 0,
    creditAddedKwh: 0, creditUsedKwh: 0, creditExpiredKwh: 0, creditBalanceKwh: 0, cashDuePln: 13,
    ...amounts,
  };
}

function billingScenario(intervals: OfferBillingIntervalResult[], amountOverrides: Record<string, number>): OfferBillingScenarioResult {
  const totals = {
    importKwh: 288, exportKwh: 864, billedImportKwh: 288, billedExportKwh: 864,
    energyCostPln: 200, distributionCostPln: 50, fixedCostPln: 25, totalCostPln: 275,
    coveredKwh: 0, coveredEnergyPln: 0, coveredDistributionPln: 0, exportValuePln: 30, depositEarnedPln: 30,
    depositUsedPln: 10, depositExpiredPln: 0, depositRefundedPln: 0, depositBalancePln: 5, pendingDepositPln: 5,
    creditAddedKwh: 0, creditUsedKwh: 0, creditExpiredKwh: 0, creditBalanceKwh: 0, cashDuePln: 250,
    ...amountOverrides,
  };
  return { intervals, months: [{ month: '2026-05', ...totals }], totals };
}

function billingComponent(category: OfferBillingCostComponent['category'], amountPln: number): OfferBillingCostComponent {
  return { componentKey: category, label: category, category, amountPln };
}

test('V4 maps authoritative calculation forecasts, billing outputs, and UTC-matched daily battery flows', () => {
  const data = workspace();
  data.input.location!.address = 'Daszewicka 23C, 61-328 Poznań, Polska';
  data.input.reportDetails!.pvInstallationPlace = 'Dach';
  data.input.reportDetails!.highLoadDevices = 'Pompa ciepła 8 kW; ładowarka 11 kW';
  data.input.reportDetails!.plannedHighLoadDevices = 'Planowane: brak danych';
  data.templates[0].items[0].product!.sku = 'ES-Dyness-LV-PowerBrick-Plus-16.07kWh-EU';
  data.energy = energyFixture(data);
  data.energy.months[0] = { ...data.energy.months[0], period: '2025-08', loadKwh: 100 };
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['battery-kit'];
  draft.saleVatMode = 'REDUCED_8';
  draft.currentSettlement = 'NET_METERING';
  draft.targetSettlement = 'NET_BILLING';
  draft.description.after = 'Opis potwierdzony w szkicu oferty.';
  const forecastEnergy = energyFixture(data);
  forecastEnergy.totals = { loadKwh: 7200, pvKwh: 8400, directKwh: 2300 };
  forecastEnergy.months = [
    { period: '2026-01', loadKwh: 400, pvKwh: 500, directKwh: 100 },
    { period: '2025-08', loadKwh: 300, pvKwh: 400, directKwh: 90 },
    { period: '2026-03', loadKwh: 500, pvKwh: 700, directKwh: 150 },
    { period: '2026-05', loadKwh: 900, pvKwh: 1200, directKwh: null },
  ];
  const forecastMeasurements = {
    ...data.measurements,
    totalsImportKwh: 500,
    totalsExportKwh: 100,
    months: [{ period: '2026-05', importKwh: null, exportKwh: null }],
  };
  const currentMeterProfile = data.measurements.dayProfiles.find((profile) => profile.date === '2026-05-12')!;
  const selectedDailyProfiles = ['2026-05-12', '2026-05-11', '2026-01-13', '2026-01-12']
    .map((date) => data.measurements.dayProfiles.find((profile) => profile.date === date)!);
  const flowCases = selectedDailyProfiles.flatMap((profile) => {
    const offset = profile.period.endsWith('-01') ? '+01:00' : '+02:00';
    const localMidnightUtc = Date.parse(`${profile.date}T00:00:00${offset}`);
    const hasDailyEnergy = profile.date === currentMeterProfile.date;
    return profile.hours.map((meterHour) => {
      const start = new Date(localMidnightUtc + meterHour.hour * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      return {
        meterHour,
        flow: {
          startUtc: start.toISOString(), endUtc: end.toISOString(), loadKwh: hasDailyEnergy ? 1 : 0,
          pvKwh: hasDailyEnergy ? 2 : 0, directKwh: hasDailyEnergy ? 0.5 : 0,
          importKwh: hasDailyEnergy ? 0.5 : 0, exportKwh: hasDailyEnergy ? 1.5 : 0,
          batteryToLoadKwh: hasDailyEnergy ? 0.25 : 0, gridToBatteryKwh: hasDailyEnergy ? 0.1 : 0,
          pvToBatteryKwh: hasDailyEnergy ? 0.75 : 0, batteryToGridKwh: hasDailyEnergy ? 0.2 : 0, socKwh: 0.5,
        },
      };
    });
  });
  const flows = flowCases.map(({ flow }) => flow);
  const beforeIntervals = flowCases.map(({ flow, meterHour }) => billingInterval(flow.startUtc, flow.endUtc, {
    importKwh: meterHour.importKwh!,
    exportKwh: meterHour.exportKwh!,
    energyCostPln: 20, distributionCostPln: 3, fixedCostPln: 1, totalCostPln: 24, cashDuePln: 24,
  }));
  const afterIntervals = flows.map((flow) => billingInterval(flow.startUtc, flow.endUtc, {
    importKwh: flow.importKwh, exportKwh: flow.exportKwh,
    energyCostPln: 10, distributionCostPln: 2, fixedCostPln: 1, totalCostPln: 13,
    coveredEnergyPln: 1, coveredDistributionPln: 0.5, depositUsedPln: 1.5, cashDuePln: 13,
  }));
  data.calculation = {
    status: 'ready', reasons: [], warnings: ['Prognoza modelowa, nie gwarancja.'],
    baselineAnnualCostPln: 10000, proposedAnnualCostPln: 4000, annualSavingsPln: 6000,
    systemCostPln: 29700, costAfterFinancingPln: 17000, paybackYears: 2.8333, estimatedPaybackYears: 2.8333, estimatedAnnualPriceGrowthRate: 0.05, estimatedAnnualExportPriceGrowthRate: 0,
    grantPln: 5000, taxReliefPln: 3000, rankings: [], recommendedTemplateIds: ['battery-kit'],
    forecastEnergy, forecastMeasurements,
    baselineBill: billingScenario(beforeIntervals, {
      energyCostPln: 200, distributionCostPln: 50, fixedCostPln: 25, totalCostPln: 275, cashDuePln: 10000,
      billedImportKwh: 248, coveredKwh: 40, coveredEnergyPln: 20,
    }),
    proposedBill: billingScenario(afterIntervals, { energyCostPln: 90, distributionCostPln: 35, fixedCostPln: 25, totalCostPln: 150, cashDuePln: 4000, depositEarnedPln: 75, depositUsedPln: 40, depositRefundedPln: 125.45, depositBalancePln: 12, pendingDepositPln: 8, coveredEnergyPln: 25, coveredDistributionPln: 5 }),
    forecastFlows: flows,
  };
  data.calculation.baselineBill!.totals.distributionComponents = [
    billingComponent('network', 28), billingComponent('quality', 12), billingComponent('oze', 5), billingComponent('cogeneration', 5),
  ];
  data.calculation.baselineBill!.totals.fixedComponents = [
    billingComponent('fixed_network', 10), billingComponent('capacity', 10), billingComponent('subscription', 5),
  ];
  data.calculation.proposedBill!.totals.distributionComponents = [
    billingComponent('network', 20), billingComponent('quality', 8), billingComponent('oze', 4), billingComponent('cogeneration', 3),
  ];
  data.calculation.proposedBill!.totals.fixedComponents = [
    billingComponent('fixed_network', 10), billingComponent('capacity', 8), billingComponent('subscription', 2), billingComponent('commercial', 5),
  ];
  data.calculation.proposedBill!.intervalTariffs = flowCases.map(({ flow, meterHour }) => {
    const zone = meterHour.hour < 8 ? 'low' : meterHour.hour < 16 ? 'mid' : 'high';
    return {
      startUtc: flow.startUtc, endUtc: flow.endUtc, energyZone: zone, distributionZone: zone,
      energyRatePlnPerKwh: zone === 'low' ? 0.2 : zone === 'mid' ? 0.3 : 0.4,
      distributionRatePlnPerKwh: 0.1,
    };
  });
  data.calculation.baselineBill!.totals.totalCostPln = 8556.19;
  data.calculation.proposedBill!.totals.totalCostPln = 6402.97;

  const result = renderOfferWorkspaceDocument(data, draft, {
    templateKey: OFFER_TEMPLATE_V4_KEY,
    tariffLabels: { current: 'G11', proposed: 'G12', currentOperator: 'Enea Operator' },
  });
  const pageOne = parseSvg(result.pages[0].svg);
  const pageTwo = parseSvg(result.pages[1].svg);
  const pageThree = parseSvg(result.pages[2].svg);
  const pageFour = parseSvg(result.pages[3].svg);
  const pageFive = parseSvg(result.pages[4].svg);
  const pageNine = parseSvg(result.pages[8].svg);
  const pageTen = parseSvg(result.pages[9].svg);

  assert.equal(textById(pageOne, '#b2c_nr_reform_strona_01'), 'Szkic oferty');
  assert.equal(textById(pageTwo, '#b2c_nr_reform_strona_02'), 'Szkic oferty');
  for (const pageNumber of [3, 4, 5, 6, 7, 8, 9, 10]) {
    const numberedPage = parseSvg(result.pages[pageNumber - 1].svg);
    assert.equal(textById(numberedPage, `#b2c_nr_reform_strona_${String(pageNumber).padStart(2, '0')}`), 'Szkic oferty');
  }
  const storageGraphic = elementById(pageTwo, 'grafika / magazyn')!;
  assert.ok(storageGraphic.getElementsByTagName('image')[0].getAttribute('href')?.startsWith('data:image/png;base64,'));
  assert.ok(textById(pageTwo, 'grafika / magazyn').includes('1 szt. PowerBrick Plus'));
  for (const [dimension, value] of [['width', '435 mm'], ['height', '850 mm'], ['depth', '235 mm']]) {
    const arrow = elementById(pageTwo, `powerbrick-dimension-${dimension}`)!;
    assert.ok(arrow, `PowerBrick ${dimension} dimension arrow exists`);
    assert.equal(textById(pageTwo, `powerbrick-dimension-${dimension}-label`), value);
    assert.equal(arrow.getElementsByTagName('path').length, 3, 'each dimension uses a line with two arrowheads');
    assert.ok(Array.from(arrow.getElementsByTagName('path')).every(path => path.getAttribute('d')));
  }
  assert.ok(textById(pageTwo, '#b2c_opis_oferty_strona_02').includes('Opis potwierdzony w szkicu oferty.'));
  assert.equal(textById(pageOne, '#b2c_operator_systemu_dystrybucyjnego_strona_01'), 'Enea Operator');
  assert.equal(textById(pageOne, '#b2c_dane_rozliczeniowe_taryfa_strona_01'), 'G11');
  assert.equal(textById(pageOne, '#b2c_miejsce_instalacji_fotowoltaicznej_strona_01'), 'Dach');
  assert.equal(textById(pageOne, '#b2c_posiadane_urzadzenia_o_duzym_poborze_energii_strona_01'), 'Pompa ciepła 8 kW; ładowarka 11 kW');
  assert.equal(textById(pageOne, '#b2c_planowane_urzadzenia_o_duzym_poborze_energii_strona_01'), 'Planowane: brak danych');
  assert.equal(textById(pageOne, '#b2c_oplaty_stale_i_dystrybucyjne_strona_01'), '75,00');
  assert.equal(textById(pageOne, '#b2c_zakup_energii_strona_01'), '200,00');
  assert.equal(textById(pageOne, '#b2c_twoj_rachunek_strona_01'), '10 000,00');
  const addressLines = textLinesById(pageOne, '#b2c_adres_report_strona_01');
  assert.equal(addressLines.join(' ').replace(/\s+/g, ' ').trim(), 'Daszewicka 23C, 61-328 Poznań, Polska');
  assert.equal(addressLines.length, 2, 'the long address wraps within the left-hand panel');
  assert.ok(result.sourceFieldsUsed.includes('documentContext.tariffLabels.currentOperator'));
  assert.equal(textById(pageThree, '#b2c_zuzycie_energii_rok_strona_03'), '3 600', 'baseline remains workspace.energy');
  assert.equal(textById(pageThree, '#b2c_miesiac_o_srednim_zuzyciu_strona_03'), 'Średnia miesięczna',
    'an average has a semantic label instead of a fabricated month');
  assert.equal(elementById(pageThree, '#b2c_calkowite_uzycie_energii_kwh_maj_strona_03')!.getAttribute('font-family'), 'DM Sans',
    'monthly baseline values use the embedded DM Sans face');
  const baselineLowMonth = elementById(pageThree, '#b2c_miesiac_o_malym_zuzyciu_strona_03')!;
  assert.equal(textById(pageThree, '#b2c_miesiac_o_malym_zuzyciu_strona_03'), '2025-08');
  assert.equal(baselineLowMonth.getElementsByTagName('tspan')[0].getAttribute('x'), '387');
  assert.equal(baselineLowMonth.getElementsByTagName('tspan')[0].getAttribute('text-anchor'), null,
    'year-month values are not treated as signed numbers for unit alignment');
  assert.equal(textById(pageThree, '#b2c_okres_strona_03'), '2025-08 - 2026-09)');
  assert.equal(textById(pageThree, '#b2c_wartosc_energii_pobranej_strona_03'), '270,00');
  assert.equal(textById(pageThree, '#b2c_wartosc_energii_oddanej_strona_03'), 'Nie dotyczy', 'net-metering export has no fabricated PLN value');
  assert.equal(textById(pageThree, '#b2c_srednia_cena_1_kwh_pln_strona_03'), 'Nie dotyczy', 'net-metering export has no fabricated unit rate');
  assert.equal(textById(pageThree, '#b2c_srednia_cena_1kwh_pln_strona_03'), '0,938');
  assert.equal(textById(pageThree, 'stale / jednostka lub dopisek'), '');
  assert.equal(textById(pageThree, 'stale / jednostka lub dopisek_6'), '', 'not-applicable export rate has no PLN/kWh suffix');
  const baselinePvPercent = elementById(pageThree, '#b2c_autokonsumpcja_z_pv_procent_strona_03')!;
  const baselinePvPercentUnit = elementById(pageThree, 'stale / jednostka lub dopisek_9')!;
  assert.equal(textById(pageThree, '#b2c_autokonsumpcja_z_pv_procent_strona_03'), '25,0');
  assert.equal((baselinePvPercent.textContent || '').includes('%'), false, 'the source percent sign is emitted once');
  assert.equal((baselinePvPercent.parentNode?.textContent || '').match(/%/g)?.length, 1);
  assert.equal(Number(baselinePvPercent.getElementsByTagName('tspan')[0].getAttribute('font-size')),
    Number(baselinePvPercentUnit.getAttribute('font-size')));
  assert.equal(baselinePvPercent.getAttribute('font-variant-numeric'), 'tabular-nums');
  const baselinePvAmount = elementById(pageThree, '#b2c_autokonsumpcja_z_pv_strona_03')!;
  const baselinePvSeparator = elementById(pageThree, 'stale / tekst_2')!;
  const baselinePvTypeFaceBytes = fs.readFileSync(path.join(process.cwd(), 'public', 'fonts', 'dm-sans', 'DMSans-Regular.ttf'));
  const baselinePvTypeFace = parseFont(baselinePvTypeFaceBytes.buffer.slice(
    baselinePvTypeFaceBytes.byteOffset, baselinePvTypeFaceBytes.byteOffset + baselinePvTypeFaceBytes.byteLength,
  ) as ArrayBuffer);
  const inlineSize = Number(baselinePvAmount.getElementsByTagName('tspan')[0].getAttribute('font-size'));
  const advance = (value: string) => baselinePvTypeFace.getAdvanceWidth(value, inlineSize);
  const amountSeparatorGap = absoluteTextX(baselinePvSeparator) - absoluteTextX(baselinePvAmount)
    - advance(textById(pageThree, '#b2c_autokonsumpcja_z_pv_strona_03'));
  assert.ok(Math.abs(absoluteTextX(baselinePvSeparator) - absoluteTextX(baselinePvAmount)
    - advance(textById(pageThree, '#b2c_autokonsumpcja_z_pv_strona_03')) - 4) < 0.001,
  `the slash separator follows the amount with a measured gap (actual: ${amountSeparatorGap})`);
  assert.ok(Math.abs(absoluteTextX(baselinePvPercent) - absoluteTextX(baselinePvSeparator)
    - advance('kWh /') - 4) < 0.001, 'the percentage follows the complete kWh slash label');
  assert.ok(Math.abs(absoluteTextX(baselinePvPercentUnit) - absoluteTextX(baselinePvPercent)
    - advance(textById(pageThree, '#b2c_autokonsumpcja_z_pv_procent_strona_03')) - 4) < 0.001);
  const exportValueNotApplicable = elementById(pageThree, '#b2c_wartosc_energii_oddanej_strona_03')!;
  const exportRateNotApplicable = elementById(pageThree, '#b2c_srednia_cena_1_kwh_pln_strona_03')!;
  assert.equal(absoluteTextX(exportValueNotApplicable), 380, 'the not-applicable PLN amount stays inside its wide cell');
  assert.equal(absoluteTextX(exportRateNotApplicable), 550, 'the not-applicable rate stays inside its wide cell');
  const purchaseRate = elementById(pageThree, '#b2c_srednia_cena_1kwh_pln_strona_03')!;
  const purchaseRateUnit = elementById(pageThree, 'stale / jednostka lub dopisek_7')!;
  assert.equal(absoluteTextX(purchaseRate), 510, 'annual price values share the explicit value column');
  assert.equal(absoluteTextX(purchaseRateUnit), 514, 'annual price units share the explicit unit column');
  const purchaseAmount = elementById(pageThree, '#b2c_wartosc_energii_pobranej_strona_03')!;
  const purchaseAmountUnit = elementById(pageThree, 'stale / jednostka lub dopisek_5')!;
  assert.equal(absoluteTextX(purchaseAmount), 358, 'annual PLN values share the right side of their cell');
  assert.equal(absoluteTextX(purchaseAmountUnit), 362, 'annual PLN units keep a fixed four-unit gap');
  assert.equal(Number(purchaseAmount.getElementsByTagName('tspan')[0].getAttribute('font-size')),
    Number(purchaseAmountUnit.getAttribute('font-size')), 'annual values and PLN use the same readable size');
  assert.equal(textById(pageFour, '#b2c_zuzycie_energii_prognozowane_strona_04'), '7 200');
  assert.equal(textById(pageFour, '#b2c_produkcja_z_pv_prognozowana_strona_04'), '8 400');
  assert.equal(textById(pageFour, '#b2c_calkowite_uzycie_energii_kwh_maj_prognozowane_strona_04'), '900');
  assert.equal(elementById(pageFour, '#b2c_calkowite_uzycie_energii_kwh_maj_prognozowane_strona_04')!.getAttribute('font-family'), 'DM Sans',
    'monthly forecast values use the embedded DM Sans face');
  assert.equal(textById(pageFour, '#b2c_autokonsumpcja_z_pv_kwh_maj_prognozowana_strona_04'), '12');
  assert.equal(textById(pageFour, '#b2c_energia_pobrana_z_sieci_kwh_maj_prognozowana_strona_04'), '12');
  assert.equal(textById(pageFour, '#b2c_energia_oddana_do_sieci_kwh_maj_prognozowana_strona_04'), '36');
  assert.equal(textById(pageFour, '#b2c_autokonsumpcja_z_magazynu_kwh_maj_prognozowana_strona_04'), '6');
  assert.equal(textById(pageFour, '#b2c_energia_pobrana_z_sieci_kwh_styczen_prognozowana_strona_04'), '0',
    'a forecast zero comes from forecast flows even when current meter data has a different value');
  assert.equal(textById(pageFour, '#b2c_energia_pobrana_z_sieci_kwh_luty_prognozowana_strona_04'), '—');
  assert.notEqual(elementById(pageFour, 'Vector_129')?.getAttribute('fill'), '#F7F7F7',
    'a forecast zero receives the row tint');
  assert.equal(elementById(pageFour, 'Vector_130')?.getAttribute('fill'), '#F7F7F7',
    'a forecast month without its own value remains neutral');
  assert.equal(textById(pageFour, '#b2c_energia_pobrana_z_sieci_prognozowana_strona_04'), '500');
  assert.equal(textById(pageFour, '#b2c_wartosc_energii_pobranej_prognozowana_strona_04'), '155,00', 'purchase value restores covered energy and distribution once');
  assert.equal(textById(pageFour, '#b2c_wartosc_energii_oddanej_prognozowana_strona_04'), '75,00', 'net-billing export value is the earned deposit');
  assert.equal(absoluteTextX(elementById(pageFour, '#b2c_wartosc_energii_pobranej_prognozowana_strona_04')!), 358);
  assert.equal(absoluteTextX(elementById(pageFour, 'stale / jednostka lub dopisek_5')!), 362);
  assert.equal(textById(pageFour, '#b2c_srednia_cena_1_kwh_pln_prognozowana_strona_04'), '0,087', 'export average is deposit-based, not raw RCE');
  assert.equal(textById(pageFour, '#b2c_srednia_cena_1kwh_pln_prognozowana_strona_04'), '0,538', 'purchase average uses gross purchase costs and billed import');
  assert.equal(absoluteTextX(elementById(pageFour, '#b2c_srednia_cena_1_kwh_pln_prognozowana_strona_04')!), 510);
  assert.equal(absoluteTextX(elementById(pageFour, 'stale / jednostka lub dopisek_6')!), 514);
  const forecastPvPercent = elementById(pageFour, '#b2c_autokonsumpcja_z_pv_prognozowana_procent_strona_04')!;
  const forecastPvPercentUnit = elementById(pageFour, 'stale / jednostka lub dopisek_9')!;
  assert.equal(textById(pageFour, '#b2c_autokonsumpcja_z_pv_prognozowana_procent_strona_04'), '27,4');
  assert.equal((forecastPvPercent.parentNode?.textContent || '').match(/%/g)?.length, 1,
    'the forecast row has one percent unit in total');
  const forecastPercentSize = Number(forecastPvPercent.getElementsByTagName('tspan')[0].getAttribute('font-size'));
  const forecastPercentWidth = baselinePvTypeFace.getAdvanceWidth(
    textById(pageFour, '#b2c_autokonsumpcja_z_pv_prognozowana_procent_strona_04'), forecastPercentSize,
  );
  assert.ok(Math.abs(absoluteTextX(forecastPvPercentUnit) - absoluteTextX(forecastPvPercent)
    - forecastPercentWidth - 4) < 0.001);
  assert.equal(textById(pageFour, '#b2c_miesiac_o_najwiekszym_zuzyciu_strona_04'), '2026-05');
  const forecastLowMonth = elementById(pageFour, '#b2c_miesiac_o_malym_zuzyciu_strona_04')!;
  assert.equal(textById(pageFour, '#b2c_miesiac_o_malym_zuzyciu_strona_04'), '2025-08');
  assert.equal(forecastLowMonth.getElementsByTagName('tspan')[0].getAttribute('x'), '387');
  assert.equal(forecastLowMonth.getElementsByTagName('tspan')[0].getAttribute('text-anchor'), null,
    'forecast year-month values retain their source position');
  assert.equal(textById(pageFour, '#b2c_zuzycie_energii_najwieksze_strona_04'), '900');
  assert.equal(textById(pageFour, '#b2c_miesiac_o_srednim_zuzyciu_strona_04'), 'Średnia miesięczna');
  assert.equal(textById(pageFour, '#b2c_zuzycie_energii_srednie_strona_04'), '525');
  assert.notEqual(elementById(pageFour, 'Vector_129')?.getAttribute('fill'), '#FC7C00', 'forecast cells no longer keep the static template fill');
  assert.ok(elementById(pageFour, 'workspace-calculated-forecast-monthly-series'));
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_pobrana_z_sieci_suma_kwh_po_strona_05'), '12,00');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_okres_strona_05'), '2026-05)');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_autokonsumpcja_z_magazynu_suma_kwh_po_strona_05'), '6,00');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_pobrana_do_magazynu_suma_kwh_po_strona_05'), '20,40');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_oszczednosc_pln_strona_05'), '264,00');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_pobrana_z_sieci_wartosc_strona_05'), '552,00',
    'current daily purchase includes energy and distribution before any coverage and matches measured hourly kWh');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_pobrana_z_sieci_srednia_cena_strona_05'),
    (552 / currentMeterProfile.hours.reduce((sum, hour) => sum + (hour.importKwh || 0), 0)).toLocaleString('pl-PL', { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
    'daily gross purchase price divides interval gross energy and distribution costs by matching measured import');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_oddana_do_sieci_wartosc_strona_05'), 'n/d',
    'net-metering export does not acquire a fictional sale value');
  assert.equal(textById(pageFive, 'stale / jednostka lub dopisek_16'), '', 'an inapplicable export amount has no PLN unit');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_oddana_do_sieci_srednia_cena_strona_05'), 'n/d');
  const dailyNotApplicableRate = elementById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_oddana_do_sieci_srednia_cena_strona_05')!;
  assert.equal(dailyNotApplicableRate.getElementsByTagName('tspan')[0].getAttribute('text-anchor'), 'end',
    'an inapplicable rate marker remains right-aligned in its numeric column');
  assert.equal(dailyNotApplicableRate.getAttribute('font-variant-numeric'), 'tabular-nums');
  assert.equal(textById(pageFive, 'stale / jednostka lub dopisek_15'), '', 'an inapplicable export rate has no PLN/kWh unit');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_bilans_wartosci_aktualny_strona_05'), 'n/d');
  assert.equal(textById(pageFive, 'stale / jednostka lub dopisek_13'), 'PLN', 'a neighboring applicable export amount retains its unit');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_pobrana_z_sieci_wartosc_po_strona_05'), '324,00',
    'future daily purchase restores both covered components exactly once, without subtracting depositUsed again');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_pobrana_z_sieci_srednia_cena_po_strona_05'), '27,000',
    'future gross price is based on the matched proposed interval kWh');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_oddana_do_sieci_wartosc_po_strona_05'), '48,00');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_oddana_do_sieci_srednia_cena_po_strona_05'), '1,333');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_bilans_wartosci_po_strona_05'), '-276,00',
    'the daily balance is export value minus the gross purchase value');
  for (const pageNumber of [5, 6, 7, 8]) {
    const dailyPage = pageNumber === 5 ? pageFive : parseSvg(result.pages[pageNumber - 1].svg);
    const dailyFields = Array.from(dailyPage.getElementsByTagName('*')) as XmlElement[];
    for (const field of dailyFields.filter((element) => (element.getAttribute('id') || '').startsWith('#b2c_')
      && /(?:autokonsumpcja_z_pv_procent|srednia_cena)/.test(element.getAttribute('id') || ''))) {
      const value = (field.textContent || '').trim();
      if (/autokonsumpcja_z_pv_procent/.test(field.getAttribute('id') || '')) {
        assert.doesNotMatch(value, /%/, `${field.getAttribute('id')} keeps its unit outside the mapped value`);
        const visiblePercentSiblingNodes = Array.from(field.parentNode?.childNodes || [])
          .filter((node) => node.nodeType === 1 && node !== field)
          .flatMap((node) => Array.from((node as XmlElement).getElementsByTagName('text')) as XmlElement[])
          .filter((node) => (node.textContent || '').trim() === '%');
        assert.equal(visiblePercentSiblingNodes.length, 1,
          `${field.getAttribute('id')} has exactly one visible percent sibling`);
      }
      if (!/^[-+−]?\d[\d\s]*(?:[.,]\d+)?$/.test(value)) continue;
      const unit = Array.from(field.parentNode?.childNodes || [])
        .find((node) => node.nodeType === 1 && /stale \/ jednostka/.test((node as XmlElement).getAttribute('id') || '')) as XmlElement | undefined;
      const visibleUnit = unit ? visibleUnitTextElement(unit) : undefined;
      if (!visibleUnit) continue;
      assert.equal(field.getAttribute('font-family'), 'DM Sans', `${field.getAttribute('id')} keeps DM Sans`);
      assert.equal(field.getAttribute('font-variant-numeric'), 'tabular-nums', `${field.getAttribute('id')} uses tabular figures`);
      assert.equal(Number(field.getElementsByTagName('tspan')[0].getAttribute('font-size')),
        Number(visibleUnit.getAttribute('font-size')), `${field.getAttribute('id')} matches unit size`);
      assert.ok(Math.abs(absoluteTextX(visibleUnit) - absoluteTextX(field) - 2) < 0.001,
        `${field.getAttribute('id')} keeps a fixed two-unit gap`);
      if (/autokonsumpcja_z_pv_procent/.test(field.getAttribute('id'))) {
        assert.equal((field.parentNode?.textContent || '').match(/%/g)?.length, 1,
          `${field.getAttribute('id')} and its unit render one percent sign`);
      }
    }
  }
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_strefa_niska_pobor_kwh_strona_05'), '4,00');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_strefa_niska_pobor_kwh_po_strona_05'), '4,00');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_strefa_niska_cena_kwh_strona_05'), '0,300');
  assert.equal(textById(pageFive, '_energia_oddana_do_sieci_aktualny_kwh_15'), 'Niska cena');
  assert.equal(textById(pageFive, '_energia_oddana_do_sieci_aktualny_kwh_16'), 'Średnia cena');
  assert.equal(textById(pageFive, '_energia_oddana_do_sieci_aktualny_kwh_17'), 'Wysoka cena');
  assert.equal(textById(pageFive, '#b2c_taryfa_aktualna_strona_05'), 'G11');
  assert.equal(textById(pageFive, '#b2c_taryfa_prognozowana_strona_05'), 'G12');
  assert.equal(textById(pageFive, '#b2c_pojemnosc_magazynu_prognozowana_strona_05'), '10,0');
  const socLabels = Array.from(elementById(pageFive, 'Group 1278')!.getElementsByTagName('text'))
    .map((label) => (label.textContent || '').trim()).filter((label) => /%$/.test(label));
  assert.equal(socLabels.length, 24);
  assert.ok(socLabels.every((label) => label === '5%'), 'SOC percentages use 0.5kWh divided by the selected 10kWh battery');
  for (const pageNumber of [6, 7, 8]) {
    const dailyPage = parseSvg(result.pages[pageNumber - 1].svg);
    const dailySoc = Array.from(elementById(dailyPage, 'Group 1278')!.getElementsByTagName('text'))
      .map((label) => (label.textContent || '').trim()).filter((label) => /%$/.test(label));
    assert.equal(dailySoc.length, 24, `page ${pageNumber} also contains 24 matched SOC samples`);
    assert.ok(dailySoc.every((label) => label === '5%'));
  }
  const winterWorkday = parseSvg(result.pages[6].svg);
  const winterWeekend = parseSvg(result.pages[7].svg);
  assert.equal(textById(winterWorkday, '#b2c_dzien_zimowy_roboczy_okres_strona_07'), '2026-01)');
  assert.equal(textById(winterWorkday, 'stale / jednostka lub dopisek'), '', 'the static close parenthesis no longer leaves a gap after a short date');
  assert.equal(textById(winterWeekend, '#b2c_dzien_zimowy_wolny_okres_strona_08'), '2026-01)');
  assert.equal(textById(winterWeekend, 'stale / jednostka lub dopisek'), '');
  assert.ok(!result.missingData.some((item) => item.fieldKeys.includes('simulation.batteryStateOfCharge')));
  const futureSeries = elementById(pageFive, 'workspace-calculated-future-hourly-series')!;
  const futureBars = Array.from(futureSeries.getElementsByTagName('rect'));
  assert.ok(futureBars.length > 0);
  assert.equal(futureBars[0].getAttribute('x'), '70');
  assert.ok(Math.abs(Number(futureBars[0].getAttribute('y')) + Number(futureBars[0].getAttribute('height')) - 477) < 0.001,
    'forecast series is anchored to the lower future plot baseline');
  assert.equal(textById(pageNine, '#b2c_twoj_aktualny_rachunek_roczny_strona_09'), '10 000,00');
  assert.equal(textById(pageNine, '#b2c_taryfa_aktualna_strona_09'), 'G11');
  assert.equal(textById(pageNine, '#b2c_taryfa_prognozowana_strona_09'), 'G12');
  assert.equal(textById(pageNine, '_oszczednosc_%'), '+60,0%');
  const pageNineText = pageNine.documentElement?.textContent || '';
  assert.ok(!pageNineText.includes('+XX%'));
  assert.ok(!pageNineText.includes('Taryfa przed'));
  assert.ok(!pageNineText.includes('ENEA'));
  assert.ok(!pageNineText.includes('19.10.2026'));
  assert.ok(pageNineText.includes('Szacowany okres zwrotu sprzętu: ok. 2,8 lat.'));
  assert.match(pageNineText, /opłaty stałe \+5,0%\/rok, cena\s*oddania bez wzrostu\./);
  assert.doesNotMatch(JSON.stringify(result.missingData), /Opis zwrotu i założeń wzrostu cen został skrócony/);
  assert.equal(textById(pageNine, '#b2c_twoj_nowy_rachunek_z_systemem_strona_09'), '4 000,00');
  assert.equal(textById(pageNine, '#b2c_oszczednosc_strona_09'), '6 000,00');
  assert.equal(textById(pageNine, '#b2c_oszczednosc_procent_strona_09'), '60,0');
  assert.equal(textById(pageNine, 'stale / jednostka lub dopisek_25'), '%');
  assert.equal((elementById(pageNine, '#b2c_oszczednosc_procent_strona_09')!.parentNode?.textContent || '').match(/%/g)?.length, 1,
    'the savings label retains a single template percent unit');
  const savingsPercent = elementById(pageNine, '#b2c_oszczednosc_procent_strona_09')!;
  const savingsLabel = elementById(pageNine, 'stale / tekst')!;
  const savingsPercentUnit = elementById(pageNine, 'stale / jednostka lub dopisek_25')!;
  const savingsPercentFontSize = Number(savingsPercent.getElementsByTagName('tspan')[0].getAttribute('font-size'));
  const savingsBoldFontBytes = fs.readFileSync(path.join(process.cwd(), 'public', 'fonts', 'dm-sans', 'DMSans-Bold.ttf'));
  const savingsBoldFont = parseFont(savingsBoldFontBytes.buffer.slice(
    savingsBoldFontBytes.byteOffset, savingsBoldFontBytes.byteOffset + savingsBoldFontBytes.byteLength,
  ) as ArrayBuffer);
  const savingsLabelWidth = savingsBoldFont.getAdvanceWidth('Oszczędność', savingsPercentFontSize);
  const savingsValueWidth = savingsBoldFont.getAdvanceWidth(textById(pageNine, '#b2c_oszczednosc_procent_strona_09'), savingsPercentFontSize);
  const savingsLabelGap = absoluteTextX(savingsPercent) - absoluteTextX(savingsLabel) - savingsLabelWidth;
  assert.ok(Math.abs(absoluteTextX(savingsPercent) - absoluteTextX(savingsLabel) - savingsLabelWidth - 4) < 0.001,
    `the savings label and percentage have a measured gap (actual: ${savingsLabelGap})`);
  assert.ok(Math.abs(absoluteTextX(savingsPercentUnit) - absoluteTextX(savingsPercent) - savingsValueWidth - 4) < 0.001,
    'the savings percentage and unit have a measured gap');
  assert.equal(textById(pageNine, '#b2c_laczna_zgromadzona_wartosc_depozytu_strona_09'), '75,00');
  assert.equal(textById(pageNine, '#b2c_laczna_wykorzystana_wartosc_depozytu_na_pokrycie_energii_pobranej_strona_09'), '30,00');
  assert.equal(textById(pageNine, '#b2c_niewykorzystana_wartosc_depozytu_strona_09'), '20,00');
  const financialSummaryFields = [
    '#b2c_twoj_aktualny_rachunek_roczny_strona_09',
    '#b2c_twoj_nowy_rachunek_z_systemem_strona_09',
    '#b2c_oszczednosc_strona_09',
    '#b2c_laczna_zgromadzona_wartosc_depozytu_strona_09',
    '#b2c_oplaty_stale_i_dystrybucyjne_strona_09',
    '#b2c_laczna_wykorzystana_wartosc_depozytu_na_pokrycie_energii_pobranej_strona_09',
    '#b2c_wartosc_energii_pobranej_niepokrytej_z_depozytu_strona_09',
    '#b2c_niewykorzystana_wartosc_depozytu_strona_09',
    '#b2c_zwrot_30_wartosci_strona_09',
  ];
  for (const id of financialSummaryFields) {
    const amount = elementById(pageNine, id)!;
    const amountSpan = amount.getElementsByTagName('tspan')[0] as XmlElement;
    assert.equal(amountSpan.getAttribute('x'), '550', `${id} shares the common amount edge`);
    assert.equal(amountSpan.getAttribute('text-anchor'), 'end', `${id} is right aligned`);
    assert.equal(amount.getAttribute('font-variant-numeric'), 'tabular-nums');
  }
  for (const id of financialSummaryFields.slice(3)) {
    assert.equal(elementById(pageNine, id)!.getAttribute('font-size'), '7.5', `${id} retains the source summary size`);
  }
  assert.equal(textById(pageNine, '#b2c_energia_wykorzystana_z_depozytu_prognozowana_kwh_strona_09'), 'n/d');
  assert.equal(textById(pageNine, 'stale / jednostka lub dopisek_43'), '', 'an inapplicable credit-energy value has no kWh unit');
  assert.equal(textById(pageNine, '#b2c_skladnik_staly_sieciowy_aktualny_strona_09_2'), '10,00');
  assert.equal(textById(pageNine, '#b2c_skladnik_staly_sieciowy_prognozowany_strona_09_2'), '8,00');
  assert.equal(textById(pageNine, '#b2c_calkowity_rachunek_brutto_aktualny_strona_09'), '8 556,19');
  assert.equal(textById(pageNine, '#b2c_calkowity_rachunek_brutto_prognozowany_strona_09'), '6 402,97');
  const currentTotalSpan = elementById(pageNine, '#b2c_calkowity_rachunek_brutto_aktualny_strona_09')!.getElementsByTagName('tspan')[0];
  const currentTotalUnitSpan = elementById(pageNine, 'stale / jednostka lub dopisek_27')!.getElementsByTagName('tspan')[0];
  assert.equal(currentTotalSpan.getAttribute('text-anchor'), 'end');
  assert.ok(Math.abs(Number(currentTotalSpan.getAttribute('x')) + 2 - Number(currentTotalUnitSpan.getAttribute('x'))) < 0.001,
    'the amount is right-aligned just before its static unit');
  assert.equal(textById(pageNine, '#b2c_zakup_energii_aktualny_strona_09_2'), '200,00');
  assert.equal(textById(pageNine, '#b2c_zakup_energii_prognozowany_strona_09_2'), '90,00');
  assert.equal(textById(pageNine, '#b2c_zakup_energii_cena_kwh_aktualny_strona_09'), '0,764');
  assert.equal(textById(pageNine, '#b2c_dystrybucja_energii_cena_kwh_aktualny_strona_09'), '0,174');
  assert.equal(textById(pageNine, '#b2c_koszt_zakupu_1kwh_aktualny_strona_09'), '0,938');
  assert.equal(textById(pageNine, '#b2c_oplaty_stale_aktualny_strona_09'), '25,00');
  assert.equal(textById(pageNine, '#b2c_zakup_energii_cena_kwh_prognozowany_strona_09'), '0,399');
  assert.equal(textById(pageNine, '#b2c_dystrybucja_energii_cena_kwh_prognozowany_strona_09'), '0,139');
  assert.equal(textById(pageNine, '#b2c_koszt_zakupu_1kwh_prognozowany_strona_09'), '0,538');
  assert.equal(textById(pageNine, '#b2c_oplaty_stale_prognozowany_strona_09'), '25,00');
  assert.equal(textById(pageNine, '#b2c_oplata_zmienna_sieciowa_aktualny_strona_09'), '0,1129');
  assert.equal(textById(pageNine, '#b2c_oplata_jakosciowa_aktualny_strona_09'), '0,0484');
  assert.equal(textById(pageNine, '#b2c_oplata_oze_aktualny_strona_09'), '0,0202');
  assert.equal(textById(pageNine, '#b2c_oplata_kogeneracyjna_aktualny_strona_09'), '0,0202');
  assert.equal(textById(pageNine, '#b2c_oplata_handlowa_aktualny_strona_09'), '0,00', 'an absent category in a reconciled breakdown is zero');
  assert.equal(textById(pageNine, '#b2c_skladnik_staly_sieciowy_aktualny_strona_09'), '10,00');
  assert.equal(textById(pageNine, '#b2c_stala_abonementu_aktualny_strona_09'), '5,00');
  assert.equal(textById(pageNine, '#b2c_oplata_zmienna_sieciowa_prognozowany_strona_09'), '0,0694');
  assert.equal(textById(pageNine, '#b2c_oplata_jakosciowa_prognozowany_strona_09'), '0,0278');
  assert.equal(textById(pageNine, '#b2c_oplata_oze_prognozowany_strona_09'), '0,0139');
  assert.equal(textById(pageNine, '#b2c_oplata_kogeneracyjna_prognozowany_strona_09'), '0,0104');
  assert.equal(textById(pageNine, '#b2c_oplata_handlowa_prognozowany_strona_09'), '5,00');
  assert.equal(textById(pageNine, '#b2c_skladnik_staly_sieciowy_prognozowany_strona_09'), '10,00');
  assert.equal(textById(pageNine, '#b2c_stala_abonementu_prognozowany_strona_09'), '2,00');
  assert.equal(textById(pageNine, '#b2c_rachunek_po_zwrocie_z_depozytu_prognozowany_strona_09'), '3 874,55',
    'the amount payable subtracts the separately reported deposit refund');
  assert.equal(textById(pageNine, '#b2c_oplaty_stale_i_dystrybucyjne_strona_09'), '60,00');
  assert.equal(textById(pageNine, '#b2c_autokonsumpcja_z_magazynu_prognozowana_strona_09'), '6,00');
  for (const id of ['workspace-calculated-unit-cost-current', 'workspace-calculated-unit-cost-proposed',
    'workspace-calculated-annual-bill-current', 'workspace-calculated-annual-bill-proposed']) {
    assert.ok(elementById(pageNine, id), `${id} is rendered from the billing summary`);
  }
  assert.equal(elementById(pageNine, 'workspace-calculated-unit-cost-current')!.getElementsByTagName('rect').length, 2);
  assert.equal(elementById(pageNine, 'workspace-calculated-unit-cost-proposed')!.getElementsByTagName('rect').length, 2);
  assert.equal(elementById(pageNine, 'workspace-calculated-annual-bill-current')!.getElementsByTagName('rect').length, 1,
    'an inconsistent bill detail falls back to the authoritative annual total, not a fabricated stack');
  assert.equal(elementById(pageNine, 'workspace-calculated-annual-bill-proposed')!.getElementsByTagName('rect').length, 1,
    'an inconsistent bill detail falls back to the authoritative annual total, not a fabricated stack');
  const billChart = elementById(pageNine, 'workspace-calculated-annual-bill-comparison')!;
  const billBars = Array.from(billChart.getElementsByTagName('rect'));
  assert.equal(billBars.length, 2);
  assert.equal(Number(billBars[0].getAttribute('y')), pathMoveY(pageNine, '_wskaznik_5_2'));
  assert.equal(Number(billBars[1].getAttribute('y')), pathMoveY(pageNine, '_wskaznik_1'));
  assert.equal(elementById(pageNine, '_przerywana_1'), undefined);
  assert.equal(elementById(pageNine, '_przerywana_2'), undefined);
  assert.equal(elementById(pageNine, '_strzalka'), undefined);
  assert.ok(elementById(pageNine, '_poziomy_wykres'), 'the chart baseline is retained');
  assert.ok(elementById(pageNine, '_wskaznik_5_2'), 'the source SVG axis ticks are retained');
  assert.equal(textById(pageNine, '_wartosc_6_2'), '10 000');
  assert.ok(result.suppressedCharts.some((item) => item.page === 9 && item.reason.includes('podsumowań calculation.baselineBill/proposedBill')));

  const smallAnnualBill = structuredClone(data);
  smallAnnualBill.calculation!.baselineAnnualCostPln = 1000;
  smallAnnualBill.calculation!.proposedAnnualCostPln = 400;
  smallAnnualBill.calculation!.annualSavingsPln = 600;
  const smallAnnualResult = renderOfferWorkspaceDocument(smallAnnualBill, draft, { templateKey: OFFER_TEMPLATE_V4_KEY });
  const smallAnnualPageNine = parseSvg(smallAnnualResult.pages[8].svg);
  const smallAxisLabel = textById(smallAnnualPageNine, '_wartosc_6_2');
  const smallBillChart = elementById(smallAnnualPageNine, 'workspace-calculated-annual-bill-comparison')!;
  const smallCurrentBar = elementById(smallAnnualPageNine, 'workspace-calculated-current-annual-cost')!;
  const smallProposedBar = elementById(smallAnnualPageNine, 'workspace-calculated-proposed-annual-cost')!;
  assert.notEqual(smallAxisLabel, '10 000');
  assert.equal(smallAxisLabel, '1 000');
  assert.equal(textById(smallAnnualPageNine, '_wartosc_2'), '400');
  assert.equal(Number(smallCurrentBar.getAttribute('y')), pathMoveY(smallAnnualPageNine, '_wskaznik_5_2'));
  assert.equal(Number(smallProposedBar.getAttribute('y')), pathMoveY(smallAnnualPageNine, '_wskaznik_1'));
  assert.equal(smallBillChart.getElementsByTagName('rect').length, 2);
  assert.ok(!(pageNine.documentElement?.textContent || '').includes('29,582'));
  assert.ok(!(pageNine.documentElement?.textContent || '').includes('11,796'));
  assert.equal(textById(pageTen, '#b2c_prognozowana_kwota_dotacji_z_programu_strona_10'), '5 000,00');
  assert.equal(textById(pageTen, '#b2c_prognozowana_ulga_termomodernizacyjna_strona_10'), '3 000,00');
  assert.equal(textById(pageTen, '#b2c_prognozowany_koszt_sytemu_po_dofinansowaniach_strona_10'), '17 000,00');
  assert.equal(textById(pageTen, '#b2c_imie_i_nazwisko_reform_strona_10'), data.clientName);
  assert.ok(!result.missingData.some((item) => item.fieldKeys.includes('simulation.dayProfiles')),
    'complete forecast profile must not be reported as missing');
  assert.ok(result.sourceFieldsUsed.includes('calculation.forecastFlows.batteryToLoadKwh'));
  assert.ok(result.sourceFieldsUsed.includes('calculation.forecastFlows.socKwh'));
  assert.ok(result.sourceFieldsUsed.includes('documentContext.tariffLabels.current'));
  assert.ok(result.limitations.some((item) => item.includes('Prognoza modelowa, nie gwarancja.')));
  assert.ok(result.limitations.some((item) => item.includes('kwotę przypisaną depozytowi')));
  assert.doesNotMatch(result.limitations.join(' '), /prognoza.*pozostają nieznane/i);
  assert.ok(textById(pageNine, 'workspace-calculated-annual-bill-comparison'));
  assert.ok(pageNine.getElementsByTagName('text')[0]);
  assert.match(pageNine.documentElement?.textContent || '', /wyniki obliczeń mają charakter szacunkowy/);
  assert.match(pageNine.documentElement?.textContent || '', /n\/d = nie dotyczy/);
  assert.ok(result.sourceFieldsUsed.includes('calculation.baselineBill.totals.distributionComponents[network].amountPln/totals.billedImportKwh'));
  assert.ok(!result.missingData.some((item) => item.page === 9
    && item.fieldKeys.some((key) => /b2c_oplata_|b2c_skladnik_staly|b2c_stala_abonementu|rachunek_po_zwrocie/.test(key))));

  const netMeteringDraft = structuredClone(draft);
  netMeteringDraft.targetSettlement = 'NET_METERING';
  const netMeteringResult = renderOfferWorkspaceDocument(data, netMeteringDraft, { templateKey: OFFER_TEMPLATE_V4_KEY });
  const netMeteringPageNine = parseSvg(netMeteringResult.pages[8].svg);
  assert.equal(textById(netMeteringPageNine, '#b2c_rachunek_po_zwrocie_z_depozytu_prognozowany_strona_09'), 'n/d',
    'net-metering deposit-return accounting stays not applicable');
  assert.equal(textById(netMeteringPageNine, 'stale / jednostka lub dopisek_50'), '',
    'a not-applicable return value does not retain the PLN unit');

  const zeroImport = structuredClone(data);
  for (const bill of [zeroImport.calculation!.baselineBill!, zeroImport.calculation!.proposedBill!]) {
    Object.assign(bill.months[0], {
      importKwh: 0, billedImportKwh: 0, coveredKwh: 0, energyCostPln: 0, distributionCostPln: 0,
      coveredEnergyPln: 0, coveredDistributionPln: 0,
    });
  }
  const zeroImportResult = renderOfferWorkspaceDocument(zeroImport, draft, { templateKey: OFFER_TEMPLATE_V4_KEY });
  const zeroImportPageNine = parseSvg(zeroImportResult.pages[8].svg);
  assert.equal(textById(zeroImportPageNine, '#b2c_zakup_energii_cena_kwh_aktualny_strona_09'), '—');
  assert.equal(textById(zeroImportPageNine, '#b2c_koszt_zakupu_1kwh_aktualny_strona_09'), '—');
  assert.equal(textById(zeroImportPageNine, '#b2c_zakup_energii_cena_kwh_prognozowany_strona_09'), '—');
  assert.equal(textById(zeroImportPageNine, '#b2c_koszt_zakupu_1kwh_prognozowany_strona_09'), '—');

  const incomplete = structuredClone(data);
  const incompletePageFiveIndex = incomplete.calculation!.proposedBill!.intervals
    .findIndex((interval) => interval.startUtc === flowCases[0].flow.startUtc);
  incomplete.calculation!.proposedBill!.intervals.splice(incompletePageFiveIndex, 1);
  const incompleteResult = renderOfferWorkspaceDocument(incomplete, draft, { templateKey: OFFER_TEMPLATE_V4_KEY });
  const incompletePageFive = parseSvg(incompleteResult.pages[4].svg);
  assert.equal(textById(incompletePageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_pobrana_z_sieci_wartosc_po_strona_05'), '—');
  assert.equal(textById(incompletePageFive, '#b2c_dzien_sloneczny_letni_roboczy_oszczednosc_pln_strona_05'), '—');
});

test('V4 suppresses every forecast and financial result when calculation status is blocked', () => {
  const data = workspace();
  data.energy = energyFixture(data);
  const forecastEnergy = energyFixture(data);
  forecastEnergy.totals = { loadKwh: 7200, pvKwh: 8400, directKwh: 2300 };
  data.calculation = {
    status: 'blocked', reasons: ['Rozbieżność modelu PV wymaga wyjaśnienia.'], warnings: [],
    baselineAnnualCostPln: 10000, proposedAnnualCostPln: 4000, annualSavingsPln: 6000,
    systemCostPln: 29700, costAfterFinancingPln: 17000, paybackYears: 2.8,
    grantPln: 5000, taxReliefPln: 3000, rankings: [], recommendedTemplateIds: ['battery-kit'],
    forecastEnergy, forecastMeasurements: data.measurements,
    baselineBill: billingScenario([], { totalCostPln: 275 }),
    proposedBill: billingScenario([], { totalCostPln: 150 }),
    forecastFlows: [],
  };
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['battery-kit'];
  draft.saleVatMode = 'REDUCED_8';
  const result = renderOfferWorkspaceDocument(data, draft, { templateKey: OFFER_TEMPLATE_V4_KEY });
  const pageThree = parseSvg(result.pages[2].svg);
  const pageFour = parseSvg(result.pages[3].svg);
  const pageFive = parseSvg(result.pages[4].svg);
  const pageNine = parseSvg(result.pages[8].svg);
  const pageTen = parseSvg(result.pages[9].svg);

  assert.equal(textById(pageThree, '#b2c_zuzycie_energii_rok_strona_03'), '3 600', 'independent current energy remains available');
  assert.equal(textById(pageFour, '#b2c_zuzycie_energii_prognozowane_strona_04'), '—');
  assert.equal(elementById(pageFour, 'workspace-calculated-forecast-monthly-series'), undefined);
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_pobrana_z_sieci_suma_kwh_po_strona_05'), '—');
  assert.equal(elementById(pageFive, 'workspace-calculated-future-hourly-series'), undefined);
  assert.equal(textById(pageNine, '#b2c_twoj_aktualny_rachunek_roczny_strona_09'), '—');
  assert.equal(textById(pageNine, '#b2c_twoj_nowy_rachunek_z_systemem_strona_09'), '—');
  assert.equal(textById(pageNine, '#b2c_oszczednosc_strona_09'), '—');
  assert.equal(elementById(pageNine, 'workspace-calculated-annual-bill-comparison'), undefined);
  assert.equal(textById(pageTen, '#b2c_prognozowana_kwota_dotacji_z_programu_strona_10'), '—');
  assert.equal(textById(pageTen, '#b2c_prognozowana_ulga_termomodernizacyjna_strona_10'), '—');
  assert.equal(textById(pageTen, '#b2c_prognozowany_koszt_sytemu_po_dofinansowaniach_strona_10'), '—');
  assert.ok(!(pageTen.documentElement?.textContent || '').includes('15 600,00'));
  assert.ok(result.missingData.some((item) => item.page === 4 && item.reason.includes('Rozbieżność modelu PV')));
});
