import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configurationInvestmentScope,
  groupTemplateVariants,
  resolveTemplateItemCosts,
  selectTemplateVariant,
} from './configuration-templates';

test('rozdziela szablony magazynu energii i instalacji PV po rodzaju technicznym', () => {
  assert.equal(configurationInvestmentScope('MAGAZYN'), 'BATTERY');
  assert.equal(configurationInvestmentScope('PV_DACH_PLASKI'), 'PV');
  assert.equal(configurationInvestmentScope('PV_DACH_SKOSNY'), 'PV');
  assert.equal(configurationInvestmentScope('EMS'), null);
  assert.equal(configurationInvestmentScope('MIXED'), null);
});

test('grupuje warianty B2C i B2B pod jedną rodziną', () => {
  const families = groupTemplateVariants([
    { id: '1', familyKey: 'family-a', name: 'Zestaw 10 kW', clientType: 'B2C' },
    { id: '2', familyKey: 'family-a', name: 'Zestaw 10 kW', clientType: 'B2B' },
  ]);

  assert.equal(families.length, 1);
  assert.equal(families[0].variants.length, 2);
  assert.equal(selectTemplateVariant(families[0], 'B2B')?.id, '2');
});

test('wariant wspólny obsługuje klienta bez wariantu dokładnego', () => {
  const [family] = groupTemplateVariants([
    { id: '1', familyKey: 'family-a', name: 'Zestaw', clientType: 'B2C_B2B' },
  ]);
  assert.equal(selectTemplateVariant(family, 'B2C')?.id, '1');
});

test('pozycja katalogowa używa aktualnej ceny, ale zachowuje koszt i marżę szablonu', () => {
  assert.deepEqual(resolveTemplateItemCosts({
    productId: 'product-1',
    description: 'Falownik',
    operatingCostNet: '200',
    marginRate: '0.3',
    product: { prices: [{ purchaseNet: '1000', currentPurchaseNet: '900', purchaseVatRate: '0.23' }] },
  }), {
    unitPurchaseNet: 900,
    purchaseVatRate: 0.23,
    operatingCostNet: 200,
    marginRate: 0.3,
  });
});

test('brak ceny katalogowej blokuje użycie szablonu', () => {
  assert.throws(
    () => resolveTemplateItemCosts({ productId: 'product-1', description: 'Falownik', product: { prices: [] } }),
    /Brak aktualnej ceny katalogowej: Falownik/,
  );
});
