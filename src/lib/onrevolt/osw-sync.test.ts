import test from 'node:test';
import assert from 'node:assert/strict';
import { __oswSyncTestUtils, normalizeOswAvailability } from './osw-sync';

const {
  buildPriceData,
  extractOswLoginForm,
  findLocalProducts,
  findPotentialLegacyDuplicateProducts,
  findPotentialDuplicateProducts,
  mapOswMallProduct,
  mapOswApiProduct,
  moneyAmount,
  normalizedOswIdentity,
  oswDefaults,
  oswProductIdFromUrl,
  parseOswProductPage,
  splitSetCookieHeader,
} = __oswSyncTestUtils;

test('stosuje stałe zasady cenowe dla nowych produktów OSW', () => {
  assert.deepEqual(oswDefaults(), {
    purchaseVatRate: 0.23,
    operatingCostNet: 0,
    marginRate: 0.3,
    saleVatRate: 0.23,
  });
});

test('wymusza VAT 23% dla istniejącego produktu i zachowuje jego indywidualną marżę', () => {
  const price = buildPriceData({
    id: 'local-1',
    prices: [{
      purchaseVatRate: 0.08,
      operatingCostNet: 12,
      marginRate: 0.25,
      saleVatRate: 0.08,
      currency: 'PLN',
    }],
  }, {
    supplierSku: 'OSW-1',
    priceNet: 1000.129,
    availabilityRaw: 'InStock',
  }, oswDefaults());

  assert.deepEqual(price, {
    productId: 'local-1',
    purchaseNet: 1000.13,
    currentPurchaseNet: 1000.13,
    purchaseVatRate: 0.23,
    operatingCostNet: 12,
    marginRate: 0.25,
    saleVatRate: 0.23,
    currency: 'PLN',
  });
});

test('normalizuje ceny OSW do dokładności pola pieniężnego w bazie', () => {
  assert.equal(moneyAmount(123.456), 123.46);
  assert.equal(moneyAmount(123.454), 123.45);
});

test('dzieli wiele nagłówków Set-Cookie bez psucia daty Expires', () => {
  const cookies = splitSetCookieHeader(
    'PHPSESSID=abc; Path=/; HttpOnly, form_key=xyz; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Path=/',
  );

  assert.deepEqual(cookies, [
    'PHPSESSID=abc; Path=/; HttpOnly',
    'form_key=xyz; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Path=/',
  ]);
});

test('wykrywa formularz logowania OSW z ukrytym tokenem', () => {
  const form = extractOswLoginForm(`
    <form method="post" action="/customer/account/loginPost/">
      <input type="hidden" name="form_key" value="abc123">
      <input type="email" name="login[username]" value="">
      <input type="password" name="login[password]">
      <button type="submit">Sign in</button>
    </form>
  `, 'https://shop.osw.energy/customer/account/login/');

  assert.equal(form?.action, 'https://shop.osw.energy/customer/account/loginPost/');
  assert.equal(form?.method, 'POST');
  assert.equal(form?.emailField, 'login[username]');
  assert.equal(form?.passwordField, 'login[password]');
  assert.equal(form?.fields.form_key, 'abc123');
});

test('parsuje dostępność i cenę ze strony produktu OSW', () => {
  const parsed = parseOswProductPage(`
    <html>
      <head>
        <script type="application/ld+json">
          {"@type":"Product","offers":{"@type":"Offer","price":"1,234.56","priceCurrency":"PLN","availability":"https://schema.org/InStock"}}
        </script>
      </head>
      <body>
        <div class="stock">Limited Stock</div>
      </body>
    </html>
  `);

  assert.equal(parsed.availabilityRaw, 'InStock');
  assert.equal(parsed.priceNet, 1234.56);
  assert.equal(parsed.currency, 'PLN');
  assert.deepEqual(normalizeOswAvailability('Limited Stock'), { label: 'Dostępny', available: true });
  assert.deepEqual(normalizeOswAvailability('On Request'), { label: 'Niedostępny', available: false });
});

