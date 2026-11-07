import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

async function render(latitude: string, longitude: string) {
  const previousReact = (globalThis as any).React;
  (globalThis as any).React = React;
  try {
    const { default: Picker } = await import('./InvestmentLocationPicker');
    return renderToStaticMarkup(React.createElement(Picker, {
      address: 'Adres testowy', latitude, longitude, mapProvider: 'GEOPORTAL2',
      onAddressChange() {}, onMapProviderChange() {}, onSelect() {},
    }));
  } finally { (globalThis as any).React = previousReact; }
}

test('saved location is expanded immediately when client details open', async () => {
  assert.match(await render('52.3892246', '17.1588914'), /aria-expanded="true"/);
});

test('missing or invalid coordinates do not open an invented location', async () => {
  for (const [lat, lng] of [['', ''], [' ', ' '], ['NaN', '17'], ['91', '17'], ['52', '181']]) {
    assert.match(await render(lat, lng), /aria-expanded="false"/);
  }
});
