import type { EnergyUsageMonth, EnergyUsageProfile } from './energy-profile';
import { prisma } from './prisma';
import { readReConsumptionProfile, type ReConsumptionProfile } from './re-consumption-api';
import { rePrisma, resolveReStation } from './re-stations';
import { readReConsumptionDashboard } from './re-consumption-dashboard';
import { readProjectAnalysisPeriod } from './project-analysis-period-server';
import type { ProjectAnalysisPeriod } from './project-analysis-period';
import { projectPvSettingsFromSources } from './project-pv-settings';
import { selectReConsumptionHistory } from './re-consumption-history';
import { buildReferenceProfileProjection } from './reference-profile-comparison';
import { readProjectReferenceProfileSelection, resolveSelectedReferenceProfile, type SelectedReferenceProfile } from './project-reference-profile';

type Payload = Record<string, any>;
type Series = Array<[string, number, number?]>;
type HourlySourceYears = { imports: Array<number | null>; exports: Array<number | null> };
type ActualDay = { isComplete: boolean; hours: Array<{ hasUse: boolean; use: number }> };
type ProjectPvProfileSource = { powerKw: number | null; latitude: number | null; longitude: number | null };
const engine = require('../../../public/shared/re-consumption-engine.js') as {
  buildActualMap(payload: Payload): Map<string, ActualDay>;
  buildForecastModel(payload: Payload): { days: number; monthlyHours: number[][] } | null;
  resolveDay(input: Record<string, unknown>): number[];
  buildProfile(input: Record<string, unknown>): { annualKwh: number; months: EnergyUsageMonth[] };
};
const labels = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const zeros = () => new Array<number>(24).fill(0);
const key = (date: Date) => date.toISOString().slice(0, 10);
const finite = (...values: unknown[]) => values.map(value => value == null || value === '' || typeof value === 'boolean'
  ? NaN : Number(value)).find(Number.isFinite);

function civilDate(value: unknown): string {
  const text = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text))
    || key(new Date(text)) !== text) throw new Error('Brak prawidłowej daty startu profilu RE');
  return text;
}

function settings(payload: Payload, profile: ReConsumptionProfile, startOverride?: string, projectPv?: ProjectPvProfileSource | null) {
  const account = payload.account || {};
  const raw = payload.rawEnergy || payload.energy || {};
  const start = civilDate(startOverride || account.dateStart || account.historyStart || payload.history?.startDate
    || payload.history?.historyStart || raw.dateStart || raw.historyStart);
  const manualPv = finite(account.pvSizeKwp, account.pvKwp, account.pvPowerKwp);
  let pv = manualPv ?? finite(raw.installedPowerKw, raw.installationPowerKw, raw.mocInstalacjiKw);
  if (manualPv == null && !(pv > 0)) {
    pv = Math.max(0, ...(payload.pvData?.records || []).flatMap((record: Payload) =>
      (record.quarters || []).map((q: Payload) => finite(q.powerW, q.acPowerW, q.dcPowerW, q.pvPowerW, q.productionPowerW) || 0))) / 1000;
  }
  let annual = finite(profile.annualUsageKwh, account.annualUsageKwh, account.annualConsumptionKwh,
    raw.annualUsageKwh, raw.annualConsumptionKwh);
  if (!(annual > 0)) {
    const records = payload.usageData?.records || [];
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
    const closed = records.filter((record: Payload) => record.date < today);
    const totals = (closed.length ? closed : records).map((record: Payload) => (record.quarters || [])
      .reduce((total: number, q: Payload) => total + Math.max(0, finite(q.totalLoadKwh, q.load, q.usageKwh, q.usage) || 0), 0))
      .filter((total: number) => total > 0);
    if (totals.length) annual = totals.reduce((a: number, b: number) => a + b, 0) / totals.length * 365;
  }
  return { start, year: Number(start.slice(0, 4)), annualKwh: Math.round(Math.max(0, annual ?? 0)),
    kWp: Math.round((projectPv ? projectPv.powerKw ?? 0 : manualPv != null ? manualPv : Math.ceil(pv || 0)) * 1000) / 1000,
    lat: projectPv ? projectPv.latitude : finite(account.lat, account.latitude, raw.lat, raw.latitude),
    lon: projectPv ? projectPv.longitude : finite(account.lon, account.lng, account.longitude, raw.lon, raw.lng, raw.longitude) };
}

