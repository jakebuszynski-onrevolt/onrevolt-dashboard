import ReTariffEngine from './offer-tariff-engine';
import type { ClientTariffHistory, ClientTariffPayload } from './client-tariffs';

export type OfferBillingIntervalInput = {
  startUtc: string;
  endUtc: string;
  importKwh: number;
  exportKwh: number;
  marketPriceNetPlnPerKwh?: number;
};

export type OfferBillingDepositLot = {
  amountPln: number;
  creditedMonth: string;
  expiresMonth: string;
  refundCapPln: number | null;
  /** Internal continuation token preserving FIFO order across billing runs. */
  fifoOrder?: number;
};

export type OfferNetBillingContinuationLot = OfferBillingDepositLot & {
  status: 'active' | 'pending';
  fifoOrder: number;
};

export type OfferNetBillingContinuation = {
  mode: 'NET_BILLING';
  currency: 'PLN';
  vatBasis: 'NET' | 'GROSS';
  period: { startUtc: string; endUtc: string };
  lots: OfferNetBillingContinuationLot[];
};

/** expiresMonth is the first calendar month in which this credit is unavailable. */
export type OfferNetMeteringCreditLot = { kwh: number; expiresMonth: string };

export type OfferBillingExportPricePeriod = {
  startUtc: string;
  endUtc: string;
  /** Final unit value credited to the deposit, including any caller-selected coefficient. */
  depositCreditPricePlnPerKwh: number;
  /** Unit value before the deposit coefficient, used as the refund cap base. */
  refundCapPricePlnPerKwh?: number;
};

export type OfferBillingContext = {
  annualUsageKwh: number;
  billingCycleMonths: number;
  connectionPowerKw: number;
};

export type NetMeteringPolicy = {
  mode: 'NET_METERING';
  netMeteringRatio: number;
  initialCreditKwh: number;
  initialCreditLots?: OfferNetMeteringCreditLot[];
  initialCreditExpiresMonth?: string | null;
  /** Calendar anchor for utility cycles; required for cycles longer than one month. */
  billingCycleStartMonth?: string;
  creditExpiryMonths: number;
  coverage: 'ENERGY_ONLY' | 'ENERGY_AND_VARIABLE_DISTRIBUTION';
  fixedChargeTreatment: 'ALWAYS_BILLED';
  /** Enables ENEA-style physical import/export balancing within each local clock hour before opust. */
  hourlyNettingMode?: 'SAME_HOUR_NET_EXCHANGE';
  /** Keeps OZE and cogeneration charges on post-hour imports while opust discounts other variable fees. */
  variableFeeOpustBasis?: 'OZE_CHP_PRE_OPUST';
};

export type NetBillingPolicy = {
  mode: 'NET_BILLING';
  initialDeposit: OfferBillingDepositLot[];
  exportUnitPrices: OfferBillingExportPricePeriod[];
  /** Selects the statutory maximum refund assumption; prices are still supplied by the caller. */
  exportPriceMethod: 'RCE' | 'RCEm';
  creditingDelayMonths: number;
  depositExpiryMonths: number;
  /** Assumed paid share of the legal refund ceiling; 0 means no refund is assumed. */
  expiredRefundRate: number;
  depositCoverage: 'ENERGY_ONLY';
  fixedChargeTreatment: 'ALWAYS_BILLED';
};

export type GridImportPolicy = { mode: 'GRID_IMPORT' };
type BillingPolicy = NetMeteringPolicy | NetBillingPolicy | GridImportPolicy;

export type OfferWorkspaceBillingInput = {
  context: OfferBillingContext;
  /** Applies to tariff-engine costs; export deposit prices are supplied as completed account values. */
  vatBasis: 'NET' | 'GROSS';
  baseline: OfferWorkspaceBillingScenarioInput;
  after: OfferWorkspaceBillingScenarioInput;
};

export type OfferWorkspaceBillingScenarioInput = {
  tariffHistory: ClientTariffHistory;
  settlement: BillingPolicy;
  intervals: OfferBillingIntervalInput[];
};

export type OfferBillingRateRequest = {
  tariffHistory: ClientTariffHistory;
  context: OfferBillingContext;
  vatBasis: 'NET' | 'GROSS';
  settlement: BillingPolicy;
  interval: OfferBillingIntervalInput;
};

export type OfferBillingRateSeriesRequest = Omit<OfferBillingRateRequest, 'interval'> & {
  intervals: OfferBillingIntervalInput[];
};

export type OfferBillingResolvedRate = {
    status: 'ready';
    date: string;
    hour: number;
    energyZone: string;
    distributionZone: string;
    energyBuyPlnPerKwh: number;
    distributionBuyPlnPerKwh: number;
    depositCreditPricePlnPerKwh: number | null;
    exportPlnPerKwh: number | null;
    refundCapPricePlnPerKwh: number | null;
    fixedDailyPln: number;
    vatBasis: 'NET' | 'GROSS';
  };

export type OfferBillingRateResult = OfferBillingResolvedRate | { status: 'blocked'; reasons: string[] };

export type OfferBillingRateSeriesResult =
  | { status: 'ready'; rates: OfferBillingResolvedRate[] }
  | { status: 'blocked'; reasons: string[] };

export type OfferWorkspaceGridIntervalInput = Omit<OfferBillingIntervalInput, 'importKwh' | 'exportKwh'> & {
  importKwh: number | null;
  exportKwh: number | null;
  exportPriceNetPlnPerKwh?: number | null;
};

export type OfferWorkspaceGridPricingInput = {
  tariffHistory: ClientTariffHistory;
  context: OfferBillingContext;
  vatBasis: 'NET' | 'GROSS';
  intervals: OfferWorkspaceGridIntervalInput[];
  expectedLocalDates?: string[];
  totalHours?: number;
  settlementMode?: NetMeteringPolicy['mode'] | NetBillingPolicy['mode'] | null;
};

export type OfferWorkspaceGridPricingResult = {
  status: 'ready' | 'partial' | 'blocked';
  vatBasis: 'NET' | 'GROSS';
  energyPln: number | null;
  distributionPln: number | null;
  fixedPln: number | null;
  exportValuePln: number | null;
  pricedHours: number;
  totalHours: number;
  tariffLabels: string[];
  issues: string[];
};

export type OfferWorkspaceScenarioResult = {
  status: 'ready';
  settlement: BillingPolicy['mode'];
  vatBasis: 'NET' | 'GROSS';
  period: { startUtc: string; endUtc: string };
  warnings: string[];
  result: OfferBillingScenarioResult;
};

export type OfferBillingComponentCategory =
  | 'network' | 'quality' | 'oze' | 'cogeneration' | 'capacity'
  | 'commercial' | 'fixed_network' | 'subscription' | 'other_variable' | 'other_fixed';

export type OfferBillingCostComponent = {
  componentKey: string;
  label: string;
  category: OfferBillingComponentCategory;
  amountPln: number;
};

export type OfferBillingIntervalTariff = {
  startUtc: string;
  endUtc: string;
  energyZone: string;
  distributionZone: string;
  energyRatePlnPerKwh: number;
  distributionRatePlnPerKwh: number;
};

export type OfferBillingIntervalResult = {
  startUtc: string;
  endUtc: string;
  month: string;
  importKwh: number;
  exportKwh: number;
  billedImportKwh: number;
  billedExportKwh: number;
  energyCostPln: number;
  distributionCostPln: number;
  fixedCostPln: number;
  totalCostPln: number;
  coveredKwh: number;
  coveredEnergyPln: number;
  coveredDistributionPln: number;
  exportValuePln: number;
  depositEarnedPln: number;
  depositUsedPln: number;
  depositExpiredPln: number;
  depositRefundedPln: number;
  depositBalancePln: number;
  pendingDepositPln: number;
  creditAddedKwh: number;
  creditUsedKwh: number;
  creditExpiredKwh: number;
  creditBalanceKwh: number | null;
  cashDuePln: number;
  /** Exact variable distribution breakdown on the kWh billed for distribution. */
  distributionComponents?: OfferBillingCostComponent[];
  /** Exact fixed-fee breakdown, allocated over the same local day as fixedCostPln. */
  fixedComponents?: OfferBillingCostComponent[];
};

export type OfferBillingMonthResult = Omit<OfferBillingIntervalResult, 'startUtc' | 'endUtc'> & {
  month: string;
};

export type OfferBillingScenarioResult = {
  intervals: OfferBillingIntervalResult[];
  months: OfferBillingMonthResult[];
  totals: Omit<OfferBillingMonthResult, 'month'>;
  /** Adjacent intervals with identical zones and prices are merged into one range. */
  intervalTariffs?: OfferBillingIntervalTariff[];
  netBillingContinuation?: OfferNetBillingContinuation;
};

export type OfferWorkspaceBillingResult =
  | {
    status: 'ready';
    vatBasis: 'NET' | 'GROSS';
    baseline: OfferWorkspaceScenarioResult;
    after: OfferWorkspaceScenarioResult;
  }
  | { status: 'blocked'; reasons: string[] };

type LocalParts = { date: string; month: string; hour: number; minute: number; offsetMinutes: number };
type PreparedInterval = OfferBillingIntervalInput & { start: number; end: number; local: LocalParts };
type ComponentRate = Omit<OfferBillingCostComponent, 'amountPln'> & { ratePlnPerKwh?: number; dailyPln?: number };
type OfferTariffRateDetails = {
  energy: number; distribution: number; capacityChargeRate: number;
  energyZone: string; distributionZone: string; capacityChargePending: boolean;
};
type RateEntry = {
  tariff: ClientTariffPayload;
  energy: number;
  distribution: number;
  vatRate: number;
  fixedDaily: number;
  energyZone: string;
  distributionZone: string;
  distributionComponents: Array<ComponentRate & { ratePlnPerKwh: number }>;
  fixedComponents: Array<ComponentRate & { dailyPln: number }>;
};
type LedgerLot = { amount: number; creditedMonth: string; expiresMonth: string; refundCap: number | null; order: number };
type ValidatedExportPricePeriod = { start: number; end: number; depositCredit: number; refundCap: number | null };

const warsawFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const hourMs = 60 * 60 * 1000;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

