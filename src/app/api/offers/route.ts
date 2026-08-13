import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonResponse, notFound, optionalString, parseDate, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { isEnergyOperator } from 'lib/onrevolt/energy-tariffs';
import { prepareOfferPdfArchive, removePreparedOfferPdf } from 'lib/onrevolt/offer-pdf';
import { buildOfferReport } from 'lib/onrevolt/offer-report';
import {
  createOfferFromConfiguration,
  OfferRecalculationError,
  offerDeleteBlockReason,
  offerInclude,
  offerStatusDateUpdate,
  recalculateOfferFromCurrentData,
} from 'lib/onrevolt/offers';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest, isAdminUser } from 'lib/onrevolt/staff-server';

const offerStatuses = new Set(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']);

function optionalNumber(value: unknown) {
  if (value == null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Nieprawidłowa wartość liczbowa: ${value}`);
  return number;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function offerWhere(req: NextRequest) {
  const url = req.nextUrl;
  const clientId = url.searchParams.get('clientId') || undefined;
  const projectId = url.searchParams.get('projectId') || undefined;
  const status = url.searchParams.get('status') || undefined;

  return {
    ...(projectId ? { projectId } : {}),
    ...(status && offerStatuses.has(status) ? { status: status as any } : {}),
    ...(clientId ? { project: { clientId } } : {}),
  };
}

async function workspaceData() {
  const [projects, configurations] = await Promise.all([
    prisma.project.findMany({
      include: {
        client: true,
        investmentSite: true,
        configurations: {
          where: { status: { not: 'ARCHIVED' } },
          include: { items: true },
          orderBy: { updatedAt: 'desc' },
        },
        energyPortalAccounts: true,
        energyAudits: {
          include: { scenarios: { orderBy: { createdAt: 'desc' } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
    prisma.configuration.findMany({
      where: { status: { not: 'ARCHIVED' } },
      include: {
        project: { include: { client: true } },
        items: { orderBy: { position: 'asc' } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    }),
  ]);

  return { projects, configurations };
}

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const workspace = req.nextUrl.searchParams.get('workspace') === '1';
    const offers = await prisma.offer.findMany({
      where: offerWhere(req),
      include: offerInclude,
      orderBy: { updatedAt: 'desc' },
      take: 300,
    });

    if (!workspace) return jsonResponse({ ok: true, data: offers });

    return jsonResponse({
      ok: true,
      data: {
        offers,
        currentUser: { systemRole: access.user.systemRole },
        ...(await workspaceData()),
      },
    });
  } catch (error) {
    return serverError('Nie udało się pobrać ofert', error);
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'offers.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const projectId = requireString(body, 'projectId');
    const energyOperator = optionalString(body, 'energyOperator');
    const tariffBefore = optionalString(body, 'tariffBefore');

    if (energyOperator && !isEnergyOperator(energyOperator)) {
      return badRequest('Nieprawidłowy OSD');
    }

    if (energyOperator || tariffBefore) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, clientId: true },
      });
      if (!project) return badRequest('Nie znaleziono projektu dla oferty');

      const operator = energyOperator || 'ENEA';
      const existing = await prisma.energyPortalAccount.findFirst({
        where: { clientId: project.clientId, projectId: project.id, operator: operator as any },
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
      });
      const data = {
        clientId: project.clientId,
        projectId: project.id,
        operator: operator as any,
        ...(tariffBefore ? { tariff: tariffBefore } : {}),
      };

      if (existing) {
        await prisma.energyPortalAccount.update({ where: { id: existing.id }, data });
      } else {
        await prisma.energyPortalAccount.create({ data });
      }
    }

    const offer = await createOfferFromConfiguration(prisma, {
      projectId,
      configurationId: optionalString(body, 'configurationId'),
      configurationIds: stringArray(body.configurationIds),
      energyScenarioId: optionalString(body, 'energyScenarioId'),
      title: optionalString(body, 'title'),
      validUntil: parseDate(body.validUntil),
      currentAnnualBillGross: optionalNumber(body.currentAnnualBillGross),
      projectedAnnualBillGross: optionalNumber(body.projectedAnnualBillGross),
      tariffBefore,
      tariffAfter: optionalString(body, 'tariffAfter'),
      settlementBefore: optionalString(body, 'settlementBefore'),
      settlementAfter: optionalString(body, 'settlementAfter') || 'net-billing',
      descriptionBefore: optionalString(body, 'descriptionBefore'),
      descriptionAfter: optionalString(body, 'descriptionAfter'),
      notes: optionalString(body, 'notes'),
    });
    await writeAuditLog({
      actorId: access.user.id,
      clientId: offer.project.clientId,
      entityType: 'Offer',
      entityId: offer.id,
      action: 'CREATE',
      after: offer,
    });
    return jsonResponse({ ok: true, data: offer }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się zapisać oferty', error);
  }
}

export async function PATCH(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'offers.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const existing = await prisma.offer.findUnique({ where: { id }, include: offerInclude });
    if (!existing) return badRequest('Nie znaleziono oferty');

    if (body.recalculate === true) {
      if (existing.status === 'ACCEPTED') {
        return badRequest('Zaakceptowana oferta jest zamrożona. Utwórz nowy wariant oferty.');
      }
      try {
        const result = await recalculateOfferFromCurrentData(prisma, id, access.user.id);
        await writeAuditLog({
          actorId: access.user.id,
          clientId: result.offer.project.clientId,
          entityType: 'Offer',
          entityId: result.offer.id,
          action: 'RECALCULATE',
          before: existing,
          after: {
            offer: result.offer,
            scenarioId: result.scenarioId,
            annualConsumptionKwh: result.annualConsumptionKwh,
          },
        });
        return jsonResponse({ ok: true, data: result.offer });
      } catch (error) {
        if (error instanceof OfferRecalculationError) return badRequest(error.message);
        throw error;
      }
    }
    const data: Record<string, any> = {};

    if ('status' in body) {
      const status = requireString(body, 'status');
      if (!offerStatuses.has(status)) return badRequest('Nieprawidłowy status oferty');
      data.status = status;
      Object.assign(data, offerStatusDateUpdate(status));
    }
    if ('title' in body) data.title = optionalString(body, 'title');
    if ('validUntil' in body) data.validUntil = parseDate(body.validUntil);
    if ('notes' in body) data.notes = optionalString(body, 'notes');
    if ('currentAnnualBillGross' in body) data.currentAnnualBillGross = optionalNumber(body.currentAnnualBillGross) ?? 0;
    if ('projectedAnnualBillGross' in body) data.projectedAnnualBillGross = optionalNumber(body.projectedAnnualBillGross) ?? 0;

    if (!Object.keys(data).length) return badRequest('Brak pól oferty do aktualizacji');

    const shouldArchiveB2c = data.status === 'SENT'
      && existing.status !== 'SENT'
      && buildOfferReport(existing).variant === 'B2C';
    let updated;
    if (shouldArchiveB2c) {
      const prepared = await prepareOfferPdfArchive({ ...existing, ...data });
      try {
        updated = await prisma.$transaction(async (tx) => {
          await tx.offer.update({
            where: { id },
            data: {
              ...data,
              documentTemplateKey: prepared.templateKey,
              documentTemplateVersion: prepared.templateVersion,
            },
          });
          await tx.document.create({
            data: {
              type: 'OFERTA',
              title: `Oferta ${existing.number || existing.title || existing.id} - wersja ${existing.version}`,
              fileName: prepared.fileName,
              mimeType: prepared.mimeType,
              sizeBytes: prepared.sizeBytes,
              sha256: prepared.sha256,
              storagePath: prepared.storagePath,
              clientId: existing.project.clientId,
              projectId: existing.projectId,
              offerId: existing.id,
              uploadedById: access.user.id,
              documentDate: new Date(),
              tags: {
                generated: true,
                offerVersion: existing.version,
                templateKey: prepared.templateKey,
                templateVersion: prepared.templateVersion,
              },
            },
          });
          return tx.offer.findUniqueOrThrow({ where: { id }, include: offerInclude });
        });
      } catch (error) {
        await removePreparedOfferPdf(prepared);
        throw error;
      }
    } else {
      updated = await prisma.offer.update({
        where: { id },
        data,
        include: offerInclude,
      });
    }

    if (updated.status === 'ACCEPTED' && existing.status !== 'ACCEPTED') {
      const stage = await prisma.pipelineStage.findFirst({ where: { code: 'CRM_OFERTA_ZAAKCEPTOWANA', isActive: true } });
      await prisma.$transaction([
        prisma.project.update({
          where: { id: updated.projectId },
          data: { status: 'OFERTA_ZAAKCEPTOWANA', ...(stage ? { stageId: stage.id } : {}) },
        }),
        prisma.activity.create({
          data: {
            type: 'SYSTEM',
            title: `Zaakceptowano ofertę ${updated.number || ''}`.trim(),
            clientId: updated.project.clientId,
            projectId: updated.projectId,
            actorId: access.user.id,
            metadata: { offerId: updated.id, totalGross: Number(updated.totalGross) },
          },
        }),
        ...((updated.configurations || []).length || updated.configurationId ? [prisma.configuration.updateMany({
          where: {
            id: {
              in: Array.from(new Set([
                updated.configurationId,
                ...(updated.configurations || []).map((entry) => entry.configurationId),
              ].filter((id): id is string => Boolean(id)))),
            },
            status: { in: ['DRAFT', 'READY', 'OFFERED'] },
          },
          data: { status: 'ACCEPTED' },
        })] : []),
      ]);
    }

    await writeAuditLog({
      actorId: access.user.id,
      clientId: updated.project.clientId,
      entityType: 'Offer',
      entityId: updated.id,
      action: 'UPDATE',
      before: existing,
      after: updated,
    });
    return jsonResponse({ ok: true, data: updated });
  } catch (error) {
    return serverError('Nie udało się zaktualizować oferty', error);
  }
}

export async function DELETE(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'offers.manage');
  if (!access.ok) return access.response;
  if (!isAdminUser(access.user)) return forbidden('Tylko administrator może usuwać oferty');

  try {
    const body = await readJsonObject(req);
    const id = requireString(body, 'id');
    const existing = await prisma.offer.findUnique({
      where: { id },
      include: {
        ...offerInclude,
        _count: { select: { contracts: true, installations: true, purchaseOrders: true } },
      },
    });
    if (!existing) return notFound('Nie znaleziono oferty');

    const blockReason = offerDeleteBlockReason(existing._count);
    if (blockReason) return badRequest(blockReason);

    const configurationIds = Array.from(new Set([
      existing.configurationId,
      ...existing.configurations.map((entry) => entry.configurationId),
    ].filter((configurationId): configurationId is string => Boolean(configurationId))));

    await prisma.$transaction(async (tx) => {
      await tx.offer.delete({ where: { id } });
      for (const configurationId of configurationIds) {
        const remainingOffers = await tx.offer.count({
          where: {
            OR: [
              { configurationId },
              { configurations: { some: { configurationId } } },
            ],
          },
        });
        if (remainingOffers === 0) {
          await tx.configuration.updateMany({
            where: { id: configurationId, status: 'OFFERED' },
            data: { status: 'READY' },
          });
        }
      }
    });

    await writeAuditLog({
      actorId: access.user.id,
      clientId: existing.project.clientId,
      entityType: 'Offer',
      entityId: existing.id,
      action: 'DELETE',
      before: existing,
    });
    return jsonResponse({ ok: true, data: { id } });
  } catch (error) {
    return serverError('Nie udało się usunąć oferty', error);
  }
}