function hourlyPatterns(rows: Series) {
  const days = new Map<string, { imports: number[]; exports: number[] }>();
  for (const [stamp, imported, exported = 0] of rows) {
    const date = civilDate(stamp);
    const hour = Number(stamp.slice(11, 13));
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isFinite(imported) || imported < 0
      || !Number.isFinite(exported) || exported < 0) throw new Error('Nieprawidłowy godzinowy profil RE');
    if (!days.has(date)) days.set(date, { imports: new Array(24).fill(null), exports: new Array(24).fill(null) });
    days.get(date).imports[hour] = imported;
    days.get(date).exports[hour] = exported;
  }
  const patterns = new Map<string, { imports: number[]; exports: number[] }>();
  for (const date of Array.from(days.keys()).sort()) {
    const day = days.get(date);
    if (day.imports.some(value => value == null)) throw new Error(`Niepełny godzinowy profil RE: ${date}`);
    patterns.set(date.slice(5), day);
  }
  return { days, patterns };
}

/** Aggregates the same resolved days as RE, retaining effective import/export labels. */
export function buildReEnergyUsageProfile(input: {
  profile: ReConsumptionProfile; dashboard: Payload; hourly?: Series; pv?: Series; linked?: boolean;
  analysisPeriod?: ProjectAnalysisPeriod; hourlySourceYears?: HourlySourceYears;
  projectPv?: ProjectPvProfileSource | null;
  referenceProfile?: SelectedReferenceProfile | null;
  referenceProfileSelectionRevision?: number;
  currentCRMAnnualKwh?: number | null;
}): EnergyUsageProfile {
  const { profile, dashboard, hourly = [], pv = [], linked = true, analysisPeriod, hourlySourceYears, projectPv,
    referenceProfile = null, referenceProfileSelectionRevision = 0 } = input;
  const explicitStart = analysisPeriod ? `${analysisPeriod.startMonth}-01` : undefined;
  const config = settings(dashboard, profile, explicitStart, projectPv);
  if (referenceProfile || referenceProfileSelectionRevision > 0) {
    const currentCRMAnnualKwh = finite(input.currentCRMAnnualKwh);
    if (!(currentCRMAnnualKwh > 0)) {
      throw new Error('Wybrany lub zresetowany profil RE wymaga dodatniej, aktualnej rocznej deklaracji zużycia z CRM.');
    }
    config.annualKwh = currentCRMAnnualKwh;
  }
  const payload = { ...dashboard, rawEnergy: dashboard.rawEnergy || dashboard.energy || {} };
  for (const field of ['usageData', 'pvData', 'storageData']) {
    if (Array.isArray(payload[field]?.records)) payload[field] = { ...payload[field],
      records: payload[field].records.filter((record: Payload) => {
        const date = String(record.date).slice(0, 10);
        return date >= config.start && (!analysisPeriod || date <= analysisPeriod.endDate);
      }) };
  }
  if (payload.rawEnergy.datetime && Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Europe/Warsaw') {
    throw new Error('Silnik pomiarów RE wymaga TZ=Europe/Warsaw w procesie CRM');
  }
  const actual = engine.buildActualMap(payload);
  const forecast = engine.buildForecastModel(payload);
  const { days: hourlyDays, patterns } = hourlyPatterns(hourly);
  const sources = profile.sources || Array(12).fill(profile.months ? 'manual' : 'standard');
  const exportSources = profile.exportSources || Array(12).fill('standard');
  const needsPv = exportSources.includes('xlsx');
  if (needsPv && !(config.kWp > 0)) throw new Error('Brak mocy PV do przeliczenia profilu OSD z energią oddaną');
  if (needsPv && !pv.length) throw new Error('Brak danych PV do przeliczenia profilu OSD z energią oddaną');
  const pvPattern = new Map<string, number>();
  for (const [stamp, radiation] of pv) {
    if (!Number.isFinite(radiation) || radiation < 0) throw new Error('Nieprawidłowe dane PV dla profilu RE');
    if (!pvPattern.has(stamp.slice(5, 13))) pvPattern.set(stamp.slice(5, 13), radiation);
  }
  function pvHours(date: Date): number[] {
    const offset = Math.round((date.getTime() - Date.parse(config.start)) / 86400000) * 24;
    return zeros().map((_, hour) => {
      const stamp = `${key(date)} ${String(hour).padStart(2, '0')}`;
      const indexed = pv[offset + hour];
      // Offset indexing is valid only for a series aligned with the RE start date.
      let radiation = indexed?.[0].slice(0, 13).replace('T', ' ') === stamp ? indexed[1] : undefined;
      for (let previous = 0; radiation == null && previous < 367; previous++) {
        const probe = new Date(date.getTime() - previous * 86400000);
        radiation = pvPattern.get(`${key(probe).slice(5)} ${String(hour).padStart(2, '0')}`);
      }
      if (radiation == null) throw new Error(`Brak danych PV: ${key(date)}, godzina ${hour}`);
      return radiation * config.kWp * 1.05 / 1000;
    });
  }
  const requestedKeys = analysisPeriod ? new Set(analysisPeriod.periodKeys) : null;
  const years = analysisPeriod
    ? Array.from(new Set(analysisPeriod.periodKeys.map(periodKey => Number(periodKey.slice(0, 4)))))
    : [config.year];
  const referenceHoursByDate = new Map<string, number[]>();
  const referenceAnnualWeightByYear = new Map<number, number>();
  const referenceMonthWeightByKey = new Map<string, number>();
  let referenceProjectionMethod: string | null = null;
  if (referenceProfile) {
    for (const year of years) {
      const projection = buildReferenceProfileProjection(referenceProfile.profile, calendarYearDates(year));
      referenceProjectionMethod = projection.method;
      const annualWeight = projection.days.reduce((total, day) => total + day.hours.reduce((dayTotal, value) => dayTotal + value, 0), 0);
      if (!(annualWeight > 0) || !Number.isFinite(annualWeight)) {
        throw new Error(`Wybrany profil referencyjny ${referenceProfile.profile.key} ma nieprawidłową sumę roczną dla ${year}.`);
      }
      for (const day of projection.days) referenceHoursByDate.set(day.date, day.hours);
      referenceAnnualWeightByYear.set(year, annualWeight);
    }
    if (analysisPeriod) {
      const targetAnnualWeight = [...referenceHoursByDate]
        .filter(([date]) => requestedKeys!.has(date.slice(0, 7)))
        .reduce((total, [, hours]) => total + hours.reduce((dayTotal, value) => dayTotal + value, 0), 0);
      if (!(targetAnnualWeight > 0) || !Number.isFinite(targetAnnualWeight)) {
        throw new Error(`Wybrany profil referencyjny ${referenceProfile.profile.key} ma nieprawidłową sumę okresu analizy.`);
      }
      for (const year of years) referenceAnnualWeightByYear.set(year, targetAnnualWeight);
    }
    const targetMonths = analysisPeriod?.periodKeys || years.flatMap(year => Array.from({ length: 12 }, (_, index) =>
      `${year}-${String(index + 1).padStart(2, '0')}`));
    for (const monthKey of targetMonths) {
      const monthWeight = [...referenceHoursByDate]
        .filter(([date]) => date.slice(0, 7) === monthKey)
        .reduce((total, [, hours]) => total + hours.reduce((dayTotal, value) => dayTotal + value, 0), 0);
      if (!Number.isFinite(monthWeight) || monthWeight < 0) {
        throw new Error(`Wybrany profil referencyjny ${referenceProfile.profile.key} ma nieprawidłową sumę dla ${monthKey}.`);
      }
      referenceMonthWeightByKey.set(monthKey, monthWeight);
    }
  }
  const projected: Array<{ item: EnergyUsageMonth; baseImportSource: string; baseExportSource: string;
    sourceFiles: number }> = [];
  const dailyConsumptionKwh: Record<string, number[]> = {};
  let referenceModelDayCount = 0;
  const patternWarnings: string[] = [];
  for (const year of years) {
    const yearSources = [...sources];
    const yearExportSources = [...exportSources];
    const requestedMonths = analysisPeriod ? analysisPeriod.periodKeys
      .filter(periodKey => Number(periodKey.slice(0, 4)) === year)
      .map(periodKey => Number(periodKey.slice(5, 7))) : [];
    if (analysisPeriod) {
      const selectedMonthIndexes = new Set(requestedMonths.map(month => month - 1));
      for (let index = 0; index < 12; index++) {
        if (!selectedMonthIndexes.has(index)) {
          yearSources[index] = 'standard';
          yearExportSources[index] = 'standard';
        }
      }
      for (const monthNumber of requestedMonths) {
        const index = monthNumber - 1;
        if (sources[index] === 'xlsx' && hourlySourceYears?.imports[index] !== year) {
          yearSources[index] = 'forecast';
          patternWarnings.push(hourlySourceYears?.imports[index] == null
            ? `Wzorzec XLSX dla ${labels[index]} nie ma potwierdzonego roku źródłowego; pokazano go jako prognozę.`
            : `Wzorzec XLSX dla ${labels[index]} pochodzi z ${hourlySourceYears.imports[index]}; pokazano go jako prognozę dla ${year}.`);
        }
        if (exportSources[index] === 'xlsx' && hourlySourceYears?.exports[index] !== year) {
          yearExportSources[index] = 'forecast';
          patternWarnings.push(hourlySourceYears?.exports[index] == null
            ? `Wzorzec energii oddanej XLSX dla ${labels[index]} nie ma potwierdzonego roku źródłowego; pokazano go jako prognozę.`
            : `Wzorzec energii oddanej XLSX dla ${labels[index]} pochodzi z ${hourlySourceYears.exports[index]}; pokazano go jako prognozę dla ${year}.`);
        }
      }
    }
    const result = engine.buildProfile({ year, annualKwh: config.annualKwh,
      monthlyKwh: profile.months, sources: yearSources, exportSources: yearExportSources,
      onDayResolved(dayKey: string, hours: number[]) {
        const monthKey = dayKey.slice(0, 7);
        if (referenceProfile && (!requestedKeys || requestedKeys.has(monthKey))) dailyConsumptionKwh[dayKey] = hours.slice();
      },
      getDayInputs(dayKey: string) {
        const date = new Date(dayKey), month = date.getUTCMonth(), actualDay = actual.get(dayKey);
        const selected = hourlyDays.get(dayKey) || patterns.get(dayKey.slice(5));
        const complete = actualDay?.isComplete && actualDay.hours.every(hour => hour.hasUse);
        const selectedMonth = !analysisPeriod || requestedKeys!.has(`${year}-${String(month + 1).padStart(2, '0')}`);
        if (selectedMonth && !complete && (sources[month] === 'xlsx' || exportSources[month] === 'xlsx') && !selected) {
          throw new Error(`Brak godzinowego profilu XLSX: ${dayKey}`);
        }
        const hasExportPattern = selectedMonth && exportSources[month] === 'xlsx' && !!selected;
        const suppressGeneratedManualDefault = referenceProfile != null && sources[month] === 'manual'
          && exportSources[month] !== 'xlsx';
        const detailedPatternAvailable = sources[month] !== 'standard' && !!selected && !suppressGeneratedManualDefault;
        const learnedPatternAvailable = sources[month] === 'standard' && !!forecast?.monthlyHours[month];
        if (referenceProfile && selectedMonth && !complete && !detailedPatternAvailable && !learnedPatternAvailable) {
          referenceModelDayCount += 1;
        }
        return { hourlyProfile: suppressGeneratedManualDefault ? undefined : selected?.imports,
          exportHourlyKwh: selected?.exports, hasExport: hasExportPattern,
          pvHourlyKwh: selectedMonth && !complete && sources[month] !== 'standard' && selected && hasExportPattern ? pvHours(date) : null,
          learnedHours: forecast?.monthlyHours[month], actualDay,
          referenceProfileSelected: referenceProfile != null && selectedMonth,
          referenceHours24: referenceHoursByDate.get(dayKey),
          referenceAnnualWeight: referenceAnnualWeightByYear.get(year),
          referenceMonthWeight: referenceMonthWeightByKey.get(`${year}-${String(month + 1).padStart(2, '0')}`) };
      } });
    for (const item of result.months) {
      const periodKey = `${year}-${String(item.month).padStart(2, '0')}`;
      if (requestedKeys && !requestedKeys.has(periodKey)) continue;
      projected.push({ item, baseImportSource: sources[item.month - 1], baseExportSource: exportSources[item.month - 1],
        sourceFiles: yearSources[item.month - 1] === 'xlsx' || yearExportSources[item.month - 1] === 'xlsx' ? 1 : 0 });
    }
  }
  const projectedAnnualKwh = projected.reduce((sum, { item }) => sum + item.totalKwh, 0);
  const months = projected.map(({ item, baseExportSource, sourceFiles }) => ({ ...item,
      key: `${item.year}-${String(item.month).padStart(2, '0')}`, label: labels[item.month - 1],
      sharePercent: projectedAnnualKwh ? item.totalKwh / projectedAnnualKwh * 100 : 0,
      ...(analysisPeriod && item.importSource === 'forecast' ? { exportSource: baseExportSource === 'xlsx'
        ? (hourlySourceYears?.exports[item.month - 1] !== item.year ? 'forecast' : 'xlsx')
        : item.exportSource } : {}),
      sourceFiles, hasData: linked ? item.hasData : config.annualKwh > 0 }));
  const importOnly = months.filter((item, index) => config.kWp > 0 && projected[index].baseImportSource === 'xlsx'
    && projected[index].baseExportSource !== 'xlsx'
    && !Array.from({ length: item.weekdayDays + item.weekendDays }, (_, day) => {
      const measured = actual.get(`${item.key}-${String(day + 1).padStart(2, '0')}`);
      return measured?.isComplete && measured.hours.every(hour => hour.hasUse);
    }).every(Boolean));
  const warnings = [...new Set(patternWarnings)];
  if (importOnly.length) warnings.push(`Brak plików energii oddanej: ${importOnly.map(month => analysisPeriod
    ? `${month.label} ${month.year}` : month.label).join(', ')}; te miesiące obejmują pobór z sieci, nie pełne zużycie budynku`);
  if (analysisPeriod && !linked) warnings.push('Brak powiązanej stacji RE; profil oparto na rocznym zużyciu deklarowanym, nie na pomiarach.');
  if (referenceProfile && referenceModelDayCount > 0) warnings.push(`Wybrany profil referencyjny ${referenceProfile.profile.name} (${referenceProfile.profile.key}, SHA-256 ${referenceProfile.contentHash}) został użyty jako znormalizowany kształt godzinowy dla ${referenceModelDayCount} dni po uwzględnieniu dostępnych danych rzeczywistych, XLSX i nauczonych.`);
  else if (referenceProfile) warnings.push(`Wybrano profil referencyjny ${referenceProfile.profile.name} (${referenceProfile.profile.key}, SHA-256 ${referenceProfile.contentHash}), lecz wszystkie wymagane dni miały już dostępne dane o wyższym priorytecie.`);
  else if (referenceProfileSelectionRevision > 0) warnings.push('Wybrany profil referencyjny został zresetowany; użyto domyślnego kształtu RE i aktualnej rocznej deklaracji CRM.');
  return { annualKwh: projectedAnnualKwh, months, warnings, ...(linked ? { source: 'RE' as const, station: profile.station } : {}),
    ...(referenceProfile && referenceProjectionMethod ? {
      referenceProfile: {
        key: referenceProfile.profile.key, name: referenceProfile.profile.name, contentHash: referenceProfile.contentHash,
        method: referenceProjectionMethod, projectionVersion: 1 as const,
      },
      dailyConsumptionKwh,
    } : {}),
    measuredDays: actual.size, pvIncluded: needsPv,
    ...(analysisPeriod ? { analysisStartMonth: analysisPeriod.startMonth } : {}) };
}

