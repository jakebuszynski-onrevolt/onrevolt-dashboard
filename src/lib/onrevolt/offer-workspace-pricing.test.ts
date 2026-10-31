import assert from 'node:assert/strict';
import test from 'node:test';
import { sumConfiguration, type CalculationInput } from './calculator';
import { priceOfferWorkspaceConfiguration, type OfferWorkspacePricingTemplate } from './offer-workspace-pricing';

function template(overrides: Partial<OfferWorkspacePricingTemplate> = {}): OfferWorkspacePricingTemplate {
  return {
    id: 'battery-16',
    name: 'Magazyn 16 kWh',
    kind: 'MAGAZYN',
    items: [
      {
        id: 'battery',
        position: 1,
        description: 'Magazyn energii',
        quantity: 2,
        role: 'BATTERY',
        supplyMode: 'ONREVOLT_SUPPLIED',
        product: {
          id: 'product-battery',
          name: 'Bateria katalogowa',
          prices: [{ purchaseNet: 1000, currentPurchaseNet: 1200, purchaseVatRate: 0.23 }],
        },
        unitPurchaseNet: null,
        purchaseVatRate: null,
        operatingCostNet: 100,
        marginRate: 0.2,
        saleVatRate: 0.08,
        isOptional: false,
        requiresReview: false,
      },
      {
        id: 'installation',
        position: 2,
        description: 'Montaż',
        quantity: 2,
        role: 'INSTALLATION',
        supplyMode: 'SERVICE_ONLY',
        unitPurchaseNet: 200,
        purchaseVatRate: 0.23,
        operatingCostNet: 50,
        marginRate: 0.1,
        saleVatRate: 0.23,
        isOptional: true,
        requiresReview: false,
      },
    ],
    ...overrides,
  };
}

test('wycenia aktualną cenę katalogową, koszty operacyjne, marżę i mieszany VAT', () => {
  const input = template();
  const result = priceOfferWorkspaceConfiguration([input], 'MIXED', 'B2C');
  const expectedInputs: CalculationInput[] = [
    {
      quantity: 2,
      unitPurchaseNet: 1200,
      purchaseVatRate: 0.23,
      operatingCostNet: 100,
      marginRate: 0.2,
      saleVatRate: 0.08,
    },
    {
      quantity: 2,
      unitPurchaseNet: 200,
      purchaseVatRate: 0.23,
      operatingCostNet: 50,
      marginRate: 0.1,
      saleVatRate: 0.23,
    },
  ];
  const expected = sumConfiguration(expectedInputs);

  assert.deepEqual(result.totals, expected);
  assert.equal(result.lines[0].resolvedCosts?.unitPurchaseNet, 1200);
  assert.equal(result.lines[0].calculation?.saleNet, 3000);
  assert.equal(result.lines[0].saleAmount, 3240);
  assert.equal(result.lines[1].isOptional, true);
  assert.equal(result.lines[1].includedInSale, true);
  assert.equal(result.systemCostBeforeFinancing, expected.saleGross);
  assert.deepEqual(result.missingRequiredData, []);
  assert.deepEqual(result.missingOptionalData, []);
});

test('dla B2B udostępnia cenę i koszt systemu netto bez zmiany sumy kalkulatora', () => {
  const result = priceOfferWorkspaceConfiguration([template()], 'MIXED', 'B2B');

  assert.equal(result.saleAmountBasis, 'NET');
  assert.equal(result.lines[0].saleAmount, result.lines[0].calculation?.saleNet);
  assert.equal(result.systemCostBeforeFinancing, result.totals?.saleNet);
});

test('tryby dostawy bez wyceny pozostają zerowe, a tryb przeglądu VAT blokuje ceny', () => {
  const input = template({
    items: [
      {
        ...template().items[0],
        id: 'client-equipment',
        supplyMode: 'CLIENT_OWNED_USED',
        isOptional: true,
      },
    ],
  });
  const result = priceOfferWorkspaceConfiguration([input], 'REVIEW', 'B2C');

  assert.equal(result.totals?.saleGross, 0);
  assert.equal(result.lines[0].includedInSale, false);
  assert.equal(result.lines[0].saleVatRate, 0);
  assert.equal(result.missingRequiredData.length, 0);
  assert.equal(result.missingOptionalData.length, 0);

  const unresolved = priceOfferWorkspaceConfiguration([template()], 'REVIEW', 'B2C');
  assert.equal(unresolved.totals, null);
  assert.equal(unresolved.systemCostBeforeFinancing, null);
  assert.match(unresolved.missingRequiredData[0], /Tryb VAT wymaga przeglądu/);
  assert.match(unresolved.missingOptionalData[0], /Tryb VAT wymaga przeglądu/);
});

test('brak ceny pozycji wymaganej lub opcjonalnej nie daje sumy częściowej', () => {
  const input = template({
    items: [
      {
        ...template().items[0],
        id: 'missing-required',
        description: 'Brak ceny wymaganej',
        product: { id: 'missing-product', name: 'Bez aktualnej ceny', prices: [] },
      },
      {
        ...template().items[1],
        id: 'missing-optional',
        description: 'Brak kosztu opcjonalnego',
        unitPurchaseNet: null,
        isOptional: true,
      },
    ],
  });
  const result = priceOfferWorkspaceConfiguration([input], 'REDUCED_8', 'B2C');

  assert.equal(result.totals, null);
  assert.equal(result.systemCostBeforeFinancing, null);
  assert.equal(result.lines[0].saleAmount, null);
  assert.match(result.missingRequiredData[0], /aktualnej ceny katalogowej/);
  assert.match(result.missingOptionalData[0], /cena pozycji ręcznej/);
});

test('odrzuca niejawny typ klienta bez domyślnego sposobu prezentacji ceny', () => {
  assert.throws(() => priceOfferWorkspaceConfiguration([template()], 'REDUCED_8', 'UNKNOWN'), /Typ klienta musi być jawnie/);
});
