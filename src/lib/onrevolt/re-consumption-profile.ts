import type { EnergyUsageMonth, EnergyUsageProfile } from './energy-profile';
import { prisma } from './prisma';
import { readReConsumptionProfile, type ReConsumptionProfile } from './re-consumption-api';
import { rePrisma, resolveReStation } from './re-stations';
import { readReConsumptionDashboard } from './re-consumption-dashboard';

type Payload = Record<string, any>;
type Series = Array<[string, number, number?]>;
type ActualDay = { isComplete: boolean; hours: Array<{ hasUse: boolean; use: number }> };
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

function settings(payload: Payload, profile: ReConsumptionProfile) {
  const account = payload.account || {};
  const raw = payload.rawEnergy || payload.energy || {};
  const start = civilDate(account.dateStart || account.historyStart || payload.history?.startDate
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
    kWp: Math.round((manualPv != null ? manualPv : Math.ceil(pv || 0)) * 1000) / 1000,
    lat: finite(account.lat, account.latitude, raw.lat, raw.latitude),
    lon: finite(account.lon, account.lng, account.longitude, raw.lon, raw.lng, raw.longitude) };
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
}): EnergyUsageProfile {
  const { profile, dashboard, hourly = [], pv = [], linked = true } = input;
  const config = settings(dashboard, profile);
  const payload = { ...dashboard, rawEnergy: dashboard.rawEnergy || dashboard.energy || {} };
  for (const field of ['usageData', 'pvData', 'storageData']) {
    if (Array.isArray(payload[field]?.records)) payload[field] = { ...payload[field],
      records: payload[field].records.filter((record: Payload) => String(record.date).slice(0, 10) >= config.start) };
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
  const result = engine.buildProfile({ year: config.year, annualKwh: config.annualKwh,
    monthlyKwh: profile.months, sources, exportSources, getDayInputs(dayKey: string) {
      const date = new Date(dayKey), month = date.getUTCMonth(), actualDay = actual.get(dayKey);
      const selected = hourlyDays.get(dayKey) || patterns.get(dayKey.slice(5));
      const complete = actualDay?.isComplete && actualDay.hours.every(hour => hour.hasUse);
      if (!complete && sources[month] === 'xlsx' && !selected) throw new Error(`Brak godzinowego profilu XLSX: ${dayKey}`);
      return { hourlyProfile: selected?.imports,
        exportHourlyKwh: selected?.exports, hasExport: exportSources[month] === 'xlsx',
        pvHourlyKwh: !complete && sources[month] !== 'standard' && selected && exportSources[month] === 'xlsx' ? pvHours(date) : null,
        learnedHours: forecast?.monthlyHours[month], actualDay };
    } });
  const months = result.months.map((item, month) => ({ ...item,
      key: `${config.year}-${String(month + 1).padStart(2, '0')}`, label: labels[month],
      sharePercent: result.annualKwh ? item.totalKwh / result.annualKwh * 100 : 0,
      sourceFiles: sources[month] === 'xlsx' || exportSources[month] === 'xlsx' ? 1 : 0,
      hasData: linked ? item.hasData : config.annualKwh > 0 }));
  const importOnly = months.filter((item, month) => config.kWp > 0 && sources[month] === 'xlsx' && exportSources[month] !== 'xlsx'
    && !Array.from({ length: item.weekdayDays + item.weekendDays }, (_, day) => {
      const measured = actual.get(`${item.key}-${String(day + 1).padStart(2, '0')}`);
      return measured?.isComplete && measured.hours.every(hour => hour.hasUse);
    }).every(Boolean));
  const warnings = importOnly.length ? [`Brak plików energii oddanej: ${importOnly.map(month => month.label).join(', ')}; te miesiące obejmują pobór z sieci, nie pełne zużycie budynku`] : [];
  return { annualKwh: result.annualKwh, months, warnings, ...(linked ? { source: 'RE' as const, station: profile.station } : {}),
    measuredDays: actual.size, pvIncluded: needsPv };
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
    select: { dashboardStation: true, dashboardStationNumber: true } });
  if (!project) throw new Error('Nie znaleziono projektu tego klienta');
  const ref = project.dashboardStation?.trim() || project.dashboardStationNumber?.trim();
  if (!ref) {
    const audit = await prisma.energyAudit.findUnique({ where: { projectId }, select: { annualConsumptionKwh: true } });
    return buildReEnergyUsageProfile({ linked: false, profile: { station: '', months: null, sources: null, exportSources: null,
      annualUsageKwh: Number(audit?.annualConsumptionKwh || 0), hourlyProfile: { exists: false, rows: 0 } },
      dashboard: { account: { dateStart: `${new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Europe/Warsaw' }).format(new Date())}-01-01` } } });
  }
  const station = await resolveReStation(ref);
  if (!station || (project.dashboardStationNumber && project.dashboardStationNumber.trim() !== station.station)) {
    throw new Error('Nieprawidłowe powiązanie stacji RE w projekcie');
  }
  const profile = await readReConsumptionProfile(station.station);
  const db = rePrisma();
  const metadata = await db.$queryRawUnsafe<Payload[]>(
    "SELECT DATE_FORMAT(dateStart, '%Y-%m-%d') AS dateStart, annual_usage_kwh AS annualUsageKwh, pv_size_kwp AS pvSizeKwp, lat, lon FROM EnergyMeter_users WHERE station=? LIMIT 1", station.station);
  if (!metadata.length) throw new Error('Brak metadanych powiązanej stacji RE');
  const measured = await db.$queryRawUnsafe<Payload[]>(
    'SELECT 1 FROM EnergyMeter USE INDEX (station) WHERE station=? LIMIT 1', station.station);
  // An indexed existence check proves profile-only; CLI failures never select it.
  const dashboard = measured.length ? await readReConsumptionDashboard(station.station, metadata[0].dateStart)
    : { account: metadata[0], energy: {} };
  const config = settings(dashboard, profile);
  const end = new Date(config.start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  const range = { from: config.start, to: key(end) };
  const rows = profile.hourlyProfile.exists ? await db.$queryRawUnsafe<Payload[]>(
    'SELECT month_no, day_no, hour_no, kwh, export_kwh FROM EnergyMeter_users_usage_hourly WHERE station=? ORDER BY month_no, day_no, hour_no', station.station) : [];
  // A leap year preserves all month/day patterns, including February 29.
  const hourly: Series = rows.map(row => [`2024-${String(row.month_no).padStart(2, '0')}-${String(row.day_no).padStart(2, '0')} ${String(row.hour_no).padStart(2, '0')}:00:00`,
    Number(row.kwh), Number(row.export_kwh)]);
  let pv: Series = [];
  if (profile.exportSources?.includes('xlsx')) {
    if (!(config.kWp > 0)) throw new Error('Brak mocy PV do przeliczenia profilu OSD z energią oddaną');
    if (config.lat == null || config.lon == null) throw new Error('Brak lokalizacji do pobrania danych PV');
    pv = await readSeries('pv', { lat: String(config.lat), lon: String(config.lon), ...range });
  }
  return buildReEnergyUsageProfile({ profile, dashboard, hourly, pv });
}
