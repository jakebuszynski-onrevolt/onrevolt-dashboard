import ClientProfile from 'components/onrevolt/ClientProfile';

export default async function Page({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;

  return <ClientProfile clientId={clientId} />;
}
