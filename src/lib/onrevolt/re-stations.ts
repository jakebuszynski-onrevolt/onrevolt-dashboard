import { randomBytes, randomInt } from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  isSolisStationType,
  isValidSolisFirmwareVersion,
  isValidSolisRapidCommand,
  supportsSolisRapidCommands,
  type SolisRapidCommand,
} from './solis-ota';
import {
  isValidSolisPowerLimitPercent,
} from './solis-inverter';

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

export type ReStationDeviceStatus = {
  station: string;
  type: string;
  uid: string | null;
  firmwareVersion: string | null;
  firmwareSeenAt: string | null;
  firmwareTargetVersion: string | null;
  otaEnabled: boolean;
  otaForce: boolean;
  otaLastStatus: string | null;
  otaLastError: string | null;
  otaLastTargetVersion: string | null;
  otaLastAt: string | null;
  controlEnabled: boolean;
  shadowOnly: boolean;
  inverterRatedPowerW: number;
  inverterPowerLimitPercent: number;
  rapidCommandSequence: number;
  rapidCommand: string | null;
  rapidCommandRequestedAt: string | null;
  rapidCommandExpiresAt: string | null;
  rapidCommandAcknowledgedSequence: number;
  rapidCommandAcknowledgedAt: string | null;
  rapidCommandResult: string | null;
  rapidCommandOk: boolean | null;
  exportBlocked: boolean;
  pvBlocked: boolean;
  exportBlockApplied: boolean;
  pvBlockApplied: boolean;
};

export class ReStationOtaRequestError extends Error {}
export class ReStationControlRequestError extends Error {}

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
    "SHOW TABLES LIKE 'EnergyMeter_users'",
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

const deviceStatusColumns = [
  'station',
  'type',
  'uid',
  'firmware_version',
  'firmware_seen_at',
  'firmware_target_version',
  'ota_enabled',
  'ota_force',
  'ota_last_status',
  'ota_last_error',
  'ota_last_target_version',
  'ota_last_at',
  'control_enabled',
  'shadow_only',
  'inverter_rated_power_w',
  'inverter_power_limit_percent',
  'solis_command_seq',
  'solis_command',
  'solis_command_requested_at',
  'solis_command_expires_at',
  'solis_command_ack_seq',
  'solis_command_ack_at',
  'solis_command_result',
  'solis_command_ok',
  'solis_export_blocked',
  'solis_pv_blocked',
  'solis_export_block_applied',
  'solis_pv_block_applied',
] as const;

function optionalText(value: unknown) {
  const text = String(value ?? '').trim();
  return text || null;
}

function boolValue(value: unknown) {
  return Number(value || 0) === 1;
}

function nullableBoolValue(value: unknown) {
  return value == null ? null : boolValue(value);
}

function intValue(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function dateValue(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return optionalText(value);
}

function validateStationInput(stationOrHash: string) {
  const stationInput = stationOrHash.trim();
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(stationInput)) {
    throw new Error('Nieprawidłowy numer albo token stacji RE');
  }
  return stationInput;
}

async function findStationRow(
  db: PrismaClient,
  columns: Map<string, MysqlColumn>,
  stationInput: string,
  selectSql: string,
) {
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
  return rows[0] || null;
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
  const stationInput = validateStationInput(stationOrHash);

  const db = rePrisma();
  await ensureEnergyMeterUsersTable(db);
  const columns = await readEnergyMeterColumns(db);
  if (!columns.has('station')) {
    throw new Error('Tabela EnergyMeter_users nie ma kolumny station');
  }

  const selectSql = selectStationColumns(columns);
  const row = await findStationRow(db, columns, stationInput, selectSql);
  if (!row) return null;

  const station = String(row.station || '').trim();
  if (!station) return null;

  return {
    station,
    stationHash: String(row.station_hash || stationInput).trim(),
    weatherStation: String(row.weather_station || '').trim() || null,
  };
}

