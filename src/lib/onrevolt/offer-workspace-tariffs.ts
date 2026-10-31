import type { ClientTariffPayload, ClientTariffPeriod } from './client-tariffs';

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
