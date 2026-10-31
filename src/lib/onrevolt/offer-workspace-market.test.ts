import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { offerHourlyMarketPrices, offerMarketIntervalStarts } from './offer-workspace-market';

test('database decimal prices are read explicitly as strings in both server readers', () => {
  for (const filename of ['offer-workspace-valuation-server.ts', 'offer-workspace-calculation-server.ts']) {
    const source = readFileSync(new URL(filename, import.meta.url), 'utf8');
    assert.match(source, /CAST\(.+? AS CHAR\) AS price/);
    assert.match(source, /const date(?:Column)? = 'dtime_utc'/);
    assert.match(source, /period_utc AS periodUtc/);
    assert.match(source, /offerMarketIntervalStarts\(/);
  }
  const hour = '2025-10-01T09:00:00.000Z';
  const rows = ['639.07', '531.75', '489.23', '465.56'].map((pricePlnPerMwh, index) => ({
    timestampUtc: `2025-10-01T09:${String(index * 15).padStart(2, '0')}:00Z`, pricePlnPerMwh,
  }));
  assert.equal(offerHourlyMarketPrices(rows, [hour]).get(hour), 0.5314025);
});

test('PSE interval ends become starts across midnight and both autumn repeated hours', () => {
  const starts = offerMarketIntervalStarts([
    { stamp: '2025-10-26T00:00:00Z', periodUtc: '23:45 - 24:00', price: '52.52' },
    { stamp: '2025-10-26T00:15:00Z', periodUtc: '00:00 - 00:15', price: '63.87' },
    { stamp: '2025-10-26T01:15:00Z', periodUtc: '01:00 - 01:15', price: '44.46' },
  ]);
  assert.deepEqual(starts.map(row => row.timestampUtc), [
    '2025-10-25T23:45:00.000Z', '2025-10-26T00:00:00.000Z', '2025-10-26T01:00:00.000Z',
  ]);
  assert.deepEqual(starts.map(row => row.pricePlnPerMwh), ['52.52', '63.87', '44.46']);
});

test('explicit hourly PSE rates cover four quarters without shifting the hour', () => {
  const starts = offerMarketIntervalStarts([{ stamp: '2026-03-29T01:00:00Z', periodUtc: '00:00 - 01:00', price: '500.00' }]);
  assert.equal(starts.length, 4);
  assert.equal(offerHourlyMarketPrices(starts, ['2026-03-29T00:00:00Z']).get('2026-03-29T00:00:00Z'), 0.5);
});

test('missing or contradictory PSE UTC periods cannot silently become quarter-hours', () => {
  for (const periodUtc of [null, '', '01:00 - 01:15', '00:00 - 00:30', '24:15 - 00:00']) {
    assert.throws(() => offerMarketIntervalStarts([{ stamp: '2026-01-01T00:15:00Z', periodUtc, price: 100 }]));
  }
});

test('offer market prices preserve units and negative values, require all quarters', () => {
  const rows = [100, -100, 200, 400].map((pricePlnPerMwh, quarter) => ({
    timestampUtc: `2026-01-01T00:${String(quarter * 15).padStart(2, '0')}:00.000Z`, pricePlnPerMwh,
  }));
  assert.ok(Math.abs(offerHourlyMarketPrices(rows, ['2026-01-01T00:00:00.000Z']).get('2026-01-01T00:00:00.000Z')! - 0.15) < 1e-12);
  assert.throws(() => offerHourlyMarketPrices(rows.slice(1), ['2026-01-01T00:00:00.000Z']), /Brak pełnych/);
  assert.throws(() => offerHourlyMarketPrices([...rows, rows[0]], []), /zduplikowany/);
});

test('missing raw prices do not become zero; negative RCE is clamped before averaging', () => {
  const hour = '2026-01-01T00:00:00.000Z';
  const rows = [-100, 100, 100, 100].map((pricePlnPerMwh, quarter) => ({
    timestampUtc: `2026-01-01T00:${String(quarter * 15).padStart(2, '0')}:00.000Z`, pricePlnPerMwh,
  }));
  assert.ok(Math.abs(offerHourlyMarketPrices(rows, [hour], { clampNegativeBeforeAverage: true }).get(hour)! - 0.075) < 1e-12);
  for (const value of [null, undefined, '', ' ', NaN]) {
    assert.throws(() => offerHourlyMarketPrices([{ ...rows[0], pricePlnPerMwh: value }, ...rows.slice(1)], [hour]));
  }
});
