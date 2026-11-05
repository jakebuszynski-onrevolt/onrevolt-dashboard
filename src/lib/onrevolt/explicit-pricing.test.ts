import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProductPurchaseNet } from './product-pricing';
import { calculateConfigurationLine } from './calculator';
import { resolveTemplateItemCosts } from './configuration-templates';
import { planTemplatePricing } from './pricing-migration';
import { priceOfferWorkspaceConfiguration } from './offer-workspace-pricing';

const price = { id: 'price-v2', purchaseNet: 100, currentPurchaseNet: 120, purchaseVatRate: 0.23,
  operatingCostNet: 20, marginRate: 0.3, saleVatRate: 0.23 };
const item = { id: 'line', description: 'Usługa', position: 1, productId: 'product', product: { id: 'product', name: 'Usługa', prices: [price] },
  quantity: 2, unitPurchaseNet: 110, purchaseVatRate: 0.23, operatingCostNet: 20, marginRate: 0.3,
  saleVatRate: 0.23, role: 'OTHER', supplyMode: 'ONREVOLT_SUPPLIED', isOptional: false, requiresReview: false };

test('canonical price is effective current, zero conflicts are explicit, confirmed zero remains valid', () => {
  assert.equal(resolveProductPurchaseNet(price), 120);
  assert.equal(resolveProductPurchaseNet({ purchaseNet: 100 }), 100);
  assert.throws(() => resolveProductPurchaseNet({ purchaseNet: 100, currentPurchaseNet: 0 }), /weryfikacji/);
  assert.equal(resolveProductPurchaseNet({ purchaseNet: 0, currentPurchaseNet: 0 }), 0);
});

test('catalog costs inherit purchase, internal cost and markup; explicit custom prices survive catalog changes', () => {
  const inherited = resolveTemplateItemCosts({ ...item, pricingMode: 'CATALOG' });
  assert.equal(inherited.unitPurchaseNet, 120); assert.equal(inherited.operatingCostBasis, 'PER_UNIT');
  assert.equal(inherited.catalogPriceId, 'price-v2');
  const custom = resolveTemplateItemCosts({ ...item, pricingMode: 'INDIVIDUAL', operatingCostBasis: 'PER_UNIT' });
  assert.equal(custom.unitPurchaseNet, 110); assert.equal(custom.operatingCostNet, 20);
  const changed = { ...item, product: { ...item.product, prices: [{ ...price, currentPurchaseNet: 500, operatingCostNet: 30 }] } };
  assert.equal(resolveTemplateItemCosts({ ...changed, pricingMode: 'CATALOG' }).unitPurchaseNet, 500);
  assert.equal(resolveTemplateItemCosts({ ...changed, pricingMode: 'INDIVIDUAL' }).unitPurchaseNet, 110);
});

test('unit costs scale with quantity including fractional quantity; legacy line totals are unchanged', () => {
  const base = { quantity: 2, unitPurchaseNet: 0, operatingCostNet: 420, marginRate: 0.3, purchaseVatRate: 0.23, saleVatRate: 0.23 };
  assert.equal(calculateConfigurationLine({ ...base, operatingCostBasis: 'PER_UNIT' }).saleGross, 1343.16);
  assert.equal(calculateConfigurationLine({ ...base }).saleGross, 671.58);
  assert.equal(calculateConfigurationLine({ ...base, quantity: 0.5, operatingCostBasis: 'PER_UNIT' }).saleNet, 273);
  assert.equal(calculateConfigurationLine({ ...base, quantity: 0, operatingCostBasis: 'PER_UNIT' }).saleGross, 0);
});

test('migration preserves cost and flags per-line semantics instead of multiplying historic costs', () => {
  const plan = planTemplatePricing(item)!;
  assert.equal(plan.pricingMode, 'INDIVIDUAL'); assert.equal(plan.operatingCostBasis, 'PER_LINE');
  assert.equal(plan.unitPurchaseNet, 120);
  const calculate = (value: typeof item) => calculateConfigurationLine({ ...resolveTemplateItemCosts(value), quantity: value.quantity, saleVatRate: value.saleVatRate });
  assert.deepEqual(calculate(item), calculate({ ...item, ...plan }));
  assert.equal(planTemplatePricing({ ...item, quantity: 1 })?.operatingCostBasis, 'PER_LINE');
  assert.equal(planTemplatePricing({ ...item, operatingCostNet: 0, product: { ...item.product, prices: [{ ...price, operatingCostNet: 0 }] } })?.pricingMode, 'CATALOG');
  assert.equal(planTemplatePricing({ ...item, quantity: 1, marginRate: 0.4 })?.pricingMode, 'INDIVIDUAL');
  assert.equal(planTemplatePricing({ ...item, quantity: 1, saleVatRate: 0.08 })?.pricingMode, 'INDIVIDUAL');
  assert.equal(planTemplatePricing({ ...item, operatingCostNet: 0, saleVatRate: null,
    product: { ...item.product, prices: [{ ...price, operatingCostNet: 0, saleVatRate: null }] } })?.pricingMode, 'INDIVIDUAL');
  assert.equal(planTemplatePricing({ ...item, pricingMode: 'CATALOG' }), null);
});

test('catalog preview and offer share exact per-unit pricing for B2C and B2B', () => {
  const costs = resolveTemplateItemCosts({ ...item, pricingMode: 'CATALOG' });
  const expected = calculateConfigurationLine({ ...costs, quantity: 2, saleVatRate: 0.23 });
  const template = { id: 'template', name: 'Zestaw', kind: 'MAGAZYN', items: [{ ...item, pricingMode: 'CATALOG' }] };
  const b2c = priceOfferWorkspaceConfiguration([template], 'STANDARD_23', 'B2C');
  const b2b = priceOfferWorkspaceConfiguration([template], 'STANDARD_23', 'B2B');
  assert.equal(b2c.systemCostBeforeFinancing, expected.saleGross);
  assert.equal(b2b.systemCostBeforeFinancing, expected.saleNet);
  const changedVat = { ...template, items: [{ ...template.items[0], saleVatRate: 0.08 }] };
  assert.equal(priceOfferWorkspaceConfiguration([changedVat], 'MIXED', 'B2C').systemCostBeforeFinancing, expected.saleGross);
  assert.equal(priceOfferWorkspaceConfiguration([changedVat], 'REDUCED_8', 'B2C').totals?.saleVatValue, Math.round(expected.saleNet * 8) / 100);
});
