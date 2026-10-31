import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateConfigurationLine, sumConfiguration, type CalculationInput } from './calculator';
import { resolveTemplateItemCosts } from './configuration-templates';
import {
  enumerateOfferCandidates,
  type ApprovedConfigurationTemplate,
  type OfferCandidateEnumerationInput,
  type OfferCandidateTemplateItem,
} from './offer-candidates';

function batteryTemplate(capacityKwh: number, overrides: Partial<ApprovedConfigurationTemplate> = {}): ApprovedConfigurationTemplate {
  const productId = `battery-${capacityKwh}`;
  return {
    id: `template-battery-${capacityKwh}`,
    familyKey: 'battery-family',
    name: `Magazyn ${capacityKwh} kWh`,
    version: 3,
    isActive: true,
    kind: 'MAGAZYN',
    clientType: 'B2C',
    roofType: null,
    powerKw: capacityKwh / 2,
    capacityKwh,
    requiresExistingPv: true,
    requiresExistingInverter: false,
    items: [
      {
        id: `item-${productId}`,
        position: 1,
        quantity: 1,
        role: 'MAIN_EQUIPMENT',
        supplyMode: 'ONREVOLT_SUPPLIED',
        description: `Magazyn ${capacityKwh} kWh`,
        productId,
        product: {
          sku: `BAT-${capacityKwh}`,
          name: `Battery product ${capacityKwh}`,
          prices: [{ purchaseNet: 10000 + capacityKwh * 100, currentPurchaseNet: 9800 + capacityKwh * 100, purchaseVatRate: 0.23 }],
        },
        operatingCostNet: 300,
        marginRate: 0.25,
        saleVatRate: 0.08,
        isOptional: false,
        requiresReview: false,
      },
      {
        id: `item-labor-${capacityKwh}`,
        position: 2,
        quantity: 2,
        role: 'LABOR',
        supplyMode: 'SERVICE_ONLY',
        description: 'Montaż',
        productId: null,
        product: null,
        unitPurchaseNet: 450,
        purchaseVatRate: 0.23,
        operatingCostNet: 0,
        marginRate: 0.2,
        saleVatRate: 0.08,
        isOptional: false,
        requiresReview: false,
      },
    ],
    ...overrides,
  };
}

function pvTemplate(
  id = 'template-pv-sloped',
  overrides: Partial<ApprovedConfigurationTemplate> = {},
): ApprovedConfigurationTemplate {
  return {
    id,
    familyKey: 'pv-family',
    name: 'PV dach skośny 6 kWp',
    version: 2,
    isActive: true,
    kind: 'PV_DACH_SKOSNY',
    clientType: 'B2C_B2B',
    roofType: 'SLOPED',
    powerKw: 6,
    capacityKwh: null,
    requiresExistingPv: false,
    requiresExistingInverter: false,
    items: [
      {
        id: 'item-pv',
        position: 1,
        quantity: 12,
        role: 'MAIN_EQUIPMENT',
        supplyMode: 'ONREVOLT_SUPPLIED',
        description: 'Moduł PV',
        productId: 'product-pv',
        product: {
          sku: 'PV-450',
          name: 'Moduł fotowoltaiczny 450 W',
          prices: [{ purchaseNet: 310, purchaseVatRate: 0.23 }],
        },
        operatingCostNet: 100,
        marginRate: 0.2,
        saleVatRate: 0.08,
        isOptional: false,
        requiresReview: false,
      },
    ],
    ...overrides,
  };
}

const allTemplates = [
  batteryTemplate(16),
  batteryTemplate(32),
  batteryTemplate(48),
  batteryTemplate(64, { id: 'template-battery-no-capacity', name: 'Magazyn bez pojemności', capacityKwh: null }),
  batteryTemplate(12, { id: 'template-battery-b2b', name: 'Magazyn B2B', clientType: 'B2B' }),
  pvTemplate(),
  pvTemplate('template-pv-flat', { kind: 'PV_DACH_PLASKI', roofType: 'FLAT', name: 'PV dach płaski 8 kWp', powerKw: 8 }),
];

const baseInput: OfferCandidateEnumerationInput = {
  approvedConfigurationTemplates: allTemplates,
  clientType: 'B2C',
  roofType: 'UNKNOWN',
  pvStrategy: 'KEEP_EXISTING',
  existingPv: { powerKw: 9.9, tiltDegrees: 40, azimuthDegrees: 170 },
  addedPvGeometry: null,
  existingPvCompatibilityEvidence: 'yes',
  existingInverterCompatibilityEvidence: 'unknown',
  saleVatMode: 'REDUCED_8',
};

