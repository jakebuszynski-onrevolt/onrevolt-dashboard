export function parseSaleAmount(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Podaj cenę z maksymalnie dwoma miejscami po przecinku.');
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 9999999999.99) throw new Error('Cena jest poza dozwolonym zakresem.');
  return amount;
}

export function saleInputToUnitNet(value: string, basis: 'net' | 'gross', vatRate: number | null): string {
  const amount = parseSaleAmount(value);
  if (basis === 'gross' && vatRate !== 0.08 && vatRate !== 0.23) throw new Error('Wybierz VAT 8% albo 23%.');
  const net = basis === 'gross' ? amount / (1 + vatRate!) : amount;
  return net.toFixed(8);
}

export function defaultTemplateSaleVat(clientType: string): number | null {
  if (clientType === 'B2C') return 0.08;
  if (clientType === 'B2B') return 0.23;
  return null;
}

export function templateLineSaleAmount(line: { saleNet: number; rawSaleNet?: number } | null, clientType: string, vatRate: number | null): number | null {
  if (!line) return null;
  if (clientType !== 'B2C') return line.saleNet;
  if (vatRate === null) return null;
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  return line.rawSaleNet === undefined ? round(line.saleNet + round(line.saleNet * vatRate)) : round(line.rawSaleNet * (1 + vatRate));
}
