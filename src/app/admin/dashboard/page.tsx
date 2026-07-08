import CrmModulePage from 'components/onrevolt/CrmModulePage';

export default function Page() {
  return (
    <CrmModulePage
      eyebrow="onRevolt CRM"
      title="Dashboard obsługi"
      description="Centrum pracy zespołu: aktywne etapy, zadania, konfiguracje, montaże, dokumenty i kolejka synchronizacji."
      metrics={[
        { label: 'Źródło prawdy', value: 'Własna baza', tone: 'purple' },
        { label: 'Pipedrive', value: 'Import + sync', tone: 'blue' },
        { label: 'Alerty', value: 'Panel + email', tone: 'green' },
        { label: 'Pliki', value: 'Serwer + DB', tone: 'orange' },
      ]}
      workflow={[
        'Lead lub klient trafia do lokalnej bazy.',
        'Sprzedawca uzupełnia dane i tworzy konfigurację.',
        'Oferta przechodzi do umowy, zaliczki, montażu i OSD.',
        'Po montażu zapisywane są urządzenia, dokumenty i dalszy serwis.',
      ]}
      endpoints={['/api/crm/clients', '/api/tasks', '/api/reminders', '/api/integrations/pipedrive/import']}
      primaryHref="/admin/clients"
      primaryLabel="Otwórz klientów"
    />
  );
}

