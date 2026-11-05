import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { planTemplatePricing } from '../src/lib/onrevolt/pricing-migration';
import { productPurchasePriceNeedsReview } from '../src/lib/onrevolt/product-pricing';
import { calculateConfigurationLine } from '../src/lib/onrevolt/calculator';
import { resolveTemplateItemCosts, resolveTemplateItemSaleVat } from '../src/lib/onrevolt/configuration-templates';

const prisma = new PrismaClient();
const applyIndex = process.argv.indexOf('--apply');
const expectedHash = applyIndex < 0 ? null : process.argv[applyIndex + 1];
if (applyIndex >= 0 && !/^[a-f0-9]{64}$/.test(expectedHash || '')) throw new Error('Podaj hash zatwierdzonego planu po --apply');

async function main() {
  return prisma.$transaction(async tx => {
    const products = await tx.product.findMany({ select: { id: true, sku: true, name: true,
      prices: { where: { validFrom: { lte: new Date() } }, orderBy: { validFrom: 'desc' }, take: 1 } }, orderBy: { id: 'asc' } });
    const priceByProduct = new Map(products.map(product => [product.id, product]));
    const items = await tx.configurationTemplateItem.findMany({ orderBy: { id: 'asc' } });
    const changes: Array<{ id: string; templateId: string; before: unknown; data: NonNullable<ReturnType<typeof planTemplatePricing>> }> = [];
    const unresolved: Array<{ id: string; reason: string }> = [];
    for (const item of items) {
      const full = { ...item, product: item.productId ? priceByProduct.get(item.productId) : null };
      try {
        const data = planTemplatePricing(full);
        if (!data) continue;
        const beforeCost = resolveTemplateItemCosts(full);
        const afterCost = resolveTemplateItemCosts({ ...full, ...data });
        const before = calculateConfigurationLine({ ...beforeCost, quantity: Number(item.quantity), saleVatRate: Number(item.saleVatRate ?? 0.23) });
        const after = calculateConfigurationLine({ ...afterCost, quantity: Number(item.quantity), saleVatRate: data.pricingMode === 'CATALOG' ? resolveTemplateItemSaleVat({ ...full, ...data }) : Number(item.saleVatRate ?? 0.23) });
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Plan zmieniałby dotychczasową wycenę');
        changes.push({ id: item.id, templateId: item.templateId, before: item, data });
      } catch (e) { unresolved.push({ id: item.id, reason: e instanceof Error ? e.message : String(e) }); }
    }
    const configs = await tx.configuration.findMany({ where: { status: { in: ['DRAFT', 'READY'] },
      offers: { none: {} }, offerLinks: { none: {} }, installations: { none: {} } },
      include: { items: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } });
    const configChanges = configs.flatMap(config => config.items.filter(item => item.pricingMode === 'LEGACY').map(item => ({
      id: item.id, before: item,
      data: { pricingMode: 'INDIVIDUAL', operatingCostBasis: Number(item.operatingCostNet) === 0 ? 'PER_UNIT' : 'PER_LINE' },
    })));
    const ambiguous = products.filter(product => product.prices[0] && productPurchasePriceNeedsReview(product.prices[0]))
      .map(product => ({ id: product.id, sku: product.sku, name: product.name }));
    const payload = JSON.parse(JSON.stringify({ changes, configChanges, unresolved, ambiguous }));
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    if (expectedHash && expectedHash !== hash) throw new Error('Dane zmieniły się od odczytu planu. Wykonaj ponowny dry-run.');
    if (expectedHash) {
      for (const change of changes) await tx.configurationTemplateItem.update({ where: { id: change.id }, data: change.data });
      for (const change of configChanges) await tx.configurationItem.update({ where: { id: change.id }, data: change.data });
      for (const id of new Set(changes.map(change => change.templateId))) {
        await tx.configurationTemplate.update({ where: { id }, data: { version: { increment: 1 } } });
      }
      await tx.auditLog.create({ data: { entityType: 'PricingMigration', entityId: hash, action: 'MIGRATE',
        before: payload, after: { version: 'explicit-pricing-v1', templateRows: changes.length, configurationRows: configChanges.length } } });
    }
    console.log(JSON.stringify({ mode: expectedHash ? 'applied' : 'dry-run', hash,
      catalogRows: changes.filter(c => c.data.pricingMode === 'CATALOG').length,
      individualRows: changes.filter(c => c.data.pricingMode === 'INDIVIDUAL').length,
      preservedPerLineRows: changes.filter(c => c.data.operatingCostBasis === 'PER_LINE').length,
      configRows: configChanges.length, unresolved, ambiguous }, null, 2));
  }, { isolationLevel: 'Serializable', timeout: 120000 });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
