import { callClientTariffs, clientTariffScope, loadClientTariffHistory, readProjectGeneralTariffs } from './client-tariffs-server';
import { tariffToday, type ClientTariffHistory, type ClientTariffData, type ClientTariffPayload } from './client-tariffs';
import { calculateOfferWorkspaceEnergy, getOfferWorkspaceEnergySourceRevision } from './offer-workspace-energy-server';
import { overlayOfferWorkspaceMeasurements } from './offer-workspace-energy';
import { blockedOfferCalculation, calculateOfferWorkspaceScenario, offerLocalTime, type OfferCalculationInput } from './offer-workspace-calculation';
import { defaultOfferCalculationAssumptions, type OfferWorkspaceDraft } from './offer-workspace';
import type { OfferWorkspace } from './offer-workspace-server';
import type { OfferMeasurementSeries } from './offer-measurements';
import type { OfferWorkspaceCalculation, OfferWorkspaceRanking } from './offer-workspace-calculation-types';
import { OfferMarketDataError, offerHourlyMarketPrices, offerMarketIntervalStarts, type OfferStoredMarketRow } from './offer-workspace-market';
import { rePrisma } from './re-stations';
import { OfferPvSourceRevisionError, readOfferPvProfileWithSourceRevision } from './offer-pv-profile';
import { getOfferPvSourceRevision } from './offer-pv-source-revision';
import { configurationInvestmentScope } from './configuration-templates';
import {
  applyOfferWorkspaceConfigurationEdits,
  hasRemovedCriticalConfigurationItem,
  validateOfferWorkspaceConfigurationEdits,
} from './offer-workspace-configuration-edits';
import { enumerateOfferCandidates, type ApprovedConfigurationTemplate, type OfferCandidateEnumerationInput, type OfferCandidateSnapshot } from './offer-candidates';
import { offerCalculationDependencyHash, offerCalculationPeriodHours } from './offer-workspace-calculation-dependencies';
import { completeHistoryForSummary } from './client-energy-cost-summary-server';
import { invoiceNetMeteringFactorForPeriod, type InvoiceNetMeteringFactorResolution } from './invoice-net-metering-factor';
import { OFFER_RECOMMENDATION_BATCH_LIMIT, OFFER_RECOMMENDATION_COARSE_LIMIT, planOfferWorkspaceRecommendationSearch } from './offer-workspace-recommendation-search';
import { recommendationInputIssues } from './offer-workspace-recommendation-inputs';
import { PME2_RULES } from './offer-financing-v2';
import {
  calculateOfferWorkspaceExistingPvBatteryBounds,
  calculateOfferWorkspaceRecommendationBatteryBounds,
  filterOfferCandidatesByPvProduction,
  filterOfferCandidatesByRecommendationPvBounds,
  OFFER_RECOMMENDATION_MAX_BATTERY_KWH_PER_PV_KWP,
  validateOfferWorkspaceRecommendationConsumptionProfile,
} from './offer-workspace-recommendation-bounds';

const OFFER_RECOMMENDATION_SOFT_BUDGET_MS = 10 * 60 * 1000;

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function carryForwardWarnings(warnings: string[]): string[] {
  return warnings.filter(warning => !warning.startsWith('Porównanie niepełne:')
    && !warning.startsWith('Limit czasu etapu osiągnięty;')
    && !warning.startsWith('Szacowany czas zwrotu ma charakter orientacyjny')
    && !warning.startsWith('Wyniki wariantu są diagnostyczne;'));
}

function copyCalculation(value: OfferWorkspaceCalculation): OfferWorkspaceCalculation {
  return {
    ...value,
    evaluatedTemplateIds: value.evaluatedTemplateIds ? [...value.evaluatedTemplateIds] : undefined,
    reasons: [...value.reasons],
    warnings: carryForwardWarnings(value.warnings),
    recommendationReasons: value.recommendationReasons ? [...value.recommendationReasons] : undefined,
    recommendationBatteryBounds: value.recommendationBatteryBounds ? { ...value.recommendationBatteryBounds } : undefined,
    recommendationPvBounds: value.recommendationPvBounds ? { ...value.recommendationPvBounds } : undefined,
    rankings: value.rankings.map(row => ({ ...row, templateIds: [...row.templateIds], reasons: row.reasons ? [...row.reasons] : undefined })),
    recommendedTemplateIds: value.recommendedTemplateIds ? [...value.recommendedTemplateIds] : null,
    estimatedRecommendedTemplateIds: value.estimatedRecommendedTemplateIds ? [...value.estimatedRecommendedTemplateIds] : null,
    recommendationSearch: value.recommendationSearch ? {
      ...value.recommendationSearch,
      evaluatedCandidateIds: [...value.recommendationSearch.evaluatedCandidateIds],
    } : undefined,
  };
}

function templateIdOrder(ids: string[]): string {
  return [...ids].sort().join('\u0000');
}

function candidateOrder(id: unknown, templateIds: string[]): string {
  return typeof id === 'string' && id.length ? id : templateIdOrder(templateIds);
}

function compareCandidateOrder(leftKey: string, rightKey: string): number {
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function hasNoPaybackClaim(message: string): boolean {
  return /bez (?:rekomendacji i )?czasu zwrotu|(?:rekomendacja i )?czas zwrotu (?:pozostaje|pozostają )?(?:wyłączony|wyłączone)/iu.test(message);
}

function dateAfter(date: string) { return new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10); }
function historyTariff(history: ClientTariffHistory, date: string): ClientTariffPayload | null {
  const entry = history.byDate[date];
  if (typeof entry === 'string') return history.tariffs?.[entry] || null;
  return entry && typeof entry === 'object' ? entry : null;
}
function isOrdinaryMissingPriceIssue(message: string) {
  return /brak jednoznacznych cen/i.test(message) && !/konflikt/i.test(message);
}
function snapshotHistory(tariff: ClientTariffPayload, from: string, until: string): ClientTariffHistory {
  const byDate: ClientTariffHistory['byDate'] = {};
  for (let date = from; date < until; date = dateAfter(date)) byDate[date] = 'scenario';
  return { strict: true, revision: tariff.catalogRevision || 0, byDate, tariffs: { scenario: tariff }, issues: [] };
}

function unavailableBaselineHistory(from: string, reasons: string[]): ClientTariffHistory {
  return { strict: true, revision: 0, byDate: {}, tariffs: {},
    issues: reasons.map(message => ({ date: from, message })) };
}

async function marketPrices(start: string, end: string, hours: string[], kind: 'RDN' | 'RCE') {
  const db = rePrisma();
  // Identifiers are selected from these two constants, never from a request.
  const table = kind === 'RDN' ? 'powerplantRDN' : 'powerplantRCE';
  const date = 'dtime_utc';
  const value = kind === 'RDN' ? 'fixing_i_price' : 'rce_pln';
  const rows = await db.$queryRawUnsafe<OfferStoredMarketRow[]>(
    `SELECT DATE_FORMAT(\`${date}\`, '%Y-%m-%dT%H:%i:%sZ') AS stamp, period_utc AS periodUtc, CAST(\`${value}\` AS CHAR) AS price FROM \`${table}\` WHERE \`${date}\` > ? AND \`${date}\` <= ? ORDER BY \`${date}\` ASC LIMIT 35137`,
    start.replace('T', ' ').replace(/\.000Z$|Z$/, ''), end.replace('T', ' ').replace(/\.000Z$|Z$/, ''),
  );
  return offerHourlyMarketPrices(offerMarketIntervalStarts(rows), hours,
    { clampNegativeBeforeAverage: kind === 'RCE' });
}

