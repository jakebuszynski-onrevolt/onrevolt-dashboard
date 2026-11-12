export type CatalogProfile = {
  key: string;
  sourceKey: string;
  name: string;
  category: string;
  kind: string;
  quantity: string;
  unit: string;
  timeBasis: string;
  resolutionMinutes: number;
  start: string | null;
  end: string | null;
  series: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  quality: Record<string, unknown>;
};

export type Summary = {
  key: string;
  name: string;
  sourceKey: string;
  category: string;
  kind: string;
  quantity: string;
  unit: string;
  eligible: boolean;
  reason: string | null;
  yearLabel: string;
  notes: string[];
};

export type Comparison = Summary & {
  monthlyKwh: number[];
  dailyAverageKwh: number[];
  totalKwh: number;
};

export type ReferenceProfileComparisonOptions = {
  annualKwh: number;
  month: number | null;
  dayType: 'all' | 'workday' | 'weekend';
};

export type ReferenceProfileCalculationEligibility = {
  eligible: boolean;
  reason: string | null;
  method: string;
};

export type ReferenceProfileDailyShape = {
  date: string;
  month: number;
  dayType: 'workday' | 'weekend';
  hours: number[];
};

export type ReferenceProfileProjection = {
  method: string;
  notes: string[];
  sourceYear: number | null;
  days: ReferenceProfileDailyShape[];
};

type DayTypeCode = 'SA' | 'FT' | 'WT';
type DayTypeLabel = 'Saturday' | 'Sunday' | 'Weekday';
type DailyProfile = { date: string; month: number; dayType: 'workday' | 'weekend'; hours: number[] };
type PreparedProfile = { summary: Summary; days: DailyProfile[]; year: number; notes: string[] };
type Eligibility = { summary: Summary; prepared: PreparedProfile | null };

const BDEW_SOURCE = 'bdew-standard-load-profiles-2025';
const VDEW_SOURCE = 'vdew-standard-load-profiles-1999-2000';
const OPSD_SOURCE = 'opsd_household_data_2020_04_15';
const OPSD_WHOLEHOUSE_KEY = 'opsd_20200415_de_kn_residential4_household_heat_pump';
const OPSD_WHOLEHOUSE_SOURCE_SHA256 = '15956440b27465686eae2abf5895cbc3dab80f934a891bcb2f4f944428e97d60';
const OPSD_WHOLEHOUSE_FORMULA = 'delta(grid_import) + delta(pv) - delta(grid_export) - delta(ev)';
const WHEN2HEAT_SOURCE = 'when2heat-20230727';
const COMPARISON_YEAR = 2025;
const BDEW_PROJECTION_METHOD = 'bdew-standard-profile';
const VDEW_PROJECTION_METHOD = 'vdew-standard-profile';
const OPSD_PUMP_PROJECTION_METHOD = 'opsd-normalized-pump-shape';
const OPSD_WHOLEHOUSE_PROJECTION_METHOD = 'opsd-whole-house-seasonal-pattern';
const DAY_MINUTES = 24 * 60;
const QUARTERS_PER_DAY = 96;
const DAY_MS = 24 * 60 * 60 * 1000;
const opsdCivilFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

const bdewNames: Record<string, string> = {
  'bdew-2025-h25': 'Gospodarstwo domowe — BDEW H25 (2025)',
  'bdew-2025-g25': 'Firma — BDEW G25 (2025)',
  'bdew-2025-l25': 'Gospodarstwo rolne — BDEW L25 (2025)',
  'bdew-2025-p25': 'Dom z fotowoltaiką — pobór z sieci, BDEW P25',
  'bdew-2025-s25': 'Dom z fotowoltaiką i magazynem — pobór z sieci, BDEW S25',
};

const vdewNames: Record<string, string> = {
  'vdew-1999-h0': 'Gospodarstwo domowe — VDEW H0 (1999/2000)',
  'vdew-1999-g0': 'Firma — ogólny profil VDEW G0',
  'vdew-1999-g1': 'Firma — praca w dni robocze 8:00–18:00, VDEW G1',
  'vdew-1999-g2': 'Firma — przewaga zużycia wieczorem, VDEW G2',
  'vdew-1999-g3': 'Firma — praca ciągła, VDEW G3',
  'vdew-1999-g4': 'Sklep lub fryzjer, VDEW G4',
  'vdew-1999-g5': 'Piekarnia z piecem, VDEW G5',
  'vdew-1999-g6': 'Firma czynna w weekendy, VDEW G6',
  'vdew-1999-l0': 'Gospodarstwo rolne — VDEW L0',
  'vdew-1999-l1': 'Gospodarstwo mleczne lub hodowlane — VDEW L1',
  'vdew-1999-l2': 'Pozostałe gospodarstwa rolne — VDEW L2',
};

const opsdNames: Record<string, string> = {
  opsd_20200415_de_kn_residential1_grid_import: 'Dom 1 — pobór z sieci (OPSD)',
  opsd_20200415_de_kn_residential1_heat_pump: 'Sama pompa ciepła — dom 1 (OPSD)',
  opsd_20200415_de_kn_residential4_grid_import: 'Dom 4 — pobór z sieci (OPSD)',
  opsd_20200415_de_kn_residential4_heat_pump: 'Sama pompa ciepła — dom 4 (OPSD)',
  [OPSD_WHOLEHOUSE_KEY]: 'Dom z pompą ciepła — bez ładowania auta (OPSD 4)',
  opsd_20200415_de_kn_industrial1_grid_import: 'Magazyn przemysłowy — pobór z sieci (OPSD)',
  opsd_20200415_de_kn_industrial3_grid_import: 'Instytut badawczy — pobór z sieci (OPSD)',
};

const when2heatNames: Record<string, string> = {
  'when2heat-20230727-pl_heat_profile_space_sfh-2022': 'Ciepło — dom jednorodzinny, ogrzewanie pomieszczeń (PL)',
  'when2heat-20230727-pl_heat_profile_space_mfh-2022': 'Ciepło — budynek wielorodzinny, ogrzewanie pomieszczeń (PL)',
  'when2heat-20230727-pl_heat_profile_space_com-2022': 'Ciepło — budynek komercyjny, ogrzewanie pomieszczeń (PL)',
  'when2heat-20230727-pl_heat_profile_water_sfh-2022': 'Ciepło — dom jednorodzinny, ciepła woda (PL)',
  'when2heat-20230727-pl_heat_profile_water_mfh-2022': 'Ciepło — budynek wielorodzinny, ciepła woda (PL)',
  'when2heat-20230727-pl_heat_profile_water_com-2022': 'Ciepło — budynek komercyjny, ciepła woda (PL)',
  'when2heat-20230727-pl_cop_ashp_floor-2022': 'COP — powietrzna pompa ciepła, ogrzewanie podłogowe (PL)',
  'when2heat-20230727-pl_cop_ashp_radiator-2022': 'COP — powietrzna pompa ciepła, grzejniki (PL)',
  'when2heat-20230727-pl_cop_ashp_water-2022': 'COP — powietrzna pompa ciepła, ciepła woda (PL)',
  'when2heat-20230727-pl_cop_gshp_floor-2022': 'COP — gruntowa pompa ciepła, ogrzewanie podłogowe (PL)',
  'when2heat-20230727-pl_cop_gshp_radiator-2022': 'COP — gruntowa pompa ciepła, grzejniki (PL)',
  'when2heat-20230727-pl_cop_gshp_water-2022': 'COP — gruntowa pompa ciepła, ciepła woda (PL)',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' ? record[key] as string : null;
}

function isValidProfileShape(value: unknown): value is CatalogProfile {
  if (!isRecord(value)) return false;
  return ['key', 'sourceKey', 'name', 'category', 'kind', 'quantity', 'unit', 'timeBasis']
    .every((key) => typeof value[key] === 'string')
    && isFiniteNumber(value.resolutionMinutes)
    && (value.start === null || typeof value.start === 'string')
    && (value.end === null || typeof value.end === 'string')
    && Array.isArray(value.series)
    && value.series.every(isRecord)
    && isRecord(value.metadata)
    && isRecord(value.quality);
}

function polishDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function dateWithOffset(date: Date, days: number) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function polishHolidays(year: number) {
  const fixed = new Set([
    `${year}-01-01`, `${year}-01-06`, `${year}-05-01`, `${year}-05-03`, `${year}-08-15`,
    `${year}-11-01`, `${year}-11-11`, `${year}-12-25`, `${year}-12-26`,
  ]);
  if (year >= 2025) fixed.add(`${year}-12-24`);
  const easter = easterSunday(year);
  fixed.add(dateWithOffset(easter, 1));
  fixed.add(dateWithOffset(easter, 60));
  return fixed;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function dynamicizationFactor(dayOfYear: number) {
  const factor = -3.92e-10 * dayOfYear ** 4 + 3.2e-7 * dayOfYear ** 3
    - 7.02e-5 * dayOfYear ** 2 + 2.1e-3 * dayOfYear + 1.24;
  return Math.round((factor + Number.EPSILON) * 10_000) / 10_000;
}

function datesOfYear(year: number) {
  const dates: Array<{ date: string; month: number; dayOfYear: number }> = [];
  const date = new Date(Date.UTC(year, 0, 1, 12));
  const days = isLeapYear(year) ? 366 : 365;
  for (let index = 0; index < days; index += 1) {
    dates.push({ date: date.toISOString().slice(0, 10), month: date.getUTCMonth() + 1, dayOfYear: index + 1 });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return dates;
}

function bdewDayType(date: string, year: number): DayTypeCode {
  if (polishHolidays(year).has(date)) return 'FT';
  const day = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  if (day === 0) return 'FT';
  if (day === 6) return 'SA';
  return 'WT';
}

function vdewDayType(date: string, year: number): DayTypeLabel {
  if (polishHolidays(year).has(date)) return 'Sunday';
  const day = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  if (day === 0) return 'Sunday';
  if (day === 6) return 'Saturday';
  return 'Weekday';
}

function minutesOfDay(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function isCompleteQuality(quality: Record<string, unknown>, expected: number) {
  return quality.complete === true
    && quality.numeric === true
    && quality.calendarExpanded === false
    && quality.expectedPoints === expected
    && quality.actualPoints === expected;
}

function bdewSheet(profile: CatalogProfile) {
  const sheet = getString(profile.metadata, 'sourceSheet');
  if (!sheet || !['H25', 'G25', 'L25', 'P25', 'S25'].includes(sheet)) return null;
  return sheet;
}

function validateBdew(profile: CatalogProfile): string | null {
  const sheet = bdewSheet(profile);
  const requiredDynamicization = sheet === 'H25' || sheet === 'P25' || sheet === 'S25';
  const requiredSot = sheet === 'P25' || sheet === 'S25';
  if (profile.kind !== 'STANDARD_PATTERN' || profile.resolutionMinutes !== 15
    || profile.timeBasis !== 'TYPICAL_DAY' || profile.unit !== 'kWh'
    || profile.quantity !== (requiredSot ? (sheet === 'P25' ? 'grid_import_with_pv' : 'grid_import_with_pv_storage') : 'relative_load')) {
    return 'Metadane profilu BDEW nie pasują do zweryfikowanego wzorca energii kwartalnej.';
  }
  if (profile.metadata.country !== 'DE' || profile.metadata.annualNormalization !== '1,000,000 kWh'
    || profile.metadata.slotSemantics !== 'interval_start'
    || profile.metadata.dynamicizationRequired !== requiredDynamicization
    || profile.metadata.sotSynchronizationRequired !== requiredSot
    || profile.metadata.sourceUnit !== '[kWh]'
    || !isCompleteQuality(profile.quality, 3456)
    || profile.series.length !== 3456) {
    return 'Brakuje potwierdzonych metadanych jakości, dynamizacji lub jednostki profilu BDEW.';
  }
  if (profile.key !== `bdew-2025-${sheet.toLowerCase()}` || !bdewNames[profile.key]) {
    return 'Nieobsługiwany kod arkusza BDEW.';
  }
  const seen = new Set<string>();
  for (const point of profile.series) {
    const month = point.month;
    const type = point.dayType;
    const slot = minutesOfDay(point.slot);
    const slotEnd = minutesOfDay(point.slotEnd);
    const value = point.value;
    if (!Number.isInteger(month) || Number(month) < 1 || Number(month) > 12
      || !['SA', 'FT', 'WT'].includes(String(type)) || slot === null || slotEnd === null
      || slot % 15 !== 0 || slotEnd !== (slot + 15) % DAY_MINUTES
      || !isFiniteNumber(value) || value < 0) {
      return 'Seria BDEW zawiera nieprawidłowy lub niekompletny punkt kwartalny.';
    }
    const key = `${month}/${type}/${slot}`;
    if (seen.has(key)) return 'Seria BDEW zawiera powtórzone kwadranse.';
    seen.add(key);
  }
  for (let month = 1; month <= 12; month += 1) {
    for (const type of ['SA', 'FT', 'WT']) {
      for (let slot = 0; slot < DAY_MINUTES; slot += 15) {
        if (!seen.has(`${month}/${type}/${slot}`)) return 'Seria BDEW nie zawiera wszystkich miesięcy, typów dni i kwadransów.';
      }
    }
  }
  return null;
}

function legacyCode(profile: CatalogProfile) {
  const code = getString(profile.metadata, 'sourceSheet');
  if (!code || !vdewNames[`vdew-1999-${code.toLowerCase()}`]) return null;
  return code;
}

function validateVdew(profile: CatalogProfile): string | null {
  const code = legacyCode(profile);
  if (profile.kind !== 'STANDARD_PATTERN' || profile.resolutionMinutes !== 15
    || profile.timeBasis !== 'TYPICAL_DAY' || profile.quantity !== 'load' || profile.unit !== 'W') {
    return 'Metadane profilu VDEW nie pasują do wzorca mocy kwartalnej.';
  }
  if (!code || profile.key !== `vdew-1999-${code.toLowerCase()}`
    || profile.metadata.country !== 'DE' || profile.metadata.annualNormalizationKwh !== 1000
    || profile.metadata.slotSemantics !== 'interval_end'
    || !isCompleteQuality(profile.quality, 864) || profile.series.length !== 864) {
    return 'Brakuje potwierdzonych metadanych jakości lub zasad etykiet czasu profilu VDEW.';
  }
  const seen = new Set<string>();
  for (const point of profile.series) {
    const season = point.season;
    const type = point.dayType;
    const slot = minutesOfDay(point.slot);
    const offset = point.dayOffset;
    const value = point.value;
    if (!['winter', 'summer', 'transition'].includes(String(season))
      || !['Saturday', 'Sunday', 'Weekday'].includes(String(type))
      || slot === null || slot % 15 !== 0
      || !Number.isInteger(offset) || ![0, 1].includes(Number(offset))
      || !isFiniteNumber(value) || value < 0) {
      return 'Seria VDEW zawiera nieprawidłowy lub niekompletny punkt kwartalny.';
    }
    const endMinute = slot + Number(offset) * DAY_MINUTES;
    const startMinute = endMinute - 15;
    if (Math.floor(endMinute / DAY_MINUTES) !== Number(offset) || startMinute < 0 || startMinute >= DAY_MINUTES) {
      return 'Etykieta końca przedziału w profilu VDEW ma nieprawidłowe dayOffset.';
    }
    const key = `${season}/${type}/${startMinute}`;
    if (seen.has(key)) return 'Seria VDEW zawiera powtórzone kwadranse.';
    seen.add(key);
  }
  for (const season of ['winter', 'summer', 'transition']) {
    for (const type of ['Saturday', 'Sunday', 'Weekday']) {
      for (let slot = 0; slot < DAY_MINUTES; slot += 15) {
        if (!seen.has(`${season}/${type}/${slot}`)) return 'Seria VDEW nie zawiera wszystkich sezonów, typów dni i kwadransów.';
      }
    }
  }
  return null;
}

function parseOpsdTimestamp(value: unknown): { year: number; month: number; date: string; hour: number; epoch: number } | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00:00Z$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== `${value.slice(0, -1)}.000Z`) return null;
  return { year, month, date: value.slice(0, 10), hour, epoch };
}

function completeOpsdYear(profile: CatalogProfile): { year: number; points: Array<{ date: string; month: number; hour: number; value: number }> } | null {
  const years = new Set<number>();
  for (const point of profile.series) {
    const stamp = parseOpsdTimestamp(point.timestamp);
    if (stamp) years.add(stamp.year);
  }
  const candidates = Array.from(years).sort((left, right) => right - left);
  for (const year of candidates) {
    const rows = new Map<number, { date: string; month: number; hour: number; value: number }>();
    let invalid = false;
    for (const point of profile.series) {
      const stamp = parseOpsdTimestamp(point.timestamp);
      if (!stamp || stamp.year !== year) continue;
      if (!isFiniteNumber(point.value) || point.value < 0 || rows.has(stamp.epoch)) {
        invalid = true;
        break;
      }
      rows.set(stamp.epoch, { date: stamp.date, month: stamp.month, hour: stamp.hour, value: point.value });
    }
    const expected = (isLeapYear(year) ? 366 : 365) * 24;
    if (invalid || rows.size !== expected) continue;
    const start = Date.UTC(year, 0, 1);
    const points: Array<{ date: string; month: number; hour: number; value: number }> = [];
    for (let index = 0; index < expected; index += 1) {
      const row = rows.get(start + index * 3_600_000);
      if (!row) {
        invalid = true;
        break;
      }
      points.push(row);
    }
    if (!invalid) return { year, points };
  }
  return null;
}

function opsdMetadataReason(profile: CatalogProfile): string | null {
  if (!['MEASURED', 'MEASURED_WITH_SOURCE_IMPUTATION'].includes(profile.kind)
    || profile.resolutionMinutes !== 60 || profile.timeBasis !== 'UTC_HOURLY_BUCKET'
    || profile.unit !== 'kWh' || !['energy_import', 'device_energy_consumption'].includes(profile.quantity)) {
    return 'Profil OPSD nie ma zweryfikowanego rodzaju pomiaru energii elektrycznej.';
  }
  if (profile.metadata.country !== 'DE' || profile.metadata.reviewStatus !== 'CANDIDATE'
    || typeof profile.metadata.geography !== 'string'
    || typeof profile.metadata.intervalSemantics !== 'string'
    || typeof profile.metadata.derivation !== 'string'
    || typeof profile.metadata.processingSourceSha256 !== 'string'
    || !isFiniteNumber(profile.quality.numericRows)
    || !isFiniteNumber(profile.quality.nullRows)) {
    return 'Brakuje potwierdzonych metadanych pochodzenia lub jakości pomiaru OPSD.';
  }
  return null;
}

function opsdWholeHousePatternReason(profile: CatalogProfile): string | null {
  if (profile.key !== OPSD_WHOLEHOUSE_KEY || profile.sourceKey !== OPSD_SOURCE
    || profile.name !== 'Dom z pompą ciepła — bez ładowania auta (OPSD 4)'
    || profile.category !== 'household_whole_house' || profile.kind !== 'DERIVED_SEASONAL_PATTERN'
    || profile.quantity !== 'whole_building_energy_consumption' || profile.unit !== 'kWh'
    || profile.timeBasis !== 'EUROPE_BERLIN_MONTH_DAYTYPE_HOUR' || profile.resolutionMinutes !== 60
    || profile.start !== null || profile.end !== null) {
    return 'Metadane podstawowe nie pasują do zweryfikowanego profilu pełnego zużycia gospodarstwa OPSD 4.';
  }
  const metadata = profile.metadata;
  const expectedColumns = [
    'DE_KN_residential4_grid_import',
    'DE_KN_residential4_pv',
    'DE_KN_residential4_grid_export',
    'DE_KN_residential4_ev',
  ];
  if (metadata.reviewStatus !== 'CANDIDATE' || metadata.country !== 'DE'
    || metadata.geography !== 'Jedno gospodarstwo domowe OPSD 4 w południowych Niemczech; lokalizacja uogólniona przez dostawcę.'
    || metadata.sourceUrl !== 'https://data.open-power-system-data.org/household_data/2020-04-15/'
    || metadata.sourceKey !== OPSD_SOURCE || metadata.sourceYear !== 2016
    || metadata.sourceSha256 !== OPSD_WHOLEHOUSE_SOURCE_SHA256
    || !Array.isArray(metadata.sourceColumnSet) || JSON.stringify(metadata.sourceColumnSet) !== JSON.stringify(expectedColumns)
    || metadata.sourceTimestampBasis !== 'OPSD uses left-labeled hourly buckets; the current-minus-previous counter delta is assigned to the current row label, with an approximately one-minute offset inherent in the last observation within that hour'
    || metadata.civilTimeBasis !== 'Europe/Berlin from cet_cest_timestamp'
    || metadata.derivation !== OPSD_WHOLEHOUSE_FORMULA
    || metadata.wholeHouseBoundaryInference !== 'grid import plus onsite PV minus grid export approximates building load; EV charging is subtracted to represent household load without the car. This is an inferred boundary, not a direct whole-building meter.'
    || metadata.heatPumpTreatment !== 'The heat pump is already included in whole-house electricity and is not added again.'
    || metadata.evTreatment !== 'EV counter delta is subtracted from the inferred building load.'
    || metadata.aggregation !== 'Arithmetic mean by current Berlin civil month, workday/weekend, and hour label; no holiday adjustment.'
    || metadata.interpolatedPolicy !== 'Skip an interval if any used counter is marked interpolated on either its start or end counter row; source flags are pipe-separated column names.'
    || metadata.negativeBalancePolicy !== 'Retain negative raw hourly balance values in group means and diagnostics; apply no clipping.'
    || metadata.confidence !== 'LOW: empirical pattern from one household in one source year; not guaranteed representative of other households.'
    || metadata.processingScript !== 'scripts/profile-catalog/opsd-household-balance.py') {
    return 'Brakuje potwierdzonego źródła, wzoru bilansu, wyłączenia interpolacji lub granicy wnioskowania OPSD 4.';
  }

  const quality = profile.quality;
  if (quality.sourceSha256 !== OPSD_WHOLEHOUSE_SOURCE_SHA256 || quality.sourceYear !== 2016
    || quality.sourceIntervalsInBerlinYear !== 8784
    || !isFiniteNumber(quality.usedIntervals) || !Number.isInteger(quality.usedIntervals) || quality.usedIntervals <= 0
    || !isFiniteNumber(quality.interpolatedIntervalsExcluded) || !Number.isInteger(quality.interpolatedIntervalsExcluded)
    || quality.usedIntervals + quality.interpolatedIntervalsExcluded !== quality.sourceIntervalsInBerlinYear
    || quality.groupCount !== 576
    || quality.allGroupMeansPositive !== true || quality.negativeValuesClipped !== false || quality.gapsFilled !== false
    || !isFiniteNumber(quality.rawNegativeHours) || !Number.isInteger(quality.rawNegativeHours) || quality.rawNegativeHours < 0
    || !isFiniteNumber(quality.rawNegativeEnergyKwh)
    || !Array.isArray(quality.negativeHourlyLoadDiagnostics)
    || quality.negativeHourlyLoadDiagnostics.length !== quality.rawNegativeHours
    || profile.series.length !== 576) {
    return 'Wskaźniki jakości lub liczba danych OPSD 4 nie zgadzają się ze zweryfikowanym rokiem źródłowym.';
  }

  const seen = new Set<string>();
  const sampleCounts: number[] = [];
  const values: number[] = [];
  for (const point of profile.series) {
    if (!isRecord(point) || JSON.stringify(Object.keys(point).sort())
      !== JSON.stringify(['dayType', 'hour', 'month', 'samples', 'slot', 'value'])) {
      return 'Punkt profilu OPSD 4 ma nieprawidłową strukturę.';
    }
    const { month, dayType, hour, slot, value, samples } = point;
    if (!Number.isInteger(month) || Number(month) < 1 || Number(month) > 12
      || !['workday', 'weekend'].includes(String(dayType))
      || !Number.isInteger(hour) || Number(hour) < 0 || Number(hour) > 23
      || slot !== hour || !isFiniteNumber(value) || value <= 0
      || !Number.isInteger(samples) || Number(samples) < 1) {
      return 'Punkt profilu OPSD 4 ma nieprawidłowy miesiąc, typ dnia, godzinę, średnią lub liczbę próbek.';
    }
    const coordinate = `${month}/${dayType}/${hour}`;
    if (seen.has(coordinate)) return 'Seria OPSD 4 zawiera powtórzony miesiąc, typ dnia i godzinę.';
    seen.add(coordinate);
    sampleCounts.push(Number(samples));
    values.push(value);
  }
  for (let month = 1; month <= 12; month += 1) {
    for (const dayType of ['workday', 'weekend']) {
      for (let hour = 0; hour < 24; hour += 1) {
        if (!seen.has(`${month}/${dayType}/${hour}`)) return 'Seria OPSD 4 nie zawiera wszystkich 576 grup.';
      }
    }
  }
  const minSamples = Math.min(...sampleCounts);
  const maxSamples = Math.max(...sampleCounts);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  if (quality.minimumSamplesPerGroup !== minSamples || quality.maximumSamplesPerGroup !== maxSamples
    || sampleCounts.reduce((sum, count) => sum + count, 0) !== quality.usedIntervals
    || !isFiniteNumber(quality.minimumGroupMeanKwh) || Math.abs(quality.minimumGroupMeanKwh - minValue) > 1e-12
    || !isFiniteNumber(quality.maximumGroupMeanKwh) || Math.abs(quality.maximumGroupMeanKwh - maxValue) > 1e-12) {
    return 'Podsumowania jakości OPSD 4 nie zgadzają się z wartościami 576 grup.';
  }

  const negativeRows = new Set<string>();
  let negativeSum = 0;
  for (const raw of quality.negativeHourlyLoadDiagnostics) {
    if (!isRecord(raw) || typeof raw.timestampUtc !== 'string' || !isFiniteNumber(raw.loadKwh) || raw.loadKwh >= 0
      || !Number.isInteger(raw.monthBerlin) || !Number.isInteger(raw.hourBerlin)
      || !['workday', 'weekend'].includes(String(raw.dayTypeBerlin))) {
      return 'Diagnostyka ujemnych godzin OPSD 4 jest nieprawidłowa.';
    }
    const stamp = parseOpsdTimestamp(raw.timestampUtc);
    if (!stamp || negativeRows.has(raw.timestampUtc)) {
      return 'Diagnostyka ujemnych godzin OPSD 4 nie zgadza się z rokiem lub zawiera powtórzenia.';
    }
    const berlinParts = Object.fromEntries(opsdCivilFormatter.formatToParts(new Date(stamp.epoch)).map(({ type, value }) => [type, value]));
    const berlinDate = `${berlinParts.year}-${berlinParts.month}-${berlinParts.day}`;
    const berlinWeekday = new Date(`${berlinDate}T12:00:00.000Z`).getUTCDay();
    const berlinDayType = berlinWeekday === 0 || berlinWeekday === 6 ? 'weekend' : 'workday';
    if (Number(berlinParts.year) !== 2016 || Number(berlinParts.month) !== raw.monthBerlin || Number(berlinParts.hour) !== raw.hourBerlin
      || berlinDayType !== raw.dayTypeBerlin) {
      return 'Diagnostyka ujemnych godzin OPSD 4 nie zgadza się z czasem cywilnym Europe/Berlin.';
    }
    negativeRows.add(raw.timestampUtc);
    negativeSum += raw.loadKwh;
  }
  if (Math.abs(negativeSum - quality.rawNegativeEnergyKwh) > 1e-9) {
    return 'Suma ujemnych godzin OPSD 4 nie zgadza się z diagnostyką jakości.';
  }
  if ((quality.rawNegativeHours === 0 && Math.abs(quality.rawNegativeEnergyKwh) > 1e-12)
    || (quality.rawNegativeHours > 0 && quality.rawNegativeEnergyKwh >= 0)) {
    return 'Suma ujemnych godzin OPSD 4 ma nieprawidłowy znak.';
  }
  return null;
}

function opsdWholeHouseDayType(date: string): 'workday' | 'weekend' {
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return weekday === 0 || weekday === 6 ? 'weekend' : 'workday';
}

function opsdWholeHousePattern(profile: CatalogProfile) {
  const pattern = new Map<string, number>();
  for (const point of profile.series) {
    pattern.set(`${point.month}/${point.dayType}/${point.hour}`, Number(point.value));
  }
  return pattern;
}

function opsdWholeHouseNotes(profile: CatalogProfile): string[] {
  const quality = profile.quality;
  return [
    `Źródło: Open Power System Data Household Data, gospodarstwo domowe 4. Oś bieżących etykiet obejmuje 2016 r. czasu Europe/Berlin; użyto ${quality.usedIntervals} z ${quality.sourceIntervalsInBerlinYear} przedziałów, a ${quality.interpolatedIntervalsExcluded} pominięto z powodu flag interpolacji.`,
    'Bilans obciążenia budynku: różnica poboru z sieci + różnica PV − różnica eksportu z sieci − różnica licznika EV. EV odjęto, aby nie przypisywać ładowania auta do zużycia domu; pompy ciepła nie dodawano ponownie, bo jej pobór jest już w bilansie budynku.',
    'Zgodnie z plikiem przetwarzania OPSD godzina bieżącej etykiety opisuje bieżący koszyk; różnica liczników bazuje na ostatnich obserwacjach wewnątrz koszyka i ma około jednominutowe przesunięcie względem granicy. To wnioskowana granica całego budynku, a nie bezpośredni pomiar licznikiem całego domu.',
    'Przedział pominięto, jeśli którykolwiek użyty licznik był oznaczony jako interpolowany w bieżącym lub poprzednim wierszu. Braków nie uzupełniano.',
    `Zachowano ${quality.rawNegativeHours} ujemnych surowych godzin (suma ${Number(quality.rawNegativeEnergyKwh).toFixed(3)} kWh) w średnich grup i diagnostyce; nie przycinano wartości. Wszystkie 576 średnich grup są dodatnie, ale najmniejsza grupa ma tylko ${quality.minimumSamplesPerGroup} próbkę.`,
    'Niska pewność: empiryczny kształt pochodzi z jednego gospodarstwa i jednego roku, więc nie gwarantuje reprezentatywności innych domów.',
    'Kształt odwzorowano bezpośrednio na miesiąc, dzień roboczy/weekend i godzinę. Sobota i niedziela są weekendem; nie stosuje się polskich ani niemieckich świąt.',
  ];
}

function validateOpsdWholeHouseAndMake(profile: CatalogProfile): Eligibility {
  const reason = opsdWholeHousePatternReason(profile);
  const notes = reason ? [] : opsdWholeHouseNotes(profile);
  const yearLabel = 'Kształt empiryczny 2016 (Berlin)';
  if (reason) return { summary: makeSummary(profile, false, reason, yearLabel, notes), prepared: null };

  const pattern = opsdWholeHousePattern(profile);
  const days = datesOfYear(COMPARISON_YEAR).map(({ date, month }) => {
    const dayType = opsdWholeHouseDayType(date);
    const hours = Array.from({ length: 24 }, (_, hour) => {
      const value = pattern.get(`${month}/${dayType}/${hour}`);
      if (value === undefined || !Number.isFinite(value) || value <= 0) {
        throw new Error(`Brak dodatniej grupy OPSD 4 dla ${date}, godziny ${hour}.`);
      }
      return value;
    });
    return { date, month, dayType, hours };
  });
  const summary = makeSummary(profile, true, null, yearLabel, notes);
  const prepared: PreparedProfile = { summary, days, year: COMPARISON_YEAR, notes };
  return { summary, prepared };
}

function bdewNotes(profile: CatalogProfile) {
  const sheet = bdewSheet(profile)!;
  const notes = [
    'Źródło: BDEW, Niemcy; standardowy profil na 2025 r., opublikowany w kWh na kwadrans i znormalizowany źródłowo do 1 000 000 kWh/rok.',
    'Daty typowe odwzorowano na polski kalendarz 2025: święta ustawowe przypadają do typu niedziela/święto; soboty pozostają osobnym typem. W filtrze workday/weekend soboty, niedziele i święta należą do weekendu; 30 kwietnia jest dniem roboczym.',
  ];
  if (profile.metadata.dynamicizationRequired === true) {
    notes.push('Zastosowano opublikowaną funkcję dynamizacji BDEW dla H25/P25/S25: wielomian zależny od dnia roku, współczynnik zaokrąglony do 4 miejsc, wynik kwadransa do 3 miejsc.');
  } else {
    notes.push(`Arkusz ${sheet} nie jest dynamizowany; przewodnik BDEW wyraźnie zabrania stosowania funkcji do G25 i L25.`);
  }
  if (profile.metadata.sotSynchronizationRequired === true) {
    notes.push('P25/S25 pokazują pobór z sieci, nie całe zużycie domu; bilans PV i autokonsumpcję należy uwzględnić osobno po stronie SOT.');
  }
  return notes;
}

function vdewNotes(profile: CatalogProfile) {
  const notes = [
    'Źródło: VDEW/BDEW, Niemcy, profile z lat 1999/2000; wzorzec ma trzy sezony i trzy typy dni.',
    'Wartości źródłowe są mocą w W. Każdy kwadrans przeliczono na energię: W × 0,25 h ÷ 1000; końcowe etykiety i dayOffset przypisano do poprzedzającego przedziału.',
    'Wzorzec odwzorowano na polski kalendarz 2025 i po rozwinięciu znormalizowano do rocznego zużycia podanego dla porównania. W filtrze workday/weekend soboty, niedziele i święta należą do weekendu; 30 kwietnia jest dniem roboczym.',
  ];
  if (profile.key === 'vdew-1999-h0') {
    notes.push('Zastosowano dynamizację H0 z oficjalnego przewodnika VDEW 2000: współczynnik zależy od numeru dnia, jest zaokrąglany do 4 miejsc, a wynik mocy do 0,1 W.');
  } else {
    notes.push('Profile VDEW G/L nie są dynamizowane; oficjalna funkcja dynamizacji dotyczy profilu H0.');
  }
  return notes;
}

function opsdNotes(profile: CatalogProfile, year: number | null) {
  const notes = [
    'Źródło: pomiary OPSD z południowych Niemiec; godzina UTC jest etykietą bieżącego koszyka. Wartość to różnica ostatnich odczytów liczników z bieżącego i poprzedniego koszyka, przypisana do bieżącej etykiety; nie jest to pomiar dokładnie na granicy godziny.',
    'Filtr workday/weekend dla OPSD odczytuje soboty i niedziele według UTC; nie przypisuje polskich świąt, bo pomiary są z Niemiec i nie mają polskiego kalendarza lokalnego.',
  ];
  if (profile.quantity === 'energy_import') {
    notes.push('To pobór z sieci, a nie całe zużycie obiektu; autokonsumpcja poza siecią nie jest doliczona.');
  } else {
    notes.push('To zużycie elektryczne pompy ciepła, a nie całe zużycie gospodarstwa.');
  }
  const imputed = profile.quality.intervalsAffectedBySourceInterpolation;
  if (isFiniteNumber(imputed) && imputed > 0) {
    notes.push(`Katalog źródłowy oznacza ${imputed} godzin w całym dostępnym zakresie jako objęte interpolacją wydawcy; nie uzupełniano brakujących wartości.`);
  }
  if (year !== null) notes.push(`Do porównania wybrano najnowszy kompletny rok UTC: ${year}; nie przesuwano godzin ani nie wypełniano braków.`);
  return notes;
}

function when2heatNotes(profile: CatalogProfile) {
  const notes = [
    'Źródło: When2Heat 2023-07-27, Polska; model krajowy na 2022 r., nie pomiar konkretnego obiektu.',
  ];
  if (profile.quantity === 'normalized_thermal_power') {
    notes.push('Szereg opisuje zapotrzebowanie na ciepło w MW/TWh, nie energię elektryczną.');
  } else if (profile.quantity === 'coefficient_of_performance') {
    notes.push('Szereg COP opisuje współczynnik sprawności pompy ciepła, nie zużycie energii elektrycznej.');
  }
  return notes;
}

function friendlyName(profile: CatalogProfile) {
  return bdewNames[profile.key] || vdewNames[profile.key] || opsdNames[profile.key]
    || when2heatNames[profile.key] || profile.name;
}

function makeSummary(profile: CatalogProfile, eligible: boolean, reason: string | null, yearLabel: string, notes: string[]): Summary {
  return {
    key: profile.key,
    name: friendlyName(profile),
    sourceKey: profile.sourceKey,
    category: profile.category,
    kind: profile.kind,
    quantity: profile.quantity,
    unit: profile.unit,
    eligible,
    reason,
    yearLabel,
    notes,
  };
}

function seasonFor(month: number, day: number): 'winter' | 'summer' | 'transition' {
  if (month >= 11 || month <= 2 || (month === 3 && day <= 20)) return 'winter';
  if ((month === 5 && day >= 15) || (month >= 6 && month <= 8) || (month === 9 && day <= 14)) return 'summer';
  return 'transition';
}

function validateBdewAndMake(profile: CatalogProfile): Eligibility {
  const error = validateBdew(profile);
  const notes = bdewNotes(profile);
  const yearLabel = 'Kalendarz PL 2025';
  if (error) return { summary: makeSummary(profile, false, error, yearLabel, notes), prepared: null };

  const index = new Map<string, number>();
  for (const point of profile.series) {
    const key = `${point.month}/${point.dayType}/${minutesOfDay(point.slot)}`;
    index.set(key, Number(point.value));
  }
  const days: DailyProfile[] = [];
  const holidays = polishHolidays(COMPARISON_YEAR);
  for (const { date, month, dayOfYear } of datesOfYear(COMPARISON_YEAR)) {
    const type = bdewDayType(date, COMPARISON_YEAR);
    const factor = profile.metadata.dynamicizationRequired === true ? dynamicizationFactor(dayOfYear) : 1;
    const quarters = Array.from({ length: QUARTERS_PER_DAY }, (_, slot) => {
      const raw = index.get(`${month}/${type}/${slot * 15}`);
      if (raw === undefined) throw new Error(`Brakujący kwadrans ${profile.key} ${date} ${slot}`);
      return profile.metadata.dynamicizationRequired === true
        ? Math.round((raw * factor + Number.EPSILON) * 1000) / 1000
        : raw;
    });
    const hours = Array.from({ length: 24 }, (_, hour) => quarters.slice(hour * 4, hour * 4 + 4).reduce((sum, value) => sum + value, 0));
    days.push({ date, month, dayType: holidays.has(date) || [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) ? 'weekend' : 'workday', hours });
  }
  const prepared: PreparedProfile = { summary: makeSummary(profile, true, null, yearLabel, notes), days, year: COMPARISON_YEAR, notes };
  return { summary: prepared.summary, prepared };
}

function validateVdewAndMake(profile: CatalogProfile): Eligibility {
  const error = validateVdew(profile);
  const notes = vdewNotes(profile);
  const yearLabel = 'Kalendarz PL 2025';
  if (error) return { summary: makeSummary(profile, false, error, yearLabel, notes), prepared: null };

  const index = new Map<string, number>();
  for (const point of profile.series) {
    const endMinute = Number(minutesOfDay(point.slot)) + Number(point.dayOffset) * DAY_MINUTES;
    const startMinute = endMinute - 15;
    index.set(`${point.season}/${point.dayType}/${startMinute}`, Number(point.value));
  }
  const holidays = polishHolidays(COMPARISON_YEAR);
  const days: DailyProfile[] = [];
  for (const { date, month, dayOfYear } of datesOfYear(COMPARISON_YEAR)) {
    const calendarDate = new Date(`${date}T12:00:00.000Z`);
    const season = seasonFor(month, calendarDate.getUTCDate());
    const type = vdewDayType(date, COMPARISON_YEAR);
    const quarters = Array.from({ length: QUARTERS_PER_DAY }, (_, slot) => {
      const watts = index.get(`${season}/${type}/${slot * 15}`);
      if (watts === undefined) throw new Error(`Brakujący kwadrans ${profile.key} ${date} ${slot}`);
      const dailyPower = profile.key === 'vdew-1999-h0'
        ? Math.round((watts * dynamicizationFactor(dayOfYear) + Number.EPSILON) * 10) / 10
        : watts;
      return dailyPower * 0.25 / 1000;
    });
    const hours = Array.from({ length: 24 }, (_, hour) => quarters.slice(hour * 4, hour * 4 + 4).reduce((sum, value) => sum + value, 0));
    days.push({ date, month, dayType: holidays.has(date) || [0, 6].includes(calendarDate.getUTCDay()) ? 'weekend' : 'workday', hours });
  }
  const prepared: PreparedProfile = { summary: makeSummary(profile, true, null, yearLabel, notes), days, year: COMPARISON_YEAR, notes };
  return { summary: prepared.summary, prepared };
}

function validateOpsdAndMake(profile: CatalogProfile): Eligibility {
  const metadataError = opsdMetadataReason(profile);
  const complete = metadataError ? null : completeOpsdYear(profile);
  const notes = opsdNotes(profile, complete?.year ?? null);
  const yearLabel = complete ? `Pomiary ${complete.year} (UTC)` : 'Brak pełnego roku UTC';
  let reason = metadataError;
  if (!reason && !complete) reason = 'Brak kompletnego roku UTC z 8760/8784 prawidłowymi, niepustymi punktami godzinowymi.';
  if (reason || !complete) return { summary: makeSummary(profile, false, reason, yearLabel, notes), prepared: null };

  const daysByDate = new Map<string, number[]>();
  for (const point of complete.points) {
    const hours = daysByDate.get(point.date) || Array.from({ length: 24 }, () => 0);
    hours[point.hour] = point.value;
    daysByDate.set(point.date, hours);
  }
  const days: DailyProfile[] = [];
  for (const [date, hours] of Array.from(daysByDate.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    const parsed = new Date(`${date}T12:00:00.000Z`);
    const weekday = parsed.getUTCDay();
    days.push({ date, month: parsed.getUTCMonth() + 1, dayType: weekday === 0 || weekday === 6 ? 'weekend' : 'workday', hours });
  }
  const prepared: PreparedProfile = { summary: makeSummary(profile, true, null, yearLabel, notes), days, year: complete.year, notes };
  return { summary: prepared.summary, prepared };
}

function knownWhen2HeatReason(profile: CatalogProfile) {
  const missing = Array.isArray(profile.quality.missingSourceTimestamps)
    ? profile.quality.missingSourceTimestamps.filter((timestamp): timestamp is string => typeof timestamp === 'string')
    : [];
  const missingNote = missing.length ? ` Brak źródłowej godziny: ${missing.join(', ')}.` : '';
  if (profile.quantity === 'normalized_thermal_power') {
    return `To zapotrzebowanie na ciepło (energia cieplna), nie zużycie energii elektrycznej.${missingNote}`;
  }
  if (profile.quantity === 'coefficient_of_performance') {
    return `COP jest bezwymiarowym współczynnikiem sprawności, nie zużyciem energii elektrycznej.${missingNote}`;
  }
  return 'Nieobsługiwany rodzaj szeregu When2Heat.';
}

function summarizeKnownWhen2Heat(profile: CatalogProfile): Eligibility {
  const notes = when2heatNotes(profile);
  const yearLabel = 'Model 2022 (UTC)';
  const reason = knownWhen2HeatReason(profile);
  return { summary: makeSummary(profile, false, reason, yearLabel, notes), prepared: null };
}

function summarizeUnknown(profile: CatalogProfile, reason: string): Eligibility {
  return { summary: makeSummary(profile, false, reason, 'Nieobsługiwane źródło', []), prepared: null };
}

function evaluateProfile(profileInput: CatalogProfile): Eligibility {
  if (!isValidProfileShape(profileInput)) {
    const rawValue: unknown = profileInput;
    const raw: Record<string, unknown> = isRecord(rawValue) ? rawValue : {};
    const fallback: CatalogProfile = {
      key: getString(raw, 'key') || '',
      sourceKey: getString(raw, 'sourceKey') || '',
      name: getString(raw, 'name') || 'Profil bez nazwy',
      category: getString(raw, 'category') || '',
      kind: getString(raw, 'kind') || '',
      quantity: getString(raw, 'quantity') || '',
      unit: getString(raw, 'unit') || '',
      timeBasis: getString(raw, 'timeBasis') || '',
      resolutionMinutes: isFiniteNumber(raw['resolutionMinutes']) ? raw['resolutionMinutes'] : 0,
      start: typeof raw['start'] === 'string' ? raw['start'] : null,
      end: typeof raw['end'] === 'string' ? raw['end'] : null,
      series: Array.isArray(raw['series']) ? raw['series'].filter(isRecord) : [],
      metadata: isRecord(raw['metadata']) ? raw['metadata'] : {},
      quality: isRecord(raw['quality']) ? raw['quality'] : {},
    };
    const reason = !isRecord(raw['metadata']) ? 'Brakuje metadanych wymaganych do weryfikacji profilu.'
      : 'Profil ma nieprawidłową strukturę lub typy pól.';
    return summarizeUnknown(fallback, reason);
  }
  if (!isRecord(profileInput.metadata)) return summarizeUnknown(profileInput, 'Brakuje metadanych wymaganych do weryfikacji profilu.');
  if (profileInput.sourceKey === BDEW_SOURCE) return validateBdewAndMake(profileInput);
  if (profileInput.sourceKey === VDEW_SOURCE) return validateVdewAndMake(profileInput);
  if (profileInput.sourceKey === OPSD_SOURCE) {
    return profileInput.key === OPSD_WHOLEHOUSE_KEY
      ? validateOpsdWholeHouseAndMake(profileInput)
      : validateOpsdAndMake(profileInput);
  }
  if (profileInput.sourceKey === WHEN2HEAT_SOURCE) return summarizeKnownWhen2Heat(profileInput);
  return summarizeUnknown(profileInput, 'Źródło profilu nie jest obsługiwane przez porównanie energii elektrycznej.');
}

export function summarizeReferenceProfile(profile: CatalogProfile): Summary {
  return evaluateProfile(profile).summary;
}

function calculationMethod(profile: CatalogProfile): string {
  if (profile?.sourceKey === BDEW_SOURCE) return BDEW_PROJECTION_METHOD;
  if (profile?.sourceKey === VDEW_SOURCE) return VDEW_PROJECTION_METHOD;
  if (profile?.key === OPSD_WHOLEHOUSE_KEY) return OPSD_WHOLEHOUSE_PROJECTION_METHOD;
  if (profile?.sourceKey === OPSD_SOURCE) return OPSD_PUMP_PROJECTION_METHOD;
  return 'unsupported';
}

/** Return the narrower eligibility decision for using a profile as a total annual-load shape. */
export function getReferenceProfileCalculationEligibility(
  profile: CatalogProfile,
): ReferenceProfileCalculationEligibility {
  const evaluation = evaluateProfile(profile);
  const method = calculationMethod(profile);
  if (!evaluation.summary.eligible || !evaluation.prepared) {
    return { eligible: false, reason: evaluation.summary.reason || 'Profil nie przeszedł walidacji źródła i kompletności.', method };
  }

  if (profile.sourceKey === BDEW_SOURCE) {
    const sheet = bdewSheet(profile);
    if (sheet === 'P25' || sheet === 'S25') {
      return {
        eligible: false,
        reason: 'Profil P25/S25 opisuje pobór z sieci; autokonsumpcja PV mogła już zostać odjęta, więc nie można użyć go jako całkowitego zużycia obiektu.',
        method,
      };
    }
    if (!['H25', 'G25', 'L25'].includes(String(sheet))) {
      return { eligible: false, reason: 'Do projekcji zużycia kwalifikują się wyłącznie profile BDEW H25, G25 i L25.', method };
    }
    return { eligible: true, reason: null, method };
  }

  if (profile.sourceKey === VDEW_SOURCE) {
    return legacyCode(profile)
      ? { eligible: true, reason: null, method }
      : { eligible: false, reason: 'Profil VDEW nie ma obsługiwanego kodu H0/G0–G6/L0–L2.', method };
  }

  if (profile.sourceKey === OPSD_SOURCE) {
    if (profile.key === OPSD_WHOLEHOUSE_KEY) return { eligible: true, reason: null, method };
    if (profile.quantity === 'energy_import') {
      return {
        eligible: false,
        reason: 'OPSD energy_import opisuje pobór z sieci; autokonsumpcja PV mogła już zostać odjęta, więc nie można użyć go jako całkowitego zużycia obiektu.',
        method,
      };
    }
    if (profile.quantity !== 'device_energy_consumption' || !profile.key.endsWith('_heat_pump') || !opsdNames[profile.key]) {
      return { eligible: false, reason: 'Z profili OPSD można użyć wyłącznie pełnego pomiaru zużycia pompy ciepła jako znormalizowanego kształtu.', method };
    }
    return { eligible: true, reason: null, method };
  }

  return { eligible: false, reason: 'Źródło profilu nie obsługuje projekcji rocznego zużycia.', method };
}

function targetDateParts(date: string): { year: number; month: number; day: number; dayOfYear: number; weekday: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (!match) throw new Error(`Nieprawidłowa data docelowa profilu: ${date}.`);
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const instant = Date.UTC(year, month - 1, day, 12);
  const parsed = new Date(instant);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) {
    throw new Error(`Nieprawidłowa data docelowa profilu: ${date}.`);
  }
  const yearStart = Date.UTC(year, 0, 1, 12);
  return { year, month, day, dayOfYear: Math.floor((instant - yearStart) / DAY_MS) + 1, weekday: parsed.getUTCDay() };
}

function targetIsWeekend(date: string, year: number, includePolishHolidays: boolean): boolean {
  if (includePolishHolidays && polishHolidays(year).has(date)) return true;
  const weekday = targetDateParts(date).weekday;
  return weekday === 0 || weekday === 6;
}

function projectionNotes(profile: CatalogProfile, method: string, sourceYear: number | null): string[] {
  if (method === BDEW_PROJECTION_METHOD) {
    const sheet = bdewSheet(profile)!;
    return [
      'Źródło: BDEW 2025, profil standardowy. Miesięczny kształt i typ dnia pochodzą bezpośrednio z katalogowej serii, a nie ze zbiorczych wyników porównania 2025.',
      'Każdą datę okresu docelowego sklasyfikowano według polskiego kalendarza lokalnego: sobota ma typ SA, niedziela i polskie święto FT, a pozostałe dni WT.',
      profile.metadata.dynamicizationRequired === true
        ? 'Zastosowano dynamizację BDEW dla H25 według dnia roku okresu docelowego; współczynnik zaokrąglono do 4 miejsc, a energię kwadransa do 3 miejsc.'
        : `Profil ${sheet} nie jest dynamizowany zgodnie z zasadami BDEW.`,
      'Zachowano dobowy kształt i różnice sezonowe; dopasowanie do rocznego zużycia następuje jedną normalizacją całego okresu.',
    ];
  }

  if (method === VDEW_PROJECTION_METHOD) {
    return [
      'Źródło: VDEW/BDEW 1999/2000. Kwartalne wartości mocy przeliczono na względną energię, a miesiąc, sezon oraz typ dnia wyznaczono dla każdej daty okresu docelowego.',
      'W kalendarzu lokalnym soboty mają osobny profil sobotni, niedziele i polskie święta profil niedzielny, a pozostałe daty profil dnia roboczego.',
      profile.key === 'vdew-1999-h0'
        ? 'Dla H0 zastosowano dynamizację zależną od dnia roku okresu docelowego.'
        : 'Profil VDEW G/L nie jest dynamizowany; oficjalna funkcja dynamizacji dotyczy H0.',
      'Zachowano dobowy kształt i różnice sezonowe; dopasowanie do rocznego zużycia następuje jedną normalizacją całego okresu.',
    ];
  }

  if (method === OPSD_WHOLEHOUSE_PROJECTION_METHOD) {
    return [
      'Źródło: pochodny kształt OPSD 4 z 2016 r., zbudowany z różnic liczników poboru z sieci, PV, eksportu i EV; pompa ciepła pozostaje częścią zużycia domu i nie jest dodawana drugi raz. Różnica current-minus-previous jest przypisana do bieżącej etykiety koszyka, którego ostatni odczyt ma około jednominutowe przesunięcie.',
      'Każdą polską datę docelową przypisano bezpośrednio do źródłowej grupy miesiąc × dzień roboczy/weekend × godzina Europe/Berlin. Weekendy obejmują sobotę i niedzielę; święta nie są wydzielane.',
      'To empiryczna obserwacja jednego gospodarstwa, nie gwarantowany typowy profil. Jedna normalizacja dopasowuje kształt do rocznej energii użytej w porównaniu.',
    ];
  }

  return [
    `Źródło: pomiary OPSD; kompletność sprawdzono w godzinach UTC, użyto najnowszego kompletnego roku${sourceYear === null ? '' : ` ${sourceYear}`}.`,
    'Każdy koszyk UTC przeliczono na niemiecki czas cywilny Europe/Berlin przed agregacją do miesiąca, dnia roboczego/weekendu i godziny. Daty docelowe klasyfikuje się według lokalnego dnia tygodnia w Polsce, bez przenoszenia niemieckich pomiarów na polskie święta.',
    'Pomiar dotyczy pompy ciepła. Został wybrany wyłącznie jako znormalizowany kształt godzinowy; nie jest rzeczywistym pomiarem ani pełnym zużyciem gospodarstwa domowego.',
    'Nie doliczono ani nie odjęto energii PV. Zachowano różnice sezonowe i między typami dni; dopasowanie do rocznego zużycia następuje jedną normalizacją całego okresu.',
  ];
}

/** Project source patterns directly onto the supplied local civil dates. */
export function buildReferenceProfileProjection(
  profile: CatalogProfile,
  targetDates: string[],
): ReferenceProfileProjection {
  const eligibility = getReferenceProfileCalculationEligibility(profile);
  if (!eligibility.eligible) {
    throw new Error(`${profile?.name || 'Profil'}: ${eligibility.reason || 'profil nie kwalifikuje się do projekcji.'}`);
  }
  if (!Array.isArray(targetDates) || targetDates.length === 0 || new Set(targetDates).size !== targetDates.length) {
    throw new Error('Projekcja profilu wymaga listy niepustych, niepowtarzających się dat lokalnych.');
  }
  const parts = targetDates.map((date) => ({ date, ...targetDateParts(date) }));
  const method = eligibility.method;

  if (method === BDEW_PROJECTION_METHOD) {
    const index = new Map<string, number>();
    for (const point of profile.series) index.set(`${point.month}/${point.dayType}/${minutesOfDay(point.slot)}`, Number(point.value));
    const days = parts.map(({ date, year, month, dayOfYear }) => {
      const type = bdewDayType(date, year);
      const factor = profile.metadata.dynamicizationRequired === true ? dynamicizationFactor(dayOfYear) : 1;
      const quarters = Array.from({ length: QUARTERS_PER_DAY }, (_, slot) => {
        const raw = index.get(`${month}/${type}/${slot * 15}`);
        if (raw === undefined) throw new Error(`Brakujący kwadrans ${profile.key} ${date} ${slot}.`);
        return profile.metadata.dynamicizationRequired === true
          ? Math.round((raw * factor + Number.EPSILON) * 1000) / 1000
          : raw;
      });
      return {
        date, month, dayType: targetIsWeekend(date, year, true) ? 'weekend' as const : 'workday' as const,
        hours: Array.from({ length: 24 }, (_, hour) => quarters.slice(hour * 4, hour * 4 + 4).reduce((sum, value) => sum + value, 0)),
      };
    });
    return { method, notes: projectionNotes(profile, method, null), sourceYear: null, days };
  }

  if (method === VDEW_PROJECTION_METHOD) {
    const index = new Map<string, number>();
    for (const point of profile.series) {
      const endMinute = Number(minutesOfDay(point.slot)) + Number(point.dayOffset) * DAY_MINUTES;
      index.set(`${point.season}/${point.dayType}/${endMinute - 15}`, Number(point.value));
    }
    const days = parts.map(({ date, year, month, day, dayOfYear }) => {
      const type = vdewDayType(date, year);
      const season = seasonFor(month, day);
      const quarters = Array.from({ length: QUARTERS_PER_DAY }, (_, slot) => {
        const watts = index.get(`${season}/${type}/${slot * 15}`);
        if (watts === undefined) throw new Error(`Brakujący kwadrans ${profile.key} ${date} ${slot}.`);
        const dynamicWatts = profile.key === 'vdew-1999-h0'
          ? Math.round((watts * dynamicizationFactor(dayOfYear) + Number.EPSILON) * 10) / 10
          : watts;
        return dynamicWatts * 0.25 / 1000;
      });
      return {
        date, month, dayType: targetIsWeekend(date, year, true) ? 'weekend' as const : 'workday' as const,
        hours: Array.from({ length: 24 }, (_, hour) => quarters.slice(hour * 4, hour * 4 + 4).reduce((sum, value) => sum + value, 0)),
      };
    });
    return { method, notes: projectionNotes(profile, method, null), sourceYear: null, days };
  }

  if (method === OPSD_WHOLEHOUSE_PROJECTION_METHOD) {
    const index = opsdWholeHousePattern(profile);
    const days = parts.map(({ date, month, weekday }) => {
      const dayType = weekday === 0 || weekday === 6 ? 'weekend' as const : 'workday' as const;
      const hours = Array.from({ length: 24 }, (_, hour) => {
        const value = index.get(`${month}/${dayType}/${hour}`);
        if (value === undefined || !Number.isFinite(value) || value <= 0) {
          throw new Error(`Brak dodatniej grupy OPSD 4 ${month}/${dayType}/${hour}.`);
        }
        return value;
      });
      return { date, month, dayType, hours };
    });
    return { method, notes: projectionNotes(profile, method, 2016), sourceYear: 2016, days };
  }

  const complete = completeOpsdYear(profile);
  if (!complete) throw new Error(`Profil ${profile.key} nie ma pełnego roku UTC; braki nie są uzupełniane.`);
  const totals = new Map<string, { total: number; count: number }>();
  for (const point of complete.points) {
    const utcEpoch = Date.parse(`${point.date}T${String(point.hour).padStart(2, '0')}:00:00.000Z`);
    const civilParts = Object.fromEntries(opsdCivilFormatter.formatToParts(new Date(utcEpoch)).map(({ type, value }) => [type, value]));
    const civilDate = `${civilParts.year}-${civilParts.month}-${civilParts.day}`;
    const month = Number(civilParts.month);
    const hour = Number(civilParts.hour);
    const weekday = new Date(`${civilDate}T12:00:00.000Z`).getUTCDay();
    const type = weekday === 0 || weekday === 6 ? 'weekend' : 'workday';
    const key = `${month}/${type}/${hour}`;
    const group = totals.get(key) || { total: 0, count: 0 };
    group.total += point.value;
    group.count += 1;
    totals.set(key, group);
  }
  const mean = new Map<string, number>();
  for (const [key, group] of totals) {
    if (group.count <= 0 || !Number.isFinite(group.total)) throw new Error(`Nieprawidłowa grupa pomiarowa OPSD ${key}.`);
    mean.set(key, group.total / group.count);
  }
  const days = parts.map(({ date, year, month, weekday }) => {
    const type: 'workday' | 'weekend' = weekday === 0 || weekday === 6 ? 'weekend' : 'workday';
    const hours = Array.from({ length: 24 }, (_, hour) => {
      const value = mean.get(`${month}/${type}/${hour}`);
      if (value === undefined || !Number.isFinite(value) || value < 0) {
        throw new Error(`Brak grupy OPSD dla miesiąca ${month}, typu ${type}, godziny ${hour}; braki nie są uzupełniane.`);
      }
      return value;
    });
    return { date, month, dayType: type, hours };
  });
  return { method, notes: projectionNotes(profile, method, complete.year), sourceYear: complete.year, days };
}

function selectedDays(days: DailyProfile[], month: number | null, dayType: ReferenceProfileComparisonOptions['dayType']) {
  return days.filter((day) => (month === null || day.month === month)
    && (dayType === 'all' || day.dayType === dayType));
}

function totalsByMonth(days: DailyProfile[]) {
  const monthly = Array.from({ length: 12 }, () => 0);
  for (const day of days) {
    monthly[day.month - 1] += day.hours.reduce((sum, value) => sum + value, 0);
  }
  return monthly;
}

function comparePrepared(
  profile: PreparedProfile,
  options: ReferenceProfileComparisonOptions,
): Comparison {
  const rawTotal = profile.days.reduce((sum, day) => sum + day.hours.reduce((daySum, value) => daySum + value, 0), 0);
  if (!(rawTotal > 0) || !Number.isFinite(rawTotal)) {
    throw new Error(`Profil ${profile.summary.key} ma nieprawidłową roczną sumę energii.`);
  }
  const scale = options.annualKwh / rawTotal;
  const monthlyKwh = totalsByMonth(profile.days).map((value) => value * scale);
  const firstElevenTotal = monthlyKwh.slice(0, 11).reduce((sum, value) => sum + value, 0);
  monthlyKwh[11] = options.annualKwh - firstElevenTotal;

  const days = selectedDays(profile.days, options.month, options.dayType);
  if (days.length === 0) throw new Error(`Brak dni do wyliczenia średniego profilu godzinowego dla ${profile.summary.key}.`);
  const dailyAverageKwh = Array.from({ length: 24 }, (_, hour) =>
    days.reduce((sum, day) => sum + day.hours[hour], 0) / days.length * scale);
  const totalKwh = monthlyKwh.reduce((sum, value) => sum + value, 0);
  if (!monthlyKwh.every(Number.isFinite) || !dailyAverageKwh.every(Number.isFinite) || !Number.isFinite(totalKwh)) {
    throw new Error(`Profil ${profile.summary.key} wygenerował nieprawidłowe wartości.`);
  }
  return { ...profile.summary, monthlyKwh, dailyAverageKwh, totalKwh };
}

function validateOptions(options: ReferenceProfileComparisonOptions) {
  if (!options || !isFiniteNumber(options.annualKwh) || options.annualKwh <= 0) {
    throw new Error('Roczne zużycie do porównania musi być dodatnią liczbą kWh.');
  }
  if (options.month !== null && (!Number.isInteger(options.month) || options.month < 1 || options.month > 12)) {
    throw new Error('Miesiąc musi mieć wartość od 1 do 12 albo null.');
  }
  if (!['all', 'workday', 'weekend'].includes(options.dayType)) {
    throw new Error('Typ dnia musi mieć wartość all, workday albo weekend.');
  }
}

export function compareReferenceProfiles(
  profiles: CatalogProfile[],
  options: ReferenceProfileComparisonOptions,
): Comparison[] {
  validateOptions(options);
  if (!Array.isArray(profiles) || profiles.length < 1 || profiles.length > 6) {
    throw new Error('Wybierz od 1 do 6 profili do porównania.');
  }
  return profiles.map((profile) => {
    const eligibility = evaluateProfile(profile);
    if (!eligibility.summary.eligible || !eligibility.prepared) {
      throw new Error(`${eligibility.summary.name}: ${eligibility.summary.reason || 'profil nie kwalifikuje się do porównania.'}`);
    }
    return comparePrepared(eligibility.prepared, options);
  });
}
