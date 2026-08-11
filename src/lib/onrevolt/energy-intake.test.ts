import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildingTypeLabel,
  getHeatSourceDetailOptions,
  heatSourceDetailLabel,
  heatSourceLabel,
  roofShapeLabel,
  terrainTypeLabel,
} from './energy-intake';

test('pokazuje właściwe rodzaje kotła dla gazu ziemnego', () => {
  assert.deepEqual(
    getHeatSourceDetailOptions('NATURAL_GAS').map((option) => option.label),
    ['Kocioł stary', 'Kocioł tradycyjny', 'Piec kondensacyjny'],
  );
});

test('pokazuje pompy ciepła wyłącznie dla ogrzewania elektrycznego', () => {
  const electric = getHeatSourceDetailOptions('ELECTRICITY').map((option) => option.value);
  assert.equal(electric.includes('HEAT_PUMP_GROUND'), true);
  assert.equal(electric.includes('HEAT_PUMP_AIR'), true);
  assert.deepEqual(getHeatSourceDetailOptions('LPG'), []);
  assert.deepEqual(getHeatSourceDetailOptions('DISTRICT_HEATING'), []);
});

test('tłumaczy wartości formularza i starsze aliasy na etykiety oferty', () => {
  assert.equal(buildingTypeLabel('SINGLE_FAMILY'), 'Dom jednorodzinny');
  assert.equal(terrainTypeLabel('SUBURBAN'), 'Teren podmiejski');
  assert.equal(roofShapeLabel('GABLE_BARN'), 'Dwuspadowy');
  assert.equal(heatSourceLabel('NATURAL_GAS'), 'Gaz ziemny');
  assert.equal(heatSourceLabel('GAS'), 'Gaz ziemny');
  assert.equal(heatSourceDetailLabel('NATURAL_GAS', 'GAS_CONDENSING'), 'Piec kondensacyjny');
});