test('tworzy kandydatów z rzeczywistych szablonów 16/32/48 kWh bez skalowania mocy', () => {
  const result = enumerateOfferCandidates(baseInput);
  assert.deepEqual(result.candidates.map((candidate) => candidate.batteryCapacityKwh), [16, 32, 48]);
  assert.deepEqual(result.candidates.map((candidate) => candidate.batteryPowerKw), [8, 16, 24]);
  assert.ok(result.candidates.every((candidate) => candidate.addedPvKw === 0 && candidate.totalPvKw === 9.9));
  assert.deepEqual(result.candidates[0].existingPv, { powerKw: 9.9, tiltDegrees: 40, azimuthDegrees: 170 });
  assert.ok(result.candidates.every((candidate) => candidate.templateIds.length === 1));
  assert.ok(result.candidates.every((candidate) => candidate.templateVersions[0] === 3));
  assert.ok(result.rejectedReasonList.some((entry) => entry.templateIds[0] === 'template-battery-no-capacity'));
});

test('dodanie PV tworzy tylko kompatybilne pary bateria-PV klient/dach', () => {
  const result = enumerateOfferCandidates({ ...baseInput, roofType: 'SLOPED', pvStrategy: 'ADD_TEMPLATE' });
  assert.deepEqual(result.candidates.map((candidate) => candidate.templateIds), [
    ['template-battery-16', 'template-pv-sloped'],
    ['template-battery-32', 'template-pv-sloped'],
    ['template-battery-48', 'template-pv-sloped'],
  ]);
  assert.ok(result.candidates.every((candidate) => candidate.addedPvKw === 6 && candidate.totalPvKw === 15.9));
  assert.ok(result.candidates.every((candidate) => candidate.pvGeometryReviewRequired && candidate.addedPvGeometry === null));
  assert.ok(result.rejectedReasonList.some((entry) => entry.templateIds[0] === 'template-pv-flat' && /dachu SLOPED/.test(entry.reasons.join(' '))));
  assert.ok(result.rejectedReasonList.some((entry) => entry.templateIds[0] === 'template-battery-b2b' && /klienta B2C/.test(entry.reasons.join(' '))));
});

test('nowy klient bez PV może dostać kandydat add-PV z geometrią dodawaną osobno', () => {
  const templates = [
    batteryTemplate(16, { requiresExistingPv: false }),
    pvTemplate(),
  ];
  const input: OfferCandidateEnumerationInput = {
    ...baseInput,
    approvedConfigurationTemplates: templates,
    roofType: 'SLOPED',
    pvStrategy: 'ADD_TEMPLATE',
    existingPv: { powerKw: 0, tiltDegrees: null, azimuthDegrees: null },
    addedPvGeometry: { tiltDegrees: 40, azimuthDegrees: 170 },
    existingPvCompatibilityEvidence: 'no',
  };
  const result = enumerateOfferCandidates(input);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].existingPv, { powerKw: 0, tiltDegrees: null, azimuthDegrees: null });
  assert.deepEqual(result.candidates[0].addedPvGeometry, { tiltDegrees: 40, azimuthDegrees: 170 });
  assert.equal(result.candidates[0].existingPvKw, 0);
  assert.equal(result.candidates[0].addedPvKw, 6);
  assert.equal(result.candidates[0].totalPvKw, 6);
  assert.equal(result.candidates[0].pvGeometryReviewRequired, false);
  assert.equal(result.candidates[0].requiresReview, false);

  const unresolvedGeometry = enumerateOfferCandidates({ ...input, addedPvGeometry: null }).candidates[0];
  assert.equal(unresolvedGeometry.addedPvGeometry, null);
  assert.equal(unresolvedGeometry.pvGeometryReviewRequired, true);
  assert.equal(unresolvedGeometry.requiresReview, true);
});

test('flagi szablonu wymagające istniejącego PV odrzucają klienta bez instalacji', () => {
  const result = enumerateOfferCandidates({
    ...baseInput,
    approvedConfigurationTemplates: [batteryTemplate(16), pvTemplate()],
    roofType: 'SLOPED',
    pvStrategy: 'ADD_TEMPLATE',
    existingPv: { powerKw: 0, tiltDegrees: null, azimuthDegrees: null },
    addedPvGeometry: null,
    existingPvCompatibilityEvidence: 'no',
  });
  assert.equal(result.candidates.length, 0);
  assert.ok(result.rejectedReasonList.some((entry) => /wymaga istniejącej instalacji PV/.test(entry.reasons.join(' '))));
});

