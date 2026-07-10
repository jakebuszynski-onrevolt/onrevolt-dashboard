import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { PrismaClient } from '@prisma/client';

function loadEnvFile(fileName: string) {
  const filePath = path.join(process.cwd(), fileName);
  return fs.readFile(filePath, 'utf8')
    .then((content) => {
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
    })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
}

type MediaSeed = {
  sourcePath: string;
  kind: string;
  altText: string;
  sortOrder: number;
};

type ProductSeed = {
  sku: string;
  name: string;
  producer?: string;
  supplier?: string;
  description: string;
  powerCapacity: string;
  voltageKind: string;
  notes: string;
  sourceSheet: string;
  media: MediaSeed[];
};

const docsRoot = process.env.GRID_METER_DOCS_ROOT || 'D:\\_WindSystems\\docs';
const publicRoot = path.join(process.cwd(), 'public');
let prisma: PrismaClient | undefined;

const products: ProductSeed[] = [
  {
    sku: 'GRID-ET340',
    name: 'Carlo Gavazzi ET340 - licznik energii 3-fazowy Modbus',
    producer: 'Carlo Gavazzi',
    description: 'Trójfazowy licznik/transducer energii na szynę DIN do pomiaru kWh/kvarh import/export oraz parametrów fazowych.',
    powerCapacity: '5(65)A, 208-400 VLL AC',
    voltageKind: '3-fazowy, 3/4-przewodowy, DIN, RS485 Modbus',
    notes: 'ET340: klasa 1 kWh wg EN62053-21, energia bierna klasa 2, pomiar bezpośredni do 65A, zmienne fazowe kW/kvar/kVA/V/A/PF. Źródło: D:\\_WindSystems\\docs\\ET340.',
    sourceSheet: 'docs:ET340',
    media: [
      {
        sourcePath: path.join(docsRoot, 'ET340', 'ET340 DS ENG.pdf'),
        kind: 'datasheet',
        altText: 'ET340 datasheet',
        sortOrder: 10,
      },
      {
        sourcePath: path.join(docsRoot, 'ET340', 'EM330_EM340_ET330_ET340_CP.pdf'),
        kind: 'manual',
        altText: 'ET340 Modbus communication protocol',
        sortOrder: 20,
      },
    ],
  },
  {
    sku: 'GRID-DTS1946-4P',
    name: 'DTS1946-4P - licznik energii 3-fazowy Modbus RS485',
    description: 'Elektroniczny licznik energii 3-fazowy, 4-przewodowy, na szynę DIN, ze zdalnym odczytem przez Modbus RS485.',
    powerCapacity: '5(100)A, 3x220/380V',
    voltageKind: '3-fazowy, 4-przewodowy, DIN, RS485 Modbus RTU 9600 bps',
    notes: 'DTS1946-4P: moc i energia czynna klasa 0.5S, energia bierna klasa 2, dokładność prądu/napięcia klasa 0.2, IP54 front/IP20 tył. Źródło: D:\\_WindSystems\\docs\\DTS1946.',
    sourceSheet: 'docs:DTS1946',
    media: [
      {
        sourcePath: path.join(docsRoot, 'DTS1946', 'DTS1946.jpeg'),
        kind: 'image',
        altText: 'DTS1946 zdjęcie produktu',
        sortOrder: 10,
      },
      {
        sourcePath: path.join(docsRoot, 'DTS1946', '917_2324.pdf'),
        kind: 'datasheet',
        altText: 'DTS1946 datasheet',
        sortOrder: 20,
      },
      {
        sourcePath: path.join(docsRoot, 'DTS1946', 'DTS1946-4P-INSTRUKCJA-OBSLUGI.pdf'),
        kind: 'manual',
        altText: 'DTS1946 instrukcja obsługi',
        sortOrder: 30,
      },
    ],
  },
];

function publicUrlFor(productSku: string, fileName: string) {
  return `/uploads/catalog/products/${encodeURIComponent(productSku)}/${encodeURIComponent(fileName)}`;
}

function sanitizeFileName(fileName: string) {
  return fileName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

async function ensurePublicMedia(productSku: string, sourcePath: string) {
  await fs.access(sourcePath);
  const fileName = sanitizeFileName(path.basename(sourcePath));
  const productDir = path.join(publicRoot, 'uploads', 'catalog', 'products', productSku);
  const targetPath = path.join(productDir, fileName);
  await fs.mkdir(productDir, { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  return {
    storagePath: targetPath,
    url: publicUrlFor(productSku, fileName),
  };
}

async function main() {
  await loadEnvFile('.env.local');
  await loadEnvFile('.env');
  prisma = new PrismaClient();

  const results = [];

  for (const item of products) {
    const data = {
      sku: item.sku,
      name: item.name,
      producer: item.producer,
      supplier: item.supplier,
      category: 'LICZNIK_GRID' as any,
      description: item.description,
      powerCapacity: item.powerCapacity,
      voltageKind: item.voltageKind,
      notes: item.notes,
      sourceSheet: item.sourceSheet,
    };

    const product = await prisma.product.upsert({
      where: { sku: item.sku },
      update: data,
      create: data,
    });

    let mediaCreated = 0;
    let mediaExisting = 0;

    for (const media of item.media) {
      const stored = await ensurePublicMedia(item.sku, media.sourcePath);
      const existing = await prisma.productMedia.findFirst({
        where: {
          productId: product.id,
          url: stored.url,
        },
      });

      if (existing) {
        await prisma.productMedia.update({
          where: { id: existing.id },
          data: {
            kind: media.kind,
            storagePath: stored.storagePath,
            altText: media.altText,
            sortOrder: media.sortOrder,
          },
        });
        mediaExisting += 1;
      } else {
        await prisma.productMedia.create({
          data: {
            productId: product.id,
            kind: media.kind,
            url: stored.url,
            storagePath: stored.storagePath,
            altText: media.altText,
            sortOrder: media.sortOrder,
          },
        });
        mediaCreated += 1;
      }
    }

    results.push({
      sku: item.sku,
      productId: product.id,
      mediaCreated,
      mediaExisting,
    });
  }

  console.log(JSON.stringify({ ok: true, products: results }, null, 2));
}

main()
  .finally(async () => {
    await prisma?.$disconnect();
  });
