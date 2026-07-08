import CrmModulePage from 'components/onrevolt/CrmModulePage';

export default function Page() {
  return (
    <CrmModulePage
      eyebrow="Praca zespołu"
      title="Zadania i przypomnienia"
      description="Zadania dla sprzedawców, monterów, serwisu, szefów i księgowości oraz przypomnienia w panelu i email."
      workflow={['Twórz zadania z terminem i priorytetem.', 'Przypisuj odpowiedzialną osobę.', 'Dodawaj przypomnienia panelowe lub email.', 'Monitoruj opóźnienia w raportach.']}
      endpoints={['/api/tasks', '/api/reminders', '/api/notifications/email-queue']}
    />
  );
}

