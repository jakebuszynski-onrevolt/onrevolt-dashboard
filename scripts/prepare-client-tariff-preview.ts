import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const source = process.argv[2], output = process.argv[3];
if (!source || !output) throw new Error('Podaj katalog źródłowy dashboardu i katalog wynikowy.');
const read = (file: string) => readFileSync(path.join(source, file), 'utf8').replace(/\r\n/g, '\n');
function write(file: string, body: string) { const target = path.join(output, file); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, body, 'utf8'); }
function replace(text: string, before: string, after: string, count = 1) {
  if (text.split(before).length !== count + 1) throw new Error(`Niejednoznaczne miejsce: ${before}`);
  return text.replaceAll(before, after);
}
let scripts = read('js/scripts.js');
const installed = scripts.includes('input = window.ClientTariffPreview.project(input, incrementalUpdate);');
if (!installed) {
scripts = replace(scripts, 'if (payload.tariffHistory?.strict) return clientTariffActual(payload, null);', 'if (payload.tariffHistory?.strict && !payload.clientTariffPreview) return clientTariffActual(payload, null);', 2);
scripts = replace(scripts, 'if (payload.tariffHistory?.strict) return clientTariffFixedCosts(payload, rangeWindow, purchaseKwh);', 'if (payload.tariffHistory?.strict && !payload.clientTariffPreview) return clientTariffFixedCosts(payload, rangeWindow, purchaseKwh);');
scripts = replace(scripts, 'const actualHistory = payload.tariffHistory?.strict && !useForecastRange && hasMeasuredUsageSplit;', 'const actualHistory = payload.tariffHistory?.strict && !payload.clientTariffPreview && !useForecastRange && hasMeasuredUsageSplit;');
scripts = replace(scripts, 'const normalized = applyDashboardHistoryFilter(normalizePayload(input));', 'input = window.ClientTariffPreview.project(input, incrementalUpdate);\n      const normalized = applyDashboardHistoryFilter(normalizePayload(input));\n      normalized.clientTariffPreview = window.ClientTariffPreview.isTesting();');
scripts = replace(scripts, '        tariffHistory: payload.tariffHistory || null,', '        tariffHistory: payload.tariffHistory || null,\n        clientTariffPreview: payload.clientTariffPreview === true,');
scripts = replace(scripts, '        window.DashboardPricing ? window.DashboardPricing.cacheKey : "legacy"', '        window.DashboardPricing ? window.DashboardPricing.cacheKey : "legacy",\n        window.ClientTariffPreview.cacheKey()');
const parsed = ts.createSourceFile('scripts.js', scripts, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const edits: Array<{ start: number; end: number; body: string }> = [];
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'readCurrentFormSettings' && node.body) {
    const start = node.body.getStart(parsed) + 1, end = node.body.end - 1;
    let body = scripts.slice(start, end);
    body = replace(body, 'return {', 'const settings = {');
    body += '\n      return Object.assign(settings, window.ClientTariffPreview.savedTariffFields());\n';
    edits.push({ start, end, body });
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
if (edits.length !== 1) throw new Error('Brak jednoznacznego odczytu ustawień instalacji.');
for (const edit of edits) scripts = scripts.slice(0, edit.start) + edit.body + scripts.slice(edit.end);
}
const setupProjection = '      payload = window.ClientTariffPreview.setupPayload(payload);';
if (!scripts.includes(setupProjection)) scripts = replace(scripts, '    function populateTariffs(savedSettings, payload) {', '    function populateTariffs(savedSettings, payload) {\n' + setupProjection);
write('js/scripts.js', scripts);
const version = '20260927-client-tariff-preview-2';
let html = read('index.html');
if (!installed) {
html = replace(html, '</head>', `<link rel="stylesheet" href="css/client-tariff-preview.css?v=${version}">\n</head>`);
html = replace(html, 'src="js/scripts.js?v=20260926-client-tariffs-1"', `src="js/scripts.js?v=${version}"`);
html = replace(html, 'src="re/pricing/dashboard-pricing.js?v=20260926-client-tariffs-1"', `src="re/pricing/dashboard-pricing.js?v=${version}"`);
html = replace(html, '<script src="js/scripts.js?', `<script src="js/client-tariff-preview.js?v=${version}"></script>\n  <script src="js/scripts.js?`);
} else {
  html = html.replaceAll('20260927-client-tariff-preview-1', version);
  if (!html.includes(`src="js/client-tariff-preview.js?v=${version}"`)) throw new Error('Nieznana wersja podglądu taryfy w HTML.');
}
write('index.html', html);
let pricing = read('re/pricing/dashboard-pricing.js');
if (!installed) pricing = replace(pricing, '  function projectReResponse(response, target) {', '  function projectReResponse(response, target) {\n    if (root.ClientTariffPreview) response = root.ClientTariffPreview.projectReResponse(response);');
write('re/pricing/dashboard-pricing.js', pricing);
for (const ext of ['js', 'css']) write(`${ext}/client-tariff-preview.${ext}`, readFileSync(path.resolve(`integrations/re/client-tariff-preview.${ext}`), 'utf8'));
console.log('Przygotowano tymczasowy podgląd taryfy dashboardu.');
