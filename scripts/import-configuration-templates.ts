import fs from 'fs';
import path from 'path';
import process from 'process';
import XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';

type ParsedTemplateItem = {
  position: number;
  productId?: string;
  description: string;
  quantity: number;
  role: string;
  supplyMode: string;
  unitPurchaseNet: number;
  purchaseVatRate: number;
  operatingCostNet: number;
  marginRate: number;
  saleVatRate: number;
  sourceSheet: string;
  sourceRow: number;
  requiresReview: boolean;
  notes?: string;
};

type ParsedTemplate = {
  name: string;
  kind: string;
  clientType: string;
  roofType?: string;
  goal: string;
  powerKw?: number;
  capacityKwh?: number;
  sortOrder: number;
  sourceSheet: string;
  sourceRange: string;
  requiresExistingPv: boolean;
  requiresExistingInverter: boolean;
  notes?: string;
  items: ParsedTemplateItem[];
};

type ProductLookup = {
  id: string;
  name: string;
  category: string;
  producer?: string | null;
};

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

function cellText(sheet: XLSX.WorkSheet, rowIndex: number, columnIndex: number) {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
  const cell = sheet[address] as XLSX.CellObject | undefined;
  if (!cell) return '';
  return String(cell.w ?? cell.v ?? '').trim();
}

function usedRange(sheet: XLSX.WorkSheet) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  return range;
}

