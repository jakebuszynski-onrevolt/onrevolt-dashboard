import assert from 'node:assert/strict';
import test from 'node:test';
import { configurationDeleteBlockReason } from './configuration-lifecycle';

test('pozwala usunąć nieużywaną konfigurację roboczą', () => {
  assert.equal(configurationDeleteBlockReason({ status: 'DRAFT' }), undefined);
});

test('blokuje usunięcie konfiguracji używanej w procesie', () => {
  assert.match(
    configurationDeleteBlockReason({ status: 'DRAFT', offers: 1 }) || '',
    /Zarchiwizuj ją/,
  );
  assert.match(
    configurationDeleteBlockReason({ status: 'DRAFT', installations: 1 }) || '',
    /Zarchiwizuj ją/,
  );
  assert.match(
    configurationDeleteBlockReason({ status: 'DRAFT', stockReservations: 1 }) || '',
    /Zarchiwizuj ją/,
  );
});

test('blokuje usunięcie konfiguracji, która nie jest szkicem', () => {
  assert.match(
    configurationDeleteBlockReason({ status: 'READY' }) || '',
    /tylko konfigurację roboczą/,
  );
});
