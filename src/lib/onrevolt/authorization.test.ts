import assert from 'node:assert/strict';
import test from 'node:test';
import { getStaffPermissions, hasStaffPermission, isAdminUser } from './staff-server';

function user(systemRole: string, companyRoles: string[] = []) {
  return {
    systemRole,
    companyRoles: companyRoles.map((code) => ({ companyRole: { code } })),
  };
}

test('administrator ma pełny zestaw uprawnień', () => {
  const admin = user('ADMIN');
  assert.equal(hasStaffPermission(admin, 'users.manage'), true);
  assert.equal(hasStaffPermission(admin, 'pricing.write'), true);
  assert.equal(getStaffPermissions(admin).size >= 10, true);
});

test('sprzedawca tworzy oferty, ale nie zarządza użytkownikami', () => {
  const seller = user('USER', ['SPRZEDAWCA']);
  assert.equal(hasStaffPermission(seller, 'offers.manage'), true);
  assert.equal(hasStaffPermission(seller, 'site-audits.manage'), true);
  assert.equal(hasStaffPermission(seller, 'users.manage'), false);
  assert.equal(hasStaffPermission(seller, 'installations.manage'), false);
});

test('monter nie widzi cen, ale obsługuje montaż', () => {
  const installer = user('USER', ['MONTER']);
  assert.equal(hasStaffPermission(installer, 'installations.manage'), true);
  assert.equal(hasStaffPermission(installer, 'site-audits.manage'), true);
  assert.equal(hasStaffPermission(installer, 'documents.manage'), true);
  assert.equal(hasStaffPermission(installer, 'pricing.read'), false);
});

test('tylko administrator systemowy może usuwać zadania', () => {
  assert.equal(isAdminUser(user('ADMIN')), true);
  assert.equal(isAdminUser(user('MODERATOR')), false);
  assert.equal(isAdminUser(user('USER', ['SPRZEDAWCA'])), false);
});
