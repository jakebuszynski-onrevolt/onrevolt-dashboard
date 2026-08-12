import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

async function main() {
  const [{ generateOfferPdf }, { offerInclude }, { prisma }] = await Promise.all([
    import('../src/lib/onrevolt/offer-pdf'),
    import('../src/lib/onrevolt/offers'),
    import('../src/lib/onrevolt/prisma'),
  ]);
  const offerId = process.argv[2]?.trim();
  const offer = offerId
    ? await prisma.offer.findUnique({ where: { id: offerId }, include: offerInclude })
    : await prisma.offer.findFirst({
      where: { project: { clientType: 'B2C' } },
      include: offerInclude,
      orderBy: { updatedAt: 'desc' },
    });

  if (!offer) throw new Error('Nie znaleziono lokalnej oferty B2C do testu PDF');
  const outputDirectory = path.join(process.cwd(), 'tmp', 'pdfs');
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `offer-${offer.id}.pdf`);
  const bytes = await generateOfferPdf(offer);
  await writeFile(outputPath, bytes);
  console.log(JSON.stringify({ offerId: offer.id, outputPath, sizeBytes: bytes.length }));
  await prisma.$disconnect();
}

main();
