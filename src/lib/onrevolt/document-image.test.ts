import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { isHeicFileName, prepareDocumentFile } from './document-image';

test('recognizes HEIC and HEIF file names regardless of letter case', () => {
  assert.equal(isHeicFileName('zdjecie.HEIC'), true);
  assert.equal(isHeicFileName('zdjecie.heif'), true);
  assert.equal(isHeicFileName('zdjecie.jpg'), false);
});

test('converts a HEIC file to a browser-compatible JPEG', async () => {
  const convertedJpeg = await sharp({
    create: {
      width: 12,
      height: 8,
      channels: 3,
      background: { r: 20, g: 120, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();
  let converterCalled = false;

  const prepared = await prepareDocumentFile({
    bytes: Buffer.from('test-heic'),
    fileName: 'zdjęcie klienta.HEIC',
    mimeType: 'image/heic',
  }, async (options) => {
    converterCalled = true;
    assert.equal(options.format, 'JPEG');
    assert.equal(options.quality, 0.9);
    return convertedJpeg;
  });
  const metadata = await sharp(prepared.bytes).metadata();

  assert.equal(converterCalled, true);
  assert.equal(prepared.fileName, 'zdjęcie klienta.jpg');
  assert.equal(prepared.mimeType, 'image/jpeg');
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 12);
  assert.equal(metadata.height, 8);
});

test('leaves other supported files unchanged', async () => {
  const source = Buffer.from('%PDF-test');
  const prepared = await prepareDocumentFile({
    bytes: source,
    fileName: 'dokument.pdf',
    mimeType: 'application/pdf',
  });

  assert.equal(prepared.bytes, source);
  assert.equal(prepared.fileName, 'dokument.pdf');
  assert.equal(prepared.mimeType, 'application/pdf');
});
