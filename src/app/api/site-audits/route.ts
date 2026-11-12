import { ConfigurationRoofType, SiteAuditStatus } from '@prisma/client';
import { NextRequest } from 'next/server';
import {
  forbidden,
  jsonResponse,
  readJsonObject,
  requireString,
  serverError,
} from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeSiteVisitRequest, authorizeStaffRequest, isAdminUser, isSiteVisitOnlyUser, staffAuthorizationResponse } from 'lib/onrevolt/staff-server';
import { requireSiteVisitProject } from 'lib/onrevolt/site-visit-access';
import {
  normalizeSiteAuditFormData,
  SITE_AUDIT_SCHEMA_VERSION,
  siteAuditCompletionErrors,
} from 'lib/onrevolt/site-audit';

const totalSteps = 7;
const statuses = new Set(Object.values(SiteAuditStatus));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const auditInclude = {
  auditor: { select: { id: true, name: true, email: true, avatarUrl: true, positionTitle: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  documents: { orderBy: { createdAt: 'desc' as const } },
} as const;
const restrictedAuditInclude = {
  auditor: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  documents: {
    select: {
      id: true,
      title: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      siteAuditId: true,
      auditFieldKey: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
  },
} as const;

class SiteAuditInputError extends Error {}
class SiteAuditConflict extends Error {}
class SiteAuditNotFound extends Error {}

function optionalUuid(value: unknown, field: string) {
  if (value == null) return undefined;
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new SiteAuditInputError(`Pole ${field} musi zawierać prawidłowy UUID`);
  }
  return value.toLowerCase();
}

function expectedUpdatedAt(body: Record<string, any>) {
  if (!Object.prototype.hasOwnProperty.call(body, 'expectedUpdatedAt')) {
    return { provided: false, value: undefined as Date | null | undefined };
  }
  if (body.expectedUpdatedAt === null) return { provided: true, value: null };
  if (typeof body.expectedUpdatedAt !== 'string' || !body.expectedUpdatedAt) {
    throw new SiteAuditInputError('Pole expectedUpdatedAt musi być datą ISO albo null');
  }
  const date = new Date(body.expectedUpdatedAt);
  if (!Number.isFinite(date.getTime())) {
    throw new SiteAuditInputError('Pole expectedUpdatedAt musi być prawidłową datą');
  }
  return { provided: true, value: date };
}

function isUniqueConstraintError(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === 'P2002';
}

function optionalDate(value: unknown) {
  if (value == null || value === '') return undefined;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new SiteAuditInputError('Nieprawidłowa data wizyty');
  return date;
}

function formData(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SiteAuditInputError('Brak prawidłowych danych formularza audytu');
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > 750_000) {
    throw new SiteAuditInputError('Dane formularza audytu są zbyt duże');
  }
  return value as Record<string, unknown>;
}

function completedSteps(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(Number)
    .filter((step) => Number.isInteger(step) && step >= 1 && step <= totalSteps))]
    .sort((a, b) => a - b);
}

function boundedStep(value: unknown) {
  const step = Number(value);
  return Number.isInteger(step) && step >= 1 && step <= totalSteps ? step : 1;
}

