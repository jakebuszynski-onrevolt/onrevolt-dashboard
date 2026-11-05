import { notFound } from 'next/navigation';
import ClientOverviewPreview from './ClientOverviewPreview';

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <ClientOverviewPreview />;
}
