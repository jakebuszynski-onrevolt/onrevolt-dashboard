import { notFound } from 'next/navigation';
import OfferWorkspacePreviewClient from './OfferWorkspacePreviewClient';

export default function OfferWorkspacePreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <OfferWorkspacePreviewClient />;
}
