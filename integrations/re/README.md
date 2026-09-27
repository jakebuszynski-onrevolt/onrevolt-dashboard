# Historia taryf klienta

CRM przechowuje historię taryf w tej samej bazie `get_pdo()` co katalog RE.
Nie tworzy urządzeń ani nie modyfikuje sterowania falownikiem. Kod w tym katalogu
jest źródłem rozszerzeń dla dwóch istniejących instalacji PHP; generator wymaga
jednoznacznych miejsc zmian i przerywa pracę, gdy pliki źródłowe się różnią.

## Kontrakt

- Profil jest przypisany do projektu i PPE; stacja jest opcjonalna i unikalna.
- Granice okresów mają postać `[validFrom, validUntil)`, według Europe/Warsaw.
- `null` jako początek oznacza początek danych, nie początek dostępnego cennika.
- Historia nie zastępuje brakujących cen bieżącymi. Nieustalony początek danych,
  luka cennika albo nierozstrzygnięte metadane ENEA oznaczają niekompletność.
- Indywidualne ceny są zapisane netto wraz z VAT i trwałym `component_key`.
- Zapis i podgląd sprawdzają `revision`. Zapis zmienia okresy i audyt w jednej
  transakcji. Podgląd wycofuje transakcję.
- Format `client-tariffs-v1` przesyła mapę dat do identyfikatorów cenników oraz
  słownik cenników. Silnik kosztowy odczytuje zarówno tę postać, jak i historyczną
  mapę obiektów. RE rozwija odwołania w pamięci bez kopiowania każdego cennika.
- Scenariusz proponowany pozostaje niezależny od rzeczywistej historii taryf.
- Dane pomiarowe i tabele pomiarowe nie są częścią tej migracji.

## Weryfikacja lokalna

```powershell
npm run test:crm
node node_modules/typescript/bin/tsc --noEmit
npm run lint
npm run build
& 'D:\STRONA Programy\php\8.4\php.exe' -d 'extension_dir=D:\STRONA Programy\php\8.4\ext' -d extension=php_pdo_sqlite.dll scripts/test-client-tariffs.php
```

Pakiet RE tworzy `scripts/prepare-client-tariff-assets.ts`. Argument `--dashboard`
dotyczy katalogu `my.onrevolt.com`; bez niego źródłem jest katalog `windyone.pl/re`.
Wyniki zapisywać wyłącznie w `_workspace-artifacts`, nie nadpisywać źródeł lustrzanych.
`scripts/verify-client-tariff-assets.ts KATALOG_WYNIKOWY_MY` sprawdza składnię JS,
funkcje rzeczywistych stawek, granice, opłaty i oddzielenie scenariusza.

## Bramka wdrożenia

1. Pobrać aktualne pliki serwerowe i porównać z bazą generatora. Nie wdrażać
   pakietu wygenerowanego z niepotwierdzonej kopii lustrzanej.
2. Skopiować zmieniane pliki do kopii serwerowej oraz lokalnego
   `D:\Strona OVH 2023\var\www\vhosts\__backup`, z zachowaniem struktury.
3. Zrobić wyłącznie kopię tabel konfiguracyjnych: `osd`, `tariff`,
   `tariff_fixed_cost`, `tariff_variable_cost`, `tariff_window`,
   `tariff_window_monthly`, `pricing_tariff_version` i istniejących tabel
   `pricing_client_*` oraz `pricing_catalog_revision`. Bez tabel pomiarowych.
4. Sprawdzić schemat i audyty bez zapisu:
   `php scripts/migrate-client-tariffs.php RE_ROOT --check`.
5. Zweryfikować migrację na izolowanej kopii tych tabel MySQL oraz zgodność
   kosztów rzeczywistych danych wskazanego klienta. Test SQLite nie zastępuje
   tego kroku ani porównania z produkcyjnymi wersjami PHP.
6. Wykonać addytywną migrację `--apply`, opublikować razem pakiet PHP/JS i CRM.
   Nie wykonywać tej migracji przez HTTP. Profil klienta nie powstaje podczas
   migracji katalogu.
7. Po wdrożeniu sprawdzić SHA-256 i rozmiary przez ponowny odczyt SFTP, API
   taryf, zmianę testowego okresu, przeliczenie oferty roboczej i dashboard RE.
   Nie przeliczać ani nie modyfikować zaakceptowanych ofert.

W razie przerwania wrócić do kopii plików/wydania CRM. Nowych tabel nie usuwać;
zachować utworzoną historię. Nie wykonywać automatycznego commita.

## Stan kontroli produkcyjnej

26.09.2026: wdrożono pakiet CRM, dashboardu RE i edytora katalogu Windyone.
Addytywna migracja utrwaliła 57 cenników. Nie zmieniono tabel pomiarowych,
nie utworzono profili klienta ani urządzeń. Dotychczasowy wybór ogólnej taryfy
wskazanego klienta pozostał bez zmian; odczyt katalogu G11 i G13active działa.
Usługa CRM jest aktywna, strony logowania CRM i dashboardu odpowiadają poprawnie.

