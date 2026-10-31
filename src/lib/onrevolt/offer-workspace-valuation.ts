import ReTariffEngine from './offer-tariff-engine';
import type { ClientTariffHistory, ClientTariffPayload, TariffCatalogRow } from './client-tariffs';
import type { OfferMeasurementInterval } from './offer-measurements';
import type { OfferWorkspaceDayProfile } from './offer-workspace-chart-data';

export type OfferWorkspaceValuationValues = {
  importKwh: number | null;
  exportKwh: number | null;
  importValuePln: number | null;
  exportValuePln: number | null;
  averageBuyPlnPerKwh: number | null;
  averageSellPlnPerKwh: number | null;
};

export type OfferWorkspaceValuationSource =
  | 'PROJECT_HISTORY'
  | 'GENERAL_SELECTION_HISTORY'
  | 'CURRENT_CATALOG'
  | 'MISSING';

export type OfferWorkspaceValuationScenario = {
  settlement: 'NET_METERING' | 'NET_BILLING' | null;
  source: OfferWorkspaceValuationSource;
  totals: OfferWorkspaceValuationValues;
  months: Array<{ period: string } & OfferWorkspaceValuationValues>;
  days: Array<{
    date: string;
    period: string;
    dayType: 'workday' | 'free';
    totals: OfferWorkspaceValuationValues;
    hours: Array<{ hour: number } & OfferWorkspaceValuationValues>;
  }>;
  issues: string[];
};

export type OfferWorkspaceValuation = {
  vatBasis: 'NET' | 'GROSS';
  current: OfferWorkspaceValuationScenario;
  target: OfferWorkspaceValuationScenario;
};

export type OfferWorkspaceValuationScenarioInput = {
  settlement: 'NET_METERING' | 'NET_BILLING' | null;
  source: OfferWorkspaceValuationSource;
  tariffHistory?: ClientTariffHistory | null;
  tariff?: ClientTariffPayload | null;
  issues?: string[];
};

export type CalculateOfferWorkspaceValuationInput = {
  measurements: {
    months: Array<{ period: string; importKwh: number | null; exportKwh: number | null }>;
    dayProfiles?: OfferWorkspaceDayProfile[];
  };
  intervals: OfferMeasurementInterval[];
  vatBasis: 'NET' | 'GROSS';
  connectionPowerKw: number | null;
  current: OfferWorkspaceValuationScenarioInput;
  target: OfferWorkspaceValuationScenarioInput;
  rdnPricesNetPlnPerKwh?: ReadonlyMap<string, number>;
  rcePricesNetPlnPerKwh?: ReadonlyMap<string, number>;
};

type CanonicalTariff = {
  tariff: ClientTariffPayload;
  vatRate: number;
  rdnAddonsIssue: string | null;
};

type ImportRate = { energy: number | null; distribution: number | null; vatRate: number | null; issues: string[] };
type HourMeasure = Pick<OfferMeasurementInterval, 'startUtc' | 'localStart' | 'import' | 'export'>;
type RateOptions = NonNullable<Parameters<typeof ReTariffEngine.rates>[4]>;

function utcHourKey(value: string): string | null {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  return new Date(Math.floor(instant / 3_600_000) * 3_600_000).toISOString();
}

function finiteNonnegative(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedLabel(value: unknown): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ł/g, 'l');
}

function isEnergyRow(row: Record<string, any>): boolean {
  const label = normalizedLabel(row.label);
  return label === 'energia' || label.includes('energia czynna');
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-8 * Math.max(1, Math.abs(right));
}

const rowIdentityFields = ['amount_mode', 'billing_cycle_months', 'annual_usage_min_kwh', 'annual_usage_max_kwh'] as const;

function sameValue(left: unknown, right: unknown): boolean {
  if (left == null || right == null) return left == null && right == null;
  const leftNumber = finiteNumber(left);
  const rightNumber = finiteNumber(right);
  if (leftNumber !== null && rightNumber !== null) return close(leftNumber, rightNumber);
  return String(left) === String(right);
}