test('baseline zero-investment i tariff-only nie są fikcyjnymi szablonami', () => {
  const result = enumerateOfferCandidates(baseInput);
  assert.deepEqual(result.baselineComparisons, [
    { id: 'baseline:zero-investment', kind: 'ZERO_INVESTMENT', templateIds: [], investmentGross: 0 },
    { id: 'baseline:tariff-only', kind: 'TARIFF_ONLY', templateIds: [], investmentGross: 0 },
  ]);
  assert.ok(result.baselineComparisons.every((baseline) => baseline.templateIds.length === 0));
});

test('zachowuje pozycje i sumy z istniejącego resolvera oraz kalkulatora konfiguracji', () => {
  const candidate = enumerateOfferCandidates(baseInput).candidates[0];
  const template = allTemplates.find((entry) => entry.id === candidate.templateIds[0])!;
  const expectedInputs: CalculationInput[] = template.items.map((item) => ({
    quantity: Number(item.quantity),
    ...resolveTemplateItemCosts(item),
    saleVatRate: 0.08,
  }));
  const expected = sumConfiguration(expectedInputs);
  const firstItem: OfferCandidateTemplateItem = template.items[0];
  assert.deepEqual(candidate.totals, expected);
  assert.equal(candidate.items[0].productId, firstItem.productId);
  assert.equal(candidate.items[0].productSku, firstItem.product?.sku);
  assert.equal(candidate.items[0].productName, firstItem.product?.name);
  assert.equal(candidate.items[0].role, firstItem.role);
  assert.equal(candidate.items[1].supplyMode, 'SERVICE_ONLY');
  assert.equal(candidate.items[1].quantity, 2);
  assert.equal(candidate.items[0].calculation?.saleGross, calculateConfigurationLine(expectedInputs[0]).saleGross);
  assert.deepEqual(candidate.existingPv, { powerKw: 9.9, tiltDegrees: 40, azimuthDegrees: 170 });
});

test('kandydat z częściowym katalogiem cen zostaje widoczny, oznaczony do przeglądu, bez sumy częściowej', () => {
  const partial = batteryTemplate(16, {
    items: [
      batteryTemplate(16).items[0],
      {
        ...batteryTemplate(16).items[1],
        id: 'missing-catalog-price',
        position: 2,
        role: 'ACCESSORY',
        supplyMode: 'ONREVOLT_SUPPLIED',
        productId: 'missing-product',
        product: { name: 'Brak ceny' },
      },
    ],
  });
  const result = enumerateOfferCandidates({ ...baseInput, approvedConfigurationTemplates: [partial] });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].totals, null);
  assert.equal(result.candidates[0].requiresReview, true);
  assert.equal(result.candidates[0].missingPrices.length, 1);
  assert.match(result.candidates[0].missingPrices[0], /Brak aktualnej ceny katalogowej/);
  assert.equal(result.candidates[0].items[1].productId, 'missing-product');
});

test('brak wersji, pojemności oraz ilość zerowa albo ujemna trafiają do powodów odrzucenia', () => {
  const noVersion = batteryTemplate(16, { id: 'no-version', version: 0 });
  const zeroQuantity = batteryTemplate(32, {
    id: 'zero-quantity',
    items: [{ ...batteryTemplate(32).items[0], quantity: 0 }],
  });
  const negativeQuantity = batteryTemplate(48, {
    id: 'negative-quantity',
    items: [{ ...batteryTemplate(48).items[0], quantity: -1 }],
  });
  const result = enumerateOfferCandidates({
    ...baseInput,
    approvedConfigurationTemplates: [noVersion, zeroQuantity, negativeQuantity, allTemplates[3]],
  });
  assert.equal(result.candidates.length, 0);
  const allReasons = result.rejectedReasonList.flatMap((entry) => entry.reasons).join(' ');
  assert.match(allReasons, /wersji/);
  assert.match(allReasons, /pojemność/);
  assert.match(allReasons, /ilość zero lub ujemną/);
});

test('brak potwierdzenia zgodności istniejących aktywów nie ukrywa kandydata, lecz wymaga przeglądu', () => {
  const result = enumerateOfferCandidates({
    ...baseInput,
    existingPvCompatibilityEvidence: 'unknown',
    existingInverterCompatibilityEvidence: 'unknown',
    approvedConfigurationTemplates: [batteryTemplate(16, { requiresExistingInverter: true })],
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].requiresReview, true);
  assert.equal(result.candidates[0].totals?.saleGross !== undefined, true);
  assert.match(result.candidates[0].reviewReasons.join(' '), /[Zz]godność/);
});

