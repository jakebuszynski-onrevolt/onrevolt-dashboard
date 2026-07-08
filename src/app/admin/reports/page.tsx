import CrmModulePage from 'components/onrevolt/CrmModulePage';

export default function Page() {
  return (
    <CrmModulePage
      eyebrow="Raporty"
      title="Raporty"
      description="Widok etapów, marż, zysków, zadań po terminie, montaży, źródeł leadów i dokumentów wymagających reakcji."
      workflow={['Czytaj dane z lokalnej bazy.', 'Segmentuj po etapie, roli, sprzedawcy i terminie.', 'Pokazuj zysk i VAT z konfiguracji.', 'Wykrywaj projekty bez kolejnego zadania.']}
      endpoints={['/api/crm/projects', '/api/configurations', '/api/tasks']}
    />
  );
}

