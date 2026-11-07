import {
  callClientTariffs,
  clientTariffScope,
  loadClientTariffHistory,
  readProjectGeneralTariffs,
} from './client-tariffs-server';
import {
  tariffToday,
  type ClientTariffData,
  type ClientTariffHistory,
  type ClientTariffPayload,
} from './client-tariffs';
import type { OfferWorkspaceDraft } from './offer-workspace';
import type { OfferMeasurementInterval, OfferMeasurementSeries } from './offer-measurements';
import type { OfferWorkspace } from './offer-workspace-server';
import { offerHourlyMarketPrices, offerMarketIntervalStarts, type OfferStoredMarketRow } from './offer-workspace-market';
import { rePrisma } from './re-stations';
import { getOfferWorkspaceArtifact, putOfferWorkspaceArtifact } from './offer-workspace-artifacts';
import { offerCalculationDependencyHash } from './offer-workspace-calculation-dependencies';
import { buildAnnualOfferConsumptionProfile } from './offer-workspace-annual-profile';
import { annualOfferMeasurementSeries, overlayOfferWorkspaceMeasurements } from './offer-workspace-energy';
import { calculateOfferWorkspaceEnergy } from './offer-workspace-energy-server';
import { resolveSelectedReferenceProfile } from './project-reference-profile';
import {
  calculateOfferWorkspaceValuation,
  type CalculateOfferWorkspaceValuationInput,
  type OfferWorkspaceValuation,
  type OfferWorkspaceValuationScenarioInput,
} from './offer-workspace-valuation';

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function monthAfter(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

function measurementBounds(intervals: OfferMeasurementInterval[], periods: Array<{ period: string }>) {
  const dates = intervals.map(row => row.localStart.slice(0, 10)).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  if (dates.length) return { from: dates[0], until: addDays(dates.at(-1)!, 1) };
  const keys = periods.map(row => row.period).filter(period => /^\d{4}-(0[1-9]|1[0-2])$/.test(period)).sort();
  return keys.length ? { from: `${keys[0]}-01`, until: monthAfter(keys.at(-1)!) } : null;
}

function utcHourKey(value: string): string | null {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  const hour = Math.floor(instant / 3_600_000) * 3_600_000;
  return new Date(hour).toISOString();
}

async function marketRows(from: string, until: string, kind: 'RDN' | 'RCE') {
  const db = rePrisma();
  const table = kind === 'RDN' ? 'powerplantRDN' : 'powerplantRCE';
  const dateColumn = 'dtime_utc';
  const priceColumn = kind === 'RDN' ? 'fixing_i_price' : 'rce_pln';
  return db.$queryRawUnsafe<OfferStoredMarketRow[]>(
    `SELECT DATE_FORMAT(\`${dateColumn}\`, '%Y-%m-%dT%H:%i:%sZ') AS stamp, period_utc AS periodUtc, CAST(\`${priceColumn}\` AS CHAR) AS price FROM \`${table}\` WHERE \`${dateColumn}\` > ? AND \`${dateColumn}\` <= ? ORDER BY \`${dateColumn}\` ASC LIMIT 35137`,
    from.replace('T', ' ').replace(/\.000Z$|Z$/, ''),
    until.replace('T', ' ').replace(/\.000Z$|Z$/, ''),
  );
}

export async function hourlyMarketPrices(
  requestedHours: string[],
  from: string,
  until: string,
  kind: 'RDN' | 'RCE',
): Promise<{ prices: Map<string, number>; issue: string | null }> {
  try {
    const rows = offerMarketIntervalStarts(await marketRows(from, until, kind));
    const rowHours = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = utcHourKey(row.timestampUtc);
      if (!key) continue;
      const list = rowHours.get(key) || [];
      list.push(row);
      rowHours.set(key, list);
    }
    const prices = new Map<string, number>();
    for (const hour of requestedHours) {
      const quarterRows = rowHours.get(hour) || [];
      try {
        const price = offerHourlyMarketPrices(
          quarterRows,
          [hour],
          { clampNegativeBeforeAverage: kind === 'RCE' },
        ).get(hour);
        if (price != null) prices.set(hour, price);
      } catch {
        // Missing quarters are kept missing; the pure evaluator reports the affected interval.
      }
    }
    return { prices, issue: null };
  } catch (error) {
    return {
      prices: new Map(),
      issue: `${kind}: nie udało się odczytać istniejących cen rynkowych (${error instanceof Error ? error.message : 'błąd źródła'}).`,
    };
  }
}

