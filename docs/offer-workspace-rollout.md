# Nowy kreator oferty: stan integracji

Stan: 2026-10-29. Wdrożenie testowe dostępne obok dotychczasowego procesu.
Nowy kreator nie finalizuje jeszcze oferty i nie generuje produkcyjnego PDF.

## Włączanie

`NEXT_PUBLIC_OFFER_WORKSPACE_ENABLED=1` podczas builda pokazuje przycisk nowego
kreatora w etapie Oferta profilu klienta. Domyślnie pozostaje poprzedni proces.
Nowy edytor i jego API wymagają `offers.manage` oraz `energy.manage`, a zakres
projektów nadal wynika z uprawnień pracownika. Ceny wymagają `pricing.read`.

Przed uruchomieniem API potrzebna jest addytywna migracja
`20261029180000_offer_workspace`. Nie tworzy stacji EMS i nie zmienia tabel
pomiarowych, istniejących konfiguracji ani utrwalonych ofert.

## Zaimplementowane

- Pięć kroków edytora, dane projektu i rzeczywiste zestawy z katalogu.
- Osobny szkic `OfferWorkspace`, rewizja, kontrola konfliktu i log audytowy.
- Odczyt plików ENEA projektu/PPE bez stacji; kontrola rozmiaru, SHA-256,
  ścieżki uploadu, kierunku energii i zakresu miesiąca.
- Kanoniczne interwały UTC z lokalnym czasem Europe/Warsaw. Zachowanie obu
  godzin zmiany czasu i odrzucanie sprzecznych oznaczeń.
- Moduł kandydatów z istniejących wersji szablonów i cen sprzedaży, bez
  wymyślanych pojemności. Nieznana zgodność urządzeń wymaga przeglądu.
- Wersjonowane reguły finansowania PME2 i ulgi termomodernizacyjnej z jawną
  kwalifikowalnością. Potencjalna dotacja nie jest gwarantowaną wypłatą.
- Oddzielny moduł rankingu czasu zwrotu i korzyści długoterminowych.
  Ranking używa dokładnego czasu, prezentacja lat może stosować podłogę.
- Dziesięć niezmienionych źródłowych SVG w prywatnym katalogu
  `assets/offer-templates/REFORM_B2C/2026_10_V3`, kontrola hashy i mapa tekstów.
- Izolowany diagnostyczny runner RE bez dostępu do bazy, sieci, stacji i
  sterowania. Testy bilansu energii oraz limitów mocy AC.

## Zweryfikowane dane referencyjne

Test na pobranej tylko do odczytu kopii 24 plików docelowego projektu:
8760 godzin, od października 2025 do września 2026, bez brakujących miesięcy
ani kierunków. Pobór 13 530,737 kWh, eksport 5 835,751 kWh. To nie jest jeszcze
całkowite zużycie budynku z PV. Weryfikacja sum kontrolnych i rozmiarów: 24/24.

Potwierdzone przez użytkownika założenia do oferty: istniejące PV 9,9 kWp,
nachylenie 40°, azymut 170°. Nie wpisano ich automatycznie do działającej stacji.
Dane klienta i skrypty diagnostyczne znajdują się wyłącznie w ignorowanym `.local`.

## Bramy przed produkcją

1. Podłączyć godzinowe wyniki istniejącego modelu PV oraz wspólne odtwarzanie
   zużycia budynku z importu, eksportu i PV. Nie nazywać importu z sieci zużyciem.
2. Rozstrzygać historyczną taryfę według daty i taryfę scenariusza oddzielnie;
   uwzględnić opłaty stałe, system net-metering i zasady depozytu net-billing.
3. Zintegrować ranking z kompletnymi obliczeniami RE. Sam runner jest nadal
   `DIAGNOSTIC_ONLY`; nie wolno publikować z niego czasu zwrotu.
4. Przenieść zweryfikowaną poprawkę sprawności do wspólnego źródła RE i
   potwierdzić zgodność wyników. Lokalna kopia diagnostyczna nie jest jeszcze
   wdrożona na dashboardzie. Kontrakt jednostek i hash są w README runtime.
5. Dodać pełne dane kwalifikowalności i jawne scenariusze finansowania.
   Nie odejmować niepotwierdzonych kwot jako gwarantowanych wpływów.
6. Połączyć wynik z istniejącym tworzeniem konfiguracji i wersji `Offer`.
   Finalizacja ma być idempotentna, a zaakceptowane dokumenty niezmienne.
7. Dokończyć mapowanie wyników RE, cen i obrazów do SVG. Podgląd renderuje już
   10 oryginalnych stron, dane klienta, miesięczne i dobowe pomiary, opis oraz
   wybrane pozycje. Fonty są osadzone, brakujące wartości jawnie oznaczone.
8. Wykonać porównanie dziesięciu stron z wzorem oraz testy PDF, druku A4,
   desktopu i telefonu. Nie podłączać niekompletnego renderera do `/pdf`.
