export type SolisRatedPowerWarning = 'LOW' | 'HIGH' | null;

export function isValidSolisRatedPowerW(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= 2_147_483_647;
}

export function isValidSolisPowerLimitPercent(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= 100;
}

export function getSolisRatedPowerWarning(value: number): SolisRatedPowerWarning {
  if (!isValidSolisRatedPowerW(value)) return null;
  if (value <= 1_000) return 'LOW';
  if (value >= 100_000) return 'HIGH';
  return null;
}

export function calculateSolisMaxExportPowerW(
  ratedPowerW: number,
  powerLimitPercent: number,
) {
  if (!isValidSolisRatedPowerW(ratedPowerW) || !isValidSolisPowerLimitPercent(powerLimitPercent)) {
    return null;
  }
  return Math.round((ratedPowerW * powerLimitPercent) / 100);
}
