import { energyInvoicesInAnalysisPeriod } from './client-energy-summary';
import { blockedClientEnergyCostSummary, buildClientEnergyCostSummary } from './client-energy-cost-summary';
import { callClientTariffs, clientTariffScope } from './client-tariffs-server';
import { tariffToday, type ClientTariffData, type ClientTariffHistory, type ClientTariffPayload, type ClientTariffPeriod } from './client-tariffs';
import { currentScenario, hourlyMarketPrices } from './offer-workspace-valuation-server';
import { billOfferWorkspaceScenario, canonicalNetRows, priceOfferWorkspaceGrid, type NetBillingPolicy, type NetMeteringPolicy } from './offer-workspace-billing';
import type { OfferMeasurementSeries } from './offer-measurements';
import { prisma } from './prisma';

type AnalysisPeriod = { startMonth: string; endMonth: string; endDate: string; fromUtc: string; untilUtc: string; periodKeys: string[] };
export type ClientEnergyCostSummaryProject = {
  id: string;
  clientId: string;
  clientType: string;
  offerWorkspace: { input: unknown } | null;
  energyAudits: Array<{
    annualConsumptionKwh: unknown;
    settlementSystem: unknown;
    existingPvKw: unknown;
    connectionPowerKw: unknown;
  }>;
};
export type ClientEnergyCostSummaryMonth = { period: string; importKwh: number | null; exportKwh: number | null; importAvailable: boolean; exportAvailable: boolean };
export type ClientEnergyCostHistoryDependencies = {
  clientTariffScope: typeof clientTariffScope;
  callClientTariffs: <T>(input: { action: string; scope: unknown } & Record<string, unknown>) => Promise<T>;
  tariffToday: () => string;
};

function finiteNonnegative(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function nextMonthStart(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
}

function periodLocalDates(periodKeys: string[]): string[] {
  const dates: string[] = [];
  for (const month of periodKeys) {
    const [year, monthNumber] = month.split('-').map(Number);
    const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    for (let day = 1; day <= days; day += 1) dates.push(`${month}-${String(day).padStart(2, '0')}`);
  }
  return dates;
}

function utcHourKey(value: string): string | null {
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? new Date(Math.floor(instant / 3_600_000) * 3_600_000).toISOString() : null;
}

function historyTariff(history: ClientTariffHistory, date: string): ClientTariffPayload | null {
  const entry = history.byDate[date];
  if (typeof entry === 'string') return history.tariffs?.[entry] || null;
  return entry && typeof entry === 'object' ? entry : null;
}

function summaryIdentityValue(value: unknown): string | null {
  if (value === null) return 'null';
  if (value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? `number:${Object.is(value, -0) ? 0 : value}` : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return `number:${Object.is(numeric, -0) ? 0 : numeric}`;
  const normalized = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').toLowerCase().replace(/\s+/g, ' ');
  return `text:${normalized}`;
}

function normalizeRoundedRuntimeGross(
  rows: Array<Record<string, any>>,
  storedRows: Array<Record<string, any>>,
  group: 'fixed' | 'variable',
  field: 'amount' | 'price',
): Array<Record<string, any>> {
  const identityFields = group === 'fixed'
    ? ['label', 'amount_mode', 'billing_cycle_months', 'annual_usage_min_kwh', 'annual_usage_max_kwh']
    : ['label', 'window_code'];
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const key = String(row.component_key || '');
    const matches = storedRows.filter((stored) => key
      ? stored.component_key === key
      : identityFields.every((identityField) => Object.prototype.hasOwnProperty.call(row, identityField)
        && Object.prototype.hasOwnProperty.call(stored, identityField)
        && summaryIdentityValue(row[identityField]) !== null
        && summaryIdentityValue(row[identityField]) === summaryIdentityValue(stored[identityField])));
    if (matches.length !== 1 || typeof row[field] !== 'number' || !Number.isFinite(row[field])) return row;
    const gross = Number(matches[0].gross);
    if (!Number.isFinite(gross)) return row;

    // Current catalog runtime prices can be serialized to four decimals; retain exact verified gross downstream.
    const roundedRuntime = Number(row[field].toFixed(4));
    const roundedGross = Number(gross.toFixed(4));
    if (row[field] === roundedRuntime && roundedRuntime === roundedGross) return { ...row, [field]: gross };
    return row;
  });
}

