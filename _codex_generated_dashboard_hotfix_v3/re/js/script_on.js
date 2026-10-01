// script2.js
// UWAGA: wymaga, żeby scripts.js (z costBankPVWindSell itd.) był już załadowany.


// ===== Mock UI dla uruchomienia headless (bez DOM) =====
(function ensureMockUI(){
  // helper: "input" z value/checked
	const mk = (init) => Object.assign({
	  value: '',
	  checked: false,
	  disabled: false,

	  // select-like
	  selectedIndex: 0,
	  options: [],
	  addEventListener(){},
	  removeEventListener(){},

	  classList: { add(){}, remove(){}, toggle(){} },
	  style: {},
	  setAttribute(){},
	  getAttribute(){ return null; },
	}, init || {});


  // Jeżeli te zmienne już istnieją (DOM), nie ruszamy.
  // Jeżeli nie istnieją, tworzymy "mocki" pod te nazwy które scripts.js czyta.

  // najczęściej używane w costBankPVWindSell / init / updateIcons:
  if (typeof window !== 'undefined') {

    // inputy liczbowe
    window.pvInp  = window.pvInp  || mk({ value: '0' });     // W lub kW*1000 (u Ciebie)
    window.bankV  = window.bankV  || mk({ value: '0' });     // pojemność banku
    window.windV  = window.windV  || mk({ value: '0' });     // wiatraki/liczba/param
    window.usage  = window.usage  || mk({ value: '0' });     // roczne zużycie / slider itp.
    window.slider = window.slider || mk({ value: '0' });     // jeżeli masz suwak do daty

    // checkboxy / przełączniki
    window.contractPowerKw = window.contractPowerKw || mk({ value: '16' });
    window.billingCycleMonths = window.billingCycleMonths || mk({ value: '1' });
    window.chkPV   = window.chkPV   || mk({ checked: true });
    window.chkBank = window.chkBank || mk({ checked: true });
    window.chkWind = window.chkWind || mk({ checked: false });
    window.chkSell = window.chkSell || mk({ checked: true });

    // inne checkboxy które mogą występować
    window.cAddMonth = window.cAddMonth || mk({ checked: false });
    window.cVAT      = window.cVAT      || mk({ checked: true });

    // ikonki / elementy UI używane w updateIcons (classList)
    window.battI   = window.battI   || mk();
    window.solTop  = window.solTop  || mk();
    window.solBot  = window.solBot  || mk();
    window.windI   = window.windI   || mk();
    window.bankI   = window.bankI   || mk();
    window.tariffLon = window.tariffLon || mk();
    window.dateLbl = window.dateLbl || mk();

	window.provider  = window.provider  || mk({ selectedIndex: 0, value: '1' });
	window.tariff    = window.tariff    || mk({ selectedIndex: 0, value: '23' });
	window.tariffLon = window.tariffLon || mk({ selectedIndex: 0, value: '0' });


    // jeśli masz jeszcze jakieś elementy, które wywalają null.value / null.checked
    // dopisz je tutaj w tej samej formie.
  }
})();


// Przeliczenie profilu 24h z rocznego zużycia albo z profilu 12 miesięcy.
function buildHourUse24(annualKWh, use24Profile, dayDate = null, monthlyUsageKWh = null) {
  const monthly = Array.isArray(monthlyUsageKWh) && monthlyUsageKWh.length === 12
    ? monthlyUsageKWh.map(v => Math.max(0, Number(v) || 0))
    : null;
  const monthlySum = monthly ? monthly.reduce((sum, value) => sum + value, 0) : 0;
  let dailyK = annualKWh / 365;

  if (monthly && monthlySum > 0 && dayDate) {
    const day = new Date(dayDate);
    const monthIndex = Number.isFinite(day.getTime()) ? day.getMonth() : 0;
    const year = Number.isFinite(day.getTime()) ? day.getFullYear() : new Date().getFullYear();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    dailyK = monthly[monthIndex] / daysInMonth;
  }

  return use24Profile.map(p => dailyK * p / 100);
}

