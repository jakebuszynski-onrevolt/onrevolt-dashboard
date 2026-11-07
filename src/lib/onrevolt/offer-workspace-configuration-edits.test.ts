import assert from 'node:assert/strict';
import test from 'node:test';
import { createOfferWorkspacePricingSnapshot, emptyOfferWorkspaceDraft } from './offer-workspace';
import {
  applyOfferWorkspaceConfigurationEdits,
  configurationEnergyQuantityFingerprint,
  configurationItemEditablePricing,
  hasRemovedCriticalConfigurationItem,
  offerWorkspaceSaleAmountToNet,
  offerWorkspaceSaleNetToAmount,
  parseOfferWorkspaceConfigurationEdits,
  validateOfferWorkspaceConfigurationEdits,
  type OfferWorkspaceConfigurationEdit,
} from './offer-workspace-configuration-edits';
import { priceOfferWorkspaceConfiguration } from './offer-workspace-pricing';

function batteryTemplate() {
  return {
    id: 'battery-1', name: 'Magazyn', kind: 'MAGAZYN', powerKw: 5, capacityKwh: 10,
    items: [
      { id: 'main-battery', position: 1, description: 'Magazyn energii', quantity: 1, role: 'MAIN_EQUIPMENT', supplyMode: 'ONREVOLT_SUPPLIED',
        pricingMode: 'CATALOG', operatingCostBasis: 'PER_UNIT', unitPurchaseNet: null, purchaseVatRate: null, operatingCostNet: null, marginRate: null,
        saleVatRate: null, isOptional: false, requiresReview: false, productId: 'battery-product',
        product: { id: 'battery-product', name: 'Powerbrick', category: 'MAGAZYN_ENERGII', prices: [{ id: 'price-1', purchaseNet: 7000,
          currentPurchaseNet: 6500, purchaseVatRate: 0.23, operatingCostNet: 500, marginRate: 0.2, saleVatRate: 0.23 }] } },
      { id: 'service', position: 2, description: 'Montaż', quantity: 1, role: 'LABOR', supplyMode: 'SERVICE_ONLY',
        pricingMode: 'INDIVIDUAL', operatingCostBasis: 'PER_LINE', unitPurchaseNet: 0, purchaseVatRate: 0, operatingCostNet: 100,
        marginRate: 0.2, saleVatRate: 0.23, isOptional: false, requiresReview: false, productId: null, product: null },
    ],
  };
}

function editDraft(configurationEdits: OfferWorkspaceConfigurationEdit[]) {
  return { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['battery-1'], saleVatMode: 'MIXED' as const, configurationEdits };
}

test('effective edits clone the selected template and convert only edited pricing to individual values', () => {
  const source = batteryTemplate();
  (source.items[0] as Record<string, any>).unitSaleNet = 9000;
  const edit = parseOfferWorkspaceConfigurationEdits([{ templateId: 'battery-1', items: [{ itemId: 'main-battery', description: 'Magazyn większy', pricing: { marginRate: 0.25 } }] }]);
  const effective = applyOfferWorkspaceConfigurationEdits([source], editDraft(edit));
  const editedMain = effective[0].items[0] as Record<string, any>;
  assert.notEqual(effective[0], source);
  assert.notEqual(effective[0].items, source.items);
  assert.equal(source.items[0].pricingMode, 'CATALOG');
  assert.equal(effective[0].items[0].description, 'Magazyn większy');
  assert.equal(editedMain.pricingMode, 'INDIVIDUAL');
  assert.equal(editedMain.catalogPriceId, null);
  assert.equal(editedMain.unitPurchaseNet, 6500);
  assert.equal(editedMain.purchaseVatRate, 0.23);
  assert.equal(editedMain.operatingCostBasis, 'PER_UNIT');
  assert.equal(editedMain.marginRate, 0.25);
  assert.equal(editedMain.unitSaleNet, null);
  assert.equal((source.items[0] as Record<string, any>).unitSaleNet, 9000);
  assert.equal(editedMain.workspaceChanged, true);
  assert.equal(effective[0].items[1], source.items[1]);
});

test('manual per-unit template sale price reaches offer net and gross totals at the selected quantity', () => {
  const source = batteryTemplate();
  (source.items[0] as Record<string, any>).unitSaleNet = 8000;
  source.items[0].quantity = 2;

  const b2b = priceOfferWorkspaceConfiguration([source], 'MIXED', 'B2B');
  assert.equal(b2b.lines[0].calculation?.saleNet, 16000);
  assert.equal(b2b.lines[0].calculation?.saleGross, 19680);
  assert.equal(b2b.totals?.saleNet, 16120);

  const b2c = priceOfferWorkspaceConfiguration([source], 'MIXED', 'B2C');
  assert.equal(b2c.lines[0].calculation?.saleGross, 19680);
  assert.equal(b2c.systemCostBeforeFinancing, 19827.6);
});

