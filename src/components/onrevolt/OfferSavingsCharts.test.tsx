import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import { DOMParser } from '@xmldom/xmldom';
import { OfferSavingsProjectionChart } from './OfferSavingsCharts';

function chart(before: number[], after: number[], paybackYears: number | null) {
  const globals = globalThis as typeof globalThis & { React?: typeof React };
  const previous = globals.React;
  globals.React = React;
  try {
    return renderToStaticMarkup(React.createElement(ChakraProvider, null,
      React.createElement(OfferSavingsProjectionChart, { before, after, paybackYears })));
  } finally { globals.React = previous; }
}

test('punkt zwrotu przed pierwszym rokiem leży na obu miesięcznych krzywych z kosztem początkowym', () => {
  const before = Array.from({ length: 25 }, (_, month) => month * 100);
  const after = Array.from({ length: 25 }, (_, month) => 250 + month * 20);
  const payback = 250 / 80 / 12;
  const markup = chart(before, after, payback);
  const xml = new DOMParser().parseFromString(markup.slice(markup.indexOf('<svg'), markup.indexOf('</svg>') + 6), 'image/svg+xml');
  const point = Array.from(xml.getElementsByTagName('circle')).find(node => node.getAttribute('fill') === '#7840d3')!;
  assert.ok(point, 'Zwrot krótszy niż rok musi mieć marker');
  const x = Number(point.getAttribute('cx')), y = Number(point.getAttribute('cy'));
  for (const color of ['#8999c2', '#00a450']) {
    const path = Array.from(xml.getElementsByTagName('path')).find(node => node.getAttribute('stroke') === color)!;
    const points = Array.from(path.getAttribute('d')!.matchAll(/[ML]([\d.e+-]+) ([\d.e+-]+)/g), match => [Number(match[1]), Number(match[2])]);
    const end = points.findIndex(([px]) => px >= x);
    assert.ok(end > 0);
    const [x1, y1] = points[end - 1], [x2, y2] = points[end];
    const interpolated = y1 + (y2 - y1) * (x - x1) / (x2 - x1);
    assert.ok(Math.abs(y - interpolated) < 1e-8, 'Marker musi leżeć dokładnie na każdej linii');
  }
  assert.match(markup, /Początek/);
  assert.match(markup, /Zwrot: ok. 0,3 lat/);
  assert.doesNotMatch(markup, /PLN \/ rok/);
});

test('brak zwrotu w horyzoncie nie tworzy pozornego punktu przecięcia', () => {
  const before = Array.from({ length: 25 }, (_, month) => month * 100);
  const after = before.map(cost => cost + 10000);
  const markup = chart(before, after, null);
  assert.doesNotMatch(markup, /Zwrot: ok\./);
  assert.match(markup, /inwestycja \+ suma rachunków/);
});
