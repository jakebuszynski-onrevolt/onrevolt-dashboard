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
import { authorizeStaffRequest, isAdminUser } from 'lib/onrevolt/staff-server';
import {
  normalizeSiteAuditFormData,
  SITE_AUDIT_SCHEMA_VERSION,
  siteAuditCompletionErrors,
} from 'lib/onrevolt/site-audit';

const totalSteps = 7;
const statuses = new Set(Object.values(SiteAuditStatus));
const auditInclude = {
  auditor: { select: { id: true, name: true, email: true, avatarUrl: true, positionTitle: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  documents: { orderBy: { createdAt: 'desc' as const } },
} as const;

function optionalDate(value: unknown) {
  if (value == null || value === '') return undefined;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new Error('Nieprawidłowa data wizyty');
  return date;
}

function formData(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Brak prawidłowych danych formularza audytu');
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > 750_000) {
    throw new Error('Dane formularza audytu są zbyt duże');
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
    throw new Error(`Przed zakończeniem uzupełnij: ${missing.join(', ')}`);
  }
}

async function syncTechnicalEnergyAudit(projectId: string, data: Record<string, unknown>) {
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

  await prisma.energyAudit.upsert({
    where: { projectId },
    create: {
      projectId,
      ...meaningful,
    } as any,
    update: meaningful,
  });
}

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'site-audits.manage');
  if (!access.ok) return access.response;
  try {
    const projectId = req.nextUrl.searchParams.get('projectId') || '';
    if (!projectId) throw new Error('Brak projectId');
    const audits = await prisma.siteAudit.findMany({
      where: { projectId },
      include: auditInclude,
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return jsonResponse({ ok: true, data: audits });
  } catch (error) {
    return serverError('Nie udało się pobrać wizji lokalnych', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'site-audits.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const id = typeof body.id === 'string' && body.id ? body.id : undefined;
    const projectId = requireString(body, 'projectId');
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, clientId: true },
    });
    if (!project) throw new Error('Nie znaleziono projektu');

    const before = id
      ? await prisma.siteAudit.findUnique({ where: { id }, include: auditInclude })
      : null;
    if (before && before.projectId !== projectId) {
      throw new Error('Audyt nie należy do wybranego projektu');
    }

    const data = normalizeSiteAuditFormData(formData(body.formData));
    const status = statuses.has(body.status as SiteAuditStatus)
      ? body.status as SiteAuditStatus
      : SiteAuditStatus.DRAFT;
    const auditorId = typeof body.auditorId === 'string' && body.auditorId
      ? body.auditorId
      : undefined;
    if (auditorId) {
      const auditor = await prisma.staffUser.findFirst({ where: { id: auditorId, active: true }, select: { id: true } });
      if (!auditor) throw new Error('Wybrany audytor nie jest aktywnym użytkownikiem');
    }
    const steps = completedSteps(body.completedSteps);
    if (status === SiteAuditStatus.COMPLETED) {
      validateCompletion(data, auditorId);
      const missingSteps = Array.from({ length: totalSteps }, (_, index) => index + 1)
        .filter((step) => !steps.includes(step));
      if (missingSteps.length) {
        throw new Error(`Przed zakończeniem oznacz jako gotowe kroki: ${missingSteps.join(', ')}`);
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
    const audit = before
      ? await prisma.siteAudit.update({
        where: { id: before.id },
        data: recordData,
        include: auditInclude,
      })
      : await prisma.siteAudit.create({
        data: { ...recordData, createdById: access.user.id },
        include: auditInclude,
      });

    await syncTechnicalEnergyAudit(projectId, data);
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
