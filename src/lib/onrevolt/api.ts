import { NextRequest, NextResponse } from 'next/server';

export function jsonResponse(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function badRequest(message: string) {
  return jsonResponse({ ok: false, error: message }, { status: 400 });
}

export function unauthorized(message = 'Wymagane logowanie') {
  return jsonResponse({ ok: false, error: message }, { status: 401 });
}

export function forbidden(message = 'Brak uprawnień') {
  return jsonResponse({ ok: false, error: message }, { status: 403 });
}

export function notFound(message: string) {
  return jsonResponse({ ok: false, error: message }, { status: 404 });
}

export function serverError(context: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return jsonResponse({ ok: false, error: context, message }, { status: 500 });
}

export async function readJsonObject(req: NextRequest) {
  const body = await req.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Oczekiwano obiektu JSON');
  }
  return body as Record<string, any>;
}

export function requireString(body: Record<string, any>, key: string) {
  const value = body[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Brak wymaganego pola ${key}`);
  }
  return value.trim();
}

export function optionalString(body: Record<string, any>, key: string) {
  const value = body[key];
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new Error(`Pole ${key} musi być tekstem`);
  }
  return value.trim();
}

export function parseDate(value: unknown) {
  if (value == null || value === '') return undefined;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Nieprawidłowa data: ${value}`);
  }
  return date;
}