function applySummaryTariffPeriod(tariff: ClientTariffPayload, period: ClientTariffPeriod): ClientTariffPayload {
  const storage = tariff.pricing?.tariffStorage;
  if (!storage || storage.priceBasis !== 'net') throw new Error('Brak zweryfikowanych cen netto dla taryfy z profilu.');
  const overrides = { ...(period.overrides || {}) };
  const used = new Set<string>();
  const result = {
    ...tariff,
    fixed: [...tariff.fixed],
    variable: [...tariff.variable],
    pricing: { ...tariff.pricing, tariffStorage: { ...storage, fixed: [...storage.fixed], variable: [...storage.variable] } },
  } as ClientTariffPayload & Record<string, unknown>;
  for (const [group, field] of [['fixed', 'amount'], ['variable', 'price']] as const) {
    const metadata = result.pricing.tariffStorage[group];
    const runtimeRows = result[group];
    if (!Array.isArray(metadata) || !Array.isArray(runtimeRows) || metadata.length !== runtimeRows.length) {
      throw new Error(`Niespójna liczba pozycji ${group} taryfy.`);
    }
    const rowsForValidation = group === 'variable'
      ? normalizeRoundedRuntimeGross(runtimeRows, metadata, group, field)
      : runtimeRows;
    const canonicalRows = canonicalNetRows(rowsForValidation, metadata, field, group, Number(storage.vatRate));
    const runtimeByKey = new Map(canonicalRows.map(row => [String(row.component_key), row]));
    result.pricing.tariffStorage[group] = metadata.map((row) => {
      const key = row.component_key;
      if (!key || used.has(`${group}/${key}`)) throw new Error(`Brak unikalnego identyfikatora pozycji ${group} taryfy.`);
      const override = overrides[key];
      const net = Number(override?.net ?? row.net);
      const vatRate = Number(override?.vatRate ?? row.vatRate);
      if (!Number.isFinite(net) || net < 0 || !Number.isFinite(vatRate) || vatRate < 0 || vatRate > 1) {
        throw new Error(`Nieprawidłowa indywidualna cena ${group} ${key}.`);
      }
      const runtime = runtimeByKey.get(key);
      if (!runtime || typeof runtime !== 'object') throw new Error(`Brak pozycji runtime ${group} ${key}.`);
      if (override) used.add(`${group}/${key}`);
      runtimeByKey.set(key, { ...runtime, component_key: key, [field]: net * (1 + vatRate), vat_rate: vatRate });
      return { ...row, net, gross: net * (1 + vatRate), vatRate, [field]: net };
    });
    result[group] = canonicalRows.map(row => runtimeByKey.get(String(row.component_key))!);
  }
  const unused = Object.keys(overrides).filter(key => !['fixed', 'variable'].some(group => used.has(`${group}/${key}`)));
  if (unused.length) throw new Error(`W katalogu brakuje pozycji z indywidualną korektą: ${unused.join(', ')}.`);
  if (period.schedule) {
    if (period.schedule.zone_model !== tariff.zone_model) throw new Error('Model stref w katalogu zmienił się; nie można zastosować harmonogramu profilu.');
    Object.assign(result, period.schedule);
  }
  result.clientPeriodId = period.id;
  result.clientPeriodSource = period.source;
  return result;
}

function currentSettlement(value: unknown): 'NET_METERING' | 'NET_BILLING' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return normalized === 'NET_METERING' || normalized === 'NET_BILLING' ? normalized : null;
}

const defaultHistoryDependencies: ClientEnergyCostHistoryDependencies = {
  clientTariffScope,
  callClientTariffs: callClientTariffs as ClientEnergyCostHistoryDependencies['callClientTariffs'],
  tariffToday,
};