function finite(value: unknown, label: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label}: oczekiwano liczby z zakresu ${min}..${max}.`);
  }
  return value;
}

function utcMillis(value: unknown, label: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error(`${label}: wymagany jawny znacznik UTC w formacie YYYY-MM-DDTHH:mm:ssZ.`);
  }
  const millis = Date.parse(value);
  const canonical = new Date(millis).toISOString();
  if (!Number.isFinite(millis) || (canonical !== value && canonical.replace('.000Z', 'Z') !== value)) {
    throw new Error(`${label}: nieprawidłowy znacznik UTC.`);
  }
  return millis;
}

function localParts(millis: number): LocalParts {
  const values = Object.fromEntries(warsawFormatter.formatToParts(new Date(millis))
    .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  const localAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), hour, minute);
  return { date, month: date.slice(0, 7), hour, minute, offsetMinutes: (localAsUtc - millis) / 60000 };
}

function addMonth(month: string, amount: number): string {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function normaliseLabel(value: unknown): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').toLowerCase();
}

const fixedRowIdentityFields = [
  'label', 'amount_mode', 'billing_cycle_months', 'annual_usage_min_kwh', 'annual_usage_max_kwh',
] as const;
const variableRowIdentityFields = ['label', 'window_code'] as const;

function semanticValue(value: unknown): string | null {
  if (value === null) return 'null';
  if (value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? `number:${Object.is(value, -0) ? 0 : value}` : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return `number:${Object.is(numeric, -0) ? 0 : numeric}`;
  return `text:${normaliseLabel(trimmed).replace(/\s+/g, ' ')}`;
}

function semanticRowIdentity(row: Record<string, unknown>, fixed: boolean): string | null {
  const fields: readonly string[] = fixed ? fixedRowIdentityFields : variableRowIdentityFields;
  const values: string[] = [];
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) return null;
    const value = semanticValue(row[field]);
    if (value === null) return null;
    values.push(value);
  }
  return JSON.stringify(values);
}

function isEnergyRow(row: Record<string, unknown>): boolean {
  const label = normaliseLabel(row.label);
  return label === 'energia' || label.includes('energia czynna');
}

function isMonth(value: unknown): value is string {
  return typeof value === 'string' && monthPattern.test(value);
}

function isWarsawMonthBoundary(millis: number): boolean {
  const local = localParts(millis);
  return local.date.endsWith('-01') && local.hour === 0 && local.minute === 0;
}

function prepareInterval(interval: OfferBillingIntervalInput, label: string): PreparedInterval {
  if (!interval || typeof interval !== 'object') throw new Error(`${label}: brak interwału.`);
  const start = utcMillis(interval.startUtc, `${label}.startUtc`);
  const end = utcMillis(interval.endUtc, `${label}.endUtc`);
  const duration = end - start;
  const startMinute = new Date(start).getUTCMinutes();
  if (new Date(start).getUTCSeconds() !== 0 || new Date(start).getUTCMilliseconds() !== 0
    || new Date(end).getUTCSeconds() !== 0 || new Date(end).getUTCMilliseconds() !== 0) {
    throw new Error(`${label}: początek i koniec muszą leżeć na granicy minuty.`);
  }
  if (duration !== 15 * 60000 && duration !== 60 * 60000) {
    throw new Error(`${label}: interwał musi trwać dokładnie 15 albo 60 minut.`);
  }
  if ((duration === hourMs && startMinute !== 0) || (duration === 15 * 60000 && startMinute % 15 !== 0)) {
    throw new Error(`${label}: początek nie odpowiada rozdzielczości interwału.`);
  }
  finite(interval.importKwh, `${label}.importKwh`, 0);
  finite(interval.exportKwh, `${label}.exportKwh`, 0);
  if (interval.marketPriceNetPlnPerKwh !== undefined) {
    finite(interval.marketPriceNetPlnPerKwh, `${label}.marketPriceNetPlnPerKwh`);
  }
  return { ...interval, start, end, local: localParts(start) };
}

function prepareIntervals(intervals: OfferBillingIntervalInput[], label: string): PreparedInterval[] {
  if (!Array.isArray(intervals) || intervals.length === 0 || intervals.length > 40000) {
    throw new Error(`${label}: wymagane są od 1 do 40000 interwałów.`);
  }
  let previousEnd: number | null = null;
  const prepared = intervals.map((interval, index) => {
    const value = prepareInterval(interval, `${label}[${index}]`);
    if (previousEnd !== null && value.start !== previousEnd) {
      throw new Error(`${label}[${index}]: luka, nakładanie albo niechronologiczna kolejność interwałów.`);
    }
    previousEnd = value.end;
    return value;
  });

  if (localParts(prepared[0].start).hour !== 0 || localParts(prepared[0].start).minute !== 0
    || localParts(prepared[prepared.length - 1].end).hour !== 0
    || localParts(prepared[prepared.length - 1].end).minute !== 0) {
    throw new Error(`${label}: okres musi obejmować pełne lokalne doby Europe/Warsaw, aby rozliczyć opłaty stałe.`);
  }
  return prepared;
}

function validateHistory(history: ClientTariffHistory): void {
  if (!history || history.strict !== true || !history.byDate || typeof history.byDate !== 'object') {
    throw new Error('Historia taryf musi być jawna i mieć strict: true.');
  }
}

export function canonicalNetRows(
  rows: Array<Record<string, any>>,
  storedRows: ClientTariffPayload['pricing']['tariffStorage']['fixed'],
  field: 'amount' | 'price',
  label: string,
  tariffVatRate: number,
): Array<Record<string, any>> {
  if (rows.length !== storedRows.length) throw new Error(`Niespójna liczba pozycji ${label} taryfy względem metadanych cen netto.`);
  const byKey = new Map<string, (typeof storedRows)[number]>();
  for (const row of storedRows) {
    const key = row.component_key;
    if (!key || byKey.has(key)) throw new Error(`Brak unikalnych identyfikatorów pozycji ${label} taryfy.`);
    byKey.set(key, row);
  }
  const usedKeys = new Set<string>();
  const fixed = field === 'amount';
  const canonicalRows = rows.map((row, index) => {
    if (!row || typeof row !== 'object') throw new Error(`Nieprawidłowa pozycja ${label} taryfy ${index}.`);
    const key = String(row.component_key || '');
    let stored = key ? byKey.get(key) : undefined;
    if (key) {
      if (!stored || usedKeys.has(key)) throw new Error(`Brak ceny netto dla pozycji ${label} ${key}.`);
      const runtimeIdentity = semanticRowIdentity(row, fixed);
      const storedIdentity = semanticRowIdentity(stored, fixed);
      if (runtimeIdentity !== null && storedIdentity !== null && runtimeIdentity !== storedIdentity) {
        throw new Error(`Pozycja ${label} ${key} nie odpowiada semantycznie metadanym taryfy.`);
      }
    } else {
      const runtimeIdentity = semanticRowIdentity(row, fixed);
      if (runtimeIdentity === null) {
        throw new Error(`Brak kompletnej tożsamości semantycznej pozycji ${label} taryfy ${index}.`);
      }
      const candidates = storedRows.filter((candidate) => !usedKeys.has(candidate.component_key)
        && semanticRowIdentity(candidate, fixed) === runtimeIdentity);
      if (candidates.length !== 1) {
        throw new Error(`Brak jednoznacznego dopasowania semantycznego pozycji ${label} "${String(row.label || index)}".`);
      }
      [stored] = candidates;
    }
    const storedKey = stored.component_key;
    usedKeys.add(storedKey);
    const net = finite(stored.net, `${label}[${index}].net`);
    const gross = finite(stored.gross, `${label}[${index}].gross`);
    const rowVat = finite(stored.vatRate, `${label}[${index}].vatRate`, 0, 1);
    if (Math.abs(rowVat - tariffVatRate) > 1e-9) {
      throw new Error(`Pozycja ${label} ${storedKey} ma inną stawkę VAT niż zbiorcza taryfa; nie można jej bezpiecznie agregować.`);
    }
    const runtimePrice = finite(row[field], `${label}[${index}].${field}`);
    const close = (left: number, right: number) => Math.abs(left - right) <= 1e-8 * Math.max(1, Math.abs(right));
    const roundedFixedGross = field === 'amount' && close(runtimePrice, Math.round((gross + Number.EPSILON) * 100) / 100);
    const roundedVariableGross = field === 'price'
      && runtimePrice === Number(gross.toFixed(4));
    if (!close(runtimePrice, net) && !close(runtimePrice, gross) && !roundedFixedGross && !roundedVariableGross) {
      throw new Error(`Cena pozycji ${label} ${storedKey} nie odpowiada jej zweryfikowanym wartościom netto/brutto.`);
    }
    return { ...row, component_key: storedKey, [field]: net };
  });
  if (usedKeys.size !== storedRows.length) throw new Error(`Nie wszystkie metadane pozycji ${label} taryfy zostały dopasowane.`);
  return canonicalRows;
}

function tariffForDate(history: ClientTariffHistory, date: string): ClientTariffPayload {
  const source = ReTariffEngine.resolve(history, date, null);
  const storage = source?.pricing?.tariffStorage;
  if (!source || !storage || storage.priceBasis !== 'net') {
    throw new Error(`Brak jawnych metadanych cen netto taryfy dla ${date}.`);
  }
  const vatRate = Number(storage.vatRate);
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 1) {
    throw new Error(`Brak prawidłowej stawki VAT w historii taryf dla ${date}.`);
  }
  if (!Array.isArray(source.fixed) || !Array.isArray(storage.fixed)) {
    throw new Error(`Brak jawnych danych opłat stałych taryfy dla ${date}.`);
  }
  if (!Array.isArray(source.variable) || !Array.isArray(storage.variable)) {
    throw new Error(`Brak jawnych danych stawek zmiennych taryfy dla ${date}.`);
  }
  let tariff = {
    ...source,
    fixed: canonicalNetRows(source.fixed, storage.fixed, 'amount', 'fixed', vatRate),
    variable: canonicalNetRows(source.variable, storage.variable, 'price', 'variable', vatRate),
  } as ClientTariffPayload;
  const sellMethod = (tariff as ClientTariffPayload & { sell_method?: string }).sell_method;
  if (sellMethod === 'rdn') {
    const market = (storage as typeof storage & {
      market?: { margin?: Record<string, unknown>; excise?: Record<string, unknown> };
    }).market;
    for (const [key, field] of [['margin', 'osd_add_rdn'], ['excise', 'osd_add_akcyza']] as const) {
      const component = market?.[key];
      if (!component || typeof component !== 'object') {
        throw new Error(`Brak zweryfikowanej ceny netto dodatku RDN (${key}) dla ${date}.`);
      }
      const net = finite(component.net, `market.${key}.net`);
      const gross = finite(component.gross, `market.${key}.gross`);
      const componentVat = finite(component.vatRate, `market.${key}.vatRate`, 0, 1);
      if (Math.abs(componentVat - vatRate) > 1e-9) {
        throw new Error(`Dodatek RDN ${key} ma inną stawkę VAT niż zbiorcza taryfa.`);
      }
      const raw = finite((source as ClientTariffPayload & Record<string, unknown>)[field], field);
      const close = (left: number, right: number) => Math.abs(left - right) <= 1e-8 * Math.max(1, Math.abs(right));
      if (!close(raw, net) && !close(raw, gross)) {
        throw new Error(`Dodatek RDN ${key} nie odpowiada zweryfikowanym wartościom netto/brutto.`);
      }
      (tariff as ClientTariffPayload & Record<string, unknown>)[field] = net;
    }
  }
  const hasEnergyPrice = tariff.variable.some((row) => isEnergyRow(row)) || sellMethod === 'rdn';
  if (!hasEnergyPrice) throw new Error(`Brak jawnej ceny energii czynnej taryfy dla ${date}.`);
  const hasDistributionPrice = tariff.variable.some((row) => !isEnergyRow(row));
  if (!hasDistributionPrice) throw new Error(`Brak jawnej stawki dystrybucyjnej taryfy dla ${date}.`);
  return tariff;
}

function basisAmount(netAmount: number, vatRate: number, basis: 'NET' | 'GROSS'): number {
  return basis === 'GROSS' ? netAmount * (1 + vatRate) : netAmount;
}

function daysInMonth(date: string): number {
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
}

function componentCategory(label: string, fixed: boolean): OfferBillingComponentCategory {
  const value = normaliseLabel(label);
  if (value.includes('oplata mocowa')) return 'capacity';
  if (value.includes('jako')) return 'quality';
  if (value.includes('oze')) return 'oze';
  if (value.includes('kogener')) return 'cogeneration';
  if (value.includes('handl') || value.includes('komercj')) return 'commercial';
  if (fixed && (value.includes('abonament') || value.includes('subscription'))) return 'subscription';
  if (value.includes('sieci')) return fixed ? 'fixed_network' : 'network';
  return fixed ? 'other_fixed' : 'other_variable';
}

function sumComponentRates(rows: Array<{ ratePlnPerKwh: number }>): number {
  return rows.reduce((sum, row) => sum + row.ratePlnPerKwh, 0);
}

function assertReconciled(actual: number, expected: number, label: string): void {
  const tolerance = 1e-8 * Math.max(1, Math.abs(actual), Math.abs(expected));
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: rozbicie składników nie uzgadnia się z kwotą taryfy.`);
  }
}

