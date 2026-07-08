import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export const systemRoleLabels: Record<string, string> = {
  ADMIN: 'Admin',
  MODERATOR: 'Moderator',
  USER: 'Użytkownik',
};

export const companyRoleLabels: Record<string, string> = {
  SZEF: 'Szef',
  KOORDYNATOR: 'Koordynator',
  SPRZEDAWCA: 'Sprzedawca',
  MONTER: 'Monter',
  ELEKTRYK: 'Elektryk',
  SERWIS: 'Serwis',
  PROJEKTANT: 'Projektant',
  DEVELOPER: 'Developer',
  KSIEGOWOSC: 'Księgowość',
  BIURO: 'Biuro',
  PODWYKONAWCA: 'Podwykonawca',
};

export const companyRoleOrder = [
  'SZEF',
  'KOORDYNATOR',
  'SPRZEDAWCA',
  'MONTER',
  'ELEKTRYK',
  'SERWIS',
  'PROJEKTANT',
  'DEVELOPER',
  'KSIEGOWOSC',
  'BIURO',
  'PODWYKONAWCA',
];

export function initialsFromName(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]).join('');
  return (initials || 'OR').toUpperCase();
}

export function displayCompanyRoles(roles: Array<{ companyRole?: { name?: string | null } | null }>) {
  const names = roles
    .map((role) => role.companyRole?.name)
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(', ') : 'Brak roli firmowej';
}

export function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = randomBytes(14);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash?: string | null) {
  if (!storedHash) return false;
  const [algorithm, salt, expectedHash] = storedHash.split(':');
  if (algorithm !== 'scrypt' || !salt || !expectedHash) return false;

  const actual = Buffer.from(scryptSync(password, salt, 64).toString('hex'), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
