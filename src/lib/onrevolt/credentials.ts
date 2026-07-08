import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const credentialVersion = 'v1';
const algorithm = 'aes-256-gcm';

function credentialKey() {
  const secret = process.env.ONREVOLT_CREDENTIAL_SECRET?.trim();
  if (!secret) {
    throw new Error('Brak ONREVOLT_CREDENTIAL_SECRET dla szyfrowania danych dostępowych');
  }

  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptCredential(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    credentialVersion,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptCredential(payload: string) {
  const [version, ivRaw, tagRaw, encryptedRaw] = payload.split(':');
  if (version !== credentialVersion || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error('Nieprawidłowy format zaszyfrowanego hasła');
  }

  const decipher = createDecipheriv(
    algorithm,
    credentialKey(),
    Buffer.from(ivRaw, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
