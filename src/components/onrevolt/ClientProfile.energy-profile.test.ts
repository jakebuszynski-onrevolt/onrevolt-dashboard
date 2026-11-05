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

function findProfileLoader() {
  let loader: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'loadEnergyProfile'
      && node.initializer && ts.isCallExpression(node.initializer)
      && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === 'useCallback') {
      const callback = node.initializer.arguments[0];
      if (callback && ts.isArrowFunction(callback)) loader = callback;
    }
    ts.forEachChild(node, visit);
  };
  visit(profileAst);
  assert.ok(loader, 'loadEnergyProfile callback must exist');
  return loader;
}

function containsCall(node: ts.Node, name: string): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) return true;
  return node.getChildren(profileAst).some(child => containsCall(child, name));
}

function refreshCalls(node: ts.Node): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (current: ts.Node) => {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)
      && current.expression.text === 'setAnalysisRefreshKey') calls.push(current);
    ts.forEachChild(current, visit);
  };
  visit(node);
  return calls;
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function loaderFactory() {
  const compiled = ts.transpileModule(findProfileLoader().getText(profileAst), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText.trim().replace(/;$/, '');
  return new Function(
    'activeEnergyProfileKey', 'activeEnergyProfileKeyRef', 'energyProfileRequest', 'activeProjectId',
    'clientId', 'analysisStartMonth', 'setEnergyProfileLoading', 'setEnergyProfile', 'setEnergyProfileKey',
    'setEnergyProfileLoadState', 'setSelectedEnergyProfileMonth', 'fetch',
    `return (${compiled});`,
  ) as (...args: any[]) => () => Promise<void>;
}

function loaderHarness() {
  const activeKeyRef = { current: '' };
  const requestCounter = { current: 0 };
  const requests: Array<Deferred<{ ok: boolean; json: () => Promise<any> }>> = [];
  const state: { loading: boolean; profile: any; profileKey: string; loadState: any; selectedMonth: string } = {
    loading: false,
    profile: null,
    profileKey: '',
    loadState: null,
    selectedMonth: '',
  };
  const factory = loaderFactory();

  function bind(key: string, analysisStartMonth: string) {
    return factory(
      key,
      activeKeyRef,
      requestCounter,
      'project-9',
      'client-9',
      analysisStartMonth,
      (value: boolean) => { state.loading = value; },
      (value: any) => { state.profile = value; },
      (value: string) => { state.profileKey = value; },
      (value: any) => { state.loadState = value; },
      (update: (current: string) => string) => { state.selectedMonth = update(state.selectedMonth); },
      async () => {
        const request = deferred<{ ok: boolean; json: () => Promise<any> }>();
        requests.push(request);
        return request.promise;
      },
    );
  }

  function resolve(index: number, analysisStartMonth: string, annualKwh: number) {
    const profile = { analysisStartMonth, annualKwh, months: [{ key: analysisStartMonth }] };
    requests[index].resolve({ ok: true, json: async () => ({ ok: true, data: profile }) });
    return profile;
  }

  return { activeKeyRef, requestCounter, requests, state, bind, resolve };
}

test('stale render callback cannot supersede the current profile request', async () => {
  const harness = loaderHarness();
  const oldKey = '["project-9","2026-10",4]';
  const currentKey = '["project-9","2026-10",5]';
  harness.activeKeyRef.current = currentKey;

  const currentRequest = harness.bind(currentKey, '2026-10')();
  assert.equal(harness.requestCounter.current, 1);
  assert.equal(harness.requests.length, 1);

  await harness.bind(oldKey, '2026-10')();
  assert.equal(harness.requestCounter.current, 1, 'a stale callback must not claim the latest request id');
  assert.equal(harness.requests.length, 1, 'a stale callback must not issue another fetch');

  const currentProfile = harness.resolve(0, '2026-10', 9991);
  await currentRequest;
  assert.deepEqual(harness.state.loadState, { key: currentKey, status: 'ready' });
  assert.equal(harness.state.profile, currentProfile);
  assert.equal(harness.state.profileKey, currentKey);
  assert.equal(harness.state.loading, false);
});

test('in-flight profile response is discarded when its key becomes stale', async () => {
  const harness = loaderHarness();
  const oldKey = '["project-9","2026-10",4]';
  const currentKey = '["project-9","2026-11",5]';
  harness.activeKeyRef.current = oldKey;

  const oldRequest = harness.bind(oldKey, '2026-10')();
  assert.equal(harness.requests.length, 1);
  harness.activeKeyRef.current = currentKey;
  const oldProfile = harness.resolve(0, '2026-10', 9990);
  await oldRequest;
  assert.equal(harness.state.profile, null);
  assert.deepEqual(harness.state.loadState, { key: oldKey, status: 'loading' });

  const currentRequest = harness.bind(currentKey, '2026-11')();
  const currentProfile = harness.resolve(1, '2026-11', 9991);
  await currentRequest;
  assert.notEqual(harness.state.profile, oldProfile);
  assert.equal(harness.state.profile, currentProfile);
  assert.deepEqual(harness.state.loadState, { key: currentKey, status: 'ready' });
  assert.equal(harness.state.loading, false);
});

test('energy saves leave automatic profile refresh to the key-driven effect', () => {
  for (const name of ['saveEnergyOverview', 'saveEnergyDataSettings']) {
    const saveFunction = findFunction(name);
    assert.ok(!containsCall(saveFunction, 'loadEnergyProfile'), `${name} must not start a competing profile request`);

    const finalizer = saveFunction.body?.statements.find(ts.isTryStatement)?.finallyBlock;
    assert.ok(finalizer, `${name} must finalize its save state`);
    const conditionalRefresh = finalizer.statements.find(statement => ts.isIfStatement(statement)
      && statement.expression.getText(profileAst) === 'auditSaved');
    assert.ok(conditionalRefresh, `${name} must invalidate after a successful audit, including later account failures`);
    assert.equal(refreshCalls(finalizer).length, 1);
    assert.equal(refreshCalls(saveFunction).length, 1, 'refresh-key invalidation must happen only in finally');
  }

  const overviewText = findFunction('saveEnergyOverview').getText(profileAst);
  assert.ok(overviewText.indexOf('auditSaved = true') < overviewText.indexOf("fetch('/api/crm/clients/energy-account'"),
    'audit success must be recorded before the follow-up account save can fail');
});
