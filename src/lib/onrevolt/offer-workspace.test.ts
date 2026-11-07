import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultOfferCalculationAssumptions, emptyOfferWorkspaceDraft, parseOfferWorkspaceDraft, selectOfferWorkspaceTemplate, setOfferWorkspacePvStrategy } from './offer-workspace';
import { DEFAULT_OFFER_BILLING_CYCLE_MONTHS } from './offer-workspace';

test('szkic oferty dopuszcza brak danych bez zastępowania ich zerem', () => {
  const input = emptyOfferWorkspaceDraft();
  assert.deepEqual(parseOfferWorkspaceDraft(input), input);
});

test('a different selected configuration clears its old commercial row assignments', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.selectedTemplateIds = ['bank-1'];
  draft.commercialPricing = { schemaVersion: 1, batteryInstallationScopeConfirmed: true,
    allocations: [{ templateId: 'bank-1', itemId: 'item', group: 'STORAGE_INSTALLATION' }] };
  const templates = [{ id: 'bank-1', kind: 'MAGAZYN' }, { id: 'bank-2', kind: 'MAGAZYN' }];
  assert.equal(selectOfferWorkspaceTemplate(draft, templates, 'bank-1', true).commercialPricing, draft.commercialPricing);
  assert.equal(selectOfferWorkspaceTemplate(draft, templates, 'bank-2', true).commercialPricing?.schemaVersion, 2);
  assert.ok(draft.commercialPricing);
});

test('potwierdzone PV 9,9 kWp / 40 stopni / 170 stopni pozostaje w szkicu', () => {
  const input = emptyOfferWorkspaceDraft();
  input.existingPv = { powerKw: 9.9, tiltDegrees: 40, azimuthDegrees: 170, lossPercent: 12 };
  assert.deepEqual(parseOfferWorkspaceDraft(input).existingPv, input.existingPv);
});

test('jawne zgody na szacunki są zachowane, a stare szkice ich nie włączają', () => {
  const calculation = defaultOfferCalculationAssumptions();
  delete calculation.taxEstimateAccepted;
  delete calculation.pvReconstructionAccepted;
  const input = { ...emptyOfferWorkspaceDraft(), calculation };
  assert.equal(parseOfferWorkspaceDraft(input).calculation?.taxEstimateAccepted, false);
  assert.equal(parseOfferWorkspaceDraft(input).calculation?.pvReconstructionAccepted, false);
  calculation.taxEstimateAccepted = true;
  calculation.pvReconstructionAccepted = true;
  assert.equal(parseOfferWorkspaceDraft(input).calculation?.taxEstimateAccepted, true);
  assert.equal(parseOfferWorkspaceDraft(input).calculation?.pvReconstructionAccepted, true);
  assert.throws(() => parseOfferWorkspaceDraft({ ...input, calculation: { ...calculation, taxEstimateAccepted: 'true' } }));
});

test('domyślny cykl oferty to dwa miesiące, a jawne cykle pozostają bez zmian', () => {
  assert.equal(DEFAULT_OFFER_BILLING_CYCLE_MONTHS, 2);
  assert.equal(defaultOfferCalculationAssumptions().billingCycleMonths, null,
    'the default is displayed and applied during calculation without being saved as an explicit cycle');
  for (const billingCycleMonths of [1, 6]) {
    const draft = { ...emptyOfferWorkspaceDraft(), calculation: {
      ...defaultOfferCalculationAssumptions(), billingCycleMonths,
    } };
    assert.equal(parseOfferWorkspaceDraft(draft).calculation?.billingCycleMonths, billingCycleMonths);
  }
});

test('brak cyklu w zapisanym szkicu pozostaje jawny podczas edycji innych założeń', () => {
  const defaults = defaultOfferCalculationAssumptions();
  const { billingCycleMonths: _default, ...calculation } = defaults;
  const draft = { ...emptyOfferWorkspaceDraft(), calculation } as unknown as ReturnType<typeof emptyOfferWorkspaceDraft>;
  assert.equal(parseOfferWorkspaceDraft(draft).calculation?.billingCycleMonths, null);
  assert.equal(parseOfferWorkspaceDraft({ ...draft, calculation: { ...calculation, billingCycleMonths: null } }).calculation?.billingCycleMonths, null);
});

