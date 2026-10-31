import type { OfferWorkspaceDraft } from './offer-workspace';
import type { OfferMeasurementSeries } from './offer-measurements';
import type { OfferWorkspace } from './offer-workspace-server';
import { readOfferPvProfile } from './offer-pv-profile';
import { buildOfferWorkspaceEnergy, type OfferWorkspaceEnergy } from './offer-workspace-energy';

export async function calculateOfferWorkspaceEnergy(
  workspace: OfferWorkspace,
  draft: OfferWorkspaceDraft,
  series: OfferMeasurementSeries | null,
): Promise<OfferWorkspaceEnergy> {
  if (!series?.intervals.length) throw new Error('Brak godzinowych pomiarów poboru i oddania dla tego projektu.');
  const { powerKw, tiltDegrees, azimuthDegrees, lossPercent } = draft.existingPv;
  if (powerKw == null) throw new Error('Uzupełnij moc istniejącej PV (0, jeżeli instalacji nie ma).');
  const intervals = [...series.intervals].sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  if (powerKw === 0) return buildOfferWorkspaceEnergy({
    intervals, months: workspace.measurements.months, dayProfiles: workspace.measurements.dayProfiles || [],
    pvHours: [], noPv: true, existingBatteryPresent: draft.existingBatteryPresent ?? null,
    source: 'Pomiary operatora', model: 'Brak instalacji PV',
  });
  const { latitude, longitude } = workspace.input.location || {};
  if (latitude == null || longitude == null) throw new Error('Uzupełnij współrzędne lokalizacji inwestycji.');
  if (tiltDegrees == null || azimuthDegrees == null || lossPercent == null) {
    throw new Error('Uzupełnij nachylenie, azymut i straty istniejącej PV.');
  }
  const profile = await readOfferPvProfile({
    latitude, longitude, powerKw, tiltDegrees, azimuthDegrees, lossPercent,
    fromUtc: new Date(Math.floor(Date.parse(intervals[0].startUtc) / 3_600_000) * 3_600_000).toISOString(),
    untilUtc: new Date(Math.ceil(Date.parse(intervals[intervals.length - 1].endUtc) / 3_600_000) * 3_600_000).toISOString(),
  });
  return buildOfferWorkspaceEnergy({
    intervals, months: workspace.measurements.months, dayProfiles: workspace.measurements.dayProfiles || [],
    pvHours: profile.hours, noPv: false, existingBatteryPresent: draft.existingBatteryPresent ?? null,
    acceptMeasuredExportReconstruction: draft.calculation?.pvReconstructionAccepted === true,
    source: `${profile.source} · 2020–2024`, model: profile.model,
  });
}