function reconcileComponents<T extends { amountPln: number }>(
  components: T[],
  expected: number,
  label: string,
): T[] {
  const sum = components.reduce((total, component) => total + component.amountPln, 0);
  assertReconciled(sum, expected, label);
  if (components.length > 0) components[components.length - 1].amountPln += expected - sum;
  else if (Math.abs(expected) > 1e-10) throw new Error(`${label}: brak składników dla niezerowej kwoty taryfy.`);
  return components;
}

function prepareFixedComponents(
  tariff: ClientTariffPayload,
  date: string,
  context: OfferBillingContext,
  vatRate: number,
  vatBasis: 'NET' | 'GROSS',
  fixedDailyNet: number,
): Array<ComponentRate & { dailyPln: number }> {
  const days = daysInMonth(date);
  const rows = tariff.fixed.flatMap((row, index) => {
    const oneRowTariff = {
      ...tariff,
      fixed: [row],
      variable: tariff.variable.filter((candidate) => !normaliseLabel(candidate.label).includes('oplata mocowa')),
      capacity_charge: undefined,
    } as ClientTariffPayload;
    const dailyNet = ReTariffEngine.fixedDaily(oneRowTariff, date, context);
    if (!Number.isFinite(dailyNet)) throw new Error(`Brak prawidłowej kwoty opłaty stałej ${index} dla ${date}.`);
    if (dailyNet === 0) return [];
    const label = String(row.label || row.component_key || `Opłata stała ${index + 1}`);
    return [{
      componentKey: String(row.component_key || `fixed-${index}`), label,
      category: componentCategory(label, true),
      dailyPln: basisAmount(dailyNet, vatRate, vatBasis),
    }];
  });
  const flatCapacityNet = ReTariffEngine.capacityFlatMonthly(tariff, date, context, true) / days;
  if (!Number.isFinite(flatCapacityNet)) throw new Error(`Brak prawidłowej opłaty mocowej stałej dla ${date}.`);
  if (flatCapacityNet !== 0) {
    rows.push({
      componentKey: 'capacity-charge-flat', label: 'Opłata mocowa', category: 'capacity',
      dailyPln: basisAmount(flatCapacityNet, vatRate, vatBasis),
    });
  }
  const expectedDaily = basisAmount(fixedDailyNet, vatRate, vatBasis);
  assertReconciled(rows.reduce((sum, row) => sum + row.dailyPln, 0), expectedDaily,
    `Opłaty stałe ${date}`);
  return rows;
}

function prepareDistributionComponents(
  tariff: ClientTariffPayload,
  date: string,
  distributionZone: string,
  rate: OfferTariffRateDetails,
  vatRate: number,
  vatBasis: 'NET' | 'GROSS',
): Array<ComponentRate & { ratePlnPerKwh: number }> {
  const rows = tariff.variable.flatMap((row, index) => {
    if (isEnergyRow(row)) return [];
    if (row.window_code !== 'all' && row.window_code !== distributionZone) return [];
    const label = String(row.label || row.component_key || `Składnik dystrybucji ${index + 1}`);
    if (componentCategory(label, false) === 'capacity') return [];
    const amount = finite(row.price, `variable[${index}].price`);
    return [{
      componentKey: String(row.component_key || `variable-${index}`), label,
      category: componentCategory(label, false),
      ratePlnPerKwh: basisAmount(amount, vatRate, vatBasis),
    }];
  });
  if (rate.capacityChargeRate !== 0) {
    rows.push({
      componentKey: 'capacity-charge-variable', label: 'Opłata mocowa', category: 'capacity',
      ratePlnPerKwh: basisAmount(rate.capacityChargeRate, vatRate, vatBasis),
    });
  }
  assertReconciled(sumComponentRates(rows), basisAmount(rate.distribution, vatRate, vatBasis),
    `Stawki dystrybucyjne ${date} ${distributionZone}`);
  return rows;
}

function prepareRates(
  intervals: PreparedInterval[],
  history: ClientTariffHistory,
  context: OfferBillingContext,
  vatBasis: 'NET' | 'GROSS',
  sharedDailyCache = new Map<string, {
    tariff: ClientTariffPayload; fixedDaily: number; vatRate: number;
    fixedComponents: Array<ComponentRate & { dailyPln: number }>;
  }>(),
): RateEntry[] {
  return intervals.map((interval) => {
    let daily = sharedDailyCache.get(interval.local.date);
    if (!daily) {
      const tariff = tariffForDate(history, interval.local.date);
      const vatRate = Number(tariff.pricing.tariffStorage.vatRate);
      const fixedDailyNet = ReTariffEngine.fixedDaily(tariff, interval.local.date, context);
      if (!Number.isFinite(fixedDailyNet) || fixedDailyNet < 0) {
        throw new Error(`Brak prawidłowych danych opłat stałych taryfy dla ${interval.local.date}.`);
      }
      daily = {
        tariff, vatRate, fixedDaily: basisAmount(fixedDailyNet, vatRate, vatBasis),
        fixedComponents: prepareFixedComponents(tariff, interval.local.date, context, vatRate, vatBasis, fixedDailyNet),
      };
      sharedDailyCache.set(interval.local.date, daily);
    }
    const rates = ReTariffEngine.rates(daily.tariff, interval.local.date, interval.local.hour,
      interval.marketPriceNetPlnPerKwh, context);
    if (rates.capacityChargePending) {
      throw new Error(`Brak danych do obliczenia opłaty mocowej dla ${interval.local.date}.`);
    }
    if (!Number.isFinite(rates.energy) || !Number.isFinite(rates.distribution) || rates.distribution < 0) {
      throw new Error(`Brak prawidłowych stawek energii lub dystrybucji dla ${interval.local.date} godz. ${interval.local.hour}.`);
    }
    const rateDetails = rates as typeof rates & OfferTariffRateDetails;
    return {
      tariff: daily.tariff,
      energy: basisAmount(rates.energy, daily.vatRate, vatBasis),
      distribution: basisAmount(rates.distribution, daily.vatRate, vatBasis),
      vatRate: daily.vatRate,
      fixedDaily: daily.fixedDaily,
      energyZone: rateDetails.energyZone,
      distributionZone: rateDetails.distributionZone,
      distributionComponents: prepareDistributionComponents(
        daily.tariff, interval.local.date, rateDetails.distributionZone, rateDetails, daily.vatRate, vatBasis,
      ),
      fixedComponents: daily.fixedComponents,
    };
  });
}

