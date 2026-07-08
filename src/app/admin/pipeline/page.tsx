import CrmModulePage from 'components/onrevolt/CrmModulePage';

export default function Page() {
  return (
    <CrmModulePage
      eyebrow="Lejek"
      title="Lejek / Etapy"
      description="Etapy od zainteresowania, przez kalkulację i ofertę, po montaż, OSD, protokół oraz serwis."
      workflow={['Utrzymuj kanoniczne etapy w lokalnej bazie.', 'Mapuj stage z Pipedrive do etapów lokalnych.', 'Filtruj klientów po statusie, właścicielu i terminach.', 'Raportuj przestoje oraz zadania po terminie.']}
      endpoints={['/api/crm/stages', '/api/crm/projects']}
      primaryHref="/admin/clients"
      primaryLabel="Klienci w etapach"
    />
  );
}

