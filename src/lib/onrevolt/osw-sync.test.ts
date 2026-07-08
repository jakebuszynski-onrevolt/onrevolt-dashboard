import test from 'node:test';
import assert from 'node:assert/strict';
import { __oswSyncTestUtils, normalizeOswAvailability } from './osw-sync';

const {
  extractOswLoginForm,
  mapOswApiProduct,
  oswProductIdFromUrl,
  parseOswProductPage,
  splitSetCookieHeader,
} = __oswSyncTestUtils;

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