export function priceOfferWorkspaceGrid(input: OfferWorkspaceGridPricingInput): OfferWorkspaceGridPricingResult {
  const issues = new Set<string>();
  const tariffLabels = new Set<string>();
  const result: OfferWorkspaceGridPricingResult = {
    status: 'blocked', vatBasis: input?.vatBasis === 'NET' ? 'NET' : 'GROSS',
    energyPln: null, distributionPln: null, fixedPln: null, exportValuePln: null,
    pricedHours: 0, totalHours: 0, tariffLabels: [], issues: [],
  };
  try {
    if (!input || (input.vatBasis !== 'NET' && input.vatBasis !== 'GROSS')) {
      throw new Error('vatBasis musi być jawnie NET albo GROSS.');
    }
    validateHistory(input.tariffHistory);
    validateContext(input.context);
    if (!Array.isArray(input.intervals) || input.intervals.length > 40000) {
      throw new Error('Nieprawidłowa lista interwałów kosztu energii.');
    }
    const prepared = input.intervals.map((row, index) => {
      if (!row || (row.importKwh == null && row.exportKwh == null)) {
        throw new Error(`Interwał ${index}: brak obu kierunków pomiaru.`);
      }
      return prepareInterval({
        ...row,
        // A missing direction is not billed as zero; zero is used only to resolve the shared tariff rate.
        importKwh: row.importKwh ?? 0,
        exportKwh: row.exportKwh ?? 0,
      }, `intervals[${index}]`);
    });
    const expectedHours = input.totalHours ?? prepared.reduce((sum, row) => sum + (row.end - row.start) / hourMs, 0);
    result.totalHours = finite(expectedHours, 'totalHours', 0);
    const expectedDates = Array.from(new Set([...(input.expectedLocalDates || []), ...prepared.map(row => row.local.date)])).sort();
    const dailyCache = new Map<string, {
      tariff: ClientTariffPayload; fixedDaily: number; vatRate: number;
      fixedComponents: Array<ComponentRate & { dailyPln: number }>;
    }>();
    let energy = 0;
    let distribution = 0;
    let fixed = 0;
    let exportValue = 0;
    let hasEnergy = false;
    let hasDistribution = false;
    let hasFixed = false;
    let hasExportValue = false;
    let pricedDuration = 0;

    for (const date of expectedDates) {
      try {
        const tariff = tariffForDate(input.tariffHistory, date);
        const vatRate = Number(tariff.pricing.tariffStorage.vatRate);
        const dailyNet = ReTariffEngine.fixedDaily(tariff, date, input.context);
        if (!Number.isFinite(dailyNet) || dailyNet < 0) throw new Error(`Brak prawidłowych danych opłat stałych taryfy dla ${date}.`);
        fixed += basisAmount(dailyNet, vatRate, input.vatBasis);
        hasFixed = true;
        dailyCache.set(date, {
          tariff, vatRate, fixedDaily: basisAmount(dailyNet, vatRate, input.vatBasis),
          fixedComponents: prepareFixedComponents(tariff, date, input.context, vatRate, input.vatBasis, dailyNet),
        });
        tariffLabels.add(`${tariff.osd_name || tariff.osd_id} ${tariff.code}`);
      } catch (error) {
        issues.add(`${date}: ${error instanceof Error ? error.message : 'Brak taryfy dla dnia.'}`);
      }
    }

    prepared.forEach((interval, index) => {
      const durationHours = (interval.end - interval.start) / hourMs;
      try {
        const [rate] = prepareRates([interval], input.tariffHistory, input.context, input.vatBasis, dailyCache);
        const source = input.intervals[index];
        if (source.importKwh != null) {
          energy += source.importKwh * rate.energy;
          distribution += source.importKwh * rate.distribution;
          hasEnergy = true;
          hasDistribution = true;
          pricedDuration += durationHours;
        }
        if (source.exportKwh != null && input.settlementMode === 'NET_BILLING') {
          const marketPrice = source.exportPriceNetPlnPerKwh;
          if (source.exportKwh === 0) {
            hasExportValue = true;
          } else if (marketPrice == null || !Number.isFinite(marketPrice)) {
            issues.add(`${interval.startUtc}: brak istniejącej ceny RCE dla eksportu.`);
          } else {
            exportValue += source.exportKwh * basisAmount(Math.max(0, marketPrice), rate.vatRate, input.vatBasis);
            hasExportValue = true;
          }
        }
      } catch (error) {
        issues.add(`${interval.startUtc}: ${error instanceof Error ? error.message : 'Brak stawki dla interwału.'}`);
      }
    });

    result.energyPln = hasEnergy ? energy : null;
    result.distributionPln = hasDistribution ? distribution : null;
    result.fixedPln = hasFixed ? fixed : null;
    result.exportValuePln = hasExportValue ? exportValue : null;
    result.pricedHours = pricedDuration;
    result.tariffLabels = [...tariffLabels];
    const hasAnyValue = hasEnergy || hasDistribution || hasFixed || hasExportValue;
    result.status = !hasAnyValue ? 'blocked'
      : pricedDuration + 1e-9 < result.totalHours || issues.size > 0 ? 'partial' : 'ready';
  } catch (error) {
    issues.add(error instanceof Error ? error.message : 'Nie udało się wycenić kosztu energii.');
  }
  result.issues = [...issues];
  return result;
}

function validateContext(context: OfferBillingContext): void {
  if (!context || typeof context !== 'object') throw new Error('Brak parametrów umowy taryfowej.');
  finite(context.annualUsageKwh, 'annualUsageKwh', 0);
  finite(context.billingCycleMonths, 'billingCycleMonths', 1, 12);
  if (!Number.isInteger(context.billingCycleMonths)) throw new Error('billingCycleMonths musi być liczbą całkowitą.');
  finite(context.connectionPowerKw, 'connectionPowerKw', Number.EPSILON);
}

function validateMeteringPolicy(policy: NetMeteringPolicy, billingCycleMonths: number): void {
  if (!['ENERGY_ONLY', 'ENERGY_AND_VARIABLE_DISTRIBUTION'].includes(policy.coverage)) {
    throw new Error('Net-metering wymaga jawnego zakresu pokrycia energii i dystrybucji zmiennej.');
  }
  if (policy.fixedChargeTreatment !== 'ALWAYS_BILLED') {
    throw new Error('Opłaty stałe nie są kompensowane w tym module; wymagane fixedChargeTreatment: ALWAYS_BILLED.');
  }
  if (policy.hourlyNettingMode !== undefined && policy.hourlyNettingMode !== 'SAME_HOUR_NET_EXCHANGE') {
    throw new Error('Nieznany tryb godzinowego bilansowania importu i eksportu dla net-meteringu.');
  }
  if (policy.variableFeeOpustBasis !== undefined && policy.variableFeeOpustBasis !== 'OZE_CHP_PRE_OPUST') {
    throw new Error('Nieznana podstawa opustu dla zmiennych opłat dystrybucyjnych.');
  }
  if (policy.variableFeeOpustBasis === 'OZE_CHP_PRE_OPUST'
    && policy.hourlyNettingMode !== 'SAME_HOUR_NET_EXCHANGE') {
    throw new Error('Rozdzielenie podstawy opłaty OZE i kogeneracyjnej wymaga wcześniejszego bilansowania w tej samej godzinie.');
  }
  finite(policy.netMeteringRatio, 'netMeteringRatio', Number.EPSILON, 1);
  if (policy.netMeteringRatio !== 0.8 && policy.netMeteringRatio !== 0.7) {
    throw new Error('netMeteringRatio musi jawnie wynosić 0.8 albo 0.7; wybór zależy od mocy instalacji prosumenckiej.');
  }
  finite(policy.initialCreditKwh, 'initialCreditKwh', 0);
  finite(policy.creditExpiryMonths, 'creditExpiryMonths', 12, 12);
  if (policy.billingCycleStartMonth !== undefined && !isMonth(policy.billingCycleStartMonth)) {
    throw new Error('billingCycleStartMonth musi mieć format YYYY-MM.');
  }
  if (billingCycleMonths > 1 && policy.billingCycleStartMonth === undefined) {
    throw new Error('Dla net-meteringu z billingCycleMonths > 1 wymagany jest jawny billingCycleStartMonth.');
  }
  const initialLots = policy.initialCreditLots || [];
  if (policy.initialCreditKwh > 0 && initialLots.length === 0) {
    throw new Error('Dodatnie initialCreditKwh wymaga initialCreditLots z rzeczywistymi datami wygaśnięcia.');
  }
  if (policy.initialCreditKwh === 0 && policy.initialCreditExpiresMonth != null) {
    throw new Error('Przy initialCreditKwh równym zero initialCreditExpiresMonth musi być null.');
  }
  const openingCredit = initialLots.reduce((sum, lot, index) => {
    finite(lot.kwh, `initialCreditLots[${index}].kwh`, 0);
    if (!isMonth(lot.expiresMonth)) throw new Error(`initialCreditLots[${index}].expiresMonth musi być jawny i mieć format YYYY-MM.`);
    return sum + lot.kwh;
  }, 0);
  if (Math.abs(openingCredit - policy.initialCreditKwh) > 0.000001) {
    throw new Error('Suma initialCreditLots musi odpowiadać initialCreditKwh; brak dat części salda blokuje chronologiczne wygasanie.');
  }
}

function validateBillingPolicy(policy: NetBillingPolicy): ValidatedExportPricePeriod[] {
  if (policy.depositCoverage !== 'ENERGY_ONLY') {
    throw new Error('Obsługiwane jest wyłącznie jawne pokrycie depozytem kosztu energii czynnej.');
  }
  if (policy.fixedChargeTreatment !== 'ALWAYS_BILLED') {
    throw new Error('Depozyt nie pokrywa opłat stałych; wymagane fixedChargeTreatment: ALWAYS_BILLED.');
  }
  if (!Array.isArray(policy.initialDeposit)) throw new Error('Brak jawnej listy initialDeposit; pustą listę podaj dla zerowego salda.');
  finite(policy.creditingDelayMonths, 'creditingDelayMonths', 1, 1);
  finite(policy.depositExpiryMonths, 'depositExpiryMonths', 12, 12);
  finite(policy.expiredRefundRate, 'expiredRefundRate', 0, 1);
  if (policy.exportPriceMethod !== 'RCE' && policy.exportPriceMethod !== 'RCEm') {
    throw new Error('exportPriceMethod musi jawnie wskazywać RCE albo RCEm.');
  }
  const maximumRefundRate = policy.exportPriceMethod === 'RCE' ? 0.3 : 0.2;
  if (policy.expiredRefundRate !== 0 && policy.expiredRefundRate !== maximumRefundRate) {
    throw new Error(`Dla ${policy.exportPriceMethod} expiredRefundRate może wynosić 0 albo jawny limit ${maximumRefundRate}.`);
  }
  const hasFifoOrder = policy.initialDeposit.some((lot) => lot.fifoOrder !== undefined);
  if (hasFifoOrder && policy.initialDeposit.some((lot) => lot.fifoOrder === undefined)) {
    throw new Error('Jeśli podajesz fifoOrder, musi być określony dla każdej transzy depozytu.');
  }
  const fifoOrders = new Set<number>();
  policy.initialDeposit.forEach((lot, index) => {
    finite(lot.amountPln, `initialDeposit[${index}].amountPln`, 0);
    if (lot.refundCapPln === null) {
      if (policy.expiredRefundRate > 0) {
        throw new Error(`initialDeposit[${index}].refundCapPln jest nieznany; nie można wznowić z dodatnim expiredRefundRate.`);
      }
    } else {
      finite(lot.refundCapPln, `initialDeposit[${index}].refundCapPln`, 0);
    }
    if (lot.fifoOrder !== undefined) {
      finite(lot.fifoOrder, `initialDeposit[${index}].fifoOrder`, 0);
      if (!Number.isInteger(lot.fifoOrder) || fifoOrders.has(lot.fifoOrder)) {
        throw new Error('fifoOrder każdej transzy musi być unikalną liczbą całkowitą nieujemną.');
      }
      fifoOrders.add(lot.fifoOrder);
    }
    if (!isMonth(lot.creditedMonth) || !isMonth(lot.expiresMonth) || lot.expiresMonth <= lot.creditedMonth) {
      throw new Error(`initialDeposit[${index}]: wymagany prawidłowy miesiąc uznania i późniejszy miesiąc wygaśnięcia.`);
    }
    if (monthOrdinal(lot.expiresMonth) - monthOrdinal(lot.creditedMonth) > policy.depositExpiryMonths) {
      throw new Error(`initialDeposit[${index}]: termin wygaśnięcia przekracza ${policy.depositExpiryMonths} miesięcy ważności depozytu.`);
    }
  });
  if (!Array.isArray(policy.exportUnitPrices)) throw new Error('Brak jawnych okresów cen eksportu.');
  const periods = policy.exportUnitPrices.map((period, index) => {
    const start = utcMillis(period.startUtc, `exportUnitPrices[${index}].startUtc`);
    const end = utcMillis(period.endUtc, `exportUnitPrices[${index}].endUtc`);
    if (end <= start) throw new Error(`exportUnitPrices[${index}]: koniec musi być późniejszy od początku.`);
    const depositCreditPrice = period.depositCreditPricePlnPerKwh;
    finite(depositCreditPrice, `exportUnitPrices[${index}].depositCreditPricePlnPerKwh`, 0);
    if (period.refundCapPricePlnPerKwh !== undefined) {
      finite(period.refundCapPricePlnPerKwh, `exportUnitPrices[${index}].refundCapPricePlnPerKwh`, 0);
    }
    return { start, end, depositCredit: depositCreditPrice, refundCap: period.refundCapPricePlnPerKwh ?? null };
  }).sort((left, right) => left.start - right.start);
  if (policy.expiredRefundRate > 0 && periods.some((period) => period.refundCap === null)) {
    throw new Error('Przy założonym zwrocie wymagane są jawne refundCapPricePlnPerKwh dla wszystkich cen eksportu.');
  }
  for (let index = 1; index < periods.length; index += 1) {
    if (periods[index].start < periods[index - 1].end) throw new Error('Okresy cen eksportu nakładają się.');
  }
  return periods;
}

