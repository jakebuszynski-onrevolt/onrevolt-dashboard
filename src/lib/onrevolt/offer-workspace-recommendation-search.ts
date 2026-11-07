import type { OfferWorkspaceCalculation, OfferWorkspaceRanking } from './offer-workspace-calculation-types';
import type { OfferCandidateSnapshot } from './offer-candidates';

export const OFFER_RECOMMENDATION_BATCH_LIMIT = 50;
export const OFFER_RECOMMENDATION_COARSE_LIMIT = 24;

type Candidate = Pick<OfferCandidateSnapshot,
  'id' | 'templateIds' | 'totalPvKw' | 'batteryCapacityKwh' | 'batteryPowerKw' | 'addedPvKw'>;

export type OfferWorkspaceRecommendationSearchPlan = {
  candidateIds: string[];
  evaluatedCandidateIds: string[];
  totalCandidates: number;
  evaluatedCandidates: number;
  batchNumber: number;
  batchEvaluated: number;
  hasMore: boolean;
  phase: 'coarse' | 'refine' | 'complete';
};

type PlanOptions = {
  candidates: Candidate[];
  candidateSignature: string;
  previousRecommendation?: OfferWorkspaceCalculation;
  rankings?: OfferWorkspaceRanking[];
  maxNewCandidates?: number;
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function candidateOrder(candidate: Candidate): string {
  return candidate.id || candidate.templateIds.join('\u0000');
}

function sameTemplateIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function tier(row: OfferWorkspaceRanking): number {
  if (row.recommendationEligible === true && finite(row.paybackYears)) return 0;
  if (finite(row.estimatedPaybackYears)) return 1;
  return 2;
}

function compareRankingRows(left: OfferWorkspaceRanking, right: OfferWorkspaceRanking,
  candidateIds: Map<string, string>): number {
  const leftTier = tier(left), rightTier = tier(right);
  const leftPrimary = leftTier === 0 ? left.paybackYears! : leftTier === 1
    ? left.estimatedPaybackYears! : -(typeof left.annualSavingsPln === 'number' && Number.isFinite(left.annualSavingsPln) ? left.annualSavingsPln : -Infinity);
  const rightPrimary = rightTier === 0 ? right.paybackYears! : rightTier === 1
    ? right.estimatedPaybackYears! : -(typeof right.annualSavingsPln === 'number' && Number.isFinite(right.annualSavingsPln) ? right.annualSavingsPln : -Infinity);
  return leftTier - rightTier
    || leftPrimary - rightPrimary
    || (finite(left.costAfterFinancingPln) ? left.costAfterFinancingPln : Infinity)
      - (finite(right.costAfterFinancingPln) ? right.costAfterFinancingPln : Infinity)
    || compareText(candidateIds.get(JSON.stringify(left.templateIds)) || left.templateIds.join('\u0000'),
      candidateIds.get(JSON.stringify(right.templateIds)) || right.templateIds.join('\u0000'));
}

function distinctSorted(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function nearestIndex(values: number[], target: number): number {
  return values.reduce((best, value, index) => Math.abs(value - target) < Math.abs(values[best] - target)
    ? index : best, 0);
}

function coarseSample(candidates: Candidate[], limit: number): Candidate[] {
  const ordered = [...candidates].sort((left, right) => compareText(candidateOrder(left), candidateOrder(right)));
  if (ordered.length <= limit) return ordered;

  const pvValues = distinctSorted(ordered.map(candidate => candidate.totalPvKw));
  const perPvBudget = Math.max(1, Math.floor(limit / 4));
  const pvTargets: number[] = [];
  for (let target = pvValues[0]; target < pvValues.at(-1)!; target += 5) pvTargets.push(target);
  pvTargets.push(pvValues.at(-1)!);
  const stepIndexes = [...new Set(pvTargets.map(target => nearestIndex(pvValues, target)))];
  stepIndexes.push(Math.floor((pvValues.length - 1) / 2));
  let pvIndexes = [...new Set(stepIndexes)].sort((left, right) => left - right);
  if (pvIndexes.length > perPvBudget) {
    pvIndexes = [...new Set(Array.from({ length: perPvBudget }, (_, index) =>
      Math.round(index * (pvIndexes.length - 1) / Math.max(1, perPvBudget - 1))))]
      .map(index => pvIndexes[index]);
  }
  const sampledPv = pvIndexes.map(index => pvValues[index]);

  const batteryById = new Map<string, Candidate>();
  for (const candidate of ordered) {
    const batteryId = candidate.templateIds[0] || candidate.id;
    const existing = batteryById.get(batteryId);
    if (!existing || candidate.totalPvKw < existing.totalPvKw
      || (candidate.totalPvKw === existing.totalPvKw && compareText(candidateOrder(candidate), candidateOrder(existing)) < 0)) {
      batteryById.set(batteryId, candidate);
    }
  }
  const batteries = [...batteryById.values()].sort((left, right) =>
    left.batteryCapacityKwh - right.batteryCapacityKwh
      || left.batteryPowerKw - right.batteryPowerKw
      || compareText(left.templateIds[0] || left.id, right.templateIds[0] || right.id));
  const perPvLimit = Math.max(1, Math.floor(limit / sampledPv.length));
  const selectedBatteryIds = new Set<string>();
  const takeBattery = (candidate: Candidate | undefined) => {
    if (candidate) selectedBatteryIds.add(candidate.templateIds[0] || candidate.id);
  };
  takeBattery(batteries[0]);
  takeBattery(batteries.at(-1));
  takeBattery(batteries[Math.floor((batteries.length - 1) / 2)]);

  const powerValues = distinctSorted(batteries.map(candidate => candidate.batteryPowerKw));
  for (const power of powerValues) {
    const samePower = batteries.filter(candidate => candidate.batteryPowerKw === power);
    takeBattery(samePower[Math.floor((samePower.length - 1) / 2)]);
  }

  for (let index = 0; selectedBatteryIds.size < Math.min(perPvLimit, batteries.length) && index < perPvLimit; index += 1) {
    const sampleIndex = perPvLimit <= 1 ? 0 : Math.round(index * (batteries.length - 1) / (perPvLimit - 1));
    takeBattery(batteries[sampleIndex]);
  }
  const batteryIds = [...selectedBatteryIds].slice(0, Math.max(perPvLimit, selectedBatteryIds.size));
  const selected: Candidate[] = [];
  const selectedIds = new Set<string>();
  const add = (candidate: Candidate | undefined) => {
    if (candidate && !selectedIds.has(candidate.id) && selected.length < limit) {
      selectedIds.add(candidate.id);
      selected.push(candidate);
    }
  };

  // Interleave PV levels so the sample keeps both edge, middle, and near-5 kWp coverage.
  const maxBatteryRows = Math.max(...sampledPv.map(pv => batteryIds.filter(batteryId =>
    ordered.some(candidate => candidate.totalPvKw === pv && (candidate.templateIds[0] || candidate.id) === batteryId)).length));
  for (let batteryIndex = 0; batteryIndex < maxBatteryRows && selected.length < limit; batteryIndex += 1) {
    for (const pv of sampledPv) {
      const batteryId = batteryIds[batteryIndex];
      if (!batteryId) continue;
      const candidate = ordered.find(row => row.totalPvKw === pv && (row.templateIds[0] || row.id) === batteryId);
      add(candidate);
    }
  }

  // Fill any gaps in an irregular candidate set with a deterministic farthest-point sample.
  const batteryCapacities = batteries.map(candidate => candidate.batteryCapacityKwh);
  const batteryPowers = batteries.map(candidate => candidate.batteryPowerKw);
  const ranges = {
    pv: Math.max(1, pvValues.at(-1)! - pvValues[0]),
    capacity: Math.max(1, Math.max(...batteryCapacities) - Math.min(...batteryCapacities)),
    power: Math.max(1, Math.max(...batteryPowers) - Math.min(...batteryPowers)),
  };
  while (selected.length < limit && selected.length < ordered.length) {
    const remaining = ordered.filter(candidate => !selectedIds.has(candidate.id));
    const next = remaining.sort((left, right) => {
      const distance = (candidate: Candidate) => selected.length
        ? Math.min(...selected.map(picked => Math.abs(candidate.totalPvKw - picked.totalPvKw) / ranges.pv
          + Math.abs(candidate.batteryCapacityKwh - picked.batteryCapacityKwh) / ranges.capacity
          + Math.abs(candidate.batteryPowerKw - picked.batteryPowerKw) / ranges.power))
        : 0;
      return distance(right) - distance(left) || compareText(candidateOrder(left), candidateOrder(right));
    })[0];
    add(next);
  }
  return selected;
}

function directNeighbors(anchor: Candidate, candidates: Candidate[]): Candidate[] {
  const batteryId = anchor.templateIds[0] || anchor.id;
  const sameBattery = candidates.filter(candidate => (candidate.templateIds[0] || candidate.id) === batteryId)
    .sort((left, right) => left.totalPvKw - right.totalPvKw || compareText(candidateOrder(left), candidateOrder(right)));
  const pvIndex = sameBattery.findIndex(candidate => candidate.id === anchor.id);
  const samePv = candidates.filter(candidate => candidate.totalPvKw === anchor.totalPvKw)
    .sort((left, right) => left.batteryCapacityKwh - right.batteryCapacityKwh
      || left.batteryPowerKw - right.batteryPowerKw
      || compareText(candidateOrder(left), candidateOrder(right)));
  const batteryIndex = samePv.findIndex(candidate => candidate.id === anchor.id);
  const direct = [sameBattery[pvIndex - 1], sameBattery[pvIndex + 1], samePv[batteryIndex - 1], samePv[batteryIndex + 1]];
  return direct.filter((candidate): candidate is Candidate => Boolean(candidate && candidate.id !== anchor.id));
}

function candidateByRanking(row: OfferWorkspaceRanking, candidates: Candidate[]): Candidate | undefined {
  return candidates.find(candidate => sameTemplateIds(candidate.templateIds, row.templateIds));
}

function validPrevious(options: PlanOptions, candidates: Candidate[]): {
  search: NonNullable<OfferWorkspaceCalculation['recommendationSearch']>;
  visited: string[];
  rankings: OfferWorkspaceRanking[];
} | null {
  const previous = options.previousRecommendation;
  const search = previous?.recommendationSearch;
  if (!previous || !search || search.version !== 1 || search.candidateSignature !== options.candidateSignature
    || search.totalCandidates !== candidates.length || !Array.isArray(search.evaluatedCandidateIds)) return null;
  const candidateIds = new Set(candidates.map(candidate => candidate.id));
  const visited = [...new Set(search.evaluatedCandidateIds.filter(id => candidateIds.has(id)))];
  if (visited.length !== search.evaluatedCandidateIds.length || visited.length !== search.evaluatedCandidates) return null;
  return { search, visited, rankings: Array.isArray(previous.rankings) ? previous.rankings : [] };
}

export function planOfferWorkspaceRecommendationSearch(options: PlanOptions): OfferWorkspaceRecommendationSearchPlan {
  const candidates = [...options.candidates].sort((left, right) => compareText(candidateOrder(left), candidateOrder(right)));
  const maxNew = Math.max(0, Math.min(OFFER_RECOMMENDATION_BATCH_LIMIT, options.maxNewCandidates ?? OFFER_RECOMMENDATION_BATCH_LIMIT));
  const previous = validPrevious(options, candidates);
  const visited = previous?.visited || [];
  const visitedSet = new Set(visited);
  const unvisited = candidates.filter(candidate => !visitedSet.has(candidate.id));
  let chosen: Candidate[] = [];
  let phase: OfferWorkspaceRecommendationSearchPlan['phase'] = 'complete';
  let batchNumber = previous ? previous.search.batchNumber + 1 : 1;

  if (!previous && candidates.length <= maxNew) {
    chosen = candidates;
  } else if (!previous) {
    chosen = coarseSample(candidates, Math.min(maxNew, OFFER_RECOMMENDATION_COARSE_LIMIT));
    phase = 'coarse';
  } else if (candidates.length <= maxNew) {
    chosen = unvisited;
  } else if (previous.search.phase === 'coarse' && visited.length < Math.min(candidates.length, OFFER_RECOMMENDATION_COARSE_LIMIT)) {
    const coarseIds = new Set(coarseSample(candidates, Math.min(candidates.length, OFFER_RECOMMENDATION_COARSE_LIMIT)).map(candidate => candidate.id));
    chosen = unvisited.filter(candidate => coarseIds.has(candidate.id)).slice(0, maxNew);
    phase = 'coarse';
  } else {
    const rankings = [...(options.rankings || previous.rankings)];
    const candidateIdsByTemplate = new Map(rankings.map(row => {
      const candidate = candidateByRanking(row, candidates);
      return [JSON.stringify(row.templateIds), candidate ? candidateOrder(candidate) : row.templateIds.join('\u0000')];
    }));
    const orderedRankings = rankings.sort((left, right) => compareRankingRows(left, right, candidateIdsByTemplate));
    const anchors = orderedRankings.slice(0, 3).map(row => candidateByRanking(row, candidates)).filter((candidate): candidate is Candidate =>
      Boolean(candidate && visitedSet.has(candidate.id)));
    if (!anchors.length) {
      anchors.push(...candidates.filter(candidate => visitedSet.has(candidate.id)).slice(0, 3));
    }
    const newById = new Map<string, Candidate>();
    const neighborRows = anchors.map(anchor => directNeighbors(anchor, candidates).filter(candidate => !visitedSet.has(candidate.id)));
    let offset = 0;
    while (newById.size < maxNew && neighborRows.some(rows => offset < rows.length)) {
      for (const rows of neighborRows) {
        const candidate = rows[offset];
        if (candidate && !visitedSet.has(candidate.id)) newById.set(candidate.id, candidate);
      }
      offset += 1;
    }

    const candidatePvValues = candidates.map(candidate => candidate.totalPvKw);
    const candidateCapacities = candidates.map(candidate => candidate.batteryCapacityKwh);
    const candidatePowers = candidates.map(candidate => candidate.batteryPowerKw);
    const ranges = {
      pv: Math.max(1, Math.max(...candidatePvValues) - Math.min(...candidatePvValues)),
      capacity: Math.max(1, Math.max(...candidateCapacities) - Math.min(...candidateCapacities)),
      power: Math.max(1, Math.max(...candidatePowers) - Math.min(...candidatePowers)),
    };
    const remaining = unvisited.filter(candidate => !newById.has(candidate.id));
    remaining.sort((left, right) => {
      const distance = (candidate: Candidate) => anchors.length
        ? Math.min(...anchors.map(anchor => Math.abs(candidate.totalPvKw - anchor.totalPvKw) / ranges.pv
          + Math.abs(candidate.batteryCapacityKwh - anchor.batteryCapacityKwh) / ranges.capacity
          + Math.abs(candidate.batteryPowerKw - anchor.batteryPowerKw) / ranges.power))
        : 0;
      return distance(left) - distance(right) || compareText(candidateOrder(left), candidateOrder(right));
    });
    for (const candidate of remaining) {
      if (newById.size >= maxNew) break;
      newById.set(candidate.id, candidate);
    }
    chosen = [...newById.values()].slice(0, maxNew);
    phase = 'refine';
  }

  const candidateIds = chosen.map(candidate => candidate.id);
  const evaluatedCandidateIds = [...visited, ...candidateIds];
  const hasMore = evaluatedCandidateIds.length < candidates.length;
  if (!hasMore) phase = 'complete';
  if (previous && candidateIds.length === 0) batchNumber = previous.search.batchNumber;
  return {
    candidateIds,
    evaluatedCandidateIds,
    totalCandidates: candidates.length,
    evaluatedCandidates: evaluatedCandidateIds.length,
    batchNumber,
    batchEvaluated: candidateIds.length,
    hasMore,
    phase,
  };
}
