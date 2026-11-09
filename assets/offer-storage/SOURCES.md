# Ilustracje i wymiary magazynów

Ilustracje od użytkownika (2026-11-05):
- `powerbrick-plus.png`: niezmieniony `C:\Users\Arczi\Desktop\Magazyn3.png`, zastępujący 2026-11-06 wcześniejszy `Magazyn.png`. Obraz nie zawiera nadrukowanych wymiarów; renderer SVG składa trzy strzałki oraz etykiety dla jednego modułu (435 × 235 × 850 mm), a podpis podaje także liczbę oferowanych sztuk.
- `stack-source.png`: zachowany oryginał `C:\Users\Arczi\Desktop\Magazyn (1).png`.
- `stack-dimensions-blank.png`: kopia przygotowana imagegen z usuniętymi napisami „XX cm”; tekst wymiarów składa renderer SVG.
- `stack314.png`: niezmieniony oryginał `C:\Users\Arczi\Desktop\dynes 314_przy oknie.png`, wskazany 2026-11-08. Zdjęcie jest poglądowe; renderer SVG rysuje wymiary wyliczone z konfiguracji STACK314.
- `cabinet-bf100.png`: niezmieniony oryginał `C:\Users\Arczi\Desktop\magazyn cabinet.png`, otrzymany 2026-11-06. Zdjęcie jest poglądowe i nie stanowi potwierdzenia, że przedstawia dokładny model BF100; renderer SVG rysuje strzałki i etykiety wymiarów jednej szafy.

Zdjęcia są poglądowe. Liczba modułów i wymiary wynikają z pozycji wybranego zestawu, nie z liczby modułów widocznych na ilustracji. Użytkownik zatwierdził podział STACK100/PRO: 12 → 8+4, 14 → 8+6, 16 → 8+8. Przy dwóch BDU każda kolumna ma własną podstawę i BDU; przy jednym BDU druga używa zestawu rozszerzającego.

Zdjęcie Cabinet potwierdzono ponownie 2026-11-08. Jest wybierane także dla SKU C100E oraz nazwy zawierającej „Cabinet”. W takich przypadkach nie przypisujemy wymiarów C100 do innego modelu.

Źródła wymiarów (mm):
- PowerBrick Plus: [karta Dyness 2025-12-10](https://dyness.com/Public/Uploads/uploadfile/files/20251226/DynessPowerBrickPlusDatasheetEN20251210.pdf), 435 × 235 × 850 mm na moduł (podane na strzałkach i w podpisie ilustracji).
- STACK100: [instrukcja Dyness V2.9](https://www.dyness.com/Public/Uploads/uploadfile/files/20250815/UMWL0G0004238STACK100UserManualENV29.pdf), strony PDF 25–28: moduł 590 × 390 × 133,5; BDU 133,5; podstawa 100; pokrywa rozszerzenia 70. Wysokość kolumny z BDU: 233,5 + 133,5 × n; rozszerzenie: 170 + 133,5 × n. Kontrola: 15 modułów z BDU i podstawą = 2236 mm, zgodnie z instrukcją.
- STACK100 PRO: [instrukcja Dyness 2025-09-01](https://nl.dyness.com/Public/Uploads/uploadfile/files/20251029/WLFC0500198Stack100proUserManualEN250901.pdf), strony PDF 24–26: tabela złożonych kolumn 657 × 459 × (292 + 169 × n), rozszerzenie 657 × 459 × (191 + 169 × n). Używamy tabeli złożonych zestawów, nie zewnętrznej wysokości pojedynczego modułu 191 mm. Tabela podaje 1644/867 mm dla 8+4 i 1644/1205 mm dla 8+6. Nowsza strona produktu zaokrągla głębokość do 460 mm; tutaj konsekwentnie wersja instrukcji 2025-09-01.
- STACK314: [specyfikacja Dyness](https://latam.dyness.com/stack314-for-small-commercial-industrial), 770 × 425 × (293 + 230 × n).
- BF100: [karta katalogowa Dyness BF100, wersja 20250826](https://www.dyness.com/Public/Uploads/uploadfile/files/20250901/DynessBF100DatasheetEN20250826.pdf), szerokość 725 mm, głębokość 1200 mm, wysokość 2260 mm na jedną szafę. Podpis pod ilustracją podaje liczbę szaf w konfiguracji.

Źródła PDF odczytano lokalnie w `.codex-deploy/offer-persistence-20261105/specs/`. Reguły nie zmieniają pojemności ani kosztów konfiguracji.
