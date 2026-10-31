<?php
declare(strict_types=1);

require_once __DIR__ . '/../integrations/re/measurement-history.php';

function expect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function hourlyRows(int $days, float $value = 1.0): array
{
    $rows = [];
    for ($day = 1; $day <= $days; $day++) {
        for ($hour = 0; $hour < 24; $hour++) {
            $rows[] = ['day' => $day, 'hour' => $hour, 'kwh' => $value];
        }
    }
    return $rows;
}

expect(re_measurement_history_days_in_month(2024, 2) === 29, 'Rok przestępny powinien mieć 29 dni lutego.');
expect(re_measurement_history_days_in_month(2023, 2) === 28, 'Rok nieprzestępny powinien mieć 28 dni lutego.');

$groups = [
    ['year' => 2024, 'month' => 2, 'direction' => 'import', 'rows' => hourlyRows(28)],
    ['year' => 2024, 'month' => 2, 'direction' => 'export', 'rows' => hourlyRows(29, 0.25)],
    ['year' => 2023, 'month' => 2, 'direction' => 'import', 'rows' => hourlyRows(28, 0.5)],
];
$complete = re_measurement_history_complete_channels($groups);
expect(count($complete) === 2, 'Niekompletny kanał lutego przestępnego nie może trafić do historii.');
expect($complete[0]['year'] === 2023 && $complete[0]['rows'][0]['day'] === 1, 'Kanały muszą być uporządkowane i zawierać dni godzinowe.');
expect($complete[1]['year'] === 2024 && $complete[1]['direction'] === 'export', 'Pełny kanał z 29 lutego powinien zostać zachowany.');
expect($complete[1]['totalKwh'] === 174.0, 'Suma kanału powinna uwzględniać 29 lutego.');

$summaries = re_measurement_history_complete_summaries([
    ['year' => 2024, 'month' => 2, 'direction' => 'import', 'rows' => 672, 'totalKwh' => 672],
    ['year' => 2024, 'month' => 2, 'direction' => 'export', 'rows' => 696, 'totalKwh' => 174],
]);
expect(count($summaries) === 1, 'Podsumowanie ma zawierać wyłącznie kompletne miesiące.');
expect($summaries[0] === [
    'year' => 2024,
    'month' => 2,
    'direction' => 'export',
    'rows' => 696,
    'totalKwh' => 174.0,
], 'API powinno zwracać uzgodniony format measurementHistory.');

expect(!re_measurement_history_should_update_legacy(2025, 2024, true), 'Starszy rok nie może nadpisać legacy.');
expect(re_measurement_history_should_update_legacy(2025, 2026, false), 'Nowszy rok może zaktualizować legacy.');
expect(!re_measurement_history_should_update_legacy(2025, 2025, false), 'Ten sam rok bez jawnego replace nie może aktualizować legacy.');
expect(re_measurement_history_should_update_legacy(2025, 2025, true), 'Jawny replace może aktualizować legacy dla tego samego roku.');
expect(re_measurement_history_should_seed_profile(false, false, true), 'Eksport-only bez rekordu profilu musi zainicjalizować pełne miesiące.');
expect(!re_measurement_history_should_seed_profile(true, false, true), 'Eksport-only nie może nadpisywać istniejącego profilu miesięcznego.');
expect(!re_measurement_history_should_seed_profile(false, true, true), 'Zapis importu sam inicjalizuje profil; nie należy seedować go drugi raz.');
expect(!re_measurement_history_should_seed_profile(false, false, false), 'Bez aktualizacji eksportu nie należy inicjalizować profilu.');

$overlaid = re_measurement_history_overlay_row(['import' => 10.0, 'export' => 2.0], ['import' => 12.0]);
expect($overlaid === ['import' => 12.0, 'export' => 2.0], 'Historia ma nadpisywać wyłącznie obecny w niej kierunek.');
$singleChannel = re_measurement_history_overlay_row(null, ['export' => 3.5]);
expect($singleChannel === ['import' => null, 'export' => 3.5], 'Brakujący kierunek bez legacy musi pozostać null, nie zero.');
expect(!re_measurement_history_row_has_import($singleChannel), 'Eksport bez importu musi pozostać niekompletnym profilem API.');
$importOnly = re_measurement_history_overlay_row(null, ['import' => 5.0]);
expect(re_measurement_history_row_has_import($importOnly) && $importOnly['export'] === null, 'Import z brakującym eksportem jest poprawny i eksport pozostaje null.');
expect(re_measurement_history_overlay_row(null, []) === null, 'Brak danych dla obu kierunków pozostaje brakiem wiersza.');

echo "OK: re measurement history pure tests\n";
