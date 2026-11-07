import type SharedTariffEngine from '../../../public/shared/re-tariff-engine.js';
import type { ClientTariffPayload } from './client-tariffs';

type OfferTariffPayload = ClientTariffPayload & {
  energy_schedule?: { model: 'monthly_codes'; monthly: Record<string, string[]> };
  sell_method?: string;
  osd_add_rdn?: number;
  osd_add_akcyza?: number;
};

type OfferTariffEngine = typeof SharedTariffEngine & {
  energyZone(tariff: OfferTariffPayload, date: string, hour: number): string;
  zone(tariff: OfferTariffPayload, date: string, hour: number): string;
  rates(tariff: OfferTariffPayload, date: string, hour: number, marketPrice?: number, options?: {
    annualUsageKwh: number; billingCycleMonths: number; connectionPowerKw: number;
    dayProfileKwh?: number[]; capacityChargeFactor?: number;
  }): {
    energy: number; distribution: number; total: number; zone: string;
    energyZone: string; distributionZone: string;
    capacityChargeRate: number; capacityChargeFactor: number | null;
    capacityChargePending: boolean; capacityChargeMode: string | null;
  };
  capacityFlatMonthly(tariff: OfferTariffPayload, date: string, options: {
    annualUsageKwh: number; billingCycleMonths: number; connectionPowerKw: number;
  }, required: boolean): number;
};

export const OFFER_TARIFF_ENGINE_SHA256 = '648D970E5134B85FE1A57406DF13A7CC907C3FD90304DB543FA11006CF758410';

const engine = require('../../../integrations/re/offer-runtime/tariff-engine.js') as OfferTariffEngine;

export default engine;
