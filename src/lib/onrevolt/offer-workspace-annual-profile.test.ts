import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { resolveProjectAnalysisPeriod } from './project-analysis-period';
import { buildAnnualOfferConsumptionProfile } from './offer-workspace-annual-profile';
import { annualOfferMeasurementSeries, buildAnnualProfileOfferWorkspaceEnergy, overlayOfferWorkspaceMeasurements } from './offer-workspace-energy';
import type { CatalogProfile } from './reference-profile-comparison';
import { buildReferenceProfileProjection } from './reference-profile-comparison';

const referenceCatalog = JSON.parse(readFileSync(
  join(process.cwd(), 'output', 'profile-catalog-20261106', 'catalog.json'),
  'utf8',
)) as { profiles: CatalogProfile[] };
const referenceByKey = new Map(referenceCatalog.profiles.map(profile => [profile.key, profile]));

function referenceProfile(key: string): CatalogProfile {
  const profile = referenceByKey.get(key);
  assert.ok(profile, `brak profilu ${key} w katalogu`);
  return profile;
}

test('annual RE profile normalizes to the declared total and handles Warsaw leap/DST hours', () => {
  const period = resolveProjectAnalysisPeriod('2024-01', new Date('2025-02-15T12:00:00.000Z'));
  const profile = buildAnnualOfferConsumptionProfile({ annualConsumptionKwh: 8765.4321, period });
  const total = profile.intervals.reduce((sum, interval) => sum + interval.loadKwh, 0);
  assert.ok(Math.abs(total - 8765.4321) < 1e-9);
  assert.equal(profile.intervals.length, 8784, 'leap year has 8784 real Warsaw civil hours');
  assert.ok(profile.intervals.every(interval => interval.endUtc === new Date(Date.parse(interval.startUtc) + 3600000).toISOString()));
  assert.ok(profile.intervals.find(interval => interval.localStart === '2024-01-15T07:00:00')!.loadKwh
    > profile.intervals.find(interval => interval.localStart === '2024-01-15T01:00:00')!.loadKwh, 'uses the RE hourly shape');
  assert.equal(profile.intervals.filter(interval => interval.date === '2024-03-31').length, 23);
  assert.equal(profile.intervals.filter(interval => interval.date === '2024-03-31' && interval.hour === 2).length, 0);
  assert.equal(profile.intervals.filter(interval => interval.date === '2024-10-27').length, 25);
  assert.equal(profile.intervals.filter(interval => interval.date === '2024-10-27' && interval.hour === 2).length, 2);
  assert.ok(profile.dayProfiles.some(day => day.dayType === 'workday'));
  assert.ok(profile.dayProfiles.some(day => day.dayType === 'free'));
});

test('annual profile rejects a missing, zero, negative, or non-finite annual declaration', () => {
  const period = resolveProjectAnalysisPeriod('2026-01', new Date('2027-02-15T12:00:00.000Z'));
  for (const annualConsumptionKwh of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => buildAnnualOfferConsumptionProfile({ annualConsumptionKwh, period }), /dodatnią, jawną wartością/u);
  }
});

