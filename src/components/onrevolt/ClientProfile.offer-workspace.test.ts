import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const profilePath = path.resolve(__dirname, './ClientProfile.tsx');
const profileSource = readFileSync(profilePath, 'utf8');
const profileAst = ts.createSourceFile(profilePath, profileSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findFunction(name: string) {
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(profileAst);
  assert.ok(found, `ClientProfile must define ${name}`);
  return found;
}

function loadFunction<T extends (...args: any[]) => any>(name: string): T {
  const compiled = ts.transpileModule(findFunction(name).getText(profileAst), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(`${compiled}; return ${name};`)() as T;
}

function loadClientSavePayloadSerializer() {
  const declarations = ['buildClientSavePayload', 'serializeClientSavePayload']
    .map((name) => findFunction(name).getText(profileAst))
    .join('\n');
  const compiled = ts.transpileModule(declarations, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(`${compiled}; return serializeClientSavePayload;`)() as (
    clientId: string, client: any, project: any, form: any,
  ) => string;
}

function findAutoOpenEffect() {
  let found: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect') {
      const callback = node.arguments[0];
      if (callback && ts.isArrowFunction(callback)
        && callback.getText(profileAst).includes('offerWorkspaceAutoOpenContext')) found = callback;
    }
    ts.forEachChild(node, visit);
  };
  visit(profileAst);
  assert.ok(found, 'ClientProfile must check saved offer drafts in an effect');
  return found;
}

const baseContext = {
  enabled: true,
  authorized: true,
  projectId: 'project-a',
  userId: 'staff-a',
  tabIndex: 4,
  journeyKey: 'offer',
};

test('auto-opens only for a persisted draft belonging to the active project', () => {
  const shouldOpen = loadFunction<(input: any) => boolean>('shouldAutoOpenSavedOfferWorkspace');
  const savedPayload = { ok: true, data: { projectId: 'project-a', draft: { revision: 2, input: {} } } };

  assert.equal(shouldOpen({ context: baseContext, responseOk: true, payload: savedPayload }), true);
  assert.equal(shouldOpen({ context: baseContext, responseOk: true, payload: { ok: true, data: { projectId: 'project-a', draft: null } } }), false);
  assert.equal(shouldOpen({ context: baseContext, responseOk: true, payload: { ok: true, data: { projectId: 'project-b', draft: { revision: 1 } } } }), false);
  assert.equal(shouldOpen({ context: baseContext, responseOk: false, payload: savedPayload }), false);
});

test('auto-open requires the feature, workspace permissions, and the Oferta journey', () => {
  const shouldOpen = loadFunction<(input: any) => boolean>('shouldAutoOpenSavedOfferWorkspace');
  const payload = { ok: true, data: { projectId: 'project-a', draft: { revision: 1 } } };

  assert.equal(shouldOpen({ context: { ...baseContext, enabled: false }, responseOk: true, payload }), false);
  assert.equal(shouldOpen({ context: { ...baseContext, authorized: false }, responseOk: true, payload }), false);
  assert.equal(shouldOpen({ context: { ...baseContext, userId: '' }, responseOk: true, payload }), false);
  assert.equal(shouldOpen({ context: { ...baseContext, tabIndex: 3 }, responseOk: true, payload }), false);
  assert.equal(shouldOpen({ context: { ...baseContext, journeyKey: 'contract' }, responseOk: true, payload }), false);
});

test('late lookup results are discarded after project, auth, or tab changes', () => {
  const isCurrent = loadFunction<(request: any, current: any) => boolean>('isCurrentOfferWorkspaceAutoOpenContext');

  assert.equal(isCurrent(baseContext, { ...baseContext }), true);
  assert.equal(isCurrent(baseContext, { ...baseContext, projectId: 'project-b' }), false);
  assert.equal(isCurrent(baseContext, { ...baseContext, userId: 'staff-b' }), false);
  assert.equal(isCurrent(baseContext, { ...baseContext, authorized: false }), false);
  assert.equal(isCurrent(baseContext, { ...baseContext, tabIndex: 0 }), false);
  assert.equal(isCurrent(baseContext, { ...baseContext, journeyKey: 'contract' }), false);
});

test('saved-draft checks are isolated by both user and project', () => {
  const keyFor = loadFunction<(userId: string, projectId: string) => string>('offerWorkspaceDraftKey');

  assert.notEqual(keyFor('staff-a', 'project-a'), keyFor('staff-b', 'project-a'));
  assert.notEqual(keyFor('staff-a', 'project-a'), keyFor('staff-a', 'project-b'));
  assert.equal(keyFor('staff-a', 'project-a'), keyFor('staff-a', 'project-a'));
});

test('link z oferty otwiera wybrane Dane energetyczne projektu', () => {
  assert.match(profileSource, /searchParams\.get\('tab'\) === 'billing'/u);
  assert.match(profileSource, /id="energy-data"/u);
});

test('global client save compares only its serialized payload and keeps EMS fields in scope', () => {
  const serialize = loadClientSavePayloadSerializer();
  const form = {
    displayName: 'Klient', clientType: 'B2C', taxId: '123', clientProblem: '', expectedResult: '', notes: 'not sent',
    email: 'a@example.com', phone: '123', addressLine: 'Ulica 1', postalCode: '00-001', city: 'Warszawa',
    investmentAddress: 'Ulica 2', projectTitle: 'Solis 15 kW + 48 kWh', projectClientType: 'B2C', status: 'LEAD',
    stageId: 'stage-a', ownerId: 'staff-a', nextActionTitle: '', nextActionAt: '', dashboardStation: 'station-hash',
    dashboardStationNumber: 'station-15', weatherStationNumber: 'weather-15', latitude: '52.2', longitude: '21.0',
    mapProvider: 'GOOGLE',
  };
  const client = { contacts: [{ id: 'contact-a', updatedAt: 'old' }], updatedAt: 'old', offers: [{ id: 'offer-a' }] };
  const project = { id: 'project-a', source: 'manual', updatedAt: 'old', configurations: [{ id: 'configuration-a' }] };
  const savedPayload = serialize('client-a', client, project, form);

  assert.equal(serialize(
    'client-a',
    { ...client, updatedAt: 'new', contacts: [{ ...client.contacts[0], updatedAt: 'new' }] },
    { ...project, updatedAt: 'new', offers: [{ id: 'offer-b' }] },
    { ...form, notes: 'changed but not sent' },
  ), savedPayload);
  assert.notEqual(serialize('client-a', client, project, { ...form, dashboardStationNumber: 'station-new' }), savedPayload);
  assert.notEqual(serialize('client-a', client, project, { ...form, projectTitle: 'Solis 20 kW' }), savedPayload);
  assert.notEqual(serialize('client-a', client, { ...project, id: 'project-b' }, form), savedPayload);
  assert.equal(serialize('client-a', client, project, form), savedPayload, 'reverting the form restores the saved payload');

  const saveClient = findFunction('saveClient').getText(profileAst);
  const selectProject = findFunction('selectProject').getText(profileAst);
  assert.match(saveClient, /currentClientPayload === savedClientPayload\) return/u);
  assert.match(saveClient, /body:\s*currentClientPayload/u);
  assert.match(saveClient, /await load\(\)/u);
  assert.match(selectProject, /setSavedClientPayload\(serializeClientSavePayload/u);
  assert.match(profileSource, /Zapisz dane klienta/u);
  assert.match(profileSource, /isDisabled=\{[^}]*currentClientPayload === savedClientPayload\}/u);
});

test('saved-draft detection performs one read-only GET lookup', () => {
  const effect = findAutoOpenEffect();
  const fetchCalls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
      fetchCalls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(effect);

  assert.equal(fetchCalls.length, 1);
  const options = fetchCalls[0].arguments[1];
  assert.ok(options && ts.isObjectLiteralExpression(options));
  assert.ok(!options.properties.some((property) => ts.isPropertyAssignment(property)
    && property.name.getText(profileAst) === 'method'));
});