function sameRuntimeIdentity(runtime: Record<string, any>, stored: TariffCatalogRow): boolean {
  if (String(runtime.label || '').trim() !== String(stored.label || '').trim()
    || String(runtime.window_code ?? '') !== String(stored.window_code ?? '')) return false;
  return rowIdentityFields.every(field => !Object.prototype.hasOwnProperty.call(runtime, field)
    || sameValue(runtime[field], stored[field]));
}

function equivalentStoredRows(left: TariffCatalogRow, right: TariffCatalogRow): boolean {
  return String(left.label || '').trim() === String(right.label || '').trim()
    && String(left.window_code ?? '') === String(right.window_code ?? '')
    && rowIdentityFields.every(field => sameValue(left[field], right[field]))
    && ['net', 'gross', 'vatRate'].every(field => {
      const leftValue = finiteNumber(left[field]);
      const rightValue = finiteNumber(right[field]);
      return leftValue !== null && rightValue !== null && close(leftValue, rightValue);
    });
}

function canonicalNetRows(
  runtimeRows: Array<Record<string, any>>,
  storedRows: TariffCatalogRow[],
  field: 'amount' | 'price',
  vatRate: number,
  date: string,
): Array<Record<string, any>> {
  if (!Array.isArray(runtimeRows) || !Array.isArray(storedRows) || runtimeRows.length !== storedRows.length) {
    throw new Error(`Brak kompletnych metadanych cen netto taryfy dla ${date}.`);
  }
  const byKey = new Map<string, TariffCatalogRow>();
  for (const stored of storedRows) {
    if (!stored.component_key || byKey.has(stored.component_key)) {
      throw new Error(`Brak unikalnych kluczy składników taryfy dla ${date}.`);
    }
    byKey.set(stored.component_key, stored);
  }
  const usedStoredKeys = new Set<string>();
  const canonicalRows = runtimeRows.map((row, index) => {
    const key = String(row.component_key || '').trim();
    const runtime = finiteNumber(row[field]);
    if (runtime === null) throw new Error(`Nieprawidłowa cena składnika ${index} taryfy (${date}).`);
    let stored = key ? byKey.get(key) : undefined;
    if (key) {
      if (!stored || usedStoredKeys.has(key)) {
        throw new Error(`Brak jednoznacznej ceny netto taryfy dla składnika ${key} (${date}).`);
      }
      if (!sameRuntimeIdentity(row, stored)) {
        throw new Error(`Niespójna etykieta lub strefa składnika ${key} względem metadanych taryfy (${date}).`);
      }
    } else {
      const candidates = storedRows.filter(candidate => {
        const candidateKey = String(candidate.component_key || '');
        if (usedStoredKeys.has(candidateKey) || !sameRuntimeIdentity(row, candidate)) return false;
        const netPrice = finiteNumber(candidate.net);
        const grossPrice = finiteNumber(candidate.gross);
        return netPrice !== null && grossPrice !== null
          && (close(runtime, netPrice) || close(runtime, grossPrice));
      });
      if (!candidates.length) {
        throw new Error(`Brak dopasowanych metadanych NET/GROSS dla składnika "${String(row.label || index)}" (${String(row.window_code || 'bez strefy')}, ${date}).`);
      }
      stored = candidates[0];
      if (candidates.some(candidate => !equivalentStoredRows(stored!, candidate))) {
        throw new Error(`Niejednoznaczne metadane NET/GROSS dla składnika "${String(row.label || index)}" (${String(row.window_code || 'bez strefy')}, ${date}).`);
      }
    }
    const storedKey = String(stored.component_key || '');
    usedStoredKeys.add(storedKey);
    const net = finiteNumber(stored.net);
    const gross = finiteNumber(stored.gross);
    const rowVat = finiteNonnegative(stored.vatRate);
    if (net === null || gross === null || rowVat === null || !close(rowVat, vatRate)
      || (!close(runtime, net) && !close(runtime, gross))) {
      throw new Error(`Niespójne metadane NET/GROSS składnika ${key || index} taryfy (${date}).`);
    }
    return { ...row, [field]: net };
  });
  if (usedStoredKeys.size !== storedRows.length) throw new Error(`Nie wszystkie metadane cen taryfy zostały dopasowane (${date}).`);
  return canonicalRows;
}

