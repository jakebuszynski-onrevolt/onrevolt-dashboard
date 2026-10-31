import assert from 'node:assert/strict';
import test from 'node:test';
import { selectReConsumptionHistory } from './re-consumption-history';
import type { ReConsumptionProfile } from './re-consumption-api';

const profile = (): ReConsumptionProfile => ({ station: '41', months: Array(12).fill(720), sources: Array(12).fill('xlsx'),
  exportSources: Array(12).fill('xlsx'), annualUsageKwh: 8640, hourlyProfile: { exists: true, rows: 720 } });
function history(year: number, month: number, direction: 'import' | 'export', value = 1) {
  return Array.from({ length: new Date(Date.UTC(year, month, 0)).getUTCDate() * 24 }, (_, i) => ({
    year_no: year, month_no: month, day_no: Math.floor(i / 24) + 1, hour_no: i % 24, direction, kwh: value,
  }));
}
function legacy(year = 2026, month = 6) {
  return history(year, month, 'import').map(row => ({ month_no: row.month_no, day_no: row.day_no, hour_no: row.hour_no,
    kwh: 1, export_kwh: 2, source: 'xlsx', source_year: year, export_source: 'xlsx', export_source_year: year }));
}

test('June 2025 and 2026 stay independent, selected totals and sources agree with hours', () => {
  const p = profile(), latest = legacy();
  const archived = [...history(2025, 6, 'import', 0.5), ...history(2025, 6, 'export', 1.5),
    ...history(2026, 6, 'import'), ...history(2026, 6, 'export', 2)];
  const before = JSON.stringify({ p, latest, archived });
  const first = selectReConsumptionHistory(p, latest, archived, ['2025-06']);
  const second = selectReConsumptionHistory(p, latest, archived, ['2026-06']);
  assert.equal(first.profile.months![5], 360);
  assert.equal(first.rows.reduce((sum, row) => sum + row.export_kwh, 0), 1080);
  assert.ok(first.rows.every(row => row.source_year === 2025 && row.export_source_year === 2025));
  assert.equal(second.profile.months![5], 720);
  assert.equal(second.rows.reduce((sum, row) => sum + row.export_kwh, 0), 1440);
  assert.equal(JSON.stringify({ p, latest, archived }), before);
});

test('directions are selected separately; a missing export does not become a measured zero', () => {
  const result = selectReConsumptionHistory(profile(), legacy(), history(2025, 6, 'import', 0.5), ['2025-06']);
  assert.ok(result.rows.every(row => row.source_year === 2025 && row.export_source_year === 2026 && row.export_kwh === 2));
});

test('incomplete, duplicate, negative and invalid hours fail instead of masquerading as measurements', () => {
  const full = history(2025, 6, 'import');
  for (const bad of [full.slice(1), [...full.slice(1), full[1]], [...full.slice(1), { ...full[0], kwh: -1 }],
    [...full.slice(1), { ...full[0], hour_no: 24 }]]) {
    assert.throws(() => selectReConsumptionHistory(profile(), legacy(), bad, ['2025-06']), /historia RE|godziny historii RE/);
  }
});

test('leap February keeps 696 hours while non-leap February removes the extra day', () => {
  const p = profile(); p.exportSources![1] = 'standard';
  const leap = selectReConsumptionHistory(p, legacy(2025, 2), history(2024, 2, 'import'), ['2024-02']);
  assert.equal(leap.rows.length, 696);
  assert.equal(leap.profile.months![1], 696);
  const normal = selectReConsumptionHistory(profile(), legacy(2024, 2), history(2025, 2, 'import'), ['2025-02']);
  assert.equal(normal.rows.length, 672);
});

test('leap day never invents export zeros for an incomplete export pattern', () => {
  assert.throws(() => selectReConsumptionHistory(profile(), legacy(2025, 2), history(2024, 2, 'import'), ['2024-02']), /Brak godzin energii oddanej/);
  const full = selectReConsumptionHistory(profile(), legacy(2025, 2),
    [...history(2024, 2, 'import'), ...history(2024, 2, 'export', 2)], ['2024-02']);
  assert.equal(full.rows.filter(row => row.day_no === 29).reduce((total, row) => total + row.export_kwh, 0), 48);
});

test('existing forecast behavior remains unchanged when exact history is absent', () => {
  const latest = legacy();
  assert.deepEqual(selectReConsumptionHistory(profile(), latest, history(2026, 6, 'import'), ['2025-06']).rows, latest);
});
