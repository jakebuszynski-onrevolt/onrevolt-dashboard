/* Included in both RE views by prepare-client-tariff-assets.ts. */
function clientTariffActual(payload, basic) {
  if (!payload.tariffHistory?.strict) return basic;
  return Object.assign({}, payload.tariffData?.current || {}, { clientTariffHistory: payload.tariffHistory });
}

function clientTariffAnnualUsage(payload) {
  const account = payload.account || {}, energy = payload.energy || {}, raw = payload.rawEnergy || {};
  for (const value of [account.annualUsageKwh, account.annualConsumptionKwh, energy.annualUsageKwh,
    energy.annualConsumptionKwh, raw.annualUsageKwh, raw.annualConsumptionKwh]) {
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function clientTariffFixedCosts(payload, rangeWindow, purchaseKwh) {
  const account = payload.account || {}, settings = account.tariffSettings || {}, current = settings.current || {};
  const end = new Date(rangeWindow.end); end.setDate(end.getDate() + 1);
  const key = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return ReTariffEngine.cost(payload.tariffHistory, [], key(rangeWindow.start), key(end), {
    annualUsageKwh: clientTariffAnnualUsage(payload),
    billingCycleMonths: Number(current.billingCycleMonths ?? current.billing_cycle_months ?? settings.billingCycleMonths ?? account.billingCycleMonths ?? 1),
    connectionPowerKw: Number(current.contractPowerKw ?? current.contract_power_kw ?? settings.contractPowerKw ?? account.contractPowerKw),
  }).fixedCost;
}

function clientTariffNotice(message, source = 'general') {
  const notices = window.__clientTariffNotices || (window.__clientTariffNotices = {});
  if (message) notices[source] = String(message);
  else delete notices[source];
  const activeMessage = Object.values(notices).find(Boolean) || '';
  let notice = document.getElementById('client-tariff-completeness');
  if (!notice && activeMessage) {
    notice = document.createElement('div');
    notice.id = 'client-tariff-completeness';
    notice.setAttribute('role', 'alert');
    notice.style.cssText = 'padding:12px 18px;border:1px solid #d49c19;background:#fff3cd;color:#533f03;margin:12px;';
    document.body.prepend(notice);
  }
  if (notice) { notice.textContent = activeMessage; notice.hidden = !activeMessage; }
}

function clientTariffDashboardCost(payload, rangeWindow, options, hourOfQuarter) {
  const history = payload.tariffHistory;
  if (!history || !history.strict) return undefined;
  const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const end = new Date(rangeWindow.end); end.setDate(end.getDate()+1);
  try {
    const records = (payload.usageData?.records || []).map(record => ({ date: record.date,
      slots: (record.quarters || []).map((q, index) => {
        const hour = hourOfQuarter(q, index);
        const market = payload.priceHistory?.rceByDate?.[record.date]?.hourlyRates?.find(r => Number(r.hour) === hour);
        return { hour, kwh: options.gridOnly ? Number(q.gridBilled ?? q.billedGrid ?? q.gridPhysical ?? q.grid ?? 0) : Number(q.gridPhysical ?? q.grid ?? 0) + Number(q.storage ?? 0) + Number(q.pv ?? 0),
          marketPrice: market?.pricePln };
      }) }));
    const result = ReTariffEngine.cost(history, records, dateKey(rangeWindow.start), dateKey(end), options);
    clientTariffNotice('', 'dashboard-cost');
    return result;
  } catch (error) {
    clientTariffNotice(error.message + ' Sprawdź historię taryf w CRM. Koszty tego zakresu są niekompletne.', 'dashboard-cost');
    return null;
  }
}

function getReDatedBaselineDay(dayDate, hourUse, annualUsageKwh, addFixed) {
  const history = window.reClientTariffHistory;
  if (!history?.strict) return null;
  const date = fmtDayLocal(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate());
  const next = new Date(dayDate); next.setDate(next.getDate()+1);
  const until = fmtDayLocal(next.getFullYear(), next.getMonth(), next.getDate());
  const market = indexRceByDay(window.rdn).get(date);
  const cost = ReTariffEngine.cost(history, [{ date, slots: hourUse.map((kwh, hour) => ({ kwh, hour, marketPrice: market?.[hour] })) }], date, until,
    { annualUsageKwh, billingCycleMonths: getBillingCycleMonths(), connectionPowerKw: getContractPowerKw() });
  return { energy: cost.purchaseCost + cost.distributionCost, fixed: addFixed ? cost.fixedCost : 0 };
}
