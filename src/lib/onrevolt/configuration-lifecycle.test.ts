import assert from 'node:assert/strict';
import test from 'node:test';
import { configurationDeleteBlockReason, configurationEditBlockReason } from './configuration-lifecycle';

test('pozwala usunąć nieużywaną konfigurację roboczą', () => {
  assert.equal(configurationDeleteBlockReason({ status: 'DRAFT' }), undefined);
});

test('blokuje usunięcie konfiguracji używanej w procesie', () => {
  assert.match(
    configurationDeleteBlockReason({ status: 'DRAFT', offers: 1 }) || '',
    /musi pozostać w historii procesu/,
  );
  assert.match(
    configurationDeleteBlockReason({ status: 'DRAFT', installations: 1 }) || '',
    /musi pozostać w historii procesu/,
  );
  assert.match(
    configurationDeleteBlockReason({ status: 'DRAFT', stockReservations: 1 }) || '',
    /musi pozostać w historii procesu/,
  );
});

test('pozwala usunąć każdą nieużywaną konfigurację, niezależnie od statusu', () => {
  assert.equal(configurationDeleteBlockReason({ status: 'READY' }), undefined);
  assert.equal(configurationDeleteBlockReason({ status: 'ARCHIVED' }), undefined);
  assert.equal(configurationDeleteBlockReason({ status: 'OFFERED' }), undefined);
});

test('pozwala edytować nieużywany szkic i konfigurację gotową', () => {
  assert.equal(configurationEditBlockReason({ status: 'DRAFT' }), undefined);
  assert.equal(configurationEditBlockReason({ status: 'READY' }), undefined);
});

test('blokuje edycję po utworzeniu pierwszej oferty', () => {
  assert.match(
    configurationEditBlockReason({ status: 'DRAFT', offers: 1 }) || '',
    /Utwórz nowy wariant/,
  );
});

test('blokuje edycję konfiguracji przekazanej dalej w procesie', () => {
  assert.match(configurationEditBlockReason({ status: 'OFFERED' }) || '', /roboczą lub gotową/);
  assert.match(configurationEditBlockReason({ status: 'ACCEPTED' }) || '', /roboczą lub gotową/);
});
