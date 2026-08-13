export const reformB2cTemplate = {
  key: 'REFORM_B2C',
  version: '2026_08_V2',
  width: 595,
  height: 843,
  pages: [
    { index: 0, slug: 'report', file: 'page-0-report.svg', title: 'Dane wejściowe' },
    { index: 1, slug: 'reform', file: 'page-1-reform.svg', title: 'Zakres inwestycji' },
    { index: 2, slug: 'tariffs', file: 'page-2-tariffs.svg', title: 'Taryfy i rozliczenie' },
    { index: 3, slug: 'current', file: 'page-3-current.svg', title: 'Obecny profil energetyczny' },
    { index: 4, slug: 'projected', file: 'page-4-projected.svg', title: 'Prognozowany profil energetyczny' },
  ],
} as const;

export type ReformB2cPageIndex = typeof reformB2cTemplate.pages[number]['index'];

export type SvgTextField = {
  id: string;
  value: string;
  textIndex?: number;
  x?: number;
  textAnchor?: 'start' | 'middle' | 'end';
  maxWidth?: number;
  maxLines?: number;
  minFontSize?: number;
};

export const requiredEditableIds: Record<ReformB2cPageIndex, string[]> = {
  0: [
    '#tytul', '#numer_oferty', '#imie_nazwisko', '#adres', '#mail', '#telefon',
    '#rodzaj_terenu', '#rodzaj_dachu', '#typ_budynku', '#moc_przylaczeniowa',
    '#operator_systemu_dystrybucyjnego', '#system_rozliczeniowy', '#dostawca_energii_elektrycznej',
    '#taryfa', '#rodzaj_przylacza', '#zrodlo_ciepla', '#rodzaj_ciepla',
    '#oplaty_stale_i_dystrybucyjne_kwota', '#zakup_energii_kwota', '#twoj_rachunek_kwota',
  ],
  1: [
    '_nazwa', '_numer', '_nazwa_pozycji_1_2', '_nazwa_pozycji_2_2', '_nazwa_pozycji_3_2',
    '_nazwa_pozycji_3_4', '_kwota_koszt_systemu_2', '_kwota_po_dofinansowaniach_2',
    '_kwota_nowy_rachunek', '_oszczednosc_kwota', '_kwota_aktualny_rachunek', '#wykres_oszczednosci',
  ],
  2: [
    '_nazwa', '_numer', '_taryfa', '_system_rozliczeniowy', '_taryfa_2', '_system_rozliczeniowy_2',
    '_koszt_zakupu_1kwh_aktualny_cena', '_koszt_zakupu_1kwh_nowy_cena',
    '_calkowity_rachunek_brutto_aktualny_rachunek_cena', '_calkowity_rachunek_brutto_nowy_rachunek_cena',
  ],
  3: [
    '_nazwa', '_numer', '_okres_aktualny', '_zuzycie_energii_aktualny_kwh',
    '_energia_pobrana_z_sieci_aktualny_kwh', '_energia_oddana_do_sieci_aktualny_kwh',
    '_miesiac_o_najwiekszym_zuzyciu_aktualne_data', '_miesiac_o_srednim_zuzyciu_aktualne_data',
    '_miesiac_o_srednim_zuzyciu_aktualne_data_2',
  ],
  4: [
    '_nazwa', '_numer', '_okres_aktualny', '_zuzycie_energii_aktualny_kwh',
    '_produkcja_pv_aktaulny_kwh', '_autokonsumpcja_pv_aktualny_kwh',
    '_autokonsumpcja_magazyn_aktualny_kwh', '_energia_pobrana_z_sieci_aktualny_kwh',
    '_energia_oddana_do_sieci_aktualny_kwh',
  ],
};
