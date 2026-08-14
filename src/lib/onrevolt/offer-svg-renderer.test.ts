import assert from 'node:assert/strict';
import test from 'node:test';
import { renderAllOfferSvgPages, renderOfferSvgPage, validateOfferTemplatePage } from './offer-svg-renderer';
import { reformB2cTemplate } from './offer-template-manifest';

function fixtureOffer() {
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    consumptionKwh: 420 + index * 12,
    pvGenerationKwh: 250 + index * 24,
    directPvKwh: 120,
    batteryDischargeToLoadKwh: 80,
    gridImportKwh: 220,
    exportKwh: 130,
  }));
  return {
    id: 'offer-fixture',
    number: 'ONR/2026/08/0001',
    title: 'Oferta testowa',
    clientSnapshot: {
      clientName: 'Aleksandra Bardzo-Długie Nazwisko Testowe',
      clientType: 'B2C',
      email: 'aleksandra.bardzo.dlugie.nazwisko@example.com',
      phone: '+48 500 000 000',
      addressLine: 'ul. Przykładowa 123/45',
      postalCode: '00-001',
      city: 'Warszawa',
    },
    lineItemsSnapshot: [
      { position: 1, name: 'Dyness PowerBrick Plus 16.07 kWh', category: 'MAGAZYN_ENERGII', model: 'PowerBrick Plus', quantity: 1, saleNet: 20000, saleGross: 21600, role: 'MAIN_EQUIPMENT', sourceConfigurationKind: 'MAGAZYN', sourceConfigurationName: 'Magazyn 16 kWh' },
      { position: 2, name: 'Solis S6 10 kW', category: 'FALOWNIK', model: 'S6-EH3P10K-H-EU', quantity: 1, saleNet: 6000, saleGross: 6480, role: 'MAIN_EQUIPMENT', sourceConfigurationKind: 'MAGAZYN', sourceConfigurationName: 'Magazyn 16 kWh' },
      { position: 3, name: 'Re:Flow', category: 'SYSTEM_MONITORUJACY', model: 'EMS onRevolt', quantity: 1, saleNet: 3000, saleGross: 3240, role: 'MONITORING', sourceConfigurationKind: 'EMS', sourceConfigurationName: 'EMS' },
      { position: 4, name: 'Longi 475 W', category: 'FOTOWOLTAIKA', model: 'LR7-54HVB', quantity: 12, saleNet: 12000, saleGross: 12960, role: 'MAIN_EQUIPMENT', sourceConfigurationKind: 'PV_DACH_SKOSNY', sourceConfigurationName: 'PV 5,7 kWp' },
    ],
    calculationSnapshot: { totalNet: 41000, totalGross: 44280, totalAfterSupportGross: 36780, currentAnnualBillGross: 6200, projectedAnnualBillGross: 1200, annualSavingsGross: 5000, savingsPercent: 80.6, paybackYears: 7.4 },
    energySnapshot: {
      measurementMonths: ['2025-09', '2026-08'],
      operatorAccounts: [{ operator: 'ENEA', tariff: 'G11' }],
      audit: { annualConsumptionKwh: 6000, terrainType: 'SUBURBAN', buildingType: 'SINGLE_FAMILY', roofShape: 'GABLE_BARN', connectionPowerKw: 11, settlementSystem: 'net-billing', energySupplier: 'ENEA', connectionType: 'LOW_VOLTAGE', heatingSource: 'NATURAL_GAS', heatingSourceDetail: 'GAS_CONDENSING' },
      scenario: {
        input: {
          energyBuyGrossPerKwh: 0.62,
          distributionGrossPerKwh: 0.48,
          exportGrossPerKwh: 0.45,
          fixedMonthlyGross: 30,
          targetTariff: {
            zoneRates: [
              { code: 'high', label: 'Wysoka', energyGrossPerKwh: 0.7915, distributionGrossPerKwh: 0.426441, totalGrossPerKwh: 1.217941 },
              { code: 'mid', label: 'Średnia', energyGrossPerKwh: 0.6089, distributionGrossPerKwh: 0.355593, totalGrossPerKwh: 0.964493 },
              { code: 'low', label: 'Niska', energyGrossPerKwh: 0.341, distributionGrossPerKwh: 0.143295, totalGrossPerKwh: 0.484295 },
            ],
          },
        },
        result: { months, annualConsumptionKwh: 6000, annualPvGenerationKwh: 7200, annualGridImportKwh: 2640, annualExportKwh: 1560, annualDirectPvKwh: 1440, annualBatteryDischargeKwh: 960, baselineAnnualCostGross: 6200, scenarioAnnualCostGross: 1200, annualSavingsGross: 5000, savingsPercent: 80.6, finalDepositGross: 300, depositPayoutGross: 90 },
      },
    },
    tariffBefore: 'G11',
    tariffAfter: 'G13active',
    settlementAfter: 'net-billing',
  };
}

