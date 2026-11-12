import assert from 'node:assert/strict';
import test from 'node:test';
import { recognizeInvoiceText } from './invoice-recognition/registry';

const common = `
SPRZEDAWCA ENEA S.A. UL. PASTELOWA 8
FAKTURA VAT NR P/24587813/00005/26
ZA ENERGIĘ ELEKTRYCZNĄ I USŁUGI DYSTRYBUCJI
Data sprzedaży: 30/06/2026
Nr kontrahenta 24587813
Należność z rozliczenia 69,74
Do zapłaty: 69,74 zł Data wystawienia: 13/07/2026 Termin płatności: 27/07/2026
Ogółem zużycie po bilansowaniu: 61 kWh
Za okres od 01/06/2026 do 30/06/2026
Kod PPE: 590310600031022936 Grupa taryfowa: G13active
DANE DOBOWO-GODZINOWE kWh
miesiąc czerwiec Suma za 1 m
rok 2026
ilość en. el.
pobranej 115 115
ilość energii wprow
do sieci 424 424
ilości en. pobr
zbilansow godz
Eb(t)+
61 61
ilości en. wprow
zbilansow godz
Eb(t)-
370 370
ROZLICZENIE ENERGII ELEKTRYCZNEJ
ROZLICZENIE - SPRZEDAŻ ENERGII
Energia elektryczna czynna
zalecane ograniczanie kWh 16 0,0000 0,00 23
pozostałe godziny doby kWh 20 0,0000 0,00 23
zalecany pobór kWh 25 0,0000 0,00 23
Opłata handlowa zł/mc 1 0,0000 0,00 23
Ogółem wartość - sprzedaż energii: 0,00
Od 115 kWh energii elektrycznej czynnej przed bilansowaniem naliczono akcyzę
`;

test('ENEA v1 rozpoznaje nagłówek, okres i zużycie miesięczne', () => {
  const result = recognizeInvoiceText(common);
  assert.equal(result.parser.id, 'enea.invoice');
  assert.equal(result.parser.version, '1.2.0');
  assert.equal(result.fields.invoiceNumber, 'P/24587813/00005/26');
  assert.equal(result.fields.issueDate, '2026-07-13');
  assert.equal(result.fields.periodFrom, '2026-06-01');
  assert.equal(result.fields.periodTo, '2026-06-30');
  assert.equal(result.fields.billingCycleMonths, 1);
  assert.equal(result.fields.amountGross, 69.74);
  assert.equal(result.fields.amountDue, 69.74);
  assert.equal(result.fields.consumption.totalBeforeBalancingKwh, 115);
  assert.equal(result.fields.consumption.totalAfterBalancingKwh, 61);
  assert.deepEqual(result.fields.consumption.monthly, [{
    year: 2026,
    month: 6,
    period: '2026-06',
    consumptionBeforeBalancingKwh: 115,
    consumptionAfterBalancingKwh: 61,
    exportedBeforeBalancingKwh: 424,
    exportedAfterBalancingKwh: 370,
  }]);
  assert.deepEqual(result.fields.consumption.zones, [
    { name: 'zalecane ograniczanie', consumptionKwh: 16 },
    { name: 'pozostałe godziny doby', consumptionKwh: 20 },
    { name: 'zalecany pobór', consumptionKwh: 25 },
  ]);
  assert.deepEqual(result.warnings, []);
});