function scenarioUsesRdn(scenario: OfferWorkspaceValuationScenarioInput, dates: string[]): boolean {
  if ((scenario.tariff as (ClientTariffPayload & { sell_method?: string }) | null | undefined)?.sell_method === 'rdn') return true;
  const history = scenario.tariffHistory;
  if (!history) return false;
  for (const date of dates) {
    try {
      const tariff = typeof history.byDate[date] === 'string'
        ? history.tariffs?.[String(history.byDate[date])]
        : history.byDate[date];
      if (tariff && typeof tariff === 'object'
        && (tariff as ClientTariffPayload & { sell_method?: string }).sell_method === 'rdn') return true;
    } catch { /* A missing day does not imply an RDN tariff. */ }
  }
  return false;
}

export async function currentScenario(
  workspace: Pick<OfferWorkspace, 'clientId' | 'projectId'>,
  settlement: OfferWorkspaceDraft['currentSettlement'],
  bounds: { from: string; until: string } | null,
): Promise<OfferWorkspaceValuationScenarioInput> {
  const missing = (issue: string): OfferWorkspaceValuationScenarioInput => ({
    settlement,
    source: 'MISSING',
    issues: [issue],
  });
  if (!bounds) return missing('Brak zakresu pomiarów do pobrania historii taryfy.');
  let scope;
  try {
    scope = await clientTariffScope(workspace.clientId, workspace.projectId);
  } catch (error) {
    return missing(`Nie udało się odczytać zakresu taryfy projektu: ${error instanceof Error ? error.message : 'błąd źródła'}.`);
  }
  let history: ClientTariffHistory | null;
  try {
    history = await loadClientTariffHistory(workspace.clientId, workspace.projectId, bounds.from, bounds.until);
  } catch (error) {
    return missing(`Nie udało się odczytać zapisanej historii taryfy: ${error instanceof Error ? error.message : 'błąd źródła'}.`);
  }
  if (history) {
    return {
      settlement,
      source: 'PROJECT_HISTORY',
      tariffHistory: history,
      issues: history.issues.map(issue => `${issue.date}: ${issue.message}`),
    };
  }

  let general: ClientTariffData['generalTariff'];
  try {
    general = (await readProjectGeneralTariffs(scope)).generalTariff;
  } catch (error) {
    return missing(`Nie udało się odczytać wybranej taryfy ogólnej: ${error instanceof Error ? error.message : 'błąd źródła'}.`);
  }
  if (!general?.code) return missing('Brak zapisanej historii oraz wybranej taryfy ogólnej projektu.');

  try {
    const catalog = await callClientTariffs<ClientTariffData>({ action: 'get', scope });
    const operator = catalog.catalog.find(item => general.osdId
      ? item.id === general.osdId
      : item.name.toLocaleLowerCase('pl') === general.operator.toLocaleLowerCase('pl')
        || item.slug.toLowerCase() === general.operator.toLowerCase());
    const tariff = operator?.tariffs.find(item => general.tariffId
      ? item.id === general.tariffId
      : item.code.toLowerCase() === general.code.toLowerCase());
    if (!operator || !tariff) return missing('Wybrana taryfa ogólna nie ma jednoznacznego odpowiednika w katalogu RE.');
    const tariffHistory = await callClientTariffs<ClientTariffHistory>({
      action: 'catalog-history', scope, from: bounds.from, until: bounds.until,
      osdId: operator.id, tariffId: tariff.id,
    });
    return {
      settlement,
      source: 'GENERAL_SELECTION_HISTORY',
      tariffHistory,
      issues: tariffHistory.issues.map(issue => `${issue.date}: ${issue.message}`),
    };
  } catch (error) {
    return missing(`Nie udało się pobrać datowanej historii wybranej taryfy ogólnej: ${error instanceof Error ? error.message : 'błąd źródła'}.`);
  }
}

async function targetScenario(
  workspace: OfferWorkspace,
  draft: OfferWorkspaceDraft,
): Promise<OfferWorkspaceValuationScenarioInput> {
  const base = { settlement: draft.targetSettlement, source: 'MISSING' as const };
  if (!draft.targetOperatorId || !draft.targetTariffId) {
    return { ...base, issues: ['Wybierz taryfę docelową z katalogu.'] };
  }
  try {
    const scope = await clientTariffScope(workspace.clientId, workspace.projectId);
    const tariff = await callClientTariffs<ClientTariffPayload>({
      action: 'catalog', scope, date: tariffToday(),
      osdId: draft.targetOperatorId, tariffId: draft.targetTariffId,
    });
    return { settlement: draft.targetSettlement, source: 'CURRENT_CATALOG', tariff };
  } catch (error) {
    return {
      ...base,
      issues: [`Nie udało się pobrać aktualnej taryfy docelowej z katalogu: ${error instanceof Error ? error.message : 'błąd źródła'}.`],
    };
  }
}