9. Przed pełnym uruchomieniem sprzedażowym wykonać kopię zmienianych plików i odpowiednich małych tabel,
   migrację, build, restart i kontrolę produkcyjną. Bez kopii ogromnej tabeli
   pomiarowej. Kopia poprzednich plików w `D:\Strona OVH 2023\var\www\vhosts\__backup`,
   lokalne lustro w odpowiadającym katalogu domeny. Po uploadzie odczytać SHA-256.

## Regresje

`npm run test:crm`, osobno test komponentu
`npx tsx --test src/components/onrevolt/OfferWorkspacePanel.test.ts`,
`npx tsc --noEmit --pretty false`, `npm run lint`, `npm run build`.
Podglądy testowe i zrzuty ekranu nie są trasami publicznymi aplikacji.

### Wyniki lokalne 2026-10-29

- Pełny zestaw CRM: 568/568 testów; testy pomocników komponentu: 4/4.
- TypeScript, walidacja schematu Prisma i produkcyjny build zakończone poprawnie.
  Lint ma dwa istniejące ostrzeżenia poza nowym edytorem.
- Playwright: 11 wariantów pięciu kroków na desktopie i telefonie, w tym brak
  eksportu w jednym miesiącu; bez błędów konsoli i poziomego przepełnienia strony.
- Dodatkowy test przeglądarkowy potwierdził zachowanie tekstu dopisanego podczas
  zapisu, aktualizację rewizji i wyczyszczenie szkicu lokalnego po kolejnym zapisie.
  Konflikt 409 i nieudane odświeżenie zachowują lokalne dane; udane odświeżenie
  pozwala kontynuować zapis od aktualnej rewizji.
- Testy przeglądarkowe korzystają z lokalnego fixture i mockowanego API, nie
  potwierdzają zapisu w bazie produkcyjnej. Trasa `/offer-workspace-preview`
  jest niedostępna w trybie produkcyjnym.
- Migracji nie zastosowano na produkcji. Nie wykonano wdrożenia ani commita.

### Zakres wdrożenia testowego 2026-10-29

Użytkownik zlecił uruchomienie nowego kreatora uniwersalnie dla wszystkich
klientów, z kontrolą działania na danych Szymona Kujatha. Pozostaje osobnym przyciskiem w etapie Oferta; stary proces,
utrwalone dokumenty, dashboard RE i sterowanie EMS pozostają bez zmian.
Lista taryf, konfiguracje i pomiary pochodzą z istniejących źródeł produkcyjnych.
Pełne rozliczenie, optymalizacja, finansowanie, finalizacja oraz PDF nadal
wymagają bram opisanych powyżej. Sam dostęp do bazy nie zastępuje tych obliczeń.

Kontrola przed wdrożeniem: 588/588 testów CRM, 18 testów renderera, tras i
pomocników UI, TypeScript oraz build. Skrypty i manifest wdrożenia są w
ignorowanym `.codex-deploy/offer-workspace-20261029`.

### Wdrożenie i kontrola serwera 2026-10-29

- Kreator włączono uniwersalnie dla uprawnionych pracowników, bez listy wybranych
  klientów. Nie utworzono urządzenia EMS ani nie zmieniono sterowania.
- Zastosowano wyłącznie addytywną migrację `OfferWorkspace`. Kopia małych tabel
  konfiguracyjnych ma 26 192 891 bajtów; nie obejmuje tabeli pomiarowej RE.
- Finalny build: `-y--GEsMzjT-YRtl4o3yZ`. Pierwsza aktywacja została automatycznie
  wycofana przez zbyt ścisłe sprawdzanie kodu HTTP strony deweloperskiej:
  Next.js zwraca strumieniowane `notFound` w powłoce HTTP 200. Sprawdzono treść
  odpowiedzi, brak fixture oraz prawidłowe zabezpieczenie API kodem 401.
- Odczyt produkcyjny: 35 aktywnych szablonów, 363 pozycje, 339 pozycji z cenami,
  4 operatorów i 63 taryfy. Dane referencyjne: 12 miesięcy, 8760 interwałów,
  bez problemów odczytu pomiarów. Podgląd generuje 10 stron SVG.
- W przeglądarce sprawdzono bieżącą G11 z historii ENEA, ceny G13active po wyborze
  oraz pozycje zestawu Solis/Dyness. Nie zmieniono rzeczywistej taryfy projektu.
- Testy CRM: 593/593; TypeScript poprawny. Build serwera przeszedł, z dwoma
  wcześniejszymi ostrzeżeniami lint poza nowym kreatorem.
- Odczytano pliki po wdrożeniu i porównano SHA-256 wszystkich 60 plików.
  Lustro: `D:\Strona OVH 2023\var\www\vhosts\onrevolt.com\httpdocs`.
  Kopia: `D:\Strona OVH 2023\var\www\vhosts\__backup\20261029-offer-workspace\onrevolt.com\httpdocs`.
- Nie wykonano commita. Pełne wyliczenie cen zestawu, RE, finansowanie,
  finalizacja i produkcyjny PDF pozostają niepodłączone, zgodnie z bramami powyżej.
