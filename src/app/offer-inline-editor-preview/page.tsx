import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { notFound } from 'next/navigation';
import InlineEditorPreviewClient from './InlineEditorPreviewClient';

export default function OfferInlineEditorPreviewPage() {
  if (process.env.NODE_ENV !== 'development' || process.env.OFFER_INLINE_EDITOR_PREVIEW !== '1') notFound();
  const file = path.join(process.cwd(), '.codex-deploy/offer-inline-editor-20261106/offer-inline-editor-baseline-20261106/client-fixture.json.gz');
  const fixture = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
  return <InlineEditorPreviewClient templates={fixture.workspace.templates} initialDraft={fixture.draft} />;
}