test('wartości obliczeń, kwoty i station z klienta nie trafiają do zapisu', () => {
  const input = { ...emptyOfferWorkspaceDraft(), station: 50, price: 1, calculation: { ...defaultOfferCalculationAssumptions(), payback: 1 } };
  assert.deepEqual(parseOfferWorkspaceDraft(input), { ...emptyOfferWorkspaceDraft(), calculation: defaultOfferCalculationAssumptions() });
  assert.throws(() => parseOfferWorkspaceDraft({ ...input, calculation: { payback: 1 } }));
});

test('walidacja liczb nie konwertuje null ani tekstu na moc PV', () => {
  for (const value of ['', '9.9', -1, Infinity, NaN, undefined]) {
    const input = emptyOfferWorkspaceDraft();
    assert.throws(() => parseOfferWorkspaceDraft({ ...input, existingPv: { ...input.existingPv, powerKw: value } }));
  }
});

test('nie przyjmuje samotnego ID taryfy i zduplikowanych zestawów', () => {
  assert.throws(() => parseOfferWorkspaceDraft({ ...emptyOfferWorkspaceDraft(), targetTariffId: 1 }));
  assert.throws(() => parseOfferWorkspaceDraft({ ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['one', 'one'] }));
});

test('zachowuje polski opis i nie interpretuje go jako HTML', () => {
  const input = emptyOfferWorkspaceDraft();
  input.description.before = 'Żółć <script>alert(1)</script>';
  assert.equal(parseOfferWorkspaceDraft(input).description.before, input.description.before);
});

test('wybór drugiego magazynu zastępuje pierwszy i zachowuje osobny zestaw PV', () => {
  const templates = [{ id: 'bank-a', kind: 'MAGAZYN' }, { id: 'bank-b', kind: 'MAGAZYN' }, { id: 'pv', kind: 'PV_DACH_SKOSNY' }];
  let draft = selectOfferWorkspaceTemplate(emptyOfferWorkspaceDraft(), templates, 'bank-a', true);
  draft = selectOfferWorkspaceTemplate(draft, templates, 'pv', true);
  assert.equal(draft.pvStrategy, 'ADD_TEMPLATE');
  draft = selectOfferWorkspaceTemplate(draft, templates, 'bank-b', true);
  assert.deepEqual(draft.selectedTemplateIds, ['pv', 'bank-b']);
  assert.doesNotThrow(() => parseOfferWorkspaceDraft(draft));
  draft = setOfferWorkspacePvStrategy(draft, templates, 'KEEP_EXISTING');
  assert.deepEqual(draft.selectedTemplateIds, ['bank-b']);
});

test('odznaczenie zestawu nie usuwa drugiego, a nieobsługiwany rodzaj nie trafia do szkicu', () => {
  const templates = [{ id: 'bank', kind: 'MAGAZYN' }, { id: 'pv', kind: 'PV_DACH_SKOSNY' }, { id: 'ems', kind: 'EMS' }];
  let draft = selectOfferWorkspaceTemplate(emptyOfferWorkspaceDraft(), templates, 'bank', true);
  draft = selectOfferWorkspaceTemplate(draft, templates, 'pv', true);
  draft = selectOfferWorkspaceTemplate(draft, templates, 'pv', false);
  assert.deepEqual(draft.selectedTemplateIds, ['bank']);
  assert.throws(() => selectOfferWorkspaceTemplate(draft, templates, 'ems', true), /magazynu lub PV/);
});

test('stare jawne zera pozostają zgodne bez automatycznego tworzenia transz i dat', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.calculation = {
    ...defaultOfferCalculationAssumptions(),
    initialCreditKwh: 0,
    initialDepositPln: 0,
  };

  const parsed = parseOfferWorkspaceDraft(draft);
  assert.equal(parsed.calculation?.billingCycleStartMonth, null);
  assert.deepEqual(parsed.calculation?.initialCreditLots, []);
  assert.deepEqual(parsed.calculation?.initialDepositLots, []);
  assert.equal(parsed.calculation?.initialCreditKwh, 0);
  assert.equal(parsed.calculation?.initialDepositPln, 0);
});

