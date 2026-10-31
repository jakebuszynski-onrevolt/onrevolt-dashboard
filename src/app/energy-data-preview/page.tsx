import { notFound } from 'next/navigation';
import EnergyDataPreview from './EnergyDataPreview';

export default function EnergyDataPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <EnergyDataPreview />;
}
