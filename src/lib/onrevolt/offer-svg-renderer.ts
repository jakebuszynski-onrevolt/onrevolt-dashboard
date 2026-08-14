import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
} from '@xmldom/xmldom';
import fs from 'node:fs';
import path from 'node:path';
import { parse, type Font } from 'opentype.js';
import { buildOfferReport, monthNames } from './offer-report';
import {
  reformB2cTemplate,
  requiredEditableIds,
  type ReformB2cPageIndex,
  type SvgTextField,
} from './offer-template-manifest';

type OfferReport = ReturnType<typeof buildOfferReport>;

type RenderOptions = {
  coverImageDataUrl?: string | null;
};

const templateRoot = path.join(
  process.cwd(),
  'public',
  'offer-templates',
  'reform-b2c',
  '2026-08-v2',
);

const fonts = new Map<string, { font: Font; data: string }>();

function loadFont(fileName: string) {
  const cached = fonts.get(fileName);
  if (cached) return cached;
  const buffer = fs.readFileSync(path.join(process.cwd(), 'public', 'fonts', 'dm-sans', fileName));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const value = { font: parse(arrayBuffer), data: buffer.toString('base64') };
  fonts.set(fileName, value);
  return value;
}

function allElements(document: XmlDocument) {
  return Array.from(document.getElementsByTagName('*')) as XmlElement[];
}

function byId(document: XmlDocument, id: string) {
  return allElements(document).find((node) => node.getAttribute('id') === id) || null;
}

function textElement(target: XmlElement | null, textIndex?: number) {
  if (!target) return null;
  if (target.tagName === 'text') return target;
  const candidates = Array.from(target.getElementsByTagName('text'));
  if (textIndex != null) return candidates[textIndex] || null;
  return candidates.find((element) => /\d/.test(element.textContent || ''))
    || candidates[candidates.length - 1]
    || null;
}

function textValue(value: unknown) {
  const normalized = String(value ?? '').trim();
  return normalized || 'Brak danych';
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: unknown, digits = 0) {
  return new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(numberValue(value)).replace(/[\u00a0\u202f]/g, ' ');
}

function formatMoney(value: unknown, digits = 2) {
  return `${formatNumber(value, digits)} PLN`;
}

function formatKwh(value: unknown, approximate = false) {
  return `${approximate ? '~' : ''}${formatNumber(value, 0)} kWh`;
}

function formatKw(value: unknown) {
  const parsed = numberValue(value);
  return parsed > 0 ? `${formatNumber(parsed, parsed % 1 ? 1 : 0)} kW` : 'Brak danych';
}

function fontFor(element: XmlElement) {
  const weight = Number(element.getAttribute('font-weight') || 400);
  const style = element.getAttribute('font-style');
  if (style === 'italic') return loadFont('DMSans-Italic.ttf').font;
  return weight >= 600 ? loadFont('DMSans-Bold.ttf').font : loadFont('DMSans-Regular.ttf').font;
}

function textWidth(element: XmlElement, value: string, fontSize: number) {
  return fontFor(element).getAdvanceWidth(value, fontSize);
}

function wrapText(element: XmlElement, value: string, fontSize: number, maxWidth: number) {
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length) return ['Brak danych'];
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (textWidth(element, candidate, fontSize) <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

function fitText(element: XmlElement, field: SvgTextField) {
  const value = textValue(field.value);
  const baseSize = numberValue(element.getAttribute('font-size')) || 10;
  const minSize = field.minFontSize || Math.max(6, baseSize * 0.72);
  const maxLines = field.maxLines || 1;
  let fontSize = baseSize;
  let lines = field.maxWidth ? wrapText(element, value, fontSize, field.maxWidth) : [value];

  while (lines.length > maxLines && fontSize > minSize) {
    fontSize = Math.max(minSize, fontSize - 0.25);
    lines = field.maxWidth ? wrapText(element, value, fontSize, field.maxWidth) : [value];
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const lastIndex = lines.length - 1;
    let last = lines[lastIndex];
    while (last.length > 1 && field.maxWidth && textWidth(element, `${last}…`, fontSize) > field.maxWidth) {
      last = last.slice(0, -1).trimEnd();
    }
    lines[lastIndex] = `${last}…`;
  }
  return { fontSize, lines };
}

function setText(document: XmlDocument, field: SvgTextField) {
  const container = byId(document, field.id);
  const target = textElement(container, field.textIndex);
  if (!target) throw new Error(`Brak pola SVG ${field.id}`);
  const siblingElements = container && container !== target
    ? Array.from(container.getElementsByTagName('text')).filter((element) => element !== target)
    : [];
  const suffixElements = siblingElements.filter((element) => /\b(?:PLN|lat)\b/i.test(element.textContent || ''));
  const siblingText = siblingElements.map((element) => element.textContent || '').join(' ');
  const value = /\b(?:PLN|lat)\b/i.test(siblingText)
    ? field.value.replace(/\s*(?:PLN|lat)\s*$/i, '')
    : field.value;
  let alignedX = field.x;
  if (suffixElements.length && field.textAnchor === 'end' && field.x != null) {
    const suffixGap = 4;
    const suffixWidths = suffixElements.map((element) => {
      const suffix = (element.textContent || '').trim();
      const fontSize = numberValue(element.getAttribute('font-size')) || 7;
      element.setAttribute('text-anchor', 'end');
      const tspan = element.getElementsByTagName('tspan')[0];
      if (tspan) {
        tspan.setAttribute('x', String(field.x));
        while (tspan.firstChild) tspan.removeChild(tspan.firstChild);
        tspan.appendChild(document.createTextNode(suffix));
      }
      return textWidth(element, suffix, fontSize);
    });
    alignedX = field.x - Math.max(...suffixWidths) - suffixGap;
  } else if (suffixElements.length) {
    suffixElements.forEach((element) => {
      const tspan = element.getElementsByTagName('tspan')[0];
      if (!tspan) return;
      const x = Number(tspan.getAttribute('x'));
      if (Number.isFinite(x)) tspan.setAttribute('x', String(x + 8));
    });
  }
  const originalTspan = target.getElementsByTagName('tspan')[0];
  const x = alignedX != null
    ? String(alignedX)
    : originalTspan?.getAttribute('x') || target.getAttribute('x') || '0';
  const y = originalTspan?.getAttribute('y') || target.getAttribute('y');
  const { fontSize, lines } = fitText(target, { ...field, value });
  target.setAttribute('font-size', String(fontSize));
  if (field.textAnchor) target.setAttribute('text-anchor', field.textAnchor);
  while (target.firstChild) target.removeChild(target.firstChild);

  lines.forEach((line, index) => {
    const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tspan.setAttribute('x', x);
    if (index === 0 && y) tspan.setAttribute('y', y);
    if (index > 0) tspan.setAttribute('dy', String(fontSize * 1.16));
    tspan.appendChild(document.createTextNode(line));
    target.appendChild(tspan);
  });
}

function injectFonts(document: XmlDocument) {
  const svg = document.documentElement;
  let defs = Array.from(svg.getElementsByTagName('defs'))[0];
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }
  const regular = loadFont('DMSans-Regular.ttf').data;
  const bold = loadFont('DMSans-Bold.ttf').data;
  const italic = loadFont('DMSans-Italic.ttf').data;
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.appendChild(document.createTextNode(`
    @font-face { font-family: 'DM Sans'; src: url(data:font/ttf;base64,${regular}) format('truetype'); font-style: normal; font-weight: 300 500; }
    @font-face { font-family: 'DM Sans'; src: url(data:font/ttf;base64,${bold}) format('truetype'); font-style: normal; font-weight: 600 800; }
    @font-face { font-family: 'DM Sans'; src: url(data:font/ttf;base64,${italic}) format('truetype'); font-style: italic; font-weight: 300 500; }
  `));
  defs.appendChild(style);
}

