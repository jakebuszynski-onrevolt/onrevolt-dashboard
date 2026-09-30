import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const arg = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const source = arg('source-root');
const output = arg('output');
const dashboard = process.argv.includes('--dashboard');
const assetVersion = '20260929-tariff-live-account-1';
if (!source || !output) throw new Error('Podaj --source-root= i --output=; --dashboard dla my.onrevolt.com.');
const read = (name: string) => readFileSync(path.join(source, name), 'utf8').replace(/\r\n/g, '\n');
function write(name: string, content: string) { const file = path.join(output!, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content, 'utf8'); }
function replace(text: string, before: string, after: string) {
  if (text.split(before).length !== 2) throw new Error(`Niejednoznaczne miejsce integracji: ${before.slice(0, 90)}`);
  return text.replace(before, () => after);
}
function editFunctions(text: string, name: string, expected: number, edit: (body: string) => string, filter = (_body: string) => true) {
  const parsed = ts.createSourceFile('dashboard.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const ranges: { start: number; end: number; body: string }[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) {
      const start = node.body.getStart(parsed) + 1, end = node.body.end - 1;
      const body = text.slice(start, end);
      if (filter(body)) ranges.push({ start, end, body });
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (ranges.length !== expected) throw new Error(`Niejednoznaczna funkcja ${name}: ${ranges.length}, oczekiwano ${expected}`);
  for (const range of ranges.reverse()) text = text.slice(0, range.start) + edit(range.body) + text.slice(range.end);
  return text;
}
const prefix = dashboard ? 're/' : '';
let storage = read(`${prefix}pricing/TariffStorage.php`);
storage = replace(storage, 'use InvalidArgumentException;', "require_once __DIR__ . '/CatalogHistory.php';\n\nuse InvalidArgumentException;");
storage = replace(storage, "$plan = ['fixed' => [], 'variable' => [], 'basis' => $basis];", "$plan = ['fixed' => [], 'variable' => [], 'basis' => $basis, 'validFrom' => ClientTariffs::date((string)($input['prices_valid_from'] ?? ClientTariffs::today()))];");
storage = replace(storage, '$existingRows = $existingQuery->fetchAll(PDO::FETCH_ASSOC);', '$existingRows = $existingQuery->fetchAll(PDO::FETCH_ASSOC);\n            $keys = CatalogHistory::prepareKeys($input, $form, $group, $existingRows);');
storage = replace(storage, "$plan[$group][] = ['net' => $net, 'legacy' => $legacy, 'vat' => $vat];", "$plan[$group][] = ['net' => $net, 'legacy' => $legacy, 'vat' => $vat, 'key' => $keys[count($plan[$group])]];");
storage = replace(storage, "vat_rate=?, price_basis=\\'net\\' WHERE id=?", "vat_rate=?, price_basis=\\'net\\', component_key=? WHERE id=?");
storage = replace(storage, "$row['vat'], $id]);", "$row['vat'], $row['key'], $id]);");
storage = replace(storage, "    public static function attachCanonical(PDO $pdo, array $legacy): array", "    public static function attachCanonical(PDO $pdo, array $legacy): array");
storage = replace(storage, "    }\n\n    public static function attachCanonical", "        $date = $plan['validFrom'];\n        $pdo->prepare('UPDATE tariff SET prices_valid_from=? WHERE id=?')->execute([$date, $tariffId]);\n        CatalogHistory::capture($pdo, $tariffId, $date, 'catalog-editor');\n    }\n\n    public static function attachCanonical");
write(`${prefix}pricing/TariffStorage.php`, storage);

if (!dashboard) {
let setup = read(`${prefix}setup.php`);
const dateField = '<label class="form-label">Ceny obowiązują od <input type="date" name="prices_valid_from" required value="<?= h((new DateTimeImmutable(\'now\', new DateTimeZone(\'Europe/Warsaw\')))->format(\'Y-m-d\')) ?>" class="form-control form-control-sm"></label>';
if (dashboard && !setup.includes('name="price_basis"')) {
  setup = replace(setup, '<form method="post" id="tariffForm">', `<form method="post" id="tariffForm">\n${dateField}\n<input type="hidden" name="price_basis" value="net">`);
} else {
  setup = replace(setup, '<input type="hidden" name="price_basis"', `${dateField}\n              <input type="hidden" name="price_basis"`);
}
for (const [pre, variable] of [['fc', 'f'], ['vc', 'v']]) {
  const pattern = new RegExp(`<td><input name="${pre}_label\\[\\]"([ \\t]+)value=`);
  if (!pattern.test(setup)) throw new Error(`Brak pola ${pre}`);
  setup = setup.replace(pattern, `<td><input type="hidden" name="${pre}_component_key[]" value="<?=h($${variable}['component_key'])?>"><input name="${pre}_label[]"$1value=`);
  setup = setup.replace(new RegExp(`<td><input name="${pre}_label\\[\\]"([ \\t]+)class=`, 'g'), `<td><input type="hidden" name="${pre}_component_key[]" value=""><input name="${pre}_label[]"$1class=`);
}
write(`${prefix}setup.php`, setup);
}
let funcs = read(`${prefix}setup_func.php`);
funcs = replace(funcs, 'SELECT id, label, window_code, price, ord, vat_rate, price_basis FROM tariff_variable_cost', 'SELECT id, component_key, label, window_code, price, ord, vat_rate, price_basis FROM tariff_variable_cost');
funcs = replace(funcs, 'SELECT id, label, amount, amount_mode, billing_cycle_months', 'SELECT id, component_key, label, amount, amount_mode, billing_cycle_months');
funcs = replace(funcs, "            echo json_encode(['ok'=>true,'data'=>$data], JSON_UNESCAPED_UNICODE);", `            $effectiveDate = \\OnRevolt\\Pricing\\ClientTariffs::date((string)($_GET['date'] ?? \\OnRevolt\\Pricing\\ClientTariffs::today()));
            $dated = (new \\OnRevolt\\Pricing\\ClientTariffs($pdo))->catalog($osd_id, $tariff_id, $effectiveDate);
            if (!$dated) throw new RuntimeException('Wymaga uzupełnienia: brak cen katalogowych dla ' . $effectiveDate);
            echo json_encode(['ok'=>true,'data'=>$dated], JSON_UNESCAPED_UNICODE);`);
write(`${prefix}setup_func.php`, funcs);
for (const name of ['ClientTariffs.php', 'CatalogHistory.php', 'DashboardTariffs.php']) {
  const target = path.join(output, prefix, 'pricing', name); mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.resolve('integrations/re/pricing', name), target);
}
const sharedEngine = readFileSync(path.resolve('public/shared/re-tariff-engine.js'), 'utf8');
const browserHelpers = readFileSync(path.resolve('integrations/re/client-tariff-browser.js'), 'utf8');

