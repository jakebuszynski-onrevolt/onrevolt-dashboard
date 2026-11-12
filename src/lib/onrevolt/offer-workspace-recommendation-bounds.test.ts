import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateOfferWorkspaceExistingPvBatteryBounds,
  calculateOfferWorkspaceRecommendationBatteryBounds,
  filterOfferCandidatesByPvProduction,
  filterOfferCandidatesByRecommendationBatteryBounds,
  filterOfferCandidatesByRecommendationPvBounds,
  INCOMPLETE_RECOMMENDATION_CONSUMPTION_REASON,
  INVALID_EXISTING_PV_RECOMMENDATION_REASON,
  OFFER_RECOMMENDATION_MAX_BATTERY_KWH_PER_EXISTING_PV_KWP,
  OFFER_RECOMMENDATION_MAX_BATTERY_KWH_PER_PV_KWP,
  OFFER_RECOMMENDATION_MIN_BATTERY_KWH_PER_EXISTING_PV_KWP,
} from './offer-workspace-recommendation-bounds';

function hourlyIntervals(fromUtc: string, untilUtc: string, loadKwh: number) {
  const start = Date.parse(fromUtc), until = Date.parse(untilUtc);
  return Array.from({ length: (until - start) / 3_600_000 }, (_, index) => ({
    startUtc: new Date(start + index * 3_600_000).toISOString(),
    endUtc: new Date(start + (index + 1) * 3_600_000).toISOString(),
    loadKwh,
    importKwh: 0.01,
  }));
}

test('liczy zakres od całkowitego zużycia loadKwh, nie od importu z sieci, z inkluzywnymi granicami', () => {
  const fromUtc = '2025-12-31T23:00:00.000Z';
  const untilUtc = '2026-01-01T23:00:00.000Z';
  const intervals = hourlyIntervals(fromUtc, untilUtc, 0.5);
  const result = calculateOfferWorkspaceRecommendationBatteryBounds(intervals, { fromUtc, untilUtc });

  assert.equal(result.reason, null);
  assert.deepEqual(result.bounds, {
    basis: 'daily_consumption',
    averageDailyConsumptionKwh: 12,
    totalConsumptionKwh: 12,
    dayCount: 1,
    minimumDailyConsumptionMultiplier: 0.5,
    maximumDailyConsumptionMultiplier: 2,
    minimumBatteryCapacityKwh: 6,
    maximumBatteryCapacityKwh: 24,
  });
  const filtered = filterOfferCandidatesByRecommendationBatteryBounds([
    { id: 'minimum', batteryCapacityKwh: 6 },
    { id: 'maximum', batteryCapacityKwh: 24 },
    { id: 'below', batteryCapacityKwh: 5.999 },
    { id: 'above', batteryCapacityKwh: 24.001 },
  ], result.bounds!);
  assert.deepEqual(filtered.candidates.map(candidate => candidate.id), ['minimum', 'maximum']);
  assert.equal(filtered.totalCandidatesBeforeFilter, 4);
  assert.equal(filtered.excludedCandidates, 2);
});

test('dzieli przez dwa pełne dni kalendarzowe w Warszawie przy zmianie DST, nie przez liczbę godzin/24', () => {
  const fromUtc = '2026-03-27T23:00:00.000Z';
  const untilUtc = '2026-03-29T22:00:00.000Z';
  const result = calculateOfferWorkspaceRecommendationBatteryBounds(hourlyIntervals(fromUtc, untilUtc, 1), { fromUtc, untilUtc });

  assert.equal(result.reason, null);
  const bounds = result.bounds;
  assert.ok(bounds?.basis === 'daily_consumption');
  assert.equal(bounds.averageDailyConsumptionKwh, 23.5);
  assert.equal(bounds.totalConsumptionKwh, 47);
  assert.equal(bounds.dayCount, 2);
  assert.equal(bounds.minimumBatteryCapacityKwh, 11.75);
  assert.equal(bounds.maximumBatteryCapacityKwh, 47);
});

