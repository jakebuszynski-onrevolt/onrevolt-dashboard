import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export const SUMMARY_VERSION = '20260929-summary-grid-charging-3';

function replaceOnce(text: string, before: string, after: string) {
  if (text.split(before).length !== 2) throw new Error(`Niejednoznaczne miejsce poprawki: ${before}`);
  return text.replace(before, after);
}

export function patchDashboardSummary(source: string) {
  const parsed = ts.createSourceFile('scripts.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits: Array<{ start: number; end: number; body: string }> = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.body) {
      let body = source.slice(node.getStart(parsed), node.end);
      const name = node.name?.text;
      if (name === 'getProsumerRangeEnergy') {
        if (!body.includes('gridPurchaseByZone')) {
          body = replaceOnce(body, 'const gridByZone = createZoneTotals();', 'const gridByZone = createZoneTotals();\n      const gridPurchaseByZone = createZoneTotals();');
          body = replaceOnce(body, 'let gridLoadKwh = 0;', 'let gridLoadKwh = 0;\n      let gridPurchaseKwh = 0;');
          body = replaceOnce(body, '          const bankLoadKwh = firstNumber(',
            '          const gridPurchaseSlotKwh = gridLoadSlotKwh + Math.max(0, firstNumber(\n            entry.billedGridTopupKwh,\n            entry.gridTopupKwh,\n            entry.gridBuyBank,\n            entry.topupKwh,\n            0\n          ) || 0);\n          const bankLoadKwh = firstNumber(');
          body = replaceOnce(body, '          gridLoadKwh += gridLoadSlotKwh;', '          gridLoadKwh += gridLoadSlotKwh;\n          gridPurchaseKwh += gridPurchaseSlotKwh;');
          body = replaceOnce(body, '          gridByZone.all += gridLoadSlotKwh;', '          gridByZone.all += gridLoadSlotKwh;\n          gridPurchaseByZone.all += gridPurchaseSlotKwh;');
          body = replaceOnce(body, '            gridByZone[windowCode] += gridLoadSlotKwh;', '            gridByZone[windowCode] += gridLoadSlotKwh;\n            gridPurchaseByZone[windowCode] += gridPurchaseSlotKwh;');
          body = replaceOnce(body, '        gridLoadKwh: gridLoadKwh,', '        gridLoadKwh: gridLoadKwh,\n        gridPurchaseKwh: gridPurchaseKwh,');
          body = replaceOnce(body, '        gridByZone: gridByZone', '        gridByZone: gridByZone,\n        gridPurchaseByZone: gridPurchaseByZone');
        }
        edits.push({ start: node.getStart(parsed), end: node.end, body });
      } else if (name === 'buildTariffModels' && body.includes('getDashboardDataMode(payload)')) {
        if (!body.includes('prosumerRange.gridPurchaseByZone && prosumerRange.gridPurchaseByZone.all >= 0')) {
          body = replaceOnce(body,
            'prosumerRange && prosumerRange.gridByZone && prosumerRange.gridByZone.all >= 0\n        ? prosumerRange.gridByZone',
            'prosumerRange && prosumerRange.gridPurchaseByZone && prosumerRange.gridPurchaseByZone.all >= 0\n        ? prosumerRange.gridPurchaseByZone');
          body = replaceOnce(body, '? prosumerRange.gridLoadKwh', '? prosumerRange.gridPurchaseKwh');
        }
        const usageDetailsCall = body.includes('buildUsageDetailsForNextTariff(prosumerRange ? prosumerRange.gridLoadKwh : g13PurchaseKwh, pvKwh, bankSupportKwh)')
          ? 'buildUsageDetailsForNextTariff(prosumerRange ? prosumerRange.gridLoadKwh : g13PurchaseKwh, pvKwh, bankSupportKwh)'
          : 'buildUsageDetailsForNextTariff(g13PurchaseKwh, pvKwh, bankSupportKwh)';
        body = replaceOnce(body,
          usageDetailsCall,
          'buildUsageDetailsForNextTariff(\n            prosumerRange && !(pvKwh > 0) ? sharedUsageKwh : (prosumerRange ? prosumerRange.gridLoadKwh : g13PurchaseKwh),\n            pvKwh,\n            prosumerRange && !(pvKwh > 0) ? 0 : bankSupportKwh\n          )');
        edits.push({ start: node.getStart(parsed), end: node.end, body });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (edits.length !== 2) throw new Error('Brak dwóch jednoznacznych funkcji podsumowania.');
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.body + source.slice(edit.end);
  }
  return source;
}

export function prepareDashboardSummary(sourceDirectory: string, outputDirectory: string) {
  const scripts = readFileSync(path.join(sourceDirectory, 'js/scripts.js'), 'utf8').replace(/\r\n/g, '\n');
  const html = readFileSync(path.join(sourceDirectory, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const matches = [...html.matchAll(/src="js\/scripts\.js\?v=[^"]+"/g)];
  if (matches.length !== 1) throw new Error('Nieznane odwołanie do skryptu dashboardu.');
  const outputScripts = patchDashboardSummary(scripts);
  mkdirSync(path.join(outputDirectory, 'js'), { recursive: true });
  writeFileSync(path.join(outputDirectory, 'js/scripts.js'), outputScripts, 'utf8');
  writeFileSync(path.join(outputDirectory, 'index.html'), html.replace(matches[0][0], `src="js/scripts.js?v=${SUMMARY_VERSION}"`), 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [source, output] = process.argv.slice(2);
  if (!source || !output) throw new Error('Podaj katalog źródłowy dashboardu i katalog wynikowy.');
  prepareDashboardSummary(source, output);
  console.log(`Przygotowano podsumowanie z zakupem na ładowanie magazynu: ${SUMMARY_VERSION}`);
}
