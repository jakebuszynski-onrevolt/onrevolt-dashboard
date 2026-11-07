import assert from 'node:assert/strict';
import test from 'node:test';
import { priceOfferWorkspaceConfiguration, type OfferWorkspacePricingTemplate } from './offer-workspace-pricing';
import { calculateOfferWorkspaceFinancing } from './offer-workspace-financing';
import {
  calculateOfferCommercialPricing,
  parseOfferWorkspaceCommercialBreakdown,
  type OfferWorkspaceCommercialBreakdown,
} from './offer-workspace-commercial-pricing';

const saleNets = {
  battery: 45_643.52,
  inverter: 7_407.41,
  ems: 1_851.85,
  transport: 652.78,
};

function selectedTemplate(overrides: Partial<OfferWorkspacePricingTemplate> = {}): OfferWorkspacePricingTemplate {
  return {
    id: 'storage-16',
    name: 'Magazyn 16 kWh',
    kind: 'MAGAZYN',
    items: [
      {
        id: 'battery',
        position: 1,
        description: 'Magazyn energii 16 kWh',
        quantity: 1,
        role: 'BATTERY',
        supplyMode: 'ONREVOLT_SUPPLIED',
        product: { id: 'product-battery', name: 'Magazyn energii', category: 'MAGAZYN_ENERGII', prices: [] },
        pricingMode: 'INDIVIDUAL',
        unitPurchaseNet: 30_000,
        purchaseVatRate: 0.23,
        operatingCostNet: 0,
        marginRate: 0,
        unitSaleNet: saleNets.battery,
        saleVatRate: 0.08,
        isOptional: false,
        requiresReview: false,
      },
      {
        id: 'inverter',
        position: 2,
        description: 'Falownik hybrydowy',
        quantity: 1,
        role: 'INVERTER',
        supplyMode: 'ONREVOLT_SUPPLIED',
        product: { id: 'product-inverter', name: 'Falownik', category: 'FALOWNIK', prices: [] },
        pricingMode: 'INDIVIDUAL',
        unitPurchaseNet: 6_936,
        purchaseVatRate: 0.23,
        operatingCostNet: 0,
        marginRate: 0,
        unitSaleNet: saleNets.inverter,
        saleVatRate: 0.08,
        isOptional: false,
        requiresReview: false,
      },
      {
        id: 'ems',
        position: 3,
        description: 'EMS',
        quantity: 1,
        role: 'MONITORING',
        supplyMode: 'ONREVOLT_SUPPLIED',
        product: { id: 'product-ems', name: 'EMS', category: 'SYSTEM_MONITORUJACY', prices: [] },
        pricingMode: 'INDIVIDUAL',
        unitPurchaseNet: 900,
        purchaseVatRate: 0.23,
        operatingCostNet: 0,
        marginRate: 0,
        unitSaleNet: saleNets.ems,
        saleVatRate: 0.08,
        isOptional: false,
        requiresReview: false,
      },
      {
        id: 'transport',
        position: 4,
        description: 'Transport',
        quantity: 1,
        role: 'LOGISTICS',
        supplyMode: 'SERVICE_ONLY',
        pricingMode: 'INDIVIDUAL',
        unitPurchaseNet: 300,
        purchaseVatRate: 0.23,
        operatingCostNet: 0,
        marginRate: 0,
        unitSaleNet: saleNets.transport,
        saleVatRate: 0.08,
        isOptional: false,
        requiresReview: false,
      },
      {
        id: 'excluded',
        position: 5,
        description: 'Pozycja wyłączona z oferty',
        quantity: 1,
        role: 'OTHER',
        supplyMode: 'NOT_INCLUDED',
        saleVatRate: 0,
        isOptional: true,
        requiresReview: false,
      },
    ],
    ...overrides,
  };
}

function breakdown(overrides: Partial<OfferWorkspaceCommercialBreakdown> = {}): OfferWorkspaceCommercialBreakdown {
  return {
    schemaVersion: 1,
    allocations: [
      { templateId: 'storage-16', itemId: 'battery', group: 'STORAGE_INSTALLATION' },
      { templateId: 'storage-16', itemId: 'inverter', group: 'INVERTER' },
      { templateId: 'storage-16', itemId: 'ems', group: 'EMS' },
      { templateId: 'storage-16', itemId: 'transport', group: 'TRANSPORT' },
    ],
    batteryInstallationScopeConfirmed: true,
    ...overrides,
  };
}

