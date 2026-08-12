import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeSiteAuditFormData,
  resetTypeDependentCompletion,
  siteAuditCompletionErrors,
  siteAuditAudience,
} from './site-audit';

test('site audit visibility distinguishes B2C, B2B and the combined mode', () => {
  assert.deepEqual(siteAuditAudience('B2C'), {
    clientType: 'B2C', hasKnownType: true, showB2C: true, showB2B: false,
  });
  assert.deepEqual(siteAuditAudience('B2B'), {
    clientType: 'B2B', hasKnownType: true, showB2C: false, showB2B: true,
  });
  assert.deepEqual(siteAuditAudience('B2C_B2B'), {
    clientType: 'B2C_B2B', hasKnownType: true, showB2C: true, showB2B: true,
  });
  assert.deepEqual(siteAuditAudience('invalid'), {
    clientType: 'UNKNOWN', hasKnownType: false, showB2C: false, showB2B: false,
  });
});

test('site audit v1 data is normalized without losing legacy values', () => {
  const normalized = normalizeSiteAuditFormData({
    client_type: 'B2C',
    existing_pv_device: 'Solis S6',
    existing_pv_kw: '7.2',
    existing_pv_params: '3 fazy',
    loads: [{ id: 'load-a', device: 'Pompa', params: '2 kW' }],
    custom_legacy_field: 'zachowane',
  });

  assert.equal(normalized.existing_pv_inverter_model, 'Solis S6');
  assert.equal(normalized.existing_pv_total_kw, '7.2');
  assert.equal(normalized.existing_pv_notes, '3 fazy');
  assert.equal(normalized.loads[0].backup_power, 'no');
  assert.equal(normalized.custom_legacy_field, 'zachowane');
});

test('changing the audit client type resets every type-dependent step', () => {
  assert.deepEqual(resetTypeDependentCompletion([1, 2, 3, 4, 5, 6, 7]), []);
});

test('an audit without client type cannot be completed', () => {
  const missing = siteAuditCompletionErrors({
    client_type: 'UNKNOWN',
    client_name: 'Klient',
    client_address: 'Poznań',
    visit_date: '2026-08-12',
    audit_result: 'Możliwa do realizacji',
    audit_next_action: 'Przygotować projekt',
    final_summary_notes: 'Wynik pozytywny',
  }, 'staff-1');
  assert.deepEqual(missing, ['typ klienta']);
});

test('B2B completion requires the company name', () => {
  const missing = siteAuditCompletionErrors({
    client_type: 'B2B', client_address: 'Poznań', visit_date: '2026-08-12',
    audit_result: 'Możliwa', audit_next_action: 'Projekt', final_summary_notes: 'OK',
  }, 'staff-1');
  assert.deepEqual(missing, ['nazwa firmy']);
});
