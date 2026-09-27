import type { ClientTariffHistory, ClientTariffPayload } from '../../src/lib/onrevolt/client-tariffs';
type FixedOptions = { annualUsageKwh: number; billingCycleMonths: number; connectionPowerKw: number };
declare const engine: {
  resolve(history: ClientTariffHistory | null, date: string, basic: ClientTariffPayload | null): ClientTariffPayload;
  expand(history: ClientTariffHistory | null): ClientTariffHistory | null;
  zone(tariff: ClientTariffPayload, date: string, hour: number): string;
  rates(tariff: ClientTariffPayload, date: string, hour: number, marketPrice?: number): { energy: number; distribution: number; total: number; zone: string };
  fixedMonthly(tariff: ClientTariffPayload, options: FixedOptions): number;
  fixedDaily(tariff: ClientTariffPayload, date: string, options: FixedOptions): number;
  cost(history: ClientTariffHistory, records: { date: string; slots: { hour: number; kwh: number; marketPrice?: number }[] }[], from: string, until: string, options: FixedOptions): {
    total: number; purchaseCost: number; distributionCost: number; fixedCost: number;
    subscriptionCost: number; distributionDetails: Record<string, number>;
    fixedDetails: { label: string; value: number }[]; subscriptionDetails: { label: string; value: number }[];
  };
};
export default engine;