function asNumber(value: unknown) {
  if (typeof value === 'number') return value;
  const original = String(value ?? '').trim();
  if (!original) return 0;

  const hasPercent = original.includes('%');
  let normalized = original
    .replace(/\s/g, '')
    .replace(/zł/gi, '')
    .replace(/[^0-9,.-]/g, '');
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

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Nieprawidłowa liczba w ODS: ${value}`);
  }
  return hasPercent ? parsed / 100 : parsed;
}

function normalizeText(value: unknown) {
  return String(value ?? '')
    .replace(/[Łł]/g, 'l')
    .replace(/[Đđ]/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactKey(value: unknown) {
  return normalizeText(value).replace(/\s+/g, '');
}

function isIntegerPosition(value: string) {
  if (!value) return false;
  const numeric = asNumber(value);
  return Number.isInteger(numeric) && numeric > 0 && /^\d+$/.test(String(value));
}

function categoryFromText(value: string) {
  const text = normalizeText(value);
  if (text.includes('magazyn')) return 'MAGAZYN_ENERGII';
  if (text.includes('falownik')) return 'FALOWNIK';
  if (text.includes('foto') || text.includes('panel')) return 'FOTOWOLTAIKA';
  if (text.includes('licznik') || text.includes('grid') || text.includes('meter')) return 'LICZNIK_GRID';
  if (text.includes('montaz') || text.includes('usluga montazowa')) return 'USLUGA_MONTAZOWA';
  if (text.includes('koszt') || text.includes('zglosz') || text.includes('projekt')) return 'KOSZTY_OPERACYJNE';
  if (text.includes('monitor')) return 'MONITOROWANIE';
  if (text.includes('osprzet') || text.includes('elektr')) return 'OSPRZET_ELEKTRONIKA';
  return 'INNE';
}

function roleFromItem(description: string, category: string) {
  const text = normalizeText(description);
  if (text.includes('montaz')) return 'LABOR';
  if (text.includes('przewod') || text.includes('okablow')) return 'CABLING';
  if (text.includes('rozdziel') || text.includes('ppoz') || text.includes('obudowa')) return 'PROTECTION';
  if (text.includes('re flow') || text.includes('reflow') || text.includes('monitor') || text.includes('stacja pogod')) return 'MONITORING';
  if (text.includes('logistyka') || text.includes('transport')) return 'LOGISTICS';
  if (text.includes('projekt')) return 'DESIGN';
  if (text.includes('zglosz') || text.includes('osd')) return 'FORMALITIES';
  if (category === 'USLUGA_MONTAZOWA') return 'LABOR';
  if (category === 'KOSZTY_OPERACYJNE') return 'FORMALITIES';
  if (category === 'FOTOWOLTAIKA' || category === 'FALOWNIK' || category === 'MAGAZYN_ENERGII') return 'MAIN_EQUIPMENT';
  if (category === 'MONITOROWANIE' || category === 'SYSTEM_MONITORUJACY') return 'MONITORING';
  if (category === 'OSPRZET_ELEKTRONIKA') return 'ACCESSORY';
  return 'OTHER';
}

function supplyModeFromRole(role: string) {
  return role === 'LABOR' || role === 'FORMALITIES' || role === 'DESIGN' || role === 'LOGISTICS'
    ? 'SERVICE_ONLY'
    : 'ONREVOLT_SUPPLIED';
}

function sheetMeta(sheetName: string) {
  const normalized = normalizeText(sheetName);
  const isPv = normalized.includes('pv');
  const isStorage = normalized.includes('magazyn');
  const isFlat = normalized.includes('plaski');
  const isSloped = normalized.includes('skosny');
  const clientType = normalized.includes('b2b') ? 'B2B' : normalized.includes('b2c') ? 'B2C' : 'UNKNOWN';

  return {
    isPv,
    isStorage,
    kind: isPv ? (isFlat ? 'PV_DACH_PLASKI' : 'PV_DACH_SKOSNY') : isStorage ? 'MAGAZYN' : 'MIXED',
    roofType: isFlat ? 'FLAT' : isSloped ? 'SLOPED' : 'UNKNOWN',
    clientType,
    goal: isPv ? 'NEW_PV' : isStorage ? 'STORAGE_RETROFIT' : 'MIXED',
  };
}

function extractFirstNumber(text: string, unit: 'kw' | 'kwh') {
  const normalized = normalizeText(text).replace(/,/g, '.');
  const regex = unit === 'kwh'
    ? /(\d+(?:[.,]\d+)?)\s*kwh/i
    : /(\d+(?:[.,]\d+)?)\s*kwp?/i;
  const match = normalized.match(regex);
  return match ? asNumber(match[1]) : undefined;
}

function findProduct(products: ProductLookup[], itemName: string, producer: string) {
  const itemKey = compactKey(itemName);
  const producerKey = compactKey(producer);
  if (!itemKey) return undefined;

  const exact = products.find((product) => compactKey(product.name) === itemKey);
  if (exact) return exact;

  const withProducer = products.find((product) => {
    const productKey = compactKey(product.name);
    const productProducer = compactKey(product.producer || '');
    return productKey.includes(itemKey)
      || itemKey.includes(productKey)
      || (producerKey && productProducer === producerKey && productKey.split(' ').some((part) => itemKey.includes(part)));
  });
  if (withProducer) return withProducer;

  return products.find((product) => {
    const productKey = compactKey(product.name);
    return productKey.length > 4 && (productKey.includes(itemKey) || itemKey.includes(productKey));
  });
}

function percentageIndexes(sheet: XLSX.WorkSheet, rowIndex: number) {
  const range = usedRange(sheet);
  const indexes: number[] = [];
  for (let columnIndex = 0; columnIndex <= range.e.c; columnIndex += 1) {
    if (cellText(sheet, rowIndex, columnIndex).includes('%')) {
      indexes.push(columnIndex);
    }
  }
  return indexes;
}

function firstNonEmptyText(sheet: XLSX.WorkSheet, rowIndex: number, startColumn: number, endColumn: number) {
  for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
    const text = cellText(sheet, rowIndex, columnIndex);
    if (text) return text;
  }
  return '';
}

function parseTemplateRow(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  rowIndex: number,
  linePosition: number,
  isBlockStart: boolean,
  isPv: boolean,
  products: ProductLookup[],
): ParsedTemplateItem | undefined {
  const percentages = percentageIndexes(sheet, rowIndex);
  if (percentages.length < 3) return undefined;

  const purchaseVatIndex = percentages[0];
  const marginIndex = percentages[1];
  const saleVatIndex = percentages[2];
  const quantityIndex = isPv ? purchaseVatIndex - 3 : purchaseVatIndex - 2;
  const unitPurchaseIndex = isPv ? purchaseVatIndex - 2 : purchaseVatIndex - 1;
  const operatingCostIndex = marginIndex - 2;

  const itemName = isBlockStart
    ? cellText(sheet, rowIndex, 2) || cellText(sheet, rowIndex, 1)
    : cellText(sheet, rowIndex, 1) || cellText(sheet, rowIndex, 2);
  if (!itemName) return undefined;

  const producer = isBlockStart
    ? cellText(sheet, rowIndex, 3)
    : cellText(sheet, rowIndex, 2);
  const categoryText = isBlockStart
    ? cellText(sheet, rowIndex, 4)
    : firstNonEmptyText(sheet, rowIndex, 3, 4);
  const category = categoryFromText(categoryText);
  const role = roleFromItem(itemName, category);
  const product = findProduct(products, itemName, producer);
  const quantity = asNumber(cellText(sheet, rowIndex, quantityIndex));
  const unitPurchaseNet = asNumber(cellText(sheet, rowIndex, unitPurchaseIndex));
  const purchaseVatRate = asNumber(cellText(sheet, rowIndex, purchaseVatIndex));
  const operatingCostNet = asNumber(cellText(sheet, rowIndex, operatingCostIndex));
  const marginRate = asNumber(cellText(sheet, rowIndex, marginIndex));
  const saleVatRate = asNumber(cellText(sheet, rowIndex, saleVatIndex));
  const requiresReview = !product && ['MAIN_EQUIPMENT', 'ACCESSORY', 'CABLING', 'PROTECTION', 'MONITORING'].includes(role);

  return {
    position: linePosition,
    productId: product?.id,
    description: itemName,
    quantity,
    role,
    supplyMode: supplyModeFromRole(role),
    unitPurchaseNet,
    purchaseVatRate,
    operatingCostNet,
    marginRate,
    saleVatRate,
    sourceSheet: sheetName,
    sourceRow: rowIndex + 1,
    requiresReview,
    notes: requiresReview
      ? `Nie znaleziono jednoznacznego produktu w katalogu. Kategoria z ODS: ${categoryText || 'brak'}`
      : undefined,
  };
}

function parseTemplates(workbook: XLSX.WorkBook, products: ProductLookup[]) {
  const templates: ParsedTemplate[] = [];
  const configurationSheets = workbook.SheetNames.filter((name) => normalizeText(name).startsWith('konfiguracja '));

  for (const sheetName of configurationSheets) {
    const sheet = workbook.Sheets[sheetName];
    const meta = sheetMeta(sheetName);
    const range = usedRange(sheet);
    let current: ParsedTemplate | undefined;
    let currentStartRow = 0;
    let linePosition = 1;

    const finishCurrent = (endRow: number) => {
      if (!current) return;
      current.sourceRange = `${currentStartRow + 1}:${endRow + 1}`;
      if (current.items.length > 0) templates.push(current);
      current = undefined;
    };

    for (let rowIndex = 2; rowIndex <= range.e.r; rowIndex += 1) {
      const rawPosition = cellText(sheet, rowIndex, 0);
      const isBlockStart = isIntegerPosition(rawPosition);
      const rowHasPrice = percentageIndexes(sheet, rowIndex).length >= 3;
      const rowName = cellText(sheet, rowIndex, isBlockStart ? 2 : 1);

      if (isBlockStart) {
        finishCurrent(rowIndex - 1);
        currentStartRow = rowIndex;
        linePosition = 1;
        const title = cellText(sheet, rowIndex, 1) || `Wariant ${rawPosition}`;
        const techText = cellText(sheet, rowIndex, meta.isPv ? 6 : meta.isStorage && meta.clientType === 'B2C' ? 7 : 6);
        const combined = `${title} ${techText}`;
        current = {
          name: title,
          kind: meta.kind,
          clientType: meta.clientType,
          roofType: meta.roofType,
          goal: meta.goal,
          powerKw: meta.isPv ? extractFirstNumber(combined, 'kw') : extractFirstNumber(title, 'kw'),
          capacityKwh: meta.isStorage ? extractFirstNumber(combined, 'kwh') : undefined,
          sortOrder: asNumber(rawPosition),
          sourceSheet: sheetName,
          sourceRange: '',
          requiresExistingPv: meta.isStorage,
          requiresExistingInverter: false,
          notes: meta.isStorage
            ? 'Szablon magazynu energii. Przy kliencie z własnym falownikiem sprawdź zgodność przed ofertą.'
            : undefined,
          items: [],
        };
      }

      if (!current || !rowHasPrice || !rowName) continue;

      const item = parseTemplateRow(sheet, sheetName, rowIndex, linePosition, isBlockStart, meta.isPv, products);
      if (item) {
        current.items.push(item);
        linePosition += 1;
      }
    }

    finishCurrent(range.e.r);
  }

  return templates;
}

function findReferenceErrors(workbook: XLSX.WorkBook) {
  const errors: Array<{ sheet: string; cell: string; value: string }> = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    for (const address of Object.keys(sheet)) {
      if (address.startsWith('!')) continue;
      const cell = sheet[address] as XLSX.CellObject | undefined;
      const value = String(cell?.w ?? cell?.v ?? cell?.f ?? '');
      if (value.includes('#REF!')) {
        errors.push({ sheet: sheetName, cell: address, value });
      }
    }
  }
  return errors;
}

async function applyTemplates(templates: ParsedTemplate[]) {
  let createdOrUpdated = 0;
  let itemsCreated = 0;

  for (const template of templates) {
    await prisma.$transaction(async (tx) => {
      const saved = await tx.configurationTemplate.upsert({
        where: {
          sourceSheet_sourceRange: {
            sourceSheet: template.sourceSheet,
            sourceRange: template.sourceRange,
          },
        } as any,
        update: {
          name: template.name,
          kind: template.kind as any,
          clientType: template.clientType as any,
          roofType: template.roofType as any,
          goal: template.goal as any,
          powerKw: template.powerKw,
          capacityKwh: template.capacityKwh,
          sortOrder: template.sortOrder,
          requiresExistingPv: template.requiresExistingPv,
          requiresExistingInverter: template.requiresExistingInverter,
          notes: template.notes,
        },
        create: {
          name: template.name,
          kind: template.kind as any,
          clientType: template.clientType as any,
          roofType: template.roofType as any,
          goal: template.goal as any,
          powerKw: template.powerKw,
          capacityKwh: template.capacityKwh,
          sortOrder: template.sortOrder,
          requiresExistingPv: template.requiresExistingPv,
          requiresExistingInverter: template.requiresExistingInverter,
          sourceSheet: template.sourceSheet,
          sourceRange: template.sourceRange,
          notes: template.notes,
        },
      });

      await tx.configurationTemplateItem.deleteMany({ where: { templateId: saved.id } });
      if (template.items.length > 0) {
        await tx.configurationTemplateItem.createMany({
          data: template.items.map((item) => ({
            templateId: saved.id,
            productId: item.productId,
            position: item.position,
            description: item.description,
            quantity: item.quantity,
            role: item.role as any,
            supplyMode: item.supplyMode as any,
            unitPurchaseNet: item.unitPurchaseNet,
            purchaseVatRate: item.purchaseVatRate,
            operatingCostNet: item.operatingCostNet,
            marginRate: item.marginRate,
            saleVatRate: item.saleVatRate,
            sourceSheet: item.sourceSheet,
            sourceRow: item.sourceRow,
            requiresReview: item.requiresReview,
            notes: item.notes,
          })),
        });
        itemsCreated += template.items.length;
      }
    });

    createdOrUpdated += 1;
  }

  return { createdOrUpdated, itemsCreated };
}

async function main() {
  const absolute = path.resolve(sourceFile);
  const workbook = XLSX.readFile(absolute, { cellFormula: true, cellDates: true, cellNF: true });
  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      category: true,
      producer: true,
    },
  });
  const templates = parseTemplates(workbook, products);
  const referenceErrors = findReferenceErrors(workbook);
  const reviewItems = templates.flatMap((template) => template.items.filter((item) => item.requiresReview));
  const applied = apply ? await applyTemplates(templates) : undefined;

  console.log(JSON.stringify({
    ok: true,
    mode: apply ? 'apply' : 'dry-run',
    file: absolute,
    templates: templates.length,
    templateItems: templates.reduce((sum, template) => sum + template.items.length, 0),
    reviewItems: reviewItems.length,
    referenceErrors,
    applied,
    preview: templates.slice(0, 8).map((template) => ({
      name: template.name,
      kind: template.kind,
      clientType: template.clientType,
      roofType: template.roofType,
      goal: template.goal,
      items: template.items.length,
      reviewItems: template.items.filter((item) => item.requiresReview).length,
    })),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
