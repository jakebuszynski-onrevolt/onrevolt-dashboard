import type { EnergyTariffCostSnapshot, EnergyTariffZoneRate } from './energy-scenario';

const tariffApiUrl = process.env.ONREVOLT_RE_TARIFF_URL?.trim()
  || 'https://windyone.pl/re/setup.php';

type ReFixedCost = {
  label?: unknown;
  amount?: unknown;
  amount_mode?: unknown;
  billing_cycle_months?: unknown;
  annual_usage_min_kwh?: unknown;
  annual_usage_max_kwh?: unknown;
};

type ReVariableCost = {
  label?: unknown;
  window_code?: unknown;
  price?: unknown;
};

type ReTariff = {
  code?: unknown;
  name?: unknown;
  zone_model?: unknown;
  use_monthly?: unknown;
  dn_night?: unknown;
  po_off?: unknown;
  monthly?: unknown;
  fixed?: unknown;
  variable?: unknown;
  capacity_charge?: unknown;
};

type ReCapacityCharge = {
  model?: unknown;
  effective_from?: unknown;
  effective_until?: unknown;
  flat_eligible?: unknown;
  flat_max_power_kw?: unknown;
  flat_monthly?: unknown;
  variable_rate?: unknown;
  qualifying_hour_from?: unknown;
  qualifying_hour_until?: unknown;
  exclude_weekends?: unknown;
  exclude_public_holidays?: unknown;
  profile_factors?: unknown;
};

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumberValue(value: unknown) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[łŁ]/g, 'l')
    .toLowerCase()
    .trim();
}

function zoneLabel(code: string) {
  return ({
    all: 'Cała doba',
    day: 'Dzień',
    night: 'Noc',
    peak: 'Szczyt',
    offpeak: 'Poza szczytem',
    high: 'Wysoka',
    mid: 'Średnia',
    low: 'Niska',
  } as Record<string, string>)[code] || code;
}

function zoneOrder(code: string) {
  return ['all', 'day', 'night', 'peak', 'offpeak', 'high', 'mid', 'low'].indexOf(code);
}

function isEnergyCost(label: unknown) {
  const value = normalizedText(label);
  return value === 'energia' || value.includes('energia czynna');
}

function isCapacityChargeCost(label: unknown) {
  return normalizedText(label).includes('oplata mocowa');
}

function buildCapacityCharge(options: {
  tariff: ReTariff;
  annualUsageKwh: number;
  connectionPowerKw?: number;
}) {
  const variable = Array.isArray(options.tariff.variable) ? options.tariff.variable as ReVariableCost[] : [];
  const capacityRow = variable.find((row) => isCapacityChargeCost(row.label));
  if (!capacityRow) return { metadata: undefined, fixedCost: undefined };

  const rule = options.tariff.capacity_charge as ReCapacityCharge | undefined;
  if (!rule || rule.model !== 'pl_capacity_charge') {
    throw new Error(`Brak reguły rozliczenia opłaty mocowej dla taryfy ${String(options.tariff.code || 'C')}.`);
  }
  const connectionPowerKw = optionalNumberValue(options.connectionPowerKw);
  if (connectionPowerKw == null || connectionPowerKw <= 0) {
    throw new Error('Brak mocy umownej do obliczenia opłaty mocowej.');
  }
  const flatEligible = Boolean(rule.flat_eligible);
  const flatMaxPowerKw = numberValue(rule.flat_max_power_kw);
  const mode: 'flat' | 'variable' = flatEligible && connectionPowerKw <= flatMaxPowerKw ? 'flat' : 'variable';
  const metadata = {
    model: 'pl_capacity_charge' as const,
    mode,
    effectiveFrom: String(rule.effective_from || ''),
    effectiveUntil: String(rule.effective_until || ''),
    variableRateGrossPerKwh: numberValue(rule.variable_rate),
    qualifyingHourFrom: numberValue(rule.qualifying_hour_from),
    qualifyingHourUntil: numberValue(rule.qualifying_hour_until),
    excludeWeekends: Boolean(rule.exclude_weekends),
    excludePublicHolidays: Boolean(rule.exclude_public_holidays),
    profileFactors: (Array.isArray(rule.profile_factors) ? rule.profile_factors : []).map((item: any) => ({
      differenceMaxPercent: optionalNumberValue(item?.difference_max_percent),
      factor: numberValue(item?.factor),
      group: String(item?.group || ''),
    })),
  };
  if (mode === 'variable') return { metadata, fixedCost: undefined };

  const band = (Array.isArray(rule.flat_monthly) ? rule.flat_monthly : []).find((item: any) => {
    const minimum = optionalNumberValue(item?.annual_usage_min_kwh);
    const maximum = optionalNumberValue(item?.annual_usage_max_kwh);
    return (minimum == null || options.annualUsageKwh >= minimum)
      && (maximum == null || options.annualUsageKwh < maximum);
  }) as any;
  if (!band || !Number.isFinite(Number(band.amount))) {
    throw new Error('Brak miesięcznej stawki opłaty mocowej.');
  }
  return {
    metadata,
    fixedCost: { label: 'Opłata mocowa', amountGross: Number(band.amount) },
  };
}