export async function calculateOfferWorkspaceValuationOnServer(
  workspace: OfferWorkspace,
  draft: OfferWorkspaceDraft,
  series: OfferMeasurementSeries | null,
): Promise<OfferWorkspaceValuation> {
  let sourceNote: string | null = null;
  if (!series?.intervals.length && workspace.measurements.availability === 'NO_FILES'
    && workspace.input.energyProfileSource === 'ANNUAL_DECLARATION'
    && (workspace.input.annualConsumptionKwh ?? 0) > 0) {
    const energy = await calculateOfferWorkspaceEnergy(workspace, draft, series);
    const profile = buildAnnualOfferConsumptionProfile({
      annualConsumptionKwh: workspace.input.annualConsumptionKwh,
      period: workspace.period,
      referenceProfile: await resolveSelectedReferenceProfile(workspace.input.referenceProfile) || undefined,
    });
    series = annualOfferMeasurementSeries(profile, energy);
    workspace = { ...workspace, measurements: overlayOfferWorkspaceMeasurements(workspace.measurements, energy) };
    sourceNote = profile.referenceProfile
      ? `Wycena szacunkowa: roczne zużycie rozłożone godzinowo profilem referencyjnym ${profile.referenceProfile.name}; pobór i oddanie są modelowane.`
      : 'Wycena szacunkowa: roczne zużycie rozłożone godzinowo profilem RE; pobór i oddanie są modelowane.';
  }
  const intervals = series?.intervals || [];
  const bounds = measurementBounds(intervals, workspace.measurements.months);
  const [current, target] = await Promise.all([
    currentScenario(workspace, draft.currentSettlement, bounds),
    targetScenario(workspace, draft),
  ]);
  const dates = Array.from(new Set(intervals.map(row => row.localStart.slice(0, 10)))).sort();
  const requestedHours = Array.from(new Set(intervals.map(row => utcHourKey(row.startUtc)).filter((key): key is string => key !== null))).sort();
  const firstHour = requestedHours[0];
  const lastHour = requestedHours.at(-1);
  let rdnPricesNetPlnPerKwh = new Map<string, number>();
  let rcePricesNetPlnPerKwh = new Map<string, number>();
  const rdnNeeded = scenarioUsesRdn(current, dates) || scenarioUsesRdn(target, dates);
  const rceNeeded = (draft.currentSettlement === 'NET_BILLING' || draft.targetSettlement === 'NET_BILLING')
    && intervals.some(row => row.export != null && row.export.valueKwh > 0);
  const startUtc = firstHour;
  const endUtc = lastHour ? new Date(Date.parse(lastHour) + 3_600_000).toISOString() : null;
  if (startUtc && endUtc && rdnNeeded) {
    const result = await hourlyMarketPrices(requestedHours, startUtc, endUtc, 'RDN');
    rdnPricesNetPlnPerKwh = result.prices;
    if (result.issue) {
      if (scenarioUsesRdn(current, dates)) current.issues = [...(current.issues || []), result.issue];
      if (scenarioUsesRdn(target, dates)) target.issues = [...(target.issues || []), result.issue];
    }
  }
  if (startUtc && endUtc && rceNeeded) {
    const result = await hourlyMarketPrices(requestedHours, startUtc, endUtc, 'RCE');
    rcePricesNetPlnPerKwh = result.prices;
    if (result.issue) {
      if (draft.currentSettlement === 'NET_BILLING') current.issues = [...(current.issues || []), result.issue];
      if (draft.targetSettlement === 'NET_BILLING') target.issues = [...(target.issues || []), result.issue];
    }
  }

  const input: CalculateOfferWorkspaceValuationInput = {
    measurements: {
      months: workspace.measurements.months,
      dayProfiles: workspace.measurements.dayProfiles || [],
    },
    intervals,
    vatBasis: workspace.clientType === 'B2B' ? 'NET' : 'GROSS',
    connectionPowerKw: workspace.input.reportDetails?.connectionPowerKw ?? null,
    current,
    target,
    rdnPricesNetPlnPerKwh,
    rcePricesNetPlnPerKwh,
  };
  const artifact = { projectId: workspace.projectId, kind: 'valuation', key: {
    algorithmVersion: 'offer-valuation-v2-annual', sourceRevision: workspace.revision,
    inputs: offerCalculationDependencyHash(input),
  } };
  const cached = await getOfferWorkspaceArtifact<OfferWorkspaceValuation>(artifact);
  if (cached) return cached;
  const result = calculateOfferWorkspaceValuation(input);
  if (sourceNote) {
    result.current.issues.push(sourceNote);
    result.target.issues.push(sourceNote);
  }
  // Failures of external sources are deliberately not made durable.
  if (!current.issues?.length && !target.issues?.length) await putOfferWorkspaceArtifact(artifact, result);
  return result;
}
