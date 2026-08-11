export type EnergyIntakeOption = {
  value: string;
  label: string;
};

export const buildingTypeOptions: EnergyIntakeOption[] = [
  { value: 'SINGLE_FAMILY', label: 'Dom jednorodzinny' },
  { value: 'MULTI_FAMILY', label: 'Dom wielorodzinny' },
  { value: 'SEMI_DETACHED', label: 'Bliźniak' },
  { value: 'TERRACED', label: 'Szeregówka' },
  { value: 'APARTMENT_BLOCK', label: 'Blok (osiedle)' },
];

export const terrainTypeOptions: EnergyIntakeOption[] = [
  { value: 'URBAN_DENSE', label: 'Gęsta zabudowa miejska' },
  { value: 'SUBURBAN', label: 'Teren podmiejski' },
  { value: 'RURAL_OPEN', label: 'Teren wiejski otwarty' },
];

export const roofShapeOptions: EnergyIntakeOption[] = [
  { value: 'FLAT', label: 'Płaski' },
  { value: 'GABLE_BARN', label: 'Dwuspadowy' },
  { value: 'MULTI_SLOPE', label: 'Wielospadowy' },
];

export const settlementSystemOptions: EnergyIntakeOption[] = [
  { value: 'net-metering', label: 'Net-metering' },
  { value: 'net-billing', label: 'Net-billing' },
];

export const energySupplierOptions: EnergyIntakeOption[] = [
  { value: 'ENEA', label: 'Enea' },
  { value: 'ENERGA', label: 'Energa Obrót' },
  { value: 'PGE', label: 'PGE Obrót' },
  { value: 'TAURON', label: 'Tauron Sprzedaż' },
  { value: 'EON', label: 'E.ON Polska' },
  { value: 'OTHER', label: 'Inny' },
];

export const connectionTypeOptions: EnergyIntakeOption[] = [
  { value: 'LOW_VOLTAGE', label: 'Niskie napięcie' },
  { value: 'MEDIUM_VOLTAGE', label: 'Średnie napięcie' },
  { value: 'HIGH_VOLTAGE', label: 'Wysokie napięcie' },
];

export const heatSourceOptions: EnergyIntakeOption[] = [
  { value: 'NATURAL_GAS', label: 'Gaz ziemny' },
  { value: 'LPG', label: 'LPG' },
  { value: 'HEATING_OIL', label: 'Olej opałowy' },
  { value: 'COAL', label: 'Węgiel' },
  { value: 'WOOD', label: 'Drewno' },
  { value: 'DISTRICT_HEATING', label: 'Ciepło systemowe (sieciowe)' },
  { value: 'ELECTRICITY', label: 'Energia elektryczna' },
];

const heatSourceDetails: Record<string, EnergyIntakeOption[]> = {
  NATURAL_GAS: [
    { value: 'GAS_OLD', label: 'Kocioł stary' },
    { value: 'GAS_TRADITIONAL', label: 'Kocioł tradycyjny' },
    { value: 'GAS_CONDENSING', label: 'Piec kondensacyjny' },
  ],
  HEATING_OIL: [
    { value: 'OIL_OLD', label: 'Kocioł stary' },
    { value: 'OIL_NEW', label: 'Kocioł nowy' },
  ],
  WOOD: [
    { value: 'WOOD_PELLET', label: 'Pellet' },
    { value: 'WOOD_BATCH', label: 'Kocioł zasypowy (tradycyjny)' },
    { value: 'WOOD_GASIFICATION', label: 'Kocioł zgazowujący drewno' },
  ],
  ELECTRICITY: [
    { value: 'ELECTRIC_DIRECT', label: 'Bezpośrednie grzanie prądem' },
    { value: 'HEAT_PUMP_GROUND', label: 'Pompa ciepła - gruntowa' },
    { value: 'HEAT_PUMP_AIR', label: 'Pompa ciepła powietrzna' },
    { value: 'AIR_CONDITIONING_HEAT', label: 'Klimatyzatory z funkcją grzania' },
  ],
  COAL: [
    { value: 'COAL_BATCH', label: 'Kocioł zasypowy (miałowy)' },
    { value: 'COAL_ECO_PEA', label: 'Kocioł na eko-groszek' },
  ],
};

const heatSourceAliases: Record<string, string> = {
  GAS: 'Gaz ziemny',
  gas: 'Gaz ziemny',
  HEAT_PUMP: 'Pompa ciepła',
  heat_pump: 'Pompa ciepła',
  ELECTRIC: 'Energia elektryczna',
  electric: 'Energia elektryczna',
  PELLET: 'Pellet',
  coal: 'Paliwo stałe',
  district: 'Sieć ciepłownicza',
  OTHER: 'Inne',
  other: 'Inne',
};

export function getHeatSourceDetailOptions(source: string | null | undefined) {
  return heatSourceDetails[source || ''] || [];
}

export function optionLabel(options: EnergyIntakeOption[], value: unknown) {
  const text = String(value ?? '').trim();
  return options.find((option) => option.value === text)?.label || text;
}

export function buildingTypeLabel(value: unknown) {
  return optionLabel(buildingTypeOptions, value);
}

export function terrainTypeLabel(value: unknown) {
  return optionLabel(terrainTypeOptions, value);
}

export function roofShapeLabel(value: unknown) {
  return optionLabel(roofShapeOptions, value);
}

export function settlementSystemLabel(value: unknown) {
  return optionLabel(settlementSystemOptions, value);
}

export function energySupplierLabel(value: unknown) {
  return optionLabel(energySupplierOptions, value);
}

export function connectionTypeLabel(value: unknown) {
  return optionLabel(connectionTypeOptions, value);
}

export function heatSourceLabel(value: unknown) {
  const text = String(value ?? '').trim();
  return heatSourceOptions.find((option) => option.value === text)?.label
    || heatSourceAliases[text]
    || text;
}

export function heatSourceDetailLabel(source: unknown, detail: unknown) {
  return optionLabel(getHeatSourceDetailOptions(String(source ?? '')), detail);
}
