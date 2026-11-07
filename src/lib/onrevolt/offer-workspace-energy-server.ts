import type { OfferWorkspaceDraft } from './offer-workspace';
import type { OfferMeasurementSeries } from './offer-measurements';
import type { OfferWorkspace } from './offer-workspace-server';
import { getOfferPvSourceRevision } from './offer-pv-source-revision';
import { OfferPvSourceRevisionError, readOfferPvProfileWithSourceRevision } from './offer-pv-profile';
import { getOfferWorkspaceArtifact, putOfferWorkspaceArtifact } from './offer-workspace-artifacts';
import { buildAnnualProfileOfferWorkspaceEnergy, buildOfferWorkspaceEnergy, type OfferWorkspaceEnergy } from './offer-workspace-energy';
import { buildAnnualOfferConsumptionProfile } from './offer-workspace-annual-profile';
import { resolveSelectedReferenceProfile } from './project-reference-profile';

const OFFER_WORKSPACE_ENERGY_CACHE_VERSION = 3;
const energySourceRevisions = new WeakMap<OfferWorkspaceEnergy, string | null>();

function bindSourceRevision(energy: OfferWorkspaceEnergy, sourceRevision: string | null): OfferWorkspaceEnergy {
  energySourceRevisions.set(energy, sourceRevision);
  return energy;
}

export function getOfferWorkspaceEnergySourceRevision(energy: OfferWorkspaceEnergy): string | null {
  return energySourceRevisions.get(energy) ?? null;
}

function requireStablePvSource(expected: string | null, actual: string | null) {
  if (!expected || actual !== expected) {
    throw new OfferPvSourceRevisionError('Źródło PV zmieniło się podczas obliczania energii. Ponów obliczenia.');
  }
}

function energyArtifactKey(
  workspace: OfferWorkspace,
  draft: OfferWorkspaceDraft,
  existingBatteryPresent: boolean | null,
  pvSourceRevision: string,
) {
  return {
    version: OFFER_WORKSPACE_ENERGY_CACHE_VERSION,
    workspaceRevision: workspace.revision,
    existingPv: {
      powerKw: draft.existingPv.powerKw ?? null,
      tiltDegrees: draft.existingPv.tiltDegrees ?? null,
      azimuthDegrees: draft.existingPv.azimuthDegrees ?? null,
      lossPercent: draft.existingPv.lossPercent ?? null,
    },
    existingBatteryPresent,
    pvReconstructionAccepted: draft.calculation?.pvReconstructionAccepted === true,
    pvSourceRevision,
  };
}

function cachedEnergy(value: unknown): OfferWorkspaceEnergy {
  if (!value || typeof value !== 'object' || !Array.isArray((value as OfferWorkspaceEnergy).intervals)
    || !Array.isArray((value as OfferWorkspaceEnergy).months) || !Array.isArray((value as OfferWorkspaceEnergy).dayProfiles)) {
    throw new Error('Nieprawidłowy trwały cache energii workspace oferty.');
  }
  return value as OfferWorkspaceEnergy;
}

