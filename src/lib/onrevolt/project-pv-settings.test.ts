import assert from 'node:assert/strict';
import test from 'node:test';
import { readOfferPvProfile } from './offer-pv-profile';
import { resolveProjectAnalysisPeriod } from './project-analysis-period';
import {
  annualPvProductionKwh,
  completeProjectPvProfileInput,
  mergeProjectPvSettingsIntoDraft,
  parseProjectPvSettingsPatch,
  projectPvSettingsFromSources,
  projectPvSettingsPowerFromDraft,
  seedProjectPvWorkspaceDraft,
} from './project-pv-settings';

test('istniejący draft jest źródłem PV także dla jawnych nulli', () => {
  assert.deepEqual(projectPvSettingsFromSources({
    draftExists: true,
    draftInput: { existingPv: { powerKw: null, tiltDegrees: null, azimuthDegrees: null, lossPercent: null } },
    energyAudit: { existingPvKw: 8, roofTiltDeg: 35, roofOrientation: 'S' },
  }), { powerKw: null, tiltDegrees: null, azimuthDegrees: null, lossPercent: null });
});

test('fallback audytu mapuje pojedynczą orientację dachu bez wymyślania strat', () => {
  assert.deepEqual(projectPvSettingsFromSources({
    draftExists: false,
    energyAudit: { existingPvKw: '7.5', roofTiltDeg: 25, roofOrientation: 'SW', settlementSystem: 'NET_BILLING' },
  }), { powerKw: 7.5, tiltDegrees: 25, azimuthDegrees: 225, lossPercent: null });
  assert.deepEqual(projectPvSettingsFromSources({
    draftExists: false,
    energyAudit: { existingPvKw: 0, roofTiltDeg: 25, roofOrientation: 'S' },
  }), { powerKw: 0, tiltDegrees: null, azimuthDegrees: null, lossPercent: null });
  assert.equal(projectPvSettingsFromSources({
    draftExists: false,
    energyAudit: { existingPvKw: 7, roofTiltDeg: 25, roofOrientation: 'E_W' },
  }).azimuthDegrees, null);
});

test('parsuje zakresy i jawne nulle ustawień geometrii', () => {
  assert.deepEqual(parseProjectPvSettingsPatch({
    tiltDegrees: null, azimuthDegrees: '270', lossPercent: null, expectedRevision: 4,
  }), { tiltDegrees: null, azimuthDegrees: 270, lossPercent: null, expectedRevision: 4 });
  assert.throws(() => parseProjectPvSettingsPatch({
    tiltDegrees: 91, azimuthDegrees: 180, lossPercent: 14, expectedRevision: 0,
  }), /Nachylenie PV/);
  assert.throws(() => parseProjectPvSettingsPatch({
    tiltDegrees: 20, azimuthDegrees: 361, lossPercent: 14, expectedRevision: 0,
  }), /Azymut PV/);
  assert.throws(() => parseProjectPvSettingsPatch({
    tiltDegrees: 20, azimuthDegrees: 180, lossPercent: 99.1, expectedRevision: 0,
  }), /Straty PV/);
  assert.throws(() => parseProjectPvSettingsPatch({
    tiltDegrees: 20, azimuthDegrees: 180, lossPercent: 14, expectedRevision: -1,
  }), /expectedRevision/);
});

test('merge zmienia wyłącznie existingPv i zachowuje resztę draftu', () => {
  const original = {
    schemaVersion: 1,
    currentSettlement: 'NET_BILLING',
    targetOperatorId: 5,
    targetTariffId: 17,
    description: { before: 'zachowaj', after: 'także' },
    existingPv: { powerKw: 6, tiltDegrees: 30, azimuthDegrees: 180, lossPercent: 14, sourceNote: 'keep' },
  };
  const patch = parseProjectPvSettingsPatch({
    tiltDegrees: null, azimuthDegrees: 90, lossPercent: null, expectedRevision: 2,
  });
  const result = mergeProjectPvSettingsIntoDraft(original, 0, patch);

  assert.deepEqual(result, {
    ...original,
    existingPv: { powerKw: 0, tiltDegrees: null, azimuthDegrees: 90, lossPercent: null, sourceNote: 'keep' },
  });
  assert.equal(projectPvSettingsPowerFromDraft(result), 0);
});

test('nowy draft zachowuje settlement z audytu jako wartość początkową', () => {
  const draft = seedProjectPvWorkspaceDraft({ settlementSystem: 'net-billing' }, { osdId: 7, tariffId: 42 });
  assert.equal(draft.currentSettlement, 'NET_BILLING');
  assert.equal(draft.targetSettlement, 'NET_BILLING');
  assert.equal(draft.targetOperatorId, 7);
  assert.equal(draft.targetTariffId, 42);
});

test('PV calculation wymaga kompletnych zakresowych parametrów, a zapis przyjmuje null', () => {
  const period = resolveProjectAnalysisPeriod('2025-10', new Date('2026-10-30T12:00:00.000Z'));
  assert.equal(period.endMonth, '2026-09');
  assert.equal(period.endDate, '2026-09-30');
  assert.equal(period.periodKeys.length, 12);
  assert.equal(period.fromUtc, '2025-09-30T22:00:00.000Z');
  assert.equal(period.untilUtc, '2026-09-30T22:00:00.000Z');
  assert.throws(() => completeProjectPvProfileInput({
    powerKw: 5, tiltDegrees: null, azimuthDegrees: 180, lossPercent: 14,
  }, 52, 21, period), /Uzupełnij współrzędne, nachylenie/);
  assert.throws(() => completeProjectPvProfileInput({
    powerKw: 5, tiltDegrees: 30, azimuthDegrees: 180, lossPercent: 14,
  }, 91, 21, period), /Szerokość geograficzna/);
  assert.throws(() => completeProjectPvProfileInput({
    powerKw: 5, tiltDegrees: 30, azimuthDegrees: 180, lossPercent: 14,
  }, 52, 181, period), /Długość geograficzna/);
});

test('zero PV daje dokładne zero dla wszystkich zamkniętych godzin', async () => {
  const period = resolveProjectAnalysisPeriod('2025-10', new Date('2026-10-30T12:00:00.000Z'));
  const input = completeProjectPvProfileInput({
    powerKw: 0, tiltDegrees: 0, azimuthDegrees: 0, lossPercent: 0,
  }, 52.23, 21.01, period);
  const profile = await readOfferPvProfile(input);

  assert.equal(profile.hours.length, 8760);
  assert.equal(annualPvProductionKwh(profile.hours), 0);
  assert.equal(profile.temporalBasis, 'zero-capacity');
});
