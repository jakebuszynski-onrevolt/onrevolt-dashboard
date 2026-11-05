import { resolveTemplateItemCosts, type PriceableTemplateItem } from './configuration-templates';

export function planTemplatePricing(item: PriceableTemplateItem & { quantity: unknown }) {
  if (item.pricingMode && item.pricingMode !== 'LEGACY') return null;
  const costs = resolveTemplateItemCosts(item);
  const quantity = Number(item.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Nieprawidłowa ilość');
  const operatingCostBasis = costs.operatingCostNet === 0 ? 'PER_UNIT' : 'PER_LINE';
  const price = item.product?.prices?.[0];
  const inherits = Boolean(item.productId && price && operatingCostBasis === 'PER_UNIT'
    && costs.operatingCostNet === Number(price.operatingCostNet) && costs.marginRate === Number(price.marginRate)
    && item.saleVatRate != null && price.saleVatRate != null
    && Number(item.saleVatRate) === Number(price.saleVatRate));
  return {
    pricingMode: inherits ? 'CATALOG' : 'INDIVIDUAL',
    operatingCostBasis,
    unitPurchaseNet: costs.unitPurchaseNet,
    purchaseVatRate: costs.purchaseVatRate,
    operatingCostNet: costs.operatingCostNet,
    marginRate: costs.marginRate,
    catalogPriceId: inherits ? price?.id ?? null : null,
  };
}