function pricedFixture(template = selectedTemplate()) {
  const templates = [template];
  const pricing = priceOfferWorkspaceConfiguration(templates, 'REDUCED_8', 'B2C');
  assert.equal(pricing.totals?.saleGross, 60_000);
  assert.equal(pricing.totals?.lines[1].purchaseNet, 6_936);
  return { templates, pricing };
}

test('parser accepts the versioned explicit breakdown and rejects unknown fields, duplicate refs, and invalid groups', () => {
  const value = breakdown();
  assert.deepEqual(parseOfferWorkspaceCommercialBreakdown(value), value);
  assert.equal(parseOfferWorkspaceCommercialBreakdown(undefined), null);
  assert.throws(() => parseOfferWorkspaceCommercialBreakdown({ ...value, extra: true }), /nieznane pola/);
  assert.throws(() => parseOfferWorkspaceCommercialBreakdown({
    ...value,
    allocations: [...value.allocations, { ...value.allocations[0] }],
  }), /Powtórzone przypisanie/);
  assert.throws(() => parseOfferWorkspaceCommercialBreakdown({
    ...value,
    allocations: value.allocations.map((item, index) => index === 0 ? { ...item, group: 'PV' } : item),
  }), /nieprawidłową grupę/);
  assert.throws(() => parseOfferWorkspaceCommercialBreakdown({
    ...value,
    allocations: value.allocations.map((item, index) => index === 0 ? { ...item, note: 'extra' } : item),
  }), /nieznane pola/);
});

test('splits the 60000 B2C price into four commercial rows and leaves the detailed price untouched', () => {
  const { templates, pricing } = pricedFixture();
  const before = structuredClone(pricing);
  const result = calculateOfferCommercialPricing(pricing, templates, breakdown());
  const rows = Object.fromEntries(result.rows.map((row) => [row.group, row]));

  assert.equal(result.totalGross, 60_000);
  assert.equal(result.totalNet, pricing.totals?.saleNet);
  assert.equal(rows.INVERTER.amountGross, 7_490.88);
  assert.equal(rows.EMS.amountGross, 2_000);
  assert.equal(rows.TRANSPORT.amountGross, 705);
  assert.equal(rows.STORAGE_INSTALLATION.amountGross, 49_804.12);
  assert.equal(result.batteryEligibleGross, 49_804.12);
  assert.equal(result.transferredInverterSaleGross, 509.12);
  assert.equal(result.rows.reduce((sum, row) => sum + row.amountGross, 0), result.totalGross);
  assert.equal(result.rows.reduce((sum, row) => sum + row.amountNet, 0), result.totalNet);
  assert.equal(rows.STORAGE_INSTALLATION.sourceReferences.some((source) => source.itemId === 'battery'), true);
  assert.equal(pricing.lines.find((line) => line.itemId === 'excluded')?.includedInSale, false);
  assert.equal(result.rows.some((row) => row.sourceReferences.some((source) => source.itemId === 'excluded')), false);
  assert.deepEqual(pricing, before);
});

test('requires every included current line exactly once and rejects missing, excluded, unknown, or misgrouped references', () => {
  const { templates, pricing } = pricedFixture();
  const valid = breakdown();

  assert.throws(() => calculateOfferCommercialPricing(pricing, templates, {
    ...valid,
    allocations: valid.allocations.filter((allocation) => allocation.itemId !== 'transport'),
  }), /Brak przypisania pozycji storage-16\/transport/);
  assert.throws(() => calculateOfferCommercialPricing(pricing, templates, {
    ...valid,
    allocations: [...valid.allocations, { templateId: 'storage-16', itemId: 'excluded', group: 'STORAGE_INSTALLATION' }],
  }), /wyłączona z ceny sprzedaży/);
  assert.throws(() => calculateOfferCommercialPricing(pricing, templates, {
    ...valid,
    allocations: [...valid.allocations, { templateId: 'storage-16', itemId: 'missing', group: 'STORAGE_INSTALLATION' }],
  }), /nieznaną pozycję/);
  assert.throws(() => calculateOfferCommercialPricing(pricing, templates, {
    ...valid,
    allocations: valid.allocations.map((allocation) => allocation.itemId === 'inverter'
      ? { ...allocation, group: 'STORAGE_INSTALLATION' }
      : allocation),
  }), /musi należeć do grupy INVERTER/);
  assert.throws(() => calculateOfferCommercialPricing(pricing, templates, {
    ...valid,
    allocations: valid.allocations.map((allocation) => allocation.itemId === 'battery'
      ? { ...allocation, group: 'INVERTER' }
      : allocation),
  }), /musi należeć do grupy STORAGE_INSTALLATION/);
});

