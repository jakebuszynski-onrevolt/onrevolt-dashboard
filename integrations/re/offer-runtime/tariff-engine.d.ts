import type SharedTariffEngine from '../../../public/shared/re-tariff-engine.js';
import type { ClientTariffPayload } from '../../../src/lib/onrevolt/client-tariffs';

type EnergySchedule = { model: 'monthly_codes'; monthly: Record<string, string[]> };
type OfferTariffPayload = ClientTariffPayload & {
  energy_schedule?: EnergySchedule;
  sell_method?: string;
  osd_add_rdn?: number;
  osd_add_akcyza?: number;
};

declare const engine: typeof SharedTariffEngine & {
  energyZone(tariff: OfferTariffPayload, date: string, hour: number): string;
};

export default engine;
