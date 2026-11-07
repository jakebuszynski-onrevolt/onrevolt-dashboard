import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearOfferWorkspaceDocumentMemoryCacheForTests,
  getOfferWorkspaceDocumentCache,
  isOfferWorkspaceDocumentKey,
  offerWorkspaceDocumentCacheScope,
  setOfferWorkspaceDocumentCache,
} from './offer-workspace-document-client-cache';
import type { OfferWorkspaceDocumentResult } from './offer-workspace-document';

const document: OfferWorkspaceDocumentResult = {
  templateKey: 'REFORM_B2C/2026_10_V4', sourceRevision: 'a'.repeat(64), pageCount: 10,
  pages: Array.from({ length: 10 }, (_, index) => ({
    page: (index + 1) as OfferWorkspaceDocumentResult['pages'][number]['page'],
    svg: `<svg data-page="${index + 1}"/>`, sourceSha256: 'b'.repeat(64), replacedFieldKeys: [],
  })),
  sourceFieldsUsed: [], missingData: [], suppressedCharts: [], limitations: [],
};

test('document cache scope is actor and project specific and excludes missing identity', () => {
  assert.equal(offerWorkspaceDocumentCacheScope(undefined, 'project-1'), null);
  assert.equal(offerWorkspaceDocumentCacheScope('actor-1', ' '), null);
  assert.notEqual(offerWorkspaceDocumentCacheScope('actor-1', 'project-1'), offerWorkspaceDocumentCacheScope('actor-2', 'project-1'));
  assert.notEqual(offerWorkspaceDocumentCacheScope('actor-1', 'project-1'), offerWorkspaceDocumentCacheScope('actor-1', 'project-2'));
});

test('document cache keeps only keyed, valid documents and partitions memory by scope', async () => {
  clearOfferWorkspaceDocumentMemoryCacheForTests();
  const first = offerWorkspaceDocumentCacheScope('actor-a', 'project-1');
  const second = offerWorkspaceDocumentCacheScope('actor-b', 'project-1');
  const entry = { documentKey: 'c'.repeat(64), document };
  assert.equal(isOfferWorkspaceDocumentKey(entry.documentKey), true);
  assert.equal(isOfferWorkspaceDocumentKey('not-a-document-key'), false);

  setOfferWorkspaceDocumentCache(first, entry);
  assert.deepEqual(await getOfferWorkspaceDocumentCache(first), entry);
  assert.equal(await getOfferWorkspaceDocumentCache(second), null);
  setOfferWorkspaceDocumentCache(second, { ...entry, documentKey: 'invalid' });
  assert.equal(await getOfferWorkspaceDocumentCache(second), null);
  clearOfferWorkspaceDocumentMemoryCacheForTests();
});
