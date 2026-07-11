import { notFound } from 'next/navigation';
import OfferDocument from 'components/onrevolt/OfferDocument';
import { offerInclude } from 'lib/onrevolt/offers';
import { prisma } from 'lib/onrevolt/prisma';

export default async function Page({ params }: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await params;
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: offerInclude,
  });

  if (!offer) notFound();

  const serialized = JSON.parse(JSON.stringify(offer));

  return <OfferDocument offer={serialized} showActions />;
}
