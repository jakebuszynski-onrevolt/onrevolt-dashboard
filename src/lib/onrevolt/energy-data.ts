export type EnergyInvoiceForSummary = {
  energyConsumptionKwh?: number | string | null;
  billingPeriodFrom?: string | Date | null;
  billingPeriodTo?: string | Date | null;
  billingCycleMonths?: number | null;
};

export type EnergyInvoiceSummary = {
  invoiceCount: number;
  totalKwh: number;
  coveredDays: number;
  coveredMonths: number;
  annualizedKwh: number;
};

function rounded(value: number, precision = 3) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function coveredDays(invoice: EnergyInvoiceForSummary) {
  if (invoice.billingPeriodFrom && invoice.billingPeriodTo) {
    const from = new Date(invoice.billingPeriodFrom);
    const to = new Date(invoice.billingPeriodTo);
    if (Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && to >= from) {
      return Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
    }
  }

  const cycleMonths = Number(invoice.billingCycleMonths);
  return Number.isFinite(cycleMonths) && cycleMonths > 0
    ? Math.round(cycleMonths * (365.25 / 12))
    : 0;
}

export function summarizeEnergyInvoices(invoices: EnergyInvoiceForSummary[]): EnergyInvoiceSummary {
  const recognized = invoices
    .map((invoice) => ({
      kwh: Number(invoice.energyConsumptionKwh),
      days: coveredDays(invoice),
    }))
    .filter((invoice) => Number.isFinite(invoice.kwh) && invoice.kwh > 0);

  const totalKwh = recognized.reduce((sum, invoice) => sum + invoice.kwh, 0);
  const days = recognized.reduce((sum, invoice) => sum + invoice.days, 0);
  const coveredMonths = days > 0 ? days / (365.25 / 12) : 0;
  const annualizedKwh = days > 0 ? totalKwh * (365.25 / days) : 0;

  return {
    invoiceCount: recognized.length,
    totalKwh: rounded(totalKwh),
    coveredDays: days,
    coveredMonths: rounded(coveredMonths, 1),
    annualizedKwh: rounded(annualizedKwh),
  };
}
