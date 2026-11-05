import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOfferWorkspacePricingSnapshot,
  emptyOfferWorkspaceDraft,
  offerWorkspacePricingFreshness,
  parseOfferWorkspaceDraft,
} from './offer-workspace';
import {
  createServerOfferWorkspacePricingSnapshot,
  offerWorkspaceEffectiveClientType,
  offerWorkspacePricingChangeAcknowledged,
  offerWorkspacePricingSnapshotsMatch,
  savedDraft,
  serializeTemplate,
} from './offer-workspace-server';
import { priceOfferWorkspaceConfiguration } from './offer-workspace-pricing';

function pricedTemplate(purchaseNet = 1000, priceId = 'price-1') {
  return {
    id: 'template-1',
    name: 'Zestaw PV',
    kind: 'PV_DACH_SKOSNY',
    items: [{
      id: 'item-1',
      position: 1,
      description: 'Moduły',
      quantity: 2,
      role: 'MODULE',
      supplyMode: 'ONREVOLT_SUPPLIED',
      pricingMode: 'CATALOG',
      operatingCostBasis: 'PER_UNIT',
      catalogPriceId: priceId,
      unitPurchaseNet: null,
      purchaseVatRate: null,
      operatingCostNet: null,
      marginRate: null,
      saleVatRate: 0.08,
      isOptional: false,
      requiresReview: false,
      product: {
        id: 'product-1',
        name: 'Moduł',
        prices: [{
          id: priceId,
          purchaseNet,
          currentPurchaseNet: purchaseNet,
          purchaseVatRate: 0.23,
          operatingCostNet: 50,
          marginRate: 0.2,
          saleVatRate: 0.23,
          currency: 'PLN',
          validFrom: new Date('2026-10-01T00:00:00.000Z'),
        }],
      },
    }],
  };
}

function savedRow(pricingSnapshot: unknown) {
  return {
    revision: 2,
    sourceRevision: 'a'.repeat(64),
    updatedAt: new Date('2026-11-03T12:00:00.000Z'),
    input: { ...emptyOfferWorkspaceDraft(), _pricingSnapshot: pricingSnapshot },
  } as any;
}

test('serializacja przekazuje pola cenowe i identyfikator ceny tylko z dostępem do pricing.read', () => {
  const template = pricedTemplate() as any;
  const included = serializeTemplate(template, true);
  assert.equal(included.items[0].pricingMode, 'CATALOG');
  assert.equal(included.items[0].operatingCostBasis, 'PER_UNIT');
  assert.equal(included.items[0].catalogPriceId, 'price-1');
  assert.equal(included.items[0].product?.prices[0].id, 'price-1');

  const restricted = serializeTemplate(template, false);
  assert.equal(restricted.items[0].unitPurchaseNet, null);
  assert.equal(restricted.items[0].pricingMode, undefined);
  assert.equal(restricted.items[0].operatingCostBasis, undefined);
  assert.equal(restricted.items[0].catalogPriceId, undefined);
  assert.deepEqual(restricted.items[0].product?.prices, []);
  assert.equal(JSON.stringify(restricted).includes('price-1'), false);
});

test('snapshot jest oddzielone od edytowalnego inputu i nie wraca z żądania klienta', () => {
  const draft = emptyOfferWorkspaceDraft();
  const snapshot = createServerOfferWorkspacePricingSnapshot(draft, [], 'B2C');
  assert.ok(snapshot);

  const visible = savedDraft(savedRow(snapshot));
  assert.deepEqual(visible.pricingSnapshot, snapshot);
  assert.equal('_pricingSnapshot' in visible.input, false);

  const restricted = savedDraft(savedRow(snapshot), false);
  assert.equal('pricingSnapshot' in restricted, false);
  assert.equal('_pricingSnapshot' in restricted.input, false);

  const forged = parseOfferWorkspaceDraft({ ...draft, _pricingSnapshot: { revision: 'forged' } });
  assert.equal('_pricingSnapshot' in forged, false);
  assert.equal('pricingSnapshot' in forged, false);
});

