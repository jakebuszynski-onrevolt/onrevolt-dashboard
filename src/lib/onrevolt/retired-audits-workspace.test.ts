import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = path.resolve(__dirname, '../..');

test('standalone audits workspace and its private scenario endpoint are removed', () => {
  const routes = readFileSync(path.join(source, 'routes.tsx'), 'utf8');
  assert.doesNotMatch(routes, /\/audits|Audyty i energia/);
  for (const file of [
    'app/admin/audits/page.tsx',
    'components/onrevolt/AuditsWorkspace.tsx',
    'app/api/energy-scenarios/route.ts',
  ]) assert.equal(existsSync(path.join(source, file)), false, file);
});

test('client energy data, site audits and shared offer calculations remain available', () => {
  for (const file of [
    'app/api/energy-audits/route.ts',
    'app/api/site-audits/route.ts',
    'components/onrevolt/ClientSiteAuditPanel.tsx',
    'lib/onrevolt/energy-scenario.ts',
    'lib/onrevolt/offers.ts',
  ]) assert.equal(existsSync(path.join(source, file)), true, file);
  assert.match(readFileSync(path.join(source, 'components/onrevolt/ClientProfile.tsx'), 'utf8'), /\/api\/energy-audits/);
});
