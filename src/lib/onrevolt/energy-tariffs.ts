export type EnergyOperatorCode = 'ENEA' | 'ENERGA' | 'TAURON' | 'PGE' | 'STOEN' | 'INNY';

export type EnergyTariffOption = {
  code: string;
  label: string;
};

export type EnergyOperatorTariffCatalog = {
  code: EnergyOperatorCode;
  label: string;
  tariffs: EnergyTariffOption[];
};

const householdTariffs: EnergyTariffOption[] = [
  { code: 'G11', label: 'G11 - jednostrefowa' },
  { code: 'G12', label: 'G12 - dwustrefowa' },
  { code: 'G12w', label: 'G12w - weekendowa' },
];

const businessTariffs: EnergyTariffOption[] = [
  { code: 'C11', label: 'C11 - jednostrefowa' },
  { code: 'C12a', label: 'C12a - szczyt / pozaszczyt' },
  { code: 'C12b', label: 'C12b - dzień / noc' },
  { code: 'C21', label: 'C21 - jednostrefowa, większa moc' },
];

export const energyTariffCatalog: EnergyOperatorTariffCatalog[] = [
  {
    code: 'ENEA',
    label: 'ENEA',
    tariffs: [
      ...householdTariffs,
      { code: 'G13', label: 'G13 - trójstrefowa' },
      { code: 'G13active', label: 'G13active - Re:flow' },
      ...businessTariffs,
    ],
  },
  {
    code: 'ENERGA',
    label: 'Energa',
    tariffs: [
      ...householdTariffs,
      { code: 'G12r', label: 'G12r - rozliczenie dwustrefowe' },
      ...businessTariffs,
    ],
  },
  {
    code: 'TAURON',
    label: 'Tauron',
    tariffs: [
      ...householdTariffs,
      { code: 'G13', label: 'G13 - trójstrefowa' },
      { code: 'G14', label: 'G14 - czterostrefowa' },
      ...businessTariffs,
    ],
  },
  {
    code: 'PGE',
    label: 'PGE',
    tariffs: [
      { code: 'G11', label: 'G11 - jednostrefowa' },
      { code: 'G12', label: 'G12 - dzień / noc' },
      { code: 'G12as', label: 'G12as - antysmogowa' },
      { code: 'G12e', label: 'G12e - elastyczna dla prosumentów i cen dynamicznych' },
      { code: 'G12n', label: 'G12n - niedzielna' },
      { code: 'G12w', label: 'G12w - weekendowa' },
      { code: 'C11', label: 'C11 - jednostrefowa' },
      { code: 'C11em', label: 'C11em - stacja ładowania' },
      { code: 'C11o', label: 'C11o - oświetleniowa, grupa wygaszana' },
      { code: 'C11s', label: 'C11s - jednostrefowa specjalna' },
      { code: 'C12a', label: 'C12a - szczyt / pozaszczyt' },
      { code: 'C12b', label: 'C12b - dzień / noc' },
      { code: 'C12n', label: 'C12n - niedzielna' },
      { code: 'C12w', label: 'C12w - weekendowa' },
      { code: 'C21', label: 'C21 - jednostrefowa, większa moc' },
      { code: 'C21em', label: 'C21em - stacja ładowania, większa moc' },
      { code: 'C22a', label: 'C22a - szczyt / pozaszczyt, większa moc' },
      { code: 'C22b', label: 'C22b - dzień / noc, większa moc' },
      { code: 'C23', label: 'C23 - trójstrefowa' },
      { code: 'C24', label: 'C24 - czterostrefowa' },
      { code: 'B11', label: 'B11 - jednostrefowa SN' },
      { code: 'B11em', label: 'B11em - stacja ładowania SN' },
      { code: 'B21', label: 'B21 - jednostrefowa SN, większa moc' },
      { code: 'B21em', label: 'B21em - stacja ładowania SN, większa moc' },
      { code: 'B22', label: 'B22 - dwustrefowa SN' },
      { code: 'B23', label: 'B23 - trójstrefowa SN' },
      { code: 'B24', label: 'B24 - czterostrefowa SN' },
      { code: 'A23', label: 'A23 - trójstrefowa WN' },
      { code: 'A24', label: 'A24 - czterostrefowa WN (Oddział Lublin)' },
      { code: 'R', label: 'R - rozliczenie ryczałtowe' },
    ],
  },
  {
    code: 'STOEN',
    label: 'StoEN',
    tariffs: [
      ...householdTariffs,
      ...businessTariffs,
    ],
  },
  {
    code: 'INNY',
    label: 'Inny',
    tariffs: [
      ...householdTariffs,
      { code: 'G13', label: 'G13 - trójstrefowa' },
      { code: 'G13active', label: 'G13active - Re:flow' },
      ...businessTariffs,
    ],
  },
];

export const energyOperatorOptions = energyTariffCatalog.map((operator) => [
  operator.code,
  operator.label,
] as const);

export function isEnergyOperator(value: unknown): value is EnergyOperatorCode {
  return typeof value === 'string' && energyTariffCatalog.some((operator) => operator.code === value);
}

export function normalizeEnergyOperator(value: unknown): EnergyOperatorCode {
  return isEnergyOperator(value) ? value : 'ENEA';
}

export function getEnergyTariffs(operator: unknown) {
  const code = normalizeEnergyOperator(operator);
  return energyTariffCatalog.find((item) => item.code === code)?.tariffs || energyTariffCatalog[0].tariffs;
}

export function getEnergyTariffLabel(operator: unknown, tariffCode?: string | null) {
  const tariff = getEnergyTariffs(operator).find((item) => item.code === tariffCode);
  return tariff?.label || tariffCode || '';
}

export function getDefaultEnergyTariff(operator: unknown) {
  return getEnergyTariffs(operator)[0]?.code || 'G11';
}

export function getDefaultTargetEnergyTariff(operator: unknown) {
  const tariffs = getEnergyTariffs(operator);
  return tariffs.find((item) => item.code === 'G13active')?.code
    || tariffs.find((item) => item.code === 'G13')?.code
    || tariffs[0]?.code
    || 'G11';
}