function fixedCostApplies(row: ReFixedCost, annualUsageKwh: number, billingCycleMonths: number) {
  const cycle = optionalNumberValue(row.billing_cycle_months);
  if (cycle != null && cycle > 0 && cycle !== billingCycleMonths) return false;
  const minimum = optionalNumberValue(row.annual_usage_min_kwh);
  if (minimum != null && annualUsageKwh < minimum) return false;
  const maximum = optionalNumberValue(row.annual_usage_max_kwh);
  if (maximum != null && annualUsageKwh >= maximum) return false;
  return true;
}

function resolveZoneCodes(tariff: ReTariff) {
  const model = String(tariff.zone_model || 'all').toLowerCase();
  if (model === 'all') return ['all'];
  if (model === 'daynight') return ['day', 'night'];
  if (model === 'peakoffpeak') return ['peak', 'offpeak'];
  if (model === 'highmidlow') return ['high', 'mid', 'low'];
  throw new Error(`Nieobsługiwany model stref taryfy: ${model}`);
}

function monthlyZoneCodes(tariff: ReTariff) {
  const model = String(tariff.zone_model || 'all').toLowerCase();
  const monthly = tariff.monthly && typeof tariff.monthly === 'object'
    ? tariff.monthly as Record<string, unknown>
    : {};
  const night = new Set(Array.isArray(tariff.dn_night) ? tariff.dn_night.map(Number) : []);
  const offpeak = new Set(Array.isArray(tariff.po_off) ? tariff.po_off.map(Number) : []);
  const maps: Record<string, Record<number, string>> = {
    highmidlow: { 1: 'high', 2: 'mid', 3: 'low' },
    daynight: { 1: 'night', 2: 'day' },
    peakoffpeak: { 1: 'offpeak', 2: 'peak' },
  };

  return Array.from({ length: 12 }, (_, monthIndex) => Array.from({ length: 24 }, (_, hour) => {
    if (model === 'all') return 'all';
    if (tariff.use_monthly) {
      const row = monthly[String(monthIndex + 1)];
      const value = Array.isArray(row) ? Number(row[hour]) : 2;
      return maps[model]?.[value] || resolveZoneCodes(tariff)[0];
    }
    if (model === 'daynight') return night.has(hour) ? 'night' : 'day';
    if (model === 'peakoffpeak') return offpeak.has(hour) ? 'offpeak' : 'peak';
    return resolveZoneCodes(tariff)[0];
  }));
}

export function buildEnergyTariffCostSnapshot(options: {
  tariff: ReTariff;
  operator: string;
  annualUsageKwh: number;
  billingCycleMonths?: number;
  connectionPowerKw?: number;
  fetchedAt?: Date;
  sourceUrl?: string;
}): EnergyTariffCostSnapshot {
  const billingCycleMonths = options.billingCycleMonths || 1;
  const variable = Array.isArray(options.tariff.variable) ? options.tariff.variable as ReVariableCost[] : [];
  const fixed = Array.isArray(options.tariff.fixed) ? options.tariff.fixed as ReFixedCost[] : [];
  const selectedFixed = fixed.filter((row) => fixedCostApplies(row, options.annualUsageKwh, billingCycleMonths));
  const fixedCosts = selectedFixed.map((row) => {
    const amount = numberValue(row.amount);
    const amountGross = String(row.amount_mode || 'flat_month').toLowerCase() === 'per_kw_month'
      ? amount * numberValue(options.connectionPowerKw)
      : amount;
    return { label: String(row.label || 'Opłata stała'), amountGross };
  });
  const capacityCharge = buildCapacityCharge({
    tariff: options.tariff,
    annualUsageKwh: options.annualUsageKwh,
    connectionPowerKw: options.connectionPowerKw,
  });
  if (capacityCharge.fixedCost) fixedCosts.push(capacityCharge.fixedCost);
  const zoneRates: EnergyTariffZoneRate[] = resolveZoneCodes(options.tariff)
    .map((code) => {
      const matching = variable.filter((row) => {
        const rowCode = String(row.window_code || 'all').toLowerCase();
        return rowCode === 'all' || rowCode === code;
      });
      const energyGrossPerKwh = matching
        .filter((row) => isEnergyCost(row.label))
        .reduce((sum, row) => sum + numberValue(row.price), 0);
      const distributionGrossPerKwh = matching
        .filter((row) => !isEnergyCost(row.label) && !isCapacityChargeCost(row.label))
        .reduce((sum, row) => sum + numberValue(row.price), 0);
      return {
        code,
        label: zoneLabel(code),
        energyGrossPerKwh,
        distributionGrossPerKwh,
        totalGrossPerKwh: energyGrossPerKwh + distributionGrossPerKwh,
      };
    })
    .sort((a, b) => zoneOrder(a.code) - zoneOrder(b.code));

  if (zoneRates.some((rate) => !(rate.totalGrossPerKwh > 0))) {
    throw new Error(`Taryfa ${String(options.tariff.code || '')} nie ma kompletnych stawek zmiennych w RE.`);
  }

  return {
    source: 'WINDYONE_RE',
    sourceUrl: options.sourceUrl || tariffApiUrl,
    fetchedAt: (options.fetchedAt || new Date()).toISOString(),
    operator: options.operator,
    code: String(options.tariff.code || ''),
    name: String(options.tariff.name || options.tariff.code || ''),
    zoneModel: String(options.tariff.zone_model || 'all'),
    monthlyZoneCodes: monthlyZoneCodes(options.tariff),
    zoneRates,
    variableCosts: variable.map((row) => ({
      label: String(row.label || 'Opłata zmienna'),
      zoneCode: String(row.window_code || 'all').toLowerCase(),
      amountGrossPerKwh: numberValue(row.price),
    })),
    fixedMonthlyGross: fixedCosts.reduce((sum, row) => sum + row.amountGross, 0),
    fixedCosts,
    billingCycleMonths,
    capacityCharge: capacityCharge.metadata,
  };
}