test('unit sale amount conversion uses the displayed basis and effective VAT without rounding net', () => {
  assert.equal(offerWorkspaceSaleAmountToNet(100, 'NET', null), 100);
  assert.equal(offerWorkspaceSaleAmountToNet(123, 'GROSS', 0.23), 100);
  assert.equal(offerWorkspaceSaleAmountToNet(108, 'GROSS', 0.08), 100);
  assert.equal(offerWorkspaceSaleAmountToNet(123.456, 'GROSS', 0.23), 100.37073170731708);
  assert.equal(offerWorkspaceSaleNetToAmount(100, 'GROSS', 0.23), 123);
  assert.equal(offerWorkspaceSaleNetToAmount(100, 'GROSS', 0.08), 108);
  assert.throws(() => offerWorkspaceSaleAmountToNet(100, 'GROSS', null), /jawna stawka VAT/);
});

test('per-offer sale price edits persist independently of saved purchase and operating cost values', () => {
  const source = batteryTemplate();
  const parsed = parseOfferWorkspaceConfigurationEdits([{ templateId: 'battery-1', items: [
    { itemId: 'main-battery', pricing: { unitSaleNet: 9123.456789 } },
  ] }]);
  const item = applyOfferWorkspaceConfigurationEdits([source], editDraft(parsed))[0].items[0] as Record<string, any>;
  assert.equal(item.unitSaleNet, 9123.456789);
  assert.equal(item.unitPurchaseNet, 6500);
  assert.equal(item.purchaseVatRate, 0.23);
  assert.equal(item.operatingCostNet, 500);
  assert.equal(item.marginRate, 0.2);
  const preview = priceOfferWorkspaceConfiguration([applyOfferWorkspaceConfigurationEdits([source], editDraft(parsed))[0]], 'MIXED', 'B2B');
  assert.equal(preview.lines[0].calculation?.saleNet, 9123.46);
  assert.equal(preview.lines[0].resolvedCosts?.unitPurchaseNet, 6500);
  assert.equal(preview.lines[0].resolvedCosts?.purchaseVatRate, 0.23);
  assert.equal(preview.lines[0].resolvedCosts?.operatingCostNet, 500);
});

test('zero manual sale is distinct, while null and absent prices preserve the historical revision', () => {
  const absent = batteryTemplate();
  const absentPricing = priceOfferWorkspaceConfiguration([absent], 'MIXED', 'B2B');
  const snapshot = (template: ReturnType<typeof batteryTemplate>, pricing = absentPricing) => createOfferWorkspacePricingSnapshot(
    { selectedTemplateIds: ['battery-1'], saleVatMode: 'MIXED' }, 'B2B', pricing, [template],
  );
  const absentRevision = snapshot(absent).revision;

  const nullPrice = batteryTemplate();
  (nullPrice.items[0] as Record<string, any>).unitSaleNet = null;
  assert.equal(snapshot(nullPrice).revision, absentRevision);

  const zeroPrice = batteryTemplate();
  (zeroPrice.items[0] as Record<string, any>).unitSaleNet = 0;
  const zeroPricing = priceOfferWorkspaceConfiguration([zeroPrice], 'MIXED', 'B2B');
  assert.equal(zeroPricing.lines[0].calculation?.saleNet, 0);
  assert.notEqual(snapshot(zeroPrice, zeroPricing).revision, absentRevision);
});

test('missing effective price components remain null and block valuation after a manual override', () => {
  const source = batteryTemplate();
  source.items[0].product!.prices = [{ purchaseNet: 5000, currentPurchaseNet: 0, purchaseVatRate: 0.23, operatingCostNet: null as unknown as number,
    marginRate: 0.2, saleVatRate: 0.23 }];
  assert.equal(configurationItemEditablePricing(source.items[0]).unitPurchaseNet, null);
  assert.equal(configurationItemEditablePricing(source.items[0]).operatingCostNet, null);
  const effective = applyOfferWorkspaceConfigurationEdits([source], editDraft([{ templateId: 'battery-1', items: [
    { itemId: 'main-battery', pricing: { marginRate: 0.3 } },
  ] }]));
  assert.equal(effective[0].items[0].unitPurchaseNet, null);
  const pricing = priceOfferWorkspaceConfiguration(effective, 'MIXED', 'B2C');
  assert.equal(pricing.systemCostBeforeFinancing, null);
  assert.ok(pricing.missingRequiredData.some(reason => reason.includes('cena pozycji ręcznej')));
});

