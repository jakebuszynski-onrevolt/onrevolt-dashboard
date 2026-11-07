import assert from 'node:assert/strict';
import test from 'node:test';
import type { OfferWorkspaceCalculation, OfferWorkspaceRanking } from './offer-workspace-calculation-types';
import { OFFER_RECOMMENDATION_COARSE_LIMIT, planOfferWorkspaceRecommendationSearch } from './offer-workspace-recommendation-search';

function candidates(pvValues = Array.from({ length: 12 }, (_, index) => 15.6 + index * 2.2), batteryCount = 16) {
  const batteries = Array.from({ length: batteryCount }, (_, index) => ({
    id: `battery-${String(index).padStart(2, '0')}`,
    capacity: 5 + Math.floor(index / 2) * 5,
    power: index % 2 === 0 ? 3 : 5,
  }));
  return pvValues.flatMap((pv, pvIndex) => batteries.map((battery, batteryIndex) => ({
    id: `candidate-${String(pvIndex).padStart(2, '0')}-${battery.id}`,
    templateIds: [battery.id, `pv-${pvIndex}`],
    totalPvKw: pv,
    addedPvKw: pv,
    batteryCapacityKwh: battery.capacity,
    batteryPowerKw: battery.power,
    pvIndex,
    batteryIndex,
  })));
}

function calculation(search: NonNullable<OfferWorkspaceCalculation['recommendationSearch']>, rankings: OfferWorkspaceRanking[] = []): OfferWorkspaceCalculation {
  return {
    status: 'ready', reasons: [], warnings: [], baselineAnnualCostPln: 0, proposedAnnualCostPln: 0,
    annualSavingsPln: 0, systemCostPln: 0, costAfterFinancingPln: 0, paybackYears: null,
    grantPln: 0, taxReliefPln: 0, rankings, recommendedTemplateIds: null,
    recommendationSearch: search, sourceDependencyStamp: 'dependency-stamp', pricesAsOf: '2026-10-01',
  };
}

function metadata(plan: ReturnType<typeof planOfferWorkspaceRecommendationSearch>, candidateSignature = 'stable') {
  return { version: 1 as const, candidateSignature, ...plan };
}

function rankingsFor(rows: ReturnType<typeof candidates>, ids: string[], score = (index: number) => index + 1): OfferWorkspaceRanking[] {
  const selected = new Set(ids);
  return rows.filter(row => selected.has(row.id)).map((row, index) => ({
    templateIds: row.templateIds,
    name: row.id,
    annualSavingsPln: 100 - index,
    costAfterFinancingPln: 1000,
    paybackYears: score(index),
    recommendationEligible: true,
  }));
}

test('coarse stage samples actual PV candidates at edges, middle, about five-kW steps, and battery power variants', () => {
  const all = candidates();
  const plan = planOfferWorkspaceRecommendationSearch({ candidates: all, candidateSignature: 'stable' });
  const sampled = all.filter(candidate => plan.candidateIds.includes(candidate.id));
  const sampledPv = [...new Set(sampled.map(candidate => candidate.totalPvKw))].sort((a, b) => a - b);
  const allPv = [...new Set(all.map(candidate => candidate.totalPvKw))].sort((a, b) => a - b);
  assert.equal(plan.phase, 'coarse');
  assert.equal(plan.candidateIds.length, OFFER_RECOMMENDATION_COARSE_LIMIT);
  assert.ok(sampledPv.includes(allPv[0]));
  assert.ok(sampledPv.includes(allPv.at(-1)!));
  assert.ok(sampledPv.includes(allPv[Math.floor((allPv.length - 1) / 2)]));
  assert.ok(sampledPv.some(pv => Math.abs(pv - (allPv[0] + 5)) <= 2.5));
  assert.deepEqual([...new Set(sampled.map(candidate => candidate.batteryPowerKw))].sort((a, b) => a - b), [3, 5]);
  assert.ok(sampled.some(candidate => candidate.batteryCapacityKwh === Math.min(...all.map(row => row.batteryCapacityKwh))));
  assert.ok(sampled.some(candidate => candidate.batteryCapacityKwh === Math.max(...all.map(row => row.batteryCapacityKwh))));
});

