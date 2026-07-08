import CrmModulePage from 'components/onrevolt/CrmModulePage';

export default function Page() {
  return (
    <CrmModulePage
      eyebrow="Serwis"
      title="Serwis"
      description="Obsługa po montażu: zgłoszenia, zadania, dokumenty, urządzenia zamontowane i historia działań."
      workflow={['Zarejestruj zgłoszenie lub zadanie serwisowe.', 'Powiąż je z klientem, projektem i urządzeniem.', 'Dodaj zdjęcia oraz notatki z wizyty.', 'Zamknij zgłoszenie z historią audytu.']}
      endpoints={['/api/tasks', '/api/installed-devices', '/api/documents']}
    />
  );
}