function canonicalTariff(source: ClientTariffPayload | null | undefined, date: string): CanonicalTariff {
  if (!source) throw new Error(`Brak historii taryfy dla ${date}.`);
  const storage = source.pricing?.tariffStorage;
  if (!storage || storage.priceBasis !== 'net') throw new Error(`Brak jawnych metadanych cen netto taryfy dla ${date}.`);
  const vatRate = finiteNonnegative(storage.vatRate);
  if (vatRate === null || vatRate > 1) throw new Error(`Brak prawidłowej stawki VAT taryfy dla ${date}.`);
  const variable = canonicalNetRows(source.variable, storage.variable, 'price', vatRate, date);
  const tariff = { ...source, fixed: [], variable } as ClientTariffPayload & Record<string, any>;
  let rdnAddonsIssue: string | null = null;
  if (tariff.sell_method === 'rdn') {
    const market = (storage as typeof storage & { market?: Record<string, unknown> }).market;
    for (const [key, field] of [['margin', 'osd_add_rdn'], ['excise', 'osd_add_akcyza']] as const) {
      const component = market?.[key] as { net?: unknown; gross?: unknown; vatRate?: unknown } | undefined;
      const net = finiteNumber(component?.net);
      const gross = finiteNumber(component?.gross);
      const componentVat = finiteNonnegative(component?.vatRate);
      const runtime = finiteNumber((source as Record<string, unknown>)[field]);
      if (net === null || gross === null || componentVat === null || runtime === null
        || !close(componentVat, vatRate) || (!close(runtime, net) && !close(runtime, gross))) {
        rdnAddonsIssue = `Brak zweryfikowanego dodatku RDN (${key}) dla ${date}.`;
        break;
      }
      tariff[field] = net;
    }
  }
  return { tariff, vatRate, rdnAddonsIssue };
}

function tariffForDate(scenario: OfferWorkspaceValuationScenarioInput, date: string): ClientTariffPayload {
  if (scenario.tariff) return scenario.tariff;
  if (!scenario.tariffHistory || scenario.tariffHistory.strict !== true) {
    throw new Error(`Brak ścisłej historii taryfy dla ${date}.`);
  }
  return ReTariffEngine.resolve(scenario.tariffHistory, date, null) as ClientTariffPayload;
}

function localDateHour(localStart: string): { date: string; hour: number } | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/.exec(localStart);
  if (!match) return null;
  const hour = Number(match[2]);
  return hour >= 0 && hour <= 23 ? { date: match[1], hour } : null;
}

function amountForBasis(net: number, vatRate: number, basis: 'NET' | 'GROSS'): number {
  return basis === 'GROSS' ? net * (1 + vatRate) : net;
}

function engineOptions(connectionPowerKw: number | null, profile?: number[]): RateOptions {
  // rates() consumes only power/profile here; annual usage and cycle belong to fixed-cost APIs.
  return {
    ...(connectionPowerKw != null ? { connectionPowerKw } : {}),
    ...(profile ? { dayProfileKwh: profile } : {}),
  } as RateOptions;
}