async function financialSources(workspace: OfferWorkspace, draft: OfferWorkspaceDraft, hours: string[]) {
  const startUtc = hours[0], endUtc = new Date(Date.parse(hours.at(-1)!) + 3600000).toISOString();
  const from = offerLocalTime(startUtc).slice(0, 10), until = offerLocalTime(endUtc).slice(0, 10);
  const dates = [...new Set(hours.map(hour => offerLocalTime(hour).slice(0, 10)))];
  const scope = await clientTariffScope(workspace.clientId, workspace.projectId);
  let loadedBaselineHistory = await loadClientTariffHistory(workspace.clientId, workspace.projectId, from, until);
  const baselineReasons: string[] = [];
  if (!loadedBaselineHistory) {
    const general = (await readProjectGeneralTariffs(scope)).generalTariff;
    if (!general?.code) baselineReasons.push('Nie wybrano obecnej taryfy projektu. Uzupełnij zakładkę Taryfy.');
    else {
      const catalog = await callClientTariffs<ClientTariffData>({ action: 'get', scope });
      const operator = catalog.catalog.find(osd => general.osdId ? osd.id === general.osdId : osd.name.toLocaleLowerCase('pl') === general.operator.toLocaleLowerCase('pl') || osd.slug.toLowerCase() === general.operator.toLowerCase());
      const tariff = operator?.tariffs.find(item => general.tariffId ? item.id === general.tariffId : item.code.toLowerCase() === general.code.toLowerCase());
      if (!operator || !tariff) baselineReasons.push('Wybrana taryfa ogólna nie ma jednoznacznego odpowiednika w katalogu RE.');
      else loadedBaselineHistory = await callClientTariffs<ClientTariffHistory>({ action: 'catalog-history', scope, from, until, osdId: operator.id, tariffId: tariff.id });
    }
  }
  const baselineAssumptions: string[] = [];
  if (loadedBaselineHistory) {
    const originalHistory = loadedBaselineHistory;
    const completion = await completeHistoryForSummary({
      history: originalHistory, clientId: workspace.clientId, projectId: workspace.projectId, dates,
    }, { clientTariffScope, callClientTariffs, tariffToday });
    baselineAssumptions.push(...completion.assumptions);
    const resolvedByDate = new Set(dates.filter(date =>
      !historyTariff(originalHistory, date) && historyTariff(completion.history, date)));
    loadedBaselineHistory = {
      ...completion.history,
      issues: completion.history.issues.filter(issue =>
        !resolvedByDate.has(issue.date) || !isOrdinaryMissingPriceIssue(issue.message)),
    };
    baselineReasons.push(...loadedBaselineHistory.issues.map(issue => `${issue.date}: ${issue.message}`), ...completion.issues);
  }
  let baselineNetMeteringFactor: InvoiceNetMeteringFactorResolution | null = null;
  let baselineNetMeteringFactorIssue: string | null = null;
  if (draft.currentSettlement === 'NET_METERING' && draft.existingPv.powerKw !== 0) {
    try {
      baselineNetMeteringFactor = await invoiceNetMeteringFactorForPeriod({
        projectId: workspace.projectId,
        clientId: workspace.clientId,
        ppeNumber: workspace.ppeNumber,
        period: { startMonth: workspace.period.startMonth, endDate: workspace.period.endDate },
      });
    } catch (error) {
      return {
        reasons: [`Nie udało się zweryfikować współczynnika opustu z faktur dla PPE: ${error instanceof Error ? error.message : 'błąd źródła'}.`],
        baselineAssumptions,
      };
    }
    if (baselineNetMeteringFactor.status === 'selected') {
      baselineAssumptions.push(`Współczynnik opustu ${baselineNetMeteringFactor.factor} przyjęto z potwierdzonej faktury ENEA dla PPE (${baselineNetMeteringFactor.invoicePeriods.join(', ')}); zastosowano go wyłącznie do rachunku bazowego NET_METERING.`);
    } else if (baselineNetMeteringFactor.status === 'ambiguous') {
      baselineNetMeteringFactorIssue = `Niejednoznaczny współczynnik opustu na potwierdzonych fakturach dla PPE (${baselineNetMeteringFactor.factors.join(', ')}); nie można porównać rachunku bazowego.`;
    } else if (baselineNetMeteringFactor.status === 'invalid') {
      baselineNetMeteringFactorIssue = 'Sprzeczne lub nieobsługiwane dane współczynnika opustu na potwierdzonej fakturze dla PPE; nie można porównać rachunku bazowego.';
    } else if (baselineNetMeteringFactor.status === 'missing' && draft.existingPv.powerKw == null) {
      baselineNetMeteringFactorIssue = 'Brak potwierdzonego współczynnika opustu z faktury i jawnej mocy istniejącej PV; nie można porównać rachunku bazowego.';
    }
  }
  const baselineUsable = loadedBaselineHistory !== null && baselineReasons.length === 0;
  const baselineDependency = baselineUsable
    ? { status: 'available', history: loadedBaselineHistory, assumptions: baselineAssumptions }
    : { status: 'incomplete', history: loadedBaselineHistory, reasons: baselineReasons, assumptions: baselineAssumptions };
  const baselineHistory = baselineUsable ? loadedBaselineHistory! : unavailableBaselineHistory(from, baselineReasons);
  const pricesAsOf = tariffToday();
  const target = await callClientTariffs<ClientTariffPayload>({ action: 'catalog', scope, date: pricesAsOf, osdId: draft.targetOperatorId, tariffId: draft.targetTariffId });
  const historicalTariffs = baselineUsable
    ? [...Object.values(baselineHistory.tariffs || {}), ...Object.values(baselineHistory.byDate).filter((value): value is ClientTariffPayload => value !== null && typeof value === 'object')]
    : [];
  const needsRdn = [...historicalTariffs, target].some(tariff => (tariff as ClientTariffPayload & { sell_method?: string }).sell_method === 'rdn');
  let rdnPricesNet: Map<string, number>, rce: Map<string, number>;
  try {
    rdnPricesNet = needsRdn ? await marketPrices(startUtc, endUtc, hours, 'RDN') : new Map<string, number>();
    rce = draft.targetSettlement === 'NET_BILLING' || (baselineUsable && draft.currentSettlement === 'NET_BILLING')
      ? await marketPrices(startUtc, endUtc, hours, 'RCE') : new Map<string, number>();
  } catch (error) {
    if (error instanceof OfferMarketDataError) return { reasons: [error.message], baselineAssumptions };
    throw error;
  }
  const exportPrices = new Map([...rce].map(([hour, value]) => [hour, Math.max(0, value) * 1.23]));
  const targetHistory = snapshotHistory(target, from, until);
  const sourceDependencyStamp = offerCalculationDependencyHash({ startUtc, endUtc, pricesAsOf,
    baseline: baselineDependency, targetHistory, rdnPricesNet, exportPrices,
    baselineNetMeteringFactor: baselineNetMeteringFactor ? {
      status: baselineNetMeteringFactor.status,
      factor: baselineNetMeteringFactor.factor,
      sourceRevision: baselineNetMeteringFactor.sourceRevision,
    } : null });
  return { baselineHistory, baselineReasons, baselineAssumptions, baselineNetMeteringFactor, baselineNetMeteringFactorIssue,
    targetHistory, rdnPricesNet, exportPrices, pricesAsOf, sourceDependencyStamp };
}

