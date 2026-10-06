export type SolisSmartPortFanSettings = {
  enabled: boolean;
  onTemperatureCx10: number;
  offTemperatureCx10: number;
};

export function isValidSolisFanTemperatureCx10(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function isValidSolisSmartPortFanSettings(
  settings: SolisSmartPortFanSettings,
) {
  return typeof settings.enabled === 'boolean'
    && isValidSolisFanTemperatureCx10(settings.onTemperatureCx10)
    && isValidSolisFanTemperatureCx10(settings.offTemperatureCx10)
    && settings.offTemperatureCx10 < settings.onTemperatureCx10;
}

export function parseSolisFanTemperatureC(value: string) {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;

  const temperatureC = Number(normalized);
  const temperatureCx10 = Math.round(temperatureC * 10);
  if (
    !Number.isFinite(temperatureC)
    || !Number.isSafeInteger(temperatureCx10)
    || Math.abs(temperatureC * 10 - temperatureCx10) > 1e-6
  ) {
    return null;
  }
  return temperatureCx10;
}

export function formatSolisFanTemperatureC(temperatureCx10: number) {
  return (temperatureCx10 / 10).toLocaleString('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}
