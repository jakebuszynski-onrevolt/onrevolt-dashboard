import { NextRequest } from 'next/server';
import { jsonResponse, notFound } from 'lib/onrevolt/api';
import { buildOfferMeasurementSeries, type OfferMeasurementKind, type OfferMeasurementFileInput, type OfferMeasurementSeries } from 'lib/onrevolt/offer-measurements';
import {
  offerWorkspaceProjectWhere,
  readOfferWorkspaceMeasurement,
  summarizeOfferMeasurementSeries,
  type OfferWorkspaceStoredMeasurement,
} from 'lib/onrevolt/offer-workspace-server';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';
import { buildClientEnergyActualDays } from 'lib/onrevolt/client-energy-summary';
import { readProjectAnalysisPeriod } from 'lib/onrevolt/project-analysis-period-server';
import { readOfferPvProfile } from 'lib/onrevolt/offer-pv-profile';
import { completeProjectPvProfileInput, projectPvSettingsFromSources } from 'lib/onrevolt/project-pv-settings';
import { buildClientEnergyPvSummary, resolveClientEnergyBatteryPresence } from 'lib/onrevolt/client-energy-pv-summary';
import { calculateClientEnergyCostSummaryOnServer, type ClientEnergyCostSummaryProject } from 'lib/onrevolt/client-energy-cost-summary-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const maxMeasurementDocuments = 24;

function emptyMonths(periods: string[]) {
  return periods.map((period) => ({
    period,
    importKwh: null as number | null,
    exportKwh: null as number | null,
    importAvailable: false,
    exportAvailable: false,
  }));
}

