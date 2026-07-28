import assert from 'node:assert/strict';
import test from 'node:test';

import { getEnergyTariffs } from './energy-tariffs';

test('PGE udostępnia aktualne grupy taryfowe z taryfy dystrybucyjnej 2026', () => {
  const codes = getEnergyTariffs('PGE').map((tariff) => tariff.code);

  assert.deepEqual(codes, [
    'G11', 'G12', 'G12as', 'G12e', 'G12n', 'G12w',
    'C11', 'C11em', 'C11o', 'C11s', 'C12a', 'C12b', 'C12n', 'C12w',
    'C21', 'C21em', 'C22a', 'C22b', 'C23', 'C24',
    'B11', 'B11em', 'B21', 'B21em', 'B22', 'B23', 'B24',
    'A23', 'A24', 'R',
  ]);
});
