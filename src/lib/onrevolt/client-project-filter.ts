export const activeServiceStatusValue = '__IN_SERVICE__';
export const activeServiceWithoutTasksStatusValue = '__IN_SERVICE_WITHOUT_TASKS__';
export const missingStatusValue = '__NO_STATUS__';

type Project = {
  status: string;
  stage?: { id?: string; isTerminal?: boolean } | null;
  _count?: { tasks: number };
};

export function matchesProjectFilter(project: Project, filter: string) {
  const status = project.status?.trim() || missingStatusValue;
  if (filter === 'all') return true;
  if (filter.startsWith('stage:')) return project.stage?.id === filter.slice(6);
  if (filter === activeServiceStatusValue) return status !== 'LEAD' && status !== missingStatusValue;
  if (filter === activeServiceWithoutTasksStatusValue) {
    return status !== 'LEAD' && status !== 'ZAKONCZONY' && status !== missingStatusValue && !project.stage?.isTerminal;
  }
  return status === filter;
}

export function matchesClientProjectFilter(client: { projects: Project[]; _count?: { tasks: number } }, filter: string) {
  if (filter === 'all') return true;
  if (filter === activeServiceWithoutTasksStatusValue
    && (client._count?.tasks || client.projects.some((project) => project._count?.tasks))) return false;
  return client.projects.some((project) => matchesProjectFilter(project, filter))
    || (!client.projects.length && filter === missingStatusValue);
}

export function projectForClientFilter<T extends Project>(projects: T[], filter: string): T | undefined {
  return projects.find((project) => matchesProjectFilter(project, filter));
}