function offerCandidateEnumerationInput(workspace: OfferWorkspace, draft: OfferWorkspaceDraft): OfferCandidateEnumerationInput {
  const settings = draft.calculation || defaultOfferCalculationAssumptions();
  return {
    approvedConfigurationTemplates: workspace.templates.map(template => ({ ...template, isActive: true })) as ApprovedConfigurationTemplate[],
    clientType: workspace.clientType === 'B2B' ? 'B2B' : 'B2C',
    roofType: workspace.input.reportDetails?.roofType?.toLocaleLowerCase('pl').includes('płask') ? 'FLAT'
      : workspace.input.reportDetails?.roofType ? 'SLOPED' : 'UNKNOWN',
    pvStrategy: draft.pvStrategy,
    existingPv: { powerKw: draft.existingPv.powerKw!, tiltDegrees: draft.existingPv.tiltDegrees, azimuthDegrees: draft.existingPv.azimuthDegrees },
    addedPvGeometry: draft.pvStrategy === 'ADD_TEMPLATE' && settings.addedPvTiltDegrees !== null && settings.addedPvAzimuthDegrees !== null
      ? { tiltDegrees: settings.addedPvTiltDegrees, azimuthDegrees: settings.addedPvAzimuthDegrees } : null,
    existingPvCompatibilityEvidence: 'unknown',
    existingInverterCompatibilityEvidence: 'unknown',
    saleVatMode: draft.saleVatMode,
  };
}

function recommendationDraftIdentity(draft: OfferWorkspaceDraft) {
  const settings = draft.calculation || defaultOfferCalculationAssumptions();
  return {
    schemaVersion: draft.schemaVersion,
    objective: draft.objective,
    existingBatteryPresent: draft.existingBatteryPresent ?? null,
    existingPv: {
      powerKw: draft.existingPv.powerKw,
      tiltDegrees: draft.existingPv.tiltDegrees,
      azimuthDegrees: draft.existingPv.azimuthDegrees,
      lossPercent: draft.existingPv.lossPercent,
    },
    pvStrategy: draft.pvStrategy,
    currentSettlement: draft.currentSettlement,
    targetSettlement: draft.targetSettlement,
    targetOperatorId: draft.targetOperatorId,
    targetTariffId: draft.targetTariffId,
    saleVatMode: draft.saleVatMode,
    financing: { ...draft.financing },
    calculation: { ...settings },
  };
}

export function offerWorkspaceCalculationRequiresPvSource(
  workspace: OfferWorkspace,
  draft: OfferWorkspaceDraft,
  mode: 'selected' | 'recommend',
): boolean {
  if ((draft.existingPv.powerKw ?? 0) > 0) return true;
  const settings = draft.calculation || defaultOfferCalculationAssumptions();
  const location = workspace.input.location;
  if (location?.latitude == null || location.longitude == null
    || settings.addedPvTiltDegrees === null || settings.addedPvAzimuthDegrees === null
    || draft.existingPv.lossPercent === null) return false;

  const sourceTemplates = mode === 'selected'
    ? applyOfferWorkspaceConfigurationEdits(workspace.templates, draft)
    : workspace.templates;
  const pvTemplateIds = new Set(sourceTemplates
    .filter(template => configurationInvestmentScope(template.kind) === 'PV' && Boolean(template.powerKw))
    .map(template => template.id));
  if (!pvTemplateIds.size) return false;
  if (mode === 'selected') return draft.selectedTemplateIds.some(id => pvTemplateIds.has(id));
  if (draft.pvStrategy !== 'ADD_TEMPLATE' || draft.existingPv.powerKw == null) return false;
  const enumeration = enumerateOfferCandidates(offerCandidateEnumerationInput(workspace, draft));
  return enumeration.candidates.some(candidate => candidate.templateIds.some(id => pvTemplateIds.has(id)));
}

function dependencyStampWithPvSource(workspace: OfferWorkspace, draft: OfferWorkspaceDraft,
  financialStamp: string, requiresPvSource: boolean, sourceRevision?: string | null): string | null {
  if (!requiresPvSource) return financialStamp;
  const location = workspace.input.location;
  if (location?.latitude == null || location.longitude == null) return null;
  const revision = sourceRevision === undefined ? getOfferPvSourceRevision(location) : sourceRevision;
  if (!revision) return null;
  return offerCalculationDependencyHash({ financialSourceDependencyStamp: financialStamp, pvSourceRevision: revision });
}

function currentPvSourceRevision(location: { latitude: number; longitude: number }): string | null {
  try { return getOfferPvSourceRevision(location); }
  catch (error) {
    throw new OfferPvSourceRevisionError(error instanceof Error ? error.message : 'Nie udało się odczytać aktualnego źródła PV.');
  }
}

function assertPvSourceRevisionStable(workspace: OfferWorkspace, required: boolean, usedRevision: string | null): void {
  if (!required) return;
  const location = workspace.input.location;
  if (location?.latitude == null || location.longitude == null) {
    throw new OfferPvSourceRevisionError('Brak współrzędnych dla wymaganej rewizji źródła PV.');
  }
  if (!usedRevision || currentPvSourceRevision(location) !== usedRevision) {
    throw new OfferPvSourceRevisionError('Źródło PV zmieniło się podczas obliczania. Ponów obliczenia.');
  }
}

export async function loadOfferCalculationDependencyStamp(
  workspace: OfferWorkspace,
  draft: OfferWorkspaceDraft,
  options: { mode?: 'selected' | 'recommend'; requiresPvSource?: boolean } = {},
): Promise<string | null> {
  if (!draft.targetOperatorId || !draft.targetTariffId) return null;
  const dependencyMonths = workspace.measurements.availability === 'NO_FILES'
    && typeof workspace.input.annualConsumptionKwh === 'number' && workspace.input.annualConsumptionKwh > 0
    ? workspace.period.periodKeys.map(period => ({ period })) : workspace.measurements.months;
  const hours = offerCalculationPeriodHours(dependencyMonths);
  if (!hours) return null;
  const sources = await financialSources(workspace, draft, hours);
  if ('reasons' in sources) return null;
  const requiresPvSource = options.requiresPvSource ?? offerWorkspaceCalculationRequiresPvSource(workspace, draft, options.mode ?? 'selected');
  return dependencyStampWithPvSource(workspace, draft, sources.sourceDependencyStamp, requiresPvSource);
}

