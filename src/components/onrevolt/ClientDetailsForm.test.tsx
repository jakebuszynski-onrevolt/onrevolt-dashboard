import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const extensions = (require as any).extensions;
extensions['.css'] = (module: any) => { module.exports = { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) }; };

const componentPath = path.resolve(__dirname, './ClientDetailsForm.tsx');
const profilePath = path.resolve(__dirname, './ClientProfile.tsx');
const componentSource = readFileSync(componentPath, 'utf8');
const profileSource = readFileSync(profilePath, 'utf8');
const profileAst = ts.createSourceFile(profilePath, profileSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const values = {
  displayName: 'Anna Nowak',
  clientType: 'B2C',
  phone: '+48 600 100 200',
  email: 'anna@example.test',
  taxId: '1234567890',
  addressLine: 'Leśna 4',
  postalCode: '00-123',
  city: 'Łódź',
  investmentAddress: 'Słoneczna 12, Łódź',
  latitude: '51.7592',
  longitude: '19.4560',
  mapProvider: 'GOOGLE',
  ownerId: 'staff-1',
  clientProblem: 'Wysokie rachunki',
  expectedResult: 'Niższe koszty energii',
  projectTitle: 'Dom Kowalskich',
  projectClientType: 'B2C',
  status: 'LEAD',
  stageId: 'stage-1',
  nextActionTitle: 'Telefon do klienta',
  nextActionAt: '2026-11-04T09:30',
  notes: 'NOTATKA NIE MOŻE BYĆ W FORMULARZU',
};

const props = {
  values,
  registeredAt: '2024-06-12T12:00:00.000Z',
  origin: 'Import ręczny',
  statusLabel: 'Nowy kontakt',
  clientTypes: [['B2C', 'Osoba prywatna'], ['B2B', 'Firma']] as const,
  staff: [{ id: 'staff-1', name: 'Ewa Opiekun' }],
  stages: [{ id: 'stage-1', name: 'Kontakt wstępny' }],
  saving: false,
  onChange: () => {},
  onAddressChange: () => {},
  onLocationSelect: () => {},
  onStageChange: () => {},
  onSave: () => {},
  onCancel: () => {},
};

function findSaveClientRequest(sourceFile: ts.SourceFile) {
  let saveClient: ts.FunctionDeclaration | undefined;
  const findFunction = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'saveClient') saveClient = node;
    ts.forEachChild(node, findFunction);
  };
  findFunction(sourceFile);
  assert.ok(saveClient, 'ClientProfile must define saveClient');

  let payload: ts.ObjectLiteralExpression | undefined;
  const visitRequest = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch'
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '/api/crm/clients') {
      const init = node.arguments[1];
      if (init && ts.isObjectLiteralExpression(init)) {
        const body = init.properties.find(property => ts.isPropertyAssignment(property)
          && property.name.getText(sourceFile) === 'body');
        if (body && ts.isPropertyAssignment(body) && ts.isCallExpression(body.initializer)
          && ts.isPropertyAccessExpression(body.initializer.expression)
          && body.initializer.expression.name.text === 'stringify') {
          const candidate = body.initializer.arguments[0];
          if (candidate && ts.isObjectLiteralExpression(candidate)) payload = candidate;
        }
      }
    }
    ts.forEachChild(node, visitRequest);
  };
  visitRequest(saveClient);
  assert.ok(payload, 'saveClient must send a JSON object to /api/crm/clients');
  return payload;
}

