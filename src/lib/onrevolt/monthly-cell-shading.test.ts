import assert from 'node:assert/strict';
import test from 'node:test';
import { MONTHLY_CELL_NEUTRAL, MONTHLY_CELL_PALETTE, monthlyCellFill } from './monthly-cell-shading';

test('monthly cell fill uses a row-local color scale with opaque shared colors', () => {
  const row = [10, 50, 100];
  const low = monthlyCellFill('pv', row[0], row);
  const middle = monthlyCellFill('pv', row[1], row);
  const high = monthlyCellFill('pv', row[2], row);

  assert.match(low, /^#[0-9A-F]{6}$/);
  assert.notEqual(low, middle);
  assert.notEqual(middle, high);
  assert.equal(high, monthlyCellFill('pv', 100, [100]));
  assert.equal(high, '#FFA500', 'a row maximum uses the full palette color');
  assert.equal(high, monthlyCellFill('pv', 100, [1, 100, null]));
});

test('zero stays a pale valid value while missing cells stay neutral', () => {
  const zero = monthlyCellFill('import', 0, [0, 100]);
  const positive = monthlyCellFill('import', 100, [0, 100]);

  assert.notEqual(zero, MONTHLY_CELL_NEUTRAL);
  assert.notEqual(zero, positive);
  assert.equal(monthlyCellFill('import', null, [0, 100]), MONTHLY_CELL_NEUTRAL);
  assert.equal(monthlyCellFill('import', undefined, [0, 100]), MONTHLY_CELL_NEUTRAL);
  assert.equal(monthlyCellFill('import', Number.NaN, [0, 100]), MONTHLY_CELL_NEUTRAL);
});

test('all equal values render evenly and each data row keeps its own palette', () => {
  const row = [25, 25, 25];
  const equalFills = row.map((value) => monthlyCellFill('direct', value, row));

  assert.deepEqual(new Set(equalFills), new Set([equalFills[0]]));
  assert.equal(equalFills[0], monthlyCellFill('direct', 25, [25]));
  assert.notEqual(monthlyCellFill('direct', 25, [25]), monthlyCellFill('consumption', 25, [25]));
  assert.equal(MONTHLY_CELL_PALETTE.pv, '#FFA500');
  assert.equal(MONTHLY_CELL_PALETTE.direct, '#FFA500');
  assert.equal(MONTHLY_CELL_PALETTE.export, '#006C30');
  assert.equal(MONTHLY_CELL_PALETTE.import, '#DF6C00');
  assert.deepEqual(Object.keys(MONTHLY_CELL_PALETTE).sort(), ['consumption', 'direct', 'export', 'import', 'pv', 'storage']);
});
