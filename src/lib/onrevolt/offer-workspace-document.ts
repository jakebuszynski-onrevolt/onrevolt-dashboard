import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse, type Font } from 'opentype.js';
import { injectFonts } from './offer-svg-renderer';
import { configurationInvestmentScope } from './configuration-templates';
import {
  applyOfferWorkspaceConfigurationEdits,
  hasRemovedCriticalConfigurationItem,
  validateOfferWorkspaceConfigurationEdits,
} from './offer-workspace-configuration-edits';
import { resolveOfferStorageIllustration } from './offer-storage-illustration';
import { monthlyCellFill, type MonthlyCellTone } from './monthly-cell-shading';
import type { OfferWorkspaceDayProfile } from './offer-workspace-chart-data';
import type { OfferWorkspaceEnergy } from './offer-workspace-energy';
import type { OfferWorkspaceCalculation, OfferForecastFlow } from './offer-workspace-calculation-types';
import { priceOfferWorkspaceConfiguration, type OfferWorkspacePricingResult } from './offer-workspace-pricing';
import { calculateOfferCommercialPricing } from './offer-workspace-commercial-pricing';
import { summarizeOfferSavingsBill, type OfferWorkspaceSavingsBillSummary } from './offer-workspace-savings';
import {
  OFFER_TEMPLATE_V3_PAGE_COUNT,
  inspectOfferTemplateV3,
  renderOfferTemplateV3Page,
  type OfferTemplateV3PageNumber,
  type OfferTemplateV3TextBinding,
} from './offer-template-v3';
import {
  OFFER_TEMPLATE_V4_KEY,
  OFFER_TEMPLATE_V4_LIMITATIONS,
  OFFER_TEMPLATE_V4_PAGE_COUNT,
  inspectOfferTemplateV4,
  renderOfferTemplateV4Page,
  type OfferTemplateV4FieldBinding,
  type OfferTemplateV4PageNumber,
} from './offer-template-v4';
import type { OfferWorkspaceDraft } from './offer-workspace';
import type { OfferWorkspace } from './offer-workspace-server';

export type OfferWorkspaceReportDetails = {
  email: string | null;
  phone: string | null;
  terrain: string | null;
  buildingType: string | null;
  roofType: string | null;
  connectionType: string | null;
  heatingSource: string | null;
  heatingDetails: string | null;
  supplier: string | null;
  connectionPowerKw: number | null;
  pvInstallationPlace?: string | null;
  highLoadDevices?: string | null;
  plannedHighLoadDevices?: string | null;
};

export type OfferWorkspaceDocumentData = Pick<
  OfferWorkspace,
  'projectId' | 'clientId' | 'projectName' | 'clientName' | 'clientType' | 'ppeNumber'
  | 'revision' | 'input' | 'measurements' | 'templates'
> & {
  input: OfferWorkspace['input'] & { reportDetails?: OfferWorkspaceReportDetails | null };
  energy?: OfferWorkspaceEnergy | null;
  calculation?: OfferWorkspaceCalculation | null;
};

export type OfferWorkspaceDocumentMissingData = {
  page: OfferTemplateV3PageNumber;
  fieldKeys: string[];
  idHint: string;
  reason: string;
};

export type OfferWorkspaceDocumentResult = {
  templateKey: string;
  sourceRevision: string;
  pageCount: typeof OFFER_TEMPLATE_V3_PAGE_COUNT;
  pages: Array<{
    page: OfferTemplateV3PageNumber;
    svg: string;
    sourceSha256: string;
    replacedFieldKeys: string[];
  }>;
  sourceFieldsUsed: string[];
  missingData: OfferWorkspaceDocumentMissingData[];
  suppressedCharts: Array<{ page: OfferTemplateV3PageNumber; reason: string }>;
  limitations: string[];
};

export type OfferWorkspaceDocumentOptions = {
  templateKey?: string;
  tariffLabels?: { current?: string | null; proposed?: string | null; currentOperator?: string | null };
};

const MISSING_PREFIX = '__OW_DOC_MISSING_';
const MAX_DESCRIPTION_CHARS = 1800;
const DESCRIPTION_MAX_LINES = 12;
const DESCRIPTION_FONT_SIZE = 7.6;
const DESCRIPTION_LINE_HEIGHT = 10.2;
const DESCRIPTION_WIDTH = 510;
const PRODUCT_ROW_SUFFIXES = ['1_2', '2_2', '3_2', '3_4', '3_6', '3_8', '3_10'] as const;
const DESCRIPTION_IDS = new Set(['_opis_oferty_opis']);
const PAGE10_HEADER_IDS = new Set([
  'nazwa_pozycji_4', 'nazwa_modelu_4', 'ilosc_4', 'cena_jednostkowa_brutto_4', 'warto_brutto_4',
]);
const PAGE10_HEADER_LABELS = new Set(['Pozycja', 'Model', 'Ilość', 'Cena jednostkowa', 'brutto']);
const PAGE10_HEADER_LIKE_LABELS = new Set(['Pozycja', 'Model', 'Ilość', 'Cena jednostkowa']);
const TEMPLATE_LABELS = new Set([
  'Pozycja', 'Model', 'Ilość', 'Cena jednostkowa', 'Zużycie energii',
  'Energia cieplna', 'Roczny rachunek za energię', 'Twój rachunek',
  'Całkowite użycie energii', '(kWh)',
  'Wartość energii oddanej', 'Wartość energii pobranej',
  'Średnia cena sprzedaży 1 kWh/PLN', 'Średnia cena zakupu 1 kWh/PLN',
  'Koszt zakupu 1 kWh', 'Stała cena abonamentu / miesiąc', 'Całkowity koszt zakupu 1 kWh',
  'Twój nowy rachunek z systemem', 'Twój aktualny rachunek roczny', 'Aktualny rachunek roczny',
  'Prognozowany rachunek roczny', 'Łączna zgromadzona wartość depozytu',
  'Łączna wykorzystana wartość depozytu na pokrycie energii pobranej', 'Niewykorzystana wartość depozytu',
  'Zwrot 30% wartości', 'Wartość energii pobranej niepokrytej z depozytu', 'Całkowity rachunek',
  'Autokonsumpcja z PV', 'Zakup z sieci', 'Zakup energii', 'Dystrybucja energii', 'Opłaty stałe',
  'Energia zakupiona z sieci', 'Energia oddana do depozytu', 'Pokryte z depozytu',
  'Autokonsumpcja z magazynu', 'Energia wykorzystana z depozytu', 'Wartość skumulowanego depozytu',
  'Oszczędność brutto', 'Całkowity rachunek brutto', 'Rachunek po zwrocie z depozytu',
  'Twoja prognozowana oszczędność', 'Koszt systemu', 'Prognozowany koszt sytemu po dofinansowaniach',
  'Prognozowana kwota dotacji z Programu “Mój Przydomowy Magazyn Energii”',
  'Prognozowana ulga termomodernizacyjna', 'brutto', 'PLN', 'kWp', '(PLN brutto)',
]);
const DATA_FILLS = new Set([
  '#fc7c00', '#ff8505', '#fdb066', '#fecb99', '#fed17f', '#feb633', '#ffd787',
  '#006c30', '#087744', '#009a44', '#00d477', '#44e09c', '#8d96aa', '#98a2b3',
  '#a3aed0', '#00bdff', '#ff3b30', '#f7c948', '#80eabb', '#029b46', '#ff9d98', '#8a47ff',
]);
const DATA_STROKES = new Set(['#fc7c00', '#006c30', '#009a44', '#a3aed0', '#98a2b3', '#00d477']);
const MONTH_ABBREVIATIONS = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];

const FONT_CACHE = new Map<string, Font>();

function font(fileName: string) {
  const existing = FONT_CACHE.get(fileName);
  if (existing) return existing;
  const bytes = readFileSync(path.join(process.cwd(), 'public', 'fonts', 'dm-sans', fileName));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const loaded = parse(data);
  FONT_CACHE.set(fileName, loaded);
  return loaded;
}

function parseSvg(source: string, page: number): XmlDocument & { documentElement: XmlElement } {
  const errors: string[] = [];
  const document = new DOMParser({
    onError: (level, message) => {
      if (level === 'error' || level === 'fatalError') errors.push(`${level}: ${message}`);
    },
  }).parseFromString(source, 'image/svg+xml');
  if (errors.length || !document.documentElement || document.documentElement.localName !== 'svg') {
    throw new Error(`Niepoprawny SVG strony ${page}${errors.length ? `: ${errors.join('; ')}` : ''}`);
  }
  return document as XmlDocument & { documentElement: XmlElement };
}

function resolveTextNode(document: XmlDocument, selector: string): XmlNode & { data: string } {
  let current: XmlNode = document;
  for (const part of selector.split('/').filter(Boolean)) {
    const textMatch = /^text\(\)\[(\d+)\]$/.exec(part);
    if (textMatch) {
      const textNodes = Array.from(current.childNodes || []).filter((node) => node.nodeType === 3 || node.nodeType === 4);
      const node = textNodes[Number(textMatch[1]) - 1] as (XmlNode & { data: string }) | undefined;
      if (!node) throw new Error(`Nie znaleziono selektora tekstowego SVG ${selector}.`);
      return node;
    }
    const elementMatch = /^([^[]+)\[(\d+)\]$/.exec(part);
    if (!elementMatch) throw new Error(`Nieobsługiwany selektor SVG ${selector}.`);
    const [, expectedName, indexText] = elementMatch;
    const elements = Array.from(current.childNodes || []).filter((node) => node.nodeType === 1) as XmlElement[];
    const next = elements[Number(indexText) - 1];
    if (!next || (next.localName || next.tagName) !== expectedName) throw new Error(`Nie znaleziono selektora SVG ${selector}.`);
    current = next;
  }
  throw new Error(`Selektor SVG ${selector} nie wskazuje węzła tekstowego.`);
}

function allElements(document: XmlDocument) {
  return Array.from(document.getElementsByTagName('*')) as XmlElement[];
}

function elementById(document: XmlDocument, id: string) {
  return allElements(document).find((element) => element.getAttribute('id') === id) || null;
}

function uniqueElementById(document: XmlDocument, id: string) {
  const matches = allElements(document).filter((element) => element.getAttribute('id') === id);
  if (matches.length > 1) throw new Error(`Niejednoznaczny identyfikator SVG: ${id}.`);
  return matches[0] || null;
}

function removeElement(element: XmlElement | null) {
  if (element?.parentNode) element.parentNode.removeChild(element);
}

function setElementText(element: XmlElement | null, value: string) {
  if (!element) return;
  const textNodes: Array<XmlNode & { data: string }> = [];
  const walk = (node: XmlNode) => {
    for (const child of Array.from(node.childNodes || [])) {
      if (child.nodeType === 3 || child.nodeType === 4) textNodes.push(child as XmlNode & { data: string });
      else if (child.nodeType === 1) walk(child);
    }
  };
  walk(element);
  if (!textNodes.length) {
    element.appendChild(element.ownerDocument!.createTextNode(value));
    return;
  }
  textNodes[0].data = value;
  textNodes.slice(1).forEach((node) => { node.data = ''; });
}

function removeDataShapes(container: XmlElement | null) {
  if (!container) return;
  const shapes = Array.from(container.getElementsByTagName('*')) as XmlElement[];
  for (const shape of shapes) {
    const tag = (shape.localName || shape.tagName).toLowerCase();
    if (!['path', 'rect', 'polygon', 'polyline', 'circle', 'ellipse', 'use'].includes(tag)) continue;
    const style = shape.getAttribute('style') || '';
    const fill = (shape.getAttribute('fill') || style.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1] || '').trim().toLowerCase();
    const stroke = (shape.getAttribute('stroke') || style.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/i)?.[1] || '').trim().toLowerCase();
    const pathData = shape.getAttribute('d') || '';
    const dataFill = DATA_FILLS.has(fill) || fill.startsWith('url(#pattern');
    const dataLine = tag === 'path' && DATA_STROKES.has(stroke)
      && (pathData.match(/[LlHhVvCcSsQqTtAa]/g) || []).length > 2;
    if (dataFill || dataLine) removeElement(shape);
  }
}

function setPlotAxis(
  plot: XmlElement | null,
  maxValue: number,
  tickIds: string[],
  digits = 0,
  resolveTick: (id: string) => XmlElement | null = (id) => plot ? elementByIdWithin(plot, id) : null,
) {
  if (!plot) return 0;
  const axisMax = niceAxisMaximum(maxValue);
  tickIds.forEach((id, index) => setElementText(
    resolveTick(id),
    formatNumber(axisMax * index / Math.max(1, tickIds.length - 1), digits),
  ));
  return axisMax;
}

function elementByIdWithin(container: XmlElement, id: string) {
  const elements = [container, ...Array.from(container.getElementsByTagName('*')) as XmlElement[]];
  return elements.find((element) => element.getAttribute('id') === id)
    || elements.find((element) => new RegExp(`^${id}_\\d+$`).test(element.getAttribute('id') || ''))
    || null;
}

function niceAxisMaximum(value: number) {
  if (!(value > 0)) return 1;
  const raw = value * 1.05;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 3 ? 3 : fraction <= 4 ? 4 : fraction <= 5 ? 5 : 10;
  return step * magnitude;
}

function chronologicalMonths(workspace: OfferWorkspaceDocumentData) {
  const byPeriod = new Map<string, OfferWorkspaceDocumentData['measurements']['months'][number]>();
  for (const month of workspace.measurements.months) {
    if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month.period)) byPeriod.set(month.period, month);
  }
  const latest = Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period)).slice(-12);
  return [...Array.from({ length: 12 - latest.length }, () => undefined), ...latest];
}

function chronologicalEnergyMonths(energy: OfferWorkspaceEnergy) {
  const byPeriod = new Map<string, OfferWorkspaceEnergy['months'][number]>();
  for (const month of energy.months) {
    if (/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month.period)) byPeriod.set(month.period, month);
  }
  const latest = Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period)).slice(-12);
  return [...Array.from({ length: 12 - latest.length }, () => undefined), ...latest];
}

function validDataMaximum(values: Array<number | null>) {
  return Math.max(0, ...values.filter((value): value is number => validChartValue(value)));
}

function validChartValue(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0;
}

function svgShape(document: XmlDocument, tag: string, attributes: Record<string, string>) {
  const shape = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
  return shape;
}

function appendStepLine(
  document: XmlDocument,
  series: XmlElement,
  values: Array<number | null | undefined>,
  seriesName: 'pv' | 'load',
  color: string,
  plotLeft: number,
  plotRight: number,
  baseline: number,
  height: number,
  axisMax: number,
) {
  const slotWidth = (plotRight - plotLeft) / values.length;
  for (let index = 0; index < values.length;) {
    if (!validChartValue(values[index])) {
      index += 1;
      continue;
    }
    const start = index;
    const yFor = (value: number) => baseline - value / axisMax * height;
    let d = `M${plotLeft + start * slotWidth},${yFor(values[start]!)}`
      + `H${plotLeft + (start + 1) * slotWidth}`;
    index += 1;
    while (index < values.length && validChartValue(values[index])) {
      d += `V${yFor(values[index]!)}H${plotLeft + (index + 1) * slotWidth}`;
      index += 1;
    }
    series.appendChild(svgShape(document, 'path', {
      d,
      fill: 'none',
      stroke: color,
      'stroke-width': '1.4',
      'stroke-linejoin': 'round',
      'data-series': seriesName,
    }));
  }
}

