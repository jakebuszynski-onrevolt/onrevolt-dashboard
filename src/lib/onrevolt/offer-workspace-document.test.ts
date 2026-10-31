import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DOMParser, type Document as XmlDocument, type Element as XmlElement } from '@xmldom/xmldom';
import { parse as parseFont } from 'opentype.js';
import { emptyOfferWorkspaceDraft } from './offer-workspace';
import { renderOfferWorkspaceDocument, type OfferWorkspaceDocumentData } from './offer-workspace-document';
import type { OfferWorkspaceEnergy } from './offer-workspace-energy';
import { inspectOfferTemplateV3 } from './offer-template-v3';
import { OFFER_TEMPLATE_V4_KEY, inspectOfferTemplateV4 } from './offer-template-v4';
import type { OfferBillingIntervalResult, OfferBillingScenarioResult } from './offer-workspace-billing';

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

function moneyValue(value: string) {
  return Number(value.replace(/\s/g, '').replace('PLN', '').replace(/\./g, '').replace(',', '.'));
}

function elementById(document: XmlDocument, id: string) {
  return Array.from(document.getElementsByTagName('*'))
    .find((element) => element.getAttribute('id') === id) as XmlElement | undefined;
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
  assert.ok(result.limitations.some((item) => item.includes('Kosztorys korzysta z aktualnych cen katalogowych')));

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
  assert.equal(textById(pageThree, '#b2c_zuzycie_energii_rok_strona_03'), '3 600');
  assert.equal(textById(pageFour, '#b2c_energia_pobrana_z_sieci_prognozowana_strona_04'), '—');
  assert.equal(textById(pageFour, '#b2c_produkcja_z_pv_grudzien_prognozowana_strona_04'), '—');
  const annualSummary = elementById(pageFour, 'sekcja / podsumowanie_roczne')!;
  const exampleFills = new Set(['#fed17f', '#8d96aa', '#006c30', '#fc7c00', '#44e09c', '#00d477']);
  const remainingExampleShapes = Array.from(annualSummary.getElementsByTagName('*'))
    .filter((element) => ['path', 'rect', 'polygon', 'polyline', 'circle', 'ellipse', 'use'].includes((element as XmlElement).localName || ''))
    .filter((element) => exampleFills.has(((element as XmlElement).getAttribute('fill') || '').toLowerCase()));
  assert.equal(remainingExampleShapes.length, 0, 'future monthly data shapes are cleared while the section/labels remain');
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
  assert.equal(textById(pageFive, '#b2c_moc_pv_prognozowana_strona_05'), '—', 'current PV is not copied into the future panel');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_zuzycie_energii_suma_kwh_strona_05'), '12,00');
  assert.equal(textById(pageFive, '#b2c_taryfa_prognozowana_strona_05'), '—');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_oszczednosc_pln_strona_05'), '—');
  assert.equal(Array.from(futurePanel.getElementsByTagName('*')).some((element) => element.getAttribute('data-series')), false);
});

