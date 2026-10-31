import { NextRequest } from 'next/server';
import { badRequest, forbidden, jsonResponse, notFound, readJsonObject, serverError } from 'lib/onrevolt/api';
import { authorizeStaffRequest, hasStaffPermission } from 'lib/onrevolt/staff-server';
import { prisma } from 'lib/onrevolt/prisma';
import { offerWorkspaceProjectWhere } from 'lib/onrevolt/offer-workspace-server';
import { readOfferPvProfile } from 'lib/onrevolt/offer-pv-profile';
import {
  annualPvProductionKwh,
  completeProjectPvProfileInput,
  projectPvSettingsFromSources,
} from 'lib/onrevolt/project-pv-settings';
import { readProjectAnalysisPeriod } from 'lib/onrevolt/project-analysis-period-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function finiteCoordinate(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  if (!hasStaffPermission(access.user, 'energy.manage')) return forbidden('Wymagane uprawnienie energy.manage.');

  try {
    const { id } = await context.params;
    const project = await prisma.project.findFirst({
      where: offerWorkspaceProjectWhere(id, access.user),
      select: {
        investmentSite: { select: { latitude: true, longitude: true } },
        offerWorkspace: { select: { revision: true, input: true } },
        energyAudits: {
          select: { existingPvKw: true, roofTiltDeg: true, roofOrientation: true },
          take: 1,
        },
      },
    });
    if (!project) return notFound('Nie znaleziono projektu');

    const periodSource = await readProjectAnalysisPeriod(id);
    if (!periodSource) return notFound('Nie znaleziono projektu');
    const period = periodSource.period;
    const data = {
      period,
      existingPv: projectPvSettingsFromSources({
        draftExists: Boolean(project.offerWorkspace),
        draftInput: project.offerWorkspace?.input,
        energyAudit: project.energyAudits[0] || null,
      }),
      latitude: finiteCoordinate(project.investmentSite?.latitude),
      longitude: finiteCoordinate(project.investmentSite?.longitude),
      revision: project.offerWorkspace?.revision ?? 0,
    };
    return jsonResponse({ ok: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return serverError('Nie udało się odczytać parametrów PV.', error);
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  if (!hasStaffPermission(access.user, 'energy.manage')) return forbidden('Wymagane uprawnienie energy.manage.');

  try {
    const body = await readJsonObject(req);
    const { id } = await context.params;
    const project = await prisma.project.findFirst({
      where: offerWorkspaceProjectWhere(id, access.user),
      select: { investmentSite: { select: { latitude: true, longitude: true } } },
    });
    if (!project) return notFound('Nie znaleziono projektu');

    const periodSource = await readProjectAnalysisPeriod(id);
    if (!periodSource) return notFound('Nie znaleziono projektu');
    const period = periodSource.period;
    let input;
    try {
      input = completeProjectPvProfileInput(
        body.existingPv,
        finiteCoordinate(project.investmentSite?.latitude),
        finiteCoordinate(project.investmentSite?.longitude),
        period,
      );
    } catch (error) {
      return jsonResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Niekompletne parametry profilu PV.',
      }, { status: 422, headers: { 'Cache-Control': 'private, no-store' } });
    }
    let profile;
    try {
      profile = await readOfferPvProfile(input);
    } catch (error) {
      return serverError('Nie udało się obliczyć profilu PV.', error);
    }
    return jsonResponse({ ok: true, data: {
      period,
      annualKwh: annualPvProductionKwh(profile.hours),
      source: profile.source,
      model: profile.model,
      fromUtc: input.fromUtc,
      untilUtc: input.untilUtc,
      latitude: input.latitude,
      longitude: input.longitude,
    } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof SyntaxError) return badRequest('Nieprawidłowy JSON.');
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Nie udało się obliczyć profilu PV.',
    }, { status: 422, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
