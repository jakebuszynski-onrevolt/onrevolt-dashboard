import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCurrentOfferWorkspaceCalculationRequest,
  monthlyMeasurementBarHeight,
  monthlyMeasurementValueLabel,
  offerWorkspaceCalculationInputKey,
  offerWorkspaceCalculationPreflightError,
  offerWorkspaceDraftWithRanking,
  offerWorkspaceStorageKey,
  parseCalculationJob,
  resolveDraftAfterSave,
  resolveCachedOfferDraft,
} from './OfferWorkspacePanel';
import { defaultOfferCalculationAssumptions, emptyOfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';

test('identyczny lokalny szkic nie blokuje otwarcia po zmianie wersji serwera', () => {
  const server = emptyOfferWorkspaceDraft();
  const restored = resolveCachedOfferDraft(server, 'new-source', 4, {
    expectedRevision: 2, sourceRevision: 'old-source', input: { ...server, step: 'CONFIGURATION' },
  });
  assert.equal(restored.conflict, null);
  assert.equal(restored.dirty, false);
  assert.equal(restored.expectedRevision, 4);
  assert.equal(restored.input.step, 'CONFIGURATION');
});

test('zmiana rewizji źródeł zachowuje lokalny szkic bez blokowania ponownego obliczenia', () => {
  const server = emptyOfferWorkspaceDraft();
  const cache = { expectedRevision: 2, sourceRevision: 'old-source', input: {
    ...server, description: { before: 'Własny opis', after: 'Bez utraty zmian' },
  } };
  const restored = resolveCachedOfferDraft(server, 'new-source', 2, cache);
  assert.equal(restored.conflict, null);
  assert.equal(restored.dirty, true);
  assert.deepEqual(restored.input.description, cache.input.description);
  assert.equal(cache.sourceRevision, 'old-source');
});

test('odświeżenie danych nie omija nowszej wersji szkicu zapisanej w drugiej karcie', () => {
  const server = emptyOfferWorkspaceDraft();
  const cached = { expectedRevision: 2, sourceRevision: 'old-source', input: {
    ...server, description: { before: 'Własne zmiany', after: '' },
  } };
  const restored = resolveCachedOfferDraft(server, 'new-source', 3, cached);
  assert.equal(restored.conflict, 'draft');
  assert.equal(restored.expectedRevision, 2);
  assert.equal(restored.input.description.before, 'Własne zmiany');
});

test('brak lokalnych zmian otwiera aktualny szkic bez konfliktu', () => {
  const server = emptyOfferWorkspaceDraft();
  const restored = resolveCachedOfferDraft(server, 'source', 3, null);
  assert.equal(restored.conflict, null);
  assert.equal(restored.dirty, false);
  assert.equal(restored.expectedRevision, 3);
});

test('zapis odpowiedzi nie nadpisuje zmian wpisanych podczas oczekującego PUT', () => {
  const submitted = { description: 'wysłany szkic' };
  const editedWhileSaving = { description: 'nowszy opis wpisany w trakcie zapisu' };
  const canonicalServerValue = { description: 'wysłany szkic' };

  const result = resolveDraftAfterSave(4, 5, editedWhileSaving, canonicalServerValue);

  assert.equal(result.hasNewerEdits, true);
  assert.equal(result.draft, editedWhileSaving);
  assert.notEqual(result.draft, submitted);
});

test('zapis odpowiedzi przyjmuje wersję serwera, jeśli szkic nie zmienił się w trakcie PUT', () => {
  const canonicalServerValue = { description: 'wersja kanoniczna serwera' };

  const result = resolveDraftAfterSave(7, 7, { description: 'wysłany szkic' }, canonicalServerValue);

  assert.equal(result.hasNewerEdits, false);
  assert.equal(result.draft, canonicalServerValue);
});

test('lokalny cache szkicu jest rozdzielony na użytkownika i projekt', () => {
  assert.notEqual(offerWorkspaceStorageKey('user-a', 'project-1'), offerWorkspaceStorageKey('user-b', 'project-1'));
  assert.notEqual(offerWorkspaceStorageKey('user-a', 'project-1'), offerWorkspaceStorageKey('user-a', 'project-2'));
  assert.equal(offerWorkspaceStorageKey(undefined, 'project-1'), null);
});

test('wykres rozróżnia zarejestrowane zero od brakującego kierunku pomiaru', () => {
  assert.equal(monthlyMeasurementBarHeight(0, 200), 2);
  assert.equal(monthlyMeasurementValueLabel(0), '0');
  assert.equal(monthlyMeasurementBarHeight(null, 200), 0);
  assert.equal(monthlyMeasurementValueLabel(null), '—');
});

test('klucz kalkulacji ignoruje krok i opis, ale zmienia się po zmianie wejścia obliczeń', () => {
  const draft = emptyOfferWorkspaceDraft();
  const initialKey = offerWorkspaceCalculationInputKey(draft);
  const navigationEdit = {
    ...draft,
    step: 'SUMMARY' as const,
    description: { before: 'opis', after: 'nowa treść' },
  };
  const calculationEdit = {
    ...draft,
    calculation: { ...defaultOfferCalculationAssumptions(), chargeEfficiencyPercent: 94 },
  };

  assert.equal(offerWorkspaceCalculationInputKey(navigationEdit), initialKey);
  assert.notEqual(offerWorkspaceCalculationInputKey(calculationEdit), initialKey);
});

test('odrzucona lub starsza odpowiedź kalkulacji nie jest już aktualna', () => {
  const controller = new AbortController();
  assert.equal(isCurrentOfferWorkspaceCalculationRequest(controller.signal, 'a', 'a', 3, 3), true);
  assert.equal(isCurrentOfferWorkspaceCalculationRequest(controller.signal, 'a', 'b', 3, 3), false);
  assert.equal(isCurrentOfferWorkspaceCalculationRequest(controller.signal, 'a', 'a', 2, 3), false);
  controller.abort();
  assert.equal(isCurrentOfferWorkspaceCalculationRequest(controller.signal, 'a', 'a', 3, 3), false);
});

test('POST kalkulacji przyjmuje odpowiedź joba 202 z postępem', () => {
  const job = parseCalculationJob({
    ok: true,
    job: { id: 'job-123', status: 'running', completed: 7, total: 35 },
  }, new Response(null, { status: 202 }));

  assert.equal(job.id, 'job-123');
  assert.equal(job.status, 'running');
  assert.equal(job.completed, 7);
  assert.equal(job.total, 35);
});

test('założenia nie podstawiają początkowych sald ani limitu ulgi', () => {
  const assumptions = defaultOfferCalculationAssumptions();
  assert.equal(assumptions.initialCreditKwh, null);
  assert.equal(assumptions.initialDepositPln, null);
  assert.equal(assumptions.taxRemainingLimitPln, null);
  assert.equal(assumptions.taxBasePln, null);
  assert.equal(assumptions.batteryReservePercent, 10);
  assert.equal(assumptions.chargeEfficiencyPercent, 95);
  assert.equal(assumptions.dischargeEfficiencyPercent, 95);
});

test('brak salda nie blokuje żądania częściowych obliczeń ani nie podstawia zera', () => {
  const draft = emptyOfferWorkspaceDraft();
  assert.match(offerWorkspaceCalculationPreflightError(draft) || '', /taryfę scenariusza/);
  draft.targetOperatorId = 1;
  draft.targetTariffId = 2;
  draft.calculation = defaultOfferCalculationAssumptions();
  assert.equal(offerWorkspaceCalculationPreflightError(draft), null);
  assert.equal(draft.calculation.initialCreditKwh, null);
  assert.equal(draft.calculation.initialDepositPln, null);
});

test('wybór rankingu aktualizuje zestawy bez zmiany innych założeń szkicu', () => {
  const draft = {
    ...emptyOfferWorkspaceDraft(),
    selectedTemplateIds: ['old-battery'],
    financing: { considerGrant: true, considerTaxRelief: false },
  };
  const next = offerWorkspaceDraftWithRanking(draft, [
    { id: 'battery-2', kind: 'MAGAZYN' },
    { id: 'pv-3', kind: 'PV_DACH_SKOSNY' },
  ], ['battery-2', 'pv-3']);

  assert.deepEqual(next.selectedTemplateIds, ['battery-2', 'pv-3']);
  assert.equal(next.pvStrategy, 'ADD_TEMPLATE');
  assert.equal(next.financing, draft.financing);
  assert.equal(next.calculation, draft.calculation);
  assert.equal(next.description, draft.description);
  assert.notEqual(offerWorkspaceCalculationInputKey(next), offerWorkspaceCalculationInputKey(draft));
});