test('requires explicit battery storage, MAGAZYN templates, four groups, and complete prices', () => {
  const { templates, pricing } = pricedFixture();
  const valid = breakdown();

  const noBattery = selectedTemplate({
    items: selectedTemplate().items.map((item) => item.id === 'battery'
      ? { ...item, product: { ...item.product!, category: 'OTHER' } }
      : item),
  });
  const noBatteryFixture = pricedFixture(noBattery);
  assert.throws(() => calculateOfferCommercialPricing(noBatteryFixture.pricing, noBatteryFixture.templates, valid), /musi zawierać produkt magazynu/);

  const wrongTemplate = selectedTemplate({ kind: 'PV_DACH_PLASKI' });
  const wrongTemplateFixture = pricedFixture(wrongTemplate);
  assert.throws(() => calculateOfferCommercialPricing(wrongTemplateFixture.pricing, wrongTemplateFixture.templates, valid), /nie pochodzi z wybranego szablonu MAGAZYN/);
  assert.throws(() => calculateOfferCommercialPricing(pricing, templates, {
    ...valid,
    allocations: valid.allocations.filter((allocation) => allocation.itemId !== 'ems'),
  }), /Brak przypisania pozycji storage-16\/ems/);
  assert.throws(() => calculateOfferCommercialPricing({
    ...pricing,
    missingOptionalData: ['brak aktualnej ceny'],
  }, templates, valid), /brakujące albo nieprawidłowe ceny/);
});

test('requires B2C, an 8% sale VAT basis, and explicit saved allocations', () => {
  const { templates, pricing } = pricedFixture();
  assert.throws(() => calculateOfferCommercialPricing(pricing, templates, null), /wymaga jawnych przypisań/);
  assert.throws(() => calculateOfferCommercialPricing({
    ...pricing,
    clientType: 'B2B',
    saleAmountBasis: 'NET',
  }, templates, breakdown()), /wyłącznie dla klienta B2C/);
  assert.throws(() => calculateOfferCommercialPricing({
    ...pricing,
    lines: pricing.lines.map((line) => line.itemId === 'inverter' ? { ...line, saleVatRate: 0.23 } : line),
  }, templates, breakdown()), /VAT sprzedaży 8%/);
});

test('rounds purchase plus sales VAT to cents before grouping a fractional VAT amount', () => {
  const template = selectedTemplate();
  template.items[1].unitPurchaseNet = 100.01;
  const pricing = priceOfferWorkspaceConfiguration([template], 'REDUCED_8', 'B2C');
  const result = calculateOfferCommercialPricing(pricing, [template], breakdown());
  assert.equal(result.rows.find(row => row.group === 'INVERTER')?.amountGross, 108.01);
  assert.equal(Math.round(result.rows.reduce((sum, row) => sum + row.amountGross, 0) * 100), 6000000);
});

test('the four-row storage basis excludes inverter, EMS and transport without forcing the grant ceiling', () => {
  const { templates, pricing } = pricedFixture();
  const commercial = calculateOfferCommercialPricing(pricing, templates, breakdown());
  const financing = calculateOfferWorkspaceFinancing({ clientType: 'B2C',
    selectedPricingLines: pricing.lines.filter(line => line.includedInSale).map(line => ({
      id: line.itemId, category: templates[0].items.find(item => item.id === line.itemId)?.product?.category ?? null,
      amountGross: line.calculation?.saleGross ?? null,
    })), batteryCapacityKwh: 48.21, pvPowerKwp: 9.9, billingModel: 'net-billing',
    pme2: { applicationDate: '2026-11-06', storageCostExcludingEmsAndInverterGross: commercial.batteryEligibleGross },
  });
  assert.equal(Math.round(financing.pme2.conditionalGross! * 100) / 100, 14941.24);
  assert.equal(financing.awardGuaranteed, false);
});
