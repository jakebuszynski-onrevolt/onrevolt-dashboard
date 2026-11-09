import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { OfferWorkspaceTemplate } from './offer-workspace-server';

export type OfferStorageIllustration = {
  family: string | null;
  dataUrl: string | null;
  caption: string;
  dimensions: { widthMm: number; depthMm: number; heightMm: number | null } | null;
  missingReason: string | null;
};

const families = [
  { family: 'PowerBrick Plus', module: 'ES-Dyness-LV-PowerBrick-Plus-16.07kWh-EU', bdu: null,
    kit: null, width: 435, depth: 235, base: 0, moduleHeight: 850, expansionBase: 0 },
  { family: 'STACK100', module: 'ES-Dyness-STACK100-5.12kWh-EU', bdu: 'ES-Dyness-STACK100-BDU-EU',
    kit: 'ES-Dyness-STACK100-Expansion-Kit-EU', width: 590, depth: 390, base: 233.5, moduleHeight: 133.5, expansionBase: 170 },
  { family: 'STACK100 PRO', module: 'ES-Dyness-STACK100-5.12kWh-PRO-EU', bdu: 'ES-Dyness-STACK100-BDU-PRO-EU',
    kit: 'ES-Dyness-STACK100-PRO-Expansion-Kit-EU', width: 657, depth: 459, base: 292, moduleHeight: 169, expansionBase: 191 },
  { family: 'STACK314', module: 'ES-Dyness-STACK314-16.04kWh-EU', bdu: 'ES-Dyness-STACK314-BDU-EU',
    kit: null, width: 770, depth: 425, base: 293, moduleHeight: 230, expansionBase: 0 },
  { family: 'BF100 (cabinet)', module: 'ES-Dyness-BF100-C100-EU', bdu: null,
    kit: null, width: 725, depth: 1200, base: 0, moduleHeight: 2260, expansionBase: 0 },
] as const;

function image(file: string) {
  return `data:image/png;base64,${readFileSync(path.join(process.cwd(), 'assets/offer-storage', file)).toString('base64')}`;
}

function missing(reason: string): OfferStorageIllustration {
  return { family: null, dataUrl: null, caption: '', dimensions: null, missingReason: reason };
}

/** Exact SKUs determine dimensions. Cabinet names also select the user-approved
 * cabinet photo, without borrowing dimensions from another model. */
export function resolveOfferStorageIllustration(
  templates: OfferWorkspaceTemplate[], selectedTemplateIds: string[],
): OfferStorageIllustration | null {
  const selected = templates.filter(template => selectedTemplateIds.includes(template.id) && template.kind === 'MAGAZYN');
  if (!selected.length) return null;
  if (selected.length !== 1) return missing('Wybierz jeden zestaw magazynu do ilustracji.');
  const items = selected[0].items;
  const matching = families.filter(family => items.some(item => item.product?.sku === family.module));
  const namedCabinet = /\bcabinet\b/i.test(selected[0].name ?? '') || items.some(item =>
    item.product?.sku === 'ES-Dyness-BF100-C100E-EU'
    || (['MAGAZYN_ENERGII', 'BATTERY'].includes(item.product?.category ?? '')
      && /\bcabinet\b/i.test(`${item.product?.name ?? ''} ${item.description ?? ''}`)));
  if (namedCabinet && matching.length === 0) {
    return { family: 'Cabinet', dataUrl: image('cabinet-bf100.png'), dimensions: null,
      caption: 'Ilustracja poglądowa · Cabinet', missingReason: null };
  }
  if (namedCabinet && matching.some(model => model.family !== 'BF100 (cabinet)')) {
    return missing('Nazwa Cabinet jest sprzeczna z modelem modułów magazynu w zestawie.');
  }
  if (matching.length !== 1) return missing('Brak przypisanej ilustracji dla modelu magazynu w wybranym zestawie.');
  const model = matching[0];
  const quantity = (sku: string | null) => sku == null ? 0
    : items.filter(item => item.product?.sku === sku).reduce((sum, item) => sum + item.quantity, 0);
  const count = quantity(model.module);
  if (!Number.isInteger(count) || count < 1) return missing('Brak poprawnej liczby modułów magazynu w konfiguracji.');
  if (model.family === 'BF100 (cabinet)') {
    return { family: model.family, dataUrl: image('cabinet-bf100.png'),
      dimensions: { widthMm: model.width, depthMm: model.depth, heightMm: model.moduleHeight }, missingReason: null,
      caption: `Ilustracja poglądowa · ${count} szt. BF100 (cabinet) · wymiary jednej szafy (szer. × gł. × wys.): ${model.width} × ${model.depth} × ${model.moduleHeight} mm` };
  }
  if (model.family === 'PowerBrick Plus') {
    return { family: model.family, dataUrl: image('powerbrick-plus.png'),
      dimensions: { widthMm: model.width, depthMm: model.depth, heightMm: model.moduleHeight }, missingReason: null,
      caption: `Ilustracja poglądowa · ${count} szt. PowerBrick Plus · wymiary jednego modułu (szer. × gł. × wys.): ${model.width} × ${model.depth} × ${model.moduleHeight} mm` };
  }
  const bduCount = quantity(model.bdu);
  const kitCount = quantity(model.kit);
  // Explicitly approved by the user on 2026-11-05; not an inferred module split.
  const approvedSplit = model.family !== 'STACK314' && [12, 14, 16].includes(count) ? [8, count - 8] : [count];
  let heights: number[] | null = null;
  if (approvedSplit.length === 1 && count >= 3 && count <= 15 && bduCount === 1 && kitCount === 0) {
    heights = [model.base + model.moduleHeight * count];
  } else if (approvedSplit.length === 2 && bduCount === 2) {
    heights = approvedSplit.map(modules => model.base + model.moduleHeight * modules);
  } else if (approvedSplit.length === 2 && bduCount === 1 && kitCount === 1) {
    heights = [model.base + model.moduleHeight * approvedSplit[0], model.expansionBase + model.moduleHeight * approvedSplit[1]];
  }
  const heightText = heights?.map(height => height.toLocaleString('pl-PL', { maximumFractionDigits: 1 })).join(' / ');
  return { family: model.family, dataUrl: image(model.family === 'STACK314' ? 'stack314.png' : 'stack-dimensions-blank.png'),
    dimensions: { widthMm: model.width, depthMm: model.depth, heightMm: heights?.[0] ?? null },
    caption: `Ilustracja poglądowa · ${model.family} · moduły: ${approvedSplit.join(' + ')}`
      + (heights ? ` · wysokość kolumn: ${heightText} mm` : ''),
    missingReason: heights ? null : 'Brak potwierdzonego układu modułów, podstaw i sterowników do wyliczenia wysokości magazynu.',
  };
}
