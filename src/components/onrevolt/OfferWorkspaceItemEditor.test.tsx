import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import OfferWorkspaceItemEditor, { buildOfferWorkspaceItemEdits, seedGroups } from './OfferWorkspaceItemEditor';
import type { WorkspaceTemplate } from './OfferWorkspacePanel';
import { emptyOfferWorkspaceDraft, parseOfferWorkspaceDraft, type OfferWorkspaceDraft } from 'lib/onrevolt/offer-workspace';
import { applyOfferWorkspaceConfigurationEdits, configurationEnergyQuantityFingerprint, parseOfferWorkspaceConfigurationEdits, validateOfferWorkspaceConfigurationEdits } from 'lib/onrevolt/offer-workspace-configuration-edits';
import { priceOfferWorkspaceConfiguration } from 'lib/onrevolt/offer-workspace-pricing';

function template(): WorkspaceTemplate {
  return {
    id: 'battery', name: 'Zestaw kontrolny', kind: 'MAGAZYN', powerKw: 15, capacityKwh: 48,
    items: [{ id: 'battery-row', position: 1, description: 'Magazyn energii', quantity: 3,
      role: 'MAIN_EQUIPMENT', supplyMode: 'ONREVOLT_SUPPLIED', pricingMode: 'INDIVIDUAL',
      unitPurchaseNet: 6441, purchaseVatRate: 0.23, operatingCostNet: 300, operatingCostBasis: 'PER_LINE',
      marginRate: 0.3, saleVatRate: 0.08, unitSaleNet: null, productId: 'device',
      product: { id: 'device', name: 'Oryginalny model', category: 'MAGAZYN_ENERGII', prices: [] },
      isOptional: false, requiresReview: false }],
  } as unknown as WorkspaceTemplate;
}

function draft(): OfferWorkspaceDraft {
  return { ...emptyOfferWorkspaceDraft(), selectedTemplateIds: ['battery'], saleVatMode: 'REDUCED_8' };
}

function addedDraft(): OfferWorkspaceDraft {
  return parseOfferWorkspaceDraft({ ...draft(), saleVatMode: 'MIXED', configurationEdits: [{ templateId: 'battery',
    addedItems: [{ id: 'accessory', description: 'Dodatkowy osprzęt', quantity: 2, role: 'ACCESSORY', supplyMode: 'ONREVOLT_SUPPLIED',
      pricing: { unitSaleNet: 100, unitPurchaseNet: 50, purchaseVatRate: 0.23, operatingCostNet: 10,
        operatingCostBasis: 'PER_UNIT', saleVatRate: 0.08 } }],
  }] });
}

function build(groups: ReturnType<typeof seedGroups>, templates: WorkspaceTemplate[], input: OfferWorkspaceDraft, clientType = 'B2C') {
  return parseOfferWorkspaceConfigurationEdits(buildOfferWorkspaceItemEdits(groups, templates, input, clientType));
}

test('otwarcie i równoważny zapis ilości/ceny nie zmieniają ceny obliczonej ani precyzji ceny ręcznej', () => {
  const source = template();
  const input = draft();
  const groups = seedGroups([source], input, 'B2C');
  groups[0].rows[0].quantity = '3,00';
  groups[0].rows[0].unitSaleAmount = '9183,560';
  assert.deepEqual(build(groups, [source], input), []);
  assert.equal(priceOfferWorkspaceConfiguration([source], input.saleVatMode, 'B2C').systemCostBeforeFinancing, 27550.69);

  source.items[0].unitSaleNet = 8503.123456789123;
  const exact = seedGroups([source], input, 'B2C');
  assert.deepEqual(build(exact, [source], input), []);
  assert.equal(source.items[0].unitSaleNet, 8503.123456789123);
});

test('niezmieniony starszy zapis techniczny i cena równa konfiguracji nie tworzą roboczych zmian', () => {
  const source = template();
  const input = parseOfferWorkspaceDraft({ ...draft(), configurationEdits: [{ templateId: source.id,
    items: [{ itemId: 'battery-row', pricing: { unitSaleNet: 8503.3 } }],
    technical: { powerKw: 14, capacityKwh: 47, quantityFingerprint: configurationEnergyQuantityFingerprint(source) },
  }] });
  validateOfferWorkspaceConfigurationEdits([source], input);
  const groups = seedGroups([source], input, 'B2C');
  assert.deepEqual(build(groups, [source], input), input.configurationEdits);
});