test('BDEW reference shape preserves seasonal weights through leap-year Warsaw DST and records provenance', () => {
  const period = resolveProjectAnalysisPeriod('2024-01', new Date('2025-02-15T12:00:00.000Z'));
  const sourceProfile = referenceProfile('bdew-2025-h25');
  const contentHash = 'a'.repeat(64);
  const reference = buildAnnualOfferConsumptionProfile({
    annualConsumptionKwh: 8765.4321,
    period,
    referenceProfile: { profile: sourceProfile, contentHash },
  });
  const re = buildAnnualOfferConsumptionProfile({ annualConsumptionKwh: 8765.4321, period });
  const total = reference.intervals.reduce((sum, interval) => sum + interval.loadKwh, 0);

  assert.ok(Math.abs(total - 8765.4321) < 1e-9);
  assert.equal(reference.intervals.length, 8784);
  assert.equal(reference.intervals.filter(interval => interval.date === '2024-03-31').length, 23);
  assert.equal(reference.intervals.filter(interval => interval.date === '2024-10-27').length, 25);
  assert.equal(reference.intervals.filter(interval => interval.date === '2024-10-27' && interval.hour === 2).length, 2);
  assert.equal(reference.source, `Roczne zużycie · profil referencyjny ${sourceProfile.name}`);
  assert.deepEqual(reference.referenceProfile, {
    key: sourceProfile.key,
    name: sourceProfile.name,
    contentHash,
    method: 'bdew-standard-profile',
    projectionVersion: 1,
    notes: reference.referenceProfile!.notes,
  });
  assert.ok(reference.referenceProfile!.notes.some(note => note.includes('nie ze zbiorczych wyników porównania 2025')));
  assert.notDeepEqual(reference.intervals.map(interval => interval.loadKwh), re.intervals.map(interval => interval.loadKwh));
  assert.ok(new Set(reference.intervals.map(interval => interval.period.slice(5))).size === 12);

  const projection = buildReferenceProfileProjection(sourceProfile, ['2024-03-31', '2024-10-27']);
  const dailyTotal = (date: string) => reference.intervals.filter(interval => interval.date === date)
    .reduce((sum, interval) => sum + interval.loadKwh, 0);
  const projectedDailyTotal = (date: string) => projection.days.find(day => day.date === date)!.hours
    .reduce((sum, value) => sum + value, 0);
  const springScale = dailyTotal('2024-03-31') / projectedDailyTotal('2024-03-31');
  const autumnScale = dailyTotal('2024-10-27') / projectedDailyTotal('2024-10-27');
  assert.ok(Math.abs(springScale - autumnScale) < 1e-12,
    'DST changes the interval count while preserving each day’s raw source-profile sum');
  const modeledEnergy = buildAnnualProfileOfferWorkspaceEnergy({ profile: reference, pvHours: [], noPv: true });
  const modeledSeries = annualOfferMeasurementSeries(reference, modeledEnergy);
  assert.equal(modeledEnergy.model.includes('Profil referencyjny'), true);
  assert.equal(modeledEnergy.model.includes('RE DEFAULT_HOURLY_PERCENT'), false);
  assert.equal(modeledEnergy.modelledMeasurements?.provenance.referenceProfile?.contentHash, contentHash);
  assert.equal(modeledSeries.modelProvenance.modelId, 'annual-reference-profile');
  assert.equal(modeledSeries.modelProvenance.referenceProfile?.key, sourceProfile.key);
  assert.equal(modeledSeries.modelProvenance.referenceProfile?.contentHash, contentHash);
});

test('OPSD pump shape projects a rolling 12-month target across years with exact annual scaling', () => {
  const period = resolveProjectAnalysisPeriod('2026-08', new Date('2027-09-15T12:00:00.000Z'));
  const sourceProfile = referenceProfile('opsd_20200415_de_kn_residential1_heat_pump');
  const contentHash = 'b'.repeat(64);
  const projected = buildAnnualOfferConsumptionProfile({
    annualConsumptionKwh: 12_345.6789,
    period,
    referenceProfile: { profile: sourceProfile, contentHash },
  });
  const total = projected.intervals.reduce((sum, interval) => sum + interval.loadKwh, 0);

  assert.equal(period.periodKeys[0], '2026-08');
  assert.equal(period.periodKeys[11], '2027-07');
  assert.ok(Math.abs(total - 12_345.6789) < 1e-9);
  assert.ok(projected.intervals.some(interval => interval.date === '2026-10-25' && interval.hour === 2 && interval.occurrence === 2));
  assert.equal(projected.intervals.filter(interval => interval.date === '2027-03-28').length, 23);
  assert.equal(projected.referenceProfile?.contentHash, contentHash);
  assert.equal(projected.referenceProfile?.method, 'opsd-normalized-pump-shape');
  assert.match(projected.referenceProfile?.notes.join(' ') || '', /znormalizowany kształt godzinowy.*nie jest rzeczywistym pomiarem/u);
  assert.equal(projected.intervals.every(interval => Number.isFinite(interval.loadKwh) && interval.loadKwh >= 0), true);
  assert.ok(new Set(projected.intervals.map(interval => interval.period)).size === 12);
});

test('OPSD pump annual residual is assigned to a positive interval without making zero hours negative', () => {
  const period = resolveProjectAnalysisPeriod('2023-07', new Date('2024-08-15T12:00:00.000Z'));
  const sourceProfile = referenceProfile('opsd_20200415_de_kn_residential4_heat_pump');
  const projected = buildAnnualOfferConsumptionProfile({
    annualConsumptionKwh: 3600.001,
    period,
    referenceProfile: { profile: sourceProfile, contentHash: 'e'.repeat(64) },
  });
  const total = projected.intervals.reduce((sum, interval) => sum + interval.loadKwh, 0);

  assert.ok(Math.abs(total - 3600.001) < 1e-9);
  assert.ok(projected.intervals.every(interval => Number.isFinite(interval.loadKwh) && interval.loadKwh >= 0));
  assert.ok(projected.intervals.some(interval => interval.loadKwh === 0), 'source zero hours remain zero');
});