test('fingerprint obejmuje aktualne ceny, wybrane zestawy i VAT, a brak starej migawki pozostaje nieznany', () => {
  const draft = { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['template-1'], saleVatMode: 'MIXED' as const };
  const oldTemplate = pricedTemplate(1000, 'price-1') as any;
  const decimal = (value: number) => ({ toString: () => String(value) });
  oldTemplate.items[0].quantity = decimal(2);
  oldTemplate.items[0].product.prices[0].purchaseNet = decimal(1000);
  oldTemplate.items[0].product.prices[0].currentPurchaseNet = decimal(1000);
  oldTemplate.items[0].product.prices[0].purchaseVatRate = decimal(0.23);
  oldTemplate.items[0].product.prices[0].operatingCostNet = decimal(50);
  oldTemplate.items[0].product.prices[0].marginRate = decimal(0.2);
  oldTemplate.items[0].product.prices[0].saleVatRate = decimal(0.23);
  const newTemplate = pricedTemplate(1200, 'price-2');
  const effectiveClientType = offerWorkspaceEffectiveClientType('UNKNOWN', 'B2C');
  assert.equal(effectiveClientType, 'B2C');
  const oldSnapshot = createServerOfferWorkspacePricingSnapshot(draft, [oldTemplate], effectiveClientType);
  const newSnapshot = createServerOfferWorkspacePricingSnapshot(draft, [newTemplate], effectiveClientType);
  assert.ok(oldSnapshot && newSnapshot);
  const serializedOldTemplate = serializeTemplate(oldTemplate as any, true);
  const clientPricing = priceOfferWorkspaceConfiguration([serializedOldTemplate], draft.saleVatMode, effectiveClientType);
  assert.equal(clientPricing.lines[0].saleVatRate, 0.23);
  assert.equal(oldSnapshot.revision, createOfferWorkspacePricingSnapshot(
    draft,
    effectiveClientType,
    clientPricing,
    [serializedOldTemplate],
  ).revision);
  const clientSnapshot = createOfferWorkspacePricingSnapshot(
    draft,
    effectiveClientType,
    clientPricing,
    [serializedOldTemplate],
  );
  assert.equal(offerWorkspacePricingSnapshotsMatch(oldSnapshot, clientSnapshot), true);
  assert.equal(offerWorkspacePricingSnapshotsMatch(oldSnapshot, newSnapshot), false);
  assert.equal(offerWorkspacePricingSnapshotsMatch(null, null), true);
  assert.equal(offerWorkspacePricingSnapshotsMatch(oldSnapshot, null), false);
  assert.equal(offerWorkspacePricingChangeAcknowledged(oldSnapshot, oldSnapshot), true);
  assert.equal(offerWorkspacePricingChangeAcknowledged(oldSnapshot, newSnapshot), false);
  assert.equal(offerWorkspacePricingChangeAcknowledged(oldSnapshot, newSnapshot, oldSnapshot.revision), false);
  assert.equal(offerWorkspacePricingChangeAcknowledged(oldSnapshot, newSnapshot, newSnapshot.revision), true);
  assert.equal(offerWorkspacePricingChangeAcknowledged(null, newSnapshot), true);
  assert.equal(offerWorkspacePricingChangeAcknowledged(oldSnapshot, null, newSnapshot.revision), false);
  assert.equal(createServerOfferWorkspacePricingSnapshot(draft, [{ ...oldTemplate, name: 'Nazwa po zmianie' }], effectiveClientType)?.revision,
    oldSnapshot.revision);
  assert.notEqual(oldSnapshot.revision, newSnapshot.revision);
  assert.notDeepEqual(oldSnapshot.totals, newSnapshot.totals);
  assert.equal(offerWorkspacePricingFreshness(undefined, newSnapshot), 'NO_BASELINE');
  assert.equal(offerWorkspacePricingFreshness(oldSnapshot, oldSnapshot), 'CURRENT');
  assert.equal(offerWorkspacePricingFreshness(oldSnapshot, newSnapshot), 'STALE');

  const anotherSelection = { ...draft, selectedTemplateIds: ['other-template'] };
  const selectionSnapshot = createServerOfferWorkspacePricingSnapshot(anotherSelection, [oldTemplate], 'B2C');
  assert.ok(selectionSnapshot);
  assert.notEqual(oldSnapshot.revision, selectionSnapshot.revision);
  const anotherVat = { ...draft, saleVatMode: 'REDUCED_8' as const };
  const vatSnapshot = createServerOfferWorkspacePricingSnapshot(anotherVat, [oldTemplate], 'B2C');
  assert.ok(vatSnapshot);
  assert.notEqual(oldSnapshot.revision, vatSnapshot.revision);

  const unresolvedOld = pricedTemplate(1000, 'same-price-id') as any;
  const unresolvedNew = pricedTemplate(1200, 'same-price-id') as any;
  unresolvedOld.items[0].product.prices[0].marginRate = null;
  unresolvedNew.items[0].product.prices[0].marginRate = null;
  const unresolvedOldSnapshot = createServerOfferWorkspacePricingSnapshot(draft, [unresolvedOld], 'B2C');
  const unresolvedNewSnapshot = createServerOfferWorkspacePricingSnapshot(draft, [unresolvedNew], 'B2C');
  assert.ok(unresolvedOldSnapshot && unresolvedNewSnapshot);
  assert.deepEqual(unresolvedOldSnapshot.totals, { net: null, gross: null });
  assert.notEqual(unresolvedOldSnapshot.revision, unresolvedNewSnapshot.revision);
});
