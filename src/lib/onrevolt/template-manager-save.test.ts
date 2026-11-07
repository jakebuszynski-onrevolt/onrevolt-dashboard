import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as configurationTemplates from './configuration-templates';
import * as templateManagerSave from './template-manager-save';
import * as calculator from './calculator';
import {
  assertTemplateCatalogSnapshot,
  buildTemplateItemWrites,
  CatalogPriceChangedError,
  matchesStoredTemplateCatalogSnapshot,
  normalizeTemplateUnitSaleNet,
  normalizeTemplateSourceRow,
} from './template-manager-save';

const templateRoutePath = path.resolve(__dirname, '../../app/api/configurations/templates/route.ts');
const templateRouteCode = ts.transpileModule(readFileSync(templateRoutePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: templateRoutePath,
}).outputText;

function templateRouteFixture(options: { template?: Record<string, any>; catalogProduct?: Record<string, any> } = {}) {
  const template = options.template ?? {
    id: 'template-1',
    familyKey: 'family-1',
    name: 'Existing template',
    version: 5,
    kind: 'MAGAZYN',
    clientType: 'B2C_B2B',
    sortOrder: 10,
    items: [
      { id: 'item-keep', productId: 'old-product', position: 1 },
      { id: 'item-remove', productId: null, position: 2 },
    ],
    _count: { configs: 0 },
  };
  const calls = {
    transactionCount: 0,
    versionGuardCount: 0,
    familyNameUpdateCount: 0,
    productReadCount: 0,
    createData: null as any,
    updateData: null as any,
  };
  const catalogProduct = options.catalogProduct ?? {
    id: 'product-1',
    name: 'Falownik',
    prices: [{
      id: 'price-1',
      purchaseNet: 100,
      currentPurchaseNet: 100,
      purchaseVatRate: 0.23,
      operatingCostNet: 10,
      marginRate: 0.2,
      saleVatRate: 0.23,
    }],
  };

  const configurationTemplate = {
    findUnique: async () => template,
    findFirst: async () => null,
    create: async ({ data }: { data: any }) => {
      calls.createData = data;
      return { id: 'created-template', ...data, items: data.items.create, _count: { configs: 0 } };
    },
    updateMany: async ({ where, data }: { where: any; data: any }) => {
      if (where.version !== undefined) {
        calls.versionGuardCount += 1;
        if (template.version !== where.version) return { count: 0 };
        template.version += data.version.increment;
        return { count: 1 };
      }
      if (where.familyKey) {
        calls.familyNameUpdateCount += 1;
        return { count: 1 };
      }
      return { count: 0 };
    },
    update: async ({ data }: { data: any }) => {
      calls.updateData = data;
      return { ...template, ...data, version: template.version, _count: { configs: 0 } };
    },
  };
  const transactionClient = { configurationTemplate };
  const prismaMock = {
    configurationTemplate,
    product: { findUnique: async () => { calls.productReadCount += 1; return catalogProduct; } },
    $transaction: async (callback: (tx: typeof transactionClient) => unknown) => {
      calls.transactionCount += 1;
      return callback(transactionClient);
    },
  };
  const modules: Record<string, any> = {
    'node:crypto': { randomUUID: () => 'test-uuid' },
    'next/server': {},
    'lib/onrevolt/audit': { writeAuditLog: async () => undefined },
    'lib/onrevolt/api': {
      badRequest: (error: string) => Response.json({ ok: false, error }, { status: 400 }),
      forbidden: (error: string) => Response.json({ ok: false, error }, { status: 403 }),
      jsonResponse: (body: unknown, init?: ResponseInit) => Response.json(body, init),
      notFound: (error: string) => Response.json({ ok: false, error }, { status: 404 }),
      optionalString: (body: Record<string, unknown>, key: string) => typeof body[key] === 'string' ? body[key] : undefined,
      readJsonObject: async (request: { body: Record<string, unknown> }) => request.body,
      requireString: (body: Record<string, unknown>, key: string) => {
        if (typeof body[key] !== 'string' || !String(body[key]).trim()) throw new Error(`Brak pola ${key}`);
        return body[key];
      },
      serverError: (message: string) => Response.json({ ok: false, error: message }, { status: 500 }),
    },
    'lib/onrevolt/prisma': { prisma: prismaMock },
    'lib/onrevolt/staff-server': {
      authorizeStaffRequest: async () => ({ ok: true, user: { id: 'staff' } }),
      isAdminUser: () => true,
    },
    'lib/onrevolt/configuration-templates': configurationTemplates,
    'lib/onrevolt/template-manager-save': templateManagerSave,
    'lib/onrevolt/calculator': calculator,
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(templateRouteCode, {
    exports,
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected template route import: ${name}`);
      return modules[name];
    },
    Response,
    Date,
    URL,
  });

  return { exports, calls, request: (body: Record<string, unknown>) => ({ body }) };
}

test('template item writes preserve IDs through reorder, update retained rows, delete omissions, and create new rows', () => {
  const rawItems: Array<Record<string, unknown>> = [
    { id: 'item-b', label: 'B' },
    { label: 'new' },
    { id: 'item-a', label: 'A' },
  ];
  const normalizedItems = [
    { description: 'B reordered', position: 1 },
    { description: 'New', position: 2 },
    { description: 'A reordered', position: 3 },
  ];

  const writes = buildTemplateItemWrites(['item-a', 'item-b', 'item-removed'], rawItems, normalizedItems);
  assert.deepEqual(writes, {
    update: [
      { where: { id: 'item-b' }, data: normalizedItems[0] },
      { where: { id: 'item-a' }, data: normalizedItems[2] },
    ],
    create: [normalizedItems[1]],
    deleteMany: { id: { in: ['item-removed'] } },
  });
});

test('template item writes omit deleteMany when all existing items remain', () => {
  const writes = buildTemplateItemWrites(
    ['item-a'],
    [{ id: 'item-a' }],
    [{ description: 'Updated' }],
  );
  assert.deepEqual(writes, {
    update: [{ where: { id: 'item-a' }, data: { description: 'Updated' } }],
    create: [],
  });
});

test('template item writes reject unknown IDs, repeated IDs, and mismatched normalized rows', () => {
  assert.throws(
    () => buildTemplateItemWrites(['item-a'], [{ id: 'other' }], [{}]),
    /nie należy do tego szablonu/,
  );
  assert.throws(
    () => buildTemplateItemWrites(['item-a'], [{ id: 'item-a' }, { id: 'item-a' }], [{}, {}]),
    /Powtórzone ID/,
  );
  assert.throws(
    () => buildTemplateItemWrites(['item-a'], [{ id: 'item-a' }], []),
    /zgodnych danych/,
  );
});

test('catalog snapshot accepts numerically equivalent values and rejects an in-place catalog price change', () => {
  const snapshot = {
    catalogPriceId: 'same-price-id',
    unitPurchaseNet: '100.00',
    purchaseVatRate: '0.2300',
    operatingCostNet: '15.00',
    marginRate: '0.3000',
    saleVatRate: '0.2300',
    operatingCostBasis: 'PER_UNIT',
    description: 'Falownik',
  };
  const resolved = {
    ...snapshot,
    unitPurchaseNet: 100,
    purchaseVatRate: 0.23,
    operatingCostNet: 15,
    marginRate: 0.3,
    saleVatRate: 0.23,
  };

  assert.doesNotThrow(() => assertTemplateCatalogSnapshot(snapshot, resolved));
  assert.doesNotThrow(() => assertTemplateCatalogSnapshot({
    ...snapshot,
    purchaseVatRate: '0.0502',
  }, {
    ...resolved,
    purchaseVatRate: 5.02 / 100,
  }));
  assert.throws(
    () => assertTemplateCatalogSnapshot(snapshot, { ...resolved, unitPurchaseNet: 101 }),
    CatalogPriceChangedError,
  );
  assert.throws(
    () => assertTemplateCatalogSnapshot(snapshot, { ...resolved, catalogPriceId: 'new-price-id' }),
    CatalogPriceChangedError,
  );
  assert.throws(
    () => assertTemplateCatalogSnapshot(snapshot, { ...resolved, operatingCostBasis: 'PER_LINE' }),
    CatalogPriceChangedError,
  );
  assert.doesNotThrow(() => assertTemplateCatalogSnapshot(
    { ...snapshot, marginRate: null },
    { ...resolved, marginRate: null },
    { allowMissingMargin: true },
  ));
});

test('catalog snapshot rejects every missing or non-finite price field without treating it as zero', () => {
  const snapshot = {
    unitPurchaseNet: 0,
    purchaseVatRate: 0,
    operatingCostNet: 0,
    marginRate: 0,
    saleVatRate: 0,
    operatingCostBasis: 'PER_UNIT',
    description: 'Moduł',
  };
  for (const field of [
    'unitPurchaseNet',
    'purchaseVatRate',
    'operatingCostNet',
    'marginRate',
    'saleVatRate',
  ] as const) {
    for (const invalid of [null, undefined, '', Number.NaN, 'NaN']) {
      const invalidSnapshot = { ...snapshot, [field]: invalid };
      assert.throws(
        () => assertTemplateCatalogSnapshot(invalidSnapshot, snapshot),
        CatalogPriceChangedError,
        `${field} should reject ${String(invalid)}`,
      );
    }
  }
});

test('stored catalog snapshot matching requires the same linked metadata and allows only numeric rounding tolerance', () => {
  const stored = {
    productId: 'product-1',
    pricingMode: 'CATALOG',
    catalogPriceId: 'price-1',
    unitPurchaseNet: 100,
    purchaseVatRate: 0.0502,
    operatingCostNet: 10,
    marginRate: 0.3,
    saleVatRate: 0.23,
    operatingCostBasis: 'PER_UNIT',
  };
  assert.equal(matchesStoredTemplateCatalogSnapshot({
    ...stored,
    purchaseVatRate: 5.02 / 100,
  }, stored), true);
  assert.equal(matchesStoredTemplateCatalogSnapshot({ ...stored, productId: null }, stored), false);
  assert.equal(matchesStoredTemplateCatalogSnapshot({ ...stored, catalogPriceId: '' }, stored), false);
  assert.equal(matchesStoredTemplateCatalogSnapshot({ ...stored, operatingCostNet: ' ' }, stored), false);
  assert.equal(matchesStoredTemplateCatalogSnapshot({ ...stored, unitSaleNet: 150 }, { ...stored, unitSaleNet: 100 }), true);
  assert.equal(matchesStoredTemplateCatalogSnapshot({ ...stored, marginRate: null, unitSaleNet: 150 }, {
    ...stored,
    marginRate: null,
    unitSaleNet: 100,
  }), true);
  assert.equal(matchesStoredTemplateCatalogSnapshot({ ...stored, marginRate: null }, { ...stored, marginRate: null }), false);
});

test('manual unit sale normalizes valid decimal inputs and enforces Decimal(18,8) limits', () => {
  assert.equal(normalizeTemplateUnitSaleNet(null), null);
  assert.equal(normalizeTemplateUnitSaleNet(12345.6789), '12345.6789');
  assert.equal(normalizeTemplateUnitSaleNet('9999999999.99999999'), '9999999999.99999999');
  assert.equal(normalizeTemplateUnitSaleNet('1e-8'), '0.00000001');

  for (const invalid of [
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '10000000000',
    '1.123456789',
    '1e-9',
    '',
    'not a number',
  ]) {
    assert.throws(() => normalizeTemplateUnitSaleNet(invalid), /Cena sprzedaży netto/);
  }
});

test('source row normalization preserves null as absent instead of coercing it to zero', () => {
  assert.equal(normalizeTemplateSourceRow(null), undefined);
  assert.equal(normalizeTemplateSourceRow(undefined), undefined);
  assert.equal(normalizeTemplateSourceRow(''), undefined);
  assert.equal(normalizeTemplateSourceRow('12'), 12);
  assert.equal(normalizeTemplateSourceRow(0), 0);
  assert.equal(normalizeTemplateSourceRow('invalid'), undefined);
});

test('POST keeps the legacy current-price ID guard compatible with fixed-VAT catalog items', async () => {
  const fixture = templateRouteFixture();
  const response = await fixture.exports.POST(fixture.request({
    name: 'New template',
    kind: 'MAGAZYN',
    clientType: 'B2C_B2B',
    items: [{
      id: 'copied-item-id',
      description: 'Falownik',
      productId: 'product-1',
      pricingMode: 'CATALOG',
      operatingCostBasis: 'PER_UNIT',
      catalogPriceId: 'price-1',
      _requireCurrentCatalogPrice: true,
      quantity: 1,
      unitPurchaseNet: 100,
      purchaseVatRate: 0.23,
      operatingCostNet: 10,
      marginRate: 0.2,
      saleVatRate: null,
    }],
  }));

  assert.equal(response.status, 201);
  const createdItem = fixture.calls.createData.items.create[0];
  assert.equal(createdItem.saleVatRate, 0.23, 'catalog VAT comes from the resolved current price');
  assert.equal(Object.hasOwn(createdItem, 'id'), false, 'POST creates fresh item identities');
});

test('POST rejects a stale full catalog snapshot even when the catalog price ID is unchanged', async () => {
  const fixture = templateRouteFixture();
  const response = await fixture.exports.POST(fixture.request({
    name: 'New template',
    kind: 'MAGAZYN',
    clientType: 'B2C_B2B',
    items: [{
      description: 'Falownik',
      productId: 'product-1',
      pricingMode: 'CATALOG',
      operatingCostBasis: 'PER_UNIT',
      catalogPriceId: 'price-1',
      _requireCatalogSnapshot: true,
      quantity: 1,
      unitPurchaseNet: 99,
      purchaseVatRate: 0.23,
      operatingCostNet: 10,
      marginRate: 0.2,
      saleVatRate: 0.23,
    }],
  }));

  assert.equal(response.status, 400);
  assert.equal(fixture.calls.createData, null);
  const body = await response.json();
  assert.match(body.error, /zmieniła się/);
});

test('PUT updates retained item IDs, creates new rows, clears omitted fields, and guards the version', async () => {
  const fixture = templateRouteFixture();
  const response = await fixture.exports.PUT(fixture.request({
    id: 'template-1',
    version: 5,
    name: 'Existing template',
    kind: 'MAGAZYN',
    clientType: 'B2C_B2B',
    sortOrder: 10,
    items: [
      {
        id: 'item-keep',
        description: 'Odłączony produkt',
        productId: null,
        pricingMode: 'INDIVIDUAL',
        operatingCostBasis: 'PER_LINE',
        catalogPriceId: null,
        quantity: 1,
        unitPurchaseNet: null,
        purchaseVatRate: null,
        operatingCostNet: null,
        marginRate: null,
        saleVatRate: null,
        sourceRow: null,
      },
      {
        description: 'Nowa pozycja',
        pricingMode: 'INDIVIDUAL',
        operatingCostBasis: 'PER_LINE',
        quantity: 2,
        unitPurchaseNet: 50,
        purchaseVatRate: 0.23,
        operatingCostNet: 5,
        marginRate: 0.3,
        saleVatRate: 0.23,
      },
    ],
  }));

  assert.equal(response.status, 200);
  assert.equal(fixture.calls.versionGuardCount, 1);
  assert.equal(fixture.calls.familyNameUpdateCount, 0, 'unchanged family names are not rewritten');
  const writes = fixture.calls.updateData.items;
  assert.deepEqual(writes.update.map((write: any) => write.where.id), ['item-keep']);
  assert.deepEqual(writes.deleteMany, { id: { in: ['item-remove'] } });
  assert.equal(writes.create.length, 1);
  assert.equal(writes.update[0].data.productId, null);
  assert.equal(writes.update[0].data.catalogPriceId, null);
  assert.equal(writes.update[0].data.unitPurchaseNet, null);
  assert.equal(writes.update[0].data.purchaseVatRate, null);
  assert.equal(writes.update[0].data.operatingCostNet, null);
  assert.equal(writes.update[0].data.marginRate, null);
  assert.equal(writes.update[0].data.saleVatRate, null);
  assert.equal(writes.update[0].data.sourceRow, undefined);
});

test('PUT rejects an out-of-date expected version with 409 before starting a transaction', async () => {
  const fixture = templateRouteFixture();
  const response = await fixture.exports.PUT(fixture.request({
    id: 'template-1',
    expectedVersion: 4,
    name: 'Existing template',
    kind: 'MAGAZYN',
    clientType: 'B2C_B2B',
    items: [{ id: 'item-keep', quantity: 1 }],
  }));

  assert.equal(response.status, 409);
  assert.equal(fixture.calls.transactionCount, 0);
  const body = await response.json();
  assert.match(body.error, /Wróć do listy/);
});

test('PUT preserves an untouched stale catalog snapshot without reading latest catalog price', async () => {
  const storedItem = {
    id: 'catalog-item',
    productId: 'product-1',
    pricingMode: 'CATALOG',
    catalogPriceId: 'price-1',
    unitPurchaseNet: 100,
    purchaseVatRate: 0.23,
    operatingCostNet: 10,
    marginRate: 0.2,
    saleVatRate: 0.23,
    operatingCostBasis: 'PER_UNIT',
    quantity: 1,
    description: 'Falownik',
  };
  const fixture = templateRouteFixture({
    template: {
      id: 'template-1', familyKey: 'family-1', name: 'Existing template', version: 5,
      kind: 'MAGAZYN', clientType: 'B2C_B2B', sortOrder: 10,
      items: [storedItem], _count: { configs: 0 },
    },
    catalogProduct: {
      id: 'product-1',
      name: 'Falownik',
      prices: [{
        id: 'price-1', purchaseNet: 100, currentPurchaseNet: 110, purchaseVatRate: 0.23,
        operatingCostNet: 12, marginRate: 0.3, saleVatRate: 0.23,
      }],
    },
  });

  const response = await fixture.exports.PUT(fixture.request({
    id: 'template-1', version: 5, name: 'Existing template', kind: 'MAGAZYN', clientType: 'B2C_B2B',
    sortOrder: 10,
    items: [{
      ...storedItem,
      _requireCurrentCatalogPrice: true,
      _requireCatalogSnapshot: true,
      quantity: 2,
      description: 'Zmieniony opis i ilość',
    }],
  }));

  assert.equal(response.status, 200);
  assert.equal(fixture.calls.productReadCount, 0);
  const persisted = fixture.calls.updateData.items.update[0].data;
  assert.equal(persisted.quantity, 2);
  assert.equal(persisted.description, 'Zmieniony opis i ilość');
  assert.equal(persisted.unitPurchaseNet, storedItem.unitPurchaseNet);
  assert.equal(persisted.operatingCostNet, storedItem.operatingCostNet);
  assert.equal(persisted.marginRate, storedItem.marginRate);
  assert.equal(persisted.catalogPriceId, storedItem.catalogPriceId);
});

test('PUT preserves omitted manual unit sale price and allows editing it independently from catalog snapshot', async () => {
  const storedItem = {
    id: 'catalog-item',
    productId: 'product-1',
    pricingMode: 'CATALOG',
    catalogPriceId: 'price-1',
    unitPurchaseNet: 100,
    purchaseVatRate: 0.23,
    operatingCostNet: 10,
    marginRate: null,
    saleVatRate: 0.23,
    operatingCostBasis: 'PER_UNIT',
    quantity: 1,
    description: 'Falownik',
    unitSaleNet: '12345.67',
  };
  const fixture = templateRouteFixture({
    template: {
      id: 'template-1', familyKey: 'family-1', name: 'Existing template', version: 5,
      kind: 'MAGAZYN', clientType: 'B2C_B2B', sortOrder: 10,
      items: [storedItem], _count: { configs: 0 },
    },
    catalogProduct: {
      id: 'product-1',
      name: 'Falownik',
      prices: [{ id: 'price-1', purchaseNet: 100, currentPurchaseNet: 100, purchaseVatRate: 0.23, operatingCostNet: 10, marginRate: null, saleVatRate: 0.23 }],
    },
  });

  const response = await fixture.exports.PUT(fixture.request({
    id: 'template-1', version: 5, name: 'Existing template', kind: 'MAGAZYN', clientType: 'B2C_B2B',
    items: [{
      ...storedItem,
      unitSaleNet: '13000.25',
      _requireCurrentCatalogPrice: true,
      _requireCatalogSnapshot: true,
    }],
  }));

  assert.equal(response.status, 200);
  assert.equal(fixture.calls.productReadCount, 0);
  const persisted = fixture.calls.updateData.items.update[0].data;
  assert.equal(persisted.unitSaleNet, '13000.25');
  assert.equal(persisted.unitPurchaseNet, storedItem.unitPurchaseNet);
  assert.equal(persisted.marginRate, null);
});

test('PUT preserves an omitted manual unit sale for older clients and explicit null clears it', async () => {
  const existingItem = {
    id: 'item-keep',
    productId: null,
    pricingMode: 'INDIVIDUAL',
    operatingCostBasis: 'PER_LINE',
    quantity: 1,
    unitPurchaseNet: 100,
    purchaseVatRate: 0.23,
    operatingCostNet: 0,
    marginRate: 0.3,
    saleVatRate: 0.23,
    unitSaleNet: '123.45',
  };
  const template = {
    id: 'template-1', familyKey: 'family-1', name: 'Existing template', version: 5,
    kind: 'MAGAZYN', clientType: 'B2C_B2B', sortOrder: 10,
    items: [existingItem], _count: { configs: 0 },
  };
  const { unitSaleNet: _previousUnitSaleNet, ...olderClientItem } = existingItem;
  const body = {
    id: 'template-1', version: 5, name: 'Existing template', kind: 'MAGAZYN', clientType: 'B2C_B2B',
    items: [olderClientItem],
  };

  const preserveFixture = templateRouteFixture({ template: structuredClone(template) });
  const preserveResponse = await preserveFixture.exports.PUT(preserveFixture.request(body));
  assert.equal(preserveResponse.status, 200);
  assert.equal(preserveFixture.calls.updateData.items.update[0].data.unitSaleNet, '123.45');

  const clearFixture = templateRouteFixture({ template: structuredClone(template) });
  const clearResponse = await clearFixture.exports.PUT(clearFixture.request({
    ...body,
    items: [{ ...existingItem, unitSaleNet: null }],
  }));
  assert.equal(clearResponse.status, 200);
  assert.equal(clearFixture.calls.updateData.items.update[0].data.unitSaleNet, null);
});

test('template save rejects manual unit sale values outside Decimal(18,8)', async () => {
  const fixture = templateRouteFixture();
  const response = await fixture.exports.POST(fixture.request({
    name: 'New template',
    kind: 'MAGAZYN',
    clientType: 'B2C_B2B',
    items: [{
      description: 'Falownik',
      pricingMode: 'INDIVIDUAL',
      quantity: 1,
      unitSaleNet: '1.123456789',
    }],
  }));

  assert.equal(response.status, 400);
  assert.equal(fixture.calls.createData, null);
});

test('template save rejects manual sale totals that exceed Decimal(12,2) at 23% VAT', async () => {
  for (const [unitSaleNet, quantity] of [['5000000000', 2], ['8200000000', 1]]) {
    const fixture = templateRouteFixture();
    const response = await fixture.exports.POST(fixture.request({
      name: 'New template',
      kind: 'MAGAZYN',
      clientType: 'B2C_B2B',
      items: [{ description: 'Falownik', pricingMode: 'INDIVIDUAL', quantity, unitSaleNet }],
    }));

    assert.equal(response.status, 400);
    assert.equal(fixture.calls.createData, null);
    const body = await response.json();
    assert.match(body.error, /Łączna cena pozycji przekracza limit/);
  }
});

test('PUT still rejects an edited stale catalog snapshot', async () => {
  const storedItem = {
    id: 'catalog-item',
    productId: 'product-1',
    pricingMode: 'CATALOG',
    catalogPriceId: 'price-1',
    unitPurchaseNet: 100,
    purchaseVatRate: 0.23,
    operatingCostNet: 10,
    marginRate: 0.2,
    saleVatRate: 0.23,
    operatingCostBasis: 'PER_UNIT',
    quantity: 1,
    description: 'Falownik',
  };
  const fixture = templateRouteFixture({
    template: {
      id: 'template-1', familyKey: 'family-1', name: 'Existing template', version: 5,
      kind: 'MAGAZYN', clientType: 'B2C_B2B', sortOrder: 10,
      items: [storedItem], _count: { configs: 0 },
    },
    catalogProduct: {
      id: 'product-1',
      name: 'Falownik',
      prices: [{
        id: 'price-1', purchaseNet: 100, currentPurchaseNet: 110, purchaseVatRate: 0.23,
        operatingCostNet: 12, marginRate: 0.3, saleVatRate: 0.23,
      }],
    },
  });

  const response = await fixture.exports.PUT(fixture.request({
    id: 'template-1', version: 5, name: 'Existing template', kind: 'MAGAZYN', clientType: 'B2C_B2B',
    sortOrder: 10,
    items: [{
      ...storedItem,
      _requireCurrentCatalogPrice: true,
      _requireCatalogSnapshot: true,
      unitPurchaseNet: 105,
    }],
  }));

  assert.equal(response.status, 400);
  assert.equal(fixture.calls.productReadCount, 1);
  assert.equal(fixture.calls.updateData, null);
});