function optionalNonNegativeNumber(value: unknown) {
  if (value == null || value === '') return undefined;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function optionalPositiveInteger(value: unknown) {
  const number = optionalNonNegativeNumber(value);
  return number != null && Number.isInteger(number) && number > 0 ? number : undefined;
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function roofType(value: unknown): ConfigurationRoofType | undefined {
  const normalized = String(value || '').toUpperCase();
  const allowed = new Set(Object.values(ConfigurationRoofType));
  return allowed.has(normalized as ConfigurationRoofType)
    ? normalized as ConfigurationRoofType
    : undefined;
}

function validateCompletion(data: Record<string, any>, auditorId?: string) {
  const missing = siteAuditCompletionErrors(data, auditorId);
  if (missing.length) {
    throw new SiteAuditInputError(`Przed zakończeniem uzupełnij: ${missing.join(', ')}`);
  }
}

async function syncTechnicalEnergyAudit(
  projectId: string,
  data: Record<string, unknown>,
  db: Pick<typeof prisma, 'energyAudit'> = prisma,
) {
  const update = {
    connectionPowerKw: optionalNonNegativeNumber(data.connection_power_kw),
    phaseCount: optionalPositiveInteger(data.phase_count),
    mainFuseA: optionalPositiveInteger(data.main_fuse_a),
    roofType: roofType(data.roof_type),
    roofAreaM2: optionalNonNegativeNumber(data.roof_area_m2),
    roofOrientation: optionalText(data.roof_orientation),
    roofTiltDeg: optionalNonNegativeNumber(data.roof_angle_deg),
    shadingNotes: optionalText(data.shading_notes),
    existingPvKw: optionalNonNegativeNumber(data.existing_pv_total_kw ?? data.existing_pv_kw),
    existingInverter: optionalText(data.existing_pv_inverter_model ?? data.existing_pv_device),
    existingBatteryKwh: optionalNonNegativeNumber(data.existing_battery_kwh),
    heatingSource: optionalText(data.heating_source),
    heatingSourceDetail: optionalText(data.heating_params),
    buildingType: optionalText(data.building_type) || optionalText(data.facility_type),
    connectionType: optionalText(data.connection_type),
  };
  const meaningful = Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined),
  );
  if (!Object.keys(meaningful).length) return;

  await db.energyAudit.upsert({
    where: { projectId },
    create: {
      projectId,
      ...meaningful,
    } as any,
    update: meaningful,
  });
}

