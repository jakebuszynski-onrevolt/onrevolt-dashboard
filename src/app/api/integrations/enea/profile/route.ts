import { readFile } from 'fs/promises';
import path from 'path';
import { NextRequest } from 'next/server';
import * as XLSX from 'xlsx';
import { badRequest, jsonResponse, optionalString, serverError } from 'lib/onrevolt/api';
import { prisma } from 'lib/onrevolt/prisma';

export const runtime = 'nodejs';

type SheetRow = Array<string | number | boolean | Date | null | undefined>;

type UsageMonth = {
  key: string;
  year: number;
  month: number;
  label: string;
  totalKwh: number;
  sharePercent: number;
  hourly: number[];
  sourceFiles: number;
};

function uploadRoot() {
  const uploadDir = process.env.ONREVOLT_UPLOAD_DIR?.trim();
  if (!uploadDir) throw new Error('Brak ONREVOLT_UPLOAD_DIR dla odczytu plików ENEA');
  return path.resolve(uploadDir);
}

function isInsideDirectory(filePath: string, directory: string) {
  const relative = path.relative(directory, filePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function normalizeText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function numberFromCell(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value ?? '')
    .replace(/\s/g, '')
    .replace(',', '.')
    .trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateFromCell(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds());
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, parsed.S || 0);
    }
  }

  const text = String(value ?? '').trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0),
    );
  }

  match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    return new Date(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0),
    );
  }

  return null;
}

function monthLabel(year: number, month: number) {
  const name = new Intl.DateTimeFormat('pl-PL', { month: 'long' }).format(new Date(year, month - 1, 1));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function emptyMonth(year: number, month: number): UsageMonth {
  return {
    key: `${year}-${String(month).padStart(2, '0')}`,
    year,
    month,
    label: monthLabel(year, month),
    totalKwh: 0,
    sharePercent: 0,
    hourly: Array.from({ length: 24 }, () => 0),
    sourceFiles: 0,
  };
}

function findHeader(rows: SheetRow[]) {
  for (let index = 0; index < rows.length; index += 1) {
    const normalized = rows[index].map(normalizeText);
    const hasDate = normalized.some((cell) => cell === 'dzien' || cell.includes('dzien'));
    const hasImport = normalized.some((cell) => cell.includes('energia czynna pobrana'));
    if (hasDate && hasImport) return index;
  }
  return -1;
}

function parseConsumptionWorkbook(bytes: Buffer) {
  const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Plik XLSX nie ma arkuszy');

  const rows = XLSX.utils.sheet_to_json<SheetRow>(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
  });
  const headerIndex = findHeader(rows);
  if (headerIndex < 0) throw new Error('Nie znaleziono nagłówków ENEA w pliku XLSX');

  const headers = rows[headerIndex].map(normalizeText);
  const dateIndex = headers.findIndex((header) => header === 'dzien' || header.includes('dzien'));
  const valueIndexes = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => header.includes('energia czynna pobrana') && header.includes('po bilansowaniu'))
    .map(({ index }) => index);

  if (dateIndex < 0 || !valueIndexes.length) {
    throw new Error('Plik XLSX nie zawiera kolumny daty lub energii pobranej po bilansowaniu');
  }

  const hourly = Array.from({ length: 24 }, () => 0);
  let totalKwh = 0;
  let rowsCount = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    const date = dateFromCell(row[dateIndex]);
    if (!date) continue;

    let rowKwh = 0;
    for (const valueIndex of valueIndexes) {
      rowKwh += numberFromCell(row[valueIndex]) ?? 0;
    }

    if (rowKwh <= 0) continue;
    date.setHours(date.getHours() - 1);
    hourly[date.getHours()] += rowKwh;
    totalKwh += rowKwh;
    rowsCount += 1;
  }

  return { totalKwh, hourly, rowsCount };
}

async function readMeasurementFile(storagePath?: string | null) {
  if (!storagePath) return null;
  const root = uploadRoot();
  const filePath = path.resolve(root, storagePath);
  if (!isInsideDirectory(filePath, root)) {
    throw new Error('Plik ENEA jest poza katalogiem uploadów');
  }
  return readFile(filePath);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const clientId = optionalString({ clientId: url.searchParams.get('clientId') }, 'clientId');
    const projectId = optionalString({ projectId: url.searchParams.get('projectId') }, 'projectId');
    if (!clientId && !projectId) return badRequest('Podaj clientId albo projectId');

    const files = await prisma.energyMeasurementFile.findMany({
      where: {
        clientId,
        projectId,
        kind: 'ACTIVE_IMPORT',
        status: 'DOWNLOADED',
      },
      include: { document: true },
      orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
      take: 36,
    });

    const latestFiles = files.slice(-12);
    const months = new Map<string, UsageMonth>();
    const warnings: string[] = [];

    for (const file of latestFiles) {
      const key = `${file.periodYear}-${String(file.periodMonth).padStart(2, '0')}`;
      const month = months.get(key) || emptyMonth(file.periodYear, file.periodMonth);
      months.set(key, month);

      try {
        const bytes = await readMeasurementFile(file.document?.storagePath || file.storagePath);
        if (!bytes) continue;
        const parsed = parseConsumptionWorkbook(bytes);
        month.totalKwh += parsed.totalKwh;
        month.sourceFiles += 1;
        for (let hour = 0; hour < 24; hour += 1) {
          month.hourly[hour] += parsed.hourly[hour] || 0;
        }
      } catch (error) {
        warnings.push(`${file.periodYear}-${String(file.periodMonth).padStart(2, '0')}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const monthRows = Array.from(months.values()).sort((a, b) => (a.year - b.year) || (a.month - b.month));
    const annualKwh = monthRows.reduce((sum, month) => sum + month.totalKwh, 0);
    const roundedMonths = monthRows.map((month) => ({
      ...month,
      totalKwh: Math.round(month.totalKwh * 100) / 100,
      sharePercent: annualKwh > 0 ? Math.round((month.totalKwh / annualKwh) * 1000) / 10 : 0,
      hourly: month.hourly.map((value) => Math.round(value * 100) / 100),
    }));

    return jsonResponse({
      ok: true,
      data: {
        annualKwh: Math.round(annualKwh * 100) / 100,
        months: roundedMonths,
        warnings,
      },
    });
  } catch (error) {
    return serverError('Nie udało się przygotować profilu zużycia', error);
  }
}