export async function readReStationDeviceStatus(stationOrHash: string): Promise<ReStationDeviceStatus | null> {
  const stationInput = validateStationInput(stationOrHash);
  const db = rePrisma();
  await ensureEnergyMeterUsersTable(db);
  const columns = await readEnergyMeterColumns(db);
  if (!columns.has('station')) {
    throw new Error('Tabela EnergyMeter_users nie ma kolumny station');
  }

  const selectedColumns = deviceStatusColumns.filter((column) => columns.has(column));
  const selectSql = selectedColumns.map((column) => `\`${column}\``).join(', ');
  const row = await findStationRow(db, columns, stationInput, selectSql);
  if (!row) return null;

  return {
    station: String(row.station || '').trim(),
    type: String(row.type || '').trim(),
    uid: optionalText(row.uid),
    firmwareVersion: optionalText(row.firmware_version),
    firmwareSeenAt: dateValue(row.firmware_seen_at),
    firmwareTargetVersion: optionalText(row.firmware_target_version),
    otaEnabled: boolValue(row.ota_enabled),
    otaForce: boolValue(row.ota_force),
    otaLastStatus: optionalText(row.ota_last_status),
    otaLastError: optionalText(row.ota_last_error),
    otaLastTargetVersion: optionalText(row.ota_last_target_version),
    otaLastAt: dateValue(row.ota_last_at),
    controlEnabled: boolValue(row.control_enabled),
    shadowOnly: row.shadow_only == null ? true : boolValue(row.shadow_only),
    inverterRatedPowerW: intValue(row.inverter_rated_power_w),
    inverterPowerLimitPercent: intValue(row.inverter_power_limit_percent),
    rapidCommandSequence: intValue(row.solis_command_seq),
    rapidCommand: optionalText(row.solis_command),
    rapidCommandRequestedAt: dateValue(row.solis_command_requested_at),
    rapidCommandExpiresAt: dateValue(row.solis_command_expires_at),
    rapidCommandAcknowledgedSequence: intValue(row.solis_command_ack_seq),
    rapidCommandAcknowledgedAt: dateValue(row.solis_command_ack_at),
    rapidCommandResult: optionalText(row.solis_command_result),
    rapidCommandOk: nullableBoolValue(row.solis_command_ok),
    exportBlocked: boolValue(row.solis_export_blocked),
    pvBlocked: boolValue(row.solis_pv_blocked),
    exportBlockApplied: boolValue(row.solis_export_block_applied),
    pvBlockApplied: boolValue(row.solis_pv_block_applied),
  };
}

export async function requestReStationOta(stationOrHash: string, targetVersion: string) {
  const version = targetVersion.trim();
  if (!isValidSolisFirmwareVersion(version)) {
    throw new ReStationOtaRequestError('Nieprawidłowa wersja firmware');
  }

  const before = await readReStationDeviceStatus(stationOrHash);
  if (!before) throw new ReStationOtaRequestError('Nie znaleziono stacji RE');
  if (!isSolisStationType(before.type)) {
    throw new ReStationOtaRequestError('Aktualizacja OTA jest dostępna tylko dla stacji Solis');
  }
  if (!before.firmwareVersion) {
    throw new ReStationOtaRequestError('Stacja nie zgłosiła jeszcze bieżącej wersji firmware');
  }
  if (before.otaEnabled) {
    throw new ReStationOtaRequestError('Aktualizacja OTA jest już włączona. Poczekaj na raport urządzenia.');
  }
  if (before.firmwareVersion === version) {
    throw new ReStationOtaRequestError('Wybrana wersja jest już zainstalowana na urządzeniu');
  }

  const db = rePrisma();
  const columns = await readEnergyMeterColumns(db);
  for (const column of ['firmware_target_version', 'ota_enabled']) {
    if (!columns.has(column)) {
      throw new Error(`Tabela EnergyMeter_users nie ma kolumny ${column}`);
    }
  }

  const updated = await db.$executeRawUnsafe(
    'UPDATE `EnergyMeter_users` SET `firmware_target_version` = ?, `ota_enabled` = 1 WHERE `station` = ? AND `ota_enabled` = 0 LIMIT 1',
    version,
    before.station,
  );
  if (updated !== 1) {
    throw new ReStationOtaRequestError('Nie udało się włączyć OTA. Odśwież status stacji i spróbuj ponownie.');
  }

  const after = await readReStationDeviceStatus(before.station);
  if (!after) throw new Error('Stacja zniknęła po włączeniu OTA');
  return { before, after };
}

export async function updateReStationControlSettings(
  stationOrHash: string,
  input: { controlEnabled: boolean; shadowOnly: boolean },
) {
  const before = await readReStationDeviceStatus(stationOrHash);
  if (!before) throw new ReStationControlRequestError('Nie znaleziono stacji RE');
  if (!isSolisStationType(before.type)) {
    throw new ReStationControlRequestError('Sterowanie jest dostępne tylko dla stacji Solis');
  }

  const db = rePrisma();
  const columns = await readEnergyMeterColumns(db);
  for (const column of ['control_enabled', 'shadow_only']) {
    if (!columns.has(column)) {
      throw new Error(`Tabela EnergyMeter_users nie ma kolumny ${column}`);
    }
  }

  const updated = await db.$executeRawUnsafe(
    'UPDATE `EnergyMeter_users` SET `control_enabled` = ?, `shadow_only` = ? WHERE `station` = ? LIMIT 1',
    input.controlEnabled ? 1 : 0,
    input.shadowOnly ? 1 : 0,
    before.station,
  );
  if (updated !== 1) {
    throw new ReStationControlRequestError('Nie udało się zapisać ustawień sterowania stacji');
  }

  const after = await readReStationDeviceStatus(before.station);
  if (!after) throw new Error('Stacja zniknęła po zapisaniu ustawień sterowania');
  return { before, after };
}

