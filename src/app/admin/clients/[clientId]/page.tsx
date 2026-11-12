import ClientsWorkspaceRouter from 'components/onrevolt/ClientsWorkspaceRouter';

export default async function Page({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;

  return <ClientsWorkspaceRouter clientId={clientId} />;
}