test('obie warstwy każdej strony mają właściwy format, unikalne ID i komplet pól', () => {
  reformB2cTemplate.pages.forEach((page) => {
    validateOfferTemplatePage(page.index).forEach((result) => {
      assert.equal(result.width, '595');
      assert.equal(result.height, '843');
      assert.equal(result.viewBox, '0 0 595 843');
      assert.deepEqual(result.duplicates, []);
      assert.deepEqual(result.missingRequiredIds, []);
    });
  });
});

test('renderer tworzy pięć samodzielnych stron SVG z danymi oferty', () => {
  const pages = renderAllOfferSvgPages(fixtureOffer());
  assert.equal(pages.length, 5);
  pages.forEach((svg) => {
    assert.match(svg, /^<svg/);
    assert.match(svg, /viewBox="0 0 595 843"/);
    assert.match(svg, /data:font\/ttf;base64,/);
    assert.doesNotMatch(svg, /Aleksandra Bardzo-Długie Nazwisko Testowe.*Aleksandra Bardzo-Długie Nazwisko Testowe/);
  });
  assert.match(pages[0], /Aleksandra/);
  assert.match(pages[0], /Brak zdjęcia/);
  assert.match(pages[1], /PowerBrick Plus/);
  assert.match(pages[2], /G13active/);
  assert.match(pages[3], /_dynamic_energy_chart/);
  assert.match(pages[4], /_dynamic_energy_chart/);
});

test('numer oferty zachowuje prawy margines na każdej stronie', () => {
  const pages = renderAllOfferSvgPages(fixtureOffer());
  pages.forEach((page, index) => {
    const id = index === 0 ? '#numer_oferty' : '_numer';
    const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const element = page.match(new RegExp(`<text[^>]*id="${escapedId}"[^>]*>[\\s\\S]*?<\\/text>`))?.[0];
    assert.ok(element, `Brak pola numeru na stronie ${index + 1}`);
    assert.match(element, /text-anchor="end"/);
    assert.match(element, /<tspan x="550"/);
  });
});

test('zdjęcie audytu zastępuje neutralne pole na pierwszej stronie', () => {
  const svg = renderOfferSvgPage(fixtureOffer(), 0, {
    coverImageDataUrl: 'data:image/png;base64,AA==',
  });
  assert.match(svg, /data:image\/png;base64,AA==/);
  assert.doesNotMatch(svg, /Brak zdjęcia/);
});

test('dokument B2C prezentuje wszystkie kwoty jako brutto', () => {
  const pages = renderAllOfferSvgPages(fixtureOffer());
  pages.forEach((svg) => {
    assert.doesNotMatch(svg, />[^<]*netto[^<]*</i);
  });
  assert.match(pages[1], />[^<]*brutto[^<]*</i);
  assert.match(pages[2], />[^<]*brutto[^<]*</i);
});

test('strona taryf pokazuje koszt 1 kWh z najtańszej strefy', () => {
  const page = renderOfferSvgPage(fixtureOffer(), 2);
  assert.match(page, />0,4843</);
});

test('wartości strony taryf mają wspólne prawe krawędzie kolumn', () => {
  const page = renderOfferSvgPage(fixtureOffer(), 2);
  const columns = [
    {
      x: 285,
      ids: [
        '_zakup_energii_aktualny_cena',
        '_oplata_zmienna_sieciowa_aktualna_cena',
        '_zuzycie_energii_rachunek_aktualny_kwh',
        '_zakup_energii_aktualny_rachunek_cena',
        '_vat_aktualna_cena_2',
      ],
    },
    {
      x: 555,
      ids: [
        '_zakup_energii_aktualny_cena_2',
        '_oplata_zmienna_sieciowa_nowy_cena',
        '_zuzycie_energii_rachunek_nowy_kwh',
        '_oszczednosc_nowy_rachunek_cena',
        '_wartosc_skumulowanego_depozytu_nowy_rachunek_cena',
      ],
    },
  ];

  columns.forEach(({ x, ids }) => ids.forEach((id) => {
    const element = page.match(new RegExp(`<text[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/text>`))?.[0];
    assert.ok(element, `Brak pola ${id}`);
    assert.match(element, /text-anchor="end"/);
    assert.match(element, new RegExp(`<tspan x="${x}"`));
  }));

  ['_koszt_zakupu_1kwh_aktualny_cena', '_calkowity_rachunek_brutto_aktualny_rachunek_cena']
    .forEach((id) => {
      const group = page.match(new RegExp(`<g id="${id}">[\\s\\S]*?<\\/g>`))?.[0];
      assert.ok(group, `Brak grupy ${id}`);
      assert.match(group, /text-anchor="end"/);
      assert.match(group, /<tspan x="285"[^>]*>PLN<\/tspan>/);
    });

  ['_koszt_zakupu_1kwh_nowy_cena', '_rachunek_po_zwrocie_z_depozytu_nowy_rachunek_cena']
    .forEach((id) => {
      const group = page.match(new RegExp(`<g id="${id}">[\\s\\S]*?<\\/g>`))?.[0];
      assert.ok(group, `Brak grupy ${id}`);
      assert.match(group, /text-anchor="end"/);
      assert.match(group, /<tspan x="555"[^>]*>PLN<\/tspan>/);
    });
});