function exportPriceAt(periods: ValidatedExportPricePeriod[], interval: PreparedInterval) {
  let low = 0;
  let high = periods.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (periods[middle].start <= interval.start) low = middle + 1;
    else high = middle;
  }
  const period = periods[low - 1];
  if (!period || period.start > interval.start || period.end < interval.end) {
    throw new Error(`Brak jednoznacznej ceny eksportu dla interwału ${interval.startUtc}.`);
  }
  return period;
}

export function resolveOfferBillingRates(request: OfferBillingRateRequest): OfferBillingRateResult {
  try {
    if (!request || (request.vatBasis !== 'NET' && request.vatBasis !== 'GROSS')) {
      throw new Error('vatBasis musi być jawnie NET albo GROSS.');
    }
    validateHistory(request.tariffHistory);
    validateContext(request.context);
    const exportPeriods = validateSettlement(request.settlement, request.context);
    const interval = prepareInterval(request.interval, 'interval');
    const [rate] = prepareRates([interval], request.tariffHistory, request.context, request.vatBasis);
    const exportPrice = exportPeriods ? exportPriceAt(exportPeriods, interval) : null;
    return {
      status: 'ready', date: interval.local.date, hour: interval.local.hour,
      energyZone: rate.energyZone, distributionZone: rate.distributionZone,
      energyBuyPlnPerKwh: rate.energy, distributionBuyPlnPerKwh: rate.distribution,
      depositCreditPricePlnPerKwh: exportPrice?.depositCredit ?? null,
      exportPlnPerKwh: exportPrice?.depositCredit ?? null,
      refundCapPricePlnPerKwh: exportPrice?.refundCap ?? null,
      fixedDailyPln: rate.fixedDaily, vatBasis: request.vatBasis,
    };
  } catch (error) {
    return { status: 'blocked', reasons: [error instanceof Error ? error.message : 'Brak stawek dla interwału.'] };
  }
}

export function resolveOfferBillingRateSeries(request: OfferBillingRateSeriesRequest): OfferBillingRateSeriesResult {
  try {
    if (!request || (request.vatBasis !== 'NET' && request.vatBasis !== 'GROSS')) {
      throw new Error('vatBasis musi być jawnie NET albo GROSS.');
    }
    validateHistory(request.tariffHistory);
    validateContext(request.context);
    const exportPeriods = validateSettlement(request.settlement, request.context);
    const intervals = prepareIntervals(request.intervals, 'intervals');
    const entries = prepareRates(intervals, request.tariffHistory, request.context, request.vatBasis);
    const rates = intervals.map((interval, index): OfferBillingResolvedRate => {
      const entry = entries[index];
      const exportPrice = exportPeriods ? exportPriceAt(exportPeriods, interval) : null;
      return {
        status: 'ready', date: interval.local.date, hour: interval.local.hour,
        energyZone: entry.energyZone, distributionZone: entry.distributionZone,
        energyBuyPlnPerKwh: entry.energy, distributionBuyPlnPerKwh: entry.distribution,
        depositCreditPricePlnPerKwh: exportPrice?.depositCredit ?? null,
        exportPlnPerKwh: exportPrice?.depositCredit ?? null,
        refundCapPricePlnPerKwh: exportPrice?.refundCap ?? null,
        fixedDailyPln: entry.fixedDaily, vatBasis: request.vatBasis,
      };
    });
    return { status: 'ready', rates };
  } catch (error) {
    return { status: 'blocked', reasons: [error instanceof Error ? error.message : 'Brak stawek dla interwałów.'] };
  }
}

function emptyInterval(interval: PreparedInterval): OfferBillingIntervalResult {
  return {
    startUtc: interval.startUtc, endUtc: interval.endUtc, month: interval.local.month,
    importKwh: interval.importKwh, exportKwh: interval.exportKwh,
    billedImportKwh: 0, billedExportKwh: 0, energyCostPln: 0, distributionCostPln: 0,
    fixedCostPln: 0, totalCostPln: 0, coveredKwh: 0, coveredEnergyPln: 0,
    coveredDistributionPln: 0,
    exportValuePln: 0, depositEarnedPln: 0, depositUsedPln: 0,
    depositExpiredPln: 0, depositRefundedPln: 0, depositBalancePln: 0,
    pendingDepositPln: 0, creditAddedKwh: 0, creditUsedKwh: 0,
    creditExpiredKwh: 0, creditBalanceKwh: null, cashDuePln: 0,
    distributionComponents: [], fixedComponents: [],
  };
}

function emptyMonth(month: string): OfferBillingMonthResult {
  const { startUtc: _startUtc, endUtc: _endUtc, ...values } = emptyInterval({
    startUtc: '', endUtc: '', importKwh: 0, exportKwh: 0,
    marketPriceNetPlnPerKwh: undefined, start: 0, end: 0,
    local: { date: '', month, hour: 0, minute: 0, offsetMinutes: 0 },
  });
  return values;
}

function addMonthValues(
  target: OfferBillingMonthResult,
  value: Omit<OfferBillingIntervalResult, 'startUtc' | 'endUtc'>,
): void {
  (Object.keys(target) as Array<keyof OfferBillingMonthResult>).forEach((key) => {
    if (key === 'depositBalancePln' || key === 'pendingDepositPln' || key === 'creditBalanceKwh') {
      target[key] = value[key] as never;
    } else if (key === 'distributionComponents' || key === 'fixedComponents') {
      target[key] = addCostComponents(target[key] as OfferBillingCostComponent[] | undefined,
        value[key] as OfferBillingCostComponent[] | undefined) as never;
    } else if (key !== 'month') {
      target[key] = ((target[key] as number) + (value[key] as number)) as never;
    }
  });
}

function addCostComponents(
  target: OfferBillingCostComponent[] | undefined,
  values: OfferBillingCostComponent[] | undefined,
): OfferBillingCostComponent[] {
  const result = target || [];
  for (const component of values || []) {
    const existing = result.find((entry) => entry.componentKey === component.componentKey
      && entry.category === component.category && entry.label === component.label);
    if (existing) existing.amountPln += component.amountPln;
    else result.push({ ...component });
  }
  return result;
}

function sumMonths(months: OfferBillingMonthResult[]): Omit<OfferBillingMonthResult, 'month'> {
  const total = emptyMonth('');
  for (const month of months) addMonthValues(total, month);
  const { month: _month, ...values } = total;
  return values;
}

function allocateFixed(intervals: PreparedInterval[], rates: RateEntry[], results: OfferBillingIntervalResult[]): void {
  const dayGroups = new Map<string, number[]>();
  intervals.forEach((interval, index) => {
    const group = dayGroups.get(interval.local.date) || [];
    group.push(index);
    dayGroups.set(interval.local.date, group);
  });
  for (const [date, indices] of dayGroups) {
    const duration = indices.reduce((sum, index) => sum + intervals[index].end - intervals[index].start, 0);
    if (duration !== 23 * hourMs && duration !== 24 * hourMs && duration !== 25 * hourMs) {
      throw new Error(`Niepełne pokrycie lokalnej doby ${date}; nie można rozdzielić opłat stałych.`);
    }
    const daily = rates[indices[0]].fixedDaily;
    for (const index of indices) {
      const share = (intervals[index].end - intervals[index].start) / duration;
      results[index].fixedCostPln = daily * share;
      results[index].fixedComponents = reconcileComponents(rates[indices[0]].fixedComponents.map((component) => ({
        componentKey: component.componentKey, label: component.label, category: component.category,
        amountPln: component.dailyPln * share,
      })), results[index].fixedCostPln, `Opłaty stałe ${date}`);
      results[index].totalCostPln += results[index].fixedCostPln;
      results[index].cashDuePln += results[index].fixedCostPln;
    }
  }
}

function finishScenario(results: OfferBillingIntervalResult[]): OfferBillingScenarioResult {
  const assertComponentSums = (value: {
    distributionCostPln: number; fixedCostPln: number;
    distributionComponents?: OfferBillingCostComponent[]; fixedComponents?: OfferBillingCostComponent[];
  }, label: string) => {
    assertReconciled((value.distributionComponents || []).reduce((sum, component) => sum + component.amountPln, 0),
      value.distributionCostPln, `${label} dystrybucja`);
    assertReconciled((value.fixedComponents || []).reduce((sum, component) => sum + component.amountPln, 0),
      value.fixedCostPln, `${label} opłaty stałe`);
  };
  results.forEach((result, index) => assertComponentSums(result, `Interwał ${index}`));
  const months = new Map<string, OfferBillingMonthResult>();
  for (const result of results) {
    const month = months.get(result.month) || emptyMonth(result.month);
    addMonthValues(month, result);
    months.set(result.month, month);
  }
  const orderedMonths = Array.from(months.values());
  orderedMonths.forEach((month) => assertComponentSums(month, `Miesiąc ${month.month}`));
  const totals = sumMonths(orderedMonths);
  assertComponentSums(totals, 'Suma okresu');
  return { intervals: results, months: orderedMonths, totals };
}

