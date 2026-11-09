import type { ClientTariffData, ClientTariffPayload, ClientTariffPeriod, GeneralTariffSelection } from './client-tariffs';

export function resolveOfferGeneralTariff(selection: GeneralTariffSelection | null | undefined, catalog: ClientTariffData['catalog']): GeneralTariffSelection | null {
  if (!selection) return null;
  if (selection.osdId && selection.tariffId) return selection;
  const normalized = (value: string) => value.trim().toLocaleUpperCase('pl-PL');
  const operators = catalog.filter(operator => selection.osdId
    ? operator.id === selection.osdId
    : normalized(operator.name) === normalized(selection.operator) || normalized(operator.slug) === normalized(selection.operator));
  if (operators.length !== 1) return null;
  const tariffs = operators[0].tariffs.filter(tariff => selection.tariffId
    ? tariff.id === selection.tariffId : normalized(tariff.code) === normalized(selection.code));
  if (tariffs.length !== 1) return null;
  return { ...selection, osdId: operators[0].id, tariffId: tariffs[0].id };
}

export type OfferTariffRateState =
  | { status: 'loading' }
  | { status: 'unavailable'; message: string }
  | { status: 'ready'; tariff: ClientTariffPayload; source?: string };

export type OfferTariffHistory = {
  periods: ClientTariffPeriod[];
  resolved: Record<string, { ok: boolean; tariff?: ClientTariffPayload; error?: string }>;
};

export function offerTariffCatalogKey(osdId: number | null | undefined, tariffId: number | null | undefined, date: string) {
  return osdId && tariffId ? `${osdId}:${tariffId}:${date}` : null;
}

export function resolveCurrentOfferTariff(history: OfferTariffHistory | null | undefined, date: string) {
  const hasHistory = Boolean(history?.periods.length);
  const period = history?.periods.find((item) =>
    (!item.validFrom || item.validFrom <= date) && (!item.validUntil || item.validUntil > date));
  if (!period) return {
    hasHistory,
    period: null,
    state: { status: 'unavailable', message: 'Brak potwierdzonej taryfy historycznej dla bieżącej daty.' } as OfferTariffRateState,
  };

  const resolved = history?.resolved[period.id];
  if (!resolved?.ok || !resolved.tariff) return {
    hasHistory,
    period,
    state: { status: 'unavailable', message: resolved?.error || 'Ceny bieżącej taryfy wymagają uzupełnienia.' } as OfferTariffRateState,
  };

  return {
    hasHistory,
    period,
    state: { status: 'ready', tariff: resolved.tariff, source: period.source } as OfferTariffRateState,
  };
}
