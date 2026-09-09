import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DASHBOARD_LOGIN_URL,
  DashboardAccessInputError,
  buildDashboardAccessEmail,
  generateDashboardAccessPassword,
  hashDashboardAccessPassword,
  normalizeDashboardAccessEmail,
  verifyDashboardAccessPassword,
} from './dashboard-access';

test('normalizuje prawidłowy email dashboardu i odrzuca błędny', () => {
  assert.equal(normalizeDashboardAccessEmail(' klient@example.com '), 'klient@example.com');
  assert.throws(() => normalizeDashboardAccessEmail('brak-at'), DashboardAccessInputError);
});

test('generuje mocne hasło dashboardu i zapisuje je jako bcrypt zgodny z password_verify', async () => {
  const password = generateDashboardAccessPassword();
  assert.equal(password.length, 14);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /[0-9]/);
  assert.match(password, /[!@#$%]/);

  const passwordHash = await hashDashboardAccessPassword(password);
  assert.match(passwordHash, /^\$2[aby]\$12\$/);
  assert.equal(await verifyDashboardAccessPassword(password, passwordHash), true);
  assert.equal(await verifyDashboardAccessPassword(`${password}x`, passwordHash), false);
});

test('wiadomość dostępowa zawiera login i właściwy link, ale nie numer stacji', () => {
  const message = buildDashboardAccessEmail({
    email: 'klient@example.com',
    password: 'Haslo123!Test',
  });
  assert.match(message.body, /klient@example\.com/);
  assert.doesNotMatch(message.body, /Numer stacji/);
  assert.ok(message.body.includes(DASHBOARD_LOGIN_URL));
});
