import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceImportField, invoiceImportKwh } from './consumption';

test('metered import is displayed and corrected without creating hourly balancing data', () => {
  const consumption = { importBasis: 'METERED' as const, meteredImportKwh: 845 };
  assert.equal(invoiceImportKwh(consumption), 845);
  const corrected = { ...consumption, [invoiceImportField(consumption)]: 900 };
  assert.deepEqual(corrected, { importBasis: 'METERED', meteredImportKwh: 900 });
  assert.equal(invoiceImportKwh({ importBasis: 'METERED', meteredImportKwh: 0 }), 0);
});

test('clearing and saving an ordinary invoice retains its basis for the next edit', () => {
  const original = { importBasis: 'METERED' as const, meteredImportKwh: 845 };
  const cleared = JSON.parse(JSON.stringify({ ...original, [invoiceImportField(original)]: undefined }));
  assert.equal(invoiceImportField(cleared), 'meteredImportKwh');
  const corrected = { ...cleared, [invoiceImportField(cleared)]: 900 };
  assert.deepEqual(corrected, { importBasis: 'METERED', meteredImportKwh: 900 });
  assert.equal(invoiceImportField({ importBasis: 'METERED' }), 'meteredImportKwh');
});

test('prosumer input uses hourly balancing and never billed discount or before-balancing values', () => {
  const consumption = { totalAfterBalancingKwh: 4370, totalBeforeBalancingKwh: 4703, billedAfterDiscountKwh: 200 };
  assert.equal(invoiceImportKwh(consumption), 4370);
  assert.equal(invoiceImportField(consumption), 'totalAfterBalancingKwh');
  assert.equal(invoiceImportKwh({}), undefined);
});
