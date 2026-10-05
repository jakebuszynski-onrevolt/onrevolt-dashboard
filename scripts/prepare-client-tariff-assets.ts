import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const source = arg('source-root');
const output = arg('output');
const dashboard = process.argv.includes('--dashboard');
const assetVersion = '20261002-tariff-runtime-1';

if (!source || !output) {
  throw new Error('Podaj --source-root= i --output=; --dashboard dla my.onrevolt.com.');
}

const normalize = (content: string) => content.replace(/\r\n/g, '\n');
const read = (name: string) => normalize(readFileSync(path.join(source, name), 'utf8'));
const write = (name: string, content: string) => {
  const file = path.join(output, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, normalize(content), 'utf8');
};
const copyCurrent = (name: string) => write(name, read(name));

function requireMarkers(name: string, content: string, markers: string[]) {
  for (const marker of markers) {
    if (!content.includes(marker)) {
      throw new Error(`Nieaktualne źródło ${name}: brak znacznika ${marker.slice(0, 100)}`);
    }
  }
}

function replaceExactlyOnce(name: string, content: string, pattern: RegExp, replacement: string): string {
  const matches = [...content.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`Niejednoznaczny zasób ${name}: znaleziono ${matches.length}, oczekiwano 1.`);
  }
  return content.replace(pattern, replacement);
}

const sharedEngine = normalize(readFileSync(path.resolve('public/shared/re-tariff-engine.js'), 'utf8')).trimEnd();
const browserHelpers = normalize(readFileSync(path.resolve('integrations/re/client-tariff-browser.js'), 'utf8')).trimEnd();

function replaceEmbeddedTariffRuntime(name: string, content: string): string {
  const marker = '/* Included in both RE views by prepare-client-tariff-assets.ts. */';
  requireMarkers(name, content, [marker, 'function getReDatedBaselineDay(']);
  const parsed = ts.createSourceFile(name, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations: ts.FunctionDeclaration[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'getReDatedBaselineDay') declarations.push(node);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (declarations.length !== 1) {
    throw new Error(`Niejednoznaczny helper taryf w ${name}: ${declarations.length}.`);
  }
  const helperEnd = declarations[0].end;
  if (content.indexOf(marker) >= helperEnd || content.slice(0, marker.length).includes(marker)) {
    throw new Error(`Nieprawidłowy układ osadzonego silnika taryf w ${name}.`);
  }
  return `${sharedEngine}\n\n${browserHelpers}${content.slice(helperEnd)}`;
}

function updateHtmlAsset(name: string, content: string, asset: string): string {
  const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`src=["']${escaped}\\?v=[^"']+["']`, 'g');
  return replaceExactlyOnce(name, content, pattern, `src="${asset}?v=${assetVersion}"`);
}

function updateReLoader(name: string, content: string): string {
  const pattern = /new URL\(["']js\/scripts\.js\?v=[^"']+["'], baseUrl\)/g;
  return replaceExactlyOnce(name, content, pattern, `new URL("js/scripts.js?v=${assetVersion}", baseUrl)`);
}

const prefix = dashboard ? 're/' : '';
const tariffStorageName = `${prefix}pricing/TariffStorage.php`;
const tariffStorage = read(tariffStorageName);
requireMarkers(tariffStorageName, tariffStorage, [
  "require_once __DIR__ . '/CatalogHistory.php';",
  "'validFrom' => ClientTariffs::date",
  'CatalogHistory::capture(',
]);
write(tariffStorageName, tariffStorage);

const setupFunctionsName = `${prefix}setup_func.php`;
const setupFunctions = read(setupFunctionsName);
requireMarkers(setupFunctionsName, setupFunctions, [
  'component_key, label, window_code',
  '\\OnRevolt\\Pricing\\ClientTariffs',
]);
write(setupFunctionsName, setupFunctions);

if (!dashboard) {
  const setup = read('setup.php');
  requireMarkers('setup.php', setup, ['name="prices_valid_from"', 'name="price_basis"', 'component_key[]']);
  write('setup.php', setup);
}

for (const name of ['ClientTariffs.php', 'CatalogHistory.php', 'DashboardTariffs.php', 'CapacityCharge.php']) {
  const target = path.join(output, prefix, 'pricing', name);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.resolve('integrations/re/pricing', name), target);
}

if (dashboard) {
  const api = read('api/dashboard.php');
  requireMarkers('api/dashboard.php', api, [
    'DashboardTariffs::context(',
    "clientTariffContext['cacheKey']",
    'DashboardTariffs::attach(',
  ]);
  write('api/dashboard.php', api);

  let scripts = read('js/scripts.js');
  requireMarkers('js/scripts.js', scripts, [
    'window.dashboardReForecastEnabled',
    'contractPowerInput.value = String(input.contractPowerKw)',
    'account ? Object.assign({}, (window.dashboardLatestPayload && window.dashboardLatestPayload.account) || {}, account)',
    'tariff.energy_schedule',
    'measurementPoints',
    'b2b-large',
  ]);
  scripts = replaceEmbeddedTariffRuntime('js/scripts.js', scripts);
  scripts = updateReLoader('js/scripts.js', scripts);
  write('js/scripts.js', scripts);

  const prosumer = read('js/prosumer-engine.js');
  requireMarkers('js/prosumer-engine.js', prosumer, [
    'resolveCapacityCharge(tariff, dateKey, hour',
    'context && context.useActualTariffHistory ? payload.tariffHistory : null',
    'buildCapacityProfilesByDate(daysInput)',
  ]);
  write('js/prosumer-engine.js', prosumer);

  const dashboardPricing = read('re/pricing/dashboard-pricing.js');
  requireMarkers('re/pricing/dashboard-pricing.js', dashboardPricing, [
    'result.capacity_charge',
    'root.ReTariffEngine.expand(history)',
  ]);
  write('re/pricing/dashboard-pricing.js', dashboardPricing);

  let reScripts = read('re/js/scripts.js');
  requireMarkers('re/js/scripts.js', reScripts, [
    'window.reClientTariffHistory = ReTariffEngine.expand(',
    'getReDatedBaselineDay(',
  ]);
  reScripts = replaceEmbeddedTariffRuntime('re/js/scripts.js', reScripts);
  write('re/js/scripts.js', reScripts);
  copyCurrent('re/js/script_on.js');

  let index = read('index.html');
  requireMarkers('index.html', index, [
    'js/dashboard-calendar.js',
    'js/client-tariff-preview.js',
    'js/industrial-usage.js',
  ]);
  index = updateHtmlAsset('index.html', index, 'js/scripts.js');
  write('index.html', index);

  let reIndex = read('re/index.php');
  reIndex = updateHtmlAsset('re/index.php', reIndex, 'js/scripts.js');
  write('re/index.php', reIndex);

  let reSite = read('re/GetRe_site.php');
  reSite = updateHtmlAsset('re/GetRe_site.php', reSite, 'js/scripts.js');
  write('re/GetRe_site.php', reSite);
}

console.log(`Przygotowano aktualny pakiet taryf B/C: ${output}`);