test('zapisuje kotwicę oraz jawne datowane transze i nie współdzieli ich tablic z wejściem', () => {
  const draft = emptyOfferWorkspaceDraft();
  draft.calculation = {
    ...defaultOfferCalculationAssumptions(),
    billingCycleMonths: 3,
    billingCycleStartMonth: '2025-03',
    initialCreditKwh: 1.25,
    initialCreditLots: [{ kwh: 1.25, creditedMonth: '2025-01', expiresMonth: '2026-02' }],
    initialDepositPln: 25,
    initialDepositLots: [{ amountPln: 25, creditedMonth: '2025-02', expiresMonth: '2026-02', refundCapPln: 7.5 }],
  };

  const parsed = parseOfferWorkspaceDraft(draft);
  assert.deepEqual(parsed.calculation, draft.calculation);
  assert.notEqual(parsed.calculation?.initialCreditLots, draft.calculation.initialCreditLots);
  assert.notEqual(parsed.calculation?.initialDepositLots, draft.calculation.initialDepositLots);
});

test('blokuje ujemne, przyszłe, niedatowane i niezgodne transze energii', () => {
  const base = emptyOfferWorkspaceDraft();
  const calculation = {
    ...defaultOfferCalculationAssumptions(),
    initialCreditKwh: 1,
    initialCreditLots: [{ kwh: 1, creditedMonth: '2025-01', expiresMonth: '2026-02' }],
  };
  const withCalculation = (value: typeof calculation) => ({ ...base, calculation: value });

  assert.throws(() => parseOfferWorkspaceDraft(withCalculation({
    ...calculation, initialCreditLots: [{ ...calculation.initialCreditLots[0], kwh: -1 }],
  })), /nieujemne|od 0/);
  assert.throws(() => parseOfferWorkspaceDraft(withCalculation({
    ...calculation, initialCreditLots: [{ ...calculation.initialCreditLots[0], creditedMonth: '2099-01' }],
  })), /przyszłe transze/);
  assert.throws(() => parseOfferWorkspaceDraft(withCalculation({
    ...calculation, initialCreditLots: [{ ...calculation.initialCreditLots[0], creditedMonth: '2025-01', expiresMonth: '' }],
  })), /miesiąc YYYY-MM/);
  assert.throws(() => parseOfferWorkspaceDraft(withCalculation({
    ...calculation, initialCreditLots: [{ ...calculation.initialCreditLots[0], expiresMonth: '2026-03' }],
  })), /12 miesięcy ważności/);
  assert.throws(() => parseOfferWorkspaceDraft(withCalculation({
    ...calculation, initialCreditKwh: 2,
  })), /suma datowanych transz/);
});

test('waliduje kotwicę i daty depozytu, zachowując limity jawne z dokumentu', () => {
  const base = emptyOfferWorkspaceDraft();
  const calculation = {
    ...defaultOfferCalculationAssumptions(),
    billingCycleStartMonth: '2025-03',
    initialDepositPln: 10,
    initialDepositLots: [{ amountPln: 10, creditedMonth: '2025-02', expiresMonth: '2026-02', refundCapPln: 3 }],
  };
  const withCalculation = (value: typeof calculation) => ({ ...base, calculation: value });

  assert.deepEqual(parseOfferWorkspaceDraft(withCalculation(calculation)).calculation?.initialDepositLots, calculation.initialDepositLots);
  assert.throws(() => parseOfferWorkspaceDraft(withCalculation({ ...calculation, billingCycleStartMonth: '2025-13' })), /YYYY-MM/);
  assert.throws(() => parseOfferWorkspaceDraft(withCalculation({ ...calculation, billingCycleStartMonth: '1899-12' })), /zakresie/);
  assert.throws(() => parseOfferWorkspaceDraft(withCalculation({
    ...calculation, initialDepositLots: [{ ...calculation.initialDepositLots[0], creditedMonth: '2099-01' }],
  })), /przyszłe transze/);
  assert.throws(() => parseOfferWorkspaceDraft(withCalculation({
    ...calculation, initialDepositLots: [{ ...calculation.initialDepositLots[0], refundCapPln: -1 }],
  })), /od 0/);
  assert.throws(() => parseOfferWorkspaceDraft(withCalculation({
    ...calculation, initialDepositLots: [{ ...calculation.initialDepositLots[0], expiresMonth: '2027-02' }],
  })), /12 miesięcy ważności depozytu/);
  assert.throws(() => parseOfferWorkspaceDraft(withCalculation({
    ...calculation, initialDepositLots: [{ ...calculation.initialDepositLots[0], expiresMonth: '2025-02' }],
  })), /musi przypadać po miesiącu uznania/);
});