function appendMonthlyReadings(
  document: XmlDocument,
  workspace: OfferWorkspaceDocumentData,
  sourceFields: Set<string>,
  missing: Map<string, OfferWorkspaceDocumentMissingData>,
  plotId = 'Group 1193',
  resolveElementById = elementById,
) {
  const plot = resolveElementById(document, plotId);
  if (!plot) return false;
  removeElement(elementByIdWithin(plot, 'Vector (Stroke)'));
  removeElement(elementByIdWithin(plot, 'Vector (Stroke)_2'));
  removeDataShapes(plot);
  const energyMode = workspace.energy !== undefined;
  const energy = workspace.energy ?? null;
  const months = energy
    ? chronologicalEnergyMonths(energy)
    : energyMode
      ? new Array<OfferWorkspaceEnergy['months'][number] | undefined>(12).fill(undefined)
      : chronologicalMonths(workspace);
  const measuredMonths = new Map(workspace.measurements.months.map((month) => [month.period, month]));
  const modelMonths = months as Array<OfferWorkspaceEnergy['months'][number] | undefined>;
  const stackValues = energyMode
    ? modelMonths.map((month) => {
      const measured = month ? measuredMonths.get(month.period) : undefined;
      return [month?.directKwh, measured?.importKwh, measured?.exportKwh] as const;
    })
    : [];
  const validStacks = stackValues.map((values) => values.every(validChartValue)
    ? values.reduce((total, value) => total + value, 0)
    : null);
  const pvValues = energyMode ? modelMonths.map((month) => month?.pvKwh) : [];
  const loadValues = energyMode ? modelMonths.map((month) => month?.loadKwh) : [];
  const values = energyMode
    ? [...validStacks, ...pvValues, ...loadValues]
    : months.flatMap((month) => [month?.importKwh ?? null, month?.exportKwh ?? null]);
  const maximum = validDataMaximum(values);
  const axisMax = setPlotAxis(
    resolveElementById(document, '_jednostki_wykres_aktualny'),
    maximum,
    ['_0', '_200', '_400', '_600', '_800', '_1000', '_1200'],
  );
  const baseline = 308.028;
  const height = baseline - 131.029;
  const energySeriesId = energy
    ? `workspace-${energy.quality.toLowerCase().replace('_', '-')}-monthly-series`
    : energyMode ? 'workspace-missing-energy-monthly-series' : 'workspace-measured-monthly-series';
  const series = svgShape(document, 'g', { id: energySeriesId });
  let missingStack = false;
  months.forEach((month, index) => {
    const categoryX = 77 + index * 40.866;
    if (energyMode) {
      const energyMonth = modelMonths[index];
      const measured = energyMonth ? measuredMonths.get(energyMonth.period) : undefined;
      const stack = [energyMonth?.directKwh, measured?.importKwh, measured?.exportKwh];
      if (!stack.every(validChartValue)) {
        if (energyMonth) missingStack = true;
        return;
      }
      let accumulated = 0;
      const segments = [
        [stack[0], '#FED17F', 'energy.months.directKwh'],
        [stack[1], '#FC7C00', 'measurements.months.importKwh'],
        [stack[2], '#006C30', 'measurements.months.exportKwh'],
      ] as const;
      for (const [value, color, field] of segments) {
        sourceFields.add(field);
        const barHeight = value / axisMax * height;
        series.appendChild(svgShape(document, 'rect', {
          x: String(categoryX),
          y: String(baseline - (accumulated + value) / axisMax * height),
          width: '18.3896',
          height: String(barHeight),
          fill: color,
          'data-series': field,
        }));
        accumulated += value;
      }
    } else {
      const monthlySeries = [
        [month?.importKwh ?? null, categoryX + 1.5, '#FC7C00', 'measurements.months.importKwh'],
        [month?.exportKwh ?? null, categoryX + 10.5, '#006C30', 'measurements.months.exportKwh'],
      ] as const;
      for (const [value, x, color, field] of monthlySeries) {
        if (!validChartValue(value)) continue;
        sourceFields.add(field);
        const barHeight = Math.max(0, Math.min(height, value / axisMax * height));
        series.appendChild(svgShape(document, 'rect', {
          x: String(x), y: String(baseline - barHeight), width: '7', height: String(barHeight), fill: color,
        }));
      }
    }
  });
  if (energyMode) {
    appendStepLine(document, series, pvValues, 'pv', '#FED17F', 72, 552, baseline, height, axisMax);
    appendStepLine(document, series, loadValues, 'load', '#A3AED0', 72, 552, baseline, height, axisMax);
    if (pvValues.some(validChartValue)) sourceFields.add('energy.months.pvKwh');
    if (loadValues.some(validChartValue)) sourceFields.add('energy.months.loadKwh');
    if (missingStack) {
      const missingField = energy ? 'energy.months/measurements.months.importKwh/exportKwh' : 'energy.months';
      addChartMissing(missing, 3, missingField, ['Group 1193'],
        'Niekompletny miesiąc modelu lub pomiarów sieci; pominięto jego słupek zamiast podstawiać zero.');
    }
  }
  plot.appendChild(series);

  const labels = Array.from(resolveElementById(document, '_miesiace_wykres_aktualny')?.getElementsByTagName('text') || []) as XmlElement[];
  labels.sort((a, b) => {
    const ax = Number(a.getAttribute('transform')?.match(/translate\(\s*([\d.-]+)/)?.[1] || 0);
    const bx = Number(b.getAttribute('transform')?.match(/translate\(\s*([\d.-]+)/)?.[1] || 0);
    return ax - bx;
  });
  labels.forEach((label, index) => {
    const month = months[index];
    const number = month ? Number(month.period.slice(5, 7)) : 0;
    setElementText(label, month && number >= 1 && number <= 12
      ? `${MONTH_ABBREVIATIONS[number - 1]} ${month.period.slice(2, 4)}`
      : '');
  });
  for (const id of ['_rok_wykres_aktualny', '_rok_wykres_aktualny_2']) {
    setElementText(resolveElementById(document, id), '');
  }
  if (values.some(validChartValue)) {
    sourceFields.add(energy ? 'energy.months.period' : 'measurements.months.period');
    return true;
  }
  return false;
}

function appendMonthlyEnergyTable(
  document: XmlDocument,
  workspace: OfferWorkspaceDocumentData,
  draft: OfferWorkspaceDraft,
  sourceFields: Set<string>,
  missing: Map<string, OfferWorkspaceDocumentMissingData>,
) {
  if (workspace.energy === undefined) return;
  const energyByMonth = new Map((workspace.energy?.months || []).map((month) => [month.period.slice(5, 7), month]));
  const measurementsByMonth = new Map(workspace.measurements.months.map((month) => [month.period.slice(5, 7), month]));
  const rows = [
    { groupId: 'Group 1229', name: 'produkcja PV', source: 'energy.months.pvKwh', value: (month: string) => energyByMonth.get(month)?.pvKwh ?? null },
    { groupId: 'Group 1228', name: 'zużycie', source: 'energy.months.loadKwh', value: (month: string) => energyByMonth.get(month)?.loadKwh ?? null },
    { groupId: 'Group 1230', name: 'oddanie do sieci', source: 'measurements.months.exportKwh', value: (month: string) => measurementsByMonth.get(month)?.exportKwh ?? null },
    { groupId: 'Group 1231', name: 'autokonsumpcja PV', source: 'energy.months.directKwh', value: (month: string) => energyByMonth.get(month)?.directKwh ?? null },
    { groupId: 'Group 1232', name: 'pobór z sieci', source: 'measurements.months.importKwh', value: (month: string) => measurementsByMonth.get(month)?.importKwh ?? null },
  ];
  for (const row of rows) {
    const group = elementById(document, row.groupId);
    const cells = Array.from(group?.getElementsByTagName('text') || []) as XmlElement[];
    const placeholders = cells.slice(0, 12);
    let hasMissing = false;
    placeholders.forEach((cell, index) => {
      const value = index < 12 ? validEnergyValue(row.value(String(index + 1).padStart(2, '0'))) : null;
      setElementText(cell, value === null ? '—' : formatNumber(value));
      if (value === null) hasMissing = true;
    });
    if (placeholders.some((_, index) => index < 12 && validEnergyValue(row.value(String(index + 1).padStart(2, '0'))) !== null)) {
      sourceFields.add(row.source);
    }
    if (hasMissing && placeholders.length) {
      addMissing(missing, 3, {
        selector: '', dynamic: true, fieldKey: row.source, kind: 'measurement', idHints: [row.groupId],
        groupSelector: '', sourceTextLength: 0, sourceTextSha256: '',
      }, `Brak jednej lub więcej miesięcznych wartości ${row.name}; w odpowiednich polach widnieje kreska.`);
    }
  }
  if (draft.existingBatteryPresent === false) sourceFields.add('draft.existingBatteryPresent');
}

function setEnergyProvenanceHeading(document: XmlDocument, energy: OfferWorkspaceEnergy) {
  const heading = elementById(document, '_nazwa');
  if (!heading) return;
  const quality = energy.quality === 'MODELLED' ? 'MODEL' : 'POMIAR';
  setElementText(heading, `Roczny bilans energetyczny · ${quality}`);
}

function profileForPage(workspace: OfferWorkspaceDocumentData, page: number) {
  const month = page <= 6 ? '05' : '01';
  const dayType: OfferWorkspaceDayProfile['dayType'] = page === 5 || page === 7 ? 'workday' : 'free';
  return [...(workspace.measurements.dayProfiles || [])]
    .filter((profile) => profile.period.slice(5, 7) === month && profile.dayType === dayType && profile.hours.length === 24)
    .sort((a, b) => b.date.localeCompare(a.date))
    .find((profile) => profile.hours.every((hour, index) => hour.hour === index
      && [hour.importKwh, hour.exportKwh].every((value) => value === null || (Number.isFinite(value) && value >= 0))));
}

function energyProfileForPage(workspace: OfferWorkspaceDocumentData, page: number) {
  const measuredProfile = profileForPage(workspace, page);
  if (!measuredProfile || !workspace.energy) return null;
  const profile = workspace.energy.dayProfiles.find((item) => item.date === measuredProfile.date);
  if (!profile || profile.hours.length !== 24 || !profile.hours.every((hour, index) => hour.hour === index
    && [hour.loadKwh, hour.pvKwh, hour.directKwh].every((value) => value === null || (Number.isFinite(value) && value >= 0)))) return null;
  return { ...profile, dayType: measuredProfile.dayType, measuredProfile };
}

function replaceTextMatching(document: XmlDocument, pattern: RegExp, value: string) {
  const text = Array.from(document.getElementsByTagName('text')) as XmlElement[];
  for (const element of text) {
    if (pattern.test((element.textContent || '').trim())) setElementText(element, value);
  }
}

function neutralizeUnconfirmedFinancingLabels(document: XmlDocument) {
  replaceTextMatching(document, /^Prognozowana kwota dotacji z Programu “Mój Przydomowy Magazyn Energii”$/,
    'Dotacja do potwierdzenia');
  replaceTextMatching(document, /^Prognozowana ulga termomodernizacyjna$/,
    'Ulga do potwierdzenia');
  replaceTextMatching(document, /^Prognozowany koszt sytemu po dofinansowaniach$/,
    'Koszt po finansowaniu do ustalenia');
}

function clearStateOfChargeExamples(document: XmlDocument, resolveElementById = elementById, keepTimelineMarks = false) {
  const group = resolveElementById(document, 'Group 1278');
  if (!keepTimelineMarks) removeDataShapes(group);
  for (const text of Array.from(group?.getElementsByTagName('text') || []) as XmlElement[]) {
    if (/^\d{1,3}%$/.test((text.textContent || '').trim())) setStateOfChargeLabel(text, '');
  }
}

function setStateOfChargeLabel(element: XmlElement, value: string) {
  const spans = Array.from(element.getElementsByTagName('tspan')) as XmlElement[];
  if (!spans.length) {
    setElementText(element, value);
    return;
  }
  spans.forEach((span, index) => {
    while (span.firstChild) span.removeChild(span.firstChild);
    if (index === 0) span.appendChild(element.ownerDocument!.createTextNode(value));
  });
}

function appendStateOfChargeReadings(
  document: XmlDocument,
  workspace: OfferWorkspaceDocumentData,
  draft: OfferWorkspaceDraft,
  calculation: OfferWorkspaceCalculation,
  page: OfferTemplateV4PageNumber,
  sourceFields: Set<string>,
  resolveElementById: (document: XmlDocument, id: string) => XmlElement | null,
) {
  const date = selectedDailyProfileDate(workspace, page);
  const capacity = forecastBatteryCapacity(workspace, draft);
  if (!date || capacity === null || capacity <= 0) return false;
  const flows = flowRowsByLocalDate(calculation, date);
  if (flows.length !== 24) return false;
  const byHour = new Map<number, OfferForecastFlow[]>();
  for (const flow of flows) {
    const hour = localFlowParts(flow)?.hour;
    if (hour === undefined || hour < 0 || hour > 23) return false;
    const items = byHour.get(hour) || [];
    items.push(flow);
    byHour.set(hour, items);
  }
  if (byHour.size !== 24 || Array.from(byHour.values()).some((rows) => rows.length !== 1)) return false;
  const socValues: number[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const socKwh = byHour.get(hour)?.[0]?.socKwh;
    if (socKwh === undefined || !Number.isFinite(socKwh) || socKwh < 0 || socKwh > capacity) return false;
    socValues.push(socKwh);
  }

  const group = resolveElementById(document, 'Group 1278');
  if (!group) return false;
  const labels = (Array.from(group.getElementsByTagName('text')) as XmlElement[])
    .filter((label) => !(label.textContent || '').trim() && label.getElementsByTagName('tspan').length > 0)
    .sort((left, right) => textOrigin(left, 'x') - textOrigin(right, 'x'));
  if (labels.length !== 24) return false;
  labels.forEach((label, hour) => setStateOfChargeLabel(label, `${formatNumber(socValues[hour] / capacity * 100, 0)}%`));
  sourceFields.add('calculation.forecastFlows.socKwh');
  sourceFields.add('draft.selectedTemplateIds|templates.capacityKwh');
  return true;
}

function clearIllustrativeHourlyZones(document: XmlDocument, resolveElementById = elementById) {
  const colors = new Set(['#00bdff', '#2b3674', '#ff3b30']);
  for (const groupId of ['Group 1299', 'Group 1245']) {
    const zones = resolveElementById(document, groupId);
    for (const shape of Array.from(zones?.getElementsByTagName('*') || []) as XmlElement[]) {
      const fill = (shape.getAttribute('fill') || '').trim().toLowerCase();
      if (colors.has(fill) || (groupId === 'Group 1299' && fill.startsWith('url(#paint1_linear'))) {
        shape.setAttribute('fill', '#FFFFFF');
      }
    }
  }
}

function replaceDailyTemplatePlaceholders(document: XmlDocument, workspace: OfferWorkspaceDocumentData, draft: OfferWorkspaceDraft) {
  replaceTextMatching(document, /^NR\s+XX\/XX\/XX\/XX\/X$/, 'NR —');
  const pvPower = draft.existingPv.powerKw ?? workspace.input.existingPv?.powerKw ?? null;
  const pvText = validChartValue(pvPower) ? `${formatNumber(pvPower, 1)} kWp` : '—';
  replaceTextMatching(document, /^\(Taryfa jednostrefowa: XX, Fotowoltaika: XX kWp\)$/,
    `(Taryfa: —, Fotowoltaika: ${pvText})`);
  replaceTextMatching(document, /^\(Taryfa trójstrefowa: XX, Fotowoltaika: XX kWp, Magazyn energii: XX kWh\)$/,
    '(Taryfa: —, Fotowoltaika: —, Magazyn energii: —)');
}

function neutralizeV4DailyTariffLabels(document: XmlDocument) {
  replaceTextMatching(document, /^\(Taryfa jednostrefowa:\s*$/, '(Taryfa: ');
  replaceTextMatching(document, /^\(Taryfa trójstrefowa:\s*$/, '(Taryfa: ');
}

function setTextOriginX(element: XmlElement, x: number) {
  const spans = Array.from(element.getElementsByTagName('tspan')) as XmlElement[];
  if (!spans.length) return;
  const elementOffsetX = textOrigin(element, 'x') - Number(spans[0].getAttribute('x') || 0);
  spans.forEach((span) => span.setAttribute('x', String(x - elementOffsetX)));
}

function v4TextWidth(element: XmlElement) {
  return fontFor(element).getAdvanceWidth((element.textContent || '').trim(), fontSize(element));
}

function reflowV4DailyProposedHeader(document: XmlDocument, page: number) {
  const suffix = String(page).padStart(2, '0');
  const tariff = uniqueElementById(document, `#b2c_taryfa_prognozowana_strona_${suffix}`);
  const tariffFollowing = uniqueElementById(document, 'stale / tekst_3');
  const pv = uniqueElementById(document, `#b2c_moc_pv_prognozowana_strona_${suffix}`);
  const pvFollowing = uniqueElementById(document, 'stale / tekst_4');
  const capacity = uniqueElementById(document, `#b2c_pojemnosc_magazynu_prognozowana_strona_${suffix}`);
  const capacityUnit = uniqueElementById(document, 'stale / jednostka lub dopisek_2');
  if (!tariff || !tariffFollowing || !pv || !pvFollowing || !capacity || !capacityUnit) return;

  const gap = 2;
  const tariffX = textOrigin(tariff, 'x');
  const tariffEnd = tariffX + v4TextWidth(tariff);
  const tariffFollowingX = Math.max(textOrigin(tariffFollowing, 'x'), tariffEnd + gap);
  setTextOriginX(tariffFollowing, tariffFollowingX);

  const pvX = Math.max(textOrigin(pv, 'x'), tariffFollowingX + v4TextWidth(tariffFollowing) + gap);
  setTextOriginX(pv, pvX);
  const pvFollowingX = Math.max(textOrigin(pvFollowing, 'x'), pvX + v4TextWidth(pv) + gap);
  setTextOriginX(pvFollowing, pvFollowingX);

  const capacityX = Math.max(textOrigin(capacity, 'x'), pvFollowingX + v4TextWidth(pvFollowing) + gap);
  setTextOriginX(capacity, capacityX);
  const capacityUnitX = Math.max(textOrigin(capacityUnit, 'x'), capacityX + v4TextWidth(capacity) + 1.5);
  setTextOriginX(capacityUnit, capacityUnitX);
}

function appendHourlyReadings(
  document: XmlDocument,
  page: OfferTemplateV3PageNumber,
  workspace: OfferWorkspaceDocumentData,
  draft: OfferWorkspaceDraft,
  sourceFields: Set<string>,
  missing: Map<string, OfferWorkspaceDocumentMissingData>,
  resolveElementById = elementById,
  templateVersion: 'V3' | 'V4' = 'V3',
) {
  const currentPlot = resolveElementById(document, 'Group 1298_2');
  const futurePlot = resolveElementById(document, 'Group 1298');
  clearStateOfChargeExamples(document, resolveElementById, templateVersion === 'V4');
  clearIllustrativeHourlyZones(document, resolveElementById);
  if (templateVersion === 'V3') replaceDailyTemplatePlaceholders(document, workspace, draft);
  for (const id of ['Union', 'Union_2', 'Union_3', 'Union_4']) removeElement(resolveElementById(document, id));
  removeDataShapes(currentPlot);
  removeDataShapes(futurePlot);
  const energyMode = workspace.energy !== undefined;
  const energy = workspace.energy ?? null;
  const energyProfile = energy ? energyProfileForPage(workspace, page) : null;
  const measuredProfile = energyMode ? null : profileForPage(workspace, page);
  const profileDate = energyProfile?.date ?? measuredProfile?.date ?? null;
  const profileDayType = energyProfile?.dayType ?? measuredProfile?.dayType ?? null;
  const hours = energyProfile?.hours ?? measuredProfile?.hours ?? [];
  if (profileDate && profileDayType && currentPlot) {
    const modelHours = hours as OfferWorkspaceEnergy['dayProfiles'][number]['hours'];
    const meterHours = energyProfile?.measuredProfile.hours ?? measuredProfile?.hours ?? [];
    const stackValues = energyMode
      ? modelHours.map((hour, index) => [hour.directKwh, meterHours[index]?.importKwh, meterHours[index]?.exportKwh] as const)
      : [];
    const stackTotals = stackValues.map((stack) => stack.every(validChartValue)
      ? stack.reduce<number>((total, value) => total + (validChartValue(value) ? value : 0), 0)
      : null);
    const pvValues = energyMode ? modelHours.map((hour) => hour.pvKwh) : [];
    const loadValues = energyMode ? modelHours.map((hour) => hour.loadKwh) : [];
    const values = energyMode
      ? [...stackTotals, ...pvValues, ...loadValues]
      : (hours as OfferWorkspaceDayProfile['hours']).flatMap((hour) => [hour.importKwh, hour.exportKwh]);
    const axisGroup = resolveElementById(document, 'Group 1259_3');
    const maxReading = validDataMaximum(values);
    const axisMax = setPlotAxis(axisGroup, maxReading, Array.from({ length: 11 }, (_, index) => String(index)), maxReading < 10 ? 1 : 0);
    const baseline = 268;
    const height = 129;
    const energySeriesId = energy
      ? `workspace-${energy.quality.toLowerCase().replace('_', '-')}-hourly-series`
      : energyMode ? 'workspace-missing-energy-hourly-series' : 'workspace-measured-hourly-series';
    const series = svgShape(document, 'g', { id: energySeriesId });
    let missingStack = false;
    const hourlyBarX = [70, 90, 110, 130, 150, 170, 189, 209, 229, 249, 269, 289, 309, 329, 349, 369, 389, 409, 428, 448, 468, 488, 508, 528];
    hours.forEach((hour, index) => {
      const x = hourlyBarX[index];
      if (energyMode) {
        const modelHour = hour as OfferWorkspaceEnergy['dayProfiles'][number]['hours'][number];
        const meterHour = meterHours[index];
        const stack = [modelHour.directKwh, meterHour?.importKwh, meterHour?.exportKwh];
        if (!stack.every(validChartValue)) {
          missingStack = true;
          return;
        }
        let accumulated = 0;
        const segments = [
          [stack[0], '#FED17F', 'energy.dayProfiles.directKwh'],
          [stack[1], '#FC7C00', 'measurements.dayProfiles.importKwh'],
          [stack[2], '#006C30', 'measurements.dayProfiles.exportKwh'],
        ] as const;
        for (const [value, color, field] of segments) {
          sourceFields.add(field);
          const barHeight = value / axisMax * height;
          series.appendChild(svgShape(document, 'rect', {
            x: String(x),
            y: String(baseline - (accumulated + value) / axisMax * height),
            width: '10',
            height: String(barHeight),
            fill: color,
            'data-series': field,
          }));
          accumulated += value;
        }
      } else {
        const bandStart = 65 + index * (478 / 24);
        const measuredSeries = [
          [(hour as OfferWorkspaceDayProfile['hours'][number]).importKwh, bandStart + 2, '#FC7C00', 'measurements.dayProfiles.importKwh'],
          [(hour as OfferWorkspaceDayProfile['hours'][number]).exportKwh, bandStart + 10, '#006C30', 'measurements.dayProfiles.exportKwh'],
        ] as const;
        for (const [value, barX, color, field] of measuredSeries) {
          if (!validChartValue(value)) continue;
          sourceFields.add(field);
          const barHeight = Math.max(0, Math.min(height, value / axisMax * height));
          series.appendChild(svgShape(document, 'rect', {
            x: String(barX), y: String(baseline - barHeight), width: '6', height: String(barHeight), fill: color,
          }));
        }
      }
    });
    if (energyMode) {
      appendStepLine(document, series, pvValues, 'pv', '#FED17F', 65, 543, baseline, height, axisMax);
      appendStepLine(document, series, loadValues, 'load', '#A3AED0', 65, 543, baseline, height, axisMax);
      if (pvValues.some(validChartValue)) sourceFields.add('energy.dayProfiles.pvKwh');
      if (loadValues.some(validChartValue)) sourceFields.add('energy.dayProfiles.loadKwh');
      if (missingStack) {
        addChartMissing(missing, page, 'energy.dayProfiles.directKwh/measurements.dayProfiles.importKwh/exportKwh', ['Group 1298_2'],
          'Niekompletna godzina modelu lub pomiarów sieci; pominięto jej słupek zamiast podstawiać zero.');
      }
    }
    currentPlot.appendChild(series);
    sourceFields.add(energy ? 'energy.dayProfiles.date' : 'measurements.dayProfiles.date');
    sourceFields.add('measurements.dayProfiles.dayType');
    const profileLabel = energy?.quality === 'MODELLED' ? 'Profil modelowany' : 'Profil pomiarowy';
    replaceTextMatching(document, /^Analiza energetyczna\s+-\s+dzień\s+.+$/i,
      `${profileLabel} - dzień ${profileDayType === 'workday' ? 'roboczy' : 'wolny'}`);
    replaceTextMatching(document, /^\((?:Maj|Styczeń)\s+\d{4}\)$/i, `(${profileDate})`);
    return values.some(validChartValue);
  }
  replaceTextMatching(document, /^Analiza energetyczna\s+-\s+dzień\s+.+$/i,
    workspace.energy?.quality === 'MODELLED'
      ? 'Brak modelowanego profilu'
      : energyMode ? 'Brak obliczenia energii' : 'Brak profilu pomiarowego');
  replaceTextMatching(document, /^\((?:Maj|Styczeń)\s+\d{4}\)$/i, '');
  return false;
}

function selectedDailyProfileDate(workspace: OfferWorkspaceDocumentData, page: OfferTemplateV3PageNumber) {
  return profileForPage(workspace, page)?.date
    || [...(workspace.measurements.dayProfiles || [])]
      .filter((profile) => profile.period.slice(5, 7) === (page <= 6 ? '05' : '01')
        && profile.dayType === (page === 5 || page === 7 ? 'workday' : 'free')
        && profile.hours.length === 24)
      .sort((left, right) => right.date.localeCompare(left.date))[0]?.date
    || null;
}

function appendMonthlyForecastReadings(
  document: XmlDocument,
  calculation: OfferWorkspaceCalculation,
  sourceFields: Set<string>,
  missing: Map<string, OfferWorkspaceDocumentMissingData>,
  resolveElementById: (document: XmlDocument, id: string) => XmlElement | null,
) {
  const plot = resolveElementById(document, 'Group 1205');
  if (!plot) return false;
  removeElement(elementByIdWithin(plot, 'Vector (Stroke)'));
  removeElement(elementByIdWithin(plot, 'Vector (Stroke)_2'));
  removeDataShapes(plot);

  type MonthlyValues = { period: string; load: number | null; pv: number | null; direct: number | null; imported: number | null; exported: number | null };
  let records: MonthlyValues[];
  const flowMonths = flowMonthRows(calculation);
  if (flowMonths.length) {
    records = flowMonths.map(({ period, rows }) => ({
      period,
      load: sumFlowMeasure(rows, 'loadKwh'),
      pv: sumFlowMeasure(rows, 'pvKwh'),
      direct: sumFlowMeasure(rows, 'directKwh'),
      imported: sumFlowMeasure(rows, 'importKwh'),
      exported: sumFlowMeasure(rows, 'exportKwh'),
    }));
  } else {
    const periods = [...new Set([
      ...(calculation.forecastEnergy?.months || []).map((month) => month.period),
      ...(calculation.forecastMeasurements?.months || []).map((month) => month.period),
    ])].sort().slice(-12);
    records = periods.map((period) => {
      const energyMonth = calculation.forecastEnergy?.months.find((month) => month.period === period);
      const meterMonth = calculation.forecastMeasurements?.months.find((month) => month.period === period);
      return {
        period,
        load: energyMonth?.loadKwh ?? null,
        pv: energyMonth?.pvKwh ?? null,
        direct: energyMonth?.directKwh ?? null,
        imported: meterMonth?.importKwh ?? null,
        exported: meterMonth?.exportKwh ?? null,
      };
    });
  }
  records = records.slice(-12);
  const months = [...Array.from({ length: 12 - records.length }, () => undefined), ...records];
  const stackTotals = months.map((month) => month && [month.direct, month.imported, month.exported].every(validChartValue)
    ? month.direct! + month.imported! + month.exported! : null);
  const values = [...stackTotals, ...months.map((month) => month?.pv), ...months.map((month) => month?.load)];
  const axisMax = setPlotAxis(resolveElementById(document, '_jednostki_wykres_aktualny'), validDataMaximum(values),
    ['_0', '_200', '_400', '_600', '_800', '_1000', '_1200']);
  const baseline = 308.028;
  const height = baseline - 131.029;
  const series = svgShape(document, 'g', { id: 'workspace-calculated-forecast-monthly-series' });
  let hasData = false;
  months.forEach((month, index) => {
    const categoryX = 77 + index * 40.866;
    if (!month || ![month.direct, month.imported, month.exported].every(validChartValue)) return;
    let accumulated = 0;
    const segments = [
      [month.direct!, '#FED17F', 'calculation.forecastFlows.directKwh'],
      [month.imported!, '#FC7C00', 'calculation.forecastFlows.importKwh'],
      [month.exported!, '#006C30', 'calculation.forecastFlows.exportKwh'],
    ] as const;
    for (const [value, color, source] of segments) {
      series.appendChild(svgShape(document, 'rect', {
        x: String(categoryX), y: String(baseline - (accumulated + value) / axisMax * height),
        width: '18.3896', height: String(value / axisMax * height), fill: color, 'data-series': source,
      }));
      accumulated += value;
      sourceFields.add(source);
    }
    hasData = true;
  });
  const pvValues = months.map((month) => month?.pv);
  const loadValues = months.map((month) => month?.load);
  appendStepLine(document, series, pvValues, 'pv', '#FED17F', 72, 552, baseline, height, axisMax);
  appendStepLine(document, series, loadValues, 'load', '#A3AED0', 72, 552, baseline, height, axisMax);
  if (pvValues.some(validChartValue)) {
    sourceFields.add(flowMonths.length ? 'calculation.forecastFlows.pvKwh' : 'calculation.forecastEnergy.months.pvKwh');
    hasData = true;
  }
  if (loadValues.some(validChartValue)) {
    sourceFields.add(flowMonths.length ? 'calculation.forecastFlows.loadKwh' : 'calculation.forecastEnergy.months.loadKwh');
    hasData = true;
  }
  if (hasData) plot.appendChild(series);

  const labels = Array.from(resolveElementById(document, '_miesiace_wykres_aktualny')?.getElementsByTagName('text') || []) as XmlElement[];
  labels.sort((a, b) => {
    const ax = Number(a.getAttribute('transform')?.match(/translate\(\s*([\d.-]+)/)?.[1] || 0);
    const bx = Number(b.getAttribute('transform')?.match(/translate\(\s*([\d.-]+)/)?.[1] || 0);
    return ax - bx;
  });
  labels.forEach((label, index) => {
    const month = months[index];
    const number = month ? Number(month.period.slice(5, 7)) : 0;
    setElementText(label, month && number >= 1 && number <= 12
      ? `${MONTH_ABBREVIATIONS[number - 1]} ${month.period.slice(2, 4)}` : '');
  });
  for (const id of ['_rok_wykres_aktualny', '_rok_wykres_aktualny_2']) setElementText(resolveElementById(document, id), '');
  if (!hasData) addV4Missing(missing, 4, 'calculation.forecastFlows/forecastEnergy.months', 'Brak miesięcznych danych prognozy do wykresu; serie przykładowe usunięto.');
  return hasData;
}

function appendForecastHourlyReadings(
  document: XmlDocument,
  page: OfferTemplateV4PageNumber,
  workspace: OfferWorkspaceDocumentData,
  calculation: OfferWorkspaceCalculation,
  sourceFields: Set<string>,
  resolveElementById: (document: XmlDocument, id: string) => XmlElement | null,
) {
  const plot = resolveElementById(document, 'Group 1298');
  if (!plot) return false;
  removeDataShapes(plot);
  const date = selectedDailyProfileDate(workspace, page);
  if (!date) return false;

  type HourValues = { hour: number; load: number | null; pv: number | null; direct: number | null; imported: number | null; exported: number | null };
  let hours: HourValues[];
  const dayFlows = flowRowsByLocalDate(calculation, date);
  if (dayFlows.length) {
    const byHour = new Map<number, OfferForecastFlow[]>();
    for (const flow of dayFlows) {
      const hour = localFlowParts(flow)?.hour;
      if (hour === undefined || hour < 0 || hour > 23) continue;
      const items = byHour.get(hour) || [];
      items.push(flow);
      byHour.set(hour, items);
    }
    hours = Array.from({ length: 24 }, (_, hour) => {
      const rows = byHour.get(hour) || [];
      return {
        hour,
        load: sumFlowMeasure(rows, 'loadKwh'),
        pv: sumFlowMeasure(rows, 'pvKwh'),
        direct: sumFlowMeasure(rows, 'directKwh'),
        imported: sumFlowMeasure(rows, 'importKwh'),
        exported: sumFlowMeasure(rows, 'exportKwh'),
      };
    });
  } else if (calculation.forecastFlows?.length) {
    return false;
  } else if (calculation.forecastEnergy && calculation.forecastMeasurements) {
    const forecastWorkspace: OfferWorkspaceDocumentData = {
      ...workspace, energy: calculation.forecastEnergy, measurements: calculation.forecastMeasurements,
    };
    const profile = energyProfileForPage(forecastWorkspace, page);
    if (!profile || profile.date !== date) return false;
    hours = profile.hours.map((hour, index) => ({
      hour: hour.hour,
      load: hour.loadKwh,
      pv: hour.pvKwh,
      direct: hour.directKwh,
      imported: profile.measuredProfile.hours[index]?.importKwh ?? null,
      exported: profile.measuredProfile.hours[index]?.exportKwh ?? null,
    }));
  } else return false;

  const stackTotals = hours.map((hour) => [hour.direct, hour.imported, hour.exported].every(validChartValue)
    ? hour.direct! + hour.imported! + hour.exported! : null);
  const values = [...stackTotals, ...hours.map((hour) => hour.pv), ...hours.map((hour) => hour.load)];
  const axisMax = setPlotAxis(resolveElementById(document, 'Group 1259'), validDataMaximum(values), Array.from({ length: 11 }, (_, index) => String(index)), validDataMaximum(values) < 10 ? 1 : 0);
  const baseline = 477;
  const height = 129;
  const series = svgShape(document, 'g', { id: 'workspace-calculated-future-hourly-series' });
  const barX = [70, 90, 110, 130, 150, 170, 189, 209, 229, 249, 269, 289, 309, 329, 349, 369, 389, 409, 428, 448, 468, 488, 508, 528];
  hours.forEach((hour, index) => {
    if (![hour.direct, hour.imported, hour.exported].every(validChartValue)) return;
    let accumulated = 0;
    const segments = [
      [hour.direct!, '#FED17F', 'calculation.forecastFlows.directKwh'],
      [hour.imported!, '#FC7C00', 'calculation.forecastFlows.importKwh'],
      [hour.exported!, '#006C30', 'calculation.forecastFlows.exportKwh'],
    ] as const;
    for (const [value, color, source] of segments) {
      series.appendChild(svgShape(document, 'rect', {
        x: String(barX[index]), y: String(baseline - (accumulated + value) / axisMax * height),
        width: '10', height: String(value / axisMax * height), fill: color, 'data-series': source,
      }));
      accumulated += value;
      sourceFields.add(source);
    }
  });
  appendStepLine(document, series, hours.map((hour) => hour.pv), 'pv', '#FED17F', 65, 543, baseline, height, axisMax);
  appendStepLine(document, series, hours.map((hour) => hour.load), 'load', '#A3AED0', 65, 543, baseline, height, axisMax);
  if (hours.some((hour) => validChartValue(hour.pv))) sourceFields.add(dayFlows.length ? 'calculation.forecastFlows.pvKwh' : 'calculation.forecastEnergy.dayProfiles.pvKwh');
  if (hours.some((hour) => validChartValue(hour.load))) sourceFields.add(dayFlows.length ? 'calculation.forecastFlows.loadKwh' : 'calculation.forecastEnergy.dayProfiles.loadKwh');
  plot.appendChild(series);
  return values.some(validChartValue);
}

function clearUnsupportedDataShapes(document: XmlDocument, page: number) {
  const targetIds = page === 9
    ? ['_kosszt_zakupu_1kwh_aktualny', '_kosszt_zakupu_1kwh_aktualny_2', '_aktualny_rachunek_roczny', '_prognozowany_rachunek_roczny', '_oszczednosc']
    : page === 10 ? ['_oszczednosc'] : [];
  for (const id of targetIds) removeDataShapes(elementById(document, id));
  return targetIds.length > 0;
}

function validateSafeSvg(document: XmlDocument, page: number) {
  const forbiddenTags = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video']);
  const allowedDataUrl = /^(?:data:image\/(?:png|jpeg|jpg|webp|gif)|data:font\/ttf);base64,[a-z0-9+/=]+$/i;
  for (const element of allElements(document)) {
    const tag = (element.localName || element.tagName).toLowerCase();
    if (forbiddenTags.has(tag)) throw new Error(`Niedozwolony element <${tag}> w SVG strony ${page}.`);
    for (const attribute of Array.from(element.attributes || [])) {
      const name = (attribute.name || '').toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on')) throw new Error(`Niedozwolony atrybut aktywny w SVG strony ${page}.`);
      if ((name === 'href' || name.endsWith(':href')) && value && !value.startsWith('#') && !allowedDataUrl.test(value)) {
        throw new Error(`Niedozwolony odnośnik w SVG strony ${page}.`);
      }
      if (/@import|javascript\s*:/i.test(value)) throw new Error(`Niedozwolony CSS w SVG strony ${page}.`);
      for (const match of value.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/gi)) {
        const target = match[1];
        if (!target.startsWith('#') && !allowedDataUrl.test(target)) throw new Error(`Zewnętrzny zasób w SVG strony ${page}.`);
      }
    }
  }
}

function normalizedId(id: string) {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('pl-PL', { maximumFractionDigits: digits, minimumFractionDigits: digits, useGrouping: 'always' })
    .format(value)
    .replace(/[\u00a0\u202f]/g, ' ');
}

function formatPeriod(period: string) {
  return period;
}

function settlementLabel(value: string | null) {
  if (value === 'NET_BILLING') return 'Net-billing';
  if (value === 'NET_METERING') return 'Net-metering';
  return null;
}

type Page10ProductRow = OfferWorkspacePricingResult['lines'][number] & {
  description: string;
  model: string | null;
  unitSaleAmount: number | null;
  lineSaleAmount: number | null;
};

type Page10ProductPricing = {
  pricing: OfferWorkspacePricingResult;
  rows: Page10ProductRow[];
};

function selectedProductRows(workspace: OfferWorkspaceDocumentData, draft: OfferWorkspaceDraft) {
  validateOfferWorkspaceConfigurationEdits(workspace.templates, draft);
  const effectiveTemplates = applyOfferWorkspaceConfigurationEdits(workspace.templates, draft);
  const selected = new Set(draft.selectedTemplateIds);
  const selectedTemplates = effectiveTemplates.filter((template) => selected.has(template.id));
  const pricing = priceOfferWorkspaceConfiguration(selectedTemplates, draft.saleVatMode, workspace.clientType);
  const productByTemplateItem = new Map(selectedTemplates.flatMap((template) => template.items.map((item) => [
    `${template.id}\u0000${item.id}`,
    item.product,
  ] as const)));
  const rows = pricing.lines.map((line) => {
    const product = productByTemplateItem.get(`${line.templateId}\u0000${line.itemId}`);
    return {
      ...line,
      description: [
        line.workspaceRemoved ? 'USUNIĘTA' : null,
        line.workspaceAdded ? 'DODANA' : null,
        !line.workspaceAdded && line.workspaceChanged && !line.workspaceRemoved ? 'ZMIENIONA' : null,
        line.description?.trim() || line.templateName,
      ].filter(Boolean).join(' — '),
      model: product
        ? [product.producer, line.productName].filter(Boolean).join(' ')
        : null,
      unitSaleAmount: line.includedInSale && line.saleAmount !== null && line.quantity !== null && line.quantity > 0
        ? line.saleAmount / line.quantity
        : null,
      lineSaleAmount: line.includedInSale ? line.saleAmount : null,
    };
  });
  // Keep tombstones visible in the fixed product table, even when other rows overflow.
  const orderedRows = rows.map((row, index) => ({ row, index }))
    .sort((left, right) => Number(Boolean(right.row.workspaceRemoved)) - Number(Boolean(left.row.workspaceRemoved))
      || left.index - right.index)
    .map(({ row }) => row);
  if (draft.commercialPricing) {
    const commercial = calculateOfferCommercialPricing(pricing, selectedTemplates, draft.commercialPricing);
    const commercialRows: Page10ProductRow[] = commercial.rows.map((group) => {
      const sources = group.sourceReferences.map(ref => rows.find(row => row.templateId === ref.templateId && row.itemId === ref.itemId)!);
      const models = sources.filter(row => group.group !== 'STORAGE_INSTALLATION'
        || ['MAGAZYN_ENERGII', 'BATTERY'].includes(productByTemplateItem.get(`${row.templateId}\u0000${row.itemId}`)?.category || ''))
        .filter(row => row.model).map(row => `${row.quantity !== 1 ? `${row.quantity} × ` : ''}${row.model}`);
      return { ...sources[0], itemId: `commercial-${group.group}`, description: group.label,
        productName: null, model: models.length ? models.join('; ') : null,
        quantity: 1, includedInSale: true, resolvedCosts: null, calculation: null,
        saleAmount: pricing.saleAmountBasis === 'NET' ? group.amountNet : group.amountGross,
        unitSaleAmount: pricing.saleAmountBasis === 'NET' ? group.amountNet : group.amountGross,
        lineSaleAmount: pricing.saleAmountBasis === 'NET' ? group.amountNet : group.amountGross,
        saleVatRate: commercial.saleVatRate, missingPriceReason: null,
        workspaceRemoved: false, workspaceAdded: false, workspaceChanged: false };
    });
    return { pricing, rows: commercialRows } satisfies Page10ProductPricing;
  }
  return { pricing, rows: orderedRows } satisfies Page10ProductPricing;
}

function selectedTemplateValues(workspace: OfferWorkspaceDocumentData, draft: OfferWorkspaceDraft, scope: 'PV' | 'BATTERY') {
  if (hasRemovedCriticalConfigurationItem(workspace.templates, draft, scope)) return [];
  const effectiveTemplates = applyOfferWorkspaceConfigurationEdits(workspace.templates, draft);
  const selected = new Set(draft.selectedTemplateIds);
  return effectiveTemplates.filter((template) => selected.has(template.id)
    && configurationInvestmentScope(template.kind) === scope);
}

function forecastPvPower(workspace: OfferWorkspaceDocumentData, draft: OfferWorkspaceDraft) {
  const existingPower = draft.existingPv.powerKw ?? workspace.input.existingPv?.powerKw ?? null;
  if (draft.pvStrategy === 'KEEP_EXISTING') return validChartValue(existingPower) ? existingPower : null;
  const pvTemplates = selectedTemplateValues(workspace, draft, 'PV');
  if (pvTemplates.length !== 1 || !validChartValue(existingPower) || !validChartValue(pvTemplates[0].powerKw)) return null;
  return existingPower + pvTemplates[0].powerKw!;
}

function forecastBatteryCapacity(workspace: OfferWorkspaceDocumentData, draft: OfferWorkspaceDraft) {
  const batteryTemplates = selectedTemplateValues(workspace, draft, 'BATTERY');
  if (batteryTemplates.length !== 1 || !validChartValue(batteryTemplates[0].capacityKwh)) return null;
  return batteryTemplates[0].capacityKwh!;
}

function page10DisplayRows(rows: Page10ProductRow[], pricing: OfferWorkspacePricingResult) {
  if (rows.length <= PRODUCT_ROW_SUFFIXES.length) return rows;
  const firstOverflowIndex = PRODUCT_ROW_SUFFIXES.length - 1;
  const overflow = rows.slice(firstOverflowIndex);
  const includedRows = overflow.filter((row) => row.includedInSale);
  const incomplete = pricing.systemCostBeforeFinancing === null
    || pricing.calculationError !== null
    || overflow.some((row) => row.missingPriceReason !== null)
    || includedRows.some((row) => row.saleAmount === null || !Number.isFinite(row.saleAmount));
  const total = incomplete ? null : overflow.reduce((sum, row) => (
    sum + (row.includedInSale ? row.saleAmount! : 0)
  ), 0);
  const includedInSale = includedRows.length > 0 || overflow.some((row) => row.missingPriceReason !== null);
  const aggregate: Page10ProductRow = {
    ...overflow[0],
    description: `Pozostałe pozycje zestawu (${overflow.length})`,
    productName: null,
    model: null,
    quantity: 1,
    includedInSale,
    resolvedCosts: null,
    saleVatRate: null,
    calculation: null,
    saleAmount: total,
    missingPriceReason: incomplete
      ? overflow.find((row) => row.missingPriceReason !== null)?.missingPriceReason
        || pricing.calculationError
        || 'Niepełna wycena pozycji zbiorczej.'
      : null,
    unitSaleAmount: includedInSale ? total : null,
    lineSaleAmount: includedInSale ? total : null,
  };
  return [...rows.slice(0, firstOverflowIndex), aggregate];
}

function formatMoney(value: number) {
  return `${formatNumber(value, 2)} PLN`;
}

function unknownFinancialReason(source: string) {
  if (source === 'unknown.financing.grant') return 'Kwota dotacji pozostaje nieznana; nie założono finansowania.';
  if (source === 'unknown.financing.relief') return 'Kwota ulgi pozostaje nieznana; nie założono finansowania.';
  return 'Koszt po finansowaniu pozostaje nieznany; nie odjęto niepotwierdzonych kwot.';
}

function unknownEnergyReason(source: string) {
  if (source.includes('existingBatteryPresent')) return 'Nie potwierdzono braku magazynu w okresie danych; autokonsumpcja z magazynu pozostaje nieznana.';
  const field = source.split('.').at(-1);
  return `Brak wymaganej wartości ${field || 'energii'} w przekazanym modelu; nie zastąpiono jej pomiarem ani założeniem.`;
}

function monthStatistics(workspace: OfferWorkspaceDocumentData) {
  const values = workspace.energy !== undefined
    ? (workspace.energy ? chronologicalEnergyMonths(workspace.energy) : [])
      .filter((month): month is NonNullable<typeof month> => Boolean(month))
      .filter((month): month is typeof month & { loadKwh: number } => month.loadKwh !== null)
      .map((month) => ({ period: month.period, value: month.loadKwh }))
    : chronologicalMonths(workspace)
      .filter((month): month is NonNullable<typeof month> => Boolean(month))
      .filter((month): month is typeof month & { importKwh: number } => month.importKwh !== null)
      .map((month) => ({ period: month.period, value: month.importKwh }));
  if (!values.length) return { maximum: null, average: null, minimum: null };
  return {
    maximum: values.reduce((best, item) => item.value > best.value ? item : best),
    average: { period: null, value: values.reduce((sum, item) => sum + item.value, 0) / values.length },
    minimum: values.reduce((best, item) => item.value < best.value ? item : best),
  };
}

function validEnergyValue(value: number | null) {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function energyMetric(value: number | null, field: string, unit = true): MappedValue {
  const valid = validEnergyValue(value);
  return valid === null
    ? { value: '—', source: `unknown.energy.${field}` }
    : { value: `${formatNumber(valid)}${unit ? ' kWh' : ''}`, source: `energy.${field}` };
}

type MappedValue = { value: string; source: string; numericValue?: number } | null;
type OfferStorageIllustration = NonNullable<ReturnType<typeof resolveOfferStorageIllustration>>;

function mapBinding(
  page: OfferTemplateV3PageNumber,
  binding: OfferTemplateV3TextBinding,
  occurrence: number,
  workspace: OfferWorkspaceDocumentData,
  draft: OfferWorkspaceDraft,
  productRows: Page10ProductRow[],
  pricing: OfferWorkspacePricingResult,
  groupBindings: ReturnType<typeof inspectOfferTemplateV3>['pages'][number]['groupBindings'],
  sourceText: string,
): MappedValue {
  const rawId = binding.idHints[0] || '';
  const id = normalizedId(rawId);
  const isDescriptionBlock = DESCRIPTION_IDS.has(rawId.toLowerCase());
  if (isDescriptionBlock) {
    return page === 10 ? { value: sourceText, source: 'template.label' } : null;
  }
  const staticLabel = sourceText.trim();
  if (page === 10) {
    if (id.includes('prognozowana_kwota_dotacji')) {
      return { value: 'Dotacja do potwierdzenia', source: 'template.label' };
    }
    if (id.includes('prognozowana_ulga_termomodernizacyjna')) {
      return { value: 'Ulga do potwierdzenia', source: 'template.label' };
    }
    if (id.includes('prognozowany_koszt_sytemu_po_dofinansowaniach')) {
      return { value: 'Koszt po finansowaniu do ustalenia', source: 'template.label' };
    }
    if (workspace.clientType === 'B2B' && staticLabel.toLowerCase() === 'brutto' && id.includes('cena_jednostkowa_brutto')) {
      return { value: 'netto', source: 'template.label' };
    }
  }
  if (page === 10 && PAGE10_HEADER_LABELS.has(staticLabel) && PAGE10_HEADER_IDS.has(id)) {
    return { value: sourceText, source: 'template.label' };
  }
  if (!(page === 10 && PAGE10_HEADER_LIKE_LABELS.has(staticLabel)) && TEMPLATE_LABELS.has(staticLabel)) {
    return { value: sourceText, source: 'template.label' };
  }

  if (page >= 5 && page <= 8 && binding.groupIdHint === 'Group 1259_2') {
    const percent = /^(\d{1,3})%/.exec(rawId.replace(/^_+/, ''));
    if (percent) return { value: `${percent[1]}%`, source: 'template.axisLabels' };
  }
  if (page >= 5 && page <= 8 && binding.groupIdHint === 'Group 1259_3') {
    const tick = /^(\d+)(?:_\d+)?$/.exec(id);
    if (tick) return { value: tick[1], source: 'template.axisLabels' };
  }

  if (page >= 5 && page <= 8 && id === 'xxx_adres') {
    const energyMode = workspace.energy !== undefined;
    const profile = energyMode ? energyProfileForPage(workspace, page) : profileForPage(workspace, page);
    return profile
      ? { value: `(${profile.date})`, source: energyMode ? 'energy.dayProfiles.date' : 'measurements.dayProfiles.date' }
      : null;
  }

  if (id === 'tytu') return { value: workspace.clientName, source: 'project.clientName' };
  if (id.includes('numer_oferty')) return null;
  if (page === 1) {
    if (id.includes('energia_cieplna_tytul')) return occurrence === 0 ? { value: 'Energia cieplna', source: 'template.label' } : null;
    if (id.includes('roczny_rachunek_za_energie_tytul')) return occurrence === 0 ? { value: 'Roczny rachunek za energię', source: 'template.label' } : null;
    if (id.includes('twoj_rachunek_tytul')) return occurrence === 0 ? { value: 'Twój rachunek', source: 'template.label' } : null;
  }
  if (page === 3) {
    if (id.includes('wartosc_energii_oddanej_aktualny_tytul')) return occurrence === 0 ? { value: 'Wartość energii oddanej', source: 'template.label' } : null;
    if (id.includes('wartosc_energii_pobranej_aktualny_tytul')) return occurrence === 0 ? { value: 'Wartość energii pobranej', source: 'template.label' } : null;
    if (id.includes('srednia_cana_oddanej_aktualny_tytul')) return occurrence === 0 ? { value: 'Średnia cena sprzedaży 1 kWh/PLN', source: 'template.label' } : null;
    if (id.includes('srednia_cana_pobranej_aktualny_tytul')) return occurrence === 0 ? { value: 'Średnia cena zakupu 1 kWh/PLN', source: 'template.label' } : null;
    if (id.includes('zuzycie_energii_aktualny_tytul')) return occurrence === 0 ? { value: 'Zużycie energii', source: 'template.label' } : null;
  }
  if (page === 10 && PAGE10_HEADER_IDS.has(id) && PAGE10_HEADER_LIKE_LABELS.has(staticLabel)) {
    return { value: sourceText, source: 'template.label' };
  }
  const details = workspace.input.reportDetails;
  const detailFields: Array<[RegExp, string | null | undefined, string]> = [
    [/mail|email/, details?.email, 'input.reportDetails.email'],
    [/telefon|phone/, details?.phone, 'input.reportDetails.phone'],
    [/rodzaj_terenu|teren/, details?.terrain, 'input.reportDetails.terrain'],
    [/typ_budynku|rodzaj_budynku/, details?.buildingType, 'input.reportDetails.buildingType'],
    [/rodzaj_dachu|typ_dachu/, details?.roofType, 'input.reportDetails.roofType'],
    [/rodzaj_przylacza|typ_przylacza/, details?.connectionType, 'input.reportDetails.connectionType'],
    [/zrodlo_ciepla/, details?.heatingSource, 'input.reportDetails.heatingSource'],
    [/rodzaj_ciepla|szczegoly_ogrzewania/, details?.heatingDetails, 'input.reportDetails.heatingDetails'],
    [/dostawca_energii|supplier/, details?.supplier, 'input.reportDetails.supplier'],
  ];
  const detail = detailFields.find(([pattern]) => pattern.test(id));
  if (detail) return detail[1]?.trim() ? { value: detail[1].trim(), source: detail[2] } : null;
  if (id.includes('moc_przylaczeniowa') || id.includes('connection_power')) {
    const power = details?.connectionPowerKw;
    return power != null && Number.isFinite(power) && power >= 0
      ? { value: `${formatNumber(power, 1)} kW`, source: 'input.reportDetails.connectionPowerKw' }
      : null;
  }
  if (id.includes('adres')) {
    return occurrence === 0 && workspace.input.location?.address
      ? { value: workspace.input.location.address, source: 'input.location.address' }
      : null;
  }
  if (id.includes('instalacja_fotowoltaiczna') && !id.includes('moc_')) {
    return workspace.input.existingPv?.powerKw != null
      ? { value: workspace.input.existingPv.powerKw > 0 ? 'Tak' : 'Nie', source: 'input.existingPv.powerKw' }
      : null;
  }
  if (id.includes('moc_instalacji_fotowoltaicznej')) {
    if (id.endsWith('_kwp')) return { value: 'kWp', source: 'template.unit' };
    const power = draft.existingPv.powerKw ?? workspace.input.existingPv?.powerKw ?? null;
    if (power === null) return null;
    return {
      value: formatNumber(power, 1),
      source: draft.existingPv.powerKw !== null ? 'draft.existingPv.powerKw' : 'input.existingPv.powerKw',
    };
  }
  if (id.includes('miejsce_instalacji')) {
    return null;
  }
  if (id.includes('system_rozliczeniowy')) {
    const target = /(?:_2|nowy|docelowy)/.test(id);
    const label = target
      ? settlementLabel(draft.targetSettlement)
      : settlementLabel(draft.currentSettlement) || settlementLabel(workspace.input.settlementMode);
    return label ? { value: label, source: target ? 'draft.targetSettlement' : 'draft.currentSettlement' } : null;
  }
  if (page === 3 && binding.kind === 'chart-value') {
    const group = groupBindings.find((item) => item.fieldKeys.includes(binding.fieldKey || ''));
    const monthIndex = group?.fieldKeys.indexOf(binding.fieldKey || '') ?? -1;
    if (workspace.energy !== undefined && ['Group 1228', 'Group 1229', 'Group 1230', 'Group 1231', 'Group 1232'].includes(group?.idHint || '')) {
      return { value: '—', source: 'template.monthlyEnergyTable' };
    }
    const month = chronologicalMonths(workspace)[monthIndex];
    if (month && group?.idHint === 'Group 1232' && month.importKwh !== null) {
      return { value: formatNumber(month.importKwh), source: 'measurements.months.importKwh' };
    }
    if (month && group?.idHint === 'Group 1230' && month.exportKwh !== null) {
      return { value: formatNumber(month.exportKwh), source: 'measurements.months.exportKwh' };
    }
  }
  if (page === 3 && workspace.energy !== undefined) {
    const totals = workspace.energy?.totals || { loadKwh: null, pvKwh: null, directKwh: null };
    if (id.includes('zuzycie_energii_aktualny_kwh')) return energyMetric(totals.loadKwh, 'totals.loadKwh');
    if (id.includes('produkcja_pv_aktaulny_kwh')) return energyMetric(totals.pvKwh, 'totals.pvKwh');
    if (id.includes('autokonsumpcja_pv_aktualny_kwh')) {
      const directKwh = validEnergyValue(totals.directKwh);
      const pvKwh = validEnergyValue(totals.pvKwh);
      const amount = directKwh === null ? '—' : formatNumber(directKwh);
      const percent = directKwh !== null && pvKwh !== null && pvKwh > 0
        ? `${formatNumber(directKwh / pvKwh * 100, 1)} %`
        : '— %';
      const source = directKwh === null
        ? 'unknown.energy.totals.directKwh'
        : pvKwh === null || pvKwh === 0
          ? 'energy.totals.directKwh|unknown.energy.totals.pvKwh'
          : 'energy.totals.directKwh|energy.totals.pvKwh';
      return { value: `${amount} kWh / ${percent}`, source };
    }
    if (id.includes('autokonsumpcja_magazyn_aktualny_kwh')) {
      return draft.existingBatteryPresent === false
        ? { value: '0 kWh', source: 'draft.existingBatteryPresent' }
        : { value: '—', source: 'unknown.energy.draft.existingBatteryPresent' };
    }
  }
  if (page === 3) {
    if (id.includes('energia_pobrana_z_sieci') && workspace.measurements.totalsImportKwh !== null) {
      return { value: `${formatNumber(workspace.measurements.totalsImportKwh)} kWh`, source: 'measurements.totalsImportKwh' };
    }
    if (id.includes('energia_oddana_do_sieci') && workspace.measurements.totalsExportKwh !== null) {
      return { value: `${formatNumber(workspace.measurements.totalsExportKwh)} kWh`, source: 'measurements.totalsExportKwh' };
    }
    if (id.includes('okres_aktualny_tytul')) {
      const periods = chronologicalMonths(workspace).filter((month) => month).map((month) => month!.period);
      const value = occurrence === 0 && periods.length ? `${formatPeriod(periods[0])} - ${formatPeriod(periods.at(-1)!)}` : null;
      return value ? { value, source: 'measurements.months.period' } : null;
    }
    const statisticGroup = normalizedId(binding.groupIdHint || '');
    const statisticsId = /miesiac_o_(?:najwiekszym|srednim|najnizszym)_zuzyciu/.test(statisticGroup)
      ? statisticGroup
      : id;
    const isLowest = statisticsId.includes('miesiac_o_najnizszym_zuzyciu')
      || (id.includes('miesiac_o_srednim_zuzyciu') && id.endsWith('_tytul_2'));
    const isAverage = !isLowest && statisticsId.includes('miesiac_o_srednim_zuzyciu');
    const isHighest = statisticsId.includes('miesiac_o_najwiekszym_zuzyciu');
    const isDateField = /_data(?:_\d+)?$/.test(id);
    const isEnergyField = /_kwh(?:_\d+)?$/.test(id);
    if (isHighest) {
      const value = monthStatistics(workspace).maximum;
      if (!value) return null;
      const source = workspace.energy ? 'energy.months.loadKwh' : 'measurements.months.importKwh';
      if (isDateField) return { value: value.period, source: workspace.energy ? 'energy.months.period' : 'measurements.months.period' };
      if (isEnergyField) return { value: `${formatNumber(value.value)} kWh`, source };
      return { value: workspace.energy ? 'Największe zużycie modelowane' : 'Największy pobór z sieci', source };
    }
    if (isAverage) {
      const value = monthStatistics(workspace).average;
      if (!value) return null;
      if (isDateField) return null;
      if (isEnergyField) return { value: `${formatNumber(value.value)} kWh`, source: workspace.energy ? 'energy.months.loadKwh' : 'measurements.months.importKwh' };
      return { value: workspace.energy ? 'Średnie zużycie modelowane' : 'Średni pobór', source: workspace.energy ? 'energy.months.loadKwh' : 'measurements.months.importKwh' };
    }
    if (isLowest) {
      const value = monthStatistics(workspace).minimum;
      if (!value) return null;
      if (isDateField) return { value: value.period, source: workspace.energy ? 'energy.months.period' : 'measurements.months.period' };
      if (isEnergyField) return { value: `${formatNumber(value.value)} kWh`, source: workspace.energy ? 'energy.months.loadKwh' : 'measurements.months.importKwh' };
      return { value: workspace.energy ? 'Najmniejsze zużycie modelowane' : 'Najmniejszy pobór', source: workspace.energy ? 'energy.months.loadKwh' : 'measurements.months.importKwh' };
    }
  }
  if (page === 10) {
    const rowSuffix = PRODUCT_ROW_SUFFIXES.find((suffix) => id.endsWith(`_${suffix}`));
    if (rowSuffix) {
      const row = productRows[PRODUCT_ROW_SUFFIXES.indexOf(rowSuffix)];
      if (!row) return null;
      if (id.startsWith('pozycja_')) return { value: String(PRODUCT_ROW_SUFFIXES.indexOf(rowSuffix) + 1), source: 'template.pricing.position' };
      if (id.startsWith('nazwa_pozycji_')) return occurrence === 0 ? { value: row.description, source: 'template.pricing.description' } : null;
      if (id.startsWith('nazwa_modelu_')) return occurrence === 0 && row.model ? { value: row.model, source: 'template.pricing.productName' } : null;
      if (id.startsWith('ilosc_')) return row.quantity === null
        ? null
        : { value: formatNumber(row.quantity, Number.isInteger(row.quantity) ? 0 : 2), source: 'template.pricing.quantity' };
      if (id.startsWith('cena_jednostkowa_brutto_')) {
        return row.includedInSale && row.unitSaleAmount !== null
          ? { value: formatMoney(row.unitSaleAmount), source: 'template.pricing.unitSaleAmount' }
          : row.includedInSale ? null : { value: '—', source: 'template.pricing.notIncluded' };
      }
      if (binding.fieldKey?.startsWith('p10-wartoa-a-brutto-')) {
        return row.includedInSale && row.lineSaleAmount !== null
          ? { value: formatMoney(row.lineSaleAmount), source: 'template.pricing.lineSaleAmount' }
          : row.includedInSale ? null : { value: '—', source: 'template.pricing.notIncluded' };
      }
    }
    if (id.startsWith('kwota_koszt_systemu')) {
      return pricing.systemCostBeforeFinancing === null
        ? null
        : { value: formatMoney(pricing.systemCostBeforeFinancing), source: 'template.pricing.systemCostBeforeFinancing' };
    }
    if (id.startsWith('kwota_dotacja')) return { value: '—', source: 'unknown.financing.grant' };
    if (id.startsWith('kwota_ulga')) return { value: '—', source: 'unknown.financing.relief' };
    if (id.startsWith('kwota_po_dofinansowaniach')) return { value: '—', source: 'unknown.financing.after' };
  }
  return null;
}

function nearestTextElement(node: XmlNode) {
  for (let current: XmlNode | null = node.parentNode; current && current.nodeType === 1; current = current.parentNode) {
    if ((current as XmlElement).localName === 'text' || (current as XmlElement).tagName === 'text') return current as XmlElement;
  }
  return null;
}

function fontSize(element: XmlElement) {
  for (let current: XmlNode | null = element; current && current.nodeType === 1; current = current.parentNode) {
    const candidate = current as XmlElement;
    const attribute = candidate.getAttribute('font-size') || candidate.getAttribute('style')?.match(/font-size\s*:\s*([\d.]+)/i)?.[1];
    const parsed = Number(attribute);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 8;
}

function fontFor(element: XmlElement) {
  const styleChain: string[] = [];
  for (let current: XmlNode | null = element; current && current.nodeType === 1; current = current.parentNode) {
    const candidate = current as XmlElement;
    styleChain.push(`${candidate.getAttribute('font-weight')} ${candidate.getAttribute('font-style')} ${candidate.getAttribute('style')}`);
  }
  const style = styleChain.join(' ').toLowerCase();
  if (/italic/.test(style)) return font('DMSans-Italic.ttf');
  if (/(?:bold|[6-9]00)/.test(style)) return font('DMSans-Bold.ttf');
  return font('DMSans-Regular.ttf');
}

function maxWidthFor(binding: OfferTemplateV3TextBinding) {
  const id = normalizedId(binding.idHints[0] || '');
  if (id.startsWith('tytu')) return 360;
  if (id.includes('numer_oferty')) return 140;
  if (id.includes('nazwa_pozycji_')) return 130;
  if (id.includes('nazwa_modelu_')) return 132;
  if (id.includes('ilosc_')) return 34;
  if (/adres|mail|telefon/.test(id)) return 190;
  if (/nazwa|model|pozycja/.test(id)) return 132;
  if (/ilosc/.test(id)) return 45;
  if (binding.kind === 'financial' || binding.kind === 'measurement' || binding.kind === 'chart-value') return 100;
  return 230;
}

function fitMappedNode(node: XmlNode & { data: string }, binding: OfferTemplateV3TextBinding) {
  const textElement = nearestTextElement(node);
  const span = node.parentNode?.nodeType === 1 ? node.parentNode as XmlElement : null;
  if (!textElement || !span) return false;
  const typeface = fontFor(textElement);
  const width = maxWidthFor(binding);
  const id = normalizedId(binding.idHints[0] || '');
  if (id.includes('nazwa_pozycji_') || id.includes('nazwa_modelu_')) {
    const templateSpans = Array.from(textElement.getElementsByTagName('tspan')) as XmlElement[];
    const firstSpan = templateSpans[0] || span;
    const x = firstSpan.getAttribute('x') || '0';
    const baselines = templateSpans.map((item) => Number(item.getAttribute('y'))).filter(Number.isFinite);
    const centerY = baselines.length
      ? (Math.min(...baselines) + Math.max(...baselines)) / 2
      : Number(firstSpan.getAttribute('y') || 0);
    const minSize = Math.min(fontSize(textElement), 6);
    let size = fontSize(textElement);
    let lines = wrapText(node.data, typeface, size, width);
    while (lines.length > 4 && size > minSize) {
      size = Math.max(minSize, size - 0.25);
      lines = wrapText(node.data, typeface, size, width);
    }
    const truncated = lines.length > 4;
    if (truncated) {
      lines = lines.slice(0, 4);
      let last = Array.from(lines[3]);
      while (last.length && typeface.getAdvanceWidth(`${last.join('')}…`, size) > width) last.pop();
      lines[3] = `${last.join('').trimEnd()}…`;
    }
    const lineHeight = Math.min(8.5, size * 1.1);
    const firstY = centerY - (lines.length - 1) * lineHeight / 2;
    for (const oldSpan of templateSpans.slice(1)) removeElement(oldSpan);
    lines.forEach((line, index) => {
      const lineSpan = index === 0
        ? firstSpan
        : firstSpan.cloneNode(false) as XmlElement;
      if (index > 0) {
        lineSpan.removeAttribute('id');
        textElement.appendChild(lineSpan);
      }
      lineSpan.setAttribute('x', x);
      lineSpan.setAttribute('y', String(firstY + index * lineHeight));
      lineSpan.setAttribute('font-size', String(size));
      setElementText(lineSpan, line);
    });
    return truncated;
  }
  let size = fontSize(textElement);
  const minSize = Math.min(size, 6);
  while (typeface.getAdvanceWidth(node.data, size) > width && size > minSize) {
    size = Math.max(minSize, size - 0.25);
  }
  span.setAttribute('font-size', String(size));
  if (typeface.getAdvanceWidth(node.data, size) <= width) return false;
  const chars = Array.from(node.data);
  while (chars.length > 1 && typeface.getAdvanceWidth(`${chars.join('')}…`, size) > width) chars.pop();
  node.data = `${chars.join('').trimEnd()}…`;
  return true;
}

function wrapText(value: string, typeface: Font, size: number, maxWidth: number) {
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (typeface.getAdvanceWidth(candidate, size) <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

function appendTextBlock(
  document: XmlDocument,
  parent: XmlElement,
  label: string,
  value: string,
  y: number,
  color: string,
) {
  const labelNode = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  labelNode.setAttribute('x', '40');
  labelNode.setAttribute('y', String(y));
  labelNode.setAttribute('font-family', 'DM Sans');
  labelNode.setAttribute('font-size', '8.4');
  labelNode.setAttribute('font-weight', '700');
  labelNode.setAttribute('fill', color);
  labelNode.appendChild(document.createTextNode(`${label}:`));
  parent.appendChild(labelNode);

  const trimmed = value.trim();
  if (!trimmed) return { truncated: false, lines: 0 };
  const bounded = trimmed.slice(0, MAX_DESCRIPTION_CHARS);
  const typeface = font('DMSans-Regular.ttf');
  let lines = wrapText(bounded, typeface, DESCRIPTION_FONT_SIZE, DESCRIPTION_WIDTH);
  let truncated = trimmed.length > bounded.length;
  if (lines.length > DESCRIPTION_MAX_LINES) {
    lines = lines.slice(0, DESCRIPTION_MAX_LINES);
    const last = lines.length - 1;
    let finalLine = lines[last];
    while (finalLine.length > 1 && typeface.getAdvanceWidth(`${finalLine}…`, DESCRIPTION_FONT_SIZE) > DESCRIPTION_WIDTH) {
      finalLine = finalLine.slice(0, -1).trimEnd();
    }
    lines[last] = `${finalLine}…`;
    truncated = true;
  }

  const body = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  body.setAttribute('x', '40');
  body.setAttribute('y', String(y + 12));
  body.setAttribute('font-family', 'DM Sans');
  body.setAttribute('font-size', String(DESCRIPTION_FONT_SIZE));
  body.setAttribute('fill', '#2B3674');
  lines.forEach((line, index) => {
    const span = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    span.setAttribute('x', '40');
    if (index > 0) span.setAttribute('dy', String(DESCRIPTION_LINE_HEIGHT));
    span.appendChild(document.createTextNode(line));
    body.appendChild(span);
  });
  parent.appendChild(body);
  return { truncated, lines: lines.length };
}

function replaceDraftDescription(document: XmlDocument, draft: OfferWorkspaceDraft) {
  const group = elementById(document, '_opis_oferty_opis');
  if (!group) return { beforeTruncated: false, afterTruncated: false };
  Array.from(group.getElementsByTagName('text')).forEach((element) => element.parentNode?.removeChild(element));
  const before = appendTextBlock(document, group, 'PRZED', draft.description.before, 382, '#FC7C00');
  const afterY = before.lines ? Math.min(520, 398 + before.lines * DESCRIPTION_LINE_HEIGHT) : 410;
  const after = appendTextBlock(document, group, 'PO', draft.description.after, afterY, '#009A44');
  return { beforeTruncated: before.truncated, afterTruncated: after.truncated };
}

function replaceV4DraftDescription(document: XmlDocument, draft: OfferWorkspaceDraft) {
  const group = uniqueElementById(document, '#b2c_opis_oferty_strona_02');
  if (!group) return { beforeTruncated: false, afterTruncated: false };
  Array.from(group.getElementsByTagName('text')).forEach((element) => element.parentNode?.removeChild(element));
  let y = 373;
  let beforeTruncated = false;
  let afterTruncated = false;
  if (draft.description.before.trim()) {
    const before = appendTextBlock(document, group, 'PRZED', draft.description.before, y, '#FC7C00');
    beforeTruncated = before.truncated;
    y += 20 + Math.max(1, before.lines) * DESCRIPTION_LINE_HEIGHT;
  }
  if (draft.description.after.trim()) {
    const after = appendTextBlock(document, group, 'PO', draft.description.after, y, '#009A44');
    afterTruncated = after.truncated;
  }
  return { beforeTruncated, afterTruncated };
}

function applyStaticClientFields(document: XmlDocument, workspace: OfferWorkspaceDocumentData) {
  setElementText(elementById(document, '_nazwa_firmy_2'), workspace.clientName);
  setElementText(elementById(document, '_dane_osobowe_tytul'), 'Dane osobowe');
}

function replaceUnavailableUnitPrices(document: XmlDocument) {
  const ids = ['_srednia_cana_oddanej_aktualny_pln', '_srednia_cana_pobranej_aktualny_pln'];
  ids.forEach((id) => setElementText(elementById(document, id), '—'));
  return ids;
}

function clearMarkedMissingValues(
  document: XmlDocument,
  page: OfferTemplateV3PageNumber,
  bindings: OfferTemplateV3TextBinding[],
  productRows: Page10ProductRow[],
) {
  for (const binding of bindings) {
    if (!binding.dynamic) continue;
    const marker = `${MISSING_PREFIX}${binding.fieldKey}__`;
    const node = resolveTextNode(document, binding.selector);
    if (node.data !== marker) continue;
    const id = normalizedId(binding.idHints[0] || '');
    const rowSuffix = page === 10 ? PRODUCT_ROW_SUFFIXES.find((suffix) => id.endsWith(`_${suffix}`)) : undefined;
    const rowIndex = rowSuffix ? PRODUCT_ROW_SUFFIXES.indexOf(rowSuffix) : -1;
    const unusedProductRow = page === 10 && rowIndex >= productRows.length;
    const missingNumericValue = !unusedProductRow && (
      binding.kind === 'financial'
      || binding.kind === 'chart-value'
      || (binding.kind === 'measurement' && /(?:kwh|kwp|_kw(?:_|$)|pln|wartosc|kwota|cena|moc_|energia_|zuzycie)/.test(id))
      || (page === 10 && binding.kind === 'product'
        && (id.includes('cena_jednostkowa') || (id.includes('warto') && id.includes('brutto'))))
    );
    node.data = missingNumericValue ? '—' : '';
  }
}

function clearNumericPlaceholders(document: XmlDocument) {
  const placeholder = /^\s*X,(?:XX|XXXX)(?:\s*PLN(?:\/kWh)?)?\s*$/;
  for (const element of allElements(document)) {
    for (const node of Array.from(element.childNodes || [])) {
      if ((node.nodeType === 3 || node.nodeType === 4)
        && placeholder.test((node as XmlNode & { data: string }).data)) {
        (node as XmlNode & { data: string }).data = '—';
      }
    }
  }
}

function addMissing(
  groups: Map<string, OfferWorkspaceDocumentMissingData>,
  page: OfferTemplateV3PageNumber,
  binding: OfferTemplateV3TextBinding,
  reason: string,
) {
  const idHint = binding.idHints[0] || binding.kind || 'text';
  const key = `${page}|${idHint}|${reason}`;
  const item = groups.get(key) || { page, fieldKeys: [], idHint, reason };
  if (binding.fieldKey && !item.fieldKeys.includes(binding.fieldKey)) item.fieldKeys.push(binding.fieldKey);
  groups.set(key, item);
}

function addChartMissing(
  groups: Map<string, OfferWorkspaceDocumentMissingData>,
  page: OfferTemplateV3PageNumber,
  fieldKey: string,
  idHints: string[],
  reason: string,
) {
  addMissing(groups, page, {
    selector: '', dynamic: true, fieldKey, kind: 'chart-value', idHints,
    groupSelector: '', sourceTextLength: 0, sourceTextSha256: '',
  }, reason);
}

function appendDraftStatusFooter(
  document: XmlDocument,
  page: OfferTemplateV3PageNumber,
  energy: OfferWorkspaceEnergy | null | undefined,
  sourceFields: Set<string>,
  calculationReady = false,
) {
  const root = document.documentElement;
  if (!root) return;
  if (page === 3 && energy?.modelledMeasurements) {
    sourceFields.add('energy.modelledMeasurements.provenance');
    const note = svgShape(document, 'text', {
      x: '30', y: '814', fill: '#2B3674', 'font-family': 'DM Sans', 'font-size': '5.5',
      'data-draft-status': 'annual-consumption-model',
    });
    note.appendChild(document.createTextNode(`${energy.modelledMeasurements.provenance.source}. Zużycie, pobór i oddanie są szacunkami, nie pomiarami.`));
    root.appendChild(note);
  }
  if (page === 3 && energy && energy.modelBelowExportKwh > 0) {
    sourceFields.add('energy.modelBelowExportKwh');
    const modelNote = svgShape(document, 'text', {
      x: '30', y: '814', fill: '#2B3674', 'font-family': 'DM Sans', 'font-size': '5.5', 'font-weight': '400',
      'data-draft-status': 'energy-model',
    });
    modelNote.appendChild(document.createTextNode(
      `PV i autokonsumpcja: model ${energy.model}; rozbieżność modelu z eksportem: ${formatNumber(energy.modelBelowExportKwh)} kWh`,
    ));
    root.appendChild(modelNote);
  }
  const status = svgShape(document, 'text', {
    x: '30', y: '823', fill: '#2B3674', 'font-family': 'DM Sans', 'font-size': '5.5', 'font-weight': '400',
    'data-draft-status': calculationReady ? 'estimated' : 'incomplete',
  });
  const notApplicableLegend = page >= 5 && page <= 9 ? ' · n/d = nie dotyczy' : '';
  status.appendChild(document.createTextNode(calculationReady
    ? `SZKIC ROBOCZY · wyniki obliczeń mają charakter szacunkowy${notApplicableLegend}`
    : `SZKIC ROBOCZY · obliczenia finansowe i prognoza systemu niekompletne${notApplicableLegend}`));
  root.appendChild(status);
}

const V4_MONTH_SLUGS = [
  'styczen', 'luty', 'marzec', 'kwiecien', 'maj', 'czerwiec',
  'lipiec', 'sierpien', 'wrzesien', 'pazdziernik', 'listopad', 'grudzien',
] as const;

function setV4MonthlyValueFont(document: XmlDocument, fields: Array<{ id: string }>) {
  for (const field of fields) {
    const semantic = v4Semantic(field.id);
    if (!V4_MONTH_SLUGS.some((month) => semantic.endsWith(`_${month}`)
      || semantic.endsWith(`_${month}_prognozowane`) || semantic.endsWith(`_${month}_prognozowana`))) continue;
    uniqueElementById(document, field.id)?.setAttribute('font-family', 'DM Sans');
  }
}

function v4AnnualMonthlyCell(page: OfferTemplateV4PageNumber, fieldId: string) {
  const semantic = v4Semantic(fieldId);
  const monthPattern = page === 3
    ? /_(styczen|luty|marzec|kwiecien|maj|czerwiec|lipiec|sierpien|wrzesien|pazdziernik|listopad|grudzien)$/
    : /_(styczen|luty|marzec|kwiecien|maj|czerwiec|lipiec|sierpien|wrzesien|pazdziernik|listopad|grudzien)_(?:prognozowane|prognozowana)$/;
  const match = monthPattern.exec(semantic);
  if (!match) return null;
  const stem = semantic.slice(0, match.index);
  const tone: MonthlyCellTone | null = stem.includes('calkowite_uzycie_energii') ? 'consumption'
    : stem.includes('produkcja_z_pv') ? 'pv'
      : stem.includes('autokonsumpcja_z_pv') ? 'direct'
        : stem.includes('energia_oddana_do_sieci') ? 'export'
          : stem.includes('energia_pobrana_z_sieci') ? 'import'
            : stem.includes('autokonsumpcja_z_magazynu') ? 'storage'
              : null;
  return tone ? { stem, monthSlug: match[1], tone } : null;
}

function previousElementSibling(element: XmlElement) {
  let sibling = element.previousSibling;
  while (sibling && sibling.nodeType !== 1) sibling = sibling.previousSibling;
  return sibling as XmlElement | null;
}

function setV4AnnualMonthlyCellShading(
  document: XmlDocument,
  page: OfferTemplateV4PageNumber,
  fields: Array<{ id: string }>,
  monthlyValues: Map<string, number | null>,
) {
  const annualSummary = uniqueElementById(document, 'sekcja / podsumowanie_roczne');
  if (!annualSummary) return;

  const rows = new Map<string, { tone: MonthlyCellTone; values: Array<number | null> }>();
  const cells: Array<{ id: string; stem: string; monthSlug: string; tone: MonthlyCellTone }> = [];
  for (const field of fields) {
    const cell = v4AnnualMonthlyCell(page, field.id);
    if (!cell || !elementByIdWithin(annualSummary, field.id)) continue;
    cells.push({ id: field.id, ...cell });
    if (!rows.has(cell.stem)) rows.set(cell.stem, { tone: cell.tone, values: Array(12).fill(null) });
    const monthIndex = V4_MONTH_SLUGS.indexOf(cell.monthSlug as typeof V4_MONTH_SLUGS[number]);
    rows.get(cell.stem)!.values[monthIndex] = monthlyValues.get(field.id) ?? null;
  }

  for (const cell of cells) {
    const row = rows.get(cell.stem)!;
    const text = elementByIdWithin(annualSummary, cell.id);
    const backgroundId = page === 3 && cell.tone === 'storage'
      ? `_autokonsumpcja_magazyn_aktualny_${cell.monthSlug}_kolor`
      : null;
    const background = backgroundId
      ? elementByIdWithin(annualSummary, backgroundId)
      : text ? previousElementSibling(text) : null;
    if (!text || !background || (background.localName || background.tagName).toLowerCase() !== 'path') {
      throw new Error(`Nie znaleziono tła komórki podsumowania rocznego dla ${cell.id}.`);
    }
    const monthIndex = V4_MONTH_SLUGS.indexOf(cell.monthSlug as typeof V4_MONTH_SLUGS[number]);
    background.setAttribute('fill', monthlyCellFill(row.tone, row.values[monthIndex], row.values));
  }
}

function v4Semantic(fieldId: string) {
  return fieldId.replace(/^#/, '').replace(/_strona_\d{2}(?:_\d+)?$/, '');
}

function v4MissingReason(page: OfferTemplateV4PageNumber, semantic: string, calculationReady = false) {
  if (page === 4) return calculationReady
    ? 'Brak odpowiadającej wartości w gotowym wyniku prognozy; danych bieżących nie użyto jako prognozy.'
    : 'Brak wyników przyszłej symulacji; danych bieżących nie użyto jako prognozy.';
  if (page >= 5 && page <= 8 && /_strefa_(?:niska|srednia|wysoka)_(?:pobor_kwh(?:_po)?|cena_kwh)$/.test(semantic)) {
    return calculationReady
      ? 'Brak pełnego dopasowania profilu z interwałami i etykietami stref w wyniku taryfowym; nie użyto nazw ani wartości przykładowych.'
      : 'Brak gotowych interwałów prognozy taryfowej z etykietami stref; nie użyto nazw ani wartości przykładowych.';
  }
  if (page >= 5 && page <= 8 && (/(?:^|_)po(?:_|$)/.test(semantic) || /taryfa_prognozowana|moc_pv_prognozowana|pojemnosc_magazynu_prognozowana|oszczednosc|bilans_wartosci_po/.test(semantic))) {
    return calculationReady
      ? 'Brak odpowiadającej wartości w gotowym wyniku wariantu docelowego; przykładowych wartości nie użyto.'
      : 'Brak obliczeń wariantu docelowego; przykładowej taryfy, magazynu ani wartości finansowych nie użyto.';
  }
  if (page === 9) return calculationReady
    ? 'Brak odpowiadającej wartości szczegółowej w gotowym wyniku rozliczenia; przykładową wartość usunięto.'
    : 'Brak zatwierdzonego wyniku rozliczenia lub symulacji taryfowej; przykładową wartość usunięto.';
  if (page === 10 && /dotac|ulga|po_dofinansowaniach/.test(semantic)) {
    return 'Dotacja, ulga i koszt po finansowaniu pozostają nieznane; nie przyjęto założeń.';
  }
  if (page === 10 && /kosztorys_(?:cena|wartosc|model|pozycja|ilosc)/.test(semantic)) {
    return 'Brak pozycji wybranego katalogu lub wymaganej ceny; wartość przykładową usunięto.';
  }
  return 'Brak odpowiadającej wartości w danych projektu lub szkicu; usunięto przykład z szablonu.';
}

function addV4Missing(
  missing: Map<string, OfferWorkspaceDocumentMissingData>,
  page: OfferTemplateV4PageNumber,
  fieldId: string,
  reason: string,
) {
  const key = `${page}|${reason}`;
  const item = missing.get(key) || { page, fieldKeys: [], idHint: fieldId, reason };
  if (!item.fieldKeys.includes(fieldId)) item.fieldKeys.push(fieldId);
  missing.set(key, item);
}

function latestMonthByNumber<T extends { period: string }>(months: T[], number: number) {
  const matches = months.filter((month) => Number(month.period.slice(5, 7)) === number);
  if (matches.length !== 1) return undefined;
  return matches[0];
}

type V4FlowMeasure = 'loadKwh' | 'pvKwh' | 'directKwh' | 'importKwh' | 'exportKwh'
  | 'batteryToLoadKwh' | 'gridToBatteryKwh' | 'pvToBatteryKwh' | 'batteryToGridKwh' | 'socKwh';

const warsawFlowFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

function localPartsAt(utc: string) {
  const millis = Date.parse(utc);
  if (!Number.isFinite(millis)) return null;
  const parts = Object.fromEntries(warsawFlowFormatter.formatToParts(new Date(millis))
    .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    period: `${parts.year}-${parts.month}`,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

function localFlowParts(flow: OfferForecastFlow) {
  return localPartsAt(flow.startUtc);
}

function sumFlowMeasure(rows: OfferForecastFlow[], measure: V4FlowMeasure) {
  if (!rows.length || rows.some((row) => !Number.isFinite(row[measure]) || row[measure] < 0)) return null;
  return rows.reduce((sum, row) => sum + row[measure], 0);
}

function flowRowsByLocalDate(calculation: OfferWorkspaceCalculation | null | undefined, date: string) {
  return (calculation?.forecastFlows || [])
    .filter((flow) => localFlowParts(flow)?.date === date)
    .sort((left, right) => left.startUtc.localeCompare(right.startUtc));
}

function flowMonthRows(calculation: OfferWorkspaceCalculation | null | undefined) {
  const groups = new Map<string, OfferForecastFlow[]>();
  for (const flow of calculation?.forecastFlows || []) {
    const period = localFlowParts(flow)?.period;
    if (!period) continue;
    const rows = groups.get(period) || [];
    rows.push(flow);
    groups.set(period, rows);
  }
  return Array.from(groups, ([period, rows]) => ({ period, rows })).sort((a, b) => a.period.localeCompare(b.period)).slice(-12);
}

function calculationEnergyTotal(calculation: OfferWorkspaceCalculation | null | undefined, measure: 'loadKwh' | 'pvKwh' | 'directKwh') {
  const direct = calculation?.forecastEnergy?.totals[measure];
  if (validEnergyValue(direct ?? null) !== null) return { value: direct!, source: `calculation.forecastEnergy.totals.${measure}` };
  const value = sumFlowMeasure(calculation?.forecastFlows || [], measure);
  return value === null ? null : { value, source: 'calculation.forecastFlows' };
}

function calculationMeterTotal(calculation: OfferWorkspaceCalculation | null | undefined, measure: 'importKwh' | 'exportKwh') {
  const direct = measure === 'importKwh'
    ? calculation?.forecastMeasurements?.totalsImportKwh
    : calculation?.forecastMeasurements?.totalsExportKwh;
  if (validEnergyValue(direct ?? null) !== null) return { value: direct!, source: `calculation.forecastMeasurements.totals${measure === 'importKwh' ? 'Import' : 'Export'}Kwh` };
  const value = sumFlowMeasure(calculation?.forecastFlows || [], measure);
  return value === null ? null : { value, source: 'calculation.forecastFlows' };
}

function calculationMonthMeasure(
  calculation: OfferWorkspaceCalculation | null | undefined,
  monthNumber: number,
  measure: V4FlowMeasure,
) {
  const energyMonth = calculation?.forecastEnergy
    ? latestMonthByNumber(calculation.forecastEnergy.months, monthNumber)
    : undefined;
  if (energyMonth && ['loadKwh', 'pvKwh', 'directKwh'].includes(measure)) {
    const value = energyMonth[measure as 'loadKwh' | 'pvKwh' | 'directKwh'];
    if (validEnergyValue(value) !== null) return { value: value!, source: `calculation.forecastEnergy.months.${measure}` };
  }
  const meterMonth = calculation?.forecastMeasurements
    ? latestMonthByNumber(calculation.forecastMeasurements.months, monthNumber)
    : undefined;
  if (meterMonth && (measure === 'importKwh' || measure === 'exportKwh')) {
    const value = meterMonth[measure];
    if (validEnergyValue(value) !== null) return { value: value!, source: `calculation.forecastMeasurements.months.${measure}` };
  }
  const flowMonth = latestMonthByNumber(flowMonthRows(calculation), monthNumber);
  if (!flowMonth) return null;
  const value = sumFlowMeasure(flowMonth.rows, measure);
  return value === null ? null : { value, source: 'calculation.forecastFlows' };
}

function billingTotals(calculation: OfferWorkspaceCalculation | null | undefined, scenario: 'baselineBill' | 'proposedBill') {
  return calculation?.[scenario]?.totals || null;
}

function completeComponentAmounts(
  components: Array<{ category: string; amountPln: number }> | undefined,
  expectedTotal: number | undefined,
) {
  if (!Array.isArray(components) || typeof expectedTotal !== 'number' || !Number.isFinite(expectedTotal)
    || components.some((component) => !component.category || !Number.isFinite(component.amountPln))) return null;
  const actualTotal = components.reduce((sum, component) => sum + component.amountPln, 0);
  if (Math.abs(actualTotal - expectedTotal) > Math.max(1e-6, Math.abs(expectedTotal) * 1e-9)) return null;
  const amounts = new Map<string, number>();
  for (const component of components) amounts.set(component.category, (amounts.get(component.category) || 0) + component.amountPln);
  return amounts;
}

function billingComponentRate(
  calculation: OfferWorkspaceCalculation | undefined,
  scenario: 'baselineBill' | 'proposedBill',
  kind: 'distribution' | 'fixed',
  category: string,
): MappedValue {
  const bill = calculation?.[scenario];
  const totals = bill?.totals;
  const components = kind === 'distribution'
    ? completeComponentAmounts(totals?.distributionComponents, totals?.distributionCostPln)
    : completeComponentAmounts(totals?.fixedComponents, totals?.fixedCostPln);
  if (!bill || !totals || !components) return null;
  const amount = components.get(category) || 0;
  if (kind === 'distribution') {
    if (!(totals.billedImportKwh > 0) || !Number.isFinite(totals.billedImportKwh)) return null;
    return { value: formatNumber(amount / totals.billedImportKwh, 4),
      source: `calculation.${scenario}.totals.${kind}Components[${category}].amountPln/totals.billedImportKwh` };
  }
  if (!bill.months.length) return null;
  return { value: formatNumber(amount / bill.months.length, 2),
    source: `calculation.${scenario}.totals.${kind}Components[${category}].amountPln/months.length` };
}

function billingAmountAfterDepositRefund(calculation: OfferWorkspaceCalculation | undefined): MappedValue {
  const totals = calculation?.proposedBill?.totals;
  if (!totals || !Number.isFinite(totals.cashDuePln) || !Number.isFinite(totals.depositRefundedPln)) return null;
  return calculationMoney(totals.cashDuePln - totals.depositRefundedPln,
    'calculation.proposedBill.totals.cashDuePln-depositRefundedPln');
}

function compactNotApplicableField(document: XmlDocument, fieldId: string, replacement = 'n/d') {
  const element = uniqueElementById(document, fieldId);
  if (!element) return;
  const parent = element.parentNode as XmlElement | null;
  const unit = parent ? Array.from(parent.childNodes)
    .filter((node) => node.nodeType === 1 && node !== element)
    .map((node) => node as XmlElement)
    .find((sibling) => sibling.getAttribute('id')?.startsWith('stale / jednostka')) : null;
  const unitText = unit ? visibleUnitTextElement(unit) : null;
  const unitX = unitText ? textOrigin(unitText, 'x') : null;
  const spans = Array.from(element.getElementsByTagName('tspan')) as XmlElement[];
  if (unitX !== null && spans.length) {
    const elementX = textOrigin(element, 'x');
    const firstSpanX = Number(spans[0].getAttribute('x') || 0);
    const offset = elementX - firstSpanX;
    spans.forEach((span) => {
      span.setAttribute('x', String(unitX - 2 - offset));
      span.setAttribute('text-anchor', 'end');
      span.setAttribute('font-variant-numeric', 'tabular-nums');
    });
    element.setAttribute('font-family', 'DM Sans');
    element.setAttribute('font-variant-numeric', 'tabular-nums');
  }
  setElementText(element, replacement);
  if (!parent) return;
  const siblings = Array.from(parent.childNodes || []).filter((node) => node.nodeType === 1) as XmlElement[];
  for (const sibling of siblings) {
    if (sibling.getAttribute('id')?.startsWith('stale / jednostka')) setElementText(sibling, '');
  }
}

function dailyBillingMeasure(
  calculation: OfferWorkspaceCalculation | null | undefined,
  scenario: 'baselineBill' | 'proposedBill',
  flows: OfferForecastFlow[],
  measure: 'energyCostPln' | 'distributionCostPln' | 'fixedCostPln' | 'exportValuePln' | 'cashDuePln',
) {
  const rows = calculation?.[scenario]?.intervals || [];
  if (!flows.length || !rows.length) return null;
  const byUtc = new Map(rows.map((row) => [`${row.startUtc}\u0000${row.endUtc}`, row]));
  let total = 0;
  for (const flow of flows) {
    const row = byUtc.get(`${flow.startUtc}\u0000${flow.endUtc}`);
    if (!row || !Number.isFinite(row[measure])) return null;
    total += row[measure];
  }
  return total;
}

type DailyBillRow = NonNullable<OfferWorkspaceCalculation['baselineBill']>['intervals'][number];
type DailyMeterPoint = { hour: number; importKwh: number | null; exportKwh: number | null };
type MatchedDailyBillRow = { bill: DailyBillRow; meter: DailyMeterPoint };
type DailyTariffZoneSummary = { zone: string; label: string; loadKwh: number; importKwh: number; grossRatePlnPerKwh: number };

function tariffZoneDisplayLabel(zone: string) {
  const labels: Record<string, string> = {
    all: 'Jedna strefa', low: 'Niska cena', mid: 'Średnia cena', high: 'Wysoka cena',
    night: 'Strefa nocna', day: 'Strefa dzienna', offpeak: 'Poza szczytem', peak: 'W szczycie',
  };
  return labels[zone.toLowerCase()] || `Strefa: ${zone}`;
}

function tariffZoneSortOrder(zone: string) {
  const order: Record<string, number> = { all: 0, low: 0, night: 0, offpeak: 0, mid: 1, day: 1, peak: 1, high: 2 };
  return order[zone.toLowerCase()] ?? 3;
}

function dailyTargetTariffZones(
  workspace: OfferWorkspaceDocumentData,
  calculation: OfferWorkspaceCalculation | null | undefined,
  page: OfferTemplateV4PageNumber,
): DailyTariffZoneSummary[] | null {
  const profile = dailyProfileForV4(workspace, page);
  const date = profile?.date;
  if (!profile || !date || !('measuredProfile' in profile)) return null;
  const loadByHour = new Map<number, number>();
  for (const hour of profile.hours) {
    if (!Number.isFinite(hour.loadKwh) || hour.loadKwh < 0 || loadByHour.has(hour.hour)) return null;
    loadByHour.set(hour.hour, hour.loadKwh);
  }
  if (loadByHour.size !== 24) return null;

  const flows = flowRowsByLocalDate(calculation, date);
  const billRows = dailyBillingRowsForForecastFlows(calculation, 'proposedBill', flows);
  const intervalTariffs = calculation?.proposedBill?.intervalTariffs || [];
  if (!billRows || intervalTariffs.length === 0) return null;
  const flowByUtc = new Map(flows.map((flow) => [`${flow.startUtc}\u0000${flow.endUtc}`, flow]));
  const groups = new Map<string, { loadKwh: number; importKwh: number; weightedGrossRate: number; durationMs: number }>();

  for (const { bill, meter } of billRows) {
    const flow = flowByUtc.get(`${bill.startUtc}\u0000${bill.endUtc}`);
    const start = Date.parse(bill.startUtc);
    const end = Date.parse(bill.endUtc);
    if (!flow || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const tariffMatches = intervalTariffs.filter((row) => {
      const tariffStart = Date.parse(row.startUtc);
      const tariffEnd = Date.parse(row.endUtc);
      return Number.isFinite(tariffStart) && Number.isFinite(tariffEnd)
        && tariffStart <= start && tariffEnd >= end;
    });
    if (tariffMatches.length !== 1) return null;
    const tariff = tariffMatches[0];
    const zone = tariff.energyZone.trim();
    const rate = tariff.energyRatePlnPerKwh + tariff.distributionRatePlnPerKwh;
    const durationMs = end - start;
    const loadKwh = loadByHour.get(meter.hour);
    if (!zone || !Number.isFinite(rate) || rate < 0 || loadKwh === undefined
      || !Number.isFinite(flow.loadKwh) || flow.loadKwh < 0 || !matchingKwh(meter.importKwh ?? 0, bill.importKwh)) return null;
    const current = groups.get(zone) || { loadKwh: 0, importKwh: 0, weightedGrossRate: 0, durationMs: 0 };
    current.loadKwh += loadKwh;
    current.importKwh += flow.importKwh;
    current.weightedGrossRate += rate * durationMs;
    current.durationMs += durationMs;
    groups.set(zone, current);
  }
  if (!groups.size || groups.size > 3) return null;
  return Array.from(groups, ([zone, value]) => ({
    zone,
    label: tariffZoneDisplayLabel(zone),
    loadKwh: value.loadKwh,
    importKwh: value.importKwh,
    grossRatePlnPerKwh: value.durationMs > 0 ? value.weightedGrossRate / value.durationMs : NaN,
  })).sort((left, right) => tariffZoneSortOrder(left.zone) - tariffZoneSortOrder(right.zone)
    || left.zone.localeCompare(right.zone));
}

function setV4DailyTariffZoneLabels(document: XmlDocument, zones: DailyTariffZoneSummary[] | null) {
  const labelIds = [
    '_energia_oddana_do_sieci_aktualny_kwh_15',
    '_energia_oddana_do_sieci_aktualny_kwh_16',
    '_energia_oddana_do_sieci_aktualny_kwh_17',
  ];
  labelIds.forEach((id, index) => {
    const label = uniqueElementById(document, id);
    const span = label?.getElementsByTagName('tspan')[0] as XmlElement | undefined;
    if (span) setElementText(span, zones?.[index]?.label || '');
  });
}

function matchingKwh(actual: number, expected: number | null) {
  return expected !== null && Number.isFinite(actual) && Number.isFinite(expected)
    && Math.abs(actual - expected) <= 1e-9;
}

function dailyBillingRowsForMeterProfile(
  calculation: OfferWorkspaceCalculation | null | undefined,
  scenario: 'baselineBill' | 'proposedBill',
  date: string,
  points: DailyMeterPoint[],
): MatchedDailyBillRow[] | null {
  const intervals = calculation?.[scenario]?.intervals || [];
  if (points.length !== 24 || new Set(points.map((point) => point.hour)).size !== 24) return null;
  const byHour = new Map<number, DailyBillRow[]>();
  for (const row of intervals) {
    const local = localPartsAt(row.startUtc);
    if (local?.date !== date) continue;
    const rows = byHour.get(local.hour) || [];
    rows.push(row);
    byHour.set(local.hour, rows);
  }
  if (byHour.size !== 24 || Array.from(byHour.values()).some((rows) => rows.length !== 1)) return null;
  const byPointHour = new Map(points.map((point) => [point.hour, point]));
  const matched: MatchedDailyBillRow[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const bill = byHour.get(hour)?.[0];
    const meter = byPointHour.get(hour);
    if (!bill || !meter) return null;
    matched.push({ bill, meter });
  }
  return matched;
}

function dailyBillingRowsForForecastFlows(
  calculation: OfferWorkspaceCalculation | null | undefined,
  scenario: 'baselineBill' | 'proposedBill',
  flows: OfferForecastFlow[],
): MatchedDailyBillRow[] | null {
  const intervals = calculation?.[scenario]?.intervals || [];
  if (flows.length !== 24) return null;
  const points = flows.map((flow) => ({
    flow,
    local: localFlowParts(flow),
  }));
  const dates = new Set(points.map((point) => point.local?.date).filter((date): date is string => Boolean(date)));
  const hours = points.map((point) => point.local?.hour);
  if (dates.size !== 1 || points.some((point) => !point.local) || new Set(hours).size !== 24) return null;
  const byUtc = new Map(intervals.map((row) => [`${row.startUtc}\u0000${row.endUtc}`, row]));
  const matched: MatchedDailyBillRow[] = [];
  for (const { flow, local } of points) {
    if (!local) return null;
    const bill = byUtc.get(`${flow.startUtc}\u0000${flow.endUtc}`);
    if (!bill || !matchingKwh(bill.importKwh, flow.importKwh) || !matchingKwh(bill.exportKwh, flow.exportKwh)) return null;
    matched.push({ bill, meter: { hour: local.hour, importKwh: flow.importKwh, exportKwh: flow.exportKwh } });
  }
  return matched;
}

function dailyMeterProfileBillingRows(
  workspace: OfferWorkspaceDocumentData,
  calculation: OfferWorkspaceCalculation | null | undefined,
  scenario: 'baselineBill' | 'proposedBill',
  page: OfferTemplateV4PageNumber,
) {
  const profile = dailyProfileForV4(workspace, page);
  if (!profile) return null;
  const meterProfile = 'measuredProfile' in profile ? profile.measuredProfile : profile;
  const points = meterProfile.hours.map((hour) => ({
    hour: hour.hour,
    importKwh: hour.importKwh,
    exportKwh: hour.exportKwh,
  }));
  return dailyBillingRowsForMeterProfile(calculation, scenario, profile.date, points);
}

function dailyGrossPurchaseFromMatched(rows: MatchedDailyBillRow[]) {
  if (!rows.length || rows.some(({ bill, meter }) => !matchingKwh(bill.importKwh, meter.importKwh)
    || ![bill.energyCostPln, bill.coveredEnergyPln, bill.distributionCostPln, bill.coveredDistributionPln].every(Number.isFinite))) return null;
  return rows.reduce((total, { bill }) => total + bill.energyCostPln + bill.coveredEnergyPln
    + bill.distributionCostPln + bill.coveredDistributionPln, 0);
}

function dailyAverageGrossPurchasePrice(rows: MatchedDailyBillRow[]) {
  const cost = dailyGrossPurchaseFromMatched(rows);
  const importKwh = completeSum(rows.map(({ meter }) => meter.importKwh));
  return cost === null || importKwh === null || importKwh <= 0 ? null : cost / importKwh;
}

function dailyExportValueFromMatched(rows: MatchedDailyBillRow[]) {
  if (!rows.length || rows.some(({ bill, meter }) => !matchingKwh(bill.exportKwh, meter.exportKwh)
    || !Number.isFinite(bill.exportValuePln))) return null;
  return rows.reduce((total, { bill }) => total + bill.exportValuePln, 0);
}

function dailyAverageExportPrice(rows: MatchedDailyBillRow[]) {
  const exportValue = dailyExportValueFromMatched(rows);
  const exportKwh = completeSum(rows.map(({ meter }) => meter.exportKwh));
  return exportValue === null || exportKwh === null || exportKwh <= 0 ? null : exportValue / exportKwh;
}

function dailyGrossValueBalance(rows: MatchedDailyBillRow[]) {
  const purchase = dailyGrossPurchaseFromMatched(rows);
  const exportValue = dailyExportValueFromMatched(rows);
  return purchase === null || exportValue === null ? null : exportValue - purchase;
}

function dailyGrossPurchaseValue(
  calculation: OfferWorkspaceCalculation | null | undefined,
  scenario: 'baselineBill' | 'proposedBill',
  flows: OfferForecastFlow[],
) {
  const rows = calculation?.[scenario]?.intervals || [];
  if (!flows.length || !rows.length) return null;
  const byUtc = new Map(rows.map((row) => [`${row.startUtc}\u0000${row.endUtc}`, row]));
  let total = 0;
  for (const flow of flows) {
    const row = byUtc.get(`${flow.startUtc}\u0000${flow.endUtc}`);
    if (!row || ![row.energyCostPln, row.coveredEnergyPln, row.distributionCostPln, row.coveredDistributionPln]
      .every(Number.isFinite)) return null;
    total += row.energyCostPln + row.coveredEnergyPln + row.distributionCostPln + row.coveredDistributionPln;
  }
  return total;
}

function calculationMoney(value: number | null | undefined, source: string): MappedValue {
  return typeof value === 'number' && Number.isFinite(value) ? { value: formatNumber(value, 2), source } : null;
}

function calculationRate(value: number | null | undefined, source: string): MappedValue {
  return typeof value === 'number' && Number.isFinite(value) ? { value: formatNumber(value, 3), source } : null;
}

function dailyCashSavings(calculation: OfferWorkspaceCalculation | null | undefined, flows: OfferForecastFlow[]) {
  const baseline = calculation?.baselineBill?.intervals || [];
  const proposed = calculation?.proposedBill?.intervals || [];
  const baselineByUtc = new Map(baseline.map((row) => [`${row.startUtc}\u0000${row.endUtc}`, row]));
  const proposedByUtc = new Map(proposed.map((row) => [`${row.startUtc}\u0000${row.endUtc}`, row]));
  if (!flows.length) return null;
  let savings = 0;
  for (const flow of flows) {
    const key = `${flow.startUtc}\u0000${flow.endUtc}`;
    const before = baselineByUtc.get(key);
    const after = proposedByUtc.get(key);
    if (!before || !after || !Number.isFinite(before.cashDuePln) || !Number.isFinite(after.cashDuePln)) return null;
    savings += before.cashDuePln - after.cashDuePln;
  }
  return calculationMoney(savings, 'calculation.baselineBill/proposedBill.intervals.cashDuePln');
}

function dailyCashSavingsFromMatched(baseline: MatchedDailyBillRow[], proposed: MatchedDailyBillRow[]) {
  if (baseline.length !== 24 || proposed.length !== 24
    || baseline.some(({ bill }) => !Number.isFinite(bill.cashDuePln))
    || proposed.some(({ bill }) => !Number.isFinite(bill.cashDuePln))) return null;
  const savings = baseline.reduce((total, row, index) => total + row.bill.cashDuePln - proposed[index].bill.cashDuePln, 0);
  return calculationMoney(savings, 'calculation.baselineBill/proposedBill.intervals.cashDuePln');
}

function completeSum(values: Array<number | null | undefined>) {
  if (!values.length || !values.every(validChartValue)) return null;
  return values.reduce<number>((sum, value) => sum + value, 0);
}

function monthFieldNumericValue(
  semantic: string,
  workspace: OfferWorkspaceDocumentData,
  draft: OfferWorkspaceDraft,
): { value: number; source: string } | null {
  const monthSlug = V4_MONTH_SLUGS.find((slug) => semantic.endsWith(`_${slug}`));
  if (!monthSlug) return null;
  const monthNumber = V4_MONTH_SLUGS.indexOf(monthSlug) + 1;
  const monthLabel = semantic.replace(new RegExp(`_${monthSlug}$`), '');
  const isStorage = monthLabel.includes('autokonsumpcja_z_magazynu');
  if (isStorage) {
    return draft.existingBatteryPresent === false
      ? { value: 0, source: 'draft.existingBatteryPresent' }
      : null;
  }
  const energyMonths = workspace.energy ? chronologicalEnergyMonths(workspace.energy).filter(Boolean) : [];
  const meterMonths = chronologicalMonths(workspace).filter(Boolean);
  if (monthLabel.includes('calkowite_uzycie_energii') || monthLabel.includes('produkcja_z_pv')
    || monthLabel.includes('autokonsumpcja_z_pv')) {
    if (workspace.energy === null) return null;
    const month = latestMonthByNumber(energyMonths as OfferWorkspaceEnergy['months'], monthNumber);
    if (!month) return null;
    const value = monthLabel.includes('calkowite_uzycie_energii') ? month.loadKwh
      : monthLabel.includes('produkcja_z_pv') ? month.pvKwh : month.directKwh;
    return validEnergyValue(value) === null ? null : {
      value: value!,
      source: `energy.months.${monthLabel.includes('calkowite_uzycie_energii') ? 'loadKwh' : monthLabel.includes('produkcja_z_pv') ? 'pvKwh' : 'directKwh'}`,
    };
  }
  const month = latestMonthByNumber(meterMonths as OfferWorkspaceDocumentData['measurements']['months'], monthNumber);
  if (!month) return null;
  if (monthLabel.includes('energia_pobrana_z_sieci')) {
    return validEnergyValue(month.importKwh) === null ? null : { value: month.importKwh!, source: 'measurements.months.importKwh' };
  }
  if (monthLabel.includes('energia_oddana_do_sieci')) {
    return validEnergyValue(month.exportKwh) === null ? null : { value: month.exportKwh!, source: 'measurements.months.exportKwh' };
  }
  return null;
}

function monthFieldValue(
  semantic: string,
  workspace: OfferWorkspaceDocumentData,
  draft: OfferWorkspaceDraft,
): MappedValue {
  const data = monthFieldNumericValue(semantic, workspace, draft);
  return data ? { value: formatNumber(data.value), source: data.source, numericValue: data.value } : null;
}

function forecastMonthFieldNumericValue(
  semantic: string,
  calculation: OfferWorkspaceCalculation | null | undefined,
): { value: number; source: string } | null {
  const suffixMatch = /_(styczen|luty|marzec|kwiecien|maj|czerwiec|lipiec|sierpien|wrzesien|pazdziernik|listopad|grudzien)_(?:prognozowane|prognozowana)$/.exec(semantic);
  if (!suffixMatch) return null;
  const monthNumber = V4_MONTH_SLUGS.indexOf(suffixMatch[1] as typeof V4_MONTH_SLUGS[number]) + 1;
  const stem = semantic.slice(0, suffixMatch.index);
  const measure: V4FlowMeasure | null = stem.includes('calkowite_uzycie_energii') ? 'loadKwh'
    : stem.includes('produkcja_z_pv') ? 'pvKwh'
      : stem.includes('autokonsumpcja_z_pv') ? 'directKwh'
        : stem.includes('energia_pobrana_z_sieci') ? 'importKwh'
          : stem.includes('energia_oddana_do_sieci') ? 'exportKwh'
            : stem.includes('autokonsumpcja_z_magazynu') ? 'batteryToLoadKwh'
              : null;
  if (!measure) return null;
  return calculationMonthMeasure(calculation, monthNumber, measure);
}

function forecastMonthFieldValue(semantic: string, calculation: OfferWorkspaceCalculation | null | undefined): MappedValue {
  const data = forecastMonthFieldNumericValue(semantic, calculation);
  return data ? { value: formatNumber(data.value), source: data.source, numericValue: data.value } : null;
}

function dailyProfileForV4(workspace: OfferWorkspaceDocumentData, page: OfferTemplateV4PageNumber) {
  if (workspace.energy !== undefined) return workspace.energy ? energyProfileForPage(workspace, page) : null;
  return profileForPage(workspace, page);
}

function mapV4Field(
  page: OfferTemplateV4PageNumber,
  fieldId: string,
  sourceText: string,
  workspace: OfferWorkspaceDocumentData,
  draft: OfferWorkspaceDraft,
  productRows: Page10ProductRow[],
  pricing: OfferWorkspacePricingResult,
  calculation: OfferWorkspaceCalculation | null | undefined,
  tariffLabels: OfferWorkspaceDocumentOptions['tariffLabels'],
  baselineSummary: OfferWorkspaceSavingsBillSummary | null,
  proposedSummary: OfferWorkspaceSavingsBillSummary | null,
  storageIllustration: OfferStorageIllustration | null,
): MappedValue {
  const semantic = v4Semantic(fieldId);
  if (semantic === 'b2c_nr_reform') return { value: 'Szkic oferty', source: 'workspace.documentStatus' };
  const details = workspace.input.reportDetails;
  const pvPower = draft.existingPv.powerKw ?? workspace.input.existingPv?.powerKw ?? null;
  const settlement = (value: string | null) => settlementLabel(value);
  const reportFields: Record<string, [string | null | undefined, string]> = {
    b2c_mail: [details?.email, 'input.reportDetails.email'],
    b2c_telefon: [details?.phone, 'input.reportDetails.phone'],
    b2c_rodzaj_terenu: [details?.terrain, 'input.reportDetails.terrain'],
    b2c_typ_budynku: [details?.buildingType, 'input.reportDetails.buildingType'],
    b2c_rodzaj_dachu: [details?.roofType, 'input.reportDetails.roofType'],
    b2c_rodzaj_przylacza: [details?.connectionType, 'input.reportDetails.connectionType'],
    b2c_zrodlo_ciepla: [details?.heatingSource, 'input.reportDetails.heatingSource'],
    b2c_rodzaj_zrodla_ciepla: [details?.heatingDetails, 'input.reportDetails.heatingDetails'],
    b2c_dostawca_energii_elektrycznej: [details?.supplier, 'input.reportDetails.supplier'],
    b2c_operator_systemu_dystrybucyjnego: [tariffLabels?.currentOperator, 'documentContext.tariffLabels.currentOperator'],
    b2c_miejsce_instalacji_fotowoltaicznej: [details?.pvInstallationPlace, 'input.reportDetails.pvInstallationPlace'],
    b2c_posiadane_urzadzenia_o_duzym_poborze_energii: [details?.highLoadDevices, 'input.reportDetails.highLoadDevices'],
    b2c_planowane_urzadzenia_o_duzym_poborze_energii: [details?.plannedHighLoadDevices, 'input.reportDetails.plannedHighLoadDevices'],
  };
  const reportValue = reportFields[semantic];
  if (reportValue) return reportValue[0]?.trim() ? { value: reportValue[0].trim(), source: reportValue[1] } : null;

  if (page === 10 && semantic === 'b2c_imie_i_nazwisko_reform') {
    return { value: workspace.clientName, source: 'project.clientName' };
  }

  if (page === 1 || page === 2) {
    if (semantic === 'b2c_nr_reform') return { value: 'Szkic oferty', source: 'workspace.documentStatus' };
    if (semantic === 'b2c_opis_oferty') return { value: '', source: 'template.descriptionPanel' };
    if (semantic === 'b2c_nazwa_klienta_report' || semantic === 'b2c_imie_i_nazwisko_report') {
      return { value: workspace.clientName, source: 'project.clientName' };
    }
    if (semantic === 'b2c_nazwa_klienta_report' && page === 2) return { value: workspace.clientName, source: 'project.clientName' };
    if (semantic === 'b2c_instalacja_fotowoltaiczna' && sourceText.trim() === 'Instalacja') {
      return { value: sourceText, source: 'template.label' };
    }
    if (semantic === 'b2c_adres_report' || semantic === 'b2c_miejsce_instalacji') {
      return workspace.input.location?.address?.trim()
        ? { value: workspace.input.location.address.trim(), source: 'input.location.address' }
        : null;
    }
    if (semantic === 'b2c_moc_przylaczeniowa') {
      return details?.connectionPowerKw != null && Number.isFinite(details.connectionPowerKw)
        ? { value: formatNumber(details.connectionPowerKw, 1), source: 'input.reportDetails.connectionPowerKw' } : null;
    }
    if (semantic === 'b2c_moc_instalacji_fotowoltaicznej') {
      return validChartValue(pvPower) ? { value: formatNumber(pvPower, 1), source: draft.existingPv.powerKw !== null ? 'draft.existingPv.powerKw' : 'input.existingPv.powerKw' } : null;
    }
    if (semantic === 'b2c_system_rozliczeniowy') {
      const value = settlement(draft.currentSettlement || workspace.input.settlementMode);
      return value ? { value, source: 'draft.currentSettlement|input.settlementMode' } : null;
    }
    if (semantic === 'b2c_dane_rozliczeniowe_taryfa') {
      const label = tariffLabels?.current?.trim();
      return label ? { value: label, source: 'documentContext.tariffLabels.current' } : null;
    }
    if (semantic === 'b2c_oplaty_stale_i_dystrybucyjne') {
      const totals = baselineSummary?.totals;
      return totals ? calculationMoney(totals.paidDistributionCostPln + totals.paidFixedCostPln,
        'calculation.baselineBill.totals.paidDistributionCostPln+paidFixedCostPln') : null;
    }
    if (semantic === 'b2c_zakup_energii') {
      return calculationMoney(baselineSummary?.totals.paidEnergyCostPln,
        'calculation.baselineBill.totals.paidEnergyCostPln');
    }
    if (semantic === 'b2c_twoj_rachunek') {
      return calculationMoney(calculation?.baselineAnnualCostPln, 'calculation.baselineAnnualCostPln');
    }
    if (semantic === 'b2c_opis_oferty') {
      const before = draft.description.before.trim();
      const after = draft.description.after.trim();
      const value = [before ? `PRZED: ${before}` : '', after ? `PO: ${after}` : ''].filter(Boolean).join('\n');
      return value ? { value, source: 'draft.description.before|draft.description.after' } : null;
    }
    if (/b2c_wymiar_magazynu_\d+/.test(semantic)) {
      return { value: '', source: storageIllustration
        ? 'workspace.templates.selectedStorageProduct'
        : 'draft.selectedTemplateIds.noStorage' };
    }
  }

  if (page === 3) {
    const currentSettlement = draft.currentSettlement ?? (workspace.input.settlementMode === 'NET_METERING'
      || workspace.input.settlementMode === 'NET_BILLING' ? workspace.input.settlementMode : null);
    if (isSummaryFinancialField(semantic)) return summaryFinancialField(semantic, baselineSummary, currentSettlement, 'baselineBill');
    if (semantic === 'b2c_okres') {
      const periods = (workspace.energy !== undefined
        ? workspace.energy ? chronologicalEnergyMonths(workspace.energy) : []
        : chronologicalMonths(workspace)).filter(Boolean).map((month) => month!.period);
      return periods.length ? { value: `${periods[0]} - ${periods.at(-1)}`, source: workspace.energy !== undefined ? 'energy.months.period' : 'measurements.months.period' } : null;
    }
    const totals = workspace.energy?.totals;
    if (semantic === 'b2c_energia_oddana_do_sieci') return energyMetric(workspace.measurements.totalsExportKwh, 'measurements.totalsExportKwh', false);
    if (semantic === 'b2c_energia_pobrana_z_sieci') return energyMetric(workspace.measurements.totalsImportKwh, 'measurements.totalsImportKwh', false);
    if (semantic === 'b2c_zuzycie_energii_rok') return totals ? energyMetric(totals.loadKwh, 'totals.loadKwh', false) : null;
    if (semantic === 'b2c_produkcja_z_pv') return totals ? energyMetric(totals.pvKwh, 'totals.pvKwh', false) : null;
    if (semantic === 'b2c_autokonsumpcja_z_pv') return totals ? energyMetric(totals.directKwh, 'totals.directKwh', false) : null;
    if (semantic === 'b2c_autokonsumpcja_z_pv_procent') {
      const direct = validEnergyValue(totals?.directKwh ?? null);
      const pv = validEnergyValue(totals?.pvKwh ?? null);
      return direct !== null && pv !== null && pv > 0
        ? { value: formatNumber(direct / pv * 100, 1), source: 'energy.totals.directKwh|energy.totals.pvKwh' } : null;
    }
    if (semantic === 'b2c_autokonsumpcja_z_magazynu') {
      return draft.existingBatteryPresent === false ? { value: '0', source: 'draft.existingBatteryPresent' } : null;
    }
    if (/^b2c_(?:calkowite_uzycie_energii_kwh|produkcja_z_pv|autokonsumpcja_z_pv_kwh|energia_pobrana_z_sieci_kwh|energia_oddana_do_sieci_kwh|autokonsumpcja_z_magazynu_kwh)_/.test(semantic)) {
      return monthFieldValue(semantic, workspace, draft);
    }
    if (semantic.startsWith('b2c_miesiac_o_')) {
      const statistics = monthStatistics(workspace);
      const result = semantic.includes('najwiekszym') ? statistics.maximum
        : semantic.includes('srednim') ? statistics.average : statistics.minimum;
      if (result && semantic.includes('srednim')) {
        return { value: 'Średnia miesięczna', source: 'measurements/energy.months.average' };
      }
      return result?.period ? { value: result.period, source: workspace.energy ? 'energy.months.period' : 'measurements.months.period' } : null;
    }
    if (semantic.includes('zuzycie_energii_najwieksze') || semantic.includes('zuzycie_energii_srednie') || semantic.includes('zuzycie_energii_male')) {
      const statistics = monthStatistics(workspace);
      const result = semantic.includes('najwieksze') ? statistics.maximum
        : semantic.includes('srednie') ? statistics.average : statistics.minimum;
      return result ? { value: formatNumber(result.value), source: workspace.energy ? 'energy.months.loadKwh' : 'measurements.months.importKwh' } : null;
    }
  }

  if (page === 4) {
    if (isSummaryFinancialField(semantic)) return summaryFinancialField(semantic, proposedSummary, draft.targetSettlement, 'proposedBill');
    if (semantic === 'b2c_okres_prognozowany') {
      const periods = calculation?.forecastEnergy?.months.map((month) => month.period)
        || calculation?.forecastMeasurements?.months.map((month) => month.period)
        || flowMonthRows(calculation).map((month) => month.period);
      const ordered = [...new Set(periods)].sort();
      return ordered.length ? { value: `${ordered[0]} - ${ordered.at(-1)}`, source: 'calculation.forecastEnergy/forecastMeasurements/forecastFlows.period' } : null;
    }
    if (/^b2c_(?:calkowite_uzycie_energii_kwh|produkcja_z_pv|autokonsumpcja_z_pv_kwh|autokonsumpcja_z_magazynu_kwh|energia_pobrana_z_sieci_kwh|energia_oddana_do_sieci_kwh)_(?:styczen|luty|marzec|kwiecien|maj|czerwiec|lipiec|sierpien|wrzesien|pazdziernik|listopad|grudzien)_(?:prognozowane|prognozowana)$/.test(semantic)) {
      return forecastMonthFieldValue(semantic, calculation);
    }
    if (semantic === 'b2c_energia_oddana_do_sieci_prognozowana') {
      const value = calculationMeterTotal(calculation, 'exportKwh');
      return value ? { value: formatNumber(value.value), source: value.source } : null;
    }
    if (semantic === 'b2c_energia_pobrana_z_sieci_prognozowana') {
      const value = calculationMeterTotal(calculation, 'importKwh');
      return value ? { value: formatNumber(value.value), source: value.source } : null;
    }
    if (semantic === 'b2c_wartosc_energii_oddanej_prognozowana') {
      return calculationMoney(billingTotals(calculation, 'proposedBill')?.exportValuePln, 'calculation.proposedBill.totals.exportValuePln');
    }
    if (semantic === 'b2c_wartosc_energii_pobranej_prognozowana') {
      return calculationMoney(billingTotals(calculation, 'proposedBill')?.energyCostPln, 'calculation.proposedBill.totals.energyCostPln');
    }
    if (semantic === 'b2c_zuzycie_energii_prognozowane') {
      const value = calculationEnergyTotal(calculation, 'loadKwh');
      return value ? { value: formatNumber(value.value), source: value.source } : null;
    }
    if (semantic === 'b2c_produkcja_z_pv_prognozowana') {
      const value = calculationEnergyTotal(calculation, 'pvKwh');
      return value ? { value: formatNumber(value.value), source: value.source } : null;
    }
    if (semantic === 'b2c_autokonsumpcja_z_pv_prognozowana') {
      const value = calculationEnergyTotal(calculation, 'directKwh');
      return value ? { value: formatNumber(value.value), source: value.source } : null;
    }
    if (semantic === 'b2c_autokonsumpcja_z_pv_prognozowana_procent') {
      const direct = calculationEnergyTotal(calculation, 'directKwh');
      const pv = calculationEnergyTotal(calculation, 'pvKwh');
      return direct && pv && pv.value > 0
        ? { value: formatNumber(direct.value / pv.value * 100, 1), source: `${direct.source}|${pv.source}` } : null;
    }
    if (semantic === 'b2c_autokonsumpcja_z_magazynu_prognozowana') {
      const value = sumFlowMeasure(calculation?.forecastFlows || [], 'batteryToLoadKwh');
      return value === null ? null : { value: formatNumber(value), source: 'calculation.forecastFlows.batteryToLoadKwh' };
    }
    if (semantic.includes('miesiac_o_') || semantic.includes('zuzycie_energii_najwieksze')
      || semantic.includes('zuzycie_energii_srednie') || semantic.includes('zuzycie_energii_male')) {
      const months = calculation?.forecastEnergy?.months.map((month) => ({ period: month.period, value: month.loadKwh }))
        || flowMonthRows(calculation).map((month) => ({ period: month.period, value: sumFlowMeasure(month.rows, 'loadKwh') }));
      const complete = months.filter((month): month is { period: string; value: number } => month.value !== null && Number.isFinite(month.value));
      if (!complete.length) return null;
      const isHighest = semantic.includes('miesiac_o_najwiekszym') || semantic.includes('zuzycie_energii_najwieksze');
      const isAverage = semantic.includes('miesiac_o_srednim') || semantic.includes('zuzycie_energii_srednie');
      const measure = isHighest ? complete.reduce((best, item) => item.value > best.value ? item : best)
        : isAverage ? { period: '', value: complete.reduce((sum, item) => sum + item.value, 0) / complete.length }
          : complete.reduce((best, item) => item.value < best.value ? item : best);
      const monthField = semantic.includes('miesiac_o_');
      return monthField
        ? isAverage
          ? { value: 'Średnia miesięczna', source: 'calculation.forecastEnergy/forecastFlows.months.average' }
          : measure.period ? { value: measure.period, source: 'calculation.forecastEnergy/forecastFlows.months.period' } : null
        : { value: formatNumber(measure.value), source: 'calculation.forecastEnergy/forecastFlows.months.loadKwh' };
    }
  }

  if (page >= 5 && page <= 8) {
    if (semantic.includes('taryfa_aktualna')) {
      const label = tariffLabels?.current?.trim();
      return label ? { value: label, source: 'documentContext.tariffLabels.current' } : null;
    }
    if (semantic.includes('taryfa_prognozowana')) {
      const label = tariffLabels?.proposed?.trim();
      return label ? { value: label, source: 'documentContext.tariffLabels.proposed' } : null;
    }
    const zoneField = /_strefa_(?:niska|srednia|wysoka)_(pobor_kwh(?:_po)?|cena_kwh)$/.exec(semantic);
    if (zoneField) {
      const rowIndex = semantic.includes('_strefa_niska_') ? 0
        : semantic.includes('_strefa_srednia_') ? 1 : 2;
      const zones = dailyTargetTariffZones(workspace, calculation, page);
      if (!zones) return null;
      const zone = zones[rowIndex];
      if (!zone) return { value: '', source: 'template.noAdditionalDailyTariffZone' };
      if (zoneField[1] === 'pobor_kwh') {
        return { value: formatNumber(zone.loadKwh, 2), source: 'energy.dayProfiles.loadKwh|calculation.proposedBill.intervalTariffs.energyZone' };
      }
      if (zoneField[1] === 'pobor_kwh_po') {
        return { value: formatNumber(zone.importKwh, 2), source: 'calculation.forecastFlows.importKwh|calculation.proposedBill.intervalTariffs.energyZone' };
      }
      return { value: formatNumber(zone.grossRatePlnPerKwh, 3), source: 'calculation.proposedBill.intervalTariffs.energyRatePlnPerKwh+distributionRatePlnPerKwh/energyZone' };
    }
    if (/(?:^|_)po(?:_|$)/.test(semantic)) {
      const date = selectedDailyProfileDate(workspace, page);
      const flows = date ? flowRowsByLocalDate(calculation, date) : [];
      const dailyBillRows = dailyBillingRowsForForecastFlows(calculation, 'proposedBill', flows);
      const baselineBillRows = date ? dailyMeterProfileBillingRows(workspace, calculation, 'baselineBill', page) : null;
      const proposedSettlement = draft.targetSettlement;
      const forecastWorkspace = calculation?.forecastEnergy && calculation.forecastMeasurements
        ? { ...workspace, energy: calculation.forecastEnergy, measurements: calculation.forecastMeasurements }
        : null;
      const forecastProfile = !flows.length && forecastWorkspace ? energyProfileForPage(forecastWorkspace, page) : null;
      const energyHours = forecastProfile?.date === date ? forecastProfile.hours : null;
      if (!flows.length && !energyHours) return null;
      const forecastValue = (measure: V4FlowMeasure, energyKey?: 'loadKwh' | 'pvKwh' | 'directKwh') => {
        if (flows.length) return sumFlowMeasure(flows, measure);
        if (!energyHours || !energyKey) return null;
        return completeSum(energyHours.map((hour) => hour[energyKey]));
      };
      if (semantic.includes('_energia_pobrana_z_sieci_suma_kwh_po')) {
        const value = flows.length ? sumFlowMeasure(flows, 'importKwh')
          : completeSum(forecastProfile!.measuredProfile.hours.map((hour) => hour.importKwh));
        return value === null ? null : { value: formatNumber(value, 2), source: flows.length ? 'calculation.forecastFlows.importKwh' : 'calculation.forecastMeasurements.dayProfiles.importKwh' };
      }
      if (semantic.includes('_energia_oddana_do_sieci_suma_kwh_po')) {
        const value = flows.length ? sumFlowMeasure(flows, 'exportKwh')
          : completeSum(forecastProfile!.measuredProfile.hours.map((hour) => hour.exportKwh));
        return value === null ? null : { value: formatNumber(value, 2), source: flows.length ? 'calculation.forecastFlows.exportKwh' : 'calculation.forecastMeasurements.dayProfiles.exportKwh' };
      }
      if (semantic.includes('_produkcja_z_pv_suma_kwh_po')) {
        const value = forecastValue('pvKwh', 'pvKwh');
        return value === null ? null : { value: formatNumber(value, 2), source: flows.length ? 'calculation.forecastFlows.pvKwh' : 'calculation.forecastEnergy.dayProfiles.pvKwh' };
      }
      if (semantic.includes('_autokonsumpcja_z_pv_suma_kwh_po')) {
        const value = forecastValue('directKwh', 'directKwh');
        return value === null ? null : { value: formatNumber(value, 2), source: flows.length ? 'calculation.forecastFlows.directKwh' : 'calculation.forecastEnergy.dayProfiles.directKwh' };
      }
      if (semantic.includes('_autokonsumpcja_z_magazynu_suma_kwh_po')) {
        const value = flows.length ? sumFlowMeasure(flows, 'batteryToLoadKwh') : null;
        return value === null ? null : { value: formatNumber(value, 2), source: 'calculation.forecastFlows.batteryToLoadKwh' };
      }
      if (semantic.includes('_energia_pobrana_do_magazynu_suma_kwh_po')) {
        if (!flows.length) return null;
        const grid = sumFlowMeasure(flows, 'gridToBatteryKwh');
        const pv = sumFlowMeasure(flows, 'pvToBatteryKwh');
        return grid === null || pv === null ? null : { value: formatNumber(grid + pv, 2), source: 'calculation.forecastFlows.gridToBatteryKwh|calculation.forecastFlows.pvToBatteryKwh' };
      }
      if (semantic.includes('_energia_pobrana_do_magazynu_z_pv_suma_kwh_po')) {
        if (!flows.length) return null;
        const value = sumFlowMeasure(flows, 'pvToBatteryKwh');
        return value === null ? null : { value: formatNumber(value, 2), source: 'calculation.forecastFlows.pvToBatteryKwh' };
      }
      if (semantic.includes('_rozladowanie_magazynu_do_sieci_kwh_po')) {
        if (!flows.length) return null;
        const value = sumFlowMeasure(flows, 'batteryToGridKwh');
        return value === null ? null : { value: formatNumber(value, 2), source: 'calculation.forecastFlows.batteryToGridKwh' };
      }
      if (semantic.includes('_oszczednosc_pln')) {
        return baselineBillRows && dailyBillRows ? dailyCashSavingsFromMatched(baselineBillRows, dailyBillRows) : null;
      }
      if (semantic.includes('_energia_pobrana_z_sieci_srednia_cena_po')) {
        const value = dailyBillRows ? dailyAverageGrossPurchasePrice(dailyBillRows) : null;
        return calculationRate(value, 'calculation.proposedBill.intervals.grossPurchasePln/forecastFlows.importKwh');
      }
      if (semantic.includes('_energia_pobrana_z_sieci_wartosc_po')) {
        const value = dailyBillRows ? dailyGrossPurchaseFromMatched(dailyBillRows) : null;
        return calculationMoney(value,
          'calculation.proposedBill.intervals.energyCostPln+coveredEnergyPln+distributionCostPln+coveredDistributionPln');
      }
      if (semantic.includes('_energia_oddana_do_sieci_srednia_cena_po')) {
        if (proposedSettlement === 'NET_METERING') return { value: 'Nie dotyczy', source: 'draft.targetSettlement.NET_METERING' };
        if (proposedSettlement !== 'NET_BILLING') return null;
        if (dailyBillRows && completeSum(dailyBillRows.map(({ meter }) => meter.exportKwh)) === 0) {
          return { value: 'Nie dotyczy', source: 'calculation.proposedBill.intervals.exportKwh.zero' };
        }
        const value = dailyBillRows ? dailyAverageExportPrice(dailyBillRows) : null;
        return calculationRate(value, 'calculation.proposedBill.intervals.exportValuePln/forecastFlows.exportKwh');
      }
      if (semantic.includes('_energia_oddana_do_sieci_wartosc_po')) {
        if (proposedSettlement === 'NET_METERING') return { value: 'Nie dotyczy', source: 'draft.targetSettlement.NET_METERING' };
        if (proposedSettlement !== 'NET_BILLING') return null;
        return calculationMoney(dailyBillRows ? dailyExportValueFromMatched(dailyBillRows) : null,
          'calculation.proposedBill.intervals.exportValuePln');
      }
      if (semantic.includes('_bilans_wartosci_po')) {
        if (proposedSettlement === 'NET_METERING') return { value: 'Nie dotyczy', source: 'draft.targetSettlement.NET_METERING' };
        if (proposedSettlement !== 'NET_BILLING') return null;
        return calculationMoney(dailyBillRows ? dailyGrossValueBalance(dailyBillRows) : null,
          'calculation.proposedBill.intervals.exportValuePln-grossPurchasePln');
      }
      if (semantic.includes('_autokonsumpcja_z_pv_procent_po')) {
        const direct = forecastValue('directKwh', 'directKwh');
        const pv = forecastValue('pvKwh', 'pvKwh');
        return direct !== null && pv !== null && pv > 0
          ? { value: formatNumber(direct / pv * 100, 1), source: 'calculation.forecastEnergy/forecastFlows.directKwh/pvKwh' } : null;
      }
      return null;
    }
    if (semantic.includes('moc_pv_prognozowana')) {
      const power = forecastPvPower(workspace, draft);
      const existingPowerSource = draft.existingPv.powerKw !== null ? 'draft.existingPv.powerKw' : 'input.existingPv.powerKw';
      const source = draft.pvStrategy === 'KEEP_EXISTING'
        ? `draft.pvStrategy|${existingPowerSource}`
        : `draft.pvStrategy|templates.powerKw|${existingPowerSource}`;
      return power === null ? null : { value: formatNumber(power, 1), source };
    }
    if (semantic.includes('pojemnosc_magazynu_prognozowana')) {
      const capacity = forecastBatteryCapacity(workspace, draft);
      return capacity === null ? null : { value: formatNumber(capacity, 1), source: 'draft.selectedTemplateIds|templates.capacityKwh' };
    }
    if (/moc_pv_prognozowana|pojemnosc_magazynu_prognozowana/.test(semantic)) return null;
    const baselineSettlement = draft.currentSettlement ?? (
      workspace.input.settlementMode === 'NET_METERING' || workspace.input.settlementMode === 'NET_BILLING'
        ? workspace.input.settlementMode : null
    );
    const currentDate = selectedDailyProfileDate(workspace, page);
    const baselineRows = currentDate ? dailyMeterProfileBillingRows(workspace, calculation, 'baselineBill', page) : null;
    if (semantic.includes('_energia_pobrana_z_sieci_srednia_cena')) {
      const value = baselineRows ? dailyAverageGrossPurchasePrice(baselineRows) : null;
      return calculationRate(value, 'calculation.baselineBill.intervals.grossPurchasePln/measurements.dayProfiles.importKwh');
    }
    if (semantic.includes('_energia_pobrana_z_sieci_wartosc') && !/(?:^|_)po(?:_|$)/.test(semantic)) {
      return calculationMoney(baselineRows ? dailyGrossPurchaseFromMatched(baselineRows) : null,
        'calculation.baselineBill.intervals.energyCostPln+coveredEnergyPln+distributionCostPln+coveredDistributionPln');
    }
    if (semantic.includes('_energia_oddana_do_sieci_srednia_cena') && !semantic.includes('_po')) {
      if (baselineSettlement === 'NET_METERING') return { value: 'Nie dotyczy', source: 'draft.currentSettlement|input.settlementMode.NET_METERING' };
      if (baselineSettlement !== 'NET_BILLING') return null;
      if (baselineRows && completeSum(baselineRows.map(({ meter }) => meter.exportKwh)) === 0) {
        return { value: 'Nie dotyczy', source: 'calculation.baselineBill.intervals.exportKwh.zero' };
      }
      const value = baselineRows ? dailyAverageExportPrice(baselineRows) : null;
      return calculationRate(value, 'calculation.baselineBill.intervals.exportValuePln/measurements.dayProfiles.exportKwh');
    }
    if (semantic.includes('_energia_oddana_do_sieci_wartosc') && !semantic.includes('_po')) {
      if (baselineSettlement === 'NET_METERING') return { value: 'Nie dotyczy', source: 'draft.currentSettlement|input.settlementMode.NET_METERING' };
      if (baselineSettlement !== 'NET_BILLING') return null;
      return calculationMoney(baselineRows ? dailyExportValueFromMatched(baselineRows) : null,
        'calculation.baselineBill.intervals.exportValuePln');
    }
    if (semantic.includes('_bilans_wartosci_aktualny')) {
      if (baselineSettlement === 'NET_METERING') return { value: 'Nie dotyczy', source: 'draft.currentSettlement|input.settlementMode.NET_METERING' };
      if (baselineSettlement !== 'NET_BILLING') return null;
      return calculationMoney(baselineRows ? dailyGrossValueBalance(baselineRows) : null,
        'calculation.baselineBill.intervals.exportValuePln-grossPurchasePln');
    }
    if (currentDate && semantic.includes('_oszczednosc_pln')) {
      const proposedFlows = flowRowsByLocalDate(calculation, currentDate);
      const proposedRows = dailyBillingRowsForForecastFlows(calculation, 'proposedBill', proposedFlows);
      return baselineRows && proposedRows ? dailyCashSavingsFromMatched(baselineRows, proposedRows) : null;
    }
    if (semantic.includes('moc_instalacji_fotowoltaicznej')) {
      return validChartValue(pvPower) ? { value: formatNumber(pvPower, 1), source: draft.existingPv.powerKw !== null ? 'draft.existingPv.powerKw' : 'input.existingPv.powerKw' } : null;
    }
    const profile = dailyProfileForV4(workspace, page);
    if (!profile) return null;
    if (semantic.endsWith('_okres')) {
      return { value: profile.date.slice(0, 7), source: workspace.energy !== undefined ? 'energy.dayProfiles.date' : 'measurements.dayProfiles.date' };
    }
    if (semantic.includes('_zuzycie_energii_suma_kwh')) {
      if (!('measuredProfile' in profile)) return null;
      const value = completeSum(profile.hours.map((hour) => hour.loadKwh));
      return value === null ? null : { value: formatNumber(value, 2), source: 'energy.dayProfiles.loadKwh' };
    }
    if (semantic.includes('_produkcja_z_pv_suma_kwh')) {
      if (!('measuredProfile' in profile)) return null;
      const value = completeSum(profile.hours.map((hour) => hour.pvKwh));
      return value === null ? null : { value: formatNumber(value, 2), source: 'energy.dayProfiles.pvKwh' };
    }
    if (semantic.includes('_autokonsumpcja_z_pv_suma_kwh')) {
      if (!('measuredProfile' in profile)) return null;
      const value = completeSum(profile.hours.map((hour) => hour.directKwh));
      return value === null ? null : { value: formatNumber(value, 2), source: 'energy.dayProfiles.directKwh' };
    }
    if (semantic.includes('_autokonsumpcja_z_pv_procent')) {
      if (!('measuredProfile' in profile)) return null;
      const direct = completeSum(profile.hours.map((hour) => hour.directKwh));
      const pv = completeSum(profile.hours.map((hour) => hour.pvKwh));
      return direct !== null && pv !== null && pv > 0
        ? { value: formatNumber(direct / pv * 100, 1), source: 'energy.dayProfiles.directKwh|energy.dayProfiles.pvKwh' } : null;
    }
    if (semantic.includes('_energia_pobrana_z_sieci_suma_kwh')) {
      const meterProfile = 'measuredProfile' in profile ? profile.measuredProfile : profile;
      const value = completeSum(meterProfile.hours.map((hour) => hour.importKwh));
      return value === null ? null : { value: formatNumber(value, 2), source: 'measurements.dayProfiles.importKwh' };
    }
    if (semantic.includes('_energia_oddana_do_sieci_suma_kwh')) {
      const meterProfile = 'measuredProfile' in profile ? profile.measuredProfile : profile;
      const value = completeSum(meterProfile.hours.map((hour) => hour.exportKwh));
      return value === null ? null : { value: formatNumber(value, 2), source: 'measurements.dayProfiles.exportKwh' };
    }
    return null;
  }

  if (page === 9) {
    if (semantic === 'b2c_taryfa_aktualna') {
      const label = tariffLabels?.current?.trim();
      return label ? { value: label, source: 'documentContext.tariffLabels.current' } : null;
    }
    if (semantic === 'b2c_taryfa_prognozowana') {
      const label = tariffLabels?.proposed?.trim();
      return label ? { value: label, source: 'documentContext.tariffLabels.proposed' } : null;
    }
    if (semantic === 'b2c_system_rozliczeniowy_aktualny') {
      const value = settlement(draft.currentSettlement || workspace.input.settlementMode);
      return value ? { value, source: 'draft.currentSettlement|input.settlementMode' } : null;
    }
    if (semantic === 'b2c_system_rozliczeniowy_prognozowany') {
      const value = settlement(draft.targetSettlement);
      return value ? { value, source: 'draft.targetSettlement' } : null;
    }
    const baseline = billingTotals(calculation, 'baselineBill');
    const proposed = billingTotals(calculation, 'proposedBill');
    const currentSettlement = draft.currentSettlement ?? (
      workspace.input.settlementMode === 'NET_METERING' || workspace.input.settlementMode === 'NET_BILLING'
        ? workspace.input.settlementMode : null
    );
    const notApplicable = (settlementMode: string, field: string): MappedValue => ({
      value: 'Nie dotyczy', source: `draft.${field === 'current' ? 'currentSettlement|input.settlementMode' : 'targetSettlement'}.${settlementMode}`,
    });
    const baselineDepositFields = new Set([
      'b2c_energia_oddana_do_depozytu_aktualna', 'b2c_pokryte_z_depozytu_aktualne',
    ]);
    const proposedDepositFields = new Set([
      'b2c_laczna_zgromadzona_wartosc_depozytu',
      'b2c_laczna_wykorzystana_wartosc_depozytu_na_pokrycie_energii_pobranej',
      'b2c_niewykorzystana_wartosc_depozytu', 'b2c_zwrot_30_wartosci',
      'b2c_wartosc_energii_pobranej_niepokrytej_z_depozytu', 'b2c_wartosc_energii_oddanej_do_depozytu_prognozowana',
      'b2c_wartosc_energii_wykorzystanej_z_depozytu_prognozowana',
      'b2c_wartosc_skumulowanego_depozytu_prognozowana', 'b2c_rachunek_po_zwrocie_z_depozytu_prognozowany',
      'b2c_energia_oddana_do_depozytu_prognozowana_kwh',
    ]);
    const currentComponentFields: Record<string, { kind: 'distribution' | 'fixed'; category: string }> = {
      b2c_oplata_zmienna_sieciowa_aktualny: { kind: 'distribution', category: 'network' },
      b2c_oplata_jakosciowa_aktualny: { kind: 'distribution', category: 'quality' },
      b2c_oplata_oze_aktualny: { kind: 'distribution', category: 'oze' },
      b2c_oplata_kogeneracyjna_aktualny: { kind: 'distribution', category: 'cogeneration' },
      b2c_oplata_handlowa_aktualny: { kind: 'fixed', category: 'commercial' },
      b2c_skladnik_staly_sieciowy_aktualny: { kind: 'fixed', category: 'fixed_network' },
      b2c_stala_abonementu_aktualny: { kind: 'fixed', category: 'subscription' },
    };
    const proposedComponentFields: Record<string, { kind: 'distribution' | 'fixed'; category: string }> = {
      b2c_oplata_zmienna_sieciowa_prognozowany: { kind: 'distribution', category: 'network' },
      b2c_oplata_jakosciowa_prognozowany: { kind: 'distribution', category: 'quality' },
      b2c_oplata_oze_prognozowany: { kind: 'distribution', category: 'oze' },
      b2c_oplata_kogeneracyjna_prognozowany: { kind: 'distribution', category: 'cogeneration' },
      b2c_oplata_handlowa_prognozowany: { kind: 'fixed', category: 'commercial' },
      b2c_skladnik_staly_sieciowy_prognozowany: { kind: 'fixed', category: 'fixed_network' },
      b2c_stala_abonementu_prognozowany: { kind: 'fixed', category: 'subscription' },
    };
    const repeatedCapacityField = /b2c_skladnik_staly_sieciowy_(?:aktualny|prognozowany)_strona_09_2$/.test(fieldId);
    const component = repeatedCapacityField
      ? { scenario: semantic.includes('_prognozowany') ? 'proposedBill' as const : 'baselineBill' as const,
        kind: 'fixed' as const, category: 'capacity' }
      : currentComponentFields[semantic]
        ? { scenario: 'baselineBill' as const, ...currentComponentFields[semantic] }
        : proposedComponentFields[semantic]
          ? { scenario: 'proposedBill' as const, ...proposedComponentFields[semantic] }
          : null;
    if (component) return billingComponentRate(calculation, component.scenario, component.kind, component.category);
    if (currentSettlement === 'NET_METERING' && baselineDepositFields.has(semantic)) {
      return notApplicable(currentSettlement, 'current');
    }
    if (draft.targetSettlement === 'NET_METERING' && proposedDepositFields.has(semantic)) {
      return notApplicable(draft.targetSettlement, 'target');
    }
    if (semantic === 'b2c_rachunek_po_zwrocie_z_depozytu_prognozowany') {
      return billingAmountAfterDepositRefund(calculation);
    }
    if (semantic === 'b2c_zakup_energii_cena_kwh_aktualny') {
      return calculationRate(baselineSummary?.totals.averageEnergyPurchasePlnPerKwh,
        'calculation.baselineBill.totals.grossPurchaseEnergyCostPln/rateBasisImportKwh');
    }
    if (semantic === 'b2c_dystrybucja_energii_cena_kwh_aktualny') {
      return calculationRate(baselineSummary?.totals.averageDistributionPurchasePlnPerKwh,
        'calculation.baselineBill.totals.grossPurchaseDistributionCostPln/rateBasisImportKwh');
    }
    if (semantic === 'b2c_koszt_zakupu_1kwh_aktualny') {
      const energy = baselineSummary?.totals.averageEnergyPurchasePlnPerKwh;
      const distribution = baselineSummary?.totals.averageDistributionPurchasePlnPerKwh;
      return energy !== null && energy !== undefined && distribution !== null && distribution !== undefined
        ? calculationRate(energy + distribution,
          'calculation.baselineBill.totals.grossPurchaseEnergyCostPln/grossPurchaseDistributionCostPln/rateBasisImportKwh')
        : null;
    }
    if (semantic === 'b2c_oplaty_stale_aktualny') {
      return calculationMoney(baselineSummary?.averageMonthlyFixedCostPln,
        'calculation.baselineBill.months.fixedCostPln/representedMonths');
    }
    if (semantic === 'b2c_zakup_energii_cena_kwh_prognozowany') {
      return calculationRate(proposedSummary?.totals.averageEnergyPurchasePlnPerKwh,
        'calculation.proposedBill.totals.grossPurchaseEnergyCostPln/rateBasisImportKwh');
    }
    if (semantic === 'b2c_dystrybucja_energii_cena_kwh_prognozowany') {
      return calculationRate(proposedSummary?.totals.averageDistributionPurchasePlnPerKwh,
        'calculation.proposedBill.totals.grossPurchaseDistributionCostPln/rateBasisImportKwh');
    }
    if (semantic === 'b2c_koszt_zakupu_1kwh_prognozowany') {
      const energy = proposedSummary?.totals.averageEnergyPurchasePlnPerKwh;
      const distribution = proposedSummary?.totals.averageDistributionPurchasePlnPerKwh;
      return energy !== null && energy !== undefined && distribution !== null && distribution !== undefined
        ? calculationRate(energy + distribution,
          'calculation.proposedBill.totals.grossPurchaseEnergyCostPln/grossPurchaseDistributionCostPln/rateBasisImportKwh')
        : null;
    }
    if (semantic === 'b2c_oplaty_stale_prognozowany') {
      return calculationMoney(proposedSummary?.averageMonthlyFixedCostPln,
        'calculation.proposedBill.months.fixedCostPln/representedMonths');
    }
    if (semantic === 'b2c_oplaty_stale_i_dystrybucyjne') {
      const totals = proposedSummary?.totals;
      return totals ? calculationMoney(totals.paidDistributionCostPln + totals.paidFixedCostPln,
        'calculation.proposedBill.totals.paidDistributionCostPln+paidFixedCostPln') : null;
    }
    if (semantic === 'b2c_autokonsumpcja_z_magazynu_prognozowana') {
      const value = sumFlowMeasure(calculation?.forecastFlows || [], 'batteryToLoadKwh');
      return value === null ? null : calculationMoney(value, 'calculation.forecastFlows.batteryToLoadKwh');
    }
    if (semantic === 'b2c_zuzycie_energii_aktualne') return workspace.energy
      ? energyMetric(workspace.energy.totals.loadKwh, 'totals.loadKwh', false) : null;
    if (semantic === 'b2c_autokonsumpcja_z_pv_aktualna') return workspace.energy
      ? energyMetric(workspace.energy.totals.directKwh, 'totals.directKwh', false) : null;
    if (semantic === 'b2c_zuzycie_energii_prognozowana') {
      const value = calculationEnergyTotal(calculation, 'loadKwh');
      return value ? { value: formatNumber(value.value), source: value.source } : null;
    }
    if (semantic === 'b2c_autokonsumpcja_z_pv_prognozowana') {
      const value = calculationEnergyTotal(calculation, 'directKwh');
      return value ? { value: formatNumber(value.value), source: value.source } : null;
    }
    if (semantic === 'b2c_twoj_aktualny_rachunek_roczny') return calculationMoney(calculation?.baselineAnnualCostPln, 'calculation.baselineAnnualCostPln');
    if (semantic === 'b2c_twoj_nowy_rachunek_z_systemem') return calculationMoney(calculation?.proposedAnnualCostPln, 'calculation.proposedAnnualCostPln');
    if (semantic === 'b2c_oszczednosc') return calculationMoney(calculation?.annualSavingsPln, 'calculation.annualSavingsPln');
    if (semantic === 'b2c_oszczednosc_procent') {
      const base = calculation?.baselineAnnualCostPln;
      const savings = calculation?.annualSavingsPln;
      return base != null && Number.isFinite(base) && base > 0 && savings != null && Number.isFinite(savings)
        ? { value: formatNumber(savings / base * 100, 1), source: 'calculation.annualSavingsPln|calculation.baselineAnnualCostPln' } : null;
    }
    if (semantic === 'b2c_calkowity_rachunek_brutto_aktualny') return calculationMoney(baseline?.totalCostPln, 'calculation.baselineBill.totals.totalCostPln');
    if (semantic === 'b2c_calkowity_rachunek_brutto_prognozowany') return calculationMoney(proposed?.totalCostPln, 'calculation.proposedBill.totals.totalCostPln');
    if (semantic === 'b2c_zakup_energii_aktualny' || semantic === 'b2c_zakup_energii_aktualny_2') return calculationMoney(baseline?.energyCostPln, 'calculation.baselineBill.totals.energyCostPln');
    if (semantic === 'b2c_dystrybucja_energii_aktualne') return calculationMoney(baseline?.distributionCostPln, 'calculation.baselineBill.totals.distributionCostPln');
    if (semantic === 'b2c_oplaty_stale_aktualne') return calculationMoney(baseline?.fixedCostPln, 'calculation.baselineBill.totals.fixedCostPln');
    if (semantic === 'b2c_energia_oddana_do_depozytu_aktualna') return calculationMoney(baseline?.depositEarnedPln, 'calculation.baselineBill.totals.depositEarnedPln');
    if (semantic === 'b2c_pokryte_z_depozytu_aktualne') return calculationMoney(baseline ? baseline.coveredEnergyPln + baseline.coveredDistributionPln : null, 'calculation.baselineBill.totals.coveredEnergyPln/coveredDistributionPln');
    if (semantic === 'b2c_laczna_zgromadzona_wartosc_depozytu') return calculationMoney(proposed?.depositEarnedPln, 'calculation.proposedBill.totals.depositEarnedPln');
    if (semantic === 'b2c_laczna_wykorzystana_wartosc_depozytu_na_pokrycie_energii_pobranej') return calculationMoney(proposed ? proposed.coveredEnergyPln + proposed.coveredDistributionPln : null, 'calculation.proposedBill.totals.coveredEnergyPln/coveredDistributionPln');
    if (semantic === 'b2c_niewykorzystana_wartosc_depozytu') return calculationMoney(proposed ? proposed.depositBalancePln + proposed.pendingDepositPln : null, 'calculation.proposedBill.totals.depositBalancePln/pendingDepositPln');
    if (semantic === 'b2c_zwrot_30_wartosci') return calculationMoney(proposed?.depositRefundedPln, 'calculation.proposedBill.totals.depositRefundedPln');
    if (semantic === 'b2c_wartosc_energii_pobranej_niepokrytej_z_depozytu') return calculationMoney(proposed?.energyCostPln, 'calculation.proposedBill.totals.energyCostPln');
    if (semantic === 'b2c_energia_pobrana_z_sieci') {
      return baseline && validEnergyValue(baseline.importKwh) !== null
        ? { value: formatNumber(baseline.importKwh), source: 'calculation.baselineBill.totals.importKwh' } : null;
    }
    if (semantic === 'b2c_energia_pobrana_z_sieci_prognozowana') {
      return proposed && validEnergyValue(proposed.importKwh) !== null
        ? { value: formatNumber(proposed.importKwh), source: 'calculation.proposedBill.totals.importKwh' } : null;
    }
    if (semantic === 'b2c_energia_oddana_do_depozytu_prognozowana_kwh') {
      return proposed && validEnergyValue(proposed.exportKwh) !== null
        ? { value: formatNumber(proposed.exportKwh), source: 'calculation.proposedBill.totals.exportKwh' } : null;
    }
    if (semantic === 'b2c_wartosc_energii_oddanej_do_depozytu_prognozowana') return calculationMoney(proposed?.depositEarnedPln, 'calculation.proposedBill.totals.depositEarnedPln');
    if (semantic === 'b2c_wartosc_energii_wykorzystanej_z_depozytu_prognozowana') return calculationMoney(proposed?.depositUsedPln, 'calculation.proposedBill.totals.depositUsedPln');
    if (semantic === 'b2c_energia_wykorzystana_z_depozytu_prognozowana_kwh') {
      if (draft.targetSettlement === 'NET_BILLING') return notApplicable(draft.targetSettlement, 'target');
      return draft.targetSettlement === 'NET_METERING' && proposed
        ? { value: formatNumber(proposed.creditUsedKwh), source: 'calculation.proposedBill.totals.creditUsedKwh' } : null;
    }
    if (semantic === 'b2c_wartosc_skumulowanego_depozytu_prognozowana') return calculationMoney(proposed ? proposed.depositBalancePln + proposed.pendingDepositPln : null, 'calculation.proposedBill.totals.depositBalancePln/pendingDepositPln');
    if (semantic === 'b2c_pokryte_z_depozytu_prognozowana') return calculationMoney(proposed ? proposed.coveredEnergyPln + proposed.coveredDistributionPln : null, 'calculation.proposedBill.totals.coveredEnergyPln/coveredDistributionPln');
    if (semantic === 'b2c_zakup_energii_prognozowany' || semantic === 'b2c_zakup_energii_prognozowany_2') return calculationMoney(proposed?.energyCostPln, 'calculation.proposedBill.totals.energyCostPln');
    if (semantic === 'b2c_dystrybucja_energii_prognozowana') return calculationMoney(proposed?.distributionCostPln, 'calculation.proposedBill.totals.distributionCostPln');
    if (semantic === 'b2c_oplaty_stale_prognozowane') return calculationMoney(proposed?.fixedCostPln, 'calculation.proposedBill.totals.fixedCostPln');
    if (semantic === 'b2c_oszczednosc_brutto_prognozowana') return calculationMoney(calculation?.annualSavingsPln, 'calculation.annualSavingsPln');
  }

  if (page === 10) {
    if (semantic.startsWith('b2c_kosztorys_')) {
      const rowMatch = /b2c_kosztorys_(?:pozycja|model|ilosc|cena_jednostkowa_brutto|wartosc_brutto)_(\d+)/.exec(semantic);
      if (!rowMatch) return null;
      const rowIndex = Number(rowMatch[1]) - 1;
      const row = productRows[rowIndex];
      if (!row) return { value: '', source: 'template.pricing.unusedRow' };
      if (semantic.includes('_pozycja_')) return { value: row.description, source: 'template.pricing.description' };
      if (semantic.includes('_model_')) return row.model
        ? { value: row.model, source: 'template.pricing.productName' }
        : { value: '—', source: 'template.pricing.modelUnknown' };
      if (semantic.includes('_ilosc_')) return row.quantity === null
        ? { value: '—', source: 'template.pricing.quantityUnknown' }
        : { value: formatNumber(row.quantity, Number.isInteger(row.quantity) ? 0 : 2), source: 'template.pricing.quantity' };
      if (semantic.includes('_cena_jednostkowa_brutto_')) return row.includedInSale && row.unitSaleAmount !== null
        ? { value: formatNumber(row.unitSaleAmount, 2), source: 'template.pricing.unitSaleAmount' }
        : { value: '—', source: row.includedInSale ? 'template.pricing.unitPriceUnknown' : 'template.pricing.notIncluded' };
      if (semantic.includes('_wartosc_brutto_')) return row.includedInSale && row.lineSaleAmount !== null
        ? { value: formatNumber(row.lineSaleAmount, 2), source: 'template.pricing.lineSaleAmount' }
        : { value: '—', source: row.includedInSale ? 'template.pricing.linePriceUnknown' : 'template.pricing.notIncluded' };
    }
    if (semantic === 'b2c_koszt_systemu') {
      return pricing.systemCostBeforeFinancing === null ? null
        : { value: formatNumber(pricing.systemCostBeforeFinancing, 2), source: 'template.pricing.systemCostBeforeFinancing' };
    }
    if (semantic === 'b2c_prognozowana_kwota_dotacji_z_programu') return calculationMoney(calculation?.grantPln, 'calculation.grantPln');
    if (semantic === 'b2c_prognozowana_ulga_termomodernizacyjna') return calculationMoney(calculation?.taxReliefPln, 'calculation.taxReliefPln');
    if (semantic === 'b2c_prognozowany_koszt_sytemu_po_dofinansowaniach') return calculationMoney(calculation?.costAfterFinancingPln, 'calculation.costAfterFinancingPln');
  }
  return null;
}

function appendStorageIllustration(
  document: XmlDocument,
  illustration: OfferStorageIllustration | null,
  sourceFields: Set<string>,
  missing: Map<string, OfferWorkspaceDocumentMissingData>,
) {
  const graphic = uniqueElementById(document, 'grafika / magazyn');
  if (!graphic) {
    addV4Missing(missing, 2, 'storageIllustration.slot', 'Brak pola ilustracji magazynu w szablonie.');
    return;
  }
  const originalClip = (Array.from(graphic.getElementsByTagName('g')) as XmlElement[])
    .map((group) => group.getAttribute('clip-path'))
    .find((value): value is string => Boolean(value));
  while (graphic.firstChild) graphic.removeChild(graphic.firstChild);

  const canvas = svgShape(document, 'g', originalClip ? { 'clip-path': originalClip } : {});
  graphic.appendChild(canvas);
  canvas.appendChild(svgShape(document, 'rect', {
    x: '30', y: '94', width: '535', height: '237.667', rx: '10',
    fill: '#f4f6fa', stroke: '#dfe3eb', 'stroke-width': '0.8',
  }));
  if (illustration?.dataUrl) {
    const image = svgShape(document, 'image', {
      x: '30', y: '94', width: '535', height: '237.667',
      preserveAspectRatio: 'xMidYMid meet', href: illustration.dataUrl,
    });
    canvas.appendChild(image);
  }

  if (illustration?.dimensions && ['PowerBrick Plus', 'STACK314', 'BF100 (cabinet)'].includes(illustration.family || '')) {
    const dimensionPrefix = illustration.family === 'PowerBrick Plus' ? 'powerbrick'
      : illustration.family === 'STACK314' ? 'stack314' : 'cabinet';
    const appendDimensionArrow = (
      id: string,
      value: number | null,
      line: string,
      arrowheads: readonly [string, string],
      labelX: number,
      labelY: number,
      labelTransform?: string,
    ) => {
      if (value === null || !Number.isFinite(value) || value <= 0) return;
      const group = svgShape(document, 'g', { id: `${dimensionPrefix}-dimension-${id}` });
      group.appendChild(svgShape(document, 'path', {
        d: line, fill: 'none', stroke: '#2b3674', 'stroke-width': '0.9', 'stroke-linecap': 'round',
      }));
      for (const d of arrowheads) {
        group.appendChild(svgShape(document, 'path', {
          d, fill: '#2b3674', stroke: '#ffffff', 'stroke-width': '0.45', 'stroke-linejoin': 'round',
        }));
      }
      const label = svgShape(document, 'text', {
        id: `${dimensionPrefix}-dimension-${id}-label`,
        x: String(labelX), y: String(labelY), 'text-anchor': 'middle',
        fill: '#2b3674', stroke: '#ffffff', 'stroke-width': '2.6', 'paint-order': 'stroke',
        'font-family': 'DM Sans', 'font-size': '8.8', 'font-weight': 'bold',
        ...(labelTransform ? { transform: labelTransform } : {}),
      });
      label.appendChild(document.createTextNode(`${formatNumber(value, 0)} mm`));
      group.appendChild(label);
      canvas.appendChild(group);
    };

    if (illustration.family === 'PowerBrick Plus') {
      appendDimensionArrow('width', illustration.dimensions.widthMm,
        'M 172 210 L 222 210', ['M 172 210 L 178 207 L 178 213 Z', 'M 222 210 L 216 207 L 216 213 Z'], 197, 204);
      appendDimensionArrow('height', illustration.dimensions.heightMm,
        'M 168 218 L 168 318', ['M 168 218 L 165 224 L 171 224 Z', 'M 168 318 L 165 312 L 171 312 Z'],
        151, 269, 'rotate(-90 151 269)');
      // These coordinates target the first cabinet in Magazyn3 (1746×917) at the current xMidYMid frame.
      appendDimensionArrow('depth', illustration.dimensions.depthMm,
        'M 225 318 L 235 306', ['M 225 318 L 226 311 L 231 315 Z', 'M 235 306 L 229 309 L 234 313 Z'], 234, 326);
    } else if (illustration.family === 'STACK314') {
      // Original Dynes_314.png (1448 × 1086), contained in the shared illustration frame.
      appendDimensionArrow('width', illustration.dimensions.widthMm,
        'M 260 316 L 326 316', ['M 260 316 L 266 313 L 266 319 Z', 'M 326 316 L 320 313 L 320 319 Z'], 293, 328);
      appendDimensionArrow('height', illustration.dimensions.heightMm,
        'M 249 119 L 249 305', ['M 249 119 L 246 125 L 252 125 Z', 'M 249 305 L 246 299 L 252 299 Z'],
        238, 214, 'rotate(-90 238 214)');
      appendDimensionArrow('depth', illustration.dimensions.depthMm,
        'M 329 315 L 349 309', ['M 329 315 L 334 310 L 336 316 Z', 'M 349 309 L 342 308 L 344 314 Z'], 365, 321);
    } else {
      // Original magazyn cabinet.png (1696 × 1272); dimensions describe one BF100 cabinet.
      appendDimensionArrow('width', illustration.dimensions.widthMm,
        'M 267 306 L 332 306', ['M 267 306 L 273 303 L 273 309 Z', 'M 332 306 L 326 303 L 326 309 Z'], 299, 320);
      appendDimensionArrow('height', illustration.dimensions.heightMm,
        'M 255 130 L 255 293', ['M 255 130 L 252 136 L 258 136 Z', 'M 255 293 L 252 287 L 258 287 Z'],
        244, 213, 'rotate(-90 244 213)');
      appendDimensionArrow('depth', illustration.dimensions.depthMm,
        'M 337 305 L 370 297', ['M 337 305 L 342 300 L 344 306 Z', 'M 370 297 L 363 296 L 365 302 Z'], 367, 319);
    }
  } else {
    const dimensionLabels = illustration?.dimensions ? [
      [illustration.dimensions.heightMm, 370, 214],
      [illustration.dimensions.widthMm, 290, 316],
      [illustration.dimensions.depthMm, 350, 314],
    ] as const : [];
    for (const [value, x, y] of dimensionLabels) {
      if (value === null || !Number.isFinite(value) || value <= 0) continue;
      const label = svgShape(document, 'text', {
        x: String(x), y: String(y), 'text-anchor': 'middle',
        fill: '#2b3674', stroke: '#ffffff', 'stroke-width': '2.4', 'paint-order': 'stroke',
        'font-family': 'DM Sans', 'font-size': '8', 'font-weight': 'bold',
      });
      label.appendChild(document.createTextNode(`${formatNumber(value, 0)} mm`));
      canvas.appendChild(label);
    }
  }

  const caption = illustration?.caption.trim()
    || 'Brak wybranego magazynu energii w wybranym zestawie.';
  canvas.appendChild(svgShape(document, 'rect', {
    x: '30', y: '94', width: '535', height: '14.667', fill: '#ffffff', 'fill-opacity': '0.9',
  }));
  const captionText = svgShape(document, 'text', {
    x: '40', y: '104.5', fill: '#2b3674', 'font-family': 'DM Sans', 'font-size': '7.2',
    'font-weight': '500',
  });
  const captionLines = wrapText(caption, font('DMSans-Regular.ttf'), 7.2, 515);
  captionLines.slice(0, 2).forEach((line, index) => {
    const span = svgShape(document, 'tspan', { x: '40', y: String(104.5 + index * 8.1) });
    span.appendChild(document.createTextNode(line));
    captionText.appendChild(span);
  });
  canvas.appendChild(captionText);

  sourceFields.add('draft.selectedTemplateIds');
  if (illustration) sourceFields.add('workspace.templates.selectedStorageProduct');
  if (illustration?.dimensions) sourceFields.add('workspace.templates.selectedStorageProduct.dimensions');
  if (illustration?.missingReason) {
    addV4Missing(missing, 2, 'workspace.templates.selectedStorageProduct.dimensions', illustration.missingReason);
  }
}

function setV4WrappedField(element: XmlElement, value: string, maxWidth: number, maxLines: number, minimumFontSize = 6) {
  const spans = Array.from(element.getElementsByTagName('tspan')) as XmlElement[];
  if (!spans.length) return false;
  const typeface = fontFor(element);
  const minSize = Math.min(fontSize(element), minimumFontSize);
  let size = fontSize(element);
  let lines = wrapText(value, typeface, size, maxWidth);
  while (lines.length > maxLines && size > minSize) {
    size = Math.max(minSize, size - 0.25);
    lines = wrapText(value, typeface, size, maxWidth);
  }
  const truncated = lines.length > maxLines;
  if (truncated) {
    lines = lines.slice(0, maxLines);
    let last = Array.from(lines[maxLines - 1]);
    while (last.length && typeface.getAdvanceWidth(`${last.join('')}…`, size) > maxWidth) last.pop();
    lines[maxLines - 1] = `${last.join('').trimEnd()}…`;
  }
  const x = spans[0].getAttribute('x') || '0';
  const firstY = Number(spans[0].getAttribute('y') || 0);
  const lineHeight = Math.min(9, size * 1.15);
  while (spans.length < lines.length) {
    const span = spans[0].cloneNode(false) as XmlElement;
    span.removeAttribute('id');
    element.appendChild(span);
    spans.push(span);
  }
  spans.forEach((span, index) => {
    span.setAttribute('x', x);
    span.setAttribute('y', String(firstY + index * lineHeight));
    span.setAttribute('font-size', String(size));
    setElementText(span, lines[index] || '');
  });
  return truncated;
}

function textOrigin(element: XmlElement, axis: 'x' | 'y') {
  const transform = element.getAttribute('transform') || '';
  const translate = /translate\(\s*([-+\d.]+)(?:[ ,]+([-+\d.]+))?\s*\)/.exec(transform);
  const offset = translate ? Number(axis === 'x' ? translate[1] : translate[2] || 0) : 0;
  const span = element.getElementsByTagName('tspan')[0] as XmlElement | undefined;
  const own = Number(span?.getAttribute(axis) ?? element.getAttribute(axis));
  return offset + (Number.isFinite(own) ? own : 0);
}

function visibleUnitTextElement(unit: XmlElement) {
  if ((unit.localName || unit.tagName) === 'text') return unit;
  return (Array.from(unit.getElementsByTagName('text')) as XmlElement[])
    .find((element) => (element.textContent || '').trim()) || unit;
}

function fitV4NumberBeforeUnit(element: XmlElement | null, extraLeft = 0) {
  if (!element || !/^[+\-−]?\d[\d\s]*(?:[.,]\d+)?$/.test((element.textContent || '').trim())) return false;
  const parent = element.parentNode as XmlElement | null;
  if (!parent) return false;
  const siblings = Array.from(parent.childNodes).filter((node) => node.nodeType === 1).map((node) => node as XmlElement);
  const fieldIndex = siblings.indexOf(element);
  const isUnit = (sibling: XmlElement) => /(?:PLN|kWh|kWp|brutto|%)/i.test(sibling.textContent || '');
  const unit = siblings.slice(fieldIndex + 1).find(isUnit)
    || siblings.slice(0, fieldIndex).reverse().find(isUnit);
  if (!unit) return false;
  const unitText = visibleUnitTextElement(unit);
  const unitX = textOrigin(unitText, 'x');
  const elementX = textOrigin(element, 'x');
  const endX = unitX - 2;
  const available = endX - (elementX - extraLeft);
  if (!(available > 0)) return false;
  const typeface = fontFor(element);
  const spans = Array.from(element.getElementsByTagName('tspan')) as XmlElement[];
  if (!spans.length) return false;
  const value = (element.textContent || '').trim();
  const id = element.getAttribute('id') || '';
  const preserveRateSize = /(?:srednia_cena|koszt_zakupu_1kwh|strefa_.*cena_kwh|autokonsumpcja_z_pv_procent)/i.test(id)
    || unitText.textContent?.trim() === '%';
  let size = fontSize(element);
  while (!preserveRateSize && size > 5.25 && typeface.getAdvanceWidth(value, size) > available) {
    size = Math.max(5.25, size - 0.25);
  }
  const firstSpanX = Number(spans[0].getAttribute('x') || 0);
  const elementOffsetX = elementX - firstSpanX;
  element.setAttribute('font-family', 'DM Sans');
  element.setAttribute('font-variant-numeric', 'tabular-nums');
  spans.forEach((span) => {
    span.setAttribute('font-size', String(size));
    span.setAttribute('x', String(endX - elementOffsetX));
    span.setAttribute('text-anchor', 'end');
    span.setAttribute('font-variant-numeric', 'tabular-nums');
  });
  unitText.setAttribute('font-family', 'DM Sans');
  unitText.setAttribute('font-size', String(size));
  unitText.getElementsByTagName('tspan').length && Array.from(unitText.getElementsByTagName('tspan'))
    .forEach((span) => span.setAttribute('font-size', String(size)));
  return preserveRateSize || typeface.getAdvanceWidth(value, size) <= available;
}

function alignV4FinancialSummaryAmounts(document: XmlDocument) {
  const fields = [
    '#b2c_twoj_aktualny_rachunek_roczny_strona_09',
    '#b2c_twoj_nowy_rachunek_z_systemem_strona_09',
    '#b2c_oszczednosc_strona_09',
    '#b2c_laczna_zgromadzona_wartosc_depozytu_strona_09',
    '#b2c_oplaty_stale_i_dystrybucyjne_strona_09',
    '#b2c_laczna_wykorzystana_wartosc_depozytu_na_pokrycie_energii_pobranej_strona_09',
    '#b2c_wartosc_energii_pobranej_niepokrytej_z_depozytu_strona_09',
    '#b2c_niewykorzystana_wartosc_depozytu_strona_09',
    '#b2c_zwrot_30_wartosci_strona_09',
  ];
  const amountRight = 550;
  for (const id of fields) {
    const amount = uniqueElementById(document, id);
    const span = amount?.getElementsByTagName('tspan')[0] as XmlElement | undefined;
    if (!amount || !span) continue;
    const size = fontSize(amount);
    amount.setAttribute('font-family', 'DM Sans');
    amount.setAttribute('font-variant-numeric', 'tabular-nums');
    span.setAttribute('x', String(amountRight));
    span.setAttribute('text-anchor', 'end');
    span.setAttribute('font-size', String(size));
    span.setAttribute('font-variant-numeric', 'tabular-nums');
  }
}

function setV4InlineTextPosition(element: XmlElement, x: number, anchor: 'start' | 'end', size: number) {
  const span = element.getElementsByTagName('tspan')[0] as XmlElement | undefined;
  if (!span) return;
  const elementX = textOrigin(element, 'x');
  const originalSpanX = Number(span.getAttribute('x') || 0);
  span.setAttribute('x', String(x - (elementX - originalSpanX)));
  span.setAttribute('text-anchor', anchor);
  span.setAttribute('font-size', String(size));
  span.setAttribute('font-variant-numeric', 'tabular-nums');
  element.setAttribute('font-family', 'DM Sans');
  element.setAttribute('font-size', String(size));
  element.setAttribute('font-variant-numeric', 'tabular-nums');
}

function layoutV4AutoconsumptionSummary(document: XmlDocument, page: 3 | 4) {
  const suffix = page === 3 ? 'strona_03' : 'prognozowana_strona_04';
  const amountId = `#b2c_autokonsumpcja_z_pv_${suffix}`;
  const percentId = page === 3
    ? '#b2c_autokonsumpcja_z_pv_procent_strona_03'
    : '#b2c_autokonsumpcja_z_pv_prognozowana_procent_strona_04';
  const amount = uniqueElementById(document, amountId);
  const separator = uniqueElementById(document, 'stale / tekst_2');
  const percent = uniqueElementById(document, percentId);
  const percentUnit = uniqueElementById(document, 'stale / jednostka lub dopisek_9');
  if (!amount || !separator || !percent || !percentUnit) return;

  const amountValue = (amount.textContent || '').trim();
  const percentValue = (percent.textContent || '').trim();
  const typeface = fontFor(amount);
  let size = fontSize(amount);
  const amountSpan = amount.getElementsByTagName('tspan')[0] as XmlElement | undefined;
  if (!amountSpan) return;
  const firstX = textOrigin(amount, 'x') - Number(amountSpan.getAttribute('x') || 0);
  const gap = 4;
  const measureWidth = (text: string) => typeface.getAdvanceWidth(text, size);
  const totalWidth = () => measureWidth(amountValue) + gap + measureWidth('kWh /') + gap
    + measureWidth(percentValue) + gap + measureWidth('%');
  while (size > 6.5 && totalWidth() > 63) size = Math.max(6.5, size - 0.25);

  setElementText(separator, 'kWh /');
  const separatorX = firstX + measureWidth(amountValue) + gap;
  const percentX = separatorX + measureWidth('kWh /') + gap;
  const unitX = percentX + measureWidth(percentValue) + gap;
  setV4InlineTextPosition(amount, firstX, 'start', size);
  setV4InlineTextPosition(separator, separatorX, 'start', size);
  setV4InlineTextPosition(percent, percentX, 'start', size);
  setV4InlineTextPosition(percentUnit, unitX, 'start', size);
}

function layoutV4AnnualFinancialSummary(
  document: XmlDocument,
  fields: OfferTemplateV4FieldBinding[],
  mapped: Map<string, MappedValue>,
) {
  for (const field of fields) {
    const semantic = v4Semantic(field.id);
    if (!/(?:srednia_cena|wartosc_energii)/.test(semantic)) continue;
    const element = uniqueElementById(document, field.id);
    if (!element) continue;
    if (mapped.get(field.id)?.value === 'Nie dotyczy') {
      setV4InlineTextPosition(element, semantic.includes('srednia_cena') ? 550 : 380, 'end', fontSize(element));
      continue;
    }
    const isRate = semantic.includes('srednia_cena');
    const parent = element.parentNode as XmlElement | null;
    if (!parent) continue;
    const siblings = Array.from(parent.childNodes).filter((node) => node.nodeType === 1) as XmlElement[];
    const index = siblings.indexOf(element);
    const unit = siblings.slice(index + 1).find((sibling) => isRate
      ? /PLN\/kWh/i.test(sibling.textContent || '')
      : /PLN/i.test(sibling.textContent || ''));
    if (!unit) continue;
    const unitText = visibleUnitTextElement(unit);
    const size = fontSize(element);
    setV4InlineTextPosition(element, isRate ? 510 : 358, 'end', size);
    setV4InlineTextPosition(unitText, isRate ? 514 : 362, 'start', size);
  }
}

function layoutV4SavingsPercent(document: XmlDocument) {
  const prefix = uniqueElementById(document, 'stale / tekst');
  const percent = uniqueElementById(document, '#b2c_oszczednosc_procent_strona_09');
  const unit = uniqueElementById(document, 'stale / jednostka lub dopisek_25');
  if (!prefix || !percent || !unit) return;
  const typeface = fontFor(percent);
  const size = fontSize(percent);
  const label = (prefix.textContent || '').trim();
  const value = (percent.textContent || '').trim();
  setElementText(prefix, label);
  const labelX = textOrigin(prefix, 'x');
  const valueX = labelX + typeface.getAdvanceWidth(label, size) + 4;
  const unitX = valueX + typeface.getAdvanceWidth(value, size) + 4;
  setV4InlineTextPosition(prefix, labelX, 'start', size);
  setV4InlineTextPosition(percent, valueX, 'start', size);
  setV4InlineTextPosition(unit, unitX, 'start', size);
}

function summaryPurchaseValue(summary: OfferWorkspaceSavingsBillSummary | null, scenario: 'baselineBill' | 'proposedBill'): MappedValue {
  const totals = summary?.totals;
  return totals
    ? calculationMoney(totals.grossPurchaseEnergyCostPln + totals.grossPurchaseDistributionCostPln,
      `calculation.${scenario}.totals.grossPurchaseEnergyCostPln+grossPurchaseDistributionCostPln`)
    : null;
}

function summaryPurchaseRate(summary: OfferWorkspaceSavingsBillSummary | null, scenario: 'baselineBill' | 'proposedBill'): MappedValue {
  const energy = summary?.totals.averageEnergyPurchasePlnPerKwh;
  const distribution = summary?.totals.averageDistributionPurchasePlnPerKwh;
  return energy !== null && energy !== undefined && distribution !== null && distribution !== undefined
    ? calculationRate(energy + distribution,
      `calculation.${scenario}.totals.grossPurchaseEnergyCostPln+grossPurchaseDistributionCostPln/rateBasisImportKwh`)
    : null;
}

function summaryExportValue(summary: OfferWorkspaceSavingsBillSummary | null, settlement: string | null, scenario: 'baselineBill' | 'proposedBill'): MappedValue {
  if (settlement === 'NET_METERING') return { value: 'Nie dotyczy', source: `${scenario}.settlement.NET_METERING` };
  return settlement === 'NET_BILLING'
    ? calculationMoney(summary?.totals.depositEarnedPln, `calculation.${scenario}.totals.depositEarnedPln`)
    : null;
}

function summaryExportRate(summary: OfferWorkspaceSavingsBillSummary | null, settlement: string | null, scenario: 'baselineBill' | 'proposedBill'): MappedValue {
  const totals = summary?.totals;
  if (settlement === 'NET_METERING') return { value: 'Nie dotyczy', source: `${scenario}.settlement.NET_METERING` };
  if (settlement === 'NET_BILLING' && totals && totals.billedExportKwh <= 0) {
    return { value: 'Nie dotyczy', source: `calculation.${scenario}.totals.billedExportKwh.zero` };
  }
  return settlement === 'NET_BILLING' && totals && totals.billedExportKwh > 0
    ? calculationRate(totals.depositEarnedPln / totals.billedExportKwh,
      `calculation.${scenario}.totals.depositEarnedPln/billedExportKwh`)
    : null;
}

function summaryFinancialField(
  semantic: string,
  summary: OfferWorkspaceSavingsBillSummary | null,
  settlement: string | null,
  scenario: 'baselineBill' | 'proposedBill',
): MappedValue {
  if (semantic.includes('wartosc_energii_pobranej')) return summaryPurchaseValue(summary, scenario);
  if (semantic.includes('srednia_cena_1kwh_pln')) return summaryPurchaseRate(summary, scenario);
  if (semantic.includes('wartosc_energii_oddanej')) return summaryExportValue(summary, settlement, scenario);
  if (semantic.includes('srednia_cena_1_kwh_pln')) return summaryExportRate(summary, settlement, scenario);
  return null;
}

function isSummaryFinancialField(semantic: string) {
  return /wartosc_energii_(?:oddanej|pobranej)|srednia_cena_1_?kwh_pln/.test(semantic);
}

function annualBillPlotY(document: XmlDocument, value: number, axisMaximum: number) {
  const tickIds = [
    '_wskaznik_1_2', '_wskaznik_2_2', '_wskaznik_3_2', '_wskaznik_1', '_wskaznik_2',
    '_wskaznik_3', '_wskaznik_4', '_wskaznik_5', '_wskaznik_4_2', '_wskaznik_5_2',
  ];
  const baselinePath = elementById(document, '_poziomy_wykres')?.getAttribute('d') || '';
  const baselineMatch = /^M\s*[-+\d.]+[ ,]+([-+\d.]+)/.exec(baselinePath);
  const baselineY = baselineMatch ? Number(baselineMatch[1]) : Number.NaN;
  const tickYs = [baselineY, ...tickIds.map((id) => {
    const path = elementById(document, id)?.getAttribute('d') || '';
    const match = /^M\s*[-+\d.]+[ ,]+([-+\d.]+)/.exec(path);
    return match ? Number(match[1]) : Number.NaN;
  })];
  if (!tickYs.every(Number.isFinite) || !(axisMaximum > 0)) return null;

  const tickPosition = value / axisMaximum * (tickYs.length - 1);
  const lowerTick = Math.min(Math.floor(tickPosition), tickYs.length - 2);
  const fraction = tickPosition - lowerTick;
  return tickYs[lowerTick] + (tickYs[lowerTick + 1] - tickYs[lowerTick]) * fraction;
}

type V4AxisTick = { element: XmlElement; value: number; y: number };

function numericAxisValue(element: XmlElement) {
  const normalized = (element.textContent || '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^[+\-\d.]+$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function v4AxisTicks(plot: XmlElement | null): V4AxisTick[] {
  if (!plot) return [];
  return (Array.from(plot.getElementsByTagName('text')) as XmlElement[])
    .flatMap((element) => {
      const value = numericAxisValue(element);
      const y = textOrigin(element, 'y');
      return value !== null && Number.isFinite(y) ? [{ element, value, y }] : [];
    })
    .sort((left, right) => left.value - right.value);
}

function v4AxisY(value: number, axisMaximum: number, ticks: V4AxisTick[]) {
  if (!(axisMaximum > 0) || ticks.length < 2) return null;
  const position = Math.max(0, Math.min(ticks.length - 1, value / axisMaximum * (ticks.length - 1)));
  const lower = Math.min(Math.floor(position), ticks.length - 2);
  const fraction = position - lower;
  return ticks[lower].y + (ticks[lower + 1].y - ticks[lower].y) * fraction;
}

function setV4AxisLabels(ticks: V4AxisTick[], maximum: number, digits: number) {
  ticks.forEach((tick, index) => setElementText(tick.element,
    formatNumber(maximum * index / Math.max(1, ticks.length - 1), digits)));
}

function appendStackedV4Bar(
  document: XmlDocument,
  plot: XmlElement,
  groupId: string,
  barId: string,
  x: number,
  width: number,
  components: Array<{ key: string; label: string; value: number; color: string }>,
  maximum: number,
  ticks: V4AxisTick[],
) {
  if (!components.length || components.some((component) => !validChartValue(component.value))) return false;
  const series = svgShape(document, 'g', { id: groupId });
  let accumulated = 0;
  for (const component of components) {
    const lowerY = v4AxisY(accumulated, maximum, ticks);
    accumulated += component.value;
    const upperY = v4AxisY(accumulated, maximum, ticks);
    if (lowerY === null || upperY === null) return false;
    const bar = svgShape(document, 'rect', {
      id: `${barId}-${component.key}`, x: String(x), y: String(upperY), width: String(width),
      height: String(Math.max(0, lowerY - upperY)), fill: component.color, 'fill-opacity': '0.78',
    });
    const title = svgShape(document, 'title', {});
    title.appendChild(document.createTextNode(`${component.label}: ${formatNumber(component.value, 2)} PLN`));
    bar.appendChild(title);
    series.appendChild(bar);
  }
  plot.appendChild(series);
  return true;
}

function appendV4FinancialComparisonCharts(
  document: XmlDocument,
  baseline: OfferWorkspaceSavingsBillSummary | null,
  proposed: OfferWorkspaceSavingsBillSummary | null,
  calculation: OfferWorkspaceCalculation | undefined,
  sourceFields: Set<string>,
) {
  const unitCharts = [
    { id: 'wykres_png / b2c / strona_09 / koszt_kwh_aktualny', suffix: 'current', x: 66, summary: baseline },
    { id: 'wykres_png / b2c / strona_09 / koszt_kwh_prognoza', suffix: 'proposed', x: 337, summary: proposed },
  ];
  const unitMaximum = Math.max(1.2, niceAxisMaximum(Math.max(
    ...unitCharts.map(({ summary }) => summary
      ? (summary.totals.averageEnergyPurchasePlnPerKwh || 0) + (summary.totals.averageDistributionPurchasePlnPerKwh || 0)
      : 0),
  ) / 1.05));
  for (const chart of unitCharts) {
    const plot = uniqueElementById(document, chart.id);
    const energy = chart.summary?.totals.averageEnergyPurchasePlnPerKwh;
    const distribution = chart.summary?.totals.averageDistributionPurchasePlnPerKwh;
    if (!plot || energy == null || distribution == null) continue;
    const ticks = v4AxisTicks(plot);
    if (ticks.length < 2) continue;
    setV4AxisLabels(ticks, unitMaximum, 2);
    if (appendStackedV4Bar(document, plot, `workspace-calculated-unit-cost-${chart.suffix}`,
      `workspace-calculated-unit-cost-${chart.suffix}`, chart.x, 11.46, [
        { key: 'distribution', label: 'Dystrybucja', value: distribution, color: '#FDB066' },
        { key: 'energy', label: 'Energia', value: energy, color: '#FC7C00' },
      ], unitMaximum, ticks)) {
      sourceFields.add(`calculation.${chart.suffix === 'current' ? 'baselineBill' : 'proposedBill'}.totals.grossPurchaseEnergyCostPln/grossPurchaseDistributionCostPln/rateBasisImportKwh`);
    }
  }

  const billCharts = [
    { id: 'wykres_png / b2c / strona_09 / rachunek_aktualny', suffix: 'current', x: 70, summary: baseline,
      amount: calculation?.baselineAnnualCostPln, color: '#FF9D98' },
    { id: 'wykres_png / b2c / strona_09 / rachunek_prognoza', suffix: 'proposed', x: 340.01, summary: proposed,
      amount: calculation?.proposedAnnualCostPln, color: '#00D477' },
  ];
  const billMaximum = niceAxisMaximum(Math.max(...billCharts.map(({ amount }) => validChartValue(amount) ? amount : 0)) / 1.05);
  for (const chart of billCharts) {
    const plot = uniqueElementById(document, chart.id);
    const totals = chart.summary?.totals;
    if (!plot || !validChartValue(chart.amount)) continue;
    const ticks = v4AxisTicks(plot);
    if (ticks.length < 2) continue;
    setV4AxisLabels(ticks, billMaximum, 0);
    const componentTotal = totals
      ? totals.paidEnergyCostPln + totals.paidDistributionCostPln + totals.paidFixedCostPln : Number.NaN;
    const componentsMatchAnnual = Number.isFinite(componentTotal) && Math.abs(componentTotal - chart.amount) <= 0.01;
    if (appendStackedV4Bar(document, plot, `workspace-calculated-annual-bill-${chart.suffix}`,
      `workspace-calculated-annual-bill-${chart.suffix}`, chart.x, 12, [
        ...(componentsMatchAnnual && totals ? [
          { key: 'fixed', label: 'Opłaty stałe', value: totals.paidFixedCostPln, color: '#FECB99' },
          { key: 'distribution', label: 'Dystrybucja', value: totals.paidDistributionCostPln, color: '#FDB066' },
          { key: 'energy', label: 'Energia', value: totals.paidEnergyCostPln, color: '#FC7C00' },
        ] : [
          { key: 'total', label: 'Rachunek roczny', value: chart.amount, color: chart.color },
        ]),
      ], billMaximum, ticks)) {
      sourceFields.add(`calculation.${chart.suffix === 'current' ? 'baselineAnnualCostPln' : 'proposedAnnualCostPln'}`);
      if (componentsMatchAnnual) {
        sourceFields.add(`calculation.${chart.suffix === 'current' ? 'baselineBill' : 'proposedBill'}.totals.paidEnergyCostPln/paidDistributionCostPln/paidFixedCostPln`);
      }
    }
  }
}

function appendAnnualBillComparison(document: XmlDocument, calculation: OfferWorkspaceCalculation | undefined) {
  const plot = uniqueElementById(document, 'grafika / slupki_oszczednosci');
  const baselineCost = calculation?.baselineAnnualCostPln;
  const proposedCost = calculation?.proposedAnnualCostPln;
  if (!plot || !validChartValue(baselineCost) || !validChartValue(proposedCost)) return false;

  removeDataShapes(plot);
  for (const id of ['_przerywana_1', '_przerywana_2', '_strzalka']) removeElement(elementByIdWithin(plot, id));
  const tickIds = [
    '_wartosc_1', '_wartosc_2_2', '_wartosc_4_3', '_wartosc_4_2', '_wartosc_2', '_wartosc_3',
    '_wartosc_4', '_wartosc_5', '_wartosc_6', '_wartosc_5_2', '_wartosc_6_2',
  ];
  const axisMaximum = setPlotAxis(
    plot,
    Math.max(baselineCost, proposedCost) / 1.05,
    tickIds,
    0,
    (id) => elementById(document, id),
  );
  const baselineY = annualBillPlotY(document, 0, axisMaximum);
  if (baselineY === null) return false;
  const series = svgShape(document, 'g', { id: 'workspace-calculated-annual-bill-comparison' });
  const entries = [
    { id: 'workspace-calculated-current-annual-cost', x: 113, value: baselineCost, label: 'Aktualnie', title: 'Rachunek roczny aktualny', color: '#FF9D98' },
    { id: 'workspace-calculated-proposed-annual-cost', x: 162, value: proposedCost, label: 'Z systemem', title: 'Rachunek roczny z systemem', color: '#029B46' },
  ];
  for (const entry of entries) {
    const y = annualBillPlotY(document, entry.value, axisMaximum);
    if (y === null) return false;
    const height = baselineY - y;
    const bar = svgShape(document, 'rect', {
      id: entry.id, x: String(entry.x), y: String(y), width: '24', height: String(height),
      fill: entry.color, 'fill-opacity': '0.65',
    });
    const title = svgShape(document, 'title', {});
    title.appendChild(document.createTextNode(`${entry.title}: ${formatNumber(entry.value, 2)} PLN`));
    bar.appendChild(title);
    series.appendChild(bar);
    const label = svgShape(document, 'text', {
      id: `${entry.id}-label`, x: String(entry.x + 12), y: '768.5', 'text-anchor': 'middle',
      fill: '#2B3674', 'font-family': 'DM Sans', 'font-size': '5.5',
    });
    label.appendChild(document.createTextNode(entry.label));
    series.appendChild(label);
  }
  plot.appendChild(series);
  return true;
}

function renderOfferWorkspaceDocumentV4(
  workspace: OfferWorkspaceDocumentData,
  draft: OfferWorkspaceDraft,
  options: OfferWorkspaceDocumentOptions,
): OfferWorkspaceDocumentResult {
  const manifest = inspectOfferTemplateV4();
  const missing = new Map<string, OfferWorkspaceDocumentMissingData>();
  const sourceFields = new Set<string>();
  const suppressedCharts: OfferWorkspaceDocumentResult['suppressedCharts'] = [];
  if (workspace.energy) {
    sourceFields.add('energy.quality');
    sourceFields.add('energy.source');
    sourceFields.add('energy.model');
    sourceFields.add('energy.issues');
  } else if (workspace.energy === null) sourceFields.add('energy.unavailable');
  if (workspace.calculation) {
    sourceFields.add('calculation.status');
    sourceFields.add('calculation.reasons');
    sourceFields.add('calculation.warnings');
  }
  const calculationForResults = workspace.calculation?.status === 'ready' ? workspace.calculation : undefined;
  const effectiveTemplates = applyOfferWorkspaceConfigurationEdits(workspace.templates, draft);
  const illustrationTemplates = effectiveTemplates
    .filter(template => !(draft.selectedTemplateIds.includes(template.id)
      && template.kind === 'MAGAZYN'
      && hasRemovedCriticalConfigurationItem(workspace.templates, draft, 'BATTERY')))
    .map(template => ({
      ...template,
      items: template.items.filter(item => !(item as typeof item & { workspaceRemoved?: boolean }).workspaceRemoved),
    }));
  const storageIllustration = hasRemovedCriticalConfigurationItem(workspace.templates, draft, 'BATTERY')
    ? {
      family: null, dataUrl: null, dimensions: null,
      caption: 'Nie pokazano ilustracji, ponieważ usunięto główne urządzenie magazynu.',
      missingReason: 'Usunięto główne urządzenie magazynu; parametry i ilustracja zestawu wymagają nowej konfiguracji.',
    }
    : resolveOfferStorageIllustration(illustrationTemplates, draft.selectedTemplateIds);
  const baselineSettlement = draft.currentSettlement ?? (
    workspace.input.settlementMode === 'NET_METERING' || workspace.input.settlementMode === 'NET_BILLING'
      ? workspace.input.settlementMode : null
  );
  const baselineSummary = calculationForResults?.baselineBill
    ? summarizeOfferSavingsBill(calculationForResults.baselineBill, baselineSettlement) : null;
  const proposedSummary = calculationForResults?.proposedBill
    ? summarizeOfferSavingsBill(calculationForResults.proposedBill, draft.targetSettlement) : null;
  const { pricing, rows: selectedRows } = selectedProductRows(workspace, draft);
  if (draft.configurationEdits?.length) sourceFields.add('draft.configurationEdits');
  const displayRows = page10DisplayRows(selectedRows, pricing);
  if (selectedRows.length) {
    sourceFields.add('workspace.clientType');
    sourceFields.add('draft.saleVatMode');
    sourceFields.add('templates.items.operatingCostNet');
    sourceFields.add('templates.items.marginRate');
    if (selectedRows.some((row) => row.resolvedCosts !== null && row.productName !== null)) sourceFields.add('templates.items.product.prices');
    if (selectedRows.some((row) => row.resolvedCosts !== null && row.productName === null)) sourceFields.add('templates.items.unitPurchaseNet');
  }

  const pages = manifest.pages.map((pageManifest) => {
    const page = pageManifest.page;
    const pathToSource = path.join(process.cwd(), 'assets', 'offer-templates', 'REFORM_B2C', '2026_10_V4', pageManifest.file);
    const sourceBytes = readFileSync(pathToSource);
    if (createHash('sha256').update(sourceBytes).digest('hex') !== pageManifest.sourceSha256) {
      throw new Error(`Hash źródłowego SVG V4 strony ${page} zmienił się podczas renderowania.`);
    }
    const sourceDocument = parseSvg(sourceBytes.toString('utf8'), page);
    const values: Record<string, string> = {};
    const mapped = new Map<string, MappedValue>();
    const monthlyValues = new Map<string, number | null>();
    for (const field of pageManifest.fields) {
      const sourceElement = uniqueElementById(sourceDocument, field.id);
      if (!sourceElement) throw new Error(`Nie znaleziono jawnego pola ${field.id}.`);
      const value = mapV4Field(page, field.id, sourceElement.textContent || '', workspace, draft, displayRows, pricing,
        calculationForResults, options.tariffLabels, baselineSummary, proposedSummary, storageIllustration);
      mapped.set(field.id, value);
      values[field.id] = value?.value ?? '—';
      if ((page === 3 || page === 4) && v4AnnualMonthlyCell(page, field.id)) {
        monthlyValues.set(field.id, value?.numericValue ?? null);
      }
      if (value?.source.startsWith('unknown.')) {
        addV4Missing(missing, page, field.id, v4MissingReason(page, v4Semantic(field.id), Boolean(calculationForResults)));
      } else if (value) {
        value.source.split('|').forEach((source) => sourceFields.add(source));
      } else {
        addV4Missing(missing, page, field.id, v4MissingReason(page, v4Semantic(field.id), Boolean(calculationForResults)));
      }
    }

    const rendered = renderOfferTemplateV4Page(page, values);
    const document = parseSvg(rendered.svg, page);
    if (page === 2) appendStorageIllustration(document, storageIllustration, sourceFields, missing);
    if (page === 2) {
      const description = replaceV4DraftDescription(document, draft);
      if (draft.description.before.trim()) sourceFields.add('draft.description.before');
      else addV4Missing(missing, page, 'draft.description.before', 'Opis dla wariantu przed nie został podany.');
      if (draft.description.after.trim()) sourceFields.add('draft.description.after');
      else addV4Missing(missing, page, 'draft.description.after', 'Opis dla wariantu po nie został podany.');
      if (description.beforeTruncated || description.afterTruncated) {
        addV4Missing(missing, page, 'draft.description.truncated', 'Opis został skrócony, aby zmieścić się w panelu strony.');
      }
    }
    if (page === 3 || page === 4) {
      setV4MonthlyValueFont(document, pageManifest.fields);
      setV4AnnualMonthlyCellShading(document, page, pageManifest.fields, monthlyValues);
    }
    if (page === 3) {
      const period = uniqueElementById(document, '#b2c_okres_strona_03');
      const closingParenthesis = uniqueElementById(document, 'stale / jednostka lub dopisek');
      const periodText = (period?.textContent || '—').trim();
      setElementText(period, `${periodText})`);
      setElementText(closingParenthesis, '');
    }
    if (page >= 5 && page <= 8) {
      const periodField = pageManifest.fields.find((field) => v4Semantic(field.id).endsWith('_okres'));
      const period = periodField ? uniqueElementById(document, periodField.id) : null;
      const periodValue = periodField ? mapped.get(periodField.id)?.value : null;
      if (period) {
        setElementText(period, `${periodValue || '—'})`);
        setElementText(uniqueElementById(document, 'stale / jednostka lub dopisek'), '');
      }
    }
    if (page === 1) {
      const field = pageManifest.fields.find((item) => mapped.get(item.id)?.source === 'documentContext.tariffLabels.currentOperator');
      const value = field ? mapped.get(field.id) : null;
      const element = field ? uniqueElementById(document, field.id) : null;
      if (field && value && element && setV4WrappedField(element, value.value, 160, 1)) {
        addV4Missing(missing, page, field.id, 'Nazwa operatora została skrócona, aby zmieściła się w polu.');
      }
      const addressField = pageManifest.fields.find((item) => v4Semantic(item.id) === 'b2c_adres_report');
      const addressValue = addressField ? mapped.get(addressField.id) : null;
      const addressElement = addressField ? uniqueElementById(document, addressField.id) : null;
      if (addressField && addressValue && addressElement
        && setV4WrappedField(addressElement, addressValue.value, 130, 2, 8)) {
        addV4Missing(missing, page, addressField.id, 'Adres został skrócony, aby zmieścił się w polu.');
      }
    }
    if (page === 9) {
      const baseline = calculationForResults?.baselineAnnualCostPln;
      const savings = calculationForResults?.annualSavingsPln;
      const savingsPercent = baseline !== null && baseline !== undefined && baseline > 0
        && savings !== null && savings !== undefined && Number.isFinite(savings)
        ? `${savings >= 0 ? '+' : ''}${formatNumber(savings / baseline * 100, 1)}%` : '';
      const percentElement = uniqueElementById(document, '_oszczednosc_%');
      setElementText(percentElement, savingsPercent);
      if (percentElement && savingsPercent && setV4WrappedField(percentElement, savingsPercent, 25, 1)) {
        addV4Missing(missing, page, 'calculation.annualSavingsPln/calculation.baselineAnnualCostPln',
          'Procent oszczędności został skrócony, aby zmieścić się przy słupkach.');
      }
      const estimatedPayback = calculationForResults?.estimatedPaybackYears;
      const paybackText = typeof estimatedPayback === 'number' && Number.isFinite(estimatedPayback) && estimatedPayback >= 0
        ? `Szacowany okres zwrotu sprzętu: ok. ${formatNumber(estimatedPayback, 1)} lat.`
        : 'Szacowany okres zwrotu: brak wyniku.';
      const growthRate = calculationForResults?.estimatedAnnualPriceGrowthRate;
      const growthText = typeof growthRate === 'number' && Number.isFinite(growthRate)
        && calculationForResults?.estimatedAnnualExportPriceGrowthRate === 0
        ? `Ta sama taryfa docelowa; zakup, dystrybucja i opłaty stałe +${formatNumber(growthRate * 100, 1)}%/rok, cena oddania bez wzrostu.`
        : 'Założenia wzrostu cen nie są zapisane w wyniku.';
      const description = uniqueElementById(document, '_opis_oferty_opis');
      if (description && setV4WrappedField(description, `Kalkulacja ma charakter szacunkowy. ${paybackText} ${growthText}`, 515, 3)) {
        addV4Missing(missing, page, 'calculation.estimatedPaybackYears/estimatedAnnualPriceGrowthRate',
          'Opis zwrotu i założeń wzrostu cen został skrócony, aby zmieścił się w polu.');
      }
      if (!calculationForResults || estimatedPayback == null || !Number.isFinite(estimatedPayback) || estimatedPayback < 0) {
        addV4Missing(missing, page, 'calculation.estimatedPaybackYears',
          'Brak oszacowanego okresu zwrotu; nie zastąpiono go prostym zwrotem z pierwszego roku.');
      }
      replaceTextMatching(document, /^Prognozowana kwota dotacji z Programu “Mój Przydomowy Magazyn Energii”$/, 'Dotacja do potwierdzenia');
      replaceTextMatching(document, /^Prognozowana ulga termomodernizacyjna\s*$/, 'Ulga do potwierdzenia');
      replaceTextMatching(document, /^Prognozowany koszt sytemu po dofinansowaniach$/, 'Koszt po finansowaniu do ustalenia');
      for (const group of pageManifest.semanticGroups.filter((item) => item.id.startsWith('sekcja /'))) {
        removeDataShapes(uniqueElementById(document, group.id));
      }
      const chartRendered = appendAnnualBillComparison(document, calculationForResults);
      if (!chartRendered) {
        addV4Missing(missing, page, 'calculation.baselineAnnualCostPln/calculation.proposedAnnualCostPln',
          calculationForResults ? 'Brak nieujemnych rocznych wartości rachunku do wykresu.' : 'Brak gotowej kalkulacji finansowej.' );
        suppressedCharts.push({ page, reason: calculationForResults
          ? 'Brak poprawnych rocznych kosztów do wykresu; przykładowe serie finansowe wyczyszczono.'
          : 'Brak gotowego wyniku kalkulacji; przykładowe serie finansowe wyczyszczono.' });
      } else {
        suppressedCharts.push({ page, reason: 'Wykres oszczędności używa rocznych kosztów z kalkulacji; porównania składowych kosztów zakupu i rachunków korzystają z podsumowań calculation.baselineBill/proposedBill.' });
      }
      appendV4FinancialComparisonCharts(document, baselineSummary, proposedSummary, calculationForResults, sourceFields);
      for (const field of pageManifest.fields) {
        const value = mapped.get(field.id);
        if (!value?.source.startsWith('documentContext.tariffLabels.')) continue;
        const element = uniqueElementById(document, field.id);
        if (element && setV4WrappedField(element, value.value, 250, 1)) {
          addV4Missing(missing, page, field.id, 'Nazwa taryfy została skrócona, aby zmieściła się w nagłówku.');
        }
      }
    }
    if (page === 10) {
      const labelUpdates: Array<[RegExp, string, number | null | undefined]> = [
        [/^Prognozowana kwota dotacji z Programu “Mój Przydomowy Magazyn Energii”$/, 'Dotacja do potwierdzenia', calculationForResults?.grantPln],
        [/^Prognozowana ulga termomodernizacyjna\s*$/, 'Ulga do potwierdzenia', calculationForResults?.taxReliefPln],
        [/^Prognozowany koszt sytemu po dofinansowaniach$/, 'Koszt po finansowaniu do ustalenia', calculationForResults?.costAfterFinancingPln],
      ];
      for (const [pattern, missingLabel, amount] of labelUpdates) {
        if (amount == null || !Number.isFinite(amount)) replaceTextMatching(document, pattern, missingLabel);
      }
      if (workspace.clientType === 'B2B') replaceTextMatching(document, /^brutto$/i, 'netto');
      for (const field of pageManifest.fields) {
        const value = mapped.get(field.id);
        if (!value?.source.startsWith('template.pricing.')) continue;
        const semantic = v4Semantic(field.id);
        if (semantic.includes('_pozycja_')) {
          const element = uniqueElementById(document, field.id);
          if (element && setV4WrappedField(element, value.value, 133, 3)) {
            addV4Missing(missing, page, field.id, 'Długa nazwa pozycji została skrócona, aby zmieściła się w komórce kosztorysu.');
          }
        } else if (semantic.includes('_model_')) {
          const element = uniqueElementById(document, field.id);
          if (element && setV4WrappedField(element, value.value, 132, 3)) {
            addV4Missing(missing, page, field.id, 'Długa nazwa modelu została skrócona, aby zmieściła się w komórce kosztorysu.');
          }
        }
      }
      if (pricing.systemCostBeforeFinancing === null) {
        addV4Missing(missing, page, 'template.pricing.systemCostBeforeFinancing', pricing.calculationError
          || [...pricing.missingRequiredData, ...pricing.missingOptionalData].join('; ')
          || 'Niepełna wycena wybranego zestawu; kwot częściowych nie pokazano.');
      }
    }
    if (page === 3) {
      const hasMonthlyReadings = appendMonthlyReadings(document, workspace, sourceFields, missing, 'Group 1193', uniqueElementById);
      if (!hasMonthlyReadings) addV4Missing(missing, page, 'energy.months/measurements.months',
        'Brak kompletnych danych miesięcznych do wykresu; serie przykładowe usunięto.');
      suppressedCharts.push({ page, reason: workspace.energy?.modelledMeasurements
        ? 'Zużycie, pobór, oddanie i autokonsumpcja pochodzą z rocznego profilu RE oraz modelu istniejącej PV; nie są pomiarami.'
        : workspace.energy
        ? 'Profil miesięczny modelowany jawnie rozróżnia autokonsumpcję oraz zmierzone pobór i oddanie do sieci.'
        : 'Usunięto przykładowe serie; widoczne wartości wykresu pochodzą wyłącznie z dostępnych pomiarów.' });
    }
    if (page === 4) {
      removeDataShapes(uniqueElementById(document, 'Group 1205'));
      const hasForecastChart = calculationForResults
        ? appendMonthlyForecastReadings(document, calculationForResults, sourceFields, missing, uniqueElementById)
        : false;
      if (!hasForecastChart) addV4Missing(missing, page, 'calculation.forecastFlows/forecastEnergy/forecastMeasurements',
        'Brak miesięcznych danych prognozy; pól ani wykresu nie uzupełniono danymi bieżącymi.');
      suppressedCharts.push({ page, reason: hasForecastChart
        ? 'Wykres prognozy korzysta wyłącznie z calculation.forecastFlows albo z par forecastEnergy/forecastMeasurements.'
        : 'Strona prognozy pozostaje bez danych symulacyjnych; wartości bieżące nie są kopiowane.' });
      if (!workspace.calculation || workspace.calculation.status === 'blocked') {
        addV4Missing(missing, page, 'simulation.futureMonthlySeries', workspace.calculation?.reasons.join(' ') || 'Brak obliczeń przyszłego wariantu; wszystkie pola pozostają kreskami.');
      }
    }
    if (page >= 5 && page <= 8) {
      const dailyZones = calculationForResults ? dailyTargetTariffZones(workspace, calculationForResults, page) : null;
      setV4DailyTariffZoneLabels(document, dailyZones);
      neutralizeV4DailyTariffLabels(document);
      reflowV4DailyProposedHeader(document, page);
      const hasProfile = appendHourlyReadings(document, page, workspace, draft, sourceFields, missing, uniqueElementById, 'V4');
      if (!hasProfile) addV4Missing(missing, page, 'energy.dayProfiles/measurements.dayProfiles', 'Brak kompletnego profilu dla strony; przykładowy profil bieżący usunięto.');
      const hasForecastProfile = calculationForResults
        ? appendForecastHourlyReadings(document, page, workspace, calculationForResults, sourceFields, uniqueElementById)
        : false;
      const hasStateOfCharge = calculationForResults
        ? appendStateOfChargeReadings(document, workspace, draft, calculationForResults, page, sourceFields, uniqueElementById)
        : false;
      if (!hasStateOfCharge) addV4Missing(missing, page, 'simulation.batteryStateOfCharge',
        'Brak kompletnego 24-godzinnego stanu magazynu i jednej pojemności z wybranego zestawu; przykładowe wartości pozostają usunięte.');
      if (!hasForecastProfile) addV4Missing(missing, page, 'calculation.forecastFlows/forecastEnergy.dayProfiles',
        'Brak prognozy dla dokładnej daty bieżącego profilu; dolny wykres pozostaje bez danych.');
      suppressedCharts.push({ page, reason: hasForecastProfile
        ? 'Panel stan aktualny korzysta z workspace.energy; panel stan z systemem wyłącznie z kalkulacji dopasowanej po dacie i UTC.'
        : 'Dane bieżące trafiają wyłącznie do górnego panelu; przyszły panel nie otrzymał pasującej serii kalkulacji.' });
    }
    if (page === 9) alignV4FinancialSummaryAmounts(document);
    clearNumericPlaceholders(document);
    if (page >= 5 && page <= 9) {
      for (const field of pageManifest.fields) {
        if (mapped.get(field.id)?.value === 'Nie dotyczy') compactNotApplicableField(document, field.id);
      }
    }
    if (page === 3 || page === 4) {
      for (const field of pageManifest.fields) {
        if (mapped.get(field.id)?.value === 'Nie dotyczy') {
          compactNotApplicableField(document, field.id, 'Nie dotyczy');
        }
      }
    }
    for (const field of pageManifest.fields) {
      if (mapped.get(field.id)?.value) fitV4NumberBeforeUnit(uniqueElementById(document, field.id));
    }
    if (page === 3 || page === 4) {
      layoutV4AnnualFinancialSummary(document, pageManifest.fields, mapped);
      layoutV4AutoconsumptionSummary(document, page);
    }
    if (page === 9) layoutV4SavingsPercent(document);
    appendDraftStatusFooter(document, page, workspace.energy, sourceFields, Boolean(calculationForResults));
    injectFonts(document);
    const svg = new XMLSerializer().serializeToString(document);
    parseSvg(svg, page);
    validateSafeSvg(document, page);
    return { page, svg, sourceSha256: rendered.sourceSha256, replacedFieldKeys: rendered.replacedFieldIds };
  });

  return {
    templateKey: manifest.key,
    sourceRevision: workspace.revision,
    pageCount: OFFER_TEMPLATE_V4_PAGE_COUNT,
    pages,
    sourceFieldsUsed: Array.from(sourceFields).sort(),
    missingData: Array.from(missing.values()),
    suppressedCharts,
    limitations: [
      ...OFFER_TEMPLATE_V4_LIMITATIONS.filter((item) => !calculationForResults
        || !item.startsWith('Prognoza, rozliczenia taryfowe, dotacje, ulgi, oszczędności i zwrot')),
      ...(calculationForResults ? [
        'Wyniki obliczeń mają charakter szacunkowy; niewypełnione szczegóły pozostają wskazane w missingData.',
      ] : []),
      'Kosztorys korzysta z wyceny wybranych pozycji, indywidualnych zmian szkicu, klienta i trybu VAT; system cost jest przed finansowaniem.',
      ...(selectedRows.length > 7 ? [
        `Pozostałe pozycje (${selectedRows.length - 6}) pokazano łącznie w wierszu agregującym kosztorysu.`,
      ] : []),
      ...(!calculationForResults ? [
        'Rozliczenia taryfowe, dotacje, ulgi, oszczędności, zwrot i prognoza wymagają osobnych wyników obliczeń.',
      ] : []),
      ...(draft.targetSettlement === 'NET_BILLING' ? [
        'Wartość eksportu Net-billing oznacza kwotę przypisaną depozytowi (może uwzględniać mnożnik), nie surową cenę RCE ani gwarantowaną wypłatę.',
      ] : []),
      ...((baselineSettlement === 'NET_METERING' || draft.targetSettlement === 'NET_METERING') ? [
        'Net-metering: oddanie energii jest pokazane ilościowo; nie przypisano eksportowi fikcyjnej ceny PLN.',
      ] : []),
      ...(workspace.energy ? [
        `Dane energii: jakość ${workspace.energy.quality}; źródło: ${workspace.energy.source}; model: ${workspace.energy.model}.`,
        ...workspace.energy.issues.map((issue) => `Uwaga modelu energii: ${issue}`),
      ] : workspace.energy === null ? ['Obliczenie energii jest niedostępne; pola energii pozostają kreskami.'] : []),
      ...(workspace.calculation ? [
        ...(workspace.calculation.forecastEnergy ? [
          `Prognoza energii: jakość ${workspace.calculation.forecastEnergy.quality}; źródło: ${workspace.calculation.forecastEnergy.source}; model: ${workspace.calculation.forecastEnergy.model}.`,
          ...workspace.calculation.forecastEnergy.issues.map((issue) => `Uwaga prognozy energii: ${issue}`),
        ] : []),
        ...workspace.calculation.warnings.map((warning) => `Ostrzeżenie obliczeń: ${warning}`),
        ...(workspace.calculation.status === 'blocked'
          ? workspace.calculation.reasons.map((reason) => `Obliczenie zablokowane: ${reason}`)
          : []),
      ] : []),
    ],
  };
}

function renderOfferWorkspaceDocumentV3(
  workspace: OfferWorkspaceDocumentData,
  draft: OfferWorkspaceDraft,
): OfferWorkspaceDocumentResult {
  const manifest = inspectOfferTemplateV3();
  const missing = new Map<string, OfferWorkspaceDocumentMissingData>();
  const sourceFields = new Set<string>();
  const suppressedCharts: OfferWorkspaceDocumentResult['suppressedCharts'] = [];
  if (workspace.energy) {
    sourceFields.add('energy.quality');
    sourceFields.add('energy.source');
    sourceFields.add('energy.model');
    sourceFields.add('energy.issues');
  } else if (workspace.energy === null) {
    sourceFields.add('energy.unavailable');
  }
  const { pricing, rows: productRows } = selectedProductRows(workspace, draft);
  if (draft.configurationEdits?.length) sourceFields.add('draft.configurationEdits');
  const displayProductRows = page10DisplayRows(productRows, pricing);
  if (productRows.length) {
    sourceFields.add('workspace.clientType');
    sourceFields.add('draft.saleVatMode');
    sourceFields.add('templates.items.operatingCostNet');
    sourceFields.add('templates.items.marginRate');
    if (productRows.some((row) => row.resolvedCosts !== null && row.productName !== null)) {
      sourceFields.add('templates.items.product.prices');
    }
    if (productRows.some((row) => row.resolvedCosts !== null && row.productName === null)) {
      sourceFields.add('templates.items.unitPurchaseNet');
    }
  }
  const pages = manifest.pages.map((pageManifest) => {
    const page = pageManifest.page;
    const sourceBytes = readFileSync(path.join(
      process.cwd(), 'assets', 'offer-templates', 'REFORM_B2C', '2026_10_V3', pageManifest.file,
    ));
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    if (sourceHash !== pageManifest.sourceSha256) throw new Error(`Hash źródłowego SVG strony ${page} zmienił się podczas renderowania.`);
    const sourceDocument = parseSvg(sourceBytes.toString('utf8'), page);
    const pageBindings = pageManifest.textBindings.filter((binding) => binding.dynamic);
    const occurrences = new Map<string, number>();
    const mapped = new Map<string, MappedValue>();
    const values: Record<string, string> = {};
    for (const binding of pageBindings) {
      const rawId = binding.idHints[0] || '';
      const occurrence = occurrences.get(rawId) || 0;
      occurrences.set(rawId, occurrence + 1);
      const sourceText = resolveTextNode(sourceDocument, binding.selector).data;
      const value = mapBinding(page, binding, occurrence, workspace, draft, displayProductRows, pricing, pageManifest.groupBindings, sourceText);
      mapped.set(binding.fieldKey!, value);
      values[binding.fieldKey!] = value?.value ?? `${MISSING_PREFIX}${binding.fieldKey}__`;
      if (value?.source.startsWith('unknown.financing.')) {
        addMissing(missing, page, binding, unknownFinancialReason(value.source));
      } else if (value?.source.includes('unknown.energy.')) {
        const sources = value.source.split('|');
        sources.filter((source) => !source.startsWith('unknown.')).forEach((source) => sourceFields.add(source));
        const unknown = sources.find((source) => source.startsWith('unknown.energy.'))!;
        addMissing(missing, page, binding, unknownEnergyReason(unknown));
      } else if (value) {
        value.source.split('|').forEach((source) => sourceFields.add(source));
      }
      else if (!DESCRIPTION_IDS.has(rawId.toLowerCase())) {
        const id = normalizedId(rawId);
        const isPricingValue = page === 10 && (
          id.startsWith('cena_jednostkowa_brutto_')
          || binding.fieldKey?.startsWith('p10-wartoa-a-brutto-')
          || id.startsWith('kwota_koszt_systemu')
        );
        const reason = isPricingValue
          ? pricing.systemCostBeforeFinancing === null
            ? pricing.calculationError || [...pricing.missingRequiredData, ...pricing.missingOptionalData].join('; ')
              || (productRows.length ? 'Niepełna wycena wybranego zestawu; nie pokazano kwot częściowych.' : 'Nie wybrano zestawu katalogowego do wyceny.')
            : 'Brak ceny dla tej pozycji; usunięto wartość przykładową.'
          : 'Brak odpowiadającego pola w workspace lub szkicu; usunięto wartość przykładową.';
        addMissing(missing, page, binding, reason);
      }
    }

    const rendered = renderOfferTemplateV3Page(page, values);
    const document = parseSvg(rendered.svg, page);
    clearMarkedMissingValues(document, page, pageBindings, displayProductRows);
    clearNumericPlaceholders(document);
    if (page === 10) neutralizeUnconfirmedFinancingLabels(document);
    if (page === 10 && workspace.clientType === 'B2B') replaceTextMatching(document, /^brutto$/i, 'netto');
    const truncatedFields: string[] = [];
    for (const binding of pageBindings) {
      const value = mapped.get(binding.fieldKey!);
      if (!value) continue;
      if ((!value.source.startsWith('template.') || value.source.startsWith('template.pricing.'))
        && fitMappedNode(resolveTextNode(document, binding.selector), binding)) truncatedFields.push(binding.fieldKey!);
    }
    if (page === 3) {
      const hasMonthlyReadings = appendMonthlyReadings(document, workspace, sourceFields, missing);
      if (workspace.energy !== undefined) {
        appendMonthlyEnergyTable(document, workspace, draft, sourceFields, missing);
        if (workspace.energy) setEnergyProvenanceHeading(document, workspace.energy);
        else setElementText(elementById(document, '_nazwa'), 'Bilans energetyczny - brak obliczenia energii');
      }
      if (!hasMonthlyReadings) addMissing(missing, page, {
        selector: '', dynamic: true, fieldKey: workspace.energy !== undefined ? 'energy.months' : 'measurements.months.importKwh/exportKwh', kind: 'chart-value',
        idHints: ['Group 1193'], groupSelector: '', sourceTextLength: 0, sourceTextSha256: '',
      }, workspace.energy !== undefined
        ? 'Brak miesięcznych wartości modelu load/PV/autokonsumpcji do narysowania wykresu.'
        : 'Brak odczytów miesięcznych do narysowania serii poboru i oddania do sieci.');
      for (const id of replaceUnavailableUnitPrices(document)) {
        addMissing(missing, page, {
          selector: '', dynamic: true, fieldKey: id.includes('oddanej') ? 'measurements.averageExportPrice' : 'measurements.averageImportPrice',
          kind: 'financial', idHints: [id], groupSelector: '', sourceTextLength: 0, sourceTextSha256: '',
        }, 'Brak rzeczywistej ceny energii w PLN/kWh; zachowano pole z kreską zamiast przykładowej kwoty.');
      }
      suppressedCharts.push({ page, reason: workspace.energy
        ? 'Usunięto ilustracyjne serie; bieżący wykres używa miesięcznego zużycia, produkcji PV i autokonsumpcji z przekazanego modelu energii.'
        : workspace.energy === null
          ? 'Obliczenie energii jest niedostępne; nie pokazano serii z pomiarów jako zamiennika modelu.'
          : 'Usunięto ilustracyjne serie PV i zużycia; słupki poboru i oddania pochodzą z pomiarów miesięcznych.' });
    }
    if (page === 4) {
      removeDataShapes(elementById(document, 'Group 1205'));
      removeDataShapes(elementById(document, '_podsumowanie_roczne_aktualne'));
      suppressedCharts.push({ page, reason: 'Usunięto przykładowe serie bez wypełniania prognozy historycznymi pomiarami; zachowano oprawę wykresów.' });
      addMissing(missing, page, {
        selector: '', dynamic: true, fieldKey: 'simulation.futureMonthlySeries', kind: 'chart-value',
        idHints: ['Group 1205', '_podsumowanie_roczne_aktualne'], groupSelector: '', sourceTextLength: 0, sourceTextSha256: '',
      }, 'Brak danych symulacyjnych do strony prognozy; rzeczywiste pomiary historyczne nie są używane jako prognoza.');
    }
    if (page >= 5 && page <= 8) {
      const hasProfile = appendHourlyReadings(document, page, workspace, draft, sourceFields, missing);
      if (!hasProfile) addMissing(missing, page, {
        selector: '', dynamic: true, fieldKey: workspace.energy !== undefined ? 'energy.dayProfiles' : 'measurements.dayProfiles', kind: 'chart-value',
        idHints: ['Group 1298_2'], groupSelector: '', sourceTextLength: 0, sourceTextSha256: '',
      }, workspace.energy !== undefined
        ? 'Brak kompletnego profilu modelowego dla daty, miesiąca i typu dnia tej strony.'
        : 'Brak kompletnego profilu pomiarowego dla miesiąca i typu dnia tej strony.');
      suppressedCharts.push({ page, reason: 'Dolny wykres symulacyjny i wskaźnik SOC pozostają bez serii; u góry pokazano dostępny profil energii.' });
      addMissing(missing, page, {
        selector: '', dynamic: true, fieldKey: 'simulation.batteryStateOfCharge', kind: 'chart-value',
        idHints: ['Group 1278'], groupSelector: '', sourceTextLength: 0, sourceTextSha256: '',
      }, 'Brak profilu magazynu i symulacji systemu; przykładową serię SOC wyczyszczono.');
    }
    if (page === 9 || page === 10) {
      if (clearUnsupportedDataShapes(document, page)) {
        suppressedCharts.push({ page, reason: 'Usunięto wyłącznie przykładowe słupki i linie finansowe; zachowano panele, opisy i osie.' });
        addMissing(missing, page, {
          selector: '', dynamic: true, fieldKey: `p${String(page).padStart(2, '0')}-financial-series`, kind: 'financial',
          idHints: ['cena', 'rachunek', 'oszczędność'], groupSelector: '', sourceTextLength: 0, sourceTextSha256: '',
        }, 'Brak danych cenowych i symulacyjnych; przykładowe serie wykresów wyczyszczono.');
      }
    }
    if (page === 2) {
      const description = replaceDraftDescription(document, draft);
      if (draft.description.before.trim()) sourceFields.add('draft.description.before');
      else addMissing(missing, page, {
        selector: '', dynamic: true, fieldKey: 'draft.description.before', kind: 'narrative',
        idHints: ['draft.description.before'], groupSelector: '', sourceTextLength: 0, sourceTextSha256: '',
      }, 'Opis nie został podany.');
      if (draft.description.after.trim()) sourceFields.add('draft.description.after');
      else addMissing(missing, page, {
        selector: '', dynamic: true, fieldKey: 'draft.description.after', kind: 'narrative',
        idHints: ['draft.description.after'], groupSelector: '', sourceTextLength: 0, sourceTextSha256: '',
      }, 'Opis nie został podany.');
      if (description.beforeTruncated || description.afterTruncated) {
        addMissing(missing, page, {
          selector: '', dynamic: true, fieldKey: 'draft.description.truncated', kind: 'narrative',
          idHints: ['draft.description'], groupSelector: '', sourceTextLength: 0, sourceTextSha256: '',
        }, 'Długi opis skrócono do limitu podglądu.');
      }
    }
    if (page === 1) applyStaticClientFields(document, workspace);
    if (truncatedFields.length) {
      addMissing(missing, page, {
        selector: '', dynamic: true, fieldKey: `p${String(page).padStart(2, '0')}-fitted-text`, kind: 'narrative',
        idHints: truncatedFields, groupSelector: '', sourceTextLength: 0, sourceTextSha256: '',
      }, 'Tekst skrócono, aby zmieścił się w polu SVG.');
    }

    if (page === 10 && productRows.length > PRODUCT_ROW_SUFFIXES.length) {
      const aggregate = displayProductRows[PRODUCT_ROW_SUFFIXES.length - 1];
      const overflowCount = productRows.length - (PRODUCT_ROW_SUFFIXES.length - 1);
      addMissing(missing, page, {
        selector: '', dynamic: true, fieldKey: 'draft.selectedTemplateIds.overflow', kind: 'product',
        idHints: ['tabela produktowa'], groupSelector: '', sourceTextLength: 0, sourceTextSha256: '',
      }, `Pozostałe pozycje (${overflowCount}) pokazano łącznie w ostatnim wierszu kosztorysu.`);
      if (aggregate?.includedInSale && aggregate.lineSaleAmount === null) {
        addMissing(missing, page, {
          selector: '', dynamic: true, fieldKey: 'draft.selectedTemplateIds.overflow.pricing', kind: 'product',
          idHints: ['pozostałe pozycje zestawu'], groupSelector: '', sourceTextLength: 0, sourceTextSha256: '',
        }, 'Niepełna wycena pozycji zbiorczej; kwota jednostkowa, suma wiersza i koszt systemu pozostają kreskami.');
      }
    }

    appendDraftStatusFooter(document, page, workspace.energy, sourceFields);
    injectFonts(document);
    const svg = new XMLSerializer().serializeToString(document);
    parseSvg(svg, page);
    if (svg.includes(MISSING_PREFIX)) throw new Error(`W SVG strony ${page} pozostał znacznik brakujących danych.`);
    validateSafeSvg(document, page);
    return {
      page,
      svg,
      sourceSha256: rendered.sourceSha256,
      replacedFieldKeys: rendered.replacedFieldKeys,
    };
  });

  return {
    templateKey: manifest.key,
    sourceRevision: workspace.revision,
    pageCount: OFFER_TEMPLATE_V3_PAGE_COUNT,
    pages,
    sourceFieldsUsed: Array.from(sourceFields).sort(),
    missingData: Array.from(missing.values()),
    suppressedCharts,
    limitations: [
      'Pokazane wartości pochodzą z pól projektu, miesięcznych pomiarów, profili dobowych, wybranych zestawów i szkicu.',
      'Kosztorys korzysta z wyceny wybranych pozycji, indywidualnych zmian szkicu, kosztu operacyjnego, narzutu, ilości, klienta i trybu VAT.',
      'Dotacje, ulgi, koszt po finansowaniu, oszczędności i zwrot pozostają nieznane; nie zastosowano założeń finansowych ani symulacji systemu.',
      ...(workspace.energy ? [
        `Dane energii: jakość ${workspace.energy.quality}; źródło: ${workspace.energy.source}; model: ${workspace.energy.model}.`,
        ...workspace.energy.issues.map((issue) => `Uwaga modelu energii: ${issue}`),
        ...(workspace.energy.quality === 'MODELLED'
          ? ['Wykresy modelowane nie są pomiarem falownika; nieuzupełnione wartości pozostają jawne.']
          : ['Wartości pochodzą z pomiaru poboru; nieuzupełnione wartości pozostają jawne.']),
      ] : workspace.energy === null ? [
        'Obliczenie energii jest niedostępne; wartości i wykresy modelowe pokazują kreski zamiast danych pomiarowych użytych jako zamiennik.',
      ] : [
        'Profile dobowe są używane tylko dla kompletnych 24-godzinnych serii pomiarowych z maja (strony 5-6) i stycznia (strony 7-8).',
      ]),
      'Wykresy finansowe i niezasilane symulacje zachowują oprawę; przykładowe serie są usuwane.',
      `Tabela produktu pokazuje do ${PRODUCT_ROW_SUFFIXES.length} wierszy; nadmiar pozycji jest agregowany w ostatnim wierszu, a nieznane kwoty pozostają kreskami. Dokument pozostaje szkicem roboczym.`,
      'Nieznane dynamiczne pola są czyszczone, a ich wykaz znajduje się w missingData.',
    ],
  };
}

export function renderOfferWorkspaceDocument(
  workspace: OfferWorkspaceDocumentData,
  draft: OfferWorkspaceDraft,
  options: OfferWorkspaceDocumentOptions = {},
): OfferWorkspaceDocumentResult {
  let result: OfferWorkspaceDocumentResult;
  if (options.templateKey === undefined || options.templateKey === 'REFORM_B2C/2026_10_V3') {
    result = renderOfferWorkspaceDocumentV3(workspace, draft);
  } else if (options.templateKey === OFFER_TEMPLATE_V4_KEY) {
    result = renderOfferWorkspaceDocumentV4(workspace, draft, options);
  } else {
    throw new Error(`Nieobsługiwany szablon dokumentu: ${options.templateKey}`);
  }
  if (workspace.energy?.modelledMeasurements) {
    result.sourceFieldsUsed = [...new Set(result.sourceFieldsUsed.map(source => source.replaceAll('measurements.', 'energy.modelledMeasurements.')))].sort();
    result.limitations.unshift('Zużycie roczne rozłożono godzinowo profilem RE. Przepływy do i z sieci oraz autokonsumpcja są wartościami modelowanymi.');
  }
  if (draft.commercialPricing) result.sourceFieldsUsed.push('draft.commercialPricing.allocations');
  return result;
}