function importRate(
  scenario: OfferWorkspaceValuationScenarioInput,
  interval: HourMeasure,
  connectionPowerKw: number | null,
  dayProfiles: Map<string, number[]>,
  rdnPrices: ReadonlyMap<string, number>,
  basis: 'NET' | 'GROSS',
  cache: Map<string, CanonicalTariff | Error>,
): ImportRate {
  const local = localDateHour(interval.localStart);
  if (!local) return { energy: null, distribution: null, vatRate: null, issues: [`Nieprawidłowy lokalny czas interwału ${interval.startUtc}.`] };
  let resolved: CanonicalTariff;
  if (cache.has(local.date)) {
    const item = cache.get(local.date)!;
    if (item instanceof Error) return { energy: null, distribution: null, vatRate: null, issues: [item.message] };
    resolved = item;
  } else {
    try {
      resolved = canonicalTariff(tariffForDate(scenario, local.date), local.date);
      cache.set(local.date, resolved);
    } catch (error) {
      const reason = error instanceof Error ? error.message : `Brak taryfy dla ${local.date}.`;
      cache.set(local.date, new Error(reason));
      return { energy: null, distribution: null, vatRate: null, issues: [reason] };
    }
  }

  const { tariff, vatRate, rdnAddonsIssue } = resolved;
  const marketHour = utcHourKey(interval.startUtc);
  const marketPrice = marketHour ? rdnPrices.get(marketHour) : undefined;
  const options = engineOptions(connectionPowerKw, dayProfiles.get(local.date));
  const reasons: string[] = [];
  const energyRows = tariff.variable.filter((row) => isEnergyRow(row));
  const distributionRows = tariff.variable.filter((row) => !isEnergyRow(row));
  const baseDistributionRows = distributionRows.filter(row => !normalizedLabel(row.label).includes('oplata mocowa'));
  const usesRdn = (tariff as ClientTariffPayload & { sell_method?: string }).sell_method === 'rdn';
  let energyNet: number | null = null;
  let distributionNet: number | null = null;

  try {
    if (usesRdn && rdnAddonsIssue) throw new Error(rdnAddonsIssue);
    const rates = ReTariffEngine.rates(tariff, local.date, local.hour, marketPrice, options);
    const energyZone = ReTariffEngine.energyZone(tariff, local.date, local.hour);
    const hasEnergyRate = usesRdn || energyRows.some(row => row.window_code === 'all' || row.window_code === energyZone);
    const hasDistributionRate = baseDistributionRows.some(row => row.window_code === 'all' || row.window_code === rates.zone);
    if (!hasEnergyRate || !Number.isFinite(rates.energy)) {
      reasons.push(`Brak zmiennej stawki energii dla ${local.date} godz. ${local.hour}.`);
    } else energyNet = rates.energy;
    if (rates.capacityChargePending) {
      reasons.push(`Nie można sklasyfikować zmiennej opłaty mocowej dla ${local.date} godz. ${local.hour}; brak mocy umownej lub pełnego profilu dobowego.`);
    } else if (!hasDistributionRate) {
      reasons.push(`Brak zmiennej stawki dystrybucyjnej dla ${local.date} godz. ${local.hour}.`);
    } else if (!Number.isFinite(rates.distribution) || rates.distribution < 0) {
      reasons.push(`Nieprawidłowa stawka dystrybucyjna dla ${local.date} godz. ${local.hour}.`);
    } else {
      distributionNet = rates.distribution;
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : `Brak stawki taryfy dla ${local.date} godz. ${local.hour}.`);
  }

  if (energyNet === null) {
    if (!energyRows.length && !usesRdn) {
      reasons.push(`Brak składnika energii czynnej dla ${local.date}.`);
    } else if (usesRdn && rdnAddonsIssue) {
      reasons.push(rdnAddonsIssue);
    } else {
      try {
        const energyOnly = { ...tariff, fixed: [], variable: energyRows } as ClientTariffPayload;
        const rates = ReTariffEngine.rates(energyOnly, local.date, local.hour, marketPrice, options);
        const energyZone = ReTariffEngine.energyZone(energyOnly, local.date, local.hour);
        const hasEnergyRate = energyRows.some(row => row.window_code === 'all' || row.window_code === energyZone);
        if (hasEnergyRate && Number.isFinite(rates.energy)) energyNet = rates.energy;
        else reasons.push(`Nieprawidłowa cena energii dla ${local.date} godz. ${local.hour}.`);
      } catch (error) {
        reasons.push(error instanceof Error ? error.message : `Brak stawki energii dla ${local.date} godz. ${local.hour}.`);
      }
    }
  }

  if (distributionNet === null && !reasons.some((reason) => reason.includes('opłaty mocowej'))) {
    if (!baseDistributionRows.length) {
      reasons.push(`Brak zmiennej stawki dystrybucyjnej dla ${local.date}.`);
    } else {
      try {
        const distributionOnly = {
          ...tariff,
          fixed: [],
          variable: distributionRows,
          sell_method: undefined,
          energy_schedule: undefined,
        } as ClientTariffPayload;
        const rates = ReTariffEngine.rates(distributionOnly, local.date, local.hour, undefined, options);
        if (rates.capacityChargePending) {
          reasons.push(`Nie można sklasyfikować zmiennej opłaty mocowej dla ${local.date} godz. ${local.hour}; brak mocy umownej lub pełnego profilu dobowego.`);
        } else if (baseDistributionRows.some(row => row.window_code === 'all' || row.window_code === rates.zone)
          && Number.isFinite(rates.distribution) && rates.distribution >= 0) {
          distributionNet = rates.distribution;
        } else reasons.push(`Nieprawidłowa stawka dystrybucyjna dla ${local.date} godz. ${local.hour}.`);
      } catch (error) {
        reasons.push(error instanceof Error ? error.message : `Brak stawki dystrybucyjnej dla ${local.date} godz. ${local.hour}.`);
      }
    }
  }

  return {
    energy: energyNet === null ? null : amountForBasis(energyNet, vatRate, basis),
    distribution: distributionNet === null ? null : amountForBasis(distributionNet, vatRate, basis),
    vatRate,
    issues: reasons,
  };
}

