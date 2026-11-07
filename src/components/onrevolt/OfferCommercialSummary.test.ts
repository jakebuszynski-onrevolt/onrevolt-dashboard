import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  offerCommercialDefaultGroup,
  offerCommercialInitialAllocations,
} from './OfferCommercialSummary';
import {
  calculateOfferCommercialPricing,
  type OfferWorkspaceCommercialBreakdown,
} from 'lib/onrevolt/offer-workspace-commercial-pricing';
import {
  priceOfferWorkspaceConfiguration,
  type OfferWorkspacePricingTemplate,
} from 'lib/onrevolt/offer-workspace-pricing';

const componentSource = readFileSync(path.resolve(__dirname, 'OfferCommercialSummary.tsx'), 'utf8');

function storageTemplate(): OfferWorkspacePricingTemplate {
  const item = (
    id: string,
    description: string,
    category: string | null,
    role: string,
    unitPurchaseNet: number,
    marginRate: number,
  ) => ({
    id,
    position: 1,
    description,
    quantity: 1,
    role,
    supplyMode: 'ONREVOLT_SUPPLIED',
    unitPurchaseNet,
    purchaseVatRate: 0.23,
    operatingCostNet: 0,
    marginRate,
    saleVatRate: 0.08,
    isOptional: false,
    requiresReview: false,
    product: category ? { name: description, category } : null,
  });

  return {
    id: 'battery-one',
    name: 'Zestaw magazynu',
    kind: 'MAGAZYN',
    items: [
      item('battery', 'Magazyn energii', 'BATTERY', 'BATTERY', 10000, 0.25),
      item('inverter', 'Falownik', 'FALOWNIK', 'MAIN_EQUIPMENT', 1000, 1),
      item('ems', 'System monitorujący', 'SYSTEM_MONITORUJACY', 'MONITORING', 500, 0.2),
      item('transport', 'Dostawa', null, 'LOGISTICS', 100, 0.1),
    ],
  };
}

test('przygotowanie tworzy cztery pozycje z jawnych kategorii i zachowuje sumę oferty', () => {
  const template = storageTemplate();
  const pricing = priceOfferWorkspaceConfiguration([template], 'REDUCED_8', 'B2C');
  const allocations = offerCommercialInitialAllocations(pricing, [template]);
  const breakdown: OfferWorkspaceCommercialBreakdown = {
    schemaVersion: 1,
    batteryInstallationScopeConfirmed: true,
    allocations,
  };

  assert.deepEqual(allocations.map(({ itemId, group }) => [itemId, group]), [
    ['battery', 'STORAGE_INSTALLATION'],
    ['inverter', 'INVERTER'],
    ['ems', 'EMS'],
    ['transport', 'TRANSPORT'],
  ]);

  const result = calculateOfferCommercialPricing(pricing, [template], breakdown);
  assert.deepEqual(result.rows.map((row) => row.group), [
    'STORAGE_INSTALLATION', 'INVERTER', 'EMS', 'TRANSPORT',
  ]);
  assert.equal(result.totalGross, pricing.totals?.saleGross);
  assert.ok(result.transferredInverterSaleGross > 0);
  assert.equal(result.rows.find((row) => row.group === 'STORAGE_INSTALLATION')?.amountGross,
    result.batteryEligibleGross);
});

test('przypisanie magazynu nie używa nazw ani podobnych nazw kategorii', () => {
  assert.equal(offerCommercialDefaultGroup({ role: 'OTHER' }, { product: { category: 'UNKNOWN' } }), 'STORAGE_INSTALLATION');
  assert.equal(offerCommercialDefaultGroup({ role: 'OTHER' }, { product: { category: 'INVERTER' } }), 'INVERTER');
  assert.equal(offerCommercialDefaultGroup({ role: 'LOGISTICS' }, { product: { category: null } }), 'TRANSPORT');
  assert.match(componentSource, /Pozostałe pozycje dotyczą zakupu i montażu magazynu/u);
  assert.match(componentSource, /Wartość przesunięta z falownika do magazynu energii/u);
  assert.match(componentSource, /Wróć do szczegółowego kosztorysu/u);
});
