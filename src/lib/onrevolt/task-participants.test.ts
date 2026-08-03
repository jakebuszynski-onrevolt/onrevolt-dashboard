import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTaskParticipant,
  normalizeTaskAssistantIds,
  taskAssignedWhere,
  taskParticipantWhere,
} from './task-participants';

test('normalizuje listę asystentów i usuwa osobę odpowiedzialną', () => {
  assert.deepEqual(
    normalizeTaskAssistantIds([' user-2 ', 'user-1', 'user-2', '', null], 'user-1'),
    ['user-2'],
  );
});

test('odrzuca wartość, która nie jest listą', () => {
  assert.throws(() => normalizeTaskAssistantIds('user-1'), /musi być listą/);
});

test('rozpoznaje odpowiedzialnego, twórcę i asystenta jako uczestników zadania', () => {
  const task = {
    assignedToId: 'owner',
    createdById: 'creator',
    assistants: [{ staffUserId: 'assistant' }],
  };

  assert.equal(isTaskParticipant(task, 'owner'), true);
  assert.equal(isTaskParticipant(task, 'creator'), true);
  assert.equal(isTaskParticipant(task, 'assistant'), true);
  assert.equal(isTaskParticipant(task, 'other'), false);
});

test('buduje filtry widoczności i przydzielenia uwzględniające asystentów', () => {
  assert.deepEqual(taskParticipantWhere('user-1'), {
    OR: [
      { assignedToId: 'user-1' },
      { createdById: 'user-1' },
      { assistants: { some: { staffUserId: 'user-1' } } },
    ],
  });
  assert.deepEqual(taskAssignedWhere('user-1'), {
    OR: [
      { assignedToId: 'user-1' },
      { assistants: { some: { staffUserId: 'user-1' } } },
    ],
  });
});