if (dashboard) {
  let api = read('api/dashboard.php');
  api = replace(api, "$cacheFile = '';\nif (!$bypassCache", "require_once __DIR__ . '/../re/pricing/DashboardTariffs.php';\n$clientTariffContext = \\OnRevolt\\Pricing\\DashboardTariffs::context(energyMeterPdo($config), $energyStation);\n$cacheFile = '';\nif (!$bypassCache");
  api = replace(api, "$stationKey) . $cacheRangeKey . '.json'", "$stationKey) . $cacheRangeKey . '_' . $clientTariffContext['cacheKey'] . '.json'");
  api = replace(api, '$payloadBody = json_encode($payload,', 'if ($includeContext) \\OnRevolt\\Pricing\\DashboardTariffs::attach($payload, $clientTariffContext);\n$payloadBody = json_encode($payload,');
  write('api/dashboard.php', api);

  let scripts = read('js/scripts.js');
  scripts = replace(scripts, 'function applyPayload(input, incrementalUpdate) {', 'function applyPayload(input, incrementalUpdate) {\n      if (input?.tariffHistory) input = Object.assign({}, input, { tariffHistory: ReTariffEngine.expand(input.tariffHistory) });');
  const liveAccountBefore = 'account: account || (window.dashboardLatestPayload && window.dashboardLatestPayload.account) || null,';
  const liveAccountAfter = 'account: account ? Object.assign({}, (window.dashboardLatestPayload && window.dashboardLatestPayload.account) || {}, account) : (window.dashboardLatestPayload && window.dashboardLatestPayload.account) || null,';
  if (scripts.split(liveAccountBefore).length !== 3) throw new Error('Niejednoznaczne scalanie konta w odświeżeniu live.');
  scripts = scripts.replaceAll(liveAccountBefore, liveAccountAfter);
  for (const asset of ['scripts.js', 'script_on.js']) {
    const matches = [...scripts.matchAll(new RegExp(`new URL\\("js/${asset.replace('.', '\\.')}\\?v=[^"\\n]+", baseUrl\\)`, 'g'))];
    if (matches.length !== 1) throw new Error(`Brak jednoznacznego loadera RE: ${asset}`);
    scripts = replace(scripts, matches[0][0], `new URL("js/${asset}?v=${assetVersion}", baseUrl)`);
  }
  for (const name of ['getDepositTariff', 'getPurchaseTariff']) {
    scripts = editFunctions(scripts, name, 1, body => '\n      if (payload.tariffHistory?.strict) return clientTariffActual(payload, null);' + body);
  }
  scripts = editFunctions(scripts, 'resolveEnergyPurchaseRate', 3, body => '\n      if (tariff?.clientTariffHistory?.strict) return ReTariffEngine.rates(ReTariffEngine.resolve(tariff.clientTariffHistory, dateKey, null), dateKey, hour, rcePricePln).energy;' + body);
  scripts = editFunctions(scripts, 'resolveVariablePurchaseFeeRate', 1, body => '\n      if (tariff?.clientTariffHistory?.strict) return ReTariffEngine.rates(ReTariffEngine.resolve(tariff.clientTariffHistory, dateKey, null), dateKey, hour, 0).distribution;' + body);
  scripts = editFunctions(scripts, 'getZoneCodeForDateHour', 3, body => '\n      if (tariff?.clientTariffHistory?.strict) return ReTariffEngine.zone(ReTariffEngine.resolve(tariff.clientTariffHistory, dateKey, null), dateKey, hour);' + body);
  scripts = editFunctions(scripts, 'estimateFixedFees', 1, body => '\n      if (payload.tariffHistory?.strict) return clientTariffFixedCosts(payload, rangeWindow, purchaseKwh);' + body);
  scripts = editFunctions(scripts, 'applyPayload', 1, body => '\ntry {' + body + '\n} catch (error) { if (!window.dashboardLatestPayload?.tariffHistory?.strict) throw error; clientTariffNotice(error.message); renderZeroState(error.message); }\n', body => body.includes('state.payload = payload;') && body.includes('updateTariffSummaryCards(payload, rangeWindow)'));
  scripts = editFunctions(scripts, 'applyPayload', 1, body => '\ntry {' + body + `
} catch (error) {
  if (!window.dashboardLatestPayload?.tariffHistory?.strict) throw error;
  clientTariffNotice(error.message);
  window.dashboardDepositBreakdown = null; window.dashboardCurrentDepositPln = null;
  [currentValueEl, saleWorthValueEl, purchaseWorthValueEl].forEach(el => setMoneyOnly(el, null));
  [saleEnergyValueEl, purchaseEnergyValueEl].forEach(el => setValueOnly(el, null, 1));
  [salePriceValueEl, purchasePriceValueEl].forEach(el => setAveragePriceValue(el, null));
  renderDepositChartEcharts([], error.message);
}
`, body => body.includes('const rangeWindow = getRangeWindowForDeposit();'));
  scripts = replace(scripts, 'getRecordCollectionSignature(sourcePayload.tariffHistory),', 'JSON.stringify([sourcePayload.tariffHistory?.revision, sourcePayload.tariffHistory?.cacheKey]),');
  scripts = replace(scripts, 'const currentBreakdown = buildTariffBreakdown(currentTariff, purchaseKwh, rangeWindow, false, null, powerUsageByMonth, getFixedCostOptions(payload, false));',
    'const currentBreakdown = payload.tariffHistory?.strict ? clientTariffDashboardCost(payload, rangeWindow, { ...getFixedCostOptions(payload, false), connectionPowerKw: getFixedCostOptions(payload, false).contractPowerKw, annualUsageKwh: Object.values(powerUsageByMonth || {}).reduce((sum, value) => sum + Number(value), 0) }, getQuarterHour) : buildTariffBreakdown(currentTariff, purchaseKwh, rangeWindow, false, null, powerUsageByMonth, getFixedCostOptions(payload, false));');
  scripts = replace(scripts, 'const currentBreakdown = buildTariffBreakdown(currentTariff, g11PurchaseKwh, rangeWindow, false,\n        currentUsageAggregate ? currentUsageAggregate.usageByZone : null, powerUsageByMonth, currentFixedCostOptions);',
    'const currentBreakdown = payload.tariffHistory?.strict ? clientTariffDashboardCost(payload, rangeWindow, { ...currentFixedCostOptions, connectionPowerKw: currentFixedCostOptions.contractPowerKw, annualUsageKwh: Object.values(powerUsageByMonth || {}).reduce((sum, value) => sum + Number(value), 0) }, getQuarterHour) : buildTariffBreakdown(currentTariff, g11PurchaseKwh, rangeWindow, false,\n        currentUsageAggregate ? currentUsageAggregate.usageByZone : null, powerUsageByMonth, currentFixedCostOptions);');
  scripts = replace(scripts, 'const nextBreakdown = buildTariffBreakdown(nextTariff, g13PurchaseKwh, rangeWindow, true, g13PurchaseByZone, powerUsageByMonth, nextFixedCostOptions);',
    'const actualHistory = payload.tariffHistory?.strict && !useForecastRange && hasMeasuredUsageSplit;\n      const nextBreakdown = actualHistory ? clientTariffDashboardCost(payload, rangeWindow, { ...currentFixedCostOptions, gridOnly: true, connectionPowerKw: currentFixedCostOptions.contractPowerKw, annualUsageKwh: Object.values(powerUsageByMonth || {}).reduce((sum, value) => sum + Number(value), 0) }, getQuarterHour) : buildTariffBreakdown(nextTariff, g13PurchaseKwh, rangeWindow, true, g13PurchaseByZone, powerUsageByMonth, nextFixedCostOptions);');
  scripts = replace(scripts, '? buildMeasuredDepositLedger(payload, rangeWindow, nextTariff)', '? buildMeasuredDepositLedger(payload, rangeWindow, actualHistory ? clientTariffActual(payload, nextTariff) : nextTariff)');
  scripts = editFunctions(scripts, 'buildTariffModels', 2, body => {
    body = replace(body, 'const currentTariff = tariffData.current || null;', 'const currentTariff = payload.tariffHistory?.strict ? ReTariffEngine.resolve(payload.tariffHistory, formatDateKey(state.anchorDate), null) : tariffData.current || null;');
    return body.replaceAll('annualUsageKwh: Object.values(powerUsageByMonth || {}).reduce((sum, value) => sum + Number(value), 0)', 'annualUsageKwh: clientTariffAnnualUsage(payload)');
  });
  scripts = replace(scripts, 'const nextTariffInfo = buildTariffInfo(payload, nextTariff, true, state.anchorDate, powerUsageByMonth, nextFixedCostOptions);',
    'const nextTariffInfo = buildTariffInfo(payload, actualHistory ? currentTariff : nextTariff, !actualHistory, state.anchorDate, powerUsageByMonth, actualHistory ? currentFixedCostOptions : nextFixedCostOptions);');
  scripts = replace(scripts, 'const models = applyReYearTotalsToModels(buildTariffModels(payload) || buildModels(payload));',
    'const tariffModels = buildTariffModels(payload);\n      const models = payload.tariffHistory?.strict && !window.dashboardReForecastEnabled ? tariffModels : applyReYearTotalsToModels(payload.tariffHistory?.strict ? tariffModels : tariffModels || buildModels(payload));');
  scripts = editFunctions(scripts, 'renderCard', 1, body => replace(body, 'if (!model) {\n        return;\n      }', `if (!model) {
        setTotal(refs.total, null); setSavings(refs.savings, null);
        if (refs.list) refs.list.textContent = '';
        renderBar(refs.bar, [], null);
        if (cardKey === 'next') renderDepositBox(null);
        return;
      }`));
  scripts = editFunctions(scripts, 'applyPayload', 1, body => {
    body = replace(body, '        publishSummaryTotals();\n        return;', '        renderCard("current"); renderCard("next");\n        publishSummaryTotals(); publishSummaryPanelTotals();\n        return;');
    return '\ntry {' + body + `
} catch (error) {
  if (!window.dashboardLatestPayload?.tariffHistory?.strict) throw error;
  clientTariffNotice(error.message); state.scaleTotal = null; state.models.current = null; state.models.next = null;
  renderCard("current"); renderCard("next"); renderTariffPanel("current"); renderTariffPanel("next");
  publishSummaryTotals(); publishSummaryPanelTotals();
}
`;
  }, body => body.includes('getSummaryAnchorDate(payload)'));
  write('js/scripts.js', sharedEngine + '\n' + browserHelpers + '\n' + scripts);

  let prosumer = read('js/prosumer-engine.js');
  prosumer = replace(prosumer, 'return fallbackTariff;', 'if (tariffHistory && tariffHistory.strict) throw new Error("Wymaga uzupełnienia: brak taryfy dla " + dateKey);\n      return fallbackTariff;');
  prosumer = replace(prosumer, 'return tariffByDate[dateKey];', 'if (tariffHistory.strict && !tariffByDate[dateKey]) throw new Error("Wymaga uzupełnienia: brak cen dla " + dateKey);\n        return tariffByDate[dateKey];');
  prosumer = replace(prosumer, 'entry[1].pricingLegacyTariff || entry[1]', 'entry[1] && (entry[1].pricingLegacyTariff || entry[1])');
  // A target investment simulation must not silently inherit the customer's actual tariff history.
  prosumer = replace(prosumer, 'tariffHistory: payload && payload.tariffHistory ? payload.tariffHistory : null,', 'tariffHistory: context && context.useActualTariffHistory ? payload.tariffHistory : null,');
  write('js/prosumer-engine.js', prosumer);
  let pricing = read('re/pricing/dashboard-pricing.js');
  pricing = replace(pricing, 'const VERSION = "net-panel-20260924-sale-vat-2";', `const VERSION = "${assetVersion}";`);
  pricing = replace(pricing, 'history = Object.assign({}, history, { byDate: Object.fromEntries(Object.entries(history.byDate).map(entry => [entry[0], projectTariff(entry[1])])) });', `const projected = new Map();
      history = root.ReTariffEngine.expand(history);
      history = Object.assign({}, history, { byDate: Object.fromEntries(Object.entries(history.byDate).map(entry => {
        if (!projected.has(entry[1])) projected.set(entry[1], projectTariff(entry[1]));
        return [entry[0], projected.get(entry[1])];
      })) });`);
  write('re/pricing/dashboard-pricing.js', pricing);
  for (const [file, assets] of [
    ['index.html', ['scripts.js', 'prosumer-engine.js']],
    ['re/index.php', ['scripts.js']],
    ['re/GetRe_site.php', ['scripts.js', 'script_on.js']],
  ] as const) {
    let content = read(file);
    if (file === 'index.html') content = replace(content, 're/pricing/dashboard-pricing.js?v=20260924-sale-vat-2', `re/pricing/dashboard-pricing.js?v=${assetVersion}`);
    for (const asset of assets) {
      const matches = [...content.matchAll(new RegExp(`src="js/${asset.replace('.', '\\.')}\\?v=[^"]+"`, 'g'))];
      if (matches.length !== 1) throw new Error(`Brak jednoznacznego zasobu: ${file} ${asset}`);
      content = replace(content, matches[0][0], `src="js/${asset}?v=${assetVersion}"`);
    }
    write(file, content);
  }
}