function dailyProfiles(intervals: OfferMeasurementInterval[]): Map<string, number[]> {
  const days = new Map<string, Map<number, Array<{ duration: number; kwh: number }>>>();
  for (const interval of intervals) {
    const local = localDateHour(interval.localStart);
    const duration = Date.parse(interval.endUtc) - Date.parse(interval.startUtc);
    if (!local || interval.import == null || !Number.isFinite(duration)) continue;
    const hours = days.get(local.date) || new Map<number, Array<{ duration: number; kwh: number }>>();
    const values = hours.get(local.hour) || [];
    values.push({ duration, kwh: interval.import.valueKwh });
    hours.set(local.hour, values);
    days.set(local.date, hours);
  }
  const output = new Map<string, number[]>();
  for (const [date, hours] of days) {
    const rows = Array.from(hours.values()).flat();
    const duration = rows[0]?.duration;
    if (!duration || (duration !== 900_000 && duration !== 3_600_000)) continue;
    const perHour = 3_600_000 / duration;
    if (hours.size !== 24 || rows.some(row => row.duration !== duration)
      || Array.from({ length: 24 }, (_, hour) => hours.get(hour)?.length === perHour).some(valid => !valid)) continue;
    output.set(date, Array.from({ length: 24 }, (_, hour) => hours.get(hour)!.reduce((sum, row) => sum + row.kwh, 0)));
  }
  return output;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function average(value: number | null, kwh: number | null): number | null {
  return value != null && kwh != null && kwh > 0 ? round(value / kwh) : null;
}

function valueImport(
  kwh: number | null,
  interval: HourMeasure | null,
  scenario: OfferWorkspaceValuationScenarioInput,
  connectionPowerKw: number | null,
  profiles: Map<string, number[]>,
  rdnPrices: ReadonlyMap<string, number>,
  basis: 'NET' | 'GROSS',
  cache: Map<string, CanonicalTariff | Error>,
): { value: number | null; reasons: string[] } {
  if (kwh === null) return { value: null, reasons: ['Brak pomiaru importu.'] };
  if (kwh < 0 || !Number.isFinite(kwh)) return { value: null, reasons: ['Nieprawidłowa energia importu.'] };
  if (kwh === 0) return { value: 0, reasons: [] };
  if (!interval) return { value: null, reasons: ['Brak interwału pomiarowego do wyceny importu.'] };
  if (!interval.import) return { value: null, reasons: ['Brak importu w interwale pomiarowym.'] };
  const rates = importRate(scenario, interval, connectionPowerKw, profiles, rdnPrices, basis, cache);
  if (rates.energy === null || rates.distribution === null) return { value: null, reasons: rates.issues };
  return { value: round(kwh * (rates.energy + rates.distribution)), reasons: rates.issues };
}

function valueExport(
  kwh: number | null,
  interval: HourMeasure | null,
  scenario: OfferWorkspaceValuationScenarioInput,
  rcePrices: ReadonlyMap<string, number>,
  basis: 'NET' | 'GROSS',
  cache: Map<string, CanonicalTariff | Error>,
): { value: number | null; reasons: string[] } {
  if (scenario.settlement === 'NET_METERING') {
    return { value: null, reasons: kwh != null && kwh > 0 ? ['NET_METERING: eksport nie ma przypisanej pieniężnej ceny sprzedaży.'] : [] };
  }
  if (scenario.settlement !== 'NET_BILLING') return { value: null, reasons: ['Nie wybrano jawnego systemu rozliczeń eksportu.'] };
  if (kwh === null) return { value: null, reasons: ['Brak pomiaru eksportu.'] };
  if (kwh < 0 || !Number.isFinite(kwh)) return { value: null, reasons: ['Nieprawidłowa energia eksportu.'] };
  if (kwh === 0) return { value: 0, reasons: [] };
  if (!interval || !interval.export) return { value: null, reasons: ['Brak interwału pomiarowego do wyceny eksportu.'] };
  const marketHour = utcHourKey(interval.startUtc);
  const rce = marketHour ? rcePrices.get(marketHour) : undefined;
  if (rce == null || !Number.isFinite(rce) || rce < 0) return { value: null, reasons: [`Brak istniejącej ceny RCE dla eksportu ${interval.startUtc}.`] };
  const indicativeNote = 'Wartość eksportu oparta na istniejącej godzinowej cenie RCE jest wskaźnikiem rynkowym, nie kwotą rozliczenia depozytu ani faktury.';
  if (basis === 'NET') return { value: round(kwh * rce), reasons: [indicativeNote] };
  const local = localDateHour(interval.localStart);
  if (!local) return { value: null, reasons: [`Nieprawidłowy lokalny czas eksportu ${interval.startUtc}.`] };
  let canonical = cache.get(local.date);
  if (!canonical) {
    try {
      canonical = canonicalTariff(tariffForDate(scenario, local.date), local.date);
      cache.set(local.date, canonical);
    } catch (error) {
      return { value: null, reasons: [error instanceof Error ? error.message : `Brak stawki VAT dla ${local.date}.`] };
    }
  }
  if (canonical instanceof Error) return { value: null, reasons: [canonical.message] };
  return { value: round(kwh * amountForBasis(rce, canonical.vatRate, basis)), reasons: [indicativeNote] };
}

function combineValues(values: Array<OfferWorkspaceValuationValues>): OfferWorkspaceValuationValues {
  const combine = (key: 'importKwh' | 'exportKwh' | 'importValuePln' | 'exportValuePln'): number | null => {
    const items = values.map((value) => value[key]);
    if (items.some((value) => value === null)) return null;
    return round(items.reduce((sum, value) => sum + value!, 0));
  };
  const importKwh = combine('importKwh');
  const exportKwh = combine('exportKwh');
  const importValuePln = combine('importValuePln');
  const exportValuePln = combine('exportValuePln');
  return {
    importKwh,
    exportKwh,
    importValuePln,
    exportValuePln,
    averageBuyPlnPerKwh: average(importValuePln, importKwh),
    averageSellPlnPerKwh: average(exportValuePln, exportKwh),
  };
}

function scenarioValuation(
  input: CalculateOfferWorkspaceValuationInput,
  scenario: OfferWorkspaceValuationScenarioInput,
): OfferWorkspaceValuationScenario {
  const issues = new Set(scenario.issues || []);
  issues.add('Wycena obejmuje energię czynną i zmienną dystrybucję przed opustem/depozytem; nie obejmuje opłat stałych ani rozliczenia faktury.');
  const intervalsByMonth = new Map<string, OfferMeasurementInterval[]>();
  const intervalsByHour = new Map<string, OfferMeasurementInterval[]>();
  for (const interval of input.intervals) {
    const local = localDateHour(interval.localStart);
    if (!local) continue;
    const monthRows = intervalsByMonth.get(local.date.slice(0, 7)) || [];
    monthRows.push(interval);
    intervalsByMonth.set(local.date.slice(0, 7), monthRows);
    const hourKey = `${local.date}/${local.hour}`;
    const hourRows = intervalsByHour.get(hourKey) || [];
    hourRows.push(interval);
    intervalsByHour.set(hourKey, hourRows);
  }
  const profiles = dailyProfiles(input.intervals);
  const tariffCache = new Map<string, CanonicalTariff | Error>();
  const months = input.measurements.months.map((month) => {
    const rows = intervalsByMonth.get(month.period) || [];
    let importValuePln: number | null = month.importKwh === 0 ? 0 : month.importKwh == null ? null : 0;
    let exportValuePln: number | null = scenario.settlement === 'NET_METERING'
      ? null : month.exportKwh === 0 ? 0 : month.exportKwh == null ? null : 0;
    let importComplete = month.importKwh != null;
    let exportComplete = month.exportKwh != null && scenario.settlement === 'NET_BILLING';
    const measuredImport = rows.filter((row) => row.import != null).reduce((sum, row) => sum + row.import!.valueKwh, 0);
    const measuredExport = rows.filter((row) => row.export != null).reduce((sum, row) => sum + row.export!.valueKwh, 0);
    if (month.importKwh != null && rows.some((row) => row.import == null)) {
      importComplete = false;
      issues.add(`${month.period}: niepełny kierunek importu w interwałach.`);
    }
    if (month.exportKwh != null && rows.some((row) => row.export == null)) {
      exportComplete = false;
      if (scenario.settlement === 'NET_BILLING') issues.add(`${month.period}: niepełny kierunek eksportu w interwałach.`);
    }
    if (month.importKwh != null && Math.abs(measuredImport - month.importKwh) > 0.002) {
      importComplete = false;
      issues.add(`${month.period}: suma interwałów importu nie zgadza się z agregatem pomiarowym.`);
    }
    if (month.exportKwh != null && Math.abs(measuredExport - month.exportKwh) > 0.002) {
      exportComplete = false;
      if (scenario.settlement === 'NET_BILLING') issues.add(`${month.period}: suma interwałów eksportu nie zgadza się z agregatem pomiarowym.`);
    }
    for (const row of rows) {
      if (row.import) {
        const result = valueImport(row.import.valueKwh, row, scenario, input.connectionPowerKw,
          profiles, input.rdnPricesNetPlnPerKwh || new Map(), input.vatBasis, tariffCache);
        if (result.value === null) importComplete = false;
        else importValuePln = (importValuePln || 0) + result.value;
        result.reasons.forEach((reason) => issues.add(`${month.period}: ${reason}`));
      }
      if (row.export && scenario.settlement === 'NET_BILLING') {
        const result = valueExport(row.export.valueKwh, row, scenario,
          input.rcePricesNetPlnPerKwh || new Map(), input.vatBasis, tariffCache);
        if (result.value === null) exportComplete = false;
        else exportValuePln = (exportValuePln || 0) + result.value;
        result.reasons.forEach((reason) => issues.add(`${month.period}: ${reason}`));
      } else if (row.export && scenario.settlement === 'NET_METERING' && row.export.valueKwh > 0) {
        issues.add(`${month.period}: NET_METERING nie przypisuje eksportowi pieniężnej ceny sprzedaży.`);
      }
    }
    if (!importComplete) importValuePln = null;
    if (!exportComplete) exportValuePln = null;
    const values: OfferWorkspaceValuationValues = {
      importKwh: month.importKwh,
      exportKwh: month.exportKwh,
      importValuePln: importValuePln == null ? null : round(importValuePln),
      exportValuePln,
      averageBuyPlnPerKwh: average(importValuePln == null ? null : round(importValuePln), month.importKwh),
      averageSellPlnPerKwh: average(exportValuePln, month.exportKwh),
    };
    return { period: month.period, ...values };
  });

  const days = (input.measurements.dayProfiles || []).map((profile) => {
    const hours = profile.hours.map((hour) => {
      const intervalRows = intervalsByHour.get(`${profile.date}/${hour.hour}`) || [];
      const valueDirection = (direction: 'import' | 'export', measuredKwh: number | null) => {
        if (measuredKwh == null) return { value: null as number | null, reasons: [`Brak pomiaru ${direction === 'import' ? 'importu' : 'eksportu'} dla profilu dnia.`] };
        const readings = intervalRows.map(row => row[direction]);
        if (!intervalRows.length || readings.some(reading => reading == null)) {
          return { value: null as number | null, reasons: [`Brak kompletnych interwałów ${direction === 'import' ? 'importu' : 'eksportu'} dla ${profile.date} godz. ${hour.hour}.`] };
        }
        const measuredFromIntervals = readings.reduce((sum, reading) => sum + reading!.valueKwh, 0);
        if (Math.abs(measuredFromIntervals - measuredKwh) > 0.002) {
          return { value: null as number | null, reasons: [`Suma interwałów nie zgadza się z profilem dla ${profile.date} godz. ${hour.hour}.`] };
        }
        let total = 0;
        const reasons: string[] = [];
        for (const interval of intervalRows) {
          const reading = interval[direction]!;
          const result = direction === 'import'
            ? valueImport(reading.valueKwh, interval, scenario, input.connectionPowerKw,
              profiles, input.rdnPricesNetPlnPerKwh || new Map(), input.vatBasis, tariffCache)
            : valueExport(reading.valueKwh, interval, scenario,
              input.rcePricesNetPlnPerKwh || new Map(), input.vatBasis, tariffCache);
          if (result.value === null) return { value: null as number | null, reasons: [...reasons, ...result.reasons] };
          total += result.value;
          reasons.push(...result.reasons);
        }
        return { value: round(total), reasons };
      };
      const importResult = valueDirection('import', hour.importKwh);
      const exportResult = valueDirection('export', hour.exportKwh);
      importResult.reasons.forEach((reason) => issues.add(`${profile.date} godz. ${hour.hour}: ${reason}`));
      exportResult.reasons.forEach((reason) => issues.add(`${profile.date} godz. ${hour.hour}: ${reason}`));
      return {
        hour: hour.hour,
        importKwh: hour.importKwh,
        exportKwh: hour.exportKwh,
        importValuePln: importResult.value,
        exportValuePln: exportResult.value,
        averageBuyPlnPerKwh: average(importResult.value, hour.importKwh),
        averageSellPlnPerKwh: average(exportResult.value, hour.exportKwh),
      };
    });
    return {
      date: profile.date,
      period: profile.period,
      dayType: profile.dayType,
      totals: combineValues(hours),
      hours,
    };
  });

  if (scenario.settlement === 'NET_METERING' && input.measurements.months.some((month) => (month.exportKwh || 0) > 0)) {
    issues.add('NET_METERING: wycena eksportu pieniężnego jest pominięta.');
  }
  return {
    settlement: scenario.settlement,
    source: scenario.source,
    totals: combineValues(months),
    months,
    days,
    issues: Array.from(issues),
  };
}

export function calculateOfferWorkspaceValuation(input: CalculateOfferWorkspaceValuationInput): OfferWorkspaceValuation {
  return {
    vatBasis: input.vatBasis,
    current: scenarioValuation(input, input.current),
    target: scenarioValuation(input, input.target),
  };
}