test('ENEA v1 rozdziela dwa miesiące i kwotę brutto od kwoty do zapłaty', () => {
  const text = common
    .replace('P/24587813/00005/26', 'P/24587813/00004/26')
    .replace('Data sprzedaży: 30/06/2026', 'Data sprzedaży: 31/05/2026')
    .replace('Należność z rozliczenia 69,74', 'Należność z rozliczenia 172,35')
    .replace('Do zapłaty: 69,74 zł', 'Do zapłaty: 138,94 zł')
    .replace('Ogółem zużycie po bilansowaniu: 61 kWh', 'Ogółem zużycie po bilansowaniu: 64 kWh')
    .replace('Za okres od 01/06/2026 do 30/06/2026', 'Za okres od 30/04/2026 do 31/05/2026')
    .replace('miesiąc czerwiec Suma za 1 m', 'miesiąc kwiecień maj Suma za 2 m')
    .replace('rok 2026', 'rok 2026 2026')
    .replace('pobranej 115 115', 'pobranej 16 172 188')
    .replace('do sieci 424 424', 'do sieci 379 426 805')
    .replace('61 61', '10 54 64')
    .replace('370 370', '263 306 569')
    .replace('zalecane ograniczanie kWh 16 0,0000 0,00 23', 'zalecane ograniczanie kWh 1 0,5030 0,50 23\nzalecane ograniczanie kWh 7 0,5030 3,52 23')
    .replace('pozostałe godziny doby kWh 20 0,0000 0,00 23', 'pozostałe godziny doby kWh 4 0,5030 2,01 23\npozostałe godziny doby kWh 14 0,5030 7,04 23')
    .replace('zalecany pobór kWh 25 0,0000 0,00 23', 'zalecany pobór kWh 5 0,5030 2,52 23\nzalecany pobór kWh 33 0,5030 16,60 23')
    .replace('Od 115 kWh', 'Od 188 kWh');

  const result = recognizeInvoiceText(text);
  assert.equal(result.fields.billingCycleMonths, 2);
  assert.equal(result.fields.amountGross, 172.35);
  assert.equal(result.fields.amountDue, 138.94);
  assert.deepEqual(
    result.fields.consumption.monthly.map((item) => [
      item.period,
      item.consumptionBeforeBalancingKwh,
      item.consumptionAfterBalancingKwh,
    ]),
    [['2026-04', 16, 10], ['2026-05', 172, 54]],
  );
  assert.deepEqual(
    result.fields.consumption.zones.map((item) => [item.name, item.consumptionKwh]),
    [['zalecane ograniczanie', 8], ['pozostałe godziny doby', 18], ['zalecany pobór', 38]],
  );
  assert.deepEqual(result.warnings, []);
});

test('rejestr odrzuca nieobsługiwany dokument', () => {
  assert.throws(() => recognizeInvoiceText('FAKTURA INNEGO OPERATORA'), /Nie rozpoznano/);
});

test('rejestr odrzuca PDF zawierający kilka faktur', () => {
  const secondInvoice = common.replace(
    'P/24587813/00005/26',
    'P/24587813/00006/26',
  );
  assert.throws(
    () => recognizeInvoiceText(`${common}\n${secondInvoice}`),
    /PDF zawiera 2 faktury ENEA/,
  );
});

test('ENEA v1 obsługuje półroczne rozliczenie prognoz z taryfą G11', () => {
  const text = `
  SPRZEDAWCA ENEA S.A.
  FAKTURA VAT NR P/24587813/00003/26
  ZA ENERGIĘ ELEKTRYCZNĄ I USŁUGI DYSTRYBUCJI
  Data sprzedaży: 29/04/2026
  PODSUMOWANIE: 1.333,22 306,64 1.639,86
  Od 1973 kWh energii elektrycznej czynnej przed bilansowaniem naliczono akcyzę
  Saldo z rozliczenia: 2.109,69 zł Data wystawienia: 27/05/2026 Termin płatności: 10/06/2026
  Ogółem zużycie po bilansowaniu: 4370 kWh
  Za okres od 01/11/2025 do 29/04/2026
  Kod PPE: 590310600031022936 Grupa taryfowa: G11
  Nr kontrahenta (odbiorcy): 24587813
  DANE DOBOWO-GODZINOWE kWh
  miesiąc listopad grudzień styczeń luty marzec kwiecień Suma za 6 m
  rok 2025 2025 2026 2026 2026 2026
  ilość en. el.
  pobranej 693 892 1.184 943 586 405 4.703
  ilość energii wprow
  do sieci 54 23 17 61 243 398 796
  ilości en. pobr
  zbilansow godz Eb(t)+
  654 870 1.167 896 490 293 4.370
  ilości en. wprow
  zbilansow godz Eb(t)-
  15 1 0 14 147 177 354
  ROZLICZENIE ENERGII ELEKTRYCZNEJ
  ROZLICZENIE - SPRZEDAŻ ENERGII
  całodobowa kWh 654 0,5050 330,27 23
  całodobowa kWh 870 0,5050 439,35 23
  całodobowa kWh 1.167 0,5030 587,00 23
  całodobowa kWh 896 0,5030 450,69 23
  całodobowa kWh 490 0,5030 246,47 23
  całodobowa kWh 293 0,5030 147,38 23
  Ogółem wartość - sprzedaż energii: 2.201,16
  `;
  const result = recognizeInvoiceText(text);
  assert.equal(result.fields.amountGross, 1639.86);
  assert.equal(result.fields.amountDue, 2109.69);
  assert.equal(result.fields.billingCycleMonths, 6);
  assert.equal(result.fields.tariff, 'G11');
  assert.equal(result.fields.consumption.totalBeforeBalancingKwh, 4703);
  assert.equal(result.fields.consumption.totalAfterBalancingKwh, 4370);
  assert.deepEqual(result.fields.consumption.zones, [{ name: 'całodobowa', consumptionKwh: 4370 }]);
  assert.deepEqual(result.warnings, []);
});


