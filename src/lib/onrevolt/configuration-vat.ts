export const configurationVatModes = ['REDUCED_8', 'STANDARD_23', 'MIXED', 'REVIEW'] as const;

export type ConfigurationVatMode = typeof configurationVatModes[number];

export type VatBreakdownLine = {
  saleNet: number;
  saleGross: number;
  saleVatRate: number;
};

export type VatBreakdownRow = {
  rate: number;
  net: number;
  vat: number;
  gross: number;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function defaultVatModeForClientType(clientType: string): ConfigurationVatMode {
  if (clientType === 'B2C') return 'REDUCED_8';
  if (clientType === 'B2B') return 'STANDARD_23';
  return 'REVIEW';
}

export function defaultSaleVatRateForMode(mode: ConfigurationVatMode) {
  if (mode === 'REDUCED_8') return 0.08;
  if (mode === 'STANDARD_23') return 0.23;
  return null;
}

export function resolveSaleVatRate(mode: ConfigurationVatMode, itemRate: number) {
  return defaultSaleVatRateForMode(mode) ?? itemRate;
}

export function vatBreakdown(lines: VatBreakdownLine[]): VatBreakdownRow[] {
  const rows = new Map<number, VatBreakdownRow>();

  lines.forEach((line) => {
    const rate = Number(line.saleVatRate);
    const net = Number(line.saleNet);
    const gross = Number(line.saleGross);
    if (![rate, net, gross].every(Number.isFinite)) return;
    if (net === 0 && gross === 0) return;

    const current = rows.get(rate) || { rate, net: 0, vat: 0, gross: 0 };
    current.net = roundMoney(current.net + net);
    current.gross = roundMoney(current.gross + gross);
    current.vat = roundMoney(current.gross - current.net);
    rows.set(rate, current);
  });

  return Array.from(rows.values()).sort((a, b) => a.rate - b.rate);
}