function applyB2cAmountLabels(document: XmlDocument) {
  allElements(document).forEach((element) => {
    Array.from(element.childNodes).forEach((node) => {
      if (node.nodeType === 3 && node.nodeValue) {
        const replacement = document.createTextNode(node.nodeValue.replace(/netto/gi, 'brutto'));
        node.parentNode?.replaceChild(replacement, node);
      }
    });
  });
}

function replaceDynamicNode(master: XmlDocument, editable: XmlDocument, id: string) {
  const source = byId(editable, id);
  if (!source) return;
  const replacement = source.cloneNode(true);
  const target = byId(master, id);
  if (target?.parentNode) target.parentNode.replaceChild(replacement, target);
  else master.documentElement.appendChild(replacement);
}

function address(report: OfferReport) {
  return [report.client.address, [report.client.postalCode, report.client.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
}

function headerFields(report: OfferReport): SvgTextField[] {
  return [
    { id: '_nazwa', value: report.client.name, maxWidth: 360, minFontSize: 8 },
    { id: '_numer', value: `NR ${report.number}`, x: 550, textAnchor: 'end', maxWidth: 145, minFontSize: 7 },
  ];
}

function page0Fields(report: OfferReport): SvgTextField[] {
  return [
    { id: '#tytul', value: report.client.name, maxWidth: 365, minFontSize: 8 },
    { id: '#numer_oferty', value: `NR ${report.number}`, x: 550, textAnchor: 'end', maxWidth: 135, minFontSize: 7 },
    { id: '#imie_nazwisko', value: report.client.name, maxWidth: 155, minFontSize: 7 },
    { id: '#adres', value: address(report), maxWidth: 155, maxLines: 2, minFontSize: 6.5 },
    { id: '#mail', value: report.client.email, maxWidth: 155, minFontSize: 5.5 },
    { id: '#telefon', value: report.client.phone, maxWidth: 155, minFontSize: 7 },
    { id: '#rodzaj_terenu', value: report.report.terrain, maxWidth: 155, minFontSize: 7 },
    { id: '#rodzaj_dachu', value: report.report.roofType, maxWidth: 155, minFontSize: 7 },
    { id: '#typ_budynku', value: report.report.buildingType, maxWidth: 155, minFontSize: 7 },
    { id: '#moc_przylaczeniowa', value: formatKw(report.report.connectionPowerKw), maxWidth: 155 },
    { id: '#operator_systemu_dystrybucyjnego', value: report.report.operator, maxWidth: 155 },
    { id: '#system_rozliczeniowy', value: report.report.settlement, maxWidth: 155 },
    { id: '#dostawca_energii_elektrycznej', value: report.report.supplier, maxWidth: 155 },
    { id: '#taryfa', value: report.report.tariff, maxWidth: 155 },
    { id: '#rodzaj_przylacza', value: report.report.connectionType, maxWidth: 155 },
    { id: '#zrodlo_ciepla', value: report.report.heatingSource, maxWidth: 155 },
    { id: '#rodzaj_ciepla', value: report.report.heatingDetails, maxWidth: 155, minFontSize: 6.5 },
    { id: '#oplaty_stale_i_dystrybucyjne_kwota', value: formatNumber(report.bills.current.distribution + report.bills.current.fixed, 2) },
    { id: '#zakup_energii_kwota', value: formatNumber(report.bills.current.energy, 2) },
    { id: '#twoj_rachunek_kwota', value: formatNumber(report.bills.current.total, 2) },
    { id: '#posiadane_urzadzenia_o_duzym_poborze_energii', value: report.report.currentLoads, maxWidth: 155, maxLines: 6, minFontSize: 6 },
    { id: '#planowane_urzadzenia_o_duzym_poborze_energii', value: report.report.plannedLoads, maxWidth: 155, maxLines: 6, minFontSize: 6 },
    { id: '#instalacja_fotowoltaiczna', value: report.report.hasPv ? 'Tak' : 'Brak' },
    { id: '#moc_instalacji_fotowoltaicznej', value: report.report.existingPvKw ? formatNumber(report.report.existingPvKw, 2) : 'Brak' },
    { id: '#miejsce_instalacji_fotowoltaicznej', value: report.report.pvPlace, maxWidth: 155 },
  ];
}

const packageFieldIds = [
  { name: '_nazwa_pozycji_1_2', model: '_nazwa_modelu_1_2', quantity: '_ilosc_1_2', unit: '_cena_jednostkowa_brutto_1_2', value: '_wartosc_brutto_1_2' },
  { name: '_nazwa_pozycji_2_2', model: '_nazwa_modelu_2_2', quantity: '_ilosc_2_2', unit: '_cena_jednostkowa_brutto_2_2', value: '_wartosc_brutto_2_2' },
  { name: '_nazwa_pozycji_3_2', model: '_nazwa_modelu_3_2', quantity: '_ilosc_3_2', unit: '_cena_jednostkowa_brutto_3_2', value: '_wartosc_brutto_3_2' },
  { name: '_nazwa_pozycji_3_4', model: '_nazwa_modelu_3_4', quantity: '_ilosc_3_4', unit: '_cena_jednostkowa_brutto_3_4', value: '_wartosc_brutto_3_4' },
];

function page1Fields(report: OfferReport): SvgTextField[] {
  const quantityColumn = { x: 350, textAnchor: 'end' as const };
  const unitPriceColumn = { x: 450, textAnchor: 'end' as const };
  const valueColumn = { x: 550, textAnchor: 'end' as const };
  const rightAlignedSummary = { x: 550, textAnchor: 'end' as const };
  const rows = report.costs.rows.flatMap((row, index) => {
    const ids = packageFieldIds[index];
    return [
      { id: ids.name, value: row.description, maxWidth: 140, minFontSize: 5.5 },
      { id: ids.model, value: row.model, maxWidth: 130, maxLines: 2, minFontSize: 5.5 },
      { id: ids.quantity, value: row.available ? formatNumber(row.quantity, 0) : '-', ...quantityColumn },
      { id: ids.unit, value: row.available ? formatMoney(row.unitValue) : '-', ...unitPriceColumn },
      { id: ids.value, value: row.available ? formatMoney(row.value) : '-', ...valueColumn },
    ];
  });
  return [
    ...headerFields(report),
    ...rows,
    { id: '_kwota_koszt_systemu_2', value: formatMoney(report.costs.systemValue), ...valueColumn },
    { id: '_kwota_dotacja_2', value: formatMoney(report.costs.subsidy), ...valueColumn },
    { id: '_kwota_ulga_2', value: formatMoney(report.costs.thermoRelief), ...valueColumn },
    { id: '_kwota_po_dofinansowaniach_2', value: formatMoney(report.costs.afterSupport), ...valueColumn },
    { id: '_kwota_nowy_rachunek', value: formatNumber(report.savings.projectedBill, 0), ...rightAlignedSummary },
    { id: '_oszczednosc_kwota', value: formatNumber(report.savings.annual, 0), ...rightAlignedSummary },
    { id: '_kwota_aktualny_rachunek', value: formatNumber(report.savings.currentBill, 0), ...rightAlignedSummary },
    { id: '_liczba_lat', value: report.savings.paybackYears ? `${Math.floor(report.savings.paybackYears)} lat` : 'Brak danych', ...rightAlignedSummary },
    { id: '_oszczednosc_2', value: `Oszczędność ${formatNumber(report.savings.percent, 0)}%`, textIndex: 0 },
    { id: '_oszczednosc_', value: `+${formatNumber(report.savings.percent, 0)}%` },
    { id: '_laczna_zgromadzona_wartosc_depozytu_kwota', value: formatNumber(report.deposit.generated, 0), ...rightAlignedSummary },
    { id: '_oplaty_stale_i_dystrybucyjne_kwota', value: `- ${formatNumber(report.bills.projected.distribution + report.bills.projected.fixed, 0)}`, ...rightAlignedSummary },
    { id: '_laczna_wykorzystana_wartosc_depozytu_na_pokrycie_energii_pobranej_kwota', value: formatNumber(report.deposit.used, 0), ...rightAlignedSummary },
    { id: '_niewykorzystana_wartosc_depozytu_kwota', value: formatNumber(report.deposit.remaining, 0), ...rightAlignedSummary },
    { id: '_zwrot_30_wartosci_kwota', value: formatNumber(report.deposit.remaining * 0.3, 0), ...rightAlignedSummary },
    { id: '_wartosc_energii_obranej_niepokrytej_z_depozytu_kwota', value: formatNumber(report.bills.projected.energyCash, 0), ...rightAlignedSummary },
  ];
}

function normalizedLabel(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function tariffComponent(
  tariff: OfferReport['tariffs']['current'],
  kind: 'variable' | 'fixed',
  pattern: RegExp,
) {
  const rows = tariff.components[kind];
  const matches = rows.filter((row) => pattern.test(normalizedLabel(row.label)));
  if (!matches.length) return null;
  return matches.reduce((total, row) => total + (
    kind === 'variable'
      ? numberValue((row as OfferReport['tariffs']['current']['components']['variable'][number]).amountPerKwh)
      : numberValue((row as OfferReport['tariffs']['current']['components']['fixed'][number]).amountMonthly)
  ), 0);
}

function componentMoney(value: number | null, digits = 2) {
  return value == null ? 'Brak danych' : formatMoney(value, digits);
}

function tariffDetailFields(
  tariff: OfferReport['tariffs']['current'],
  suffix: 'aktualna' | 'nowy',
): SvgTextField[] {
  const current = suffix === 'aktualna';
  const id = (currentId: string, newId: string) => current ? currentId : newId;
  const alignment = { x: current ? 285 : 555, textAnchor: 'end' as const };
  return [
    { id: id('_oplata_zmienna_sieciowa_aktualna_cena', '_oplata_zmienna_sieciowa_nowy_cena'), value: componentMoney(tariffComponent(tariff, 'variable', /zmienna.*sieci|sieciowa.*zmienna/), 4), ...alignment },
    { id: id('_oplata_jakosciowa_aktualna_cena', '_oplata_jakosciowa_nowy_cena'), value: componentMoney(tariffComponent(tariff, 'variable', /jakosci/), 4), ...alignment },
    { id: id('_oplata_oze_aktualna_cena', '_oplata_oze_nowy_cena'), value: componentMoney(tariffComponent(tariff, 'variable', /\boze\b/), 4), ...alignment },
    { id: id('_oplata_kogeneracyjna_aktualna_cena', '_oplata_kogeneracyjna_nowy_cena'), value: componentMoney(tariffComponent(tariff, 'variable', /kogener/), 4), ...alignment },
    { id: id('_vat_aktualna_cena', '_vat_nowy_cena'), value: 'w cenie', ...alignment },
    { id: id('_oplata_handlowa_aktualna_cena', '_oplata_handlowa_nowy_cena'), value: componentMoney(tariffComponent(tariff, 'fixed', /handlow/)), ...alignment },
    { id: id('_skladnik_staly_sieciowy_aktualny_cena', '_skladnik_staly_sieciowy_nowy_cena'), value: componentMoney(tariffComponent(tariff, 'fixed', /skladnik.*staly|staly.*sieci/)), ...alignment },
    { id: id('oplata_mocowa_aktualne_cena', 'oplata_mocowa_nowy_cena'), value: componentMoney(tariffComponent(tariff, 'fixed', /mocow/)), ...alignment },
    { id: id('_stala_cena_abonementu_aktualna_cena', '_stala_cena_abonementu_nowy_cena'), value: componentMoney(tariffComponent(tariff, 'fixed', /abon/)), ...alignment },
  ];
}

function page2Fields(report: OfferReport): SvgTextField[] {
  const left = { x: 285, textAnchor: 'end' as const };
  const right = { x: 555, textAnchor: 'end' as const };
  return [
    ...headerFields(report),
    { id: '_taryfa', value: report.tariffs.before },
    { id: '_system_rozliczeniowy', value: report.tariffs.settlementBefore },
    { id: '_taryfa_2', value: report.tariffs.afterName },
    { id: '_system_rozliczeniowy_2', value: report.tariffs.settlementAfter },
    { id: '_koszt_zakupu_1kwh_aktualny_cena', value: formatMoney(report.tariffs.current.totalPerKwh, 4), ...left },
    { id: '_zakup_energii_aktualny_cena', value: formatMoney(report.tariffs.current.energyPerKwh, 4), ...left },
    { id: '_dystrybucja_energii_aktualna_cena', value: formatMoney(report.tariffs.current.distributionPerKwh, 4), ...left },
    { id: '_oplaty_stale_aktuale_cena', value: formatMoney(report.tariffs.current.fixedMonthly, 2), ...left },
    ...tariffDetailFields(report.tariffs.current, 'aktualna'),
    { id: '_koszt_zakupu_1kwh_nowy_cena', value: formatMoney(report.tariffs.projected.totalPerKwh, 4), ...right },
    { id: '_zakup_energii_aktualny_cena_2', value: formatMoney(report.tariffs.projected.energyPerKwh, 4), ...right },
    { id: '_dystrybucja_energii_aktualna_cena_2', value: formatMoney(report.tariffs.projected.distributionPerKwh, 4), ...right },
    { id: '_oplaty_stale_nowy_cena', value: formatMoney(report.tariffs.projected.fixedMonthly, 2), ...right },
    ...tariffDetailFields(report.tariffs.projected, 'nowy'),
    { id: '_zuzycie_energii_rachunek_aktualny_kwh', value: formatKwh(report.bills.current.consumptionKwh), ...left },
    { id: '_autokonsumpcja_pv_aktualny_rachunek_kwh', value: formatKwh(0), ...left },
    { id: '_calkowity_rachunek_brutto_aktualny_rachunek_cena', value: formatMoney(report.bills.current.total, 0), ...left },
    { id: '_zakup_z_sieci_aktualny_rachunek_kwh', value: formatKwh(report.bills.current.gridImportKwh), ...left },
    { id: '_zakup_energii_aktualny_rachunek_cena', value: formatMoney(report.bills.current.energy, 0), ...left },
    { id: '_dystrybucja_energii_aktualny_rachunek_cena', value: formatMoney(report.bills.current.distribution, 0), ...left },
    { id: '_oplaty_stale_aktualny_rachunek_cena', value: formatMoney(report.bills.current.fixed, 0), ...left },
    { id: '_energia_zakupiona_z_sieci_aktualny_rachunek_cena', value: formatMoney(report.bills.current.energy, 0), ...left },
    { id: '_pokryte_z_depozytu_aktualny_rachunek_cena', value: formatMoney(0, 0), ...left },
    { id: '_vat_aktualna_cena_2', value: 'w cenie', ...left },
    { id: '_zuzycie_energii_rachunek_nowy_kwh', value: formatKwh(report.bills.projected.consumptionKwh), ...right },
    { id: '_oszczednosc_nowy_rachunek_cena', value: formatMoney(report.savings.annual, 0), ...right },
    { id: '_calkowity_rachunek_brutto_nowy_rachunek_cena', value: formatMoney(report.bills.projected.total, 0), ...right },
    { id: '_rachunek_po_zwrocie_z_depozytu_nowy_rachunek_cena', value: formatMoney(Math.max(0, report.bills.projected.total - report.deposit.payout), 0), ...right },
    { id: '_energia_zakupiona_z_sieci_nowy_rachunek_cena', value: formatMoney(report.bills.projected.energyDue, 0), ...right },
    { id: '_autokonsumpcja_pv_aktualny_rachunek_kwh_2', value: formatKwh(report.bills.projected.pvDirectKwh), ...right },
    { id: '_autokonsumpcja_magazyn_nowy_rachunek_kwh', value: formatKwh(report.bills.projected.batteryKwh), ...right },
    { id: '_zakup_z_sieci_nowy_rachunek_kwh', value: formatKwh(report.bills.projected.gridImportKwh), ...right },
    { id: '_energia_oddana_do_depozytu_nowy_rachunek_cena', value: `${formatMoney(report.deposit.generated, 0)} / ${formatKwh(report.deposit.exportKwh)}`, ...right },
    { id: '_energia_wykorzystana_z_depozytu_nowy_rachunek_cena', value: formatMoney(report.deposit.used, 0), ...right },
    { id: '_pokryte_z_depozytu_nowy_rachunek_cena', value: formatMoney(report.deposit.used, 0), ...right },
    { id: '_wartosc_skumulowanego_depozytu_nowy_rachunek_cena', value: formatMoney(report.deposit.remaining, 0), ...right },
    { id: '_zakup_energii_nowy_rachunek_cena', value: formatMoney(report.bills.projected.energyCash, 0), ...right },
    { id: '_dystrybucja_energii_nowy_rachunek_cena', value: formatMoney(report.bills.projected.distribution, 0), ...right },
    { id: '_oplaty_stale_nowy_rachunek_cena', value: formatMoney(report.bills.projected.fixed, 0), ...right },
    { id: '_vat_nowy_cena_2', value: 'w cenie', ...right },
  ];
}

const monthSlugs = ['styczen', 'luty', 'marzec', 'kwiecien', 'maj', 'czerwiec', 'lipiec', 'sierpien', 'wrzesien', 'pazdziernik', 'listopad', 'grudzien'];

function characteristicFields(months: OfferReport['energy']['currentMonths']): SvgTextField[] {
  const sorted = months.slice().sort((a, b) => a.consumptionKwh - b.consumptionKwh);
  const low = sorted[0] || null;
  const high = sorted[sorted.length - 1] || null;
  const average = months.length
    ? months.reduce((total, month) => total + month.consumptionKwh, 0) / months.length
    : 0;
  const medium = months.length
    ? months.reduce((closest, month) => (
      Math.abs(month.consumptionKwh - average) < Math.abs(closest.consumptionKwh - average)
        ? month
        : closest
    ), months[0])
    : null;
  return [
    { id: '_miesiac_o_najwiekszym_zuzyciu_aktualne_data', value: high ? monthNames[high.month - 1] : 'Brak danych' },
    { id: '_miesiac_o_najwiekszym_zuzyciu_aktualne_kwh', value: high ? formatKwh(high.consumptionKwh, true) : 'Brak danych' },
    { id: '_miesiac_o_srednim_zuzyciu_aktualne_data', value: medium ? monthNames[medium.month - 1] : 'Brak danych' },
    { id: '_miesiac_o_srednim_zuzyciu_aktualne_kwh', value: medium ? formatKwh(medium.consumptionKwh, true) : 'Brak danych' },
    { id: '_miesiac_o_srednim_zuzyciu_aktualne_data_2', value: low ? monthNames[low.month - 1] : 'Brak danych' },
    { id: '_miesiac_o_srednim_zuzyciu_aktualne_kwh_2', value: low ? formatKwh(low.consumptionKwh, true) : 'Brak danych' },
  ];
}

function energyPageFields(report: OfferReport, projected: boolean): SvgTextField[] {
  const months = projected ? report.energy.projectedMonths : report.energy.currentMonths;
  const monthByNumber = new Map(months.map((month) => [month.month, month]));
  const annualPv = months.reduce((sum, month) => sum + month.pvGenerationKwh, 0);
  const annualDirect = months.reduce((sum, month) => sum + month.directPvKwh, 0);
  const annualBattery = months.reduce((sum, month) => sum + month.batteryKwh, 0);
  const annualImport = months.reduce((sum, month) => sum + month.gridImportKwh, 0);
  const annualExport = months.reduce((sum, month) => sum + month.exportKwh, 0);
  const monthlyFields = projected ? [] : monthSlugs.flatMap((slug, index) => {
    const month = monthByNumber.get(index + 1);
    return [
      { id: `_autokonsumpcja_magazyn_aktualny_${slug}_wartosc_2`, value: month ? formatNumber(month.pvGenerationKwh, 0) : 'Brak' },
      { id: `_autokonsumpcja_magazyn_aktualny_${slug}_wartosc_3`, value: month ? formatNumber(month.exportKwh, 0) : 'Brak' },
      { id: `_autokonsumpcja_magazyn_aktualny_${slug}_wartosc_4`, value: month ? formatNumber(month.directPvKwh, 0) : 'Brak' },
      { id: `_autokonsumpcja_magazyn_aktualny_${slug}_wartosc`, value: month ? formatNumber(month.batteryKwh, 0) : 'Brak' },
    ];
  });
  return [
    ...headerFields(report),
    { id: '_okres_aktualny', value: `(${report.energy.period})`, textIndex: 1, maxWidth: 330, minFontSize: 7 },
    { id: '_zuzycie_energii_aktualny_kwh', value: formatKwh(report.energy.annualConsumption) },
    { id: '_produkcja_pv_aktaulny_kwh', value: formatKwh(annualPv) },
    { id: '_autokonsumpcja_pv_aktualny_kwh', value: formatKwh(annualDirect) },
    { id: '_autokonsumpcja_magazyn_aktualny_kwh', value: formatKwh(annualBattery) },
    { id: '_energia_pobrana_z_sieci_aktualny_kwh', value: formatKwh(annualImport) },
    { id: '_energia_oddana_do_sieci_aktualny_kwh', value: formatKwh(annualExport) },
    { id: '_wartosc_energii_oddanej_aktualny_kwh', value: formatMoney(projected ? report.deposit.generated : 0) },
    { id: '_wartosc_energii_pobranej_aktualny_kwh', value: formatMoney(projected ? report.bills.projected.energyDue : report.bills.current.energy) },
    { id: '_srednia_cana_oddanej_aktualny_pln', value: formatMoney(report.energy.averageExportPrice, 4) },
    { id: '_srednia_cana_pobranej_aktualny_pln', value: formatMoney(projected ? report.energy.averageImportPrice : report.tariffs.current.energyPerKwh, 4) },
    ...characteristicFields(months),
    ...monthlyFields,
  ];
}

function pageFields(page: ReformB2cPageIndex, report: OfferReport) {
  if (page === 0) return page0Fields(report);
  if (page === 1) return page1Fields(report);
  if (page === 2) return page2Fields(report);
  return energyPageFields(report, page === 4);
}

function fitParagraph(element: XmlElement, value: string, maxWidth: number, maxLines: number) {
  let fontSize = 7;
  let lines = wrapText(element, textValue(value), fontSize, maxWidth);
  while (lines.length > maxLines && fontSize > 5.5) {
    fontSize = Math.max(5.5, fontSize - 0.25);
    lines = wrapText(element, textValue(value), fontSize, maxWidth);
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last.length > 1 && textWidth(element, `${last}…`, fontSize) > maxWidth) {
      last = last.slice(0, -1).trimEnd();
    }
    lines[maxLines - 1] = `${last}…`;
  }
  return { fontSize, lines };
}

function appendParagraph(
  document: XmlDocument,
  target: XmlElement,
  lines: string[],
  fontSize: number,
  y: number,
  firstX: number,
  nextX: number,
) {
  lines.forEach((line, index) => {
    const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tspan.setAttribute('x', String(index === 0 ? firstX : nextX));
    tspan.setAttribute('y', String(y + index * 8));
    tspan.appendChild(document.createTextNode(line));
    target.appendChild(tspan);
  });
  target.setAttribute('font-size', String(fontSize));
}

function updateDescription(document: XmlDocument, report: OfferReport) {
  const group = byId(document, '_opis_oferty_opis');
  const texts = group ? Array.from(group.getElementsByTagName('text')) : [];
  const target = texts[2];
  if (!target) throw new Error('Brak edytowalnego pola opisu oferty w SVG');
  const before = fitParagraph(target, report.description.before, 515, 5);
  const after = fitParagraph(target, report.description.after, 515, 9);
  while (target.firstChild) target.removeChild(target.firstChild);
  appendParagraph(document, target, before.lines, before.fontSize, 690.387, 65.5, 40);
  appendParagraph(document, target, after.lines, after.fontSize, 738.387, 53.5, 40);
}

function removeNode(document: XmlDocument, id: string) {
  const node = byId(document, id);
  if (node?.parentNode) node.parentNode.removeChild(node);
}

function chartPolyline(document: XmlDocument, values: number[], color: string, axisMax: number) {
  const x0 = 73;
  const y0 = 312;
  const width = 479;
  const height = 172;
  const points = values.map((value, index) => {
    const x = x0 + (width * index) / 11;
    const y = y0 - (Math.max(0, value) / axisMax) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', points);
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', color);
  polyline.setAttribute('stroke-width', '1.5');
  polyline.setAttribute('stroke-linejoin', 'round');
  polyline.setAttribute('stroke-linecap', 'round');
  return polyline;
}

function chartRect(document: XmlDocument, x: number, y: number, width: number, height: number, fill: string) {
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x.toFixed(2));
  rect.setAttribute('y', y.toFixed(2));
  rect.setAttribute('width', width.toFixed(2));
  rect.setAttribute('height', Math.max(0, height).toFixed(2));
  rect.setAttribute('fill', fill);
  return rect;
}

function appendStack(
  document: XmlDocument,
  group: XmlElement,
  x: number,
  bottom: number,
  width: number,
  availableHeight: number,
  axisMax: number,
  segments: Array<{ value: number; color: string }>,
) {
  let cursor = bottom;
  segments.forEach((segment) => {
    const height = Math.max(0, segment.value) / axisMax * availableHeight;
    cursor -= height;
    group.appendChild(chartRect(document, x, cursor, width, height, segment.color));
  });
}

function updateTariffCharts(document: XmlDocument, report: OfferReport) {
  [
    '_dystrybucja_energii_aktualna_slupek', '_zakup_energii_aktualny_slupek', '_vat_aktualna_slupek',
    '_dystrybucja_energii_nowy_slupek', '_zakup_energii_nowy_slupek', '_vat_nowy_slupek',
    '_vat_aktualna_slupek_3', '_oplaty_stale_aktualny_rachunek_slupek',
    '_dystrybucja_aktualny_rachunek_slupek', '_zakup_energii_aktualny_rachunek_slupek',
    '_vat_aktualna_slupek_5', '_oplaty_stale_aktualny_rachunek_slupek_3',
    '_oplaty_stale_aktualny_rachunek_slupek_5', '_oplaty_stale_aktualny_rachunek_slupek_7',
    '_wartosc_skumulowanego_deppozytu_nowy_rachunek_slupek', '_oszczednosc_nowy_rachunek_slupek',
  ].forEach((id) => removeNode(document, id));

  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('id', '_dynamic_tariff_charts');
  const rateAxisMax = Math.max(1.2, Math.ceil(Math.max(
    report.tariffs.current.totalPerKwh,
    report.tariffs.projected.totalPerKwh,
  ) * 10) / 10);
  const rateSegments = (tariff: OfferReport['tariffs']['current']) => [
    { value: tariff.distributionPerKwh, color: '#FDB066' },
    { value: tariff.energyPerKwh, color: '#FC7C00' },
  ];
  appendStack(document, group, 65, 345, 11.5, 160, rateAxisMax, rateSegments(report.tariffs.current));
  appendStack(document, group, 336, 345, 11.5, 160, rateAxisMax, rateSegments(report.tariffs.projected));

  const current = report.bills.current;
  const projected = report.bills.projected;
  const billAxisMax = Math.max(6000, Math.ceil(Math.max(
    current.total,
    projected.total + report.savings.annual,
  ) / 1000) * 1000);
  const currentComponents = current.energy + current.distribution + current.fixed;
  const projectedComponents = projected.energyCash + projected.distribution + projected.fixed;
  appendStack(document, group, 65, 644, 12, 249, billAxisMax, currentComponents > 0 ? [
    { value: current.energy, color: '#FC7C00' },
    { value: current.distribution, color: '#FDB066' },
    { value: current.fixed, color: '#FECB99' },
  ] : [
    { value: current.total, color: '#A3AED0' },
  ]);
  appendStack(document, group, 335, 644, 12, 249, billAxisMax, [
    ...(projectedComponents > 0 ? [
    { value: projected.energyCash, color: '#FC7C00' },
    { value: projected.distribution, color: '#FDB066' },
    { value: projected.fixed, color: '#FECB99' },
    ] : [
      { value: projected.total, color: '#A3AED0' },
    ]),
    { value: report.savings.annual, color: '#00D477' },
  ]);
  const defs = Array.from(document.documentElement.getElementsByTagName('defs'))[0];
  document.documentElement.insertBefore(group, defs || null);
}

function updateChart(
  document: XmlDocument,
  months: OfferReport['energy']['currentMonths'],
  projected: boolean,
) {
  removeNode(document, 'Group_16');
  if (projected) {
    ['Group', 'Group_2', 'Group_3', 'Group_4', 'Vector_153', 'Vector_154'].forEach((id) => removeNode(document, id));
  }
  removeNode(document, '_dynamic_energy_chart');
  const grid = byId(document, '_linie_wykres_aktualny');
  if (!grid?.parentNode) return;
  const values = months.flatMap((month) => [
    month.consumptionKwh,
    month.pvGenerationKwh,
    month.directPvKwh + month.batteryKwh + month.gridImportKwh,
  ]);
  const max = Math.max(1, ...values);
  const axisStep = Math.max(100, Math.ceil(max / 1000) * 100);
  const axisMax = axisStep * 10;
  const chart = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  chart.setAttribute('id', '_dynamic_energy_chart');
  if (months.length) {
    const y0 = 312;
    const height = 172;
    const barWidth = 18;
    months.forEach((month, index) => {
      const x = 76 + index * (450.5 / 11);
      if (projected) {
        let bottom = y0;
        [
          { value: month.gridImportKwh, color: '#FC7C00' },
          { value: month.batteryKwh, color: '#44E09C' },
          { value: month.directPvKwh, color: '#FEB633' },
        ].forEach((segment) => {
          const segmentHeight = Math.max(0, segment.value) / axisMax * height;
          bottom -= segmentHeight;
          chart.appendChild(chartRect(document, x, bottom, barWidth, segmentHeight, segment.color));
        });
      } else {
        const barHeight = Math.max(0, month.pvGenerationKwh) / axisMax * height;
        chart.appendChild(chartRect(document, x, y0 - barHeight, barWidth, barHeight, '#FEB633'));
      }
    });
    chart.appendChild(chartPolyline(document, months.map((month) => month.consumptionKwh), '#A3AED0', axisMax));
    if (projected) chart.appendChild(chartPolyline(document, months.map((month) => month.pvGenerationKwh), '#009A44', axisMax));
  }
  grid.parentNode.insertBefore(chart, grid.nextSibling);

  const axisIds = ['_0', '_200', '_400', '_600', '_800', '_1000', '_1200', '_1400', '_1400_3', '_1400_2', '_1400_4'];
  axisIds.forEach((id, index) => {
    if (byId(document, id)) setText(document, { id, value: formatNumber(axisStep * index, 0) });
  });
}

function updateMonthlyTable(
  document: XmlDocument,
  months: OfferReport['energy']['currentMonths'],
  projected: boolean,
) {
  if (projected) {
    [
      { id: 'Group_22', y: 508, color: '#FEB633', value: (month: typeof months[number]) => month.pvGenerationKwh },
      { id: 'Group_21', y: 547, color: '#98A2B3', value: (month: typeof months[number]) => month.consumptionKwh },
      { id: 'Group_20', y: 586, color: '#009A44', value: (month: typeof months[number]) => month.exportKwh },
      { id: 'Group_19', y: 625, color: '#FFDDA0', value: (month: typeof months[number]) => month.directPvKwh },
      { id: 'Group_18', y: 664, color: '#44E09C', value: (month: typeof months[number]) => month.batteryKwh },
      { id: 'Group_17', y: 703, color: '#E57A00', value: (month: typeof months[number]) => month.gridImportKwh },
    ].forEach((series) => replaceMonthlySeries(
      document,
      series.id,
      months,
      series.y,
      series.color,
      series.value,
    ));
    return;
  }
  const monthByNumber = new Map(months.map((month) => [month.month, month]));
  const styles = [
    { suffix: '_2', color: '#FEB633', value: (month: typeof months[number]) => month.pvGenerationKwh },
    { suffix: '_3', color: '#009A44', value: (month: typeof months[number]) => month.exportKwh },
    { suffix: '_4', color: '#FFDDA0', value: (month: typeof months[number]) => month.directPvKwh },
    { suffix: '', color: '#44E09C', value: (month: typeof months[number]) => month.batteryKwh },
  ];
  monthSlugs.forEach((slug, index) => {
    const month = monthByNumber.get(index + 1);
    styles.forEach((style) => {
      const color = byId(document, `_autokonsumpcja_magazyn_aktualny_${slug}_kolor${style.suffix}`);
      if (!color) return;
      color.setAttribute('fill', month ? style.color : '#F2F5FB');
      color.setAttribute('fill-opacity', month
        ? String(Math.max(0.3, Math.min(1, style.value(month) / Math.max(1, ...months.map(style.value)))))
        : '1');
    });
  });

  replaceMonthlySeries(
    document,
    'Group_15',
    months,
    547,
    '#98A2B3',
    (month) => month.consumptionKwh,
  );
  replaceMonthlySeries(
    document,
    'Group_14',
    months,
    703,
    '#E57A00',
    (month) => month.gridImportKwh,
  );
}

function replaceMonthlySeries(
  document: XmlDocument,
  id: string,
  months: OfferReport['energy']['currentMonths'],
  y: number,
  fill: string,
  readValue: (month: OfferReport['energy']['currentMonths'][number]) => number,
) {
  const target = byId(document, id);
  if (!target?.parentNode) return;
  const parent = target.parentNode;
  const next = target.nextSibling;
  parent.removeChild(target);
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('id', id);
  const monthByNumber = new Map(months.map((month) => [month.month, month]));
  const max = Math.max(1, ...months.map(readValue));
  monthSlugs.forEach((_, index) => {
    const month = monthByNumber.get(index + 1);
    const x = 39 + index * 42.25;
    const rect = chartRect(document, x, y, 41, 13, month ? fill : '#F2F5FB');
    rect.setAttribute('fill-opacity', month ? String(Math.max(0.3, readValue(month) / max)) : '1');
    group.appendChild(rect);
    const value = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    value.setAttribute('x', String(x + 20.5));
    value.setAttribute('y', String(y + 24));
    value.setAttribute('text-anchor', 'middle');
    value.setAttribute('fill', '#2B3674');
    value.setAttribute('font-family', 'DM Sans');
    value.setAttribute('font-size', '6');
    value.appendChild(document.createTextNode(month ? formatNumber(readValue(month), 0) : 'Brak'));
    group.appendChild(value);
  });
  parent.insertBefore(group, next);
}

function updateCoverImage(document: XmlDocument, dataUrl?: string | null) {
  const target = byId(document, '_zdjecie_satelitarne');
  if (!target?.parentNode) return;
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('id', '_zdjecie_satelitarne');
  if (!dataUrl) {
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('x', '214');
    background.setAttribute('y', '95');
    background.setAttribute('width', '351');
    background.setAttribute('height', '249');
    background.setAttribute('rx', '10');
    background.setAttribute('fill', '#EEF2F8');
    group.appendChild(background);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', '389.5');
    label.setAttribute('y', '223');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', '#8190B7');
    label.setAttribute('font-family', 'DM Sans');
    label.setAttribute('font-size', '12');
    label.setAttribute('font-weight', '700');
    label.appendChild(document.createTextNode('Brak zdjęcia'));
    group.appendChild(label);
    target.parentNode.replaceChild(group, target);
    return;
  }
  const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
  clip.setAttribute('id', '_cover_image_clip');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', '214');
  rect.setAttribute('y', '95');
  rect.setAttribute('width', '351');
  rect.setAttribute('height', '249');
  rect.setAttribute('rx', '10');
  clip.appendChild(rect);
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.appendChild(clip);
  group.appendChild(defs);
  const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
  image.setAttribute('x', '214');
  image.setAttribute('y', '95');
  image.setAttribute('width', '351');
  image.setAttribute('height', '249');
  image.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  image.setAttribute('clip-path', 'url(#_cover_image_clip)');
  image.setAttribute('href', dataUrl);
  group.appendChild(image);
  target.parentNode.replaceChild(group, target);
}

function removeSavingsPercentSample(document: XmlDocument) {
  const target = byId(document, '_oszczednosc_2');
  if (!target) return;
  Array.from(target.getElementsByTagName('text'))
    .slice(1)
    .forEach((element) => element.parentNode?.removeChild(element));
}

function readTemplate(layer: 'master' | 'editable', page: ReformB2cPageIndex) {
  const definition = reformB2cTemplate.pages.find((item) => item.index === page);
  if (!definition) throw new Error(`Nieznana strona szablonu: ${page}`);
  return fs.readFileSync(path.join(templateRoot, layer, definition.file), 'utf8');
}

export function renderOfferSvgPage(offer: any, page: ReformB2cPageIndex, options: RenderOptions = {}) {
  const parser = new DOMParser({ onError: (level, message) => { if (level === 'error' || level === 'fatalError') throw new Error(message); } });
  const master = parser.parseFromString(readTemplate('master', page), 'image/svg+xml');
  const editable = parser.parseFromString(readTemplate('editable', page), 'image/svg+xml');
  const report = buildOfferReport(offer);
  const fields = pageFields(page, report);

  fields.forEach((field) => setText(editable, field));
  if (page === 1) removeSavingsPercentSample(editable);
  if (page === 2) updateDescription(editable, report);
  fields.forEach((field) => replaceDynamicNode(master, editable, field.id));
  if (page === 2) replaceDynamicNode(master, editable, '_opis_oferty_opis');
  if (page === 0) updateCoverImage(master, options.coverImageDataUrl);
  if (page === 2) updateTariffCharts(master, report);
  if (page === 3) {
    updateMonthlyTable(master, report.energy.currentMonths, false);
    updateChart(master, report.energy.currentMonths, false);
  }
  if (page === 4) {
    updateMonthlyTable(master, report.energy.projectedMonths, true);
    updateChart(master, report.energy.projectedMonths, true);
  }
  applyB2cAmountLabels(master);
  injectFonts(master);
  master.documentElement.setAttribute('width', String(reformB2cTemplate.width));
  master.documentElement.setAttribute('height', String(reformB2cTemplate.height));
  master.documentElement.setAttribute('viewBox', `0 0 ${reformB2cTemplate.width} ${reformB2cTemplate.height}`);
  return new XMLSerializer().serializeToString(master);
}

export function renderAllOfferSvgPages(offer: any, options: RenderOptions = {}) {
  return reformB2cTemplate.pages.map((page) => renderOfferSvgPage(offer, page.index, options));
}

export function validateOfferTemplatePage(page: ReformB2cPageIndex) {
  const parser = new DOMParser();
  return (['master', 'editable'] as const).map((layer) => {
    const document = parser.parseFromString(readTemplate(layer, page), 'image/svg+xml');
    const svg = document.documentElement;
    const ids = allElements(document).map((node) => node.getAttribute('id')).filter((id): id is string => Boolean(id));
    const duplicates = Array.from(new Set(ids.filter((id, index) => ids.indexOf(id) !== index)));
    const missingRequiredIds = requiredEditableIds[page].filter((id) => !ids.includes(id));
    return {
      layer,
      width: svg.getAttribute('width'),
      height: svg.getAttribute('height'),
      viewBox: svg.getAttribute('viewBox'),
      duplicates,
      missingRequiredIds,
    };
  });
}