Kopia plików i tabel konfiguracyjnych znajduje się na serwerze w
`/var/www/vhosts/onrevolt.com/releases/backups/client-tariffs-20260926`
oraz lokalnie w `D:\Strona OVH 2023\var\www\vhosts\__backup\2026-09-26-client-tariffs`.
Nie wykonywano kopii tabel pomiarowych ani automatycznego commita.

Lokalnie przeszło 371 testów CRM, 43 sprawdzenia repozytorium PHP na SQLite,
kontrola wygenerowanych adapterów RE i scenariusze edytora w Chromium
(desktop, telefon, B2B netto). Kontrola adapterów obejmuje także roczne progi
opłat, rozdzielenie poboru sieciowego od całego zużycia, kompaktową historię
oraz identyczną projekcję netto wielu dni korzystających z jednego cennika.
Migracja przeszła dodatkowo 865 kontroli na izolowanej kopii MySQL. Koszty
12 miesięcy rzeczywistego profilu zużycia stacji 40 porównano w CRM i RE
z testową historią G11/G13active w roku 2027, bez zapisu historii klienta
na produkcji. Serwerowy zestaw testów: 315 zaliczonych, 56 pominiętych
z powodu braku lokalnych fixture, 0 błędów; produkcyjny build zakończony poprawnie.
Interfejs sprawdzono lokalnie na desktopie, telefonie i w B2B. Końcowy podgląd
zalogowanej karty produkcyjnej wymaga sesji użytkownika w przeglądarce.
Taryfy RDN wymagają dodatkowo potwierdzenia godzinowej podstawy cen rynkowych
i VAT; brak tych cen zgłaszany jest jako niekompletność.

## Podgląd rzeczywistej taryfy w dashboardzie

27.09.2026: wdrożono podsumowanie wyboru ogólnego w CRM (operator, taryfa
dotychczasowa i oddzielna taryfa symulacji ze stacji RE) oraz tymczasowy podgląd
dashboardu. Po włączeniu historii klienta lista pokazuje „Rzeczywista (CRM)”
i taryfy „Test”. Podgląd nie zapisuje wyboru, historii ani poleceń falownika;
powrót i odświeżenie strony przywracają rzeczywistą taryfę. Zapis pozostałych
ustawień instalacji zachowuje oryginalne identyfikatory taryf stacji.

`client-tariff-preview.js` przechowuje wyłącznie stan bieżącej strony. Rzeczywisty
podgląd i natywny RE używają migawki z indywidualnymi cenami i godzinami.
Pamięć prognoz uwzględnia wybór i treść migawki. Nie tworzyć historii
produkcyjnego klienta dla testów.

Generator `scripts/prepare-client-tariff-preview.ts SOURCE OUTPUT` obsługuje kopię
dashboardu sprzed poprawki (20260926-client-tariffs-1) i kolejne wersje podglądu;
sprawdza miejsca zmiany. Wynik sprawdza `scripts/verify-client-tariff-preview.ts OUTPUT`.
Testy logiki znajdują się w `client-tariff-preview.test.ts` (7 scenariuszy).
Sprawdzono wybór, powrót, odświeżenie i układ panelu na desktopie oraz 390px.
Produkcja zjsurj75: działa bez błędów JS, brak indywidualnych okresów, ENEA G11
dotychczasowa i ENEA G13active symulacja, bez zmiany ustawień klienta.

Pakiet i dowody: `_workspace-artifacts/tariff-preview-20260927`.
Kopia serwerowa: `/var/www/vhosts/onrevolt.com/releases/backups/tariff-preview-20260927`.
Lokalna: `D:\Strona OVH 2023\var\www\vhosts\__backup\2026-09-27-tariff-preview`.
Zweryfikowano rozmiar i SHA-256 wszystkich pięciu ponownie pobranych plików.
Bez zmian tabel, kopii pomiarów, restartu usług i automatycznego commita.

27.09.2026, poprawka widoczności (client-tariff-preview-2): podgląd jest dostępny
również bez historii CRM. Wówczas domyślna pozycja to „Zapisana symulacja (RE)”,
bez zmiany dotychczasowych obliczeń i bez nazywania symulacji taryfą rzeczywistą.
Przycisk „Wróć do zapisanej” kończy test. Dotychczasowy edytor znajduje się
w zwiniętej sekcji „Zapisane taryfy RE” i odczytuje oryginalne dane, nie wybór
testowy. Historia CRM nadal włącza pozycję „Rzeczywista (CRM)”.
Sprawdzono produkcyjny zjsurj75: widoczność, test G11, niezmienione zapisane
G11/G13active i powrót do symulacji, bez zapisu ustawień i bez błędów JS.
Kopia czterech plików: `releases/backups/tariff-preview-visible-20260927` na
serwerze oraz `__backup/2026-09-27-tariff-preview-visible` w lokalnym lustrze.
Pakiet, hashe i zrzut produkcyjny: `_workspace-artifacts/tariff-preview-visible-20260927`.