test('cena brutto przechodzi przez zapis szkicu bez zmiany kosztów, a powrót do oryginału usuwa zmianę', () => {
  const source = template();
  const input = draft();
  const groups = seedGroups([source], input, 'B2C');
  groups[0].rows[0].unitSaleAmount = '9184,00';
  groups[0].rows[0].salePriceEdited = true;
  const saved = parseOfferWorkspaceDraft(JSON.parse(JSON.stringify({ ...input, configurationEdits: build(groups, [source], input) })));
  const effective = applyOfferWorkspaceConfigurationEdits([source], saved);
  const price = priceOfferWorkspaceConfiguration(effective, input.saleVatMode, 'B2C');
  assert.equal(price.systemCostBeforeFinancing, 27552);
  assert.equal(price.lines[0].resolvedCosts?.operatingCostNet, 300);
  assert.equal(price.lines[0].resolvedCosts?.operatingCostBasis, 'PER_LINE');
  assert.equal(price.lines[0].resolvedCosts?.unitPurchaseNet, 6441);
  const returned = seedGroups([source], saved, 'B2C');
  returned[0].rows[0].unitSaleAmount = '9183,56';
  returned[0].rows[0].salePriceEdited = true;
  assert.deepEqual(build(returned, [source], saved), []);
});

test('zmiana ilości używa widocznej ceny brutto i wymaga nowych parametrów; powrót usuwa wygenerowane nadpisania', () => {
  const source = template();
  const input = draft();
  const groups = seedGroups([source], input, 'B2C');
  groups[0].rows[0].quantity = '2';
  groups[0].powerKw = '';
  groups[0].capacityKwh = '';
  groups[0].technicalConfirmed = false;
  assert.throws(() => build(groups, [source], input), /Potwierdź parametry/);
  groups[0].powerKw = '15';
  groups[0].capacityKwh = '32';
  groups[0].technicalConfirmed = true;
  const saved = { ...input, configurationEdits: build(groups, [source], input) };
  validateOfferWorkspaceConfigurationEdits([source], saved);
  assert.equal(priceOfferWorkspaceConfiguration(applyOfferWorkspaceConfigurationEdits([source], saved), input.saleVatMode, 'B2C').systemCostBeforeFinancing, 18367.12);
  const returned = seedGroups([source], saved, 'B2C');
  returned[0].rows[0].quantity = '3';
  returned[0].technicalConfirmed = false;
  returned[0].powerKw = '';
  returned[0].capacityKwh = '';
  assert.deepEqual(build(returned, [source], saved), []);
});

test('zmiana ilości nie zaokrągla zapisanej ręcznej ceny netto', () => {
  const source = template();
  source.items[0].unitSaleNet = 8503.123456789123;
  const input = draft();
  const groups = seedGroups([source], input, 'B2C');
  groups[0].rows[0].quantity = '2';
  groups[0].powerKw = '15';
  groups[0].capacityKwh = '32';
  groups[0].technicalConfirmed = true;
  const effective = applyOfferWorkspaceConfigurationEdits([source], { ...input, configurationEdits: build(groups, [source], input) });
  assert.equal(effective[0].items[0].unitSaleNet, 8503.123456789123);
});

test('usunięcie wcześniej przeliczonego głównego urządzenia usuwa nieaktualne potwierdzenie', () => {
  const source = template();
  const input = draft();
  const groups = seedGroups([source], input, 'B2C');
  groups[0].rows[0].quantity = '2';
  groups[0].powerKw = '15';
  groups[0].capacityKwh = '32';
  groups[0].technicalConfirmed = true;
  const saved = { ...input, configurationEdits: build(groups, [source], input) };
  const removed = seedGroups([source], saved, 'B2C');
  removed[0].rows[0].removed = true;
  removed[0].technicalConfirmed = false;
  removed[0].powerKw = '';
  removed[0].capacityKwh = '';
  const next = { ...saved, configurationEdits: build(removed, [source], saved) };
  validateOfferWorkspaceConfigurationEdits([source], next);
  assert.equal(next.configurationEdits[0].technical, undefined);
  assert.equal(next.configurationEdits[0].items?.[0].removed, true);
  assert.equal(priceOfferWorkspaceConfiguration(applyOfferWorkspaceConfigurationEdits([source], next), 'REDUCED_8', 'B2C').lines[0].includedInSale, false);
});