export async function completeHistoryForSummary(input: {
  history: ClientTariffHistory;
  clientId: string;
  projectId: string;
  dates: string[];
}, dependencies: ClientEnergyCostHistoryDependencies = defaultHistoryDependencies): Promise<{ history: ClientTariffHistory; assumptions: string[]; issues: string[] }> {
  const missingDates = input.dates.filter(date => !historyTariff(input.history, date));
  if (!missingDates.length) return { history: input.history, assumptions: [], issues: [] };
  const confirmedPriceGaps: string[] = [];
  const issues: string[] = [];
  for (const date of missingDates) {
    const dateIssues = input.history.issues.filter(issue => issue.date === date);
    if (dateIssues.length && dateIssues.every(issue => /brak jednoznacznych cen/i.test(issue.message)
      && !/konflikt/i.test(issue.message))) {
      confirmedPriceGaps.push(date);
    } else {
      const detail = dateIssues.map(issue => issue.message).join(' ');
      issues.push(`${date}: nie zastosowano ceny szacunkowej, ponieważ historia nie potwierdza zwykłego braku ceny${detail ? ` (${detail})` : ''}.`);
    }
  }
  if (!confirmedPriceGaps.length) return { history: input.history, assumptions: [], issues };
  try {
    const scope = await dependencies.clientTariffScope(input.clientId, input.projectId);
    const profile = await dependencies.callClientTariffs<ClientTariffData>({ action: 'get', scope });
    const periods = profile.profile?.periods || [];
    const dated: Array<{ date: string; period: ClientTariffPeriod }> = [];
    for (const date of confirmedPriceGaps) {
      const matches = periods.filter(period => (!period.validFrom || period.validFrom <= date)
        && (!period.validUntil || period.validUntil > date));
      if (matches.length !== 1 || !Number.isInteger(matches[0]?.osdId) || !Number.isInteger(matches[0]?.tariffId)) {
        issues.push(`${date}: brak jednoznacznej datowanej tożsamości taryfy; nie użyto bieżącego cennika.`);
      } else {
        dated.push({ date, period: matches[0] });
      }
    }
    const byDate = { ...input.history.byDate };
    const identities = Array.from(new Map(dated.map(row => [`${row.period.osdId}/${row.period.tariffId}`, row.period])).values());
    const fetched = await Promise.all(identities.map(async identity => {
      try {
        const tariff = await dependencies.callClientTariffs<ClientTariffPayload>({
          action: 'catalog', scope, date: dependencies.tariffToday(), osdId: identity.osdId, tariffId: identity.tariffId,
        });
        if (tariff.osd_id !== identity.osdId || tariff.tariff_id !== identity.tariffId) {
          throw new Error('Katalog zwrócił inną parę operator/taryfa niż datowany profil.');
        }
        return { key: `${identity.osdId}/${identity.tariffId}`, tariff, error: null as string | null };
      } catch (error) {
        return { key: `${identity.osdId}/${identity.tariffId}`, tariff: null,
          error: error instanceof Error ? error.message : 'błąd katalogu' };
      }
    }));
    let filledCount = 0;
    const appliedByPeriod = new Map<string, ClientTariffPayload>();
    for (const identity of dated) {
      const key = `${identity.period.osdId}/${identity.period.tariffId}`;
      const source = fetched.find(row => row.key === key);
      if (!source?.tariff) {
        issues.push(`${identity.date}: nie uzupełniono taryfy ${key}: ${source?.error || 'brak cennika'}.`);
        continue;
      }
      try {
        const periodKey = identity.period.id || `${key}/${identity.period.validFrom || ''}/${identity.period.validUntil || ''}`;
        let applied = appliedByPeriod.get(periodKey);
        if (!applied) {
          applied = applySummaryTariffPeriod(source.tariff, identity.period);
          appliedByPeriod.set(periodKey, applied);
        }
        byDate[identity.date] = applied;
        filledCount += 1;
      } catch (error) {
        issues.push(`${identity.date}: nie zastosowano korekt taryfy ${key}: ${error instanceof Error ? error.message : 'błąd profilu'}.`);
      }
    }
    return {
      history: filledCount ? { ...input.history, byDate } : input.history,
      assumptions: filledCount ? [`Dla ${filledCount} dni bez ceny historycznej użyto bieżącego cennika dokładnie tej samej taryfy z datowanego profilu; historia projektu pozostała bez zmian.`] : [],
      issues,
    };
  } catch (error) {
    return {
      history: input.history, assumptions: [],
      issues: [...issues, `Nie uzupełniono ${confirmedPriceGaps.length} dni ceną taryfy z datowanego profilu: ${error instanceof Error ? error.message : 'błąd katalogu'}.`],
    };
  }
}