test('wyciąga ID produktu z URL-a OSW', () => {
  assert.equal(
    oswProductIdFromUrl('https://osw.energy/pl/products/Dyness_BF100_Battery_Cabinet_100kWh-6896'),
    '6896',
  );
});

test('mapuje produkt z API OSW na lokalny payload synchronizacji', () => {
  const mapped = mapOswApiProduct(
    {
      id: 'local-1',
      sku: 'ODS-Produkty-4',
      supplierSku: null,
      name: 'Dyness BF100 Battery Cabinet 100kWh',
    },
    'https://osw.energy/pl/products/Dyness_BF100_Battery_Cabinet_100kWh-6896',
    {
      item_id: 'ES-Dyness-BF100-C100-EU',
      display_name: 'Dyness BF100 Battery Cabinet 100kWh',
      real_price: '12345.67',
      currency: 'PLN',
      districts: [
        { id: 11, stock: 0, stock_status: 'On  Request', is_default: true },
      ],
    },
    {
      baseUrl: 'https://osw.energy',
      jar: { header: () => '', hasCookies: () => false } as any,
      defaultDistrictId: 11,
      loginAttempted: false,
    },
  );

  assert.deepEqual(mapped, {
    localProductId: 'local-1',
    supplierSku: 'ES-Dyness-BF100-C100-EU',
    name: 'Dyness BF100 Battery Cabinet 100kWh',
    supplierUrl: 'https://osw.energy/pl/products/Dyness_BF100_Battery_Cabinet_100kWh-6896',
    availabilityRaw: 'On  Request',
    priceNet: 12345.67,
    currency: 'PLN',
  });
});

test('mapuje produkt z nowego OSW Mall wraz ze zdjęciem i datasheet', () => {
  const mapped = mapOswMallProduct({
    mallProductId: '1751',
    itemCode: 'KST-G125KT7',
    marketName: 'Kstar 125kW String Inverter 8 MPPT IP66',
    status: 1,
    images: ['https://assets.solarbrain.com.au/product.jpg'],
    thumbnailUrl: 'https://assets.solarbrain.com.au/product-small.jpg',
    brands: [{ name: 'Kstar' }],
    priceView: { currency: 'PLN', finalPrice: 9878 },
    documentDownloads: [{
      code: 'Datasheet',
      name: 'Datasheet',
      value: [{ name: 'Datasheet_G125KT7_EN_V1.0.pdf', url: 'https://assets.solarbrain.com.au/product.pdf' }],
    }],
  }, 'FALOWNIK');

  assert.deepEqual(mapped, {
    oswProductId: '1751',
    supplierSku: 'KST-G125KT7',
    name: 'Kstar 125kW String Inverter 8 MPPT IP66',
    priceNet: 9878,
    availabilityRaw: 'InStock',
    supplierUrl: 'https://shop.osw.energy/pl/mall/products/1751',
    currency: 'PLN',
    category: 'FALOWNIK',
    producer: 'Kstar',
    imageUrl: 'https://assets.solarbrain.com.au/product.jpg',
    datasheetUrl: 'https://assets.solarbrain.com.au/product.pdf',
    datasheetName: 'Datasheet_G125KT7_EN_V1.0.pdf',
  });
});

test('dopasowuje istniejący produkt po SKU niezależnie od separatorów i wielkości liter', () => {
  const localProducts = [{
    id: 'local-1',
    sku: 'sol-s6-eh3p10k-h-eu',
    supplierSku: null,
    supplierUrl: null,
    name: 'Solis S6 10 kW',
  }] as any;

  const matches = findLocalProducts({
    supplierSku: 'SOL_S6_EH3P10K_H_EU',
    availabilityRaw: 'InStock',
  }, localProducts);

  assert.equal(normalizedOswIdentity('SOL_S6-EH3P10K H EU'), 'sols6eh3p10kheu');
  assert.deepEqual(matches.map((product: { id: string }) => product.id), ['local-1']);
});

