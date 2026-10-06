import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSolisFanTemperatureC,
  isValidSolisSmartPortFanSettings,
  parseSolisFanTemperatureC,
} from './solis-fan';

test('akceptuje poprawną histerezę wentylatora', () => {
  assert.equal(isValidSolisSmartPortFanSettings({
    enabled: true,
    onTemperatureCx10: 550,
    offTemperatureCx10: 500,
  }), true);
});

test('odrzuca brak histerezy i wartości niecałkowite x10', () => {
  assert.equal(isValidSolisSmartPortFanSettings({
    enabled: true,
    onTemperatureCx10: 500,
    offTemperatureCx10: 500,
  }), false);
  assert.equal(isValidSolisSmartPortFanSettings({
    enabled: false,
    onTemperatureCx10: 499,
    offTemperatureCx10: 500,
  }), false);
  assert.equal(isValidSolisSmartPortFanSettings({
    enabled: true,
    onTemperatureCx10: 550.5,
    offTemperatureCx10: 500,
  }), false);
});

test('konwertuje temperaturę między stopniami Celsjusza i zapisem x10', () => {
  assert.equal(parseSolisFanTemperatureC('55'), 550);
  assert.equal(parseSolisFanTemperatureC('50,5'), 505);
  assert.equal(parseSolisFanTemperatureC('50.55'), null);
  assert.equal(formatSolisFanTemperatureC(505), '50,5');
});
