import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildReferenceProfileProjection,
  compareReferenceProfiles,
  getReferenceProfileCalculationEligibility,
  summarizeReferenceProfile,
} from './reference-profile-comparison';
import type { CatalogProfile } from './reference-profile-comparison';

const catalog = JSON.parse(readFileSync(
  join(process.cwd(), 'output', 'profile-catalog-20261106', 'catalog.json'),
  'utf8',
)) as { profiles: CatalogProfile[] };

const profiles = catalog.profiles;
const profileByKey = new Map(profiles.map((profile) => [profile.key, profile]));
const opsdWholeHouse = JSON.parse(readFileSync(
  join(process.cwd(), 'assets', 'reference-profiles', 'opsd-residential4-whole-house.json'),
  'utf8',
)) as CatalogProfile;

function profile(key: string) {
  const found = profileByKey.get(key);
  assert.ok(found, `brak profilu ${key} w katalogu`);
  return found;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

test('katalog 34 rzeczywistych profili kwalifikuje 16 BDEW/VDEW i 5 pełnych profili OPSD', () => {
  assert.equal(profiles.length, 34);
  const summaries = profiles.map(summarizeReferenceProfile);
  const eligible = summaries.filter((summary) => summary.eligible);
  const disabled = summaries.filter((summary) => !summary.eligible);

  assert.equal(eligible.length, 21);
  assert.equal(disabled.length, 13);
  assert.ok(disabled.every((summary) => summary.reason && summary.reason.length > 0));
  assert.ok(eligible.every((summary) => summary.reason === null));

  for (const summary of summaries) {
    assert.equal(typeof summary.key, 'string');
    assert.equal(typeof summary.name, 'string');
    assert.equal(typeof summary.sourceKey, 'string');
    assert.equal(typeof summary.category, 'string');
    assert.equal(typeof summary.kind, 'string');
    assert.equal(typeof summary.quantity, 'string');
    assert.equal(typeof summary.unit, 'string');
    assert.equal(typeof summary.yearLabel, 'string');
    assert.ok(Array.isArray(summary.notes));
  }
});

test('porównanie normalizuje roczny wynik i miesięczne słupki do annualKwh', () => {
  const selected = [
    profile('bdew-2025-h25'),
    profile('bdew-2025-p25'),
    profile('vdew-1999-h0'),
    profile('opsd_20200415_de_kn_residential1_grid_import'),
    profile('opsd_20200415_de_kn_residential4_grid_import'),
  ];
  const annualKwh = 18_432.75;
  const results = compareReferenceProfiles(selected, { annualKwh, month: null, dayType: 'all' });

  assert.equal(results.length, selected.length);
  for (const result of results) {
    assert.equal(result.eligible, true);
    assert.equal(result.monthlyKwh.length, 12);
    assert.equal(result.dailyAverageKwh.length, 24);
    assert.ok(result.monthlyKwh.every(Number.isFinite));
    assert.ok(result.dailyAverageKwh.every(Number.isFinite));
    assert.ok(Math.abs(sum(result.monthlyKwh) - annualKwh) < 1e-8);
    assert.ok(Math.abs(result.totalKwh - annualKwh) < 1e-8);
  }
  assert.match(results.find((result) => result.key === 'opsd_20200415_de_kn_residential4_grid_import')!.yearLabel, /2017 \(UTC\)/);
  assert.match(results.find((result) => result.key === 'opsd_20200415_de_kn_residential1_grid_import')!.yearLabel, /2016 \(UTC\)/);
});

test('wybór miesiąca i typu dnia zmienia tylko średnią dobową, nie roczną normalizację', () => {
  const household = profile('bdew-2025-h25');
  const workdays = compareReferenceProfiles([household], { annualKwh: 12_000, month: 1, dayType: 'workday' })[0];
  const weekends = compareReferenceProfiles([household], { annualKwh: 12_000, month: 1, dayType: 'weekend' })[0];

  assert.deepEqual(workdays.monthlyKwh, weekends.monthlyKwh);
  assert.equal(workdays.totalKwh, 12_000);
  assert.equal(weekends.totalKwh, 12_000);
  assert.notDeepEqual(workdays.dailyAverageKwh, weekends.dailyAverageKwh);
  assert.ok(workdays.dailyAverageKwh.every(Number.isFinite));
  assert.ok(weekends.dailyAverageKwh.every(Number.isFinite));
});

test('VDEW H0 używa dynamizacji zależnej od dnia i poprawia końcowe etykiety do początku kwadransa', () => {
  const h0 = profile('vdew-1999-h0');
  const result = compareReferenceProfiles([h0], { annualKwh: 1_000, month: 1, dayType: 'workday' })[0];
  const quarterByEnd = new Map<string, number>();
  for (const point of h0.series) {
    const slot = String(point.slot);
    const [hour, minute] = slot.split(':').map(Number);
    const end = hour * 60 + minute + Number(point.dayOffset) * 1440;
    quarterByEnd.set(`${point.season}/${point.dayType}/${end}`, Number(point.value));
  }
  const holidayDates = new Set(['2025-01-01', '2025-01-06']);
  let expectedHour0 = 0;
  let expectedHour1 = 0;
  let includedDays = 0;
  for (let day = 1; day <= 31; day += 1) {
    const date = `2025-01-${String(day).padStart(2, '0')}`;
    const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
    if (weekday === 0 || weekday === 6 || holidayDates.has(date)) continue;
    includedDays += 1;
    const dayOfYear = day;
    const rawFactor = -3.92e-10 * dayOfYear ** 4 + 3.2e-7 * dayOfYear ** 3
      - 7.02e-5 * dayOfYear ** 2 + 2.1e-3 * dayOfYear + 1.24;
    const factor = Math.round((rawFactor + Number.EPSILON) * 10_000) / 10_000;
    for (let end = 15; end <= 60; end += 15) {
      const watts = quarterByEnd.get(`winter/Weekday/${end}`)!;
      expectedHour0 += Math.round((watts * factor + Number.EPSILON) * 10) / 10 * 0.25 / 1000;
    }
    for (let end = 75; end <= 120; end += 15) {
      const watts = quarterByEnd.get(`winter/Weekday/${end}`)!;
      expectedHour1 += Math.round((watts * factor + Number.EPSILON) * 10) / 10 * 0.25 / 1000;
    }
  }
  assert.ok(includedDays > 0);
  assert.ok(Math.abs(result.dailyAverageKwh[0] / result.dailyAverageKwh[1] - expectedHour0 / expectedHour1) < 1e-10);
  assert.ok(result.notes.some((note) => note.includes('dynamiz')));
});

test('P25/S25 jasno opisują pobór z sieci i rolę bilansu PV w SOT', () => {
  for (const key of ['bdew-2025-p25', 'bdew-2025-s25']) {
    const summary = summarizeReferenceProfile(profile(key));
    assert.equal(summary.eligible, true);
    assert.ok(summary.notes.some((note) => note.includes('pobór z sieci')));
    assert.ok(summary.notes.some((note) => note.includes('bilans PV') && note.includes('SOT')));
  }
});

test('kwalifikacja projekcji rocznej dopuszcza H25/G25/L25, wszystkie VDEW i pompy OPSD', () => {
  for (const key of ['bdew-2025-h25', 'bdew-2025-g25', 'bdew-2025-l25']) {
    const eligibility = getReferenceProfileCalculationEligibility(profile(key));
    assert.deepEqual(eligibility, { eligible: true, reason: null, method: 'bdew-standard-profile' });
  }
  for (const key of Object.keys({
    'vdew-1999-h0': true, 'vdew-1999-g0': true, 'vdew-1999-g1': true, 'vdew-1999-g2': true,
    'vdew-1999-g3': true, 'vdew-1999-g4': true, 'vdew-1999-g5': true, 'vdew-1999-g6': true,
    'vdew-1999-l0': true, 'vdew-1999-l1': true, 'vdew-1999-l2': true,
  })) {
    assert.equal(getReferenceProfileCalculationEligibility(profile(key)).eligible, true, key);
  }
  const pump = getReferenceProfileCalculationEligibility(profile('opsd_20200415_de_kn_residential1_heat_pump'));
  assert.equal(pump.eligible, true);
  assert.equal(pump.method, 'opsd-normalized-pump-shape');
  assert.equal(summarizeReferenceProfile(profile('opsd_20200415_de_kn_residential1_heat_pump')).name,
    'Sama pompa ciepła — dom 1 (OPSD)');
  assert.equal(summarizeReferenceProfile(profile('opsd_20200415_de_kn_residential4_heat_pump')).name,
    'Sama pompa ciepła — dom 4 (OPSD)');

  for (const key of ['bdew-2025-p25', 'bdew-2025-s25', 'opsd_20200415_de_kn_residential1_grid_import']) {
    const eligibility = getReferenceProfileCalculationEligibility(profile(key));
    assert.equal(eligibility.eligible, false);
    assert.match(eligibility.reason || '', /pobór z sieci|autokonsumpcja PV/i);
  }
  const partial = getReferenceProfileCalculationEligibility(profile('opsd_20200415_de_kn_industrial3_grid_import'));
  assert.equal(partial.eligible, false);
  assert.match(partial.reason || '', /kompletnego roku UTC/);
});

test('OPSD 4 whole-house pattern validates provenance and all 576 groups', () => {
  const summary = summarizeReferenceProfile(opsdWholeHouse);
  const eligibility = getReferenceProfileCalculationEligibility(opsdWholeHouse);
  assert.equal(summary.eligible, true);
  assert.equal(summary.key, 'opsd_20200415_de_kn_residential4_household_heat_pump');
  assert.equal(summary.name, 'Dom z pompą ciepła — bez ładowania auta (OPSD 4)');
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.method, 'opsd-whole-house-seasonal-pattern');
  assert.equal(opsdWholeHouse.series.length, 576);
  assert.equal(opsdWholeHouse.quality.minimumSamplesPerGroup, 1);
  assert.ok(summary.notes.some((note) => note.includes('Niska pewność')));
  assert.ok(summary.notes.some((note) => note.includes('EV odjęto')));
  assert.ok(summary.notes.some((note) => note.includes('tylko 1 próbkę')));
  assert.ok(summary.notes.some((note) => note.includes('około jednominutowe przesunięcie')));

  const badMetadata = summarizeReferenceProfile({
    ...opsdWholeHouse,
    metadata: { ...opsdWholeHouse.metadata, evTreatment: 'EV nie odjęto' },
  });
  assert.equal(badMetadata.eligible, false);
  assert.match(badMetadata.reason || '', /granicy wnioskowania/);

  const missingGroup = summarizeReferenceProfile({
    ...opsdWholeHouse,
    series: opsdWholeHouse.series.slice(1),
  });
  assert.equal(missingGroup.eligible, false);
  assert.match(missingGroup.reason || '', /liczba danych OPSD 4/);

  const nonpositiveGroup = summarizeReferenceProfile({
    ...opsdWholeHouse,
    series: opsdWholeHouse.series.map((point, index) => index === 0 ? { ...point, value: 0 } : point),
  });
  assert.equal(nonpositiveGroup.eligible, false);
  assert.match(nonpositiveGroup.reason || '', /średnią/);
});

