import { callClientTariffs, clientTariffScope, loadClientTariffHistory, readProjectGeneralTariffs } from './client-tariffs-server';
import { tariffToday, type ClientTariffHistory, type ClientTariffData, type ClientTariffPayload } from './client-tariffs';
import { calculateOfferWorkspaceEnergy } from './offer-workspace-energy-server';
import { blockedOfferCalculation, calculateOfferWorkspaceScenario, offerLocalTime, type OfferCalculationInput } from './offer-workspace-calculation';
import { defaultOfferCalculationAssumptions, type OfferWorkspaceDraft } from './offer-workspace';
import type { OfferWorkspace } from './offer-workspace-server';
import type { OfferMeasurementSeries } from './offer-measurements';
import type { OfferWorkspaceCalculation } from './offer-workspace-calculation-types';
import { OfferMarketDataError, offerHourlyMarketPrices, offerMarketIntervalStarts, type OfferStoredMarketRow } from './offer-workspace-market';
import { rePrisma } from './re-stations';
import { readOfferPvProfile } from './offer-pv-profile';
import { configurationInvestmentScope } from './configuration-templates';
import { enumerateOfferCandidates, type ApprovedConfigurationTemplate } from './offer-candidates';
import { offerCalculationDependencyHash, offerCalculationPeriodHours } from './offer-workspace-calculation-dependencies';

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
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
  if (loadedBaselineHistory?.issues.length) {
    baselineReasons.push(...loadedBaselineHistory.issues.map(issue => `${issue.date}: ${issue.message}`));
  }
  const baselineUsable = loadedBaselineHistory !== null && baselineReasons.length === 0;
  const baselineDependency = baselineUsable
    ? { status: 'available', history: loadedBaselineHistory }
    : { status: 'incomplete', history: loadedBaselineHistory, reasons: baselineReasons };
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
    if (error instanceof OfferMarketDataError) return { reasons: [error.message] };
    throw error;
  }
  const exportPrices = new Map([...rce].map(([hour, value]) => [hour, Math.max(0, value) * 1.23]));
  const targetHistory = snapshotHistory(target, from, until);
  const sourceDependencyStamp = offerCalculationDependencyHash({ startUtc, endUtc, pricesAsOf,
    baseline: baselineDependency, targetHistory, rdnPricesNet, exportPrices });
  return { baselineHistory, baselineReasons, targetHistory, rdnPricesNet, exportPrices, pricesAsOf, sourceDependencyStamp };
}

export async function loadOfferCalculationDependencyStamp(workspace: OfferWorkspace, draft: OfferWorkspaceDraft): Promise<string | null> {
  if (!draft.targetOperatorId || !draft.targetTariffId) return null;
  const hours = offerCalculationPeriodHours(workspace.measurements.months);
  if (!hours) return null;
  const sources = await financialSources(workspace, draft, hours);
  return 'reasons' in sources ? null : sources.sourceDependencyStamp;
}