test('refinement uses neighbors of the top three existing ranking rows and does not repeat candidates', () => {
  const all = candidates();
  const coarse = planOfferWorkspaceRecommendationSearch({ candidates: all, candidateSignature: 'stable' });
  const rows = all.filter(candidate => coarse.candidateIds.includes(candidate.id));
  const firstThree = [...rows].sort((left, right) => left.id.localeCompare(right.id)).slice(0, 3);
  const rankings = firstThree.map((row, index) => ({
    templateIds: row.templateIds, name: row.id, annualSavingsPln: 100,
    costAfterFinancingPln: 1000, paybackYears: index + 1, recommendationEligible: true,
  }));
  const prior = calculation(metadata(coarse), rankings);
  const refine = planOfferWorkspaceRecommendationSearch({ candidates: all, candidateSignature: 'stable', previousRecommendation: prior });
  const visited = new Set(coarse.evaluatedCandidateIds);
  assert.equal(refine.phase, 'refine');
  assert.ok(refine.candidateIds.every(id => !visited.has(id)));
  const anchor = firstThree[0];
  const samePv = all.filter(candidate => candidate.totalPvKw === anchor.totalPvKw)
    .sort((left, right) => left.batteryCapacityKwh - right.batteryCapacityKwh
      || left.batteryPowerKw - right.batteryPowerKw || left.id.localeCompare(right.id));
  const anchorIndex = samePv.findIndex(candidate => candidate.id === anchor.id);
  const directBatteryNeighbor = samePv[anchorIndex + 1] || samePv[anchorIndex - 1];
  assert.ok(directBatteryNeighbor && refine.candidateIds.includes(directBatteryNeighbor.id),
    'an adjacent battery configuration for the best coarse combination is explored');
  assert.deepEqual(refine.evaluatedCandidateIds.slice(0, coarse.evaluatedCandidateIds.length), coarse.evaluatedCandidateIds);
});

test('each continuation is stable under shuffled catalog order and eventually exhausts a non-unimodal search space', () => {
  const all = candidates([15.6, 19.8, 24, 28.2, 32.4, 36.6], 12);
  const first = planOfferWorkspaceRecommendationSearch({ candidates: all, candidateSignature: 'stable' });
  const shuffled = planOfferWorkspaceRecommendationSearch({ candidates: [...all].reverse(), candidateSignature: 'stable' });
  assert.deepEqual(first.candidateIds, shuffled.candidateIds);

  const target = all.find(candidate => candidate.pvIndex === 4 && candidate.batteryIndex === 9)!;
  let plan = first;
  let previous = calculation(metadata(plan));
  let visited = new Set(plan.evaluatedCandidateIds);
  let batch = 1;
  while (plan.hasMore && batch < 20) {
    const rows = all.filter(candidate => visited.has(candidate.id)).map(candidate => ({
      templateIds: candidate.templateIds,
      name: candidate.id,
      annualSavingsPln: candidate.id === target.id ? 10000 : -candidate.batteryIndex,
      costAfterFinancingPln: 1000,
      paybackYears: null,
      estimatedPaybackYears: candidate.id === target.id ? 0.5 : 4 + candidate.batteryIndex,
      recommendationEligible: false,
    }));
    previous = { ...previous, rankings: rows, recommendationSearch: metadata(plan) };
    plan = planOfferWorkspaceRecommendationSearch({ candidates: [...all].reverse(), candidateSignature: 'stable',
      previousRecommendation: previous, maxNewCandidates: 17 });
    for (const id of plan.candidateIds) {
      assert.ok(!visited.has(id), `candidate ${id} was already visited`);
      visited.add(id);
    }
    batch += 1;
  }
  assert.equal(plan.hasMore, false);
  assert.equal(visited.size, all.length);
  assert.ok(visited.has(target.id), 'a non-unimodal interior optimum remains reachable');
  assert.equal(plan.phase, 'complete');
});

test('eligible payback rankings remain ahead of faster estimates during refinement', () => {
  const all = candidates();
  const coarse = planOfferWorkspaceRecommendationSearch({ candidates: all, candidateSignature: 'stable' });
  const rows = all.filter(candidate => coarse.candidateIds.includes(candidate.id));
  const strict = rows[0], estimates = rows.slice(1, 4);
  const rankings: OfferWorkspaceRanking[] = [
    { templateIds: strict.templateIds, name: strict.id, annualSavingsPln: 10, costAfterFinancingPln: 1000,
      paybackYears: 8, recommendationEligible: true },
    ...estimates.map(row => ({ templateIds: row.templateIds, name: row.id, annualSavingsPln: 50,
      costAfterFinancingPln: 100, paybackYears: null, estimatedPaybackYears: 0.1, recommendationEligible: false })),
  ];
  const refine = planOfferWorkspaceRecommendationSearch({ candidates: all, candidateSignature: 'stable',
    previousRecommendation: calculation(metadata(coarse), rankings) });
  const samePv = all.filter(candidate => candidate.totalPvKw === strict.totalPvKw)
    .sort((left, right) => left.batteryCapacityKwh - right.batteryCapacityKwh
      || left.batteryPowerKw - right.batteryPowerKw || left.id.localeCompare(right.id));
  const strictIndex = samePv.findIndex(candidate => candidate.id === strict.id);
  const expectedNeighbor = samePv[strictIndex + 1] || samePv[strictIndex - 1];
  assert.ok(expectedNeighbor && refine.candidateIds.includes(expectedNeighbor.id));
});
