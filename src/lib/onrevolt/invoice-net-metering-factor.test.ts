import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveInvoiceNetMeteringFactor,
  type InvoiceNetMeteringFactorDocument,
} from './invoice-net-metering-factor';

function invoice(overrides: Partial<InvoiceNetMeteringFactorDocument> & {
  factor?: unknown;
  ppe?: string | null;
  confirmed?: boolean;
  periodFrom?: string;
  periodTo?: string;
} = {}): InvoiceNetMeteringFactorDocument {
  const { factor = 0.8, ppe = 'ppe-1', confirmed = true, periodFrom = '2025-04-01', periodTo = '2026-03-31', ...document } = overrides;
  return {
    id: 'invoice-1', clientId: 'client-1', projectId: 'project-1', type: 'FAKTURA_PRAD',
    invoicePpeNumber: ppe,
    billingPeriodFrom: periodFrom,
    billingPeriodTo: periodTo,
    invoiceRecognition: {
      schemaVersion: 1,
      provider: 'ENEA',
      parser: { id: 'enea.invoice', version: '1.2.0' },
      confidence: 0.99,
      fields: {
        ppeNumber: ppe,
        periodFrom,
        periodTo,
        consumption: { netMeteringFactor: factor },
      },
      ...(confirmed ? { confirmation: { confirmedAt: '2026-11-11T08:00:00.000Z', confirmedById: 'staff-1' } } : {}),
    },
    ...document,
  };
}

const scope = {
  projectId: 'project-1', clientId: 'client-1', ppeNumber: 'ppe-1',
  period: { startMonth: '2025-04', endDate: '2026-03-31' },
};

test('same confirmed factor across overlapping annual invoices applies once', () => {
  const result = resolveInvoiceNetMeteringFactor({ ...scope, documents: [
    invoice(), invoice({ id: 'invoice-2', periodFrom: '2025-05-01', periodTo: '2026-04-30' }),
  ] });

  assert.deepEqual(result, {
    status: 'selected', factor: 0.8, sourceRevision: result.sourceRevision,
    invoicePeriods: ['2025-04-01–2026-03-31', '2025-05-01–2026-04-30'],
  });
  assert.match(result.sourceRevision, /^[a-f0-9]{64}$/);
});

test('different confirmed factors in the applicable period are explicit ambiguity', () => {
  const result = resolveInvoiceNetMeteringFactor({ ...scope, documents: [
    invoice(), invoice({ id: 'invoice-2', factor: 0.7 }),
  ] });

  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(result.status === 'ambiguous' ? result.factors : [], [0.7, 0.8]);
});

test('invoice factor requires matching project, client, PPE, ENEA provider, and an intersecting stored period', () => {
  const result = resolveInvoiceNetMeteringFactor({ ...scope, documents: [
    invoice({ id: 'other-project', projectId: 'project-2' }),
    invoice({ id: 'other-client', clientId: 'client-2' }),
    invoice({ id: 'other-ppe', ppe: 'ppe-2' }),
    invoice({ id: 'outside-period', periodFrom: '2024-01-01', periodTo: '2024-12-31' }),
    invoice({ id: 'non-enea', invoiceRecognition: { provider: 'OTHER' } }),
  ] });

  assert.equal(result.status, 'missing');
  assert.deepEqual(result.invoicePeriods, []);
});

test('unconfirmed invoice recognition does not supply a factor', () => {
  const result = resolveInvoiceNetMeteringFactor({ ...scope, documents: [invoice({ confirmed: false })] });
  assert.equal(result.status, 'missing');
});

test('unsupported confirmed factor blocks instead of falling back to PV power', () => {
  const result = resolveInvoiceNetMeteringFactor({ ...scope, documents: [invoice({ factor: 0.75 })] });
  assert.equal(result.status, 'invalid');
});

test('disagreement between confirmed document and recognition PPE or dates is invalid', () => {
  const badPpe = invoice({ ppe: 'ppe-1' });
  (badPpe.invoiceRecognition as any).fields.ppeNumber = 'ppe-other';
  const badDate = invoice({ id: 'bad-date' });
  (badDate.invoiceRecognition as any).fields.periodTo = '2026-02-28';
  const result = resolveInvoiceNetMeteringFactor({ ...scope, documents: [badPpe, badDate] });
  assert.equal(result.status, 'invalid');
});

test('factor source revision changes when confirmed invoice evidence changes', () => {
  const baseline = resolveInvoiceNetMeteringFactor({ ...scope, documents: [invoice()] });
  const changed = resolveInvoiceNetMeteringFactor({ ...scope, documents: [invoice({ factor: 0.7 })] });
  assert.notEqual(changed.sourceRevision, baseline.sourceRevision);
});