async function ensureTariffRuntime(osdId, tariffId) {
  if (!osdId || !tariffId) return false;
  if (typeof window.loadCurrentTariff !== 'function') return false;
  if (typeof window.buildTariffRuntime !== 'function') return false;

  const T = await window.loadCurrentTariff(osdId, tariffId);

  // ✅ zachowaj pełną taryfę do headless
  window.__TariffFull = T;

  // ✅ policz miesięczne stałe (tak jak w calc())
  const fixedRows = Array.isArray(T?.fixed) ? T.fixed : [];
  if (typeof window.calcTariffFixedMonthly === 'function') {
    window.selKosztMies = window.calcTariffFixedMonthly(fixedRows);
  } else {
    window.selKosztMies = fixedRows.reduce((s,r)=> s + (parseFloat(r.amount)||0), 0);
  }
  if (typeof window.updateContractPowerVisibility === 'function') {
    window.updateContractPowerVisibility(T);
  }
  if (typeof window.updateBillingCycleVisibility === 'function') {
    window.updateBillingCycleVisibility(T);
  }

  window.buildTariffRuntime(T, window.rdn, window.rce);
  return true;
}


/**
 * Prosta roczna symulacja wariantu: BANK + PV + WIATR + SPRZEDAŻ (net-billing).
 *
 * Wymaga:
 *  - globalnej funkcji costBankPVWindSell(hourUse, socIn, kWp, pvOffset, baseMs, doLog=false)
 *  - globalnych tablic pv[], wind[] i cen z getTariffPriceBuyAt/getTariffPriceSellAt
 *  - stałej START (domyślna data startowa, np. '2024-10-01')
 *  - tablicy USE24 (profil procentowy 24h, jak w scripts.js)
 *
 * Parametry:
 *   options = {
 *     startDateStr: 'YYYY-MM-DD' (opcjonalne, domyślnie START),
 *     days:          liczba dni symulacji (domyślnie 365),
 *     annualUsageKWh: zużycie roczne [kWh],
 *     kWp:           moc PV [kWp] (tak jak w costBankPVWindSell),
 *     initialSocKWh: początkowy stan magazynu [kWh] (domyślnie 0),
 *     use24Profile:  [24] profil procentowy (domyślnie USE24),
 *     pvOffsetHours: offset godzinowy do tablicy pv/wind (domyślnie 0),
 *     includeHourly:  dołącz listę dni/godzin do wykorzystania przez dashboard
 *   }
 *
 * Zwraca:
 *   {
 *     yearCostCash,        // suma gotówkowych kosztów (energia + dystrybucja)
 *     depositAfterYear,    // wartość depozytu po roku (brutto)
 *     depositPayout30,     // zgodność API; brak wypłaty, depozyt przechodzi na kolejny okres
 *     greenYearGenKWh,     // suma produkcji PV+wiatr (limit prosumencki)
 *     greenYearSoldKWh,    // suma sprzedanych kWh
 *     finalSocKWh,         // stan magazynu na końcu roku
 *     days                 // opcjonalnie: dane godzinowe dla dashboardu
 *   }
 */
