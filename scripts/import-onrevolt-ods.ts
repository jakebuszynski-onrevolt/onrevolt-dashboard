import path from 'path';
import process from 'process';
import fs from 'fs';
import XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';
import { calculateConfigurationLine } from '../src/lib/onrevolt/calculator';

function loadEnvFile(fileName: string) {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    if (process.env[key]) continue;

    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const fileArgIndex = process.argv.findIndex((arg) => arg === '--file');
const sourceFile = fileArgIndex >= 0 && process.argv[fileArgIndex + 1]
  ? process.argv[fileArgIndex + 1]
  : 'E:\\Pobrane\\kalkulator dla sprzedawcy.ods';

function asNumber(value: unknown) {
  if (typeof value === 'number') return value;
  const original = String(value ?? '').trim();
  const hasPercent = original.includes('%');
  let normalized = original
    .replace(/\s/g, '')
    .replace(/[^0-9,.-]/g, '')
    .trim();
  if (!normalized) return 0;

  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastDot > lastComma
      ? normalized.replace(/,/g, '')
      : normalized.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0) {
    normalized = /^-?\d{1,3}(,\d{3})+$/.test(normalized)
      ? normalized.replace(/,/g, '')
      : normalized.replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, '');
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) throw new Error(`Nieprawidłowa liczba w ODS: ${value}`);
  return hasPercent ? n / 100 : n;
}

function categoryFromSheet(value: unknown) {
  const text = String(value || '').trim().toLowerCase();
  if (text.includes('magazyn')) return 'MAGAZYN_ENERGII';
  if (text.includes('falownik')) return 'FALOWNIK';
  if (text.includes('foto') || text.includes('panel')) return 'FOTOWOLTAIKA';
  if (text.includes('licznik') || text.includes('grid') || text.includes('meter')) return 'LICZNIK_GRID';
  if (text.includes('montaż')) return 'USLUGA_MONTAZOWA';
  if (text.includes('koszt')) return 'KOSZTY_OPERACYJNE';
  if (text.includes('monitor')) return 'MONITOROWANIE';
  if (text.includes('osprzęt') || text.includes('elektr')) return 'OSPRZET_ELEKTRONIKA';
  return 'INNE';
}

function clientTypeFromSheet(value: unknown) {
  const text = String(value || '').trim().toUpperCase();
  if (text === 'B2B') return 'B2B';
  if (text === 'B2C/B2B') return 'B2C_B2B';
  return 'B2C';
}

function cellHyperlinkTarget(sheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number) {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
  const cell = sheet[address] as XLSX.CellObject & { l?: { Target?: string } };
  const target = cell?.l?.Target;
  return typeof target === 'string' && target.trim() ? target.trim() : undefined;
}

