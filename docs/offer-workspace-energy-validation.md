# Kontrola danych energii i bram finansowych, 2026-10-29

## Pomiary referencyjne

Odczyt bez zmian w bazie: projekt `cmvs3rq0e00b9hpugoty6oex4`.
Potwierdzone przez użytkownika PV: 9,9 kWp, 40 stopni, azymut 170 stopni,
straty modelu 12%, bez magazynu w okresie pomiarów.

Model jest klimatologią godzinową PVGIS/SARAH-3 2020-2024, nie odtworzeniem
pogody w okresie ENEA 2025-10 do 2026-09. Suma dodatnich różnic
`max(eksport ENEA - model PV, 0)` wynosi 969,052 kWh. Nie jest to dowód na
większą moc instalacji. Maksymalny godzinowy eksport wynosi 8,418 kWh.
Przesunięcia profilu o -2/-1/+1/+2 godziny zwiększają tę sumę do odpowiednio
2012,402 / 1404,374 / 1066,043 / 1552,750 kWh. To nie wskazuje na prosty błąd
przesunięcia o pełną godzinę, ale nie stanowi pełnej kalibracji modelu.

Oryginalny `enea-oddana-2026-09.xlsx`, SHA-256:
`bd622e89b662fa4292d6ed12f4e32bbc5a01443d559dd9062c9e28314fcd4e27`.
Nagłówek: `Energia czynna oddana (2.8.0) po bilansowaniu`.
720 wierszy ma status `Dane rzeczywiste`; 686 zer, 34 niezerowe wartości,
0 pustych komórek energii. Od 5 do 29 września eksport jest zerowy, 30 września
wraca. Pobór pozostaje niezerowy. Parser CRM nie wytworzył tych zer.
Nie rozstrzygnięto, czy PV było wyłączone, cała energia była konsumowana,
czy dane operatora wymagają korekty. Potrzebny odczyt falownika lub wyjaśnienie
od klienta/operatora. Nie zmieniono mocy, pomiarów ani produkcji automatycznie.

## Zakres lokalny, jeszcze nie nowy release

- Nowe szablony V4 pochodzą z `Re_port (5).zip`; V3 pozostaje zachowane.
- Dodano adapter rozliczeń, założenia obliczeń, zadania asynchroniczne i
  powiązanie dokumentu z wynikiem serwera dla tej samej rewizji danych.
- Dane z przeglądarki nie mogą podstawić kwot do PDF.
- Brak danych finansowych ma pozostać jawny, bez przykładowych wartości.
- Przeliczenie sprzętu jest blokowane przy niespójnym bilansie modelu PV
  i pomiarów, dopóki nie zostanie zaakceptowana poprawna metoda rekonstrukcji.
- Rozliczenie ma osobny wariant kontrolny: ta sama instalacja i pomiary,
  ale taryfa docelowa. Korzyść samej taryfy jest oddzielona od przyrostowej
  korzyści sprzętu; prosty zwrot sprzętu nie obejmuje korzyści samej taryfy.
- Formularz obsługuje datowane transze salda opustu i depozytu oraz początek
  cyklu rozliczeniowego. Nieznane saldo pozostaje nieznane, nie jest zerowane.
- Wynik serwera otrzymał trwały snapshot z tożsamością użytkownika, projektu,
  szkicu i zależności cenowych. Migracja jest przygotowana, nie została tutaj
  zastosowana na produkcji. To nie jest jeszcze finalizacja oferty.

## Ciągłość między latami

Nie wolno zerować depozytu na koniec grudnia ani nadawać staremu saldu nowego
terminu ważności w styczniu. Do następnego okresu przechodzą pozostałe transze,
ich miesiące uznania i wygaśnięcia, podstawa limitu zwrotu oraz środki oczekujące
na uznanie. Depozyt nie jest gotówką: oszczędność pojawia się przy pokryciu kosztu
energii lub przy rozliczonym zwrocie, a nie drugi raz przy przeniesieniu salda.

