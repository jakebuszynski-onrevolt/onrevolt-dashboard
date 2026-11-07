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
import { blockedClientEnergyCostSummary } from 'lib/onrevolt/client-energy-cost-summary';
import { buildAnnualOfferConsumptionProfile, type OfferAnnualConsumptionProfile } from 'lib/onrevolt/offer-workspace-annual-profile';
import { annualOfferMeasurementSeries, buildAnnualProfileOfferWorkspaceEnergy, type OfferWorkspaceEnergy } from 'lib/onrevolt/offer-workspace-energy';
import { readProjectReferenceProfileSelection, resolveSelectedReferenceProfile } from 'lib/onrevolt/project-reference-profile';

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

function positiveAnnualConsumption(value: unknown): number | null {
  const number = finiteCoordinate(value);
  return number != null && number > 0 ? number : null;
}

function annualModelPayload(profile: OfferAnnualConsumptionProfile, energy: OfferWorkspaceEnergy | null, reason: string | null) {
  const profileMonths = new Map<string, number>();
  for (const interval of profile.intervals) profileMonths.set(interval.period, (profileMonths.get(interval.period) || 0) + interval.loadKwh);
  const energyMonths = new Map((energy?.modelledMeasurements?.months || []).map(month => [month.period, month]));
  const energyDays = new Map((energy?.modelledMeasurements?.dayProfiles || []).map(day => [day.date, day]));
  const days = profile.dayProfiles.map(day => {
    const modeledDay = energyDays.get(day.date);
    const intervalsByHour = new Map<number, number>();
    for (const interval of profile.intervals) {
      if (interval.date === day.date) intervalsByHour.set(interval.hour, (intervalsByHour.get(interval.hour) || 0) + interval.loadKwh);
    }
    return {
      date: day.date,
      period: day.period,
      hours: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        loadKwh: energy?.dayProfiles.find(item => item.date === day.date)?.hours.find(item => item.hour === hour)?.loadKwh
          ?? intervalsByHour.get(hour) ?? null,
        importKwh: modeledDay?.hours.find(item => item.hour === hour)?.importKwh ?? null,
        exportKwh: modeledDay?.hours.find(item => item.hour === hour)?.exportKwh ?? null,
      })),
    };
  });
  return {
    source: 'MODELLED' as const,
    provenance: {
      kind: 'annual-consumption' as const,
      source: profile.source,
      annualConsumptionKwh: profile.annualConsumptionKwh,
      ...(profile.referenceProfile ? { referenceProfile: profile.referenceProfile } : {}),
    },
    flowAvailable: energy?.modelledMeasurements != null,
    months: [...profileMonths].sort(([left], [right]) => left.localeCompare(right)).map(([period, loadKwh]) => {
      const month = energyMonths.get(period);
      return { period, loadKwh, importKwh: month?.importKwh ?? null, exportKwh: month?.exportKwh ?? null };
    }),
    days,
    issues: [...(energy?.issues || []), ...(reason ? [reason] : [])],
  };
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
            annualConsumptionKwh: true, profileSource: true, settlementSystem: true, connectionPowerKw: true,
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
    async function annualFallback(measurementIssue: string, months: ReturnType<typeof emptyMonths>) {
      const annualConsumptionKwh = energyAudit?.profileSource === 'ANNUAL_DECLARATION'
        ? positiveAnnualConsumption(energyAudit.annualConsumptionKwh) : null;
      if (annualConsumptionKwh == null) return null;
      let referenceSelection: Awaited<ReturnType<typeof readProjectReferenceProfileSelection>> | null = null;
      let selectionRead = false;
      let profile: OfferAnnualConsumptionProfile;
      try {
        referenceSelection = await readProjectReferenceProfileSelection(projectId);
        selectionRead = true;
        const referenceProfile = await resolveSelectedReferenceProfile(referenceSelection);
        profile = buildAnnualOfferConsumptionProfile({ annualConsumptionKwh, period, referenceProfile: referenceProfile || undefined });
      } catch (error) {
        const reason = `Nie udało się zbudować profilu MODELLED: ${error instanceof Error ? error.message : String(error)}`;
        const profileSource = !selectionRead
          ? 'Roczne zużycie · źródło nieustalone'
          : referenceSelection?.key
            ? `Roczne zużycie · profil referencyjny ${referenceSelection.profileName || referenceSelection.key}`
            : 'Roczne zużycie · profil godzinowy RE';
        return {
          period, months, days: [], issues: [measurementIssue, reason],
          ...(pvSummary ? { pv: pvSummary(null, months) } : {}),
          annualModel: { source: 'MODELLED' as const, flowAvailable: false, profileSource, annualConsumptionKwh,
            months: [], days: [], issues: [reason] },
          cost: { ...blockedClientEnergyCostSummary(project.clientType === 'B2B' ? 'NET' : 'GROSS',
            (Date.parse(period.untilUtc) - Date.parse(period.fromUtc)) / 3_600_000,
            'Nie obliczono kosztu: nie udało się zbudować modelowanego profilu rocznego.'), source: 'MODELLED' as const },
        };
      }

      const noPv = pvSettings.powerKw === 0;
      const pvKnown = noPv || (pvSettings.powerKw != null && pvSettings.powerKw > 0 && modelHours != null);
      const flowBlockedReason = existingBatteryPresent !== false
        ? existingBatteryPresent === null
          ? 'Nie obliczono poboru i oddania: status istniejącego magazynu energii wymaga potwierdzenia.'
          : 'Nie obliczono poboru i oddania: w obiekcie jest magazyn energii, którego przepływów nie modelowano.'
        : !pvKnown
          ? 'Nie obliczono poboru i oddania: status PV jest nieznany albo model produkcji PV jest niekompletny.'
          : null;
      let energy: OfferWorkspaceEnergy | null = null;
      if (!flowBlockedReason && pvKnown) {
        energy = buildAnnualProfileOfferWorkspaceEnergy({
          profile,
          pvHours: noPv ? [] : modelHours || [],
          noPv,
          pvSource: noPv ? 'Potwierdzony brak PV' : 'Model PV',
          pvModel: noPv ? 'model zerowej produkcji PV' : 'profil godzinowy PV',
        });
      }
      const annualModel = annualModelPayload(profile, energy, flowBlockedReason);
      const modeledSeries = energy ? annualOfferMeasurementSeries(profile, energy) : null;
      const cost = modeledSeries
        ? await calculateClientEnergyCostSummaryOnServer({
          project: project as unknown as ClientEnergyCostSummaryProject,
          period,
          series: modeledSeries,
          months,
          energySource: 'MODELLED',
        })
        : {
          ...blockedClientEnergyCostSummary(project.clientType === 'B2B' ? 'NET' : 'GROSS',
            (Date.parse(period.untilUtc) - Date.parse(period.fromUtc)) / 3_600_000,
            flowBlockedReason || 'Nie obliczono kosztu: brak kompletnych danych do modelu godzinowego.'),
          source: 'MODELLED' as const,
        };
      const pv = energy && !noPv
        ? {
          productionKwh: energy.totals.pvKwh,
          selfConsumptionKwh: energy.totals.directKwh,
          coveredMonths: period.periodKeys.length,
          totalMonths: period.periodKeys.length,
          coveredHours: profile.intervals.length,
          totalHours: profile.intervals.length,
          modelUrl,
          note: 'MODELLED · produkcja PV z profilu pogodowego; autokonsumpcja to suma godzinowego min(zużycie, produkcja).',
          issues: energy.issues,
        }
        : pvSummary ? pvSummary(null, months) : undefined;
      return {
        period, months, days: [], issues: [...annualModel.issues], annualModel,
        ...(pv ? { pv } : {}), cost,
      };
    }
    const projectAccounts = await prisma.energyPortalAccount.findMany({
      where: { projectId, clientId: project.clientId },
      select: { id: true, ppeNumber: true, operator: true },
      orderBy: { updatedAt: 'desc' },
    });
    // The measurement reader currently supports ENEA exports only. Other
    // operators still use their own selected tariff in the cost summary.
    const accounts = projectAccounts.filter(account => account.operator === 'ENEA');
    if (!accounts.length) {
      const months = emptyMonths(periodKeys);
      const operators = Array.from(new Set(projectAccounts.map(account => account.operator)));
      const measurementIssue = operators.length
        ? `Import pomiarów godzinowych dla operatora ${operators.join(', ')} nie jest jeszcze obsługiwany.`
        : 'Nie znaleziono konta operatora energii przypisanego do projektu.';
      const modeled = await annualFallback(measurementIssue, months);
      if (modeled) return jsonResponse({ ok: true, data: modeled }, { headers: { 'Cache-Control': 'private, no-store' } });
      return jsonResponse({ ok: true, data: {
        period, months, days: [],
        issues: [measurementIssue],
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
      const periodWhere = periodKeys.map((period) => {
        const [periodYear, periodMonth] = period.split('-').map(Number);
        return { periodYear, periodMonth };
      });
      const nonDownloadedRecords = await prisma.energyMeasurementFile.findMany({
        where: {
          accountId: { in: scopedAccounts.map((account) => account.id) },
          clientId: project.clientId,
          operator: 'ENEA',
          status: { not: 'DOWNLOADED' },
          kind: { in: ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'] },
          AND: [
            { OR: periodWhere },
            { OR: [{ projectId }, { projectId: null }] },
          ],
        },
        select: { id: true, status: true },
      });
      if (nonDownloadedRecords.length) {
        issues.push(`Znaleziono ${nonDownloadedRecords.length} rekordów plików ENEA poza statusem DOWNLOADED; profil roczny nie zastępuje tych źródeł.`);
      }
      const modeled = nonDownloadedRecords.length ? null : await annualFallback(issues[0], months);
      if (modeled) return jsonResponse({ ok: true, data: modeled }, { headers: { 'Cache-Control': 'private, no-store' } });
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