test('OPSD whole-house projects month/day-type/hour directly with summer household load', () => {
  const projection = buildReferenceProfileProjection(opsdWholeHouse, ['2025-07-15', '2025-07-19', '2025-12-25']);
  assert.equal(projection.method, 'opsd-whole-house-seasonal-pattern');
  assert.equal(projection.sourceYear, 2016);
  assert.deepEqual(projection.days.map((day) => day.dayType), ['workday', 'weekend', 'workday']);
  assert.ok(projection.days.every((day) => day.hours.length === 24 && day.hours.every((value) => value > 0)));
  assert.ok(projection.days[0].hours.reduce((sum, value) => sum + value, 0) > 0,
    'summer household consumption remains in the whole-house pattern');
  assert.ok(projection.notes.some((note) => note.includes('jednego gospodarstwa')));

  const pattern = new Map(opsdWholeHouse.series.map((point) => (
    [`${point.month}/${point.dayType}/${point.hour}`, Number(point.value)]
  )));
  for (const day of projection.days) {
    for (let hour = 0; hour < 24; hour += 1) {
      assert.equal(day.hours[hour], pattern.get(`${day.month}/${day.dayType}/${hour}`));
    }
  }

  const comparison = compareReferenceProfiles([opsdWholeHouse], { annualKwh: 12_000, month: null, dayType: 'all' })[0];
  assert.equal(comparison.eligible, true);
  assert.ok(Math.abs(sum(comparison.monthlyKwh) - 12_000) < 1e-8);
  assert.ok(comparison.monthlyKwh[6] > 0);
});

