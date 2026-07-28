import {
  InvoiceEnergyZone,
  InvoiceMonthlyEnergy,
  InvoiceRecognitionResult,
  InvoiceTextParser,
} from '../types';

const parserId = 'enea.invoice';
const parserVersion = '1.0.0';

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
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : undefined;
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

export function parseEneaInvoiceV1(text: string): InvoiceRecognitionResult {
  const compact = compactText(text);
  const periodFrom = isoDate(firstMatch(compact, /Za okres od\s+(\d{2}\/\d{2}\/\d{4})/i));
  const periodTo = isoDate(firstMatch(compact, /Za okres od\s+\d{2}\/\d{2}\/\d{4}\s+do\s+(\d{2}\/\d{2}\/\d{4})/i));
  const monthly = parseMonthlyEnergy(compact, periodFrom, periodTo);
  const zones = parseEnergyZones(text);

  const exciseConsumptionKwh = parseInteger(firstMatch(
    compact,
    /Od\s+(\d[\d\s]*)\s+kWh energii elektrycznej czynnej przed bilansowaniem/i,
  ));
  const monthlyBeforeBalancingKwh = monthly.length
    ? sum(monthly.map((item) => item.consumptionBeforeBalancingKwh))
    : undefined;
  const totalBeforeBalancingKwh = monthlyBeforeBalancingKwh || exciseConsumptionKwh;
  const totalAfterBalancingKwh = parseInteger(firstMatch(
    compact,
    /Ogółem zużycie po bilansowaniu:\s*(\d[\d\s]*)\s*kWh/i,
  ));
  const exportedBeforeBalancingKwh = monthly.length
    ? sum(monthly.map((item) => item.exportedBeforeBalancingKwh))
    : undefined;
  const exportedAfterBalancingKwh = monthly.length
    ? sum(monthly.map((item) => item.exportedAfterBalancingKwh))
    : undefined;

  const fields = {
    invoiceNumber: firstMatch(compact, /FAKTURA VAT NR\s+([A-Z0-9/-]+)/i),
    issueDate: isoDate(firstMatch(compact, /Data wystawienia:\s*(\d{2}\/\d{2}\/\d{4})/i)),
    saleDate: isoDate(firstMatch(compact, /Data sprzedaży:\s*(\d{2}\/\d{2}\/\d{4})/i)),
    dueDate: isoDate(firstMatch(compact, /Termin płatności:\s*(\d{2}\/\d{2}\/\d{4})/i)),
    periodFrom,
    periodTo,
    billingCycleMonths: monthly.length || undefined,
    amountGross: parsePolishNumber(firstMatch(
      compact,
      /Należność z rozliczenia\s+([0-9][0-9 .]*,[0-9]{2})/i,
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
    fields.consumption.totalAfterBalancingKwh,
  ];
  const recognizedRequired = requiredFields.filter((value) => value != null && value !== '').length;

  const monthlyAfter = monthly.length
    ? sum(monthly.map((item) => item.consumptionAfterBalancingKwh))
    : undefined;
  const zonesTotal = zones.length ? sum(zones.map((item) => item.consumptionKwh)) : undefined;
  if (!monthly.length) warnings.push('Nie rozpoznano miesięcznego zestawienia energii.');
  if (!approximatelyEqual(monthlyAfter, totalAfterBalancingKwh)) {
    warnings.push('Suma miesięcznego zużycia po bilansowaniu nie zgadza się z wartością ogółem.');
  }
  if (!approximatelyEqual(zonesTotal, totalAfterBalancingKwh)) {
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
    && /ENEA S\.A\./i.test(text)
    && /ZA ENERGIĘ ELEKTRYCZNĄ I USŁUGI DYSTRYBUCJI/i.test(text),
  parse: parseEneaInvoiceV1,
};
