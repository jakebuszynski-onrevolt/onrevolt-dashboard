export type InvoiceMonthlyEnergy = {
  year: number;
  month: number;
  period: string;
  consumptionBeforeBalancingKwh?: number;
  consumptionAfterBalancingKwh?: number;
  exportedBeforeBalancingKwh?: number;
  exportedAfterBalancingKwh?: number;
};

export type InvoiceEnergyZone = {
  name: string;
  consumptionKwh: number;
};

export type InvoiceRecognitionFields = {
  invoiceNumber?: string;
  issueDate?: string;
  saleDate?: string;
  dueDate?: string;
  periodFrom?: string;
  periodTo?: string;
  billingCycleMonths?: number;
  amountGross?: number;
  amountDue?: number;
  currency: 'PLN';
  customerNumber?: string;
  ppeNumber?: string;
  tariff?: string;
  consumption: {
    totalBeforeBalancingKwh?: number;
    totalAfterBalancingKwh?: number;
    exportedBeforeBalancingKwh?: number;
    exportedAfterBalancingKwh?: number;
    monthly: InvoiceMonthlyEnergy[];
    zones: InvoiceEnergyZone[];
  };
};

export type InvoiceRecognitionResult = {
  schemaVersion: 1;
  provider: 'ENEA';
  parser: {
    id: string;
    version: string;
  };
  confidence: number;
  warnings: string[];
  fields: InvoiceRecognitionFields;
};

export type InvoiceTextParser = {
  id: string;
  version: string;
  provider: InvoiceRecognitionResult['provider'];
  canParse: (text: string) => boolean;
  parse: (text: string) => InvoiceRecognitionResult;
};