test('projekcja buduje kształt z docelowych dat, sezonu i kalendarza lokalnego', () => {
  const h25 = profile('bdew-2025-h25');
  const eligibility = getReferenceProfileCalculationEligibility(h25);
  const projection = buildReferenceProfileProjection(h25, ['2024-03-19', '2025-03-19', '2026-05-01', '2026-07-15']);
  assert.equal(projection.method, eligibility.method);
  assert.equal(projection.sourceYear, null);
  assert.deepEqual(projection.days.map(day => day.date), ['2024-03-19', '2025-03-19', '2026-05-01', '2026-07-15']);
  assert.ok(projection.days.every(day => day.hours.length === 24 && day.hours.every(Number.isFinite)));
  assert.notDeepEqual(projection.days[0].hours, projection.days[1].hours,
    'dynamization follows the target day-of-year, including leap-year shifts');
  assert.equal(projection.days[2].dayType, 'weekend', 'Polish holidays use the FT/weekend shape');
  assert.notDeepEqual(projection.days[2].hours, projection.days[3].hours,
    'monthly seasonality remains in the source shape');

  const pump = buildReferenceProfileProjection(profile('opsd_20200415_de_kn_residential1_heat_pump'), ['2024-02-29', '2024-03-01']);
  assert.equal(pump.sourceYear, 2016);
  assert.ok(pump.notes.some(note => note.includes('znormalizowany kształt godzinowy')));
  assert.ok(pump.notes.some(note => note.includes('nie jest rzeczywistym pomiarem')));
  assert.ok(pump.days.every(day => day.hours.length === 24 && day.hours.every(value => value >= 0 && Number.isFinite(value))));

  const berlin = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  });
  const expectedGroups = Array.from({ length: 24 }, () => ({ total: 0, count: 0 }));
  for (const point of profile('opsd_20200415_de_kn_residential1_heat_pump').series) {
    const timestamp = String(point.timestamp);
    if (!timestamp.startsWith('2016-')) continue;
    const parts = Object.fromEntries(berlin.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]));
    const civilDate = `${parts.year}-${parts.month}-${parts.day}`;
    const weekday = new Date(`${civilDate}T12:00:00.000Z`).getUTCDay();
    if (Number(parts.month) !== 1 || weekday < 1 || weekday > 5) continue;
    const group = expectedGroups[Number(parts.hour)];
    group.total += Number(point.value);
    group.count += 1;
  }
  const weekdayProjection = buildReferenceProfileProjection(
    profile('opsd_20200415_de_kn_residential1_heat_pump'), ['2024-01-03'],
  ).days[0];
  for (let hour = 0; hour < 24; hour += 1) {
    assert.ok(expectedGroups[hour].count > 0);
    assert.ok(Math.abs(weekdayProjection.hours[hour] - expectedGroups[hour].total / expectedGroups[hour].count) < 1e-12,
      `hour ${hour} is grouped in Europe/Berlin civil time before projection`);
  }
});