export async function GET(req: NextRequest) {
  const access = await authorizeSiteVisitRequest(req, 'site-audits.manage');
  if (!access.ok) return access.response;
  try {
    const projectId = req.nextUrl.searchParams.get('projectId') || '';
    if (!projectId) throw new Error('Brak projectId');
    await requireSiteVisitProject(access.user, projectId);
    const include = isSiteVisitOnlyUser(access.user) ? restrictedAuditInclude : auditInclude;
    const audits = await prisma.siteAudit.findMany({
      where: { projectId },
      include,
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return jsonResponse({ ok: true, data: audits });
  } catch (error) {
    const authorizationResponse = staffAuthorizationResponse(error);
    if (authorizationResponse) return authorizationResponse;
    return serverError('Nie udało się pobrać wizji lokalnych', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeSiteVisitRequest(req, 'site-audits.manage');
  if (!access.ok) return access.response;
  try {
    const restricted = isSiteVisitOnlyUser(access.user);
    const include = restricted ? restrictedAuditInclude : auditInclude;
    let body: Record<string, any>;
    try {
      body = await readJsonObject(req);
    } catch (error) {
      throw new SiteAuditInputError(error instanceof Error ? error.message : 'Nieprawidłowe dane żądania');
    }
    const hasDraftOwnerId = Object.prototype.hasOwnProperty.call(body, 'draftOwnerId');
    const hasModernDraftIdentity = Object.prototype.hasOwnProperty.call(body, 'mutationId')
      || Object.prototype.hasOwnProperty.call(body, 'clientDraftId');
    if ((hasDraftOwnerId || hasModernDraftIdentity)
      && (typeof body.draftOwnerId !== 'string' || body.draftOwnerId !== access.user.id)) {
      return forbidden('Właściciel szkicu nie zgadza się z aktywnym użytkownikiem');
    }
    const id = typeof body.id === 'string' && body.id ? body.id : undefined;
    const clientDraftId = optionalUuid(body.clientDraftId, 'clientDraftId');
    const mutationId = optionalUuid(body.mutationId, 'mutationId');
    const expected = expectedUpdatedAt(body);
    const resolvedId = id || (clientDraftId ? `draft-${clientDraftId}` : undefined);
    const isDeterministicDraft = !id && !!clientDraftId;
    let projectId: string;
    try {
      projectId = requireString(body, 'projectId');
    } catch (error) {
      throw new SiteAuditInputError(error instanceof Error ? error.message : 'Brak wymaganego pola projectId');
    }
    await requireSiteVisitProject(access.user, projectId);
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, clientId: true },
    });
    if (!project) throw new SiteAuditNotFound('Nie znaleziono projektu');

    const before = resolvedId
      ? await prisma.siteAudit.findUnique({ where: { id: resolvedId }, include })
      : null;
    if (id && !before) throw new SiteAuditNotFound('Nie znaleziono wizji lokalnej do aktualizacji');
    if (before && before.projectId !== projectId) {
      throw new SiteAuditNotFound('Nie znaleziono wizji lokalnej w wybranym projekcie');
    }

    const savedMutationId = before?.formData && typeof before.formData === 'object'
      ? (before.formData as Record<string, unknown>)._autosaveMutationId
      : undefined;
    if (before && mutationId && savedMutationId === mutationId) {
      return jsonResponse({ ok: true, data: before });
    }
    if (before && isDeterministicDraft && (!expected.provided || expected.value === null)) {
      throw new SiteAuditConflict('Szkic istnieje już w innej wersji. Odśwież dane przed ponownym zapisem.');
    }
    if (!before && expected.provided && expected.value !== null) {
      throw new SiteAuditConflict('Nie można zapisać szkicu na podstawie nieaktualnej wersji. Odśwież dane.');
    }

    const data = normalizeSiteAuditFormData(formData(body.formData));
    if (mutationId) data._autosaveMutationId = mutationId;
    else delete data._autosaveMutationId;
    const status = statuses.has(body.status as SiteAuditStatus)
      ? body.status as SiteAuditStatus
      : SiteAuditStatus.DRAFT;
    let auditorId = typeof body.auditorId === 'string' && body.auditorId
      ? body.auditorId
      : undefined;
    if (restricted) {
      const formAuditorId = typeof data.auditor_id === 'string' && data.auditor_id.trim()
        ? data.auditor_id.trim()
        : undefined;
      if (auditorId && formAuditorId && auditorId !== formAuditorId) {
        throw new SiteAuditInputError('Audytor formularza nie zgadza się z audytorem wizji lokalnej');
      }
      auditorId = auditorId || formAuditorId || before?.auditorId || access.user.id;
      if (auditorId !== access.user.id && auditorId !== before?.auditorId) {
        throw new SiteAuditInputError('Wizję lokalną możesz przypisać do siebie albo pozostawić dotychczasowego audytora');
      }
      data.auditor_id = auditorId;
    }
    if (auditorId) {
      if (!restricted || auditorId !== before?.auditorId) {
        const auditor = await prisma.staffUser.findFirst({ where: { id: auditorId, active: true }, select: { id: true } });
        if (!auditor) throw new SiteAuditInputError('Wybrany audytor nie jest aktywnym użytkownikiem');
      }
    }
    const steps = completedSteps(body.completedSteps);
    if (status === SiteAuditStatus.COMPLETED) {
      validateCompletion(data, auditorId);
      const missingSteps = Array.from({ length: totalSteps }, (_, index) => index + 1)
        .filter((step) => !steps.includes(step));
      if (missingSteps.length) {
        throw new SiteAuditInputError(`Przed zakończeniem oznacz jako gotowe kroki: ${missingSteps.join(', ')}`);
      }
    }
    const progressPercent = status === SiteAuditStatus.COMPLETED
      ? 100
      : Math.round(steps.length / totalSteps * 100);
    const visitDate = optionalDate(body.visitDate || data.visit_date);
    const title = optionalText(body.title)
      || `Wizja lokalna${visitDate ? ` ${visitDate.toLocaleDateString('pl-PL')}` : ''}`;
    const recordData = {
      projectId,
      title: title.slice(0, 191),
      status,
      schemaVersion: SITE_AUDIT_SCHEMA_VERSION,
      visitDate,
      auditorId,
      currentStep: boundedStep(body.currentStep),
      completedSteps: steps,
      progressPercent,
      formData: data as any,
      completedAt: status === SiteAuditStatus.COMPLETED
        ? before?.completedAt || new Date()
        : null,
    };
    let audit;
    try {
      audit = await prisma.$transaction(async (tx) => {
        await requireSiteVisitProject(access.user, projectId, tx);
        let saved;
        if (before) {
          if (expected.provided) {
            if (!expected.value) {
              throw new SiteAuditConflict('Wizja lokalna została już utworzona. Odśwież dane przed zapisem.');
            }
            const result = await tx.siteAudit.updateMany({
              where: { id: before.id, updatedAt: expected.value },
              data: recordData,
            });
            if (result.count !== 1) {
              throw new SiteAuditConflict('Wizja lokalna została zmieniona w innej sesji. Odśwież dane przed ponownym zapisem.');
            }
            saved = await tx.siteAudit.findUnique({ where: { id: before.id }, include });
            if (!saved) {
              throw new SiteAuditConflict('Wizja lokalna przestała być dostępna. Odśwież dane.');
            }
          } else {
            saved = await tx.siteAudit.update({
              where: { id: before.id },
              data: recordData,
              include,
            });
          }
        } else {
          saved = await tx.siteAudit.create({
            data: {
              ...(resolvedId ? { id: resolvedId } : {}),
              ...recordData,
              createdById: access.user.id,
            },
            include,
          });
        }
        await syncTechnicalEnergyAudit(projectId, data, tx);
        return saved;
      });
    } catch (error) {
      if (isUniqueConstraintError(error) && isDeterministicDraft) {
        await requireSiteVisitProject(access.user, projectId);
        const concurrent = await prisma.siteAudit.findUnique({
          where: { id: resolvedId },
          include,
        });
        if (concurrent?.projectId === projectId && mutationId
          && (concurrent.formData as Record<string, unknown> | null)?._autosaveMutationId === mutationId) {
          return jsonResponse({ ok: true, data: concurrent });
        }
        if (concurrent) {
          throw new SiteAuditConflict('Szkic został już zapisany w innej sesji. Odśwież dane, aby wczytać aktualną wersję.');
        }
      }
      throw error;
    }

    await writeAuditLog({
      actorId: access.user.id,
      clientId: project.clientId,
      entityType: 'SiteAudit',
      entityId: audit.id,
      action: before ? (status === SiteAuditStatus.COMPLETED ? 'COMPLETE' : 'UPDATE') : 'CREATE',
      before: before || undefined,
      after: audit,
    });
    return jsonResponse({ ok: true, data: audit }, { status: before ? 200 : 201 });
  } catch (error) {
    const authorizationResponse = staffAuthorizationResponse(error);
    if (authorizationResponse) return authorizationResponse;
    if (error instanceof SiteAuditInputError) {
      return jsonResponse({ ok: false, error: error.message }, { status: 400 });
    }
    if (error instanceof SiteAuditConflict) {
      return jsonResponse({ ok: false, error: error.message }, { status: 409 });
    }
    if (error instanceof SiteAuditNotFound) {
      return jsonResponse({ ok: false, error: error.message }, { status: 404 });
    }
    return serverError('Nie udało się zapisać wizji lokalnej', error);
  }
}

export async function DELETE(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'site-audits.manage');
  if (!access.ok) return access.response;
  if (!isAdminUser(access.user)) return forbidden('Tylko administrator może usunąć audyt');
  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const before = await prisma.siteAudit.findUnique({
      where: { id },
      include: { project: { select: { clientId: true } } },
    });
    if (!before) throw new Error('Nie znaleziono audytu');
    await prisma.siteAudit.delete({ where: { id } });
    await writeAuditLog({
      actorId: access.user.id,
      clientId: before.project.clientId,
      entityType: 'SiteAudit',
      entityId: id,
      action: 'DELETE',
      before,
    });
    return jsonResponse({ ok: true, data: { id } });
  } catch (error) {
    return serverError('Nie udało się usunąć wizji lokalnej', error);
  }
}
