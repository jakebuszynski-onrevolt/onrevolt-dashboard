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
  assert.equal(calculateClientJourney({ projectStatus: 'CZEKA_NA_KALKULACJE' }).currentKey, 'offer');
  assert.equal(calculateClientJourney({ projectStatus: 'OFERTA_PRZYGOTOWANA' }).currentKey, 'offer');
  assert.equal(calculateClientJourney({ projectStatus: 'OFERTA_ZAAKCEPTOWANA' }).currentKey, 'contract');
  assert.equal(calculateClientJourney({ projectStatus: 'ZALICZKA_MONTAZ' }).currentKey, 'installation');
  assert.equal(calculateClientJourney({ projectStatus: 'PROCEDURA_OSD' }).currentKey, 'formalities');
  assert.equal(calculateClientJourney({ projectStatus: 'ZAKONCZONY' }).currentKey, 'documents');
});

test('rozróżnia postęp konfiguracji, oferty, umowy i montażu', () => {
  const result = calculateClientJourney({
    configurations: [{ status: 'READY' }],
    offers: [{ status: 'ACCEPTED', contracts: [{ status: 'SIGNED' }] }],
    installations: [{ status: 'IN_PROGRESS' }],
  });
  assert.equal(result.progress.offer, 100);
  assert.equal(result.progress.contract, 100);
  assert.equal(result.progress.installation, 65);
});

test('włącza postęp konfiguracji do wspólnego kroku oferty', () => {
  const result = calculateClientJourney({ configurations: [{ status: 'READY' }] });
  assert.equal(result.progress.offer, 75);
});

test('pokazuje formalności po rozpoczęciu procedury OSD', () => {
  const inProgress = calculateClientJourney({ odsCase: { status: 'SUBMITTED' } });
  assert.equal(inProgress.progress.formalities, 60);

  const completed = calculateClientJourney({ odsCase: { status: 'COMPLETED' } });
  assert.equal(completed.progress.formalities, 100);
});

test('liczy kompletność danych energetycznych bez wymagania faktur', () => {
  const result = calculateClientJourney({
    energyData: {
      hasConsumptionData: true,
      terrainType: 'SUBURBAN',
      buildingType: 'SINGLE_FAMILY',
      roofShape: 'GABLE_BARN',
      settlementSystem: 'net-billing',
      energySupplier: 'ENEA',
      connectionType: 'LOW_VOLTAGE',
      connectionPowerKw: 11,
      heatingSource: 'NATURAL_GAS',
      heatingSourceDetail: 'GAS_CONDENSING',
      heatingSourceDetailRequired: true,
    },
  });

  assert.equal(result.progress.billing, 100);
});

test('pokazuje 95 procent przy jednym brakującym polu pomocniczym', () => {
  const result = calculateClientJourney({
    energyData: {
      hasConsumptionData: true,
      terrainType: 'SUBURBAN',
      buildingType: 'SINGLE_FAMILY',
      roofShape: '',
      settlementSystem: 'net-billing',
      energySupplier: 'ENEA',
      connectionType: 'LOW_VOLTAGE',
      connectionPowerKw: 11,
      heatingSource: 'DISTRICT_HEATING',
      heatingSourceDetailRequired: false,
    },
  });

  assert.equal(result.progress.billing, 95);
});

test('nie miesza postępu sprawy OSD z kompletnością danych energetycznych', () => {
  const result = calculateClientJourney({ odsCase: { status: 'COMPLETED' } });
  assert.equal(result.progress.billing, 0);
  assert.equal(result.progress.formalities, 100);
});

test('status serwisowy wyróżnia serwis poza dolną ścieżką', () => {
  const result = calculateClientJourney({ projectStatus: 'SERWIS' });
  assert.equal(result.serviceStage, true);
  assert.equal(result.currentKey, 'client');
});
