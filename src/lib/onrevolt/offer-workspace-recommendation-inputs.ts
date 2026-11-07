import {
  defaultOfferCalculationAssumptions,
  type OfferWorkspaceDraft,
} from './offer-workspace';

export type OfferWorkspaceRecommendationInputIssue = {
  code: 'VAT_REVIEW' | 'ADDED_PV_GEOMETRY' | 'SETTLEMENT_REQUIRED' | 'STORAGE_NET_METERING';
  message: string;
};

/** Wskazuje pola szkicu wymagane do rekomendacji magazynu. */
export function recommendationInputIssues(draft: OfferWorkspaceDraft): OfferWorkspaceRecommendationInputIssue[] {
  const issues: OfferWorkspaceRecommendationInputIssue[] = [];

  if (draft.saleVatMode === 'REVIEW') {
    issues.push({
      code: 'VAT_REVIEW',
      message: 'Wybierz VAT sprzedaży: 8%, 23% albo stawki mieszane.',
    });
  }

  const missingSettlements = [
    draft.existingPv.powerKw !== 0 && draft.currentSettlement == null ? 'obecny sposób rozliczeń' : null,
    draft.targetSettlement == null ? 'docelowy sposób rozliczeń' : null,
  ].filter((value): value is string => value !== null);
  if (missingSettlements.length) {
    issues.push({
      code: 'SETTLEMENT_REQUIRED',
      message: `Brakujące dane szkicu: ${missingSettlements.join(', ')}.${draft.targetSettlement == null ? ' Docelowe rozliczenie wybierz w kroku System rozliczeń.' : ''}`,
    });
  }

  if (draft.pvStrategy === 'ADD_TEMPLATE') {
    const assumptions = {
      ...defaultOfferCalculationAssumptions(),
      ...(draft.calculation || {}),
    };
    const missingGeometry: string[] = [];
    if (assumptions.addedPvTiltDegrees == null) missingGeometry.push('nachylenie dodatkowej PV');
    if (assumptions.addedPvAzimuthDegrees == null) missingGeometry.push('azymut dodatkowej PV');

    const missingLosses = draft.existingPv.lossPercent == null;
    const missingFields = [...missingGeometry, ...(missingLosses ? ['straty modelu PV'] : [])];
    if (missingFields.length) {
      const locations = [
        missingGeometry.length ? 'geometrię wpisz w Założeniach obliczeń' : null,
        missingLosses ? 'straty modelu uzupełnij w kroku System' : null,
      ].filter((value): value is string => value !== null);
      issues.push({
        code: 'ADDED_PV_GEOMETRY',
        message: `Uzupełnij brakujące pola: ${missingFields.join(', ')} (${locations.join('; ')}).`,
      });
    }
  }

  if (draft.targetSettlement === 'NET_METERING') {
    issues.push({
      code: 'STORAGE_NET_METERING',
      message: 'Rekomendowanie magazynu energii dla rozliczenia net-metering nie jest jeszcze dostępne. Zmień rozliczenie docelowe na net-billing, jeśli taki scenariusz chcesz przeanalizować.',
    });
  }

  return issues;
}
