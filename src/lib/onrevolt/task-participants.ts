type TaskParticipantShape = {
  assignedToId?: string | null;
  createdById?: string | null;
  assistants?: Array<{ staffUserId: string }>;
};

export function normalizeTaskAssistantIds(value: unknown, assignedToId?: string | null) {
  if (!Array.isArray(value)) throw new Error('Pole assistantIds musi być listą');

  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item !== '' && item !== assignedToId),
  ));
}

export function taskParticipantWhere(staffUserId: string) {
  return {
    OR: [
      { assignedToId: staffUserId },
      { createdById: staffUserId },
      { assistants: { some: { staffUserId } } },
    ],
  };
}

export function taskAssignedWhere(staffUserId: string) {
  return {
    OR: [
      { assignedToId: staffUserId },
      { assistants: { some: { staffUserId } } },
    ],
  };
}

export function isTaskParticipant(task: TaskParticipantShape, staffUserId: string) {
  return task.assignedToId === staffUserId
    || task.createdById === staffUserId
    || Boolean(task.assistants?.some((assistant) => assistant.staffUserId === staffUserId));
}
