export type ProductUsageCounts = {
  templateItems: number;
  configItems: number;
  existingAssets: number;
  installationPlannedItems: number;
  installed: number;
  purchaseOrderItems: number;
  stockReservations: number;
};

const usageLabels: Array<[keyof ProductUsageCounts, string]> = [
  ['templateItems', 'szablonach konfiguracji'],
  ['configItems', 'konfiguracjach klientów'],
  ['existingAssets', 'urządzeniach posiadanych przez klientów'],
  ['installationPlannedItems', 'planach montażu'],
  ['installed', 'zamontowanych urządzeniach'],
  ['purchaseOrderItems', 'zamówieniach'],
  ['stockReservations', 'rezerwacjach magazynowych'],
];

export function productDeleteBlockReason(counts: ProductUsageCounts) {
  const usages = usageLabels
    .filter(([key]) => counts[key] > 0)
    .map(([key, label]) => `${label}: ${counts[key]}`);

  if (!usages.length) return null;
  return `Nie można usunąć produktu, ponieważ jest używany (${usages.join(', ')}). Usuń najpierw jego powiązania.`;
}
