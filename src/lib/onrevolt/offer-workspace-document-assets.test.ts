import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import * as xml from '@xmldom/xmldom';

const filename = path.resolve(__dirname, 'offer-workspace-document-assets.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g id="grafika / zdjecie_satelitarne"><rect x="215" y="94" width="350" height="249" rx="10" fill="white"/></g></svg>';

function fixture(options: { failed?: boolean; changed?: boolean; failArtifactGet?: boolean; failArtifactPut?: boolean } = {}) {
  const calls: unknown[] = [];
  const exports: any = {};
  const artifacts = new Map<string, unknown>();
  let site = { latitude: options.changed ? 53 : 52, longitude: 17, mapProvider: 'GEOPORTAL2' };
  const modules: Record<string, unknown> = {
    './offer-workspace-document-cache': { offerDocumentMapRevision: async () => 'map-v1' },
    './offer-workspace-artifacts': {
      getOfferWorkspaceArtifact: async (key: unknown) => {
        if (options.failArtifactGet) throw new Error('artifact database read failed');
        return artifacts.get(JSON.stringify(key)) ?? null;
      },
      putOfferWorkspaceArtifact: async (key: unknown, data: unknown) => {
        if (options.failArtifactPut) throw new Error('artifact database write failed');
        artifacts.set(JSON.stringify(key), data);
      },
    },
    '@xmldom/xmldom': xml, sharp,
    './prisma': { prisma: { project: { findUnique: async () => ({ investmentSite: site }) } } },
    './location-map-images': { fetchLocationMapImage: async (...args: unknown[]) => {
      calls.push(args);
      if (options.failed) throw new Error('private upstream failure');
      return { bytes: await sharp({ create: { width: 1280, height: 908, channels: 3, background: '#009a44' } }).png().toBuffer() };
    } },
  };
  vm.runInNewContext(code, { exports, Buffer, require: (id: string) => {
    if (!(id in modules)) throw new Error(`Unexpected import ${id}`);
    return modules[id];
  } });
  const document = { pages: [{ page: 1, svg }, { page: 2, svg: '<svg/>' }], sourceFieldsUsed: [], missingData: [] as any[] };
  const workspace = { projectId: 'authorized-project', input: { location: { latitude: 52, longitude: 17 } as any } };
  return { exports, calls, document, workspace, artifacts, options, setSite: (value: typeof site) => { site = value; } };
}

test('embeds saved map source in exact SVG slot without cropping attribution', async () => {
  const state = fixture();
  await state.exports.attachOfferWorkspaceDocumentMap(state.document, state.workspace);
  assert.equal(JSON.stringify(state.calls), JSON.stringify([['GEOPORTAL2', 52, 17]]));
  const doc = new xml.DOMParser().parseFromString(state.document.pages[0].svg, 'image/svg+xml');
  const image = doc.getElementsByTagName('image')[0];
  assert.equal(image.getAttribute('width'), '350');
  assert.equal(image.getAttribute('height'), '249');
  assert.equal(image.getAttribute('x'), '215');
  assert.equal(image.getAttribute('y'), '94');
  assert.equal(image.getAttribute('preserveAspectRatio'), 'xMidYMid meet');
  assert.match(image.getAttribute('href')!, /^data:image\/png;base64,/);
  assert.equal(doc.getElementsByTagName('clipPath')[0].firstChild?.nodeName, 'rect');
  assert.equal(state.document.pages[1].svg, '<svg/>');
  assert.equal(state.document.missingData.length, 0);
  state.document.pages[0].svg = svg;
  await state.exports.attachOfferWorkspaceDocumentMap(state.document, state.workspace);
  assert.equal(state.calls.length, 1, 'unchanged map uses its persistent artifact without provider calls');
});

test('missing coordinates do not fetch or substitute a map', async () => {
  const state = fixture();
  state.workspace.input.location = null;
  await state.exports.attachOfferWorkspaceDocumentMap(state.document, state.workspace);
  assert.equal(state.calls.length, 0);
  assert.equal(state.document.pages[0].svg, svg);
  assert.match(state.document.missingData[0].reason, /Brak współrzędnych/);
});

test('unavailable map or changed coordinates are reported without exposing upstream errors', async () => {
  for (const options of [{ failed: true }, { changed: true }]) {
    const state = fixture(options);
    await state.exports.attachOfferWorkspaceDocumentMap(state.document, state.workspace);
    assert.equal(state.document.pages[0].svg, svg);
    assert.match(state.document.missingData[0].reason, /Nie udało się pobrać/);
    assert.doesNotMatch(JSON.stringify(state.document), /private upstream/);
    if (options.changed) assert.equal(state.calls.length, 0);
  }
});

test('artifact database errors reject instead of becoming a missing map', async () => {
  for (const options of [{ failArtifactGet: true }, { failArtifactPut: true }]) {
    const state = fixture(options);
    await assert.rejects(state.exports.attachOfferWorkspaceDocumentMap(state.document, state.workspace), /artifact database/);
    assert.equal(state.document.missingData.length, 0);
  }
});

test('provider failures are not cached and a later retry stores the successful image', async () => {
  const state = fixture({ failed: true });
  await state.exports.attachOfferWorkspaceDocumentMap(state.document, state.workspace);
  assert.equal(state.artifacts.size, 0);
  assert.equal(state.document.missingData.length, 1);

  state.options.failed = false;
  state.document.pages[0].svg = svg;
  await state.exports.attachOfferWorkspaceDocumentMap(state.document, state.workspace);
  assert.equal(state.calls.length, 2);
  assert.equal(state.artifacts.size, 1);
  assert.equal(state.document.missingData.length, 0);
});

test('provider and coordinates are part of the map artifact identity', async () => {
  const state = fixture();
  await state.exports.attachOfferWorkspaceDocumentMap(state.document, state.workspace);

  state.setSite({ latitude: 52, longitude: 17, mapProvider: 'GOOGLE' });
  state.document.pages[0].svg = svg;
  await state.exports.attachOfferWorkspaceDocumentMap(state.document, state.workspace);
  assert.equal(state.calls.length, 2, 'changing only the provider invalidates the artifact');

  state.setSite({ latitude: 53, longitude: 18, mapProvider: 'GOOGLE' });
  state.workspace.input.location = { latitude: 53, longitude: 18 } as any;
  state.document.pages[0].svg = svg;
  await state.exports.attachOfferWorkspaceDocumentMap(state.document, state.workspace);

  assert.equal(state.calls.length, 3, 'changing only the coordinates also invalidates the artifact');
  assert.deepEqual(state.calls, [['GEOPORTAL2', 52, 17], ['GOOGLE', 52, 17], ['GOOGLE', 53, 18]]);
  assert.equal(state.artifacts.size, 3);
});

test('embedding rejects executable SVG instead of a PNG', () => {
  const state = fixture();
  assert.throws(() => state.exports.embedOfferWorkspaceMap(svg, Buffer.from('<svg onload="alert(1)"/>')), /Nieprawidłowy obraz/);
});