export async function calculateOfferWorkspaceEnergy(
  workspace: OfferWorkspace,
  draft: OfferWorkspaceDraft,
  series: OfferMeasurementSeries | null,
): Promise<OfferWorkspaceEnergy> {
  if (!series?.intervals.length) {
    const hasMeasurementData = (workspace.measurements.intervalCount ?? 0) > 0
      || workspace.measurements.months.some(month => month.importKwh !== null || month.exportKwh !== null)
      || workspace.measurements.periods.some(period => period.hasImport || period.hasExport);
    if (hasMeasurementData) throw new Error('Dostępne są niepełne pomiary; roczny profil nie zastępuje danych godzinowych.');
    if (workspace.measurements.availability !== 'NO_FILES') {
      throw new Error('Roczny profil można użyć tylko wtedy, gdy workspace potwierdza brak plików pomiarowych.');
    }
    if (workspace.input.existingBatteryPresent !== false) {
      throw new Error(workspace.input.existingBatteryPresent == null
        ? 'Potwierdź brak istniejącego magazynu energii przed użyciem profilu rocznego.'
        : 'Roczny profil nie odtwarza przepływów instalacji z istniejącym magazynem energii.');
    }
    if (workspace.input.energyProfileSource !== 'ANNUAL_DECLARATION') {
      throw new Error('Profil RE z rocznej deklaracji wymaga jawnego źródła ANNUAL_DECLARATION; nie zastępuje profilu miesięcznego ani operatora.');
    }
    const { powerKw, tiltDegrees, azimuthDegrees, lossPercent } = draft.existingPv;
    if (powerKw == null) throw new Error('Uzupełnij moc istniejącej PV (0, jeżeli instalacji nie ma).');
    const profile = buildAnnualOfferConsumptionProfile({
      annualConsumptionKwh: workspace.input.annualConsumptionKwh,
      period: workspace.period,
      referenceProfile: await resolveSelectedReferenceProfile(workspace.input.referenceProfile) || undefined,
    });
    if (powerKw === 0) {
      return bindSourceRevision(buildAnnualProfileOfferWorkspaceEnergy({ profile, pvHours: [], noPv: true }), null);
    }

    const { location } = workspace.input;
    if (location?.latitude == null || location.longitude == null) throw new Error('Uzupełnij współrzędne lokalizacji inwestycji.');
    if (tiltDegrees == null || azimuthDegrees == null || lossPercent == null) {
      throw new Error('Uzupełnij nachylenie, azymut i straty istniejącej PV.');
    }
    const sourceRevisionBefore = getOfferPvSourceRevision(location);
    const profileRead = await readOfferPvProfileWithSourceRevision({
      ...location, powerKw, tiltDegrees, azimuthDegrees, lossPercent,
      fromUtc: workspace.period.fromUtc,
      untilUtc: workspace.period.untilUtc,
    });
    requireStablePvSource(profileRead.sourceRevision, getOfferPvSourceRevision(location));
    if (sourceRevisionBefore !== null && sourceRevisionBefore !== profileRead.sourceRevision) {
      throw new OfferPvSourceRevisionError('Źródło PV zmieniło się podczas obliczania energii. Ponów obliczenia.');
    }
    const result = buildAnnualProfileOfferWorkspaceEnergy({ profile, pvHours: profileRead.profile.hours,
      noPv: false, pvSource: profileRead.profile.source, pvModel: profileRead.profile.model });
    return bindSourceRevision(result, profileRead.sourceRevision);
  }
  const { powerKw, tiltDegrees, azimuthDegrees, lossPercent } = draft.existingPv;
  if (powerKw == null) throw new Error('Uzupełnij moc istniejącej PV (0, jeżeli instalacji nie ma).');
  const intervals = [...series.intervals].sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  const existingBatteryPresent = workspace.input.existingBatteryPresent ?? null;
  let location: { latitude: number; longitude: number } | null = null;
  let sourceRevisionBefore: string | null = null;
  if (powerKw !== 0) {
    const { latitude, longitude } = workspace.input.location || {};
    if (latitude == null || longitude == null) throw new Error('Uzupełnij współrzędne lokalizacji inwestycji.');
    if (tiltDegrees == null || azimuthDegrees == null || lossPercent == null) {
      throw new Error('Uzupełnij nachylenie, azymut i straty istniejącej PV.');
    }
    location = { latitude, longitude };
    sourceRevisionBefore = getOfferPvSourceRevision(location);
  }

  const sourceRevisionForKey = powerKw === 0 ? 'zero-capacity' : sourceRevisionBefore;
  const canReuse = sourceRevisionForKey !== null;
  const keyBefore = canReuse ? energyArtifactKey(workspace, draft, existingBatteryPresent, sourceRevisionForKey) : null;
  if (keyBefore) {
    const cached = await getOfferWorkspaceArtifact<unknown>({ projectId: workspace.projectId, kind: 'energy', key: keyBefore });
    if (cached !== null) {
      const currentRevision = powerKw === 0 ? null : getOfferPvSourceRevision(location!);
      if (powerKw !== 0) requireStablePvSource(sourceRevisionBefore, currentRevision);
      return bindSourceRevision(cachedEnergy(cached), powerKw === 0 ? null : sourceRevisionBefore);
    }
  }

  let result: OfferWorkspaceEnergy;
  let sourceRevisionAfter: string | null = sourceRevisionForKey;
  if (powerKw === 0) {
    result = buildOfferWorkspaceEnergy({
      intervals, months: workspace.measurements.months, dayProfiles: workspace.measurements.dayProfiles || [],
      pvHours: [], noPv: true, existingBatteryPresent,
      source: 'Pomiary operatora', model: 'Brak instalacji PV',
    });
  } else {
    const profileRead = await readOfferPvProfileWithSourceRevision({
      ...location!, powerKw, tiltDegrees: tiltDegrees!, azimuthDegrees: azimuthDegrees!, lossPercent: lossPercent!,
      fromUtc: new Date(Math.floor(Date.parse(intervals[0].startUtc) / 3_600_000) * 3_600_000).toISOString(),
      untilUtc: new Date(Math.ceil(Date.parse(intervals[intervals.length - 1].endUtc) / 3_600_000) * 3_600_000).toISOString(),
    });
    sourceRevisionAfter = profileRead.sourceRevision;
    requireStablePvSource(sourceRevisionAfter, getOfferPvSourceRevision(location!));
    if (sourceRevisionBefore !== null && sourceRevisionBefore !== sourceRevisionAfter) {
      throw new OfferPvSourceRevisionError('Źródło PV zmieniło się podczas obliczania energii. Ponów obliczenia.');
    }
    const profile = profileRead.profile;
    result = buildOfferWorkspaceEnergy({
      intervals, months: workspace.measurements.months, dayProfiles: workspace.measurements.dayProfiles || [],
      pvHours: profile.hours, noPv: false, existingBatteryPresent,
      acceptMeasuredExportReconstruction: draft.calculation?.pvReconstructionAccepted === true,
      source: `${profile.source} · 2020–2024`, model: profile.model,
    });
  }

  const sourceWasStable = powerKw === 0 || sourceRevisionBefore === null || sourceRevisionBefore === sourceRevisionAfter;
  if (sourceRevisionAfter !== null && sourceWasStable) {
    if (powerKw !== 0) requireStablePvSource(sourceRevisionAfter, getOfferPvSourceRevision(location!));
    await putOfferWorkspaceArtifact({
      projectId: workspace.projectId, kind: 'energy',
      key: energyArtifactKey(workspace, draft, existingBatteryPresent, sourceRevisionAfter),
    }, result);
  }
  return bindSourceRevision(result, powerKw === 0 ? null : sourceRevisionAfter);
}
