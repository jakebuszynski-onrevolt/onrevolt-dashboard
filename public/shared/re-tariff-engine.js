(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.ReTariffEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function resolve(history, date, basic) {
    if (!history || !history.strict) return basic;
    const entry = history.byDate && history.byDate[date];
    const tariff = typeof entry === 'string' ? history.tariffs && history.tariffs[entry] : entry;
    if (!tariff) throw new Error('Wymaga uzupełnienia: brak cen taryfy dla ' + date);
    return tariff;
  }
  function expand(history) {
    if (!history || history.format !== 'client-tariffs-v1') return history;
    const byDate = Object.fromEntries(Object.entries(history.byDate).map(function (entry) {
      const value = entry[1];
      if (value === null) return entry;
      if (typeof value !== 'string' || !history.tariffs[value]) throw new Error('Nieprawidłowe odwołanie do wersji taryfy.');
      return [entry[0], history.tariffs[value]];
    }));
    return Object.assign({}, history, { format: 'expanded', byDate });
  }
  function zone(tariff, date, hour) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Nieprawidłowa godzina taryfy.');
    const model = tariff.zone_model;
    if (model === 'all') return 'all';
    const day = new Date(date + 'T12:00:00Z').getUTCDay();
    if ((day === 6 && tariff.cheap_saturday) || (day === 0 && tariff.cheap_sunday)) {
      return { daynight: 'night', peakoffpeak: 'offpeak', highmidlow: 'low' }[model];
    }
    if (tariff.use_monthly) {
      const month = Number(date.slice(5, 7));
      const value = tariff.monthly && tariff.monthly[month] && tariff.monthly[month][hour];
      const code = ({ daynight: { 1: 'night', 2: 'day' }, peakoffpeak: { 1: 'offpeak', 2: 'peak' }, highmidlow: { 1: 'high', 2: 'mid', 3: 'low' } }[model] || {})[value];
      if (!code) throw new Error('Niekompletny harmonogram stref dla ' + date);
      return code;
    }
    if (model === 'daynight') return tariff.dn_night.includes(hour) ? 'night' : 'day';
    if (model === 'peakoffpeak') return tariff.po_off.includes(hour) ? 'offpeak' : 'peak';
    throw new Error('Nieobsługiwany harmonogram taryfy.');
  }
  function rates(tariff, date, hour, marketPrice) {
    const code = zone(tariff, date, hour);
    let energy = 0, distribution = 0;
    for (const row of tariff.variable || []) {
      if (row.window_code !== 'all' && row.window_code !== code) continue;
      const amount = Number(row.price);
      if (!Number.isFinite(amount)) throw new Error('Brak ceny składnika taryfy.');
      const label = String(row.label).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (label === 'energia' || label.includes('energia czynna')) energy += amount;
      else distribution += amount;
    }
    if (tariff.sell_method === 'rdn') {
      if (!Number.isFinite(marketPrice)) throw new Error('Brak ceny RDN dla ' + date + ' godz. ' + hour);
      energy = marketPrice + Number(tariff.osd_add_rdn || 0) + Number(tariff.osd_add_akcyza || 0);
    }
    return { energy, distribution, total: energy + distribution, zone: code };
  }
  function fixedMonthly(tariff, options) {
    const o = options || {};
    return (tariff.fixed || []).reduce(function (sum, row) {
      if (row.billing_cycle_months != null && Number(row.billing_cycle_months) > 0) {
        if (!Number.isFinite(o.billingCycleMonths) || o.billingCycleMonths <= 0) throw new Error('Brak cyklu rozliczeniowego do opłaty stałej.');
        if (Number(row.billing_cycle_months) !== o.billingCycleMonths) return sum;
      }
      if ((row.annual_usage_min_kwh != null || row.annual_usage_max_kwh != null) && !Number.isFinite(o.annualUsageKwh)) throw new Error('Brak rocznego zużycia do opłaty stałej.');
      if (row.annual_usage_min_kwh != null && o.annualUsageKwh < Number(row.annual_usage_min_kwh)) return sum;
      if (row.annual_usage_max_kwh != null && o.annualUsageKwh >= Number(row.annual_usage_max_kwh)) return sum;
      const amount = Number(row.amount);
      const factor = row.amount_mode === 'per_kw_month' ? o.connectionPowerKw : 1;
      if (!Number.isFinite(amount) || !Number.isFinite(factor) || (row.amount_mode === 'per_kw_month' && factor <= 0)) throw new Error('Brak danych do opłaty stałej.');
      return sum + amount * factor;
    }, 0);
  }
  function fixedDaily(tariff, date, options) {
    const days = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
    return fixedMonthly(tariff, options) / days;
  }
  function cost(history, records, from, until, options) {
    const o = options || {};
    const out = { total: 0, purchaseCost: 0, distributionCost: 0, fixedCost: 0, subscriptionCost: 0,
      distributionDetails: { network: 0, quality: 0, oze: 0, cogeneration: 0 }, fixedDetails: [], subscriptionDetails: [] };
    const fixed = new Map();
    for (let d = new Date(from + 'T12:00:00Z'); d.toISOString().slice(0, 10) < until; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10), tariff = resolve(history, date, null);
      for (const row of tariff.fixed || []) {
        const amount = fixedDaily(Object.assign({}, tariff, { fixed: [row] }), date, o);
        out.fixedCost += amount;
        const key = row.component_key || row.label;
        const entry = fixed.get(key) || { label: row.label, value: 0 };
        entry.value += amount; fixed.set(key, entry);
      }
    }
    for (const record of records) {
      if (record.date < from || record.date >= until) continue;
      const tariff = resolve(history, record.date, null);
      for (const slot of record.slots) {
        if (!Number.isFinite(slot.kwh) || slot.kwh < 0) throw new Error('Nieprawidłowe zużycie w przedziale.');
        const rate = rates(tariff, record.date, slot.hour, slot.marketPrice);
        out.purchaseCost += slot.kwh * rate.energy;
        out.distributionCost += slot.kwh * rate.distribution;
        for (const row of tariff.variable || []) {
          if (row.window_code !== 'all' && row.window_code !== rate.zone) continue;
          const label = String(row.label).toLowerCase();
          const key = label.includes('jako') ? 'quality' : label.includes('oze') ? 'oze' : label.includes('kogener') ? 'cogeneration' : null;
          if (key) out.distributionDetails[key] += slot.kwh * Number(row.price);
        }
      }
    }
    out.distributionDetails.network = out.distributionCost - out.distributionDetails.quality - out.distributionDetails.oze - out.distributionDetails.cogeneration;
    out.fixedDetails = Array.from(fixed.values());
    out.total = out.purchaseCost + out.distributionCost + out.fixedCost;
    return out;
  }
  return { resolve, expand, zone, rates, fixedMonthly, fixedDaily, cost };
});