function annualNetMetering(row = '14176 10234 13520 9577 0 0,80 5858 0') {
  return `SPRZEDAWCA ENEA S.A.
FAKTURA VAT NR P/12345678/00002/26
ZA ENERGIĘ ELEKTRYCZNĄ I USŁUGI DYSTRYBUCJI
Data sprzedaży: 30/06/2026
Należność za okres od 01/07/2025 do 30/06/2026 6.233,36
Wartość prognozy z poprzedniej faktury 4.977,41
PODSUMOWANIE: 1.021,10 234,85 1.255,95
Od 2750 kWh energii elektrycznej czynnej przed bilansowaniem naliczono akcyzę
Saldo z rozliczenia: 1.255,95 zł Data wystawienia: 07/07/2026 Termin płatności: 14/08/2026
Ogółem zużycie po bilansowaniu: 5858 kWh
Za okres od 01/07/2025 do 30/06/2026
Kod PPE: 590310600000000000 Grupa taryfowa: G11
Rozliczenie energii elektrycznej wprowadzonej wobec ilości energii pobranej za okres 01/07/2025 - 30/06/2026
Współczynnik (opust) 1 2 3 4 5 6 7 8
1. Energia elektryczna całodobowa ${row}
ROZLICZENIE - SPRZEDAŻ ENERGII
całodobowa kWh 5.858 0,5050 2.958,29 23
Ogółem wartość - sprzedaż energii: 2.958,29`;
}

test('roczna ENEA: pobór i oddanie godzinowe są oddzielone od opustu, a koszt okresu od dopłaty', () => {
  const result = recognizeInvoiceText(annualNetMetering());
  assert.equal(result.fields.amountGross, 6233.36);
  assert.equal(result.fields.amountDue, 1255.95);
  assert.equal(result.fields.billingCycleMonths, 12);
  assert.deepEqual(result.fields.consumption, {
    totalBeforeBalancingKwh: 14176, exportedBeforeBalancingKwh: 10234,
    totalAfterBalancingKwh: 13520, exportedAfterBalancingKwh: 9577,
    billedAfterDiscountKwh: 5858, netMeteringFactor: 0.8, monthly: [], zones: [],
  });
  assert.deepEqual(result.warnings, ['Faktura podaje sumy za cały okres, bez miesięcznego zestawienia energii.']);
  const previous = recognizeInvoiceText(annualNetMetering('13756 10502 13180 9923 0 0,80 5242 0'));
  assert.equal(previous.fields.consumption.totalAfterBalancingKwh, 13180);
  assert.equal(previous.fields.consumption.exportedAfterBalancingKwh, 9923);
});

test('nieznany układ tabeli opustu nie podstawia dopłaty energii jako poboru ani zera eksportu', () => {
  assert.throws(() => recognizeInvoiceText(annualNetMetering('14176 10234 13520')), /tabeli opustu/);
  assert.throws(() => recognizeInvoiceText(annualNetMetering().replace('1 2 3 4 5 6 7 8', '1 2 3 4')), /kolumn rozliczenia/);
});

test('jawne zero poboru miesięcznego nie jest zastępowane ilością energii do akcyzy', () => {
  const result = recognizeInvoiceText(common.replace('pobranej 115 115', 'pobranej 0 0'));
  assert.equal(result.fields.consumption.totalBeforeBalancingKwh, 0);
});

const standardEneaInvoice = `
SPRZEDAWCA ENEA   Sprzedaż   sp.  z o.o. UL. PRZYKŁADOWA 1
FAKTURA VAT NR P/12345678/00007/26
ZA ENERGIĘ ELEKTRYCZNĄ I USŁUGI DYSTRYBUCJI
Data sprzedaży: 11.10.2026
Data wystawienia: 20.10.2026
Termin płatności: 03.11.2026
Należność z rozliczenia 922,07
Do zapłaty: 922,07 zł
Ogółem zużycie: 845 kWh
Za okres od 18.08.2026 do 11.10.2026
Kod PPE: 590310600000000000 Grupa taryfowa: G11
Współczynniki
ROZLICZENIE - SPRZEDAŻ ENERGII
Energia elektryczna czynna
całodobowa kWh 533 0,4950 263,84 23
całodobowa kWh 142 0,4950 70,29 23
całodobowa kWh 170 0,4950 84,15 23
Ogółem wartość - sprzedaż energii: 434,52
Od 845 kWh energii elektrycznej czynnej naliczono akcyzę w kwocie 4,23 zł
`;