test('polski kalendarz profili standardowych traktuje 30 kwietnia jako dzień roboczy', () => {
  const g25 = profile('bdew-2025-g25');
  const synthetic = {
    ...g25,
    series: g25.series.map((point) => ({
      ...point,
      value: point.dayType === 'WT' ? 3 : point.dayType === 'SA' ? 1 : 2,
    })),
  };
  const annualKwh = 1_000;
  const holidays = new Set([
    '2025-01-01', '2025-01-06', '2025-04-21', '2025-05-01', '2025-05-03',
    '2025-06-19', '2025-08-15', '2025-11-01', '2025-11-11', '2025-12-24',
    '2025-12-25', '2025-12-26',
  ]);
  let sourceAnnual = 0;
  for (let date = new Date('2025-01-01T12:00:00.000Z'); date.getUTCFullYear() === 2025; date.setUTCDate(date.getUTCDate() + 1)) {
    const dateKey = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay();
    const type = holidays.has(dateKey) || weekday === 0 ? 'FT' : weekday === 6 ? 'SA' : 'WT';
    sourceAnnual += (type === 'WT' ? 3 : type === 'SA' ? 1 : 2) * 96;
  }
  const result = compareReferenceProfiles([synthetic], { annualKwh, month: 4, dayType: 'workday' })[0];
  assert.ok(Math.abs(result.dailyAverageKwh[0] - 12 * annualKwh / sourceAnnual) < 1e-12);
  assert.ok(result.notes.some((note) => note.includes('30 kwietnia jest dniem roboczym')));
});

