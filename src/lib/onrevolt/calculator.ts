export type CalculationInput = {
  quantity: number;
  unitPurchaseNet: number;
  purchaseVatRate: number;
  operatingCostNet: number;
  marginRate: number;
  saleVatRate: number;
  includeVatSurplus?: boolean;
  forcedSaleNet?: number;
};

export type CalculationResult = {
  purchaseNet: number;
  purchaseVatValue: number;
  purchaseGross: number;
  operatingCostNet: number;
  totalCostNet: number;
  marginNet: number;
  saleNet: number;
  saleVatValue: number;
  saleGross: number;
  vatSurplus: number;
  profitNet: number;
  profitWithVatSurplus: number;
};

export type ConfigurationTotals = CalculationResult & {
  lines: CalculationResult[];
};

function assertFiniteMoney(value: number, name: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`Nieprawidłowa wartość pola ${name}`);
  }
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateConfigurationLine(input: CalculationInput): CalculationResult {
  assertFiniteMoney(input.quantity, 'quantity');
  assertFiniteMoney(input.unitPurchaseNet, 'unitPurchaseNet');
  assertFiniteMoney(input.purchaseVatRate, 'purchaseVatRate');
  assertFiniteMoney(input.operatingCostNet, 'operatingCostNet');
  assertFiniteMoney(input.marginRate, 'marginRate');
  assertFiniteMoney(input.saleVatRate, 'saleVatRate');

  if (input.quantity < 0 || input.unitPurchaseNet < 0 || input.operatingCostNet < 0) {
    throw new Error('Ilość, cena zakupu i koszt operacyjny nie mogą być ujemne');
  }

  const purchaseNet = roundMoney(input.unitPurchaseNet * input.quantity);
  const purchaseVatValue = roundMoney(purchaseNet * input.purchaseVatRate);
  const purchaseGross = roundMoney(purchaseNet + purchaseVatValue);
  const operatingCostNet = roundMoney(input.operatingCostNet);
  const totalCostNet = roundMoney(purchaseNet + operatingCostNet);
  const marginNet = roundMoney(totalCostNet * input.marginRate);
  const saleNet = roundMoney(input.forcedSaleNet ?? (totalCostNet + marginNet));
  const saleVatValue = roundMoney(saleNet * input.saleVatRate);
  const saleGross = roundMoney(saleNet + saleVatValue);
  const vatSurplus = input.includeVatSurplus === false
    ? 0
    : roundMoney(Math.max(0, purchaseVatValue - saleVatValue));
  const profitNet = roundMoney(saleNet - totalCostNet);
  const profitWithVatSurplus = roundMoney(profitNet + vatSurplus);

  return {
    purchaseNet,
    purchaseVatValue,
    purchaseGross,
    operatingCostNet,
    totalCostNet,
    marginNet,
    saleNet,
    saleVatValue,
    saleGross,
    vatSurplus,
    profitNet,
    profitWithVatSurplus,
  };
}

export function sumConfiguration(lines: CalculationInput[]): ConfigurationTotals {
  const calculated = lines.map(calculateConfigurationLine);
  const totals = calculated.reduce<CalculationResult>((acc, line) => ({
    purchaseNet: roundMoney(acc.purchaseNet + line.purchaseNet),
    purchaseVatValue: roundMoney(acc.purchaseVatValue + line.purchaseVatValue),
    purchaseGross: roundMoney(acc.purchaseGross + line.purchaseGross),
    operatingCostNet: roundMoney(acc.operatingCostNet + line.operatingCostNet),
    totalCostNet: roundMoney(acc.totalCostNet + line.totalCostNet),
    marginNet: roundMoney(acc.marginNet + line.marginNet),
    saleNet: roundMoney(acc.saleNet + line.saleNet),
    saleVatValue: roundMoney(acc.saleVatValue + line.saleVatValue),
    saleGross: roundMoney(acc.saleGross + line.saleGross),
    vatSurplus: roundMoney(acc.vatSurplus + line.vatSurplus),
    profitNet: roundMoney(acc.profitNet + line.profitNet),
    profitWithVatSurplus: roundMoney(acc.profitWithVatSurplus + line.profitWithVatSurplus),
  }), {
    purchaseNet: 0,
    purchaseVatValue: 0,
    purchaseGross: 0,
    operatingCostNet: 0,
    totalCostNet: 0,
    marginNet: 0,
    saleNet: 0,
    saleVatValue: 0,
    saleGross: 0,
    vatSurplus: 0,
    profitNet: 0,
    profitWithVatSurplus: 0,
  });

  return { ...totals, lines: calculated };
}

