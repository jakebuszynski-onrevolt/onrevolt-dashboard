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
  function normalizedLabel(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ł/g, 'l');
  }
  function capacityRow(tariff) {
    return (tariff.variable || []).find(function (row) {
      return normalizedLabel(row && row.label).includes('oplata mocowa');
    }) || null;
  }
  function capacityRule(tariff, date) {
    const row = capacityRow(tariff);
    if (!row) return null;
    const rule = tariff.capacity_charge;
    if (!rule || rule.model !== 'pl_capacity_charge') {
      throw new Error('Brak reguły rozliczenia opłaty mocowej dla taryfy ' + String(tariff.code || 'C') + '.');
    }
    if (date && ((rule.effective_from && date < rule.effective_from) || (rule.effective_until && date >= rule.effective_until))) {
      throw new Error('Brak aktualnej reguły opłaty mocowej dla ' + date + '.');
    }
    return rule;
  }
  function easterSunday(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }
  function dateWithOffset(date, days) {
    const value = new Date(date.getTime());
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  }
  function isPolishPublicHoliday(date) {
    const year = Number(date.slice(0, 4));
    const fixed = new Set([
      year + '-01-01', year + '-01-06', year + '-05-01', year + '-05-03', year + '-08-15',
      year + '-11-01', year + '-11-11', year + '-12-25', year + '-12-26'
    ]);
    if (year >= 2025) fixed.add(year + '-12-24');
    const easter = easterSunday(year);
    fixed.add(dateWithOffset(easter, 1));
    fixed.add(dateWithOffset(easter, 60));
    return fixed.has(date);
  }
  function capacityQualifyingHour(rule, date, hour) {
    const day = new Date(date + 'T12:00:00Z').getUTCDay();
    if (rule.exclude_weekends && (day === 0 || day === 6)) return false;
    if (rule.exclude_public_holidays && isPolishPublicHoliday(date)) return false;
    return hour >= Number(rule.qualifying_hour_from) && hour < Number(rule.qualifying_hour_until);
  }
  function capacityMode(rule, options) {
    const power = Number(options && options.connectionPowerKw);
    if (!Number.isFinite(power) || power <= 0) return 'unresolved';
    return rule.flat_eligible && power <= Number(rule.flat_max_power_kw) ? 'flat' : 'variable';
  }
  function capacityProfileFactor(rule, date, dayProfileKwh) {
    if (!Array.isArray(dayProfileKwh) || dayProfileKwh.length !== 24) return null;
    let peak = 0, peakHours = 0, other = 0, otherHours = 0;
    for (let hour = 0; hour < 24; hour += 1) {
      const amount = Number(dayProfileKwh[hour]);
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Nieprawidłowy profil dobowy opłaty mocowej.');
      if (capacityQualifyingHour(rule, date, hour)) { peak += amount; peakHours += 1; }
      else { other += amount; otherHours += 1; }
    }
    if (!peakHours) return 0;
    if (!otherHours || other <= 0) return 1;
    const difference = (((peak / peakHours) / (other / otherHours)) - 1) * 100;
    const band = (rule.profile_factors || []).find(function (item) {
      return item.difference_max_percent == null || difference < Number(item.difference_max_percent);
    });
    if (!band || !Number.isFinite(Number(band.factor))) throw new Error('Niekompletne współczynniki opłaty mocowej.');
    return Number(band.factor);
  }
  function capacityFlatMonthly(tariff, date, options, required) {
    const rule = capacityRule(tariff, date);
    if (!rule) return 0;
    const mode = capacityMode(rule, options);
    if (mode === 'unresolved') {
      if (required) throw new Error('Brak mocy umownej do obliczenia opłaty mocowej.');
      return 0;
    }
    if (mode !== 'flat') return 0;
    const annual = Number(options && options.annualUsageKwh);
    if (!Number.isFinite(annual) || annual < 0) throw new Error('Brak rocznego zużycia do opłaty mocowej.');
    const band = (rule.flat_monthly || []).find(function (item) {
      return (item.annual_usage_min_kwh == null || annual >= Number(item.annual_usage_min_kwh))
        && (item.annual_usage_max_kwh == null || annual < Number(item.annual_usage_max_kwh));
    });
    if (!band || !Number.isFinite(Number(band.amount))) throw new Error('Brak miesięcznej stawki opłaty mocowej.');
    return Number(band.amount);
  }
  function capacityVariableRate(tariff, date, hour, options) {
    const rule = capacityRule(tariff, date);
    if (!rule) return { rate: 0, factor: null, pending: false, mode: null };
    const mode = capacityMode(rule, options);
    if (mode !== 'variable' || !capacityQualifyingHour(rule, date, hour)) {
      return { rate: 0, factor: mode === 'flat' ? null : 0, pending: mode === 'unresolved', mode };
    }
    let factor = Number(options && options.capacityChargeFactor);
    if (!Number.isFinite(factor)) factor = capacityProfileFactor(rule, date, options && options.dayProfileKwh);
    if (!Number.isFinite(factor)) return { rate: 0, factor: null, pending: true, mode };
    return { rate: Number(rule.variable_rate) * factor, factor, pending: false, mode };
  }
  function rates(tariff, date, hour, marketPrice, options) {
    const code = zone(tariff, date, hour);
    let energy = 0, distribution = 0;
    for (const row of tariff.variable || []) {
      if (row.window_code !== 'all' && row.window_code !== code) continue;
      const amount = Number(row.price);
      if (!Number.isFinite(amount)) throw new Error('Brak ceny składnika taryfy.');
      const label = normalizedLabel(row.label);
      if (label.includes('oplata mocowa')) continue;
      if (label === 'energia' || label.includes('energia czynna')) energy += amount;
      else distribution += amount;
    }
    if (tariff.sell_method === 'rdn') {
      if (!Number.isFinite(marketPrice)) throw new Error('Brak ceny RDN dla ' + date + ' godz. ' + hour);
      energy = marketPrice + Number(tariff.osd_add_rdn || 0) + Number(tariff.osd_add_akcyza || 0);
    }
    const capacity = capacityVariableRate(tariff, date, hour, options || {});
    distribution += capacity.rate;
    return { energy, distribution, total: energy + distribution, zone: code,
      capacityChargeRate: capacity.rate, capacityChargeFactor: capacity.factor,
      capacityChargePending: capacity.pending, capacityChargeMode: capacity.mode };
  }
  function fixedRowsMonthly(rows, options) {
    const o = options || {};
    return (rows || []).reduce(function (sum, row) {
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
  function fixedMonthly(tariff, options) {
    const o = options || {};
    const fixed = fixedRowsMonthly(tariff.fixed, o);
    const date = tariff.capacity_charge && tariff.capacity_charge.effective_from;
    return fixed + capacityFlatMonthly(tariff, date, o, true);
  }
  function fixedDaily(tariff, date, options) {
    const days = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
    return fixedMonthly(tariff, options) / days;
  }
  function cost(history, records, from, until, options) {
    const o = options || {};
    const out = { total: 0, purchaseCost: 0, distributionCost: 0, fixedCost: 0, subscriptionCost: 0,
      distributionDetails: { network: 0, quality: 0, oze: 0, cogeneration: 0, capacity: 0 }, fixedDetails: [], subscriptionDetails: [] };
    const fixed = new Map();
    const profiles = new Map();
    for (const record of records) {
      if (record.date < from || record.date >= until) continue;
      const profile = profiles.get(record.date) || Array(24).fill(0);
      for (const slot of record.slots) {
        if (!Number.isFinite(slot.kwh) || slot.kwh < 0) throw new Error('Nieprawidłowe zużycie w przedziale.');
        profile[slot.hour] += slot.kwh;
      }
      profiles.set(record.date, profile);
    }
    for (let d = new Date(from + 'T12:00:00Z'); d.toISOString().slice(0, 10) < until; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = d.toISOString().slice(0, 10), tariff = resolve(history, date, null);
      for (const row of tariff.fixed || []) {
        const amount = fixedRowsMonthly([row], o) / new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
        out.fixedCost += amount;
        const key = row.component_key || row.label;
        const entry = fixed.get(key) || { label: row.label, value: 0 };
        entry.value += amount; fixed.set(key, entry);
      }
      const capacity = capacityFlatMonthly(tariff, date, o, true) / new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
      if (capacity > 0) {
        out.fixedCost += capacity;
        const entry = fixed.get('capacity-charge') || { label: 'Opłata mocowa', value: 0 };
        entry.value += capacity; fixed.set('capacity-charge', entry);
      }
    }
    for (const record of records) {
      if (record.date < from || record.date >= until) continue;
      const tariff = resolve(history, record.date, null);
      for (const slot of record.slots) {
        if (!Number.isFinite(slot.kwh) || slot.kwh < 0) throw new Error('Nieprawidłowe zużycie w przedziale.');
        const rate = rates(tariff, record.date, slot.hour, slot.marketPrice,
          Object.assign({}, o, { dayProfileKwh: profiles.get(record.date) }));
        if (rate.capacityChargePending) throw new Error('Brak danych do obliczenia opłaty mocowej dla ' + record.date + '.');
        out.purchaseCost += slot.kwh * rate.energy;
        out.distributionCost += slot.kwh * rate.distribution;
        out.distributionDetails.capacity += slot.kwh * rate.capacityChargeRate;
        for (const row of tariff.variable || []) {
          if (row.window_code !== 'all' && row.window_code !== rate.zone) continue;
          const label = normalizedLabel(row.label);
          if (label.includes('oplata mocowa')) continue;
          const key = label.includes('jako') ? 'quality' : label.includes('oze') ? 'oze' : label.includes('kogener') ? 'cogeneration' : null;
          if (key) out.distributionDetails[key] += slot.kwh * Number(row.price);
        }
      }
    }
    out.distributionDetails.network = out.distributionCost - out.distributionDetails.quality - out.distributionDetails.oze - out.distributionDetails.cogeneration - out.distributionDetails.capacity;
    out.fixedDetails = Array.from(fixed.values());
    out.total = out.purchaseCost + out.distributionCost + out.fixedCost;
    return out;
  }
  return { resolve, expand, zone, rates, fixedMonthly, fixedDaily, cost,
    capacityRule, capacityQualifyingHour, capacityProfileFactor, capacityFlatMonthly, capacityVariableRate };
});
