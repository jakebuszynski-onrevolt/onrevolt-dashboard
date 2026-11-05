import test from 'node:test';
import assert from 'node:assert/strict';
import { __catalogWorkspaceTestUtils } from 'components/onrevolt/CatalogWorkspace';
import {
  activeProductPriceInclude,
  parseProductPriceInput,
  productPriceChanged,
  productPriceData,
} from './catalog-product-pricing';
import { __oswSyncTestUtils } from './osw-sync';

const {
  buildPricePayload,
  editFormFromProduct,
  formatMoney,
  formPricePreview,
  legacyPurchasePriceWarning,
  productPriceFormChanged,
  shouldSubmitProductPrice,
} = __catalogWorkspaceTestUtils;

function productWithPrice(price: Record<string, unknown>) {
  return {
    id: 'product-1',
    name: 'Produkt testowy',
    category: 'INNE',
    prices: [price],
    media: [],
  } as any;
}

function productWithoutPrice() {
  return {
    id: 'product-no-price',
    name: 'Produkt bez ceny',
    category: 'INNE',
    prices: [],
    media: [],
  } as any;
}

test('pojedyncze pole ceny pokazuje aktualną cenę i wymaga weryfikacji starego konfliktu', () => {
  const form = editFormFromProduct(productWithPrice({
    purchaseNet: 1200,
    currentPurchaseNet: 0,
    purchaseVatRate: 0.23,
    operatingCostNet: 80,
    marginRate: 0.2,
    saleVatRate: 0.08,
    currency: 'PLN',
  }));

  assert.equal(form.purchaseNet, '1200');
  assert.equal('currentPurchaseNet' in form, false);
  assert.match(legacyPurchasePriceWarning(productWithPrice({ purchaseNet: 1200, currentPurchaseNet: 0 }).prices[0]), /wymaga weryfikacji/i);
});

test('brak dawnej stawki VAT sprzedaży nie blokuje zapisu zmian niezwiązanych z ceną', () => {
  const product = productWithPrice({
    purchaseNet: 1200,
    currentPurchaseNet: 1200,
    purchaseVatRate: 0.23,
    operatingCostNet: 80,
    marginRate: 0.2,
    saleVatRate: null,
    currency: 'PLN',
  });
  const form = editFormFromProduct(product);

  assert.equal(form.saleVatRate, '');
  assert.equal(productPriceFormChanged(form, product), false);
});

test('edycja produktu bez historii cen nie wywołuje kontroli ceny dla undefined', () => {
  const product = productWithoutPrice();
  const form = editFormFromProduct(product);

  assert.equal(shouldSubmitProductPrice(form, 'edit', product), false);
});

test('zapytanie o bieżącą cenę pomija rekordy z przyszłym validFrom', () => {
  const asOf = new Date('2026-11-03T12:00:00.000Z');
  assert.deepEqual(activeProductPriceInclude(asOf), {
    where: { validFrom: { lte: asOf } },
    orderBy: { validFrom: 'desc' },
    take: 1,
  });
});

test('zapis katalogowy potwierdza jedną cenę, zachowuje zero i uwzględnia VAT sprzedaży', () => {
  const form = editFormFromProduct(productWithPrice({
    purchaseNet: 1200,
    currentPurchaseNet: 850,
    purchaseVatRate: 0.23,
    operatingCostNet: 80,
    marginRate: 0.2,
    saleVatRate: 0.08,
    currency: 'PLN',
  }));
  assert.equal(form.purchaseNet, '850');

  const payload = buildPricePayload({
    ...form,
    purchaseNet: '0',
    saleVatRate: '8',
  });
  assert.deepEqual(payload, {
    purchaseNet: '0',
    purchaseVatRate: 0.23,
    operatingCostNet: '80',
    marginRate: 0.2,
    saleVatRate: 0.08,
    currency: 'PLN',
  });
  assert.equal('currentPurchaseNet' in payload!, false);

  const parsed = parseProductPriceInput(payload);
  assert.deepEqual(productPriceData(parsed!), {
    purchaseNet: 0,
    currentPurchaseNet: 0,
    purchaseVatRate: 0.23,
    operatingCostNet: 80,
    marginRate: 0.2,
    saleVatRate: 0.08,
    currency: 'PLN',
  });
});