export async function calculateOfferWorkspaceOnServer(workspace: OfferWorkspace, draft: OfferWorkspaceDraft,
  series: OfferMeasurementSeries | null, mode: 'selected' | 'recommend',
  onProgress: (completed: number, total: number) => void = () => undefined,
  previousRecommendation?: OfferWorkspaceCalculation): Promise<OfferWorkspaceCalculation> {
  const calculationStartedAt = Date.now();
  const hasContinuation = mode === 'recommend' && Boolean(previousRecommendation?.recommendationSearch?.hasMore);
  const settings = draft.calculation || defaultOfferCalculationAssumptions();
  const missing: string[] = [];
  if (!draft.targetOperatorId || !draft.targetTariffId) missing.push('Wybierz taryfę docelową.');
  if (!workspace.input.reportDetails?.connectionPowerKw) missing.push('Uzupełnij moc przyłączeniową w danych energetycznych.');
  if (mode === 'recommend') missing.push(...recommendationInputIssues(draft).map(issue => issue.message));
  if (missing.length) {
    if (hasContinuation) throw new Error(`Nie można kontynuować rekomendacji: ${missing.join(' ')}`);
    return blockedOfferCalculation(missing);
  }
  if (mode === 'selected') {
    try {
      validateOfferWorkspaceConfigurationEdits(workspace.templates, draft);
    } catch (error) {
      return blockedOfferCalculation([error instanceof Error ? error.message : 'Nieprawidłowe zmiany pozycji konfiguracji.']);
    }
    if (hasRemovedCriticalConfigurationItem(workspace.templates, draft)) {
      const blocked = blockedOfferCalculation([
        'Usunięto główne urządzenie zestawu. Pełnej kalkulacji nie można wykonać; wybierz inną konfigurację z kompletem wymaganych urządzeń.',
      ]);
      blocked.evaluatedTemplateIds = [...draft.selectedTemplateIds];
      return blocked;
    }
  }
  if (mode === 'recommend' && draft.pvStrategy === 'KEEP_EXISTING'
    && !(typeof draft.existingPv.powerKw === 'number' && Number.isFinite(draft.existingPv.powerKw) && draft.existingPv.powerKw > 0)) {
    const reason = 'Uzupełnij dodatnią moc istniejącej instalacji PV albo wybierz rozbudowę PV, aby rekomendować gotowe konfiguracje magazynu.';
    if (hasContinuation) throw new Error(`Nie można kontynuować rekomendacji: ${reason}`);
    return blockedOfferCalculation([reason]);
  }
  const requiresPvSource = offerWorkspaceCalculationRequiresPvSource(workspace, draft, mode);
  const energy = await calculateOfferWorkspaceEnergy(workspace, draft, series);
  const calculationWorkspace = energy.modelledMeasurements
    ? { ...workspace, measurements: overlayOfferWorkspaceMeasurements(workspace.measurements, energy) }
    : workspace;
  const existingPvSourceRevision = (draft.existingPv.powerKw ?? 0) > 0
    ? getOfferWorkspaceEnergySourceRevision(energy) : null;
  if ((draft.existingPv.powerKw ?? 0) > 0 && !existingPvSourceRevision) {
    throw new OfferPvSourceRevisionError('Nie udało się potwierdzić rewizji profilu istniejącej instalacji PV.');
  }
  let pvSourceRevisionUsed = existingPvSourceRevision
    ?? (requiresPvSource && workspace.input.location?.latitude != null && workspace.input.location.longitude != null
      ? currentPvSourceRevision(workspace.input.location) : null);
  if (existingPvSourceRevision) assertPvSourceRevisionStable(workspace, true, existingPvSourceRevision);
  if (!energy.intervals?.length) {
    if (hasContinuation) throw new Error('Nie można kontynuować rekomendacji: brak pełnych interwałów energii.');
    return blockedOfferCalculation(['Brak pełnych interwałów energii.']);
  }
  let recommendationBatteryRange = null;
  if (mode === 'recommend' && draft.pvStrategy === 'KEEP_EXISTING') {
    const profileReason = validateOfferWorkspaceRecommendationConsumptionProfile(energy.intervals, workspace.period);
    recommendationBatteryRange = profileReason
      ? { bounds: null, reason: profileReason }
      : calculateOfferWorkspaceExistingPvBatteryBounds(draft.existingPv.powerKw);
  } else if (mode === 'recommend') {
    recommendationBatteryRange = calculateOfferWorkspaceRecommendationBatteryBounds(energy.intervals, workspace.period);
  }
  if (recommendationBatteryRange && !recommendationBatteryRange.bounds) {
    if (hasContinuation) throw new Error(`Nie można kontynuować rekomendacji: ${recommendationBatteryRange.reason}`);
    return blockedOfferCalculation([recommendationBatteryRange.reason]);
  }
  const first = energy.intervals[0], last = energy.intervals.at(-1)!;
  const sources = await financialSources(calculationWorkspace, draft, energy.intervals.map(row => row.startUtc));
  if ('reasons' in sources) {
    if (pvSourceRevisionUsed) assertPvSourceRevisionStable(workspace, requiresPvSource, pvSourceRevisionUsed);
    if (hasContinuation) throw new Error(`Nie można kontynuować rekomendacji: ${sources.reasons!.join(' ')}`);
    const result = blockedOfferCalculation(sources.reasons!);
    result.warnings = [...new Set('baselineAssumptions' in sources ? sources.baselineAssumptions : [])];
    return result;
  }
  const { sourceDependencyStamp, baselineReasons, baselineAssumptions, ...financial } = sources;
  let dependencyStamp = dependencyStampWithPvSource(workspace, draft, sourceDependencyStamp, requiresPvSource,
    requiresPvSource ? pvSourceRevisionUsed : undefined);
  const attachSourceIdentity = (result: OfferWorkspaceCalculation) => {
    if (pvSourceRevisionUsed) assertPvSourceRevisionStable(workspace, requiresPvSource, pvSourceRevisionUsed);
    result.pricesAsOf = financial.pricesAsOf;
    result.sourceDependencyStamp = dependencyStamp;
    return result;
  };
  const common: Omit<OfferCalculationInput, 'draft' | 'addedPvHours'> = { workspace: calculationWorkspace, energy, ...financial };
  const addedProfiles = new Map<string, Map<string, number>>();
  async function loadAddedPvHours(powerKw: number) {
    if (settings.addedPvTiltDegrees == null || settings.addedPvAzimuthDegrees == null || draft.existingPv.lossPercent == null) throw new Error('Uzupełnij geometrię dodatkowej PV i straty modelu.');
    const location = workspace.input.location;
    if (location?.latitude == null || location.longitude == null) throw new Error('Brak współrzędnych instalacji PV.');
    const key = String(powerKw);
    if (!addedProfiles.has(key)) {
      const profileRead = await readOfferPvProfileWithSourceRevision({ latitude: location.latitude, longitude: location.longitude, powerKw,
        tiltDegrees: settings.addedPvTiltDegrees, azimuthDegrees: settings.addedPvAzimuthDegrees, lossPercent: draft.existingPv.lossPercent,
        fromUtc: first.startUtc, untilUtc: last.endUtc });
      if (!requiresPvSource) throw new OfferPvSourceRevisionError('Obliczenie użyło PV spoza zapisanego kontekstu źródłowego.');
      if (!profileRead.sourceRevision) {
        throw new OfferPvSourceRevisionError('Nie udało się potwierdzić rewizji dodanego profilu PV.');
      }
      if (pvSourceRevisionUsed && profileRead.sourceRevision !== pvSourceRevisionUsed) {
        throw new OfferPvSourceRevisionError('Źródło PV zmieniło się między profilami użytymi w obliczeniu. Ponów obliczenia.');
      }
      pvSourceRevisionUsed = profileRead.sourceRevision;
      assertPvSourceRevisionStable(workspace, true, pvSourceRevisionUsed);
      addedProfiles.set(key, new Map(profileRead.profile.hours.map(hour => [hour.startUtc, hour.pvKwh])));
      dependencyStamp = dependencyStampWithPvSource(workspace, draft, sourceDependencyStamp, true, profileRead.sourceRevision);
    }

    return addedProfiles.get(String(powerKw))!;
  }
  async function calculate(selectedDraft: OfferWorkspaceDraft) {
    const effectiveDraft = mode === 'recommend' ? { ...selectedDraft, configurationEdits: undefined, commercialPricing: undefined } : selectedDraft;
    const templates = mode === 'recommend'
      ? workspace.templates
      : applyOfferWorkspaceConfigurationEdits(workspace.templates, effectiveDraft);
    const pv = templates.find(item => effectiveDraft.selectedTemplateIds.includes(item.id) && configurationInvestmentScope(item.kind) === 'PV');
    let addedPvHours = new Map<string, number>();
    if (pv) {
      if (!pv.powerKw || settings.addedPvTiltDegrees === null || settings.addedPvAzimuthDegrees === null || draft.existingPv.lossPercent === null) {
        return blockedOfferCalculation(['Uzupełnij moc, nachylenie i azymut rozbudowy PV oraz straty modelu.']);
      }
      addedPvHours = await loadAddedPvHours(pv.powerKw);

    }
    const result = await calculateOfferWorkspaceScenario({ ...common, draft: effectiveDraft, addedPvHours });
    result.sourceDependencyStamp = dependencyStamp;
    result.pricesAsOf = financial.pricesAsOf;
    result.warnings = [...new Set([...result.warnings, ...baselineReasons, ...baselineAssumptions])];
    return result;
  }
  if (mode === 'selected') { onProgress(0, 1); const result = await calculate(draft); onProgress(1, 1); return attachSourceIdentity(result); }
  // Every candidate must be comparable to the same target tariff without new equipment.
  // Check that common bill once before loading added-PV profiles or counting candidates.
  {
    const tariffCheck = await calculateOfferWorkspaceScenario({ ...common,
      draft: { ...draft, pvStrategy: 'KEEP_EXISTING', selectedTemplateIds: [],
        financing: { considerGrant: false, considerTaxRelief: false }, configurationEdits: undefined, commercialPricing: undefined },
      addedPvHours: new Map(),
    });
    if (tariffCheck.status === 'blocked') {
      if (hasContinuation) throw new Error(`Nie można kontynuować rekomendacji: ${tariffCheck.reasons.join(' ')}`);
      const blocked = blockedOfferCalculation(tariffCheck.reasons);
      blocked.warnings = [...new Set([...tariffCheck.warnings, ...baselineReasons, ...baselineAssumptions])];
      return attachSourceIdentity(blocked);
    }
  }
  const enumeration = enumerateOfferCandidates(offerCandidateEnumerationInput(workspace, draft));
  const unfilteredCandidates = enumeration.candidates;
  const batteryFilter = filterOfferCandidatesByRecommendationPvBounds(unfilteredCandidates);
  const consumptionKwh = energy.intervals.reduce((sum, row) => sum + row.loadKwh!, 0);
  const addedProduction = new Map<number, number>();
  let pvFilter: { candidates: OfferCandidateSnapshot[]; totalCandidatesBeforeFilter: number; excludedCandidates: number } | null = null;
  if (draft.pvStrategy === 'ADD_TEMPLATE' && batteryFilter.candidates.length) {
    for (const powerKw of new Set(batteryFilter.candidates.map(candidate => candidate.addedPvKw))) {
      if (powerKw === 0) continue;
      const profile = await loadAddedPvHours(powerKw);
      let production = 0;
      for (const row of energy.intervals) {
        const pvKwh = profile.get(row.startUtc);
        if (pvKwh == null || !Number.isFinite(pvKwh) || pvKwh < 0) throw new Error('Niepełny profil dodawanej PV do filtrowania produkcji.');
        production += pvKwh;
      }
      addedProduction.set(powerKw, production);
    }
    if (energy.intervals.some(row => row.pvKwh == null || !Number.isFinite(row.pvKwh) || row.pvKwh < 0)) throw new Error('Niepełny profil istniejącej PV do filtrowania produkcji.');
    const existingProductionKwh = energy.intervals.reduce((sum, row) => sum + row.pvKwh!, 0);
    pvFilter = filterOfferCandidatesByPvProduction(batteryFilter.candidates, consumptionKwh, existingProductionKwh, addedProduction);
  }
  const recommendationBatteryBounds: NonNullable<OfferWorkspaceCalculation['recommendationBatteryBounds']> = draft.pvStrategy === 'KEEP_EXISTING'
    ? { ...recommendationBatteryRange!.bounds!, totalCandidatesBeforeFilter: batteryFilter.totalCandidatesBeforeFilter, excludedCandidates: batteryFilter.excludedCandidates }
    : { basis: 'pv_production', totalConsumptionKwh: consumptionKwh,
      minimumPvProductionKwh: 0.8 * consumptionKwh, maximumPvProductionKwh: 1.2 * consumptionKwh,
      minimumBatteryCapacityKwh: unfilteredCandidates.length ? Math.min(...unfilteredCandidates.map(candidate => 2 * candidate.totalPvKw)) : 0,
      maximumBatteryCapacityKwh: unfilteredCandidates.length ? Math.max(...unfilteredCandidates.map(candidate => 3 * candidate.totalPvKw)) : 0,
      totalCandidatesBeforeFilter: batteryFilter.totalCandidatesBeforeFilter, excludedCandidates: batteryFilter.excludedCandidates };
  const recommendationPvBounds = draft.pvStrategy === 'ADD_TEMPLATE' ? {
    minimumBatteryKwhPerPvKwp: 2, maximumBatteryKwhPerPvKwp: OFFER_RECOMMENDATION_MAX_BATTERY_KWH_PER_PV_KWP,
    minimumProductionKwh: 0.8 * consumptionKwh, maximumProductionKwh: 1.2 * consumptionKwh, consumptionKwh,
    pvBasis: 'existing_plus_added' as const,
    totalCandidatesBeforeFilter: pvFilter?.totalCandidatesBeforeFilter ?? 0,
    excludedCandidates: pvFilter?.excludedCandidates ?? 0,
  } : undefined;
  const sizeCandidates = pvFilter ? pvFilter.candidates : batteryFilter.candidates;
  const requiresPme2Capacity = workspace.clientType === 'B2C' && draft.financing.considerGrant;
  const candidates = requiresPme2Capacity ? sizeCandidates.filter(candidate =>
    candidate.batteryCapacityKwh >= PME2_RULES.minimumBatteryCapacityKwh
    && candidate.totalPvKw > 0
    && candidate.batteryCapacityKwh >= PME2_RULES.minimumBatteryToPvRatio * candidate.totalPvKw) : sizeCandidates;
  if (!unfilteredCandidates.length) {
    if (hasContinuation) throw new Error('Nie można kontynuować rekomendacji: katalog nie zawiera już wariantów do oceny.');
    const rejectedReasons = enumeration.rejectedReasonList.flatMap(item => item.reasons);
    const result = blockedOfferCalculation(rejectedReasons.length ? [...new Set(rejectedReasons)]
      : ['Brak technicznie dopuszczalnego zestawu do obliczeń.']);
    result.recommendationBatteryBounds = recommendationBatteryBounds;
    result.recommendationPvBounds = recommendationPvBounds;
    return attachSourceIdentity(result);
  }
  if (!batteryFilter.candidates.length) {
    if (hasContinuation) throw new Error('Nie można kontynuować rekomendacji: katalog nie zawiera już wariantów do oceny.');
    const reason = 'Brak gotowych konfiguracji z magazynem w zakresie 2–3 kWh na 1 kWp łącznej mocy PV (istniejąca + dodawana).';
    const result = blockedOfferCalculation([reason]);
    result.recommendationBatteryBounds = recommendationBatteryBounds;
    result.recommendationPvBounds = recommendationPvBounds;
    return attachSourceIdentity(result);
  }
  if (!sizeCandidates.length) {
    if (hasContinuation) throw new Error('Nie można kontynuować rekomendacji: nie pozostały warianty spełniające limit PV.');
    if (!recommendationPvBounds) throw new Error('Nie można kontynuować rekomendacji: brak PV do filtrowania.');
    const result = blockedOfferCalculation(['Brak gotowych konfiguracji z produkcją PV w zakresie 80–120% zużycia w okresie analizy (istniejąca + dodawana).']);
    result.recommendationBatteryBounds = recommendationBatteryBounds;
    result.recommendationPvBounds = recommendationPvBounds;
    return attachSourceIdentity(result);
  }
  if (!candidates.length) {
    const reason = `Brak konfiguracji spełniających warunki pojemności PME2: minimum ${PME2_RULES.minimumBatteryCapacityKwh} kWh i co najmniej ${PME2_RULES.minimumBatteryToPvRatio}× łącznej mocy PV (istniejąca + dodawana). Wyłącz uwzględnianie dotacji, aby porównać również mniejsze magazyny.`;
    if (hasContinuation) throw new Error(`Nie można kontynuować rekomendacji: ${reason}`);
    const result = blockedOfferCalculation([reason]);
    result.recommendationBatteryBounds = recommendationBatteryBounds;
    result.recommendationPvBounds = recommendationPvBounds;
    return attachSourceIdentity(result);
  }
  const candidateSignature = offerCalculationDependencyHash({
    pricesAsOf: financial.pricesAsOf,
    draft: recommendationDraftIdentity(draft),
    energy,
    recommendationBatteryBounds,
    recommendationPvBounds,
    candidates: [...candidates].sort((left, right) => compareCandidateOrder(left.id, right.id)).map(candidate => ({
      id: candidate.id,
      templateIds: candidate.templateIds,
      templateVersions: candidate.templateVersions,
      totals: candidate.totals,
      existingPvKw: candidate.existingPvKw,
      addedPvKw: candidate.addedPvKw,
      totalPvKw: candidate.totalPvKw,
      batteryCapacityKwh: candidate.batteryCapacityKwh,
      batteryPowerKw: candidate.batteryPowerKw,
      requiresReview: candidate.requiresReview,
      reviewReasons: candidate.reviewReasons,
      missingPrices: candidate.missingPrices,
    })),
  });
  const candidateIds = new Set(candidates.map(candidate => candidate.id));
  const previousSearch = previousRecommendation?.recommendationSearch;
  const previousVisited = previousSearch?.evaluatedCandidateIds;
  const previousMatches = Boolean(previousRecommendation && previousSearch?.version === 1
    && previousSearch.candidateSignature === candidateSignature
    && previousSearch.totalCandidates === candidates.length
    && previousRecommendation.sourceDependencyStamp === dependencyStamp
    && previousRecommendation.pricesAsOf === financial.pricesAsOf
    && dependencyStamp !== null
    && Array.isArray(previousVisited)
    && new Set(previousVisited).size === previousVisited.length
    && previousVisited.every(id => candidateIds.has(id))
    && previousVisited.length === previousSearch.evaluatedCandidates);
  if (hasContinuation && !previousMatches) {
    throw new Error('Źródła taryfy, PV lub katalogu zmieniły się od poprzedniego etapu rekomendacji. Rozpocznij nowe wyszukiwanie.');
  }
  const trustedPrevious = previousMatches ? previousRecommendation : undefined;
  const initialPlan = planOfferWorkspaceRecommendationSearch({ candidates, candidateSignature,
    previousRecommendation: trustedPrevious });
  const candidatesById = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const rankingMap = new Map<string, OfferWorkspaceRanking>();
  const rankingIds = new Map<string, string>();
  const errors: string[] = [];
  const blockingErrors: string[] = [];
  let winner: OfferWorkspaceCalculation | null = null;
  let winnerTemplateIds: string[] | null = null;
  let winnerId = '';
  let bestEstimate: OfferWorkspaceCalculation | null = null;
  let bestEstimateTemplateIds: string[] | null = null;
  let bestEstimateId = '';
  let bestEstimateReasons: string[] = [];
  let bestEstimatePayback = Infinity;
  let bestEstimateCost = Infinity;
  let bestDiagnostic: OfferWorkspaceCalculation | null = null;
  let bestDiagnosticTemplateIds: string[] | null = null;
  let bestDiagnosticId = '';
  let bestDiagnosticReasons: string[] = [];
  let bestDiagnosticSavings = -Infinity;
  let incompleteCandidates = previousMatches
    ? Math.max(0, previousSearch!.evaluatedCandidates - (previousRecommendation!.rankings || []).length) : 0;
  let best = Infinity;
  const inheritedWarnings = previousMatches ? carryForwardWarnings(previousRecommendation!.warnings) : [];
  for (const candidate of candidates) rankingIds.set(templateIdOrder(candidate.templateIds), candidateOrder(candidate.id, candidate.templateIds));
  if (previousMatches) {
    for (const row of previousRecommendation!.rankings) {
      const key = templateIdOrder(row.templateIds);
      if (candidates.some(candidate => templateIdOrder(candidate.templateIds) === key)) {
        rankingMap.set(key, { ...row, templateIds: [...row.templateIds], reasons: row.reasons ? [...row.reasons] : undefined });
      }
    }
    const priorIds = previousRecommendation!.evaluatedTemplateIds
      || previousRecommendation!.recommendedTemplateIds
      || previousRecommendation!.estimatedRecommendedTemplateIds
      || [];
    const priorCandidate = candidates.find(candidate => templateIdOrder(candidate.templateIds) === templateIdOrder(priorIds));
    const priorRanking = priorCandidate ? rankingMap.get(templateIdOrder(priorCandidate.templateIds)) : undefined;
    if (priorCandidate && priorRanking) {
      const priorValue = copyCalculation(previousRecommendation!);
      if (priorRanking.recommendationEligible === true && finiteNonnegative(priorRanking.paybackYears)) {
        winner = priorValue;
        winnerTemplateIds = [...priorCandidate.templateIds];
        winnerId = candidateOrder(priorCandidate.id, priorCandidate.templateIds);
        best = priorRanking.paybackYears;
      } else if (finiteNonnegative(priorRanking.estimatedPaybackYears)) {
        bestEstimate = priorValue;
        bestEstimateTemplateIds = [...priorCandidate.templateIds];
        bestEstimateId = candidateOrder(priorCandidate.id, priorCandidate.templateIds);
        bestEstimateReasons = [...(priorRanking.reasons || [])];
        bestEstimatePayback = priorRanking.estimatedPaybackYears;
        bestEstimateCost = finiteNonnegative(priorRanking.costAfterFinancingPln) ? priorRanking.costAfterFinancingPln : Infinity;
      } else {
        bestDiagnostic = priorValue;
        bestDiagnosticTemplateIds = [...priorCandidate.templateIds];
        bestDiagnosticId = candidateOrder(priorCandidate.id, priorCandidate.templateIds);
        bestDiagnosticReasons = [...(priorRanking.reasons || [])];
        bestDiagnosticSavings = typeof priorRanking.annualSavingsPln === 'number' && Number.isFinite(priorRanking.annualSavingsPln)
          ? priorRanking.annualSavingsPln : -Infinity;
      }
    }
  }

  const sortedRankings = () => [...rankingMap.values()].sort((a, b) => {
    const tier = (row: OfferWorkspaceRanking) => row.recommendationEligible ? 0
      : finiteNonnegative(row.estimatedPaybackYears) ? 1 : 2;
    const leftTier = tier(a), rightTier = tier(b);
    return leftTier - rightTier
      || (leftTier === 0 ? (a.paybackYears ?? Infinity) - (b.paybackYears ?? Infinity)
        : leftTier === 1 ? a.estimatedPaybackYears! - b.estimatedPaybackYears!
          : (b.annualSavingsPln ?? -Infinity) - (a.annualSavingsPln ?? -Infinity))
      || (a.costAfterFinancingPln ?? Infinity) - (b.costAfterFinancingPln ?? Infinity)
      || compareCandidateOrder(rankingIds.get(templateIdOrder(a.templateIds)) || templateIdOrder(a.templateIds),
        rankingIds.get(templateIdOrder(b.templateIds)) || templateIdOrder(b.templateIds));
  });

  const initialVisited = previousMatches ? [...previousVisited!] : [];
  const evaluatedCandidateIds = [...initialVisited];
  const evaluatedSet = new Set(evaluatedCandidateIds);
  let batchEvaluated = 0;
  const batchNumber = initialPlan.batchNumber;
  const progressTotal = candidates.length;
  onProgress(initialVisited.length, progressTotal);
  const queued = initialPlan.candidateIds.map(id => candidatesById.get(id)).filter((candidate): candidate is OfferCandidateSnapshot => Boolean(candidate));
  let queueIndex = 0;
  let refinementConsidered = initialPlan.phase !== 'coarse';
  let timeBudgetReached = false;

  const makeInterimRecommendation = (): OfferWorkspaceCalculation => {
    const full = winner || bestEstimate || bestDiagnostic || trustedPrevious;
    const snapshot = full ? copyCalculation(full)
      : blockedOfferCalculation(['Trwa etapowe porównanie kandydatów.']);
    snapshot.rankings = sortedRankings();
    snapshot.recommendedTemplateIds = winnerTemplateIds ? [...winnerTemplateIds] : null;
    snapshot.estimatedRecommendedTemplateIds = !winner && bestEstimateTemplateIds ? [...bestEstimateTemplateIds] : null;
    snapshot.evaluatedTemplateIds = winnerTemplateIds || bestEstimateTemplateIds || bestDiagnosticTemplateIds || undefined;
    snapshot.pricesAsOf = financial.pricesAsOf;
    snapshot.sourceDependencyStamp = dependencyStamp;
    snapshot.recommendationSearch = {
      version: 1,
      candidateSignature,
      evaluatedCandidateIds: [...evaluatedCandidateIds],
      totalCandidates: candidates.length,
      evaluatedCandidates: evaluatedCandidateIds.length,
      batchNumber,
      batchEvaluated,
      hasMore: evaluatedCandidateIds.length < candidates.length,
      phase: 'coarse',
    };
    snapshot.recommendationBatteryBounds = { ...recommendationBatteryBounds };
    snapshot.recommendationPvBounds = recommendationPvBounds ? { ...recommendationPvBounds } : undefined;
    return snapshot;
  };

  const evaluateCandidate = async (candidate: OfferCandidateSnapshot) => {
    try {
      const value = await calculate({ ...draft, selectedTemplateIds: candidate.templateIds,
        ...(mode === 'recommend' ? { configurationEdits: undefined, commercialPricing: undefined } : {}) });
      value.evaluatedTemplateIds = [...candidate.templateIds];
      const hasTargetComparison = value.proposedAnnualCostPln != null && value.tariffOnlyAnnualCostPln != null
        && value.hardwareAnnualSavingsPln != null;
      const candidateReviewClear = candidate.requiresReview !== true && candidate.totals !== null
        && !(candidate.missingPrices || []).length;
      const recommendationEligible = candidateReviewClear && value.status === 'ready' && value.recommendationEligible === true
        && value.costAfterFinancingPln !== null && value.paybackYears !== null;
      const hasEstimateInputs = hasTargetComparison && candidate.totals != null && !(candidate.missingPrices || []).length;
      const estimatedPaybackYears = hasEstimateInputs && finiteNonnegative(value.estimatedPaybackYears)
        ? value.estimatedPaybackYears : null;
      const reviewReasons = candidate.reviewReasons || [];
      const supportingReasons = [...(candidate.missingPrices || []), ...(value.recommendationReasons || []), ...value.reasons]
        .filter(reason => recommendationEligible || estimatedPaybackYears === null || !hasNoPaybackClaim(reason));
      const candidateReasons = [...new Set([...reviewReasons, ...supportingReasons])];
      if (hasTargetComparison) {
        if (!recommendationEligible && !candidateReasons.length) {
          candidateReasons.push(estimatedPaybackYears === null
            ? 'Wariant policzono diagnostycznie; nie ma podstaw do rekomendacji ani zwrotu inwestycji.'
            : 'Wariant ma wyłącznie szacunkowy czas zwrotu i wymaga weryfikacji.');
        }
        const candidateKey = candidateOrder(candidate.id, candidate.templateIds);
        const templateKey = templateIdOrder(candidate.templateIds);
        rankingMap.set(templateKey, {
          templateIds: candidate.templateIds,
          name: workspace.templates.filter(template => candidate.templateIds.includes(template.id)).map(template => template.name).join(' + '),
          annualSavingsPln: value.hardwareAnnualSavingsPln,
          targetAnnualCostPln: value.proposedAnnualCostPln,
          tariffOnlyAnnualCostPln: value.tariffOnlyAnnualCostPln,
          costAfterFinancingPln: value.costAfterFinancingPln,
          paybackYears: recommendationEligible ? value.paybackYears : null,
          estimatedPaybackYears,
          recommendationEligible,
          reasons: candidateReasons,
        });
        if (recommendationEligible) {
          if (value.paybackYears! < best || (value.paybackYears === best && (!winnerId || compareCandidateOrder(candidateKey, winnerId) < 0))) {
            best = value.paybackYears!; winner = value; winnerTemplateIds = candidate.templateIds; winnerId = candidateKey;
          }
        } else {
          errors.push(...candidateReasons);
          if (estimatedPaybackYears !== null) {
            const cost = finiteNonnegative(value.costAfterFinancingPln) ? value.costAfterFinancingPln : Infinity;
            const betterEstimate = estimatedPaybackYears < bestEstimatePayback
              || (estimatedPaybackYears === bestEstimatePayback && (cost < bestEstimateCost
                || (cost === bestEstimateCost && bestEstimateTemplateIds !== null
                  && compareCandidateOrder(candidateKey, bestEstimateId) < 0)));
            if (betterEstimate) {
              bestEstimate = value;
              bestEstimateTemplateIds = candidate.templateIds;
              bestEstimateId = candidateKey;
              bestEstimateReasons = candidateReasons;
              bestEstimatePayback = estimatedPaybackYears;
              bestEstimateCost = cost;
            }
          }
          if (value.hardwareAnnualSavingsPln! > bestDiagnosticSavings
            || (value.hardwareAnnualSavingsPln === bestDiagnosticSavings && (!bestDiagnosticId || compareCandidateOrder(candidateKey, bestDiagnosticId) < 0))) {
            bestDiagnosticSavings = value.hardwareAnnualSavingsPln!;
            bestDiagnostic = value;
            bestDiagnosticTemplateIds = candidate.templateIds;
            bestDiagnosticId = candidateKey;
            bestDiagnosticReasons = candidateReasons;
          }
        }
      } else {
        incompleteCandidates += 1;
        blockingErrors.push(...value.reasons);
        errors.push(...candidateReasons,
          ...(candidateReasons.length ? [] : ['Brak kompletnego rachunku docelowego lub przyrostu oszczędności sprzętu dla wariantu.']));
      }
    } catch (error) {
      if (error instanceof OfferPvSourceRevisionError) throw error;
      incompleteCandidates += 1;
      const reason = error instanceof Error ? error.message : 'Nie udało się przeliczyć wariantu.';
      blockingErrors.push(reason);
      errors.push(reason);
    }
  };

  while (queueIndex < queued.length) {
    if (Date.now() - calculationStartedAt >= OFFER_RECOMMENDATION_SOFT_BUDGET_MS) {
      timeBudgetReached = true;
      break;
    }
    const candidate = queued[queueIndex++];
    if (evaluatedSet.has(candidate.id)) continue;
    evaluatedSet.add(candidate.id);
    evaluatedCandidateIds.push(candidate.id);
    batchEvaluated += 1;
    await evaluateCandidate(candidate);
    onProgress(evaluatedCandidateIds.length, progressTotal);
  }

  if (!timeBudgetReached && !refinementConsidered && candidates.length > OFFER_RECOMMENDATION_BATCH_LIMIT
    && evaluatedCandidateIds.length >= Math.min(candidates.length, OFFER_RECOMMENDATION_COARSE_LIMIT)
    && batchEvaluated < OFFER_RECOMMENDATION_BATCH_LIMIT) {
    refinementConsidered = true;
    const refinementPlan = planOfferWorkspaceRecommendationSearch({
      candidates,
      candidateSignature,
      previousRecommendation: makeInterimRecommendation(),
      rankings: sortedRankings(),
      maxNewCandidates: OFFER_RECOMMENDATION_BATCH_LIMIT - batchEvaluated,
    });
    for (const id of refinementPlan.candidateIds) {
      const candidate = candidatesById.get(id);
      if (candidate && !evaluatedSet.has(id)) queued.push(candidate);
    }
    onProgress(evaluatedCandidateIds.length, progressTotal);
    while (queueIndex < queued.length) {
      if (Date.now() - calculationStartedAt >= OFFER_RECOMMENDATION_SOFT_BUDGET_MS) {
        timeBudgetReached = true;
        break;
      }
      const candidate = queued[queueIndex++];
      if (evaluatedSet.has(candidate.id)) continue;
      evaluatedSet.add(candidate.id);
      evaluatedCandidateIds.push(candidate.id);
      batchEvaluated += 1;
      await evaluateCandidate(candidate);
      onProgress(evaluatedCandidateIds.length, progressTotal);
    }
  }

  if (!batchEvaluated && (hasContinuation || !trustedPrevious)) {
    throw new Error(hasContinuation
      ? 'Limit czasu upłynął przed nową próbą; poprzedni etap rekomendacji pozostaje bez zmian.'
      : 'Limit czasu obliczeń upłynął przed pierwszym wariantem; ponów rekomendację.');
  }
  const rankings = sortedRankings();
  const result = winner || bestEstimate || bestDiagnostic || (trustedPrevious
    ? copyCalculation(trustedPrevious)
    : blockedOfferCalculation([
    errors[0] || 'Brak wycenionych zestawów spełniających kryteria projektu.',
  ]));
  result.rankings = rankings;
  result.recommendedTemplateIds = winnerTemplateIds;
  result.estimatedRecommendedTemplateIds = !winner && bestEstimate ? bestEstimateTemplateIds : null;
  result.evaluatedTemplateIds = winnerTemplateIds || bestEstimateTemplateIds || bestDiagnosticTemplateIds
    || (trustedPrevious?.evaluatedTemplateIds ? [...trustedPrevious.evaluatedTemplateIds] : undefined);
  if (errors.length || incompleteCandidates > 0) {
    if (incompleteCandidates > 0 && (winner || bestEstimate || bestDiagnostic)) {
      result.warnings.push(`Porównanie niepełne: pokazano ${rankings.length} wariantów z kompletnym rachunkiem docelowym i przyrostem sprzętu; ${incompleteCandidates} z ${evaluatedCandidateIds.length} ocenionych kandydatów wymaga uzupełnienia danych.`);
    } else if (!rankings.length) {
      result.status = 'blocked';
      result.reasons = [...new Set([...blockingErrors, ...(result.reasons || []), ...errors])].slice(0, 5);
    }
  }
  if (!winner && bestEstimate) {
    result.recommendedTemplateIds = null;
    result.recommendationEligible = false;
    result.paybackYears = null;
    result.recommendationReasons = [...new Set([...(result.recommendationReasons || []), ...bestEstimateReasons])]
      .filter(reason => !hasNoPaybackClaim(reason));
    result.warnings = result.warnings.filter(warning => !hasNoPaybackClaim(warning));
    result.warnings.push('Szacowany czas zwrotu ma charakter orientacyjny i wymaga weryfikacji danych oraz zgodności technicznej; nie stanowi formalnej rekomendacji.');
  } else if (!winner && bestDiagnostic) {
    result.recommendedTemplateIds = null;
    result.estimatedRecommendedTemplateIds = null;
    result.recommendationEligible = false;
    result.recommendationReasons = [...new Set([...(result.recommendationReasons || []), ...bestDiagnosticReasons])];
    result.paybackYears = null;
    result.warnings.push('Wyniki wariantu są diagnostyczne; rekomendacja i czas zwrotu pozostają wyłączone.');
  }
  if (winner) {
    result.warnings = result.warnings.filter(warning => !warning.startsWith('Szacowany czas zwrotu ma charakter orientacyjny')
      && !warning.startsWith('Wyniki wariantu są diagnostyczne;'));
  } else if (bestEstimate) {
    result.warnings = result.warnings.filter(warning => !warning.startsWith('Wyniki wariantu są diagnostyczne;'));
  } else if (bestDiagnostic) {
    result.warnings = result.warnings.filter(warning => !warning.startsWith('Szacowany czas zwrotu ma charakter orientacyjny'));
  }
  const phase: NonNullable<OfferWorkspaceCalculation['recommendationSearch']>['phase'] = evaluatedCandidateIds.length >= Math.min(candidates.length, OFFER_RECOMMENDATION_COARSE_LIMIT)
    ? (evaluatedCandidateIds.length >= candidates.length ? 'complete' : 'refine') : 'coarse';
  result.recommendationSearch = {
    version: 1,
    candidateSignature,
    evaluatedCandidateIds: [...evaluatedCandidateIds],
    totalCandidates: candidates.length,
    evaluatedCandidates: evaluatedCandidateIds.length,
    batchNumber,
    batchEvaluated,
    hasMore: evaluatedCandidateIds.length < candidates.length,
    phase,
  };
  result.recommendationBatteryBounds = { ...recommendationBatteryBounds };
  result.recommendationPvBounds = recommendationPvBounds ? { ...recommendationPvBounds } : undefined;
  result.warnings = [...new Set([...result.warnings, ...inheritedWarnings, ...baselineAssumptions,
    ...(!winner && bestEstimate ? errors.filter(reason => !hasNoPaybackClaim(reason)) : errors),
    ...(timeBudgetReached ? ['Limit czasu etapu osiągnięty; można kontynuować wyszukiwanie od ocenionych wariantów.'] : []),
    'Rekomendacja ekonomiczna wymaga potwierdzenia zgodności technicznej wybranego zestawu.'])];
  return attachSourceIdentity(result);
}