test('powtórzony falownik lub EMS w BOM dwóch szablonów wymaga przeglądu', () => {
  const addDevice = (template: ApprovedConfigurationTemplate, role: 'FALOWNIK' | 'EMS') => ({
    ...template,
    items: [...template.items, {
      ...template.items[0],
      id: `${template.id}-${role}`,
      position: template.items.length + 1,
      role,
      description: role === 'EMS' ? 'System EMS' : 'Falownik hybrydowy',
      productId: `${template.id}-${role}-product`,
      product: {
        sku: `${template.id}-${role}`,
        name: role === 'EMS' ? 'Energy management system' : 'Inverter 10 kW',
        category: role === 'EMS' ? 'SYSTEM_MONITORUJACY' : 'FALOWNIK',
        prices: [{ purchaseNet: 1000, purchaseVatRate: 0.23 }],
      },
    }],
  });
  const battery = addDevice(addDevice(batteryTemplate(16), 'FALOWNIK'), 'EMS');
  const pv = addDevice(addDevice(pvTemplate(), 'FALOWNIK'), 'EMS');
  const result = enumerateOfferCandidates({
    ...baseInput,
    approvedConfigurationTemplates: [battery, pv],
    roofType: 'SLOPED',
    pvStrategy: 'ADD_TEMPLATE',
    addedPvGeometry: { tiltDegrees: 40, azimuthDegrees: 170 },
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].requiresReview, true);
  assert.match(result.candidates[0].reviewReasons.join(' '), /Falownik występuje w kilku szablonach/);
  assert.match(result.candidates[0].reviewReasons.join(' '), /EMS występuje w kilku szablonach/);
  assert.equal(result.candidates[0].items.filter((item) => item.role === 'FALOWNIK').length, 2);
  assert.equal(result.candidates[0].items.filter((item) => item.role === 'EMS').length, 2);
});

test('tryb mieszany zachowuje VAT z BOM, a REVIEW nie tworzy pozornej sumy', () => {
  const mixed = enumerateOfferCandidates({ ...baseInput, saleVatMode: 'MIXED' }).candidates[0];
  const unresolvedVat = enumerateOfferCandidates({ ...baseInput, saleVatMode: 'REVIEW' }).candidates[0];
  assert.equal(mixed.items[0].saleVatRate, 0.08);
  assert.ok(mixed.totals);
  assert.equal(unresolvedVat.totals, null);
  assert.equal(unresolvedVat.requiresReview, true);
  assert.ok(unresolvedVat.missingPrices.length > 0);
});

test('identyfikator i deduplikacja zależą tylko od uporządkowanych ID szablonów', () => {
  const template = batteryTemplate(16);
  const first = enumerateOfferCandidates({ ...baseInput, approvedConfigurationTemplates: [template] }).candidates[0];
  const second = enumerateOfferCandidates({ ...baseInput, approvedConfigurationTemplates: [{ ...template }] }).candidates[0];
  assert.equal(first.id, second.id);
  const duplicate = enumerateOfferCandidates({ ...baseInput, approvedConfigurationTemplates: [template, { ...template }] });
  assert.equal(duplicate.candidates.length, 1);
  assert.ok(duplicate.rejectedReasonList.some((entry) => /Powtórzony identyfikator/.test(entry.reasons.join(' '))));
});

test('wymaga dodatniej istniejącej mocy w trybie fixed i skończonych danych wejściowych', () => {
  assert.throws(() => enumerateOfferCandidates({
    ...baseInput,
    existingPv: { powerKw: 0, tiltDegrees: null, azimuthDegrees: null },
  }), /dodatniej/);
  assert.throws(() => enumerateOfferCandidates({ ...baseInput, existingPv: { ...baseInput.existingPv, powerKw: Number.NaN } }), /skończona/);
  assert.throws(() => enumerateOfferCandidates({ ...baseInput, existingPv: { ...baseInput.existingPv, tiltDegrees: 91 } }), /nachylenie/i);
  assert.throws(() => enumerateOfferCandidates({ ...baseInput, saleVatMode: undefined as never }), /Tryb VAT/);
  assert.throws(() => enumerateOfferCandidates({ ...baseInput, saleVatMode: 'EXPLICIT_VAT' as never }), /Tryb VAT/);
});
