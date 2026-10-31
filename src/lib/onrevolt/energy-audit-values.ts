// Undefined preserves a stored value; explicit null clears it without claiming zero.
export function optionalNullableEnergyNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (value === undefined || value === '') return undefined;
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) {
    throw new Error('Nieprawidłowa wartość liczbowa');
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('Nieprawidłowa wartość liczbowa');
  return number;
}