test('OPSD częściowy rok, When2Heat i nieznane metadane są wyłączone z jednoznacznym powodem', () => {
  const industrial3 = summarizeReferenceProfile(profile('opsd_20200415_de_kn_industrial3_grid_import'));
  assert.equal(industrial3.eligible, false);
  assert.match(industrial3.reason || '', /kompletnego roku UTC/);

  const thermal = summarizeReferenceProfile(profile('when2heat-20230727-pl_heat_profile_space_sfh-2022'));
  assert.equal(thermal.eligible, false);
  assert.match(thermal.reason || '', /ciepło.*nie zużycie energii elektrycznej/i);
  assert.match(thermal.reason || '', /2022-10-30T01:00:00Z/);

  const cop = summarizeReferenceProfile(profile('when2heat-20230727-pl_cop_ashp_floor-2022'));
  assert.equal(cop.eligible, false);
  assert.match(cop.reason || '', /COP.*nie zużyciem energii elektrycznej/i);
  assert.match(cop.reason || '', /2022-10-30T01:00:00Z/);

  const unknown = summarizeReferenceProfile({
    ...profile('bdew-2025-h25'),
    key: 'unknown-source-profile',
    sourceKey: 'unknown-source',
  });
  assert.equal(unknown.eligible, false);
  assert.match(unknown.reason || '', /nie jest obsługiwane/);

  const missingMetadata = summarizeReferenceProfile({
    ...profile('bdew-2025-h25'),
    metadata: null as unknown as Record<string, unknown>,
  });
  assert.equal(missingMetadata.eligible, false);
  assert.match(missingMetadata.reason || '', /Brakuje metadanych/);

  assert.throws(() => compareReferenceProfiles([profile('when2heat-20230727-pl_heat_profile_space_sfh-2022')], {
    annualKwh: 10_000,
    month: null,
    dayType: 'all',
  }), /zapotrzebowanie na ciepło/);
});

test('waliduje annualKwh, zakres miesiąca i liczbę wybranych profili', () => {
  assert.throws(() => compareReferenceProfiles([profile('bdew-2025-h25')], {
    annualKwh: 0,
    month: null,
    dayType: 'all',
  }), /dodatnią liczbą/);
  assert.throws(() => compareReferenceProfiles([profile('bdew-2025-h25')], {
    annualKwh: 10_000,
    month: 13,
    dayType: 'all',
  }), /Miesiąc/);
  assert.throws(() => compareReferenceProfiles([], { annualKwh: 10_000, month: null, dayType: 'all' }), /od 1 do 6/);
});