function simulateYearBankPVWindSell(options) {
  const {
    startDateStr   = (typeof START !== 'undefined' ? START : getReDataStartDate()),
    days           = 365,
    annualUsageKWh,
    kWp,
    initialSocKWh  = 0,
    initialDepositPln = 0,
    use24Profile   = (typeof USE24 !== 'undefined' ? USE24 : new Array(24).fill(100/24)),
    monthlyUsageKWh = null,
    pvOffsetHours  = 0,
    includeHourly  = false
  } = options || {};

  if (typeof costBankPVWindSell !== 'function') {
    throw new Error('Brak funkcji costBankPVWindSell – upewnij się, że scripts.js jest załadowany przed script2.js');
  }

  const configuredInitialDepositPln = Number(initialDepositPln);
  if (!Number.isFinite(configuredInitialDepositPln) || configuredInitialDepositPln < 0) {
    throw new Error('Nieprawidłowy depozyt startowy.');
  }

  // reset depozytu i liczników rocznych (korzystamy z tych samych globali co scripts.js)
  if (typeof deposit !== 'undefined') deposit = configuredInitialDepositPln;
  if (typeof window !== 'undefined') {
    window._greenYearGenKWh  = 0;
    window._greenYearSoldKWh = 0;
  }

  let soc  = initialSocKWh;   // SOC przenoszony między dobami
  let off  = pvOffsetHours;   // offset w tablicach pv / wind
  let yearCostCash = 0;       // to będzie Twój "rachunek roczny"
  let oldBillCash = 0;
  let forecastDays = includeHourly ? [] : null;
  const savedTraceRows = includeHourly && typeof window !== 'undefined' ? window.traceRows : null;
  const bankCapacityKWh = (typeof getBankCapacityKWh === 'function') ? getBankCapacityKWh() : 0;
  let startDepositPln = (typeof deposit !== 'undefined') ? Number(deposit || 0) : 0;
  let fixedUsageYear = null;
  let cumulativeYearUsageKWh = 0;
  let fixedMonthKey = '';
  let oldFixedMonthlyPln = 0;
  let newFixedMonthlyPln = 0;
  let newFixedCostTotalPln = 0;
  const addMonth =
    (options && options.cAddMonth === true) ||
    (typeof window !== 'undefined' && window.cAddMonth && window.cAddMonth.checked);
  const oldEnergyRatePln = Number(typeof window !== 'undefined' ? window.oldKosztKWh : 0) || 0;
  const daysInMonthForDate = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

  // start daty
  let cur = new Date(startDateStr);

  for (let d = 0; d < days; d++) {
    const dayDate = new Date(
      cur.getFullYear(), cur.getMonth(), cur.getDate(), 0, 0, 0, 0
    );
    const baseMs = dayDate.getTime();

    const hourUse = typeof buildHourlyUseForDay === 'function'
      ? buildHourlyUseForDay(dayDate, annualUsageKWh, use24Profile, { kWp, pvOffset: off })
      : buildHourUse24(annualUsageKWh, use24Profile, dayDate, monthlyUsageKWh);
    const oldUsageKwh = typeof sumUsageForSpan === 'function'
      ? sumUsageForSpan(dayDate, 1, annualUsageKWh, { kWp, pvOffset: off })
      : hourUse.reduce((sum, value) => sum + (Number(value) || 0), 0);
    const datedBaseline = getReDatedBaselineDay(dayDate, hourUse, annualUsageKWh, addMonth);
    const oldEnergyCostPln = datedBaseline ? datedBaseline.energy : Math.max(0, Number(oldUsageKwh) || 0) * Math.max(0, oldEnergyRatePln);
    const monthDays = daysInMonthForDate(dayDate) || 1;
    const monthKey = `${dayDate.getFullYear()}-${dayDate.getMonth()}`;
    if (monthKey !== fixedMonthKey) {
      if (fixedUsageYear !== dayDate.getFullYear()) {
        fixedUsageYear = dayDate.getFullYear();
        cumulativeYearUsageKWh = 0;
      }
      const monthStart = new Date(dayDate.getFullYear(), dayDate.getMonth(), 1);
      const fullMonthUsageKWh = typeof sumUsageForSpan === 'function'
        ? sumUsageForSpan(monthStart, monthDays, annualUsageKWh, { kWp })
        : 0;
      cumulativeYearUsageKWh += Math.max(0, Number(fullMonthUsageKWh) || 0);
      oldFixedMonthlyPln = calcTariffFixedMonthly(window.oldFixedRows, { annualUsageKWh: cumulativeYearUsageKWh });
      newFixedMonthlyPln = calcTariffFixedMonthly(window.selFixedRows, { annualUsageKWh: cumulativeYearUsageKWh });
      fixedMonthKey = monthKey;
    }
    const oldFixedCostPln = datedBaseline ? datedBaseline.fixed : (addMonth ? oldFixedMonthlyPln / monthDays : 0);
    const newFixedCostPln = addMonth ? newFixedMonthlyPln / monthDays : 0;
    const oldBillPln = oldEnergyCostPln + oldFixedCostPln;
    oldBillCash += oldBillPln;

    if (includeHourly && typeof window !== 'undefined') {
      window.traceRows = [];
    }

    const { cost, socOut, day } = costBankPVWindSell(
      hourUse,
      soc,
      kWp,
      off,
      baseMs,
      includeHourly // doLog
    );
    const endDepositPln = (typeof deposit !== 'undefined') ? Number(deposit || 0) : startDepositPln;

    if (includeHourly) {
      forecastDays.push(buildDashboardForecastDayFromTrace(
        dayDate,
        Array.isArray(window.traceRows) ? window.traceRows.slice(0, 24) : [],
        day,
        soc,
        typeof socOut === 'number' ? socOut : soc,
        startDepositPln,
        endDepositPln,
        bankCapacityKWh,
        {
          oldUsageKwh,
          oldEnergyCostPln,
          oldFixedCostPln,
          oldBillPln,
          newFixedCostPln
        }
      ));
      startDepositPln = endDepositPln;
    }

    // roczny rachunek gotówkowy: tylko to co faktycznie płacisz z kieszeni
    yearCostCash += (day.buyOwn_zl_cash + day.buyBank_zl_cash);
    newFixedCostTotalPln += newFixedCostPln;

    // aktualizacja stanu magazynu i przesunięcia PV/Wind
    if (typeof socOut === 'number') soc = socOut;
    off += 24;

    // kolejny dzień
    cur.setDate(cur.getDate() + 1);
  }

  if (addMonth) {
    yearCostCash += newFixedCostTotalPln;
  }


  const greenYearGenKWh  = (typeof window !== 'undefined') ? (window._greenYearGenKWh  || 0) : 0;
  const greenYearSoldKWh = (typeof window !== 'undefined') ? (window._greenYearSoldKWh || 0) : 0;
  const depositAfterYear = (typeof deposit !== 'undefined') ? deposit : 0;
  const depositPayout30  = 0;

  if (includeHourly && typeof window !== 'undefined') {
    window.traceRows = savedTraceRows;
  }

  const result = {
    yearCostCash,
    oldBillCash,
    depositAfterYear,
    depositPayout30,
    greenYearGenKWh,
    greenYearSoldKWh,
    finalSocKWh: soc
  };
  if (includeHourly) {
    result.days = forecastDays;
    result.batteryCapacityKWh = bankCapacityKWh;
  }
  return result;
}