export async function updateReStationInverterPowerLimit(
  stationOrHash: string,
  inverterPowerLimitPercent: number,
) {
  if (!isValidSolisPowerLimitPercent(inverterPowerLimitPercent)) {
    throw new ReStationControlRequestError('Limit mocy falownika musi być całkowitą wartością od 0% do 100%');
  }

  const before = await readReStationDeviceStatus(stationOrHash);
  if (!before) throw new ReStationControlRequestError('Nie znaleziono stacji RE');
  if (!isSolisStationType(before.type)) {
    throw new ReStationControlRequestError('Ustawienia mocy są dostępne tylko dla stacji Solis');
  }
  if (before.inverterPowerLimitPercent === inverterPowerLimitPercent) {
    return { before, after: before };
  }

  const db = rePrisma();
  const columns = await readEnergyMeterColumns(db);
  if (!columns.has('inverter_power_limit_percent')) {
    throw new Error('Tabela EnergyMeter_users nie ma kolumny inverter_power_limit_percent');
  }

  const updated = await db.$executeRawUnsafe(
    'UPDATE `EnergyMeter_users` SET `inverter_power_limit_percent` = ? WHERE `station` = ? LIMIT 1',
    inverterPowerLimitPercent,
    before.station,
  );
  if (updated !== 1) {
    throw new ReStationControlRequestError('Nie udało się zapisać ustawień mocy falownika');
  }

  const after = await readReStationDeviceStatus(before.station);
  if (!after) throw new Error('Stacja zniknęła po zapisaniu ustawień mocy');
  return { before, after };
}

export async function requestReStationRapidCommand(
  stationOrHash: string,
  requestedCommand: string,
) {
  const command = requestedCommand.trim().toUpperCase();
  if (!isValidSolisRapidCommand(command)) {
    throw new ReStationControlRequestError('Nieprawidłowe polecenie dla stacji Solis');
  }

  const before = await readReStationDeviceStatus(stationOrHash);
  if (!before) throw new ReStationControlRequestError('Nie znaleziono stacji RE');
  if (!isSolisStationType(before.type)) {
    throw new ReStationControlRequestError('Szybkie polecenia są dostępne tylko dla stacji Solis');
  }
  if (!supportsSolisRapidCommands(before.firmwareVersion)) {
    throw new ReStationControlRequestError('Szybkie polecenia wymagają firmware Solis 2026.09.02.4 lub nowszego');
  }

  const db = rePrisma();
  const columns = await readEnergyMeterColumns(db);
  const requiredColumns = [
    'solis_command_seq',
    'solis_command',
    'solis_command_requested_at',
    'solis_command_expires_at',
    'solis_command_ack_seq',
    'solis_command_result',
    'solis_command_ok',
  ];
  for (const column of requiredColumns) {
    if (!columns.has(column)) {
      throw new Error(`Tabela EnergyMeter_users nie ma kolumny ${column}`);
    }
  }

  const sequence = await db.$transaction(async (transaction) => {
    const rows = await transaction.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT \`solis_command_seq\`, \`solis_command_ack_seq\`,
              (\`solis_command\` IS NOT NULL
               AND \`solis_command_seq\` > \`solis_command_ack_seq\`
               AND \`solis_command_expires_at\` > NOW()) AS \`command_pending\`
       FROM \`EnergyMeter_users\` WHERE \`station\` = ? LIMIT 1 FOR UPDATE`,
      before.station,
    );
    const row = rows[0];
    if (!row) throw new ReStationControlRequestError('Nie znaleziono stacji RE');
    if (boolValue(row.command_pending)) {
      throw new ReStationControlRequestError('Stacja ma już oczekujące polecenie. Poczekaj na potwierdzenie lub wygaśnięcie.');
    }

    const currentSequence = intValue(row.solis_command_seq);
    const nextSequence = currentSequence >= 4_294_967_294 ? 1 : currentSequence + 1;
    const updated = await transaction.$executeRawUnsafe(
      `UPDATE \`EnergyMeter_users\`
       SET \`solis_command_seq\` = ?,
           \`solis_command\` = ?,
           \`solis_command_requested_at\` = NOW(),
           \`solis_command_expires_at\` = DATE_ADD(NOW(), INTERVAL 300 SECOND),
           \`solis_command_result\` = NULL,
           \`solis_command_ok\` = NULL
       WHERE \`station\` = ? LIMIT 1`,
      nextSequence,
      command as SolisRapidCommand,
      before.station,
    );
    if (updated !== 1) {
      throw new ReStationControlRequestError('Nie udało się zapisać polecenia dla stacji');
    }
    return nextSequence;
  });

  const after = await readReStationDeviceStatus(before.station);
  if (!after) throw new Error('Stacja zniknęła po zapisaniu polecenia');
  return { before, after, command: command as SolisRapidCommand, sequence };
}
