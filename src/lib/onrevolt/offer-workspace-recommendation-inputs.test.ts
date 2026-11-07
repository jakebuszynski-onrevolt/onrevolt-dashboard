import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyOfferWorkspaceDraft, defaultOfferCalculationAssumptions } from './offer-workspace';
import { recommendationInputIssues } from './offer-workspace-recommendation-inputs';

test('zwraca VAT, geometrię PV i net-metering jako trzy konkretne przeszkody', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.pvStrategy = 'ADD_TEMPLATE';
  draft.currentSettlement = 'NET_BILLING';
  draft.targetSettlement = 'NET_METERING';

  const issues = recommendationInputIssues(draft);

  assert.deepEqual(issues.map(({ code }) => code), ['VAT_REVIEW', 'ADDED_PV_GEOMETRY', 'STORAGE_NET_METERING']);
  assert.match(issues[0].message, /VAT sprzedaży/);
  assert.doesNotMatch(issues[0].message, /ceny produktów/i);
  assert.match(issues[1].message, /nachylenie dodatkowej PV, azymut dodatkowej PV, straty modelu PV/);
  assert.match(issues[1].message, /Założeniach obliczeń/);
  assert.match(issues[1].message, /kroku System/);
  assert.match(issues[2].message, /net-metering nie jest jeszcze dostępne/);
});

test('geometria o wartości zero jest jawna i poprawna', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.pvStrategy = 'ADD_TEMPLATE';
  draft.saleVatMode = 'STANDARD_23';
  draft.currentSettlement = 'NET_BILLING';
  draft.targetSettlement = 'NET_BILLING';
  draft.existingPv.lossPercent = 0;
  draft.calculation = {
    ...defaultOfferCalculationAssumptions(),
    addedPvTiltDegrees: 0,
    addedPvAzimuthDegrees: 0,
  };

  assert.deepEqual(recommendationInputIssues(draft), []);
});

test('KEEP_EXISTING nie wymaga geometrii dodatkowej PV, a net-metering obecny z docelowym net-billing jest dozwolony', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.saleVatMode = 'MIXED';
  draft.currentSettlement = 'NET_METERING';
  draft.targetSettlement = 'NET_BILLING';

  assert.deepEqual(recommendationInputIssues(draft), []);
});

test('wykazuje tylko brakujące pola geometrii i strat modelu', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.pvStrategy = 'ADD_TEMPLATE';
  draft.saleVatMode = 'REDUCED_8';
  draft.currentSettlement = 'NET_BILLING';
  draft.targetSettlement = 'NET_BILLING';
  draft.existingPv.lossPercent = 12;
  draft.calculation = {
    ...defaultOfferCalculationAssumptions(),
    addedPvTiltDegrees: 30,
  };

  const issues = recommendationInputIssues(draft);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'ADDED_PV_GEOMETRY');
  assert.match(issues[0].message, /azymut dodatkowej PV/);
  assert.doesNotMatch(issues[0].message, /nachylenie|straty modelu/);
  assert.match(issues[0].message, /Założeniach obliczeń/);
});

test('brak rozliczenia wskazuje właściwe pole, bez odsyłania do edycji obecnego rozliczenia w polu tylko do odczytu', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.saleVatMode = 'STANDARD_23';
  draft.currentSettlement = 'NET_BILLING';
  draft.targetSettlement = 'NET_BILLING';

  for (const [field, label] of [
    ['currentSettlement', 'obecny sposób rozliczeń'],
    ['targetSettlement', 'docelowy sposób rozliczeń'],
  ] as const) {
    const incomplete = { ...draft, [field]: null };
    const issues = recommendationInputIssues(incomplete);
    assert.deepEqual(issues.map(({ code }) => code), ['SETTLEMENT_REQUIRED']);
    assert.match(issues[0].message, new RegExp(label));
    assert.doesNotMatch(issues[0].message, new RegExp(field === 'currentSettlement' ? 'docelowy sposób' : 'obecny sposób'));
    if (field === 'targetSettlement') assert.match(issues[0].message, /System rozliczeń/);
    else assert.doesNotMatch(issues[0].message, /System rozliczeń/);
  }

  const bothMissing = recommendationInputIssues({ ...draft, currentSettlement: null, targetSettlement: null });
  assert.equal(bothMissing.length, 1);
  assert.match(bothMissing[0].message, /obecny sposób rozliczeń, docelowy sposób rozliczeń/);
});