test('API odrzuca puste pola cenowe, zakresy ujemne i VAT poza zakresem', () => {
  const validInput = {
    purchaseNet: 100,
    purchaseVatRate: 0.23,
    operatingCostNet: 0,
    marginRate: 0.3,
    saleVatRate: 0.23,
    currency: 'PLN',
  };

  for (const field of ['purchaseNet', 'purchaseVatRate', 'operatingCostNet', 'marginRate', 'saleVatRate']) {
    for (const empty of [undefined, null, '', '   ']) {
      assert.throws(
        () => parseProductPriceInput({ ...validInput, [field]: empty }),
        /jest wymagane/,
        `${field}=${String(empty)} powinno być wymagane`,
      );
    }
  }

  for (const invalid of [
    { purchaseNet: -0.01 },
    { operatingCostNet: -0.01 },
    { purchaseVatRate: -0.01 },
    { purchaseVatRate: 1.01 },
    { saleVatRate: -0.01 },
    { saleVatRate: 1.01 },
    { marginRate: -0.01 },
  ]) {
    assert.throws(() => parseProductPriceInput({ ...validInput, ...invalid }));
  }

  assert.throws(() => parseProductPriceInput({ ...validInput, currency: 'EURO' }), /trzyliterowym/);
  assert.throws(() => parseProductPriceInput({ ...validInput, currency: '  ' }), /trzyliterowym/);
  assert.equal(parseProductPriceInput({ ...validInput, currency: 'pln', marginRate: 2 })?.currency, 'PLN');
  assert.equal(parseProductPriceInput({ ...validInput, currency: 'pln', marginRate: 2 })?.marginRate, 2);
});

test('rozbieżność w cenie historycznej tworzy nowy wpis nawet przy tej samej cenie bazowej', () => {
  const next = parseProductPriceInput({
    purchaseNet: 1200,
    purchaseVatRate: 0.23,
    operatingCostNet: 80,
    marginRate: 0.2,
    saleVatRate: 0.08,
    currency: 'PLN',
  })!;

  assert.equal(productPriceChanged({
    purchaseNet: 1200,
    currentPurchaseNet: 0,
    purchaseVatRate: 0.23,
    operatingCostNet: 80,
    marginRate: 0.2,
    saleVatRate: 0.08,
    currency: 'PLN',
  }, next), true);
});

test('podgląd jednostkowy korzysta ze wspólnego kalkulatora', () => {
  const result = formPricePreview({
    purchaseNet: '100',
    purchaseVatRate: '23',
    operatingCostNet: '30',
    marginRate: '20',
    saleVatRate: '8',
    currency: 'PLN',
  } as any);

  assert.equal(result.totalCostNet, 130);
  assert.equal(result.saleNet, 156);
  assert.equal(result.saleGross, 168.48);
  assert.equal(formPricePreview({ ...({} as any), purchaseNet: '-', operatingCostNet: '30' }), null);
});

test('pusty formularz i niepoprawna waluta ukrywają podgląd bez błędu formatowania', () => {
  assert.equal(formPricePreview({
    purchaseNet: '',
    purchaseVatRate: '',
    operatingCostNet: '',
    marginRate: '',
    saleVatRate: '',
    currency: 'PLN',
  } as any), null);

  const invalidCurrencyForm = {
    purchaseNet: '100',
    purchaseVatRate: '23',
    operatingCostNet: '30',
    marginRate: '20',
    saleVatRate: '8',
    currency: 'not-a-currency',
  } as any;
  assert.equal(formPricePreview(invalidCurrencyForm), null);
  assert.doesNotThrow(() => formatMoney(123.45, invalidCurrencyForm.currency));
});

test('brak VAT sprzedaży ukrywa brutto zamiast traktować stawkę jako zero', () => {
  const preview = formPricePreview({
    purchaseNet: '100',
    purchaseVatRate: '23',
    operatingCostNet: '30',
    marginRate: '20',
    saleVatRate: '',
    currency: 'PLN',
  } as any);

  assert.equal(preview?.saleNet, 156);
  assert.equal(preview?.saleGross, null);
});

test('synchronizacja OSW zapisuje obie ceny równo i zachowuje koszt jednostkowy oraz narzut', () => {
  const price = __oswSyncTestUtils.buildPriceData({
    id: 'local-1',
    prices: [{ operatingCostNet: 45, marginRate: 0.27, currency: 'PLN' }],
  }, {
    supplierSku: 'OSW-1',
    priceNet: 900.129,
    availabilityRaw: 'InStock',
  }, __oswSyncTestUtils.oswDefaults());

  assert.equal(price?.purchaseNet, 900.13);
  assert.equal(price?.currentPurchaseNet, 900.13);
  assert.equal(price?.operatingCostNet, 45);
  assert.equal(price?.marginRate, 0.27);
});