test('kwoty podsumowania oszczędności są wyrównane do prawej krawędzi', () => {
  const page = renderOfferSvgPage(fixtureOffer(), 1);
  const ids = [
    '_laczna_zgromadzona_wartosc_depozytu_kwota',
    '_oplaty_stale_i_dystrybucyjne_kwota',
    '_laczna_wykorzystana_wartosc_depozytu_na_pokrycie_energii_pobranej_kwota',
    '_wartosc_energii_obranej_niepokrytej_z_depozytu_kwota',
    '_niewykorzystana_wartosc_depozytu_kwota',
    '_zwrot_30_wartosci_kwota',
  ];

  ids.forEach((id) => {
    const element = page.match(new RegExp(`<text[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/text>`))?.[0];
    assert.ok(element, `Brak pola ${id}`);
    assert.match(element, /text-anchor="end"/);
    assert.match(element, /<tspan x="550"/);
  });
});

test('kosztorys ma wspólne prawe osie i czytelne nazwy modeli', () => {
  const offer = fixtureOffer();
  offer.lineItemsSnapshot[0].model = 'ODS-Produkty-1';
  const page = renderOfferSvgPage(offer, 1);
  const columns = [
    { x: 350, ids: ['_ilosc_1_2', '_ilosc_2_2', '_ilosc_3_2', '_ilosc_3_4'] },
    { x: 450, ids: ['_cena_jednostkowa_brutto_1_2', '_cena_jednostkowa_brutto_2_2', '_cena_jednostkowa_brutto_3_2', '_cena_jednostkowa_brutto_3_4'] },
    { x: 550, ids: ['_wartosc_brutto_1_2', '_wartosc_brutto_2_2', '_wartosc_brutto_3_2', '_wartosc_brutto_3_4', '_kwota_koszt_systemu_2', '_kwota_po_dofinansowaniach_2'] },
  ];

  columns.forEach(({ x, ids }) => ids.forEach((id) => {
    const element = page.match(new RegExp(`<text[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/text>`))?.[0];
    assert.ok(element, `Brak pola ${id}`);
    assert.match(element, /text-anchor="end"/);
    assert.match(element, new RegExp(`<tspan x="${x}"`));
  }));
  assert.match(page, /Dyness PowerBrick Plus 16\.07 kWh/);
  assert.doesNotMatch(page, />ODS-Produkty-1</);
});

test('czas zwrotu jest zaokrąglony w dół i nie powiela jednostki lat', () => {
  const offer = fixtureOffer();
  offer.calculationSnapshot.paybackYears = 8.9;
  const page = renderOfferSvgPage(offer, 1);
  const group = page.match(/<g id="_liczba_lat">[\s\S]*?<\/g>/)?.[0];

  assert.ok(group);
  assert.equal((group.match(/>lat</g) || []).length, 1);
  assert.match(group, />8</);
  assert.doesNotMatch(group, /8,9/);
  assert.match(group, /<tspan x="550"[^>]*>lat<\/tspan>/);
});

test('słupki miesięczne mieszczą się w obszarze wykresu', () => {
  const page = renderOfferSvgPage(fixtureOffer(), 4);
  const chart = page.match(/<g id="_dynamic_energy_chart">([\s\S]*?)<\/g>/)?.[1];
  assert.ok(chart);
  const rects = Array.from(chart.matchAll(/<rect[^>]*x="([\d.]+)"[^>]*width="([\d.]+)"/g));
  assert.equal(rects.length, 36);
  const rightEdge = Math.max(...rects.map((match) => Number(match[1]) + Number(match[2])));
  assert.ok(rightEdge <= 545, `Ostatni słupek wychodzi poza wykres: ${rightEdge}`);
});