test('usunięcie innego głównego urządzenia wymaga potwierdzenia, jeśli pozostaje aktywna zmieniona ilość', () => {
  const source = template();
  source.items.push({ ...source.items[0], id: 'inverter-row', position: 2, quantity: 1,
    product: { ...source.items[0].product!, id: 'inverter', category: 'INWERTER' } });
  const input = draft();
  const groups = seedGroups([source], input, 'B2C');
  groups[0].rows[0].quantity = '2';
  groups[0].powerKw = '15';
  groups[0].capacityKwh = '32';
  groups[0].technicalConfirmed = true;
  const saved = { ...input, configurationEdits: build(groups, [source], input) };
  const changed = seedGroups([source], saved, 'B2C');
  changed[0].rows[1].removed = true;
  changed[0].technicalConfirmed = false;
  changed[0].powerKw = '';
  changed[0].capacityKwh = '';
  assert.throws(() => build(changed, [source], saved), /Potwierdź parametry/);
  changed[0].powerKw = '10';
  changed[0].capacityKwh = '32';
  changed[0].technicalConfirmed = true;
  const next = { ...saved, configurationEdits: build(changed, [source], saved) };
  validateOfferWorkspaceConfigurationEdits([source], next);
  assert.equal(next.configurationEdits[0].technical?.powerKw, 10);
  assert.equal(next.configurationEdits[0].items?.find(item => item.itemId === 'inverter-row')?.removed, true);
});

test('nowa pozycja B2C MIXED przelicza 8% i 23% bez domyślnego narzutu', () => {
  const source = template();
  const input = { ...draft(), saleVatMode: 'MIXED' as const };
  for (const percent of [8, 23]) {
    const groups = seedGroups([source], input, 'B2C');
    const row = seedGroups([source], addedDraft(), 'B2C')[0].rows.find(row => row.added)!;
    row.persistedAdded = false;
    row.saleVatRate = String(percent);
    row.unitSaleAmount = percent === 8 ? '108' : '123';
    row.salePriceEdited = true;
    groups[0].rows.push(row);
    const edits = build(groups, [source], input);
    assert.equal(edits[0].addedItems?.[0].pricing.unitSaleNet, 100);
    assert.equal(edits[0].addedItems?.[0].pricing.saleVatRate, percent / 100);
    assert.equal(edits[0].addedItems?.[0].pricing.marginRate, undefined);
    const reloaded = { ...input, configurationEdits: edits };
    assert.deepEqual(build(seedGroups([source], reloaded, 'B2C'), [source], reloaded), edits);
  }
});

test('zmiana VAT dodanej pozycji zachowuje widoczną cenę brutto dla B2C i netto dla B2B', () => {
  const source = template();
  const input = addedDraft();
  for (const clientType of ['B2C', 'B2B']) {
    const groups = seedGroups([source], input, clientType);
    groups[0].rows.find(row => row.added)!.saleVatRate = '23';
    const edited = { ...input, configurationEdits: build(groups, [source], input, clientType) };
    const price = priceOfferWorkspaceConfiguration(applyOfferWorkspaceConfigurationEdits([source], edited), 'MIXED', clientType);
    const line = price.lines.find(line => line.workspaceAdded)!;
    assert.equal(line.saleAmount, clientType === 'B2C' ? 216 : 200);
    assert.equal(line.saleVatRate, 0.23);
  }
});

test('usunięcie i przywrócenie zachowują cenę do podglądu, ale usunięta pozycja nie trafia do sumy', () => {
  const source = template();
  const input = parseOfferWorkspaceDraft({ ...draft(), configurationEdits: [{ templateId: 'battery', items: [{ itemId: 'battery-row', removed: true }] }] });
  const groups = seedGroups([source], input, 'B2C');
  assert.equal(groups[0].rows[0].unitSaleAmount, '9183,56');
  assert.equal(priceOfferWorkspaceConfiguration(applyOfferWorkspaceConfigurationEdits([source], input), 'REDUCED_8', 'B2C').lines[0].includedInSale, false);
  groups[0].rows[0].removed = false;
  assert.deepEqual(build(groups, [source], input), []);
});

test('błędna cena nie jest zapisywana, a zachowane koszty indywidualne nadal oznaczają zmieniony wiersz', () => {
  const source = template();
  const input = draft();
  const groups = seedGroups([source], input, 'B2C');
  groups[0].rows[0].unitSaleAmount = '-';
  groups[0].rows[0].salePriceEdited = true;
  assert.throws(() => build(groups, [source], input), /poprawną|liczb/);
  assert.equal(groups[0].rows[0].unitSaleAmount, '-');
  const hidden = parseOfferWorkspaceDraft({ ...input, configurationEdits: [{ templateId: 'battery', items: [{ itemId: 'battery-row',
    pricing: { unitSaleNet: 8503.3, operatingCostNet: 400 } }] }] });
  const markup = renderToStaticMarkup(<ChakraProvider><OfferWorkspaceItemEditor templates={[source]} draft={hidden} clientType="B2C" disabled onApply={() => undefined} /></ChakraProvider>);
  assert.ok(markup.includes('data-change="changed"'), 'Koszty indywidualne muszą pozostawić oznaczenie zmienionej pozycji.');
  assert.ok(!markup.includes('role="dialog"'), 'Tabela nie może otwierać starego modala.');
});
