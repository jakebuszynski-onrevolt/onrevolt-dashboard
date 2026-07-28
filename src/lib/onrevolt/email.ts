import nodemailer from 'nodemailer';

import { prisma } from 'lib/onrevolt/prisma';

type EmailInput = {
  to: string;
  subject: string;
  body: string;
  scheduledAt?: Date;
};

type DeliveryResult = {
  id: string;
  status: 'QUEUED' | 'SENT' | 'FAILED';
  error?: string;
};

let transporter: nodemailer.Transporter | null = null;

const transientRetryDelaysMs = [2_000, 8_000];

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Brak ${name} w konfiguracji poczty`);
  return value;
}

function envBoolean(name: string, defaultValue: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  if (value === 'true' || value === '1' || value === 'yes') return true;
  if (value === 'false' || value === '0' || value === 'no') return false;
  throw new Error(`Nieprawidłowa wartość ${name}: ${process.env[name]}`);
}

function smtpTransport() {
  if (transporter) return transporter;
  const port = Number(requiredEnv('SMTP_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT musi być prawidłowym numerem portu');
  }

  const useAuth = envBoolean('SMTP_AUTH', false);
  transporter = nodemailer.createTransport({
    pool: true,
    host: requiredEnv('SMTP_HOST'),
    port,
    name: requiredEnv('SMTP_HELO_NAME'),
    secure: envBoolean('SMTP_SECURE', false),
    requireTLS: envBoolean('SMTP_REQUIRE_TLS', true),
    auth: useAuth
      ? { user: requiredEnv('SMTP_USER'), pass: requiredEnv('SMTP_PASSWORD') }
      : undefined,
    tls: { minVersion: 'TLSv1.2' },
    maxConnections: 1,
    maxMessages: 100,
    rateDelta: 60_000,
    rateLimit: 30,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
  });
  return transporter;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTransientSmtpError(error: unknown) {
  const candidate = error as { responseCode?: number; code?: string; message?: string };
  return candidate?.responseCode === 421
    || candidate?.code === 'ETIMEDOUT'
    || candidate?.code === 'ECONNECTION'
    || /\b421(?:-|\s)|try again later/i.test(candidate?.message || '');
}

function closeTransport() {
  transporter?.close();
  transporter = null;
}

export function closeSmtpConnection() {
  closeTransport();
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function textToHtml(value: string) {
  const escaped = value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  return escaped.replaceAll('\n', '<br>');
}

export async function verifySmtpConnection() {
  await smtpTransport().verify();
}

async function sendWithRetry(message: {
  from: { name: string; address: string };
  sender: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  envelope: { from: string; to: string };
}) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= transientRetryDelaysMs.length; attempt += 1) {
    try {
      return await smtpTransport().sendMail(message);
    } catch (error) {
      lastError = error;
      closeTransport();
      if (!isTransientSmtpError(error) || attempt === transientRetryDelaysMs.length) throw error;
      await delay(transientRetryDelaysMs[attempt]);
    }
  }
  throw lastError;
}

export async function deliverEmailMessage(id: string): Promise<DeliveryResult> {
  const message = await prisma.emailMessage.findUniqueOrThrow({ where: { id } });
  if (message.status === 'SENT') return { id, status: 'SENT' };
  if (message.scheduledAt && message.scheduledAt.getTime() > Date.now()) {
    return { id, status: 'QUEUED' };
  }

  try {
    const from = requiredEnv('EMAIL_FROM');
    const envelopeFrom = requiredEnv('EMAIL_ENVELOPE_FROM');
    const sender = process.env.EMAIL_SENDER?.trim() || envelopeFrom;
    await sendWithRetry({
      from: { name: process.env.EMAIL_FROM_NAME?.trim() || 'onRevolt CRM', address: from },
      sender,
      to: message.to,
      subject: message.subject,
      text: message.body,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#17224d">${textToHtml(message.body)}</div>`,
      envelope: { from: envelopeFrom, to: message.to },
    });

    await prisma.emailMessage.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date(), error: null },
    });
    return { id, status: 'SENT' };
  } catch (error) {
    const failure = errorMessage(error);
    const transient = isTransientSmtpError(error);
    await prisma.emailMessage.update({
      where: { id },
      data: transient
        ? { status: 'QUEUED', scheduledAt: new Date(Date.now() + 5 * 60_000), error: failure }
        : { status: 'FAILED', error: failure },
    });
    return { id, status: transient ? 'QUEUED' : 'FAILED', error: failure };
  }
}

export async function queueAndSendEmail(input: EmailInput): Promise<DeliveryResult> {
  const message = await prisma.emailMessage.create({
    data: {
      to: input.to.trim(),
      subject: input.subject.trim(),
      body: input.body,
      scheduledAt: input.scheduledAt,
      status: 'QUEUED',
    },
  });
  return deliverEmailMessage(message.id);
}

export async function processEmailQueue(limit = 50) {
  const messages = await prisma.emailMessage.findMany({
    where: {
      status: 'QUEUED',
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
    },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    take: Math.max(1, Math.min(limit, 100)),
  });

  const results: DeliveryResult[] = [];
  for (const message of messages) results.push(await deliverEmailMessage(message.id));
  return results;
}
