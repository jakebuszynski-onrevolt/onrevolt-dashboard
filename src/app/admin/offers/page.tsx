import CrmModulePage from 'components/onrevolt/CrmModulePage';

export default function Page() {
  return (
    <CrmModulePage
      eyebrow="Sprzedaż"
      title="Oferty i umowy"
      description="Oferty, akceptacje, umowy, zaliczki, statusy i dokumenty powiązane z projektem klienta."
      workflow={['Utwórz ofertę z konfiguracji.', 'Zapisz wersję oferty i termin ważności.', 'Po akceptacji utwórz umowę.', 'Przekaż projekt do montażu i dokumentów OSD.']}
      endpoints={['/api/offers', '/api/contracts', '/api/documents/upload']}
    />
  );
}

