import { execFile } from 'node:child_process';
import path from 'node:path';

type Payload = Record<string, any>;
type Range = { from: string; to: string };
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const datasets = ['usageData', 'pvData', 'storageData'] as const;

export function reConsumptionDashboardRanges(start: string, now = new Date()): Range[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start))
    || dateKey(new Date(start)) !== start) throw new Error('Brak prawidłowej daty startu profilu RE');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(now);
  if (start > today) throw new Error('Data startu profilu RE jest w przyszłości');
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + 1);
  const ranges: Range[] = [];
  for (let cursor = new Date(start); cursor < end;) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const to = next < end ? next : end;
    ranges.push({ from: dateKey(cursor), to: dateKey(to) });
    cursor = to;
  }
  return ranges;
}

async function readDashboardRange(station: string, range: Range): Promise<Payload> {
  const stdout = await new Promise<string>((resolve, reject) => execFile(process.env.ONREVOLT_PHP_BIN?.trim() || 'php',
    [path.resolve('scripts/read-re-consumption.php'), process.env.ONREVOLT_RE_ROOT?.trim()
      || '/var/www/vhosts/onrevolt.com/my.onrevolt.com', station, range.from, range.to],
    { timeout: 120_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', windowsHide: true },
    (error, output) => error ? reject(new Error(`Nie udało się odczytać dashboardu RE (${range.from} – ${range.to}): ${error.message}`)) : resolve(output)));
  let payload: Payload;
  try { payload = JSON.parse(stdout); } catch { throw new Error('Dashboard RE nie zwrócił poprawnego JSON'); }
  if (!payload || Array.isArray(payload) || typeof payload !== 'object' || payload.error || !payload.account) {
    throw new Error(`Błąd dashboardu RE: ${String(payload?.error || 'brak danych konta')}`);
  }
  return payload;
}

/** Keep PHP memory bounded to one month; preserve RE records and quality flags verbatim. */
export async function readReConsumptionDashboard(station: string, start: string,
  readRange = readDashboardRange, now = new Date()): Promise<Payload> {
  const result: Payload = {};
  const records = Object.fromEntries(datasets.map(field => [field, new Map<string, Payload>()]));
  const issues: Payload[] = [];
  // Sequential reads release each PHP process before starting the next month.
  for (const range of reConsumptionDashboardRanges(start, now)) {
    const chunk = await readRange(station, range);
    for (const field of ['account', 'energy', 'history']) {
      if (chunk[field] != null) result[field] = chunk[field];
    }
    for (const field of datasets) {
      const dataset = chunk[field];
      if (!dataset || !Array.isArray(dataset.records)) continue;
      const { records: rows, ...metadata } = dataset;
      result[field] = metadata;
      for (const row of rows) {
        const date = ['date', 'day', 'dateKey', 'timestamp', 'datetime']
          .map(key => String(row[key] ?? '').slice(0, 10)).find(value => /^\d{4}-\d{2}-\d{2}$/.test(value));
        if (!date) throw new Error('Dashboard RE zwrócił pomiar bez daty');
        records[field].set(date, row);
      }
    }
    if (chunk.dataQuality) {
      result.dataQuality = chunk.dataQuality;
      issues.push(...(chunk.dataQuality.issues || []));
    }
  }
  for (const field of datasets) {
    if (!result[field]) continue;
    const dates = Array.from(records[field].keys()).sort();
    result[field] = { ...result[field], records: dates.map(date => records[field].get(date)),
      totalDays: dates.length, oldestDate: dates[0], latestDate: dates[dates.length - 1] };
  }
  if (result.dataQuality) result.dataQuality = { ...result.dataQuality, issues, issueCount: issues.length,
    ok: issues.length === 0, status: issues.length ? 'error' : 'ok' };
  return result;
}