function finiteCoordinate(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;

  try {
    const { id: projectId } = await context.params;
    const project = await prisma.project.findFirst({
      where: offerWorkspaceProjectWhere(projectId, access.user),
      select: {
        id: true,
        clientId: true,
        clientType: true,
        investmentSite: { select: { latitude: true, longitude: true } },
        offerWorkspace: { select: { input: true } },
        energyAudits: {
          select: {
            existingPvKw: true, roofTiltDeg: true, roofOrientation: true, existingBatteryKwh: true,
            annualConsumptionKwh: true, settlementSystem: true, connectionPowerKw: true,
          },
          take: 1,
        },
      },
    });
    if (!project) return notFound('Nie znaleziono projektu');

    const periodSource = await readProjectAnalysisPeriod(projectId);
    if (!periodSource) return notFound('Nie znaleziono projektu');
    const period = periodSource.period;
    const periodKeys = period.periodKeys;
    const energyAudit = project.energyAudits[0] || null;
    const pvSettings = projectPvSettingsFromSources({
      draftExists: Boolean(project.offerWorkspace),
      draftInput: project.offerWorkspace?.input,
      energyAudit,
    });
    const existingBatteryPresent = resolveClientEnergyBatteryPresence(
      project.offerWorkspace?.input,
      energyAudit?.existingBatteryKwh,
    );
    let modelHours: Array<{ startUtc: string; pvKwh: number }> | null = null;
    let modelError: string | null = null;
    let modelUrl: string | null = null;
    let pvSummary: ((measurementSeries: OfferMeasurementSeries | null, months: ReturnType<typeof emptyMonths>) => ReturnType<typeof buildClientEnergyPvSummary>) | null = null;
    if (pvSettings.powerKw != null && pvSettings.powerKw > 0) {
      try {
        const modelInput = completeProjectPvProfileInput(
          pvSettings,
          finiteCoordinate(project.investmentSite?.latitude),
          finiteCoordinate(project.investmentSite?.longitude),
          period,
        );
        const manualUrl = new URL('https://my.onrevolt.com/pv/');
        manualUrl.searchParams.set('mode', 'manual');
        manualUrl.searchParams.set('layout', 'single');
        manualUrl.searchParams.set('lat', String(modelInput.latitude));
        manualUrl.searchParams.set('lon', String(modelInput.longitude));
        manualUrl.searchParams.set('capacityKwp', String(modelInput.powerKw));
        manualUrl.searchParams.set('tilt', String(modelInput.tiltDegrees));
        manualUrl.searchParams.set('azimuth', String(modelInput.azimuthDegrees));
        manualUrl.searchParams.set('lossPercent', String(modelInput.lossPercent));
        modelUrl = manualUrl.toString();
        const profile = await readOfferPvProfile(modelInput);
        modelHours = profile.hours;
      } catch (error) {
        modelError = error instanceof Error ? error.message : String(error);
      }
      pvSummary = (measurementSeries, months) => buildClientEnergyPvSummary({
        periodKeys,
        fromUtc: period.fromUtc,
        untilUtc: period.untilUtc,
        modelHours,
        modelError,
        modelUrl,
        measurementSeries,
        months,
        existingBatteryPresent,
      });
    }
    const accounts = await prisma.energyPortalAccount.findMany({
      where: { projectId, clientId: project.clientId, operator: 'ENEA' },
      select: { id: true, ppeNumber: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!accounts.length) {
      const months = emptyMonths(periodKeys);
      return jsonResponse({ ok: true, data: {
        period, months, days: [],
        issues: ['Nie znaleziono konta ENEA przypisanego do projektu.'],
        ...(pvSummary ? { pv: pvSummary(null, months) } : {}),
        cost: await calculateClientEnergyCostSummaryOnServer({ project: project as unknown as ClientEnergyCostSummaryProject, period, series: null, months }),
      } }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const ppeNumbers = Array.from(new Set(accounts.map((account) => account.ppeNumber?.trim()).filter((value): value is string => Boolean(value))));
    if (ppeNumbers.length > 1) {
      const months = emptyMonths(periodKeys);
      return jsonResponse({ ok: true, data: {
        period, months, days: [],
        issues: ['Projekt ma kilka numerów PPE; pomiary nie zostały połączone w jeden profil.'],
        ...(pvSummary ? { pv: pvSummary(null, months) } : {}),
        cost: await calculateClientEnergyCostSummaryOnServer({ project: project as unknown as ClientEnergyCostSummaryProject, period, series: null, months }),
      } }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const scopedAccounts = ppeNumbers.length
      ? accounts.filter((account) => account.ppeNumber?.trim() === ppeNumbers[0])
      : accounts;
    const periodWhere = periodKeys.map((period) => {
      const [periodYear, periodMonth] = period.split('-').map(Number);
      return { periodYear, periodMonth };
    });
    const records = await prisma.energyMeasurementFile.findMany({
      where: {
        accountId: { in: scopedAccounts.map((account) => account.id) },
        clientId: project.clientId,
        operator: 'ENEA',
        status: 'DOWNLOADED',
        kind: { in: ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'] },
        AND: [
          { OR: periodWhere },
          { OR: [{ projectId }, { projectId: null }] },
        ],
      },
      select: {
        id: true,
        clientId: true,
        projectId: true,
        accountId: true,
        kind: true,
        periodYear: true,
        periodMonth: true,
        aggregation: true,
        storagePath: true,
        fileName: true,
        updatedAt: true,
        document: { select: { clientId: true, projectId: true, storagePath: true, fileName: true, sizeBytes: true, sha256: true } },
      },
      orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }, { kind: 'asc' }, { id: 'asc' }],
      take: maxMeasurementDocuments + 1,
    });

    const issues: string[] = [];
    let months = emptyMonths(periodKeys);
    let days: ReturnType<typeof buildClientEnergyActualDays> = [];
    let measurementSeries: OfferMeasurementSeries | null = null;

    if (records.length > maxMeasurementDocuments) {
      issues.push(`Znaleziono więcej niż ${maxMeasurementDocuments} pliki pomiarowe; dane nie zostały wczytane.`);
    } else if (!records.length) {
      issues.push(`Brak pobranych miesięcznych plików ENEA w okresie ${period.startMonth}–${period.endMonth}.`);
    } else {
      const eligible = records.filter((file) => {
        if (file.clientId !== project.clientId || (file.projectId && file.projectId !== projectId)) {
          issues.push(`Plik ${file.id}: niespójne powiązanie klienta, projektu lub konta.`);
          return false;
        }
        if (file.document && (file.document.clientId !== project.clientId || (file.document.projectId && file.document.projectId !== projectId))) {
          issues.push(`Plik ${file.id}: dokument nie należy do wskazanego klienta i projektu.`);
          return false;
        }
        return true;
      });
      if (!ppeNumbers.length) {
        issues.push('Brak numeru PPE potrzebnego do walidacji plików pomiarowych.');
      } else {
        const ppeNumber = ppeNumbers[0];
        const inputs: OfferMeasurementFileInput[] = [];
        for (const file of eligible) {
          const expectedPeriod = `${file.periodYear}-${String(file.periodMonth).padStart(2, '0')}`;
          try {
            const stored: OfferWorkspaceStoredMeasurement = {
              id: file.id,
              clientId: file.clientId,
              projectId: file.projectId,
              accountId: file.accountId,
              kind: file.kind as OfferMeasurementKind,
              periodYear: file.periodYear,
              periodMonth: file.periodMonth,
              aggregation: file.aggregation,
              storagePath: file.storagePath,
              fileName: file.fileName,
              document: file.document,
            };
            const bytes = await readOfferWorkspaceMeasurement(stored);
            inputs.push({ id: file.id, expectedPeriod, expectedKind: file.kind as OfferMeasurementKind, bytes, projectId });
          } catch (error) {
            issues.push(`Plik ${file.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        const monthMap = new Map<string, { period: string; importKwh: number | null; exportKwh: number | null; importAvailable: boolean; exportAvailable: boolean }>();
        const actualDays = new Map<string, ReturnType<typeof buildClientEnergyActualDays>[number]>();
        try {
          const series = buildOfferMeasurementSeries(inputs, { ppeNumber, periodKeys, projectId });
          measurementSeries = series;
          const summary = summarizeOfferMeasurementSeries(series, [], periodKeys);
          for (const month of summary.months) {
            const monthSeries = series.periods.find((item) => item.period === month.period);
            monthMap.set(month.period, {
              ...month,
              importAvailable: Boolean(monthSeries?.hasImport),
              exportAvailable: Boolean(monthSeries?.hasExport),
            });
          }
          for (const day of buildClientEnergyActualDays(series.intervals)) actualDays.set(day.date, day);
        } catch (error) {
          issues.push(`Nie udało się odczytać pomiarów z okresu ${periodKeys[0]}–${periodKeys[periodKeys.length - 1]}: ${error instanceof Error ? error.message : String(error)}`);
        }

        months = periodKeys.map((period) => monthMap.get(period) || {
          period, importKwh: null, exportKwh: null, importAvailable: false, exportAvailable: false,
        });
        days = Array.from(actualDays.values()).sort((a, b) => a.date.localeCompare(b.date));
        const importMonths = months.filter((month) => month.importAvailable).length;
        const exportMonths = months.filter((month) => month.exportAvailable).length;
        if (importMonths < periodKeys.length) issues.push(`Pobór z sieci dostępny w ${importMonths}/${periodKeys.length} miesięcy okresu analizy.`);
        if (exportMonths < periodKeys.length) issues.push(`Oddanie do sieci dostępne w ${exportMonths}/${periodKeys.length} miesięcy okresu analizy.`);
        if (!inputs.length && !issues.some((issue) => issue.startsWith('Plik '))) {
          issues.push('Nie udało się wczytać żadnego dokumentu pomiarowego.');
        }
      }
    }

    return jsonResponse({ ok: true, data: {
      period, months, days, issues,
      ...(pvSummary ? { pv: pvSummary(measurementSeries, months) } : {}),
      cost: await calculateClientEnergyCostSummaryOnServer({ project: project as unknown as ClientEnergyCostSummaryProject, period, series: measurementSeries, months }),
    } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Error && error.message === 'Nie znaleziono projektu') return notFound(error.message);
    return jsonResponse({ ok: false, error: 'Nie udało się wczytać podsumowania energii.' }, { status: 500 });
  }
}
