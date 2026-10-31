import type { ReConsumptionProfile } from './re-consumption-api';

type Row = Record<string, any>;

/** Select measured calendar months without changing RE's latest-year forecast patterns. */
export function selectReConsumptionHistory(profile: ReConsumptionProfile, legacy: Row[], history: Row[], periodKeys: readonly string[]) {
  const requested = new Set(periodKeys);
  if (new Set(periodKeys.map(key => key.slice(5))).size !== periodKeys.length) {
    throw new Error('Profil RE wymaga najwyżej jednego wystąpienia każdego miesiąca');
  }
  const groups = new Map<string, Row[]>();
  for (const row of history) {
    const period = `${row.year_no}-${String(row.month_no).padStart(2, '0')}`;
    if (!requested.has(period)) continue;
    if (!['import', 'export'].includes(row.direction)) throw new Error('Nieprawidłowy kierunek historii RE');
    const groupKey = `${period}/${row.direction}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(row);
  }
  const rows = new Map(legacy.map(row => [`${row.month_no}/${row.day_no}/${row.hour_no}`, { ...row }]));
  const resolved: ReConsumptionProfile = {
    ...profile,
    months: profile.months ? [...profile.months] : null,
    sources: profile.sources ? [...profile.sources] : null,
    exportSources: profile.exportSources ? [...profile.exportSources] : null,
    hourlyProfile: { ...profile.hourlyProfile },
  };
  for (const [groupKey, measured] of groups) {
    const year = Number(measured[0].year_no), month = Number(measured[0].month_no);
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const seen = new Set<string>();
    let total = 0;
    for (const row of measured) {
      const day = Number(row.day_no), hour = Number(row.hour_no), value = Number(row.kwh);
      const slot = `${day}/${hour}`;
      if (!Number.isInteger(day) || day < 1 || day > days || !Number.isInteger(hour) || hour < 0 || hour > 23
        || !Number.isFinite(value) || value < 0 || seen.has(slot)) {
        throw new Error(`Nieprawidłowe godziny historii RE: ${groupKey}`);
      }
      seen.add(slot);
      total += value;
    }
    if (seen.size !== days * 24) throw new Error(`Niepełna historia RE: ${groupKey} (${seen.size}/${days * 24} godzin)`);
    if (!resolved.months || !resolved.sources || !resolved.exportSources) {
      throw new Error('Historia pomiarów RE nie ma profilu miesięcznego');
    }
    const imported = measured[0].direction === 'import';
    for (const row of measured) {
      const slot = `${month}/${row.day_no}/${row.hour_no}`;
      const target = rows.get(slot) || { month_no: month, day_no: Number(row.day_no), hour_no: Number(row.hour_no),
        kwh: null, export_kwh: null, source: 'standard', source_year: null, export_source: 'standard', export_source_year: null };
      target[imported ? 'kwh' : 'export_kwh'] = Number(row.kwh);
      target[imported ? 'source' : 'export_source'] = 'xlsx';
      target[imported ? 'source_year' : 'export_source_year'] = year;
      rows.set(slot, target);
    }
    if (imported) {
      resolved.months[month - 1] = total;
      resolved.sources[month - 1] = 'xlsx';
    } else resolved.exportSources[month - 1] = 'xlsx';
    // A non-leap selection must not retain February 29 from another year's pattern.
    for (const [slot, row] of rows) if (Number(row.month_no) === month && Number(row.day_no) > days) rows.delete(slot);
  }
  const selectedRows = [...rows.values()].sort((a, b) => a.month_no - b.month_no || a.day_no - b.day_no || a.hour_no - b.hour_no);
  if (selectedRows.some(row => row.kwh == null)) throw new Error('Brak godzin poboru w historii RE dla wybranego okresu');
  if (selectedRows.some(row => row.export_kwh == null && resolved.exportSources?.[Number(row.month_no) - 1] === 'xlsx')) {
    throw new Error('Brak godzin energii oddanej w historii RE dla wybranego okresu');
  }
  resolved.hourlyProfile.exists = selectedRows.length > 0;
  resolved.hourlyProfile.rows = selectedRows.length;
  return { profile: resolved, rows: selectedRows };
}
