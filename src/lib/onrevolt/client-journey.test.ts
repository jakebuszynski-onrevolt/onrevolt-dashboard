import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateClientJourney } from './client-journey';

test('oblicza postęp danych klienta z czterech jawnych kryteriów', () => {
  const result = calculateClientJourney({
    displayName: 'Anna Nowak',
    clientType: 'B2C',
    hasContactChannel: true,
    hasAddress: false,
  });
  assert.equal(result.progress.client, 75);
});

test('mapuje statusy procesu na właściwe punkty ścieżki', () => {
  assert.equal(calculateClientJourney({ projectStatus: 'LEAD' }).currentKey, 'client');
  assert.equal(calculateClientJourney({ projectStatus: 'CZEKA_NA_KALKULACJE' }).currentKey, 'configuration');
  assert.equal(calculateClientJourney({ projectStatus: 'OFERTA_PRZYGOTOWANA' }).currentKey, 'offer');
  assert.equal(calculateClientJourney({ projectStatus: 'OFERTA_ZAAKCEPTOWANA' }).currentKey, 'contract');
  assert.equal(calculateClientJourney({ projectStatus: 'ZALICZKA_MONTAZ' }).currentKey, 'installation');
  assert.equal(calculateClientJourney({ projectStatus: 'PROCEDURA_OSD' }).currentKey, 'billing');
  assert.equal(calculateClientJourney({ projectStatus: 'ZAKONCZONY' }).currentKey, 'documents');
});

test('rozróżnia postęp konfiguracji, oferty, umowy i montażu', () => {
  const result = calculateClientJourney({
    configurations: [{ status: 'READY' }],
    offers: [{ status: 'ACCEPTED', contracts: [{ status: 'SIGNED' }] }],
    installations: [{ status: 'IN_PROGRESS' }],
  });
  assert.equal(result.progress.configuration, 75);
  assert.equal(result.progress.offer, 100);
  assert.equal(result.progress.contract, 100);
  assert.equal(result.progress.installation, 65);
});

test('zamyka etap faktur i OSD dopiero po zakończeniu sprawy', () => {
  const inProgress = calculateClientJourney({
    energyAccounts: [{ ppeNumber: '590', measurementFiles: [{}] }],
    invoiceCount: 2,
    odsCase: { status: 'SUBMITTED' },
  });
  assert.equal(inProgress.progress.billing, 80);

  const completed = calculateClientJourney({ odsCase: { status: 'COMPLETED' } });
  assert.equal(completed.progress.billing, 100);
});

test('status serwisowy wyróżnia serwis poza dolną ścieżką', () => {
  const result = calculateClientJourney({ projectStatus: 'SERWIS' });
  assert.equal(result.serviceStage, true);
  assert.equal(result.currentKey, 'client');
});
