import { eneaInvoiceParserV1 } from './parsers/enea-v1';
import type { InvoiceRecognitionResult, InvoiceTextParser } from './types';

const parsers: InvoiceTextParser[] = [
  eneaInvoiceParserV1,
];

export function recognizeInvoiceText(text: string): InvoiceRecognitionResult {
  if (!text.trim()) throw new Error('PDF nie zawiera warstwy tekstowej');
  const invoiceNumbers = new Set(
    Array.from(text.matchAll(/FAKTURA VAT NR\s+([A-Z0-9/-]+)/gi))
      .map((match) => match[1].toUpperCase()),
  );
  if (invoiceNumbers.size > 1) {
    throw new Error(
      `PDF zawiera ${invoiceNumbers.size} faktury ENEA. Rozdziel dokument i wgraj każdą fakturę osobno.`,
    );
  }
  const parser = parsers.find((candidate) => candidate.canParse(text));
  if (!parser) throw new Error('Nie rozpoznano obsługiwanego szablonu faktury ENEA');
  return parser.parse(text);
}

export function registeredInvoiceParsers() {
  return parsers.map(({ id, version, provider }) => ({ id, version, provider }));
}
