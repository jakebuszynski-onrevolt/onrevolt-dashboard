import CrmModulePage from 'components/onrevolt/CrmModulePage';

export default function Page() {
  return (
    <CrmModulePage
      eyebrow="Dokumenty"
      title="Dokumenty"
      description="Faktury za prąd, dokumenty Enea o zużyciu i produkcji, umowy, oferty, protokoły, zdjęcia i pliki Re."
      workflow={['Wyślij dokument na serwer.', 'Powiąż go z klientem, projektem, ofertą, umową lub montażem.', 'Zapisz metadane i SHA-256.', 'Udostępnij klientowi tylko jawnie oznaczone pliki.']}
      endpoints={['/api/documents', '/api/documents/upload']}
    />
  );
}