export async function calculateOfferWorkspaceOnServer(workspace: OfferWorkspace, draft: OfferWorkspaceDraft,
  series: OfferMeasurementSeries | null, mode: 'selected' | 'recommend',
  onProgress: (completed: number, total: number) => void = () => undefined): Promise<OfferWorkspaceCalculation> {
  const settings = draft.calculation || defaultOfferCalculationAssumptions();
  const missing: string[] = [];
  if (!draft.targetOperatorId || !draft.targetTariffId) missing.push('Wybierz taryfę docelową.');
  if (!workspace.input.reportDetails?.connectionPowerKw) missing.push('Uzupełnij moc przyłączeniową w danych energetycznych.');
  if (missing.length) return blockedOfferCalculation(missing);
  const energy = await calculateOfferWorkspaceEnergy(workspace, draft, series);
  if (!energy.intervals?.length) return blockedOfferCalculation(['Brak pełnych interwałów energii.']);
  const first = energy.intervals[0], last = energy.intervals.at(-1)!;
  const sources = await financialSources(workspace, draft, energy.intervals.map(row => row.startUtc));
  if ('reasons' in sources) return blockedOfferCalculation(sources.reasons!);
  const { sourceDependencyStamp, baselineReasons, ...financial } = sources;
  const common: Omit<OfferCalculationInput, 'draft' | 'addedPvHours'> = { workspace, energy, ...financial };
  const addedProfiles = new Map<string, Map<string, number>>();
  async function calculate(selectedDraft: OfferWorkspaceDraft) {
    const pv = workspace.templates.find(item => selectedDraft.selectedTemplateIds.includes(item.id) && configurationInvestmentScope(item.kind) === 'PV');
    let addedPvHours = new Map<string, number>();
    if (pv) {
      if (!pv.powerKw || settings.addedPvTiltDegrees === null || settings.addedPvAzimuthDegrees === null || draft.existingPv.lossPercent === null) {
        return blockedOfferCalculation(['Uzupełnij moc, nachylenie i azymut rozbudowy PV oraz straty modelu.']);
      }
      const location = workspace.input.location;
      if (location?.latitude == null || location.longitude == null) return blockedOfferCalculation(['Brak współrzędnych instalacji PV.']);
      const key = String(pv.powerKw);
      if (!addedProfiles.has(key)) {
        const profile = await readOfferPvProfile({ latitude: location.latitude, longitude: location.longitude, powerKw: pv.powerKw,
          tiltDegrees: settings.addedPvTiltDegrees, azimuthDegrees: settings.addedPvAzimuthDegrees, lossPercent: draft.existingPv.lossPercent,
          fromUtc: first.startUtc, untilUtc: last.endUtc });
        addedProfiles.set(key, new Map(profile.hours.map(hour => [hour.startUtc, hour.pvKwh])));
      }
      addedPvHours = addedProfiles.get(key)!;
    }
    const result = await calculateOfferWorkspaceScenario({ ...common, draft: selectedDraft, addedPvHours });
    result.sourceDependencyStamp = sourceDependencyStamp;
    result.pricesAsOf = financial.pricesAsOf;
    result.warnings = [...new Set([...result.warnings, ...baselineReasons])];
    return result;
  }
  if (mode === 'selected') { onProgress(0, 1); const result = await calculate(draft); onProgress(1, 1); return result; }
  const enumeration = enumerateOfferCandidates({
    approvedConfigurationTemplates: workspace.templates.map(template => ({ ...template, isActive: true })) as ApprovedConfigurationTemplate[],
    clientType: workspace.clientType === 'B2B' ? 'B2B' : 'B2C',
    roofType: workspace.input.reportDetails?.roofType?.toLocaleLowerCase('pl').includes('płask') ? 'FLAT'
      : workspace.input.reportDetails?.roofType ? 'SLOPED' : 'UNKNOWN',
    pvStrategy: draft.pvStrategy, existingPv: { powerKw: draft.existingPv.powerKw!, tiltDegrees: draft.existingPv.tiltDegrees, azimuthDegrees: draft.existingPv.azimuthDegrees },
    addedPvGeometry: draft.pvStrategy === 'ADD_TEMPLATE' && settings.addedPvTiltDegrees !== null && settings.addedPvAzimuthDegrees !== null
      ? { tiltDegrees: settings.addedPvTiltDegrees, azimuthDegrees: settings.addedPvAzimuthDegrees } : null,
    existingPvCompatibilityEvidence: 'unknown', existingInverterCompatibilityEvidence: 'unknown', saleVatMode: draft.saleVatMode,
  });
  const candidates = enumeration.candidates;
  if (!candidates.length) {
    const rejectedReasons = enumeration.rejectedReasonList.flatMap(item => item.reasons);
    return blockedOfferCalculation(rejectedReasons.length ? [...new Set(rejectedReasons)]
      : ['Brak technicznie dopuszczalnego zestawu do obliczeń.']);
  }
  if (candidates.length > 50) return blockedOfferCalculation(['Ponad 50 wariantów: zawęź zakres konfiguracji przed porównaniem.']);
  const rankings: OfferWorkspaceCalculation['rankings'] = [];
  const rankingIds = new Map<string, string>();
  const errors: string[] = [];
  let winner: OfferWorkspaceCalculation | null = null;
  let winnerTemplateIds: string[] | null = null;
  let bestEstimate: OfferWorkspaceCalculation | null = null;
  let bestEstimateTemplateIds: string[] | null = null;
  let bestEstimateId = '';
  let bestEstimateReasons: string[] = [];
  let bestEstimatePayback = Infinity;
  let bestEstimateCost = Infinity;
  let bestDiagnostic: OfferWorkspaceCalculation | null = null;
  let bestDiagnosticReasons: string[] = [];
  let bestDiagnosticSavings = -Infinity;
  let incompleteCandidates = 0;
  let best = Infinity;
  onProgress(0, candidates.length);
  for (const [index, candidate] of candidates.entries()) {
    try {
      const value = await calculate({ ...draft, selectedTemplateIds: candidate.templateIds });
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
        const templateKey = templateIdOrder(candidate.templateIds);
        const candidateKey = candidateOrder(candidate.id, candidate.templateIds);
        rankingIds.set(templateKey, candidateKey);
        rankings.push({
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
          if (value.paybackYears! < best) {
            best = value.paybackYears!; winner = value; winnerTemplateIds = candidate.templateIds;
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
          if (value.hardwareAnnualSavingsPln! > bestDiagnosticSavings) {
            bestDiagnosticSavings = value.hardwareAnnualSavingsPln!;
            bestDiagnostic = value;
            bestDiagnosticReasons = candidateReasons;
          }
        }
      } else {
        incompleteCandidates += 1;
        errors.push(...candidateReasons,
          ...(candidateReasons.length ? [] : ['Brak kompletnego rachunku docelowego lub przyrostu oszczędności sprzętu dla wariantu.']));
      }
    } catch (error) {
      incompleteCandidates += 1;
      errors.push(error instanceof Error ? error.message : 'Nie udało się przeliczyć wariantu.');
    }
    onProgress(index + 1, candidates.length);
  }
  rankings.sort((a, b) => {
    const tier = (row: typeof a) => row.recommendationEligible ? 0
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
  const result = winner || bestEstimate || bestDiagnostic || blockedOfferCalculation([
    errors[0] || 'Brak wycenionych zestawów spełniających kryteria projektu.',
  ]);
  result.rankings = rankings;
  result.recommendedTemplateIds = winnerTemplateIds;
  result.estimatedRecommendedTemplateIds = !winner && bestEstimate ? bestEstimateTemplateIds : null;
  if (errors.length) {
    if (incompleteCandidates > 0 && (winner || bestEstimate || bestDiagnostic)) {
      result.warnings.push(`Porównanie niepełne: pokazano ${rankings.length} wariantów z kompletnym rachunkiem docelowym i przyrostem sprzętu; ${incompleteCandidates} z ${candidates.length} kandydatów wymaga uzupełnienia danych.`);
    } else if (!rankings.length) {
      result.status = 'blocked';
      result.reasons = [...new Set([...(result.reasons || []), ...errors.slice(0, 5)])];
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
  result.warnings.push(...new Set(!winner && bestEstimate ? errors.filter(reason => !hasNoPaybackClaim(reason)) : errors),
    'Rekomendacja ekonomiczna wymaga potwierdzenia zgodności technicznej wybranego zestawu.');
  return result;
}
