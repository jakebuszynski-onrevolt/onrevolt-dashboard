import assert from 'node:assert/strict';
import test from 'node:test';
import { ChakraProvider } from '@chakra-ui/react';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as any).React = React;

const emptyInvoice = {
  id: 'invoice-1',
  type: 'FAKTURA_PRAD',
  title: 'Faktura ENEA',
  fileName: 'faktura.pdf',
  mimeType: 'application/pdf',
  invoiceNumber: null,
  amountGross: null,
  amountDue: null,
  billingCycleMonths: null,
  billingPeriodFrom: null,
  billingPeriodTo: null,
  documentDate: null,
  invoicePpeNumber: null,
  invoiceTariff: null,
  energyConsumptionKwh: null,
  invoiceRecognition: {
    fields: {
      consumption: {
        totalBeforeBalancingKwh: null,
        exportedAfterBalancingKwh: null,
        monthly: [],
      },
    },
  },
};

async function renderPanel({ variant, documents = [] }: { variant?: 'energy'; documents?: any[] } = {}) {
  const { default: ClientDocumentsPanel } = await import('./ClientDocumentsPanel');
  const props: any = {
    mode: 'invoices',
    clientId: 'client-1',
    documents,
    onChanged: () => undefined,
  };
  if (variant) props.variant = variant;

  return renderToStaticMarkup(createElement(
    ChakraProvider,
    null,
    createElement(ClientDocumentsPanel, props),
  ));
}

test('wariant energy pokazuje kreski dla brakujących pól i nie emituje zerowych sum', async () => {
  const markup = await renderPanel({ variant: 'energy', documents: [emptyInvoice] });

  assert.match(markup, /Pobór: —/);
  assert.match(markup, /Oddanie: —/);
  assert.match(markup, /<td[^>]*>—<\/td>/);
  assert.doesNotMatch(markup, /0(?:[,.]0+)?\s*(?:kWh|zł)/);
});

test('zwykła faktura pokazuje pobór licznikowy bez wymyślonego oddania', async () => {
  const document = { ...emptyInvoice, energyConsumptionKwh: 845,
    invoiceRecognition: { fields: { consumption: { importBasis: 'METERED', meteredImportKwh: 845, monthly: [] } } } };
  const markup = await renderPanel({ variant: 'energy', documents: [document] });
  assert.match(markup, /Pobór: 845\s*kWh/);
  assert.match(markup, /Oddanie: —/);
});

test('wariant energy renderuje semantyczną tabelę faktur z wymaganymi kolumnami', async () => {
  const markup = await renderPanel({ variant: 'energy', documents: [emptyInvoice] });

  assert.match(markup, /<table\b/);
  assert.match(markup, /<thead\b/);
  assert.match(markup, /<tbody\b/);
  assert.match(markup, /<th\b[^>]*>Dokument \/ okres<\/th>/);
  assert.match(markup, /<th\b[^>]*>Pobór \/ oddanie<\/th>/);
  assert.match(markup, /<th\b[^>]*>Rachunek brutto<\/th>/);
  assert.match(markup, /<th\b[^>]*>Status<\/th>/);
});

test('wariant energy udostępnia wybór pliku wyłącznie jako PDF', async () => {
  const markup = await renderPanel({ variant: 'energy' });
  const fileInput = markup.match(/<input\b(?=[^>]*\btype="file")[^>]*>/)?.[0];

  assert.ok(fileInput, 'powinno istnieć pole wyboru pliku');
  assert.match(fileInput, /accept="\.pdf,application\/pdf"/);
  assert.doesNotMatch(fileInput, /png|jpe?g|image\//i);
  assert.match(markup, /Wybierz plik/);
  assert.match(markup, /PDF \(jedyny obsługiwany format\)/);
});

test('bez variant zachowuje dotychczasowy formularz faktury', async () => {
  const markup = await renderPanel();

  assert.match(markup, /Dodaj fakturę ENEA/);
  assert.match(markup, /Faktura PDF/);
  assert.match(markup, /Brak dokumentów w tej sekcji\./);
  assert.doesNotMatch(markup, /Faktury za energię/);
  assert.doesNotMatch(markup, /Dokument \/ okres/);
  assert.doesNotMatch(markup, /<table\b/);
});
