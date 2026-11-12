type InvoiceConsumption = {
  importBasis?: 'METERED';
  totalAfterBalancingKwh?: number | null;
  meteredImportKwh?: number | null;
};

/** Keep ordinary meter readings distinct from prosumer hourly balancing. */
export function invoiceImportField(consumption?: InvoiceConsumption | null) {
  return consumption?.importBasis === 'METERED'
    ? 'meteredImportKwh' as const
    : 'totalAfterBalancingKwh' as const;
}

export function invoiceImportKwh(consumption?: InvoiceConsumption | null) {
  return consumption?.[invoiceImportField(consumption)];
}
