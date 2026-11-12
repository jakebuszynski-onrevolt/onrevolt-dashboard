import { notFound } from 'next/navigation';
import OfferDocument from 'components/onrevolt/OfferDocument';
import { offerInclude } from 'lib/onrevolt/offers';
import { prisma } from 'lib/onrevolt/prisma';
import { requireStaffPage } from 'lib/onrevolt/staff-page';

export default async function Page({ params }: { params: Promise<{ offerId: string }> }) {
  await requireStaffPage('offers.manage');
  const { offerId } = await params;
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: offerInclude,
  });

  if (!offer) notFound();

  const serialized = JSON.parse(JSON.stringify(offer));

  return <OfferDocument offer={serialized} showActions />;
}