test('standardowa faktura ENEA przyjmuje tylko potwierdzony pobór za okres i daty kropkowane', () => {
  const result = recognizeInvoiceText(standardEneaInvoice);
  assert.equal(result.parser.version, '1.2.0');
  assert.equal(result.fields.saleDate, '2026-10-11');
  assert.equal(result.fields.issueDate, '2026-10-20');
  assert.equal(result.fields.dueDate, '2026-11-03');
  assert.equal(result.fields.periodFrom, '2026-08-18');
  assert.equal(result.fields.periodTo, '2026-10-11');
  assert.equal(result.fields.billingCycleMonths, 3);
  assert.equal(result.fields.amountGross, 922.07);
  assert.equal(result.fields.consumption.meteredImportKwh, 845);
  assert.equal(result.fields.consumption.importBasis, 'METERED');
  assert.equal(result.fields.consumption.totalBeforeBalancingKwh, undefined);
  assert.equal(result.fields.consumption.totalAfterBalancingKwh, undefined);
  assert.deepEqual(result.fields.consumption.monthly, []);
  assert.deepEqual(result.fields.consumption.zones, [{ name: 'całodobowa', consumptionKwh: 845 }]);
  assert.deepEqual(result.warnings, ['Faktura podaje sumy za cały okres, bez miesięcznego zestawienia energii.']);
  assert.equal(result.confidence, 1);
});

test('standardowa wartość ogółem nie jest używana przy niezgodnej akcyzie lub strefach', () => {
  const wrongExcise = recognizeInvoiceText(standardEneaInvoice.replace('Od 845 kWh', 'Od 844 kWh'));
  assert.equal(wrongExcise.fields.consumption.meteredImportKwh, undefined);
  assert.equal(wrongExcise.fields.consumption.importBasis, 'METERED');
  assert.equal(wrongExcise.fields.consumption.totalBeforeBalancingKwh, undefined);
  assert.equal(wrongExcise.fields.consumption.totalAfterBalancingKwh, undefined);
  assert.equal(wrongExcise.warnings.some((warning) => warning.includes('nie została potwierdzona')), true);

  const wrongZones = recognizeInvoiceText(standardEneaInvoice.replace('kWh 533 ', 'kWh 534 '));
  assert.equal(wrongZones.fields.consumption.meteredImportKwh, undefined);
  assert.equal(wrongZones.fields.consumption.totalBeforeBalancingKwh, undefined);
  assert.equal(wrongZones.fields.consumption.totalAfterBalancingKwh, undefined);
});

test('daty standardowej faktury muszą być prawdziwymi datami kalendarzowymi', () => {
  const result = recognizeInvoiceText(standardEneaInvoice
    .replace('Data sprzedaży: 11.10.2026', 'Data sprzedaży: 31.02.2026')
    .replace('Za okres od 18.08.2026 do 11.10.2026', 'Za okres od 31.02.2026 do 11.10.2026'));
  assert.equal(result.fields.saleDate, undefined);
  assert.equal(result.fields.periodFrom, undefined);
  assert.equal(result.fields.periodTo, '2026-10-11');
});

test('wzmianka o ENEA bez dokładnej nazwy sprzedawcy nie kwalifikuje faktury', () => {
  const text = standardEneaInvoice.replace('SPRZEDAWCA ENEA   Sprzedaż   sp.  z o.o.', 'Administratorem jest Enea S.A.');
  assert.throws(() => recognizeInvoiceText(text), /Nie rozpoznano obsługiwanego szablonu/);
});

test('wskaźniki prosumenckie lub bilansowania blokują pobór standardowy', () => {
  const result = recognizeInvoiceText(`${standardEneaInvoice}\nWspółczynnik opustu: 0,8`);
  assert.equal(result.fields.consumption.meteredImportKwh, undefined);
  assert.equal(result.fields.consumption.totalBeforeBalancingKwh, undefined);
  assert.equal(result.fields.consumption.totalAfterBalancingKwh, undefined);
});