test('details form renders core, map, and project fields without exposing notes', async () => {
  const previousReact = (globalThis as any).React;
  (globalThis as any).React = React;
  let html: string;
  let clientDetailsKeys: readonly string[];
  try {
    const component = await import('./ClientDetailsForm');
    html = renderToStaticMarkup(React.createElement(component.default, props as any));
    clientDetailsKeys = component.clientDetailsKeys;
  } finally {
    if (previousReact === undefined) delete (globalThis as any).React;
    else (globalThis as any).React = previousReact;
  }

  for (const label of [
    'Imię i nazwisko / Nazwa', 'Typ klienta', 'Telefon', 'Adres e-mail', 'NIP', 'Opiekun projektu',
    'Ulica', 'Kod', 'Miasto', 'Adres inwestycji i zdjęcie lokalizacji', 'Problematyka',
    'Oczekiwany rezultat', 'Nazwa projektu', 'Typ projektu', 'Status projektu', 'Etap',
    'Następne działanie', 'Termin następnego działania', 'Adres inwestycji projektu',
  ]) assert.ok(html.includes(label), label);
  for (const value of ['Anna Nowak', 'Słoneczna 12, Łódź', 'Dom Kowalskich', 'Nowy kontakt', 'Import ręczny']) {
    assert.ok(html.includes(value), value);
  }
  assert.ok(html.includes('Data rejestracji'));
  assert.ok(html.includes('12.06.2024'));
  assert.match(componentSource, /<FormLabel>Data rejestracji<\/FormLabel><Input value=\{registration\} isReadOnly/);
  assert.match(componentSource, /<FormLabel>Źródło projektu<\/FormLabel><Input value=\{props\.origin\} isReadOnly/);
  assert.match(componentSource, /<FormLabel>Status projektu<\/FormLabel><Input value=\{props\.statusLabel\} isReadOnly/);
  assert.ok(!html.includes('NOTATKA NIE MOŻE BYĆ W FORMULARZU'));
  assert.ok(!clientDetailsKeys.includes('notes' as never));
  assert.ok(!clientDetailsKeys.includes('source' as never));
  assert.ok(!clientDetailsKeys.includes('registeredAt' as never));
  assert.ok(html.includes('Anuluj'));
  assert.ok(html.includes('Zapisz zmiany'));
});

test('details form retains its callback wiring for save, cancel, stage, and location actions', () => {
  assert.match(componentSource, /onClick=\{props\.onCancel\}/);
  assert.match(componentSource, /onClick=\{props\.onSave\}/);
  assert.match(componentSource, /onStageChange\(event\.target\.value\)/);
  assert.match(componentSource, /onAddressChange=\{props\.onAddressChange\}/);
  assert.match(componentSource, /onSelect=\{props\.onLocationSelect\}/);
});

test('resetClientDetails restores only detail fields and retains unrelated client and energy state', async () => {
  const { clientDetailsKeys, resetClientDetails } = await import('./ClientDetailsForm');
  const saved = Object.fromEntries(clientDetailsKeys.map(key => [key, `saved:${key}`]));
  const originalNotes = { title: 'Notatka ogólna', body: 'Zachowaj mnie' };
  const energyState = { annualKwh: '4200', notes: 'Uwagi do energii' };
  const emsState = { station: 'EMS-7', enabled: true };
  const current = {
    ...Object.fromEntries(clientDetailsKeys.map(key => [key, `edited:${key}`])),
    notes: 'legacy draft',
    overviewNotes: [originalNotes],
    energyState,
    emsState,
    dashboardStation: 'station-9',
  } as any;

  const reset = resetClientDetails(current, saved as any);
  for (const key of clientDetailsKeys) assert.equal(reset[key], `saved:${key}`, key);
  assert.equal(reset.notes, 'legacy draft');
  assert.equal(reset.overviewNotes, current.overviewNotes);
  assert.equal(reset.energyState, energyState);
  assert.equal(reset.emsState, emsState);
  assert.equal(reset.dashboardStation, 'station-9');
  assert.notEqual(reset, current);
  assert.equal(current.displayName, 'edited:displayName');
});

test('saveClient never includes client notes in the client update payload', () => {
  const payload = findSaveClientRequest(profileAst);
  const containsNotes = (node: ts.Node): boolean => {
    if (ts.isPropertyAssignment(node) && node.name.getText(profileAst).replace(/^['"]|['"]$/g, '') === 'notes') return true;
    return node.getChildren(profileAst).some(containsNotes);
  };
  assert.ok(!containsNotes(payload), 'PUT /api/crm/clients must not send notes');
});
