import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { reConsumptionDashboardRanges, readReConsumptionDashboard } from './re-consumption-dashboard';

test('dashboard reads contiguous calendar months, including leap and DST dates', () => {
  assert.deepEqual(reConsumptionDashboardRanges('2024-02-27', new Date('2024-04-01T22:30:00Z')), [
    { from: '2024-02-27', to: '2024-03-01' },
    { from: '2024-03-01', to: '2024-04-01' },
    { from: '2024-04-01', to: '2024-04-03' },
  ]);
  const ranges = reConsumptionDashboardRanges('2025-01-01', new Date('2026-09-19T10:00:00Z'));
  assert.equal(ranges[0].from, '2025-01-01');
  assert.equal(ranges.at(-1).to, '2026-09-20');
  assert.ok(ranges.every(range => (Date.parse(range.to) - Date.parse(range.from)) / 86400000 <= 31));
});

test('invalid and future history dates fail before reading any data', async () => {
  for (const start of ['', '2026-02-30', '2026-13-01', '2027-01-01']) {
    await assert.rejects(readReConsumptionDashboard('35', start, async () => {
      assert.fail('No API call for an invalid date');
    }, new Date('2026-09-19T10:00:00Z')), /daty startu|w przyszłości/);
  }
});

test('monthly reads retain usage, PV, storage, coverage and all quality issues without context', async () => {
  const calls: string[] = [];
  const shared = { date: '2026-08-31', quarters: [{ slotStart: '2026-08-31T00:00:00+02:00', totalLoadKwh: 1 }], measurementCoverage: 0.2 };
  const result = await readReConsumptionDashboard('35', '2026-08-01', async (station, range) => {
    assert.equal(station, '35'); calls.push(range.from);
    return { account: { annualUsageKwh: 3000 }, energy: { datetime: range.to }, history: { startDate: '2026-08-01' },
      usageData: { records: [shared, { date: range.from, quarters: [{ totalLoadKwh: 2 }] }] },
      pvData: { records: [{ date: range.from, quarters: [{ pvKwh: 3 }] }] },
      storageData: { records: [{ date: range.from, quarters: [{ dischargeKwh: 4 }] }] },
      dataQuality: { issues: [{ from: range.from, to: range.to }] }, weather: { unused: true }, priceHistory: { unused: true } };
  }, new Date('2026-09-19T10:00:00Z'));
  assert.deepEqual(calls, ['2026-08-01', '2026-09-01']);
  assert.equal(result.account.annualUsageKwh, 3000);
  assert.equal(result.energy.datetime, '2026-09-20');
  assert.deepEqual(result.usageData.records.map(row => row.date), ['2026-08-01', '2026-08-31', '2026-09-01']);
  assert.deepEqual(result.usageData.records[1], shared);
  assert.equal(result.pvData.records.length, 2); assert.equal(result.storageData.records.length, 2);
  assert.equal(result.dataQuality.issueCount, 2); assert.equal(result.dataQuality.ok, false);
  assert.equal(result.weather, undefined); assert.equal(result.priceHistory, undefined);
});

test('failed monthly read aborts instead of returning a partial profile or annual estimate', async () => {
  let calls = 0;
  await assert.rejects(readReConsumptionDashboard('35', '2026-06-12', async () => {
    if (++calls === 2) throw new Error('Monthly API failure');
    return { account: { annualUsageKwh: 3000 }, usageData: { records: [] } };
  }, new Date('2026-09-19T10:00:00Z')), /Monthly API failure/);
  assert.equal(calls, 2);
});

test('CLI bridge requests only a bounded range without weather or tariff context', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 're-dashboard-range-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'api'));
  writeFileSync(path.join(root, 'api/dashboard.php'), '<?php echo json_encode($_GET);');
  const php = process.env.ONREVOLT_PHP_BIN?.trim() || 'php';
  const args = [path.resolve('scripts/read-re-consumption.php'), root, '35'];
  const query = JSON.parse(execFileSync(php, [...args, '2026-08-01', '2026-09-01'], { encoding: 'utf8' }));
  assert.deepEqual(query, { station: '35', from: '2026-08-01', to: '2026-09-01', context: '0' });
  for (const dates of [[], ['2026-01-01', '2026-09-01'], ['2026-02-30', '2026-03-01'], ['2026-09-01', '2026-08-01']]) {
    assert.throws(() => execFileSync(php, [...args, ...dates], { encoding: 'utf8', stdio: 'pipe' }), /miesięczny zakres/);
  }
});