test('V4 page 10 uses selected catalog pricing and keeps finance outcomes unknown', () => {
  const data = workspace();
  data.templates[0].items[0].quantity = 2;
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['battery-kit'];
  draft.saleVatMode = 'REDUCED_8';
  const result = renderOfferWorkspaceDocument(data, draft, { templateKey: OFFER_TEMPLATE_V4_KEY });
  const pageTen = parseSvg(result.pages[9].svg);
  const pageTenText = pageTen.documentElement?.textContent || '';

  assert.equal(textById(pageTen, '#b2c_kosztorys_pozycja_1_strona_10'), 'Magazyn energii');
  assert.equal(textById(pageTen, '#b2c_kosztorys_model_1_strona_10'), 'Acme Battery Model X');
  assert.equal(textById(pageTen, '#b2c_kosztorys_ilosc_1_strona_10'), '2');
  assert.equal(textById(pageTen, '#b2c_kosztorys_cena_jednostkowa_brutto_1_strona_10'), '14 850,00 PLN');
  assert.equal(textById(pageTen, '#b2c_kosztorys_wartosc_brutto_1_strona_10'), '29 700,00 PLN');
  assert.equal(textById(pageTen, '#b2c_koszt_systemu_strona_10'), '29 700,00 PLN');
  assert.equal(textById(pageTen, '#b2c_prognozowana_kwota_dotacji_z_programu_strona_10'), '—');
  assert.equal(textById(pageTen, '#b2c_prognozowana_ulga_termomodernizacyjna_strona_10'), '—');
  assert.equal(textById(pageTen, '#b2c_prognozowany_koszt_sytemu_po_dofinansowaniach_strona_10'), '—');
  assert.ok(!pageTenText.includes('Dyness Stack 314 16.07 kWh'));
  assert.ok(!pageTenText.includes('75 000,00'));
  assert.ok(result.sourceFieldsUsed.includes('templates.items.product.prices'));
  assert.ok(result.limitations.some((item) => item.includes('system cost jest przed finansowaniem')));
  assert.equal(inspectOfferTemplateV4().pages[9].fields.length, result.pages[9].replacedFieldKeys.length);
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

test('V4 maps authoritative calculation forecasts, billing outputs, and UTC-matched daily battery flows', () => {
  const data = workspace();
  data.energy = energyFixture(data);
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['battery-kit'];
  draft.saleVatMode = 'REDUCED_8';
  draft.targetSettlement = 'NET_BILLING';
  const forecastEnergy = energyFixture(data);
  forecastEnergy.totals = { loadKwh: 7200, pvKwh: 8400, directKwh: 2300 };
  forecastEnergy.months = [
    { period: '2026-01', loadKwh: 400, pvKwh: 500, directKwh: 100 },
    { period: '2026-02', loadKwh: 300, pvKwh: 400, directKwh: 90 },
    { period: '2026-03', loadKwh: 500, pvKwh: 700, directKwh: 150 },
    { period: '2026-05', loadKwh: 900, pvKwh: 1200, directKwh: null },
  ];
  const forecastMeasurements = {
    ...data.measurements,
    totalsImportKwh: 500,
    totalsExportKwh: 100,
    months: [{ period: '2026-05', importKwh: null, exportKwh: null }],
  };
  const flows = Array.from({ length: 24 }, (_, hour) => {
    const start = new Date(Date.UTC(2026, 4, 11, 22 + hour));
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
      startUtc: start.toISOString(), endUtc: end.toISOString(), loadKwh: 1, pvKwh: 2, directKwh: 0.5,
      importKwh: 0.5, exportKwh: 1.5, batteryToLoadKwh: 0.25, gridToBatteryKwh: 0.1,
      pvToBatteryKwh: 0.75, batteryToGridKwh: 0.2, socKwh: 0.5,
    };
  });
  const beforeIntervals = flows.map((flow) => billingInterval(flow.startUtc, flow.endUtc, { cashDuePln: 20 }));
  const afterIntervals = flows.map((flow) => billingInterval(flow.startUtc, flow.endUtc, { cashDuePln: 10 }));
  data.calculation = {
    status: 'ready', reasons: [], warnings: ['Prognoza modelowa, nie gwarancja.'],
    baselineAnnualCostPln: 10000, proposedAnnualCostPln: 4000, annualSavingsPln: 6000,
    systemCostPln: 29700, costAfterFinancingPln: 17000, paybackYears: 2.8333,
    grantPln: 5000, taxReliefPln: 3000, rankings: [], recommendedTemplateIds: ['battery-kit'],
    forecastEnergy, forecastMeasurements,
    baselineBill: billingScenario(beforeIntervals, { energyCostPln: 200, distributionCostPln: 50, fixedCostPln: 25, totalCostPln: 275, cashDuePln: 10000 }),
    proposedBill: billingScenario(afterIntervals, { energyCostPln: 90, distributionCostPln: 35, fixedCostPln: 25, totalCostPln: 150, cashDuePln: 4000, depositEarnedPln: 75, depositUsedPln: 40, depositBalancePln: 12, pendingDepositPln: 8, coveredEnergyPln: 25, coveredDistributionPln: 5 }),
    forecastFlows: flows,
  };

  const result = renderOfferWorkspaceDocument(data, draft, { templateKey: OFFER_TEMPLATE_V4_KEY });
  const pageThree = parseSvg(result.pages[2].svg);
  const pageFour = parseSvg(result.pages[3].svg);
  const pageFive = parseSvg(result.pages[4].svg);
  const pageNine = parseSvg(result.pages[8].svg);
  const pageTen = parseSvg(result.pages[9].svg);

  assert.equal(textById(pageThree, '#b2c_zuzycie_energii_rok_strona_03'), '3 600', 'baseline remains workspace.energy');
  assert.equal(textById(pageThree, '#b2c_okres_strona_03'), '2025-10 - 2026-09)');
  assert.equal(textById(pageThree, 'stale / jednostka lub dopisek'), '');
  assert.equal(textById(pageFour, '#b2c_zuzycie_energii_prognozowane_strona_04'), '7 200');
  assert.equal(textById(pageFour, '#b2c_calkowite_uzycie_energii_kwh_maj_prognozowane_strona_04'), '900');
  assert.equal(textById(pageFour, '#b2c_autokonsumpcja_z_pv_kwh_maj_prognozowana_strona_04'), '12');
  assert.equal(textById(pageFour, '#b2c_energia_pobrana_z_sieci_kwh_maj_prognozowana_strona_04'), '12');
  assert.equal(textById(pageFour, '#b2c_energia_oddana_do_sieci_kwh_maj_prognozowana_strona_04'), '36');
  assert.equal(textById(pageFour, '#b2c_autokonsumpcja_z_magazynu_kwh_maj_prognozowana_strona_04'), '6');
  assert.equal(textById(pageFour, '#b2c_energia_pobrana_z_sieci_prognozowana_strona_04'), '500');
  assert.equal(textById(pageFour, '#b2c_wartosc_energii_pobranej_prognozowana_strona_04'), '90,00');
  assert.equal(textById(pageFour, '#b2c_wartosc_energii_oddanej_prognozowana_strona_04'), '30,00');
  assert.equal(textById(pageFour, '#b2c_miesiac_o_najwiekszym_zuzyciu_strona_04'), '2026-05');
  assert.equal(textById(pageFour, '#b2c_zuzycie_energii_najwieksze_strona_04'), '900');
  assert.equal(textById(pageFour, '#b2c_miesiac_o_srednim_zuzyciu_strona_04'), '—');
  assert.equal(textById(pageFour, '#b2c_zuzycie_energii_srednie_strona_04'), '525');
  assert.ok(elementById(pageFour, 'workspace-calculated-forecast-monthly-series'));
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_pobrana_z_sieci_suma_kwh_po_strona_05'), '12,00');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_okres_strona_05'), '2026-05');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_autokonsumpcja_z_magazynu_suma_kwh_po_strona_05'), '6,00');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_pobrana_do_magazynu_suma_kwh_po_strona_05'), '20,40');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_oszczednosc_pln_strona_05'), '240,00');
  assert.equal(textById(pageFive, '#b2c_dzien_sloneczny_letni_roboczy_energia_pobrana_z_sieci_wartosc_strona_05'), '240,00');
  const futureSeries = elementById(pageFive, 'workspace-calculated-future-hourly-series')!;
  const futureBars = Array.from(futureSeries.getElementsByTagName('rect'));
  assert.ok(futureBars.length > 0);
  assert.equal(futureBars[0].getAttribute('x'), '70');
  assert.ok(Math.abs(Number(futureBars[0].getAttribute('y')) + Number(futureBars[0].getAttribute('height')) - 477) < 0.001,
    'forecast series is anchored to the lower future plot baseline');
  assert.equal(textById(pageNine, '#b2c_twoj_aktualny_rachunek_roczny_strona_09'), '10 000,00');
  assert.equal(textById(pageNine, '#b2c_taryfa_aktualna_strona_09'), '—');
  assert.equal(textById(pageNine, '_oszczednosc_%'), '');
  const pageNineText = pageNine.documentElement?.textContent || '';
  assert.ok(!pageNineText.includes('+XX%'));
  assert.ok(!pageNineText.includes('Taryfa przed'));
  assert.ok(!pageNineText.includes('ENEA'));
  assert.ok(!pageNineText.includes('19.10.2026'));
  assert.ok(pageNineText.includes('Brak potwierdzonych taryf i kalkulacji rozliczenia; oszczędności pozostają nieznane.'));
  assert.equal(textById(pageNine, '#b2c_twoj_nowy_rachunek_z_systemem_strona_09'), '4 000,00');
  assert.equal(textById(pageNine, '#b2c_oszczednosc_strona_09'), '6 000,00');
  assert.equal(textById(pageNine, '#b2c_oszczednosc_procent_strona_09'), '60,0 %');
  assert.equal(textById(pageNine, '#b2c_laczna_zgromadzona_wartosc_depozytu_strona_09'), '75,00');
  assert.equal(textById(pageNine, '#b2c_laczna_wykorzystana_wartosc_depozytu_na_pokrycie_energii_pobranej_strona_09'), '30,00');
  assert.equal(textById(pageNine, '#b2c_niewykorzystana_wartosc_depozytu_strona_09'), '20,00');
  assert.equal(textById(pageNine, '#b2c_skladnik_staly_sieciowy_aktualny_strona_09_2'), '—');
  assert.equal(textById(pageNine, '#b2c_skladnik_staly_sieciowy_prognozowany_strona_09_2'), '—');
  assert.equal(textById(pageNine, '#b2c_zakup_energii_aktualny_strona_09_2'), '200,00');
  assert.equal(textById(pageNine, '#b2c_zakup_energii_prognozowany_strona_09_2'), '90,00');
  assert.ok(!(pageNine.documentElement?.textContent || '').includes('29,582'));
  assert.ok(!(pageNine.documentElement?.textContent || '').includes('11,796'));
  assert.equal(textById(pageTen, '#b2c_prognozowana_kwota_dotacji_z_programu_strona_10'), '5 000,00');
  assert.equal(textById(pageTen, '#b2c_prognozowana_ulga_termomodernizacyjna_strona_10'), '3 000,00');
  assert.equal(textById(pageTen, '#b2c_prognozowany_koszt_sytemu_po_dofinansowaniach_strona_10'), '17 000,00');
  assert.ok(!result.missingData.some((item) => item.fieldKeys.includes('simulation.dayProfiles')),
    'complete forecast profile must not be reported as missing');
  assert.ok(result.sourceFieldsUsed.includes('calculation.forecastFlows.batteryToLoadKwh'));
  assert.ok(result.limitations.some((item) => item.includes('Prognoza modelowa, nie gwarancja.')));

  const incomplete = structuredClone(data);
  incomplete.calculation!.proposedBill!.intervals.pop();
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
  assert.equal(textById(pageTen, '#b2c_prognozowana_kwota_dotacji_z_programu_strona_10'), '—');
  assert.equal(textById(pageTen, '#b2c_prognozowana_ulga_termomodernizacyjna_strona_10'), '—');
  assert.equal(textById(pageTen, '#b2c_prognozowany_koszt_sytemu_po_dofinansowaniach_strona_10'), '—');
  assert.ok(!(pageTen.documentElement?.textContent || '').includes('15 600,00'));
  assert.ok(result.missingData.some((item) => item.page === 4 && item.reason.includes('Rozbieżność modelu PV')));
});