async function importProducts(workbook: XLSX.WorkBook, sheetName: string) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { sheetName, rows: 0, imported: 0, priceRecordsCreated: 0, priceRecordsUnchanged: 0 };

  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: '' });
  let imported = 0;
  let priceRecordsCreated = 0;
  let priceRecordsUnchanged = 0;
  for (let index = 2; index < rows.length; index += 1) {
    const row = rows[index];
    const name = String(row[1] || '').trim();
    if (!name) continue;

    const isPv = sheetName === 'ProduktyPV';
    const sku = `ODS-${sheetName}-${String(row[0] || index + 1).replace(/\s+/g, '-')}`;
    const supplierUrl = cellHyperlinkTarget(sheet, index, 1);
    const purchaseNet = asNumber(isPv ? row[7] : row[10]);
    const operatingCostNet = asNumber(isPv ? row[10] : row[14]);
    const purchaseVatRate = asNumber(isPv ? row[8] : row[12]);
    const marginRate = asNumber(isPv ? row[12] : row[16]);
    const saleVatRate = asNumber(isPv ? row[15] : row[19]);

    calculateConfigurationLine({
      quantity: 1,
      unitPurchaseNet: purchaseNet,
      purchaseVatRate,
      operatingCostNet,
      marginRate,
      saleVatRate,
    });

    if (apply) {
      const product = await prisma.product.upsert({
        where: { sku },
        update: {
          name,
          availability: isPv ? undefined : String(row[2] || '').trim() || undefined,
          producer: String(isPv ? row[3] : row[3] || '').trim() || undefined,
          supplier: isPv ? String(row[3] || '').trim() || undefined : undefined,
          supplierUrl,
          category: categoryFromSheet(isPv ? row[2] : row[4]) as any,
          clientType: isPv ? undefined : clientTypeFromSheet(row[5]) as any,
          description: String(isPv ? row[4] : row[6] || '').trim() || undefined,
          powerCapacity: String(isPv ? row[5] : row[7] || '').trim() || undefined,
          voltageKind: isPv ? undefined : String(row[8] || '').trim() || undefined,
          notes: String(isPv ? row[21] : row[25] || '').trim() || undefined,
          sourceSheet: sheetName,
          sourceRow: index + 1,
        },
        create: {
          sku,
          name,
          availability: isPv ? undefined : String(row[2] || '').trim() || undefined,
          producer: String(isPv ? row[3] : row[3] || '').trim() || undefined,
          supplier: isPv ? String(row[3] || '').trim() || undefined : undefined,
          supplierUrl,
          category: categoryFromSheet(isPv ? row[2] : row[4]) as any,
          clientType: isPv ? undefined : clientTypeFromSheet(row[5]) as any,
          description: String(isPv ? row[4] : row[6] || '').trim() || undefined,
          powerCapacity: String(isPv ? row[5] : row[7] || '').trim() || undefined,
          voltageKind: isPv ? undefined : String(row[8] || '').trim() || undefined,
          notes: String(isPv ? row[21] : row[25] || '').trim() || undefined,
          sourceSheet: sheetName,
          sourceRow: index + 1,
        },
      });

      const latestPrice = await prisma.productPrice.findFirst({
        where: { productId: product.id },
        orderBy: { validFrom: 'desc' },
      });

      const priceChanged = !latestPrice
        || Number(latestPrice.purchaseNet) !== purchaseNet
        || Number(latestPrice.currentPurchaseNet) !== purchaseNet
        || Number(latestPrice.purchaseVatRate) !== purchaseVatRate
        || Number(latestPrice.operatingCostNet) !== operatingCostNet
        || Number(latestPrice.marginRate) !== marginRate
        || Number(latestPrice.saleVatRate) !== saleVatRate;

      if (priceChanged) {
        await prisma.productPrice.create({
          data: {
            productId: product.id,
            purchaseNet,
            currentPurchaseNet: purchaseNet,
            purchaseVatRate,
            operatingCostNet,
            marginRate,
            saleVatRate,
          },
        });
        priceRecordsCreated += 1;
      } else {
        priceRecordsUnchanged += 1;
      }
    }
    imported += 1;
  }

  return { sheetName, rows: rows.length, imported, priceRecordsCreated, priceRecordsUnchanged };
}

async function main() {
  const absolute = path.resolve(sourceFile);
  const workbook = XLSX.readFile(absolute, { cellFormula: true, cellDates: true });
  const productResults = [
    await importProducts(workbook, 'Produkty'),
    await importProducts(workbook, 'ProduktyPV'),
  ];
  const configurationSheets = workbook.SheetNames.filter((name) => name.startsWith('Konfiguracja '));
  const reviewSheets = workbook.SheetNames.filter((name) => name.includes('Umowy') || name.includes('Lista klientów'));

  console.log(JSON.stringify({
    ok: true,
    mode: apply ? 'apply' : 'dry-run',
    file: absolute,
    productResults,
    configurationSheets,
    migrationOnlySheets: reviewSheets,
    note: 'Arkusze klientów i umów są materiałem migracyjnym. Rekordy z #REF! wymagają ręcznej weryfikacji.',
  }, null, 2));
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
