import { Prisma, PrismaClient } from '@prisma/client';
import { calculateConfigurationLine } from '../src/lib/onrevolt/calculator';
import { configurationEditBlockReason } from '../src/lib/onrevolt/configuration-lifecycle';
import { groupTemplateVariants, resolveTemplateItemCosts } from '../src/lib/onrevolt/configuration-templates';

const prisma = new PrismaClient();
const rollbackSentinel = 'ROLLBACK_CONFIGURATION_WORKFLOW_OK';

function numericCosts(costs: ReturnType<typeof resolveTemplateItemCosts>) {
  return {
    unitPurchaseNet: Number(costs.unitPurchaseNet),
    purchaseVatRate: Number(costs.purchaseVatRate),
    operatingCostNet: Number(costs.operatingCostNet),
    marginRate: Number(costs.marginRate),
  };
}

async function verify() {
  try {
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { prices: { some: {} } },
        include: { prices: { orderBy: { validFrom: 'desc' }, take: 1 } },
      });
      if (!product?.prices[0]) throw new Error('Brak produktu z aktualną ceną do testu');

      const familyKey = `integration-${Date.now()}`;
      const commonTemplateData = {
        familyKey,
        name: 'Test integracyjny konfiguracji',
        version: 1,
        isActive: true,
        kind: 'MAGAZYN' as const,
        sourceSheet: 'integration-test',
        items: {
          create: [{
            productId: product.id,
            position: 1,
            description: product.name,
            quantity: 2,
            role: 'MAIN_EQUIPMENT' as const,
            supplyMode: 'ONREVOLT_SUPPLIED' as const,
            unitPurchaseNet: 1,
            purchaseVatRate: 0.23,
            operatingCostNet: 125,
            marginRate: 0.3,
          }],
        },
      };
      const b2cTemplate = await tx.configurationTemplate.create({
        data: { ...commonTemplateData, clientType: 'B2C', sourceRange: `${familyKey}-b2c` },
        include: { items: { include: { product: { include: { prices: { orderBy: { validFrom: 'desc' }, take: 1 } } } } } },
      });
      const b2bTemplate = await tx.configurationTemplate.create({
        data: { ...commonTemplateData, clientType: 'B2B', sourceRange: `${familyKey}-b2b` },
      });
      if (groupTemplateVariants([b2cTemplate, b2bTemplate]).length !== 1) {
        throw new Error('Warianty B2C/B2B nie utworzyły jednej rodziny');
      }

      const client = await tx.client.create({ data: { displayName: 'Test integracyjny', clientType: 'B2C' } });
      const project = await tx.project.create({ data: { clientId: client.id, title: 'Projekt integracyjny', clientType: 'B2C' } });
      const costs = numericCosts(resolveTemplateItemCosts(b2cTemplate.items[0]));
      const currentPrice = Number(product.prices[0].currentPurchaseNet ?? product.prices[0].purchaseNet);
      if (costs.unitPurchaseNet !== currentPrice) throw new Error('Konfiguracja nie pobrała aktualnej ceny katalogowej');
      const line = calculateConfigurationLine({ quantity: 2, ...costs, saleVatRate: 0.08 });

      const configuration = await tx.configuration.create({
        data: {
          projectId: project.id,
          templateId: b2cTemplate.id,
          sourceTemplateVersion: b2cTemplate.version,
          name: 'Konfiguracja klienta',
          kind: b2cTemplate.kind,
          status: 'DRAFT',
          clientType: 'B2C',
          saleVatMode: 'REDUCED_8',
          defaultSaleVatRate: 0.08,
          vatBasis: 'RESIDENTIAL_INSTALLATION',
          totalPurchaseNet: line.purchaseNet,
          totalSaleGross: line.saleGross,
          totalProfitNet: line.profitNet,
          items: {
            create: [{
              productId: product.id,
              position: 1,
              description: product.name,
              quantity: 2,
              role: 'MAIN_EQUIPMENT',
              supplyMode: 'ONREVOLT_SUPPLIED',
              ...costs,
              saleVatRate: 0.08,
              saleNet: line.saleNet,
              saleGross: line.saleGross,
              profitNet: line.profitNet,
              vatSurplus: line.vatSurplus,
            }],
          },
        },
        include: { items: true },
      });

      const edited = await tx.configuration.update({
        where: { id: configuration.id },
        data: { name: 'Konfiguracja klienta po zmianie' },
      });
      if (edited.name !== 'Konfiguracja klienta po zmianie') throw new Error('Nie udała się edycja szkicu');

      const snapshot = configuration.items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        saleGross: Number(item.saleGross),
      }));
      await tx.offer.create({
        data: {
          projectId: project.id,
          configurationId: configuration.id,
          number: `TEST-${Date.now()}`,
          title: 'Oferta integracyjna',
          status: 'DRAFT',
          totalNet: line.saleNet,
          totalGross: line.saleGross,
          totalAfterSupportGross: line.saleGross,
          lineItemsSnapshot: snapshot as Prisma.InputJsonValue,
        },
      });
      await tx.configuration.update({ where: { id: configuration.id }, data: { status: 'OFFERED' } });

      const locked = await tx.configuration.findUniqueOrThrow({
        where: { id: configuration.id },
        include: {
          items: true,
          _count: { select: { offers: true, installations: true, stockReservations: true } },
        },
      });
      const blockReason = configurationEditBlockReason({ status: locked.status, ...locked._count });
      if (!blockReason) throw new Error('Konfiguracja z ofertą nie została zablokowana');

      const variant = await tx.configuration.create({
        data: {
          projectId: project.id,
          templateId: locked.templateId || undefined,
          sourceTemplateVersion: locked.sourceTemplateVersion,
          name: `${locked.name} - wariant`,
          kind: locked.kind,
          status: 'DRAFT',
          clientType: locked.clientType,
          saleVatMode: locked.saleVatMode,
          defaultSaleVatRate: locked.defaultSaleVatRate,
          vatBasis: locked.vatBasis,
          totalPurchaseNet: locked.totalPurchaseNet,
          totalSaleGross: locked.totalSaleGross,
          totalProfitNet: locked.totalProfitNet,
          items: {
            create: locked.items.map((item) => ({
              productId: item.productId || undefined,
              position: item.position,
              description: item.description,
              quantity: item.quantity,
              role: item.role,
              supplyMode: item.supplyMode,
              unitPurchaseNet: item.unitPurchaseNet,
              purchaseVatRate: item.purchaseVatRate,
              operatingCostNet: item.operatingCostNet,
              marginRate: item.marginRate,
              saleVatRate: item.saleVatRate,
              saleNet: item.saleNet,
              saleGross: item.saleGross,
              profitNet: item.profitNet,
              vatSurplus: item.vatSurplus,
            })),
          },
        },
        include: { items: true },
      });
      if (variant.status !== 'DRAFT' || variant.items.length !== locked.items.length) {
        throw new Error('Nowy wariant nie zachował pozycji konfiguracji źródłowej');
      }

      console.log(JSON.stringify({
        familyVariants: 2,
        templateVersion: b2cTemplate.version,
        currentPrice,
        locked: true,
        variantItems: variant.items.length,
      }));
      throw new Error(rollbackSentinel);
    }, { timeout: 20_000 });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== rollbackSentinel) throw error;
    console.log('INTEGRATION_OK_ROLLED_BACK');
  } finally {
    await prisma.$disconnect();
  }
}

verify();
