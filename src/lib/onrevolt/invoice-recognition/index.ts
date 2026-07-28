import type { PDFParse as PDFParseType } from 'pdf-parse';
import { recognizeInvoiceText } from './registry';

export * from './types';
export { recognizeInvoiceText, registeredInvoiceParsers } from './registry';

export async function recognizeInvoicePdf(bytes: Buffer) {
  const { PDFParse } = require('pdf-parse/node') as {
    PDFParse: typeof PDFParseType;
  };
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const result = await parser.getText();
    return recognizeInvoiceText(result.text);
  } finally {
    await parser.destroy();
  }
}
