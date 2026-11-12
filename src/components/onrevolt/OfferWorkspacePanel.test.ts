import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initialDraft,
  offerDraftWithDefaultVat,
  offerDraftWithClientPvGeometry,
  isCurrentOfferWorkspaceCalculationRequest,
  offerWorkspaceCalculationRestoreOrder,
  beginOfferWorkspaceCalculationState,
  failOfferWorkspaceCalculationState,
  monthlyMeasurementBarHeight,
  monthlyMeasurementValueLabel,
  offerWorkspaceCalculationInputKey,
  offerWorkspaceCalculationPreflightError,
  offerWorkspaceCalculationStaleMessage,
  offerWorkspaceDraftWithRanking,
  offerWorkspaceStorageKey,
  parseCalculationJob,
  resolveDraftAfterSave,
  resolveCachedOfferDraft,
  staleOfferWorkspaceCalculationState,
} from './OfferWorkspacePanel';
import { defaultOfferCalculationAssumptions, emptyOfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';

test('dodatkowa PV korzysta z geometrii klienta; własne wartości, w tym zero, pozostają zachowane', () => {
  const draft = { ...emptyOfferWorkspaceDraft(), pvStrategy: 'ADD_TEMPLATE' as const };
  const roofGeometry = { tiltDegrees: 15, azimuthDegrees: 200 };
  const initialized = offerDraftWithClientPvGeometry(draft, roofGeometry);
  assert.equal(initialized.calculation?.addedPvTiltDegrees, 15);
  assert.equal(initialized.calculation?.addedPvAzimuthDegrees, 200);
  const manual = { ...initialized, calculation: { ...initialized.calculation!, addedPvTiltDegrees: 0, addedPvAzimuthDegrees: 90 } };
  assert.equal(offerDraftWithClientPvGeometry(manual, { tiltDegrees: 40, azimuthDegrees: 180 }), manual);
  const partial = { ...manual, calculation: { ...manual.calculation, addedPvAzimuthDegrees: null } };
  assert.equal(offerDraftWithClientPvGeometry(partial, roofGeometry).calculation?.addedPvTiltDegrees, 0);
  assert.equal(offerDraftWithClientPvGeometry(partial, roofGeometry).calculation?.addedPvAzimuthDegrees, 200);
  assert.equal(offerDraftWithClientPvGeometry(draft, undefined).calculation?.addedPvTiltDegrees, 30);
  assert.equal(offerDraftWithClientPvGeometry(draft, { tiltDegrees: null, azimuthDegrees: null }).calculation?.addedPvAzimuthDegrees, 180);
  const batteryOnly = emptyOfferWorkspaceDraft();
  assert.equal(offerDraftWithClientPvGeometry(batteryOnly, roofGeometry), batteryOnly, 'otwarcie oferty bez dodatkowej PV nie zmienia jej założeń ani tożsamości wyniku');
  const workspace = { clientType: 'B2C', input: { roofGeometry, existingBatteryPresent: false }, draft: { input: draft } } as any;
  assert.equal(initialDraft(workspace, null).calculation?.addedPvTiltDegrees, 15);
  assert.equal(initialDraft(workspace, null).calculation?.addedPvAzimuthDegrees, 200);
  const existingPv = { ...draft.existingPv, tiltDegrees: 15, azimuthDegrees: 200 };
  const clientPv = offerDraftWithClientPvGeometry({ ...draft, existingPv }, { tiltDegrees: null, azimuthDegrees: 180 });
  assert.equal(clientPv.calculation?.addedPvTiltDegrees, 15);
  assert.equal(clientPv.calculation?.addedPvAzimuthDegrees, 200, 'dokładny zapis parametrów PV ma pierwszeństwo przed ogólnym kierunkiem dachu');
});

test('istniejąca PV przy braku geometrii otrzymuje uzgodnione 30 stopni i południe, bez nadpisania zera', () => {
  const draft = { ...emptyOfferWorkspaceDraft(), existingPv: { powerKw: 13, tiltDegrees: null, azimuthDegrees: null, lossPercent: 14 } };
  const result = offerDraftWithClientPvGeometry(draft, undefined);
  assert.equal(result.existingPv.tiltDegrees, 30);
  assert.equal(result.existingPv.azimuthDegrees, 180);
  const manual = { ...result, existingPv: { ...result.existingPv, tiltDegrees: 0, azimuthDegrees: 0 } };
  assert.equal(offerDraftWithClientPvGeometry(manual, undefined), manual);
});

test('nieustalony VAT przyjmuje uzgodnioną stawkę B2C/B2B; jawne stawki pozostają bez zmian', () => {
  const draft = emptyOfferWorkspaceDraft();
  for (const [clientType, vat] of [['B2C', 'REDUCED_8'], ['B2B', 'STANDARD_23'], ['UNKNOWN', 'REVIEW']]) {
    const workspace = { clientType, input: { existingBatteryPresent: false } } as any;
    assert.equal(initialDraft(workspace, null).saleVatMode, vat);
    assert.equal(initialDraft({ ...workspace, draft: { input: draft } }, null).saleVatMode, vat);
    assert.equal(offerDraftWithDefaultVat(draft, clientType).saleVatMode, vat);
  }
  for (const saleVatMode of ['REDUCED_8', 'STANDARD_23', 'MIXED'] as const) {
    for (const clientType of ['B2C', 'B2B']) assert.equal(offerDraftWithDefaultVat({ ...draft, saleVatMode }, clientType).saleVatMode, saleVatMode);
  }
  assert.equal(draft.saleVatMode, 'REVIEW', 'odczyt nie zmienia zapisanego obiektu');
});

test('edycja kosztorysu unieważnia wybrany wynik i nie przywraca katalogowej rekomendacji', () => {
  const draft = { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['battery'],
    targetOperatorId: 1, targetTariffId: 27,
    commercialPricing: { schemaVersion: 1 as const, batteryInstallationScopeConfirmed: true as const,
      allocations: [{ templateId: 'battery', itemId: 'battery-cell', group: 'STORAGE_INSTALLATION' as const }] } };
  const edited = { ...draft, configurationEdits: [{ templateId: 'battery', items: [{ itemId: 'inverter', pricing: { marginRate: 0.25 } }] }] };
  assert.notEqual(offerWorkspaceCalculationInputKey(draft), offerWorkspaceCalculationInputKey(edited));
  assert.deepEqual(offerWorkspaceCalculationRestoreOrder(edited), ['selected']);
  const selectedRanking = offerWorkspaceDraftWithRanking(edited, [{ id: 'battery', kind: 'MAGAZYN' }], ['battery']);
  assert.deepEqual(selectedRanking.configurationEdits, []);
  assert.equal(selectedRanking.commercialPricing?.schemaVersion, 2);
  assert.deepEqual(selectedRanking.commercialPricing?.allocations, []);
});

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

test('lokalny szkic nie nadpisuje kanonicznej obecności magazynu z danych energetycznych', () => {
  const server = { ...emptyOfferWorkspaceDraft(), existingBatteryPresent: true };
  const cached = { expectedRevision: 2, input: { ...server, existingBatteryPresent: false } };
  const restored = resolveCachedOfferDraft(server, 'source', 2, cached);
  assert.equal(restored.input.existingBatteryPresent, true);
  assert.equal(restored.dirty, false);
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

test('kontynuacja zachowuje poprzedni ranking podczas błędu i wyłącza go po utracie świeżości', () => {
  const previous = {
    status: 'blocked' as const, reasons: ['Brak pełnego profilu.'], warnings: [],
    baselineAnnualCostPln: null, proposedAnnualCostPln: null, annualSavingsPln: null,
    systemCostPln: null, costAfterFinancingPln: null, paybackYears: null, grantPln: null, taxReliefPln: null,
    rankings: [], recommendedTemplateIds: null,
    recommendationSearch: {
      version: 1 as const, candidateSignature: 'f'.repeat(64), evaluatedCandidateIds: ['candidate-1'],
      totalCandidates: 5, evaluatedCandidates: 1, batchNumber: 1, batchEvaluated: 1,
      hasMore: true, phase: 'coarse' as const,
    },
  };
  const original = {
    key: 'same-input', projectId: 'project-1', data: previous, jobId: 'parent-1',
    loading: false, mode: null, error: '', completed: 1, total: 5,
  };
  const running = beginOfferWorkspaceCalculationState(original, 'same-input', 'project-1', 'recommend', 'parent-1');
  assert.equal(running.data, previous);
  assert.equal(running.jobId, 'parent-1');
  assert.equal(running.loading, true);

  const failed = failOfferWorkspaceCalculationState(running, {
    key: 'same-input', error: 'Błąd kontynuacji.', continueFromJobId: 'parent-1',
    resultMatchesDraft: true, staleContinuation: false,
  });
  assert.equal(failed.data, previous);
  assert.equal(failed.jobId, 'parent-1', 'transient failure keeps the parent available for retry');
  assert.equal(failed.loading, false);
  assert.equal(failed.error, 'Błąd kontynuacji.');

  const stale = failOfferWorkspaceCalculationState(running, {
    key: 'same-input', error: 'Poprzednia rekomendacja jest nieaktualna.', continueFromJobId: 'parent-1',
    resultMatchesDraft: true, staleContinuation: true,
  });
  assert.equal(stale.data, previous, 'stale continuation still leaves the old result visible');
  assert.equal(stale.jobId, null, 'stale parent cannot be submitted again');

  const changedDraft = staleOfferWorkspaceCalculationState(original, 'changed-input');
  assert.equal(changedDraft.data, null);
  assert.equal(changedDraft.jobId, null);
});

test('lokalny cache szkicu jest rozdzielony na użytkownika i projekt', () => {
  assert.notEqual(offerWorkspaceStorageKey('user-a', 'project-1'), offerWorkspaceStorageKey('user-b', 'project-1'));
  assert.notEqual(offerWorkspaceStorageKey('user-a', 'project-1'), offerWorkspaceStorageKey('user-a', 'project-2'));
  assert.equal(offerWorkspaceStorageKey(undefined, 'project-1'), null);
});

test('restore zachowuje obliczenie wybranego zestawu przed rankingiem, a bez wyboru szuka rekomendacji najpierw', () => {
  const selectedDraft = { ...emptyOfferWorkspaceDraft(), saleVatMode: 'STANDARD_23' as const,
    currentSettlement: 'NET_BILLING' as const, targetSettlement: 'NET_BILLING' as const };
  assert.deepEqual(offerWorkspaceCalculationRestoreOrder({ ...selectedDraft, selectedTemplateIds: ['battery-b'] }), ['selected', 'recommend']);
  assert.deepEqual(offerWorkspaceCalculationRestoreOrder(selectedDraft), ['recommend', 'selected']);
});

test('zapisany podział komercyjny unieważnia cache i przywraca wybrane obliczenie', () => {
  const draft = { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['battery'],
    commercialPricing: { schemaVersion: 1 as const, batteryInstallationScopeConfirmed: true as const,
      allocations: [{ templateId: 'battery', itemId: 'battery-cell', group: 'STORAGE_INSTALLATION' as const }] } };
  assert.notEqual(offerWorkspaceCalculationInputKey(draft), offerWorkspaceCalculationInputKey(emptyOfferWorkspaceDraft()));
  assert.deepEqual(offerWorkspaceCalculationRestoreOrder(draft), ['selected']);
});

test('restore pomija rekomendację z brakującymi danymi i nadal przywraca wybrane obliczenie', () => {
  const invalidDraft = { ...emptyOfferWorkspaceDraft(), targetOperatorId: 1, targetTariffId: 2 };
  assert.deepEqual(offerWorkspaceCalculationRestoreOrder(invalidDraft), ['selected']);
  assert.deepEqual(offerWorkspaceCalculationRestoreOrder({ ...invalidDraft, selectedTemplateIds: ['battery-b'] }), ['selected']);
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

test('nieaktualny job pokazuje przyczynę zablokowanej kalkulacji zamiast komunikatu o braku wyniku', () => {
  const reason = 'Brak pełnego godzinowego profilu energii do symulacji.';
  const job = parseCalculationJob({
    ok: true,
    job: { id: 'job-stale', status: 'completed', completed: 18, total: 18, stale: true, blockedReasons: [reason] },
  }, new Response(null, { status: 200 }));

  assert.equal(job.stale, true);
  assert.deepEqual(job.blockedReasons, [reason]);
  assert.equal(offerWorkspaceCalculationStaleMessage(job.blockedReasons),
    `Wynik kalkulacji jest nieaktualny i został pominięty. Ostatnia próba była zablokowana: ${reason}`);
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
  assert.match(offerWorkspaceCalculationPreflightError(draft, 'recommend') || '', /VAT sprzedaży/);
  assert.equal(draft.calculation.initialCreditKwh, null);
  assert.equal(draft.calculation.initialDepositPln, null);
});

test('wybrana diagnostyka zachowuje dotychczasowy preflight nawet gdy rekomendacja wymaga danych', () => {
  const draft = { ...emptyOfferWorkspaceDraft(), targetOperatorId: 1, targetTariffId: 2 };

  assert.equal(offerWorkspaceCalculationPreflightError(draft, 'selected'), null);
  assert.match(offerWorkspaceCalculationPreflightError(draft, 'recommend') || '', /VAT sprzedaży/);
  assert.match(offerWorkspaceCalculationPreflightError(emptyOfferWorkspaceDraft(), 'recommend') || '', /taryfę scenariusza/);
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


test('starszy szkic uzupełnia znane rozliczenie tylko dla istniejącej PV', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.targetSettlement = 'NET_BILLING';
  draft.existingPv.powerKw = 5;
  const workspace = { input: { settlementMode: 'net-metering', existingPv: { powerKw: 5 }, existingBatteryPresent: false }, draft: { input: draft } } as any;
  assert.equal(initialDraft(workspace, null).currentSettlement, 'NET_METERING');
  assert.equal(initialDraft(workspace, null).targetSettlement, 'NET_BILLING');
  draft.currentSettlement = 'NET_BILLING';
  assert.equal(initialDraft(workspace, null).currentSettlement, 'NET_BILLING');
  draft.existingPv.powerKw = 0;
  assert.equal(initialDraft(workspace, null).currentSettlement, null);
  assert.equal(initialDraft(workspace, null).targetSettlement, 'NET_BILLING');
});


test('stary cache bez podziału nie wyłącza automatycznych czterech lub pięciu pozycji', () => {
  const original = emptyOfferWorkspaceDraft();
  const server = { ...original, commercialPricing: { schemaVersion: 2 as const, allocations: [], batteryInstallationScopeConfirmed: true as const } };
  const restored = resolveCachedOfferDraft(server, 'source', 2, { expectedRevision: 2, input: { ...original, description: { before: 'Zachowaj tekst', after: '' } } });
  assert.equal(restored.input.commercialPricing?.schemaVersion, 2);
  assert.equal(restored.input.description.before, 'Zachowaj tekst');
});

test('nowy system zawsze net-billing, również po odczycie starszego szkicu i cache', () => {
  const saved = { ...emptyOfferWorkspaceDraft(), currentSettlement: 'NET_METERING' as const, targetSettlement: 'NET_METERING' as const };
  const workspace = { clientType: 'B2C', input: { existingPv: { powerKw: 10 }, settlementMode: 'net-metering' }, draft: { input: saved } } as any;
  const loaded = initialDraft(workspace, null);
  assert.equal(loaded.targetSettlement, 'NET_BILLING');
  assert.equal(loaded.currentSettlement, 'NET_METERING');
  assert.equal(saved.targetSettlement, 'NET_METERING');
  assert.equal(initialDraft({ ...workspace, draft: null }, null).targetSettlement, 'NET_BILLING');
  const cached = resolveCachedOfferDraft(loaded, 'source', 1, { expectedRevision: 1, input: { ...saved, targetSettlement: 'NET_BILLING' } });
  assert.equal(cached.input.targetSettlement, 'NET_BILLING');
});

test('nowa oferta B2C zaczyna z PV, magazynem, dotacją i ulgą; zapisane wybory pozostają', () => {
  const workspace = { clientType: 'B2C', input: { existingPv: { powerKw: 0 }, existingBatteryPresent: false } } as any;
  const initial = initialDraft(workspace, null);
  assert.equal(initial.pvStrategy, 'ADD_TEMPLATE');
  assert.equal(initial.includeStorage, true);
  assert.deepEqual(initial.financing, { considerGrant: true, considerTaxRelief: true });
  assert.deepEqual(initial.selectedTemplateIds, [], 'zestaw wybiera użytkownik albo rekomendacja');
  const saved = { ...initial, pvStrategy: 'KEEP_EXISTING' as const, includeStorage: false, financing: { considerGrant: false, considerTaxRelief: false } };
  const restored = initialDraft({ ...workspace, draft: { input: saved } }, null);
  assert.equal(restored.pvStrategy, 'KEEP_EXISTING');
  assert.equal(restored.includeStorage, false);
  assert.deepEqual(restored.financing, saved.financing);
  assert.deepEqual(initialDraft({ ...workspace, clientType: 'B2B' }, null).financing, { considerGrant: false, considerTaxRelief: false });
});