export async function invoiceBillingCycleForPeriod(
  projectId: string,
  period: Pick<AnalysisPeriod, 'startMonth' | 'endDate'>,
  expectedCycleMonths?: number | null,
) {
  const rows = await prisma.document.findMany({
    where: {
      projectId, type: 'FAKTURA_PRAD', billingCycleMonths: { not: null },
      billingPeriodFrom: { lte: new Date(`${period.endDate}T23:59:59.999Z`) },
      billingPeriodTo: { gte: new Date(`${period.startMonth}-01T00:00:00.000Z`) },
    },
    select: { billingCycleMonths: true, billingPeriodFrom: true, billingPeriodTo: true },
    orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
  });
  const selected = energyInvoicesInAnalysisPeriod(rows, period);
  const invoice = selected.included.find(row => row.billingCycleMonths != null
    && (expectedCycleMonths == null || Number(row.billingCycleMonths) === expectedCycleMonths)) || null;
  return {
    cycleMonths: invoice?.billingCycleMonths == null ? null : Number(invoice.billingCycleMonths),
    startMonth: invoice?.billingPeriodFrom ? new Date(invoice.billingPeriodFrom).toISOString().slice(0, 7) : null,
    crossingCount: selected.crossingCount,
  };
}

export type ClientEnergyCostSummaryServerDependencies = {
  invoiceBillingCycleForPeriod: typeof invoiceBillingCycleForPeriod;
  currentScenario: typeof currentScenario;
  hourlyMarketPrices: typeof hourlyMarketPrices;
  completeHistoryForSummary: typeof completeHistoryForSummary;
  priceOfferWorkspaceGrid: typeof priceOfferWorkspaceGrid;
  billOfferWorkspaceScenario: typeof billOfferWorkspaceScenario;
};

const defaultSummaryDependencies: ClientEnergyCostSummaryServerDependencies = {
  invoiceBillingCycleForPeriod,
  currentScenario,
  hourlyMarketPrices,
  completeHistoryForSummary,
  priceOfferWorkspaceGrid,
  billOfferWorkspaceScenario,
};

