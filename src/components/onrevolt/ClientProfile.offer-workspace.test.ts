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
