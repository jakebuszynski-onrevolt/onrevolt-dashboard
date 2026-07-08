import CrmModulePage from 'components/onrevolt/CrmModulePage';

export default function Page() {
  return (
    <CrmModulePage
      eyebrow="Realizacja"
      title="Montaże"
      description="Planowanie montażu, ekipy, terminy, protokoły, zdjęcia i lista realnie zamontowanych urządzeń."
      workflow={['Przyjmij projekt po umowie i zaliczce.', 'Zaplanuj termin i ekipę.', 'Dodaj zdjęcia oraz protokół.', 'Zapisz numery seryjne i parametry urządzeń.']}
      endpoints={['/api/installations', '/api/installed-devices', '/api/documents/upload']}
    />
  );
}