function buildDashboardForecastDayFromTrace(dayDate, rows, day, socIn, socOut, depositStart, depositEnd, capacityKWh, summaryMeta) {
  const dateKey = `${dayDate.getFullYear()}-${String(dayDate.getMonth()+1).padStart(2,'0')}-${String(dayDate.getDate()).padStart(2,'0')}`;
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  const round = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 1000) / 1000;
  const precise = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 1000000000) / 1000000000;
  const oldUsageKwh = num(summaryMeta && summaryMeta.oldUsageKwh);
  const oldEnergyCostPln = num(summaryMeta && summaryMeta.oldEnergyCostPln);
  const oldFixedCostPln = num(summaryMeta && summaryMeta.oldFixedCostPln);
  const oldBillPln = num(summaryMeta && summaryMeta.oldBillPln);
  const newFixedCostPln = num(summaryMeta && summaryMeta.newFixedCostPln);
  const flowTotals = rows.reduce((totals, row) => {
    const source = row || {};
    const chargeFromPvKwh = Math.max(0, num(source.store_kWh));
    const dischargeToLoadKwh = Math.max(0, num(source.dis_kWh));
    const dischargeToGridKwh = Math.max(0, num(source.soldBank_kWh));
    totals.chargeFromPvKwh += chargeFromPvKwh;
    totals.dischargeToLoadKwh += dischargeToLoadKwh;
    totals.dischargeToGridKwh += dischargeToGridKwh;
    totals.dischargeKwh += dischargeToLoadKwh + dischargeToGridKwh;
    return totals;
  }, {
    chargeFromPvKwh: 0,
    dischargeToLoadKwh: 0,
    dischargeToGridKwh: 0,
    dischargeKwh: 0
  });
  const hours = Array.from({ length: 24 }, function (_, hour) {
    const row = rows[hour] || {};
    const gridForLoadKwh = Math.max(0, num(row.buyOwn_kWh));
    const gridTopupKwh = Math.max(0, num(row.buyBank_kWh || row.topup_kWh));
    const gridPurchaseKwh = Math.max(0, num(row.buy_kWh) || (gridForLoadKwh + gridTopupKwh));
    const sellPrice = Math.max(0, num(row.priceSell || row.rce_zl_kWh));
    const buyPrice = Math.max(0, num(row.priceBuy));
    const soldImmediateKwh = Math.max(0, num(row.soldImmediate_kWh));
    const soldBankKwh = Math.max(0, num(row.soldBank_kWh));
    const soldImmediatePln = Math.max(0, num(row.soldImmediate_zl) || (soldImmediateKwh * sellPrice));
    const soldBankPln = Math.max(0, num(row.soldBank_zl) || (soldBankKwh * sellPrice));
    const buyOwnTotalPln = Math.max(0, num(row.buyOwn_zl_total) || (gridForLoadKwh * buyPrice));
    const buyBankTotalPln = Math.max(0, num(row.buyBank_zl_total) || (gridTopupKwh * buyPrice));
    const depositUsedPln = Math.max(0, num(row.buyOwn_zl_fromDeposit) + num(row.buyBank_zl_fromDeposit));
    const cashCostPln = Math.max(0, num(row.buyOwn_zl_cash) + num(row.buyBank_zl_cash));
    const endSocKwh = Math.max(0, num(row.battery_kWh));
    const chargeFromPvKwh = Math.max(0, num(row.store_kWh));
    const dischargeToLoadKwh = Math.max(0, num(row.dis_kWh));

    return {
      hour: hour,
      dateKey: dateKey,
      totalBuyPricePln: round(buyPrice),
      energyBuyPricePln: round(buyPrice),
      distributionBuyPricePln: 0,
      sellPricePln: round(sellPrice),
      rcePricePln: round(sellPrice),
      demandKwh: round(Math.abs(num(row.use_kWh))),
      generationKwh: round(num(row.gen_kWh) || (num(row.pv_kWh) + num(row.wind_kWh))),
      chargeFromPvKwh: round(chargeFromPvKwh),
      storageChargeFromPvKwh: round(chargeFromPvKwh),
      pvToBankKwh: round(chargeFromPvKwh),
      topupKwh: round(gridTopupKwh),
      chargeFromGridKwh: round(gridTopupKwh),
      soldImmediateKwh: round(soldImmediateKwh),
      soldBankKwh: round(soldBankKwh),
      bankToSellKwh: round(soldBankKwh),
      dischargeToGridKwh: round(soldBankKwh),
      bankToLoadKwh: round(dischargeToLoadKwh),
      dischargeToLoadKwh: round(dischargeToLoadKwh),
      dischargeKwh: round(dischargeToLoadKwh + soldBankKwh),
      gridTopupKwh: round(gridTopupKwh),
      gridPurchaseKwh: round(gridPurchaseKwh),
      gridPurchaseForLoadKwh: round(gridForLoadKwh),
      billedGridPurchaseForLoadKwh: round(gridForLoadKwh),
      nominalCostPln: round(buyOwnTotalPln + buyBankTotalPln),
      cashCostPln: round(cashCostPln),
      depositUsedPln: round(depositUsedPln),
      depositEarnedPln: round(soldImmediatePln + soldBankPln),
      exportKwh: round(soldImmediateKwh + soldBankKwh),
      endSocKwh: round(endSocKwh),
      socPercent: capacityKWh > 0 ? round((endSocKwh / capacityKWh) * 100) : 0,
      endDepositPln: round(num(row.deposit_zl) || depositEnd),
      isForecast: row.source !== 'actual'
    };
  });
  const totals = {
    usageKwh: round(day && day.use_kWh_sum),
    oldUsageKwh: round(oldUsageKwh),
    oldEnergyCostPln: round(oldEnergyCostPln),
    oldFixedCostPln: precise(oldFixedCostPln),
    oldBillPln: precise(oldBillPln),
    currentBillPln: precise(oldBillPln),
    generationKwh: round((day && day.sum_PV || 0) + (day && day.sum_wind || 0)),
    directPvKwh: 0,
    bankToLoadKwh: round(flowTotals.dischargeToLoadKwh),
    chargeFromPvKwh: round(flowTotals.chargeFromPvKwh),
    storageChargeFromPvKwh: round(flowTotals.chargeFromPvKwh),
    pvToBankKwh: round(flowTotals.chargeFromPvKwh),
    topupKwh: round(day && day.buyBank_kWh),
    chargeFromGridKwh: round(day && day.buyBank_kWh),
    dischargeKwh: round(flowTotals.dischargeKwh),
    dischargeToLoadKwh: round(flowTotals.dischargeToLoadKwh),
    dischargeToGridKwh: round(flowTotals.dischargeToGridKwh),
    bankToSellKwh: round(flowTotals.dischargeToGridKwh),
    exportKwh: round((day && day.soldImmediate_kWh || 0) + (day && day.soldBank_kWh || 0)),
    soldImmediateKwh: round(day && day.soldImmediate_kWh),
    soldImmediatePln: round(day && day.soldImmediate_zl),
    soldBankKwh: round(day && day.soldBank_kWh),
    soldBankPln: round(day && day.soldBank_zl),
    gridPurchaseKwh: round((day && day.buyOwn_kWh || 0) + (day && day.buyBank_kWh || 0)),
    gridPurchaseForLoadKwh: round(day && day.buyOwn_kWh),
    gridTopupKwh: round(day && day.buyBank_kWh),
    nominalVariableCostPln: round((day && day.buyOwn_zl_total || 0) + (day && day.buyBank_zl_total || 0)),
    cashCostPln: round((day && day.buyOwn_zl_cash || 0) + (day && day.buyBank_zl_cash || 0)),
    newFixedCostPln: precise(newFixedCostPln),
    cashCostWithFixedPln: precise((day && day.buyOwn_zl_cash || 0) + (day && day.buyBank_zl_cash || 0) + newFixedCostPln),
    topupCashCostPln: round(day && day.buyBank_zl_cash),
    depositUsedPln: round((day && day.buyOwn_zl_fromDeposit || 0) + (day && day.buyBank_zl_fromDeposit || 0)),
    depositEarnedPln: round((day && day.soldImmediate_zl || 0) + (day && day.soldBank_zl || 0)),
    buyOwnKwh: round(day && day.buyOwn_kWh),
    buyOwnCashPln: round(day && day.buyOwn_zl_cash),
    buyOwnFromDepositPln: round(day && day.buyOwn_zl_fromDeposit),
    buyOwnNominalPln: round(day && day.buyOwn_zl_total),
    buyBankKwh: round(day && day.buyBank_kWh),
    buyBankCashPln: round(day && day.buyBank_zl_cash),
    buyBankFromDepositPln: round(day && day.buyBank_zl_fromDeposit),
    buyBankNominalPln: round(day && day.buyBank_zl_total),
    physicalGridImportKwh: round((day && day.buyOwn_kWh || 0) + (day && day.buyBank_kWh || 0)),
    physicalGridExportKwh: round((day && day.soldImmediate_kWh || 0) + (day && day.soldBank_kWh || 0)),
    billedGridPurchaseKwh: round((day && day.buyOwn_kWh || 0) + (day && day.buyBank_kWh || 0)),
    billedGridPurchaseForLoadKwh: round(day && day.buyOwn_kWh),
    billedGridTopupKwh: round(day && day.buyBank_kWh),
    billedGridExportKwh: round((day && day.soldImmediate_kWh || 0) + (day && day.soldBank_kWh || 0)),
    billedSaleValuePln: round((day && day.soldImmediate_zl || 0) + (day && day.soldBank_zl || 0)),
    billedPurchaseNominalPln: round((day && day.buyOwn_zl_total || 0) + (day && day.buyBank_zl_total || 0)),
    billedPurchaseCashPln: round((day && day.buyOwn_zl_cash || 0) + (day && day.buyBank_zl_cash || 0)),
    billedPurchaseCashWithFixedPln: precise((day && day.buyOwn_zl_cash || 0) + (day && day.buyBank_zl_cash || 0) + newFixedCostPln),
    billedDepositUsedPln: round((day && day.buyOwn_zl_fromDeposit || 0) + (day && day.buyBank_zl_fromDeposit || 0)),
    billedDepositEarnedPln: round((day && day.soldImmediate_zl || 0) + (day && day.soldBank_zl || 0)),
    dischargeByZone: { cheap: 0, mid: 0, peak: 0, all: round(flowTotals.dischargeToLoadKwh) }
  };

  return {
    dateKey,
    hours,
    totals,
    oldBillPln: precise(oldBillPln),
    newFixedCostPln: precise(newFixedCostPln),
    startSocKwh: round(socIn),
    endSocKwh: round(socOut),
    startSocPercent: capacityKWh > 0 ? round((socIn / capacityKWh) * 100) : 0,
    endSocPercent: capacityKWh > 0 ? round((socOut / capacityKWh) * 100) : 0,
    startDepositPln: round(depositStart),
    endDepositPln: round(depositEnd),
    cycleCountEnd: 0,
    isForecast: hours.some(hour => hour.isForecast)
  };
}

// opcjonalnie podwieszenie pod window, żeby łatwo odpalać z konsoli:
if (typeof window !== 'undefined') {
  window.simulateYearBankPVWindSell = simulateYearBankPVWindSell;
}