test('uwzględnia 366 dni kompletnego roku przestępnego', () => {
  const fromUtc = '2023-12-31T23:00:00.000Z';
  const untilUtc = '2024-12-31T23:00:00.000Z';
  const result = calculateOfferWorkspaceRecommendationBatteryBounds(hourlyIntervals(fromUtc, untilUtc, 0.25), { fromUtc, untilUtc });

  assert.equal(result.reason, null);
  const bounds = result.bounds;
  assert.ok(bounds?.basis === 'daily_consumption');
  assert.equal(bounds.averageDailyConsumptionKwh, 6);
  assert.equal(bounds.dayCount, 366);
});

test('brak load, luka, duplikat, nieciągłość okresu lub brak period blokują zakres', () => {
  const fromUtc = '2025-12-31T23:00:00.000Z';
  const untilUtc = '2026-01-01T23:00:00.000Z';
  const complete = hourlyIntervals(fromUtc, untilUtc, 0.5);
  const invalidCases = [
    complete.map((interval, index) => index === 3 ? { ...interval, loadKwh: null } : interval),
    complete.map((interval, index) => index === 3 ? { ...interval, loadKwh: -0.1 } : interval),
    complete.slice(0, -1),
    [...complete.slice(0, 4), complete[3], ...complete.slice(4)],
    complete.slice(24),
  ];

  for (const intervals of invalidCases) {
    assert.deepEqual(calculateOfferWorkspaceRecommendationBatteryBounds(intervals, { fromUtc, untilUtc }), {
      bounds: null,
      reason: INCOMPLETE_RECOMMENDATION_CONSUMPTION_REASON,
    });
  }
  assert.equal(calculateOfferWorkspaceRecommendationBatteryBounds(complete, undefined).bounds, null);
  const shiftedPeriod = { fromUtc: '2025-12-31T23:00:00.001Z', untilUtc: '2026-01-01T23:00:00.001Z' };
  assert.equal(calculateOfferWorkspaceRecommendationBatteryBounds(
    hourlyIntervals(shiftedPeriod.fromUtc, shiftedPeriod.untilUtc, 0.5), shiftedPeriod,
  ).bounds, null, 'calendar boundaries must also have zero milliseconds');
});

test('rzeczywiste zerowe zużycie daje poprawny zakres [0, 0], bez zamiany braku danych na zero', () => {
  const fromUtc = '2025-12-31T23:00:00.000Z';
  const untilUtc = '2026-01-01T23:00:00.000Z';
  const result = calculateOfferWorkspaceRecommendationBatteryBounds(hourlyIntervals(fromUtc, untilUtc, 0), { fromUtc, untilUtc });

  assert.equal(result.reason, null);
  const bounds = result.bounds;
  assert.ok(bounds?.basis === 'daily_consumption');
  assert.equal(bounds.averageDailyConsumptionKwh, 0);
  assert.equal(bounds.minimumBatteryCapacityKwh, 0);
  assert.equal(bounds.maximumBatteryCapacityKwh, 0);
  assert.deepEqual(filterOfferCandidatesByRecommendationBatteryBounds([
    { id: 'zero', batteryCapacityKwh: 0 },
    { id: 'positive', batteryCapacityKwh: 0.001 },
  ], bounds).candidates.map(candidate => candidate.id), ['zero']);
});

test('limit PV 3 kWh/kWp uwzględnia łączną moc istniejącej i dodawanej instalacji, bez zaokrągleń', () => {
  assert.equal(OFFER_RECOMMENDATION_MAX_BATTERY_KWH_PER_PV_KWP, 3);
  const filtered = filterOfferCandidatesByRecommendationPvBounds([
    { id: '48-at-19-2', batteryCapacityKwh: 48, totalPvKw: 16, existingPvKw: 9.9, addedPvKw: 6.1 },
    { id: '48-below-19-2', batteryCapacityKwh: 48, totalPvKw: 15.999, existingPvKw: 9.9, addedPvKw: 6.099 },
    { id: 'existing-only', batteryCapacityKwh: 24.75, totalPvKw: 9.9, existingPvKw: 9.9, addedPvKw: 0 },
    { id: 'no-pv', batteryCapacityKwh: 5, totalPvKw: 0, existingPvKw: 0, addedPvKw: 0 },
  ]);

  assert.deepEqual(filtered.candidates.map(candidate => candidate.id), ['48-at-19-2', 'existing-only']);
  assert.equal(filtered.totalCandidatesBeforeFilter, 4);
  assert.equal(filtered.excludedCandidates, 2);
});

