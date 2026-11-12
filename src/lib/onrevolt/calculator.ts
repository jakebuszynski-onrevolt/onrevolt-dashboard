export type CalculationInput = {
  saleDiscount?: boolean;
  quantity: number;
  unitPurchaseNet: number;
  purchaseVatRate: number;
  operatingCostNet: number;
  operatingCostBasis?: 'PER_UNIT' | 'PER_LINE';
  marginRate: number;
  saleVatRate: number;
  includeVatSurplus?: boolean;
  forcedSaleNet?: number;
  unitSaleNet?: number;
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
  rawSaleNet?: number;
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

const MAX_LINE_MONEY = 9_999_999_999.99;

export class ManualSaleTotalsValidationError extends Error {
  constructor(message = `Łączna cena pozycji przekracza limit ${MAX_LINE_MONEY.toFixed(2)}`) {
    super(message);
    this.name = 'ManualSaleTotalsValidationError';
  }
}

export function validateManualSaleTotals(unitSaleNet: number, quantity: number) {
  if (!Number.isFinite(unitSaleNet) || !Number.isFinite(quantity)) {
    throw new ManualSaleTotalsValidationError('Ręczna cena sprzedaży i ilość muszą być wartościami skończonymi');
  }
  if (unitSaleNet < 0 || quantity < 0) {
    throw new ManualSaleTotalsValidationError('Ręczna cena sprzedaży i ilość nie mogą być ujemne');
  }

  const rawSaleNet = unitSaleNet * quantity;
  const saleNet = roundMoney(rawSaleNet);
  const saleGrossAtVat23 = roundMoney(rawSaleNet * 1.23);
  if (!Number.isFinite(rawSaleNet) || saleNet > MAX_LINE_MONEY || saleGrossAtVat23 > MAX_LINE_MONEY) {
    throw new ManualSaleTotalsValidationError();
  }
  return rawSaleNet;
}

export function calculateConfigurationLine(input: CalculationInput): CalculationResult {
  if (input.saleDiscount) {
    if (input.quantity !== 1 || input.unitPurchaseNet !== 0 || input.operatingCostNet !== 0
      || input.purchaseVatRate !== 0 || input.marginRate !== 0 || input.forcedSaleNet !== undefined
      || input.unitSaleNet == null || !Number.isFinite(input.unitSaleNet) || input.unitSaleNet >= 0
      || ![0.08, 0.23].includes(input.saleVatRate)) throw new Error('Nieprawidłowa pozycja upustu.');
    const positive = calculateConfigurationLine({ ...input, saleDiscount: false, unitSaleNet: -input.unitSaleNet, includeVatSurplus: false });
    return { ...positive, saleNet: -positive.saleNet, rawSaleNet: -positive.rawSaleNet!,
      saleGross: -positive.saleGross, saleVatValue: -positive.saleVatValue,
      marginNet: -positive.marginNet, profitNet: -positive.profitNet, profitWithVatSurplus: -positive.profitWithVatSurplus };
  }
  assertFiniteMoney(input.quantity, 'quantity');
  assertFiniteMoney(input.unitPurchaseNet, 'unitPurchaseNet');
  assertFiniteMoney(input.purchaseVatRate, 'purchaseVatRate');
  assertFiniteMoney(input.operatingCostNet, 'operatingCostNet');
  assertFiniteMoney(input.marginRate, 'marginRate');
  assertFiniteMoney(input.saleVatRate, 'saleVatRate');
  if (input.unitSaleNet !== undefined) assertFiniteMoney(input.unitSaleNet, 'unitSaleNet');

  if (input.quantity < 0 || input.unitPurchaseNet < 0 || input.operatingCostNet < 0) {
    throw new Error('Ilość, cena zakupu i koszt operacyjny nie mogą być ujemne');
  }
  if (input.unitSaleNet !== undefined && input.unitSaleNet < 0) {
    throw new Error('Ręczna cena sprzedaży nie może być ujemna');
  }

  const purchaseNet = roundMoney(input.unitPurchaseNet * input.quantity);
  const purchaseVatValue = roundMoney(purchaseNet * input.purchaseVatRate);
  const purchaseGross = roundMoney(purchaseNet + purchaseVatValue);
  if (input.operatingCostBasis !== undefined && !['PER_UNIT', 'PER_LINE'].includes(input.operatingCostBasis)) {
    throw new Error('Nieprawidłowy sposób naliczania kosztu realizacji');
  }
  const operatingCostNet = roundMoney(input.operatingCostNet * (input.operatingCostBasis === 'PER_UNIT' ? input.quantity : 1));
  const totalCostNet = roundMoney(purchaseNet + operatingCostNet);
  const manualSale = input.unitSaleNet !== undefined && input.forcedSaleNet === undefined;
  const rawSaleNet = manualSale ? validateManualSaleTotals(input.unitSaleNet!, input.quantity) : undefined;
  const calculatedMarginNet = roundMoney(totalCostNet * input.marginRate);
  const saleNet = roundMoney(input.forcedSaleNet ?? rawSaleNet ?? (totalCostNet + calculatedMarginNet));
  const saleGross = rawSaleNet === undefined
    ? roundMoney(saleNet + roundMoney(saleNet * input.saleVatRate))
    : roundMoney(rawSaleNet * (1 + input.saleVatRate));
  const saleVatValue = rawSaleNet === undefined
    ? roundMoney(saleNet * input.saleVatRate)
    : roundMoney(saleGross - saleNet);
  const marginNet = manualSale ? roundMoney(saleNet - totalCostNet) : calculatedMarginNet;
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
    ...(rawSaleNet === undefined ? {} : { rawSaleNet }),
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