test('energy quantities require a matching explicit technical confirmation', () => {
  const source = batteryTemplate();
  const afterQuantityEdit = { ...source, items: source.items.map(item => item.id === 'main-battery' ? { ...item, quantity: 2 } : item) };
  const fingerprint = configurationEnergyQuantityFingerprint(afterQuantityEdit);
  const draft = editDraft([{ templateId: 'battery-1', items: [{ itemId: 'main-battery', quantity: 2 }],
    technical: { powerKw: 10, capacityKwh: 20, quantityFingerprint: fingerprint } }]);
  assert.doesNotThrow(() => validateOfferWorkspaceConfigurationEdits([source], draft));
  assert.deepEqual(applyOfferWorkspaceConfigurationEdits([source], draft)[0].capacityKwh, 20);
  assert.throws(() => validateOfferWorkspaceConfigurationEdits([source], editDraft([{ templateId: 'battery-1', items: [{ itemId: 'main-battery', quantity: 2 }] }])), /wymaga ponownego potwierdzenia/);
  assert.throws(() => validateOfferWorkspaceConfigurationEdits([source], editDraft([{ templateId: 'battery-1', items: [{ itemId: 'main-battery', quantity: 2 }],
    technical: { powerKw: 10, capacityKwh: 20, quantityFingerprint: fingerprint.replace(/[a-f0-9]{16}$/, '0'.repeat(16)) } }])), /Potwierdź ponownie/);
});

test('removing a core row remains visible as a tombstone, removes its price, and blocks full calculation', () => {
  const source = batteryTemplate();
  const draft = editDraft([{ templateId: 'battery-1', items: [{ itemId: 'main-battery', removed: true }] }]);
  const effective = applyOfferWorkspaceConfigurationEdits([source], draft);
  assert.equal((effective[0].items[0] as Record<string, any>).workspaceRemoved, true);
  assert.equal(hasRemovedCriticalConfigurationItem([source], draft), true);
  const pricing = priceOfferWorkspaceConfiguration(effective, 'MIXED', 'B2C');
  assert.equal(pricing.lines.find(line => line.itemId === 'main-battery')?.workspaceRemoved, true);
  assert.equal(pricing.lines.find(line => line.itemId === 'main-battery')?.includedInSale, false);
  assert.ok(pricing.systemCostBeforeFinancing! < 1000);
});

test('new rows are limited to additional roles and explicit pricing; core product identity fields are rejected', () => {
  const added = { templateId: 'battery-1', addedItems: [{ id: 'onsite', description: 'Dodatkowy montaż', quantity: 1,
    role: 'LABOR', supplyMode: 'SERVICE_ONLY', pricing: { unitPurchaseNet: 0, purchaseVatRate: 0, operatingCostNet: 100,
      operatingCostBasis: 'PER_LINE', marginRate: 0.1, saleVatRate: 0.23 } }] };
  const parsed = parseOfferWorkspaceConfigurationEdits([added]);
  assert.equal((applyOfferWorkspaceConfigurationEdits([batteryTemplate()], editDraft(parsed))[0].items.at(-1) as Record<string, any>)?.workspaceAdded, true);
  assert.throws(() => parseOfferWorkspaceConfigurationEdits([{ ...added, addedItems: [{ ...added.addedItems[0], role: 'MAIN_EQUIPMENT' }] }]), /nie można dodać głównego urządzenia/);
  assert.throws(() => parseOfferWorkspaceConfigurationEdits([{ templateId: 'battery-1', items: [{ itemId: 'main-battery', productId: 'different-maker' }] }]), /Niedozwolone pole/);
});

test('new manual sale rows accept unit price and explicit costs without requiring a markup field', () => {
  const edits = parseOfferWorkspaceConfigurationEdits([{ templateId: 'battery-1', addedItems: [{ id: 'new-row', description: 'Nowa usługa', quantity: 2,
    role: 'LABOR', supplyMode: 'SERVICE_ONLY', pricing: { unitSaleNet: 321.12345, unitPurchaseNet: 100,
      purchaseVatRate: 0.23, operatingCostNet: 20, operatingCostBasis: 'PER_UNIT', saleVatRate: 0.08 } }] }]);
  const added = applyOfferWorkspaceConfigurationEdits([batteryTemplate()], editDraft(edits))[0].items.at(-1) as Record<string, any>;
  assert.equal(added.unitSaleNet, 321.12345);
  assert.equal(added.unitPurchaseNet, 100);
  assert.equal(added.operatingCostNet, 20);
  assert.equal(added.marginRate, null);
  assert.equal(added.saleVatRate, 0.08);
  assert.throws(() => parseOfferWorkspaceConfigurationEdits([{ templateId: 'battery-1', addedItems: [{ id: 'invalid', description: 'Nowa', quantity: 1,
    role: 'LABOR', supplyMode: 'SERVICE_ONLY', pricing: { unitPurchaseNet: 100, purchaseVatRate: 0.23, operatingCostNet: 20,
      operatingCostBasis: 'PER_UNIT' } }] }]), /cena sprzedaży jednostkowa albo starszy narzut/);
});

test('edits for unknown or unselected templates and duplicate rows are rejected', () => {
  const source = batteryTemplate();
  assert.throws(() => applyOfferWorkspaceConfigurationEdits([source], { ...editDraft([]), configurationEdits: [{ templateId: 'other' }] }), /niewybranego zestawu/);
  assert.throws(() => validateOfferWorkspaceConfigurationEdits([source], editDraft([{ templateId: 'battery-1', items: [
    { itemId: 'main-battery', quantity: 2 }, { itemId: 'main-battery', removed: true },
  ] }])), /wystąpić tylko raz/);
});
