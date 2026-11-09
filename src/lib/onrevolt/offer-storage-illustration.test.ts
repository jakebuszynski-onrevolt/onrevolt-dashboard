import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveOfferStorageIllustration } from './offer-storage-illustration';
import type { OfferWorkspaceTemplate } from './offer-workspace-server';

function template(items: Array<[string, number]>) {
  return [{ id: 'storage', kind: 'MAGAZYN', items: items.map(([sku, quantity]) => ({ quantity, product: { sku } })) }] as OfferWorkspaceTemplate[];
}

test('PowerBrick illustration uses exact product and states offered quantity independently of photo', () => {
  const result = resolveOfferStorageIllustration(template([['ES-Dyness-LV-PowerBrick-Plus-16.07kWh-EU', 2]]), ['storage'])!;
  assert.equal(result.family, 'PowerBrick Plus');
  assert.match(result.caption, /2 szt/);
  assert.match(result.caption, /jednego modułu/);
  assert.deepEqual(result.dimensions, { widthMm: 435, depthMm: 235, heightMm: 850 });
});

test('STACK100 PRO approved splits use assembled manual dimensions, with independent second BDU when present', () => {
  for (const [count, bdus, secondHeight] of [[12, 1, 867], [14, 1, 1205], [16, 2, 1644]]) {
    const result = resolveOfferStorageIllustration(template([
      ['ES-Dyness-STACK100-5.12kWh-PRO-EU', count], ['ES-Dyness-STACK100-BDU-PRO-EU', bdus],
      ['ES-Dyness-STACK100-PRO-Expansion-Kit-EU', 1],
    ]), ['storage'])!;
    assert.equal(result.dimensions?.heightMm, 1644);
    assert.equal(result.dimensions?.depthMm, 459);
    assert.ok(result.caption.includes(secondHeight.toLocaleString('pl-PL')));
    assert.equal(result.missingReason, null);
  }
});

test('STACK314 dimensions vary with actual module count; unsupported family never gets a replacement image', () => {
  const result = resolveOfferStorageIllustration(template([
    ['ES-Dyness-STACK314-16.04kWh-EU', 4], ['ES-Dyness-STACK314-BDU-EU', 1],
  ]), ['storage'])!;
  assert.deepEqual(result.dimensions, { widthMm: 770, depthMm: 425, heightMm: 1213 });
  assert.equal(result.dataUrl, `data:image/png;base64,${readFileSync(path.join(process.cwd(), 'assets/offer-storage/stack314.png')).toString('base64')}`);
  assert.equal(resolveOfferStorageIllustration(template([['OTHER', 1]]), ['storage'])?.dataUrl, null);
  assert.equal(resolveOfferStorageIllustration(template([['OTHER', 1]]), []), null);
});

test('cabinet quantity does not multiply one-cabinet dimensions or select an image for a mixed family', () => {
  const result = resolveOfferStorageIllustration(template([['ES-Dyness-BF100-C100-EU', 2]]), ['storage'])!;
  assert.deepEqual(result.dimensions, { widthMm: 725, depthMm: 1200, heightMm: 2260 });
  assert.match(result.caption, /2 szt\. BF100/);
  assert.match(result.caption, /jednej szafy/);
  assert.equal(result.dataUrl, `data:image/png;base64,${readFileSync(path.join(process.cwd(), 'assets/offer-storage/cabinet-bf100.png')).toString('base64')}`);
  const mixed = resolveOfferStorageIllustration(template([
    ['ES-Dyness-BF100-C100-EU', 1], ['ES-Dyness-STACK314-16.04kWh-EU', 3],
  ]), ['storage'])!;
  assert.equal(mixed.dataUrl, null);
});


test('Cabinet C100E i nazwa Cabinet wybierają zdjęcie bez zgadywania wymiarów; 314Ah nie oznacza STACK314', () => {
  for (const sku of ['ES-Dyness-BF100-C100E-EU', 'OTHER-CABINET']) {
    const templates = template([[sku, 1]]);
    templates[0].name = 'Solis S6 20kW + BF100 Battery Cabinet C100E';
    Object.assign(templates[0].items[0].product!, { name: 'Battery Cabinet, 314Ah, 100kWh', category: 'MAGAZYN_ENERGII' });
    const result = resolveOfferStorageIllustration(templates, ['storage'])!;
    assert.equal(result.family, 'Cabinet');
    assert.equal(result.dimensions, null);
    assert.equal(result.missingReason, null);
    assert.equal(result.dataUrl, 'data:image/png;base64,' + readFileSync('assets/offer-storage/cabinet-bf100.png').toString('base64'));
  }
  const mixed = template([['ES-Dyness-BF100-C100E-EU', 1], ['ES-Dyness-STACK314-16.04kWh-EU', 3]]);
  assert.equal(resolveOfferStorageIllustration(mixed, ['storage'])?.dataUrl, null);
});