function attachDistributionComponents(
  intervals: PreparedInterval[],
  rates: RateEntry[],
  results: OfferBillingIntervalResult[],
  settlement: BillingPolicy,
): void {
  intervals.forEach((interval, index) => {
    const result = results[index];
    const billedDistributionKwh = settlement.mode !== 'NET_METERING'
      ? result.billedImportKwh
      : settlement.coverage === 'ENERGY_AND_VARIABLE_DISTRIBUTION'
        ? Math.max(0, interval.importKwh - result.coveredKwh)
        : interval.importKwh;
    result.distributionComponents = reconcileComponents(rates[index].distributionComponents.map((component) => ({
      componentKey: component.componentKey,
      label: component.label,
      category: component.category,
      amountPln: component.ratePlnPerKwh * billedDistributionKwh,
    })), result.distributionCostPln, `Dystrybucja ${interval.startUtc}`);
  });
}

function buildIntervalTariffs(intervals: PreparedInterval[], rates: RateEntry[]): OfferBillingIntervalTariff[] {
  const periods: OfferBillingIntervalTariff[] = [];
  intervals.forEach((interval, index) => {
    const rate = rates[index];
    const current: OfferBillingIntervalTariff = {
      startUtc: interval.startUtc, endUtc: interval.endUtc,
      energyZone: rate.energyZone, distributionZone: rate.distributionZone,
      energyRatePlnPerKwh: rate.energy, distributionRatePlnPerKwh: rate.distribution,
    };
    const previous = periods[periods.length - 1];
    if (previous && previous.endUtc === current.startUtc
      && previous.energyZone === current.energyZone
      && previous.distributionZone === current.distributionZone
      && previous.energyRatePlnPerKwh === current.energyRatePlnPerKwh
      && previous.distributionRatePlnPerKwh === current.distributionRatePlnPerKwh) {
      previous.endUtc = current.endUtc;
    } else {
      periods.push(current);
    }
  });
  return periods;
}

function runNetBilling(
  policy: NetBillingPolicy,
  intervals: PreparedInterval[],
  rates: RateEntry[],
  exportPeriods: ValidatedExportPricePeriod[],
  vatBasis: 'NET' | 'GROSS',
): OfferBillingScenarioResult {
  const results = intervals.map(emptyInterval);
  allocateFixed(intervals, rates, results);
  const months = Array.from(new Set(intervals.map((interval) => interval.local.month)));
  const active: LedgerLot[] = [];
  const pending: LedgerLot[] = policy.initialDeposit.map((lot, order) => ({
    amount: lot.amountPln, creditedMonth: lot.creditedMonth, expiresMonth: lot.expiresMonth,
    refundCap: lot.refundCapPln, order: lot.fifoOrder ?? order,
  }));
  let nextOrder = pending.reduce((next, lot) => Math.max(next, lot.order + 1), 0);

  const intervalIndicesByMonth = new Map<string, number[]>();
  intervals.forEach((interval, index) => {
    const indices = intervalIndicesByMonth.get(interval.local.month) || [];
    indices.push(index);
    intervalIndicesByMonth.set(interval.local.month, indices);
  });

  for (const month of months) {
    const allLots = [...active, ...pending];
    const expired = allLots.filter((lot) => lot.expiresMonth <= month);
    const live = allLots.filter((lot) => lot.expiresMonth > month);
    active.splice(0, active.length, ...live.filter((lot) => lot.creditedMonth <= month));
    pending.splice(0, pending.length, ...live.filter((lot) => lot.creditedMonth > month));
    active.sort((left, right) => left.creditedMonth.localeCompare(right.creditedMonth) || left.order - right.order);

    let monthExpired = 0;
    let monthRefunded = 0;
    for (const lot of expired) {
      if (lot.amount > 0 && policy.expiredRefundRate > 0 && lot.refundCap === null) {
        throw new Error(`Brak podstawy limitu zwrotu depozytu dla transzy uznanej w ${lot.creditedMonth}.`);
      }
      const refund = policy.expiredRefundRate === 0 ? 0
        : Math.min(lot.amount, lot.refundCap! * policy.expiredRefundRate);
      monthRefunded += refund;
      monthExpired += lot.amount - refund;
    }
    let monthExportValue = 0;
    let monthRefundCap: number | null = 0;
    let uncreditedEarned = 0;
    const monthIndices = intervalIndicesByMonth.get(month) || [];
    if (monthIndices.length) {
      results[monthIndices[0]].depositExpiredPln = monthExpired;
      results[monthIndices[0]].depositRefundedPln = monthRefunded;
    }

    const hourlyGroups = new Map<string, number[]>();
    for (const index of monthIndices) {
      const local = intervals[index].local;
      const key = `${local.date}T${String(local.hour).padStart(2, '0')}@${local.offsetMinutes}`;
      const group = hourlyGroups.get(key) || [];
      group.push(index);
      hourlyGroups.set(key, group);
    }

    for (const indices of hourlyGroups.values()) {
      const physicalImport = indices.reduce((sum, index) => sum + intervals[index].importKwh, 0);
      const physicalExport = indices.reduce((sum, index) => sum + intervals[index].exportKwh, 0);
      const billedImport = Math.max(physicalImport - physicalExport, 0);
      const billedExport = Math.max(physicalExport - physicalImport, 0);
      for (const index of indices) {
        const interval = intervals[index];
        const result = results[index];
        const billedImportShare = physicalImport > 0 ? billedImport * interval.importKwh / physicalImport : 0;
        const billedExportShare = physicalExport > 0 ? billedExport * interval.exportKwh / physicalExport : 0;
        result.billedImportKwh = billedImportShare;
        result.billedExportKwh = billedExportShare;

        const rate = rates[index];
        const grossEnergyCost = billedImportShare * rate.energy;
        const distributionCost = billedImportShare * rate.distribution;
        let remainingEnergyCost = grossEnergyCost;
        let used = 0;
        for (const lot of active) {
          if (remainingEnergyCost <= 0) break;
          const amount = Math.min(lot.amount, remainingEnergyCost);
          lot.amount -= amount;
          remainingEnergyCost -= amount;
          used += amount;
        }
        result.energyCostPln = remainingEnergyCost;
        result.distributionCostPln = distributionCost;
        result.totalCostPln += remainingEnergyCost + distributionCost;
        result.depositUsedPln = used;
        result.coveredEnergyPln = used;
        const exportPrice = billedExportShare > 0 ? exportPriceAt(exportPeriods, interval) : null;
        result.depositEarnedPln = billedExportShare * (exportPrice?.depositCredit ?? 0);
        result.exportValuePln = result.depositEarnedPln;
        result.cashDuePln += remainingEnergyCost + distributionCost;
        monthExportValue += result.exportValuePln;
        if (billedExportShare > 0 && exportPrice?.refundCap === null) monthRefundCap = null;
        else if (monthRefundCap !== null) monthRefundCap += billedExportShare * (exportPrice?.refundCap ?? 0);
        uncreditedEarned += result.depositEarnedPln;
        result.depositBalancePln = active.reduce((sum, lot) => sum + lot.amount, 0);
        result.pendingDepositPln = pending.reduce((sum, lot) => sum + lot.amount, 0) + uncreditedEarned;
      }
    }
    const exportValue = monthExportValue;
    if (exportValue > 0) {
      const creditedMonth = addMonth(month, policy.creditingDelayMonths);
      pending.push({
        amount: exportValue,
        creditedMonth,
        expiresMonth: addMonth(creditedMonth, policy.depositExpiryMonths),
        refundCap: monthRefundCap,
        order: nextOrder++,
      });
    }
    const balance = active.reduce((sum, lot) => sum + lot.amount, 0);
    const pendingBalance = pending.reduce((sum, lot) => sum + lot.amount, 0);
    const lastIndex = monthIndices.at(-1);
    if (lastIndex !== undefined) {
      results[lastIndex].depositBalancePln = balance;
      results[lastIndex].pendingDepositPln = pendingBalance;
    }
  }
  attachDistributionComponents(intervals, rates, results, policy);
  const result = finishScenario(results);
  const lots: OfferNetBillingContinuationLot[] = [
    ...active.map((lot) => ({ lot, status: 'active' as const })),
    ...pending.map((lot) => ({ lot, status: 'pending' as const })),
  ].filter(({ lot }) => lot.amount > 0)
    .sort((left, right) => left.lot.order - right.lot.order)
    .map(({ lot, status }) => ({
      amountPln: lot.amount,
      creditedMonth: lot.creditedMonth,
      expiresMonth: lot.expiresMonth,
      refundCapPln: lot.refundCap,
      fifoOrder: lot.order,
      status,
    }));
  result.netBillingContinuation = {
    mode: 'NET_BILLING', currency: 'PLN', vatBasis,
    period: { startUtc: intervals[0].startUtc, endUtc: intervals[intervals.length - 1].endUtc },
    lots,
  };
  return result;
}

function monthOrdinal(month: string): number {
  const [year, value] = month.split('-').map(Number);
  return year * 12 + value - 1;
}