export async function calculateClientEnergyCostSummaryOnServer(input: {
  project: ClientEnergyCostSummaryProject;
  period: AnalysisPeriod;
  series: OfferMeasurementSeries | null;
  months: ClientEnergyCostSummaryMonth[];
}, dependencies: ClientEnergyCostSummaryServerDependencies = defaultSummaryDependencies) {
  const { project, period, series, months } = input;
  const vatBasis = project.clientType === 'B2B' ? 'NET' : 'GROSS';
  const totalHours = (Date.parse(period.untilUtc) - Date.parse(period.fromUtc)) / 3_600_000;
  const audit = project.energyAudits[0];
  const draft = project.offerWorkspace?.input && typeof project.offerWorkspace.input === 'object'
    ? project.offerWorkspace.input as Record<string, unknown> : {};
  const calculation = draft.calculation && typeof draft.calculation === 'object'
    ? draft.calculation as Record<string, unknown> : {};
  const settlement = currentSettlement(audit?.settlementSystem) || currentSettlement(draft.currentSettlement);
  let cycleValue = finiteNonnegative(calculation.billingCycleMonths);
  const savedCycleStart = typeof calculation.billingCycleStartMonth === 'string' ? calculation.billingCycleStartMonth : null;
  let invoiceCycleStart: string | null = null;
  let invoiceIssue: string | null = null;
  if (cycleValue == null || (cycleValue > 1 && !savedCycleStart)) {
    try {
      const invoiceCycle = await dependencies.invoiceBillingCycleForPeriod(project.id, period, cycleValue);
      if (cycleValue == null) cycleValue = invoiceCycle.cycleMonths;
      invoiceCycleStart = invoiceCycle.startMonth;
      if (invoiceCycle.crossingCount > 0) invoiceIssue = `Pominięto ${invoiceCycle.crossingCount} faktur przecinających granice okresu analizy.`;
    } catch (error) {
      invoiceIssue = `Nie udało się odczytać cyklu z faktur: ${error instanceof Error ? error.message : 'błąd źródła'}.`;
    }
  }
  const billingCycleMonths = cycleValue != null && Number.isInteger(cycleValue) && cycleValue >= 1 && cycleValue <= 12 ? cycleValue : null;
  const connectionPowerKw = finiteNonnegative(audit?.connectionPowerKw);
  const completeMeasuredImport = months.length === period.periodKeys.length
    && months.every(month => month.importAvailable && month.importKwh != null);
  const measuredAnnualUsage = completeMeasuredImport ? months.reduce((sum, month) => sum + (month.importKwh || 0), 0) : null;
  const auditedAnnualUsage = finiteNonnegative(audit?.annualConsumptionKwh);
  const annualUsageKwh = measuredAnnualUsage ?? auditedAnnualUsage;
  const assumptions: string[] = [];
  if (invoiceCycleStart && billingCycleMonths != null) assumptions.push(`Cykl ${billingCycleMonths}-miesięczny i jego kotwica pochodzą z faktury w wybranym okresie.`);
  if (measuredAnnualUsage == null && auditedAnnualUsage != null) {
    assumptions.push('Zużycie roczne do wyznaczenia stawek pochodzi z audytu; pomiar importu w okresie nie jest kompletny.');
  }
  if (connectionPowerKw == null || annualUsageKwh == null || billingCycleMonths == null) {
    return blockedClientEnergyCostSummary(vatBasis, totalHours,
      [invoiceIssue, 'Brak jawnej mocy przyłączeniowej, rocznego zużycia lub cyklu rozliczeniowego potrzebnego do wyceny taryfy.'].filter(Boolean).join(' '));
  }

  let current;
  try {
    current = await dependencies.currentScenario({ clientId: project.clientId, projectId: project.id }, settlement,
      { from: `${period.startMonth}-01`, until: nextMonthStart(period.endMonth) });
  } catch (error) {
    return blockedClientEnergyCostSummary(vatBasis, totalHours,
      `Nie udało się odczytać bieżącej taryfy projektu: ${error instanceof Error ? error.message : 'błąd źródła'}.`);
  }
  if (!current.tariffHistory) {
    return blockedClientEnergyCostSummary(vatBasis, totalHours,
      (current.issues || []).join(' ') || 'Brak jawnej historii bieżącej taryfy projektu.');
  }

  const dates = periodLocalDates(period.periodKeys);
  const completion = await dependencies.completeHistoryForSummary({
    history: current.tariffHistory, clientId: project.clientId, projectId: project.id, dates,
  });
  assumptions.push(...completion.assumptions);
  const tariffHistory = completion.history;
  const intervals = (series?.intervals || []).filter(row => row.import != null || row.export != null);
  const estimatedIntervalCount = intervals.filter(row => row.import?.source === 'estimated' || row.export?.source === 'estimated').length;
  if (estimatedIntervalCount > 0) {
    assumptions.push(`Liczba interwałów z danymi oznaczonymi w plikach OSD jako szacowane (import lub eksport): ${estimatedIntervalCount}. Wynik należy traktować jako szacunek.`);
  }
  const hours = Array.from(new Set(intervals.map(row => utcHourKey(row.startUtc)).filter((hour): hour is string => hour !== null))).sort();
  const marketStart = hours[0] || period.fromUtc;
  const marketEnd = hours.length ? new Date(Date.parse(hours.at(-1)!) + 3_600_000).toISOString() : period.untilUtc;
  const dailyTariffs = dates.map(date => historyTariff(tariffHistory, date)).filter((row): row is ClientTariffPayload => Boolean(row));
  const rdnNeeded = dailyTariffs.some(row => (row as ClientTariffPayload & { sell_method?: string }).sell_method === 'rdn');
  const rceNeeded = settlement === 'NET_BILLING' && intervals.some(row => (row.export?.valueKwh || 0) > 0);
  let rdnPrices = new Map<string, number>();
  let rcePrices = new Map<string, number>();
  const marketIssues: string[] = [];
  if (hours.length && rdnNeeded) {
    const result = await dependencies.hourlyMarketPrices(hours, marketStart, marketEnd, 'RDN');
    rdnPrices = result.prices;
    if (result.issue) marketIssues.push(result.issue);
  }
  if (hours.length && rceNeeded) {
    const result = await dependencies.hourlyMarketPrices(hours, marketStart, marketEnd, 'RCE');
    rcePrices = result.prices;
    if (result.issue) marketIssues.push(result.issue);
  }
  const gridIntervals = intervals.map(row => {
    const hour = utcHourKey(row.startUtc);
    return {
      startUtc: row.startUtc, endUtc: row.endUtc,
      importKwh: row.import?.valueKwh ?? null, exportKwh: row.export?.valueKwh ?? null,
      ...(hour && rdnPrices.has(hour) ? { marketPriceNetPlnPerKwh: rdnPrices.get(hour)! } : {}),
      ...(hour && rcePrices.has(hour) ? { exportPriceNetPlnPerKwh: rcePrices.get(hour)! } : {}),
    };
  });
  const rawPricing = dependencies.priceOfferWorkspaceGrid({
    tariffHistory, context: { annualUsageKwh, billingCycleMonths, connectionPowerKw }, vatBasis,
    intervals: gridIntervals, expectedLocalDates: dates, totalHours, settlementMode: settlement,
  });
  const pricing = {
    ...rawPricing,
    issues: [...rawPricing.issues, ...completion.issues, ...marketIssues],
    status: rawPricing.status === 'ready' && (completion.issues.length || marketIssues.length) ? 'partial' as const : rawPricing.status,
  };
  const hasNetMeteringExport = settlement === 'NET_METERING'
    && intervals.some(row => (row.export?.valueKwh || 0) > 0);

  let settlementResult: ReturnType<typeof billOfferWorkspaceScenario> | null = null;
  let settlementIssue: string | null = null;
  const measuredHours = intervals.reduce((sum, row) => sum + (Date.parse(row.endUtc) - Date.parse(row.startUtc)) / 3_600_000, 0);
  const fullImport = intervals.length > 0 && intervals.every(row => row.import != null)
    && Math.abs(measuredHours - totalHours) < 1e-6
    && (series?.periods.length || 0) === period.periodKeys.length && (series?.periods || []).every(row => row.hasImport);
  const fullExport = intervals.length > 0 && intervals.every(row => row.export != null)
    && Math.abs(measuredHours - totalHours) < 1e-6 && (series?.periods || []).every(row => row.hasExport);
  if (!settlement) {
    settlementIssue = 'Brak jawnego systemu rozliczeń; nie obliczono opustu ani depozytu.';
  } else if (!(fullImport && fullExport)) {
    if (!(finiteNonnegative(audit?.existingPvKw) === 0 && fullImport)) {
      settlementIssue = 'Pełne rozliczenie pominięto: pomiary nie obejmują wszystkich godzin obu kierunków okresu.';
    }
  } else if (completion.issues.length || marketIssues.length) {
    settlementIssue = 'Pełne rozliczenie wymaga kompletnych cen taryfowych i rynkowych; zachowano dostępny koszt bazowy.';
  } else {
    const billIntervals = intervals.map(row => ({
      startUtc: row.startUtc, endUtc: row.endUtc, importKwh: row.import!.valueKwh, exportKwh: row.export!.valueKwh,
      ...(utcHourKey(row.startUtc) && rdnPrices.has(utcHourKey(row.startUtc)!)
        ? { marketPriceNetPlnPerKwh: rdnPrices.get(utcHourKey(row.startUtc)!)! } : {}),
    }));
    const cycleStartMonth = savedCycleStart || invoiceCycleStart || period.startMonth;
    if (billingCycleMonths > 1 && !savedCycleStart && !invoiceCycleStart) {
      assumptions.push(`Nieznany początek cyklu ${billingCycleMonths}-miesięcznego; w szacunku przyjęto ${period.startMonth}.`);
    }
    if (settlement === 'NET_METERING') {
      const lots = Array.isArray(calculation.initialCreditLots) ? calculation.initialCreditLots as Array<Record<string, unknown>> : [];
      const lotsTotal = lots.reduce((sum, lot) => sum + (finiteNonnegative(lot.kwh) || 0), 0);
      let initialCreditKwh = finiteNonnegative(calculation.initialCreditKwh);
      if (initialCreditKwh == null && lotsTotal > 0) initialCreditKwh = lotsTotal;
      if (initialCreditKwh == null) {
        initialCreditKwh = 0;
        assumptions.push('Brak zapisanego salda początkowego opustu; w szacunku przyjęto 0 kWh.');
      }
      const powerKw = finiteNonnegative(audit?.existingPvKw);
      if (powerKw == null) settlementIssue = 'Brak jawnej mocy istniejącej PV; nie można ustalić współczynnika net-meteringu.';
      else {
        const policy: NetMeteringPolicy = {
          mode: 'NET_METERING', netMeteringRatio: powerKw <= 10 ? 0.8 : 0.7, initialCreditKwh,
          initialCreditLots: lots.map(lot => ({ kwh: Number(lot.kwh), creditedMonth: String(lot.creditedMonth), expiresMonth: String(lot.expiresMonth) })),
          billingCycleStartMonth: billingCycleMonths > 1 ? cycleStartMonth : undefined,
          initialCreditExpiresMonth: null, creditExpiryMonths: 12,
          coverage: 'ENERGY_AND_VARIABLE_DISTRIBUTION', fixedChargeTreatment: 'ALWAYS_BILLED',
        };
        settlementResult = dependencies.billOfferWorkspaceScenario({ tariffHistory, context: { annualUsageKwh, billingCycleMonths, connectionPowerKw }, vatBasis, settlement: policy, intervals: billIntervals });
      }
    } else {
      const lots = Array.isArray(calculation.initialDepositLots) ? calculation.initialDepositLots as Array<Record<string, unknown>> : [];
      const lotsTotal = lots.reduce((sum, lot) => sum + (finiteNonnegative(lot.amountPln) || 0), 0);
      const declaredDeposit = finiteNonnegative(calculation.initialDepositPln);
      const initialDeposit = declaredDeposit == null ? (lotsTotal > 0 ? lotsTotal : 0) : declaredDeposit;
      if (declaredDeposit == null && lotsTotal === 0) assumptions.push('Brak zapisanego salda początkowego depozytu; w szacunku przyjęto 0 zł.');
      if (Math.abs(initialDeposit - lotsTotal) > 0.000001) settlementIssue = 'Jawne saldo depozytu nie ma zgodnych, datowanych transz; pełnego rozliczenia nie obliczono.';
      else if (billIntervals.some(row => row.exportKwh > 0 && !rcePrices.has(utcHourKey(row.startUtc) || ''))) {
        settlementIssue = 'Brak kompletnych godzinowych cen RCE; pominięto rozliczenie depozytu.';
      } else {
        const policy: NetBillingPolicy = {
          mode: 'NET_BILLING',
          initialDeposit: lots.map(lot => ({ amountPln: Number(lot.amountPln), creditedMonth: String(lot.creditedMonth),
            expiresMonth: String(lot.expiresMonth), refundCapPln: Number(lot.refundCapPln) })),
          exportUnitPrices: billIntervals.map(row => {
            const price = Math.max(0, rcePrices.get(utcHourKey(row.startUtc) || '') || 0) * 1.23;
            return { startUtc: row.startUtc, endUtc: row.endUtc, depositCreditPricePlnPerKwh: price, refundCapPricePlnPerKwh: price / 1.23 };
          }),
          exportPriceMethod: 'RCE', creditingDelayMonths: 1, depositExpiryMonths: 12, expiredRefundRate: 0,
          depositCoverage: 'ENERGY_ONLY', fixedChargeTreatment: 'ALWAYS_BILLED',
        };
        settlementResult = dependencies.billOfferWorkspaceScenario({ tariffHistory, context: { annualUsageKwh, billingCycleMonths, connectionPowerKw }, vatBasis, settlement: policy, intervals: billIntervals });
      }
    }
    if (settlementResult?.status === 'blocked') settlementIssue = 'Pełne rozliczenie zostało zablokowane; zachowano wycenę kosztu bazowego.';
  }
  if (settlementResult?.status === 'ready') assumptions.push(...settlementResult.warnings);
  if (hasNetMeteringExport && settlementResult?.status !== 'ready') {
    assumptions.push('Eksport w NET_METERING nie otrzymuje tu wartości pieniężnej; koszt pokazuje import z sieci przed rozliczeniem oddania.');
  }
  if (current.issues?.length && completion.assumptions.length === 0) {
    pricing.issues.push(...current.issues.map(issue => `Taryfa: ${issue}`));
    if (pricing.status === 'ready') pricing.status = 'partial';
  }
  return buildClientEnergyCostSummary({ pricing, settlementResult, settlementIssue, assumptions });
}