test('nie wybiera automatycznie produktu, gdy kilka pozycji ma ten sam supplierSku', () => {
  const localProducts = [
    { id: 'local-1', sku: null, supplierSku: 'DUP-1', supplierUrl: null, name: 'Pierwszy' },
    { id: 'local-2', sku: null, supplierSku: 'DUP-1', supplierUrl: null, name: 'Drugi' },
  ] as any;

  const matches = findLocalProducts({ supplierSku: 'DUP-1', availabilityRaw: 'InStock' }, localProducts);
  assert.deepEqual(matches.map((product: { id: string }) => product.id), ['local-1', 'local-2']);
});

test('dopasowuje tę samą nazwę mimo przecinka zamiast kropki w pojemności', () => {
  const localProducts = [{
    id: 'local-stack',
    sku: null,
    supplierSku: null,
    supplierUrl: null,
    name: 'Dyness Stack100 Battery Module 5,12kWh',
  }] as any;

  const matches = findLocalProducts({
    supplierSku: 'ES-Dyness-STACK100-5.12kWh-EU',
    name: 'Dyness Stack100 Battery Module 5.12kWh',
    availabilityRaw: 'InStock',
  }, localProducts);
  assert.deepEqual(matches.map((product: { id: string }) => product.id), ['local-stack']);
});

test('zatrzymuje możliwy duplikat modelu zamiast automatycznie tworzyć drugą pozycję', () => {
  const localProducts = [{
    id: 'local-solis',
    sku: 'ODS-Produkty-9',
    supplierSku: null,
    supplierUrl: null,
    name: 'Solis S6-EH3P30K-H 30 kW',
    producer: 'Solis',
    category: 'FALOWNIK',
  }] as any;

  const matches = findPotentialDuplicateProducts({
    supplierSku: 'SOL-S6-EH3P30K-H-EU',
    name: 'Solis S6 30kW 3Ph Hybrid Inverter w/ display',
    producer: 'Solis',
    category: 'FALOWNIK',
    availabilityRaw: 'InStock',
  }, localProducts);
  assert.deepEqual(matches.map((product: { id: string }) => product.id), ['local-solis']);
});

test('nie uznaje innego SKU już powiązanego z OSW za duplikat nowego wariantu', () => {
  const localProducts = [{
    id: 'osw-deye-20kw',
    sku: 'DEYE-SUN-20K-SG05LP3-EU-SM2-EU',
    supplier: 'OSW',
    supplierSku: 'DEYE-SUN-20K-SG05LP3-EU-SM2-EU',
    supplierUrl: 'https://shop.osw.energy/pl/mall/product/20kw',
    name: 'Deye 20kW LV Hybrid Inverter',
    producer: 'Deye',
    category: 'FALOWNIK',
  }, {
    id: 'legacy-deye',
    sku: 'ODS-Produkty-55',
    supplier: null,
    supplierSku: null,
    supplierUrl: null,
    name: 'Deye 12kW LV Hybrid Inverter',
    producer: 'Deye',
    category: 'FALOWNIK',
  }] as any;

  const matches = findPotentialLegacyDuplicateProducts({
    supplierSku: 'DEYE-SUN-12K-SG05LP3-EU-SM2-EU',
    name: 'Deye 12kW LV Hybrid Inverter',
    producer: 'Deye',
    category: 'FALOWNIK',
    availabilityRaw: 'InStock',
  }, localProducts);

  assert.deepEqual(matches.map((product: { id: string }) => product.id), ['legacy-deye']);
});

test('nie myli różnych mocy tego samego producenta bez wspólnego modelu', () => {
  const localProducts = [{
    id: 'local-12kw',
    sku: null,
    supplierSku: null,
    supplierUrl: null,
    name: 'Solis S6 12kW 3Ph Hybrid Inverter',
    producer: 'Solis',
    category: 'FALOWNIK',
  }] as any;

  const matches = findPotentialDuplicateProducts({
    supplierSku: 'SOL-S6-EH3P10K-H-EU',
    name: 'Solis S6 10kW 3Ph Hybrid Inverter',
    producer: 'Solis',
    category: 'FALOWNIK',
    availabilityRaw: 'InStock',
  }, localProducts);
  assert.deepEqual(matches, []);
});
