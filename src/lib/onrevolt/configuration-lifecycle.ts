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
    return 'Konfiguracja jest używana przez ofertę, montaż lub rezerwację i musi pozostać w historii procesu.';
  }
  return undefined;
}

export function configurationEditBlockReason(configuration: ConfigurationUsage) {
  const isUsed = Number(configuration.offers || 0) > 0
    || Number(configuration.installations || 0) > 0
    || Number(configuration.stockReservations || 0) > 0;

  if (isUsed) {
    return 'Konfiguracja jest już używana w procesie. Utwórz nowy wariant, aby wprowadzić zmiany.';
  }
  if (!['DRAFT', 'READY'].includes(configuration.status || '')) {
    return 'Edytować można tylko konfigurację roboczą lub gotową.';
  }
  return undefined;
}
