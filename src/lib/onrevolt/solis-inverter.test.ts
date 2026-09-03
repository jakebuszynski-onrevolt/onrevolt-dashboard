import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateSolisMaxExportPowerW,
  getSolisRatedPowerWarning,
  isValidSolisPowerLimitPercent,
  isValidSolisRatedPowerW,
} from './solis-inverter';

test('oblicza maksymalną moc eksportu z mocy znamionowej i limitu procentowego', () => {
  assert.equal(calculateSolisMaxExportPowerW(10_000, 80), 8_000);
  assert.equal(calculateSolisMaxExportPowerW(12_345, 75), 9_259);
});

test('waliduje całkowite wartości pól falownika', () => {
  assert.equal(isValidSolisRatedPowerW(0), true);
  assert.equal(isValidSolisRatedPowerW(-1), false);
  assert.equal(isValidSolisRatedPowerW(10_000.5), false);
  assert.equal(isValidSolisPowerLimitPercent(0), true);
  assert.equal(isValidSolisPowerLimitPercent(100), true);
  assert.equal(isValidSolisPowerLimitPercent(101), false);
});

test('ostrzega przy małej i dużej mocy znamionowej na wartościach granicznych', () => {
  assert.equal(getSolisRatedPowerWarning(1_000), 'LOW');
  assert.equal(getSolisRatedPowerWarning(1_001), null);
  assert.equal(getSolisRatedPowerWarning(99_999), null);
  assert.equal(getSolisRatedPowerWarning(100_000), 'HIGH');
});
