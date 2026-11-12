import {
  InvoiceEnergyZone,
  InvoiceMonthlyEnergy,
  InvoiceRecognitionResult,
  InvoiceTextParser,
} from '../types';

const parserId = 'enea.invoice';
const parserVersion = '1.2.0';

function compactText(text: string) {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parsePolishNumber(value?: string) {
  if (!value) return undefined;
  const number = Number(value.replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : undefined;
}

function parseInteger(value?: string) {
  if (!value) return undefined;
  const number = Number(value.replace(/\s/g, ''));
  return Number.isInteger(number) ? number : undefined;
}

function isoDate(value?: string) {
  const match = value?.match(/^(\d{2})([/.])(\d{2})\2(\d{4})$/);
  if (!match) return undefined;

  const day = Number(match[1]);
  const month = Number(match[3]);
  const year = Number(match[4]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!daysInMonth || day < 1 || day > daysInMonth) return undefined;

  return `${match[4]}-${match[3]}-${match[1]}`;
}

function firstMatch(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]?.trim();
}

function inclusiveMonths(periodFrom?: string, periodTo?: string) {
  if (!periodFrom || !periodTo) return [];
  const [fromYear, fromMonth] = periodFrom.split('-').map(Number);
  const [toYear, toMonth] = periodTo.split('-').map(Number);
  if (!fromYear || !fromMonth || !toYear || !toMonth) return [];

  const result: Array<{ year: number; month: number; period: string }> = [];
  let cursor = fromYear * 12 + fromMonth - 1;
  const end = toYear * 12 + toMonth - 1;
  while (cursor <= end && result.length < 24) {
    const year = Math.floor(cursor / 12);
    const month = cursor % 12 + 1;
    result.push({ year, month, period: `${year}-${String(month).padStart(2, '0')}` });
    cursor += 1;
  }
  return result;
}

function rowNumbers(compact: string, pattern: RegExp, expected: number) {
  const value = firstMatch(compact, pattern);
  const numbers = value?.match(/\d+(?:[.,]\d+)?/g)?.map((item) => parsePolishNumber(item));
  if (!numbers?.length) return [];
  return numbers.filter((item): item is number => item != null).slice(0, expected);
}

function parseMonthlyEnergy(compact: string, periodFrom?: string, periodTo?: string) {
  const months = inclusiveMonths(periodFrom, periodTo);
  if (!months.length) return [];

  const before = rowNumbers(
    compact,
    /ilość en\. el\. pobranej\s+(.+?)\s+ilość energii wprow/i,
    months.length,
  );
  const exportedBefore = rowNumbers(
    compact,
    /ilość energii wprow do sieci\s+(.+?)\s+ilości en\. pobr/i,
    months.length,
  );
  const after = rowNumbers(
    compact,
    /ilości en\. pobr zbilansow godz Eb\(t\)\+\s+(.+?)\s+ilości en\. wprow/i,
    months.length,
  );
  const exportedAfter = rowNumbers(
    compact,
    /ilości en\. wprow zbilansow godz Eb\(t\)-\s+(.+?)\s+ROZLICZENIE ENERGII/i,
    months.length,
  );

  if (![before, exportedBefore, after, exportedAfter].some(values => values.length)) return [];
  return months.map<InvoiceMonthlyEnergy>((month, index) => ({
    ...month,
    consumptionBeforeBalancingKwh: before[index],
    consumptionAfterBalancingKwh: after[index],
    exportedBeforeBalancingKwh: exportedBefore[index],
    exportedAfterBalancingKwh: exportedAfter[index],
  }));
}

function parseEnergyZones(text: string) {
  const start = text.indexOf('ROZLICZENIE - SPRZEDAŻ ENERGII');
  const end = text.indexOf('Ogółem wartość - sprzedaż energii:', start);
  if (start < 0 || end < 0) return [];

  const zones = new Map<string, number>();
  for (const line of text.slice(start, end).split(/\r?\n/)) {
    const match = line.trim().match(/^(.+?)\s+kWh\s+(.+)$/i);
    if (!match) continue;
    const quantity = parsePolishNumber(match[2].match(/\d+(?:[.,]\d+)?/)?.[0]);
    const name = match[1].replace(/\s+/g, ' ').trim();
    if (!name || quantity == null) continue;
    zones.set(name, (zones.get(name) || 0) + quantity);
  }
  return Array.from(zones, ([name, consumptionKwh]): InvoiceEnergyZone => ({ name, consumptionKwh }));
}

function sum(values: Array<number | undefined>) {
  return values.reduce<number>((total, value) => total + (value || 0), 0);
}

function summaryGross(compact: string) {
  const summary = firstMatch(compact, /PODSUMOWANIE:\s+(.+?)\s+Od\s+\d[\d\s]*\s+kWh/i);
  const values = summary?.match(/[0-9][0-9 .]*,[0-9]{2}/g) || [];
  return parsePolishNumber(values.at(-1));
}

function approximatelyEqual(left?: number, right?: number) {
  if (left == null || right == null) return true;
  return Math.abs(left - right) < 0.01;
}

function parseNetMetering(compact: string) {
  const section = firstMatch(compact, /Rozliczenie energii elektrycznej wprowadzonej wobec ilości energii pobranej(.+?)ROZLICZENIE\s*-\s*SPRZEDAŻ ENERGII/i);
  if (!section) return null;
  // This table distinguishes hourly balancing (columns 3/4) from the discount (7).
  // Reject an unknown layout instead of interpreting the billed remainder as imports.
  if (!/Współczynnik\s*\(opust\)/i.test(section) || !/1\s+2\s+3\s+4\s+5\s+6\s+7\s+8\s/.test(section)) {
    throw new Error('Nie rozpoznano kolumn rozliczenia opustu ENEA. Sprawdź fakturę ręcznie.');
  }
  const row = section.match(/1\.\s*Energia elektryczna\s+całodobowa\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*$/i);
  const values = row?.slice(1).map(parsePolishNumber);
  if (!values || values.some(v => v == null || v < 0) || ![0.7, 0.8].includes(values[5]!)) {
    throw new Error('Nie rozpoznano wartości w tabeli opustu ENEA. Sprawdź fakturę ręcznie.');
  }
  return { totalBeforeBalancingKwh: values[0]!, exportedBeforeBalancingKwh: values[1]!,
    totalAfterBalancingKwh: values[2]!, exportedAfterBalancingKwh: values[3]!,
    netMeteringFactor: values[5]!, billedAfterDiscountKwh: values[6]! };
}

function sumComplete(values: Array<number | undefined>) {
  return values.length && values.every(value => value != null) ? sum(values) : undefined;
}

function hasSupportedSellerName(text: string) {
  const compact = compactText(text);
  return /(?:^|\s)SPRZEDAWCA\s+ENEA\s+(?:S\.A\.|SPRZEDAŻ\s+SP\.\s*Z\s*O\.O\.)(?=\s|,|$)/i.test(compact);
}

function hasProsumerBalancingOrDiscountIndicators(compact: string) {
  return /prosument|prosumenck|bilans|opust|upust|rabat|zniżk|net[\s-]?(?:metering|billing)|depozyt|mikroinstalacj|współczynnik\s*\(opust\)|energia\s+(?:elektryczna\s+)?(?:wprowadzon|oddawan)|po\s+opuście/i.test(compact);
}

export function parseEneaInvoiceV1(text: string): InvoiceRecognitionResult {
  const compact = compactText(text);
  const periodMatch = compact.match(/Za okres od\s+(\d{2}[/.]\d{2}[/.]\d{4})\s+do\s+(\d{2}[/.]\d{2}[/.]\d{4})/i);
  const periodFrom = isoDate(periodMatch?.[1]);
  const periodTo = isoDate(periodMatch?.[2]);
  const monthly = parseMonthlyEnergy(compact, periodFrom, periodTo);
  const netMetering = parseNetMetering(compact);
  // Sales-zone quantities include the discount, so they are not grid consumption.
  const zones = netMetering ? [] : parseEnergyZones(text);

  const exciseConsumptionKwh = parseInteger(firstMatch(
    compact,
    /Od\s+(\d[\d\s]*)\s+kWh energii elektrycznej czynnej(?: przed bilansowaniem)?\s+naliczono akcyzę/i,
  ));
  const zonesTotal = zones.length ? sum(zones.map((item) => item.consumptionKwh)) : undefined;
  const hasPlainMeteredTotal = /Ogółem zużycie:/i.test(compact);
  const hasMeteredImportBasis = hasPlainMeteredTotal && !hasProsumerBalancingOrDiscountIndicators(compact);
  const plainMeteredTotalKwh = parseInteger(firstMatch(compact, /Ogółem zużycie:\s*(\d[\d\s]*)\s*kWh\b/i));
  const meteredImportKwh = plainMeteredTotalKwh != null
    && hasMeteredImportBasis
    && exciseConsumptionKwh != null
    && approximatelyEqual(exciseConsumptionKwh, plainMeteredTotalKwh)
    && zonesTotal != null
    && approximatelyEqual(zonesTotal, plainMeteredTotalKwh)
    ? plainMeteredTotalKwh
    : undefined;
  const monthlyBeforeBalancingKwh = sumComplete(monthly.map(item => item.consumptionBeforeBalancingKwh));
  const totalBeforeBalancingKwh = netMetering?.totalBeforeBalancingKwh
    ?? monthlyBeforeBalancingKwh
    ?? (hasPlainMeteredTotal ? undefined : exciseConsumptionKwh);
  const totalAfterBalancingKwh = netMetering?.totalAfterBalancingKwh ?? parseInteger(firstMatch(
    compact,
    /Ogółem zużycie po bilansowaniu:\s*(\d[\d\s]*)\s*kWh/i,
  ));
  const exportedBeforeBalancingKwh = netMetering?.exportedBeforeBalancingKwh
    ?? sumComplete(monthly.map(item => item.exportedBeforeBalancingKwh));
  const exportedAfterBalancingKwh = netMetering?.exportedAfterBalancingKwh
    ?? sumComplete(monthly.map(item => item.exportedAfterBalancingKwh));

  const fields = {
    invoiceNumber: firstMatch(compact, /FAKTURA VAT NR\s+([A-Z0-9/-]+)/i),
    issueDate: isoDate(firstMatch(compact, /Data wystawienia:\s*(\d{2}[/.]\d{2}[/.]\d{4})/i)),
    saleDate: isoDate(firstMatch(compact, /Data sprzedaży:\s*(\d{2}[/.]\d{2}[/.]\d{4})/i)),
    dueDate: isoDate(firstMatch(compact, /Termin płatności:\s*(\d{2}[/.]\d{2}[/.]\d{4})/i)),
    periodFrom,
    periodTo,
    billingCycleMonths: inclusiveMonths(periodFrom, periodTo).length || undefined,
    amountGross: parsePolishNumber(firstMatch(
      compact,
      /Należność za okres od\s+\d{2}[/.]\d{2}[/.]\d{4}\s+do\s+\d{2}[/.]\d{2}[/.]\d{4}\s+([0-9][0-9 .]*,[0-9]{2})/i,
    )) ?? parsePolishNumber(firstMatch(
      compact, /Należność z rozliczenia\s+([0-9][0-9 .]*,[0-9]{2})/i,
    )) ?? summaryGross(compact),
    amountDue: parsePolishNumber(firstMatch(
      compact,
      /Do zapłaty:\s*([0-9][0-9 .]*,[0-9]{2})\s*zł/i,
    )) ?? parsePolishNumber(firstMatch(
      compact,
      /Saldo z rozliczenia:\s*([0-9][0-9 .]*,[0-9]{2})\s*zł/i,
    )),
    currency: 'PLN' as const,
    customerNumber: firstMatch(compact, /Nr kontrahenta(?: \(odbiorcy\))?:?\s*(\d+)/i),
    ppeNumber: firstMatch(compact, /Kod PPE:\s*(\d+)/i),
    tariff: firstMatch(compact, /Grupa taryfowa:\s*([A-Z0-9_-]+)/i),
    consumption: {
      totalBeforeBalancingKwh,
      totalAfterBalancingKwh,
      exportedBeforeBalancingKwh,
      exportedAfterBalancingKwh,
      ...(meteredImportKwh != null ? { meteredImportKwh } : {}),
      ...(hasMeteredImportBasis ? { importBasis: 'METERED' as const } : {}),
      ...(netMetering ? { billedAfterDiscountKwh: netMetering.billedAfterDiscountKwh, netMeteringFactor: netMetering.netMeteringFactor } : {}),
      monthly,
      zones,
    },
  };

  const warnings: string[] = [];
  const requiredFields = [
    fields.invoiceNumber,
    fields.issueDate,
    fields.periodFrom,
    fields.periodTo,
    fields.amountGross,
    fields.ppeNumber,
    fields.tariff,
    fields.consumption.totalAfterBalancingKwh ?? fields.consumption.meteredImportKwh,
  ];
  const recognizedRequired = requiredFields.filter((value) => value != null && value !== '').length;

  const monthlyAfter = sumComplete(monthly.map(item => item.consumptionAfterBalancingKwh));
  const recognizedConsumptionKwh = totalAfterBalancingKwh ?? meteredImportKwh;
  if (!monthly.length) warnings.push(netMetering || meteredImportKwh != null
    ? 'Faktura podaje sumy za cały okres, bez miesięcznego zestawienia energii.'
    : 'Nie rozpoznano miesięcznego zestawienia energii.');
  if (hasPlainMeteredTotal && meteredImportKwh == null) {
    warnings.push('Wartość ogółem zużycia nie została potwierdzona zgodnością z akcyzą i strefami.');
  }
  if (!approximatelyEqual(monthlyAfter, totalAfterBalancingKwh)) {
    warnings.push('Suma miesięcznego zużycia po bilansowaniu nie zgadza się z wartością ogółem.');
  }
  if (!approximatelyEqual(zonesTotal, recognizedConsumptionKwh)) {
    warnings.push('Suma zużycia w strefach nie zgadza się z wartością ogółem.');
  }
  if (recognizedRequired < requiredFields.length) {
    warnings.push('Nie wszystkie kluczowe pola faktury zostały rozpoznane.');
  }

  return {
    schemaVersion: 1,
    provider: 'ENEA',
    parser: { id: parserId, version: parserVersion },
    confidence: Number((recognizedRequired / requiredFields.length).toFixed(3)),
    warnings,
    fields,
  };
}

export const eneaInvoiceParserV1: InvoiceTextParser = {
  id: parserId,
  version: parserVersion,
  provider: 'ENEA',
  canParse: (text) => /FAKTURA VAT NR/i.test(text)
    && hasSupportedSellerName(text)
    && /ZA ENERGIĘ ELEKTRYCZNĄ I USŁUGI DYSTRYBUCJI/i.test(text),
  parse: parseEneaInvoiceV1,
};
