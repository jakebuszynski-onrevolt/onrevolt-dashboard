import { randomBytes, randomInt } from 'crypto';
import { PrismaClient } from '@prisma/client';

type MysqlColumn = {
  Field: string;
  Type: string;
  Null: 'YES' | 'NO';
  Key: string;
  Default: unknown;
  Extra: string;
};

export type CreatedReStation = {
  station: string;
  stationHash: string;
  weatherStation: string | null;
};

export type ResolvedReStation = CreatedReStation;

const globalForRePrisma = globalThis as unknown as {
  onrevoltRePrisma?: PrismaClient;
  onrevoltReDatabaseUrl?: string;
};

function reDatabaseUrl() {
  const url = process.env.ONREVOLT_RE_DATABASE_URL?.trim();
  if (!url) {
    throw new Error('Brak ONREVOLT_RE_DATABASE_URL dla bazy RE / EnergyMeter_users');
  }
  return url;
}

function rePrisma() {
  const url = reDatabaseUrl();
  if (!globalForRePrisma.onrevoltRePrisma || globalForRePrisma.onrevoltReDatabaseUrl !== url) {
    globalForRePrisma.onrevoltRePrisma = new PrismaClient({
      datasources: { db: { url } },
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    } as any);
    globalForRePrisma.onrevoltReDatabaseUrl = url;
  }
  return globalForRePrisma.onrevoltRePrisma;
}

async function ensureEnergyMeterUsersTable(db: PrismaClient) {
  const tables = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    'SHOW TABLES LIKE ?',
    'EnergyMeter_users',
  );
  if (!tables.length) {
    throw new Error('Brak tabeli EnergyMeter_users w bazie RE');
  }
}

async function readEnergyMeterColumns(db: PrismaClient) {
  const rows = await db.$queryRawUnsafe<MysqlColumn[]>('SHOW COLUMNS FROM `EnergyMeter_users`');
  return new Map(rows.map((row) => [row.Field, row]));
}

function selectStationColumns(columns: Map<string, MysqlColumn>) {
  const select = ['station'];
  if (columns.has('station_hash')) select.push('station_hash');
  if (columns.has('weather_station')) select.push('weather_station');
  return select.map((column) => `\`${column}\``).join(', ');
}

async function ensureColumn(db: PrismaClient, columns: Map<string, MysqlColumn>, column: string, definition: string) {
  if (columns.has(column)) return;
  await db.$executeRawUnsafe(`ALTER TABLE \`EnergyMeter_users\` ADD COLUMN \`${column}\` ${definition}`);
  columns.set(column, {
    Field: column,
    Type: definition,
    Null: definition.includes('NOT NULL') ? 'NO' : 'YES',
    Key: '',
    Default: null,
    Extra: '',
  });
}

function normalizeMaxStation(value: unknown) {
  if (value == null) return 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function stationExists(db: PrismaClient, station: string) {
  const rows = await db.$queryRawUnsafe<Array<{ station: string }>>(
    'SELECT `station` FROM `EnergyMeter_users` WHERE `station` = ? LIMIT 1',
    station,
  );
  return rows.length > 0;
}

async function nextStationNumber(db: PrismaClient) {
  const rows = await db.$queryRawUnsafe<Array<{ maxStation: unknown }>>(
    'SELECT MAX(CAST(`station` AS UNSIGNED)) AS maxStation FROM `EnergyMeter_users` WHERE `station` REGEXP "^[0-9]+$"',
  );
  let stationNumber = normalizeMaxStation(rows[0]?.maxStation) + 1;

  for (let attempt = 0; attempt < 500; attempt += 1) {
    const station = String(stationNumber);
    if (!(await stationExists(db, station))) return station;
    stationNumber += 1;
  }

  throw new Error('Nie udało się znaleźć wolnego numeru stacji RE');
}

function randomStationHash() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let hash = '';
  for (let index = 0; index < 8; index += 1) {
    hash += alphabet[randomInt(0, alphabet.length)];
  }
  return hash;
}

async function generateUniqueStationHash(db: PrismaClient) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const hash = randomStationHash();
    const existing = await db.$queryRawUnsafe<Array<{ station: string }>>(
      'SELECT `station` FROM `EnergyMeter_users` WHERE `station_hash` = ? LIMIT 1',
      hash,
    );
    if (!existing.length) return hash;
  }

  throw new Error('Nie udało się wygenerować wolnego tokenu stacji RE');
}

function safeInsertColumns(columns: Map<string, MysqlColumn>, values: Record<string, unknown>) {
  return Object.keys(values).filter((column) => columns.has(column));
}

async function insertStation(
  db: PrismaClient,
  columns: Map<string, MysqlColumn>,
  values: Record<string, unknown>,
) {
  const insertColumns = safeInsertColumns(columns, values);
  const columnSql = insertColumns.map((column) => `\`${column}\``).join(', ');
  const placeholderSql = insertColumns.map(() => '?').join(', ');
  const query = `INSERT INTO \`EnergyMeter_users\` (${columnSql}) VALUES (${placeholderSql})`;

  await db.$executeRawUnsafe(query, ...insertColumns.map((column) => values[column]));
}

export async function createReStation(input: { displayName: string; email?: string | null }): Promise<CreatedReStation> {
  const db = rePrisma();
  await ensureEnergyMeterUsersTable(db);
  const columns = await readEnergyMeterColumns(db);

  if (!columns.has('station')) {
    throw new Error('Tabela EnergyMeter_users nie ma kolumny station');
  }

  await ensureColumn(db, columns, 'station_hash', 'CHAR(8) NULL DEFAULT NULL');
  await ensureColumn(db, columns, 'api_key', 'VARCHAR(128) NULL DEFAULT NULL');

  const station = await nextStationNumber(db);
  const stationHash = await generateUniqueStationHash(db);
  const apiKey = randomBytes(16).toString('hex');
  const email = input.email?.trim() || null;
  const username = input.displayName.trim() || email || `Stacja ${station}`;

  await insertStation(db, columns, {
    station,
    station_hash: stationHash,
    api_key: apiKey,
    username,
    email,
    user_type: 'user',
  });

  return {
    station,
    stationHash,
    weatherStation: null,
  };
}

export async function resolveReStation(stationOrHash: string): Promise<ResolvedReStation | null> {
  const stationInput = stationOrHash.trim();
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(stationInput)) {
    throw new Error('Nieprawidłowy numer albo token stacji RE');
  }

  const db = rePrisma();
  await ensureEnergyMeterUsersTable(db);
  const columns = await readEnergyMeterColumns(db);
  if (!columns.has('station')) {
    throw new Error('Tabela EnergyMeter_users nie ma kolumny station');
  }

  const selectSql = selectStationColumns(columns);
  let rows: Array<Record<string, unknown>> = [];

  if (/^\d+$/.test(stationInput)) {
    rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT ${selectSql} FROM \`EnergyMeter_users\` WHERE \`station\` = ? LIMIT 1`,
      stationInput,
    );
  }

  if (!rows.length && columns.has('station_hash')) {
    rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT ${selectSql} FROM \`EnergyMeter_users\` WHERE \`station_hash\` = ? LIMIT 1`,
      stationInput,
    );
  }

  const row = rows[0];
  if (!row) return null;

  const station = String(row.station || '').trim();
  if (!station) return null;

  return {
    station,
    stationHash: String(row.station_hash || stationInput).trim(),
    weatherStation: String(row.weather_station || '').trim() || null,
  };
}