if (dashboard) {
let native = read(`${prefix}js/scripts.js`);
native = replace(native, 'function applyReActualDashboardData(payload){', 'function applyReActualDashboardData(payload){\n  window.reClientTariffHistory = ReTariffEngine.expand(payload?.tariffHistory || null);');
native = replace(native, '\ttotG11 += base;', `\tif (window.reClientTariffHistory?.strict) {
    base = 0;
    try {
      for (let offset = 0; offset < span; offset++) {
        const date = new Date(cur.getFullYear(), m, cur.getDate() + offset);
        const hours = buildHourlyUseForDay(date, annualK, USE24, { kWp, pvOffset: off + offset * 24 });
        const dated = getReDatedBaselineDay(date, hours, annualK, cAddMonth.checked);
        base += dated.energy + dated.fixed;
      }
    } catch (error) {
      clientTariffNotice(error.message + ' Sprawdź zakładkę Taryfy w CRM.');
      window.dashboardReYearTotals = null;
      document.dispatchEvent(new CustomEvent('dashboard:re-year-totals-updated', { detail: null }));
      return;
    }
  }
\ttotG11 += base;`);
write(`${prefix}js/scripts.js`, sharedEngine + '\n' + browserHelpers + '\n' + native);
let simulation = read(`${prefix}js/script_on.js`);
simulation = replace(simulation, 'const oldEnergyCostPln = Math.max(0, Number(oldUsageKwh) || 0) * Math.max(0, oldEnergyRatePln);', 'const datedBaseline = getReDatedBaselineDay(dayDate, hourUse, annualUsageKWh, addMonth);\n    const oldEnergyCostPln = datedBaseline ? datedBaseline.energy : Math.max(0, Number(oldUsageKwh) || 0) * Math.max(0, oldEnergyRatePln);');
simulation = replace(simulation, 'const oldFixedCostPln = addMonth ? oldFixedMonthlyPln / monthDays : 0;', 'const oldFixedCostPln = datedBaseline ? datedBaseline.fixed : (addMonth ? oldFixedMonthlyPln / monthDays : 0);');
write(`${prefix}js/script_on.js`, simulation);
}
console.log(`Przygotowano rozszerzenie taryf: ${output}`);