function monthFromOrdinal(value: number): string {
  const year = Math.floor(value / 12);
  const month = value - year * 12;
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function validateMeteringRange(
  policy: NetMeteringPolicy,
  intervals: PreparedInterval[],
  billingCycleMonths: number,
): void {
  if (billingCycleMonths === 1) return;
  const startMonth = intervals[0].local.month;
  const endLocal = localParts(intervals[intervals.length - 1].end);
  const startOffset = monthOrdinal(startMonth) - monthOrdinal(policy.billingCycleStartMonth!);
  if (startOffset < 0 || startOffset % billingCycleMonths !== 0
    || intervals[0].local.date !== `${startMonth}-01`
    || endLocal.date.slice(8) !== '01') {
    throw new Error('Cykl net-meteringu >1 miesiąca wymaga pełnych cykli z granicami wynikającymi z billingCycleStartMonth.');
  }
  const cycleSpan = monthOrdinal(endLocal.month) - monthOrdinal(startMonth);
  if (cycleSpan <= 0 || cycleSpan % billingCycleMonths !== 0) {
    throw new Error('Zakres net-meteringu musi obejmować całkowitą liczbę pełnych, zakotwiczonych cykli rozliczeniowych.');
  }
}

type NetMeteringHourlyFlow = { importKwh: number; exportKwh: number };

function balanceNetMeteringHourlyFlows(
  policy: NetMeteringPolicy,
  intervals: PreparedInterval[],
): NetMeteringHourlyFlow[] {
  const flows = intervals.map((interval) => ({ importKwh: interval.importKwh, exportKwh: interval.exportKwh }));
  if (policy.hourlyNettingMode !== 'SAME_HOUR_NET_EXCHANGE') return flows;

  const groups = new Map<string, number[]>();
  intervals.forEach((interval, index) => {
    const local = interval.local;
    const key = `${local.date}T${String(local.hour).padStart(2, '0')}@${local.offsetMinutes}`;
    const indices = groups.get(key) || [];
    indices.push(index);
    groups.set(key, indices);
  });

  for (const indices of groups.values()) {
    const imported = indices.reduce((sum, index) => sum + intervals[index].importKwh, 0);
    const exported = indices.reduce((sum, index) => sum + intervals[index].exportKwh, 0);
    const netImport = Math.max(imported - exported, 0);
    const netExport = Math.max(exported - imported, 0);
    const allocateDirection = (direction: 'importKwh' | 'exportKwh', measured: number, net: number) => {
      const contributing = indices.filter((index) => intervals[index][direction] > 0);
      let allocated = 0;
      contributing.forEach((index, position) => {
        const share = position === contributing.length - 1
          ? Math.max(0, net - allocated)
          : net * intervals[index][direction] / measured;
        flows[index][direction] = share;
        allocated += share;
      });
    };
    allocateDirection('importKwh', imported, netImport);
    allocateDirection('exportKwh', exported, netExport);
  }
  return flows;
}

function netMeteringDistributionCharges(
  rate: RateEntry,
  policy: NetMeteringPolicy,
  postHourImportKwh: number,
  postOpustImportKwh: number,
  coveredKwh: number,
): { costPln: number; coveredPln: number; components: OfferBillingCostComponent[] } {
  const opustCoversDistribution = policy.coverage === 'ENERGY_AND_VARIABLE_DISTRIBUTION';
  if (policy.variableFeeOpustBasis !== 'OZE_CHP_PRE_OPUST') {
    const coveredPln = opustCoversDistribution ? coveredKwh * rate.distribution : 0;
    const costPln = postHourImportKwh * rate.distribution - coveredPln;
    const billedKwh = opustCoversDistribution ? postOpustImportKwh : postHourImportKwh;
    const components = rate.distributionComponents.map((component) => ({
      componentKey: component.componentKey,
      label: component.label,
      category: component.category,
      amountPln: component.ratePlnPerKwh * billedKwh,
    }));
    return { costPln, coveredPln, components };
  }
  let costPln = 0;
  let coveredPln = 0;
  const components = rate.distributionComponents.map((component) => {
    const opustExempt = component.category === 'oze' || component.category === 'cogeneration';
    const billedKwh = opustCoversDistribution && !opustExempt
      ? postOpustImportKwh : postHourImportKwh;
    const amountPln = component.ratePlnPerKwh * billedKwh;
    costPln += amountPln;
    if (opustCoversDistribution && !opustExempt) {
      coveredPln += component.ratePlnPerKwh * coveredKwh;
    }
    return {
      componentKey: component.componentKey,
      label: component.label,
      category: component.category,
      amountPln,
    };
  });
  return { costPln, coveredPln, components };
}

function runNetMetering(
  policy: NetMeteringPolicy,
  intervals: PreparedInterval[],
  rates: RateEntry[],
  billingCycleMonths: number,
): OfferBillingScenarioResult {
  const results = intervals.map(emptyInterval);
  allocateFixed(intervals, rates, results);
  validateMeteringRange(policy, intervals, billingCycleMonths);
  const hourlyFlows = balanceNetMeteringHourlyFlows(policy, intervals);
  const initialLots = policy.initialCreditLots || [];
  const credits: Array<{ kwh: number; expiresMonth: string; order: number }> = initialLots
    .map((lot, order) => ({ ...lot, order: order - initialLots.length }));
  let nextOrder = 0;
  const anchorOrdinal = policy.billingCycleStartMonth ? monthOrdinal(policy.billingCycleStartMonth) : null;
  const cycleGroups = new Map<string, number[]>();
  intervals.forEach((interval, index) => {
    const monthPosition = monthOrdinal(interval.local.month);
    const cycleStart = billingCycleMonths === 1
      ? interval.local.month
      : monthFromOrdinal(anchorOrdinal! + Math.floor((monthPosition - anchorOrdinal!) / billingCycleMonths) * billingCycleMonths);
    const indices = cycleGroups.get(cycleStart) || [];
    indices.push(index);
    cycleGroups.set(cycleStart, indices);
  });

  for (const [cycleStart, indices] of cycleGroups) {
    const cycleEnd = addMonth(cycleStart, billingCycleMonths);
    let expiredKwh = 0;
    for (let index = credits.length - 1; index >= 0; index -= 1) {
      if (credits[index].expiresMonth <= cycleStart) {
        expiredKwh += credits[index].kwh;
        credits.splice(index, 1);
      } else if (credits[index].expiresMonth < cycleEnd) {
        throw new Error(`Transza opustu wygasa wewnątrz cyklu ${cycleStart}–${cycleEnd}; wymagane jest rozliczenie okresu dokładniejszego niż miesiąc.`);
      }
    }

    const monthlyExports = new Map<string, number>();
    let cycleImports = 0;
    for (const index of indices) {
      const interval = intervals[index];
      const flow = hourlyFlows[index];
      cycleImports += flow.importKwh;
      monthlyExports.set(interval.local.month,
        (monthlyExports.get(interval.local.month) || 0) + flow.exportKwh);
    }
    for (const [month, exportedKwh] of monthlyExports) {
      if (exportedKwh <= 0) continue;
      credits.push({ kwh: exportedKwh * policy.netMeteringRatio,
        expiresMonth: addMonth(month, policy.creditExpiryMonths + 1), order: nextOrder++ });
    }

    credits.sort((left, right) => left.expiresMonth.localeCompare(right.expiresMonth) || left.order - right.order);
    let importsToCover = cycleImports;
    let coveredTotal = 0;
    for (const lot of credits) {
      if (importsToCover <= 0) break;
      const used = Math.min(lot.kwh, importsToCover);
      lot.kwh -= used;
      importsToCover -= used;
      coveredTotal += used;
    }
    for (let index = credits.length - 1; index >= 0; index -= 1) {
      if (credits[index].kwh <= Number.EPSILON) credits.splice(index, 1);
    }

    let coverageRemaining = coveredTotal;
    for (const index of indices) {
      const interval = intervals[index];
      const flow = hourlyFlows[index];
      const result = results[index];
      const covered = Math.min(flow.importKwh, coverageRemaining);
      coverageRemaining -= covered;
      const billedImport = flow.importKwh - covered;
      const rate = rates[index];
      const distributionCharges = netMeteringDistributionCharges(rate, policy, flow.importKwh, billedImport, covered);
      const energy = billedImport * rate.energy;
      result.billedImportKwh = billedImport;
      result.billedExportKwh = flow.exportKwh;
      result.coveredKwh = covered;
      result.coveredEnergyPln = covered * rate.energy;
      result.coveredDistributionPln = distributionCharges.coveredPln;
      result.energyCostPln = energy;
      result.distributionCostPln = distributionCharges.costPln;
      result.distributionComponents = reconcileComponents(distributionCharges.components,
        distributionCharges.costPln, `Dystrybucja ${interval.startUtc}`);
      result.totalCostPln += energy + distributionCharges.costPln;
      result.cashDuePln += energy + distributionCharges.costPln;
      result.creditExpiredKwh = index === indices[0] ? expiredKwh : 0;
      result.creditUsedKwh = covered;
      result.creditAddedKwh = flow.exportKwh * policy.netMeteringRatio;
    }
    const cycleBalance = credits.reduce((sum, lot) => sum + lot.kwh, 0);
    const lastIndex = indices[indices.length - 1];
    results[lastIndex].creditBalanceKwh = cycleBalance;
  }
  return finishScenario(results);
}

function runGridImport(intervals: PreparedInterval[], rates: RateEntry[]): OfferBillingScenarioResult {
  if (intervals.some(interval => interval.exportKwh !== 0)) {
    throw new Error('Rozliczenie zakupu z sieci bez PV wymaga zerowego eksportu.');
  }
  const results = intervals.map(emptyInterval);
  allocateFixed(intervals, rates, results);
  intervals.forEach((interval, index) => {
    const result = results[index];
    result.billedImportKwh = interval.importKwh;
    result.billedExportKwh = 0;
    result.energyCostPln = interval.importKwh * rates[index].energy;
    result.distributionCostPln = interval.importKwh * rates[index].distribution;
    result.totalCostPln += result.energyCostPln + result.distributionCostPln;
    result.cashDuePln += result.energyCostPln + result.distributionCostPln;
  });
  attachDistributionComponents(intervals, rates, results, { mode: 'GRID_IMPORT' });
  return finishScenario(results);
}

function validateSettlement(
  policy: BillingPolicy,
  context: OfferBillingContext,
): ValidatedExportPricePeriod[] | null {
  if (!policy || !['NET_METERING', 'NET_BILLING', 'GRID_IMPORT'].includes(policy.mode)) {
    throw new Error('Nieznany tryb rozliczenia energii.');
  }
  if (policy.mode === 'GRID_IMPORT') return null;
  if (policy.mode === 'NET_METERING') {
    validateMeteringPolicy(policy, context.billingCycleMonths);
    return null;
  }
  return validateBillingPolicy(policy);
}

function billScenario(
  input: OfferWorkspaceBillingScenarioInput & { context: OfferBillingContext; vatBasis: 'NET' | 'GROSS' },
  label: string,
): OfferWorkspaceScenarioResult {
  validateHistory(input.tariffHistory);
  const exportPeriods = validateSettlement(input.settlement, input.context);
  const intervals = prepareIntervals(input.intervals, label);
  const rates = prepareRates(intervals, input.tariffHistory, input.context, input.vatBasis);
  const result = input.settlement.mode === 'GRID_IMPORT' ? runGridImport(intervals, rates)
    : input.settlement.mode === 'NET_METERING'
    ? runNetMetering(input.settlement, intervals, rates, input.context.billingCycleMonths)
    : runNetBilling(input.settlement, intervals, rates, exportPeriods || [], input.vatBasis);
  result.intervalTariffs = buildIntervalTariffs(intervals, rates);
  const warnings = input.settlement.mode === 'GRID_IMPORT' ? [] : input.settlement.mode === 'NET_METERING'
    ? ['Wynik net-meteringu jest modelem rozliczenia cyklu, nie dokładnym odtworzeniem faktury: eksporty z całego jawnego cyklu są przeliczane współczynnikiem i mogą pokryć wcześniejszy import w tym samym cyklu; eksport z kolejnego, już odrębnego cyklu nie koryguje wstecz poprzedniego rachunku.',
      ...(input.settlement.hourlyNettingMode === 'SAME_HOUR_NET_EXCHANGE'
        ? ['Import i eksport są najpierw bilansowane w każdej lokalnej godzinie; surowe pomiary pozostają zachowane w wyniku.']
        : []),
      ...(input.settlement.variableFeeOpustBasis === 'OZE_CHP_PRE_OPUST'
        ? ['Opłaty OZE i kogeneracyjna są liczone od importu po bilansowaniu godzinowym, przed opustem; pozostałe zmienne opłaty dystrybucyjne korzystają z ilości po opuście.']
        : []),
      ...(input.context.billingCycleMonths > 1
        ? ['Salda miesięczne wewnątrz wielomiesięcznego cyklu pozostają null do jego zamknięcia; koszty są alokacją wyniku cyklu, nie miesięcznym odczytem faktury.']
        : []),
      ...(input.context.billingCycleMonths === 1
        && (intervals[0].local.date.slice(8) !== '01'
          || localParts(intervals[intervals.length - 1].end).date.slice(8) !== '01')
        ? ['Zakres obejmuje tylko fragment co najmniej jednego miesięcznego cyklu; brakujące interwały mogą zmienić saldo i kompensację.']
        : []),
      ...(input.settlement.initialCreditKwh === 0
        ? ['Saldo początkowe wynosi 0 kWh; historyczne kredyty nieuwzględnione przez initialCreditLots nie pokryją importu na początku zakresu.']
        : [])]
    : [
      'Net-billing używa miesięcznych granic uznania i wygaśnięcia depozytu; dokładne daty księgowania, faktury i wypłaty sprzedawcy nie są odtwarzane.',
      ...(input.settlement.exportPriceMethod === 'RCE'
        && intervals.some(interval => interval.end - interval.start > 15 * 60 * 1000)
        ? ['Cena eksportu RCE została podana dla interwału dłuższego niż 15 minut; wynik nie odtwarza dokładnie rozliczenia dla okresów niezbilansowania.']
        : []),
      ...(input.settlement.expiredRefundRate > 0
        ? [`Zwrot ${input.settlement.expiredRefundRate * 100}% przy wygaśnięciu jest założeniem maksymalnego zwrotu, nie gwarancją sprzedawcy.`]
        : []),
    ];
  return {
    status: 'ready', settlement: input.settlement.mode, vatBasis: input.vatBasis,
    period: { startUtc: intervals[0].startUtc, endUtc: intervals[intervals.length - 1].endUtc },
    warnings, result,
  };
}

export function billOfferWorkspaceScenario(
  input: OfferWorkspaceBillingScenarioInput & { context: OfferBillingContext; vatBasis: 'NET' | 'GROSS' },
): OfferWorkspaceScenarioResult | { status: 'blocked'; reasons: string[] } {
  try {
    if (!input || typeof input !== 'object') throw new Error('Brak danych do rozliczenia oferty.');
    validateContext(input.context);
    if (input.vatBasis !== 'NET' && input.vatBasis !== 'GROSS') throw new Error('vatBasis musi być jawnie NET albo GROSS.');
    return billScenario(input, 'scenario');
  } catch (error) {
    return { status: 'blocked', reasons: [error instanceof Error ? error.message : 'Nie udało się rozliczyć taryfy.'] };
  }
}

export function continueOfferNetBillingScenario(
  previous: OfferWorkspaceScenarioResult,
  next: OfferWorkspaceBillingScenarioInput & { context: OfferBillingContext; vatBasis: 'NET' | 'GROSS' },
): OfferWorkspaceScenarioResult | { status: 'blocked'; reasons: string[] } {
  try {
    const state = previous?.result?.netBillingContinuation;
    if (previous?.settlement !== 'NET_BILLING' || !state) {
      throw new Error('Poprzedni okres nie zawiera stanu kontynuacji net-billing.');
    }
    if (next?.settlement?.mode !== 'NET_BILLING' || state.mode !== 'NET_BILLING') {
      throw new Error('Kontynuacja wymaga trybu NET_BILLING w obu okresach.');
    }
    if (state.currency !== 'PLN' || state.vatBasis !== previous.vatBasis || state.vatBasis !== next.vatBasis) {
      throw new Error('Kontynuacja wymaga tej samej waluty PLN i tej samej podstawy NET/GROSS co poprzedni okres.');
    }
    if (!Array.isArray(previous.result.intervals) || previous.result.intervals.length === 0) {
      throw new Error('Poprzedni okres nie zawiera interwałów do weryfikacji granic.');
    }

    const previousStart = utcMillis(previous.period.startUtc, 'previous.period.startUtc');
    const previousEnd = utcMillis(previous.period.endUtc, 'previous.period.endUtc');
    const stateStart = utcMillis(state.period.startUtc, 'netBillingContinuation.period.startUtc');
    const stateEnd = utcMillis(state.period.endUtc, 'netBillingContinuation.period.endUtc');
    const previousFirst = utcMillis(previous.result.intervals[0].startUtc, 'previous.result.intervals[0].startUtc');
    const previousLast = utcMillis(previous.result.intervals.at(-1)!.endUtc, 'previous.result.intervals[last].endUtc');
    if (stateStart !== previousStart || stateEnd !== previousEnd || previousFirst !== previousStart || previousLast !== previousEnd) {
      throw new Error('Stan transz nie odpowiada dokładnie zakresowi poprzedniego rozliczenia.');
    }
    if (!isWarsawMonthBoundary(previousStart) || !isWarsawMonthBoundary(previousEnd)) {
      throw new Error('Kontynuacja wymaga pełnych granic miesięcy Europe/Warsaw w poprzednim okresie.');
    }

    const intervals = prepareIntervals(next.intervals, 'continuation');
    const nextStart = intervals[0].start;
    const nextEnd = intervals[intervals.length - 1].end;
    if (!isWarsawMonthBoundary(nextStart) || !isWarsawMonthBoundary(nextEnd)) {
      throw new Error('Kontynuacja wymaga pełnych granic miesięcy Europe/Warsaw w następnym okresie.');
    }
    if (nextStart !== previousEnd) {
      throw new Error('Okresy kontynuacji muszą stykać się dokładnie; luka lub nakładanie blokuje symulację.');
    }
    if (next.settlement.initialDeposit.length !== 0) {
      throw new Error('Przy kontynuacji initialDeposit musi być pusty; saldo zostanie przeniesione ze snapshotu.');
    }

    const lastCoveredMonth = localParts(previousEnd - 1).month;
    const fifoOrders = new Set<number>();
    for (const [index, lot] of state.lots.entries()) {
      finite(lot.amountPln, `netBillingContinuation.lots[${index}].amountPln`, 0);
      if (lot.amountPln === 0) throw new Error(`Stan transzy ${index} musi zawierać dodatnią pozostałą kwotę.`);
      if (!isMonth(lot.creditedMonth) || !isMonth(lot.expiresMonth)
        || lot.expiresMonth <= lot.creditedMonth || lot.expiresMonth <= lastCoveredMonth) {
        throw new Error(`Stan transzy ${index} ma nieprawidłowe lub już wygasłe daty.`);
      }
      if (lot.refundCapPln !== null) finite(lot.refundCapPln, `netBillingContinuation.lots[${index}].refundCapPln`, 0);
      if (lot.refundCapPln === null && next.settlement.expiredRefundRate > 0) {
        throw new Error(`Transza ${index} nie ma znanego refundCap; wznowienie z dodatnim expiredRefundRate jest zablokowane.`);
      }
      finite(lot.fifoOrder, `netBillingContinuation.lots[${index}].fifoOrder`, 0);
      if (!Number.isInteger(lot.fifoOrder) || fifoOrders.has(lot.fifoOrder)) {
        throw new Error('Snapshot ma nieunikalną lub nieprawidłową kolejność FIFO.');
      }
      fifoOrders.add(lot.fifoOrder);
      const expectedStatus = lot.creditedMonth <= lastCoveredMonth ? 'active' : 'pending';
      if (lot.status !== expectedStatus) throw new Error(`Status transzy ${index} nie odpowiada jej dacie uznania.`);
    }

    const initialDeposit: OfferBillingDepositLot[] = [...state.lots]
      .sort((left, right) => left.fifoOrder - right.fifoOrder)
      .map(({ status: _status, ...lot }) => lot);
    return billOfferWorkspaceScenario({
      ...next,
      settlement: { ...next.settlement, initialDeposit },
    });
  } catch (error) {
    return { status: 'blocked', reasons: [error instanceof Error ? error.message : 'Nie udało się wznowić rozliczenia depozytu.'] };
  }
}

export function calculateOfferWorkspaceBilling(input: OfferWorkspaceBillingInput): OfferWorkspaceBillingResult {
  try {
    if (!input || typeof input !== 'object') throw new Error('Brak danych do porównania oferty.');
    validateContext(input.context);
    if (input.vatBasis !== 'NET' && input.vatBasis !== 'GROSS') throw new Error('vatBasis musi być jawnie NET albo GROSS.');
    const baselineIntervals = prepareIntervals(input.baseline.intervals, 'baseline');
    const afterIntervals = prepareIntervals(input.after.intervals, 'after');
    if (baselineIntervals.length !== afterIntervals.length
      || baselineIntervals.some((interval, index) => interval.start !== afterIntervals[index].start || interval.end !== afterIntervals[index].end)) {
      throw new Error('Baseline i after muszą używać identycznego, kompletnego zakresu interwałów.');
    }
    const baseline = billScenario({ ...input.baseline, context: input.context, vatBasis: input.vatBasis }, 'baseline');
    const after = billScenario({ ...input.after, context: input.context, vatBasis: input.vatBasis }, 'after');
    return { status: 'ready', vatBasis: input.vatBasis, baseline, after };
  } catch (error) {
    return { status: 'blocked', reasons: [error instanceof Error ? error.message : 'Nie udało się porównać rozliczeń.'] };
  }
}