Silnik zwraca `netBillingContinuation` i udostępnia
`continueOfferNetBillingScenario`. Kontynuacja zachowuje transze active/pending,
daty, kolejność FIFO i podstawy limitów zwrotu. Wymaga sąsiednich pełnych
miesięcy w Europe/Warsaw oraz zgodnej podstawy NET/GROSS. Dodatkowe saldo
początkowe przy wznowieniu jest odrzucane. Test dwóch pełnych lat potwierdza
identyczny wynik przebiegu ciągłego i dwóch kolejnych przebiegów rocznych,
również dla śladowych dodatnich reszt arytmetycznych, bez ich zaokrąglania.

Obecny kreator rozlicza 12 miesięcy i prosty zwrot. Nie ma jeszcze gotowej
projekcji 20-letniej. Docelowo każdy rok musi kontynuować poprzedni stan;
nie można mnożyć wyniku pierwszego roku przez liczbę lat. Powtarzalność
późniejszych wyników może być wynikiem jawnie stałych założeń, nie założeniem
zastępującym obliczenia. Ceny, profil zużycia i produkcji, degradacja, serwis
oraz ewentualne dyskontowanie wymagają jawnego scenariusza projekcji.
Przy symulacji magazynu granica roku nie może także tworzyć ani usuwać energii:
stan naładowania kończącego się okresu musi być stanem początkowym kolejnego.
Warianty porównawcze prowadzą oddzielne salda; nie współdzielą jednego depozytu.

## Niezamknięte bramy przed pełnym wdrożeniem finansowym

1. Harmonogram RE optymalizuje nominalne ceny eksportu, natomiast rachunek
   używa depozytu z datami dostępności i wygaśnięcia. Ranking wymaga zgodnej
   funkcji ekonomicznej, a nie samego późniejszego przeliczenia rachunku.
2. Wieloletni zwrot wymaga kolejnych rozliczeń z ciągłością sald i jawnymi
   założeniami przyszłych okresów; obecny prosty zwrot nie zastępuje projekcji.
3. Salda początkowe i daty transz trzeba potwierdzić danymi klienta. Formularz
   nie może ich wymyślać na potrzeby uzyskania pełnego wyniku.
4. Optymalizacja magazynu przy docelowym net-meteringu pozostaje zablokowana;
   nie wolno zastępować jej optymalizatorem net-billing.
5. Finalizacja i pełny cykl utrwalonej oferty/dokumentu wymagają podłączenia
   do trwałych wyników obliczeń oraz wdrożenia addytywnej migracji snapshotów.
6. Wymagana końcowa kontrola wizualna 10 stron PDF, przeglądarki, testów i buildu.
7. Siatka SOC 0,5 kWh dla 16 kWh skraca roczną diagnostykę do ok. 82,5 s,
   lecz w kontrolnym profilu 48 h daje koszt o 14,3% wyższy niż krok 0,1 kWh.
   Nie jest to potwierdzona dokładność ekonomiczna. Helper adaptera ogranicza
   pracę jawnie; rekomendacja wymaga dokładniejszego i wydajniejszego rozwiązania.

W lokalnym punkcie kontrolnym przeszło 724/724 testów `test:crm` i TypeScript.
Zapisy wyników wymagają osobnego trwałego potwierdzenia dopuszczenia;
spóźniony rekord bez tego potwierdzenia nie jest wynikiem po restarcie.
Równoczesne odmienne obliczenie tego samego projektu zwraca konflikt 409,
zamiast podpinać wynik innego szkicu. Migracja snapshotów i potwierdzeń
pozostaje lokalna; testy repozytorium nie są testem migracji na żywej bazie.
Kontrola formularza w Chrome: 1440, 768 i 390 px, dodanie obu typów transz,
wyczyszczenie salda do wartości nieznanej, brak poziomego overflow strony
i brak błędów JavaScript. Testy komponentów objęły również zaokrąglenie
prezentowanego zwrotu w dół; obliczenia zachowują dokładną wartość.
To nie zastępuje wymienionych bram ekonomicznych ani testu produkcyjnego.

Zmiany tej partii nie zostały wdrożone do aplikacji produkcyjnej. Odczyty
diagnostyczne nie zmieniały bazy, dashboardu, taryf ani sterowania EMS.
