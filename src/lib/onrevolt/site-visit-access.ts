import { prisma } from './prisma';
import { isSiteVisitOnlyUser, StaffAuthorizationError } from './staff-server';

export const SITE_VISIT_STAGE_CODE = 'CRM_WIZJA_LOKALNA';

export async function requireSiteVisitProject(
  user: any, projectId: string, db: Pick<typeof prisma, 'project'> = prisma,
) {
  if (!isSiteVisitOnlyUser(user)) return;
  if (!projectId) throw new StaffAuthorizationError(403, 'Brak dostępu do wizji lokalnej');
  const project = await db.project.findFirst({
    where: { id: projectId, stage: { code: SITE_VISIT_STAGE_CODE, isActive: true } },
    select: { id: true },
  });
  if (!project) throw new StaffAuthorizationError(403, 'Projekt nie jest na etapie Wizja Lokalna');
}
