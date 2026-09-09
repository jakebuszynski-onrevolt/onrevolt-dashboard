import { compare, hash } from 'bcryptjs';
import { randomInt } from 'crypto';

export const DASHBOARD_LOGIN_URL = 'https://my.onrevolt.com/login/';

const passwordGroups = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%',
] as const;
const passwordAlphabet = passwordGroups.join('');

export class DashboardAccessInputError extends Error {}

export function normalizeDashboardAccessEmail(value: unknown) {
  const email = typeof value === 'string' ? value.trim() : '';
  if (!email) throw new DashboardAccessInputError('Podaj email klienta do logowania');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new DashboardAccessInputError('Podaj prawidłowy adres email klienta');
  }
  return email;
}

export function generateDashboardAccessPassword(length = 14) {
  if (!Number.isInteger(length) || length < passwordGroups.length) {
    throw new DashboardAccessInputError('Hasło dashboardu musi mieć co najmniej 4 znaki');
  }

  const characters = passwordGroups.map((group) => group[randomInt(0, group.length)]);
  while (characters.length < length) {
    characters.push(passwordAlphabet[randomInt(0, passwordAlphabet.length)]);
  }
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join('');
}

export async function hashDashboardAccessPassword(password: string) {
  return hash(password, 12);
}

export async function verifyDashboardAccessPassword(password: string, passwordHash: string) {
  return compare(password, passwordHash);
}

export function buildDashboardAccessEmail(input: {
  email: string;
  password: string;
}) {
  return {
    subject: 'Dostęp do systemu onRevolt',
    body: [
      'Dzień dobry,',
      '',
      'uruchomiliśmy dla Ciebie dostęp do systemu onRevolt. W panelu możesz wygodnie sprawdzać dane energetyczne i pracę swojej instalacji.',
      '',
      `Adres logowania: ${DASHBOARD_LOGIN_URL}`,
      `Login: ${input.email}`,
      `Hasło: ${input.password}`,
      '',
      'Ze względów bezpieczeństwa nie udostępniaj danych logowania innym osobom. Hasło możesz później zmienić przy użyciu opcji „Nie pamiętam hasła” na stronie logowania.',
      '',
      'Pozdrawiamy,',
      'Zespół onRevolt',
    ].join('\n'),
  };
}
