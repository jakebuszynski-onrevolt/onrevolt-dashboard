import test from 'node:test';
import assert from 'node:assert/strict';
import { itemFromTemplate, templateItemPricing, applySuggestedTemplatePrice, templateItemPayload } from './TemplateManagerWorkspace';

const row = {
  id: 'item-1', productId: 'battery', quantity: '3', position: 1, description: 'Bateria',
  supplyMode: 'ONREVOLT_SUPPLIED', role: 'MAIN_EQUIPMENT', pricingMode: 'INDIVIDUAL',
  operatingCostBasis: 'PER_LINE', unitPurchaseNet: '100', purchaseVatRate: '0.23',
  operatingCostNet: '30', marginRate: '0.3', saleVatRate: '0.08', sourceRow: null,
  product: { id: 'battery', name: 'Bateria', category: 'MAGAZYN_ENERGII', prices: [{
    id: 'new-price', purchaseNet: 120, purchaseVatRate: 0.23, operatingCostNet: 0, marginRate: 0.3, saleVatRate: 0.23,
  }] },
};

test('otwarcie zachowuje zapisaną cenę, narzut i koszt za pozycję; aktualizacja jest jawna', () => {
  const form = itemFromTemplate(row);
  assert.equal(form.unitPurchaseNet, '100');
  assert.equal(form.operatingCostBasis, 'PER_LINE');
  assert.equal(form.marginRate, '30');
  const before = templateItemPricing(form);
  assert.equal(before.saved?.saleNet, 429);
  assert.equal(before.suggested?.saleNet, 507);
  const updated = applySuggestedTemplatePrice(form);
  assert.equal(updated.unitPurchaseNet, '120');
  assert.equal(updated.operatingCostNet, '30');
  assert.equal(updated.operatingCostBasis, 'PER_LINE');
  assert.equal(updated.saleVatRate, '8');
  assert.equal(updated.id, row.id);
  assert.equal(templateItemPricing(updated).difference, 0);
  const payload = templateItemPayload(updated);
  assert.equal(payload.marginRate, 0.3);
  assert.equal(payload.sourceRow, undefined);
  assert.equal(payload.pricingMode, 'INDIVIDUAL');
});

test('pusty narzut nie staje się zerem przy otwarciu ani zapisie, a zero pozostaje jawne', () => {
  const missing = itemFromTemplate({ ...row, marginRate: null });
  assert.equal(templateItemPricing(missing).saved, null);
  assert.equal(templateItemPayload(missing).marginRate, null);
  assert.equal(applySuggestedTemplatePrice(missing).marginRate, '30');
  const zero = itemFromTemplate({ ...row, marginRate: 0 });
  assert.equal(templateItemPricing(zero).saved?.saleNet, 330);
  assert.equal(templateItemPayload(zero).marginRate, 0);
});

test('jawne przeliczenie katalogu zachowuje jego aktualny VAT przy przejściu na indywidualną cenę', () => {
  const form = itemFromTemplate({ ...row, pricingMode: 'CATALOG' });
  const updated = applySuggestedTemplatePrice(form);
  assert.equal(updated.pricingMode, 'INDIVIDUAL');
  assert.equal(updated.saleVatRate, '23');
  assert.equal(updated.operatingCostBasis, 'PER_UNIT');
  assert.equal(updated.operatingCostNet, '0');
  assert.equal(updated.catalogPriceId, null);
});

test('starszy szablon zachowuje LEGACY i koszt za pozycję przy przeliczeniu', () => {
  const updated = applySuggestedTemplatePrice(itemFromTemplate({ ...row, pricingMode: 'LEGACY' }));
  assert.equal(updated.pricingMode, 'LEGACY');
  assert.equal(updated.operatingCostBasis, 'PER_LINE');
  assert.equal(updated.unitPurchaseNet, '120');
});