function hourlySourceYears(rows: Payload[]): HourlySourceYears {
  const result: HourlySourceYears = { imports: Array(12).fill(null), exports: Array(12).fill(null) };
  for (let month = 1; month <= 12; month++) {
    const monthRows = rows.filter(row => Number(row.month_no) === month);
    for (const [sourceKey, yearKey, target] of [
      ['source', 'source_year', result.imports],
      ['export_source', 'export_source_year', result.exports],
    ] as const) {
      const matching = monthRows.filter(row => row[sourceKey] === 'xlsx');
      const years = new Set(matching.map(row => {
        const value = Number(row[yearKey]);
        return Number.isInteger(value) && value >= 1900 && value <= 9999 ? value : null;
      }));
      if (matching.length && matching.length === monthRows.length && years.size === 1 && !years.has(null)) {
        target[month - 1] = [...years][0] as number;
      }
    }
  }
  return result;
}

function dayAfter(date: string): string {
  const next = new Date(`${civilDate(date)}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return key(next);
}

function calendarYearDates(year: number): string[] {
  const dates: string[] = [];
  const date = new Date(Date.UTC(year, 0, 1, 12));
  while (date.getUTCFullYear() === year) {
    dates.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return dates;
}

async function readSeries(api: 'pv', params: Record<string, string>): Promise<Series> {
  const url = new URL('get_dbdata.php', process.env.ONREVOLT_RE_PROFILE_URL?.trim() || 'https://my.onrevolt.com/re/setup_func.php');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Nieprawidłowy adres API RE');
  url.search = new URLSearchParams({ api, ...params }).toString();
  const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) });
  const data = await response.json();
  if (!response.ok || !Array.isArray(data) || data.some(row => !Array.isArray(row) || typeof row[0] !== 'string'
    || !Number.isFinite(Number(row[1])))) throw new Error(`Błąd profilu ${api} RE: ${data?.error || response.status}`);
  return data.map(row => [row[0], Number(row[1]), row[2] == null ? undefined : Number(row[2])]);
}

export async function readProjectReConsumptionProfile(projectId: string, options: { clientId?: string } = {}): Promise<EnergyUsageProfile> {
  if (!projectId?.trim()) throw new Error('Brak projectId dla profilu RE');
  const project = await prisma.project.findFirst({ where: { id: projectId, ...(options.clientId ? { clientId: options.clientId } : {}) },
    select: {
      dashboardStation: true,
      dashboardStationNumber: true,
      offerWorkspace: { select: { input: true } },
      energyAudits: { select: { annualConsumptionKwh: true, existingPvKw: true, roofTiltDeg: true, roofOrientation: true }, take: 1 },
      investmentSite: { select: { latitude: true, longitude: true } },
    } });
  if (!project) throw new Error('Nie znaleziono projektu tego klienta');
  const energyAudit = project.energyAudits?.[0] || null;
  const hasProjectPvSettings = Boolean(project.offerWorkspace) || energyAudit?.existingPvKw != null;
  const projectPvSettings = hasProjectPvSettings ? projectPvSettingsFromSources({
    draftExists: Boolean(project.offerWorkspace),
    draftInput: project.offerWorkspace?.input,
    energyAudit,
  }) : null;
  const projectPv: ProjectPvProfileSource | null = projectPvSettings ? {
    powerKw: projectPvSettings.powerKw,
    latitude: finite(project.investmentSite?.latitude),
    longitude: finite(project.investmentSite?.longitude),
  } : null;
  const analysis = await readProjectAnalysisPeriod(projectId);
  if (!analysis) throw new Error('Nie znaleziono okresu analizy projektu');
  const analysisPeriod = analysis.period;
  const referenceProfileSelection = await readProjectReferenceProfileSelection(projectId);
  const referenceProfile = await resolveSelectedReferenceProfile(referenceProfileSelection);
  let currentCRMAnnualKwh = finite(energyAudit?.annualConsumptionKwh);
  const ref = project.dashboardStation?.trim() || project.dashboardStationNumber?.trim();
  if (!ref) {
    const audit = await prisma.energyAudit.findUnique({ where: { projectId }, select: { annualConsumptionKwh: true } });
    currentCRMAnnualKwh = finite(audit?.annualConsumptionKwh) ?? currentCRMAnnualKwh;
    return buildReEnergyUsageProfile({ linked: false, profile: { station: '', months: null, sources: null, exportSources: null,
      annualUsageKwh: currentCRMAnnualKwh || 0, hourlyProfile: { exists: false, rows: 0 } },
      dashboard: { account: { dateStart: `${analysisPeriod.startMonth}-01` } }, analysisPeriod, projectPv,
      referenceProfile, referenceProfileSelectionRevision: referenceProfileSelection.revision, currentCRMAnnualKwh });
  }
  const station = await resolveReStation(ref);
  if (!station || (project.dashboardStationNumber && project.dashboardStationNumber.trim() !== station.station)) {
    throw new Error('Nieprawidłowe powiązanie stacji RE w projekcie');
  }
  const storedProfile = await readReConsumptionProfile(station.station);
  const db = rePrisma();
  const metadata = await db.$queryRawUnsafe<Payload[]>(
    "SELECT DATE_FORMAT(dateStart, '%Y-%m-%d') AS dateStart, annual_usage_kwh AS annualUsageKwh, pv_size_kwp AS pvSizeKwp, lat, lon FROM EnergyMeter_users WHERE station=? LIMIT 1", station.station);
  if (!metadata.length) throw new Error('Brak metadanych powiązanej stacji RE');
  const measured = await db.$queryRawUnsafe<Payload[]>(
    'SELECT 1 FROM EnergyMeter USE INDEX (station) WHERE station=? LIMIT 1', station.station);
  // An indexed existence check proves profile-only; CLI failures never select it.
  const dashboard = measured.length ? await readReConsumptionDashboard(station.station,
    `${analysisPeriod.startMonth}-01`, undefined, new Date(`${analysisPeriod.endDate}T12:00:00.000Z`))
    : { account: metadata[0], energy: {} };
  const range = { from: `${analysisPeriod.startMonth}-01`, to: dayAfter(analysisPeriod.endDate) };
  const legacyRows = storedProfile.hourlyProfile.exists ? await db.$queryRawUnsafe<Payload[]>(
    'SELECT month_no, day_no, hour_no, kwh, export_kwh, source, source_year, export_source, export_source_year FROM EnergyMeter_users_usage_hourly WHERE station=? ORDER BY month_no, day_no, hour_no',
    station.station) : [];
  const historyRows = await db.$queryRawUnsafe<Payload[]>(
    'SELECT year_no, month_no, day_no, hour_no, direction, kwh FROM EnergyMeter_users_usage_history WHERE station=? AND year_no BETWEEN ? AND ? ORDER BY year_no, month_no, day_no, hour_no, direction',
    station.station, Number(analysisPeriod.startMonth.slice(0, 4)), Number(analysisPeriod.endDate.slice(0, 4)));
  const { profile, rows } = selectReConsumptionHistory(storedProfile, legacyRows, historyRows, analysisPeriod.periodKeys);
  const config = settings(dashboard, profile, `${analysisPeriod.startMonth}-01`, projectPv);
  // A leap year preserves all month/day patterns, including February 29.
  const hourly: Series = rows.map(row => [`2024-${String(row.month_no).padStart(2, '0')}-${String(row.day_no).padStart(2, '0')} ${String(row.hour_no).padStart(2, '0')}:00:00`,
    Number(row.kwh), Number(row.export_kwh)]);
  let pv: Series = [];
  if (profile.exportSources?.includes('xlsx')) {
    if (!(config.kWp > 0)) throw new Error('Brak mocy PV do przeliczenia profilu OSD z energią oddaną');
    if (config.lat == null || config.lon == null) throw new Error(projectPv
      ? 'Brak lokalizacji projektu do pobrania danych PV'
      : 'Brak lokalizacji do pobrania danych PV');
    pv = await readSeries('pv', { lat: String(config.lat), lon: String(config.lon), ...range });
  }
  return buildReEnergyUsageProfile({ profile, dashboard, hourly, pv, analysisPeriod,
    hourlySourceYears: hourlySourceYears(rows), projectPv, referenceProfile,
    referenceProfileSelectionRevision: referenceProfileSelection.revision, currentCRMAnnualKwh });
}