async function getJson(url: URL) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`RE zwróciło HTTP ${response.status} dla danych taryfowych.`);
  const payload = await response.json();
  if (!payload?.ok) throw new Error(payload?.error || 'RE nie zwróciło danych taryfowych.');
  return payload;
}

function apiUrl(parameters: Record<string, string>) {
  const url = new URL(tariffApiUrl);
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

export type ReEnergyTariffCatalog = Array<{
  code: string;
  label: string;
  tariffs: Array<{
    id: number;
    code: string;
    label: string;
  }>;
}>;

export async function loadEnergyTariffCatalog(): Promise<ReEnergyTariffCatalog> {
  const osdPayload = await getJson(apiUrl({ action: 'json_osds' }));
  const osds = Array.isArray(osdPayload.osds) ? osdPayload.osds : [];

  return Promise.all(osds.map(async (osd: any) => {
    const listPayload = await getJson(apiUrl({ act: 'list', osd_id: String(osd.id) }));
    const tariffs = Array.isArray(listPayload.data) ? listPayload.data : [];
    return {
      code: String(osd.slug || osd.name || '').trim().toUpperCase(),
      label: String(osd.name || osd.slug || '').trim(),
      tariffs: tariffs.map((tariff: any) => ({
        id: Number(tariff.id),
        code: String(tariff.code || '').trim(),
        label: String(tariff.name || tariff.code || '').trim(),
      })),
    };
  }));
}

export async function loadEnergyTariffSnapshots(options: {
  operator: string;
  tariffCodes: string[];
  annualUsageKwh: number;
  billingCycleMonths?: number;
  connectionPowerKw?: number;
}) {
  const osdPayload = await getJson(apiUrl({ action: 'json_osds' }));
  const osds = Array.isArray(osdPayload.osds) ? osdPayload.osds : [];
  const operatorKey = normalizedText(options.operator);
  const osd = osds.find((item: any) => (
    normalizedText(item.slug) === operatorKey || normalizedText(item.name) === operatorKey
  ));
  if (!osd) throw new Error(`Brak operatora ${options.operator} w bazie taryf RE.`);

  const listPayload = await getJson(apiUrl({ act: 'list', osd_id: String(osd.id) }));
  const tariffs = Array.isArray(listPayload.data) ? listPayload.data : [];
  const uniqueCodes = Array.from(new Set(options.tariffCodes.filter(Boolean)));
  const selected = uniqueCodes.map((code) => {
    const tariff = tariffs.find((item: any) => normalizedText(item.code) === normalizedText(code));
    if (!tariff) throw new Error(`Brak taryfy ${code} dla operatora ${options.operator} w bazie RE.`);
    return { code, id: tariff.id };
  });
  const fetchedAt = new Date();
  const rows = await Promise.all(selected.map(async ({ code, id }) => {
    const payload = await getJson(apiUrl({ act: 'get', osd_id: String(osd.id), tariff_id: String(id) }));
    return [code, buildEnergyTariffCostSnapshot({
      tariff: payload.data,
      operator: options.operator,
      annualUsageKwh: options.annualUsageKwh,
      billingCycleMonths: options.billingCycleMonths,
      connectionPowerKw: options.connectionPowerKw,
      fetchedAt,
      sourceUrl: apiUrl({ osd: String(osd.id), tariff: String(id) }).toString(),
    })] as const;
  }));
  return Object.fromEntries(rows) as Record<string, EnergyTariffCostSnapshot>;
}
