import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOfferWorkspaceDocumentRequest,
  offerWorkspaceDocumentPreviewTemplateKey,
  offerWorkspaceDocumentAspectRatio,
  offerWorkspaceDocumentFrameStyle,
  readDocumentResponse,
  svgSrcDoc,
} from './OfferWorkspaceDocumentPreview';
import type { OfferWorkspaceDocumentResult } from 'lib/onrevolt/offer-workspace-document';
import type { OfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import type { WorkspaceData } from './OfferWorkspacePanel';

test('SVG frame keeps the mockup aspect ratio and fills its positioned wrapper', () => {
  assert.equal(offerWorkspaceDocumentAspectRatio, 595 / 843);
  assert.deepEqual(offerWorkspaceDocumentFrameStyle, {
    position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0,
  });
});

test('srcDoc scales the SVG responsively and only permits data images and fonts', () => {
  const source = svgSrcDoc('<svg width="595" height="843"></svg>');
  assert.match(source, /default-src 'none'/);
  assert.match(source, /script-src 'none'/);
  assert.match(source, /img-src data:/);
  assert.match(source, /font-src data:/);
  assert.match(source, /html,body\{margin:0;overflow:hidden\}/);
  assert.match(source, /svg\{display:block;width:100%;height:auto\}/);
  assert.match(source, /<svg width="595" height="843"><\/svg>/);
});

test('development and production requests use their respective document route contracts', () => {
  const workspace = { projectId: 'project/1', input: { reportDetails: { phone: null } } } as WorkspaceData;
  const draft = { description: { before: '', after: 'aktualny draft' } } as OfferWorkspaceDraft;
  assert.deepEqual(createOfferWorkspaceDocumentRequest(workspace, draft, true), {
    endpoint: '/offer-workspace-preview/document', body: { workspace, draft },
  });
  assert.deepEqual(createOfferWorkspaceDocumentRequest(workspace, draft, false), {
    endpoint: '/api/projects/project%2F1/offer-workspace/document', body: { draft, sourceRevision: workspace.revision },
  });
});

test('document response parser accepts the confirmed { ok: true, document } envelope', async () => {
  const result: OfferWorkspaceDocumentResult = {
    templateKey: offerWorkspaceDocumentPreviewTemplateKey, sourceRevision: 'a'.repeat(64), pageCount: 10,
    pages: Array.from({ length: 10 }, (_, index) => ({
      page: (index + 1) as OfferWorkspaceDocumentResult['pages'][number]['page'],
      svg: `<svg data-page="${index + 1}"/>`, sourceSha256: 'b'.repeat(64), replacedFieldKeys: [],
    })),
    sourceFieldsUsed: [], missingData: [], suppressedCharts: [], limitations: [],
  };
  const response = new Response(JSON.stringify({ ok: true, document: result }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
  assert.deepEqual(await readDocumentResponse(response), result);
});

test('document preview rejects V3 instead of silently showing the archived layout', async () => {
  const result: OfferWorkspaceDocumentResult = {
    templateKey: 'REFORM_B2C/2026_10_V3', sourceRevision: 'a'.repeat(64), pageCount: 10,
    pages: Array.from({ length: 10 }, (_, index) => ({
      page: (index + 1) as OfferWorkspaceDocumentResult['pages'][number]['page'],
      svg: `<svg data-page="${index + 1}"/>`, sourceSha256: 'b'.repeat(64), replacedFieldKeys: [],
    })),
    sourceFieldsUsed: [], missingData: [], suppressedCharts: [], limitations: [],
  };
  const response = new Response(JSON.stringify({ ok: true, document: result }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
  await assert.rejects(readDocumentResponse(response), /wymaga szablonu REFORM_B2C\/2026_10_V4/);
});