test('selected grid-import reference profile is rejected instead of falling back to RE', () => {
  const period = resolveProjectAnalysisPeriod('2026-01', new Date('2027-02-15T12:00:00.000Z'));
  assert.throws(() => buildAnnualOfferConsumptionProfile({
    annualConsumptionKwh: 3650,
    period,
    referenceProfile: {
      profile: referenceProfile('bdew-2025-p25'),
      contentHash: 'c'.repeat(64),
    },
  }), /pobór z sieci.*autokonsumpcja PV/u);
});

test('annual profile model derives balanced hourly and monthly PV flows and overlays only ephemerally', () => {
  const period = resolveProjectAnalysisPeriod('2024-01', new Date('2025-02-15T12:00:00.000Z'));
  const profile = buildAnnualOfferConsumptionProfile({ annualConsumptionKwh: 8760, period });
  const energy = buildAnnualProfileOfferWorkspaceEnergy({
    profile,
    noPv: false,
    pvSource: 'PV test source',
    pvModel: 'PV test model',
    pvHours: profile.intervals.map(interval => ({ startUtc: interval.startUtc, pvKwh: 0.5 })),
  });
  assert.equal(energy.quality, 'MODELLED');
  assert.equal(energy.source, 'Roczne zużycie · profil godzinowy RE');
  assert.equal(energy.intervals?.length, profile.intervals.length);
  assert.equal(energy.months.length, 12);
  assert.equal(energy.modelledMeasurements?.months.length, 12);
  assert.ok(Math.abs(energy.totals.loadKwh! - 8760) < 1e-9);
  for (const row of energy.intervals!) {
    assert.ok(Math.abs(row.loadKwh! - (row.directKwh! + row.importKwh!)) < 1e-12);
    assert.ok(Math.abs(row.pvKwh! - (row.directKwh! + row.exportKwh!)) < 1e-12);
  }
  const original = { months: period.periodKeys.map(period => ({ period, importKwh: null, exportKwh: null })),
    periods: [], dayProfiles: [], totalsImportKwh: null, totalsExportKwh: null, intervalCount: null,
    missingDirections: [], issues: [] } as any;
  const overlay = overlayOfferWorkspaceMeasurements(original, energy);
  assert.notEqual(overlay, original);
  assert.equal(original.months[0].importKwh, null, 'the workspace input remains unchanged');
  assert.equal(overlay.months.every(month => month.importKwh !== null && month.exportKwh !== null), true);
  assert.equal(overlay.intervalCount, null, 'modelled intervals are not labeled as meter readings');
  assert.ok(overlay.issues.some(issue => issue.includes('nie dane pomiarowe')));
  const series = annualOfferMeasurementSeries(profile, energy);
  assert.equal(series.ppeNumber, 'MODELLED_ANNUAL_PROFILE');
  assert.equal(series.modelProvenance.modelId, 'annual-profile-re');
  assert.equal(series.intervals.length, profile.intervals.length);
  assert.ok(series.intervals.every(interval => interval.import?.source === 'estimated'
    && interval.export?.source === 'estimated' && interval.import.fileIds.length === 0 && interval.export.fileIds.length === 0));
  assert.equal(series.periods.length, 12);
  assert.ok(series.periods.every(month => month.hasImport && month.hasExport && month.missingDirections.length === 0));
});

test('no-PV annual profile exports zero and models grid import as the annual load', () => {
  const period = resolveProjectAnalysisPeriod('2026-01', new Date('2027-02-15T12:00:00.000Z'));
  const profile = buildAnnualOfferConsumptionProfile({ annualConsumptionKwh: 3650, period });
  const energy = buildAnnualProfileOfferWorkspaceEnergy({ profile, pvHours: [], noPv: true });
  assert.equal(energy.quality, 'MODELLED');
  assert.ok(Math.abs(energy.totals.loadKwh! - 3650) < 1e-9);
  assert.ok(Math.abs(energy.modelledMeasurements!.totalsImportKwh - 3650) < 1e-9);
  assert.equal(energy.modelledMeasurements!.totalsExportKwh, 0);
  assert.ok(energy.intervals!.every(row => row.pvKwh === 0 && row.directKwh === 0 && row.exportKwh === 0 && row.importKwh === row.loadKwh));
});
