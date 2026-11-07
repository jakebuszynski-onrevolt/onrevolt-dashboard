export type MonthlyCellTone = 'pv' | 'direct' | 'consumption' | 'export' | 'import' | 'storage';

export const MONTHLY_CELL_PALETTE: Record<MonthlyCellTone, string> = {
  pv: '#FFA500',
  direct: '#FFA500',
  consumption: '#8D96AA',
  export: '#006C30',
  import: '#DF6C00',
  storage: '#44E09C',
};

export const MONTHLY_CELL_NEUTRAL = '#F7F7F7';

const LOW_VALUE_BLEND = 0.12;
const HIGH_VALUE_BLEND = 1;

function validValue(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0;
}

function colorChannel(hex: string, offset: number) {
  return Number.parseInt(hex.slice(offset, offset + 2), 16);
}

/**
 * Returns an opaque color so SVG-to-PDF and HTML renderers use the same pixels.
 * Values are scaled against the largest valid value in this one monthly row.
 */
export function monthlyCellFill(
  tone: MonthlyCellTone,
  value: number | null | undefined,
  rowValues: readonly (number | null | undefined)[],
): string {
  if (!validValue(value)) return MONTHLY_CELL_NEUTRAL;

  const maximum = Math.max(0, ...rowValues.filter(validValue));
  const relativeValue = maximum > 0 ? Math.min(1, value / maximum) : 0;
  const blend = LOW_VALUE_BLEND + relativeValue * (HIGH_VALUE_BLEND - LOW_VALUE_BLEND);
  const base = MONTHLY_CELL_PALETTE[tone];
  const channels = [1, 3, 5].map((offset) => {
    const channel = Math.round(255 + (colorChannel(base, offset) - 255) * blend);
    return channel.toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`.toUpperCase();
}
