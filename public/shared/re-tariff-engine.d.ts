import type { ClientTariffHistory, ClientTariffPayload } from '../../src/lib/onrevolt/client-tariffs';
type FixedOptions = { annualUsageKwh: number; billingCycleMonths: number; connectionPowerKw: number };
type CapacityOptions = FixedOptions & { dayProfileKwh?: number[]; capacityChargeFactor?: number };
declare const engine: {
  resolve(history: ClientTariffHistory | null, date: string, basic: ClientTariffPayload | null): ClientTariffPayload;
  expand(history: ClientTariffHistory | null): ClientTariffHistory | null;
  zone(tariff: ClientTariffPayload, date: string, hour: number): string;
  rates(tariff: ClientTariffPayload, date: string, hour: number, marketPrice?: number, options?: CapacityOptions): {
    energy: number; distribution: number; total: number; zone: string;
    capacityChargeRate: number; capacityChargeFactor: number | null;
    capacityChargePending: boolean; capacityChargeMode: string | null;
  };
  fixedMonthly(tariff: ClientTariffPayload, options: FixedOptions): number;
  fixedDaily(tariff: ClientTariffPayload, date: string, options: FixedOptions): number;
  cost(history: ClientTariffHistory, records: { date: string; slots: { hour: number; kwh: number; marketPrice?: number }[] }[], from: string, until: string, options: FixedOptions): {
    total: number; purchaseCost: number; distributionCost: number; fixedCost: number;
    subscriptionCost: number; distributionDetails: Record<string, number>;
    fixedDetails: { label: string; value: number }[]; subscriptionDetails: { label: string; value: number }[];
  };
};
export default engine;
