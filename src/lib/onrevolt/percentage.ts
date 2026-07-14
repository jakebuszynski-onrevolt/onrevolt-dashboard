export type PercentageValue = string | number | null | undefined;

function normalizedNumber(value: PercentageValue) {
  return String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.');
}

export function rateToPercentFormValue(value: PercentageValue) {
  const normalized = normalizedNumber(value);
  if (!normalized) return '';

  const rate = Number(normalized);
  if (!Number.isFinite(rate)) return '';

  return String(Number((rate * 100).toFixed(6)));
}

export function percentFormValueToRate(value: PercentageValue) {
  const normalized = normalizedNumber(value);
  if (!normalized) return 0;
  return Number(normalized) / 100;
}
