export type ConfigurationUsage = {
  status?: string | null;
  offers?: number;
  installations?: number;
  stockReservations?: number;
};

export function configurationDeleteBlockReason(configuration: ConfigurationUsage) {
  const isUsed = Number(configuration.offers || 0) > 0
    || Number(configuration.installations || 0) > 0
    || Number(configuration.stockReservations || 0) > 0;

  if (isUsed) {
    return 'Konfiguracja jest używana przez ofertę, montaż lub rezerwację. Zarchiwizuj ją zamiast usuwać.';
  }
  if (configuration.status !== 'DRAFT') {
    return 'Usunąć można tylko konfigurację roboczą. Zarchiwizuj ją zamiast usuwać.';
  }
  return undefined;
}