test('KEEP_EXISTING wyznacza inkluzywny zakres 2–3× istniejącej PV bez zaokrągleń', () => {
  assert.equal(OFFER_RECOMMENDATION_MIN_BATTERY_KWH_PER_EXISTING_PV_KWP, 2);
  assert.equal(OFFER_RECOMMENDATION_MAX_BATTERY_KWH_PER_EXISTING_PV_KWP, 3);
  const result = calculateOfferWorkspaceExistingPvBatteryBounds(9.9);
  assert.equal(result.reason, null);
  assert.deepEqual(result.bounds, {
    basis: 'existing_pv',
    existingPvPowerKw: 9.9,
    minimumBatteryKwhPerPvKwp: 2,
    maximumBatteryKwhPerPvKwp: 3,
    minimumBatteryCapacityKwh: 19.8,
    maximumBatteryCapacityKwh: 3 * 9.9,
  });
  const filtered = filterOfferCandidatesByRecommendationBatteryBounds([
    { id: 'below', batteryCapacityKwh: 19.799 },
    { id: 'minimum', batteryCapacityKwh: 19.8 },
    { id: 'maximum', batteryCapacityKwh: 29.7 },
    { id: 'above', batteryCapacityKwh: 29.701 },
  ], result.bounds!);
  assert.deepEqual(filtered.candidates.map(candidate => candidate.id), ['minimum', 'maximum']);
  assert.equal(filtered.totalCandidatesBeforeFilter, 4);
  assert.equal(filtered.excludedCandidates, 2);
});

test('KEEP_EXISTING wymaga dodatniej, skończonej mocy istniejącej PV', () => {
  for (const invalidPower of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(calculateOfferWorkspaceExistingPvBatteryBounds(invalidPower), {
      bounds: null,
      reason: INVALID_EXISTING_PV_RECOMMENDATION_REASON,
    });
  }
});

test('ADD_TEMPLATE nadal wyznacza zakres 0,5–2× średniego dobowego zużycia', () => {
  const fromUtc = '2025-12-31T23:00:00.000Z';
  const untilUtc = '2026-01-01T23:00:00.000Z';
  const intervals = hourlyIntervals(fromUtc, untilUtc, 0.5);
  const add = calculateOfferWorkspaceRecommendationBatteryBounds(intervals, { fromUtc, untilUtc });

  assert.equal(add.reason, null);
  const bounds = add.bounds;
  assert.ok(bounds?.basis === 'daily_consumption');
  assert.equal(bounds.minimumDailyConsumptionMultiplier, 0.5);
  assert.equal(bounds.maximumDailyConsumptionMultiplier, 2);
  assert.equal(bounds.minimumBatteryCapacityKwh, 6);
  assert.equal(bounds.maximumBatteryCapacityKwh, 24);
  assert.deepEqual(filterOfferCandidatesByRecommendationBatteryBounds([
    { id: 'add-below-min', batteryCapacityKwh: 5.999 },
    { id: 'add-min', batteryCapacityKwh: 6 },
    { id: 'add-upper', batteryCapacityKwh: 24 },
  ], add.bounds!).candidates.map(candidate => candidate.id), ['add-min', 'add-upper']);
});

test('produkcja 80–120% obejmuje istniejącą PV i nie ogranicza dużych firm do 20 MWh', () => {
  const candidates = [0, 1, 2, 3].map(addedPvKw => ({addedPvKw}));
  const filter = filterOfferCandidatesByPvProduction(candidates, 100000, 40000, new Map([[1,39999],[2,40000],[3,80000]]));
  assert.deepEqual(filter.candidates.map(c => c.addedPvKw), [2,3]);
  assert.throws(() => filterOfferCandidatesByPvProduction([{addedPvKw:4}],100000,40000,new Map()));
});
