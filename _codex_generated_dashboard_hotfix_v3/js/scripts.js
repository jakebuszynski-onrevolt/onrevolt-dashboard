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

(function () {
  const weekdayFormatter = new Intl.DateTimeFormat("pl-PL", { weekday: "long" });
  const dateFormatter = new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  const DASHBOARD_BASE_WIDTH = 1920;
  const DASHBOARD_BASE_HEIGHT = 1200;
  const WEB_RUNTIME_FULL_REFRESH_MS = 60000;
  const WEB_RUNTIME_LIVE_REFRESH_SECONDS = [16, 26, 36, 46, 56];
  const WEB_RUNTIME_LIVE_REFRESH_JITTER_MS = 2000;
  const DASHBOARD_RE_PAYLOAD_WAIT_MS = 12000;
  const DASHBOARD_REMOTE_API_URL = "https://my.onrevolt.com/api/dashboard.php";
  const DASHBOARD_REMOTE_RE_BASE_URL = "https://my.onrevolt.com/re/";
  const DASHBOARD_STALE_DATA_THRESHOLD_MS = 15 * 60 * 1000;
  const DASHBOARD_SALE_ACTIVE_THRESHOLD_KWH = 0.25;
  const PROSUMER_SALE_PRICE_MULTIPLIER = 1.23;
  const PROSUMER_DEPOSIT_INITIAL_PLN = 0;
  const DASHBOARD_DATA_MODE_REAL = "real";
  const DASHBOARD_DATA_MODE_USAGE_ONLY = "usage-only";
  const DASHBOARD_DATA_MODE_DEMO = "demo";
  const PV_LIGHT_LUX_REFERENCE = 20000;
  const PV_UVI_REFERENCE = 10.5;
  const DASHBOARD_WEATHER_REFRESH_MS = 15 * 60 * 1000;
  const DASHBOARD_WEATHER_MODEL = "ecmwf_ifs025";
  const DASHBOARD_WEATHER_LOCATION = {
    label: "Poznań",
    latitude: 52.43452321306382,
    longitude: 16.822114529123457,
    timezone: "Europe/Warsaw"
  };
  const timeFormatter = new Intl.DateTimeFormat("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const staleDataDateFormatter = new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const WEATHER_ICON_PATHS = {
    clearDay: "images/icons/weather-clear-day.svg",
    clearNight: "images/icons/weather-clear-night.svg",
    partlyCloudyDay: "images/icons/weather-partly-cloudy-day.svg",
    partlyCloudyDayAlt: "images/icons/weather-partly-cloudy-day-alt.svg",
    partlyCloudyNight: "images/icons/weather-partly-cloudy-night.svg",
    partlyCloudyNightAlt: "images/icons/weather-partly-cloudy-night-alt.svg",
    cloudy: "images/icons/weather-cloudy.svg",
    rainy: "images/icons/weather-rainy.svg",
    hail: "images/icons/weather-hail.svg",
    snowy: "images/icons/weather-snowy.svg",
    cool: "images/icons/weather-cool.svg"
  };

  function asFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function firstFiniteNumber() {
    for (let index = 0; index < arguments.length; index += 1) {
      const numeric = asFiniteNumber(arguments[index]);
      if (numeric != null) {
        return numeric;
      }
    }

    return null;
  }

  function firstTextValue() {
    for (let index = 0; index < arguments.length; index += 1) {
      const value = arguments[index];
      if (value != null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }

    return "";
  }

  function getDashboardChartDrilldownTarget(range, anchorDate, item, dataIndex) {
    if (range !== "year" && range !== "month" && range !== "week") {
      return null;
    }

    const rawDate = firstTextValue(
      item && item.sourceDate,
      item && item.dateKey,
      item && item.key
    );
    const dateMatch = rawDate.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    let itemDate = dateMatch
      ? new Date(
        Number(dateMatch[1]),
        Number(dateMatch[2]) - 1,
        Number(dateMatch[3] || 1),
        12,
        0,
        0,
        0
      )
      : null;

    if (range === "year") {
      if (!itemDate) {
        itemDate = new Date(anchorDate.getFullYear(), dataIndex, 1, 12, 0, 0, 0);
      }
      return {
        range: "month",
        anchorDate: new Date(itemDate.getFullYear(), itemDate.getMonth(), 1, 12, 0, 0, 0)
      };
    }

    return itemDate ? {
      range: "day",
      anchorDate: itemDate
    } : null;
  }

  function getDashboardNavigationDay(date) {
    const next = date instanceof Date ? new Date(date) : new Date();
    next.setHours(12, 0, 0, 0);
    return next;
  }

  function addDashboardNavigationDays(date, days) {
    const next = getDashboardNavigationDay(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function addDashboardNavigationMonths(date, months) {
    const next = getDashboardNavigationDay(date);
    next.setMonth(next.getMonth() + months);
    return next;
  }

  function addDashboardNavigationYears(date, years) {
    const next = getDashboardNavigationDay(date);
    next.setFullYear(next.getFullYear() + years);
    return next;
  }

  function getDashboardNavigationWeekStart(date) {
    const next = getDashboardNavigationDay(date);
    const day = next.getDay();
    const shift = day === 0 ? -6 : 1 - day;
    next.setDate(next.getDate() + shift);
    return next;
  }

  function getDashboardNavigationShiftDate(date, range, step) {
    if (range === "week") {
      return addDashboardNavigationDays(date, step * 7);
    }
    if (range === "month") {
      return addDashboardNavigationMonths(date, step);
    }
    if (range === "year") {
      return addDashboardNavigationYears(date, step);
    }
    return addDashboardNavigationDays(date, step);
  }

  function getDashboardNavigationLimitDate(range) {
    const today = getDashboardNavigationDay(new Date());
    return range === "day" ? addDashboardNavigationDays(today, 1) : today;
  }

  function compareDashboardNavigationRange(leftDate, rightDate, range) {
    const left = getDashboardNavigationDay(leftDate);
    const right = getDashboardNavigationDay(rightDate);

    if (range === "week") {
      return getDashboardNavigationWeekStart(left).getTime() - getDashboardNavigationWeekStart(right).getTime();
    }
    if (range === "month") {
      return (left.getFullYear() - right.getFullYear()) || (left.getMonth() - right.getMonth());
    }
    if (range === "year") {
      return left.getFullYear() - right.getFullYear();
    }
    return left.getTime() - right.getTime();
  }

  function getOnRevoltChartItemHour(item) {
    const directHour = firstFiniteNumber(
      item && item.hour,
      item && item.hourIndex,
      item && item.h
    );
    if (directHour != null) {
      return Math.floor(directHour);
    }

    const label = firstTextValue(item && item.label, item && item.rangeLabel);
    const match = label.match(/(\d{1,2})(?::\d{2})?/);
    if (!match) {
      return null;
    }

    const hour = Number(match[1]);
    return Number.isFinite(hour) ? Math.floor(hour) : null;
  }

  function findOnRevoltCurrentHourIndex(items, now) {
    const list = Array.isArray(items) ? items : [];
    const currentHour = now.getHours();
    const currentDateKey = formatDashboardDateKey(now);

    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      if (!item || item.isGap) {
        continue;
      }

      const sourceDate = firstTextValue(item.sourceDate, item.date, item.dateKey);
      if (sourceDate && sourceDate.slice(0, 10) !== currentDateKey) {
        continue;
      }

      if (getOnRevoltChartItemHour(item) === currentHour) {
        return index;
      }
    }

    return -1;
  }

  function createOnRevoltEchartsCurrentHourHighlighter(options) {
    const chart = options && options.chart;
    const element = options && options.element;
    const getItems = options && typeof options.getItems === "function" ? options.getItems : null;
    const getRange = options && typeof options.getRange === "function" ? options.getRange : null;
    const getAnchorDate = options && typeof options.getAnchorDate === "function" ? options.getAnchorDate : null;
    const getCurrentIndex = options && typeof options.getCurrentIndex === "function" ? options.getCurrentIndex : null;
    const restoreDelayMs = Math.max(0, Number(options && options.restoreDelayMs) || 2000);

    if (!chart || !element || !getItems || !getRange || !getAnchorDate) {
      return null;
    }

    const highlight = document.createElement("div");
    highlight.className = "echarts-current-hour-highlight";
    highlight.hidden = true;
    element.appendChild(highlight);

    let restoreTimer = 0;

    function clearRestoreTimer() {
      if (restoreTimer) {
        window.clearTimeout(restoreTimer);
        restoreTimer = 0;
      }
    }

    function getCurrentIndexValue(now) {
      return getCurrentIndex
        ? getCurrentIndex(getItems(), now)
        : findOnRevoltCurrentHourIndex(getItems(), now);
    }

    function getPlotBounds() {
      let top = 0;
      let bottom = element.clientHeight || 0;
      const option = typeof chart.getOption === "function" ? chart.getOption() : null;
      const yAxis = option && Array.isArray(option.yAxis) ? option.yAxis[0] : (option && option.yAxis);

      try {
        const max = yAxis && Array.isArray(yAxis.max) ? yAxis.max[0] : yAxis && yAxis.max;
        const min = yAxis && Array.isArray(yAxis.min) ? yAxis.min[0] : yAxis && yAxis.min;
        const maxPixel = Number.isFinite(Number(max)) ? chart.convertToPixel({ yAxisIndex: 0 }, Number(max)) : null;
        const minPixel = Number.isFinite(Number(min)) ? chart.convertToPixel({ yAxisIndex: 0 }, Number(min)) : chart.convertToPixel({ yAxisIndex: 0 }, 0);

        if (Number.isFinite(maxPixel) && Number.isFinite(minPixel)) {
          top = Math.max(0, Math.min(maxPixel, minPixel));
          bottom = Math.min(element.clientHeight || bottom, Math.max(maxPixel, minPixel));
        }
      } catch (error) {
        top = 0;
        bottom = element.clientHeight || 0;
      }

      return {
        top: top,
        bottom: bottom,
        height: Math.max(0, bottom - top)
      };
    }

    function getSlotBounds(index, length) {
      const width = element.clientWidth || 0;
      let center = null;

      try {
        center = chart.convertToPixel({ xAxisIndex: 0 }, index);
      } catch (error) {
        center = null;
      }

      if (!Number.isFinite(center)) {
        return null;
      }

      let previous = null;
      let next = null;
      try {
        previous = index > 0 ? chart.convertToPixel({ xAxisIndex: 0 }, index - 1) : null;
        next = index < length - 1 ? chart.convertToPixel({ xAxisIndex: 0 }, index + 1) : null;
      } catch (error) {
        previous = null;
        next = null;
      }

      const defaultSlotWidth = width / Math.max(length, 1);
      const left = Number.isFinite(previous)
        ? (previous + center) / 2
        : center - (Number.isFinite(next) ? Math.abs(next - center) / 2 : defaultSlotWidth / 2);
      const right = Number.isFinite(next)
        ? (center + next) / 2
        : center + (Number.isFinite(previous) ? Math.abs(center - previous) / 2 : defaultSlotWidth / 2);

      return {
        left: Math.max(0, Math.min(left, width)),
        right: Math.max(0, Math.min(right, width))
      };
    }

    function showCurrent() {
      clearRestoreTimer();

      const now = new Date();
      const anchorDate = getDashboardNavigationDay(getAnchorDate());
      if (getRange() !== "day" || formatDashboardDateKey(anchorDate) !== formatDashboardDateKey(now)) {
        highlight.hidden = true;
        return;
      }

      const items = getItems();
      const index = getCurrentIndexValue(now);
      if (!Array.isArray(items) || index < 0 || index >= items.length) {
        highlight.hidden = true;
        return;
      }

      const slot = getSlotBounds(index, items.length);
      const bounds = getPlotBounds();
      if (!slot || slot.right <= 0 || slot.left >= (element.clientWidth || 0) || bounds.height <= 0) {
        highlight.hidden = true;
        return;
      }

      highlight.style.left = Math.round(slot.left) + "px";
      highlight.style.top = Math.round(bounds.top) + "px";
      highlight.style.width = Math.max(2, Math.round(slot.right - slot.left)) + "px";
      highlight.style.height = Math.round(bounds.height) + "px";
      highlight.hidden = false;
    }

    function hideTemporarily() {
      highlight.hidden = true;
      clearRestoreTimer();
      restoreTimer = window.setTimeout(showCurrent, restoreDelayMs);
    }

    function scheduleUpdate() {
      window.requestAnimationFrame(showCurrent);
    }

    element.addEventListener("mousemove", hideTemporarily);
    element.addEventListener("mouseleave", hideTemporarily);
    window.addEventListener("resize", scheduleUpdate);
    chart.on("datazoom", hideTemporarily);

    return {
      update: function () {
        scheduleUpdate();
      },
      hideTemporarily: hideTemporarily,
      dispose: function () {
        clearRestoreTimer();
        element.removeEventListener("mousemove", hideTemporarily);
        element.removeEventListener("mouseleave", hideTemporarily);
        window.removeEventListener("resize", scheduleUpdate);
        if (highlight.parentNode) {
          highlight.parentNode.removeChild(highlight);
        }
      }
    };
  }

  window.onRevoltCreateCurrentHourHighlighter = createOnRevoltEchartsCurrentHourHighlighter;

  function isDashboardForecastNavigationEnabled() {
    return !!window.dashboardReForecastEnabled;
  }

  function clampDashboardNavigationDate(date, range) {
    const candidate = getDashboardNavigationDay(date);
    if (isDashboardForecastNavigationEnabled()) {
      return candidate;
    }

    const limit = getDashboardNavigationLimitDate(range);
    return compareDashboardNavigationRange(candidate, limit, range) > 0 ? limit : candidate;
  }

  function shouldDisableDashboardNextRange(range, anchorDate) {
    if (isDashboardForecastNavigationEnabled()) {
      return false;
    }

    const nextDate = getDashboardNavigationShiftDate(anchorDate, range, 1);
    return compareDashboardNavigationRange(nextDate, getDashboardNavigationLimitDate(range), range) > 0;
  }

  function updateDashboardShiftButtons(buttons, range, anchorDate, attributeName) {
    (buttons || []).forEach(function (button) {
      const direction = Number(button.getAttribute(attributeName) || 0);
      const disabled = direction > 0 && shouldDisableDashboardNextRange(range, anchorDate);
      button.disabled = disabled;
      button.setAttribute("aria-disabled", disabled ? "true" : "false");
    });
  }

  window.dashboardDateNavigation = {
    today: function () {
      return getDashboardNavigationDay(new Date());
    },
    shiftDate: getDashboardNavigationShiftDate,
    clampDate: clampDashboardNavigationDate,
    updateShiftButtons: updateDashboardShiftButtons,
    shouldDisableNext: shouldDisableDashboardNextRange
  };

  function getDashboardInstallationTitle(payload) {
    const source = payload || window.dashboardLatestPayload || {};
    const account = source.account || {};
    return firstTextValue(
      account.locationLabel,
      account.locationName,
      account.address,
      account.adres,
      account.description,
      account.opis
    );
  }

  function updateDashboardDocumentTitle(payload) {
    const title = getDashboardInstallationTitle(payload);
    if (title) {
      document.title = title;
    }
  }

  function normalizeText(value) {
    if (typeof value !== "string") {
      return "";
    }

    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function normalizeDashboardCoordinate(value, min, max) {
    const numeric = firstFiniteNumber(value);
    if (numeric == null || numeric < min || numeric > max) {
      return null;
    }

    return numeric;
  }

  function getDashboardWeatherLocation(payload) {
    const source = payload || window.dashboardLatestPayload || {};
    const account = source.account || {};
    const rawEnergy = source.rawEnergy || source.energy || {};
    const latitude = normalizeDashboardCoordinate(firstFiniteNumber(
      account.lat,
      account.latitude,
      account.weatherLat,
      rawEnergy.lat,
      rawEnergy.latitude
    ), -90, 90);
    const longitude = normalizeDashboardCoordinate(firstFiniteNumber(
      account.lon,
      account.lng,
      account.longitude,
      account.weatherLon,
      rawEnergy.lon,
      rawEnergy.lng,
      rawEnergy.longitude
    ), -180, 180);

    if (latitude == null || longitude == null) {
      return Object.assign({}, DASHBOARD_WEATHER_LOCATION, {
        source: "fallback"
      });
    }

    return {
      label: firstTextValue(
        account.locationLabel,
        account.locationName,
        account.city,
        account.name,
        DASHBOARD_WEATHER_LOCATION.label
      ),
      latitude: latitude,
      longitude: longitude,
      timezone: firstTextValue(account.timezone, account.timeZone, DASHBOARD_WEATHER_LOCATION.timezone),
      source: "account"
    };
  }

  function getDashboardWeatherLocationKey(locationInput) {
    const location = locationInput || getDashboardWeatherLocation();
    const latitude = normalizeDashboardCoordinate(location.latitude, -90, 90);
    const longitude = normalizeDashboardCoordinate(location.longitude, -180, 180);

    if (latitude == null || longitude == null) {
      return "fallback";
    }

    return [
      latitude.toFixed(6),
      longitude.toFixed(6),
      firstTextValue(location.timezone, DASHBOARD_WEATHER_LOCATION.timezone)
    ].join("|");
  }

  function parseDashboardDateTime(value) {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    const text = String(value).trim();
    if (!text) {
      return null;
    }

    const normalized = text.indexOf("T") === -1 ? text.replace(" ", "T") : text;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function getDashboardLatestDataTime(payload) {
    const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
    const energy = payload && payload.energy ? payload.energy : {};
    const livePaths = payload && payload.livePaths ? payload.livePaths : {};

    return parseDashboardDateTime(firstTextValue(
      rawEnergy.datetime,
      rawEnergy.reading_time,
      rawEnergy.timestamp,
      energy.datetime,
      energy.reading_time,
      energy.timestamp,
      livePaths.datastats
    ));
  }

  function getDashboardPayloadAnchorDate(payload) {
    const usageData = payload && payload.usageData ? payload.usageData : null;
    const records = usageData && Array.isArray(usageData.records) ? usageData.records : [];
    const latestUsageDate = parseDashboardDateKey(firstTextValue(
      usageData && usageData.latestDate,
      records.length ? records[records.length - 1].date : null
    ));
    const latestDataTime = getDashboardLatestDataTime(payload);

    return latestUsageDate || latestDataTime || new Date();
  }

  function formatStaleDataTimestamp(date) {
    return timeFormatter.format(date) + " " + staleDataDateFormatter.format(date);
  }

  function getDashboardDataQualityIssues(payload) {
    const quality = payload && payload.dataQuality ? payload.dataQuality : null;
    const issues = quality && Array.isArray(quality.issues) ? quality.issues : [];
    return issues.filter(function (issue) {
      return issue && String(issue.severity || "").toLowerCase() !== "info";
    }).sort(function (left, right) {
      const leftKey = firstTextValue(left.to) || firstTextValue(left.from);
      const rightKey = firstTextValue(right.to) || firstTextValue(right.from);
      return rightKey.localeCompare(leftKey);
    });
  }

  function getDashboardDataQualityMessage(payload) {
    const issues = getDashboardDataQualityIssues(payload);
    if (!issues.length) {
      return "";
    }

    const latestIssue = issues[0] || {};
    const message = firstTextValue(latestIssue.message);
    const range = firstTextValue(latestIssue.from) && firstTextValue(latestIssue.to)
      ? " Zakres: " + firstTextValue(latestIssue.from) + " - " + firstTextValue(latestIssue.to) + "."
      : "";
    const suffix = issues.length > 1
      ? " Liczba wykrytych problemów: " + String(issues.length) + "."
      : "";

    return (message || "Wykryto problem z jakością danych pomiarowych.") + range + suffix;
  }

  function getProsumerSalePricePln(rcePricePln) {
    const price = asFiniteNumber(rcePricePln);
    const nominal = price == null ? null : Math.max(price, 0) * PROSUMER_SALE_PRICE_MULTIPLIER;
    return window.DashboardPricing ? window.DashboardPricing.settlementAmount(nominal) : nominal;
  }

  function normalizeDashboardDateKey(value) {
    if (value == null) {
      return "";
    }

    const text = String(value).trim();
    if (!text || text === "0000-00-00" || text === "0000-00-00 00:00:00") {
      return "";
    }

    const dateKey = text.slice(0, 10);
    const parsed = new Date(dateKey + "T00:00:00");
    return Number.isNaN(parsed.getTime()) ? "" : dateKey;
  }

  function formatDashboardDateKey(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, "0");
      const day = String(value.getDate()).padStart(2, "0");
      return year + "-" + month + "-" + day;
    }

    return normalizeDashboardDateKey(value);
  }

  function parseDashboardDateKey(value) {
    const dateKey = normalizeDashboardDateKey(value);
    if (!dateKey) {
      return null;
    }

    const parsed = new Date(dateKey + "T00:00:00");
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function getDashboardHistoryStartKey(payload) {
    const source = payload || window.dashboardLatestPayload || {};
    const account = source.account || {};
    const history = source.history || {};
    const rawEnergy = source.rawEnergy || source.energy || {};

    return normalizeDashboardDateKey(firstTextValue(
      account.dateStart,
      account.historyStart,
      history.startDate,
      history.historyStart,
      rawEnergy.dateStart,
      rawEnergy.historyStart
    ));
  }

  function getDashboardDepositStartPln(payload) {
    const source = payload || window.dashboardLatestPayload || {};
    const account = source.account || {};
    const history = source.history || {};
    const rawEnergy = source.rawEnergy || source.energy || {};
    const value = firstFiniteNumber(
      account.depositStartPln,
      account.depositStart,
      history.depositStartPln,
      history.depositStart,
      rawEnergy.depositStartPln,
      rawEnergy.depositStart,
      PROSUMER_DEPOSIT_INITIAL_PLN
    );

    const nominal = value == null ? 0 : Math.max(0, value);
    return window.DashboardPricing ? window.DashboardPricing.settlementAmount(nominal) : nominal;
  }

  function getDashboardStartOfDay(date) {
    const source = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    return new Date(source.getFullYear(), source.getMonth(), source.getDate());
  }

  function getDashboardStartOfWeek(date) {
    const start = getDashboardStartOfDay(date);
    const day = start.getDay();
    start.setDate(start.getDate() + (day === 0 ? -6 : 1 - day));
    return start;
  }

  function getDashboardRangeWindow(range, anchorDate) {
    const anchor = getDashboardStartOfDay(anchorDate);
    if (range === "week") {
      const start = getDashboardStartOfWeek(anchor);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return { start: start, end: end };
    }

    if (range === "month") {
      return {
        start: new Date(anchor.getFullYear(), anchor.getMonth(), 1),
        end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
      };
    }

    if (range === "year") {
      return {
        start: new Date(anchor.getFullYear(), 0, 1),
        end: new Date(anchor.getFullYear(), 11, 31)
      };
    }

    return { start: anchor, end: anchor };
  }

  function isDashboardSelectionBeforeHistoryStart(range, anchorDate, payload) {
    const historyStart = parseDashboardDateKey(getDashboardHistoryStartKey(payload));
    if (!historyStart) {
      return false;
    }

    const rangeWindow = getDashboardRangeWindow(range, anchorDate);
    return rangeWindow.end.getTime() < historyStart.getTime();
  }

  function filterDashboardRecordDataset(dataset, historyStartKey) {
    if (!dataset || !Array.isArray(dataset.records) || !historyStartKey) {
      return dataset || null;
    }

    const records = dataset.records.filter(function (record) {
      const dateKey = normalizeDashboardDateKey(record && record.date);
      return dateKey && dateKey >= historyStartKey;
    });

    if (records.length === dataset.records.length) {
      return dataset;
    }

    return Object.assign({}, dataset, {
      oldestDate: records.length ? records[0].date : null,
      latestDate: records.length ? records[records.length - 1].date : null,
      totalDays: records.length,
      records: records
    });
  }

  function applyDashboardHistoryFilter(payload) {
    const historyStartKey = getDashboardHistoryStartKey(payload);
    if (!payload || !historyStartKey) {
      return payload;
    }

    return Object.assign({}, payload, {
      usageData: filterDashboardRecordDataset(payload.usageData, historyStartKey),
      storageData: filterDashboardRecordDataset(payload.storageData, historyStartKey),
      pvData: filterDashboardRecordDataset(payload.pvData, historyStartKey),
      weatherData: filterDashboardRecordDataset(payload.weatherData, historyStartKey)
    });
  }

  window.getDashboardHistoryStartKey = getDashboardHistoryStartKey;
  window.getDashboardDepositStartPln = getDashboardDepositStartPln;
  window.isDashboardSelectionBeforeHistoryStart = isDashboardSelectionBeforeHistoryStart;
  window.getDashboardWeatherLocation = getDashboardWeatherLocation;
  window.getDashboardWeatherLocationKey = getDashboardWeatherLocationKey;

  function isMeasuredUsageDataset(usageData) {
    const source = usageData && typeof usageData.source === "string"
      ? usageData.source.toLowerCase()
      : "";

    if (
      source.indexOf("victron") !== -1 ||
      source.indexOf("measured") !== -1 ||
      source.indexOf("actual") !== -1
    ) {
      return true;
    }

    const records = usageData && Array.isArray(usageData.records) ? usageData.records : [];
    return records.some(function (record) {
      const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
      return quarters.some(function (quarter) {
        return firstFiniteNumber(
          quarter && quarter.gridNetKwh,
          quarter && quarter.gridImportKwh,
          quarter && quarter.gridExportKwh,
          quarter && quarter.storageDischargeKwh,
          quarter && quarter.storageChargeKwh,
          quarter && quarter.pvGenerationKwh,
          quarter && quarter.pvPowerW,
          quarter && quarter.storageSocPercent,
          quarter && quarter.storageLevelKwh
        ) != null;
      });
    });
  }

  function datasetHasRecords(dataset) {
    return Boolean(dataset && Array.isArray(dataset.records) && dataset.records.length);
  }

  function datasetHasAnyField(dataset, fields) {
    const records = dataset && Array.isArray(dataset.records) ? dataset.records : [];
    return records.some(function (record) {
      const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
      return quarters.some(function (quarter) {
        return fields.some(function (field) {
          return firstFiniteNumber(quarter && quarter[field]) != null;
        });
      });
    });
  }

  function resolveDashboardDataMode(payload) {
    const explicitMode = payload && typeof payload.dataMode === "string"
      ? payload.dataMode.toLowerCase()
      : "";

    if (
      explicitMode === DASHBOARD_DATA_MODE_REAL ||
      explicitMode === DASHBOARD_DATA_MODE_USAGE_ONLY ||
      explicitMode === DASHBOARD_DATA_MODE_DEMO
    ) {
      return explicitMode;
    }

    const usageData = payload && payload.usageData ? payload.usageData : null;
    const pvData = payload && payload.pvData ? payload.pvData : null;
    const storageData = payload && payload.storageData ? payload.storageData : null;
    const energy = payload && (payload.energy || payload.rawEnergy)
      ? (payload.energy || payload.rawEnergy)
      : {};
    const hasMeasuredUsage = isMeasuredUsageDataset(usageData);
    const hasRealPv = Boolean(
      energy.hasRealPvState ||
      datasetHasAnyField(pvData, ["productionKwh", "production", "powerW", "acPowerW"]) ||
      datasetHasAnyField(usageData, ["pvGenerationKwh", "pvPowerW"])
    );
    const hasRealStorage = Boolean(
      energy.hasRealStorageState ||
      datasetHasAnyField(storageData, ["energyKwh", "socPercent", "powerW", "chargePowerW", "dischargePowerW"]) ||
      datasetHasAnyField(usageData, ["storageLevelKwh", "storageSocPercent", "storageChargeKwh", "storageDischargeKwh", "storageNetKwh"])
    );

    if (hasMeasuredUsage && hasRealPv && hasRealStorage) {
      return DASHBOARD_DATA_MODE_REAL;
    }

    if (hasMeasuredUsage || (datasetHasRecords(usageData) && !payload.useRandomUsageData)) {
      return DASHBOARD_DATA_MODE_USAGE_ONLY;
    }

    return DASHBOARD_DATA_MODE_DEMO;
  }

  function getDashboardDataMode(payload) {
    return payload && payload.dataMode
      ? payload.dataMode
      : (window.dashboardDataMode || resolveDashboardDataMode(payload || window.dashboardLatestPayload || {}));
  }

  function isRealDashboardDataMode(payload) {
    return getDashboardDataMode(payload) === DASHBOARD_DATA_MODE_REAL;
  }

  function getQuarterPhysicalImportKwh(quarter) {
    return Math.max(0, firstFiniteNumber(
      quarter && quarter.gridImportKwh,
      quarter && quarter.importPhysical,
      quarter && quarter.gridPhysical,
      quarter && quarter.grid,
      0
    ) || 0);
  }

  function getQuarterPhysicalExportKwh(usageQuarter, pvQuarter) {
    const usageExport = Math.max(0, firstFiniteNumber(
      usageQuarter && usageQuarter.gridExportKwh,
      usageQuarter && usageQuarter.exportPhysical,
      usageQuarter && usageQuarter.salePhysical,
      usageQuarter && usageQuarter.exportKwh,
      usageQuarter && usageQuarter.sale,
      0
    ) || 0);
    const pvExport = Math.max(0, firstFiniteNumber(
      pvQuarter && pvQuarter.toGridKwh,
      pvQuarter && pvQuarter.grid,
      pvQuarter && pvQuarter.salePhysical,
      pvQuarter && pvQuarter.sale,
      0
    ) || 0);

    return Math.max(usageExport, pvExport);
  }

  function clampNumber(value, min, max) {
    if (value < min) {
      return min;
    }

    if (value > max) {
      return max;
    }

    return value;
  }

  function normalizeWeatherToken(value) {
    if (typeof value !== "string") {
      return "";
    }

    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function resolveWeatherIconKey(condition, options) {
    const normalized = normalizeWeatherToken(condition);
    const config = options || {};
    const isNight = Boolean(config.isNight);
    const cloudiness = typeof config.cloudiness === "number" ? config.cloudiness : null;
    const temperatureC = typeof config.temperatureC === "number" ? config.temperatureC : null;

    if (normalized.includes("hail") || normalized.includes("grad")) {
      return "hail";
    }

    if (
      normalized.includes("snow") ||
      normalized.includes("snieg") ||
      normalized.includes("sniezyca") ||
      normalized.includes("flurr")
    ) {
      return "snowy";
    }

    if (
      normalized.includes("rain") ||
      normalized.includes("shower") ||
      normalized.includes("deszcz") ||
      normalized.includes("mza") ||
      normalized.includes("m\u017c")
    ) {
      return "rainy";
    }

    if (normalized.includes("storm") || normalized.includes("burza")) {
      return "rainy";
    }

    if (normalized.includes("fog") || normalized.includes("mist") || normalized.includes("mgla")) {
      return "cloudy";
    }

    if (
      normalized.includes("partly") ||
      normalized.includes("przejas") ||
      normalized.includes("umiarkowane zachmurzenie") ||
      normalized.includes("lekko pochm")
    ) {
      if (cloudiness != null && cloudiness >= 0.58) {
        return isNight ? "partlyCloudyNightAlt" : "partlyCloudyDayAlt";
      }
      return isNight ? "partlyCloudyNight" : "partlyCloudyDay";
    }

    if (normalized.includes("cloud") || normalized.includes("pochm") || normalized.includes("zachmur")) {
      return cloudiness != null && cloudiness < 0.52
        ? (isNight ? "partlyCloudyNightAlt" : "partlyCloudyDayAlt")
        : "cloudy";
    }

    if (
      normalized.includes("clear") ||
      normalized.includes("sun") ||
      normalized.includes("slon") ||
      normalized.includes("bezchmurn")
    ) {
      return isNight ? "clearNight" : "clearDay";
    }

    if (temperatureC != null && temperatureC <= -1) {
      return "snowy";
    }

    if (cloudiness != null) {
      if (cloudiness <= 0.18) {
        return isNight ? "clearNight" : "clearDay";
      }
      if (cloudiness <= 0.52) {
        return isNight ? "partlyCloudyNight" : "partlyCloudyDay";
      }
    }

    return "cloudy";
  }

  function resolveWeatherIconPath(condition, options) {
    const iconKey = resolveWeatherIconKey(condition, options);

    return WEATHER_ICON_PATHS[iconKey] || WEATHER_ICON_PATHS.cloudy;
  }

  function describeWeatherCondition(condition, options) {
    const iconKey = resolveWeatherIconKey(condition, options);

    switch (iconKey) {
      case "clearNight":
        return "Bezchmurna noc";
      case "clearDay":
        return "S\u0142onecznie";
      case "partlyCloudyNight":
      case "partlyCloudyNightAlt":
        return "Nocne rozpogodzenia";
      case "partlyCloudyDay":
      case "partlyCloudyDayAlt":
        return "Cz\u0119\u015bciowe zachmurzenie";
      case "rainy":
        return "Deszcz";
      case "hail":
        return "Grad";
      case "snowy":
        return "\u015anieg";
      default:
        return "Pochmurnie";
    }
  }

  function getOpenMeteoWeatherConditionToken(weatherCode, cloudiness, precipitation, temperatureC) {
    const code = Math.round(firstFiniteNumber(weatherCode) == null ? -1 : Number(weatherCode));
    const rain = firstFiniteNumber(precipitation) || 0;

    if (code === 95 || code === 96 || code === 99) {
      return code === 99 ? "hail" : "rain";
    }

    if (
      code === 71 ||
      code === 73 ||
      code === 75 ||
      code === 77 ||
      code === 85 ||
      code === 86 ||
      (temperatureC != null && temperatureC <= 0.5 && rain >= 0.15)
    ) {
      return "snow";
    }

    if (
      code === 51 ||
      code === 53 ||
      code === 55 ||
      code === 56 ||
      code === 57 ||
      code === 61 ||
      code === 63 ||
      code === 65 ||
      code === 66 ||
      code === 67 ||
      code === 80 ||
      code === 81 ||
      code === 82 ||
      rain >= 0.15
    ) {
      return "rain";
    }

    if (code === 45 || code === 48 || code === 3) {
      return "cloudy";
    }

    if (code === 1 || code === 2 || (cloudiness != null && cloudiness >= 0.28 && cloudiness < 0.72)) {
      return "partly cloudy";
    }

    if (code === 0 || (cloudiness != null && cloudiness < 0.28)) {
      return "clear";
    }

    return "cloudy";
  }

  function getDashboardWeatherUrl(locationInput) {
    const location = locationInput || getDashboardWeatherLocation();
    const params = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      timezone: firstTextValue(location.timezone, DASHBOARD_WEATHER_LOCATION.timezone),
      models: DASHBOARD_WEATHER_MODEL,
      current: [
        "temperature_2m",
        "relative_humidity_2m",
        "weather_code",
        "cloud_cover",
        "wind_speed_10m",
        "wind_gusts_10m",
        "wind_direction_10m",
        "precipitation",
        "is_day"
      ].join(",")
    });

    return "https://api.open-meteo.com/v1/forecast?" + params.toString();
  }

  function normalizeDashboardOpenMeteoWeather(openMeteoData, locationInput) {
    const location = locationInput || getDashboardWeatherLocation();
    const current = openMeteoData && openMeteoData.current ? openMeteoData.current : {};
    const timestamp = firstTextValue(current.time);
    const parsedTime = parseDashboardDateTime(timestamp);
    const cloudCover = firstFiniteNumber(current.cloud_cover);
    const cloudiness = cloudCover == null ? null : clampNumber(cloudCover / 100, 0, 1);
    const temperatureC = firstFiniteNumber(current.temperature_2m);
    const precipitation = firstFiniteNumber(current.precipitation);
    const isDayValue = firstFiniteNumber(current.is_day);
    const isNight = isDayValue == null
      ? Boolean(parsedTime && (parsedTime.getHours() < 6 || parsedTime.getHours() >= 20))
      : isDayValue !== 1;
    const conditionToken = getOpenMeteoWeatherConditionToken(
      current.weather_code,
      cloudiness,
      precipitation,
      temperatureC
    );

    return {
      temperatureC: temperatureC,
      temperature_C: temperatureC,
      humidity: firstFiniteNumber(current.relative_humidity_2m),
      windAvgKmH: firstFiniteNumber(current.wind_speed_10m),
      windMaxKmH: firstFiniteNumber(current.wind_gusts_10m),
      windDirection: firstFiniteNumber(current.wind_direction_10m),
      rainMm: precipitation,
      precipitationMm: precipitation,
      cloudiness: cloudiness,
      cloudCover: cloudCover,
      condition: conditionToken,
      conditionLabel: describeWeatherCondition(conditionToken, {
        isNight: isNight,
        cloudiness: cloudiness,
        temperatureC: temperatureC
      }),
      isNight: isNight,
      reading_time: timestamp,
      datetime: timestamp,
      source: "open-meteo",
      sourceLabel: "Open-Meteo",
      locationLabel: firstTextValue(location.label, DASHBOARD_WEATHER_LOCATION.label),
      latitude: location.latitude,
      longitude: location.longitude
    };
  }

  window.dashboardWeatherAssets = {
    iconPaths: WEATHER_ICON_PATHS,
    resolveIconKey: resolveWeatherIconKey,
    resolveIconPath: resolveWeatherIconPath,
    describeCondition: describeWeatherCondition,
    clamp: clampNumber
  };

  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function formatSlashDate(date) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");

    return day + "/" + month + "/" + date.getFullYear();
  }

  function getDashboardRuntime() {
    const protocol = String(window.location.protocol || "").toLowerCase();
    if (protocol === "http:" || protocol === "https:") {
      return "web";
    }
    return "android";
  }

  function getDashboardWebConfig() {
    const params = new URLSearchParams(window.location.search || "");
    const body = document.body;
    const configuredApi = body ? body.getAttribute("data-dashboard-api") : "";
    const configuredStation = body ? body.getAttribute("data-dashboard-station") : "";
    const station = (params.get("station") || configuredStation || "").trim();
    const apiUrl = (params.get("api") || configuredApi || "/api/dashboard.php").trim();

    return {
      station: station,
      apiUrl: apiUrl
    };
  }

  function getDashboardApiUrl() {
    const runtime = window.dashboardRuntime || getDashboardRuntime();
    const config = getDashboardWebConfig();
    if (runtime !== "web") {
      return DASHBOARD_REMOTE_API_URL;
    }
    return new URL(config.apiUrl || "/api/dashboard.php", window.location.href).href;
  }

  function getDashboardStation(payload) {
    const config = getDashboardWebConfig();
    const source = payload || window.dashboardLatestPayload || {};
    const account = source.account || {};
    const energy = source.energy || {};
    const rawEnergy = source.rawEnergy || {};
    return firstTextValue(
      config.station,
      account.station,
      account.stationId,
      energy.station,
      energy.stationId,
      rawEnergy.station,
      rawEnergy.stationId
    );
  }

  function initModeratorStationSwitcher() {
    if (getDashboardRuntime() !== "web") {
      return;
    }

    const switcher = document.getElementById("station-switcher");
    const toggle = document.getElementById("station-switcher-toggle");
    const menu = document.getElementById("station-switcher-menu");
    if (!switcher || !toggle || !menu) {
      return;
    }
    const toggleLabel = toggle.querySelector("span");
    const detailLocationButtons = Array.from(document.querySelectorAll(".usage-detail .usage-pill--location"));
    const locationLabelMeasureContext = document.createElement("canvas").getContext("2d");

    let isReady = false;

    function setMenuOpen(open) {
      if (!isReady) {
        open = false;
      }
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      switcher.classList.toggle("is-open", open);
    }

    function switchDashboardStation(stationHash) {
      const hash = firstTextValue(stationHash);
      if (!hash) {
        return;
      }

      const url = new URL(window.location.href);
      url.searchParams.set("station", hash);
      window.location.assign(url.toString());
    }

    function renderStationList(stations) {
      menu.innerHTML = "";
      let currentLocationName = "";
      stations.forEach(function (station) {
        const hash = firstTextValue(station && station.stationHash);
        const locationLabel = firstTextValue(station && station.locationLabel, station && station.location);
        const label = firstTextValue(station && station.label, hash);
        if (!hash || !label) {
          return;
        }

        if (station.current && locationLabel) {
          currentLocationName = getStationLocationButtonLabel(locationLabel);
        }

        const item = document.createElement("button");
        item.type = "button";
        item.className = "station-switcher__item" + (station.current ? " is-current" : "");
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", station.current ? "true" : "false");
        item.dataset.stationHash = hash;

        const labelEl = document.createElement("span");
        labelEl.textContent = label;
        item.appendChild(labelEl);

        item.addEventListener("click", function () {
          if (station.current) {
            setMenuOpen(false);
            return;
          }
          switchDashboardStation(hash);
        });

        menu.appendChild(item);
      });

      isReady = menu.children.length > 0;
      switcher.classList.toggle("station-switcher--ready", isReady);
      updateLocationLabels(currentLocationName);
      if (!isReady) {
        setMenuOpen(false);
      }
    }

    function updateLocationLabels(currentLocationName) {
      if (currentLocationName) {
        if (toggleLabel) {
          toggleLabel.textContent = currentLocationName;
          toggle.setAttribute("aria-label", "Lokalizacja: " + currentLocationName);
          toggle.title = currentLocationName;
          fitStationLocationToggleLabel();
          window.requestAnimationFrame(fitStationLocationToggleLabel);
        }
        updateDetailLocationLabels(currentLocationName);
      }
    }

    function getStationLocationButtonLabel(locationLabel) {
      const label = firstTextValue(locationLabel);
      const separatorIndex = label.indexOf(" - ");
      if (separatorIndex > 0) {
        return label.slice(0, separatorIndex).trim();
      }
      return label;
    }

    function fitDetailLocationButtonLabel(button, label) {
      if (!button || !label || !locationLabelMeasureContext) {
        return;
      }

      const buttonStyle = window.getComputedStyle(button);
      const labelStyle = window.getComputedStyle(label);
      const icon = button.querySelector("svg");
      const iconStyle = icon ? window.getComputedStyle(icon) : null;
      const availableWidth = parseFloat(buttonStyle.width)
        - parseFloat(buttonStyle.paddingLeft)
        - parseFloat(buttonStyle.paddingRight)
        - (iconStyle ? parseFloat(iconStyle.width) : 0)
        - parseFloat(buttonStyle.columnGap || buttonStyle.gap || "0");
      const maxFontSize = 20;
      const minFontSize = 10;
      let fontSize = maxFontSize;

      label.style.fontSize = fontSize + "px";
      while (fontSize > minFontSize) {
        locationLabelMeasureContext.font = [
          labelStyle.fontStyle,
          labelStyle.fontWeight,
          fontSize + "px",
          labelStyle.fontFamily
        ].join(" ");
        if (locationLabelMeasureContext.measureText(label.textContent || "").width <= availableWidth) {
          break;
        }
        fontSize -= 1;
        label.style.fontSize = fontSize + "px";
      }
    }

    function updateDetailLocationLabels(locationName) {
      detailLocationButtons.forEach(function (button) {
        const label = button.querySelector("span");
        if (!label) {
          return;
        }
        label.textContent = locationName;
        button.setAttribute("aria-label", "Lokalizacja: " + locationName);
        button.title = locationName;
        fitDetailLocationButtonLabel(button, label);
      });
    }

    function fitStationLocationToggleLabel() {
      if (!toggleLabel) {
        return;
      }

      toggleLabel.style.fontSize = "";
      const maxFontSize = 20;
      const minFontSize = 10;
      let fontSize = maxFontSize;
      while (fontSize > minFontSize && toggleLabel.scrollWidth > toggleLabel.clientWidth) {
        fontSize -= 1;
        toggleLabel.style.fontSize = fontSize + "px";
      }
    }

    toggle.addEventListener("click", function (event) {
      if (!isReady) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(menu.hidden);
    });

    document.addEventListener("click", function (event) {
      if (!menu.hidden && !switcher.contains(event.target)) {
        setMenuOpen(false);
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !menu.hidden) {
        setMenuOpen(false);
        toggle.focus();
      }
    });

    function updateLocationFromPayload(payload) {
      const account = payload && payload.account;
      updateLocationLabels(getStationLocationButtonLabel(account && account.locationLabel));
    }

    document.addEventListener("dashboard:payload-updated", function (event) {
      updateLocationFromPayload(event && event.detail && event.detail.payload);
    });
    updateLocationFromPayload(window.dashboardLatestPayload);

    (async function loadStationList() {
      const config = getDashboardWebConfig();

      try {
        const url = new URL(config.apiUrl || "/api/dashboard.php", window.location.href);
        if (config.station) {
          url.searchParams.set("station", config.station);
        }
        url.searchParams.set("action", "station_list");
        url.searchParams.set("_ts", String(Date.now()));

        const response = await fetch(url.toString(), {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Accept": "application/json"
          }
        });
        const data = await response.json();
        if (!response.ok || !data || !data.allowed || !Array.isArray(data.stations)) {
          return;
        }

        renderStationList(data.stations);
      } catch (error) {
        console.warn("Station list unavailable:", error);
      }
    })();
  }

  function isDashboardReDemoStation(payload) {
    const station = getDashboardStation(payload);
    return String(station || "").trim() === "1";
  }

  function getDashboardReBaseUrl() {
    const runtime = window.dashboardRuntime || getDashboardRuntime();
    if (runtime !== "web") {
      return DASHBOARD_REMOTE_RE_BASE_URL;
    }
    return new URL("re/", window.location.href).href;
  }

  function reDelay(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function installDashboardReFetchPatch(baseUrl) {
    if (window.__dashboardReFetchPatched) {
      return;
    }
    const originalFetch = window.fetch ? window.fetch.bind(window) : null;
    if (!originalFetch) {
      return;
    }
    window.fetch = function (resource, init) {
      if (typeof resource === "string" && /^(get_dbdata|setup_func|GetRe)\.php(?:\?|$)/.test(resource)) {
        return originalFetch(new URL(resource, baseUrl).href, init);
      }
      return originalFetch(resource, init);
    };
    window.__dashboardReFetchPatched = true;
  }

  function loadDashboardReScript(src) {
    return new Promise(function (resolve, reject) {
      if (src.indexOf("chart.js") !== -1 && window.Chart) {
        resolve();
        return;
      }
      const existing = document.querySelector('script[data-dashboard-re-script="' + src.replace(/"/g, '\\"') + '"]');
      if (existing && existing.getAttribute("data-loaded") === "true") {
        resolve();
        return;
      }
      const script = existing || document.createElement("script");
      script.src = src;
      script.async = false;
      script.setAttribute("data-dashboard-re-script", src);
      script.onload = function () {
        script.setAttribute("data-loaded", "true");
        resolve();
      };
      script.onerror = function () {
        reject(new Error("Nie udało się załadować " + src));
      };
      if (!existing) {
        document.head.appendChild(script);
      }
    });
  }

  function rewriteDashboardReRelativeAssets(root, baseUrl) {
    root.querySelectorAll("[src]").forEach(function (element) {
      const value = element.getAttribute("src") || "";
      if (!value || /^(?:[a-z]+:|\/\/|data:|#)/i.test(value)) {
        return;
      }
      element.setAttribute("src", new URL(value, baseUrl).href);
    });
  }

  function stripDashboardReHiddenImages(root) {
    const hiddenRows = Array.from(root.querySelectorAll(":scope > tbody > tr")).slice(0, 2);
    hiddenRows.forEach(function (row) {
      row.querySelectorAll("img[src]").forEach(function (image) {
        image.dataset.removedSrc = image.getAttribute("src") || "";
        image.removeAttribute("src");
      });
    });
  }

  function getDashboardReDateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function roundDashboardReUp(value, step) {
    const numeric = firstFiniteNumber(value);
    if (numeric == null || numeric <= 0) {
      return numeric;
    }
    return Math.ceil(numeric / step) * step;
  }

  function sumDashboardReUsageRecordKwh(record) {
    const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
    return quarters.reduce(function (sum, quarter) {
      return sum + Math.max(0, firstFiniteNumber(
        quarter && quarter.totalLoadKwh,
        quarter && quarter.load,
        quarter && quarter.usageKwh,
        quarter && quarter.usage
      ) || 0);
    }, 0);
  }

  function firstConfiguredStorageSizeKwh() {
    for (const value of arguments) {
      if (value == null || String(value).trim() === "") continue;
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric >= 0) return numeric;
    }
    return null;
  }

  function getDashboardManualStorageSizeKwh(payload) {
    const station = getDashboardStation(payload);
    const key = "onrevolt.installationSettings.v1" + (station ? ".station." + station : "");
    try {
      const saved = JSON.parse(window.localStorage.getItem(key) || "{}");
      return firstConfiguredStorageSizeKwh(saved.storageSizeKwh);
    } catch (error) {
      return null;
    }
  }

  function getDashboardReInputFromPayload(payload) {
    const account = payload && payload.account ? payload.account : {};
    const energy = payload && payload.energy ? payload.energy : {};
    const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
    const settings = account && account.tariffSettings && typeof account.tariffSettings === "object"
      ? account.tariffSettings
      : {};
    const current = settings.current && typeof settings.current === "object" ? settings.current : {};
    const target = settings.target && typeof settings.target === "object" ? settings.target : {};
    const tariffData = payload && payload.tariffData ? payload.tariffData : {};
    const nextTariff = tariffData.next || {};

    let annualUsageKwh = firstFiniteNumber(
      account.annualUsageKwh,
      account.annualConsumptionKwh,
      energy.annualUsageKwh,
      energy.annualConsumptionKwh,
      rawEnergy.annualUsageKwh,
      rawEnergy.annualConsumptionKwh
    );
    if (annualUsageKwh == null || annualUsageKwh <= 0) {
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const records = usageData && Array.isArray(usageData.records) ? usageData.records : [];
      const todayKey = getDashboardReDateKey(new Date());
      const completeRecords = records.filter(function (record) {
        return record && typeof record.date === "string" && record.date < todayKey;
      });
      const sourceRecords = completeRecords.length ? completeRecords : records;
      const dailyTotals = sourceRecords.map(sumDashboardReUsageRecordKwh).filter(function (value) {
        return value > 0;
      });
      if (dailyTotals.length) {
        annualUsageKwh = (dailyTotals.reduce(function (sum, value) { return sum + value; }, 0) / dailyTotals.length) * 365;
      }
    }

    const manualPvKwp = firstFiniteNumber(account.pvSizeKwp, account.pvKwp, account.pvPowerKwp);
    let pvKwp = manualPvKwp != null
      ? manualPvKwp
      : firstFiniteNumber(
        energy.installedPowerKw,
        energy.installationPowerKw,
        energy.mocInstalacjiKw,
        rawEnergy.installedPowerKw,
        rawEnergy.installationPowerKw,
        rawEnergy.mocInstalacjiKw
      );
    if ((pvKwp == null || pvKwp <= 0) && manualPvKwp == null) {
      const pvData = payload && payload.pvData ? payload.pvData : null;
      const records = pvData && Array.isArray(pvData.records) ? pvData.records : [];
      let maxPowerW = 0;
      records.forEach(function (record) {
        const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
        quarters.forEach(function (quarter) {
          const power = firstFiniteNumber(
            quarter && quarter.powerW,
            quarter && quarter.acPowerW,
            quarter && quarter.dcPowerW,
            quarter && quarter.pvPowerW,
            quarter && quarter.productionPowerW
          );
          if (power != null) {
            maxPowerW = Math.max(maxPowerW, power);
          }
        });
      });
      pvKwp = maxPowerW > 0 ? maxPowerW / 1000 : null;
    }
    if ((pvKwp == null || pvKwp <= 0) && isDashboardReDemoStation(payload)) {
      pvKwp = 5;
    }

    let storageKwh = firstConfiguredStorageSizeKwh(
      energy.batteryCapacityKwh,
      energy.storageCapacityKwh,
      rawEnergy.batteryCapacityKwh,
      rawEnergy.storageCapacityKwh,
      rawEnergy.capacityKwh,
      account.storageKwh,
      account.storageCapacityKwh,
      account.batteryCapacityKwh,
      getDashboardManualStorageSizeKwh(payload)
    );
    if (storageKwh == null) {
      const storageData = payload && payload.storageData ? payload.storageData : null;
      const records = storageData && Array.isArray(storageData.records) ? storageData.records : [];
      for (let recordIndex = records.length - 1; recordIndex >= 0; recordIndex -= 1) {
        const quarters = records[recordIndex] && Array.isArray(records[recordIndex].quarters) ? records[recordIndex].quarters : [];
        for (let quarterIndex = quarters.length - 1; quarterIndex >= 0; quarterIndex -= 1) {
          const capacity = firstFiniteNumber(quarters[quarterIndex] && quarters[quarterIndex].capacityKwh);
          if (capacity != null && capacity > 0) {
            storageKwh = capacity;
            break;
          }
        }
        if (storageKwh != null && storageKwh > 0) {
          break;
        }
      }
    }
    if (storageKwh == null && isDashboardReDemoStation(payload)) {
      storageKwh = 16;
    }

    return {
      annualUsageKwh: annualUsageKwh,
      pvKwp: manualPvKwp != null ? manualPvKwp : roundDashboardReUp(pvKwp, 1),
      storageKwh: storageKwh == null ? null : roundDashboardReUp(storageKwh, 1),
      contractPowerKw: firstFiniteNumber(current.contractPowerKw, current.contract_power_kw, settings.contractPowerKw, account.contractPowerKw),
      billingCycleMonths: firstFiniteNumber(current.billingCycleMonths, current.billing_cycle_months, settings.billingCycleMonths, account.billingCycleMonths, 1),
      lat: firstFiniteNumber(account.lat, account.latitude, rawEnergy.lat, rawEnergy.latitude),
      lon: firstFiniteNumber(account.lon, account.lng, account.longitude, rawEnergy.lon, rawEnergy.lng, rawEnergy.longitude),
      locationLabel: firstTextValue(account.locationLabel, account.locationName, account.name),
      providerId: firstFiniteNumber(target.osdId, account.tariffTargetOsdId, nextTariff.osd_id),
      providerLabel: firstTextValue(target.operator, target.provider, target.osdName, nextTariff.provider, nextTariff.osd_name, tariffData.provider),
      tariffId: firstFiniteNumber(target.tariffId, account.tariffTargetTariffId, nextTariff.tariff_id, nextTariff.id),
      tariffLabel: firstTextValue(
        target.code && target.name ? target.code + " — " + target.name : "",
        nextTariff.code && nextTariff.name ? nextTariff.code + " — " + nextTariff.name : "",
        target.code,
        nextTariff.code
      )
    };
  }

  function hasDashboardReBasePayload(payload) {
    const input = getDashboardReInputFromPayload(payload || {});
    return input.lat != null &&
      input.lon != null &&
      input.providerId != null &&
      input.tariffId != null &&
      input.annualUsageKwh != null &&
      input.annualUsageKwh > 0 &&
      input.pvKwp != null &&
      input.pvKwp >= 0;
  }

  function hasDashboardRePayload(payload) {
    const input = getDashboardReInputFromPayload(payload || {});
    return hasDashboardReBasePayload(payload) &&
      input.storageKwh != null &&
      input.storageKwh >= 0;
  }

  function rememberDashboardRePayload(payload) {
    if (hasDashboardRePayload(payload)) {
      window.dashboardReForecastPayload = payload;
      return payload;
    }

    return null;
  }

  function resolveDashboardRePayload(payload) {
    const source = payload || window.dashboardLatestPayload || {};
    const remembered = window.dashboardReForecastPayload || null;

    return rememberDashboardRePayload(source) ||
      (hasDashboardRePayload(remembered) ? remembered : null) ||
      source;
  }

  function resolveDashboardReBasePayload(payload) {
    const source = payload || window.dashboardLatestPayload || {};
    const remembered = window.dashboardReForecastPayload || null;

    return hasDashboardReBasePayload(source)
      ? source
      : (hasDashboardReBasePayload(remembered) ? remembered : null);
  }

  async function fetchDashboardRePayloadFromApi() {
    if (window.__dashboardWebHistoryPayloadPromise && typeof window.__dashboardWebHistoryPayloadPromise.then === "function") {
      return window.__dashboardWebHistoryPayloadPromise;
    }
    if (typeof window.__dashboardFetchWebHistoryPayload === "function") {
      return window.__dashboardFetchWebHistoryPayload();
    }
    throw new Error("Miesięczne dane dashboardu nie zostały jeszcze uruchomione.");
  }

  async function waitForDashboardRePayload(options) {
    const waitOptions = options || {};
    const timeoutMs = Number(waitOptions.timeoutMs);
    const waitLimitMs = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DASHBOARD_RE_PAYLOAD_WAIT_MS;
    const allowApiFallback = waitOptions.allowApiFallback !== false;
    const requireStorage = waitOptions.requireStorage !== false;
    const hasRequiredPayload = requireStorage ? hasDashboardRePayload : hasDashboardReBasePayload;
    const rememberRequiredPayload = requireStorage
      ? rememberDashboardRePayload
      : function (payload) {
        rememberDashboardRePayload(payload);
        return payload;
      };
    const startedAt = Date.now();
    while (Date.now() - startedAt < waitLimitMs) {
      if (hasRequiredPayload(window.dashboardLatestPayload)) {
        return rememberRequiredPayload(window.dashboardLatestPayload);
      }
      if (hasRequiredPayload(window.dashboardReForecastPayload)) {
        return window.dashboardReForecastPayload;
      }
      await reDelay(150);
    }
    if ((window.dashboardRuntime || getDashboardRuntime()) === "android") {
      while (true) {
        if (hasRequiredPayload(window.dashboardLatestPayload)) {
          return rememberRequiredPayload(window.dashboardLatestPayload);
        }
        if (hasRequiredPayload(window.dashboardReForecastPayload)) {
          return window.dashboardReForecastPayload;
        }
        await reDelay(300);
      }
    }
    if (!allowApiFallback) {
      while (true) {
        if (hasRequiredPayload(window.dashboardLatestPayload)) {
          return rememberRequiredPayload(window.dashboardLatestPayload);
        }
        if (hasRequiredPayload(window.dashboardReForecastPayload)) {
          return window.dashboardReForecastPayload;
        }
        await reDelay(300);
      }
    }
    const payload = await fetchDashboardRePayloadFromApi();
    if (!hasRequiredPayload(payload)) {
      throw new Error("Brak lokalizacji w danych dashboardu.");
    }
    return rememberRequiredPayload(payload);
  }

  function ensureDashboardReOption(select, value, label) {
    if (!select || value == null || value === "") {
      return false;
    }
    const stringValue = String(value);
    let option = Array.from(select.options || []).find(function (candidate) {
      return candidate.value === stringValue;
    });
    if (!option && label) {
      option = document.createElement("option");
      option.value = stringValue;
      option.textContent = label;
      select.appendChild(option);
    }
    if (!option) {
      return false;
    }
    select.value = stringValue;
    return true;
  }

  async function waitForDashboardReOption(select, value, timeoutMs) {
    const startedAt = Date.now();
    const stringValue = value == null ? "" : String(value);
    while (select && stringValue && Date.now() - startedAt < timeoutMs) {
      if (Array.from(select.options || []).some(function (option) { return option.value === stringValue; })) {
        return true;
      }
      await reDelay(100);
    }
    return false;
  }

  async function syncDashboardReControls(payload) {
    const input = getDashboardReInputFromPayload(payload || {});
    const debugSection = document.getElementById("dashboard-re-native");
    if (debugSection) {
      debugSection.dataset.reAnnualUsage = input.annualUsageKwh == null ? "" : String(input.annualUsageKwh);
      debugSection.dataset.rePvKwp = input.pvKwp == null ? "" : String(input.pvKwp);
      debugSection.dataset.reStorageKwh = input.storageKwh == null ? "" : String(input.storageKwh);
      debugSection.dataset.reLat = input.lat == null ? "" : String(input.lat);
      debugSection.dataset.reLon = input.lon == null ? "" : String(input.lon);
    }
    const annualInput = document.getElementById("annualUsage");
    const pvInput = document.getElementById("pvPower");
    const bankSelect = document.getElementById("bankV");
    const bankCheckbox = document.getElementById("bankEnergy");
    const pvCheckbox = document.getElementById("cPV");
    const addressInput = document.getElementById("addrInput");
    const contractPowerInput = document.getElementById("contractPowerKw");
    const billingCycleSelect = document.getElementById("billingCycleMonths");
    const providerSelect = document.getElementById("providerSelect");
    const tariffSelect = document.getElementById("tariffShort");

    if (annualInput && input.annualUsageKwh != null) {
      annualInput.value = String(Math.round(input.annualUsageKwh));
    }
    if (pvInput && input.pvKwp != null) {
      pvInput.value = String(Math.round(input.pvKwp * 1000));
    }
    if (pvCheckbox && input.pvKwp != null) {
      pvCheckbox.checked = input.pvKwp > 0;
    }
    if (bankSelect && input.storageKwh != null) {
      ensureDashboardReOption(bankSelect, input.storageKwh, Math.round(input.storageKwh) + " kWh");
      bankSelect.value = String(input.storageKwh);
    }
    if (bankCheckbox && input.storageKwh != null) {
      bankCheckbox.checked = input.storageKwh > 0;
    }
    if (addressInput) {
      addressInput.value = input.locationLabel || (
        input.lat != null && input.lon != null ? String(input.lat).replace(".", ",") + ", " + String(input.lon).replace(".", ",") : ""
      );
    }

    if (contractPowerInput && input.contractPowerKw != null && input.contractPowerKw > 0) {
      contractPowerInput.value = String(input.contractPowerKw);
    }
    if (billingCycleSelect && input.billingCycleMonths != null) {
      const billingValue = String(Math.round(input.billingCycleMonths));
      if (Array.from(billingCycleSelect.options || []).some(function (option) { return option.value === billingValue; })) billingCycleSelect.value = billingValue;
    }

    if (providerSelect && input.providerId != null) {
      await waitForDashboardReOption(providerSelect, input.providerId, 5000);
      if (ensureDashboardReOption(providerSelect, input.providerId, input.providerLabel)) {
        providerSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    if (tariffSelect && input.tariffId != null) {
      await waitForDashboardReOption(tariffSelect, input.tariffId, 5000);
      if (ensureDashboardReOption(tariffSelect, input.tariffId, input.tariffLabel)) {
        tariffSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    const bridge = window.__dashboardReBridge || {};
    const refreshTariffState = bridge.refreshTariffDerivedState || (typeof refreshTariffDerivedState === "function"
      ? refreshTariffDerivedState
      : window.refreshTariffDerivedState);
    const recalc = bridge.calc || (typeof calc === "function" ? calc : window.calc);
    if (typeof refreshTariffState === "function") {
      await refreshTariffState({ reloadCurrentTariff: true });
    } else if (typeof recalc === "function") {
      recalc();
    }
  }

  function getDashboardReStartDate() {
    const fn = window.getReDataStartDate || (typeof getReDataStartDate === "function" ? getReDataStartDate : null);
    return typeof fn === "function" ? fn() : window.REVOLT_DATA_START_DATE;
  }

  function getDashboardReEndDate() {
    const fn = window.getReDataEndDate || (typeof getReDataEndDate === "function" ? getReDataEndDate : null);
    return typeof fn === "function" ? fn() : window.REVOLT_DATA_END_DATE;
  }

  function addYearsToDashboardReDate(dateKey, years) {
    const date = parseDashboardDateKey(dateKey);
    if (!date) {
      return "";
    }
    date.setFullYear(date.getFullYear() + years);
    return formatDashboardDateKey(date);
  }

  function applyDashboardReDateRangeFromPayload(payload) {
    const startDate = getDashboardHistoryStartKey(payload);
    if (!startDate) {
      return;
    }

    window.REVOLT_DATA_START_DATE = startDate;
    window.REVOLT_DATA_END_DATE = addYearsToDashboardReDate(startDate, 1);
    window.REVOLT_DEPOSIT_START_PLN = getDashboardDepositStartPln(payload);
  }

  async function loadDashboardReData(payload) {
    const input = getDashboardReInputFromPayload(payload || {});
    const debugSection = document.getElementById("dashboard-re-native");
    const startDate = getDashboardReStartDate();
    const endDate = getDashboardReEndDate();
    const dataKey = [input.lat, input.lon, startDate, endDate].join("|");
    if (window.__dashboardReDataKey === dataKey && window.rdn && window.rce && window.pv && window.wind) {
      return;
    }
    const bridge = window.__dashboardReBridge || {};
    const fetchRdn = bridge.fetchSeriesRDN || (typeof fetchSeriesRDN === "function" ? fetchSeriesRDN : window.fetchSeriesRDN);
    const applyRdn = bridge.applyRDN || (typeof applyRDN === "function" ? applyRDN : window.applyRDN);
    const fetchRdnExact = bridge.fetchSeriesRDNExact || (typeof fetchSeriesRDNExact === "function" ? fetchSeriesRDNExact : window.fetchSeriesRDNExact);
    const applyRdnExact = bridge.applyRDNExact || (typeof applyRDNExact === "function" ? applyRDNExact : window.applyRDNExact);
    const fetchRce = bridge.fetchSeriesRCE || (typeof fetchSeriesRCE === "function" ? fetchSeriesRCE : window.fetchSeriesRCE);
    const applyRce = bridge.applyRCE || (typeof applyRCE === "function" ? applyRCE : window.applyRCE);
    const fetchRceExact = bridge.fetchSeriesRCEExact || (typeof fetchSeriesRCEExact === "function" ? fetchSeriesRCEExact : window.fetchSeriesRCEExact);
    const applyRceExact = bridge.applyRCEExact || (typeof applyRCEExact === "function" ? applyRCEExact : window.applyRCEExact);
    const fetchWeatherSeries = bridge.fetchSeries || (typeof fetchSeries === "function" ? fetchSeries : window.fetchSeries);
    const applyPvData = bridge.applyPV || (typeof applyPV === "function" ? applyPV : window.applyPV);
    const applyWindData = bridge.applyWind || (typeof applyWind === "function" ? applyWind : window.applyWind);
    if (typeof fetchRdn === "function" && typeof applyRdn === "function") {
      const rdnData = await fetchRdn("rdn", startDate, endDate);
      applyRdn(rdnData);
      if (typeof fetchRdnExact === "function" && typeof applyRdnExact === "function") {
        const rdnExactData = await fetchRdnExact("rdn", startDate, endDate);
        applyRdnExact(rdnExactData);
      }
    }
    if (typeof fetchRce === "function" && typeof applyRce === "function") {
      const rceData = await fetchRce("rce", startDate, endDate);
      applyRce(rceData);
      if (typeof fetchRceExact === "function" && typeof applyRceExact === "function") {
        const rceExactData = await fetchRceExact("rce", startDate, endDate);
        applyRceExact(rceExactData);
      }
    }
    if (input.lat == null || input.lon == null) {
      throw new Error("Brak lokalizacji do pobrania danych PV i wiatru.");
    }
    if (typeof fetchWeatherSeries === "function" && typeof applyPvData === "function" && typeof applyWindData === "function") {
      const windAndPv = await Promise.all([
        fetchWeatherSeries("wind", input.lat, input.lon, startDate, endDate),
        fetchWeatherSeries("pv", input.lat, input.lon, startDate, endDate)
      ]);
      applyWindData(windAndPv[0]);
      applyPvData(windAndPv[1]);
      if (debugSection) {
        debugSection.dataset.reRdnLoaded = window.rdn && Array.isArray(window.rdn) ? String(window.rdn.length) : "set";
        debugSection.dataset.reRceLoaded = window.rce && Array.isArray(window.rce) ? String(window.rce.length) : "set";
        debugSection.dataset.reWindLoaded = String(Array.isArray(windAndPv[0]) ? windAndPv[0].length : 0);
        debugSection.dataset.rePvLoaded = String(Array.isArray(windAndPv[1]) ? windAndPv[1].length : 0);
      }
    }
    window.__dashboardReDataKey = dataKey;
  }

  function getDashboardReForecastRange(payload) {
    const startKey = getDashboardHistoryStartKey(payload) || "2026-05-01";
    const startDate = parseDashboardDateKey(startKey);
    if (!startDate) {
      return null;
    }

    const yearEnd = new Date(new Date().getFullYear(), 11, 31);
    if (startDate.getTime() > yearEnd.getTime()) {
      yearEnd.setFullYear(startDate.getFullYear());
    }

    const coverageEnd = new Date(yearEnd.getFullYear() + 1, 11, 31);
    const endKey = formatDashboardDateKey(yearEnd);
    const coverageEndKey = formatDashboardDateKey(coverageEnd);
    const dayMs = 24 * 60 * 60 * 1000;
    const days = Math.max(1, Math.round((yearEnd.getTime() - startDate.getTime()) / dayMs) + 1);
    const coverageDays = Math.max(1, Math.round((coverageEnd.getTime() - startDate.getTime()) / dayMs) + 1);

    return {
      startKey: formatDashboardDateKey(startDate),
      endKey: endKey,
      days: days,
      coverageEndKey: coverageEndKey,
      coverageDays: coverageDays
    };
  }

  function getDashboardReForecastInitialSocKwh(payload) {
    const energy = payload && payload.energy ? payload.energy : {};
    const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
    return firstFiniteNumber(
      energy.batteryKwh,
      energy.batteryLevelKwh,
      energy.storageKwh,
      energy.storageLevelKwh,
      rawEnergy.batteryKwh,
      rawEnergy.batteryLevelKwh,
      rawEnergy.storageKwh,
      rawEnergy.storageLevelKwh,
      0
    ) || 0;
  }

  function getDashboardReActualCutoffKey(payload) {
    const raw = String(payload && payload.rawEnergy && payload.rawEnergy.datetime || "").trim();
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2})/);
    return match ? match[1] + "T" + match[2] : "";
  }

  function getDashboardReForecastRequest(payload) {
    const input = getDashboardReInputFromPayload(payload || {});
    const range = getDashboardReForecastRange(payload || {});
    if (!range || input.providerId == null || input.tariffId == null || input.lat == null || input.lon == null) {
      return null;
    }

    const url = new URL("GetRe.php", getDashboardReBaseUrl());
    const station = getDashboardStation(payload);
    const actualCutoffKey = getDashboardReActualCutoffKey(payload || {});
    const params = {
      station: station || "",
      provider: Math.round(input.providerId),
      tariff: Math.round(input.tariffId),
      annualUsageKWh: Math.max(0, Math.round(input.annualUsageKwh || 0)),
      kWp: Math.max(0, input.pvKwp || 0),
      chkPV: input.pvKwp > 0 ? 1 : 0,
      chkWind: 0,
      chkSell: 1,
      chkBank: input.storageKwh > 0 ? 1 : 0,
      windV: 0,
      bankV: Math.max(0, input.storageKwh || 0),
      from: range.startKey,
      to: range.coverageEndKey || range.endKey,
      days: range.coverageDays || range.days,
      initialSocKWh: getDashboardReForecastInitialSocKwh(payload || {}),
      initialDepositPln: getDashboardDepositStartPln(payload || {}),
      lat: input.lat,
      lon: input.lon,
      includeHourly: 1
    };

    Object.keys(params).forEach(function (key) {
      url.searchParams.set(key, String(params[key]));
    });

    return {
      input: input,
      range: range,
      url: url,
      key: [
        station || "",
        params.provider,
        params.tariff,
        params.annualUsageKWh,
        params.kWp,
        params.bankV,
        params.initialSocKWh,
        params.initialDepositPln,
        params.lat,
        params.lon,
        params.from,
        params.to,
        params.days,
        actualCutoffKey,
        window.DashboardPricing ? window.DashboardPricing.cacheKey : "legacy"
      ].join("|")
    };
  }

  function waitForDashboardReHybridRuntime() {
    if (window.__dashboardReFullAppReady && typeof window.runDashboardReHybridForecast === "function") {
      return Promise.resolve();
    }

    return new Promise(function (resolve, reject) {
      let settled = false;
      const timeoutId = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        document.removeEventListener("dashboard:re-native-ready", onReady);
        reject(new Error("Silnik Re nie został załadowany."));
      }, 60000);

      function onReady() {
        if (settled || typeof window.runDashboardReHybridForecast !== "function") return;
        settled = true;
        window.clearTimeout(timeoutId);
        document.removeEventListener("dashboard:re-native-ready", onReady);
        resolve();
      }

      document.addEventListener("dashboard:re-native-ready", onReady);
      onReady();
    });
  }

  async function runDashboardReForecastLocally(payload, request) {
    await waitForDashboardReHybridRuntime();
    applyDashboardReActualData(payload || {});

    await syncDashboardReControls(payload || {});

    await new Promise(function (resolve) {
      window.requestAnimationFrame(function () {
        window.setTimeout(resolve, 0);
      });
    });

    const result = window.runDashboardReHybridForecast({
      startDateStr: request.range.startKey,
      days: request.range.coverageDays || request.range.days,
      annualUsageKWh: Math.max(0, Number(request.input.annualUsageKwh) || 0),
      kWp: Math.max(0, Number(request.input.pvKwp) || 0),
      initialSocKWh: getDashboardReForecastInitialSocKwh(payload || {}),
      initialDepositPln: getDashboardDepositStartPln(payload || {}),
      pvOffsetHours: 0,
      includeHourly: true
    });

    return { ok: true, data: result };
  }

  function sumDashboardForecastTotals(target, source) {
    if (!source || typeof source !== "object") {
      return;
    }

    Object.keys(source).forEach(function (key) {
      const value = source[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        target[key] = (target[key] || 0) + value;
        return;
      }

      if (key === "dischargeByZone" && value && typeof value === "object") {
        target.dischargeByZone = target.dischargeByZone || {};
        Object.keys(value).forEach(function (zoneKey) {
          const zoneValue = Number(value[zoneKey]);
          if (Number.isFinite(zoneValue)) {
            target.dischargeByZone[zoneKey] = (target.dischargeByZone[zoneKey] || 0) + zoneValue;
          }
        });
      }
    });
  }

  function buildDashboardReForecastDataset(days, field) {
    return {
      source: "re-forecast",
      latestDate: days.length ? days[days.length - 1].dateKey : "",
      totalDays: days.length,
      records: days.map(function (day) {
        const entries = Array.isArray(day.slots) && day.slots.length
          ? day.slots
          : (Array.isArray(day.hours) ? day.hours : []);
        return {
          date: day.dateKey,
          quarters: entries.map(function (slot) {
            if (field === "pv") {
              const load = Number(slot.load != null ? slot.load : (slot.demandKwh || 0));
              const generation = Number(slot.pvGenerationKwh != null ? slot.pvGenerationKwh : (slot.generationKwh || 0));
              const gridForLoad = Number(slot.gridBuyLoad != null ? slot.gridBuyLoad : (slot.gridPurchaseForLoadKwh || 0));
              const totalExport = firstFiniteNumber(slot.billedGridExportKwh, slot.exportKwh, 0) || 0;
              const bankExport = firstFiniteNumber(
                slot.soldBankKwh,
                slot.bankToSellKwh,
                slot.dischargeToGridKwh,
                slot.storageToGridKwh,
                slot.batteryToGridKwh,
                0
              ) || 0;
              const soldImmediate = Math.max(0, firstFiniteNumber(
                slot.billedSoldImmediateKwh,
                slot.soldImmediateKwh,
                slot.pvToGridKwh,
                slot.toGridKwh,
                totalExport - bankExport
              ) || 0);
              const pvToLoad = Number(slot.pvToLoad != null ? slot.pvToLoad : Math.min(load, generation));
              const pvToBank = Number(slot.pvToBank != null ? slot.pvToBank : Math.max(0, generation - pvToLoad - soldImmediate));
              return {
                hour: slot.hour,
                quarter: slot.quarter || 0,
                productionKwh: generation,
                generationKwh: generation,
                selfUseKwh: pvToLoad,
                hourlyBalanceKwh: pvToBank,
                saleKwh: Math.min(soldImmediate, Math.max(0, generation)),
                isForecast: slot.isForecast !== false
              };
            }

            const load = Number(slot.load != null ? slot.load : (slot.demandKwh || 0));
            const generation = Number(slot.pvGenerationKwh != null ? slot.pvGenerationKwh : (slot.generationKwh || 0));
            const gridForLoad = Number(slot.billedGridPurchaseForLoadKwh != null
              ? slot.billedGridPurchaseForLoadKwh
              : (slot.gridBuyLoad != null ? slot.gridBuyLoad : (slot.gridPurchaseForLoadKwh || 0)));
            const pvToLoad = Number(slot.pvToLoad != null ? slot.pvToLoad : Math.min(load, generation));
            const bankToLoad = Number(slot.bankToLoad != null ? slot.bankToLoad : Math.max(0, load - pvToLoad - gridForLoad));
            return {
              hour: slot.hour,
              quarter: slot.quarter || 0,
              totalLoadKwh: load,
              usageKwh: load,
              pvKwh: pvToLoad,
              storageKwh: bankToLoad,
              gridKwh: gridForLoad,
              isForecast: slot.isForecast !== false
            };
          })
        };
      })
    };
  }

  function buildDashboardReForecastSimulation(apiData, payload, request) {
    const data = apiData && apiData.data ? apiData.data : apiData;
    const days = data && Array.isArray(data.days)
      ? data.days.filter(function (day) { return day && day.dateKey; })
      : [];
    const dayMap = {};
    days.forEach(function (day) {
      if (typeof day.isForecast !== "boolean") day.isForecast = true;
      if (Array.isArray(day.hours)) {
        day.hours.forEach(function (hour) {
          if (hour && typeof hour.isForecast !== "boolean") hour.isForecast = true;
        });
      }
      if (Array.isArray(day.slots)) {
        day.slots.forEach(function (slot) {
          if (slot && typeof slot.isForecast !== "boolean") slot.isForecast = true;
        });
      }
      dayMap[day.dateKey] = day;
    });

    const capacityKwh = firstFiniteNumber(
      data && data.batteryCapacityKWh,
      request && request.input && request.input.storageKwh,
      0
    ) || 0;

    const simulation = {
      source: "re-forecast",
      isForecast: true,
      days: days,
      dayMap: dayMap,
      latestDateKey: days.length ? days[days.length - 1].dateKey : "",
      latestCycleCount: firstFiniteNumber(data && data.cyclesYear, 0) || 0,
      latestDepositPln: days.length ? firstFiniteNumber(days[days.length - 1].endDepositPln, 0) : 0,
      battery: { capacityKwh: capacityKwh },
      options: {
        annualUsageKwh: request && request.input ? request.input.annualUsageKwh : null,
        pvKwp: request && request.input ? request.input.pvKwp : null,
        storageKwh: capacityKwh
      },
      usageDataset: buildDashboardReForecastDataset(days, "usage"),
      pvDataset: buildDashboardReForecastDataset(days, "pv"),
      forecastStartKey: request && request.range ? request.range.startKey : "",
      forecastEndKey: request && request.range ? request.range.endKey : "",
      getRangeTotals: function (rangeWindow) {
        const startKey = rangeWindow && (rangeWindow.startKey || formatDashboardDateKey(rangeWindow.start));
        const endKey = rangeWindow && (rangeWindow.endKey || formatDashboardDateKey(rangeWindow.end));
        const selected = days.filter(function (day) {
          return day && (!startKey || day.dateKey >= startKey) && (!endKey || day.dateKey <= endKey);
        });
        const totals = {};
        selected.forEach(function (day) {
          sumDashboardForecastTotals(totals, day.totals);
        });
        const firstDay = selected[0] || null;
        const lastDay = selected[selected.length - 1] || null;

        return {
          startKey: startKey || "",
          endKey: endKey || "",
          days: selected.length,
          totals: totals,
          startSocKwh: firstDay ? firstDay.startSocKwh : 0,
          endSocKwh: lastDay ? lastDay.endSocKwh : 0,
          startDepositPln: firstDay ? firstDay.startDepositPln : 0,
          endDepositPln: lastDay ? lastDay.endDepositPln : 0
        };
      }
    };

    return simulation;
  }

  function getDashboardDepositCoverageDays(simulation, startKeyInput, initialBalancePln) {
    const days = simulation && Array.isArray(simulation.days) ? simulation.days : [];
    if (!days.length) {
      return null;
    }

    const startKey = typeof startKeyInput === "string" && startKeyInput
      ? startKeyInput
      : (startKeyInput && startKeyInput.start ? formatDashboardDateKey(startKeyInput.start) : "");
    let startIndex = startKey
      ? days.findIndex(function (day) { return day && day.dateKey >= startKey; })
      : 0;

    if (startIndex < 0) {
      return null;
    }

    const explicitStartBalance = firstFiniteNumber(initialBalancePln);
    if (explicitStartBalance != null) {
      if (explicitStartBalance <= 0.005) {
        return 0;
      }

      let runningBalance = explicitStartBalance;
      for (let index = startIndex; index < days.length; index += 1) {
        const day = days[index] || {};
        const totals = day.totals || {};
        const earnedPln = firstFiniteNumber(
          totals.depositEarnedPln,
          totals.billedDepositEarnedPln,
          day.depositEarnedPln,
          0
        ) || 0;
        const usedPln = firstFiniteNumber(
          totals.depositUsedPln,
          totals.billedDepositUsedPln,
          day.depositUsedPln,
          0
        ) || 0;

        runningBalance += earnedPln - usedPln;
        if (runningBalance <= 0.005) {
          return Math.max(0, index - startIndex);
        }
      }
    }

    const startDay = days[startIndex];
    const startBalance = firstFiniteNumber(
      startDay && startDay.startDepositPln,
      startDay && startDay.endDepositPln,
      simulation && simulation.latestDepositPln
    );

    if (startBalance == null) {
      return null;
    }

    if (startBalance <= 0.005) {
      return 0;
    }

    for (let index = startIndex; index < days.length; index += 1) {
      const day = days[index];
      const balance = firstFiniteNumber(day && day.endDepositPln, day && day.depositPln);
      if (balance != null && balance <= 0.005) {
        return Math.max(0, index - startIndex);
      }
    }

    return null;
  }

  function getDashboardForecastSimulationForRange(rangeWindow) {
    const simulation = window.dashboardReForecastSimulation || null;
    if (!simulation || !rangeWindow) {
      return null;
    }

    const startKey = rangeWindow.startKey || formatDashboardDateKey(rangeWindow.start);
    const endKey = rangeWindow.endKey || formatDashboardDateKey(rangeWindow.end);
    if (!startKey || !endKey) {
      return simulation;
    }

    if (simulation.forecastEndKey && startKey > simulation.forecastEndKey) {
      return null;
    }
    if (simulation.forecastStartKey && endKey < simulation.forecastStartKey) {
      return null;
    }
    return simulation;
  }

  window.getDashboardForecastSimulationForRange = getDashboardForecastSimulationForRange;

  function updateDashboardForecastButtons() {
    const active = !!(window.dashboardReForecastEnabled && window.dashboardReForecastSimulation);
    document.querySelectorAll("[data-dashboard-forecast-toggle]").forEach(function (button) {
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.disabled = !!window.dashboardReForecastLoading;
    });
    document.body.classList.toggle("dashboard-forecast-active", active);
  }

  function applyDashboardReForecastActiveState() {
    const baseSimulation = window.dashboardBaseProsumerSimulation || null;
    const forecastSimulation = window.dashboardReForecastSimulation || null;
    const activeSimulation = window.dashboardReForecastEnabled && forecastSimulation
      ? forecastSimulation
      : baseSimulation;

    if (activeSimulation) {
      window.dashboardProsumerSimulation = activeSimulation;
      window.dashboardBankSimulation = activeSimulation;
      document.dispatchEvent(new CustomEvent("dashboard:prosumer-updated", { detail: activeSimulation }));
      document.dispatchEvent(new CustomEvent("dashboard:bank-updated", { detail: activeSimulation }));
      document.dispatchEvent(new CustomEvent("dashboard:summary-updated", {
        detail: window.dashboardSummaryTotals || {}
      }));
    }

    updateDashboardForecastButtons();
  }

  async function ensureDashboardReForecast(payload, options) {
    const sourcePayload = resolveDashboardRePayload(payload || window.dashboardLatestPayload || {});
    const request = getDashboardReForecastRequest(sourcePayload);
    if (!request) {
      return null;
    }
    if (window.__dashboardReForecastSimulationKey === request.key && window.dashboardReForecastSimulation && !window.__dashboardReForecastPromise) {
      if (options && options.activate) {
        applyDashboardReForecastActiveState();
      }
      return window.dashboardReForecastSimulation;
    }
    if (window.__dashboardReForecastPromise && window.__dashboardReForecastKey === request.key) {
      if (options && options.activate) {
        return window.__dashboardReForecastPromise.then(function (simulation) {
          applyDashboardReForecastActiveState();
          return simulation;
        });
      }
      return window.__dashboardReForecastPromise;
    }

    const previousForecast = window.__dashboardReForecastPromise;
    window.__dashboardReForecastKey = request.key;
    window.__dashboardReForecastRequest = request;
    window.dashboardReForecastLoading = true;
    updateDashboardForecastButtons();

    // Re uses shared controls: finish the previous calculation before applying new settings.
    window.__dashboardReForecastPromise = Promise.resolve(previousForecast).catch(function () {})
      .then(function () {
        if (window.__dashboardReForecastRequest !== request) return null;
        return runDashboardReForecastLocally(sourcePayload || {}, request);
      })
      .then(function (data) {
        if (!data || window.__dashboardReForecastRequest !== request) return null;
        const simulation = buildDashboardReForecastSimulation(data, sourcePayload || {}, request);
        window.dashboardReForecastSimulation = simulation;
        window.__dashboardReForecastSimulationKey = request.key;
        document.dispatchEvent(new CustomEvent("dashboard:re-forecast-updated", { detail: simulation }));
        if (options && options.activate) {
          applyDashboardReForecastActiveState();
        } else {
          updateDashboardForecastButtons();
          document.dispatchEvent(new CustomEvent("dashboard:summary-updated", {
            detail: window.dashboardSummaryTotals || {}
          }));
        }
        return simulation;
      })
      .catch(function (error) {
        if (window.__dashboardReForecastRequest !== request) return null;
        console.error("Dashboard RE forecast error", error);
        window.dashboardReForecastSimulation = null;
        if (window.dashboardReForecastEnabled) {
          window.dashboardReForecastEnabled = false;
          applyDashboardReForecastActiveState();
        }
        throw error;
      })
      .finally(function () {
        if (window.__dashboardReForecastRequest !== request) return;
        window.dashboardReForecastLoading = false;
        window.__dashboardReForecastPromise = null;
        updateDashboardForecastButtons();
      });

    return window.__dashboardReForecastPromise;
  }

  async function setDashboardReForecastEnabled(enabled) {
    window.dashboardReForecastEnabled = !!enabled;
    if (!window.dashboardReForecastEnabled) {
      applyDashboardReForecastActiveState();
      return;
    }

    window.dashboardReForecastLoading = true;
    updateDashboardForecastButtons();

    try {
      const payload = hasDashboardRePayload(resolveDashboardRePayload(window.dashboardLatestPayload))
        ? resolveDashboardRePayload(window.dashboardLatestPayload)
        : await waitForDashboardRePayload();
      const simulation = await ensureDashboardReForecast(payload, { activate: true });
      if (!simulation && window.dashboardReForecastEnabled && !window.__dashboardReForecastPromise) {
        window.dashboardReForecastEnabled = false;
        applyDashboardReForecastActiveState();
      }
    } catch (error) {
      console.error("Dashboard RE forecast error", error);
      if (window.dashboardReForecastEnabled) {
        window.dashboardReForecastEnabled = false;
        applyDashboardReForecastActiveState();
      }
    } finally {
      if (!window.__dashboardReForecastPromise) {
        window.dashboardReForecastLoading = false;
      }
      updateDashboardForecastButtons();
    }
  }
  window.setDashboardReForecastEnabled = setDashboardReForecastEnabled;

  function initDashboardForecastControls() {
    document.querySelectorAll(".usage-toolbar:not([data-forecast-control='false'])").forEach(function (toolbar) {
      if (toolbar.querySelector("[data-dashboard-forecast-toggle]")) {
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "usage-forecast-toggle";
      button.textContent = "Prognoza";
      button.setAttribute("data-dashboard-forecast-toggle", "true");
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", function () {
        setDashboardReForecastEnabled(!window.dashboardReForecastEnabled);
      });
      toolbar.appendChild(button);
    });

    document.addEventListener("dashboard:payload-updated", function (event) {
      const payload = event && event.detail && event.detail.payload ? event.detail.payload : window.dashboardLatestPayload || {};
      ensureDashboardReForecast(resolveDashboardRePayload(payload), { activate: !!window.dashboardReForecastEnabled }).catch(function () {});
    });
    document.addEventListener("dashboard:incremental-data-updated", function (event) {
      const payload = event && event.detail && event.detail.payload ? event.detail.payload : window.dashboardLatestPayload || {};
      ensureDashboardReForecast(resolveDashboardRePayload(payload), { activate: !!window.dashboardReForecastEnabled }).catch(function () {});
    });
    document.addEventListener("dashboard:re-forecast-updated", applyDashboardReForecastActiveState);
    document.addEventListener("dashboard:installation-settings-saved", function () {
      ensureDashboardReForecast(window.dashboardLatestPayload || {}, { activate: !!window.dashboardReForecastEnabled }).catch(function () {});
    });
    updateDashboardForecastButtons();
  }

  function applyDashboardReActualData(payload) {
    const bridge = window.__dashboardReBridge || {};
    const applyActual = bridge.applyReActualDashboardData ||
      (typeof window.applyReActualDashboardData === "function" ? window.applyReActualDashboardData : null);
    if (typeof applyActual !== "function") {
      return null;
    }

    const summary = applyActual(payload || {});
    const debugSection = document.getElementById("dashboard-re-native");
    if (debugSection && summary) {
      debugSection.dataset.reActualDays = String(summary.days || 0);
      debugSection.dataset.reActualFirstDate = summary.firstDate || "";
      debugSection.dataset.reActualLastDate = summary.lastDate || "";
    }
    return summary;
  }

  function installDashboardReBridge() {
    if (window.__dashboardReBridge) {
      return;
    }
    const script = document.createElement("script");
    script.textContent = [
      "(function(){",
      "window.__dashboardReBridge={",
      "fetchSeriesRDN:typeof fetchSeriesRDN==='function'?fetchSeriesRDN:null,",
      "fetchSeriesRDNExact:typeof fetchSeriesRDNExact==='function'?fetchSeriesRDNExact:null,",
      "fetchSeriesRCE:typeof fetchSeriesRCE==='function'?fetchSeriesRCE:null,",
      "fetchSeriesRCEExact:typeof fetchSeriesRCEExact==='function'?fetchSeriesRCEExact:null,",
      "fetchSeries:typeof fetchSeries==='function'?fetchSeries:null,",
      "applyRDN:typeof applyRDN==='function'?applyRDN:null,",
      "applyRDNExact:typeof applyRDNExact==='function'?applyRDNExact:null,",
      "applyRCE:typeof applyRCE==='function'?applyRCE:null,",
      "applyRCEExact:typeof applyRCEExact==='function'?applyRCEExact:null,",
      "applyPV:typeof applyPV==='function'?applyPV:null,",
      "applyWind:typeof applyWind==='function'?applyWind:null,",
      "refreshTariffDerivedState:typeof refreshTariffDerivedState==='function'?refreshTariffDerivedState:null,",
      "calc:typeof calc==='function'?calc:null,",
      "drawRceChart:typeof drawRceChart==='function'?drawRceChart:null",
      "};",
      "}());"
    ].join("");
    document.head.appendChild(script);
  }

  async function mountDashboardReFullApp(section, options) {
    const baseUrl = getDashboardReBaseUrl();
    const visible = !options || options.visible !== false;
    section.classList.add("dashboard-re-native--full");
    section.classList.toggle("dashboard-re-native--background", !visible);
    if (visible) {
      document.body.classList.add("dashboard-re-enabled");
      section.hidden = false;
      if (!section.children.length) {
        section.innerHTML = '<div class="dashboard-re-loader">Ładowanie Re:Volt...</div>';
      }
    }
    installDashboardReFetchPatch(baseUrl);
    if (visible && window.__dashboardFirstPayloadReadyPromise) {
      await Promise.race([
        window.__dashboardFirstPayloadReadyPromise,
        reDelay(8000)
      ]);
    }
    const payload = await waitForDashboardRePayload(visible
      ? { requireStorage: false, timeoutMs: 30000 }
      : null);
    applyDashboardReDateRangeFromPayload(payload);
    const reInput = getDashboardReInputFromPayload(payload || {});
    if (reInput && reInput.lat != null && reInput.lon != null) {
      window.REVOLT_LOCATION_LAT = Number(reInput.lat);
      window.REVOLT_LOCATION_LON = Number(reInput.lon);
      window.REVOLT_LOCATION_LABEL = reInput.locationLabel || (
        String(reInput.lat).replace(".", ",") + ", " + String(reInput.lon).replace(".", ",")
      );
    }

    if (!window.__dashboardReFullLoaded) {
      const response = await fetch(new URL("index.php", baseUrl).href, {
        cache: "no-store",
        credentials: "same-origin"
      });
      const html = await response.text();
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const table = parsed.querySelector("table.layout-table");
      if (!table) {
        throw new Error("Brak tabeli layout-table w /re/index.php.");
      }
      stripDashboardReHiddenImages(table);
      rewriteDashboardReRelativeAssets(table, baseUrl);
      section.innerHTML = "";
      section.appendChild(table);
      if (window.DashboardPricing) window.DashboardPricing.refreshLabels();
      section.hidden = !visible;
      const tariffSetupButton = section.querySelector("#TarifSetBtn");
      if (tariffSetupButton) {
        tariffSetupButton.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopImmediatePropagation();
          window.location.href = new URL("setup.php", baseUrl).href;
        }, true);
      }
      await loadDashboardReScript("https://cdn.jsdelivr.net/npm/chart.js");
      await loadDashboardReScript(new URL("re_config.js.php?v=20260717a", baseUrl).href);
      await loadDashboardReScript(new URL("js/others.js?v=20260924-sale-vat-3", baseUrl).href);
      await loadDashboardReScript(new URL("js/re-consumption-engine.js?v=20260909-shared-profile", baseUrl).href);
      await loadDashboardReScript(new URL("js/scripts.js?v=20260930-capacity-charge-3", baseUrl).href);
      await loadDashboardReScript(new URL("js/script_on.js?v=20260930-capacity-charge-3", baseUrl).href);
      await loadDashboardReScript(new URL("js/dashboard-bridge.js?v=20260701a", baseUrl).href);
      window.__dashboardReFullLoaded = true;
    } else {
      section.hidden = !visible;
    }

    applyDashboardReActualData(payload);
    await loadDashboardReData(payload);
    await syncDashboardReControls(payload);
    const bridge = window.__dashboardReBridge || {};
    const redrawRceChart = bridge.drawRceChart || (typeof drawRceChart === "function" ? drawRceChart : window.drawRceChart);
    if (typeof redrawRceChart === "function") {
      const slider = document.getElementById("dateRange");
      const selected = new Date(getDashboardReStartDate() + "T00:00:00");
      if (slider) {
        selected.setDate(selected.getDate() + Number(slider.value || 0));
      }
      redrawRceChart(getDashboardReDateKey(selected));
    }

    window.__dashboardReFullAppReady = true;
    document.dispatchEvent(new CustomEvent("dashboard:re-native-ready", { detail: { payload: payload } }));

    if (!window.__dashboardRePayloadListenerInstalled) {
      document.addEventListener("dashboard:payload-updated", function (event) {
        const nextPayload = event && event.detail && event.detail.payload ? event.detail.payload : window.dashboardLatestPayload || {};
        applyDashboardReDateRangeFromPayload(nextPayload);
        applyDashboardReActualData(nextPayload);
        syncDashboardReControls(nextPayload).catch(function (error) {
          console.error("Dashboard RE sync error", error);
        });
      });
      window.__dashboardRePayloadListenerInstalled = true;
    }
  }

  function startDashboardReFullModule(section, visible) {
    const runtime = window.dashboardRuntime || getDashboardRuntime();
    if ((runtime !== "web" && runtime !== "android") ||
      !section ||
      window.__dashboardReFullAppReady ||
      window.__dashboardReModuleMountStarted) {
      return;
    }

    window.__dashboardReModuleMountStarted = true;
    mountDashboardReFullApp(section, { visible: visible }).catch(function (error) {
      window.__dashboardReModuleMountStarted = false;
      window.__dashboardReFullAppReady = false;
      window.__dashboardReModuleLastError = String(error && error.message ? error.message : error);
      if (visible) {
        section.hidden = false;
        section.classList.add("dashboard-re-native--full");
        section.innerHTML = '<div class="dashboard-re-error">BĹ‚Ä…d Ĺ‚adowania Re:Volt: ' + String(error && error.message ? error.message : error) + '</div>';
      }
      console.error("Dashboard RE load error", error);
    });
  }

  function installDashboardReFullModulePayloadStarter(section, visible) {
    if (window.__dashboardReModulePayloadStarterInstalled) {
      return;
    }

    window.__dashboardReModulePayloadStarterInstalled = true;
    document.addEventListener("dashboard:payload-updated", function () {
      startDashboardReFullModule(section, visible);
    });
  }

  function initDashboardReModule() {
    const params = new URLSearchParams(window.location.search || "");
    const config = getDashboardWebConfig();
    const runtime = window.dashboardRuntime || getDashboardRuntime();
    const section = document.getElementById("dashboard-re-native");
    const visible = params.has("re");

    if (!section) {
      return;
    }

    installDashboardReFullModulePayloadStarter(section, visible);
    startDashboardReFullModule(section, visible);
    return;

    if ((runtime !== "web" && runtime !== "android") || !section) {
      return;
    }

    mountDashboardReFullApp(section, { visible: visible }).catch(function (error) {
      if (visible) {
        section.hidden = false;
        section.classList.add("dashboard-re-native--full");
        section.innerHTML = '<div class="dashboard-re-error">Błąd ładowania Re:Volt: ' + String(error && error.message ? error.message : error) + '</div>';
      }
      console.error("Dashboard RE load error", error);
    });
    return;

    const fields = {
      status: document.getElementById("dashboard-re-status"),
      provider: document.getElementById("dashboard-re-provider"),
      tariff: document.getElementById("dashboard-re-tariff"),
      annual: document.getElementById("dashboard-re-annual"),
      pv: document.getElementById("dashboard-re-pv"),
      bank: document.getElementById("dashboard-re-bank"),
      location: document.getElementById("dashboard-re-location"),
      balance: document.getElementById("dashboard-re-balance"),
      newBill: document.getElementById("dashboard-re-new-bill"),
      depositPayout: document.getElementById("dashboard-re-deposit-payout"),
      deposit: document.getElementById("dashboard-re-deposit"),
      rateDate: document.getElementById("dashboard-re-rate-date"),
      rateChart: document.getElementById("dashboard-re-rate-chart")
    };
    let pendingRequestId = 0;
    let activeInputKey = "";
    let lastInputKey = "";
    let lastResultData = null;

    function reNumber() {
      const numeric = firstFiniteNumber.apply(null, arguments);
      return numeric == null ? null : numeric;
    }

    function reText() {
      return firstTextValue.apply(null, arguments);
    }

    function formatReNumber(value, digits) {
      const numeric = reNumber(value);
      if (numeric == null) {
        return "--";
      }
      return numeric.toFixed(digits == null ? 1 : digits).replace(".", ",");
    }

    function formatReMoney(value) {
      const numeric = reNumber(value);
      return numeric == null ? "--" : formatReNumber(numeric, 2) + " PLN";
    }

    function setReText(element, value) {
      if (element) {
        element.textContent = value || "--";
      }
    }

    function setupDateKey(date) {
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
      ].join("-");
    }

    function sumReUsageRecordKwh(record) {
      const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
      return quarters.reduce(function (sum, quarter) {
        return sum + Math.max(0, reNumber(
          quarter && quarter.totalLoadKwh,
          quarter && quarter.load,
          quarter && quarter.usageKwh,
          quarter && quarter.usage
        ) || 0);
      }, 0);
    }

    function roundReUp(value, step) {
      const numeric = reNumber(value);
      if (numeric == null || numeric <= 0) {
        return numeric;
      }
      return Math.ceil(numeric / step) * step;
    }

    function estimateReAnnualUsageKwh(payload) {
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const direct = reNumber(
        rawEnergy.annualUsageKwh,
        rawEnergy.annualConsumptionKwh,
        energy.annualUsageKwh,
        energy.annualConsumptionKwh
      );
      if (direct != null && direct > 0) {
        return direct;
      }

      const usageData = payload && payload.usageData ? payload.usageData : null;
      const records = usageData && Array.isArray(usageData.records) ? usageData.records : [];
      const todayKey = setupDateKey(new Date());
      const completeRecords = records.filter(function (record) {
        return record && typeof record.date === "string" && record.date < todayKey;
      });
      const sourceRecords = completeRecords.length ? completeRecords : records;
      const dailyTotals = sourceRecords.map(sumReUsageRecordKwh).filter(function (value) {
        return value > 0;
      });
      if (!dailyTotals.length) {
        return null;
      }
      return (dailyTotals.reduce(function (sum, value) { return sum + value; }, 0) / dailyTotals.length) * 365;
    }

    function estimateRePvKwp(payload) {
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const direct = reNumber(
        rawEnergy.installedPowerKw,
        rawEnergy.installationPowerKw,
        rawEnergy.mocInstalacjiKw,
        energy.installedPowerKw,
        energy.installationPowerKw,
        energy.mocInstalacjiKw
      );
      if (direct != null && direct > 0) {
        return direct;
      }

      const pvData = payload && payload.pvData ? payload.pvData : null;
      const records = pvData && Array.isArray(pvData.records) ? pvData.records : [];
      let maxPowerW = 0;
      records.forEach(function (record) {
        const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
        quarters.forEach(function (quarter) {
          const power = reNumber(
            quarter && quarter.powerW,
            quarter && quarter.acPowerW,
            quarter && quarter.dcPowerW,
            quarter && quarter.pvPowerW,
            quarter && quarter.productionPowerW
          );
          if (power != null) {
            maxPowerW = Math.max(maxPowerW, power);
          }
        });
      });
      return maxPowerW > 0 ? maxPowerW / 1000 : null;
    }

    function estimateReStorageKwh(payload) {
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const direct = reNumber(
        rawEnergy.batteryCapacityKwh,
        rawEnergy.storageCapacityKwh,
        energy.batteryCapacityKwh,
        energy.storageCapacityKwh
      );
      if (direct != null && direct > 0) {
        return direct;
      }

      const storageData = payload && payload.storageData ? payload.storageData : null;
      const records = storageData && Array.isArray(storageData.records) ? storageData.records : [];
      for (let recordIndex = records.length - 1; recordIndex >= 0; recordIndex -= 1) {
        const quarters = records[recordIndex] && Array.isArray(records[recordIndex].quarters) ? records[recordIndex].quarters : [];
        for (let quarterIndex = quarters.length - 1; quarterIndex >= 0; quarterIndex -= 1) {
          const capacity = reNumber(quarters[quarterIndex] && quarters[quarterIndex].capacityKwh);
          if (capacity != null && capacity > 0) {
            return capacity;
          }
        }
      }
      return null;
    }

    function getReTariffSelection(payload) {
      const account = payload && payload.account ? payload.account : {};
      const tariffData = payload && payload.tariffData ? payload.tariffData : {};
      const settings = account && account.tariffSettings && typeof account.tariffSettings === "object"
        ? account.tariffSettings
        : {};
      const target = settings.target && typeof settings.target === "object" ? settings.target : {};
      const tariff = tariffData.next || {};
      return {
        providerId: reNumber(target.osdId, account.tariffTargetOsdId, tariff.osd_id),
        tariffId: reNumber(target.tariffId, account.tariffTargetTariffId, tariff.tariff_id, tariff.id),
        providerName: reText(target.operator, target.provider, target.osdName, tariff.provider, tariff.osd_name, tariffData.provider),
        tariffLabel: reText(target.code && target.name ? target.code + " - " + target.name : "", tariff.code && tariff.name ? tariff.code + " - " + tariff.name : "", tariff.code, target.code),
        tariff: tariff
      };
    }

    function getReLocation(payload) {
      const account = payload && payload.account ? payload.account : {};
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const lat = reNumber(account.lat, account.latitude, rawEnergy.lat, rawEnergy.latitude);
      const lon = reNumber(account.lon, account.lng, account.longitude, rawEnergy.lon, rawEnergy.longitude);
      return {
        label: reText(account.locationLabel, account.locationName, account.name, rawEnergy.name),
        lat: lat,
        lon: lon
      };
    }

    function buildReInput(payload) {
      const account = payload && payload.account ? payload.account : {};
      const tariff = getReTariffSelection(payload);
      const location = getReLocation(payload);
      const annualUsage = estimateReAnnualUsageKwh(payload);
      const manualPvKwp = reNumber(account.pvSizeKwp, account.pvKwp, account.pvPowerKwp);
      const pvKwp = manualPvKwp != null ? manualPvKwp : estimateRePvKwp(payload);
      const storageKwh = estimateReStorageKwh(payload);
      return {
        tariff: tariff,
        location: location,
        annualUsageKwh: roundReUp(annualUsage, 500),
        pvKwp: manualPvKwp != null ? manualPvKwp : roundReUp(pvKwp, 1),
        storageKwh: roundReUp(storageKwh, 1)
      };
    }

    function renderReRates(payload) {
      if (!fields.rateChart) {
        return;
      }
      const purchaseData = (payload && payload.purchaseData) || null;
      const rates = purchaseData && Array.isArray(purchaseData.hourlyRates) ? purchaseData.hourlyRates : [];
      fields.rateChart.innerHTML = "";
      setReText(fields.rateDate, purchaseData && purchaseData.businessDate ? purchaseData.businessDate : "");
      if (!rates.length) {
        const empty = document.createElement("p");
        empty.className = "dashboard-re-rate-empty";
        empty.textContent = "Brak danych taryfy godzinowej.";
        fields.rateChart.appendChild(empty);
        return;
      }

      const maxRate = rates.reduce(function (max, entry) {
        return Math.max(max, reNumber(entry && (entry.pricePln != null ? entry.pricePln : entry.price)) || 0);
      }, 0);
      rates.forEach(function (entry) {
        const price = reNumber(entry && (entry.pricePln != null ? entry.pricePln : entry.price));
        const hour = entry && entry.hour != null ? Number(entry.hour) : 0;
        const bar = document.createElement("div");
        const fill = document.createElement("span");
        const label = document.createElement("span");
        bar.className = "dashboard-re-rate-bar";
        fill.className = "dashboard-re-rate-bar__fill";
        label.className = "dashboard-re-rate-bar__label";
        fill.style.height = price != null && maxRate > 0 ? Math.max(3, (price / maxRate) * 156) + "px" : "3px";
        fill.title = price == null ? "" : String(hour).padStart(2, "0") + ":00 - " + formatReNumber(price, 2) + " PLN/kWh";
        label.textContent = String(hour).padStart(2, "0");
        bar.appendChild(fill);
        bar.appendChild(label);
        fields.rateChart.appendChild(bar);
      });
    }

    function setReResults(data) {
      const result = data && data.data ? data.data : {};
      const yearCostCash = reNumber(result.yearCostCash);
      const newBill = yearCostCash != null ? Math.max(yearCostCash, 0) : null;
      setReText(fields.balance, formatReMoney(yearCostCash));
      setReText(fields.newBill, formatReMoney(newBill));
      setReText(fields.depositPayout, formatReMoney(0));
      setReText(fields.deposit, formatReMoney(result.depositAfterYear));
    }

    function buildReInputKey(input) {
      function round(value, multiplier) {
        const numeric = reNumber(value);
        return numeric == null ? null : Math.round(numeric * multiplier) / multiplier;
      }

      return JSON.stringify({
        providerId: Math.round(input.tariff.providerId),
        tariffId: Math.round(input.tariff.tariffId),
        annualUsageKwh: round(input.annualUsageKwh, 1),
        pvKwp: round(input.pvKwp, 1000),
        storageKwh: round(input.storageKwh, 100),
        lat: round(input.location.lat, 1000000),
        lon: round(input.location.lon, 1000000)
      });
    }

    function getReApiUrl(input) {
      const url = new URL("re/GetRe.php", window.location.href);
      url.searchParams.set("provider", String(Math.round(input.tariff.providerId)));
      url.searchParams.set("tariff", String(Math.round(input.tariff.tariffId)));
      url.searchParams.set("annualUsageKWh", String(Math.round(input.annualUsageKwh)));
      url.searchParams.set("kWp", String(input.pvKwp));
      url.searchParams.set("chkPV", input.pvKwp > 0 ? "1" : "0");
      url.searchParams.set("bankV", String(input.storageKwh));
      url.searchParams.set("chkBank", input.storageKwh > 0 ? "1" : "0");
      url.searchParams.set("chkWind", "0");
      url.searchParams.set("chkSell", "1");
      url.searchParams.set("days", "365");
      url.searchParams.set("lat", String(input.location.lat));
      url.searchParams.set("lon", String(input.location.lon));
      url.searchParams.set("nocache", String(Date.now()));
      return url;
    }

    async function refreshReModule() {
      const payload = window.dashboardLatestPayload || {};
      const input = buildReInput(payload);
      section.hidden = false;
      document.body.classList.add("dashboard-re-enabled");

      setReText(fields.provider, input.tariff.providerName);
      setReText(fields.tariff, input.tariff.tariffLabel);
      setReText(fields.annual, input.annualUsageKwh == null ? "" : formatReNumber(input.annualUsageKwh, 0) + " kWh");
      setReText(fields.pv, input.pvKwp == null ? "" : formatReNumber(input.pvKwp, 1) + " kWp");
      setReText(fields.bank, input.storageKwh == null ? "" : formatReNumber(input.storageKwh, 1) + " kWh");
      setReText(fields.location, input.location.label || (input.location.lat != null && input.location.lon != null ? formatReNumber(input.location.lat, 5) + ", " + formatReNumber(input.location.lon, 5) : ""));
      renderReRates(payload);

      if (!input.tariff.providerId || !input.tariff.tariffId) {
        setReText(fields.status, "Brak taryfy docelowej w danych dashboardu.");
        return;
      }
      const missing = [];
      if (input.annualUsageKwh == null) {
        missing.push("rocznego zużycia");
      }
      if (input.pvKwp == null) {
        missing.push("mocy PV");
      }
      if (input.storageKwh == null) {
        missing.push("pojemności magazynu");
      }
      if (input.location.lat == null || input.location.lon == null) {
        missing.push("lokalizacji");
      }
      if (missing.length) {
        setReText(fields.status, "Brak danych do obliczeń RE: " + missing.join(", ") + ".");
        return;
      }

      const inputKey = buildReInputKey(input);
      if (inputKey === lastInputKey && lastResultData) {
        setReResults(lastResultData);
        setReText(fields.status, "Dane wspólne z dashboardu, obliczenia z /re/GetRe.php.");
        return;
      }
      if (inputKey === activeInputKey) {
        setReText(fields.status, "Przeliczanie Re:Volt...");
        return;
      }

      const requestId = ++pendingRequestId;
      activeInputKey = inputKey;
      setReText(fields.status, "Przeliczanie Re:Volt...");
      try {
        const response = await fetch(getReApiUrl(input).toString(), {
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Accept": "application/json" }
        });
        const data = await response.json().catch(function () { return null; });
        if (requestId !== pendingRequestId) {
          return;
        }
        if (!response.ok || !data || data.ok === false) {
          throw new Error(data && data.error ? data.error : "HTTP " + response.status);
        }
        lastInputKey = inputKey;
        lastResultData = data;
        activeInputKey = "";
        setReResults(data);
        setReText(fields.status, "Dane wspólne z dashboardu, obliczenia z /re/GetRe.php.");
      } catch (error) {
        if (requestId === pendingRequestId) {
          activeInputKey = "";
          setReText(fields.status, "Błąd obliczeń RE: " + (error && error.message ? error.message : "nieznany błąd"));
        }
      }
    }

    refreshReModule();
    document.addEventListener("dashboard:payload-updated", refreshReModule);
  }

  function applyDashboardScaleForViewport() {
    const body = document.body;
    const root = document.documentElement;
    if (!body || !root) {
      return;
    }

    const runtime = window.dashboardRuntime || getDashboardRuntime();
    const viewportWidth = Math.max(
      window.innerWidth || 0,
      document.documentElement ? document.documentElement.clientWidth : 0
    );
    const viewportHeight = Math.max(
      window.innerHeight || 0,
      document.documentElement ? document.documentElement.clientHeight : 0
    );
    const scale = runtime === "web" && viewportWidth > 0 && viewportHeight > 0
      ? Math.min(viewportWidth / DASHBOARD_BASE_WIDTH, viewportHeight / DASHBOARD_BASE_HEIGHT, 1)
      : 1;

    body.style.setProperty("--dashboard-scale", String(scale));
    root.style.setProperty("--dashboard-scale", String(scale));
  }

  function initDateTime() {
    const dateTimeEl = document.getElementById("current-date-time");
    const dateLabelEl = document.getElementById("current-date-label");
    const depositDateEl = document.getElementById("deposit-current-date");
    const depositTimeEl = document.getElementById("deposit-current-time");
    const saleDateEl = document.getElementById("sale-current-date");
    const saleTimeEl = document.getElementById("sale-current-time");
    const purchaseDateEl = document.getElementById("purchase-current-date");
    const purchaseTimeEl = document.getElementById("purchase-current-time");
    const usageDateEl = document.getElementById("usage-current-date");
    const usageTimeEl = document.getElementById("usage-current-time");
    const pvDateEl = document.getElementById("pv-current-date");
    const pvTimeEl = document.getElementById("pv-current-time");
    const bankDateEl = document.getElementById("bank-current-date");
    const bankTimeEl = document.getElementById("bank-current-time");
    const weatherDateEl = document.getElementById("weather-current-date");
    const weatherTimeEl = document.getElementById("weather-current-time");
    const summaryDateEl = document.getElementById("summary-current-date");
    const summaryTimeEl = document.getElementById("summary-current-time");

    function updateDateTime() {
      const now = new Date();

      if (dateTimeEl) {
        dateTimeEl.textContent = capitalize(weekdayFormatter.format(now)) + " " + timeFormatter.format(now);
      }

      if (dateLabelEl) {
        dateLabelEl.textContent = dateFormatter.format(now);
      }

      if (depositDateEl) {
        depositDateEl.textContent = formatSlashDate(now);
      }

      if (depositTimeEl) {
        depositTimeEl.textContent = timeFormatter.format(now);
      }

      if (saleDateEl) {
        saleDateEl.textContent = formatSlashDate(now);
      }

      if (saleTimeEl) {
        saleTimeEl.textContent = timeFormatter.format(now);
      }

      if (purchaseDateEl) {
        purchaseDateEl.textContent = formatSlashDate(now);
      }

      if (purchaseTimeEl) {
        purchaseTimeEl.textContent = timeFormatter.format(now);
      }

      if (usageDateEl) {
        usageDateEl.textContent = formatSlashDate(now);
      }

      if (usageTimeEl) {
        usageTimeEl.textContent = timeFormatter.format(now);
      }

      if (pvDateEl) {
        pvDateEl.textContent = formatSlashDate(now);
      }

      if (pvTimeEl) {
        pvTimeEl.textContent = timeFormatter.format(now);
      }

      if (bankDateEl) {
        bankDateEl.textContent = formatSlashDate(now);
      }

      if (bankTimeEl) {
        bankTimeEl.textContent = timeFormatter.format(now);
      }

      if (weatherDateEl) {
        weatherDateEl.textContent = formatSlashDate(now);
      }

      if (weatherTimeEl) {
        weatherTimeEl.textContent = timeFormatter.format(now);
      }

      if (summaryDateEl) {
        summaryDateEl.textContent = formatSlashDate(now);
      }

      if (summaryTimeEl) {
        summaryTimeEl.textContent = timeFormatter.format(now);
      }
    }

    updateDateTime();
    setInterval(updateDateTime, 1000);
  }

  function initDashboardFreshnessNotice() {
    const body = document.body;
    const noticeEl = document.getElementById("dashboard-data-notice");
    const noticeTitleEl = noticeEl ? noticeEl.querySelector(".dashboard-data-notice__copy h2") : null;
    const noticeTextEl = document.getElementById("dashboard-data-notice-text");
    const auditButtons = Array.from(document.querySelectorAll(".dashboard-pill--audit, .usage-pill--audit"));
    let staleCheckTimer = null;
    let noticeRequested = false;

    function updateAuditControls(state) {
      const hasProblem = !state || !state.fresh;
      auditButtons.forEach(function (button) {
        button.setAttribute("aria-controls", "dashboard-data-notice");
        button.setAttribute("aria-expanded", hasProblem && noticeRequested ? "true" : "false");
        button.setAttribute("aria-label", hasProblem
          ? "Audyt: brak świeżych danych"
          : "Audyt: dane aktualne");
        button.title = hasProblem
          ? "Pokaż komunikat o danych"
          : "Dane są aktualne";
      });
    }

    function updateNoticeVisibility(state) {
      const hasProblem = !state || !state.fresh;
      if (noticeEl) {
        noticeEl.hidden = !(hasProblem && noticeRequested);
      }
      updateAuditControls(state);
    }

    function setNoticeState(payload) {
      const sourcePayload = payload || window.dashboardLatestPayload || {};
      const latestDataTime = getDashboardLatestDataTime(payload || window.dashboardLatestPayload || {});
      const now = new Date();
      const ageMs = latestDataTime ? Math.max(0, now.getTime() - latestDataTime.getTime()) : null;
      const stale = ageMs == null || ageMs > DASHBOARD_STALE_DATA_THRESHOLD_MS;
      const dataQualityIssues = getDashboardDataQualityIssues(sourcePayload);
      const dataQualityError = dataQualityIssues.length > 0;
      const fresh = !stale && !dataQualityError;
      const state = {
        checkedAt: now.toISOString(),
        latestAt: latestDataTime ? latestDataTime.toISOString() : null,
        latestLabel: latestDataTime ? formatStaleDataTimestamp(latestDataTime) : "",
        ageMs: ageMs,
        stale: stale,
        fresh: fresh,
        dataQualityError: dataQualityError,
        dataQualityIssues: dataQualityIssues
      };

      window.dashboardDataFreshness = state;

      if (body) {
        body.classList.toggle("dashboard-data-stale", stale);
        body.classList.toggle("dashboard-data-fresh", fresh);
        body.classList.toggle("dashboard-data-quality-error", dataQualityError);
      }

      if (fresh) {
        noticeRequested = false;
      }

      if (dataQualityError) {
        if (noticeTitleEl) {
          noticeTitleEl.textContent = "Problem z danymi";
        }
        if (noticeTextEl) {
          noticeTextEl.textContent = getDashboardDataQualityMessage(sourcePayload);
        }
      } else if (noticeTextEl && latestDataTime) {
        if (noticeTitleEl) {
          noticeTitleEl.textContent = "Czekamy na świeże dane";
        }
        noticeTextEl.textContent = "Brak nowych danych. Ostatni odczyt: " +
          state.latestLabel +
          ". Dashboard odświeży się automatycznie, gdy tylko pojawi się świeży odczyt.";
      } else {
        if (noticeTitleEl) {
          noticeTitleEl.textContent = "Czekamy na świeże dane";
        }
        if (noticeTextEl) {
          noticeTextEl.textContent = "Brak odczytów z instalacji. Dashboard odświeży się automatycznie, gdy tylko pojawią się dane.";
        }
      }

      updateNoticeVisibility(state);

      document.dispatchEvent(new CustomEvent("dashboard:data-freshness-updated", {
        detail: state
      }));
    }

    auditButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        const state = window.dashboardDataFreshness || null;
        if (state && state.fresh) {
          return;
        }
        noticeRequested = !noticeRequested;
        updateNoticeVisibility(state);
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !noticeRequested) {
        return;
      }
      noticeRequested = false;
      updateNoticeVisibility(window.dashboardDataFreshness || null);
    });

    window.updateDashboardFreshnessState = setNoticeState;

    document.addEventListener("dashboard:payload-updated", function (event) {
      const detail = event && event.detail ? event.detail : {};
      setNoticeState(detail.payload || window.dashboardLatestPayload || null);
    });

    document.addEventListener("dashboard:live-paths-updated", function (event) {
      const detail = event && event.detail ? event.detail : {};
      setNoticeState(detail.payload || window.dashboardLatestPayload || null);
    });

    staleCheckTimer = window.setInterval(function () {
      setNoticeState(window.dashboardLatestPayload || null);
    }, WEB_RUNTIME_FULL_REFRESH_MS);

    setNoticeState(window.dashboardLatestPayload || null);

    window.addEventListener("beforeunload", function () {
      if (staleCheckTimer != null) {
        window.clearInterval(staleCheckTimer);
      }
    }, { once: true });
  }

  function initInstallationSettingsModal() {
    const modal = document.getElementById("setup-modal");
    const form = document.getElementById("setup-form");
    const openButtons = Array.from(document.querySelectorAll(".dashboard-icon-pill--settings, .usage-icon-pill--settings"));
    const closeButtons = modal ? Array.from(modal.querySelectorAll("[data-setup-close]")) : [];
    const fields = {
      locationLabel: document.getElementById("setup-location-label"),
      lat: document.getElementById("setup-location-lat"),
      lon: document.getElementById("setup-location-lon"),
      startDate: document.getElementById("setup-location-start"),
      annualUsage: document.getElementById("setup-annual-usage"),
      dailyUsage: document.getElementById("setup-daily-usage"),
      pvSize: document.getElementById("setup-pv-size"),
      storageSize: document.getElementById("setup-storage-size"),
      currentOperator: document.getElementById("setup-current-operator"),
      currentTariff: document.getElementById("setup-current-tariff"),
      targetOperator: document.getElementById("setup-target-operator"),
      targetTariff: document.getElementById("setup-target-tariff"),
      screenTimeout: document.getElementById("setup-screen-timeout"),
      screenTimeoutField: document.getElementById("setup-screen-timeout-field"),
      note: document.getElementById("setup-modal-note")
    };
    const storageKeyBase = "onrevolt.installationSettings.v1";
    const screenTimeoutOptionsMs = [
      60000,
      300000,
      900000,
      1800000,
      3600000,
      7200000,
      18000000
    ];

    if (!modal || !form || !openButtons.length) {
      return;
    }
    if (fields.pvSize) {
      fields.pvSize.step = "0.1";
    }
    fields.pvSizeLabel = fields.pvSize && fields.pvSize.closest("label")
      ? fields.pvSize.closest("label").querySelector("span")
      : null;

    function setupDateKey(date) {
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
      ].join("-");
    }

    function setupNumber(value) {
      const numeric = firstFiniteNumber(value);
      return numeric == null ? null : numeric;
    }

    function roundUpToStep(value, step) {
      const numeric = setupNumber(value);
      const safeStep = Number(step) || 1;
      return numeric == null || numeric <= 0 ? null : Math.ceil(numeric / safeStep) * safeStep;
    }

    function setInputValue(input, value) {
      if (!input) {
        return;
      }
      input.value = value == null ? "" : String(value);
    }

    function setReadOnly(input, readOnly) {
      if (!input) {
        return;
      }
      input.readOnly = Boolean(readOnly);
      input.classList.toggle("is-locked", Boolean(readOnly));
    }

    function refreshScreenTimeoutField() {
      const bridge = window.AndroidScreenSettings;
      const available = getDashboardRuntime() === "android"
        && bridge
        && typeof bridge.getTimeoutMs === "function"
        && typeof bridge.setTimeoutMs === "function";

      if (fields.screenTimeoutField) {
        fields.screenTimeoutField.hidden = !available;
      }
      if (!available || !fields.screenTimeout) {
        return;
      }

      const timeoutMs = Number(bridge.getTimeoutMs());
      if (screenTimeoutOptionsMs.indexOf(timeoutMs) !== -1) {
        fields.screenTimeout.value = String(timeoutMs);
      }
    }

    function formatSetupKwp(value) {
      const numeric = setupNumber(value);
      if (numeric == null) {
        return "";
      }
      return String(Math.round(numeric * 10) / 10).replace(/\.0$/, "");
    }

    function sumUsageRecordKwh(record) {
      const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
      return quarters.reduce(function (sum, quarter) {
        return sum + Math.max(0, firstFiniteNumber(
          quarter && quarter.totalLoadKwh,
          quarter && quarter.load
        ) || 0);
      }, 0);
    }

    function getMeasuredDailyUsageKwh(payload) {
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const records = usageData && Array.isArray(usageData.records) ? usageData.records : [];
      if (!records.length) {
        return null;
      }

      const todayKey = setupDateKey(new Date());
      let completeRecords = records.filter(function (record) {
        return record && typeof record.date === "string" && record.date < todayKey;
      });
      if (!completeRecords.length) {
        completeRecords = records;
      }

      const dailyTotals = completeRecords
        .map(sumUsageRecordKwh)
        .filter(function (value) { return value > 0; });
      if (!dailyTotals.length) {
        return null;
      }

      return dailyTotals.reduce(function (sum, value) { return sum + value; }, 0) / dailyTotals.length;
    }

    function getMeasuredPvSizeKw(payload) {
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const direct = firstFiniteNumber(
        rawEnergy.installedPowerKw,
        rawEnergy.installationPowerKw,
        rawEnergy.mocInstalacjiKw,
        energy.installedPowerKw,
        energy.installationPowerKw,
        energy.mocInstalacjiKw
      );
      if (direct != null && direct > 0) {
        return direct;
      }

      const pvData = payload && payload.pvData ? payload.pvData : null;
      const records = pvData && Array.isArray(pvData.records) ? pvData.records : [];
      let maxPowerW = 0;
      records.forEach(function (record) {
        const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
        quarters.forEach(function (quarter) {
          const power = firstFiniteNumber(
            quarter && quarter.powerW,
            quarter && quarter.acPowerW,
            quarter && quarter.dcPowerW
          );
          if (power != null) {
            maxPowerW = Math.max(maxPowerW, power);
          }
        });
      });

      return maxPowerW > 0 ? maxPowerW / 1000 : null;
    }

    function getMeasuredStorageSizeKwh(payload) {
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const direct = firstFiniteNumber(
        rawEnergy.batteryCapacityKwh,
        rawEnergy.storageCapacityKwh,
        energy.batteryCapacityKwh,
        energy.storageCapacityKwh
      );
      if (direct != null && direct > 0) {
        return direct;
      }

      const storageData = payload && payload.storageData ? payload.storageData : null;
      const records = storageData && Array.isArray(storageData.records) ? storageData.records : [];
      let capacity = null;
      records.forEach(function (record) {
        const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
        quarters.forEach(function (quarter) {
          const value = firstFiniteNumber(quarter && quarter.capacityKwh);
          if (value != null && value > 0) {
            capacity = capacity == null ? value : Math.max(capacity, value);
          }
        });
      });

      return capacity;
    }

    function getPayloadStation(payload) {
      const config = getDashboardWebConfig();
      const source = payload || window.dashboardLatestPayload || {};
      const account = source.account || {};
      const rawEnergy = source.rawEnergy || source.energy || {};
      return firstTextValue(
        config.station,
        account.station,
        account.stationId,
        rawEnergy.station,
        rawEnergy.stationId
      );
    }

    function getSettingsStorageKey(payload) {
      const station = getPayloadStation(payload);
      return station ? storageKeyBase + ".station." + station : storageKeyBase;
    }

    function loadSavedSettings(payload) {
      try {
        const raw = window.localStorage ? window.localStorage.getItem(getSettingsStorageKey(payload)) : "";
        return raw ? JSON.parse(raw) : {};
      } catch (error) {
        return {};
      }
    }

    function saveSettings(settings, payload) {
      try {
        if (window.localStorage) {
          window.localStorage.setItem(getSettingsStorageKey(payload), JSON.stringify(settings));
        }
      } catch (error) {
        // Local storage can be disabled in some WebView modes.
      }
      window.dashboardInstallationSettings = settings;
      document.dispatchEvent(new CustomEvent("dashboard:installation-settings-saved"));
    }

    function getTariffCatalog(payload) {
      const tariffData = payload && payload.tariffData ? payload.tariffData : {};
      const catalog = tariffData && tariffData.catalog ? tariffData.catalog : null;
      return catalog && Array.isArray(catalog.operators) ? catalog : null;
    }

    function getCatalogOperators(payload) {
      const catalog = getTariffCatalog(payload);
      return catalog ? catalog.operators : [];
    }

    function getCatalogTariffs(payload, osdId) {
      const key = String(osdId || "");
      if (!key) {
        return [];
      }
      const operator = getCatalogOperators(payload).find(function (row) {
        return String(row && row.id) === key;
      });
      return operator && Array.isArray(operator.tariffs) ? operator.tariffs : [];
    }

    function getAccountTariffSettings(payload) {
      const account = payload && payload.account ? payload.account : {};
      const settings = account && account.tariffSettings && typeof account.tariffSettings === "object"
        ? account.tariffSettings
        : {};
      const current = settings.current && typeof settings.current === "object" ? settings.current : {};
      const target = settings.target && typeof settings.target === "object" ? settings.target : {};

      return {
        currentOperatorId: String(current.osdId || account.tariffCurrentOsdId || ""),
        currentTariffId: String(current.tariffId || account.tariffCurrentTariffId || ""),
        targetOperatorId: String(target.osdId || account.tariffTargetOsdId || ""),
        targetTariffId: String(target.tariffId || account.tariffTargetTariffId || "")
      };
    }

    function fillSelect(select, rows, selectedValue, labelFactory) {
      if (!select) {
        return;
      }
      const previousValue = selectedValue != null && selectedValue !== "" ? String(selectedValue) : String(select.value || "");
      select.innerHTML = "";
      rows.forEach(function (row) {
        const option = document.createElement("option");
        option.value = String(row.id);
        option.textContent = labelFactory(row);
        select.appendChild(option);
      });
      if (previousValue && rows.some(function (row) { return String(row.id) === previousValue; })) {
        select.value = previousValue;
      } else if (rows.length) {
        select.value = String(rows[0].id);
      }
    }

    function findOperatorId(operators, tariff, providerName) {
      const direct = firstFiniteNumber(tariff && tariff.osd_id);
      if (direct != null) {
        return String(Math.round(direct));
      }
      const normalizedProvider = String(providerName || "").trim().toLowerCase();
      const found = normalizedProvider
        ? operators.find(function (operator) {
          return String(operator.name || "").trim().toLowerCase() === normalizedProvider;
        })
        : null;
      return found ? String(found.id) : (operators[0] ? String(operators[0].id) : "");
    }

    function findTariffId(tariffs, tariff) {
      const direct = firstFiniteNumber(tariff && tariff.tariff_id, tariff && tariff.id);
      if (direct != null) {
        return String(Math.round(direct));
      }
      const code = String(tariff && tariff.code ? tariff.code : "").trim().toLowerCase();
      const found = code
        ? tariffs.find(function (row) {
          return String(row.code || "").trim().toLowerCase() === code;
        })
        : null;
      return found ? String(found.id) : (tariffs[0] ? String(tariffs[0].id) : "");
    }

    function populateTariffSelect(payload, operatorSelect, tariffSelect, selectedTariffId, sourceTariff) {
      if (!operatorSelect || !tariffSelect) {
        return;
      }
      const tariffs = getCatalogTariffs(payload, operatorSelect.value);
      fillSelect(tariffSelect, tariffs, selectedTariffId || findTariffId(tariffs, sourceTariff), function (tariff) {
        return String(tariff.code || "") + " - " + String(tariff.name || tariff.code || "");
      });
    }

    function populateTariffs(savedSettings, payload) {
      const tariffData = payload && payload.tariffData ? payload.tariffData : {};
      const operators = getCatalogOperators(payload);
      const currentTariff = tariffData.current || {};
      const targetTariff = tariffData.next || currentTariff || {};
      const accountSettings = getAccountTariffSettings(payload);
      const currentOperatorId = accountSettings.currentOperatorId || savedSettings.currentOperatorId || findOperatorId(operators, currentTariff, tariffData.provider);
      const targetOperatorId = accountSettings.targetOperatorId || savedSettings.targetOperatorId || findOperatorId(operators, targetTariff, tariffData.provider);

      if (!operators.length) {
        throw new Error("Brak katalogu taryf w danych dashboardu");
      }

      fillSelect(fields.currentOperator, operators, currentOperatorId, function (operator) {
        return String(operator.name || operator.slug || operator.id);
      });
      fillSelect(fields.targetOperator, operators, targetOperatorId, function (operator) {
        return String(operator.name || operator.slug || operator.id);
      });

      populateTariffSelect(payload, fields.currentOperator, fields.currentTariff, accountSettings.currentTariffId || savedSettings.currentTariffId, currentTariff);
      populateTariffSelect(payload, fields.targetOperator, fields.targetTariff, accountSettings.targetTariffId || savedSettings.targetTariffId, targetTariff);
    }

    function readCurrentFormSettings() {
      return {
        locationLabel: fields.locationLabel ? fields.locationLabel.value.trim() : "",
        lat: fields.lat ? fields.lat.value.trim() : "",
        lon: fields.lon ? fields.lon.value.trim() : "",
        startDate: fields.startDate ? fields.startDate.value.trim() : "",
        annualUsageKwh: fields.annualUsage ? fields.annualUsage.value.trim() : "",
        pvSizeKwp: fields.pvSize ? fields.pvSize.value.trim() : "",
        storageSizeKwh: fields.storageSize ? fields.storageSize.value.trim() : "",
        currentOperatorId: fields.currentOperator ? fields.currentOperator.value : "",
        currentTariffId: fields.currentTariff ? fields.currentTariff.value : "",
        targetOperatorId: fields.targetOperator ? fields.targetOperator.value : "",
        targetTariffId: fields.targetTariff ? fields.targetTariff.value : ""
      };
    }

    function updateMeasuredFields(payload, savedSettings) {
      const account = payload && payload.account ? payload.account : {};
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const measuredDailyUsage = getMeasuredDailyUsageKwh(payload);
      const measuredAnnualUsage = measuredDailyUsage != null ? roundUpToStep(measuredDailyUsage * 365, 500) : null;
      const measuredPvSizeRaw = getMeasuredPvSizeKw(payload);
      const measuredPvSize = roundUpToStep(measuredPvSizeRaw, 1);
      const measuredStorageSize = roundUpToStep(getMeasuredStorageSizeKwh(payload), 1);
      const savedAnnualUsage = firstFiniteNumber(account.annualUsageKwh, account.annualConsumptionKwh, savedSettings.annualUsageKwh);
      const savedPvSize = firstFiniteNumber(account.pvSizeKwp, account.pvKwp, account.pvPowerKwp, savedSettings.pvSizeKwp);
      const annualUsage = savedAnnualUsage || measuredAnnualUsage || 5000;
      const pvSize = savedPvSize != null ? savedPvSize : (measuredPvSize || 5);
      const storageSize = firstConfiguredStorageSizeKwh(measuredStorageSize, savedSettings.storageSizeKwh, 16);
      const startDate = getDashboardHistoryStartKey(payload) || normalizeDashboardDateKey(savedSettings.startDate);
      const dailyUsage = Math.round(annualUsage / 365);
      const noteParts = [];
      const measuredPvLabel = formatSetupKwp(measuredPvSizeRaw);

      setInputValue(fields.locationLabel, firstTextValue(account.locationLabel, account.locationName, account.name, rawEnergy.name, savedSettings.locationLabel));
      setInputValue(fields.lat, firstTextValue(account.lat, account.latitude, rawEnergy.lat, rawEnergy.latitude, savedSettings.lat));
      setInputValue(fields.lon, firstTextValue(account.lon, account.lng, account.longitude, rawEnergy.lon, rawEnergy.longitude, savedSettings.lon));
      setInputValue(fields.startDate, startDate);
      setInputValue(fields.annualUsage, Math.round(annualUsage));
      setInputValue(fields.dailyUsage, String(dailyUsage) + " kWh/d");
      setInputValue(fields.pvSize, formatSetupKwp(pvSize));
      setInputValue(fields.storageSize, Math.round(storageSize));
      if (fields.pvSizeLabel) {
        fields.pvSizeLabel.textContent = measuredPvLabel
          ? "Panele PV [kWp] (" + measuredPvLabel + "kWp)"
          : "Panele PV [kWp]";
      }

      setReadOnly(fields.annualUsage, savedAnnualUsage == null && measuredAnnualUsage != null);
      setReadOnly(fields.pvSize, false);
      setReadOnly(fields.storageSize, measuredStorageSize != null);

      if (savedAnnualUsage != null) {
        noteParts.push("Zużycie roczne z ustawień: średnio " + dailyUsage + " kWh/d, rocznie " + Math.round(savedAnnualUsage) + " kWh.");
      } else if (measuredAnnualUsage != null) {
        noteParts.push("Zużycie policzone z danych licznika: średnio " + dailyUsage + " kWh/d, rocznie " + Math.round(measuredAnnualUsage) + " kWh.");
      }
      if (savedPvSize != null) {
        noteParts.push("Moc PV z ustawień: " + formatSetupKwp(savedPvSize) + " kWp.");
      } else if (measuredPvSize != null) {
        noteParts.push("Moc PV policzona z danych instalacji: " + Math.round(measuredPvSize) + " kWp.");
      }
      if (measuredStorageSize != null) {
        noteParts.push("Pojemność magazynu odczytana z danych: " + Math.round(measuredStorageSize) + " kWh.");
      }
      if (fields.note) {
        fields.note.textContent = noteParts.length
          ? noteParts.join(" ")
          : "Brak pełnych danych pomiarowych - wartości można edytować ręcznie.";
      }
    }

    function getSettingsApiUrl() {
      const runtime = getDashboardRuntime();
      const config = getDashboardWebConfig();
      const payload = window.dashboardLatestPayload || {};
      const account = payload.account || {};
      const station = config.station || account.station || (payload.energy && payload.energy.station) || "";
      const baseUrl = runtime === "web"
        ? config.apiUrl
        : "https://my.onrevolt.com/api/dashboard.php";

      if (!station) {
        throw new Error("Brak numeru stacji do zapisu ustawień");
      }

      const url = new URL(baseUrl, window.location.href);
      url.searchParams.set("station", String(station));
      return url.toString();
    }

    async function persistSettings(settings) {
      const response = await fetch(getSettingsApiUrl(), {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(settings)
      });
      const payload = await response.json().catch(function () {
        return null;
      });

      if (!response.ok || !payload || payload.ok === false) {
        const message = payload && (payload.error || payload.details)
          ? String(payload.error || payload.details)
          : "HTTP " + response.status;
        throw new Error(message);
      }

      return payload;
    }

    async function reloadDashboardPayloadAfterSettings() {
      const url = new URL(getSettingsApiUrl());
      url.searchParams.set("nocache", String(Date.now()));
      const response = await fetch(url.toString(), {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Accept": "application/json"
        }
      });
      const payload = await response.json().catch(function () {
        return null;
      });

      if (!response.ok || !payload) {
        throw new Error("Nie udało się odświeżyć danych dashboardu po zapisie");
      }
      if (typeof window.updateDashboardPayload === "function") {
        window.updateDashboardPayload(payload);
      }
    }

    function setSavingState(saving) {
      const buttons = Array.from(form.querySelectorAll("button, select, input"));
      buttons.forEach(function (element) {
        if (saving) {
          element.setAttribute("data-setup-disabled-during-save", element.disabled ? "1" : "0");
          element.disabled = true;
        } else if (element.getAttribute("data-setup-disabled-during-save") === "0") {
          element.disabled = false;
        }
        if (!saving) {
          element.removeAttribute("data-setup-disabled-during-save");
        }
      });
    }

    async function refreshSetupForm() {
      const payload = window.dashboardLatestPayload || {};
      const savedSettings = loadSavedSettings(payload);
      updateMeasuredFields(payload, savedSettings);
      refreshScreenTimeoutField();

      if (fields.currentOperator) {
        fields.currentOperator.disabled = true;
      }
      if (fields.currentTariff) {
        fields.currentTariff.disabled = true;
      }
      if (fields.targetOperator) {
        fields.targetOperator.disabled = true;
      }
      if (fields.targetTariff) {
        fields.targetTariff.disabled = true;
      }

      try {
        populateTariffs(savedSettings, payload);
      } catch (error) {
        if (fields.note) {
          fields.note.textContent = "Nie udało się pobrać listy taryf: " + error.message;
        }
      } finally {
        if (fields.currentOperator) {
          fields.currentOperator.disabled = false;
        }
        if (fields.currentTariff) {
          fields.currentTariff.disabled = false;
        }
        if (fields.targetOperator) {
          fields.targetOperator.disabled = false;
        }
        if (fields.targetTariff) {
          fields.targetTariff.disabled = false;
        }
      }
    }

    function openModal() {
      modal.hidden = false;
      document.body.classList.add("setup-modal-open");
      refreshSetupForm();
      window.setTimeout(function () {
        if (getDashboardRuntime() !== "android" && fields.locationLabel) {
          fields.locationLabel.focus();
        }
      }, 0);
    }

    function closeModal() {
      modal.hidden = true;
      document.body.classList.remove("setup-modal-open");
    }

    openButtons.forEach(function (button) {
      button.addEventListener("click", openModal);
    });

    closeButtons.forEach(function (button) {
      button.addEventListener("click", closeModal);
    });

    if (fields.currentOperator) {
      fields.currentOperator.addEventListener("change", function () {
        populateTariffSelect(window.dashboardLatestPayload || {}, fields.currentOperator, fields.currentTariff, "", null);
      });
    }

    if (fields.targetOperator) {
      fields.targetOperator.addEventListener("change", function () {
        populateTariffSelect(window.dashboardLatestPayload || {}, fields.targetOperator, fields.targetTariff, "", null);
      });
    }

    if (fields.screenTimeout) {
      fields.screenTimeout.addEventListener("change", function () {
        const timeoutMs = Number(fields.screenTimeout.value);
        if (screenTimeoutOptionsMs.indexOf(timeoutMs) !== -1
            && window.AndroidScreenSettings
            && typeof window.AndroidScreenSettings.setTimeoutMs === "function") {
          window.AndroidScreenSettings.setTimeoutMs(timeoutMs);
        }
      });
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const payload = window.dashboardLatestPayload || {};
      const settings = readCurrentFormSettings();
      setSavingState(true);
      if (fields.note) {
        fields.note.textContent = "Zapisywanie ustawień taryfy...";
      }
      closeModal();
      let settingsSaved = false;
      try {
        await persistSettings(settings);
        saveSettings(settings, payload);
        settingsSaved = true;
        await reloadDashboardPayloadAfterSettings();
      } catch (error) {
        if (settingsSaved) {
          console.error("Nie udało się odświeżyć dashboardu po zapisie ustawień", error);
        } else if (fields.note) {
          fields.note.textContent = "Nie zapisano ustawień: " + (error && error.message ? error.message : "nieznany błąd");
        }
      } finally {
        setSavingState(false);
      }
    });

    document.addEventListener("dashboard:payload-updated", function () {
      if (!modal.hidden) {
        refreshSetupForm();
      }
    });

    window.addEventListener("keydown", function (event) {
      if (!modal.hidden && event.key === "Escape") {
        closeModal();
      }
    });
  }

  function initDetailViews() {
    const body = document.body;
    const detailPages = Array.from(document.querySelectorAll(".usage-detail[data-view]"));

    function getPage(viewName) {
      return detailPages.find(function (page) {
        return page.getAttribute("data-view") === viewName;
      }) || null;
    }

    function dispatchViewEvent(viewName, phase) {
      document.dispatchEvent(new CustomEvent("detailview:" + phase, {
        detail: { view: viewName }
      }));

      if (viewName === "usage") {
        document.dispatchEvent(new CustomEvent("usageview:" + phase));
      }
    }

    function openDetailView(viewName) {
      const nextPage = getPage(viewName);

      if (!nextPage || !body) {
        return;
      }

      detailPages.forEach(function (page) {
        const pageView = page.getAttribute("data-view");
        const shouldOpen = page === nextPage;
        const wasHidden = page.hidden;

        page.hidden = !shouldOpen;

        if (!shouldOpen && !wasHidden) {
          dispatchViewEvent(pageView, "close");
        }
      });

      body.classList.add("body--detail-view");
      body.setAttribute("data-active-detail-view", viewName);

      if (nextPage.hidden === false) {
        dispatchViewEvent(viewName, "open");
      }
    }

    function closeDetailView(viewName) {
      const currentPage = getPage(viewName);

      if (!currentPage || currentPage.hidden) {
        return;
      }

      currentPage.hidden = true;
      dispatchViewEvent(viewName, "close");

      const hasOpenPage = detailPages.some(function (page) {
        return !page.hidden;
      });

      if (!hasOpenPage && body) {
        body.classList.remove("body--detail-view");
        body.removeAttribute("data-active-detail-view");
      }
    }

    document.querySelectorAll("[data-open-view]").forEach(function (trigger) {
      const viewName = trigger.getAttribute("data-open-view");

      if (!viewName) {
        return;
      }

      trigger.addEventListener("click", function () {
        openDetailView(viewName);
      });
      trigger.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDetailView(viewName);
        }
      });
    });

    document.querySelectorAll("[data-close-view]").forEach(function (trigger) {
      const viewName = trigger.getAttribute("data-close-view");

      if (!viewName) {
        return;
      }

      trigger.addEventListener("click", function () {
        closeDetailView(viewName);
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !body) {
        return;
      }

      const activeView = body.getAttribute("data-active-detail-view");
      if (activeView) {
        closeDetailView(activeView);
      }
    });
  }

  function initAppTheme() {
    const body = document.body;
    const detailPages = Array.from(document.querySelectorAll(".usage-detail[data-view]"));
    const themeToggles = Array.from(document.querySelectorAll("[data-detail-theme-toggle='true']"));
    const themedImages = Array.from(document.querySelectorAll("[data-theme-light-src][data-theme-dark-src]"));
    const consumptionObject = document.querySelector(".scene-object--washer");
    const storageKey = "app-theme";

    if (!body) {
      return;
    }

    function resolveBackgroundVariant() {
      const params = new URLSearchParams(window.location.search || "");
      const forcedVariant = (params.get("backgroundVariant") || params.get("bgVariant") || "").toLowerCase();
      if (forcedVariant === "tablet" || forcedVariant === "site") {
        return forcedVariant;
      }

      const href = String(window.location.href || "").toLowerCase();
      const protocol = String(window.location.protocol || "").toLowerCase();
      const userAgent = String(window.navigator && window.navigator.userAgent || "").toLowerCase();
      const isAndroidLocal = userAgent.indexOf("android") !== -1 && (
        protocol === "file:" ||
        href.indexOf("android_asset") !== -1 ||
        href.indexOf("localhost") !== -1
      );

      return isAndroidLocal ? "tablet" : "site";
    }

    const backgroundVariant = resolveBackgroundVariant();
    body.dataset.backgroundVariant = backgroundVariant;

    function getThemeAssetSrc(image, theme) {
      if (body.dataset.sceneSegment === "b2b") {
        return image.getAttribute("data-b2b-" + theme + "-src");
      }
      const suffix = backgroundVariant === "tablet" ? "tablet" : "site";
      const themedVariantSrc = image.getAttribute("data-theme-" + theme + "-src-" + suffix);
      if (themedVariantSrc) {
        return themedVariantSrc;
      }

      return image.getAttribute("data-theme-" + theme + "-src");
    }

    function applyThemeAssets(theme) {
      themedImages.forEach(function (image) {
        const nextSrc = getThemeAssetSrc(image, theme === "dark" ? "dark" : "light");

        if (nextSrc && image.getAttribute("src") !== nextSrc) {
          image.setAttribute("src", nextSrc);
        }
      });
    }

    window.updateDashboardScene = function (payload) {
      const source = payload || {};
      const account = source.account || {};
      const settings = account.tariffSettings || {};
      const target = settings.target || {};
      const nextTariff = (source.tariffData || {}).next || {};
      const tariffCode = String(target.code || nextTariff.code || "").trim();
      const segment = /^C\d/i.test(tariffCode) ? "b2b" : "b2c";

      if (body.dataset.sceneSegment !== segment) {
        body.dataset.sceneSegment = segment;
        applyThemeAssets(body.dataset.theme === "dark" ? "dark" : "light");
      }
      if (consumptionObject) {
        const src = consumptionObject.getAttribute("data-" + segment + "-src");
        if (src && consumptionObject.getAttribute("src") !== src) {
          consumptionObject.setAttribute("src", src);
        }
      }
    };

    function applyDashboardTheme(theme) {
      const nextTheme = theme === "dark" ? "dark" : "light";
      body.dataset.theme = nextTheme;
      applyThemeAssets(nextTheme);

      document.dispatchEvent(new CustomEvent("appthemechange", {
        detail: { theme: nextTheme }
      }));
    }

    function applyDetailTheme(theme) {
      const nextTheme = theme === "dark" ? "dark" : "light";
      const isDark = nextTheme === "dark";

      detailPages.forEach(function (page) {
        page.dataset.theme = nextTheme;
      });

      themeToggles.forEach(function (toggle) {
        toggle.setAttribute("aria-pressed", isDark ? "true" : "false");
      });

      document.dispatchEvent(new CustomEvent("detailview:themechange", {
        detail: { theme: nextTheme }
      }));

      document.dispatchEvent(new CustomEvent("usageview:themechange", {
        detail: { theme: nextTheme }
      }));
    }

    let initialTheme = "light";

    try {
      initialTheme = localStorage.getItem(storageKey) === "dark" ? "dark" : "light";
    } catch (error) {
      initialTheme = "light";
    }

    applyDashboardTheme(initialTheme);
    applyDetailTheme(initialTheme);

    themeToggles.forEach(function (toggle) {
      toggle.disabled = false;
      toggle.hidden = false;
      toggle.removeAttribute("aria-hidden");

      toggle.addEventListener("click", function () {
        const nextTheme = detailPages.some(function (page) {
          return page.dataset.theme === "dark";
        }) ? "light" : "dark";

        applyDashboardTheme(nextTheme);
        applyDetailTheme(nextTheme);

        try {
          localStorage.setItem(storageKey, nextTheme);
        } catch (error) {
          /* ignore storage failures */
        }
      });
    });
  }

  function initDepositView() {
    const depositPage = document.getElementById("deposit-detail");
    const breadcrumbRangeEl = document.getElementById("deposit-breadcrumb-range");
    const rangeLabelEl = document.getElementById("deposit-range-label");
    const currentValueEl = document.getElementById("deposit-current-value");
    const saleEnergyValueEl = document.getElementById("deposit-sale-energy-value");
    const saleWorthValueEl = document.getElementById("deposit-sale-worth-value");
    const salePriceValueEl = document.getElementById("deposit-sale-price-value");
    const purchaseEnergyValueEl = document.getElementById("deposit-purchase-energy-value");
    const purchaseWorthValueEl = document.getElementById("deposit-purchase-worth-value");
    const purchasePriceValueEl = document.getElementById("deposit-purchase-price-value");
    const coverageDaysEl = document.getElementById("deposit-coverage-days");
    const currentStatusEl = document.getElementById("deposit-current-status");
    const currentMeterThumbEl = document.getElementById("deposit-state-meter-thumb");
    const currentDateButton = document.getElementById("deposit-current-date");
    const currentTimeButton = document.getElementById("deposit-current-time");
    const chartShellEl = document.getElementById("deposit-chart-shell");
    const chartEl = document.getElementById("deposit-chart");
    const chartCaptionEl = document.getElementById("deposit-chart-caption");
    const sunMarkersEl = document.getElementById("deposit-sun-markers");
    const totalValueButton = document.getElementById("deposit-total-value-toggle");
    const depositKwhUnitEl = depositPage ? depositPage.querySelector(".deposit-kwh-unit-pill") : null;
    const rangeButtons = Array.from(document.querySelectorAll("[data-deposit-range]"));
    const shiftButtons = Array.from(document.querySelectorAll("[data-deposit-shift]"));
    const zoomButtons = Array.from(document.querySelectorAll("[data-deposit-zoom]"));
    const zoomResetButton = document.querySelector("[data-deposit-zoom-reset='true']");
    const monthTitleFormatter = new Intl.DateTimeFormat("pl-PL", {
      month: "long",
      year: "numeric"
    });
    const DEFAULT_INSTALLED_POWER_KW = 5;
    const LIGHT_LUX_REFERENCE = 20000;
    const UVI_REFERENCE = 10.5;
    const DEPOSIT_RANGE_DEFAULT_WINDOW = { day: 24, week: 7, month: 14, year: 6 };
    const DEPOSIT_RANGE_MIN_WINDOW = { day: 7, week: 4, month: 7, year: 3 };
    const DEPOSIT_BAR_WIDTH = 40;
    const DEPOSIT_RANGE_BAR_WIDTH = 36;
    const DEPOSIT_BAR_RADIUS = 5;
    const DEPOSIT_COLORS = {
      energy: "#8a47ff",
      saleValue: "#009a44",
      purchaseValue: "#fc7c00",
      totalActual: "#8a47ff",
      totalForecast: "#c5a3ff"
    };
    let currentHourHighlighter = null;
    if (!depositPage) {
      return;
    }

    function numberOrNull(value) {
      if (value == null || value === "") {
        return null;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }

    function firstNumber() {
      for (let i = 0; i < arguments.length; i += 1) {
        const numeric = numberOrNull(arguments[i]);
        if (numeric != null) {
          return numeric;
        }
      }
      return null;
    }

    function firstText() {
      for (let i = 0; i < arguments.length; i += 1) {
        const value = arguments[i];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
      return "";
    }

    function formatDecimal(value, digits) {
      return Number(value || 0).toFixed(digits == null ? 1 : digits).replace(".", ",");
    }

    function formatDateKey(date) {
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
      ].join("-");
    }

    function parseDateKey(value) {
      if (typeof value !== "string" || !value.trim()) {
        return null;
      }

      const parsed = new Date(value.trim().slice(0, 10) + "T00:00:00");
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function formatRangeName(range) {
      switch (range) {
        case "week":
          return "Tydzień";
        case "month":
          return "Miesiąc";
        case "year":
          return "Rok";
        default:
          return "Dzień";
      }
    }

    function addDays(date, days) {
      const next = new Date(date);
      next.setDate(next.getDate() + days);
      return next;
    }

    function addMonths(date, months) {
      const next = new Date(date);
      next.setMonth(next.getMonth() + months);
      return next;
    }

    function addYears(date, years) {
      const next = new Date(date);
      next.setFullYear(next.getFullYear() + years);
      return next;
    }

    function getStartOfWeek(date) {
      const next = new Date(date);
      const day = next.getDay();
      const shift = day === 0 ? -6 : 1 - day;

      next.setDate(next.getDate() + shift);
      return next;
    }

    function formatLongDate(date) {
      return capitalize(weekdayFormatter.format(date)) + " " + dateFormatter.format(date);
    }

    function formatWeekLabel(date) {
      const start = getStartOfWeek(date);
      const end = addDays(start, 6);
      return dateFormatter.format(start) + " - " + dateFormatter.format(end);
    }

    function formatMonthLabel(date) {
      return capitalize(monthTitleFormatter.format(date));
    }

    function formatYearLabel(date) {
      return String(date.getFullYear());
    }

    function setValueOnly(element, value, digits) {
      if (!element) {
        return;
      }

      if (value == null) {
        element.textContent = "--";
        return;
      }

      element.textContent = formatDecimal(value, digits == null ? 1 : digits);
    }

    function setMoneyText(element, value) {
      if (!element) {
        return;
      }

      element.textContent = value == null ? "-- PLN" : formatDecimal(value, 2) + " PLN";
    }

    function setMoneyOnly(element, value) {
      if (!element) {
        return;
      }

      element.textContent = value == null ? "--" : formatDecimal(value, 2);
    }

    function setAveragePriceValue(element, value) {
      if (!element) {
        return;
      }

      element.textContent = value == null ? "--" : formatDecimal(value, 2);
    }

    function getRangeDays(rangeWindow) {
      if (!rangeWindow || !rangeWindow.start || !rangeWindow.end) {
        return 1;
      }

      const startTime = rangeWindow.start.getTime();
      const endTime = rangeWindow.end.getTime();
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
        return 1;
      }

      return Math.max(1, Math.round((endTime - startTime) / 86400000) + 1);
    }

    function estimateCoverageDays(currentDepositPln, breakdown, rangeWindow, payload) {
      if (currentDepositPln == null || currentDepositPln <= 0) {
        return currentDepositPln === 0 ? 0 : null;
      }

      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const rangeDays = getRangeDays(rangeWindow);
      const averageDailyCost = firstNumber(
        breakdown && breakdown.purchaseValuePln != null && rangeDays > 0
          ? breakdown.purchaseValuePln / rangeDays
          : null,
        rawEnergy.dailyBillPln,
        rawEnergy.dailyCostPln,
        rawEnergy.dailyEnergyCostPln,
        energy.dailyBillPln,
        energy.dailyCostPln
      );

      return averageDailyCost && averageDailyCost > 0 ? currentDepositPln / averageDailyCost : null;
    }

    function updateDepositStatus(currentDepositPln, breakdown, rangeWindow, payload) {
      const coverageDays = estimateCoverageDays(currentDepositPln, breakdown, rangeWindow, payload);
      if (coverageDaysEl) {
        coverageDaysEl.textContent = coverageDays == null ? "--" : formatDecimal(coverageDays, 0);
      }

      const status = currentDepositPln == null
        ? "--"
        : (coverageDays != null && coverageDays < 1 ? "niski" : "stabilny");
      if (currentStatusEl) {
        currentStatusEl.textContent = "Stan depozytu: " + status;
      }

      if (currentMeterThumbEl) {
        const percent = coverageDays != null
          ? clampNumber((coverageDays / 30) * 100, 0, 100)
          : (currentDepositPln > 0 ? 50 : 0);
        currentMeterThumbEl.style.left = formatDecimal(percent, 2).replace(",", ".") + "%";
      }
    }

    function escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function formatTooltipHour(hour) {
      const safeHour = Math.max(0, Math.min(24, Math.round(hour == null ? 0 : hour)));
      return String(safeHour).padStart(2, "0") + ":00";
    }

    function getDepositTooltipRangeLabel(item) {
      const label = item && typeof item.label === "string" ? item.label.trim() : "";
      const parsedHour = Number(label.slice(0, 2));
      if (state.range === "day" && label && Number.isFinite(parsedHour)) {
        return formatTooltipHour(parsedHour) + "–" + formatTooltipHour(parsedHour + 1);
      }

      return label || formatRangeName(state.range);
    }

    function getDepositTooltipDateLabel(item) {
      const key = item && item.key != null ? String(item.key) : "";
      const dateKey = key.slice(0, 10);
      const date = parseDateKey(dateKey);

      if (state.range === "year") {
        const monthMatch = key.match(/^(\d{4})-(\d{2})$/);
        if (monthMatch) {
          return capitalize(monthTitleFormatter.format(new Date(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1)));
        }

        return date ? capitalize(monthTitleFormatter.format(date)) : getDepositTooltipRangeLabel(item);
      }

      return date
        ? capitalize(weekdayFormatter.format(date)) + ", " + dateFormatter.format(date)
        : getDepositTooltipRangeLabel(item);
    }

    function formatDepositTooltipPercent(value, total) {
      return total > 0 ? formatDecimal((Math.max(value || 0, 0) / total) * 100, 0) + "%" : "--";
    }

    function depositTooltipRow(color, label, value, unit, total) {
      return [
        "<div class=\"pv-chart-tooltip__row\">",
        "<span class=\"pv-chart-tooltip__dot\" style=\"background:" + color + ";\"></span>",
        "<div class=\"pv-chart-tooltip__row-content\">",
        "<p class=\"pv-chart-tooltip__row-label\">" + escapeHtml(label) + "</p>",
        "<p class=\"pv-chart-tooltip__row-value\">" + formatDecimal(value, 2) + " " + unit + " | " + formatDepositTooltipPercent(value, total) + "</p>",
        "</div>",
        "</div>"
      ].join("");
    }

    function getDepositTooltipContent(item, mode, totals) {
      if (state.range !== "day") {
        return [
          "<p class=\"pv-chart-tooltip__title\">Zasilenie depozytu</p>",
          "<p class=\"pv-chart-tooltip__range\">" + escapeHtml(getDepositTooltipDateLabel(item)) + "</p>",
          depositTooltipRow(DEPOSIT_COLORS.energy, "Energia oddana", Math.max(0, firstNumber(item && item.saleKwh, 0) || 0), "kWh", totals.saleEnergy),
          depositTooltipRow(DEPOSIT_COLORS.saleValue, "Wartość dopisana", Math.max(0, firstNumber(item && item.saleValuePln, 0) || 0), "PLN", totals.saleValue),
          "<p class=\"pv-chart-tooltip__title deposit-tooltip__section-title\">Wykorzystanie depozytu</p>",
          depositTooltipRow(DEPOSIT_COLORS.energy, "Energia wykorzystana", Math.max(0, firstNumber(item && item.purchaseKwh, 0) || 0), "kWh", totals.purchaseEnergy),
          depositTooltipRow(DEPOSIT_COLORS.purchaseValue, "Wartość wykorzystana", Math.max(0, firstNumber(item && item.purchaseValuePln, 0) || 0), "PLN", totals.purchaseValue)
        ].join("");
      }

      const isUsage = mode === "purchase";
      const energy = Math.max(0, firstNumber(isUsage ? item.purchaseKwh : item.saleKwh, 0) || 0);
      const value = Math.max(0, firstNumber(isUsage ? item.purchaseValuePln : item.saleValuePln, 0) || 0);

      return [
        "<p class=\"pv-chart-tooltip__title\">" + (isUsage ? "Wykorzystanie depozytu" : "Zasilenie depozytu") + "</p>",
        "<p class=\"pv-chart-tooltip__range\">" + escapeHtml(getDepositTooltipRangeLabel(item)) + "</p>",
        depositTooltipRow(DEPOSIT_COLORS.energy, isUsage ? "Energia wykorzystana" : "Energia oddana", energy, "kWh", isUsage ? totals.purchaseEnergy : totals.saleEnergy),
        depositTooltipRow(isUsage ? DEPOSIT_COLORS.purchaseValue : DEPOSIT_COLORS.saleValue, isUsage ? "Wartość wykorzystana" : "Wartość dopisana", value, "PLN", isUsage ? totals.purchaseValue : totals.saleValue)
      ].join("");
    }

    function getDepositTotalValueTooltipContent(item) {
      const rangeLabel = state.range === "day"
        ? getDepositTooltipRangeLabel(item)
        : getDepositTooltipDateLabel(item);
      const value = Math.max(0, firstNumber(item && item.depositPln, 0) || 0);

      return [
        "<p class=\"pv-chart-tooltip__title\">Całkowita wartość depozytu</p>",
        "<p class=\"pv-chart-tooltip__range\">" + escapeHtml(rangeLabel) + "</p>",
        "<div class=\"pv-chart-tooltip__divider\"></div>",
        "<p class=\"pv-chart-tooltip__total\"><span>" + formatDecimal(value, 2) + "</span> PLN</p>"
      ].join("");
    }

    function getRangeWindowForDeposit() {
      if (state.range === "week") {
        const start = getStartOfWeek(state.anchorDate);
        return {
          start: start,
          end: addDays(start, 6)
        };
      }

      if (state.range === "month") {
        return {
          start: new Date(state.anchorDate.getFullYear(), state.anchorDate.getMonth(), 1),
          end: new Date(state.anchorDate.getFullYear(), state.anchorDate.getMonth() + 1, 0)
        };
      }

      if (state.range === "year") {
        return {
          start: new Date(state.anchorDate.getFullYear(), 0, 1),
          end: new Date(state.anchorDate.getFullYear(), 11, 31)
        };
      }

      return {
        start: new Date(state.anchorDate.getFullYear(), state.anchorDate.getMonth(), state.anchorDate.getDate()),
        end: new Date(state.anchorDate.getFullYear(), state.anchorDate.getMonth(), state.anchorDate.getDate())
      };
    }

    function shouldUseMeasuredUsageSplit(usageData) {
      return isMeasuredUsageDataset(usageData);
    }

    function getMeasuredPayloadAnchorDate(payload) {
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const pvData = payload && payload.pvData ? payload.pvData : null;
      const latestKey = firstText(
        usageData && usageData.latestDate,
        pvData && pvData.latestDate,
        usageData && Array.isArray(usageData.records) && usageData.records.length
          ? usageData.records[usageData.records.length - 1].date
          : "",
        pvData && Array.isArray(pvData.records) && pvData.records.length
          ? pvData.records[pvData.records.length - 1].date
          : ""
      );

      return latestKey ? parseDateKey(latestKey) : null;
    }

    function normalizeText(value) {
      let text = String(value || "").toLowerCase();
      const replacements = {
        "\u0105": "a",
        "\u0107": "c",
        "\u0119": "e",
        "\u0142": "l",
        "\u0144": "n",
        "\u00f3": "o",
        "\u015b": "s",
        "\u017a": "z",
        "\u017c": "z"
      };

      text = text.replace(/[\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c]/g, function (match) {
        return replacements[match] || match;
      });

      return text.replace(/\s+/g, " ").trim();
    }

    function getDepositTariff(payload) {
      if (payload.tariffHistory?.strict) return clientTariffActual(payload, null);
      const tariffData = payload && payload.tariffData ? payload.tariffData : null;
      return tariffData && (tariffData.next || tariffData.current)
        ? (tariffData.next || tariffData.current)
        : null;
    }

    function sumTariffVariableRows(rows, matcher, windowCode) {
      return (rows || []).reduce(function (sum, row) {
        const rowCode = normalizeText(row && row.window_code ? row.window_code : "all");
        if (rowCode !== windowCode) {
          return sum;
        }

        if (!matcher(normalizeText(row && row.label))) {
          return sum;
        }

        return sum + (Number(row && row.price) || 0);
      }, 0);
    }

    function getZoneCodeForDateHour(tariff, dateKey, hour) {
      if (tariff?.clientTariffHistory?.strict) return ReTariffEngine.zone(ReTariffEngine.resolve(tariff.clientTariffHistory, dateKey, null), dateKey, hour);
      const monthNumber = parseInt(String(dateKey || "").slice(5, 7), 10);
      const monthly = tariff && tariff.monthly ? tariff.monthly : null;
      const row = monthly && monthNumber ? (monthly[String(monthNumber)] || monthly[monthNumber]) : null;
      const zoneValue = row && row.length ? (Number(row[hour]) || 2) : 2;

      if (zoneValue === 1) {
        return "high";
      }
      if (zoneValue === 3) {
        return "low";
      }
      return "mid";
    }

    function resolveEnergyPurchaseRate(tariff, dateKey, hour, rcePricePln) {
      if (tariff?.clientTariffHistory?.strict) return ReTariffEngine.rates(ReTariffEngine.resolve(tariff.clientTariffHistory, dateKey, null), dateKey, hour, rcePricePln).energy;
      if (!tariff) {
        return null;
      }

      const variableRows = Array.isArray(tariff.variable) ? tariff.variable : [];
      const sellMethod = normalizeText(tariff.sell_method || "fixed");
      const windowCode = (tariff.zone_model || "") === "highmidlow" || tariff.use_monthly
        ? getZoneCodeForDateHour(tariff, dateKey, hour)
        : "all";
      const energyRate = sumTariffVariableRows(variableRows, function (label) {
        return label.indexOf("energia") !== -1;
      }, windowCode);

      if (sellMethod === "rdn") {
        const rcePrice = firstNumber(rcePricePln);
        return rcePrice == null ? null : rcePrice;
      }

      return energyRate;
    }

    function getPayloadRceForDate(payload, dateKey) {
      const priceHistory = payload && payload.priceHistory ? payload.priceHistory : null;
      const byDate = priceHistory && priceHistory.rceByDate ? priceHistory.rceByDate : null;

      if (byDate && dateKey && Object.prototype.hasOwnProperty.call(byDate, dateKey)) {
        return byDate[dateKey];
      }

      const rce = payload && payload.rce ? payload.rce : null;
      return rce && rce.businessDate === dateKey ? rce : null;
    }

    function resolveRcePriceForDateHour(payload, dateKey, hour) {
      const rce = getPayloadRceForDate(payload, dateKey);
      const hourlyRates = rce && Array.isArray(rce.hourlyRates) ? rce.hourlyRates : [];

      for (let index = 0; index < hourlyRates.length; index += 1) {
        const entry = hourlyRates[index];
        if (Number(entry && entry.hour) === hour) {
          return firstNumber(entry && entry.pricePln, entry && entry.price, entry && entry.value);
        }
      }

      return firstNumber(rce && rce.currentPricePln);
    }

    function getRecordByDate(dataset, dateKey) {
      const records = dataset && Array.isArray(dataset.records) ? dataset.records : [];
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (String(record && record.date ? record.date : "") === dateKey) {
          return record;
        }
      }

      return null;
    }

    function collectMeasuredDateKeys(payload, endKey, startKey) {
      const keys = {};
      [payload && payload.usageData, payload && payload.pvData].forEach(function (dataset) {
        const records = dataset && Array.isArray(dataset.records) ? dataset.records : [];
        records.forEach(function (record) {
          const dateKey = String(record && record.date ? record.date : "");
          if (dateKey && (!startKey || dateKey >= startKey) && dateKey <= endKey) {
            keys[dateKey] = true;
          }
        });
      });

      return Object.keys(keys).sort();
    }

    function getQuarterHour(quarter, index) {
      const rawHour = firstNumber(quarter && quarter.hour, Math.floor(index / 4));
      return Math.max(0, Math.min(23, Math.floor(rawHour == null ? Math.floor(index / 4) : rawHour)));
    }

    function createMeasuredBucket(key, label, startDepositPln) {
      return {
        key: key,
        label: label,
        saleKwh: 0,
        saleValuePln: 0,
        purchaseKwh: 0,
        purchaseValuePln: 0,
        depositPln: startDepositPln || 0,
        hasData: false
      };
    }

    function buildMeasuredDepositLedger(payload, rangeWindow) {
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const pvData = payload && payload.pvData ? payload.pvData : null;
      const tariff = getDepositTariff(payload);

      if (!shouldUseMeasuredUsageSplit(usageData) || !tariff || !rangeWindow) {
        return null;
      }

      const rangeStartKey = formatDateKey(rangeWindow.start);
      const rangeEndKey = formatDateKey(rangeWindow.end);
      const depositStartKey = getDashboardHistoryStartKey(payload);
      const dateKeys = collectMeasuredDateKeys(payload, rangeEndKey, depositStartKey);
      let balancePln = getDashboardDepositStartPln(payload);
      const entries = [];
      const totals = {
        startBalancePln: balancePln,
        endBalancePln: balancePln,
        earnedPln: 0,
        earnedKwh: 0,
        usedPln: 0,
        coveredPurchaseKwh: 0,
        gridPurchaseKwh: 0
      };
      let capturedStart = false;

      dateKeys.forEach(function (dateKey) {
        const usageRecord = getRecordByDate(usageData, dateKey);
        const pvRecord = getRecordByDate(pvData, dateKey);
        const usageQuarters = usageRecord && Array.isArray(usageRecord.quarters) ? usageRecord.quarters : [];
        const pvQuarters = pvRecord && Array.isArray(pvRecord.quarters) ? pvRecord.quarters : [];
        const isInRange = dateKey >= rangeStartKey && dateKey <= rangeEndKey;

        const hourBalances = Array.from({ length: 24 }, function () {
          return { physicalImportKwh: 0, physicalExportKwh: 0 };
        });
        const slotCount = Math.max(usageQuarters.length, pvQuarters.length) || 96;

        for (let index = 0; index < slotCount; index += 1) {
          const usageQuarter = usageQuarters[index] || null;
          const pvQuarter = pvQuarters[index] || null;
          const hour = getQuarterHour(usageQuarter || pvQuarter, index);
          hourBalances[hour].physicalImportKwh += getQuarterPhysicalImportKwh(usageQuarter);
          hourBalances[hour].physicalExportKwh += getQuarterPhysicalExportKwh(usageQuarter, pvQuarter);
        }

        for (let hour = 0; hour < 24; hour += 1) {
          const physicalImportKwh = hourBalances[hour].physicalImportKwh;
          const physicalExportKwh = hourBalances[hour].physicalExportKwh;
          const saleKwh = Math.max(physicalExportKwh - physicalImportKwh, 0);
          const gridKwh = Math.max(physicalImportKwh - physicalExportKwh, 0);
          const rcePricePln = resolveRcePriceForDateHour(payload, dateKey, hour);
          const salePricePln = getProsumerSalePricePln(rcePricePln) || 0;
          const purchaseRatePln = resolveEnergyPurchaseRate(tariff, dateKey, hour, rcePricePln) || 0;
          const earnedPln = saleKwh * salePricePln;
          const eligiblePurchasePln = gridKwh * purchaseRatePln;

          if (isInRange && !capturedStart) {
            totals.startBalancePln = balancePln;
            capturedStart = true;
          }

          balancePln += earnedPln;
          const usedPln = Math.min(balancePln, eligiblePurchasePln);
          balancePln -= usedPln;
          const coveredPurchaseKwh = eligiblePurchasePln > 0
            ? gridKwh * (usedPln / eligiblePurchasePln)
            : 0;

          if (isInRange) {
            totals.earnedPln += earnedPln;
            totals.earnedKwh += saleKwh;
            totals.usedPln += usedPln;
            totals.coveredPurchaseKwh += coveredPurchaseKwh;
            totals.gridPurchaseKwh += gridKwh;
            entries.push({
              dateKey: dateKey,
              hour: hour,
              saleKwh: saleKwh,
              saleValuePln: earnedPln,
              purchaseKwh: coveredPurchaseKwh,
              purchaseValuePln: usedPln,
              depositPln: balancePln
            });
          }
        }
      });

      totals.endBalancePln = entries.length ? entries[entries.length - 1].depositPln : balancePln;

      return {
        entries: entries,
        totals: totals
      };
    }

    function buildMeasuredRangeItems(ledger, rangeWindow) {
      if (!ledger || !ledger.entries.length) {
        return [];
      }

      if (state.range === "day") {
        const buckets = Array.from({ length: 24 }, function (_, hour) {
          return createMeasuredBucket(
            formatDateKey(rangeWindow.start) + "-h" + String(hour),
            String(hour).padStart(2, "0"),
            ledger.totals.startBalancePln
          );
        });

        ledger.entries.forEach(function (entry) {
          const bucket = buckets[entry.hour] || null;
          if (!bucket) {
            return;
          }
          bucket.saleKwh += entry.saleKwh || 0;
          bucket.saleValuePln += entry.saleValuePln || 0;
          bucket.purchaseKwh += entry.purchaseKwh || 0;
          bucket.purchaseValuePln += entry.purchaseValuePln || 0;
          bucket.depositPln = entry.depositPln || 0;
          bucket.hasData = true;
        });

        let runningDeposit = ledger.totals.startBalancePln || 0;
        buckets.forEach(function (bucket) {
          if (bucket.hasData) {
            runningDeposit = bucket.depositPln;
          } else {
            bucket.depositPln = runningDeposit;
          }
        });

        return buckets;
      }

      const buckets = {};

      if (state.range === "year") {
        for (let date = new Date(rangeWindow.start.getFullYear(), 0, 1); date.getTime() <= rangeWindow.end.getTime(); date = addMonths(date, 1)) {
          const bucketKey = String(date.getFullYear()) + "-" + String(date.getMonth() + 1).padStart(2, "0");
          if (!buckets[bucketKey]) {
            buckets[bucketKey] = createMeasuredBucket(
              bucketKey,
              capitalize(monthTitleFormatter.format(date).split(" ")[0]),
              ledger.totals.startBalancePln
            );
          }
        }
      } else {
        for (let date = new Date(rangeWindow.start); date.getTime() <= rangeWindow.end.getTime(); date = addDays(date, 1)) {
          const bucketKey = formatDateKey(date);
          buckets[bucketKey] = createMeasuredBucket(
            bucketKey,
            state.range === "week"
              ? capitalize(weekdayFormatter.format(date))
              : String(date.getDate()).padStart(2, "0"),
            ledger.totals.startBalancePln
          );
        }
      }

      ledger.entries.forEach(function (entry) {
        const date = parseDateKey(entry.dateKey);
        if (!date) {
          return;
        }

        const bucketKey = state.range === "year"
          ? String(date.getFullYear()) + "-" + String(date.getMonth() + 1).padStart(2, "0")
          : entry.dateKey;
        if (!buckets[bucketKey]) {
          buckets[bucketKey] = createMeasuredBucket(
            bucketKey,
            state.range === "year"
              ? capitalize(monthTitleFormatter.format(date).split(" ")[0])
              : (state.range === "week"
                ? capitalize(weekdayFormatter.format(date))
                : String(date.getDate()).padStart(2, "0")),
            ledger.totals.startBalancePln
          );
        }

        buckets[bucketKey].saleKwh += entry.saleKwh || 0;
        buckets[bucketKey].saleValuePln += entry.saleValuePln || 0;
        buckets[bucketKey].purchaseKwh += entry.purchaseKwh || 0;
        buckets[bucketKey].purchaseValuePln += entry.purchaseValuePln || 0;
        buckets[bucketKey].depositPln = entry.depositPln || 0;
        buckets[bucketKey].hasData = true;
      });

      let runningDeposit = ledger.totals.startBalancePln || 0;
      return Object.keys(buckets).sort().map(function (bucketKey) {
        const bucket = buckets[bucketKey];
        if (bucket.hasData) {
          runningDeposit = bucket.depositPln;
        } else {
          bucket.depositPln = runningDeposit;
        }
        return bucket;
      });
    }

    function getMeasuredBreakdown(payload, rangeWindow) {
      if (!isRealDashboardDataMode(payload)) {
        return null;
      }

      const ledger = buildMeasuredDepositLedger(payload, rangeWindow);
      if (!ledger) {
        return null;
      }

      const rangeEndKey = formatDateKey(rangeWindow.end);
      const referenceSalePricePln = firstNumber(
        getProsumerSalePricePln(resolveRcePriceForDateHour(payload, rangeEndKey, 23)),
        getProsumerSalePricePln(payload && payload.rce && payload.rce.currentPricePln),
        ledger.totals.earnedKwh > 0 ? ledger.totals.earnedPln / ledger.totals.earnedKwh : null
      );

      return {
        depositKwh: ledger.totals.endBalancePln > 0 && referenceSalePricePln
          ? ledger.totals.endBalancePln / referenceSalePricePln
          : 0,
        currentDepositPln: ledger.totals.endBalancePln,
        depositChangePln: ledger.totals.earnedPln - ledger.totals.usedPln,
        depositWorthPln: ledger.totals.endBalancePln,
        saleKwh: ledger.totals.earnedKwh,
        saleValuePln: ledger.totals.earnedPln,
        saleAveragePricePln: ledger.totals.earnedKwh > 0
          ? ledger.totals.earnedPln / ledger.totals.earnedKwh
          : null,
        purchaseKwh: ledger.totals.coveredPurchaseKwh,
        purchaseValuePln: ledger.totals.usedPln,
        purchaseAveragePricePln: ledger.totals.coveredPurchaseKwh > 0
          ? ledger.totals.usedPln / ledger.totals.coveredPurchaseKwh
          : null,
        items: buildMeasuredRangeItems(ledger, rangeWindow)
      };
    }

    function getLatestMeasuredDepositDateKey(payload) {
      const latestDate = getMeasuredPayloadAnchorDate(payload);
      return latestDate ? formatDateKey(latestDate) : "";
    }

    function isDepositRangeFullyMeasured(payload, rangeWindow) {
      const latestKey = getLatestMeasuredDepositDateKey(payload);
      if (!latestKey || !rangeWindow || !rangeWindow.end) {
        return false;
      }

      return formatDateKey(rangeWindow.end) < latestKey;
    }

    function buildRangeItems(simulation, rangeWindow) {
      if (!simulation || !Array.isArray(simulation.days)) {
        return [];
      }

      const startKey = formatDateKey(rangeWindow.start);
      const endKey = formatDateKey(rangeWindow.end);
      const days = simulation.days.filter(function (day) {
        return day && day.dateKey >= startKey && day.dateKey <= endKey;
      });

      if (!days.length) {
        return [];
      }

      if (state.range === "day") {
        return (days[0].hours || []).map(function (hourEntry, index) {
          return {
            key: days[0].dateKey + "-h" + String(index),
            label: String(index).padStart(2, "0"),
            saleKwh: firstNumber(hourEntry && hourEntry.exportKwh, 0) || 0,
            saleValuePln: firstNumber(
              hourEntry && hourEntry.depositEarnedPln,
              hourEntry && hourEntry.exportKwh != null && hourEntry.sellPricePln != null
                ? hourEntry.exportKwh * hourEntry.sellPricePln
                : null,
              hourEntry && (hourEntry.soldImmediatePln != null || hourEntry.soldBankPln != null)
                ? ((hourEntry.soldImmediatePln || 0) + (hourEntry.soldBankPln || 0))
                : null,
              0
            ) || 0,
            purchaseKwh: firstNumber(
              hourEntry && hourEntry.depositUsedPln != null && hourEntry.energyBuyPricePln
                ? hourEntry.depositUsedPln / hourEntry.energyBuyPricePln
                : null,
              hourEntry && hourEntry.gridPurchaseKwh,
              0
            ) || 0,
            purchaseValuePln: firstNumber(
              hourEntry && hourEntry.depositUsedPln,
              hourEntry && hourEntry.gridPurchaseKwh != null && hourEntry.energyBuyPricePln != null
                ? hourEntry.gridPurchaseKwh * hourEntry.energyBuyPricePln
                : null,
              0
            ) || 0,
            depositPln: firstNumber(hourEntry && hourEntry.endDepositPln, 0) || 0,
            isForecast: !!(hourEntry && hourEntry.isForecast)
          };
        });
      }

      if (state.range === "year") {
        const monthBuckets = {};
        days.forEach(function (day) {
          const date = parseDateKey(day.dateKey);
          if (!date) {
            return;
          }
          const bucketKey = String(date.getFullYear()) + "-" + String(date.getMonth() + 1).padStart(2, "0");
          if (!monthBuckets[bucketKey]) {
            monthBuckets[bucketKey] = {
              key: bucketKey,
              label: capitalize(monthTitleFormatter.format(date).split(" ")[0]),
              saleKwh: 0,
              saleValuePln: 0,
              purchaseKwh: 0,
              purchaseValuePln: 0,
              depositPln: 0,
              isForecast: false
            };
          }

          if (day.isForecast) {
            monthBuckets[bucketKey].isForecast = true;
          }
          monthBuckets[bucketKey].saleKwh += firstNumber(day.totals && day.totals.exportKwh, 0) || 0;
          monthBuckets[bucketKey].saleValuePln += firstNumber(
            day.totals && day.totals.depositEarnedPln,
            day.totals && (day.totals.soldImmediatePln != null || day.totals.soldBankPln != null)
              ? ((day.totals.soldImmediatePln || 0) + (day.totals.soldBankPln || 0))
              : null,
            0
          ) || 0;
          monthBuckets[bucketKey].purchaseKwh += firstNumber(
            estimateDepositCoveredKwhFromSimulation({ days: [day] }, {
              start: date,
              end: date
            }),
            day.totals && day.totals.gridPurchaseKwh,
            0
          ) || 0;
          monthBuckets[bucketKey].purchaseValuePln += firstNumber(day.totals && day.totals.depositUsedPln, 0) || 0;
          monthBuckets[bucketKey].depositPln = firstNumber(day.endDepositPln, monthBuckets[bucketKey].depositPln, 0) || 0;
        });

        return Object.keys(monthBuckets).sort().map(function (bucketKey) {
          return monthBuckets[bucketKey];
        });
      }

      return days.map(function (day) {
        const date = parseDateKey(day.dateKey);
        return {
          key: day.dateKey,
          label: state.range === "week"
            ? capitalize(weekdayFormatter.format(date || new Date()))
            : String((date || new Date()).getDate()).padStart(2, "0"),
          saleKwh: firstNumber(day.totals && day.totals.exportKwh, 0) || 0,
          saleValuePln: firstNumber(
            day.totals && day.totals.depositEarnedPln,
            day.totals && (day.totals.soldImmediatePln != null || day.totals.soldBankPln != null)
              ? ((day.totals.soldImmediatePln || 0) + (day.totals.soldBankPln || 0))
              : null,
            0
          ) || 0,
          purchaseKwh: firstNumber(
            estimateDepositCoveredKwhFromSimulation({ days: [day] }, {
              start: date || new Date(),
              end: date || new Date()
            }),
            day.totals && day.totals.gridPurchaseKwh,
            0
          ) || 0,
          purchaseValuePln: firstNumber(day.totals && day.totals.depositUsedPln, 0) || 0,
          depositPln: firstNumber(day.endDepositPln, 0) || 0,
          isForecast: !!(day && day.isForecast)
        };
      });
    }

    function createEmptyDepositRangeItem(key, label) {
      return {
        key: key,
        label: label,
        saleKwh: 0,
        saleValuePln: 0,
        purchaseKwh: 0,
        purchaseValuePln: 0,
        depositPln: 0,
        isForecast: false
      };
    }

    function completeDepositRangeItems(items, rangeWindow) {
      const itemsByKey = new Map((items || []).map(function (item) {
        return [String(item && item.key ? item.key : ""), item];
      }));
      const completedItems = [];

      if (state.range === "day") {
        const dateKey = formatDateKey(rangeWindow.start);
        for (let hour = 0; hour < 24; hour += 1) {
          const key = dateKey + "-h" + String(hour);
          completedItems.push(itemsByKey.get(key) || createEmptyDepositRangeItem(key, String(hour).padStart(2, "0")));
        }
        return completedItems;
      }

      if (state.range === "year") {
        for (let date = new Date(rangeWindow.start); date.getTime() <= rangeWindow.end.getTime(); date = addMonths(date, 1)) {
          const key = String(date.getFullYear()) + "-" + String(date.getMonth() + 1).padStart(2, "0");
          completedItems.push(
            itemsByKey.get(key) || createEmptyDepositRangeItem(
              key,
              capitalize(monthTitleFormatter.format(date).split(" ")[0])
            )
          );
        }
        return completedItems;
      }

      for (let date = new Date(rangeWindow.start); date.getTime() <= rangeWindow.end.getTime(); date = addDays(date, 1)) {
        const key = formatDateKey(date);
        completedItems.push(
          itemsByKey.get(key) || createEmptyDepositRangeItem(
            key,
            state.range === "week"
              ? capitalize(weekdayFormatter.format(date))
              : String(date.getDate()).padStart(2, "0")
          )
        );
      }

      return completedItems;
    }

    function clearUnmeasuredDepositItems(items, payload) {
      const latestDate = getMeasuredPayloadAnchorDate(payload);
      if (!latestDate) {
        return items;
      }

      const latestDateKey = formatDateKey(latestDate);
      const latestMonthKey = latestDateKey.slice(0, 7);
      const latestDataTime = getDashboardLatestDataTime(payload);
      const latestHour = latestDataTime && formatDateKey(latestDataTime) === latestDateKey
        ? latestDataTime.getHours()
        : 23;

      return items.map(function (item) {
        const key = String(item && item.key ? item.key : "");
        let isAfterMeasuredData = false;

        if (state.range === "year") {
          isAfterMeasuredData = key > latestMonthKey;
        } else if (state.range === "day") {
          const dateKey = key.slice(0, 10);
          const hourMatch = key.match(/-h(\d{1,2})$/);
          const hour = hourMatch ? Number(hourMatch[1]) : null;
          isAfterMeasuredData = dateKey > latestDateKey || (
            dateKey === latestDateKey && hour != null && hour > latestHour
          );
        } else {
          isAfterMeasuredData = key > latestDateKey;
        }

        return isAfterMeasuredData
          ? createEmptyDepositRangeItem(key, item && item.label ? item.label : "")
          : item;
      });
    }

    function buildMeasuredDepositRangeItems(payload, rangeWindow) {
      const ledger = buildMeasuredDepositLedger(payload, rangeWindow);
      return ledger ? buildMeasuredRangeItems(ledger, rangeWindow) : [];
    }

    function buildForecastAwareDepositItems(payload, simulation, rangeWindow) {
      if (!simulation || !simulation.isForecast) {
        return buildMeasuredDepositRangeItems(payload, rangeWindow);
      }
      return buildRangeItems(simulation, rangeWindow);
    }

    function getNiceDepositScaleMax(value) {
      if (!Number.isFinite(value) || value <= 0) {
        return 1;
      }

      const padded = value * 1.12;
      const magnitude = Math.pow(10, Math.floor(Math.log10(padded)));
      const normalized = padded / magnitude;
      let nice = 10;

      if (normalized <= 1) {
        nice = 1;
      } else if (normalized <= 2) {
        nice = 2;
      } else if (normalized <= 5) {
        nice = 5;
      }

      return nice * magnitude;
    }

    function formatMinuteOfDay(minute) {
      const safeMinute = clampNumber(Math.round(minute || 0), 0, (24 * 60) - 1);
      const hour = Math.floor(safeMinute / 60);
      const minuteInHour = safeMinute - (hour * 60);
      return String(hour).padStart(2, "0") + ":" + String(minuteInHour).padStart(2, "0");
    }

    function getDepositThemeColor(variableName, fallback) {
      const value = getComputedStyle(depositPage).getPropertyValue(variableName).trim();
      return value || fallback;
    }

    function getDepositThemeTokens() {
      return {
        text: getDepositThemeColor("--usage-ink", "#1A1A1A"),
        gridLine: getDepositThemeColor("--usage-chart-grid", "rgba(26, 26, 26, 0.10)"),
        pointerShadow: getDepositThemeColor("--usage-chart-grid", "rgba(176, 187, 213, 0.10)")
      };
    }

    function getDepositWindowOrigin(range) {
      return range === "week" ? "end" : "start";
    }

    function getDepositDefaultWindow(range, length) {
      if (range === "month" || range === "year") {
        return Math.max(length, 1);
      }
      return Math.min(DEPOSIT_RANGE_DEFAULT_WINDOW[range] || length, Math.max(length, 1));
    }

    function getDepositMinWindow(range, length) {
      return Math.min(DEPOSIT_RANGE_MIN_WINDOW[range] || 1, Math.max(length, 1));
    }

    function getDepositSymmetricAxisConfig(value, minimum) {
      const maxValue = Math.max(getNiceDepositScaleMax(Math.max(Number(value) || 0, minimum || 1)), minimum || 1);
      const splitCount = 6;
      return {
        min: -maxValue,
        max: maxValue,
        interval: (maxValue * 2) / splitCount,
        splitNumber: splitCount
      };
    }

    function formatDepositAxisTick(value) {
      if (Math.abs(value) < 0.000001) {
        return "0,00";
      }

      return value > 0
        ? "+ " + formatDecimal(value, 2)
        : "- " + formatDecimal(Math.abs(value), 2);
    }

    function getDepositTooltipTotals(items) {
      return items.reduce(function (totals, item) {
        totals.saleEnergy += Math.max(0, firstNumber(item && item.saleKwh, 0) || 0);
        totals.saleValue += Math.max(0, firstNumber(item && item.saleValuePln, 0) || 0);
        totals.purchaseEnergy += Math.max(0, firstNumber(item && item.purchaseKwh, 0) || 0);
        totals.purchaseValue += Math.max(0, firstNumber(item && item.purchaseValuePln, 0) || 0);
        return totals;
      }, {
        saleEnergy: 0,
        saleValue: 0,
        purchaseEnergy: 0,
        purchaseValue: 0
      });
    }

    function getDepositTooltipMode(item) {
      const saleValue = Math.max(0, firstNumber(item && item.saleValuePln, 0) || 0);
      const purchaseValue = Math.max(0, firstNumber(item && item.purchaseValuePln, 0) || 0);
      const saleKwh = Math.max(0, firstNumber(item && item.saleKwh, 0) || 0);
      const purchaseKwh = Math.max(0, firstNumber(item && item.purchaseKwh, 0) || 0);

      return purchaseValue > saleValue || (purchaseValue === saleValue && purchaseKwh > saleKwh)
        ? "purchase"
        : "sale";
    }

    function positionDepositChartTooltip(point, params, dom, rect, size) {
      const viewSize = size && Array.isArray(size.viewSize)
        ? size.viewSize
        : [chartEl ? chartEl.clientWidth : 0, chartEl ? chartEl.clientHeight : 0];
      const rawContentSize = size && Array.isArray(size.contentSize) ? size.contentSize : [0, 0];
      const measuredTooltip = dom && dom.querySelector ? dom.querySelector(".deposit-detail-tooltip") : null;
      const isTotalValueMode = state.chartMode === "total";
      const contentSize = [
        Math.max(rawContentSize[0] || 0, dom && dom.offsetWidth ? dom.offsetWidth : 0, measuredTooltip && measuredTooltip.offsetWidth ? measuredTooltip.offsetWidth : 0, 300),
        Math.max(rawContentSize[1] || 0, dom && dom.offsetHeight ? dom.offsetHeight : 0, measuredTooltip && measuredTooltip.offsetHeight ? measuredTooltip.offsetHeight : 0, isTotalValueMode ? 120 : 220)
      ];
      const margin = 12;
      const gap = 18;
      const viewWidth = Math.max(viewSize[0] || 0, contentSize[0] + (margin * 2));
      const viewHeight = Math.max(viewSize[1] || 0, contentSize[1] + (margin * 2));
      const pointX = Array.isArray(point) ? point[0] : 0;
      const pointY = Array.isArray(point) ? point[1] : 0;
      const maxLeft = Math.max(margin, viewWidth - contentSize[0] - margin);
      const maxTop = Math.max(margin, viewHeight - contentSize[1] - margin);
      let left = pointX + gap;
      let top = pointY - contentSize[1] - gap;

      if (left + contentSize[0] + margin > viewWidth) {
        left = pointX - contentSize[0] - gap;
      }
      if (top < margin) {
        top = pointY + gap;
      }
      if (top + contentSize[1] + margin > viewHeight) {
        top = pointY - contentSize[1] - gap;
      }

      return [
        clampNumber(left, margin, maxLeft),
        clampNumber(top, margin, maxTop)
      ];
    }

    function ensureDepositEchart() {
      if (!chartEl || !window.echarts || !chartEl.offsetWidth || !chartEl.offsetHeight) {
        return null;
      }

      if (state.chart) {
        return state.chart;
      }

      state.chart = window.echarts.init(chartEl, null, {
        renderer: "canvas",
        useCoarsePointer: true,
        pointerSize: 14
      });

      state.chart.on("datazoom", function () {
        syncDepositWindowCount();
        requestAnimationFrame(renderDepositSunMarkersEcharts);
      });

      state.chart.on("click", function (params) {
        if (params.componentType !== "series" || typeof params.dataIndex !== "number") {
          return;
        }

        const target = getDashboardChartDrilldownTarget(
          state.range,
          state.anchorDate,
          state.items[params.dataIndex],
          params.dataIndex
        );
        if (!target) {
          return;
        }

        state.range = target.range;
        state.anchorDate = clampDashboardNavigationDate(target.anchorDate, state.range);
        state.anchorTouched = true;
        state.windowOrigin = getDepositWindowOrigin(state.range);
        state.windowStartIndex = null;
        state.windowCount = null;
        updateToolbar();
        applyPayload();
      });

      if (typeof window.onRevoltCreateCurrentHourHighlighter === "function") {
        currentHourHighlighter = window.onRevoltCreateCurrentHourHighlighter({
          chart: state.chart,
          element: chartEl,
          getItems: function () { return state.items; },
          getRange: function () { return state.range; },
          getAnchorDate: function () { return state.anchorDate; }
        });
      }

      return state.chart;
    }

    function renderDepositEnergyStep(params, api) {
      const coordSys = params && params.coordSys ? params.coordSys : null;
      const values = state.depositStepValues || [];
      if (!coordSys || !values.length) {
        return null;
      }

      const centers = values.map(function (_, index) {
        return api.coord([index, 0])[0];
      });
      const linePoints = [];
      let previousY = null;

      values.forEach(function (value, index) {
        if (value == null) {
          previousY = null;
          return;
        }

        const point = api.coord([index, value]);
        const centerX = point[0];
        const y = point[1];
        const leftNeighbor = centers[index - 1];
        const rightNeighbor = centers[index + 1];
        const fallbackSlotWidth = Math.max(DEPOSIT_BAR_WIDTH, coordSys.width / Math.max(values.length, 1));
        const startX = Math.max(
          coordSys.x,
          leftNeighbor == null ? centerX - (fallbackSlotWidth / 2) : (leftNeighbor + centerX) / 2
        );
        const endX = Math.min(
          coordSys.x + coordSys.width,
          rightNeighbor == null ? centerX + (fallbackSlotWidth / 2) : (centerX + rightNeighbor) / 2
        );

        if (!linePoints.length || previousY == null) {
          linePoints.push([startX, y]);
        } else {
          linePoints.push([startX, previousY], [startX, y]);
        }

        linePoints.push([endX, y]);
        previousY = y;
      });

      return linePoints.length > 1 ? {
        type: "polyline",
        shape: {
          points: linePoints
        },
        style: {
          fill: null,
          stroke: DEPOSIT_COLORS.energy,
          lineWidth: 3,
          lineCap: "round",
          lineJoin: "round",
          opacity: (state.depositStepForecast || []).some(function (value) { return value; }) ? 0.4 : 1
        },
        silent: true
      } : null;
    }

    function getDepositBarData(items, mode) {
      return items.map(function (item) {
        const value = mode === "purchase"
          ? Math.max(0, firstNumber(item && item.purchaseValuePln, 0) || 0)
          : Math.max(0, firstNumber(item && item.saleValuePln, 0) || 0);

        if (value <= 0) {
          return {
            value: null
          };
        }

        return {
          value: mode === "purchase" ? -value : value,
          itemStyle: {
            color: mode === "purchase" ? DEPOSIT_COLORS.purchaseValue : DEPOSIT_COLORS.saleValue,
            borderRadius: mode === "purchase"
              ? [0, 0, DEPOSIT_BAR_RADIUS, DEPOSIT_BAR_RADIUS]
              : [DEPOSIT_BAR_RADIUS, DEPOSIT_BAR_RADIUS, 0, 0]
          }
        };
      });
    }

    function getDepositShiftedBarData(items, mode) {
      return items.map(function (item, index) {
        const value = mode === "purchase"
          ? Math.max(0, firstNumber(item && item.purchaseValuePln, 0) || 0)
          : Math.max(0, firstNumber(item && item.saleValuePln, 0) || 0);

        return [
          index,
          mode === "purchase" ? -value : value,
          item && item.isForecast ? 0.4 : 1
        ];
      });
    }

    function renderDepositShiftedBar(params, api) {
      const coordSys = params && params.coordSys ? params.coordSys : null;
      const value = Number(api.value(1) || 0);
      if (!coordSys || Math.abs(value) < 0.000001) {
        return null;
      }

      const shiftedIndex = Number(api.value(0) || 0) + (state.range === "day" ? 0.5 : 0);
      const basePoint = api.coord([shiftedIndex, 0]);
      const valuePoint = api.coord([shiftedIndex, value]);
      const width = state.range === "day" ? DEPOSIT_BAR_WIDTH : DEPOSIT_RANGE_BAR_WIDTH;
      const rawHeight = Math.abs(basePoint[1] - valuePoint[1]);
      const height = Math.max(2, rawHeight);
      const shape = {
        x: basePoint[0] - (width / 2),
        y: value >= 0 ? basePoint[1] - height : basePoint[1],
        width: width,
        height: height,
        r: value >= 0
          ? [DEPOSIT_BAR_RADIUS, DEPOSIT_BAR_RADIUS, 0, 0]
          : [0, 0, DEPOSIT_BAR_RADIUS, DEPOSIT_BAR_RADIUS]
      };
      const clippedShape = window.echarts && window.echarts.graphic
        ? window.echarts.graphic.clipRectByRect(shape, {
          x: coordSys.x,
          y: coordSys.y,
          width: coordSys.width,
          height: coordSys.height
        })
        : shape;

      if (!clippedShape) {
        return null;
      }

      clippedShape.r = shape.r;
      return {
        type: "rect",
        shape: clippedShape,
        style: {
          fill: value < 0 ? DEPOSIT_COLORS.purchaseValue : DEPOSIT_COLORS.saleValue,
          opacity: firstNumber(api.value(2), 1)
        }
      };
    }

    function getDepositPositiveAxisConfig(value) {
      const maxValue = Math.max(0, Number(value) || 0);
      if (maxValue <= 0) {
        return { min: 0, max: 1, interval: 0.2, splitNumber: 5 };
      }

      const rawStep = maxValue / 6;
      const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
      const normalized = rawStep / magnitude;
      const normalizedStep = normalized <= 1 ? 1 : (normalized <= 2 ? 2 : (normalized <= 5 ? 5 : 10));
      const interval = normalizedStep * magnitude;
      const axisMax = (Math.ceil(maxValue / interval) + 1) * interval;

      return {
        min: 0,
        max: axisMax,
        interval: interval,
        splitNumber: Math.max(2, Math.round(axisMax / interval))
      };
    }

    function formatDepositTotalAxisTick(value) {
      return Number(value || 0).toLocaleString("pl-PL", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    function isDepositTotalValueForecast(item) {
      if (!window.dashboardReForecastEnabled) {
        return false;
      }

      const key = String(item && item.key ? item.key : "");
      const todayKey = formatDateKey(new Date());
      if (state.range === "year") {
        return key >= todayKey.slice(0, 7);
      }
      if (state.range !== "day") {
        return key >= todayKey;
      }

      const dateKey = key.slice(0, 10);
      if (dateKey < todayKey) {
        return false;
      }
      if (dateKey > todayKey) {
        return true;
      }

      const hourMatch = key.match(/-h(\d{1,2})$/);
      const hour = hourMatch ? Number(hourMatch[1]) : Number(String(item && item.label || "").slice(0, 2));
      return Number.isFinite(hour) && hour > new Date().getHours();
    }

    function getDepositTotalValueBarData(items) {
      return items.map(function (item) {
        const isForecast = isDepositTotalValueForecast(item);
        return {
          value: Math.max(0, firstNumber(item && item.depositPln, 0) || 0),
          itemStyle: {
            color: isForecast ? DEPOSIT_COLORS.totalForecast : DEPOSIT_COLORS.totalActual,
            borderRadius: [DEPOSIT_BAR_RADIUS, DEPOSIT_BAR_RADIUS, 0, 0]
          }
        };
      });
    }

    function buildDepositTotalValueEchartOption(items) {
      const isWeekRange = state.range === "week";
      const theme = getDepositThemeTokens();
      const labels = items.map(function (item) { return item.label; });
      const maxDepositPln = items.reduce(function (currentMax, item) {
        return Math.max(currentMax, Math.max(0, firstNumber(item && item.depositPln, 0) || 0));
      }, 0);
      const axisConfig = getDepositPositiveAxisConfig(maxDepositPln);

      return {
        animationDuration: 300,
        animationDurationUpdate: 260,
        grid: {
          top: 18,
          right: 54,
          bottom: isWeekRange ? 58 : 44,
          left: 54,
          containLabel: true
        },
        tooltip: {
          trigger: "axis",
          axisPointer: {
            type: "shadow",
            shadowStyle: {
              color: theme.pointerShadow
            }
          },
          backgroundColor: "transparent",
          borderWidth: 0,
          padding: 0,
          extraCssText: "box-shadow:none;",
          position: positionDepositChartTooltip,
          formatter: function (params) {
            const tooltipParam = Array.isArray(params)
              ? params.find(function (param) { return param && typeof param.dataIndex === "number"; })
              : params;
            const item = tooltipParam && typeof tooltipParam.dataIndex === "number"
              ? items[tooltipParam.dataIndex]
              : null;

            return item
              ? "<div class=\"pv-chart-tooltip deposit-detail-tooltip deposit-detail-tooltip--total\">" +
                getDepositTotalValueTooltipContent(item) + "</div>"
              : "";
          }
        },
        xAxis: {
          type: "category",
          data: labels,
          axisTick: { show: false },
          axisLine: { show: false },
          boundaryGap: true,
          axisLabel: {
            color: theme.text,
            fontSize: 14,
            lineHeight: 20,
            margin: isWeekRange ? 18 : 14,
            interval: 0
          }
        },
        yAxis: {
          type: "value",
          min: axisConfig.min,
          max: axisConfig.max,
          interval: axisConfig.interval,
          splitNumber: axisConfig.splitNumber,
          axisTick: { show: false },
          axisLine: { show: false },
          axisLabel: {
            color: theme.text,
            fontSize: 14,
            margin: 12,
            formatter: formatDepositTotalAxisTick
          },
          splitLine: {
            lineStyle: {
              color: theme.gridLine,
              width: 1
            }
          }
        },
        dataZoom: [
          {
            id: "deposit-inside",
            type: "inside",
            xAxisIndex: 0,
            filterMode: "none",
            zoomOnMouseWheel: false,
            moveOnMouseWheel: false,
            moveOnMouseMove: true,
            preventDefaultMouseMove: false
          },
          {
            id: "deposit-slider",
            type: "slider",
            show: false,
            xAxisIndex: 0,
            filterMode: "none"
          }
        ],
        series: [
          {
            name: "Całkowita wartość depozytu",
            type: "bar",
            data: getDepositTotalValueBarData(items),
            barWidth: state.range === "day" ? DEPOSIT_BAR_WIDTH : DEPOSIT_RANGE_BAR_WIDTH,
            z: 2
          }
        ]
      };
    }

    function buildDepositEchartOption(items) {
      if (state.chartMode === "total") {
        return buildDepositTotalValueEchartOption(items);
      }

      const isWeekRange = state.range === "week";
      const theme = getDepositThemeTokens();
      const labels = items.map(function (item) { return item.label; });
      let runningDepositEnergyKwh = 0;
      const energyValues = items.map(function (item) {
        runningDepositEnergyKwh += Math.max(0, firstNumber(item && item.saleKwh, 0) || 0);
        runningDepositEnergyKwh -= Math.max(0, firstNumber(item && item.purchaseKwh, 0) || 0);
        return runningDepositEnergyKwh;
      });
      const maxValuePln = items.reduce(function (currentMax, item) {
        return Math.max(
          currentMax,
          Math.max(0, firstNumber(item && item.saleValuePln, 0) || 0),
          Math.max(0, firstNumber(item && item.purchaseValuePln, 0) || 0)
        );
      }, 0);
      const maxEnergyKwh = energyValues.reduce(function (currentMax, value) {
        return Math.max(currentMax, Math.abs(value || 0));
      }, 0);
      const valueAxisConfig = getDepositSymmetricAxisConfig(maxValuePln, 1);
      const energyAxisConfig = getDepositSymmetricAxisConfig(maxEnergyKwh, 1);
      const tooltipTotals = getDepositTooltipTotals(items);

      state.depositStepValues = energyValues;
      state.depositStepForecast = items.map(function (item) { return !!(item && item.isForecast); });

      return {
        animationDuration: 300,
        animationDurationUpdate: 260,
        grid: {
          top: 18,
          right: 54,
          bottom: isWeekRange ? 58 : 44,
          left: 54,
          containLabel: true
        },
        tooltip: {
          trigger: "axis",
          axisPointer: {
            type: "shadow",
            shadowStyle: {
              color: theme.pointerShadow
            }
          },
          backgroundColor: "transparent",
          borderWidth: 0,
          padding: 0,
          extraCssText: "box-shadow:none;",
          position: positionDepositChartTooltip,
          formatter: function (params) {
            const tooltipParam = Array.isArray(params)
              ? params.find(function (param) { return param && typeof param.dataIndex === "number"; })
              : params;
            const item = tooltipParam && typeof tooltipParam.dataIndex === "number"
              ? items[tooltipParam.dataIndex]
              : null;

            if (!item) {
              return "";
            }

            const mode = getDepositTooltipMode(item);

            return [
              "<div class=\"pv-chart-tooltip deposit-detail-tooltip" + (state.range !== "day" ? " deposit-detail-tooltip--range" : "") + "\">",
              getDepositTooltipContent(item, mode, tooltipTotals),
              "</div>"
            ].join("");
          }
        },
        xAxis: {
          type: "category",
          data: labels,
          axisTick: { show: false },
          axisLine: { show: false },
          boundaryGap: true,
          axisLabel: {
            color: theme.text,
            fontSize: 14,
            lineHeight: 20,
            margin: isWeekRange ? 18 : 14,
            interval: 0
          }
        },
        yAxis: [
          {
            type: "value",
            min: valueAxisConfig.min,
            max: valueAxisConfig.max,
            interval: valueAxisConfig.interval,
            splitNumber: valueAxisConfig.splitNumber,
            axisTick: { show: false },
            axisLine: { show: false },
            axisLabel: {
              color: theme.text,
              fontSize: 14,
              margin: 12,
              formatter: formatDepositAxisTick
            },
            splitLine: {
              lineStyle: {
                color: theme.gridLine,
                width: 1
              }
            }
          },
          {
            type: "value",
            min: energyAxisConfig.min,
            max: energyAxisConfig.max,
            interval: energyAxisConfig.interval,
            splitNumber: energyAxisConfig.splitNumber,
            axisTick: { show: false },
            axisLine: { show: false },
            axisLabel: {
              color: theme.text,
              fontSize: 14,
              margin: 12,
              formatter: formatDepositAxisTick
            },
            splitLine: {
              show: false
            }
          }
        ],
        dataZoom: [
          {
            id: "deposit-inside",
            type: "inside",
            xAxisIndex: 0,
            filterMode: "none",
            zoomOnMouseWheel: false,
            moveOnMouseWheel: false,
            moveOnMouseMove: true,
            preventDefaultMouseMove: false
          },
          {
            id: "deposit-slider",
            type: "slider",
            show: false,
            xAxisIndex: 0,
            filterMode: "none"
          }
        ],
        series: [
          {
            name: "Energia depozytu",
            type: "custom",
            yAxisIndex: 1,
            data: [[0, 0]],
            renderItem: renderDepositEnergyStep,
            clip: true,
            z: 4,
            silent: true
          },
          {
            name: "Warto\u015b\u0107 dopisana",
            type: "custom",
            data: getDepositShiftedBarData(items, "sale"),
            renderItem: renderDepositShiftedBar,
            encode: { x: 0, y: 1 },
            yAxisIndex: 0,
            clip: true,
            z: 2
          },
          {
            name: "Warto\u015b\u0107 wykorzystana",
            type: "custom",
            data: getDepositShiftedBarData(items, "purchase"),
            renderItem: renderDepositShiftedBar,
            encode: { x: 0, y: 1 },
            yAxisIndex: 0,
            clip: true,
            z: 2
          }
        ]
      };
    }

    function getDepositDayMarkerIndex(minute) {
      const normalizedMinute = clampNumber(Math.round(minute == null ? 0 : minute), 0, (24 * 60) - 1);
      const hour = Math.floor(normalizedMinute / 60);
      const minuteInHour = normalizedMinute - (hour * 60);
      return hour + (minuteInHour / 60);
    }

    function renderDepositSunMarkersEcharts() {
      if (!sunMarkersEl) {
        return;
      }

      sunMarkersEl.innerHTML = "";

      if (state.range !== "day" || !state.chart || !state.items.length) {
        sunMarkersEl.hidden = true;
        return;
      }

      [
        {
          type: "sunrise",
          label: "Wsch\u00f3d s\u0142o\u0144ca",
          minute: 6 * 60,
          icon: "images/icons/sunrise.svg"
        },
        {
          type: "sunset",
          label: "Zach\u00f3d s\u0142o\u0144ca",
          minute: 20 * 60,
          icon: "images/icons/sunset.svg"
        }
      ].forEach(function (marker) {
        const position = state.chart.convertToPixel({ xAxisIndex: 0 }, getDepositDayMarkerIndex(marker.minute));
        if (!Number.isFinite(position) || position < -20 || position > chartEl.clientWidth + 20) {
          return;
        }

        const element = document.createElement("span");
        const clock = formatMinuteOfDay(marker.minute);

        element.className = "pv-sun-marker deposit-sun-marker deposit-sun-marker--" + marker.type;
        element.style.left = position + "px";
        element.style.backgroundImage = "url('" + marker.icon + "')";
        element.title = marker.label + ": " + clock;
        element.setAttribute("aria-label", element.title);
        sunMarkersEl.appendChild(element);
      });

      sunMarkersEl.hidden = !sunMarkersEl.children.length;
    }

    function applyDepositZoomWindow() {
      if (!state.chart || !state.items.length) {
        return;
      }

      const fullLength = state.items.length;
      const maxStartIndex = Math.max(fullLength - state.windowCount, 0);
      const startValue = state.windowStartIndex != null
        ? clampNumber(state.windowStartIndex, 0, maxStartIndex)
        : (state.windowOrigin === "start" ? 0 : Math.max(0, fullLength - state.windowCount));
      const endValue = Math.min(fullLength - 1, startValue + state.windowCount - 1);

      state.chart.dispatchAction({
        type: "dataZoom",
        dataZoomId: "deposit-inside",
        startValue: startValue,
        endValue: endValue
      });
    }

    function syncDepositWindowCount() {
      if (!state.chart || !state.items.length) {
        return;
      }

      const option = state.chart.getOption();
      const zoomState = option.dataZoom && option.dataZoom[0];
      if (!zoomState) {
        return;
      }

      const startValue = typeof zoomState.startValue === "number" ? zoomState.startValue : 0;
      const endValue = typeof zoomState.endValue === "number" ? zoomState.endValue : state.items.length - 1;

      state.windowStartIndex = startValue;
      state.windowCount = clampNumber(
        (endValue - startValue) + 1,
        getDepositMinWindow(state.range, state.items.length),
        state.items.length
      );
    }

    function renderDepositChartEcharts(items, emptyMessage) {
      state.items = Array.isArray(items) ? items : [];

      if (!chartEl || !chartShellEl) {
        return;
      }

      if (!state.items.length) {
        chartShellEl.classList.add("is-empty");
        if (state.chart) {
          state.chart.clear();
        } else {
          chartEl.innerHTML = "";
        }
        if (chartCaptionEl) {
          chartCaptionEl.textContent = emptyMessage || "Brak danych depozytu prosumenckiego dla wybranego zakresu.";
        }
        renderDepositSunMarkersEcharts();
        if (currentHourHighlighter) {
          currentHourHighlighter.update();
        }
        return;
      }

      chartShellEl.classList.remove("is-empty");

      const chart = ensureDepositEchart();
      if (!chart) {
        return;
      }

      state.windowCount = clampNumber(
        state.windowCount || getDepositDefaultWindow(state.range, state.items.length),
        getDepositMinWindow(state.range, state.items.length),
        Math.max(state.items.length, 1)
      );
      state.windowStartIndex = state.windowStartIndex == null
        ? null
        : clampNumber(state.windowStartIndex, 0, Math.max(state.items.length - state.windowCount, 0));

      try {
        chart.setOption(buildDepositEchartOption(state.items), true);
      } catch (error) {
        console.error("Deposit ECharts render failed:", error);
        chartShellEl.classList.add("is-empty");
        if (chartCaptionEl) {
          chartCaptionEl.textContent = "B\u0142\u0105d renderowania wykresu depozytu prosumenckiego.";
        }
        return;
      }

      applyDepositZoomWindow();
      requestAnimationFrame(renderDepositSunMarkersEcharts);
      if (currentHourHighlighter) {
        currentHourHighlighter.update();
      }
    }

    function zoomDepositChart(direction) {
      if (!state.items.length) {
        return;
      }

      const minWindow = getDepositMinWindow(state.range, state.items.length);
      const currentStart = state.windowStartIndex == null
        ? (state.windowOrigin === "start" ? 0 : Math.max(0, state.items.length - state.windowCount))
        : state.windowStartIndex;
      const currentEnd = Math.min(state.items.length - 1, currentStart + state.windowCount - 1);
      const currentCenter = currentStart + ((currentEnd - currentStart) / 2);
      const targetWindow = state.range === "day"
        ? window.onRevoltDayZoom.nextHours(state.windowCount, direction)
        : direction > 0
        ? Math.max(minWindow, Math.round(state.windowCount * 0.8))
        : Math.min(state.items.length, Math.round(state.windowCount * 1.25));

      state.windowCount = clampNumber(targetWindow, minWindow, state.items.length);
      state.windowStartIndex = clampNumber(
        Math.round(currentCenter - ((state.windowCount - 1) / 2)),
        0,
        Math.max(state.items.length - state.windowCount, 0)
      );
      applyDepositZoomWindow();
      requestAnimationFrame(renderDepositSunMarkersEcharts);
    }

    function resetDepositZoomWindow() {
      if (!state.items.length) {
        return;
      }

      state.windowOrigin = getDepositWindowOrigin(state.range);
      state.windowStartIndex = null;
      state.windowCount = state.windowOrigin === "start"
        ? state.items.length
        : getDepositDefaultWindow(state.range, state.items.length);
      applyDepositZoomWindow();
      requestAnimationFrame(renderDepositSunMarkersEcharts);
    }

    function jumpToLatestDepositDay() {
      state.range = "day";
      state.anchorDate = getDashboardNavigationDay(new Date());
      state.anchorTouched = true;
      state.anchorSourceKey = formatDateKey(state.anchorDate);
      state.windowOrigin = getDepositWindowOrigin(state.range);
      state.windowStartIndex = null;
      state.windowCount = null;
      updateToolbar();
      applyPayload();
    }

    function estimateDepositCoveredKwhFromSimulation(simulation, rangeWindow) {
      if (!simulation || !Array.isArray(simulation.days) || !rangeWindow) {
        return null;
      }

      const startKey = formatDateKey(rangeWindow.start);
      const endKey = formatDateKey(rangeWindow.end);
      let coveredKwh = 0;
      let hasDepositUse = false;

      simulation.days.forEach(function (day) {
        if (!day || day.dateKey < startKey || day.dateKey > endKey) {
          return;
        }

        (day.hours || []).forEach(function (hourEntry) {
          const usedPln = firstNumber(hourEntry && hourEntry.depositUsedPln, 0) || 0;
          const energyPrice = firstNumber(hourEntry && hourEntry.energyBuyPricePln);
          if (usedPln <= 0 || !energyPrice || energyPrice <= 0) {
            return;
          }

          coveredKwh += usedPln / energyPrice;
          hasDepositUse = true;
        });
      });

      return hasDepositUse ? coveredKwh : null;
    }

    function getBreakdown(payload, rangeWindow) {
      const simulation = window.dashboardProsumerSimulation || window.dashboardBankSimulation;
      const useForecastSimulation = !!(window.dashboardReForecastEnabled && simulation && simulation.isForecast);
      const measuredBreakdown = getMeasuredBreakdown(payload, rangeWindow);
      if (measuredBreakdown && (!useForecastSimulation || isDepositRangeFullyMeasured(payload, rangeWindow))) {
        return measuredBreakdown;
      }

      const rangeTotals = simulation && typeof simulation.getRangeTotals === "function"
        ? simulation.getRangeTotals(rangeWindow)
        : null;
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const salePricePln = firstNumber(rawEnergy.salePricePln, rawEnergy.salePrice, energy.salePricePln);
      if (rangeTotals) {
        const endKey = formatDateKey(rangeWindow.end);
        const latestDay = simulation && simulation.dayMap ? simulation.dayMap[endKey] : null;
        const referenceSalePricePln = firstNumber(
          latestDay && latestDay.hours && latestDay.hours.length ? latestDay.hours[latestDay.hours.length - 1].sellPricePln : null,
          salePricePln
        );
        const depositWorthPln = firstNumber(rangeTotals.endDepositPln, simulation && simulation.latestDepositPln);
        const saleKwh = firstNumber(rangeTotals.totals && rangeTotals.totals.exportKwh);
        const saleValuePln = firstNumber(
          rangeTotals.totals && ((rangeTotals.totals.soldImmediatePln || 0) + (rangeTotals.totals.soldBankPln || 0))
        );
        const purchaseValuePln = firstNumber(rangeTotals.totals && rangeTotals.totals.depositUsedPln);
        const purchaseKwh = firstNumber(
          estimateDepositCoveredKwhFromSimulation(simulation, rangeWindow),
          rangeTotals.totals && rangeTotals.totals.gridPurchaseKwh
        );
        return {
          depositKwh: depositWorthPln != null && referenceSalePricePln
            ? depositWorthPln / referenceSalePricePln
            : null,
          currentDepositPln: depositWorthPln,
          depositChangePln: firstNumber(
            rangeTotals.totals && ((rangeTotals.totals.depositEarnedPln || 0) - (rangeTotals.totals.depositUsedPln || 0)),
            rangeTotals.endDepositPln != null && rangeTotals.startDepositPln != null
              ? rangeTotals.endDepositPln - rangeTotals.startDepositPln
              : null
          ),
          depositWorthPln: depositWorthPln,
          saleKwh: saleKwh,
          saleValuePln: saleValuePln,
          saleAveragePricePln: saleKwh > 0 && saleValuePln != null ? saleValuePln / saleKwh : null,
          purchaseKwh: purchaseKwh,
          purchaseValuePln: purchaseValuePln,
          purchaseAveragePricePln: purchaseKwh > 0 && purchaseValuePln != null ? purchaseValuePln / purchaseKwh : null
        };
      }

      const purchasePricePln = firstNumber(rawEnergy.purchasePricePln, rawEnergy.purchasePrice, energy.purchasePricePln);
      const depositKwh = firstNumber(
        rawEnergy.depositKwh,
        rawEnergy.depozytKwh,
        rawEnergy.prosumerDepositKwh,
        energy.depositKwh
      );
      const depositWorthPln = firstNumber(
        rawEnergy.depositValuePln,
        rawEnergy.depositWorthPln,
        rawEnergy.depositPln,
        rawEnergy.wartoscDepozytuPln,
        energy.depositValuePln,
        depositKwh != null && salePricePln != null ? depositKwh * salePricePln : null
      );
      const saleKwh = firstNumber(
        rawEnergy.saleEnergyKwh,
        rawEnergy.saleKwh,
        rawEnergy.soldEnergyKwh,
        rawEnergy.exportedEnergyKwh,
        rawEnergy.exportKwh,
        rawEnergy.oddaneKwh,
        energy.productionKwh != null && energy.usageKwh != null
          ? Math.max(energy.productionKwh - energy.usageKwh, 0)
          : null
      );
      const saleValuePln = firstNumber(
        rawEnergy.saleValuePln,
        rawEnergy.soldValuePln,
        rawEnergy.saleRevenuePln,
        rawEnergy.exportValuePln,
        rawEnergy.przychodSprzedazyPln,
        saleKwh != null && salePricePln != null ? saleKwh * salePricePln : null
      );
      const purchaseKwh = firstNumber(
        rawEnergy.purchaseEnergyKwh,
        rawEnergy.purchaseKwh,
        rawEnergy.importKwh,
        rawEnergy.importEnergyKwh,
        rawEnergy.boughtEnergyKwh,
        rawEnergy.poborKwh,
        energy.totalImportKwh,
        energy.usageKwh != null && energy.productionKwh != null
          ? Math.max(energy.usageKwh - energy.productionKwh, 0)
          : null
      );
      const purchaseValuePln = firstNumber(
        rawEnergy.purchaseValuePln,
        rawEnergy.importValuePln,
        rawEnergy.boughtValuePln,
        rawEnergy.kosztZakupuPln,
        energy.dailyBillPln,
        purchaseKwh != null && purchasePricePln != null ? purchaseKwh * purchasePricePln : null
      );

      return {
        depositKwh: depositKwh,
        currentDepositPln: depositWorthPln,
        depositChangePln: firstNumber(
          saleValuePln != null || purchaseValuePln != null
            ? (saleValuePln || 0) - (purchaseValuePln || 0)
            : null
        ),
        depositWorthPln: depositWorthPln,
        saleKwh: saleKwh,
        saleValuePln: saleValuePln,
        saleAveragePricePln: saleKwh > 0 && saleValuePln != null ? saleValuePln / saleKwh : null,
        purchaseKwh: purchaseKwh,
        purchaseValuePln: purchaseValuePln,
        purchaseAveragePricePln: purchaseKwh > 0 && purchaseValuePln != null ? purchaseValuePln / purchaseKwh : null
      };
    }

    function getCurrentDepositPln(payload, simulation, fallbackBreakdown) {
      const latestMeasuredDate = isRealDashboardDataMode(payload) ? getMeasuredPayloadAnchorDate(payload) : null;
      if (latestMeasuredDate) {
        const latestLedger = buildMeasuredDepositLedger(payload, {
          start: latestMeasuredDate,
          end: latestMeasuredDate
        });

        if (latestLedger && latestLedger.totals && latestLedger.totals.endBalancePln != null) {
          return latestLedger.totals.endBalancePln;
        }
      }

      if (simulation) {
        const days = Array.isArray(simulation.days) ? simulation.days : [];
        const lastDay = days.length ? days[days.length - 1] : null;
        return firstNumber(
          simulation.latestDepositPln,
          lastDay && lastDay.endDepositPln,
          simulation.endDepositPln
        );
      }

      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      return firstNumber(
        rawEnergy.depositValuePln,
        rawEnergy.depositWorthPln,
        rawEnergy.depositPln,
        rawEnergy.wartoscDepozytuPln,
        energy.depositValuePln,
        fallbackBreakdown && fallbackBreakdown.currentDepositPln,
        fallbackBreakdown && fallbackBreakdown.depositWorthPln
      );
    }

    const state = {
      range: "day",
      chartMode: "flow",
      anchorDate: new Date(),
      anchorSourceKey: "",
      anchorTouched: false,
      chart: null,
      items: [],
      depositStepValues: [],
      windowOrigin: "start",
      windowStartIndex: null,
      windowCount: null
    };

    function updateDepositChartModeUi() {
      const totalValueMode = state.chartMode === "total";
      depositPage.classList.toggle("is-total-value-mode", totalValueMode);
      if (totalValueButton) {
        totalValueButton.classList.toggle("is-active", totalValueMode);
        totalValueButton.setAttribute("aria-pressed", totalValueMode ? "true" : "false");
      }
      if (depositKwhUnitEl) {
        depositKwhUnitEl.hidden = totalValueMode;
      }
      if (chartEl) {
        chartEl.setAttribute(
          "aria-label",
          totalValueMode ? "Wykres całkowitej wartości depozytu" : "Wykres depozytu prosumenckiego"
        );
      }
    }

    function updateToolbar() {
      const anchorDate = state.anchorDate;
      let label = formatLongDate(anchorDate);

      if (state.range === "week") {
        label = formatWeekLabel(anchorDate);
      } else if (state.range === "month") {
        label = formatMonthLabel(anchorDate);
      } else if (state.range === "year") {
        label = formatYearLabel(anchorDate);
      }

      if (breadcrumbRangeEl) {
        breadcrumbRangeEl.textContent = formatRangeName(state.range);
      }

      if (rangeLabelEl) {
        rangeLabelEl.textContent = label;
        window.DashboardCalendar.sync(rangeLabelEl, {
          date: state.anchorDate, range: state.range,
          clamp: function (date) { return clampDashboardNavigationDate(date, state.range); },
          select: function (date) {
            state.anchorTouched = true;
            state.anchorDate = clampDashboardNavigationDate(date, state.range);
            state.windowStartIndex = null;
            updateToolbar();
            applyPayload();
          }
        });
      }

      rangeButtons.forEach(function (button) {
        const isActive = button.getAttribute("data-deposit-range") === state.range;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });

      updateDashboardShiftButtons(shiftButtons, state.range, state.anchorDate, "data-deposit-shift");
    }

    function shiftRange(step) {
      state.anchorTouched = true;
      let nextDate = new Date(state.anchorDate);
      if (state.range === "week") {
        nextDate = addDays(state.anchorDate, step * 7);
      } else if (state.range === "month") {
        nextDate = addMonths(state.anchorDate, step);
      } else if (state.range === "year") {
        nextDate = addYears(state.anchorDate, step);
      } else {
        nextDate = addDays(state.anchorDate, step);
      }

      state.anchorDate = clampDashboardNavigationDate(nextDate, state.range);
      state.windowStartIndex = null;
      updateToolbar();
      applyPayload();
    }

    function applyPayload() {
try {
      const payload = window.dashboardLatestPayload || {};
      const simulation = window.dashboardProsumerSimulation || window.dashboardBankSimulation;
      const payloadAnchorDate = getMeasuredPayloadAnchorDate(payload) ||
        (simulation && simulation.latestDateKey ? parseDateKey(simulation.latestDateKey) : null);
      const payloadAnchorKey = payloadAnchorDate ? formatDateKey(payloadAnchorDate) : "";
      if (payloadAnchorDate && (!state.anchorSourceKey || (!state.anchorTouched && state.anchorSourceKey !== payloadAnchorKey))) {
        state.anchorDate = payloadAnchorDate;
        state.anchorSourceKey = payloadAnchorKey;
        updateToolbar();
      }

      state.anchorDate = clampDashboardNavigationDate(state.anchorDate, state.range);
      updateToolbar();
      const rangeWindow = getRangeWindowForDeposit();
      const beforeHistory = isDashboardSelectionBeforeHistoryStart(state.range, state.anchorDate, payload);
      const breakdown = getBreakdown(payload, rangeWindow);
      const useForecastItems = !!(window.dashboardReForecastEnabled && simulation && simulation.isForecast);
      let items = breakdown && Array.isArray(breakdown.items)
        ? breakdown.items
        : (useForecastItems
          ? buildForecastAwareDepositItems(payload, simulation, rangeWindow)
          : buildRangeItems(simulation, rangeWindow));
      items = completeDepositRangeItems(items, rangeWindow);
      if (!useForecastItems) {
        items = clearUnmeasuredDepositItems(items, payload);
      }

      window.dashboardDepositBreakdown = breakdown;
      const currentDepositPln = getCurrentDepositPln(payload, simulation, breakdown);
      window.dashboardCurrentDepositPln = currentDepositPln;

      if (beforeHistory) {
        setMoneyOnly(currentValueEl, currentDepositPln);
        setValueOnly(saleEnergyValueEl, null, 1);
        setMoneyOnly(saleWorthValueEl, null);
        setAveragePriceValue(salePriceValueEl, null);
        setValueOnly(purchaseEnergyValueEl, null, 1);
        setMoneyOnly(purchaseWorthValueEl, null);
        setAveragePriceValue(purchasePriceValueEl, null);
        updateDepositStatus(currentDepositPln, breakdown, rangeWindow, payload);
        renderDepositChartEcharts([], "Brak historii depozytu prosumenckiego.");
        return;
      }

      if (!breakdown) {
        setMoneyOnly(currentValueEl, currentDepositPln);
        setValueOnly(saleEnergyValueEl, null, 1);
        setMoneyOnly(saleWorthValueEl, null);
        setAveragePriceValue(salePriceValueEl, null);
        setValueOnly(purchaseEnergyValueEl, null, 1);
        setMoneyOnly(purchaseWorthValueEl, null);
        setAveragePriceValue(purchasePriceValueEl, null);
        updateDepositStatus(currentDepositPln, breakdown, rangeWindow, payload);
        renderDepositChartEcharts(items);
        return;
      }

      setMoneyOnly(currentValueEl, currentDepositPln);
      setValueOnly(saleEnergyValueEl, breakdown.saleKwh, 1);
      setMoneyOnly(saleWorthValueEl, breakdown.saleValuePln);
      setAveragePriceValue(salePriceValueEl, firstNumber(
        breakdown.saleAveragePricePln,
        breakdown.saleKwh > 0 && breakdown.saleValuePln != null ? breakdown.saleValuePln / breakdown.saleKwh : null
      ));
      setValueOnly(purchaseEnergyValueEl, breakdown.purchaseKwh, 1);
      setMoneyOnly(purchaseWorthValueEl, breakdown.purchaseValuePln);
      setAveragePriceValue(purchasePriceValueEl, firstNumber(
        breakdown.purchaseAveragePricePln,
        breakdown.purchaseKwh > 0 && breakdown.purchaseValuePln != null ? breakdown.purchaseValuePln / breakdown.purchaseKwh : null
      ));
      updateDepositStatus(currentDepositPln, breakdown, rangeWindow, payload);
      renderDepositChartEcharts(items);
    
} catch (error) {
  if (!window.dashboardLatestPayload?.tariffHistory?.strict) throw error;
  clientTariffNotice(error.message);
  window.dashboardDepositBreakdown = null; window.dashboardCurrentDepositPln = null;
  [currentValueEl, saleWorthValueEl, purchaseWorthValueEl].forEach(el => setMoneyOnly(el, null));
  [saleEnergyValueEl, purchaseEnergyValueEl].forEach(el => setValueOnly(el, null, 1));
  [salePriceValueEl, purchasePriceValueEl].forEach(el => setAveragePriceValue(el, null));
  renderDepositChartEcharts([], error.message);
}
}

    rangeButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        state.range = button.getAttribute("data-deposit-range") || "day";
        state.anchorDate = clampDashboardNavigationDate(state.anchorDate, state.range);
        state.anchorTouched = true;
        state.windowOrigin = getDepositWindowOrigin(state.range);
        state.windowStartIndex = null;
        state.windowCount = null;
        updateToolbar();
        applyPayload();
      });
    });

    shiftButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        shiftRange(Number(button.getAttribute("data-deposit-shift") || 0));
      });
    });

    zoomButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        const direction = Number(button.getAttribute("data-deposit-zoom") || 0);
        zoomDepositChart(direction);
      });
    });

    if (zoomResetButton) {
      zoomResetButton.addEventListener("click", function () {
        jumpToLatestDepositDay();
      });
    }

    if (totalValueButton) {
      totalValueButton.addEventListener("click", function () {
        state.chartMode = state.chartMode === "total" ? "flow" : "total";
        updateDepositChartModeUi();
        renderDepositChartEcharts(state.items);
      });
    }

    [currentDateButton, currentTimeButton].forEach(function (button) {
      if (!button) {
        return;
      }

      button.addEventListener("click", function () {
        jumpToLatestDepositDay();
      });
    });

    document.addEventListener("dashboard:payload-updated", applyPayload);
    document.addEventListener("dashboard:bank-updated", applyPayload);
    document.addEventListener("dashboard:prosumer-updated", applyPayload);
    document.addEventListener("dashboard:bank-incremental-updated", function () {
      if (document.body && document.body.getAttribute("data-active-detail-view") === "deposit") {
        applyPayload();
      }
    });

    document.addEventListener("detailview:open", function (event) {
      if (!event.detail || event.detail.view !== "deposit") {
        return;
      }

      requestAnimationFrame(function () {
        applyPayload();
        if (state.chart) {
          state.chart.resize();
          requestAnimationFrame(renderDepositSunMarkersEcharts);
        }
      });
    });

    document.addEventListener("detailview:themechange", function () {
      if (state.chart && state.items.length) {
        renderDepositChartEcharts(state.items);
        state.chart.resize();
      }
    });

    window.addEventListener("resize", function () {
      if (state.chart) {
        state.chart.resize();
        requestAnimationFrame(renderDepositSunMarkersEcharts);
      }
    });

    updateDepositChartModeUi();
    updateToolbar();
    applyPayload();
  }

  function initSaleView() {
    const salePage = document.getElementById("sale-detail");
    const breadcrumbRangeEl = document.getElementById("sale-breadcrumb-range");
    const rangeLabelEl = document.getElementById("sale-range-label");
    const chartEl = document.getElementById("sale-detail-chart");
    const chartPanelEl = document.getElementById("sale-chart-panel");
    const chartEmptyEl = document.getElementById("sale-chart-empty");
    const sunMarkersEl = document.getElementById("sale-sun-markers");
    const currentPriceValueEl = document.getElementById("sale-current-price-value");
    const currentPriceStatusEl = document.getElementById("sale-current-price-status");
    const currentPriceMeterThumbEl = document.getElementById("sale-current-price-meter-thumb");
    const bestPriceValueEl = document.getElementById("sale-best-price-value");
    const averagePriceValueEl = document.getElementById("sale-average-price-value");
    const totalValueEl = document.getElementById("sale-total-value");
    const depositValueEl = document.getElementById("sale-deposit-value");
    const energyValueEl = document.getElementById("sale-energy-value");
    const rangeButtons = Array.from(document.querySelectorAll("[data-sale-range]"));
    const shiftButtons = Array.from(document.querySelectorAll("[data-sale-shift]"));
    const zoomButtons = Array.from(document.querySelectorAll("[data-sale-zoom]"));
    const zoomResetButton = document.querySelector("[data-sale-zoom-reset='true']");
    const marketToggleButton = document.querySelector("[data-sale-market-toggle='true']");
    const primaryUnitPill = salePage.querySelector(".sale-unit-pill");
    const auxiliaryUnitPill = salePage.querySelector(".sale-kwh-unit-pill");
    const marketEnergyValueEl = document.getElementById("sale-market-energy-value");
    const marketAveragePriceValueEl = document.getElementById("sale-market-average-price-value");
    const marketHighPriceValueEl = document.getElementById("sale-market-high-price-value");
    const marketLowPriceValueEl = document.getElementById("sale-market-low-price-value");
    const currentDateButton = document.getElementById("sale-current-date");
    const currentTimeButton = document.getElementById("sale-current-time");
    const monthTitleFormatter = new Intl.DateTimeFormat("pl-PL", {
      month: "long",
      year: "numeric"
    });
    const monthShortFormatter = new Intl.DateTimeFormat("pl-PL", {
      month: "short"
    });
    const weekdayShortFormatter = new Intl.DateTimeFormat("pl-PL", {
      weekday: "short"
    });
    const SALE_RANGE_DEFAULT_WINDOW = { day: 24, week: 7, month: 14, year: 6 };
    const SALE_RANGE_MIN_WINDOW = { day: 6, week: 4, month: 7, year: 3 };
    // Quarter-mode axes include one spacer per hour: 12 h and 7 h.
    const SALE_DAY_ZOOM_WINDOWS = [60, 35];
    const SALE_BAR_WIDTH = 40;
    const SALE_RANGE_BAR_WIDTH = 36;
    const SALE_BAR_RADIUS = 5;
    const SALE_COLORS = {
      energy: "#b0bbd5",
      value: "#019a45",
      valueArea: "rgba(176, 187, 213, 0.18)",
      marketIdle: "#98d6b7",
      marketActive: "#019a45",
      price: "#feb633"
    };

    if (!salePage) {
      return;
    }

    function numberOrNull(value) {
      if (value == null || value === "") {
        return null;
      }

      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }

    function firstNumber() {
      for (let i = 0; i < arguments.length; i += 1) {
        const numeric = numberOrNull(arguments[i]);
        if (numeric != null) {
          return numeric;
        }
      }

      return null;
    }

    function formatDecimal(value, digits) {
      return Number(value || 0).toFixed(digits == null ? 2 : digits).replace(".", ",");
    }

    function setPriceMetric(element, value) {
      if (element) {
        element.textContent = value == null ? "--" : formatDecimal(value, 2);
      }
    }

    function setValueMetric(element, value) {
      if (element) {
        element.textContent = value == null ? "--" : formatDecimal(value, 2);
      }
    }

    function setEnergyMetric(element, value) {
      if (element) {
        element.textContent = value == null ? "--" : formatDecimal(value, 2);
      }
    }

    function formatRangeName(range) {
      switch (range) {
        case "week":
          return "Tydzień";
        case "month":
          return "Miesiąc";
        case "year":
          return "Rok";
        default:
          return "Dzień";
      }
    }

    function formatLongDate(date) {
      return capitalize(weekdayFormatter.format(date)) + " " + dateFormatter.format(date);
    }

    function addDays(date, days) {
      const next = new Date(date);
      next.setDate(next.getDate() + days);
      return next;
    }

    function addMonths(date, months) {
      const next = new Date(date);
      next.setMonth(next.getMonth() + months);
      return next;
    }

    function addYears(date, years) {
      const next = new Date(date);
      next.setFullYear(next.getFullYear() + years);
      return next;
    }

    function getStartOfWeek(date) {
      const next = new Date(date);
      const day = next.getDay();
      const shift = day === 0 ? -6 : 1 - day;
      next.setDate(next.getDate() + shift);
      return next;
    }

    function formatWeekLabel(date) {
      const start = getStartOfWeek(date);
      const end = addDays(start, 6);
      return dateFormatter.format(start) + " - " + dateFormatter.format(end);
    }

    function formatMonthLabel(date) {
      return capitalize(monthTitleFormatter.format(date));
    }

    function formatYearLabel(date) {
      return String(date.getFullYear());
    }

    function formatDateKey(date) {
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
      ].join("-");
    }

    function parseDateKey(value) {
      if (typeof value !== "string" || !value.trim()) {
        return null;
      }

      const parsed = new Date(value.trim().slice(0, 10) + "T00:00:00");
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function getRangeWindow(range, anchorDate) {
      let start = new Date(anchorDate);
      let end = new Date(anchorDate);

      if (range === "week") {
        start = getStartOfWeek(anchorDate);
        end = addDays(start, 6);
      } else if (range === "month") {
        start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
        end = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
      } else if (range === "year") {
        start = new Date(anchorDate.getFullYear(), 0, 1);
        end = new Date(anchorDate.getFullYear(), 11, 31);
      }

      return {
        start: start,
        end: end,
        startKey: formatDateKey(start),
        endKey: formatDateKey(end)
      };
    }

    function getPayloadAnchorDate(payload) {
      const simulation = window.dashboardProsumerSimulation;
      const latestKey = payload && payload.pvData && payload.pvData.latestDate
        ? String(payload.pvData.latestDate).slice(0, 10)
        : (payload && payload.usageData && payload.usageData.latestDate
          ? String(payload.usageData.latestDate).slice(0, 10)
          : (simulation && simulation.latestDateKey ? simulation.latestDateKey : ""));
      const parsed = latestKey ? parseDateKey(latestKey) : null;
      return parsed || new Date();
    }

    function getRecordByDate(dataset, dateKey) {
      const records = dataset && Array.isArray(dataset.records) ? dataset.records : [];
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (String(record && record.date ? record.date : "") === dateKey) {
          return record;
        }
      }

      return null;
    }

    function getQuarterHour(quarter, index) {
      const rawHour = firstNumber(quarter && quarter.hour, Math.floor(index / 4));
      return Math.max(0, Math.min(23, Math.round(rawHour == null ? Math.floor(index / 4) : rawHour)));
    }

    function getPayloadRceForDate(payload, dateKey) {
      const priceHistory = payload && payload.priceHistory ? payload.priceHistory : null;
      const byDate = priceHistory && priceHistory.rceByDate ? priceHistory.rceByDate : null;

      if (byDate && dateKey && Object.prototype.hasOwnProperty.call(byDate, dateKey)) {
        return byDate[dateKey];
      }

      const rce = payload && payload.rce ? payload.rce : null;
      return rce && rce.businessDate === dateKey ? rce : null;
    }

    function resolveRcePriceForDateHour(payload, dateKey, hour) {
      const rce = getPayloadRceForDate(payload, dateKey);
      const hourlyRates = rce && Array.isArray(rce.hourlyRates) ? rce.hourlyRates : [];

      for (let index = 0; index < hourlyRates.length; index += 1) {
        const entry = hourlyRates[index];
        if (Number(entry && entry.hour) === hour) {
          return firstNumber(entry && entry.pricePln, entry && entry.price, entry && entry.value);
        }
      }

      return firstNumber(rce && rce.currentPricePln);
    }

    function hasMeasuredPvSaleData(payload) {
      const pvData = payload && payload.pvData ? payload.pvData : null;
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const records = [];

      if (pvData && Array.isArray(pvData.records)) {
        records.push.apply(records, pvData.records);
      }
      if (usageData && Array.isArray(usageData.records)) {
        records.push.apply(records, usageData.records);
      }

      return records.some(function (record) {
        const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
        return quarters.some(function (quarter) {
          return firstNumber(
            quarter && quarter.gridExportKwh,
            quarter && quarter.toGridKwh,
            quarter && quarter.grid,
            quarter && quarter.sale
          ) != null;
        });
      });
    }

    function buildMeasuredHourItems(payload, dateKey) {
      const pvData = payload && payload.pvData ? payload.pvData : null;
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const record = getRecordByDate(pvData, dateKey);
      const usageRecord = getRecordByDate(usageData, dateKey);
      const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
      const usageQuarters = usageRecord && Array.isArray(usageRecord.quarters) ? usageRecord.quarters : [];
      const items = Array.from({ length: 24 }, function (_, hour) {
        const marketPrice = resolveRcePriceForDateHour(payload, dateKey, hour);
        const salePrice = getProsumerSalePricePln(marketPrice);
        return {
          key: dateKey + "-h" + String(hour),
          label: String(hour).padStart(2, "0"),
          rangeLabel: formatTooltipHour(hour) + " - " + formatTooltipHour(hour + 1),
          sourceDate: dateKey,
          fullPrice: salePrice,
          marketPrice: marketPrice,
          exportKwh: 0,
          valueWithDepositPln: 0,
          valueWithoutDepositPln: 0,
          active: false
        };
      });

      const slotCount = Math.max(quarters.length, usageQuarters.length) || 96;
      for (let index = 0; index < slotCount; index += 1) {
        const quarter = quarters[index] || null;
        const usageQuarter = usageQuarters[index] || null;
        const hour = getQuarterHour(quarter || usageQuarter, index);
        const item = items[hour];
        if (!item) {
          continue;
        }

        const marketPrice = resolveRcePriceForDateHour(payload, dateKey, hour);
        const salePrice = getProsumerSalePricePln(marketPrice);
        const physicalExportKwh = getQuarterPhysicalExportKwh(usageQuarter, quarter);
        const physicalImportKwh = getQuarterPhysicalImportKwh(usageQuarter);

        item.fullPrice = firstNumber(salePrice, item.fullPrice);
        item.marketPrice = firstNumber(marketPrice, item.marketPrice);
        item._physicalExportKwh = (item._physicalExportKwh || 0) + physicalExportKwh;
        item._physicalImportKwh = (item._physicalImportKwh || 0) + physicalImportKwh;
      }

      items.forEach(function (item) {
        const exportKwh = Math.max((item._physicalExportKwh || 0) - (item._physicalImportKwh || 0), 0);
        const value = exportKwh * (item.fullPrice || 0);
        item.exportKwh = exportKwh;
        item.valueWithDepositPln = value;
        item.valueWithoutDepositPln = value;
        item.active = exportKwh > 0;
        delete item._physicalExportKwh;
        delete item._physicalImportKwh;
      });

      return items;
    }

    function createSaleGapItem(key, dateKey) {
      return {
        key: key,
        label: "",
        rangeLabel: "",
        sourceDate: dateKey || null,
        fullPrice: null,
        marketPrice: null,
        exportKwh: null,
        valueWithDepositPln: null,
        valueWithoutDepositPln: null,
        active: false,
        isGap: true
      };
    }

    function buildMeasuredQuarterItems(payload, dateKey) {
      const pvData = payload && payload.pvData ? payload.pvData : null;
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const record = getRecordByDate(pvData, dateKey);
      const usageRecord = getRecordByDate(usageData, dateKey);
      const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
      const usageQuarters = usageRecord && Array.isArray(usageRecord.quarters) ? usageRecord.quarters : [];
      const slotCount = Math.max(quarters.length, usageQuarters.length) || 96;
      const items = [];

      for (let index = 0; index < slotCount; index += 1) {
        const quarter = quarters[index] || null;
        const usageQuarter = usageQuarters[index] || null;
        const hour = getQuarterHour(quarter || usageQuarter, index);
        const quarterIndex = getSaleQuarterIndex(quarter || usageQuarter, index);
        const marketPrice = resolveRcePriceForDateHour(payload, dateKey, hour);
        const salePrice = getProsumerSalePricePln(marketPrice);
        const physicalExportKwh = getQuarterPhysicalExportKwh(usageQuarter, quarter);
        const physicalImportKwh = getQuarterPhysicalImportKwh(usageQuarter);
        const exportKwh = Math.max(physicalExportKwh - physicalImportKwh, 0);
        const value = exportKwh * (salePrice || 0);

        items.push({
          key: dateKey + "-q" + String(index),
          label: quarterIndex === 0 ? String(hour).padStart(2, "0") : "",
          rangeLabel: formatSaleQuarterRange(hour, quarterIndex),
          sourceDate: dateKey,
          fullPrice: salePrice,
          marketPrice: marketPrice,
          exportKwh: exportKwh,
          valueWithDepositPln: value,
          valueWithoutDepositPln: value,
          active: exportKwh > 0
        });

        if (quarterIndex === 3 && hour < 23) {
          items.push(createSaleGapItem(dateKey + "-gap" + String(hour), dateKey));
        }
      }

      return items;
    }

    function buildHourItems(day) {
      const hours = day && Array.isArray(day.hours) ? day.hours : [];

      return (hours.length ? hours : Array.from({ length: 24 }, function (_, hour) { return { hour: hour }; })).map(function (entry, index) {
        const hour = clampNumber(Math.round(firstNumber(entry && entry.hour, index) || 0), 0, 23);
        const marketPrice = firstNumber(entry && entry.rcePricePln, entry && entry.sellPricePln);
        const fullPrice = firstNumber(entry && entry.sellPricePln, marketPrice);
        const exportKwh = firstNumber(
          entry && entry.exportKwh,
          entry && entry.soldImmediateKwh != null && entry.soldBankKwh != null
            ? entry.soldImmediateKwh + entry.soldBankKwh
            : null,
          0
        ) || 0;
        const fullValue = firstNumber(
          entry && entry.depositEarnedPln,
          fullPrice != null ? exportKwh * fullPrice : null,
          0
        ) || 0;
        const marketValue = marketPrice != null ? exportKwh * marketPrice : 0;

        return {
          key: day.dateKey + "-h" + String(index),
          label: String(hour).padStart(2, "0"),
          rangeLabel: formatTooltipHour(hour) + " - " + formatTooltipHour(hour + 1),
          sourceDate: day.dateKey,
          fullPrice: fullPrice,
          marketPrice: marketPrice,
          exportKwh: exportKwh,
          valueWithDepositPln: fullValue,
          valueWithoutDepositPln: marketValue,
          active: exportKwh > 0,
          isForecast: !!(day && day.isForecast || entry && entry.isForecast)
        };
      });
    }

    function buildQuarterItems(day) {
      const slots = day && Array.isArray(day.slots) ? day.slots : [];
      const dateKey = day && day.dateKey ? day.dateKey : formatDateKey(state.anchorDate);
      const items = [];

      if (slots.length) {
        slots.forEach(function (slot, index) {
          const hour = clampNumber(Math.round(firstNumber(slot && slot.hour, Math.floor(index / 4)) || 0), 0, 23);
          const quarterIndex = getSaleQuarterIndex(slot, index);
          const marketPrice = firstNumber(slot && slot.rce, slot && slot.rcePricePln, slot && slot.sellPrice);
          const fullPrice = firstNumber(slot && slot.sellPrice, slot && slot.sellPricePln, marketPrice);
          const exportKwh = firstNumber(
            slot && slot.billedGridExportKwh,
            slot && slot.exportKwh,
            slot && slot.billedSoldImmediateKwh != null && slot.billedSoldBankKwh != null
              ? slot.billedSoldImmediateKwh + slot.billedSoldBankKwh
              : null,
            0
          ) || 0;
          const fullValue = firstNumber(
            slot && slot.depositEarnedPln,
            slot && slot.billedSaleValuePln,
            slot && slot.billedDepositEarnedPln,
            fullPrice != null ? exportKwh * fullPrice : null,
            0
          ) || 0;
          const marketValue = marketPrice != null ? exportKwh * marketPrice : 0;

          items.push({
            key: dateKey + "-q" + String(index),
            label: quarterIndex === 0 ? String(hour).padStart(2, "0") : "",
            rangeLabel: formatSaleQuarterRange(hour, quarterIndex),
            sourceDate: dateKey,
            fullPrice: fullPrice,
            marketPrice: marketPrice,
            exportKwh: exportKwh,
            valueWithDepositPln: fullValue,
            valueWithoutDepositPln: marketValue,
            active: exportKwh > 0,
            isForecast: !!(day && day.isForecast || slot && slot.isForecast)
          });

          if (quarterIndex === 3 && hour < 23) {
            items.push(createSaleGapItem(dateKey + "-gap" + String(hour), dateKey));
          }
        });

        return items;
      }

      buildHourItems(day).forEach(function (hourItem) {
        const hour = clampNumber(Math.round(Number(hourItem && hourItem.label) || 0), 0, 23);
        for (let quarterIndex = 0; quarterIndex < 4; quarterIndex += 1) {
          const exportKwh = (firstNumber(hourItem && hourItem.exportKwh, 0) || 0) / 4;
          const valueWithDeposit = (firstNumber(hourItem && hourItem.valueWithDepositPln, 0) || 0) / 4;
          const valueWithoutDeposit = (firstNumber(hourItem && hourItem.valueWithoutDepositPln, 0) || 0) / 4;

          items.push({
            key: dateKey + "-q" + String(hour) + "-" + String(quarterIndex),
            label: quarterIndex === 0 ? String(hour).padStart(2, "0") : "",
            rangeLabel: formatSaleQuarterRange(hour, quarterIndex),
            sourceDate: dateKey,
            fullPrice: hourItem && hourItem.fullPrice,
            marketPrice: hourItem && hourItem.marketPrice,
            exportKwh: exportKwh,
            valueWithDepositPln: valueWithDeposit,
            valueWithoutDepositPln: valueWithoutDeposit,
            active: exportKwh > 0,
            isForecast: !!(day && day.isForecast || hourItem && hourItem.isForecast)
          });
        }

        if (hour < 23) {
          items.push(createSaleGapItem(dateKey + "-gap" + String(hour), dateKey));
        }
      });

      return items;
    }

    function buildMeasuredRangeItems(payload, rangeWindow) {
      if (!isRealDashboardDataMode(payload)) {
        return [];
      }

      if (!hasMeasuredPvSaleData(payload)) {
        return [];
      }

      if (state.range === "day") {
        return state.dayDetailMode
          ? buildMeasuredQuarterItems(payload, formatDateKey(rangeWindow.start))
          : buildMeasuredHourItems(payload, formatDateKey(rangeWindow.start));
      }

      if (state.range === "year") {
        const buckets = {};
        for (let date = new Date(rangeWindow.start); date.getTime() <= rangeWindow.end.getTime(); date = addDays(date, 1)) {
          const dateKey = formatDateKey(date);
          const monthKey = String(date.getFullYear()) + "-" + String(date.getMonth() + 1).padStart(2, "0");
          if (!buckets[monthKey]) {
            buckets[monthKey] = {
              label: capitalize(monthShortFormatter.format(date).replace(".", "")),
              items: []
            };
          }
          buckets[monthKey].items = buckets[monthKey].items.concat(buildMeasuredHourItems(payload, dateKey));
        }

        return Object.keys(buckets).sort().map(function (bucketKey) {
          const bucket = buckets[bucketKey];
          return aggregateEntries(bucket.items, bucket.label, bucketKey);
        });
      }

      const items = [];
      for (let date = new Date(rangeWindow.start); date.getTime() <= rangeWindow.end.getTime(); date = addDays(date, 1)) {
        const dateKey = formatDateKey(date);
        const label = state.range === "week"
          ? capitalize(weekdayShortFormatter.format(date).replace(".", ""))
          : String(date.getDate()).padStart(2, "0");
        items.push(aggregateEntries(buildMeasuredHourItems(payload, dateKey), label, dateKey));
      }

      return items;
    }

    function aggregateEntries(entries, label, key) {
      let exportKwh = 0;
      let weightedFull = 0;
      let weightedMarket = 0;
      let fullSum = 0;
      let fullCount = 0;
      let marketSum = 0;
      let marketCount = 0;
      let valueWithDepositPln = 0;
      let valueWithoutDepositPln = 0;
      let active = false;
      let isForecast = false;

      entries.forEach(function (entry) {
        const fullPrice = firstNumber(entry && entry.fullPrice);
        const marketPrice = firstNumber(entry && entry.marketPrice);
        const sold = firstNumber(entry && entry.exportKwh, 0) || 0;
        exportKwh += sold;
        if (fullPrice != null) {
          fullSum += fullPrice;
          fullCount += 1;
          weightedFull += fullPrice * sold;
        }
        if (marketPrice != null) {
          marketSum += marketPrice;
          marketCount += 1;
          weightedMarket += marketPrice * sold;
        }
        valueWithDepositPln += firstNumber(entry && entry.valueWithDepositPln, 0) || 0;
        valueWithoutDepositPln += firstNumber(entry && entry.valueWithoutDepositPln, 0) || 0;
        if (entry && entry.active) {
          active = true;
        }
        if (entry && entry.isForecast) {
          isForecast = true;
        }
      });

      return {
        key: key,
        label: label,
        fullPrice: exportKwh > 0 && weightedFull > 0
          ? weightedFull / exportKwh
          : (fullCount ? fullSum / fullCount : null),
        marketPrice: exportKwh > 0 && weightedMarket > 0
          ? weightedMarket / exportKwh
          : (marketCount ? marketSum / marketCount : null),
        exportKwh: exportKwh,
        valueWithDepositPln: valueWithDepositPln,
        valueWithoutDepositPln: valueWithoutDepositPln,
        active: active,
        isForecast: isForecast
      };
    }

    function buildRangeItems(simulation, rangeWindow) {
      if (!simulation || !Array.isArray(simulation.days)) {
        return [];
      }

      const days = simulation.days.filter(function (day) {
        return day && day.dateKey >= rangeWindow.startKey && day.dateKey <= rangeWindow.endKey;
      });

      if (!days.length) {
        return [];
      }

      if (state.range === "day") {
        return state.dayDetailMode ? buildQuarterItems(days[0]) : buildHourItems(days[0]);
      }

      if (state.range === "year") {
        const buckets = {};
        days.forEach(function (day) {
          const date = parseDateKey(day.dateKey);
          if (!date) {
            return;
          }
          const bucketKey = String(date.getFullYear()) + "-" + String(date.getMonth() + 1).padStart(2, "0");
          if (!buckets[bucketKey]) {
            buckets[bucketKey] = {
              label: capitalize(monthShortFormatter.format(date).replace(".", "")),
              items: []
            };
          }
          buckets[bucketKey].items = buckets[bucketKey].items.concat(buildHourItems(day));
        });

        return Object.keys(buckets).sort().map(function (bucketKey) {
          const bucket = buckets[bucketKey];
          return aggregateEntries(bucket.items, bucket.label, bucketKey);
        });
      }

      return days.map(function (day) {
        const date = parseDateKey(day.dateKey);
        const label = state.range === "week"
          ? capitalize(weekdayShortFormatter.format(date || new Date()).replace(".", ""))
          : String((date || new Date()).getDate()).padStart(2, "0");
        return aggregateEntries(buildHourItems(day), label, day.dateKey);
      });
    }

    function getLatestMeasuredDateKey(payload) {
      const keys = [];
      const datasets = [
        payload && payload.pvData ? payload.pvData : null,
        payload && payload.usageData ? payload.usageData : null
      ];

      datasets.forEach(function (dataset) {
        const latestKey = normalizeDashboardDateKey(dataset && dataset.latestDate);
        if (latestKey) {
          keys.push(latestKey);
        }

        const records = dataset && Array.isArray(dataset.records) ? dataset.records : [];
        if (records.length) {
          const recordKey = normalizeDashboardDateKey(records[records.length - 1] && records[records.length - 1].date);
          if (recordKey) {
            keys.push(recordKey);
          }
        }
      });

      return keys.length ? keys.sort()[keys.length - 1] : "";
    }

    function getSimulationDay(simulation, dateKey) {
      if (!simulation || !dateKey) {
        return null;
      }
      if (simulation.dayMap && simulation.dayMap[dateKey]) {
        return simulation.dayMap[dateKey];
      }
      const days = Array.isArray(simulation.days) ? simulation.days : [];
      return days.find(function (day) { return day && day.dateKey === dateKey; }) || null;
    }

    function buildForecastAwareDayItems(payload, simulation, dateKey, latestKey, latestDataTime) {
      const forecastDay = getSimulationDay(simulation, dateKey);
      const useMeasuredWholeDay = latestKey && dateKey < latestKey;
      const useForecastWholeDay = latestKey && dateKey > latestKey;

      if (useMeasuredWholeDay || !forecastDay) {
        return state.dayDetailMode
          ? buildMeasuredQuarterItems(payload, dateKey)
          : buildMeasuredHourItems(payload, dateKey);
      }
      if (useForecastWholeDay || !latestDataTime) {
        return state.dayDetailMode ? buildQuarterItems(forecastDay) : buildHourItems(forecastDay);
      }

      const measuredItems = state.dayDetailMode
        ? buildMeasuredQuarterItems(payload, dateKey)
        : buildMeasuredHourItems(payload, dateKey);
      const forecastItems = state.dayDetailMode ? buildQuarterItems(forecastDay) : buildHourItems(forecastDay);
      const latestMinute = (latestDataTime.getHours() * 60) + latestDataTime.getMinutes();

      return forecastItems.map(function (forecastItem, index) {
        const measuredItem = measuredItems[index] || null;
        const startMinute = getSaleItemStartMinute(measuredItem || forecastItem);
        if (startMinute == null || startMinute <= latestMinute) {
          return measuredItem || forecastItem;
        }
        return forecastItem;
      });
    }

    function buildForecastAwareRangeItems(payload, simulation, rangeWindow) {
      if (!simulation || !simulation.isForecast) {
        return buildMeasuredRangeItems(payload, rangeWindow);
      }

      const latestKey = getLatestMeasuredDateKey(payload);
      if (!latestKey) {
        return buildRangeItems(simulation, rangeWindow);
      }

      const latestDataTime = getDashboardLatestDataTime(payload);

      if (state.range === "day") {
        return buildForecastAwareDayItems(payload, simulation, formatDateKey(rangeWindow.start), latestKey, latestDataTime);
      }

      if (state.range === "year") {
        const buckets = {};
        for (let date = new Date(rangeWindow.start); date.getTime() <= rangeWindow.end.getTime(); date = addDays(date, 1)) {
          const dateKey = formatDateKey(date);
          const bucketKey = String(date.getFullYear()) + "-" + String(date.getMonth() + 1).padStart(2, "0");
          if (!buckets[bucketKey]) {
            buckets[bucketKey] = {
              label: capitalize(monthShortFormatter.format(date).replace(".", "")),
              items: []
            };
          }
          buckets[bucketKey].items = buckets[bucketKey].items.concat(
            buildForecastAwareDayItems(payload, simulation, dateKey, latestKey, latestDataTime)
          );
        }

        return Object.keys(buckets).sort().map(function (bucketKey) {
          const bucket = buckets[bucketKey];
          return aggregateEntries(bucket.items, bucket.label, bucketKey);
        });
      }

      const items = [];
      for (let date = new Date(rangeWindow.start); date.getTime() <= rangeWindow.end.getTime(); date = addDays(date, 1)) {
        const dateKey = formatDateKey(date);
        const label = state.range === "week"
          ? capitalize(weekdayShortFormatter.format(date).replace(".", ""))
          : String(date.getDate()).padStart(2, "0");
        items.push(aggregateEntries(
          buildForecastAwareDayItems(payload, simulation, dateKey, latestKey, latestDataTime),
          label,
          dateKey
        ));
      }

      return items;
    }

    function getDisplayPrice(item) {
      return state.priceMode === "market"
        ? firstNumber(item && item.marketPrice, item && item.fullPrice)
        : firstNumber(item && item.fullPrice, item && item.marketPrice);
    }

    function getSaleMarketRate(item) {
      if (item && Object.prototype.hasOwnProperty.call(item, "quarterMarketPricePln")) {
        return getProsumerSalePricePln(item.quarterMarketPricePln);
      }
      return firstNumber(getProsumerSalePricePln(item && item.marketPrice), item && item.fullPrice);
    }

    function applySaleQuarterMarketRates(items, payload) {
      const ratesByDate = new Map();
      return items.map(function (item) {
        if (!item || item.isGap) {
          return item;
        }
        const dateKey = item.sourceDate;
        const rce = getPayloadRceForDate(payload, dateKey);
        if (!rce && item.isForecast) {
          return item;
        }
        if (!ratesByDate.has(dateKey)) {
          const ratesByMinute = new Map();
          const rates = rce && Array.isArray(rce.quarterRates) ? rce.quarterRates : [];
          rates.forEach(function (rate) {
            const minute = (Number(rate.hour) * 60) + (Number(rate.quarter) * 15);
            if (!ratesByMinute.has(minute)) {
              ratesByMinute.set(minute, []);
            }
            ratesByMinute.get(minute).push(firstNumber(rate.pricePln));
          });
          ratesByDate.set(dateKey, ratesByMinute);
        }
        // Consume repeated local times in source order on the autumn DST day.
        const rates = ratesByDate.get(dateKey).get(getSaleItemStartMinute(item));
        return Object.assign({}, item, {
          quarterMarketPricePln: rates && rates.length ? rates.shift() : null
        });
      });
    }

    function getSettlementValue(item) {
      return state.settlement === "market"
        ? firstNumber(item && item.valueWithoutDepositPln, item && item.valueWithDepositPln)
        : firstNumber(item && item.valueWithDepositPln, item && item.valueWithoutDepositPln);
    }

    function getSaleItemStartMinute(item) {
      const rangeLabel = String(item && item.rangeLabel ? item.rangeLabel : "");
      const rangeMatch = rangeLabel.match(/(\d{1,2}):(\d{2})/);
      if (rangeMatch) {
        return (Number(rangeMatch[1]) * 60) + Number(rangeMatch[2]);
      }

      const hour = Number(item && item.label);
      return Number.isFinite(hour) ? clampNumber(Math.round(hour), 0, 23) * 60 : null;
    }

    function isSaleFutureItem(item) {
      if (!state.latestDataTime || state.range !== "day" || !item || !item.sourceDate) {
        return false;
      }

      const latestKey = formatDateKey(state.latestDataTime);
      const anchorKey = formatDateKey(state.anchorDate);
      if (String(item.sourceDate).slice(0, 10) !== latestKey || anchorKey !== latestKey) {
        return false;
      }

      const startMinute = getSaleItemStartMinute(item);
      const latestMinute = (state.latestDataTime.getHours() * 60) + state.latestDataTime.getMinutes();
      return startMinute != null && startMinute > latestMinute;
    }

    function getSaleThemeColor(variableName, fallback) {
      const value = getComputedStyle(salePage).getPropertyValue(variableName).trim();
      return value || fallback;
    }

    function getSaleThemeTokens() {
      return {
        text: getSaleThemeColor("--usage-ink", "#1A1A1A"),
        gridLine: getSaleThemeColor("--usage-chart-grid", "rgba(26, 26, 26, 0.10)"),
        pointerShadow: getSaleThemeColor("--usage-chart-grid", "rgba(176, 187, 213, 0.10)")
      };
    }

    function getSaleDefaultWindow(range, length) {
      if (range === "day" && state.dayDetailMode) {
        return Math.min(119, Math.max(length, 1));
      }
      if (range === "month" || range === "year") {
        return Math.max(length, 1);
      }
      return Math.min(SALE_RANGE_DEFAULT_WINDOW[range] || length, Math.max(length, 1));
    }

    function getSaleMinWindow(range, length) {
      if (range === "day" && state.dayDetailMode) {
        return Math.min(SALE_DAY_ZOOM_WINDOWS[1], Math.max(length, 1));
      }
      return Math.min(SALE_RANGE_MIN_WINDOW[range] || 1, Math.max(length, 1));
    }

    function getSaleDayZoomScale(windowCount, detailMode) {
      const visibleHours = detailMode ? Math.max(windowCount / 5, 0.25) : Math.max(windowCount, 0.25);
      return Math.round((24 / visibleHours) * 100);
    }

    function getSaleWindowOrigin(range) {
      return range === "week" ? "end" : "start";
    }

    function getSaleRoundedDayScaleMax(value) {
      const normalizedMax = Math.max(Number(value) || 0, 0);

      if (normalizedMax < 10) {
        return Math.max(1, Math.round(normalizedMax) + 1);
      }
      if (normalizedMax < 20) {
        return Math.round(normalizedMax) + 2;
      }
      if (normalizedMax < 100) {
        return (Math.round(normalizedMax / 10) * 10) + 5;
      }

      const roundedHundreds = (Math.round(normalizedMax / 100) * 100) + 10;
      return roundedHundreds >= normalizedMax
        ? roundedHundreds
        : ((Math.round(normalizedMax / 100) + 1) * 100) + 10;
    }

    function getSaleDayScaleMaxFromRecentDays(payload, simulation, date) {
      const endDate = new Date(date);
      const startDate = addDays(endDate, -29);
      const useMeasuredSaleData = isRealDashboardDataMode(payload) && hasMeasuredPvSaleData(payload);
      let maxEnergy = 0;
      let maxValue = 0;

      for (let currentDate = new Date(startDate); currentDate.getTime() <= endDate.getTime(); currentDate = addDays(currentDate, 1)) {
        const dateKey = formatDateKey(currentDate);
        let dayItems = useMeasuredSaleData ? buildMeasuredHourItems(payload, dateKey) : [];

        if (!useMeasuredSaleData) {
          const simulationDay = simulation && Array.isArray(simulation.days)
            ? simulation.days.find(function (day) { return day && day.dateKey === dateKey; })
            : null;
          dayItems = simulationDay ? buildHourItems(simulationDay) : dayItems;
        }

        dayItems.forEach(function (item) {
          if (!item || item.isGap || isSaleFutureItem(item)) {
            return;
          }

          maxEnergy = Math.max(maxEnergy, Math.max(0, firstNumber(item.exportKwh, 0) || 0));
          maxValue = Math.max(maxValue, Math.max(0, getSettlementValue(item) || 0));
        });
      }

      return {
        energy: getSaleRoundedDayScaleMax(maxEnergy),
        value: getSaleRoundedDayScaleMax(maxValue)
      };
    }

    function getSaleMarketRateAxisConfig(payload, simulation, date, fallbackMax) {
      const axisMin = -0.1;
      const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      let maxRate = Math.max(Number(fallbackMax) || 0, 0);

      for (let currentDate = new Date(firstDay); currentDate.getTime() <= lastDay.getTime(); currentDate = addDays(currentDate, 1)) {
        const dateKey = formatDateKey(currentDate);

        for (let hour = 0; hour < 24; hour += 1) {
          const rate = getProsumerSalePricePln(resolveRcePriceForDateHour(payload, dateKey, hour));
          if (rate != null) {
            maxRate = Math.max(maxRate, rate);
          }
        }

        if (simulation && Array.isArray(simulation.days)) {
          const simulationDay = simulation.days.find(function (day) { return day && day.dateKey === dateKey; });
          if (simulationDay) {
            buildHourItems(simulationDay).forEach(function (item) {
              const rate = getSaleMarketRate(item);
              if (rate != null) {
                maxRate = Math.max(maxRate, rate);
              }
            });
          }
        }
      }

      const axisMax = Math.max(axisMin + 0.3, maxRate + 0.2);
      const splitCount = 6;
      return {
        min: axisMin,
        max: axisMax,
        interval: (axisMax - axisMin) / splitCount,
        splitNumber: splitCount
      };
    }

    function getSaleAxisConfig(maxValue, minimumMax, forcedMax) {
      const splitCount = 6;
      const normalizedForcedMax = Number(forcedMax);
      if (Number.isFinite(normalizedForcedMax) && normalizedForcedMax > 0) {
        return {
          max: normalizedForcedMax,
          interval: normalizedForcedMax / splitCount,
          splitNumber: splitCount
        };
      }

      const normalizedMax = Math.max(Number(maxValue) || 0, 0);
      const minAxisMax = Math.max(Number(minimumMax) || 0, 0.01);
      if (normalizedMax <= minAxisMax) {
        return {
          max: minAxisMax,
          interval: minAxisMax / splitCount,
          splitNumber: splitCount
        };
      }

      const paddedMax = normalizedMax * 1.08;
      const magnitude = Math.pow(10, Math.floor(Math.log10(paddedMax)));
      const multipliers = [1, 1.25, 1.5, 2, 2.5, 5, 10];
      let bestConfig = null;

      for (let powerShift = -1; powerShift <= 1; powerShift += 1) {
        const shiftedMagnitude = magnitude * Math.pow(10, powerShift);

        multipliers.forEach(function (multiplier) {
          const interval = Math.max(0.01, multiplier * shiftedMagnitude);
          const axisMax = interval * splitCount;

          if (axisMax < paddedMax) {
            return;
          }

          const score = (axisMax - normalizedMax) / normalizedMax;
          if (!bestConfig || score < bestConfig.score) {
            bestConfig = {
              max: axisMax,
              interval: interval,
              splitNumber: splitCount,
              score: score
            };
          }
        });
      }

      if (!bestConfig) {
        const fallbackInterval = Math.max(0.01, paddedMax / splitCount);
        bestConfig = {
          max: fallbackInterval * splitCount,
          interval: fallbackInterval,
          splitNumber: splitCount
        };
      }

      return {
        max: bestConfig.max,
        interval: bestConfig.interval,
        splitNumber: bestConfig.splitNumber
      };
    }

    function getCurrentHourFromPayload(payload) {
      const rce = payload && payload.rce ? payload.rce : null;
      const rawHour = firstNumber(
        rce && rce.currentHour,
        rce && rce.hour,
        new Date().getHours()
      );

      return Math.max(0, Math.min(23, Math.round(rawHour == null ? new Date().getHours() : rawHour)));
    }

    function getCurrentSalePrice(payload, items) {
      const rce = payload && payload.rce ? payload.rce : null;
      const anchorDate = getPayloadAnchorDate(payload);
      const dateKey = formatDateKey(anchorDate);
      const currentHour = getCurrentHourFromPayload(payload);
      const currentItem = Array.isArray(items)
        ? items.find(function (item) { return String(item && item.label).padStart(2, "0") === String(currentHour).padStart(2, "0"); })
        : null;
      const marketPrice = firstNumber(
        rce && rce.currentPricePln,
        rce && rce.pricePln,
        resolveRcePriceForDateHour(payload, dateKey, currentHour),
        currentItem && currentItem.marketPrice
      );
      const salePrice = firstNumber(
        rce && rce.currentSalePricePln,
        getProsumerSalePricePln(marketPrice),
        currentItem && currentItem.fullPrice
      );

      return state.priceMode === "market"
        ? firstNumber(marketPrice, salePrice)
        : firstNumber(salePrice, marketPrice);
    }

    function updateCurrentSalePriceState(currentPrice, bestPrice) {
      if (currentPriceMeterThumbEl) {
        const percent = bestPrice && bestPrice > 0
          ? clampNumber((currentPrice || 0) / bestPrice, 0, 1) * 100
          : 0;
        currentPriceMeterThumbEl.style.left = formatDecimal(percent, 2).replace(",", ".") + "%";
      }

      if (!currentPriceStatusEl) {
        return;
      }

      if (currentPrice == null) {
        currentPriceStatusEl.textContent = "Cena sprzedaży: --";
        return;
      }

      const ratio = bestPrice && bestPrice > 0 ? currentPrice / bestPrice : 0;
      const status = ratio >= 0.9
        ? "optymalna"
        : (ratio >= 0.7 ? "korzystna" : "niska");
      currentPriceStatusEl.textContent = "Cena sprzedaży: " + status;
    }

    function escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function formatTooltipHour(hour) {
      const safeHour = Math.max(0, Math.min(24, Math.round(hour == null ? 0 : hour)));
      return String(safeHour).padStart(2, "0") + ":00";
    }

    function formatSaleMinute(totalMinutes) {
      const safeMinute = clampNumber(Math.round(totalMinutes == null ? 0 : totalMinutes), 0, 24 * 60);
      const hour = Math.floor(safeMinute / 60);
      const minute = safeMinute % 60;
      return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
    }

    function formatSaleQuarterRange(hour, quarter) {
      const startMinute = (clampNumber(Math.round(hour == null ? 0 : hour), 0, 23) * 60) +
        (clampNumber(Math.round(quarter == null ? 0 : quarter), 0, 3) * 15);
      return formatSaleMinute(startMinute) + " - " + formatSaleMinute(startMinute + 15);
    }

    function getSaleQuarterIndex(quarter, fallbackIndex) {
      const rawQuarter = firstNumber(quarter && quarter.quarter, fallbackIndex % 4);
      return clampNumber(Math.round(rawQuarter == null ? fallbackIndex % 4 : rawQuarter), 0, 3);
    }

    function getQuarterStartMinute(quarter, index) {
      const parsedStart = parseDashboardDateTime(firstTextValue(quarter && quarter.slotStart));
      if (parsedStart) {
        return (parsedStart.getHours() * 60) + parsedStart.getMinutes();
      }

      const rawHour = firstNumber(quarter && quarter.hour, Math.floor(index / 4));
      const hour = clampNumber(Math.round(rawHour == null ? Math.floor(index / 4) : rawHour), 0, 23);
      const quarterIndex = clampNumber(Math.round(firstNumber(quarter && quarter.quarter, index % 4) || 0), 0, 3);
      return (hour * 60) + (quarterIndex * 15);
    }

    function getQuarterEndMinute(quarter, index) {
      const parsedEnd = parseDashboardDateTime(firstTextValue(quarter && quarter.slotEnd));
      if (parsedEnd) {
        return (parsedEnd.getHours() * 60) + parsedEnd.getMinutes();
      }

      return clampNumber(getQuarterStartMinute(quarter, index) + 15, 0, 24 * 60);
    }

    function getQuarterDaylightKwh(quarter) {
      return Math.max(0, firstNumber(
        quarter && quarter.productionKwh,
        quarter && quarter.pvGenerationKwh,
        quarter && quarter.production,
        quarter && quarter.pv,
        quarter && quarter.chargeFromPvKwh,
        quarter && quarter.pvToBankKwh,
        0
      ) || 0);
    }

    function getDaylightWindowFromRecord(record) {
      const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
      let firstMinute = null;
      let lastMinute = null;

      quarters.forEach(function (quarter, index) {
        if (getQuarterDaylightKwh(quarter) < 0.01) {
          return;
        }

        const startMinute = getQuarterStartMinute(quarter, index);
        const endMinute = getQuarterEndMinute(quarter, index);
        firstMinute = firstMinute == null ? startMinute : Math.min(firstMinute, startMinute);
        lastMinute = lastMinute == null ? endMinute : Math.max(lastMinute, endMinute);
      });

      if (firstMinute == null || lastMinute == null) {
        return null;
      }

      return {
        firstMinute: firstMinute,
        lastMinute: lastMinute
      };
    }

    function getSaleDaylightWindow() {
      const payload = window.dashboardLatestPayload || {};
      const anchorKey = formatDateKey(state.anchorDate);
      const startKey = formatDateKey(addDays(state.anchorDate, -4));
      const datasets = [
        payload && payload.pvData,
        payload && payload.usageData,
        window.usageSampleData
      ];
      const windows = [];

      datasets.forEach(function (dataset) {
        const records = dataset && Array.isArray(dataset.records) ? dataset.records : [];
        records.forEach(function (record) {
          const dateKey = record && typeof record.date === "string" ? record.date : "";
          if (!dateKey || dateKey < startKey || dateKey > anchorKey) {
            return;
          }

          const daylightWindow = getDaylightWindowFromRecord(record);
          if (daylightWindow) {
            windows.push(daylightWindow);
          }
        });
      });

      if (!windows.length) {
        return null;
      }

      return {
        sourceDaysCount: windows.length,
        sunriseMinute: windows.reduce(function (minValue, daylight) {
          return Math.min(minValue, daylight.firstMinute);
        }, 24 * 60),
        sunsetMinute: windows.reduce(function (maxValue, daylight) {
          return Math.max(maxValue, daylight.lastMinute);
        }, 0)
      };
    }

    function formatMinuteOfDay(minute) {
      const safeMinute = clampNumber(Math.round(minute || 0), 0, (24 * 60) - 1);
      const hour = Math.floor(safeMinute / 60);
      const minuteInHour = safeMinute - (hour * 60);
      return String(hour).padStart(2, "0") + ":" + String(minuteInHour).padStart(2, "0");
    }

    function getSaleDayMarkerIndex(minute) {
      const normalizedMinute = clampNumber(Math.round(minute == null ? 0 : minute), 0, (24 * 60) - 1);
      const hour = Math.floor(normalizedMinute / 60);
      const minuteInHour = normalizedMinute - (hour * 60);
      if (!state.dayDetailMode) {
        return hour;
      }

      return (hour * 5) + (minuteInHour / 15);
    }

    function renderSaleSunMarkers() {
      if (!sunMarkersEl) {
        return;
      }

      sunMarkersEl.innerHTML = "";

      if (state.range !== "day" || !state.chart || !state.items.length) {
        sunMarkersEl.hidden = true;
        return;
      }

      const daylightWindow = getSaleDaylightWindow();
      if (!daylightWindow) {
        sunMarkersEl.hidden = true;
        return;
      }

      [
        {
          type: "sunrise",
          label: "Wschód słońca",
          minute: daylightWindow.sunriseMinute,
          icon: "images/icons/sunrise.svg"
        },
        {
          type: "sunset",
          label: "Zachód słońca",
          minute: daylightWindow.sunsetMinute,
          icon: "images/icons/sunset.svg"
        }
      ].forEach(function (marker) {
        const position = state.chart.convertToPixel({ xAxisIndex: 0 }, getSaleDayMarkerIndex(marker.minute));
        if (!Number.isFinite(position) || position < -20 || position > chartEl.clientWidth + 20) {
          return;
        }

        const element = document.createElement("span");
        const clock = formatMinuteOfDay(marker.minute);

        element.className = "pv-sun-marker sale-sun-marker sale-sun-marker--" + marker.type;
        element.style.left = position + "px";
        element.style.backgroundImage = "url('" + marker.icon + "')";
        element.title = marker.label + ": " + clock + " (z ostatnich " + daylightWindow.sourceDaysCount + " dni)";
        element.setAttribute("aria-label", element.title);
        sunMarkersEl.appendChild(element);
      });

      sunMarkersEl.hidden = !sunMarkersEl.children.length;
    }

    function getSaleTooltipRangeLabel(item) {
      if (item && typeof item.rangeLabel === "string" && item.rangeLabel.trim()) {
        return item.rangeLabel.trim();
      }

      const label = item && typeof item.label === "string" ? item.label.trim() : "";
      const parsedHour = Number(label);
      if (state.range === "day" && label && Number.isFinite(parsedHour)) {
        return formatTooltipHour(parsedHour) + "–" + formatTooltipHour(parsedHour + 1);
      }

      return label || formatRangeName(state.range);
    }

    function formatSaleTooltipPercent(value, total) {
      return total > 0 ? formatDecimal((Math.max(value || 0, 0) / total) * 100, 0) + "%" : "--";
    }

    function saleTooltipRow(color, label, value, unit, total) {
      return [
        "<div class=\"pv-chart-tooltip__row\">",
        "<span class=\"pv-chart-tooltip__dot\" style=\"background:" + color + ";\"></span>",
        "<div class=\"pv-chart-tooltip__row-content\">",
        "<p class=\"pv-chart-tooltip__row-label\">" + escapeHtml(label) + "</p>",
        "<p class=\"pv-chart-tooltip__row-value\">" + formatDecimal(value, 2) + " " + unit + " | " + formatSaleTooltipPercent(value, total) + "</p>",
        "</div>",
        "</div>"
      ].join("");
    }

    function saleTooltipTextRow(color, label, text) {
      return [
        "<div class=\"pv-chart-tooltip__row\">",
        "<span class=\"pv-chart-tooltip__dot\" style=\"background:" + color + ";\"></span>",
        "<div class=\"pv-chart-tooltip__row-content\">",
        "<p class=\"pv-chart-tooltip__row-label\">" + escapeHtml(label) + "</p>",
        "<p class=\"pv-chart-tooltip__row-value\">" + escapeHtml(text) + "</p>",
        "</div>",
        "</div>"
      ].join("");
    }

    function positionSaleChartTooltip(point, params, dom, rect, size) {
      const viewSize = size && Array.isArray(size.viewSize)
        ? size.viewSize
        : [chartEl ? chartEl.clientWidth : 0, chartEl ? chartEl.clientHeight : 0];
      const rawContentSize = size && Array.isArray(size.contentSize) ? size.contentSize : [0, 0];
      const measuredTooltip = dom && dom.querySelector ? dom.querySelector(".sale-detail-tooltip") : null;
      const minimumTooltipHeight = state.showMarketRates ? 220 : 360;
      const contentSize = [
        Math.max(rawContentSize[0] || 0, dom && dom.offsetWidth ? dom.offsetWidth : 0, measuredTooltip && measuredTooltip.offsetWidth ? measuredTooltip.offsetWidth : 0, 320),
        Math.max(rawContentSize[1] || 0, dom && dom.offsetHeight ? dom.offsetHeight : 0, measuredTooltip && measuredTooltip.offsetHeight ? measuredTooltip.offsetHeight : 0, minimumTooltipHeight)
      ];
      const margin = 12;
      const gap = 18;
      const viewWidth = Math.max(viewSize[0] || 0, contentSize[0] + (margin * 2));
      const viewHeight = Math.max(viewSize[1] || 0, contentSize[1] + (margin * 2));
      const pointX = Array.isArray(point) ? point[0] : 0;
      const pointY = Array.isArray(point) ? point[1] : 0;
      const maxLeft = Math.max(margin, viewWidth - contentSize[0] - margin);
      const maxTop = Math.max(margin, viewHeight - contentSize[1] - margin);
      let left = pointX + gap;
      let top = pointY - contentSize[1] - gap;

      if (left + contentSize[0] + margin > viewWidth) {
        left = pointX - contentSize[0] - gap;
      }

      if (top < margin) {
        top = pointY + gap;
      }

      if (top + contentSize[1] + margin > viewHeight) {
        top = pointY - contentSize[1] - gap;
      }

      return [
        clampNumber(left, margin, maxLeft),
        clampNumber(top, margin, maxTop)
      ];
    }

    function getSaleTooltipTotals(items) {
      return items.reduce(function (totals, item) {
        if (isSaleFutureItem(item)) {
          return totals;
        }

        totals.energy += Math.max(0, firstNumber(item && item.exportKwh, 0) || 0);
        totals.value += Math.max(0, getSettlementValue(item) || 0);
        return totals;
      }, {
        energy: 0,
        value: 0
      });
    }

    function ensureSaleChart() {
      if (!chartEl || !window.echarts || !chartEl.offsetWidth || !chartEl.offsetHeight) {
        return null;
      }

      if (state.chart) {
        return state.chart;
      }

      state.chart = window.echarts.init(chartEl, null, {
        renderer: "canvas",
        useCoarsePointer: true,
        pointerSize: 14
      });

      state.chart.on("datazoom", function () {
        syncSaleWindowCount();
        requestAnimationFrame(renderSaleSunMarkers);
      });

      state.chart.on("click", function (params) {
        if (params.componentType !== "series" || typeof params.dataIndex !== "number") {
          return;
        }

        const target = getDashboardChartDrilldownTarget(
          state.range,
          state.anchorDate,
          state.items[params.dataIndex],
          params.dataIndex
        );
        if (!target) {
          return;
        }

        state.range = target.range;
        state.anchorDate = clampDashboardNavigationDate(target.anchorDate, state.range);
        state.anchorTouched = true;
        state.dayDetailMode = false;
        state.windowOrigin = getSaleWindowOrigin(state.range);
        state.windowStartIndex = null;
        state.windowCount = null;
        updateToolbar();
        applyPayload();
      });

      if (!currentHourHighlighter && typeof window.onRevoltCreateCurrentHourHighlighter === "function") {
        currentHourHighlighter = window.onRevoltCreateCurrentHourHighlighter({
          chart: state.chart,
          element: chartEl,
          getItems: function () { return state.items; },
          getRange: function () { return state.range; },
          getAnchorDate: function () { return state.anchorDate; }
        });
      }

      return state.chart;
    }

    function buildSaleOption(items) {
      const isWeekRange = state.range === "week";
      const isMarketMode = !!state.showMarketRates;
      const theme = getSaleThemeTokens();
      const labels = items.map(function (item) { return item.label; });
      const values = items.map(function (item) {
        if ((item && item.isGap) || isSaleFutureItem(item)) {
          return null;
        }

        return Math.max(0, getSettlementValue(item) || 0);
      });
      const energyValues = items.map(function (item) {
        if ((item && item.isGap) || isSaleFutureItem(item)) {
          return null;
        }

        return Math.max(0, firstNumber(item && item.exportKwh, 0) || 0);
      });
      const marketRateValues = items.map(function (item) {
        if (item && item.isGap) {
          return null;
        }

        return getSaleMarketRate(item);
      });
      const tooltipTotals = getSaleTooltipTotals(items);
      const maxValue = values.reduce(function (currentMax, value) {
        return Math.max(currentMax, value || 0);
      }, 0);
      const maxEnergy = energyValues.reduce(function (currentMax, value) {
        return Math.max(currentMax, value || 0);
      }, 0);
      const maxMarketRate = marketRateValues.reduce(function (currentMax, value) {
        return Math.max(currentMax, value == null ? 0 : value);
      }, 0);
      const dayScaleMax = state.range === "day"
        ? getSaleDayScaleMaxFromRecentDays(window.dashboardLatestPayload || {}, window.dashboardProsumerSimulation, state.anchorDate)
        : null;
      const axisConfig = getSaleAxisConfig(maxValue, 1, dayScaleMax && dayScaleMax.value);
      const auxiliaryAxisConfig = getSaleAxisConfig(maxEnergy, 1, dayScaleMax && dayScaleMax.energy);
      const primaryAxisConfig = isMarketMode
        ? getSaleMarketRateAxisConfig(window.dashboardLatestPayload || {}, window.dashboardProsumerSimulation, state.anchorDate, maxMarketRate)
        : axisConfig;
      const barWidth = state.range === "day" ? SALE_BAR_WIDTH : SALE_RANGE_BAR_WIDTH;
      const forecastSeriesOpacity = items.some(function (item) { return item && item.isForecast; }) ? 0.4 : 1;
      const series = [];
      const actualSaleByHour = items.reduce(function (totals, item) {
        const rangeMatch = String(item && item.rangeLabel || "").match(/^(\d{1,2}):/);
        if (!item || item.isGap || isSaleFutureItem(item) || !rangeMatch) {
          return totals;
        }

        const hourKey = String(item.sourceDate || "") + "-" + String(Number(rangeMatch[1]));
        totals[hourKey] = (totals[hourKey] || 0) + Math.max(0, firstNumber(item.exportKwh, 0) || 0);
        return totals;
      }, {});

      function hasActualSale(item) {
        const rangeMatch = String(item && item.rangeLabel || "").match(/^(\d{1,2}):/);
        if (!item || item.isGap || isSaleFutureItem(item) || !rangeMatch) {
          return false;
        }

        const hourKey = String(item.sourceDate || "") + "-" + String(Number(rangeMatch[1]));
        return (actualSaleByHour[hourKey] || 0) > DASHBOARD_SALE_ACTIVE_THRESHOLD_KWH;
      }

      function renderSaleAuxiliaryStep(params, api) {
        const coordSys = params && params.coordSys ? params.coordSys : null;
        if (!coordSys || !energyValues.length) {
          return null;
        }

        const baseline = api.coord([0, 0])[1];
        const centers = energyValues.map(function (_, index) {
          return api.coord([index, 0])[0];
        });
        const children = [];
        const linePoints = [];
        let previousY = null;

        energyValues.forEach(function (value, index) {
          if (value == null) {
            previousY = null;
            return;
          }

          const point = api.coord([index, value]);
          const centerX = point[0];
          const y = point[1];
          const leftNeighbor = centers[index - 1];
          const rightNeighbor = centers[index + 1];
          const fallbackSlotWidth = Math.max(barWidth, coordSys.width / Math.max(energyValues.length, 1));
          const startX = Math.max(
            coordSys.x,
            leftNeighbor == null ? centerX - (fallbackSlotWidth / 2) : (leftNeighbor + centerX) / 2
          );
          const endX = Math.min(
            coordSys.x + coordSys.width,
            rightNeighbor == null ? centerX + (fallbackSlotWidth / 2) : (centerX + rightNeighbor) / 2
          );
          const stepWidth = Math.max(0, endX - startX);
          const fillY = Math.min(y, baseline);
          const fillHeight = Math.abs(baseline - y);

          children.push({
            type: "rect",
            shape: {
              x: startX,
              y: fillY,
              width: stepWidth,
              height: fillHeight
            },
            style: {
              fill: SALE_COLORS.valueArea,
              stroke: "none",
              opacity: items[index] && items[index].isForecast ? 0.4 : 1
            },
            silent: true
          });

          if (!linePoints.length || previousY == null) {
            linePoints.push([startX, y]);
          } else {
            linePoints.push([startX, previousY], [startX, y]);
          }

          linePoints.push([endX, y]);
          previousY = y;
        });

        if (linePoints.length > 1) {
          children.push({
            type: "polyline",
            shape: {
              points: linePoints
            },
            style: {
              fill: null,
              stroke: SALE_COLORS.energy,
              lineWidth: 2,
              opacity: forecastSeriesOpacity
            },
            silent: true
          });
        }

        return {
          type: "group",
          children: children
        };
      }

      series.push({
        name: "Sprzedana energia",
        type: "custom",
        yAxisIndex: 1,
        data: [[0, 0]],
        renderItem: renderSaleAuxiliaryStep,
        clip: true,
        z: 1,
        silent: true
      });

      if (isMarketMode) {
        series.push({
          name: "Cena rynkowa sprzedaży",
          type: "bar",
          data: marketRateValues.map(function (value, index) {
            if (value == null) {
              return null;
            }

            return {
              value: value,
              itemStyle: {
                color: hasActualSale(items[index]) ? SALE_COLORS.marketActive : SALE_COLORS.marketIdle,
                opacity: items[index] && items[index].isForecast ? 0.4 : 1,
                borderRadius: value < 0
                  ? [0, 0, SALE_BAR_RADIUS, SALE_BAR_RADIUS]
                  : [SALE_BAR_RADIUS, SALE_BAR_RADIUS, 0, 0]
              }
            };
          }),
          yAxisIndex: 0,
          barWidth: barWidth,
          barMinHeight: 3,
          barCategoryGap: state.range === "day" ? "28%" : "34%",
          z: 2
        });
      } else {
        series.push({
          name: "Wartość sprzedaży",
          type: "bar",
          data: values.map(function (value, index) {
            if (value == null) {
              return null;
            }
            return {
              value: value,
              itemStyle: {
                opacity: items[index] && items[index].isForecast ? 0.4 : 1
              }
            };
          }),
          yAxisIndex: 0,
          barWidth: barWidth,
          barMinHeight: 3,
          barCategoryGap: state.range === "day" ? "28%" : "34%",
          itemStyle: {
            color: SALE_COLORS.value,
            borderRadius: [SALE_BAR_RADIUS, SALE_BAR_RADIUS, 0, 0]
          },
          z: 2
        });
      }

      return {
        animationDuration: 300,
        animationDurationUpdate: 260,
        grid: {
          top: 18,
          right: 54,
          bottom: isWeekRange ? 58 : 44,
          left: 54,
          containLabel: true
        },
        tooltip: {
          trigger: "axis",
          axisPointer: {
            type: "shadow",
            shadowStyle: {
              color: theme.pointerShadow
            }
          },
          backgroundColor: "transparent",
          borderWidth: 0,
          padding: 0,
          extraCssText: "box-shadow:none;",
          position: positionSaleChartTooltip,
          formatter: function (params) {
            const tooltipParam = Array.isArray(params)
              ? (params.find(function (param) {
                return param && param.seriesName === (isMarketMode ? "Cena rynkowa sprzedaży" : "Warto\u015b\u0107 sprzeda\u017cy");
              }) || params[0])
              : params;
            const item = tooltipParam && typeof tooltipParam.dataIndex === "number"
              ? items[tooltipParam.dataIndex]
              : null;

            const isFutureItem = isSaleFutureItem(item);

            if (!item || item.isGap || (!isMarketMode && isFutureItem)) {
              return "";
            }

            const exportKwh = isFutureItem ? null : Math.max(0, firstNumber(item && item.exportKwh, 0) || 0);
            const settlementValue = isFutureItem ? null : Math.max(0, getSettlementValue(item) || 0);
            const salePrice = getDisplayPrice(item);
            const marketRate = getSaleMarketRate(item);

            if (isMarketMode) {
              return [
                "<div class=\"pv-chart-tooltip sale-detail-tooltip sale-market-tooltip\">",
                "<p class=\"pv-chart-tooltip__title\">Sprzedaż energii</p>",
                "<p class=\"pv-chart-tooltip__range\">" + escapeHtml(getSaleTooltipRangeLabel(item)) + "</p>",
                saleTooltipTextRow(
                  SALE_COLORS.marketActive,
                  "Cena rynkowa sprzedaży",
                  marketRate == null ? "--" : formatDecimal(marketRate, 2) + " PLN/kWh"
                ),
                saleTooltipTextRow(
                  SALE_COLORS.energy,
                  "Ilość sprzedanej energii",
                  exportKwh == null ? "--" : formatDecimal(exportKwh, 2) + " kWh"
                ),
                "</div>"
              ].join("");
            }

            const auxiliaryRow = saleTooltipRow(SALE_COLORS.energy, "Sprzedana energia", exportKwh, "kWh", tooltipTotals.energy);
            const valueRow = settlementValue == null
              ? saleTooltipTextRow(SALE_COLORS.value, "Warto\u015b\u0107 sprzeda\u017cy", "--")
              : saleTooltipRow(SALE_COLORS.value, "Warto\u015b\u0107 sprzeda\u017cy", settlementValue, "PLN", tooltipTotals.value);
            const priceRow = saleTooltipTextRow(
              SALE_COLORS.price,
              "Cena sprzeda\u017cy",
              salePrice == null ? "--" : formatDecimal(salePrice, 2) + " PLN/kWh"
            );

            return [
              "<div class=\"pv-chart-tooltip sale-detail-tooltip\">",
              "<p class=\"pv-chart-tooltip__title\">Sprzeda\u017c energii</p>",
              "<p class=\"pv-chart-tooltip__range\">" + escapeHtml(getSaleTooltipRangeLabel(item)) + "</p>",
              auxiliaryRow,
              valueRow,
              priceRow,
              "</div>"
            ].join("");
          }
        },
        xAxis: {
          type: "category",
          data: labels,
          axisTick: { show: false },
          axisLine: { show: false },
          boundaryGap: true,
          axisLabel: {
            color: theme.text,
            fontSize: 14,
            lineHeight: 20,
            margin: isWeekRange ? 18 : 14,
            interval: 0
          }
        },
        yAxis: [
          {
            type: "value",
            min: primaryAxisConfig.min == null ? 0 : primaryAxisConfig.min,
            max: primaryAxisConfig.max,
            interval: primaryAxisConfig.interval,
            splitNumber: primaryAxisConfig.splitNumber,
            axisTick: { show: false },
            axisLine: { show: false },
            axisLabel: {
              color: theme.text,
              fontSize: 14,
              margin: 12,
              formatter: function (value) {
                return formatDecimal(value, 2);
              }
            },
            splitLine: {
              lineStyle: {
                color: theme.gridLine,
                width: 1
              }
            }
          },
          {
            type: "value",
            show: true,
            min: auxiliaryAxisConfig.min == null ? 0 : auxiliaryAxisConfig.min,
            max: auxiliaryAxisConfig.max,
            interval: auxiliaryAxisConfig.interval,
            splitNumber: auxiliaryAxisConfig.splitNumber,
            axisTick: { show: false },
            axisLine: { show: false },
            axisLabel: {
              color: theme.text,
              fontSize: 14,
              margin: 12,
              formatter: function (value) {
                return value === 0 ? "0" : formatDecimal(value, 2);
              }
            },
            splitLine: {
              show: false
            }
          }
        ],
        dataZoom: [
          {
            id: "sale-inside",
            type: "inside",
            minValueSpan: state.range === "day" && state.dayDetailMode ? SALE_DAY_ZOOM_WINDOWS[1] - 1 : undefined,
            xAxisIndex: 0,
            filterMode: "none",
            zoomOnMouseWheel: false,
            moveOnMouseWheel: false,
            moveOnMouseMove: true,
            preventDefaultMouseMove: false
          },
          {
            id: "sale-slider",
            type: "slider",
            minValueSpan: state.range === "day" && state.dayDetailMode ? SALE_DAY_ZOOM_WINDOWS[1] - 1 : undefined,
            show: false,
            xAxisIndex: 0,
            filterMode: "none"
          }
        ],
        series: series
      };
    }

    function updateSaleZoomButtons() {
      zoomButtons.forEach(function (button) {
        const zoomIn = Number(button.getAttribute("data-sale-zoom")) > 0;
        const atDayLimit = state.range === "day" && (zoomIn
          ? state.dayDetailMode && state.windowCount <= SALE_DAY_ZOOM_WINDOWS[1]
          : !state.dayDetailMode && state.windowCount >= state.items.length);
        button.disabled = !state.items.length || atDayLimit;
      });
    }

    function applySaleZoomWindow() {
      updateSaleZoomButtons();
      if (!state.chart || !state.items.length) {
        return;
      }

      const fullLength = state.items.length;
      const maxStartIndex = Math.max(fullLength - state.windowCount, 0);
      const startValue = state.windowStartIndex != null
        ? clampNumber(state.windowStartIndex, 0, maxStartIndex)
        : (state.windowOrigin === "start" ? 0 : Math.max(0, fullLength - state.windowCount));
      const endValue = Math.min(fullLength - 1, startValue + state.windowCount - 1);

      state.chart.dispatchAction({
        type: "dataZoom",
        dataZoomId: "sale-inside",
        startValue: startValue,
        endValue: endValue
      });
    }

    function switchSaleDayDetailMode(nextMode, startValue, endValue) {
      const startHour = state.dayDetailMode ? Math.floor(startValue / 5) : startValue;
      const endHourExclusive = state.dayDetailMode ? Math.ceil((endValue + 1) / 5) : endValue + 1;

      state.dayDetailMode = nextMode;
      state.windowStartIndex = nextMode ? startHour * 5 : startHour;
      state.windowCount = nextMode
        ? Math.max(5, (endHourExclusive - startHour) * 5)
        : Math.max(1, endHourExclusive - startHour);
      applyPayload();
    }

    function syncSaleWindowCount() {
      if (!state.chart || !state.items.length) {
        return;
      }

      const option = state.chart.getOption();
      const zoomState = option.dataZoom && option.dataZoom[0];
      if (!zoomState) {
        return;
      }

      const startValue = typeof zoomState.startValue === "number" ? zoomState.startValue : 0;
      const endValue = typeof zoomState.endValue === "number" ? zoomState.endValue : state.items.length - 1;

      state.windowStartIndex = startValue;
      state.windowCount = clampNumber(
        (endValue - startValue) + 1,
        getSaleMinWindow(state.range, state.items.length),
        state.items.length
      );
      updateSaleZoomButtons();

      if (state.range === "day") {
        const scale = getSaleDayZoomScale(state.windowCount, state.dayDetailMode);
        if (!state.dayDetailMode && scale > 199) {
          switchSaleDayDetailMode(true, startValue, endValue);
          return;
        }
        if (state.dayDetailMode && scale <= 190) {
          switchSaleDayDetailMode(false, startValue, endValue);
        }
      }
    }

    function renderZeroState(message) {
      state.items = [];
      if (state.chart) {
        state.chart.clear();
      } else if (chartEl) {
        chartEl.innerHTML = "";
      }
      if (chartPanelEl) {
        chartPanelEl.classList.add("is-empty");
      }
      if (chartEmptyEl) {
        chartEmptyEl.textContent = message || "Brak danych sprzeda\u017cy energii dla wybranego zakresu.";
      }
      renderSaleSunMarkers();
      setPriceMetric(currentPriceValueEl, null);
      updateCurrentSalePriceState(null, null);
      setPriceMetric(bestPriceValueEl, null);
      setPriceMetric(averagePriceValueEl, null);
      setValueMetric(totalValueEl, null);
      setValueMetric(depositValueEl, null);
      setEnergyMetric(energyValueEl, null);
      setEnergyMetric(marketEnergyValueEl, null);
      setPriceMetric(marketAveragePriceValueEl, null);
      setPriceMetric(marketHighPriceValueEl, null);
      setPriceMetric(marketLowPriceValueEl, null);
    }

    function renderChart(items) {
      state.items = Array.isArray(items) ? items : [];

      if (!chartEl) {
        return;
      }

      if (!state.items.length) {
        if (chartPanelEl) {
          chartPanelEl.classList.add("is-empty");
        }
        if (state.chart) {
          state.chart.clear();
        }
        renderSaleSunMarkers();
        return;
      }

      if (chartPanelEl) {
        chartPanelEl.classList.remove("is-empty");
      }

      const chart = ensureSaleChart();
      if (!chart) {
        return;
      }

      state.windowCount = clampNumber(
        state.windowCount || getSaleDefaultWindow(state.range, state.items.length),
        getSaleMinWindow(state.range, state.items.length),
        Math.max(state.items.length, 1)
      );
      state.windowStartIndex = state.windowStartIndex == null
        ? null
        : clampNumber(state.windowStartIndex, 0, Math.max(state.items.length - state.windowCount, 0));

      chart.setOption(buildSaleOption(state.items), true);
      applySaleZoomWindow();
      if (currentHourHighlighter) {
        currentHourHighlighter.update();
      }
      requestAnimationFrame(renderSaleSunMarkers);
    }

    function zoomSaleChart(direction) {
      if (!state.items.length) {
        return;
      }

      const minWindow = getSaleMinWindow(state.range, state.items.length);
      const currentStart = state.windowStartIndex == null
        ? (state.windowOrigin === "start" ? 0 : Math.max(0, state.items.length - state.windowCount))
        : state.windowStartIndex;
      const currentEnd = Math.min(state.items.length - 1, currentStart + state.windowCount - 1);
      const currentCenter = currentStart + ((currentEnd - currentStart) / 2);
      if (state.range === "day") {
        Object.assign(state, window.onRevoltDayZoom.detailWindow(state, currentCenter, direction));
        applyPayload();
        return;
      }

      const targetWindow = direction > 0
        ? Math.max(minWindow, Math.round(state.windowCount * 0.8))
        : Math.min(state.items.length, Math.round(state.windowCount * 1.25));

      state.windowCount = clampNumber(targetWindow, minWindow, state.items.length);
      state.windowStartIndex = clampNumber(
        Math.round(currentCenter - ((state.windowCount - 1) / 2)),
        0,
        Math.max(state.items.length - state.windowCount, 0)
      );
      applySaleZoomWindow();
      requestAnimationFrame(renderSaleSunMarkers);
    }

    function resetSaleZoomWindow() {
      if (!state.items.length) {
        return;
      }

      const wasDayDetailMode = state.dayDetailMode;
      state.dayDetailMode = false;
      state.windowOrigin = getSaleWindowOrigin(state.range);
      state.windowStartIndex = null;
      state.windowCount = state.windowOrigin === "start"
        ? state.items.length
        : getSaleDefaultWindow(state.range, state.items.length);

      if (wasDayDetailMode) {
        applyPayload();
        return;
      }

      applySaleZoomWindow();
      requestAnimationFrame(renderSaleSunMarkers);
    }

    function jumpToLatestSaleDay() {
      state.range = "day";
      state.anchorDate = getDashboardNavigationDay(new Date());
      state.anchorTouched = true;
      state.anchorSourceKey = formatDateKey(state.anchorDate);
      state.dayDetailMode = false;
      state.windowOrigin = getSaleWindowOrigin(state.range);
      state.windowStartIndex = null;
      state.windowCount = null;
      updateToolbar();
      applyPayload();
    }

    function updateCards(items, payload) {
      const displayPrices = items
        .map(getDisplayPrice)
        .filter(function (value) { return value != null; });
      const totalEnergy = items.reduce(function (sum, item) {
        return sum + (firstNumber(item && item.exportKwh, 0) || 0);
      }, 0);
      const totalValue = items.reduce(function (sum, item) {
        return sum + (getSettlementValue(item) || 0);
      }, 0);
      const weightedAverage = totalEnergy > 0
        ? items.reduce(function (sum, item) {
          return sum + ((getDisplayPrice(item) || 0) * (firstNumber(item && item.exportKwh, 0) || 0));
        }, 0) / totalEnergy
        : (displayPrices.length
          ? displayPrices.reduce(function (sum, value) { return sum + value; }, 0) / displayPrices.length
          : null);
      const bestPrice = displayPrices.length ? Math.max.apply(Math, displayPrices) : null;
      const currentPrice = getCurrentSalePrice(payload, items);
      const marketRates = items
        .map(getSaleMarketRate)
        .filter(function (value) { return value != null; });
      const actualSaleItems = items.filter(function (item) {
        return item
          && !item.isGap
          && !isSaleFutureItem(item)
          && Math.max(0, firstNumber(item.exportKwh, 0) || 0) > 0;
      });
      const marketEnergy = actualSaleItems.reduce(function (sum, item) {
        return sum + Math.max(0, firstNumber(item.exportKwh, 0) || 0);
      }, 0);
      const marketWeightedValue = actualSaleItems.reduce(function (sum, item) {
        const marketRate = getSaleMarketRate(item);
        const energy = Math.max(0, firstNumber(item.exportKwh, 0) || 0);
        return sum + (marketRate == null ? 0 : marketRate * energy);
      }, 0);
      const marketAveragePrice = marketEnergy > 0 ? marketWeightedValue / marketEnergy : null;
      const marketHighPrice = marketRates.length ? Math.max.apply(Math, marketRates) : null;
      const marketLowPrice = marketRates.length ? Math.min.apply(Math, marketRates) : null;

      setPriceMetric(currentPriceValueEl, currentPrice);
      updateCurrentSalePriceState(currentPrice, bestPrice);
      setPriceMetric(bestPriceValueEl, bestPrice);
      setPriceMetric(averagePriceValueEl, weightedAverage);
      setValueMetric(totalValueEl, totalValue);
      setValueMetric(depositValueEl, totalValue);
      setEnergyMetric(energyValueEl, totalEnergy);
      setEnergyMetric(marketEnergyValueEl, marketEnergy);
      setPriceMetric(marketAveragePriceValueEl, marketAveragePrice);
      setPriceMetric(marketHighPriceValueEl, marketHighPrice);
      setPriceMetric(marketLowPriceValueEl, marketLowPrice);
    }

    function updateSaleMarketModeUi() {
      const canUseMarketRates = state.range === "day";

      if (!canUseMarketRates && state.showMarketRates) {
        state.showMarketRates = false;
      }

      if (marketToggleButton) {
        marketToggleButton.disabled = !canUseMarketRates;
        marketToggleButton.classList.toggle("is-active", canUseMarketRates && !!state.showMarketRates);
        marketToggleButton.classList.toggle("is-disabled", !canUseMarketRates);
        marketToggleButton.setAttribute("aria-pressed", canUseMarketRates && state.showMarketRates ? "true" : "false");
        marketToggleButton.setAttribute("aria-disabled", canUseMarketRates ? "false" : "true");
      }
      if (primaryUnitPill) {
        primaryUnitPill.textContent = state.showMarketRates ? "PLN/kWh" : "PLN";
      }
      if (auxiliaryUnitPill) {
        auxiliaryUnitPill.textContent = "kWh";
      }
      salePage.setAttribute("data-sale-mode", state.showMarketRates ? "rates" : "energy");
    }

    function updateToolbar() {
      let label = formatLongDate(state.anchorDate);
      if (state.range === "week") {
        label = formatWeekLabel(state.anchorDate);
      } else if (state.range === "month") {
        label = formatMonthLabel(state.anchorDate);
      } else if (state.range === "year") {
        label = formatYearLabel(state.anchorDate);
      }

      if (breadcrumbRangeEl) {
        breadcrumbRangeEl.textContent = formatRangeName(state.range);
      }

      if (rangeLabelEl) {
        rangeLabelEl.textContent = label;
        window.DashboardCalendar.sync(rangeLabelEl, {
          date: state.anchorDate, range: state.range,
          clamp: function (date) { return clampDashboardNavigationDate(date, state.range); },
          select: function (date) {
            state.anchorTouched = true;
            state.anchorDate = clampDashboardNavigationDate(date, state.range);
            state.windowStartIndex = null;
            updateToolbar();
            applyPayload();
          }
        });
      }

      rangeButtons.forEach(function (button) {
        const isActive = button.getAttribute("data-sale-range") === state.range;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });

      updateDashboardShiftButtons(shiftButtons, state.range, state.anchorDate, "data-sale-shift");
      updateSaleMarketModeUi();
    }

    function shiftRange(step) {
      state.anchorTouched = true;
      let nextDate = new Date(state.anchorDate);
      if (state.range === "week") {
        nextDate = addDays(state.anchorDate, step * 7);
      } else if (state.range === "month") {
        nextDate = addMonths(state.anchorDate, step);
      } else if (state.range === "year") {
        nextDate = addYears(state.anchorDate, step);
      } else {
        nextDate = addDays(state.anchorDate, step);
      }
      state.anchorDate = clampDashboardNavigationDate(nextDate, state.range);
      state.windowStartIndex = null;
      updateToolbar();
      applyPayload();
    }

    function applyPayload() {
      const payload = window.dashboardLatestPayload || {};
      const simulation = window.dashboardProsumerSimulation;
      const payloadAnchorDate = getPayloadAnchorDate(payload);
      const payloadAnchorKey = formatDateKey(payloadAnchorDate);
      state.latestDataTime = getDashboardLatestDataTime(payload);

      if (!state.anchorSourceKey || (!state.anchorTouched && state.anchorSourceKey !== payloadAnchorKey)) {
        state.anchorDate = payloadAnchorDate;
        state.anchorSourceKey = payloadAnchorKey;
      }

      state.anchorDate = clampDashboardNavigationDate(state.anchorDate, state.range);
      updateToolbar();

      if (isDashboardSelectionBeforeHistoryStart(state.range, state.anchorDate, payload)) {
        renderZeroState("Brak historii sprzedaży energii.");
        return;
      }

      if (!simulation && !hasMeasuredPvSaleData(payload)) {
        renderZeroState("Brak danych sprzedaży energii.");
        return;
      }

      const rangeWindow = getRangeWindow(state.range, state.anchorDate);
      let items = window.dashboardReForecastEnabled && simulation && simulation.isForecast
        ? buildForecastAwareRangeItems(payload, simulation, rangeWindow)
        : buildMeasuredRangeItems(payload, rangeWindow);
      if (!items.length) {
        items = buildRangeItems(simulation, rangeWindow);
      }
      if (!items.length) {
        renderZeroState("Brak danych sprzedaży energii dla wybranego zakresu.");
        return;
      }

      if (state.range === "day" && state.dayDetailMode && getDashboardRuntime() === "web") {
        items = applySaleQuarterMarketRates(items, payload);
      }
      renderChart(items);
      updateCards(items, payload);
    }

    const state = {
      range: "day",
      anchorDate: new Date(),
      anchorTouched: false,
      anchorSourceKey: "",
      settlement: "deposit",
      priceMode: "full",
      showMarketRates: false,
      chart: null,
      items: [],
      dayDetailMode: false,
      windowOrigin: "start",
      windowStartIndex: null,
      windowCount: null,
      latestDataTime: null
    };
    let currentHourHighlighter = null;

    rangeButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        state.range = button.getAttribute("data-sale-range") || "day";
        state.anchorDate = clampDashboardNavigationDate(state.anchorDate, state.range);
        state.anchorTouched = true;
        state.dayDetailMode = false;
        state.windowOrigin = getSaleWindowOrigin(state.range);
        state.windowStartIndex = null;
        state.windowCount = null;
        updateToolbar();
        applyPayload();
      });
    });

    shiftButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        shiftRange(Number(button.getAttribute("data-sale-shift") || 0));
      });
    });

    zoomButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        const direction = Number(button.getAttribute("data-sale-zoom") || 0);
        zoomSaleChart(direction);
      });
    });

    if (zoomResetButton) {
      zoomResetButton.addEventListener("click", function () {
        jumpToLatestSaleDay();
      });
    }

    if (marketToggleButton) {
      marketToggleButton.addEventListener("click", function () {
        if (state.range !== "day") {
          state.showMarketRates = false;
          updateToolbar();
          return;
        }
        state.showMarketRates = !state.showMarketRates;
        updateToolbar();
        applyPayload();
      });
    }

    [currentDateButton, currentTimeButton].forEach(function (button) {
      if (!button) {
        return;
      }

      button.addEventListener("click", function () {
        jumpToLatestSaleDay();
      });
    });

    document.addEventListener("dashboard:payload-updated", applyPayload);
    document.addEventListener("dashboard:prosumer-updated", applyPayload);
    document.addEventListener("dashboard:bank-incremental-updated", function () {
      if (document.body && document.body.getAttribute("data-active-detail-view") === "sale") {
        applyPayload();
      }
    });

    document.addEventListener("detailview:open", function (event) {
      if (!event.detail || event.detail.view !== "sale") {
        return;
      }

      requestAnimationFrame(function () {
        if (state.items.length) {
          renderChart(state.items);
        }
        if (state.chart) {
          state.chart.resize();
          requestAnimationFrame(renderSaleSunMarkers);
        }
      });
    });

    document.addEventListener("detailview:themechange", function () {
      if (state.chart && state.items.length) {
        renderChart(state.items);
        state.chart.resize();
      }
    });

    window.addEventListener("resize", function () {
      if (state.chart) {
        state.chart.resize();
        requestAnimationFrame(renderSaleSunMarkers);
      }
    });

    updateToolbar();
    applyPayload();
  }

  function initPurchaseView() {
    const purchasePage = document.getElementById("purchase-detail");
    const breadcrumbRangeEl = document.getElementById("purchase-breadcrumb-range");
    const rangeLabelEl = document.getElementById("purchase-range-label");
    const chartEl = document.getElementById("purchase-detail-chart");
    const chartPanelEl = document.getElementById("purchase-chart-panel");
    const chartEmptyEl = document.getElementById("purchase-chart-empty");
    const sunMarkersEl = document.getElementById("purchase-sun-markers");
    const currentPriceValueEl = document.getElementById("purchase-current-price-value");
    const currentPriceStatusEl = document.getElementById("purchase-current-price-status");
    const currentPriceMeterThumbEl = document.getElementById("purchase-current-price-meter-thumb");
    const averagePriceValueEl = document.getElementById("purchase-average-price-value");
    const totalValueEl = document.getElementById("purchase-total-value");
    const energyValueEl = document.getElementById("purchase-energy-value");
    const depositCoveredValueEl = document.getElementById("purchase-deposit-covered-value");
    const feesValueEl = document.getElementById("purchase-fees-value");
    const payableValueEl = document.getElementById("purchase-payable-value");
    const rangeButtons = Array.from(document.querySelectorAll("[data-purchase-range]"));
    const shiftButtons = Array.from(document.querySelectorAll("[data-purchase-shift]"));
    const zoomButtons = Array.from(document.querySelectorAll("[data-purchase-zoom]"));
    const zoomResetButton = document.querySelector("[data-purchase-zoom-reset='true']");
    const marketToggleButton = document.querySelector("[data-purchase-market-toggle='true']");
    const auxiliaryUnitPill = purchasePage.querySelector(".purchase-kwh-unit-pill");
    const currentDateButton = document.getElementById("purchase-current-date");
    const currentTimeButton = document.getElementById("purchase-current-time");
    const tariffZoneTimeEls = {
      low: document.getElementById("purchase-zone-low-time"),
      high: document.getElementById("purchase-zone-high-time"),
      mid: document.getElementById("purchase-zone-mid-time")
    };
    const tariffEnergyPriceEls = {
      low: document.getElementById("purchase-energy-low-price"),
      high: document.getElementById("purchase-energy-high-price"),
      mid: document.getElementById("purchase-energy-mid-price")
    };
    const tariffDistributionPriceEls = {
      low: document.getElementById("purchase-distribution-low-price"),
      high: document.getElementById("purchase-distribution-high-price"),
      mid: document.getElementById("purchase-distribution-mid-price")
    };
    const monthTitleFormatter = new Intl.DateTimeFormat("pl-PL", {
      month: "long",
      year: "numeric"
    });
    const monthShortFormatter = new Intl.DateTimeFormat("pl-PL", {
      month: "short"
    });
    const weekdayLongFormatter = new Intl.DateTimeFormat("pl-PL", {
      weekday: "long"
    });
    const PURCHASE_RANGE_DEFAULT_WINDOW = { day: 24, week: 7, month: 14, year: 6 };
    const PURCHASE_RANGE_MIN_WINDOW = { day: 6, week: 4, month: 7, year: 3 };
    const PURCHASE_BAR_WIDTH = 40;
    const PURCHASE_RANGE_BAR_WIDTH = 36;
    const PURCHASE_BAR_RADIUS = 5;
    const PURCHASE_COLORS = {
      energy: "#b0bbd5",
      energyArea: "rgba(176, 187, 213, 0.16)",
      cost: "#fc7c00",
      deposit: "#fc7c00",
      depositStripe: "#8a47ff",
      fees: "#fdb066",
      marketLow: "#fc7c00",
      marketHigh: "#ffd7ad",
      marketMid: "#fdb066",
      marketArea: "rgba(176, 187, 213, 0.18)"
    };

    if (!purchasePage) {
      return;
    }

    function getPurchaseThemeColor(variableName, fallback) {
      const value = getComputedStyle(purchasePage).getPropertyValue(variableName).trim();
      return value || fallback;
    }

    function getPurchaseThemeTokens() {
      return {
        text: getPurchaseThemeColor("--usage-ink", "#1A1A1A"),
        gridLine: getPurchaseThemeColor("--usage-chart-grid", "rgba(26, 26, 26, 0.10)"),
        pointerShadow: getPurchaseThemeColor("--usage-chart-grid", "rgba(176, 187, 213, 0.10)")
      };
    }

    function getPurchaseNiceScaleMax(value) {
      if (!Number.isFinite(value) || value <= 0) {
        return 1;
      }

      const padded = value * 1.12;
      const magnitude = Math.pow(10, Math.floor(Math.log10(padded)));
      const normalized = padded / magnitude;
      let nice = 10;

      if (normalized <= 1) {
        nice = 1;
      } else if (normalized <= 2) {
        nice = 2;
      } else if (normalized <= 5) {
        nice = 5;
      }

      return nice * magnitude;
    }

    function getPurchaseAxisConfig(maxValue, minimumMax) {
      const splitCount = 6;
      const axisMax = Math.max(minimumMax || 1, getPurchaseNiceScaleMax(maxValue || 0));

      return {
        max: axisMax,
        interval: axisMax / splitCount,
        splitNumber: splitCount
      };
    }

    function getPurchaseMarketRateAxisConfig(payload, simulation, date, fallbackMax) {
      const splitCount = 6;
      const tariff = getPurchaseTariff(payload);
      const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      let maxRate = Math.max(Number(fallbackMax) || 0, 0);

      for (let currentDate = new Date(firstDay); currentDate.getTime() <= lastDay.getTime(); currentDate = addDays(currentDate, 1)) {
        const dateKey = formatDateKey(currentDate);

        for (let hour = 0; hour < 24; hour += 1) {
          const rcePricePln = resolveRcePriceForDateHour(payload, dateKey, hour);
          const energyRate = resolveEnergyPurchaseRate(tariff, dateKey, hour, rcePricePln);
          const variableFeeRate = resolveVariablePurchaseFeeRate(tariff, dateKey, hour);
          const rate = energyRate == null && variableFeeRate == null
            ? null
            : (energyRate || 0) + (variableFeeRate || 0);
          if (rate != null) {
            maxRate = Math.max(maxRate, rate);
          }
        }
      }

      if (simulation && Array.isArray(simulation.days)) {
        simulation.days.forEach(function (day) {
          const dateKey = String(day && day.dateKey ? day.dateKey : "");
          const parsed = parseDateKey(dateKey);
          if (!parsed || parsed < firstDay || parsed > lastDay) {
            return;
          }

          buildSimulationHourItems(day).forEach(function (item) {
            const rate = getPurchaseMarketChartRate(item);
            if (rate != null) {
              maxRate = Math.max(maxRate, rate);
            }
          });
        });
      }

      const axisMax = Math.max(0.3, maxRate + 0.2);

      return {
        min: 0,
        max: axisMax,
        interval: axisMax / splitCount,
        splitNumber: splitCount
      };
    }

    function getPurchaseDefaultWindow(range, length) {
      if (range === "day" && state.dayDetailMode) {
        return Math.min(119, Math.max(length, 1));
      }
      if (range === "month" || range === "year") {
        return Math.max(length, 1);
      }
      return Math.min(PURCHASE_RANGE_DEFAULT_WINDOW[range] || length, Math.max(length, 1));
    }

    function getPurchaseMinWindow(range, length) {
      if (range === "day" && state.dayDetailMode) {
        return Math.min(35, Math.max(length, 1));
      }
      return Math.min(PURCHASE_RANGE_MIN_WINDOW[range] || 1, Math.max(length, 1));
    }

    function getPurchaseDayZoomScale(windowCount, detailMode) {
      const visibleHours = detailMode ? Math.max(windowCount / 5, 0.25) : Math.max(windowCount, 0.25);
      return Math.round((24 / visibleHours) * 100);
    }

    function numberOrNull(value) {
      if (value == null || value === "") {
        return null;
      }

      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }

    function firstNumber() {
      for (let i = 0; i < arguments.length; i += 1) {
        const numeric = numberOrNull(arguments[i]);
        if (numeric != null) {
          return numeric;
        }
      }

      return null;
    }

    function formatDecimal(value, digits) {
      return Number(value || 0).toFixed(digits == null ? 2 : digits).replace(".", ",");
    }

    function setMetric(element, value, digits) {
      if (!element) {
        return;
      }

      element.textContent = value == null ? "--" : formatDecimal(value, digits == null ? 2 : digits);
    }

    function setText(element, value) {
      if (element) {
        element.textContent = value || "--";
      }
    }

    function formatPriceRate(value) {
      return value == null ? "--" : formatDecimal(value, 4);
    }

    function formatRangeName(range) {
      switch (range) {
        case "week":
          return "Tydzień";
        case "month":
          return "Miesiąc";
        case "year":
          return "Rok";
        default:
          return "Dzień";
      }
    }

    function formatLongDate(date) {
      return capitalize(weekdayFormatter.format(date)) + " " + dateFormatter.format(date);
    }

    function addDays(date, days) {
      const next = new Date(date);
      next.setDate(next.getDate() + days);
      return next;
    }

    function addMonths(date, months) {
      const next = new Date(date);
      next.setMonth(next.getMonth() + months);
      return next;
    }

    function addYears(date, years) {
      const next = new Date(date);
      next.setFullYear(next.getFullYear() + years);
      return next;
    }

    function getStartOfWeek(date) {
      const next = new Date(date);
      const day = next.getDay();
      const shift = day === 0 ? -6 : 1 - day;
      next.setDate(next.getDate() + shift);
      return next;
    }

    function formatWeekLabel(date) {
      const start = getStartOfWeek(date);
      const end = addDays(start, 6);
      return dateFormatter.format(start) + " - " + dateFormatter.format(end);
    }

    function formatMonthLabel(date) {
      return capitalize(monthTitleFormatter.format(date));
    }

    function formatYearLabel(date) {
      return String(date.getFullYear());
    }

    function formatDateKey(date) {
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
      ].join("-");
    }

    function parseDateKey(value) {
      if (typeof value !== "string" || !value.trim()) {
        return null;
      }

      const parsed = new Date(value.trim().slice(0, 10) + "T00:00:00");
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function getRangeWindow(range, anchorDate) {
      let start = new Date(anchorDate);
      let end = new Date(anchorDate);

      if (range === "week") {
        start = getStartOfWeek(anchorDate);
        end = addDays(start, 6);
      } else if (range === "month") {
        start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
        end = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
      } else if (range === "year") {
        start = new Date(anchorDate.getFullYear(), 0, 1);
        end = new Date(anchorDate.getFullYear(), 11, 31);
      }

      return {
        start: start,
        end: end,
        startKey: formatDateKey(start),
        endKey: formatDateKey(end)
      };
    }

    function normalizeText(value) {
      let text = String(value || "").toLowerCase();
      const replacements = {
        "\u0105": "a",
        "\u0107": "c",
        "\u0119": "e",
        "\u0142": "l",
        "\u0144": "n",
        "\u00f3": "o",
        "\u015b": "s",
        "\u017a": "z",
        "\u017c": "z"
      };

      text = text.replace(/[\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c]/g, function (match) {
        return replacements[match] || match;
      });

      return text.replace(/\s+/g, " ").trim();
    }

    function shouldUseMeasuredUsageSplit(usageData) {
      return isMeasuredUsageDataset(usageData);
    }

    function getPurchaseTariff(payload) {
      if (payload.tariffHistory?.strict) return clientTariffActual(payload, null);
      const tariffData = payload && payload.tariffData ? payload.tariffData : null;
      return tariffData && (tariffData.next || tariffData.current)
        ? (tariffData.next || tariffData.current)
        : null;
    }

    function canUseMeasuredPurchaseData(payload) {
      const mode = getDashboardDataMode(payload);
      return mode === DASHBOARD_DATA_MODE_REAL || mode === DASHBOARD_DATA_MODE_USAGE_ONLY;
    }

    function getPayloadRceForDate(payload, dateKey) {
      const priceHistory = payload && payload.priceHistory ? payload.priceHistory : null;
      const byDate = priceHistory && priceHistory.rceByDate ? priceHistory.rceByDate : null;

      if (byDate && dateKey && Object.prototype.hasOwnProperty.call(byDate, dateKey)) {
        return byDate[dateKey];
      }

      const rce = payload && payload.rce ? payload.rce : null;
      return rce && rce.businessDate === dateKey ? rce : null;
    }

    function resolveRcePriceForDateHour(payload, dateKey, hour) {
      const rce = getPayloadRceForDate(payload, dateKey);
      const hourlyRates = rce && Array.isArray(rce.hourlyRates) ? rce.hourlyRates : [];

      for (let index = 0; index < hourlyRates.length; index += 1) {
        const entry = hourlyRates[index];
        if (Number(entry && entry.hour) === hour) {
          return firstNumber(entry && entry.pricePln, entry && entry.price, entry && entry.value);
        }
      }

      return firstNumber(rce && rce.currentPricePln);
    }

    function sumTariffVariableRows(rows, matcher, windowCode) {
      return (rows || []).reduce(function (sum, row) {
        const rowCode = normalizeText(row && row.window_code ? row.window_code : "all");
        if (rowCode !== windowCode || !matcher(normalizeText(row && row.label))) {
          return sum;
        }
        return sum + (Number(row && row.price) || 0);
      }, 0);
    }

    function getZoneCodeForDateHour(tariff, dateKey, hour) {
      if (tariff?.clientTariffHistory?.strict) return ReTariffEngine.zone(ReTariffEngine.resolve(tariff.clientTariffHistory, dateKey, null), dateKey, hour);
      const monthNumber = parseInt(String(dateKey || "").slice(5, 7), 10);
      const monthly = tariff && tariff.monthly ? tariff.monthly : null;
      const row = monthly && monthNumber ? (monthly[String(monthNumber)] || monthly[monthNumber]) : null;
      const zoneValue = row && row.length ? (Number(row[hour]) || 2) : 2;

      if (zoneValue === 1) {
        return "high";
      }
      if (zoneValue === 3) {
        return "low";
      }
      return "mid";
    }

    function resolveEnergyPurchaseRate(tariff, dateKey, hour, rcePricePln) {
      if (tariff?.clientTariffHistory?.strict) return ReTariffEngine.rates(ReTariffEngine.resolve(tariff.clientTariffHistory, dateKey, null), dateKey, hour, rcePricePln).energy;
      if (!tariff) {
        return null;
      }

      const variableRows = Array.isArray(tariff.variable) ? tariff.variable : [];
      const sellMethod = normalizeText(tariff.sell_method || "fixed");
      const windowCode = (tariff.zone_model || "") === "highmidlow" || tariff.use_monthly
        ? getZoneCodeForDateHour(tariff, dateKey, hour)
        : "all";
      const energyRate = sumTariffVariableRows(variableRows, function (label) {
        return label.indexOf("energia") !== -1;
      }, windowCode);

      if (sellMethod === "rdn") {
        const rcePrice = firstNumber(rcePricePln);
        return rcePrice == null ? null : rcePrice;
      }

      return energyRate;
    }

    function resolveVariablePurchaseFeeRate(tariff, dateKey, hour) {
      if (tariff?.clientTariffHistory?.strict) return ReTariffEngine.rates(ReTariffEngine.resolve(tariff.clientTariffHistory, dateKey, null), dateKey, hour, 0).distribution;
      if (!tariff) {
        return null;
      }

      const variableRows = Array.isArray(tariff.variable) ? tariff.variable : [];
      const windowCode = (tariff.zone_model || "") === "highmidlow" || tariff.use_monthly
        ? getZoneCodeForDateHour(tariff, dateKey, hour)
        : "all";
      const networkRate = sumTariffVariableRows(variableRows, function (label) {
        return label.indexOf("sieciowa") !== -1;
      }, windowCode);
      const qualityRate = sumTariffVariableRows(variableRows, function (label) {
        return label.indexOf("jak") !== -1;
      }, "all");
      const ozeRate = sumTariffVariableRows(variableRows, function (label) {
        return label.indexOf("oze") !== -1;
      }, "all");
      const cogenerationRate = sumTariffVariableRows(variableRows, function (label) {
        return label.indexOf("kogener") !== -1;
      }, "all");

      return networkRate + qualityRate + ozeRate + cogenerationRate;
    }

    function formatHourLabel(hour) {
      if (hour === 24) {
        return "24:00";
      }
      if (hour === 0) {
        return "24:00";
      }
      return String(hour).padStart(2, "0") + ":00";
    }

    function formatZoneRanges(hours) {
      if (!hours || !hours.length) {
        return "--";
      }

      const sorted = hours.slice().sort(function (a, b) { return a - b; });
      const ranges = [];
      let start = sorted[0];
      let previous = sorted[0];

      for (let index = 1; index <= sorted.length; index += 1) {
        const hour = sorted[index];
        if (hour === previous + 1) {
          previous = hour;
          continue;
        }

        ranges.push(formatHourLabel(start) + " - " + formatHourLabel(previous + 1));
        start = hour;
        previous = hour;
      }

      return ranges.join(", ");
    }

    function averageRateForZone(tariff, payload, dateKey, zoneCode, resolver) {
      let sum = 0;
      let count = 0;

      for (let hour = 0; hour < 24; hour += 1) {
        if (getZoneCodeForDateHour(tariff, dateKey, hour) !== zoneCode) {
          continue;
        }

        const rate = resolver(tariff, dateKey, hour, resolveRcePriceForDateHour(payload, dateKey, hour));
        if (rate != null) {
          sum += rate;
          count += 1;
        }
      }

      return count ? (sum / count) : null;
    }

    function updateTariffSummaryCards(payload, rangeWindow) {
      const tariff = getPurchaseTariff(payload);
      const dateKey = rangeWindow && rangeWindow.start ? formatDateKey(rangeWindow.start) : formatDateKey(getPayloadAnchorDate(payload));
      const hoursByZone = {
        low: [],
        high: [],
        mid: []
      };

      for (let hour = 0; hour < 24; hour += 1) {
        const zoneCode = tariff ? getZoneCodeForDateHour(tariff, dateKey, hour) : "mid";
        if (hoursByZone[zoneCode]) {
          hoursByZone[zoneCode].push(hour);
        }
      }

      ["low", "high", "mid"].forEach(function (zoneCode) {
        setText(tariffZoneTimeEls[zoneCode], formatZoneRanges(hoursByZone[zoneCode]));
        setText(tariffEnergyPriceEls[zoneCode], formatPriceRate(
          tariff
            ? averageRateForZone(tariff, payload, dateKey, zoneCode, resolveEnergyPurchaseRate)
            : null
        ));
        setText(tariffDistributionPriceEls[zoneCode], formatPriceRate(
          tariff
            ? averageRateForZone(tariff, payload, dateKey, zoneCode, function (sourceTariff, sourceDateKey, hour) {
              return resolveVariablePurchaseFeeRate(sourceTariff, sourceDateKey, hour);
            })
            : null
        ));
      });
    }

    function getRangeDayCount(rangeWindow) {
      if (!rangeWindow || !rangeWindow.start || !rangeWindow.end) {
        return 1;
      }

      return Math.max(1, Math.round((rangeWindow.end.getTime() - rangeWindow.start.getTime()) / 86400000) + 1);
    }

    function getRangeMonthsFactor(rangeWindow) {
      return getRangeDayCount(rangeWindow) / 30.4375;
    }

    function getFixedMonthlyAmount(rows, matcher) {
      return (rows || []).reduce(function (sum, row) {
        return matcher(normalizeText(row && row.label))
          ? sum + (Number(row && row.amount) || 0)
          : sum;
      }, 0);
    }

    function pickSubscriptionMonthly(rows, billingCycleMonths) {
      const candidates = (rows || []).filter(function (row) {
        return normalizeText(row && row.label).indexOf("abonament") !== -1;
      });
      const exact = candidates.find(function (row) {
        return Number(row && row.billing_cycle_months) === billingCycleMonths;
      });

      if (exact) {
        return Number(exact.amount) || 0;
      }

      return candidates.length ? (Number(candidates[0].amount) || 0) : 0;
    }

    function pickPowerMonthly(rows, annualUsageKwh) {
      const candidates = (rows || []).filter(function (row) {
        return normalizeText(row && row.label).indexOf("mocowa") !== -1;
      });
      const match = candidates.find(function (row) {
        const min = numberOrNull(row && row.annual_usage_min_kwh);
        const max = numberOrNull(row && row.annual_usage_max_kwh);
        const meetsMin = min == null || annualUsageKwh >= min;
        const meetsMax = max == null || annualUsageKwh < max;
        return meetsMin && meetsMax;
      });

      if (match) {
        return Number(match.amount) || 0;
      }

      return candidates.length ? (Number(candidates[candidates.length - 1].amount) || 0) : 0;
    }

    function estimateFixedFees(payload, rangeWindow, purchaseKwh) {
      if (payload.tariffHistory?.strict) return clientTariffFixedCosts(payload, rangeWindow, purchaseKwh);
      const tariff = getPurchaseTariff(payload);
      const fixedRows = tariff && Array.isArray(tariff.fixed) ? tariff.fixed : [];

      if (!fixedRows.length) {
        return 0;
      }

      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const annualUsageKwh = firstNumber(
        rawEnergy.annualUsageKwh,
        rawEnergy.annualConsumptionKwh,
        energy.annualUsageKwh,
        purchaseKwh != null ? (purchaseKwh / getRangeDayCount(rangeWindow)) * 365 : null
      );
      const fixedMonthly =
        getFixedMonthlyAmount(fixedRows, function (label) { return label.indexOf("sieciowa") !== -1; }) +
        getFixedMonthlyAmount(fixedRows, function (label) { return label.indexOf("handlowa") !== -1; }) +
        pickPowerMonthly(fixedRows, annualUsageKwh || 0) +
        pickSubscriptionMonthly(fixedRows, 1);

      return fixedMonthly * getRangeMonthsFactor(rangeWindow);
    }

    function applyFixedFeesToItems(items, payload, rangeWindow) {
      const totalPurchaseKwh = items.reduce(function (sum, item) {
        return sum + (firstNumber(item && item.purchaseKwh, 0) || 0);
      }, 0);
      const fixedFees = estimateFixedFees(payload, rangeWindow, totalPurchaseKwh);

      if (!fixedFees || !items.length) {
        return items;
      }

      const activeItems = items.filter(function (item) {
        return item && ((firstNumber(item.purchaseKwh, 0) || 0) > 0 || item.active);
      });
      const allocationSource = activeItems.length ? activeItems : items;

      allocationSource.forEach(function (item) {
        const share = totalPurchaseKwh > 0
          ? ((firstNumber(item && item.purchaseKwh, 0) || 0) / totalPurchaseKwh)
          : (1 / allocationSource.length);
        const fixedShare = fixedFees * share;
        const variableFeesPln = Math.max(0, firstNumber(item.variableFeesPln, item.feesPln, 0) || 0);
        item.fixedFeesPln = (firstNumber(item.fixedFeesPln, 0) || 0) + fixedShare;
        item.variableFeesPln = variableFeesPln;
        item.feesPln = variableFeesPln + item.fixedFeesPln;
        item.payablePln = Math.max(
          (firstNumber(item.valuePln, 0) || 0) +
          (firstNumber(item.feesPln, 0) || 0) -
          (firstNumber(item.depositCoveredPln, 0) || 0),
          0
        );
      });

      return items;
    }

    function getRecordByDate(dataset, dateKey) {
      const records = dataset && Array.isArray(dataset.records) ? dataset.records : [];
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (String(record && record.date ? record.date : "") === dateKey) {
          return record;
        }
      }

      return null;
    }

    function getQuarterHour(quarter, index) {
      const rawHour = firstNumber(quarter && quarter.hour, Math.floor(index / 4));
      return Math.max(0, Math.min(23, Math.round(rawHour == null ? Math.floor(index / 4) : rawHour)));
    }

    function getPurchaseQuarterIndex(quarter, fallbackIndex) {
      const rawQuarter = firstNumber(quarter && quarter.quarter, fallbackIndex % 4);
      return clampNumber(Math.round(rawQuarter == null ? fallbackIndex % 4 : rawQuarter), 0, 3);
    }

    function createEmptyHourItems(payload, dateKey, tariff) {
      return Array.from({ length: 24 }, function (_, hour) {
        const price = resolveEnergyPurchaseRate(tariff, dateKey, hour, resolveRcePriceForDateHour(payload, dateKey, hour));
        const variableFeeRate = resolveVariablePurchaseFeeRate(tariff, dateKey, hour);
        return {
          key: dateKey + "-h" + String(hour),
          label: String(hour).padStart(2, "0"),
          rangeLabel: formatTooltipHour(hour) + " - " + formatTooltipHour(hour + 1),
          price: price,
          variableFeeRate: variableFeeRate,
          purchaseKwh: 0,
          valuePln: 0,
          depositCoveredPln: 0,
          variableFeesPln: 0,
          fixedFeesPln: 0,
          feesPln: 0,
          payablePln: 0,
          active: false
        };
      });
    }

    function createPurchaseGapItem(key, dateKey) {
      return {
        key: key,
        label: "",
        rangeLabel: "",
        sourceDate: dateKey || null,
        price: null,
        variableFeeRate: null,
        purchaseKwh: null,
        valuePln: null,
        depositCoveredPln: null,
        variableFeesPln: null,
        fixedFeesPln: 0,
        feesPln: null,
        payablePln: null,
        active: false,
        isGap: true
      };
    }

    function buildMeasuredHourItems(payload, dateKey, depositCoverageByHour) {
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const pvData = payload && payload.pvData ? payload.pvData : null;
      const tariff = getPurchaseTariff(payload);
      const record = getRecordByDate(usageData, dateKey);
      const pvRecord = getRecordByDate(pvData, dateKey);
      const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
      const pvQuarters = pvRecord && Array.isArray(pvRecord.quarters) ? pvRecord.quarters : [];
      const items = createEmptyHourItems(payload, dateKey, tariff);

      const slotCount = Math.max(quarters.length, pvQuarters.length) || 96;
      for (let index = 0; index < slotCount; index += 1) {
        const quarter = quarters[index] || null;
        const pvQuarter = pvQuarters[index] || null;
        const hour = getQuarterHour(quarter || pvQuarter, index);
        const item = items[hour];
        if (!item) {
          continue;
        }
        const price = resolveEnergyPurchaseRate(tariff, dateKey, hour, resolveRcePriceForDateHour(payload, dateKey, hour));
        const physicalImportKwh = getQuarterPhysicalImportKwh(quarter);
        const physicalExportKwh = getQuarterPhysicalExportKwh(quarter, pvQuarter);
        item.price = firstNumber(price, item.price);
        item._feeRate = resolveVariablePurchaseFeeRate(tariff, dateKey, hour);
        item._physicalImportKwh = (item._physicalImportKwh || 0) + physicalImportKwh;
        item._physicalExportKwh = (item._physicalExportKwh || 0) + physicalExportKwh;
      }

      items.forEach(function (item) {
        const purchaseKwh = Math.max((item._physicalImportKwh || 0) - (item._physicalExportKwh || 0), 0);
        const feesPln = purchaseKwh * (item._feeRate || 0);
        const depositCoveredPln = Math.min(
          purchaseKwh * (item.price || 0),
          Math.max(0, firstNumber(depositCoverageByHour && depositCoverageByHour[item.key], 0) || 0)
        );
        item.purchaseKwh = purchaseKwh;
        item.valuePln = purchaseKwh * (item.price || 0);
        item.variableFeeRate = item._feeRate;
        item.depositCoveredPln = depositCoveredPln;
        item.variableFeesPln = feesPln;
        item.fixedFeesPln = 0;
        item.feesPln = feesPln;
        item.payablePln = Math.max(item.valuePln + feesPln - depositCoveredPln, 0);
        item.active = purchaseKwh > 0;
        delete item._feeRate;
        delete item._physicalImportKwh;
        delete item._physicalExportKwh;
      });

      return items;
    }

    function buildMeasuredQuarterItems(payload, dateKey, depositCoverageByHour) {
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const pvData = payload && payload.pvData ? payload.pvData : null;
      const tariff = getPurchaseTariff(payload);
      const record = getRecordByDate(usageData, dateKey);
      const pvRecord = getRecordByDate(pvData, dateKey);
      const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
      const pvQuarters = pvRecord && Array.isArray(pvRecord.quarters) ? pvRecord.quarters : [];
      const slotCount = Math.max(quarters.length, pvQuarters.length) || 96;
      const rawItems = [];
      const hourlyValuePln = Array.from({ length: 24 }, function () { return 0; });
      const items = [];

      for (let index = 0; index < slotCount; index += 1) {
        const quarter = quarters[index] || null;
        const pvQuarter = pvQuarters[index] || null;
        const hour = getQuarterHour(quarter || pvQuarter, index);
        const quarterIndex = getPurchaseQuarterIndex(quarter || pvQuarter, index);
        const price = resolveEnergyPurchaseRate(tariff, dateKey, hour, resolveRcePriceForDateHour(payload, dateKey, hour));
        const variableFeeRate = resolveVariablePurchaseFeeRate(tariff, dateKey, hour);
        const physicalImportKwh = getQuarterPhysicalImportKwh(quarter);
        const physicalExportKwh = getQuarterPhysicalExportKwh(quarter, pvQuarter);
        const purchaseKwh = Math.max(physicalImportKwh - physicalExportKwh, 0);
        const valuePln = purchaseKwh * (price || 0);

        hourlyValuePln[hour] += valuePln;
        rawItems.push({
          hour: hour,
          quarterIndex: quarterIndex,
          price: price,
          variableFeeRate: variableFeeRate,
          purchaseKwh: purchaseKwh,
          valuePln: valuePln
        });
      }

      rawItems.forEach(function (item, index) {
        const hourCoverageKey = dateKey + "-h" + String(item.hour);
        const hourCoveragePln = Math.max(0, firstNumber(depositCoverageByHour && depositCoverageByHour[hourCoverageKey], 0) || 0);
        const hourValuePln = hourlyValuePln[item.hour] || 0;
        const depositCoveredPln = Math.min(
          item.valuePln,
          hourValuePln > 0 ? hourCoveragePln * (item.valuePln / hourValuePln) : 0
        );
        const variableFeesPln = item.purchaseKwh * (item.variableFeeRate || 0);

        items.push({
          key: dateKey + "-q" + String(index),
          label: item.quarterIndex === 0 ? String(item.hour).padStart(2, "0") : "",
          rangeLabel: formatPurchaseQuarterRange(item.hour, item.quarterIndex),
          sourceDate: dateKey,
          price: item.price,
          variableFeeRate: item.variableFeeRate,
          purchaseKwh: item.purchaseKwh,
          valuePln: item.valuePln,
          depositCoveredPln: depositCoveredPln,
          variableFeesPln: variableFeesPln,
          fixedFeesPln: 0,
          feesPln: variableFeesPln,
          payablePln: Math.max(item.valuePln + variableFeesPln - depositCoveredPln, 0),
          active: item.purchaseKwh > 0
        });

        if (item.quarterIndex === 3 && item.hour < 23) {
          items.push(createPurchaseGapItem(dateKey + "-gap" + String(item.hour), dateKey));
        }
      });

      return items;
    }

    function buildMeasuredDepositCoverageByHour(payload, rangeWindow) {
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const pvData = payload && payload.pvData ? payload.pvData : null;
      const tariff = getPurchaseTariff(payload);

      if (!shouldUseMeasuredUsageSplit(usageData) || !tariff || !rangeWindow) {
        return {};
      }

      const rangeStartKey = rangeWindow.startKey || formatDateKey(rangeWindow.start);
      const rangeEndKey = rangeWindow.endKey || formatDateKey(rangeWindow.end);
      const depositStartKey = getDashboardHistoryStartKey(payload);
      const dateKeysByValue = {};
      [usageData, pvData].forEach(function (dataset) {
        const records = dataset && Array.isArray(dataset.records) ? dataset.records : [];
        records.forEach(function (record) {
          const dateKey = String(record && record.date ? record.date : "");
          if (dateKey && (!depositStartKey || dateKey >= depositStartKey) && dateKey <= rangeEndKey) {
            dateKeysByValue[dateKey] = true;
          }
        });
      });

      let balancePln = getDashboardDepositStartPln(payload);
      const coverageByHour = {};

      Object.keys(dateKeysByValue).sort().forEach(function (dateKey) {
        const usageRecord = getRecordByDate(usageData, dateKey);
        const pvRecord = getRecordByDate(pvData, dateKey);
        const usageQuarters = usageRecord && Array.isArray(usageRecord.quarters) ? usageRecord.quarters : [];
        const pvQuarters = pvRecord && Array.isArray(pvRecord.quarters) ? pvRecord.quarters : [];
        const hourBalances = Array.from({ length: 24 }, function () {
          return { physicalImportKwh: 0, physicalExportKwh: 0 };
        });
        const slotCount = Math.max(usageQuarters.length, pvQuarters.length) || 96;

        for (let index = 0; index < slotCount; index += 1) {
          const usageQuarter = usageQuarters[index] || null;
          const pvQuarter = pvQuarters[index] || null;
          const hour = getQuarterHour(usageQuarter || pvQuarter, index);
          hourBalances[hour].physicalImportKwh += getQuarterPhysicalImportKwh(usageQuarter);
          hourBalances[hour].physicalExportKwh += getQuarterPhysicalExportKwh(usageQuarter, pvQuarter);
        }

        for (let hour = 0; hour < 24; hour += 1) {
          const physicalImportKwh = hourBalances[hour].physicalImportKwh;
          const physicalExportKwh = hourBalances[hour].physicalExportKwh;
          const saleKwh = Math.max(physicalExportKwh - physicalImportKwh, 0);
          const gridKwh = Math.max(physicalImportKwh - physicalExportKwh, 0);
          const rcePricePln = resolveRcePriceForDateHour(payload, dateKey, hour);
          const salePricePln = getProsumerSalePricePln(rcePricePln) || 0;
          const purchaseRatePln = resolveEnergyPurchaseRate(tariff, dateKey, hour, rcePricePln) || 0;
          const earnedPln = saleKwh * salePricePln;
          const eligiblePurchasePln = gridKwh * purchaseRatePln;

          balancePln += earnedPln;
          const usedPln = Math.min(balancePln, eligiblePurchasePln);
          balancePln -= usedPln;

          if (usedPln > 0 && dateKey >= rangeStartKey && dateKey <= rangeEndKey) {
            const key = dateKey + "-h" + String(hour);
            coverageByHour[key] = (coverageByHour[key] || 0) + usedPln;
          }
        }
      });

      return coverageByHour;
    }

    function aggregateItems(entries, label, key, forceActiveOnly) {
      let purchaseKwh = 0;
      let valuePln = 0;
      let depositCoveredPln = 0;
      let variableFeesPln = 0;
      let fixedFeesPln = 0;
      let feesPln = 0;
      let payablePln = 0;
      let weightedPrice = 0;
      let weightedVariableFeeRate = 0;
      let variableFeeRateSum = 0;
      let variableFeeRateCount = 0;
      let priceSum = 0;
      let priceCount = 0;
      let active = false;
      let isForecast = false;

      entries.forEach(function (entry) {
        const price = firstNumber(entry && entry.price);
        const bought = firstNumber(entry && entry.purchaseKwh, 0) || 0;
        const value = firstNumber(entry && entry.valuePln, price != null ? bought * price : 0, 0) || 0;
        const covered = firstNumber(entry && entry.depositCoveredPln, 0) || 0;
        const variableFees = getItemVariableFeesPln(entry);
        const fixedFees = firstNumber(entry && entry.fixedFeesPln, 0) || 0;
        const fees = variableFees;
        purchaseKwh += bought;
        valuePln += value;
        depositCoveredPln += covered;
        variableFeesPln += variableFees;
        fixedFeesPln += fixedFees;
        feesPln += fees;
        payablePln += Math.max(value + variableFees - covered, 0);
        if (price != null) {
          priceSum += price;
          priceCount += 1;
          weightedPrice += price * bought;
        }
        const variableFeeRate = firstNumber(entry && entry.variableFeeRate);
        if (variableFeeRate != null) {
          variableFeeRateSum += variableFeeRate;
          variableFeeRateCount += 1;
          weightedVariableFeeRate += variableFeeRate * bought;
        }
        if (entry && entry.active) {
          active = true;
        }
        if (entry && entry.isForecast) {
          isForecast = true;
        }
      });

      const hasPurchase = purchaseKwh > 0;
      return {
        key: key,
        label: label,
        price: hasPurchase && weightedPrice > 0
          ? weightedPrice / purchaseKwh
          : (forceActiveOnly ? null : (priceCount ? priceSum / priceCount : null)),
        variableFeeRate: hasPurchase && weightedVariableFeeRate > 0
          ? weightedVariableFeeRate / purchaseKwh
          : (forceActiveOnly ? null : (variableFeeRateCount ? variableFeeRateSum / variableFeeRateCount : null)),
        purchaseKwh: purchaseKwh,
        valuePln: valuePln,
        depositCoveredPln: depositCoveredPln,
        variableFeesPln: variableFeesPln,
        fixedFeesPln: fixedFeesPln,
        feesPln: feesPln,
        payablePln: payablePln,
        active: active || hasPurchase,
        isForecast: isForecast
      };
    }

    function buildMeasuredRangeItems(payload, rangeWindow) {
      if (!canUseMeasuredPurchaseData(payload)) {
        return [];
      }

      const usageData = payload && payload.usageData ? payload.usageData : null;
      if (!shouldUseMeasuredUsageSplit(usageData) || !getPurchaseTariff(payload)) {
        return [];
      }

      const depositCoverageByHour = buildMeasuredDepositCoverageByHour(payload, rangeWindow);

      if (state.range === "day") {
        return state.dayDetailMode
          ? buildMeasuredQuarterItems(payload, formatDateKey(rangeWindow.start), depositCoverageByHour)
          : buildMeasuredHourItems(payload, formatDateKey(rangeWindow.start), depositCoverageByHour);
      }

      if (state.range === "year") {
        const buckets = {};
        for (let date = new Date(rangeWindow.start); date.getTime() <= rangeWindow.end.getTime(); date = addDays(date, 1)) {
          const dateKey = formatDateKey(date);
          const monthKey = String(date.getFullYear()) + "-" + String(date.getMonth() + 1).padStart(2, "0");
          if (!buckets[monthKey]) {
            buckets[monthKey] = {
              label: capitalize(monthShortFormatter.format(date).replace(".", "")),
              items: []
            };
          }
          buckets[monthKey].items = buckets[monthKey].items.concat(buildMeasuredHourItems(payload, dateKey, depositCoverageByHour));
        }

        return Object.keys(buckets).sort().map(function (bucketKey) {
          const bucket = buckets[bucketKey];
          return aggregateItems(bucket.items, bucket.label, bucketKey, true);
        });
      }

      const items = [];
      for (let date = new Date(rangeWindow.start); date.getTime() <= rangeWindow.end.getTime(); date = addDays(date, 1)) {
        const dateKey = formatDateKey(date);
        const label = state.range === "week"
          ? capitalize(weekdayLongFormatter.format(date))
          : String(date.getDate()).padStart(2, "0");
        items.push(aggregateItems(buildMeasuredHourItems(payload, dateKey, depositCoverageByHour), label, dateKey, true));
      }

      return items;
    }

    function buildSimulationHourItems(day) {
      const hours = day && Array.isArray(day.hours) ? day.hours : [];

      return (hours.length ? hours : Array.from({ length: 24 }, function (_, hour) { return { hour: hour }; })).map(function (entry, index) {
        const hour = clampNumber(Math.round(firstNumber(entry && entry.hour, index) || 0), 0, 23);
        const price = firstNumber(entry.energyBuyPricePln, entry.energyBuyPrice, entry.buyPrice, entry.totalBuyPricePln);
        const purchaseKwh = firstNumber(
          entry.gridPurchaseKwh,
          (firstNumber(entry.gridPurchaseForLoadKwh, 0) || 0) + (firstNumber(entry.gridTopupKwh, 0) || 0),
          0
        ) || 0;
        const variableFeeRate = firstNumber(
          entry.distributionBuyPricePln,
          entry.distributionPricePln,
          entry.variableFeeRate,
          purchaseKwh > 0 && entry.distributionCostPln != null ? entry.distributionCostPln / purchaseKwh : null
        );
        const valuePln = firstNumber(
          entry.energyCostPln,
          price != null ? purchaseKwh * price : null,
          entry.nominalCostPln,
          0
        ) || 0;
        const feesPln = firstNumber(
          entry.distributionCostPln,
          entry.distributionBuyPricePln != null ? purchaseKwh * entry.distributionBuyPricePln : null,
          entry.nominalCostPln != null ? Math.max((entry.nominalCostPln || 0) - valuePln, 0) : null,
          0
        ) || 0;
        const depositCoveredPln = Math.min(valuePln, firstNumber(entry.depositUsedPln, 0) || 0);

        return {
          key: day.dateKey + "-h" + String(index),
          label: String(hour).padStart(2, "0"),
          rangeLabel: formatTooltipHour(hour) + " - " + formatTooltipHour(hour + 1),
          price: price,
          variableFeeRate: variableFeeRate,
          purchaseKwh: purchaseKwh,
          valuePln: valuePln,
          depositCoveredPln: depositCoveredPln,
          variableFeesPln: feesPln,
          fixedFeesPln: 0,
          feesPln: feesPln,
          payablePln: Math.max(valuePln + feesPln - depositCoveredPln, 0),
          active: purchaseKwh > 0,
          isForecast: !!(day && day.isForecast || entry && entry.isForecast)
        };
      });
    }

    function buildSimulationQuarterItems(day) {
      const slots = day && Array.isArray(day.slots) ? day.slots : [];
      const dateKey = day && day.dateKey ? day.dateKey : formatDateKey(state.anchorDate);
      const items = [];

      if (slots.length) {
        slots.forEach(function (slot, index) {
          const hour = clampNumber(Math.round(firstNumber(slot && slot.hour, Math.floor(index / 4)) || 0), 0, 23);
          const quarterIndex = getPurchaseQuarterIndex(slot, index);
          const price = firstNumber(slot && slot.energyBuyPricePln, slot && slot.energyBuyPrice, slot && slot.buyPrice, slot && slot.totalBuyPricePln);
          const purchaseKwh = firstNumber(
            slot && slot.gridPurchaseKwh,
            (firstNumber(slot && slot.gridPurchaseForLoadKwh, 0) || 0) + (firstNumber(slot && slot.gridTopupKwh, 0) || 0),
            0
          ) || 0;
          const variableFeeRate = firstNumber(
            slot && slot.distributionBuyPricePln,
            slot && slot.distributionPricePln,
            slot && slot.variableFeeRate,
            purchaseKwh > 0 && slot && slot.distributionCostPln != null ? slot.distributionCostPln / purchaseKwh : null
          );
          const valuePln = firstNumber(
            slot && slot.energyCostPln,
            price != null ? purchaseKwh * price : null,
            slot && slot.nominalCostPln,
            0
          ) || 0;
          const variableFeesPln = firstNumber(
            slot && slot.distributionCostPln,
            slot && slot.distributionBuyPricePln != null ? purchaseKwh * slot.distributionBuyPricePln : null,
            slot && slot.nominalCostPln != null ? Math.max((slot.nominalCostPln || 0) - valuePln, 0) : null,
            0
          ) || 0;
          const depositCoveredPln = Math.min(valuePln, firstNumber(slot && slot.depositUsedPln, 0) || 0);

          items.push({
            key: dateKey + "-q" + String(index),
            label: quarterIndex === 0 ? String(hour).padStart(2, "0") : "",
            rangeLabel: formatPurchaseQuarterRange(hour, quarterIndex),
            sourceDate: dateKey,
            price: price,
            variableFeeRate: variableFeeRate,
            purchaseKwh: purchaseKwh,
            valuePln: valuePln,
            depositCoveredPln: depositCoveredPln,
            variableFeesPln: variableFeesPln,
            fixedFeesPln: 0,
            feesPln: variableFeesPln,
            payablePln: Math.max(valuePln + variableFeesPln - depositCoveredPln, 0),
            active: purchaseKwh > 0,
            isForecast: !!(day && day.isForecast || slot && slot.isForecast)
          });

          if (quarterIndex === 3 && hour < 23) {
            items.push(createPurchaseGapItem(dateKey + "-gap" + String(hour), dateKey));
          }
        });

        return items;
      }

      buildSimulationHourItems(day).forEach(function (hourItem) {
        const hour = clampNumber(Math.round(Number(hourItem && hourItem.label) || 0), 0, 23);
        for (let quarterIndex = 0; quarterIndex < 4; quarterIndex += 1) {
          const purchaseKwh = (firstNumber(hourItem && hourItem.purchaseKwh, 0) || 0) / 4;
          const valuePln = (firstNumber(hourItem && hourItem.valuePln, 0) || 0) / 4;
          const depositCoveredPln = (firstNumber(hourItem && hourItem.depositCoveredPln, 0) || 0) / 4;
          const variableFeesPln = getItemVariableFeesPln(hourItem) / 4;

          items.push({
            key: dateKey + "-q" + String(hour) + "-" + String(quarterIndex),
            label: quarterIndex === 0 ? String(hour).padStart(2, "0") : "",
            rangeLabel: formatPurchaseQuarterRange(hour, quarterIndex),
            sourceDate: dateKey,
            price: hourItem && hourItem.price,
            variableFeeRate: hourItem && hourItem.variableFeeRate,
            purchaseKwh: purchaseKwh,
            valuePln: valuePln,
            depositCoveredPln: depositCoveredPln,
            variableFeesPln: variableFeesPln,
            fixedFeesPln: 0,
            feesPln: variableFeesPln,
            payablePln: Math.max(valuePln + variableFeesPln - depositCoveredPln, 0),
            active: purchaseKwh > 0,
            isForecast: !!(day && day.isForecast || hourItem && hourItem.isForecast)
          });
        }

        if (hour < 23) {
          items.push(createPurchaseGapItem(dateKey + "-gap" + String(hour), dateKey));
        }
      });

      return items;
    }

    function buildSimulationRangeItems(simulation, rangeWindow) {
      if (!simulation || !Array.isArray(simulation.days)) {
        return [];
      }

      const days = simulation.days.filter(function (day) {
        return day && day.dateKey >= rangeWindow.startKey && day.dateKey <= rangeWindow.endKey;
      });

      if (!days.length) {
        return [];
      }

      if (state.range === "day") {
        return state.dayDetailMode ? buildSimulationQuarterItems(days[0]) : buildSimulationHourItems(days[0]);
      }

      if (state.range === "year") {
        const buckets = {};
        days.forEach(function (day) {
          const date = parseDateKey(day.dateKey);
          if (!date) {
            return;
          }
          const bucketKey = String(date.getFullYear()) + "-" + String(date.getMonth() + 1).padStart(2, "0");
          if (!buckets[bucketKey]) {
            buckets[bucketKey] = {
              label: capitalize(monthShortFormatter.format(date).replace(".", "")),
              items: []
            };
          }
          buckets[bucketKey].items = buckets[bucketKey].items.concat(buildSimulationHourItems(day));
        });

        return Object.keys(buckets).sort().map(function (bucketKey) {
          const bucket = buckets[bucketKey];
          return aggregateItems(bucket.items, bucket.label, bucketKey, true);
        });
      }

      return days.map(function (day) {
        const date = parseDateKey(day.dateKey);
        const label = state.range === "week"
          ? capitalize(weekdayLongFormatter.format(date || new Date()))
          : String((date || new Date()).getDate()).padStart(2, "0");
        return aggregateItems(buildSimulationHourItems(day), label, day.dateKey, true);
      });
    }

    function getLatestMeasuredDateKey(payload) {
      const keys = [];
      const datasets = [
        payload && payload.usageData ? payload.usageData : null,
        payload && payload.pvData ? payload.pvData : null
      ];

      datasets.forEach(function (dataset) {
        const latestKey = normalizeDashboardDateKey(dataset && dataset.latestDate);
        if (latestKey) {
          keys.push(latestKey);
        }

        const records = dataset && Array.isArray(dataset.records) ? dataset.records : [];
        if (records.length) {
          const recordKey = normalizeDashboardDateKey(records[records.length - 1] && records[records.length - 1].date);
          if (recordKey) {
            keys.push(recordKey);
          }
        }
      });

      return keys.length ? keys.sort()[keys.length - 1] : "";
    }

    function getSimulationDay(simulation, dateKey) {
      if (!simulation || !dateKey) {
        return null;
      }
      if (simulation.dayMap && simulation.dayMap[dateKey]) {
        return simulation.dayMap[dateKey];
      }
      const days = Array.isArray(simulation.days) ? simulation.days : [];
      return days.find(function (day) { return day && day.dateKey === dateKey; }) || null;
    }

    function getPurchaseItemStartMinute(item) {
      const rangeLabel = String(item && item.rangeLabel ? item.rangeLabel : "");
      const rangeMatch = rangeLabel.match(/(\d{1,2}):(\d{2})/);
      if (rangeMatch) {
        return (Number(rangeMatch[1]) * 60) + Number(rangeMatch[2]);
      }

      const hour = Number(item && item.label);
      return Number.isFinite(hour) ? clampNumber(Math.round(hour), 0, 23) * 60 : null;
    }

    function buildForecastAwareDayItems(payload, simulation, dateKey, latestKey, latestDataTime, depositCoverageByHour) {
      const forecastDay = getSimulationDay(simulation, dateKey);
      const useMeasuredWholeDay = latestKey && dateKey < latestKey;
      const useForecastWholeDay = latestKey && dateKey > latestKey;

      if (useMeasuredWholeDay || !forecastDay) {
        return state.dayDetailMode
          ? buildMeasuredQuarterItems(payload, dateKey, depositCoverageByHour)
          : buildMeasuredHourItems(payload, dateKey, depositCoverageByHour);
      }
      if (useForecastWholeDay || !latestDataTime) {
        return state.dayDetailMode ? buildSimulationQuarterItems(forecastDay) : buildSimulationHourItems(forecastDay);
      }

      const measuredItems = state.dayDetailMode
        ? buildMeasuredQuarterItems(payload, dateKey, depositCoverageByHour)
        : buildMeasuredHourItems(payload, dateKey, depositCoverageByHour);
      const forecastItems = state.dayDetailMode ? buildSimulationQuarterItems(forecastDay) : buildSimulationHourItems(forecastDay);
      const latestMinute = (latestDataTime.getHours() * 60) + latestDataTime.getMinutes();

      return forecastItems.map(function (forecastItem, index) {
        const measuredItem = measuredItems[index] || null;
        const startMinute = getPurchaseItemStartMinute(measuredItem || forecastItem);
        if (startMinute == null || startMinute <= latestMinute) {
          return measuredItem || forecastItem;
        }
        return forecastItem;
      });
    }

    function buildForecastAwareRangeItems(payload, simulation, rangeWindow) {
      if (!simulation || !simulation.isForecast) {
        return buildMeasuredRangeItems(payload, rangeWindow);
      }

      const latestKey = getLatestMeasuredDateKey(payload);
      if (!latestKey) {
        return buildSimulationRangeItems(simulation, rangeWindow);
      }

      const latestDataTime = getDashboardLatestDataTime(payload);
      const depositCoverageByHour = buildMeasuredDepositCoverageByHour(payload, rangeWindow);

      if (state.range === "day") {
        return buildForecastAwareDayItems(
          payload,
          simulation,
          formatDateKey(rangeWindow.start),
          latestKey,
          latestDataTime,
          depositCoverageByHour
        );
      }

      if (state.range === "year") {
        const buckets = {};
        for (let date = new Date(rangeWindow.start); date.getTime() <= rangeWindow.end.getTime(); date = addDays(date, 1)) {
          const dateKey = formatDateKey(date);
          const bucketKey = String(date.getFullYear()) + "-" + String(date.getMonth() + 1).padStart(2, "0");
          if (!buckets[bucketKey]) {
            buckets[bucketKey] = {
              label: capitalize(monthShortFormatter.format(date).replace(".", "")),
              items: []
            };
          }
          buckets[bucketKey].items = buckets[bucketKey].items.concat(
            buildForecastAwareDayItems(payload, simulation, dateKey, latestKey, latestDataTime, depositCoverageByHour)
          );
        }

        return Object.keys(buckets).sort().map(function (bucketKey) {
          const bucket = buckets[bucketKey];
          return aggregateItems(bucket.items, bucket.label, bucketKey, true);
        });
      }

      const items = [];
      for (let date = new Date(rangeWindow.start); date.getTime() <= rangeWindow.end.getTime(); date = addDays(date, 1)) {
        const dateKey = formatDateKey(date);
        const label = state.range === "week"
          ? capitalize(weekdayLongFormatter.format(date))
          : String(date.getDate()).padStart(2, "0");
        items.push(aggregateItems(
          buildForecastAwareDayItems(payload, simulation, dateKey, latestKey, latestDataTime, depositCoverageByHour),
          label,
          dateKey,
          true
        ));
      }

      return items;
    }

    function getPayloadAnchorDate(payload) {
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const simulation = window.dashboardProsumerSimulation;
      const latestKey = firstText(
        usageData && usageData.latestDate,
        simulation && simulation.latestDateKey
      );
      const parsed = latestKey ? parseDateKey(latestKey) : null;
      return parsed || new Date();
    }

    function firstText() {
      for (let i = 0; i < arguments.length; i += 1) {
        const value = arguments[i];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
      return "";
    }

    function getCurrentHourFromPayload(payload) {
      const rce = payload && payload.rce ? payload.rce : null;
      const rawHour = firstNumber(
        rce && rce.currentHour,
        rce && rce.hour,
        new Date().getHours()
      );

      return Math.max(0, Math.min(23, Math.round(rawHour == null ? new Date().getHours() : rawHour)));
    }

    function getCurrentPurchasePrice(payload, items) {
      const tariff = getPurchaseTariff(payload);
      const rce = payload && payload.rce ? payload.rce : null;
      const anchorDate = getPayloadAnchorDate(payload);
      const dateKey = formatDateKey(anchorDate);
      const currentHour = getCurrentHourFromPayload(payload);
      const currentItem = Array.isArray(items)
        ? items.find(function (item) {
          return String(item && item.label).padStart(2, "0") === String(currentHour).padStart(2, "0");
        })
        : null;

      return firstNumber(
        rce && rce.currentPurchasePricePln,
        rce && rce.currentBuyPricePln,
        currentItem && currentItem.price,
        resolveEnergyPurchaseRate(tariff, dateKey, currentHour, resolveRcePriceForDateHour(payload, dateKey, currentHour))
      );
    }

    function updateCurrentPurchasePriceState(currentPrice, maxPrice, averagePrice) {
      if (currentPriceMeterThumbEl) {
        const percent = maxPrice && maxPrice > 0
          ? clampNumber((currentPrice || 0) / maxPrice, 0, 1) * 100
          : 0;
        currentPriceMeterThumbEl.style.left = formatDecimal(percent, 2).replace(",", ".") + "%";
      }

      if (!currentPriceStatusEl) {
        return;
      }

      if (currentPrice == null) {
        currentPriceStatusEl.textContent = "Cena zakupu: --";
        return;
      }

      const ratio = maxPrice && maxPrice > 0 ? currentPrice / maxPrice : 0;
      const status = ratio <= 0.55
        ? "optymalna"
        : (ratio <= 0.8 || (averagePrice != null && currentPrice <= averagePrice) ? "podwyższona" : "wysoka");
      currentPriceStatusEl.textContent = "Cena zakupu: " + status;
    }

    function escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function formatTooltipHour(hour) {
      const safeHour = Math.max(0, Math.min(24, Math.round(hour == null ? 0 : hour)));
      return String(safeHour).padStart(2, "0") + ":00";
    }

    function formatPurchaseMinute(totalMinutes) {
      const safeMinute = clampNumber(Math.round(totalMinutes == null ? 0 : totalMinutes), 0, 24 * 60);
      const hour = Math.floor(safeMinute / 60);
      const minute = safeMinute % 60;
      return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
    }

    function formatPurchaseQuarterRange(hour, quarter) {
      const startMinute = (clampNumber(Math.round(hour == null ? 0 : hour), 0, 23) * 60) +
        (clampNumber(Math.round(quarter == null ? 0 : quarter), 0, 3) * 15);
      return formatPurchaseMinute(startMinute) + " - " + formatPurchaseMinute(startMinute + 15);
    }

    function getPurchaseTooltipRangeLabel(item) {
      if (item && typeof item.rangeLabel === "string" && item.rangeLabel.trim()) {
        return item.rangeLabel.trim();
      }

      const label = item && typeof item.label === "string" ? item.label.trim() : "";
      const parsedHour = Number(label);
      if (state.range === "day" && label && Number.isFinite(parsedHour)) {
        return formatTooltipHour(parsedHour) + " - " + formatTooltipHour(parsedHour + 1);
      }

      return label || formatRangeName(state.range);
    }

    function getItemDepositCoveredPln(item) {
      const valuePln = Math.max(0, firstNumber(item && item.valuePln, 0) || 0);
      return Math.min(valuePln, Math.max(0, firstNumber(item && item.depositCoveredPln, 0) || 0));
    }

    function getItemVariableFeesPln(item) {
      const feesPln = Math.max(0, firstNumber(item && item.feesPln, 0) || 0);
      const fixedFeesPln = Math.max(0, firstNumber(item && item.fixedFeesPln, 0) || 0);
      const variableFeesPln = firstNumber(item && item.variableFeesPln);
      return Math.max(0, variableFeesPln != null ? variableFeesPln : Math.max(feesPln - fixedFeesPln, 0));
    }

    function getItemChartTotalPln(item) {
      return Math.max(0, firstNumber(item && item.valuePln, 0) || 0) + getItemVariableFeesPln(item);
    }

    function getItemPurchasePayablePln(item) {
      return Math.max(
        (firstNumber(item && item.valuePln, 0) || 0) +
        getItemVariableFeesPln(item) -
        getItemDepositCoveredPln(item),
        0
      );
    }

    function renderZeroState(message) {
      state.items = [];
      if (state.chart) {
        state.chart.clear();
      } else if (chartEl) {
        chartEl.innerHTML = "";
      }
      if (sunMarkersEl) {
        sunMarkersEl.hidden = true;
      }
      if (chartPanelEl) {
        chartPanelEl.classList.add("is-empty");
      }
      if (chartEmptyEl) {
        chartEmptyEl.textContent = message || "Brak danych zakupu energii dla wybranego zakresu.";
      }
      setMetric(currentPriceValueEl, null);
      updateCurrentPurchasePriceState(null, null, null);
      setMetric(averagePriceValueEl, null);
      setMetric(totalValueEl, null);
      setMetric(energyValueEl, null);
      setMetric(depositCoveredValueEl, null);
      setMetric(feesValueEl, null);
      setMetric(payableValueEl, null);
    }

    function purchaseTooltipTextRow(color, label, text, className) {
      const dotClass = "pv-chart-tooltip__dot" + (className ? " " + className : "");
      const dotStyle = color ? " style=\"background:" + color + ";\"" : "";
      return [
        "<div class=\"pv-chart-tooltip__row\">",
        "<span class=\"" + dotClass + "\"" + dotStyle + "></span>",
        "<div class=\"pv-chart-tooltip__row-content\">",
        "<p class=\"pv-chart-tooltip__row-label\">" + escapeHtml(label) + "</p>",
        "<p class=\"pv-chart-tooltip__row-value\">" + escapeHtml(text) + "</p>",
        "</div>",
        "</div>"
      ].join("");
    }

    function positionPurchaseChartTooltip(point, params, dom, rect, size) {
      const viewSize = size && Array.isArray(size.viewSize)
        ? size.viewSize
        : [chartEl ? chartEl.clientWidth : 0, chartEl ? chartEl.clientHeight : 0];
      const rawContentSize = size && Array.isArray(size.contentSize) ? size.contentSize : [0, 0];
      const measuredTooltip = dom && dom.querySelector ? dom.querySelector(".purchase-detail-tooltip") : null;
      const minimumTooltipHeight = state.showMarketRates ? 190 : 360;
      const contentSize = [
        Math.max(rawContentSize[0] || 0, dom && dom.offsetWidth ? dom.offsetWidth : 0, measuredTooltip && measuredTooltip.offsetWidth ? measuredTooltip.offsetWidth : 0, 330),
        Math.max(rawContentSize[1] || 0, dom && dom.offsetHeight ? dom.offsetHeight : 0, measuredTooltip && measuredTooltip.offsetHeight ? measuredTooltip.offsetHeight : 0, minimumTooltipHeight)
      ];
      const margin = 12;
      const gap = 18;
      const viewWidth = Math.max(viewSize[0] || 0, contentSize[0] + (margin * 2));
      const viewHeight = Math.max(viewSize[1] || 0, contentSize[1] + (margin * 2));
      const pointX = Array.isArray(point) ? point[0] : 0;
      const pointY = Array.isArray(point) ? point[1] : 0;
      const maxLeft = Math.max(margin, viewWidth - contentSize[0] - margin);
      const maxTop = Math.max(margin, viewHeight - contentSize[1] - margin);
      let left = pointX + gap;
      let top = pointY - contentSize[1] - gap;

      if (left + contentSize[0] + margin > viewWidth) {
        left = pointX - contentSize[0] - gap;
      }

      if (top < margin) {
        top = pointY + gap;
      }

      if (top + contentSize[1] + margin > viewHeight) {
        top = pointY - contentSize[1] - gap;
      }

      return [
        clampNumber(left, margin, maxLeft),
        clampNumber(top, margin, maxTop)
      ];
    }

    function ensurePurchaseChart() {
      if (!chartEl || !window.echarts || !chartEl.offsetWidth || !chartEl.offsetHeight) {
        return null;
      }

      if (state.chart) {
        return state.chart;
      }

      state.chart = window.echarts.init(chartEl, null, {
        renderer: "canvas",
        useCoarsePointer: true,
        pointerSize: 14
      });

      state.chart.on("datazoom", function () {
        syncPurchaseWindowCount();
        requestAnimationFrame(renderPurchaseSunMarkersEcharts);
      });

      state.chart.on("click", function (params) {
        if (params.componentType !== "series" || typeof params.dataIndex !== "number") {
          return;
        }

        const target = getDashboardChartDrilldownTarget(
          state.range,
          state.anchorDate,
          state.items[params.dataIndex],
          params.dataIndex
        );
        if (!target) {
          return;
        }

        state.range = target.range;
        state.anchorDate = clampDashboardNavigationDate(target.anchorDate, state.range);
        state.anchorTouched = true;
        state.dayDetailMode = false;
        state.windowStartIndex = null;
        state.windowCount = null;
        updateToolbar();
        applyPayload();
      });

      if (!currentHourHighlighter && typeof window.onRevoltCreateCurrentHourHighlighter === "function") {
        currentHourHighlighter = window.onRevoltCreateCurrentHourHighlighter({
          chart: state.chart,
          element: chartEl,
          getItems: function () { return state.items; },
          getRange: function () { return state.range; },
          getAnchorDate: function () { return state.anchorDate; }
        });
      }

      return state.chart;
    }

    function getPurchaseTopSegment(item) {
      if (getItemDepositCoveredPln(item) > 0) {
        return "deposit";
      }
      if (Math.max((firstNumber(item && item.valuePln, 0) || 0) - getItemDepositCoveredPln(item), 0) > 0) {
        return "cost";
      }
      if (getItemVariableFeesPln(item) > 0) {
        return "fees";
      }
      return "";
    }

    function getPurchaseSegmentData(items, segmentName) {
      return items.map(function (item) {
        if (item && item.isGap) {
          return {
            value: null
          };
        }

        const valuePln = Math.max(0, firstNumber(item && item.valuePln, 0) || 0);
        const depositCoveredPln = getItemDepositCoveredPln(item);
        const value = segmentName === "fees"
          ? getItemVariableFeesPln(item)
          : (segmentName === "deposit"
            ? depositCoveredPln
            : Math.max(valuePln - depositCoveredPln, 0));
        const isTopSegment = getPurchaseTopSegment(item) === segmentName;
        const color = segmentName === "fees"
          ? PURCHASE_COLORS.fees
          : (segmentName === "deposit" ? PURCHASE_COLORS.deposit : PURCHASE_COLORS.cost);
        const itemStyle = {
          color: color,
          borderRadius: isTopSegment ? [PURCHASE_BAR_RADIUS, PURCHASE_BAR_RADIUS, 0, 0] : [0, 0, 0, 0],
          opacity: item && item.isForecast ? 0.4 : 1
        };

        if (segmentName === "deposit") {
          itemStyle.decal = {
            symbol: "rect",
            symbolSize: 1,
            symbolKeepAspect: true,
            color: PURCHASE_COLORS.depositStripe,
            dashArrayX: [1, 0],
            dashArrayY: [6, 6],
            rotation: Math.PI / 4
          };
        }

        return {
          value: value > 0 ? value : null,
          itemStyle: itemStyle
        };
      });
    }

    function renderPurchaseEnergyStep(params, api) {
      const coordSys = params && params.coordSys ? params.coordSys : null;
      const values = state.purchaseStepValues || [];
      if (!coordSys || !values.length) {
        return null;
      }

      const baseline = api.coord([0, 0])[1];
      const centers = values.map(function (_, index) {
        return api.coord([index, 0])[0];
      });
      const children = [];
      const linePoints = [];
      let previousY = null;

      values.forEach(function (value, index) {
        if (value == null) {
          previousY = null;
          return;
        }

        const point = api.coord([index, value]);
        const centerX = point[0];
        const y = point[1];
        const leftNeighbor = centers[index - 1];
        const rightNeighbor = centers[index + 1];
        const fallbackSlotWidth = Math.max(PURCHASE_BAR_WIDTH, coordSys.width / Math.max(values.length, 1));
        const startX = Math.max(
          coordSys.x,
          leftNeighbor == null ? centerX - (fallbackSlotWidth / 2) : (leftNeighbor + centerX) / 2
        );
        const endX = Math.min(
          coordSys.x + coordSys.width,
          rightNeighbor == null ? centerX + (fallbackSlotWidth / 2) : (centerX + rightNeighbor) / 2
        );
        const fillY = Math.min(y, baseline);
        const fillHeight = Math.abs(baseline - y);

        children.push({
          type: "rect",
          shape: {
            x: startX,
            y: fillY,
            width: Math.max(0, endX - startX),
            height: fillHeight
          },
          style: {
            fill: PURCHASE_COLORS.energyArea,
            stroke: "none",
            opacity: state.items && state.items[index] && state.items[index].isForecast ? 0.4 : 1
          },
          silent: true
        });

        if (!linePoints.length || previousY == null) {
          linePoints.push([startX, y]);
        } else {
          linePoints.push([startX, previousY], [startX, y]);
        }

        linePoints.push([endX, y]);
        previousY = y;
      });

      if (linePoints.length > 1) {
        children.push({
          type: "polyline",
          shape: {
            points: linePoints
          },
          style: {
            fill: null,
            stroke: PURCHASE_COLORS.energy,
            lineWidth: 2,
            opacity: state.items && state.items.some(function (item) { return item && item.isForecast; }) ? 0.4 : 1
          },
          silent: true
        });
      }

      return {
        type: "group",
        children: children
      };
    }

    function getPurchaseMarketChartRate(item) {
      const energyRate = firstNumber(item && item.price);
      const purchaseKwh = Math.max(0, firstNumber(item && item.purchaseKwh, 0) || 0);
      const variableFeeRate = firstNumber(
        item && item.variableFeeRate,
        purchaseKwh > 0 ? getItemVariableFeesPln(item) / purchaseKwh : null
      );

      return energyRate == null && variableFeeRate == null
        ? null
        : (energyRate || 0) + (variableFeeRate || 0);
    }

    function getPurchaseMarketZoneColor(item) {
      const tariff = getPurchaseTariff(state.payload);
      const dateKey = normalizeDashboardDateKey(firstText(item && item.sourceDate, item && item.dateKey))
        || formatDateKey(state.anchorDate);
      const startMinute = getPurchaseItemStartMinute(item);
      const hour = startMinute == null ? 0 : clampNumber(Math.floor(startMinute / 60), 0, 23);
      const zoneCode = tariff ? getZoneCodeForDateHour(tariff, dateKey, hour) : "mid";

      if (zoneCode === "low") {
        return PURCHASE_COLORS.marketLow;
      }
      if (zoneCode === "high") {
        return PURCHASE_COLORS.marketHigh;
      }
      return PURCHASE_COLORS.marketMid;
    }

    function buildPurchaseOption(items) {
      const isWeekRange = state.range === "week";
      const isMarketMode = !!state.showMarketRates;
      const theme = getPurchaseThemeTokens();
      const labels = items.map(function (item) { return item.label; });
      const totalPlnValues = items.map(function (item) {
        return item && item.isGap ? null : getItemChartTotalPln(item);
      });
      const purchaseKwhValues = items.map(function (item) {
        if (item && item.isGap) {
          return null;
        }

        return Math.max(0, firstNumber(item && item.purchaseKwh, 0) || 0);
      });
      const marketRateValues = items.map(function (item) {
        if (item && item.isGap) {
          return null;
        }

        return getPurchaseMarketChartRate(item);
      });
      const maxTotalPln = totalPlnValues.reduce(function (currentMax, value) {
        return Math.max(currentMax, value || 0);
      }, 0);
      const maxPurchaseKwh = purchaseKwhValues.reduce(function (currentMax, value) {
        return Math.max(currentMax, value || 0);
      }, 0);
      const maxMarketRate = marketRateValues.reduce(function (currentMax, value) {
        return Math.max(currentMax, value == null ? 0 : value);
      }, 0);
      const valueAxisConfig = getPurchaseAxisConfig(maxTotalPln, 5);
      const purchaseAxisConfig = isMarketMode
        ? getPurchaseMarketRateAxisConfig(state.payload, state.simulation, state.anchorDate, maxMarketRate)
        : getPurchaseAxisConfig(maxPurchaseKwh, 5);
      const barWidth = state.range === "day" ? PURCHASE_BAR_WIDTH : PURCHASE_RANGE_BAR_WIDTH;
      const hasPurchaseLine = !isMarketMode && purchaseKwhValues.some(function (value) { return value > 0; });
      const series = [];

      state.purchaseStepValues = hasPurchaseLine ? purchaseKwhValues : [];

      if (isMarketMode) {
        series.push({
          name: "Cena rynkowa",
          type: "bar",
          data: marketRateValues.map(function (value, index) {
            if (value == null) {
              return null;
            }
            return {
              value: value,
              itemStyle: {
                color: getPurchaseMarketZoneColor(items[index]),
                opacity: items[index] && items[index].isForecast ? 0.4 : 1
              }
            };
          }),
          yAxisIndex: 1,
          barWidth: barWidth,
          barCategoryGap: state.range === "day" ? "28%" : "34%",
          itemStyle: {
            color: PURCHASE_COLORS.marketMid,
            borderRadius: [PURCHASE_BAR_RADIUS, PURCHASE_BAR_RADIUS, 0, 0]
          },
          z: 0
        });
      } else {
        series.push({
          name: "Zakupiona energia",
          type: "custom",
          yAxisIndex: 1,
          data: [[0, 0]],
          renderItem: renderPurchaseEnergyStep,
          clip: true,
          z: 1,
          silent: true
        });
      }

      [
        { name: "Op\u0142aty dystrybucyjne", key: "fees" },
        { name: "Koszt zakupu", key: "cost" },
        { name: "Pokryte z depozytu", key: "deposit" }
      ].forEach(function (seriesConfig, index) {
        series.push({
          name: seriesConfig.name,
          type: "bar",
          stack: "purchase-cost",
          data: getPurchaseSegmentData(items, seriesConfig.key),
          yAxisIndex: 0,
          barWidth: barWidth,
          barMinHeight: 2,
          barGap: index === 0 && isMarketMode ? "-100%" : undefined,
          barCategoryGap: state.range === "day" ? "28%" : "34%",
          z: 3 + index
        });
      });

      return {
        animationDuration: 300,
        animationDurationUpdate: 260,
        grid: {
          top: 18,
          right: 54,
          bottom: isWeekRange ? 58 : 44,
          left: 54,
          containLabel: true
        },
        tooltip: {
          trigger: "axis",
          axisPointer: {
            type: "shadow",
            shadowStyle: {
              color: theme.pointerShadow
            }
          },
          backgroundColor: "transparent",
          borderWidth: 0,
          padding: 0,
          extraCssText: "box-shadow:none;",
          position: positionPurchaseChartTooltip,
          formatter: function (params) {
            const tooltipParam = Array.isArray(params)
              ? params.find(function (param) { return param && typeof param.dataIndex === "number"; })
              : params;
            const item = tooltipParam && typeof tooltipParam.dataIndex === "number"
              ? items[tooltipParam.dataIndex]
              : null;

            if (!item || item.isGap) {
              return "";
            }

            if (isMarketMode) {
              return [
                "<div class=\"pv-chart-tooltip purchase-detail-tooltip\">",
                "<p class=\"pv-chart-tooltip__title\">Cena rynkowa</p>",
                "<p class=\"pv-chart-tooltip__range\">" + escapeHtml(getPurchaseTooltipRangeLabel(item)) + "</p>",
                "<div class=\"purchase-rate-tooltip__divider\"></div>",
                "<p class=\"purchase-rate-tooltip__value\">" + formatPriceRate(getPurchaseMarketChartRate(item)) + " <span>PLN/kWh</span></p>",
                "</div>"
              ].join("");
            }

            return [
              "<div class=\"pv-chart-tooltip purchase-detail-tooltip\">",
              "<p class=\"pv-chart-tooltip__title\">Zakup energii</p>",
              "<p class=\"pv-chart-tooltip__range\">" + escapeHtml(getPurchaseTooltipRangeLabel(item)) + "</p>",
              purchaseTooltipTextRow(PURCHASE_COLORS.energy, "Zakupiona energia", formatDecimal(Math.max(0, firstNumber(item.purchaseKwh, 0) || 0), 2) + " kWh"),
              purchaseTooltipTextRow(PURCHASE_COLORS.cost, "Koszt zakupu", formatDecimal(Math.max(0, firstNumber(item.valuePln, 0) || 0), 2) + " PLN"),
              purchaseTooltipTextRow("", "Pokryte z depozytu", formatDecimal(getItemDepositCoveredPln(item), 2) + " PLN", "purchase-chart-tooltip__dot--deposit"),
              purchaseTooltipTextRow(PURCHASE_COLORS.fees, "Op\u0142aty dystrybucyjne", formatDecimal(getItemVariableFeesPln(item), 2) + " PLN"),
              "</div>"
            ].join("");
          }
        },
        xAxis: {
          type: "category",
          data: labels,
          axisTick: { show: false },
          axisLine: { show: false },
          boundaryGap: true,
          axisLabel: {
            color: theme.text,
            fontSize: 14,
            lineHeight: 20,
            margin: isWeekRange ? 18 : 14,
            interval: 0
          }
        },
        yAxis: [
          {
            type: "value",
            min: 0,
            max: valueAxisConfig.max,
            interval: valueAxisConfig.interval,
            splitNumber: valueAxisConfig.splitNumber,
            axisTick: { show: false },
            axisLine: { show: false },
            axisLabel: {
              color: theme.text,
              fontSize: 14,
              margin: 12,
              formatter: function (value) {
                return formatDecimal(value, 2);
              }
            },
            splitLine: {
              lineStyle: {
                color: theme.gridLine,
                width: 1
              }
            }
          },
          {
            type: "value",
            min: 0,
            max: purchaseAxisConfig.max,
            interval: purchaseAxisConfig.interval,
            splitNumber: purchaseAxisConfig.splitNumber,
            axisTick: { show: false },
            axisLine: { show: false },
            axisLabel: {
              color: theme.text,
              fontSize: 14,
              margin: 12,
              formatter: function (value) {
                return !isMarketMode && value === 0 ? "0" : formatDecimal(value, 2);
              }
            },
            splitLine: {
              show: false
            }
          }
        ],
        dataZoom: [
          {
            id: "purchase-inside",
            type: "inside",
            xAxisIndex: 0,
            filterMode: "none",
            zoomOnMouseWheel: false,
            moveOnMouseWheel: false,
            moveOnMouseMove: true,
            preventDefaultMouseMove: false
          },
          {
            id: "purchase-slider",
            type: "slider",
            show: false,
            xAxisIndex: 0,
            filterMode: "none"
          }
        ],
        series: series
      };
    }

    function getPurchaseDayMarkerIndex(minute) {
      const normalizedMinute = clampNumber(Math.round(minute == null ? 0 : minute), 0, (24 * 60) - 1);
      const hour = Math.floor(normalizedMinute / 60);
      const minuteInHour = normalizedMinute - (hour * 60);

      if (state.dayDetailMode) {
        return (hour * 5) + (minuteInHour / 15);
      }

      return hour + (minuteInHour / 60);
    }

    function formatMinuteOfDayEcharts(minute) {
      const safeMinute = clampNumber(Math.round(minute || 0), 0, (24 * 60) - 1);
      const hour = Math.floor(safeMinute / 60);
      const minuteInHour = safeMinute - (hour * 60);
      return String(hour).padStart(2, "0") + ":" + String(minuteInHour).padStart(2, "0");
    }

    function renderPurchaseSunMarkersEcharts() {
      if (!sunMarkersEl) {
        return;
      }

      sunMarkersEl.innerHTML = "";

      if (state.range !== "day" || !state.chart || !state.items.length) {
        sunMarkersEl.hidden = true;
        return;
      }

      [
        {
          type: "sunrise",
          label: "Wsch\u00f3d s\u0142o\u0144ca",
          minute: 6 * 60,
          icon: "images/icons/sunrise.svg"
        },
        {
          type: "sunset",
          label: "Zach\u00f3d s\u0142o\u0144ca",
          minute: 20 * 60,
          icon: "images/icons/sunset.svg"
        }
      ].forEach(function (marker) {
        const position = state.chart.convertToPixel({ xAxisIndex: 0 }, getPurchaseDayMarkerIndex(marker.minute));
        if (!Number.isFinite(position) || position < -20 || position > chartEl.clientWidth + 20) {
          return;
        }

        const element = document.createElement("span");
        const clock = formatMinuteOfDayEcharts(marker.minute);

        element.className = "pv-sun-marker purchase-sun-marker purchase-sun-marker--" + marker.type;
        element.style.left = position + "px";
        element.style.backgroundImage = "url('" + marker.icon + "')";
        element.title = marker.label + ": " + clock;
        element.setAttribute("aria-label", element.title);
        sunMarkersEl.appendChild(element);
      });

      sunMarkersEl.hidden = !sunMarkersEl.children.length;
    }

    function applyPurchaseZoomWindow() {
      if (!state.chart || !state.items.length) {
        return;
      }

      const fullLength = state.items.length;
      const maxStartIndex = Math.max(fullLength - state.windowCount, 0);
      const startValue = state.windowStartIndex != null
        ? clampNumber(state.windowStartIndex, 0, maxStartIndex)
        : 0;
      const endValue = Math.min(fullLength - 1, startValue + state.windowCount - 1);

      state.chart.dispatchAction({
        type: "dataZoom",
        dataZoomId: "purchase-inside",
        startValue: startValue,
        endValue: endValue
      });
    }

    function switchPurchaseDayDetailMode(nextMode, startValue, endValue) {
      const startHour = state.dayDetailMode ? Math.floor(startValue / 5) : startValue;
      const endHourExclusive = state.dayDetailMode ? Math.ceil((endValue + 1) / 5) : endValue + 1;

      state.dayDetailMode = nextMode;
      state.windowStartIndex = nextMode ? startHour * 5 : startHour;
      state.windowCount = nextMode
        ? Math.max(5, (endHourExclusive - startHour) * 5)
        : Math.max(1, endHourExclusive - startHour);
      applyPayload();
    }

    function syncPurchaseWindowCount() {
      if (!state.chart || !state.items.length) {
        return;
      }

      const option = state.chart.getOption();
      const zoomState = option.dataZoom && option.dataZoom[0];
      if (!zoomState) {
        return;
      }

      const startValue = typeof zoomState.startValue === "number" ? zoomState.startValue : 0;
      const endValue = typeof zoomState.endValue === "number" ? zoomState.endValue : state.items.length - 1;

      state.windowStartIndex = startValue;
      state.windowCount = clampNumber(
        (endValue - startValue) + 1,
        getPurchaseMinWindow(state.range, state.items.length),
        state.items.length
      );

      if (state.range === "day") {
        const scale = getPurchaseDayZoomScale(state.windowCount, state.dayDetailMode);
        if (!state.dayDetailMode && scale > 199) {
          switchPurchaseDayDetailMode(true, startValue, endValue);
          return;
        }
        if (state.dayDetailMode && scale <= 190) {
          switchPurchaseDayDetailMode(false, startValue, endValue);
        }
      }
    }

    function renderChart(items) {
      state.items = Array.isArray(items) ? items : [];

      if (!chartEl) {
        return;
      }

      if (!state.items.length) {
        if (chartPanelEl) {
          chartPanelEl.classList.add("is-empty");
        }
        if (state.chart) {
          state.chart.clear();
        } else {
          chartEl.innerHTML = "";
        }
        renderPurchaseSunMarkersEcharts();
        return;
      }

      if (chartPanelEl) {
        chartPanelEl.classList.remove("is-empty");
      }

      const chart = ensurePurchaseChart();
      if (!chart) {
        return;
      }

      state.windowCount = clampNumber(
        state.windowCount || getPurchaseDefaultWindow(state.range, state.items.length),
        getPurchaseMinWindow(state.range, state.items.length),
        Math.max(state.items.length, 1)
      );
      state.windowStartIndex = state.windowStartIndex == null
        ? null
        : clampNumber(state.windowStartIndex, 0, Math.max(state.items.length - state.windowCount, 0));

      try {
        const purchaseOption = buildPurchaseOption(state.items);
        chart.setOption(purchaseOption, true);
      } catch (error) {
        console.error("Purchase ECharts render failed:", error);
        if (chartPanelEl) {
          chartPanelEl.classList.add("is-empty");
        }
        if (chartEmptyEl) {
          chartEmptyEl.textContent = "Błąd renderowania wykresu zakupu energii.";
        }
        return;
      }
      applyPurchaseZoomWindow();
      if (currentHourHighlighter) {
        currentHourHighlighter.update();
      }
      requestAnimationFrame(renderPurchaseSunMarkersEcharts);
    }

    function zoomPurchaseChart(direction) {
      if (!state.items.length) {
        return;
      }

      const minWindow = getPurchaseMinWindow(state.range, state.items.length);
      const currentStart = state.windowStartIndex == null ? 0 : state.windowStartIndex;
      const currentEnd = Math.min(state.items.length - 1, currentStart + state.windowCount - 1);
      const currentCenter = currentStart + ((currentEnd - currentStart) / 2);
      if (state.range === "day") {
        Object.assign(state, window.onRevoltDayZoom.detailWindow(state, currentCenter, direction));
        applyPayload();
        return;
      }
      const targetWindow = direction > 0
        ? Math.max(minWindow, Math.round(state.windowCount * 0.8))
        : Math.min(state.items.length, Math.round(state.windowCount * 1.25));

      state.windowCount = clampNumber(targetWindow, minWindow, state.items.length);
      state.windowStartIndex = clampNumber(
        Math.round(currentCenter - ((state.windowCount - 1) / 2)),
        0,
        Math.max(state.items.length - state.windowCount, 0)
      );
      applyPurchaseZoomWindow();
      requestAnimationFrame(renderPurchaseSunMarkersEcharts);
    }

    function resetPurchaseZoomWindow() {
      if (!state.items.length) {
        return;
      }

      const wasDayDetailMode = state.dayDetailMode;
      state.dayDetailMode = false;
      state.windowStartIndex = null;
      state.windowCount = getPurchaseDefaultWindow(state.range, state.items.length);

      if (wasDayDetailMode) {
        applyPayload();
        return;
      }

      applyPurchaseZoomWindow();
      requestAnimationFrame(renderPurchaseSunMarkersEcharts);
    }

    function jumpToLatestPurchaseDay() {
      state.range = "day";
      state.anchorDate = getDashboardNavigationDay(new Date());
      state.anchorTouched = true;
      state.anchorSourceKey = formatDateKey(state.anchorDate);
      state.dayDetailMode = false;
      state.windowStartIndex = null;
      state.windowCount = null;
      updateToolbar();
      applyPayload();
    }

    function updateCards(items, payload) {
      const activeItems = items.filter(function (item) {
        return item && item.active && (item.purchaseKwh || 0) > 0 && firstNumber(item.price) != null;
      });
      const priceSource = activeItems.length ? activeItems : items.filter(function (item) {
        return item && firstNumber(item.price) != null;
      });
      const totalEnergy = items.reduce(function (sum, item) {
        return sum + (firstNumber(item && item.purchaseKwh, 0) || 0);
      }, 0);
      const totalValue = items.reduce(function (sum, item) {
        return sum + (firstNumber(item && item.valuePln, 0) || 0);
      }, 0);
      const depositCovered = items.reduce(function (sum, item) {
        return sum + (firstNumber(item && item.depositCoveredPln, 0) || 0);
      }, 0);
      const fees = items.reduce(function (sum, item) {
        return sum + getItemVariableFeesPln(item);
      }, 0);
      const payable = items.reduce(function (sum, item) {
        return sum + getItemPurchasePayablePln(item);
      }, 0);
      const weightedAverage = totalEnergy > 0
        ? items.reduce(function (sum, item) {
          return sum + ((firstNumber(item && item.price, 0) || 0) * (firstNumber(item && item.purchaseKwh, 0) || 0));
        }, 0) / totalEnergy
        : (priceSource.length
          ? priceSource.reduce(function (sum, item) { return sum + (firstNumber(item && item.price, 0) || 0); }, 0) / priceSource.length
          : null);
      const bestPrice = priceSource.length
        ? Math.min.apply(Math, priceSource.map(function (item) { return firstNumber(item && item.price, 0) || 0; }))
        : null;
      const maxPrice = priceSource.length
        ? Math.max.apply(Math, priceSource.map(function (item) { return firstNumber(item && item.price, 0) || 0; }))
        : null;
      const currentPrice = getCurrentPurchasePrice(payload, items);

      setMetric(currentPriceValueEl, currentPrice);
      updateCurrentPurchasePriceState(currentPrice, maxPrice || bestPrice, weightedAverage);
      setMetric(averagePriceValueEl, weightedAverage);
      setMetric(totalValueEl, totalValue);
      setMetric(energyValueEl, totalEnergy);
      setMetric(depositCoveredValueEl, depositCovered);
      setMetric(feesValueEl, fees);
      setMetric(payableValueEl, payable);
    }

    function updateToolbar() {
      const canUseMarketRates = state.range === "day";

      if (!canUseMarketRates && state.showMarketRates) {
        state.showMarketRates = false;
      }

      let label = formatLongDate(state.anchorDate);
      if (state.range === "week") {
        label = formatWeekLabel(state.anchorDate);
      } else if (state.range === "month") {
        label = formatMonthLabel(state.anchorDate);
      } else if (state.range === "year") {
        label = formatYearLabel(state.anchorDate);
      }

      if (breadcrumbRangeEl) {
        breadcrumbRangeEl.textContent = formatRangeName(state.range);
      }
      if (rangeLabelEl) {
        rangeLabelEl.textContent = label;
        window.DashboardCalendar.sync(rangeLabelEl, {
          date: state.anchorDate, range: state.range,
          clamp: function (date) { return clampDashboardNavigationDate(date, state.range); },
          select: function (date) {
            state.anchorTouched = true;
            state.anchorDate = clampDashboardNavigationDate(date, state.range);
            state.windowStartIndex = null;
            updateToolbar();
            applyPayload();
          }
        });
      }
      rangeButtons.forEach(function (button) {
        const isActive = button.getAttribute("data-purchase-range") === state.range;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
      updateDashboardShiftButtons(shiftButtons, state.range, state.anchorDate, "data-purchase-shift");
      if (marketToggleButton) {
        marketToggleButton.disabled = !canUseMarketRates;
        marketToggleButton.classList.toggle("is-active", canUseMarketRates && !!state.showMarketRates);
        marketToggleButton.classList.toggle("is-disabled", !canUseMarketRates);
        marketToggleButton.setAttribute("aria-pressed", canUseMarketRates && state.showMarketRates ? "true" : "false");
        marketToggleButton.setAttribute("aria-disabled", canUseMarketRates ? "false" : "true");
      }
      if (auxiliaryUnitPill) {
        auxiliaryUnitPill.textContent = state.showMarketRates ? "PLN/kWh" : "kWh";
      }
      purchasePage.setAttribute("data-purchase-mode", state.showMarketRates ? "rates" : "purchase");
    }

    function shiftRange(step) {
      state.anchorTouched = true;
      let nextDate = new Date(state.anchorDate);
      if (state.range === "week") {
        nextDate = addDays(state.anchorDate, step * 7);
      } else if (state.range === "month") {
        nextDate = addMonths(state.anchorDate, step);
      } else if (state.range === "year") {
        nextDate = addYears(state.anchorDate, step);
      } else {
        nextDate = addDays(state.anchorDate, step);
      }
      state.anchorDate = clampDashboardNavigationDate(nextDate, state.range);
      state.windowStartIndex = null;
      updateToolbar();
      applyPayload();
    }

    function applyPayload() {
try {
      const payload = window.dashboardLatestPayload || {};
      const simulation = window.dashboardProsumerSimulation;
      const payloadAnchorDate = getPayloadAnchorDate(payload);
      const payloadAnchorKey = formatDateKey(payloadAnchorDate);

      state.payload = payload;
      state.simulation = simulation;

      if (!state.anchorSourceKey || (!state.anchorTouched && state.anchorSourceKey !== payloadAnchorKey)) {
        state.anchorDate = payloadAnchorDate;
        state.anchorSourceKey = payloadAnchorKey;
      }

      state.anchorDate = clampDashboardNavigationDate(state.anchorDate, state.range);
      updateToolbar();

      if (isDashboardSelectionBeforeHistoryStart(state.range, state.anchorDate, payload)) {
        renderZeroState("Brak historii zakupu energii.");
        return;
      }

      const rangeWindow = getRangeWindow(state.range, state.anchorDate);
      updateTariffSummaryCards(payload, rangeWindow);
      let items = window.dashboardReForecastEnabled && simulation && simulation.isForecast
        ? buildForecastAwareRangeItems(payload, simulation, rangeWindow)
        : buildMeasuredRangeItems(payload, rangeWindow);
      if (!items.length) {
        items = buildSimulationRangeItems(simulation, rangeWindow);
      }
      if (!items.length) {
        renderZeroState("Brak danych zakupu energii dla wybranego zakresu.");
        return;
      }

      renderChart(items);
      updateCards(items, payload);
    
} catch (error) { if (!window.dashboardLatestPayload?.tariffHistory?.strict) throw error; clientTariffNotice(error.message); renderZeroState(error.message); }
}

    const state = {
      range: "day",
      anchorDate: new Date(),
      anchorTouched: false,
      anchorSourceKey: "",
      showMarketRates: false,
      chart: null,
      items: [],
      dayDetailMode: false,
      payload: null,
      simulation: null,
      purchaseStepValues: [],
      windowStartIndex: null,
      windowCount: null
    };
    let currentHourHighlighter = null;

    rangeButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        state.range = button.getAttribute("data-purchase-range") || "day";
        state.anchorDate = clampDashboardNavigationDate(state.anchorDate, state.range);
        state.anchorTouched = true;
        state.dayDetailMode = false;
        state.windowStartIndex = null;
        state.windowCount = null;
        updateToolbar();
        applyPayload();
      });
    });

    shiftButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        shiftRange(Number(button.getAttribute("data-purchase-shift") || 0));
      });
    });

    if (marketToggleButton) {
      marketToggleButton.addEventListener("click", function () {
        if (state.range !== "day") {
          state.showMarketRates = false;
          updateToolbar();
          return;
        }
        state.showMarketRates = !state.showMarketRates;
        updateToolbar();
        applyPayload();
      });
    }

    zoomButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        const direction = Number(button.getAttribute("data-purchase-zoom") || 0);
        zoomPurchaseChart(direction);
      });
    });

    if (zoomResetButton) {
      zoomResetButton.addEventListener("click", function () {
        jumpToLatestPurchaseDay();
      });
    }

    [currentDateButton, currentTimeButton].forEach(function (button) {
      if (!button) {
        return;
      }

      button.addEventListener("click", function () {
        jumpToLatestPurchaseDay();
      });
    });

    document.addEventListener("dashboard:payload-updated", applyPayload);
    document.addEventListener("dashboard:prosumer-updated", applyPayload);
    document.addEventListener("dashboard:bank-incremental-updated", function () {
      if (document.body && document.body.getAttribute("data-active-detail-view") === "purchase") {
        applyPayload();
      }
    });

    document.addEventListener("detailview:open", function (event) {
      if (!event.detail || event.detail.view !== "purchase") {
        return;
      }

      requestAnimationFrame(function () {
        applyPayload();
        if (state.chart) {
          state.chart.resize();
          requestAnimationFrame(renderPurchaseSunMarkersEcharts);
        }
      });
    });

    document.addEventListener("detailview:themechange", function () {
      if (state.chart && state.items.length) {
        renderChart(state.items);
        state.chart.resize();
      }
    });

    window.addEventListener("resize", function () {
      if (state.chart) {
        state.chart.resize();
        requestAnimationFrame(renderPurchaseSunMarkersEcharts);
      }
    });

    updateToolbar();
    applyPayload();
  }

  function initPvView() {
    return;
    const pvPage = document.getElementById("pv-detail");
    const breadcrumbRangeEl = document.getElementById("pv-breadcrumb-range");
    const rangeLabelEl = document.getElementById("pv-range-label");
    const currentValueEl = document.getElementById("pv-current-value");
    const totalValueEl = document.getElementById("pv-total-value");
    const selfUseValueEl = document.getElementById("pv-self-use-value");
    const laterUseValueEl = document.getElementById("pv-later-use-value");
    const hourlyBalanceValueEl = document.getElementById("pv-hourly-balance-value");
    const saleEnergyValueEl = document.getElementById("pv-sale-energy-value");
    const salePriceEl = document.getElementById("pv-sale-price");
    const installedPowerEl = document.getElementById("pv-installed-power");
    const rangeButtons = Array.from(document.querySelectorAll("[data-pv-range]"));
    const shiftButtons = Array.from(document.querySelectorAll("[data-pv-shift]"));
    const monthTitleFormatter = new Intl.DateTimeFormat("pl-PL", {
      month: "long",
      year: "numeric"
    });

    if (!pvPage) {
      return;
    }

    function numberOrNull(value) {
      if (value == null || value === "") {
        return null;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }

    function firstNumber() {
      for (let i = 0; i < arguments.length; i += 1) {
        const numeric = numberOrNull(arguments[i]);
        if (numeric != null) {
          return numeric;
        }
      }
      return null;
    }

    function formatDecimal(value, digits) {
      return Number(value || 0).toFixed(digits == null ? 1 : digits).replace(".", ",");
    }

    function formatRangeName(range) {
      switch (range) {
        case "week":
          return "Tydzień";
        case "month":
          return "Miesiąc";
        case "year":
          return "Rok";
        default:
          return "Dzień";
      }
    }

    function addDays(date, days) {
      const next = new Date(date);
      next.setDate(next.getDate() + days);
      return next;
    }

    function addMonths(date, months) {
      const next = new Date(date);
      next.setMonth(next.getMonth() + months);
      return next;
    }

    function addYears(date, years) {
      const next = new Date(date);
      next.setFullYear(next.getFullYear() + years);
      return next;
    }

    function getStartOfWeek(date) {
      const next = new Date(date);
      const day = next.getDay();
      const shift = day === 0 ? -6 : 1 - day;

      next.setDate(next.getDate() + shift);
      return next;
    }

    function formatLongDate(date) {
      return capitalize(weekdayFormatter.format(date)) + " " + dateFormatter.format(date);
    }

    function formatWeekLabel(date) {
      const start = getStartOfWeek(date);
      const end = addDays(start, 6);
      return dateFormatter.format(start) + " - " + dateFormatter.format(end);
    }

    function formatMonthLabel(date) {
      return capitalize(monthTitleFormatter.format(date));
    }

    function formatYearLabel(date) {
      return String(date.getFullYear());
    }

    function setMetric(element, value, digits) {
      if (!element) {
        return;
      }
      element.textContent = value == null ? "--" : formatDecimal(value, digits == null ? 1 : digits);
    }

    function setMetricWithPercent(element, value, total) {
      if (!element) {
        return;
      }

      if (value == null || total == null || total <= 0) {
        element.textContent = "--";
        return;
      }

      element.textContent = formatDecimal(value, 1) + " kWh | " + Math.round((value / total) * 100) + "%";
    }

    function setPrice(element, value) {
      if (!element) {
        return;
      }

      if (value == null) {
        element.innerHTML = "-- <span>PLN / kWh</span>";
        return;
      }

      element.innerHTML = formatDecimal(value, 2) + " <span>PLN / kWh</span>";
    }

    function setInstalledPower(element, value) {
      if (!element) {
        return;
      }

      if (value == null) {
        element.innerHTML = "Moc instalacji: -- <span>kW</span>";
        return;
      }

      element.innerHTML = "Moc instalacji: " + formatDecimal(value, 1) + " <span>kW</span>";
    }

    function getBreakdown(payload) {
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      let total = firstNumber(
        rawEnergy.productionTotalKwh,
        rawEnergy.totalProductionKwh,
        rawEnergy.pvTotalKwh,
        energy.productionKwh
      );
      const selfUse = firstNumber(
        rawEnergy.selfConsumptionKwh,
        rawEnergy.autoconsumptionKwh,
        rawEnergy.autokonsumpcjaKwh,
        total != null ? total * 0.42 : null
      );
      const laterUse = firstNumber(
        rawEnergy.laterUseKwh,
        rawEnergy.storageUseKwh,
        rawEnergy.delayedConsumptionKwh,
        rawEnergy.pozniejszeWykorzystanieKwh,
        total != null ? total * 0.26 : null
      );
      const hourlyBalance = firstNumber(
        rawEnergy.hourlyBalancingKwh,
        rawEnergy.balancingKwh,
        rawEnergy.bilansowanieGodzinoweKwh,
        total != null ? total * 0.18 : null
      );
      let sale = firstNumber(
        rawEnergy.saleKwh,
        rawEnergy.exportKwh,
        rawEnergy.sprzedazKwh,
        total != null && selfUse != null && laterUse != null && hourlyBalance != null
          ? Math.max(total - selfUse - laterUse - hourlyBalance, 0)
          : null
      );

      if (total == null) {
        total = [selfUse, laterUse, hourlyBalance, sale].reduce(function (sum, value) {
          return sum + (value == null ? 0 : value);
        }, 0);
        total = total > 0 ? total : null;
      }

      if (sale == null && total != null) {
        sale = Math.max(total - (selfUse || 0) - (laterUse || 0) - (hourlyBalance || 0), 0);
      }

      return {
        total: total,
        selfUse: selfUse,
        laterUse: laterUse,
        hourlyBalance: hourlyBalance,
        sale: sale,
        salePricePln: firstNumber(rawEnergy.salePricePln, rawEnergy.salePrice, energy.salePricePln),
        installedPowerKw: firstNumber(
          rawEnergy.installedPowerKw,
          rawEnergy.installationPowerKw,
          rawEnergy.mocInstalacjiKw,
          rawEnergy.powerKw,
          10
        )
      };
    }

    const state = {
      range: "day",
      anchorDate: new Date()
    };

    function updateToolbar() {
      const anchorDate = state.anchorDate;
      let label = formatLongDate(anchorDate);

      if (state.range === "week") {
        label = formatWeekLabel(anchorDate);
      } else if (state.range === "month") {
        label = formatMonthLabel(anchorDate);
      } else if (state.range === "year") {
        label = formatYearLabel(anchorDate);
      }

      if (breadcrumbRangeEl) {
        breadcrumbRangeEl.textContent = formatRangeName(state.range);
      }

      if (rangeLabelEl) {
        rangeLabelEl.textContent = label;
      }

      rangeButtons.forEach(function (button) {
        const isActive = button.getAttribute("data-pv-range") === state.range;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }

    function shiftRange(step) {
      if (state.range === "week") {
        state.anchorDate = addDays(state.anchorDate, step * 7);
      } else if (state.range === "month") {
        state.anchorDate = addMonths(state.anchorDate, step);
      } else if (state.range === "year") {
        state.anchorDate = addYears(state.anchorDate, step);
      } else {
        state.anchorDate = addDays(state.anchorDate, step);
      }

      updateToolbar();
      applyPayload();
    }

    function applyPayload() {
      const payload = window.dashboardLatestPayload || {};
      const energy = payload.energy || {};
      const breakdown = getBreakdown(payload);

      setMetric(currentValueEl, energy.productionKwh, 1);
      setMetric(totalValueEl, breakdown.total != null ? breakdown.total : energy.productionKwh, 1);
      setMetricWithPercent(selfUseValueEl, breakdown.selfUse, breakdown.total);
      setMetricWithPercent(laterUseValueEl, breakdown.laterUse, breakdown.total);
      setMetricWithPercent(hourlyBalanceValueEl, breakdown.hourlyBalance, breakdown.total);
      setMetricWithPercent(saleEnergyValueEl, breakdown.sale, breakdown.total);
      setPrice(salePriceEl, breakdown.salePricePln);
      setInstalledPower(installedPowerEl, breakdown.installedPowerKw);
    }

    rangeButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        const nextRange = button.getAttribute("data-pv-range") || "day";
        state.range = nextRange;
        updateToolbar();
      });
    });

    shiftButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        shiftRange(Number(button.getAttribute("data-pv-shift") || 0));
      });
    });

    document.addEventListener("dashboard:payload-updated", applyPayload);

    updateToolbar();
    applyPayload();
  }

  function initBankView() {
    const bankPage = document.getElementById("bank-detail");
    const breadcrumbRangeEl = document.getElementById("bank-breadcrumb-range");
    const rangeLabelEl = document.getElementById("bank-range-label");
    const socPillEl = document.getElementById("bank-soc-pill");
    const statusPillEl = document.getElementById("bank-status-pill");
    const stageDialEl = document.getElementById("bank-stage-dial");
    const summaryDialEl = document.getElementById("bank-summary-dial");
    const stageSocValueEl = document.getElementById("bank-stage-soc-value");
    const stageSocLabelEl = document.getElementById("bank-stage-soc-label");
    const stageLevelValueEl = document.getElementById("bank-stage-level-value");
    const stageCapacityValueEl = document.getElementById("bank-stage-capacity-value");
    const stageChargeValueEl = document.getElementById("bank-stage-charge-value");
    const stageDischargeValueEl = document.getElementById("bank-stage-discharge-value");
    const stageAutonomyValueEl = document.getElementById("bank-stage-autonomy-value");
    const stageReserveValueEl = document.getElementById("bank-stage-reserve-value");
    const currentValueEl = document.getElementById("bank-current-value");
    const statusBadgeEl = document.getElementById("bank-status-badge");
    const statusDetailEl = document.getElementById("bank-status-detail");
    const chargeEnergyValueEl = document.getElementById("bank-charge-energy-value");
    const chargeEnergyDetailEl = document.getElementById("bank-charge-energy-detail");
    const chargePowerValueEl = document.getElementById("bank-charge-power-value");
    const chargePowerDetailEl = document.getElementById("bank-charge-power-detail");
    const cycleCountValueEl = document.getElementById("bank-cycle-count-value");
    const cycleCountTotalEl = document.getElementById("bank-cycle-count-total");
    const rangeButtons = Array.from(document.querySelectorAll("[data-bank-range]"));
    const shiftButtons = Array.from(document.querySelectorAll("[data-bank-shift]"));
    const monthTitleFormatter = new Intl.DateTimeFormat("pl-PL", {
      month: "long",
      year: "numeric"
    });

    if (!bankPage) {
      return;
    }

    function numberOrNull(value) {
      if (value == null || value === "") {
        return null;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }

    function firstNumber() {
      for (let i = 0; i < arguments.length; i += 1) {
        const numeric = numberOrNull(arguments[i]);
        if (numeric != null) {
          return numeric;
        }
      }
      return null;
    }

    function formatDecimal(value, digits) {
      return Number(value || 0).toFixed(digits == null ? 1 : digits).replace(".", ",");
    }

    function formatRangeName(range) {
      switch (range) {
        case "week":
          return "Tydzień";
        case "month":
          return "Miesiąc";
        case "year":
          return "Rok";
        default:
          return "Dzień";
      }
    }

    function addDays(date, days) {
      const next = new Date(date);
      next.setDate(next.getDate() + days);
      return next;
    }

    function addMonths(date, months) {
      const next = new Date(date);
      next.setMonth(next.getMonth() + months);
      return next;
    }

    function addYears(date, years) {
      const next = new Date(date);
      next.setFullYear(next.getFullYear() + years);
      return next;
    }

    function getStartOfWeek(date) {
      const next = new Date(date);
      const day = next.getDay();
      const shift = day === 0 ? -6 : 1 - day;

      next.setDate(next.getDate() + shift);
      return next;
    }

    function formatLongDate(date) {
      return capitalize(weekdayFormatter.format(date)) + " " + dateFormatter.format(date);
    }

    function formatWeekLabel(date) {
      const start = getStartOfWeek(date);
      const end = addDays(start, 6);
      return dateFormatter.format(start) + " - " + dateFormatter.format(end);
    }

    function formatMonthLabel(date) {
      return capitalize(monthTitleFormatter.format(date));
    }

    function formatYearLabel(date) {
      return String(date.getFullYear());
    }

    function setText(element, value) {
      if (element) {
        element.textContent = value == null || value === "" ? "--" : String(value);
      }
    }

    function setMetric(element, value, unit, digits) {
      if (!element) {
        return;
      }

      if (value == null) {
        element.textContent = "--";
        return;
      }

      element.textContent = formatDecimal(value, digits == null ? 1 : digits) + " " + unit;
    }

    function setValueOnly(element, value, digits) {
      if (!element) {
        return;
      }

      if (value == null) {
        element.textContent = "--";
        return;
      }

      element.textContent = formatDecimal(value, digits == null ? 1 : digits);
    }

    function setPercent(element, value, digits) {
      if (!element) {
        return;
      }

      if (value == null) {
        element.textContent = "--";
        return;
      }

      element.textContent = formatDecimal(value, digits == null ? 0 : digits) + "%";
    }

    function setCycles(element, value) {
      if (!element) {
        return;
      }

      if (value == null) {
        element.textContent = "Liczba cykli: --";
        return;
      }

      element.textContent = "Liczba cykli: " + formatDecimal(value, 0);
    }

    function setSocPill(element, value) {
      if (!element) {
        return;
      }

      if (value == null) {
        element.innerHTML = "SOC: -- <span>%</span>";
        return;
      }

      element.innerHTML = "SOC: " + formatDecimal(value, 0) + " <span>%</span>";
    }

    function formatMetricText(value, unit, digits) {
      return value == null ? "--" : formatDecimal(value, digits == null ? 1 : digits) + " " + unit;
    }

    function getStatusState(breakdown) {
      if (breakdown.chargeKw != null && breakdown.chargeKw > 0.1 && (breakdown.dischargeKw == null || breakdown.chargeKw >= breakdown.dischargeKw)) {
        return { key: "charging", label: "Ładowanie" };
      }

      if (breakdown.dischargeKw != null && breakdown.dischargeKw > 0.1) {
        return { key: "discharging", label: "Rozładowanie" };
      }

      return { key: "idle", label: "Czuwanie" };
    }

    function setStatusPill(element, status) {
      if (!element) {
        return;
      }

      element.textContent = "Status: " + status.label;
      element.setAttribute("data-state", status.key);
    }

    function setStatusBadge(element, status) {
      if (!element) {
        return;
      }

      element.textContent = status.label;
      element.setAttribute("data-state", status.key);
    }

    function setCycleSummary(element, value) {
      if (!element) {
        return;
      }

      element.textContent = value == null ? "-- / 8000" : formatDecimal(value, 0) + " / 8000";
    }

    function setDialAngle(element, value) {
      if (!element) {
        return;
      }

      const safePercent = value == null ? 0 : Math.max(0, Math.min(100, value));
      element.style.setProperty("--bank-dial-fill-angle", String((safePercent / 100) * 360) + "deg");
    }

    function getBreakdown(payload) {
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const levelKwh = firstNumber(
        rawEnergy.batteryLevelKwh,
        rawEnergy.bankKwh,
        rawEnergy.storageLevelKwh,
        energy.batteryLevelKwh,
        energy.bankKwh
      );
      const capacityKwh = firstNumber(
        rawEnergy.batteryCapacityKwh,
        rawEnergy.bankCapacityKwh,
        rawEnergy.storageCapacityKwh,
        rawEnergy.capacityKwh,
        energy.batteryCapacityKwh,
        levelKwh != null ? Math.max(levelKwh, 40) : null
      );
      let socPercent = firstNumber(
        rawEnergy.batterySocPercent,
        rawEnergy.socPercent,
        rawEnergy.batterySoc,
        rawEnergy.soc
      );

      if (socPercent != null && socPercent > 0 && socPercent <= 1) {
        socPercent *= 100;
      }
      if (socPercent == null && levelKwh != null && capacityKwh != null && capacityKwh > 0) {
        socPercent = (levelKwh / capacityKwh) * 100;
      }

      const chargeKw = firstNumber(
        rawEnergy.batteryChargeKw,
        rawEnergy.chargePowerKw,
        rawEnergy.storageChargeKw,
        rawEnergy.magazynLadowanieKw,
        energy.batteryChargeKw,
        energy.productionKwh != null && energy.usageKwh != null
          ? Math.max(energy.productionKwh - energy.usageKwh, 0) * 0.22
          : null
      );
      const dischargeKw = firstNumber(
        rawEnergy.batteryDischargeKw,
        rawEnergy.dischargePowerKw,
        rawEnergy.storageDischargeKw,
        rawEnergy.magazynRozladowanieKw,
        energy.batteryDischargeKw,
        energy.usageKwh != null && energy.productionKwh != null
          ? Math.max(energy.usageKwh - energy.productionKwh, 0) * 0.18
          : null
      );
      const reserveKwh = firstNumber(
        rawEnergy.reserveKwh,
        rawEnergy.backupReserveKwh,
        rawEnergy.rezerwaKwh,
        levelKwh != null ? Math.max(Math.min(levelKwh * 0.2, 8), 2) : null
      );
      const availableKwh = levelKwh == null ? null : Math.max(levelKwh - (reserveKwh || 0), 0);
      const autonomyHours = firstNumber(
        rawEnergy.autonomyHours,
        rawEnergy.backupHours,
        levelKwh != null && energy.instantPowerW != null && energy.instantPowerW > 0
          ? levelKwh / (energy.instantPowerW / 1000)
          : null
      );
      const cycleCount = firstNumber(
        rawEnergy.batteryCycleCount,
        rawEnergy.cycles,
        rawEnergy.cycleCount,
        rawEnergy.liczbaCykli
      );
      const healthPercent = firstNumber(
        rawEnergy.batteryHealthPercent,
        rawEnergy.healthPercent,
        rawEnergy.soh,
        cycleCount != null ? Math.max(60, 100 - (cycleCount / 80)) : null
      );
      const pvChargeKwh = firstNumber(
        rawEnergy.chargeFromPvKwh,
        rawEnergy.pvChargeKwh,
        rawEnergy.storageChargeFromPvKwh,
        energy.productionKwh != null ? energy.productionKwh * 0.22 : null
      );
      const homeSupportKwh = firstNumber(
        rawEnergy.storageUseKwh,
        rawEnergy.homeSupportKwh,
        rawEnergy.batterySupportKwh,
        energy.usageKwh != null ? energy.usageKwh * 0.18 : null
      );
      const gridBufferKwh = firstNumber(
        rawEnergy.gridBufferKwh,
        rawEnergy.gridSupportKwh,
        rawEnergy.backupReserveKwh,
        reserveKwh
      );

      return {
        levelKwh: levelKwh,
        capacityKwh: capacityKwh,
        socPercent: socPercent == null ? null : Math.max(0, Math.min(100, socPercent)),
        chargeKw: chargeKw,
        dischargeKw: dischargeKw,
        reserveKwh: reserveKwh,
        availableKwh: availableKwh,
        autonomyHours: autonomyHours,
        cycleCount: cycleCount,
        healthPercent: healthPercent,
        pvChargeKwh: pvChargeKwh,
        homeSupportKwh: homeSupportKwh,
        gridBufferKwh: gridBufferKwh
      };
    }

    const state = {
      range: "day",
      anchorDate: new Date()
    };

    function updateToolbar() {
      const anchorDate = state.anchorDate;
      let label = formatLongDate(anchorDate);

      if (state.range === "week") {
        label = formatWeekLabel(anchorDate);
      } else if (state.range === "month") {
        label = formatMonthLabel(anchorDate);
      } else if (state.range === "year") {
        label = formatYearLabel(anchorDate);
      }

      if (breadcrumbRangeEl) {
        breadcrumbRangeEl.textContent = formatRangeName(state.range);
      }

      if (rangeLabelEl) {
        rangeLabelEl.textContent = label;
      }

      rangeButtons.forEach(function (button) {
        const isActive = button.getAttribute("data-bank-range") === state.range;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }

    function shiftRange(step) {
      if (state.range === "week") {
        state.anchorDate = addDays(state.anchorDate, step * 7);
      } else if (state.range === "month") {
        state.anchorDate = addMonths(state.anchorDate, step);
      } else if (state.range === "year") {
        state.anchorDate = addYears(state.anchorDate, step);
      } else {
        state.anchorDate = addDays(state.anchorDate, step);
      }

      updateToolbar();
    }

    function applyPayload() {
      const payload = window.dashboardLatestPayload || {};
      const breakdown = getBreakdown(payload);

      setSocPill(socPillEl, breakdown.socPercent);
      const status = getStatusState(breakdown);

      setStatusPill(statusPillEl, status);
      setDialAngle(stageDialEl, breakdown.socPercent);
      setDialAngle(summaryDialEl, breakdown.socPercent);
      setPercent(stageSocValueEl, breakdown.socPercent, 0);
      setText(stageSocLabelEl, "Stan naładowania");
      setMetric(stageLevelValueEl, breakdown.levelKwh, "kWh", 1);
      setMetric(stageCapacityValueEl, breakdown.capacityKwh, "kWh", 1);
      setMetric(stageChargeValueEl, breakdown.chargeKw, "kW", 1);
      setMetric(stageDischargeValueEl, breakdown.dischargeKw, "kW", 1);
      setMetric(stageAutonomyValueEl, breakdown.autonomyHours, "h", 1);
      setMetric(stageReserveValueEl, breakdown.reserveKwh, "kWh", 1);
      setValueOnly(currentValueEl, breakdown.levelKwh, 1);
      setStatusBadge(statusBadgeEl, status);
      setValueOnly(chargeEnergyValueEl, breakdown.pvChargeKwh, 1);
      setValueOnly(chargePowerValueEl, breakdown.chargeKw, 1);

      if (statusDetailEl) {
        const socText = breakdown.socPercent == null ? "--" : formatDecimal(breakdown.socPercent, 0) + "%";
        statusDetailEl.textContent = "SOC: " + socText + " • Dostępne: " + formatMetricText(breakdown.availableKwh, "kWh", 1);
      }

      if (chargeEnergyDetailEl) {
        chargeEnergyDetailEl.textContent = "Rezerwa: " + formatMetricText(breakdown.reserveKwh, "kWh", 1);
      }

      if (chargePowerDetailEl) {
        chargePowerDetailEl.textContent = "Rozładowanie: " + formatMetricText(breakdown.dischargeKw, "kW", 1);
      }

      if (cycleCountValueEl) {
        cycleCountValueEl.textContent = breakdown.cycleCount == null ? "--" : formatDecimal(breakdown.cycleCount, 0);
      }

      setCycleSummary(cycleCountTotalEl, breakdown.cycleCount);
    }

    rangeButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        state.range = button.getAttribute("data-bank-range") || "day";
        updateToolbar();
      });
    });

    shiftButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        shiftRange(Number(button.getAttribute("data-bank-shift") || 0));
      });
    });

    document.addEventListener("dashboard:payload-updated", applyPayload);

    updateToolbar();
    applyPayload();
  }

  function initBankView() {
    const bankPage = document.getElementById("bank-detail");
    const breadcrumbRangeEl = document.getElementById("bank-breadcrumb-range");
    const rangeLabelEl = document.getElementById("bank-range-label");
    const chartEl = document.getElementById("bank-chart");
    const chartPlaceholderEl = document.getElementById("bank-chart-placeholder");
    const chartPlaceholderCaptionEl = document.getElementById("bank-chart-placeholder-caption");
    const sunMarkersEl = document.getElementById("bank-sun-markers");
    const socUnitPillEl = bankPage ? bankPage.querySelector(".bank-soc-unit-pill") : null;
    const currentStateValueEl = document.getElementById("bank-current-state-value");
    const currentMeterThumbEl = document.getElementById("bank-current-meter-thumb");
    const currentStatusEl = document.getElementById("bank-current-status");
    const storedEnergyValueEl = document.getElementById("bank-stored-energy-value");
    const dischargedEnergyValueEl = document.getElementById("bank-discharged-energy-value");
    const chargePvValueEl = document.getElementById("bank-charge-pv-value");
    const chargeGridValueEl = document.getElementById("bank-charge-grid-value");
    const dischargeLoadValueEl = document.getElementById("bank-discharge-load-value");
    const dischargeGridValueEl = document.getElementById("bank-discharge-grid-value");
    const flowDialEl = document.getElementById("bank-flow-dial");
    const currentDateButton = document.getElementById("bank-current-date");
    const currentTimeButton = document.getElementById("bank-current-time");
    const rangeButtons = Array.from(document.querySelectorAll("[data-bank-range]"));
    const shiftButtons = Array.from(document.querySelectorAll("[data-bank-shift]"));
    const zoomButtons = Array.from(document.querySelectorAll("[data-bank-chart-zoom]"));
    const zoomResetButton = document.querySelector("[data-bank-chart-zoom-reset='true']");
    const monthTitleFormatter = new Intl.DateTimeFormat("pl-PL", {
      month: "long",
      year: "numeric"
    });
    const yearMonthFormatter = new Intl.DateTimeFormat("pl-PL", {
      month: "short"
    });
    const BANK_CAPACITY_KWH = 10;
    const BANK_INITIAL_SOC_KWH = 10;
    const BANK_RESERVE_KWH = BANK_CAPACITY_KWH * 0.15;
    const BANK_SLOT_LIMIT_KWH = BANK_CAPACITY_KWH / 2;
    const BANK_DISCHARGE_EFFICIENCY = 0.99;
    const BANK_SECOND_SLOT_TARGET_WITH_GENERATION = 0.70;
    const BANK_DEFAULT_INSTALLED_POWER_KW = 5;
    const BANK_LIVE_PATH_MAX_AGE_SECONDS = 14;
    const BANK_LIVE_PATH_STATUS_SECONDS = [10, 20, 30, 40, 50];
    const BANK_LIVE_PATH_STATUS_TOLERANCE_SECONDS = 4;
    const BANK_DAYLIGHT_THRESHOLD_KWH = 0.01;
    const BANK_FLOW_COLORS = {
      chargePv: "#FEB633",
      chargeGrid: "#FC7C00",
      dischargeLoad: "#B0BBD5",
      dischargeGrid: "#009A44"
    };
    const BANK_RANGE_DEFAULT_WINDOW = { day: 24, week: 7, month: 14, year: 6 };
    const BANK_RANGE_MIN_WINDOW = { day: 7, week: 4, month: 7, year: 3 };
    const BANK_BAR_WIDTH = 40;
    const BANK_RANGE_BAR_WIDTH = 36;
    const BANK_BAR_RADIUS = 5;

    if (!bankPage) {
      return;
    }

    function numberOrNull(value) {
      if (value == null || value === "") {
        return null;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }

    function firstNumber() {
      for (let i = 0; i < arguments.length; i += 1) {
        const numeric = numberOrNull(arguments[i]);
        if (numeric != null) {
          return numeric;
        }
      }
      return null;
    }

    function firstText() {
      for (let i = 0; i < arguments.length; i += 1) {
        const value = arguments[i];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
      return "";
    }

    function escapeHtml(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function clamp(value, min, max) {
      if (value < min) {
        return min;
      }
      if (value > max) {
        return max;
      }
      return value;
    }

    function formatDecimal(value, digits) {
      return Number(value || 0).toFixed(digits == null ? 1 : digits).replace(".", ",");
    }

    function formatSignedDecimal(value, digits) {
      if (Math.abs(Number(value) || 0) < 0.0001) {
        return "0,00";
      }
      const prefix = value > 0 ? "+ " : "− ";
      return prefix + formatDecimal(Math.abs(value), digits == null ? 2 : digits);
    }

    function formatRangeName(range) {
      switch (range) {
        case "week":
          return "Tydzień";
        case "month":
          return "Miesiąc";
        case "year":
          return "Rok";
        default:
          return "Dzień";
      }
    }

    function addDays(date, days) {
      const next = new Date(date);
      next.setDate(next.getDate() + days);
      return next;
    }

    function addMonths(date, months) {
      const next = new Date(date);
      next.setMonth(next.getMonth() + months);
      return next;
    }

    function addYears(date, years) {
      const next = new Date(date);
      next.setFullYear(next.getFullYear() + years);
      return next;
    }

    function getStartOfWeek(date) {
      const next = new Date(date);
      const day = next.getDay();
      const shift = day === 0 ? -6 : 1 - day;
      next.setDate(next.getDate() + shift);
      return next;
    }

    function formatLongDate(date) {
      return capitalize(weekdayFormatter.format(date)) + " " + dateFormatter.format(date);
    }

    function formatWeekLabel(date) {
      const start = getStartOfWeek(date);
      const end = addDays(start, 6);
      return dateFormatter.format(start) + " - " + dateFormatter.format(end);
    }

    function formatMonthLabel(date) {
      return capitalize(monthTitleFormatter.format(date));
    }

    function formatYearLabel(date) {
      return String(date.getFullYear());
    }

    function setText(element, value) {
      if (element) {
        element.textContent = value == null || value === "" ? "--" : String(value);
      }
    }

    function setValueOnly(element, value, digits) {
      if (!element) {
        return;
      }
      if (value == null) {
        element.textContent = "--";
        return;
      }
      element.textContent = formatDecimal(value, digits == null ? 1 : digits);
    }

    function setCycles(element, value) {
      if (!element) {
        return;
      }
      if (value == null) {
        element.textContent = "--";
        return;
      }
      element.textContent = formatDecimal(value, 2);
    }

    function setSocPill(element, value) {
      if (!element) {
        return;
      }
      if (value == null) {
        element.innerHTML = "SOC: -- <span>%</span>";
        return;
      }
      element.innerHTML = "SOC: " + formatDecimal(value, 0) + " <span>%</span>";
    }

    function formatMetricText(value, unit, digits) {
      return value == null ? "--" : formatDecimal(value, digits == null ? 1 : digits) + " " + unit;
    }

    function setKwhValue(element, value, digits) {
      if (!element) {
        return;
      }
      element.textContent = value == null ? "--" : formatDecimal(value, digits == null ? 2 : digits);
    }

    function setFlowValue(element, value, total) {
      if (!element) {
        return;
      }
      if (value == null) {
        element.textContent = "--";
        return;
      }
      const percent = total > 0 ? (Math.max(value, 0) / total) * 100 : 0;
      element.textContent = formatDecimal(value, 2) + " kWh | " + formatDecimal(percent, 0) + "%";
    }

    function getStatusState(chargeKwh, dischargeKwh) {
      if (chargeKwh > 0.05 && chargeKwh >= dischargeKwh) {
        return { key: "charging", label: "ładowanie" };
      }
      if (dischargeKwh > 0.05) {
        return { key: "discharging", label: "rozładowanie" };
      }
      return { key: "idle", label: "czuwanie" };
    }

    function setStatusPill(element, status) {
      if (!element) {
        return;
      }
      element.textContent = "Status: " + status.label;
      element.setAttribute("data-state", status.key);
    }

    function setStatusBadge(element, status) {
      if (!element) {
        return;
      }
      element.textContent = status.label;
      element.setAttribute("data-state", status.key);
    }

    function setCycleSummary(element, value) {
      if (!element) {
        return;
      }
      element.textContent = value == null ? "-- / 8000" : formatDecimal(value, 0) + " / 8000";
    }

    function normalizeText(value) {
      if (typeof value !== "string") {
        return "";
      }
      return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
    }

    function formatDateKey(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return year + "-" + month + "-" + day;
    }

    function parseDateKey(value) {
      if (typeof value !== "string" || !value.trim()) {
        return null;
      }
      const parsed = new Date(value.trim() + "T00:00:00");
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function parseSqlDateTime(value) {
      if (typeof value !== "string" || !value.trim()) {
        return null;
      }
      const parsed = new Date(value.trim().replace(" ", "T"));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function getPayloadAnchorDate(payload) {
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const records = usageData && Array.isArray(usageData.records) ? usageData.records : [];
      const latestUsageDate = parseDateKey(firstText(
        usageData && usageData.latestDate,
        records.length ? records[records.length - 1].date : null
      ));
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const energyDate = parseSqlDateTime(firstText(
        rawEnergy.datetime,
        rawEnergy.reading_time,
        rawEnergy.timestamp,
        energy.datetime,
        energy.reading_time,
        energy.timestamp
      ));
      return latestUsageDate || energyDate || new Date();
    }

    function getRangeWindow(range, anchorDate) {
      if (range === "week") {
        const start = getStartOfWeek(anchorDate);
        return {
          start: start,
          end: addDays(start, 6),
          days: 7
        };
      }

      if (range === "month") {
        const start = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
        const end = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
        return {
          start: start,
          end: end,
          days: end.getDate()
        };
      }

      if (range === "year") {
        const start = new Date(anchorDate.getFullYear(), 0, 1);
        const end = new Date(anchorDate.getFullYear(), 11, 31);
        return {
          start: start,
          end: end,
          days: Math.round((end.getTime() - start.getTime()) / 86400000) + 1
        };
      }

      return {
        start: new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate()),
        end: new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate()),
        days: 1
      };
    }

    function inferMinuteFromLabel(label) {
      if (typeof label !== "string") {
        return null;
      }
      const match = label.match(/(\d{1,2}):(\d{2})/);
      return match ? clamp(Number(match[2]), 0, 59) : null;
    }

    function normalizeWeatherQuarterPoint(point, fallbackIndex) {
      const rawHour = firstNumber(point && point.hour, Math.floor(fallbackIndex / 4));
      const hour = clamp(Math.round(rawHour == null ? 0 : rawHour), 0, 23);
      const minute = clamp(Math.floor((firstNumber(
        point && point.minute,
        point && point.minuteOfHour,
        inferMinuteFromLabel(point && point.label)
      ) || 0) / 15) * 15, 0, 45);

      return {
        hour: hour,
        minute: minute,
        temperatureC: firstNumber(point && point.temperature_C, point && point.temperatureC),
        rainMm: firstNumber(point && point.rain_mm, point && point.rainMm),
        uvi: firstNumber(point && point.uvi),
        lightLux: firstNumber(point && point.light_lux, point && point.lightLux),
        isNight: Boolean(point && point.isNight) || hour < 5 || hour >= 20
      };
    }

    function createQuarterArray(factory) {
      return Array.from({ length: 96 }, function (_, index) {
        return factory(index);
      });
    }

    function buildQuarterWeatherSeries(rawPoints) {
      const normalizedPoints = (Array.isArray(rawPoints) ? rawPoints : [])
        .map(normalizeWeatherQuarterPoint)
        .filter(Boolean);

      if (!normalizedPoints.length) {
        return createQuarterArray(function () { return null; });
      }

      const shouldReplicateHourly = normalizedPoints.length <= 24 && normalizedPoints.every(function (point) {
        return point.minute === 0;
      });
      const buckets = createQuarterArray(function () {
        return {
          temperatureSum: 0,
          temperatureCount: 0,
          rainSum: 0,
          rainCount: 0,
          uviSum: 0,
          uviCount: 0,
          lightLuxSum: 0,
          lightLuxCount: 0,
          isNight: false,
          sampleCount: 0
        };
      });

      function applyPointToBucket(point, quarterIndex) {
        const bucket = buckets[(point.hour * 4) + quarterIndex];
        bucket.sampleCount += 1;
        bucket.isNight = point.isNight;
        if (point.temperatureC != null) {
          bucket.temperatureSum += point.temperatureC;
          bucket.temperatureCount += 1;
        }
        if (point.rainMm != null) {
          bucket.rainSum += point.rainMm;
          bucket.rainCount += 1;
        }
        if (point.uvi != null) {
          bucket.uviSum += point.uvi;
          bucket.uviCount += 1;
        }
        if (point.lightLux != null) {
          bucket.lightLuxSum += point.lightLux;
          bucket.lightLuxCount += 1;
        }
      }

      normalizedPoints.forEach(function (point) {
        if (shouldReplicateHourly) {
          for (let quarterIndex = 0; quarterIndex < 4; quarterIndex += 1) {
            applyPointToBucket(point, quarterIndex);
          }
          return;
        }
        applyPointToBucket(point, clamp(Math.floor(point.minute / 15), 0, 3));
      });

      return buckets.map(function (bucket, index) {
        if (!bucket.sampleCount) {
          return null;
        }
        return {
          hour: Math.floor(index / 4),
          quarter: index % 4,
          isNight: bucket.isNight,
          temperatureC: bucket.temperatureCount ? bucket.temperatureSum / bucket.temperatureCount : null,
          rainMm: bucket.rainCount ? bucket.rainSum / bucket.rainCount : null,
          uvi: bucket.uviCount ? bucket.uviSum / bucket.uviCount : null,
          lightLux: bucket.lightLuxCount ? bucket.lightLuxSum / bucket.lightLuxCount : null
        };
      });
    }

    function getSolarCurveRatio(hour, quarter) {
      const decimalHour = hour + (quarter * 0.25);
      if (decimalHour < 5 || decimalHour > 20) {
        return 0;
      }
      const phase = (decimalHour - 5) / 15;
      return Math.pow(Math.sin(Math.PI * clamp(phase, 0, 1)), 1.35);
    }

    function getQuarterProduction(sample, installedPowerKw) {
      if (!sample) {
        return { energyKwh: null, powerKw: null };
      }
      if (sample.isNight) {
        return { energyKwh: 0, powerKw: 0 };
      }

      const luxRatio = sample.lightLux == null ? null : clamp(sample.lightLux / PV_LIGHT_LUX_REFERENCE, 0, 1.15);
      const uviRatio = sample.uvi == null ? null : clamp(sample.uvi / PV_UVI_REFERENCE, 0, 1.15);
      let solarRatio = null;

      if (luxRatio != null && uviRatio != null) {
        solarRatio = clamp(Math.max(luxRatio, uviRatio * 0.96), 0, 1);
      } else if (luxRatio != null || uviRatio != null) {
        solarRatio = clamp(luxRatio != null ? luxRatio : uviRatio, 0, 1);
      } else {
        solarRatio = getSolarCurveRatio(sample.hour, sample.quarter) * 0.68;
      }

      const temperaturePenalty = sample.temperatureC != null && sample.temperatureC > 25
        ? clamp(1 - ((sample.temperatureC - 25) * 0.0045), 0.82, 1)
        : 1;
      const rainPenalty = sample.rainMm != null
        ? clamp(1 - (Math.min(sample.rainMm, 2.2) * 0.18), 0.45, 1)
        : 1;
      const powerKw = clamp(installedPowerKw * solarRatio * temperaturePenalty * rainPenalty, 0, installedPowerKw);

      return {
        powerKw: powerKw,
        energyKwh: powerKw * 0.25
      };
    }

    function resolveRcePriceForHour(rce, hour) {
      if (!rce || !Array.isArray(rce.hourlyRates)) {
        return null;
      }
      for (let index = 0; index < rce.hourlyRates.length; index += 1) {
        const entry = rce.hourlyRates[index];
        if (Number(entry && entry.hour) !== hour) {
          continue;
        }
        return firstNumber(entry && entry.pricePln, entry && entry.price, entry && entry.value);
      }
      return null;
    }

    function isEnergyActiveTariffLabel(label) {
      return normalizeText(label).indexOf("energia czynna") !== -1;
    }

    function isCapacityChargeTariffLabel(label) {
      return normalizeText(label).replace(/ł/g, "l").indexOf("oplata mocowa") !== -1;
    }

    function sumTariffVariableRowsForWindow(rows, windowCode, includeEnergyActive) {
      const normalizedWindowCode = normalizeText(windowCode || "all");

      return (rows || []).reduce(function (sum, row) {
        const rowWindowCode = normalizeText(row && row.window_code ? row.window_code : "all");
        if (normalizedWindowCode === "all") {
          if (rowWindowCode !== "all") {
            return sum;
          }
        } else if (rowWindowCode !== "all" && rowWindowCode !== normalizedWindowCode) {
          return sum;
        }

        const label = normalizeText(row && row.label);
        if (isCapacityChargeTariffLabel(label)) {
          return sum;
        }
        if (!includeEnergyActive && isEnergyActiveTariffLabel(label)) {
          return sum;
        }

        return sum + (Number(row && row.price) || 0);
      }, 0);
    }

    function resolveTariffWindowCodeForDateHour(tariff, dateKey, hour) {
      const zoneModel = normalizeText(tariff && tariff.zone_model ? tariff.zone_model : "all");
      if (!zoneModel || zoneModel === "all") {
        return "all";
      }

      const timestamp = new Date(dateKey + "T" + String(hour).padStart(2, "0") + ":00:00");
      if (!Number.isNaN(timestamp.getTime())) {
        const weekday = timestamp.getDay();
        const cheapSaturday = Boolean(tariff && tariff.cheap_saturday);
        const cheapSunday = Boolean(tariff && tariff.cheap_sunday);
        if ((weekday === 6 && cheapSaturday) || (weekday === 0 && cheapSunday)) {
          if (zoneModel === "daynight") {
            return "night";
          }
          if (zoneModel === "peakoffpeak") {
            return "offpeak";
          }
          if (zoneModel === "highmidlow") {
            return "low";
          }
        }
      }

      if (tariff && tariff.use_monthly && tariff.monthly) {
        const month = Number(String(dateKey || "").slice(5, 7));
        const row = tariff.monthly[String(month)] || tariff.monthly[month] || null;
        if (Array.isArray(row) && Object.prototype.hasOwnProperty.call(row, hour)) {
          const value = Number(row[hour]) || 2;
          if (zoneModel === "highmidlow") {
            return value === 1 ? "high" : (value === 3 ? "low" : "mid");
          }
          if (zoneModel === "daynight") {
            return value === 1 ? "night" : "day";
          }
          if (zoneModel === "peakoffpeak") {
            return value === 1 ? "offpeak" : "peak";
          }
        }
      }

      if (zoneModel === "daynight") {
        const nightHours = Array.isArray(tariff && tariff.dn_night) ? tariff.dn_night.map(Number) : [];
        return nightHours.indexOf(hour) !== -1 ? "night" : "day";
      }

      if (zoneModel === "peakoffpeak") {
        const offPeakHours = Array.isArray(tariff && tariff.po_off) ? tariff.po_off.map(Number) : [];
        return offPeakHours.indexOf(hour) !== -1 ? "offpeak" : "peak";
      }

      if (zoneModel === "highmidlow") {
        return "mid";
      }

      return "all";
    }

    function sumTariffRowsByMatcher(rows, windowCode, matcher) {
      const normalizedWindowCode = normalizeText(windowCode || "all");

      return (rows || []).reduce(function (sum, row) {
        const rowWindowCode = normalizeText(row && row.window_code ? row.window_code : "all");
        if (normalizedWindowCode === "all") {
          if (rowWindowCode !== "all") {
            return sum;
          }
        } else if (rowWindowCode !== "all" && rowWindowCode !== normalizedWindowCode) {
          return sum;
        }

        const label = normalizeText(row && row.label);
        if (typeof matcher === "function" && !matcher(label, row)) {
          return sum;
        }

        return sum + (Number(row && row.price) || 0);
      }, 0);
    }

    function resolveTariffEnergyPurchasePrice(tariff, dateKey, hour, rce) {
      if (!tariff) return null;
      const sellMethod = normalizeText(tariff.sell_method || "fixed");
      const rcePrice = sellMethod === "rdn" ? resolveRcePriceForHour(rce, hour) : undefined;
      if (sellMethod === "rdn" && rcePrice == null) return null;
      return ReTariffEngine.rates(tariff, dateKey, hour, rcePrice, capacityOptions).energy;
    }

    function resolveTariffPurchasePrice(tariff, dateKey, hour, rce) {
      if (!tariff) return null;
      const sellMethod = normalizeText(tariff.sell_method || "fixed");
      const rcePrice = sellMethod === "rdn" ? resolveRcePriceForHour(rce, hour) : undefined;
      if (sellMethod === "rdn" && rcePrice == null) return null;
      return ReTariffEngine.rates(tariff, dateKey, hour, rcePrice, capacityOptions).total;
    }

    function resolveTariffDistributionPrice(tariff, dateKey, hour, rce) {
      const totalPrice = resolveTariffPurchasePrice(tariff, dateKey, hour, rce, capacityOptions);
      const energyPrice = resolveTariffEnergyPurchasePrice(tariff, dateKey, hour, rce, capacityOptions);
      if (totalPrice == null || energyPrice == null) return null;
      return Math.max(totalPrice - energyPrice, 0);
    }

    function resolveTariffSalePrice(tariff, dateKey, hour, rce) {
      const rcePrice = resolveRcePriceForHour(rce, hour);
      if (rcePrice == null) {
        return null;
      }

      return getProsumerSalePricePln(rcePrice);
    }

    function buildHourlySourceForDay(record, weatherSeries, installedPowerKw) {
      const hourly = Array.from({ length: 24 }, function (_, hour) {
        return {
          hour: hour,
          demandKwh: 0,
          observedPvSelfKwh: 0,
          estimatedGenerationKwh: 0
        };
      });
      const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];

      quarters.forEach(function (quarter, index) {
        const hour = clamp(Math.round(firstNumber(quarter && quarter.hour, Math.floor(index / 4)) || 0), 0, 23);
        const grid = numberOrNull(quarter && quarter.grid) || 0;
        const storage = numberOrNull(quarter && quarter.storage) || 0;
        const pv = numberOrNull(quarter && quarter.pv) || 0;
        const totalDemand = grid + storage + pv;
        hourly[hour].demandKwh += totalDemand;
        hourly[hour].observedPvSelfKwh += pv;

        const weatherSample = weatherSeries && weatherSeries[index] ? weatherSeries[index] : null;
        const estimatedProduction = getQuarterProduction(weatherSample, installedPowerKw);
        const estimatedQuarterKwh = firstNumber(estimatedProduction && estimatedProduction.energyKwh, 0) || 0;
        hourly[hour].estimatedGenerationKwh += Math.max(pv, estimatedQuarterKwh);
      });

      return hourly.map(function (entry) {
        return {
          hour: entry.hour,
          demandKwh: entry.demandKwh,
          generationKwh: Math.max(entry.observedPvSelfKwh, entry.estimatedGenerationKwh),
          observedPvSelfKwh: entry.observedPvSelfKwh
        };
      });
    }

    function pickLowestBuyHours(hourEntries, rangeHours, count) {
      return hourEntries
        .filter(function (entry) {
          return rangeHours.indexOf(entry.hour) !== -1 && entry.totalBuyPricePln != null;
        })
        .slice()
        .sort(function (left, right) {
          return left.totalBuyPricePln - right.totalBuyPricePln;
        })
        .slice(0, count == null ? 2 : count)
        .map(function (entry) {
          return entry.hour;
        });
    }

    function pickHighestSellHours(hourEntries, rangeHours, count) {
      return hourEntries
        .filter(function (entry) {
          return rangeHours.indexOf(entry.hour) !== -1 && entry.sellPricePln != null;
        })
        .slice()
        .sort(function (left, right) {
          return right.sellPricePln - left.sellPricePln;
        })
        .slice(0, count == null ? 2 : count)
        .map(function (entry) {
          return entry.hour;
        });
    }

    function createZoneTotals() {
      return {
        all: 0,
        high: 0,
        mid: 0,
        low: 0
      };
    }

    function simulateBankDay(dateKey, hourlySource, simulationState, tariff, rce) {
      const CAPACITY_KWH = BANK_CAPACITY_KWH;
      const RESERVE_KWH = CAPACITY_KWH * 0.05;
      const CHUNK_KWH = CAPACITY_KWH / 2;
      const END_BUFFER_KWH = CAPACITY_KWH * 0.05;
      const HALF_DAY_ARBITRAGE_GAP = 0.05;
      const account = window.dashboardLatestPayload && window.dashboardLatestPayload.account || {};
      const settings = account.tariffSettings || {};
      const currentSettings = settings.current || {};
      const capacityOptions = {
        connectionPowerKw: firstNumber(currentSettings.contractPowerKw, settings.contractPowerKw, account.contractPowerKw),
        dayProfileKwh: hourlySource.map(function (entry) { return firstNumber(entry && entry.demandKwh, 0) || 0; })
      };
      const hourEntries = Array.from({ length: 24 }, function (_, hour) {
        const sourceEntry = hourlySource[hour] || {};
        return {
          hour: hour,
          dateKey: dateKey,
          demandKwh: firstNumber(sourceEntry.demandKwh, 0) || 0,
          generationKwh: firstNumber(sourceEntry.generationKwh, sourceEntry.observedPvSelfKwh, 0) || 0,
          observedPvSelfKwh: firstNumber(sourceEntry.observedPvSelfKwh, 0) || 0,
          windowCode: resolveTariffWindowCodeForDateHour(tariff, dateKey, hour),
          totalBuyPricePln: resolveTariffPurchasePrice(tariff, dateKey, hour, rce, capacityOptions),
          energyBuyPricePln: resolveTariffEnergyPurchasePrice(tariff, dateKey, hour, rce, capacityOptions),
          distributionBuyPricePln: resolveTariffDistributionPrice(tariff, dateKey, hour, rce, capacityOptions),
          sellPricePln: resolveTariffSalePrice(tariff, dateKey, hour, rce),
          rcePricePln: resolveRcePriceForHour(rce, hour)
        };
      });
      const A_BUY_RANGE = Array.from({ length: 8 }, function (_, index) { return index; });
      const A_SELL_RANGE = Array.from({ length: 7 }, function (_, index) { return index + 5; });
      const B_BUY_RANGE = Array.from({ length: 8 }, function (_, index) { return index + 12; });
      const B_SELL_RANGE = Array.from({ length: 8 }, function (_, index) { return index + 16; });
      const buySlotsA = pickLowestBuyHours(hourEntries, A_BUY_RANGE, 2);
      const buySlotsB = pickLowestBuyHours(hourEntries, B_BUY_RANGE, 2);
      const sellTopA = pickHighestSellHours(hourEntries, A_SELL_RANGE, 2);
      const sellTopB = pickHighestSellHours(hourEntries, B_SELL_RANGE, 2);
      const sellPairA = sellTopA.slice().sort(function (left, right) { return left - right; });
      const sellPairB = sellTopB.slice().sort(function (left, right) { return left - right; });
      const bestSellAEntry = sellTopA.length ? hourEntries[sellTopA[0]] : null;
      const bestSellBEntry = sellTopB.length ? hourEntries[sellTopB[0]] : null;
      const bestBuyAEntry = buySlotsA.length ? hourEntries[buySlotsA[0]] : null;
      const bestBuyBEntry = buySlotsB.length ? hourEntries[buySlotsB[0]] : null;
      const gapA = bestSellAEntry && bestBuyAEntry
        ? (Number(bestSellAEntry.sellPricePln || 0) - Number(bestBuyAEntry.totalBuyPricePln || 0))
        : -Infinity;
      const gapB = bestSellBEntry && bestBuyBEntry
        ? (Number(bestSellBEntry.sellPricePln || 0) - Number(bestBuyBEntry.totalBuyPricePln || 0))
        : -Infinity;
      const plan = {
        doBuyA: buySlotsA.length > 0 && sellTopA.length > 0 && gapA >= HALF_DAY_ARBITRAGE_GAP,
        doSellA: sellTopA.length > 0,
        doBuyB: buySlotsB.length > 0 && sellTopB.length > 0 && gapB >= HALF_DAY_ARBITRAGE_GAP,
        doSellB: sellTopB.length > 0,
        buySlotsA: buySlotsA,
        buySlotsB: buySlotsB,
        sellPairA: sellPairA,
        sellPairB: sellPairB,
        gapA: gapA,
        gapB: gapB
      };
      const remainingUse = Array(25).fill(0);
      const remainingGeneration = Array(25).fill(0);
      let index;
      let hour;
      for (index = 23; index >= 0; index -= 1) {
        remainingUse[index] = remainingUse[index + 1] + hourEntries[index].demandKwh;
        remainingGeneration[index] = remainingGeneration[index + 1] + hourEntries[index].generationKwh;
      }

      function sumUse(startHour, endHour) {
        let sum = 0;
        if (endHour < startHour) {
          return 0;
        }
        for (hour = startHour; hour <= endHour; hour += 1) {
          sum += hourEntries[hour].demandKwh;
        }
        return sum;
      }

      function sumGeneration(startHour, endHour) {
        let sum = 0;
        if (endHour < startHour) {
          return 0;
        }
        for (hour = startHour; hour <= endHour; hour += 1) {
          sum += hourEntries[hour].generationKwh;
        }
        return sum;
      }

      function needDeficit(startHour, endHour) {
        return Math.max(0, sumUse(startHour, endHour) - sumGeneration(startHour, endHour));
      }

      function nextGreater(values, threshold) {
        const candidates = values.filter(function (value) {
          return value > threshold;
        });
        return candidates.length ? Math.min.apply(null, candidates) : null;
      }

      function targetSocForBuyAt(hourIndex) {
        if (hourIndex <= 11) {
          return Math.max(0, CAPACITY_KWH - sumUse(hourIndex, 11));
        }

        const nextSellHour = nextGreater(plan.sellPairB || [], hourIndex);
        if (nextSellHour != null) {
          return Math.max(0, CAPACITY_KWH - sumUse(hourIndex, nextSellHour));
        }

        return Math.max(0, CAPACITY_KWH - sumUse(hourIndex, 23));
      }

      function minSocAfterSellAt(hourIndex) {
        const earlyMorningNeed = Math.max(0, sumUse(0, 6) - sumGeneration(0, 6));
        if (hourIndex <= 11) {
          if (plan.doBuyB && plan.buySlotsB.length) {
            const nextBuyHour = plan.buySlotsB[0];
            if (nextBuyHour > hourIndex) {
              return Math.max(RESERVE_KWH, needDeficit(hourIndex + 1, nextBuyHour) / BANK_DISCHARGE_EFFICIENCY);
            }
          }
          return Math.max(RESERVE_KWH, needDeficit(hourIndex + 1, 23) / BANK_DISCHARGE_EFFICIENCY);
        }

        return Math.max(
          RESERVE_KWH,
          (needDeficit(hourIndex + 1, 23) + (hourIndex >= 17 ? earlyMorningNeed : 0)) / BANK_DISCHARGE_EFFICIENCY
        );
      }

      const totals = {
        usageKwh: 0,
        generationKwh: 0,
        directPvKwh: 0,
        chargeFromPvKwh: 0,
        topupKwh: 0,
        dischargeKwh: 0,
        exportKwh: 0,
        soldImmediateKwh: 0,
        soldImmediatePln: 0,
        soldBankKwh: 0,
        soldBankPln: 0,
        gridPurchaseKwh: 0,
        gridPurchaseForLoadKwh: 0,
        gridTopupKwh: 0,
        nominalVariableCostPln: 0,
        cashCostPln: 0,
        topupCashCostPln: 0,
        depositUsedPln: 0,
        depositEarnedPln: 0,
        buyOwnKwh: 0,
        buyOwnCashPln: 0,
        buyOwnFromDepositPln: 0,
        buyOwnNominalPln: 0,
        buyBankKwh: 0,
        buyBankCashPln: 0,
        buyBankFromDepositPln: 0,
        buyBankNominalPln: 0,
        dischargeByZone: createZoneTotals()
      };
      let socKwh = clamp(firstNumber(simulationState && simulationState.socKwh, 0) || 0, 0, CAPACITY_KWH);
      let depositPln = Math.max(0, firstNumber(simulationState && simulationState.depositPln, 0) || 0);
      let cycleCount = Math.max(0, firstNumber(simulationState && simulationState.cycleCount, 0) || 0);
      let greenGeneratedKwh = Math.max(0, firstNumber(simulationState && simulationState.greenGeneratedKwh, 0) || 0);
      let greenSoldKwh = Math.max(0, firstNumber(simulationState && simulationState.greenSoldKwh, 0) || 0);

      function remainingGreenQuotaKwh() {
        return Math.max(0, greenGeneratedKwh - greenSoldKwh);
      }

      function registerSale(kwh) {
        greenSoldKwh += Math.max(0, kwh || 0);
      }

      function payWithDeposit(quantityKwh, hourEntry) {
        const energyCostPln = Math.max(0, quantityKwh * (Number(hourEntry.energyBuyPricePln) || 0));
        const distributionCostPln = Math.max(0, quantityKwh * (Number(hourEntry.distributionBuyPricePln) || 0));
        const nominalCostPln = Math.max(0, quantityKwh * (Number(hourEntry.totalBuyPricePln) || 0));
        const usedDepositPln = Math.min(depositPln, energyCostPln);
        depositPln -= usedDepositPln;
        const energyCashPln = energyCostPln - usedDepositPln;
        const cashCostPln = energyCashPln + distributionCostPln;

        totals.nominalVariableCostPln += nominalCostPln;
        totals.cashCostPln += cashCostPln;
        totals.depositUsedPln += usedDepositPln;

        return {
          energyCostPln: energyCostPln,
          distributionCostPln: distributionCostPln,
          nominalCostPln: nominalCostPln,
          usedDepositPln: usedDepositPln,
          cashCostPln: cashCostPln
        };
      }

      const hours = [];
      for (index = 0; index < hourEntries.length; index += 1) {
        const entry = hourEntries[index];
        const hourData = {
          hour: entry.hour,
          dateKey: dateKey,
          windowCode: entry.windowCode,
          totalBuyPricePln: entry.totalBuyPricePln,
          energyBuyPricePln: entry.energyBuyPricePln,
          distributionBuyPricePln: entry.distributionBuyPricePln,
          sellPricePln: entry.sellPricePln,
          demandKwh: entry.demandKwh,
          generationKwh: entry.generationKwh,
          directPvKwh: 0,
          chargeFromPvKwh: 0,
          topupKwh: 0,
          dischargeKwh: 0,
          soldImmediateKwh: 0,
          soldBankKwh: 0,
          gridPurchaseForLoadKwh: 0,
          gridTopupKwh: 0,
          gridPurchaseKwh: 0,
          nominalCostPln: 0,
          cashCostPln: 0,
          depositUsedPln: 0,
          depositEarnedPln: 0,
          exportKwh: 0,
          startSocKwh: socKwh,
          endSocKwh: socKwh,
          startDepositPln: depositPln,
          endDepositPln: depositPln,
          socPercent: (socKwh / CAPACITY_KWH) * 100,
          cycleCount: cycleCount
        };
        let needKwh = entry.demandKwh;
        let surplusKwh = 0;

        totals.usageKwh += entry.demandKwh;
        totals.generationKwh += entry.generationKwh;
        greenGeneratedKwh += entry.generationKwh;

        hourData.directPvKwh = Math.min(needKwh, entry.generationKwh);
        needKwh -= hourData.directPvKwh;
        surplusKwh = Math.max(entry.generationKwh - hourData.directPvKwh, 0);
        totals.directPvKwh += hourData.directPvKwh;

        if (surplusKwh > 0) {
          const freeSpaceKwh = Math.max(0, CAPACITY_KWH - socKwh);
          const chargeFromPvKwh = Math.min(freeSpaceKwh, surplusKwh);
          if (chargeFromPvKwh > 0) {
            socKwh += chargeFromPvKwh;
            surplusKwh -= chargeFromPvKwh;
            hourData.chargeFromPvKwh = chargeFromPvKwh;
            totals.chargeFromPvKwh += chargeFromPvKwh;
          }
        }

        if (surplusKwh > 0 && entry.sellPricePln != null) {
          const sellableKwh = Math.min(surplusKwh, remainingGreenQuotaKwh());
          if (sellableKwh > 0) {
            const earnedPln = sellableKwh * entry.sellPricePln;
            depositPln += earnedPln;
            registerSale(sellableKwh);
            hourData.soldImmediateKwh = sellableKwh;
            hourData.depositEarnedPln += earnedPln;
            totals.soldImmediateKwh += sellableKwh;
            totals.soldImmediatePln += earnedPln;
            totals.depositEarnedPln += earnedPln;
            surplusKwh -= sellableKwh;
          }
        }

        if (needKwh > 0 && socKwh > 0) {
          const dischargeKwh = Math.min(needKwh, socKwh * BANK_DISCHARGE_EFFICIENCY);
          if (dischargeKwh > 0) {
            const withdrawnKwh = dischargeKwh / BANK_DISCHARGE_EFFICIENCY;
            socKwh = Math.max(0, socKwh - withdrawnKwh);
            needKwh -= dischargeKwh;
            cycleCount += withdrawnKwh / CAPACITY_KWH;
            hourData.dischargeKwh = dischargeKwh;
            totals.dischargeKwh += dischargeKwh;
            totals.dischargeByZone.all += dischargeKwh;
            if (Object.prototype.hasOwnProperty.call(totals.dischargeByZone, entry.windowCode)) {
              totals.dischargeByZone[entry.windowCode] += dischargeKwh;
            }
          }
        }

        const inSellA = plan.doSellA && (entry.hour === plan.sellPairA[0] || entry.hour === plan.sellPairA[1]);
        const inSellB = plan.doSellB && (entry.hour === plan.sellPairB[0] || entry.hour === plan.sellPairB[1]);
        if ((inSellA || inSellB) && entry.sellPricePln != null && socKwh > 0) {
          const sellPair = inSellA ? plan.sellPairA : plan.sellPairB;
          const earlierHour = sellPair[0];
          const laterHour = sellPair.length > 1 ? sellPair[1] : sellPair[0];
          const isEarlierHour = entry.hour === earlierHour;
          const earlierPricePln = firstNumber(hourEntries[earlierHour] && hourEntries[earlierHour].sellPricePln, entry.sellPricePln) || 0;
          const laterPricePln = firstNumber(hourEntries[laterHour] && hourEntries[laterHour].sellPricePln, entry.sellPricePln) || 0;
          const minimumSocKwh = minSocAfterSellAt(entry.hour);
          const availableForSaleKwh = Math.max(0, (socKwh - minimumSocKwh) * BANK_DISCHARGE_EFFICIENCY);
          let sellFromBankKwh = 0;

          if (isEarlierHour && laterHour !== earlierHour && laterPricePln > earlierPricePln) {
            const needUntilLaterKwh = needDeficit(entry.hour + 1, laterHour);
            const laterMinimumSocKwh = minSocAfterSellAt(laterHour);
            const requiredSocBeforeLaterKwh = (needUntilLaterKwh / BANK_DISCHARGE_EFFICIENCY) +
              (laterMinimumSocKwh + (CHUNK_KWH / BANK_DISCHARGE_EFFICIENCY));
            sellFromBankKwh = Math.min(
              CHUNK_KWH,
              availableForSaleKwh,
              Math.max(0, (socKwh - requiredSocBeforeLaterKwh) * BANK_DISCHARGE_EFFICIENCY)
            );
          } else {
            sellFromBankKwh = Math.min(CHUNK_KWH, availableForSaleKwh);
          }

          sellFromBankKwh = Math.min(sellFromBankKwh, remainingGreenQuotaKwh());
          if (sellFromBankKwh > 0) {
            const withdrawnKwh = sellFromBankKwh / BANK_DISCHARGE_EFFICIENCY;
            const earnedPln = sellFromBankKwh * entry.sellPricePln;
            socKwh = Math.max(0, socKwh - withdrawnKwh);
            depositPln += earnedPln;
            cycleCount += withdrawnKwh / CAPACITY_KWH;
            registerSale(sellFromBankKwh);
            hourData.soldBankKwh = sellFromBankKwh;
            hourData.depositEarnedPln += earnedPln;
            totals.soldBankKwh += sellFromBankKwh;
            totals.soldBankPln += earnedPln;
            totals.depositEarnedPln += earnedPln;
          }
        }

        if (needKwh > 0) {
          const purchaseForLoadKwh = needKwh;
          const payment = payWithDeposit(purchaseForLoadKwh, entry);
          hourData.gridPurchaseForLoadKwh = purchaseForLoadKwh;
          hourData.gridPurchaseKwh += purchaseForLoadKwh;
          hourData.nominalCostPln += payment.nominalCostPln;
          hourData.cashCostPln += payment.cashCostPln;
          hourData.depositUsedPln += payment.usedDepositPln;
          totals.gridPurchaseKwh += purchaseForLoadKwh;
          totals.gridPurchaseForLoadKwh += purchaseForLoadKwh;
          totals.buyOwnKwh += purchaseForLoadKwh;
          totals.buyOwnCashPln += payment.cashCostPln;
          totals.buyOwnFromDepositPln += payment.usedDepositPln;
          totals.buyOwnNominalPln += payment.nominalCostPln;
          needKwh = 0;
        }

        if (entry.hour === 1 && !plan.doBuyA && plan.buySlotsB.length && entry.totalBuyPricePln != null) {
          const nextBuyHour = plan.buySlotsB[0];
          const remainingNeedKwh = Math.max(0, needDeficit(entry.hour + 1, nextBuyHour) - (socKwh * BANK_DISCHARGE_EFFICIENCY));
          const emergencyTopupKwh = Math.min(
            CHUNK_KWH,
            Math.max(0, remainingNeedKwh / BANK_DISCHARGE_EFFICIENCY),
            Math.max(0, CAPACITY_KWH - socKwh)
          );
          if (emergencyTopupKwh > 0) {
            const emergencyPayment = payWithDeposit(emergencyTopupKwh, entry);
            socKwh += emergencyTopupKwh;
            hourData.topupKwh += emergencyTopupKwh;
            hourData.gridTopupKwh += emergencyTopupKwh;
            hourData.gridPurchaseKwh += emergencyTopupKwh;
            hourData.nominalCostPln += emergencyPayment.nominalCostPln;
            hourData.cashCostPln += emergencyPayment.cashCostPln;
            hourData.depositUsedPln += emergencyPayment.usedDepositPln;
            totals.topupKwh += emergencyTopupKwh;
            totals.gridPurchaseKwh += emergencyTopupKwh;
            totals.gridTopupKwh += emergencyTopupKwh;
            totals.buyBankKwh += emergencyTopupKwh;
            totals.buyBankCashPln += emergencyPayment.cashCostPln;
            totals.buyBankFromDepositPln += emergencyPayment.usedDepositPln;
            totals.buyBankNominalPln += emergencyPayment.nominalCostPln;
            totals.topupCashCostPln += emergencyPayment.cashCostPln;
          }
        }

        const inMorningBuy = plan.doBuyA && plan.buySlotsA.indexOf(entry.hour) !== -1;
        const inEveningBuy = plan.doBuyB && plan.buySlotsB.indexOf(entry.hour) !== -1;
        if ((inMorningBuy || inEveningBuy) && entry.totalBuyPricePln != null && entry.hour < 21) {
          let targetTopupKwh = 0;
          if (inEveningBuy) {
            const nextSellHour = nextGreater(plan.sellPairB || [], entry.hour);
            if (nextSellHour != null) {
              const desiredSocAtSellKwh = Math.max(0, CAPACITY_KWH - END_BUFFER_KWH);
              const useToSellKwh = sumUse(entry.hour, nextSellHour);
              const generationToSellKwh = sumGeneration(entry.hour, nextSellHour);
              targetTopupKwh = Math.min(
                CHUNK_KWH,
                Math.max(0, CAPACITY_KWH - socKwh),
                Math.max(0, desiredSocAtSellKwh - socKwh - generationToSellKwh + useToSellKwh)
              );
            } else {
              targetTopupKwh = Math.min(CHUNK_KWH, Math.max(0, targetSocForBuyAt(entry.hour) - socKwh));
            }
          } else {
            targetTopupKwh = Math.min(CHUNK_KWH, Math.max(0, targetSocForBuyAt(entry.hour) - socKwh));
          }

          if (targetTopupKwh > 0) {
            const topupPayment = payWithDeposit(targetTopupKwh, entry);
            socKwh += targetTopupKwh;
            hourData.topupKwh += targetTopupKwh;
            hourData.gridTopupKwh += targetTopupKwh;
            hourData.gridPurchaseKwh += targetTopupKwh;
            hourData.nominalCostPln += topupPayment.nominalCostPln;
            hourData.cashCostPln += topupPayment.cashCostPln;
            hourData.depositUsedPln += topupPayment.usedDepositPln;
            totals.topupKwh += targetTopupKwh;
            totals.gridPurchaseKwh += targetTopupKwh;
            totals.gridTopupKwh += targetTopupKwh;
            totals.buyBankKwh += targetTopupKwh;
            totals.buyBankCashPln += topupPayment.cashCostPln;
            totals.buyBankFromDepositPln += topupPayment.usedDepositPln;
            totals.buyBankNominalPln += topupPayment.nominalCostPln;
            totals.topupCashCostPln += topupPayment.cashCostPln;
          }
        }

        hourData.exportKwh = hourData.soldImmediateKwh + hourData.soldBankKwh;
        hourData.endSocKwh = socKwh;
        hourData.endDepositPln = depositPln;
        hourData.socPercent = (socKwh / CAPACITY_KWH) * 100;
        hourData.cycleCount = cycleCount;
        totals.exportKwh += hourData.exportKwh;
        hours.push(hourData);
      }

      return {
        dateKey: dateKey,
        startSocKwh: firstNumber(hours[0] && hours[0].startSocKwh, simulationState && simulationState.socKwh, 0) || 0,
        endSocKwh: socKwh,
        startSocPercent: ((firstNumber(hours[0] && hours[0].startSocKwh, simulationState && simulationState.socKwh, 0) || 0) / CAPACITY_KWH) * 100,
        endSocPercent: (socKwh / CAPACITY_KWH) * 100,
        startDepositPln: firstNumber(hours[0] && hours[0].startDepositPln, simulationState && simulationState.depositPln, 0) || 0,
        endDepositPln: depositPln,
        greenGeneratedKwhEnd: greenGeneratedKwh,
        greenSoldKwhEnd: greenSoldKwh,
        hours: hours,
        totals: totals,
        cycleCountEnd: cycleCount,
        plan: plan,
        stateOut: {
          socKwh: socKwh,
          depositPln: depositPln,
          cycleCount: cycleCount,
          greenGeneratedKwh: greenGeneratedKwh,
          greenSoldKwh: greenSoldKwh
        }
      };
    }

    function buildBankTimelineContext(payload) {
      if (!window.DashboardProsumerEngine || typeof window.DashboardProsumerEngine.runTimeline !== "function") {
        return null;
      }

      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const tariffData = payload && payload.tariffData ? payload.tariffData : null;
      const tariff = tariffData && (tariffData.next || tariffData.current) ? (tariffData.next || tariffData.current) : null;
      const historyStartKey = getDashboardHistoryStartKey(payload);
      const depositStartPln = getDashboardDepositStartPln(payload);
      const installedPowerKw = firstNumber(
        rawEnergy.installedPowerKw,
        rawEnergy.installationPowerKw,
        rawEnergy.mocInstalacjiKw,
        energy.installedPowerKw,
        BANK_DEFAULT_INSTALLED_POWER_KW
      );
      const account = payload && payload.account ? payload.account : {};
      const stationKey = firstTextValue(
        account.stationHash,
        account.station_hash,
        account.station,
        rawEnergy.station,
        new URLSearchParams(window.location.search).get("station")
      );
      return {
        historyStartKey: historyStartKey,
        tariff: tariff,
        context: {
          cacheKey: "bank:" + stationKey + ":" + (window.DashboardPricing ? window.DashboardPricing.cacheKey : "legacy"),
          payload: payload,
          dayStart: {
            socKwh: BANK_INITIAL_SOC_KWH,
            depositPln: depositStartPln,
            cycleCount: 0
          },
          battery: {
            capacityKwh: BANK_CAPACITY_KWH,
            reserveKwh: BANK_RESERVE_KWH,
            maxChargePerSlotKwh: BANK_SLOT_LIMIT_KWH * 0.25,
            maxDischargePerSlotKwh: BANK_SLOT_LIMIT_KWH * 0.25,
            chargeEfficiency: BANK_DISCHARGE_EFFICIENCY,
            dischargeEfficiency: BANK_DISCHARGE_EFFICIENCY
          },
          tariff: tariff,
          options: {
            simulationStartKey: historyStartKey,
            depositStartKey: historyStartKey,
            depositInitialPln: depositStartPln,
            initialDepositPln: depositStartPln,
            installedPowerKw: installedPowerKw,
            batteryCapacityKwh: BANK_CAPACITY_KWH,
            initialSocKwh: BANK_INITIAL_SOC_KWH,
            reserveSocRatio: BANK_RESERVE_KWH / BANK_CAPACITY_KWH
          }
        }
      };
    }

    function finalizeBankSimulation(simulation, timeline) {
      if (!simulation) {
        return null;
      }

      simulation.capacityKwh = BANK_CAPACITY_KWH;
      simulation.reserveKwh = BANK_RESERVE_KWH;
      simulation.initialDateKey = timeline.historyStartKey || (simulation.days && simulation.days.length ? simulation.days[0].dateKey : "");
      simulation.initialSocKwh = BANK_INITIAL_SOC_KWH;
      simulation.latestDepositPln = simulation.days && simulation.days.length
        ? simulation.days[simulation.days.length - 1].endDepositPln
        : 0;
      simulation.tariff = timeline.tariff;
      return simulation;
    }

    function buildBankSimulation(payload) {
      const timeline = buildBankTimelineContext(payload);
      if (!timeline) {
        return null;
      }

      return finalizeBankSimulation(
        window.DashboardProsumerEngine.runTimeline(timeline.context),
        timeline
      );
    }

    function getChargeFromPvKwh(source) {
      return Math.max(0, firstNumber(
        source && source.chargeFromPvKwh,
        source && source.pvToBank,
        source && source.pvToBankKwh,
        source && source.storageChargeFromPvKwh,
        0
      ) || 0);
    }

    function getChargeFromGridKwh(source) {
      return Math.max(0, firstNumber(
        source && source.topupKwh,
        source && source.gridBuyBank,
        source && source.gridBuyBankKwh,
        source && source.gridTopupKwh,
        source && source.chargeFromGridKwh,
        0
      ) || 0);
    }

    function getDischargeToGridKwh(source) {
      return Math.max(0, firstNumber(
        source && source.bankToSell,
        source && source.bankToSellKwh,
        source && source.bankToGridKwh,
        source && source.storageToGridKwh,
        source && source.batteryToGridKwh,
        source && source.soldBankKwh,
        source && source.exportBankKwh,
        source && source.dischargeToGridKwh,
        0
      ) || 0);
    }

    function getDischargeToLoadKwh(source) {
      const explicit = firstNumber(
        source && source.bankToLoad,
        source && source.bankToLoadKwh,
        source && source.dischargeToLoadKwh
      );
      if (explicit != null) {
        return Math.max(0, explicit);
      }

      const totalDischarge = Math.max(0, firstNumber(
        source && source.dischargeKwh,
        source && source.storageDischargeKwh,
        source && source.batteryDischargeKwh,
        0
      ) || 0);
      const hasSeparateGridDischarge = firstNumber(
        source && source.bankToSell,
        source && source.bankToSellKwh,
        source && source.bankToGridKwh,
        source && source.storageToGridKwh,
        source && source.batteryToGridKwh,
        source && source.soldBankKwh,
        source && source.exportBankKwh,
        source && source.dischargeToGridKwh
      ) != null;

      return hasSeparateGridDischarge ? Math.max(totalDischarge - getDischargeToGridKwh(source), 0) : totalDischarge;
    }

    function createBankChartItem(base, source) {
      const chargeFromPvKwh = getChargeFromPvKwh(source);
      const topupKwh = getChargeFromGridKwh(source);
      const dischargeToLoadKwh = getDischargeToLoadKwh(source);
      const dischargeToGridKwh = getDischargeToGridKwh(source);

      return Object.assign({}, base, {
        chargeFromPvKwh: chargeFromPvKwh,
        topupKwh: topupKwh,
        dischargeToLoadKwh: dischargeToLoadKwh,
        dischargeToGridKwh: dischargeToGridKwh,
        dischargeKwh: dischargeToLoadKwh + dischargeToGridKwh,
        isForecast: !!(base && base.isForecast || source && source.isForecast)
      });
    }

    function buildRangeItems(simulation, range, anchorDate) {
      if (!simulation) {
        return [];
      }

      const rangeWindow = getRangeWindow(range, anchorDate);
      const startKey = formatDateKey(rangeWindow.start);
      const endKey = formatDateKey(rangeWindow.end);

      if (range === "day") {
        const selectedDay = simulation.dayMap[startKey];
        if (!selectedDay) {
          return [];
        }

        return selectedDay.hours.map(function (hourEntry) {
        return createBankChartItem({
          key: selectedDay.dateKey + "-" + String(hourEntry.hour).padStart(2, "0"),
          label: String(hourEntry.hour).padStart(2, "0"),
          socPercent: hourEntry.socPercent,
          isForecast: !!(selectedDay.isForecast || hourEntry.isForecast),
          reference: hourEntry
        }, hourEntry);
      });
      }

      if (range === "year") {
        const monthMap = new Map();
        for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
          const monthDate = new Date(rangeWindow.start.getFullYear(), monthIndex, 1);
          const monthKey = String(monthDate.getFullYear()) + "-" + String(monthIndex + 1).padStart(2, "0");
          monthMap.set(monthKey, {
            key: monthKey,
            label: capitalize(yearMonthFormatter.format(monthDate)).replace(".", ""),
            chargeFromPvKwh: 0,
            topupKwh: 0,
            dischargeToLoadKwh: 0,
            dischargeToGridKwh: 0,
            dischargeKwh: 0,
            socPercent: null,
            isForecast: false,
            reference: null
          });
        }

        simulation.days.forEach(function (day) {
          if (day.dateKey < startKey || day.dateKey > endKey) {
            return;
          }

          const monthKey = day.dateKey.slice(0, 7);
          const bucket = monthMap.get(monthKey);
          if (!bucket) {
            return;
          }
          bucket.chargeFromPvKwh += getChargeFromPvKwh(day.totals);
          bucket.topupKwh += getChargeFromGridKwh(day.totals);
          bucket.dischargeToLoadKwh += getDischargeToLoadKwh(day.totals);
          bucket.dischargeToGridKwh += getDischargeToGridKwh(day.totals);
          bucket.dischargeKwh = bucket.dischargeToLoadKwh + bucket.dischargeToGridKwh;
          bucket.socPercent = day.endSocPercent;
          bucket.isForecast = bucket.isForecast || !!(simulation.isForecast || day.isForecast);
          bucket.reference = day;
        });

        return Array.from(monthMap.values());
      }

      const dayMap = simulation.dayMap || {};
      const items = [];
      for (let currentDate = new Date(rangeWindow.start); currentDate.getTime() <= rangeWindow.end.getTime(); currentDate = addDays(currentDate, 1)) {
        const dateKey = formatDateKey(currentDate);
        const day = dayMap[dateKey];
        const label = range === "week"
          ? String(currentDate.getDate()).padStart(2, "0") + "." + String(currentDate.getMonth() + 1).padStart(2, "0")
          : String(currentDate.getDate()).padStart(2, "0");

        items.push(createBankChartItem({
          key: dateKey,
          label: label,
          socPercent: day ? day.endSocPercent : null,
          isForecast: !!(simulation && simulation.isForecast || day && day.isForecast),
          reference: day || null
        }, day ? day.totals : null));
      }

      return items;
    }

    function buildMeasuredRangeItems(payload, range, anchorDate) {
      const storageData = payload && payload.storageData ? payload.storageData : null;
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const records = storageData && Array.isArray(storageData.records) ? storageData.records : [];
      const usageRecords = usageData && Array.isArray(usageData.records) ? usageData.records : [];
      if (!records.length) {
        return [];
      }

      const recordMap = new Map(records
        .filter(function (record) {
          return record && typeof record.date === "string" && Array.isArray(record.quarters);
        })
        .map(function (record) {
          return [record.date, record];
        }));
      const usageRecordMap = new Map(usageRecords
        .filter(function (record) {
          return record && typeof record.date === "string" && Array.isArray(record.quarters);
        })
        .map(function (record) {
          return [record.date, record];
        }));
      const rangeWindow = getRangeWindow(range, anchorDate);
      const startKey = formatDateKey(rangeWindow.start);
      const endKey = formatDateKey(rangeWindow.end);

      function createMeasuredItem(key, label) {
        return {
          key: key,
          label: label,
          chargeFromPvKwh: 0,
          topupKwh: 0,
          dischargeToLoadKwh: 0,
          dischargeToGridKwh: 0,
          dischargeKwh: 0,
          socPercent: null,
          reference: null
        };
      }

      function findUsageQuarter(storageRecord, quarter, index) {
        const dateKey = storageRecord && storageRecord.date ? String(storageRecord.date) : "";
        const usageRecord = dateKey ? usageRecordMap.get(dateKey) : null;
        const usageQuarters = usageRecord && Array.isArray(usageRecord.quarters) ? usageRecord.quarters : [];
        if (!usageQuarters.length) {
          return null;
        }

        if (usageQuarters[index]) {
          return usageQuarters[index];
        }

        const slotIndex = firstNumber(quarter && quarter.slotIndex);
        if (slotIndex != null) {
          const bySlot = usageQuarters.find(function (usageQuarter) {
            return firstNumber(usageQuarter && usageQuarter.slotIndex) === slotIndex;
          });
          if (bySlot) {
            return bySlot;
          }
        }

        const label = firstText(quarter && quarter.label);
        return label
          ? usageQuarters.find(function (usageQuarter) {
            return firstText(usageQuarter && usageQuarter.label) === label;
          }) || null
          : null;
      }

      function getMeasuredChargeSourceSplit(chargeKwh, usageQuarter) {
        if (!(chargeKwh > 0) || !usageQuarter) {
          return null;
        }

        const pvGenerationKwh = firstNumber(
          usageQuarter && usageQuarter.pvGenerationKwh,
          usageQuarter && usageQuarter.productionKwh
        );
        const loadKwh = firstNumber(
          usageQuarter && usageQuarter.totalLoadKwh,
          usageQuarter && usageQuarter.load
        );
        let pvToLoadKwh = firstNumber(
          usageQuarter && usageQuarter.pv,
          usageQuarter && usageQuarter.pvToLoadKwh
        );

        if (pvToLoadKwh == null && pvGenerationKwh != null && loadKwh != null) {
          pvToLoadKwh = Math.min(Math.max(0, pvGenerationKwh), Math.max(0, loadKwh));
        }

        if (pvGenerationKwh != null && pvToLoadKwh != null) {
          const pvSurplusKwh = Math.max(0, pvGenerationKwh - Math.max(0, pvToLoadKwh));
          const chargeFromPvKwh = Math.min(chargeKwh, pvSurplusKwh);
          return {
            chargeFromPvKwh: chargeFromPvKwh,
            chargeFromGridKwh: Math.max(0, chargeKwh - chargeFromPvKwh)
          };
        }

        const gridImportKwh = firstNumber(
          usageQuarter && usageQuarter.gridImportKwh,
          usageQuarter && usageQuarter.importKwh
        );
        const gridNetKwh = firstNumber(usageQuarter && usageQuarter.gridNetKwh);
        if ((gridImportKwh != null && gridImportKwh > 0) || (gridNetKwh != null && gridNetKwh > 0)) {
          return {
            chargeFromPvKwh: 0,
            chargeFromGridKwh: chargeKwh
          };
        }

        return null;
      }

      function updateMeasuredItem(bucket, quarter, usageQuarter) {
        const chargeKwh = Math.max(0, firstNumber(quarter && quarter.chargeKwh, quarter && quarter.storageChargeKwh, 0) || 0);
        const explicitChargeFromGridKwh = firstNumber(
          quarter && quarter.gridChargeKwh,
          quarter && quarter.chargeFromGridKwh,
          quarter && quarter.gridToBankKwh,
          quarter && quarter.topupKwh
        );
        const explicitChargeFromPvKwh = firstNumber(
          quarter && quarter.chargeFromPvKwh,
          quarter && quarter.pvToBankKwh,
          quarter && quarter.storageChargeFromPvKwh
        );
        const measuredChargeSourceSplit = explicitChargeFromGridKwh == null && explicitChargeFromPvKwh == null
          ? getMeasuredChargeSourceSplit(chargeKwh, usageQuarter)
          : null;
        const chargeFromGridKwh = Math.max(0, firstNumber(
          explicitChargeFromGridKwh,
          measuredChargeSourceSplit && measuredChargeSourceSplit.chargeFromGridKwh,
          0
        ) || 0);
        const chargeFromPvKwh = Math.max(0, firstNumber(
          explicitChargeFromPvKwh,
          measuredChargeSourceSplit && measuredChargeSourceSplit.chargeFromPvKwh,
          0
        ) || 0);
        const totalDischargeKwh = Math.max(0, firstNumber(
          quarter && quarter.dischargeKwh,
          quarter && quarter.storageDischargeKwh,
          quarter && quarter.batteryDischargeKwh,
          usageQuarter && usageQuarter.storageDischargeKwh,
          0
        ) || 0);
        const explicitGridDischarge = firstNumber(
          quarter && quarter.dischargeToGridKwh,
          quarter && quarter.bankToSellKwh,
          quarter && quarter.bankToGridKwh,
          quarter && quarter.storageToGridKwh,
          quarter && quarter.batteryToGridKwh,
          quarter && quarter.soldBankKwh,
          quarter && quarter.exportBankKwh
        );
        const explicitLoadDischarge = firstNumber(
          quarter && quarter.dischargeToLoadKwh,
          quarter && quarter.bankToLoadKwh,
          quarter && quarter.storageToLoadKwh,
          quarter && quarter.batteryToLoadKwh
        );
        const usageStorageToLoad = firstNumber(
          usageQuarter && usageQuarter.storage,
          usageQuarter && usageQuarter.storageToLoadKwh,
          usageQuarter && usageQuarter.bankToLoadKwh,
          usageQuarter && usageQuarter.batteryToLoadKwh
        );
        const usageGridExportKwh = Math.max(0, firstNumber(
          usageQuarter && usageQuarter.gridExportKwh,
          usageQuarter && usageQuarter.exportKwh,
          usageQuarter && usageQuarter.saleKwh,
          usageQuarter && usageQuarter.soldKwh,
          0
        ) || 0);
        let dischargeToGridKwh = explicitGridDischarge != null ? Math.max(0, explicitGridDischarge) : 0;
        let dischargeToLoadKwh = 0;

        if (explicitLoadDischarge != null) {
          dischargeToLoadKwh = Math.max(0, explicitLoadDischarge);
        } else if (usageStorageToLoad != null) {
          dischargeToLoadKwh = Math.min(totalDischargeKwh, Math.max(0, usageStorageToLoad));
        }

        if (explicitGridDischarge == null) {
          if (usageStorageToLoad != null) {
            dischargeToGridKwh = Math.max(0, totalDischargeKwh - dischargeToLoadKwh);
          } else if (usageGridExportKwh > 0) {
            dischargeToGridKwh = Math.min(totalDischargeKwh, usageGridExportKwh);
          }
        }

        if (explicitLoadDischarge == null && usageStorageToLoad == null) {
          dischargeToLoadKwh = Math.max(0, totalDischargeKwh - dischargeToGridKwh);
        }

        const dischargeKwh = Math.max(totalDischargeKwh, dischargeToLoadKwh + dischargeToGridKwh);
        const levelKwh = firstNumber(quarter && quarter.energyKwh);
        const capacityKwh = firstNumber(quarter && quarter.capacityKwh);
        let socPercent = firstNumber(quarter && quarter.socPercent);
        const hasMeasuredState = levelKwh != null || socPercent != null;
        const hasMeasuredFlow = chargeKwh > 0 || dischargeKwh > 0 || firstNumber(
          quarter && quarter.powerW,
          quarter && quarter.chargePowerW,
          quarter && quarter.dischargePowerW
        ) != null;

        if (socPercent == null && levelKwh != null && capacityKwh != null && capacityKwh > 0) {
          socPercent = (levelKwh / capacityKwh) * 100;
        }

        bucket.chargeFromPvKwh += chargeFromPvKwh;
        bucket.topupKwh += chargeFromGridKwh;
        bucket.dischargeToLoadKwh += dischargeToLoadKwh;
        bucket.dischargeToGridKwh += dischargeToGridKwh;
        bucket.dischargeKwh += dischargeKwh;
        if (socPercent != null) {
          bucket.socPercent = socPercent;
        }
        if (hasMeasuredState || hasMeasuredFlow) {
          bucket.reference = {
            endSocKwh: levelKwh,
            socPercent: socPercent,
            chargeFromPvKwh: chargeFromPvKwh,
            topupKwh: chargeFromGridKwh,
            dischargeToLoadKwh: dischargeToLoadKwh,
            dischargeToGridKwh: dischargeToGridKwh,
            dischargeKwh: dischargeKwh,
            gridExportKwh: usageGridExportKwh,
            storageToLoadKwh: usageStorageToLoad,
            powerW: firstNumber(quarter && quarter.powerW),
            chargePowerW: firstNumber(quarter && quarter.chargePowerW),
            dischargePowerW: firstNumber(quarter && quarter.dischargePowerW)
          };
        }
      }

      if (range === "day") {
        const selected = recordMap.get(startKey);
        if (!selected) {
          return [];
        }

        const hourItems = Array.from({ length: 24 }, function (_, hour) {
          return createMeasuredItem(selected.date + "-" + String(hour).padStart(2, "0"), String(hour).padStart(2, "0"));
        });

        selected.quarters.forEach(function (quarter, index) {
          const rawHour = firstNumber(quarter && quarter.hour, Math.floor(index / 4));
          const hourIndex = clamp(Math.round(rawHour == null ? Math.floor(index / 4) : rawHour), 0, 23);
          updateMeasuredItem(hourItems[hourIndex], quarter, findUsageQuarter(selected, quarter, index));
        });

        return hourItems;
      }

      if (range === "year") {
        const monthMap = new Map();
        for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
          const monthDate = new Date(rangeWindow.start.getFullYear(), monthIndex, 1);
          const monthKey = String(monthDate.getFullYear()) + "-" + String(monthIndex + 1).padStart(2, "0");
          monthMap.set(monthKey, createMeasuredItem(
            monthKey,
            capitalize(yearMonthFormatter.format(monthDate)).replace(".", "")
          ));
        }

        records.forEach(function (record) {
          const dateKey = record && record.date ? String(record.date) : "";
          if (!dateKey || dateKey < startKey || dateKey > endKey) {
            return;
          }

          const monthKey = dateKey.slice(0, 7);
          const bucket = monthMap.get(monthKey);
          if (!bucket) {
            return;
          }
          record.quarters.forEach(function (quarter, index) {
            updateMeasuredItem(bucket, quarter, findUsageQuarter(record, quarter, index));
          });
        });

        return Array.from(monthMap.values());
      }

      const items = [];
      for (let currentDate = new Date(rangeWindow.start); currentDate.getTime() <= rangeWindow.end.getTime(); currentDate = addDays(currentDate, 1)) {
        const dateKey = formatDateKey(currentDate);
        const record = recordMap.get(dateKey);
        const item = createMeasuredItem(
          dateKey,
          range === "week"
            ? String(currentDate.getDate()).padStart(2, "0") + "." + String(currentDate.getMonth() + 1).padStart(2, "0")
            : String(currentDate.getDate()).padStart(2, "0")
        );

        if (record) {
          record.quarters.forEach(function (quarter, index) {
            updateMeasuredItem(item, quarter, findUsageQuarter(record, quarter, index));
          });
        }

        items.push(item);
      }

      return items;
    }

    function getLatestMeasuredStorageDateKey(payload) {
      const storageData = payload && payload.storageData ? payload.storageData : null;
      const records = storageData && Array.isArray(storageData.records) ? storageData.records : [];
      const candidates = [];
      if (storageData && storageData.latestDate) {
        candidates.push(String(storageData.latestDate).slice(0, 10));
      }
      records.forEach(function (record) {
        if (record && typeof record.date === "string") {
          candidates.push(record.date.slice(0, 10));
        }
      });

      return candidates
        .filter(function (dateKey) {
          return /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
        })
        .sort()
        .pop() || null;
    }

    function getMeasuredStorageCutoffMinute(payload, dateKey) {
      const latestTime = getDashboardLatestDataTime(payload);
      if (latestTime && formatDateKey(latestTime) === dateKey) {
        return clamp((latestTime.getHours() * 60) + latestTime.getMinutes(), 0, 24 * 60);
      }

      const storageData = payload && payload.storageData ? payload.storageData : null;
      const records = storageData && Array.isArray(storageData.records) ? storageData.records : [];
      const record = records.find(function (candidate) {
        return candidate && candidate.date === dateKey && Array.isArray(candidate.quarters);
      });
      if (!record) {
        return 24 * 60;
      }

      const coveredMinute = record.quarters.reduce(function (minute, quarter, index) {
        if (!quarter) {
          return minute;
        }
        return Math.max(minute, getQuarterEndMinute(quarter, index));
      }, 0);
      return coveredMinute > 0 ? clamp(coveredMinute, 0, 24 * 60) : 24 * 60;
    }

    function buildForecastAwareBankRangeItems(payload, simulation, range, anchorDate) {
      if (!simulation || !simulation.isForecast) {
        return buildMeasuredRangeItems(payload, range, anchorDate);
      }

      const forecastItems = buildRangeItems(simulation, range, anchorDate);
      const measuredItems = buildMeasuredRangeItems(payload, range, anchorDate);
      const latestMeasuredKey = getLatestMeasuredStorageDateKey(payload);
      const rangeWindow = getRangeWindow(range, anchorDate);
      const startKey = formatDateKey(rangeWindow.start);

      if (!latestMeasuredKey || !measuredItems.length) {
        return forecastItems;
      }

      if (range === "day") {
        if (startKey < latestMeasuredKey) {
          return measuredItems;
        }
        if (startKey > latestMeasuredKey) {
          return forecastItems;
        }

        const measuredByKey = new Map(measuredItems.map(function (item) {
          return [item.key, item];
        }));
        const cutoffMinute = getMeasuredStorageCutoffMinute(payload, startKey);
        return forecastItems.map(function (item) {
          const hour = Number(String(item && item.label || "").slice(0, 2));
          const itemStartMinute = Number.isFinite(hour) ? hour * 60 : 24 * 60;
          return itemStartMinute < cutoffMinute && measuredByKey.has(item.key)
            ? measuredByKey.get(item.key)
            : item;
        });
      }

      if (range === "week" || range === "month") {
        const measuredByKey = new Map(measuredItems.map(function (item) {
          return [item.key, item];
        }));
        return forecastItems.map(function (item) {
          return item && item.key <= latestMeasuredKey && measuredByKey.has(item.key)
            ? measuredByKey.get(item.key)
            : item;
        });
      }

      return forecastItems;
    }

    function renderZeroState(message) {
      state.items = [];
      if (chartEl) {
        if (state.chart) {
          state.chart.clear();
        } else {
          chartEl.innerHTML = "";
        }
      }
      renderBankSunMarkersEcharts();
      if (socUnitPillEl) {
        socUnitPillEl.hidden = state.range !== "day";
      }
      if (chartPlaceholderEl) {
        chartPlaceholderEl.classList.add("is-empty");
      }
      if (chartPlaceholderCaptionEl) {
        chartPlaceholderCaptionEl.textContent = message || "Brak danych do wykresu";
      }
    }

    function getQuarterStartMinute(quarter, index) {
      const parsedStart = parseSqlDateTime(firstText(quarter && quarter.slotStart));
      if (parsedStart) {
        return (parsedStart.getHours() * 60) + parsedStart.getMinutes();
      }

      const rawHour = firstNumber(quarter && quarter.hour, Math.floor(index / 4));
      const hour = clamp(Math.round(rawHour == null ? Math.floor(index / 4) : rawHour), 0, 23);
      const quarterIndex = clamp(Math.round(firstNumber(quarter && quarter.quarter, index % 4) || 0), 0, 3);
      return (hour * 60) + (quarterIndex * 15);
    }

    function getQuarterEndMinute(quarter, index) {
      const parsedEnd = parseSqlDateTime(firstText(quarter && quarter.slotEnd));
      if (parsedEnd) {
        return (parsedEnd.getHours() * 60) + parsedEnd.getMinutes();
      }

      return clamp(getQuarterStartMinute(quarter, index) + 15, 0, 24 * 60);
    }

    function getQuarterDaylightKwh(quarter) {
      return Math.max(0, firstNumber(
        quarter && quarter.productionKwh,
        quarter && quarter.pvGenerationKwh,
        quarter && quarter.production,
        quarter && quarter.pv,
        quarter && quarter.chargeFromPvKwh,
        quarter && quarter.pvToBankKwh,
        0
      ) || 0);
    }

    function getDaylightWindowFromRecord(record) {
      const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
      if (!quarters.length) {
        return null;
      }

      let firstMinute = null;
      let lastMinute = null;
      quarters.forEach(function (quarter, index) {
        if (getQuarterDaylightKwh(quarter) < BANK_DAYLIGHT_THRESHOLD_KWH) {
          return;
        }

        const startMinute = getQuarterStartMinute(quarter, index);
        const endMinute = getQuarterEndMinute(quarter, index);
        firstMinute = firstMinute == null ? startMinute : Math.min(firstMinute, startMinute);
        lastMinute = lastMinute == null ? endMinute : Math.max(lastMinute, endMinute);
      });

      if (firstMinute == null || lastMinute == null) {
        return null;
      }

      return {
        date: record.date,
        firstMinute: firstMinute,
        lastMinute: lastMinute
      };
    }

    function getBankDaylightWindow() {
      const payload = window.dashboardLatestPayload || {};
      const anchorKey = formatDateKey(state.anchorDate);
      const startKey = formatDateKey(addDays(state.anchorDate, -4));
      const datasets = [
        payload && payload.pvData,
        payload && payload.usageData,
        window.usageSampleData
      ];
      const windows = [];

      datasets.forEach(function (dataset) {
        const records = dataset && Array.isArray(dataset.records) ? dataset.records : [];
        records.forEach(function (record) {
          const dateKey = record && typeof record.date === "string" ? record.date : "";
          if (!dateKey || dateKey < startKey || dateKey > anchorKey) {
            return;
          }

          const daylightWindow = getDaylightWindowFromRecord(record);
          if (daylightWindow) {
            windows.push(daylightWindow);
          }
        });
      });

      if (!windows.length) {
        return null;
      }

      return {
        sourceDaysCount: windows.length,
        sunriseMinute: windows.reduce(function (minValue, daylight) {
          return Math.min(minValue, daylight.firstMinute);
        }, 24 * 60),
        sunsetMinute: windows.reduce(function (maxValue, daylight) {
          return Math.max(maxValue, daylight.lastMinute);
        }, 0)
      };
    }

    function formatMinuteOfDay(minute) {
      const safeMinute = clamp(Math.round(minute || 0), 0, (24 * 60) - 1);
      const hour = Math.floor(safeMinute / 60);
      const minuteInHour = safeMinute - (hour * 60);
      return String(hour).padStart(2, "0") + ":" + String(minuteInHour).padStart(2, "0");
    }

    function formatBankTooltipHour(hour) {
      const safeHour = clamp(Math.round(hour == null ? 0 : hour), 0, 24);
      return String(safeHour).padStart(2, "0") + ":00";
    }

    function getBankTooltipRangeLabel(item) {
      const label = item && typeof item.label === "string" ? item.label.trim() : "";
      const parsedHour = Number(label);
      if (state.range === "day" && label && Number.isFinite(parsedHour)) {
        return formatBankTooltipHour(parsedHour) + "–" + formatBankTooltipHour(parsedHour + 1);
      }
      return label || formatRangeName(state.range);
    }

    function getBankTooltipDateLabel(item) {
      const key = item && item.key != null ? String(item.key) : "";
      const dateKey = key.slice(0, 10);
      const date = parseDateKey(dateKey);

      if (state.range === "year") {
        const monthMatch = key.match(/^(\d{4})-(\d{2})$/);
        if (monthMatch) {
          return capitalize(monthTitleFormatter.format(new Date(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1)));
        }

        return date ? capitalize(monthTitleFormatter.format(date)) : getBankTooltipRangeLabel(item);
      }

      return date
        ? capitalize(weekdayFormatter.format(date)) + ", " + dateFormatter.format(date)
        : getBankTooltipRangeLabel(item);
    }

    function bankTooltipPercent(value, total) {
      return total > 0 ? formatDecimal((Math.max(value || 0, 0) / total) * 100, 0) + "%" : "--";
    }

    function bankTooltipRow(color, label, value, total) {
      return [
        "<div class=\"pv-chart-tooltip__row\">",
        "<span class=\"pv-chart-tooltip__dot\" style=\"background:" + color + ";\"></span>",
        "<div class=\"pv-chart-tooltip__row-content\">",
        "<p class=\"pv-chart-tooltip__row-label\">" + label + "</p>",
        "<p class=\"pv-chart-tooltip__row-value\">" + formatDecimal(value, 2) + " kWh | " + bankTooltipPercent(value, total) + "</p>",
        "</div>",
        "</div>"
      ].join("");
    }

    function bankTooltipSocRow(value) {
      return [
        "<div class=\"pv-chart-tooltip__row bank-chart-tooltip__soc-row\">",
        "<span class=\"pv-chart-tooltip__dot\" style=\"background:" + BANK_FLOW_COLORS.dischargeGrid + ";\"></span>",
        "<div class=\"pv-chart-tooltip__row-content\">",
        "<p class=\"pv-chart-tooltip__row-label\">SOC</p>",
        "<p class=\"pv-chart-tooltip__row-value\">" + (value == null ? "--" : formatDecimal(value, 0) + "%") + "</p>",
        "</div>",
        "</div>"
      ].join("");
    }

    function getBankAxisExtent(maxValue) {
      const normalizedMax = Math.max(Number(maxValue) || 0, 1);
      const paddedMax = normalizedMax * 1.04;
      const splitCountPerSide = 3;
      const roughInterval = paddedMax / splitCountPerSide;
      const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(roughInterval, 0.001))));
      const multipliers = [1, 1.25, 2, 2.5, 5, 10];
      let bestConfig = null;

      for (let magnitudeShift = -1; magnitudeShift <= 1; magnitudeShift += 1) {
        const shiftedMagnitude = magnitude * Math.pow(10, magnitudeShift);

        multipliers.forEach(function (multiplier) {
          const interval = Math.max(0.1, multiplier * shiftedMagnitude);
          const axisExtent = interval * splitCountPerSide;

          if (axisExtent < paddedMax) {
            return;
          }

          const slackPenalty = (axisExtent - normalizedMax) / normalizedMax;
          if (!bestConfig || slackPenalty < bestConfig.score) {
            bestConfig = {
              extent: axisExtent,
              interval: interval,
              score: slackPenalty
            };
          }
        });
      }

      return bestConfig || {
        extent: Math.max(1, paddedMax),
        interval: Math.max(0.1, paddedMax / splitCountPerSide)
      };
    }

    function getBankThemeColor(variableName, fallback) {
      const value = getComputedStyle(bankPage).getPropertyValue(variableName).trim();
      return value || fallback;
    }

    function getBankThemeTokens() {
      return {
        text: getBankThemeColor("--usage-ink", "#1A1A1A"),
        gridLine: getBankThemeColor("--usage-chart-grid", "rgba(26, 26, 26, 0.10)"),
        pointerShadow: getBankThemeColor("--usage-chart-grid", "rgba(176, 187, 213, 0.10)")
      };
    }

    function getBankWindowOrigin(range) {
      return range === "week" ? "end" : "start";
    }

    function getBankDefaultWindow(range, length) {
      if (range === "month" || range === "year") {
        return Math.max(length, 1);
      }
      return Math.min(BANK_RANGE_DEFAULT_WINDOW[range] || length, Math.max(length, 1));
    }

    function getBankMinWindow(range, length) {
      return Math.min(BANK_RANGE_MIN_WINDOW[range] || 1, Math.max(length, 1));
    }

    function getBankAxisConfig(maxValue, minimum) {
      const axisExtent = getBankAxisExtent(Math.max(Number(maxValue) || 0, minimum || 1)).extent;
      const splitCount = 6;
      return {
        min: -axisExtent,
        max: axisExtent,
        interval: (axisExtent * 2) / splitCount,
        splitNumber: splitCount
      };
    }

    function positionBankChartTooltip(point, params, dom, rect, size) {
      const viewSize = size && Array.isArray(size.viewSize)
        ? size.viewSize
        : [chartEl ? chartEl.clientWidth : 0, chartEl ? chartEl.clientHeight : 0];
      const rawContentSize = size && Array.isArray(size.contentSize) ? size.contentSize : [0, 0];
      const measuredTooltip = dom && dom.querySelector ? dom.querySelector(".bank-chart-tooltip") : null;
      const contentSize = [
        Math.max(rawContentSize[0] || 0, dom && dom.offsetWidth ? dom.offsetWidth : 0, measuredTooltip && measuredTooltip.offsetWidth ? measuredTooltip.offsetWidth : 0, 338),
        Math.max(rawContentSize[1] || 0, dom && dom.offsetHeight ? dom.offsetHeight : 0, measuredTooltip && measuredTooltip.offsetHeight ? measuredTooltip.offsetHeight : 0, 320)
      ];
      const margin = 12;
      const gap = 18;
      const viewWidth = Math.max(viewSize[0] || 0, contentSize[0] + (margin * 2));
      const viewHeight = Math.max(viewSize[1] || 0, contentSize[1] + (margin * 2));
      const pointX = Array.isArray(point) ? point[0] : 0;
      const pointY = Array.isArray(point) ? point[1] : 0;
      const maxLeft = Math.max(margin, viewWidth - contentSize[0] - margin);
      const maxTop = Math.max(margin, viewHeight - contentSize[1] - margin);
      let left = pointX + gap;
      let top = pointY - contentSize[1] - gap;

      if (left + contentSize[0] + margin > viewWidth) {
        left = pointX - contentSize[0] - gap;
      }
      if (top < margin) {
        top = pointY + gap;
      }
      if (top + contentSize[1] + margin > viewHeight) {
        top = pointY - contentSize[1] - gap;
      }

      return [
        clampNumber(left, margin, maxLeft),
        clampNumber(top, margin, maxTop)
      ];
    }

    function getBankTooltipMode(item) {
      const chargeTotal = Math.max(0, firstNumber(item && item.chargeFromPvKwh, 0) || 0) +
        Math.max(0, firstNumber(item && item.topupKwh, 0) || 0);
      const dischargeTotal = Math.max(0, firstNumber(item && item.dischargeToLoadKwh, item && item.dischargeKwh, 0) || 0) +
        Math.max(0, firstNumber(item && item.dischargeToGridKwh, 0) || 0);
      return dischargeTotal > chargeTotal ? "discharge" : "charge";
    }

    function getBankTooltipHtml(item, mode) {
      const chargePv = Math.max(0, firstNumber(item && item.chargeFromPvKwh, 0) || 0);
      const chargeGrid = Math.max(0, firstNumber(item && item.topupKwh, 0) || 0);
      const dischargeLoad = Math.max(0, firstNumber(item && item.dischargeToLoadKwh, item && item.dischargeKwh, 0) || 0);
      const dischargeGrid = Math.max(0, firstNumber(item && item.dischargeToGridKwh, 0) || 0);
      const chargeTotal = chargePv + chargeGrid;
      const dischargeTotal = dischargeLoad + dischargeGrid;
      const total = mode === "charge" ? chargeTotal : dischargeTotal;

      if (state.range !== "day") {
        return [
          "<div class=\"pv-chart-tooltip bank-chart-tooltip bank-chart-tooltip--range\">",
          "<p class=\"pv-chart-tooltip__title\">Ładowanie</p>",
          "<p class=\"pv-chart-tooltip__range\">" + escapeHtml(getBankTooltipDateLabel(item)) + "</p>",
          bankTooltipRow(BANK_FLOW_COLORS.chargePv, "Z fotowoltaiki", chargePv, chargeTotal),
          bankTooltipRow(BANK_FLOW_COLORS.chargeGrid, "Z sieci", chargeGrid, chargeTotal),
          "<p class=\"pv-chart-tooltip__title bank-chart-tooltip__section-title\">Rozładowywanie</p>",
          bankTooltipRow(BANK_FLOW_COLORS.dischargeLoad, "Na zużycie", dischargeLoad, dischargeTotal),
          bankTooltipRow(BANK_FLOW_COLORS.dischargeGrid, "Do sieci", dischargeGrid, dischargeTotal),
          "<div class=\"pv-chart-tooltip__divider\"></div>",
          "<p class=\"pv-chart-tooltip__total\"><span>" + formatDecimal(chargeTotal + dischargeTotal, 2) + "</span> kWh</p>",
          "</div>"
        ].join("");
      }

      const title = mode === "charge" ? "\u0141adowanie" : "Roz\u0142adowywanie";
      const rows = mode === "charge"
        ? [
          bankTooltipRow(BANK_FLOW_COLORS.chargePv, "Z fotowoltaiki", chargePv, chargeTotal),
          bankTooltipRow(BANK_FLOW_COLORS.chargeGrid, "Z sieci", chargeGrid, chargeTotal)
        ]
        : [
          bankTooltipRow(BANK_FLOW_COLORS.dischargeLoad, "Na zu\u017cycie", dischargeLoad, dischargeTotal),
          bankTooltipRow(BANK_FLOW_COLORS.dischargeGrid, "Do sieci", dischargeGrid, dischargeTotal)
        ];
      const socSection = state.range === "day"
        ? [
          "<div class=\"pv-chart-tooltip__divider\"></div>",
          bankTooltipSocRow(item && item.socPercent)
        ]
        : [];

      return [
        "<div class=\"pv-chart-tooltip bank-chart-tooltip\">",
        "<p class=\"pv-chart-tooltip__title\">" + title + "</p>",
        "<p class=\"pv-chart-tooltip__range\">" + getBankTooltipRangeLabel(item) + "</p>",
        rows.join(""),
        socSection.join(""),
        "<div class=\"pv-chart-tooltip__divider\"></div>",
        "<p class=\"pv-chart-tooltip__total\"><span>" + formatDecimal(total, 2) + "</span> kWh</p>",
        "</div>"
      ].join("");
    }

    function ensureBankChart() {
      if (!chartEl || !window.echarts || !chartEl.offsetWidth || !chartEl.offsetHeight) {
        return null;
      }

      if (state.chart) {
        return state.chart;
      }

      state.chart = window.echarts.init(chartEl, null, {
        renderer: "canvas",
        useCoarsePointer: true,
        pointerSize: 14
      });

      state.chart.on("datazoom", function () {
        syncBankWindowCount();
        requestAnimationFrame(renderBankSunMarkersEcharts);
      });

      state.chart.on("click", function (params) {
        if (params.componentType !== "series" || typeof params.dataIndex !== "number") {
          return;
        }

        const target = getDashboardChartDrilldownTarget(
          state.range,
          state.anchorDate,
          state.items[params.dataIndex],
          params.dataIndex
        );
        if (!target) {
          return;
        }

        state.range = target.range;
        state.anchorDate = clampDashboardNavigationDate(target.anchorDate, state.range);
        state.anchorTouched = true;
        state.windowOrigin = getBankWindowOrigin(state.range);
        state.windowStartIndex = null;
        state.windowCount = null;
        updateToolbar();
        applyPayload();
      });

      if (!currentHourHighlighter && typeof window.onRevoltCreateCurrentHourHighlighter === "function") {
        currentHourHighlighter = window.onRevoltCreateCurrentHourHighlighter({
          chart: state.chart,
          element: chartEl,
          getItems: function () { return state.items; },
          getRange: function () { return state.range; },
          getAnchorDate: function () { return state.anchorDate; }
        });
      }

      return state.chart;
    }

    function getBankStackedBarData(items) {
      return items.map(function (item, index) {
        return [
          index,
          Math.max(0, firstNumber(item && item.chargeFromPvKwh, 0) || 0),
          Math.max(0, firstNumber(item && item.topupKwh, 0) || 0),
          Math.max(0, firstNumber(item && item.dischargeToLoadKwh, item && item.dischargeKwh, 0) || 0),
          Math.max(0, firstNumber(item && item.dischargeToGridKwh, 0) || 0),
          item && item.isForecast ? 0.4 : 1
        ];
      });
    }

    function createBankBarShape(coordSys, x, y, width, height, radii) {
      if (!window.echarts || !window.echarts.graphic || height <= 0 || width <= 0) {
        return null;
      }

      const shape = {
        x: x,
        y: y,
        width: width,
        height: height,
        r: radii
      };
      const clippedShape = window.echarts.graphic.clipRectByRect(shape, {
        x: coordSys.x,
        y: coordSys.y,
        width: coordSys.width,
        height: coordSys.height
      });

      if (!clippedShape) {
        return null;
      }

      clippedShape.r = radii;
      return clippedShape;
    }

    function renderBankStackedBars(params, api) {
      const coordSys = params && params.coordSys ? params.coordSys : null;
      if (!coordSys) {
        return null;
      }

      const index = Number(api.value(0) || 0);
      const opacity = firstNumber(api.value(5), 1);
      const basePoint = api.coord([index, 0]);
      const barWidth = state.range === "day" ? BANK_BAR_WIDTH : BANK_RANGE_BAR_WIDTH;
      const x = basePoint[0] - (barWidth / 2);
      const radius = Math.min(BANK_BAR_RADIUS, barWidth / 2);
      const children = [];
      const positiveSegments = [
        { value: Number(api.value(1) || 0), color: BANK_FLOW_COLORS.chargePv },
        { value: Number(api.value(2) || 0), color: BANK_FLOW_COLORS.chargeGrid }
      ].filter(function (segment) { return segment.value > 0; });
      const negativeSegments = [
        { value: Number(api.value(3) || 0), color: BANK_FLOW_COLORS.dischargeLoad },
        { value: Number(api.value(4) || 0), color: BANK_FLOW_COLORS.dischargeGrid }
      ].filter(function (segment) { return segment.value > 0; });
      let positiveCursor = 0;
      let negativeCursor = 0;

      positiveSegments.forEach(function (segment, segmentIndex) {
        const nextCursor = positiveCursor + segment.value;
        const topPoint = api.coord([index, nextCursor]);
        const bottomPoint = api.coord([index, positiveCursor]);
        const rawHeight = Math.abs(bottomPoint[1] - topPoint[1]);
        const height = Math.max(2, rawHeight);
        const shape = createBankBarShape(
          coordSys,
          x,
          Math.min(topPoint[1], bottomPoint[1]) - (rawHeight < 2 ? 2 - rawHeight : 0),
          barWidth,
          height,
          segmentIndex === positiveSegments.length - 1 ? [radius, radius, 0, 0] : [0, 0, 0, 0]
        );
        if (shape) {
          children.push({
            type: "rect",
            shape: shape,
            style: {
              fill: segment.color,
              opacity: opacity
            }
          });
        }
        positiveCursor = nextCursor;
      });

      negativeSegments.forEach(function (segment, segmentIndex) {
        const nextCursor = negativeCursor - segment.value;
        const topPoint = api.coord([index, negativeCursor]);
        const bottomPoint = api.coord([index, nextCursor]);
        const rawHeight = Math.abs(bottomPoint[1] - topPoint[1]);
        const height = Math.max(2, rawHeight);
        const shape = createBankBarShape(
          coordSys,
          x,
          Math.min(topPoint[1], bottomPoint[1]),
          barWidth,
          height,
          segmentIndex === negativeSegments.length - 1 ? [0, 0, radius, radius] : [0, 0, 0, 0]
        );
        if (shape) {
          children.push({
            type: "rect",
            shape: shape,
            style: {
              fill: segment.color,
              opacity: opacity
            }
          });
        }
        negativeCursor = nextCursor;
      });

      return children.length ? {
        type: "group",
        children: children
      } : null;
    }

    function renderBankSocStep(params, api) {
      const coordSys = params && params.coordSys ? params.coordSys : null;
      const values = state.bankSocValues || [];
      if (!coordSys || !values.length) {
        return null;
      }

      const centers = values.map(function (_, index) {
        return api.coord([index, 50])[0];
      });
      const bottomY = coordSys.y + coordSys.height;
      const children = [];
      let linePoints = [];
      let areaPoints = [];
      let previousY = null;

      function flushRun() {
        if (linePoints.length <= 1 || areaPoints.length <= 2) {
          linePoints = [];
          areaPoints = [];
          previousY = null;
          return;
        }

        children.push({
          type: "polygon",
          shape: {
            points: areaPoints.concat([[linePoints[linePoints.length - 1][0], bottomY]])
          },
          style: {
            fill: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(217, 249, 235, 0.55)" },
              { offset: 1, color: "rgba(217, 249, 235, 0)" }
            ]),
            stroke: "none",
            opacity: (state.bankSocForecast || []).some(function (value) { return value; }) ? 0.4 : 1
          },
          silent: true
        });
        children.push({
          type: "polyline",
          shape: {
            points: linePoints
          },
          style: {
            fill: null,
            stroke: "#38C98A",
            lineWidth: 3,
            lineCap: "round",
            lineJoin: "round",
            opacity: (state.bankSocForecast || []).some(function (value) { return value; }) ? 0.4 : 1
          },
          silent: true
        });

        linePoints = [];
        areaPoints = [];
        previousY = null;
      }

      values.forEach(function (value, index) {
        if (value == null) {
          flushRun();
          return;
        }

        const point = api.coord([index, clamp(value, 0, 100)]);
        const centerX = point[0];
        const y = point[1];
        const leftNeighbor = centers[index - 1];
        const rightNeighbor = centers[index + 1];
        const fallbackSlotWidth = Math.max(BANK_BAR_WIDTH, coordSys.width / Math.max(values.length, 1));
        const startX = Math.max(
          coordSys.x,
          leftNeighbor == null ? centerX - (fallbackSlotWidth / 2) : (leftNeighbor + centerX) / 2
        );
        const endX = Math.min(
          coordSys.x + coordSys.width,
          rightNeighbor == null ? centerX + (fallbackSlotWidth / 2) : (centerX + rightNeighbor) / 2
        );

        if (!linePoints.length || previousY == null) {
          linePoints.push([startX, y]);
          areaPoints.push([startX, bottomY], [startX, y]);
        } else {
          linePoints.push([startX, previousY], [startX, y]);
          areaPoints.push([startX, previousY], [startX, y]);
        }

        linePoints.push([endX, y]);
        areaPoints.push([endX, y]);
        previousY = y;
      });

      flushRun();

      return children.length ? {
        type: "group",
        children: children
      } : null;
    }

    function buildBankEchartOption(items) {
      const isWeekRange = state.range === "week";
      const showSocChart = state.range === "day";
      const theme = getBankThemeTokens();
      const labels = items.map(function (item) { return item.label; });
      const positiveMax = items.reduce(function (maxValue, item) {
        return Math.max(
          maxValue,
          Math.max(0, firstNumber(item && item.chargeFromPvKwh, 0) || 0) +
            Math.max(0, firstNumber(item && item.topupKwh, 0) || 0)
        );
      }, 0);
      const negativeMax = items.reduce(function (maxValue, item) {
        return Math.max(
          maxValue,
          Math.max(0, firstNumber(item && item.dischargeToLoadKwh, item && item.dischargeKwh, 0) || 0) +
            Math.max(0, firstNumber(item && item.dischargeToGridKwh, 0) || 0)
        );
      }, 0);
      const energyAxisConfig = getBankAxisConfig(Math.max(positiveMax, negativeMax, BANK_SLOT_LIMIT_KWH), 1);
      const series = [
        {
          name: "Przep\u0142yw energii",
          type: "custom",
          data: getBankStackedBarData(items),
          renderItem: renderBankStackedBars,
          encode: { x: 0 },
          yAxisIndex: 0,
          clip: true,
          z: 3
        }
      ];

      if (socUnitPillEl) {
        socUnitPillEl.hidden = !showSocChart;
      }

      state.bankSocValues = showSocChart ? items.map(function (item) {
        const value = firstNumber(item && item.socPercent);
        return value == null ? null : clamp(value, 0, 100);
      }) : [];
      state.bankSocForecast = showSocChart ? items.map(function (item) { return !!(item && item.isForecast); }) : [];

      if (showSocChart) {
        series.push({
          name: "SOC",
          type: "custom",
          yAxisIndex: 1,
          data: [[0, 0]],
          renderItem: renderBankSocStep,
          clip: true,
          z: 1,
          silent: true
        });
      }

      return {
        animationDuration: 300,
        animationDurationUpdate: 260,
        grid: {
          top: 18,
          right: 54,
          bottom: isWeekRange ? 58 : 44,
          left: 54,
          containLabel: true
        },
        tooltip: {
          trigger: "axis",
          axisPointer: {
            type: "shadow",
            shadowStyle: {
              color: theme.pointerShadow
            }
          },
          backgroundColor: "transparent",
          borderWidth: 0,
          padding: 0,
          extraCssText: "box-shadow:none;",
          position: positionBankChartTooltip,
          formatter: function (params) {
            const tooltipParam = Array.isArray(params)
              ? params.find(function (param) { return param && param.seriesName === "Przep\u0142yw energii"; }) || params[0]
              : params;
            const item = tooltipParam && typeof tooltipParam.dataIndex === "number"
              ? items[tooltipParam.dataIndex]
              : null;

            if (!item) {
              return "";
            }

            return getBankTooltipHtml(item, getBankTooltipMode(item));
          }
        },
        xAxis: {
          type: "category",
          data: labels,
          axisTick: { show: false },
          axisLine: { show: false },
          boundaryGap: true,
          axisLabel: {
            color: theme.text,
            fontSize: 14,
            lineHeight: 20,
            margin: isWeekRange ? 18 : 14,
            interval: 0
          }
        },
        yAxis: [
          {
            type: "value",
            min: energyAxisConfig.min,
            max: energyAxisConfig.max,
            interval: energyAxisConfig.interval,
            splitNumber: energyAxisConfig.splitNumber,
            axisTick: { show: false },
            axisLine: { show: false },
            axisLabel: {
              color: theme.text,
              fontSize: 14,
              margin: 12,
              formatter: function (value) {
                return formatSignedDecimal(value, 2);
              }
            },
            splitLine: {
              lineStyle: {
                color: theme.gridLine,
                width: 1
              }
            }
          },
          {
            show: showSocChart,
            type: "value",
            min: 0,
            max: 100,
            interval: 100 / 6,
            splitNumber: 6,
            axisTick: { show: false },
            axisLine: { show: false },
            axisLabel: {
              color: theme.text,
              fontSize: 14,
              margin: 12,
              formatter: function (value) {
                return formatDecimal(value, 0) + "%";
              }
            },
            splitLine: {
              show: false
            }
          }
        ],
        dataZoom: [
          {
            id: "bank-inside",
            type: "inside",
            xAxisIndex: 0,
            filterMode: "none",
            zoomOnMouseWheel: false,
            moveOnMouseWheel: false,
            moveOnMouseMove: true,
            preventDefaultMouseMove: false
          },
          {
            id: "bank-slider",
            type: "slider",
            show: false,
            xAxisIndex: 0,
            filterMode: "none"
          }
        ],
        series: series
      };
    }

    function getBankDayMarkerIndex(minute) {
      const normalizedMinute = clampNumber(Math.round(minute == null ? 0 : minute), 0, (24 * 60) - 1);
      const hour = Math.floor(normalizedMinute / 60);
      const minuteInHour = normalizedMinute - (hour * 60);
      return hour + (minuteInHour / 60);
    }

    function renderBankSunMarkersEcharts() {
      if (!sunMarkersEl) {
        return;
      }

      sunMarkersEl.innerHTML = "";

      if (state.range !== "day" || !state.chart || !state.items.length) {
        sunMarkersEl.hidden = true;
        return;
      }

      const daylightWindow = getBankDaylightWindow();
      if (!daylightWindow) {
        sunMarkersEl.hidden = true;
        return;
      }

      [
        {
          type: "sunrise",
          label: "Wsch\u00f3d s\u0142o\u0144ca",
          minute: daylightWindow.sunriseMinute,
          icon: "images/icons/sunrise.svg"
        },
        {
          type: "sunset",
          label: "Zach\u00f3d s\u0142o\u0144ca",
          minute: daylightWindow.sunsetMinute,
          icon: "images/icons/sunset.svg"
        }
      ].forEach(function (marker) {
        const position = state.chart.convertToPixel({ xAxisIndex: 0 }, getBankDayMarkerIndex(marker.minute));
        if (!Number.isFinite(position) || position < -20 || position > chartEl.clientWidth + 20) {
          return;
        }

        const element = document.createElement("span");
        const clock = formatMinuteOfDay(marker.minute);

        element.className = "pv-sun-marker bank-sun-marker bank-sun-marker--" + marker.type;
        element.style.left = position + "px";
        element.style.backgroundImage = "url('" + marker.icon + "')";
        element.title = marker.label + ": " + clock + " (z ostatnich " + daylightWindow.sourceDaysCount + " dni)";
        element.setAttribute("aria-label", element.title);
        sunMarkersEl.appendChild(element);
      });

      sunMarkersEl.hidden = !sunMarkersEl.children.length;
    }

    function applyBankZoomWindow() {
      if (!state.chart || !state.items.length) {
        return;
      }

      const fullLength = state.items.length;
      const maxStartIndex = Math.max(fullLength - state.windowCount, 0);
      const startValue = state.windowStartIndex != null
        ? clampNumber(state.windowStartIndex, 0, maxStartIndex)
        : (state.windowOrigin === "start" ? 0 : Math.max(0, fullLength - state.windowCount));
      const endValue = Math.min(fullLength - 1, startValue + state.windowCount - 1);

      state.chart.dispatchAction({
        type: "dataZoom",
        dataZoomId: "bank-inside",
        startValue: startValue,
        endValue: endValue
      });
    }

    function syncBankWindowCount() {
      if (!state.chart || !state.items.length) {
        return;
      }

      const option = state.chart.getOption();
      const zoomState = option.dataZoom && option.dataZoom[0];
      if (!zoomState) {
        return;
      }

      const startValue = typeof zoomState.startValue === "number" ? zoomState.startValue : 0;
      const endValue = typeof zoomState.endValue === "number" ? zoomState.endValue : state.items.length - 1;

      state.windowStartIndex = startValue;
      state.windowCount = clampNumber(
        (endValue - startValue) + 1,
        getBankMinWindow(state.range, state.items.length),
        state.items.length
      );
    }

    function renderBankChart(items) {
      state.items = Array.isArray(items) ? items : [];

      if (!chartEl) {
        return;
      }


      if (!state.items.length) {
        renderZeroState("Brak danych do wykresu");
        return;
      }

      if (chartPlaceholderEl) {
        chartPlaceholderEl.classList.remove("is-empty");
      }

      const chart = ensureBankChart();
      if (!chart) {
        return;
      }

      state.windowCount = clampNumber(
        state.windowCount || getBankDefaultWindow(state.range, state.items.length),
        getBankMinWindow(state.range, state.items.length),
        Math.max(state.items.length, 1)
      );
      state.windowStartIndex = state.windowStartIndex == null
        ? null
        : clampNumber(state.windowStartIndex, 0, Math.max(state.items.length - state.windowCount, 0));

      try {
        chart.setOption(buildBankEchartOption(state.items), true);
      } catch (error) {
        console.error("Bank ECharts render failed:", error);
        renderZeroState("B\u0142\u0105d renderowania wykresu magazynu energii.");
        return;
      }

      applyBankZoomWindow();
      if (currentHourHighlighter) {
        currentHourHighlighter.update();
      }
      requestAnimationFrame(renderBankSunMarkersEcharts);
    }

    function zoomBankChart(direction) {
      if (!state.items.length) {
        return;
      }

      const minWindow = getBankMinWindow(state.range, state.items.length);
      const currentStart = state.windowStartIndex == null
        ? (state.windowOrigin === "start" ? 0 : Math.max(0, state.items.length - state.windowCount))
        : state.windowStartIndex;
      const currentEnd = Math.min(state.items.length - 1, currentStart + state.windowCount - 1);
      const currentCenter = currentStart + ((currentEnd - currentStart) / 2);
      const targetWindow = state.range === "day"
        ? window.onRevoltDayZoom.nextHours(state.windowCount, direction)
        : direction > 0
        ? Math.max(minWindow, Math.round(state.windowCount * 0.8))
        : Math.min(state.items.length, Math.round(state.windowCount * 1.25));

      state.windowCount = clampNumber(targetWindow, minWindow, state.items.length);
      state.windowStartIndex = clampNumber(
        Math.round(currentCenter - ((state.windowCount - 1) / 2)),
        0,
        Math.max(state.items.length - state.windowCount, 0)
      );
      applyBankZoomWindow();
      requestAnimationFrame(renderBankSunMarkersEcharts);
    }

    function resetBankZoomWindow() {
      if (!state.items.length) {
        return;
      }

      state.windowOrigin = getBankWindowOrigin(state.range);
      state.windowStartIndex = null;
      state.windowCount = state.windowOrigin === "start"
        ? state.items.length
        : getBankDefaultWindow(state.range, state.items.length);
      applyBankZoomWindow();
      requestAnimationFrame(renderBankSunMarkersEcharts);
    }

    function jumpToLatestBankDay() {
      const payload = window.dashboardLatestPayload || {};

      state.range = "day";
      state.anchorDate = getPayloadAnchorDate(payload);
      state.anchorTouched = false;
      state.anchorSourceKey = "";
      state.windowOrigin = getBankWindowOrigin(state.range);
      state.windowStartIndex = null;
      state.windowCount = null;
      updateToolbar();
      applyPayload();
    }

    function jumpToCurrentBankDay() {
      state.range = "day";
      state.anchorDate = getDashboardNavigationDay(new Date());
      state.anchorTouched = true;
      state.anchorSourceKey = formatDateKey(state.anchorDate);
      state.windowOrigin = getBankWindowOrigin(state.range);
      state.windowStartIndex = null;
      state.windowCount = null;
      updateToolbar();
      applyPayload();
    }

    function getReferenceEntry(range, items, payloadAnchorDate, anchorDate) {
      if (!items.length) {
        return null;
      }

      if (range !== "day") {
        return items[items.length - 1].reference || null;
      }

      const selectedDateKey = formatDateKey(anchorDate);
      const payloadDateKey = formatDateKey(payloadAnchorDate);
      if (selectedDateKey !== payloadDateKey) {
        return items[items.length - 1].reference || null;
      }

      const payloadHour = clamp(payloadAnchorDate.getHours(), 0, 23);
      for (let index = Math.min(payloadHour, items.length - 1); index >= 0; index -= 1) {
        if (items[index] && items[index].reference) {
          return items[index].reference;
        }
      }

      return items[items.length - 1].reference || null;
    }

    function getLatestMeasuredStorageSample(payload) {
      const storageData = payload && payload.storageData ? payload.storageData : null;
      const records = storageData && Array.isArray(storageData.records) ? storageData.records : [];
      for (let recordIndex = records.length - 1; recordIndex >= 0; recordIndex -= 1) {
        const record = records[recordIndex];
        const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
        for (let quarterIndex = quarters.length - 1; quarterIndex >= 0; quarterIndex -= 1) {
          const quarter = quarters[quarterIndex];
          const levelKwh = firstNumber(quarter && quarter.energyKwh);
          const socPercent = firstNumber(quarter && quarter.socPercent);
          const chargePowerW = firstNumber(quarter && quarter.chargePowerW);
          const dischargePowerW = firstNumber(quarter && quarter.dischargePowerW);
          const powerW = firstNumber(quarter && quarter.powerW);
          if (levelKwh != null || socPercent != null || chargePowerW != null || dischargePowerW != null || powerW != null) {
            return quarter;
          }
        }
      }
      return null;
    }

    function calculateMeasuredCycleCount(payload, capacityKwh) {
      const storageData = payload && payload.storageData ? payload.storageData : null;
      const records = storageData && Array.isArray(storageData.records) ? storageData.records : [];
      const capacity = firstNumber(capacityKwh, BANK_CAPACITY_KWH);
      if (!records.length || capacity == null || capacity <= 0) {
        return null;
      }

      let dischargedKwh = 0;
      records.forEach(function (record) {
        const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
        quarters.forEach(function (quarter) {
          dischargedKwh += firstNumber(quarter && quarter.dischargeKwh, 0) || 0;
        });
      });

      return dischargedKwh > 0 ? dischargedKwh / capacity : null;
    }

    function getMeasuredBreakdown(payload) {
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const latestSample = getLatestMeasuredStorageSample(payload);
      const capacityKwh = firstNumber(
        energy.batteryCapacityKwh,
        energy.storageCapacityKwh,
        rawEnergy.batteryCapacityKwh,
        rawEnergy.storageCapacityKwh,
        latestSample && latestSample.capacityKwh,
        BANK_CAPACITY_KWH
      );
      const levelKwh = firstNumber(
        energy.batteryLevelKwh,
        energy.storageLevelKwh,
        rawEnergy.batteryLevelKwh,
        rawEnergy.storageLevelKwh,
        latestSample && latestSample.energyKwh
      );
      let socPercent = firstNumber(
        energy.batterySocPercent,
        energy.socPercent,
        rawEnergy.batterySocPercent,
        rawEnergy.socPercent,
        latestSample && latestSample.socPercent
      );
      if (socPercent == null && levelKwh != null && capacityKwh != null && capacityKwh > 0) {
        socPercent = (levelKwh / capacityKwh) * 100;
      }

      const chargeKw = firstNumber(
        energy.batteryChargeKw,
        energy.storageChargeKw,
        rawEnergy.batteryChargeKw,
        rawEnergy.storageChargeKw,
        latestSample && latestSample.chargePowerW != null ? latestSample.chargePowerW / 1000 : null,
        latestSample && latestSample.powerW != null && latestSample.powerW > 0 ? latestSample.powerW / 1000 : null
      );
      const dischargeKw = firstNumber(
        energy.batteryDischargeKw,
        energy.storageDischargeKw,
        rawEnergy.batteryDischargeKw,
        rawEnergy.storageDischargeKw,
        latestSample && latestSample.dischargePowerW != null ? latestSample.dischargePowerW / 1000 : null,
        latestSample && latestSample.powerW != null && latestSample.powerW < 0 ? Math.abs(latestSample.powerW) / 1000 : null
      );
      const cycleCount = firstNumber(
        energy.batteryCycleCount,
        rawEnergy.batteryCycleCount,
        rawEnergy.cycles,
        rawEnergy.cycleCount,
        rawEnergy.liczbaCykli,
        calculateMeasuredCycleCount(payload, capacityKwh)
      );

      return {
        capacityKwh: capacityKwh,
        levelKwh: levelKwh,
        socPercent: socPercent,
        chargeKw: chargeKw,
        dischargeKw: dischargeKw,
        cycleCount: cycleCount
      };
    }

    function getFlowTotals(items) {
      return (Array.isArray(items) ? items : []).reduce(function (totals, item) {
        totals.chargePv += Math.max(0, firstNumber(item && item.chargeFromPvKwh, 0) || 0);
        totals.chargeGrid += Math.max(0, firstNumber(item && item.topupKwh, 0) || 0);
        totals.dischargeLoad += Math.max(0, firstNumber(item && item.dischargeToLoadKwh, item && item.dischargeKwh, 0) || 0);
        totals.dischargeGrid += Math.max(0, firstNumber(item && item.dischargeToGridKwh, 0) || 0);
        return totals;
      }, {
        chargePv: 0,
        chargeGrid: 0,
        dischargeLoad: 0,
        dischargeGrid: 0
      });
    }

    function updateFlowDial(totals) {
      if (!flowDialEl) {
        return;
      }

      const total = (totals.chargePv || 0) + (totals.chargeGrid || 0) + (totals.dischargeLoad || 0) + (totals.dischargeGrid || 0);
      if (total <= 0) {
        flowDialEl.style.background = "conic-gradient(from -90deg, #fc7c00 0 25%, #feb633 25% 50%, #b0bbd5 50% 75%, #009a44 75% 100%)";
        return;
      }

      const segments = [
        { value: totals.chargeGrid, color: BANK_FLOW_COLORS.chargeGrid },
        { value: totals.chargePv, color: BANK_FLOW_COLORS.chargePv },
        { value: totals.dischargeLoad, color: BANK_FLOW_COLORS.dischargeLoad },
        { value: totals.dischargeGrid, color: BANK_FLOW_COLORS.dischargeGrid }
      ];
      let cursor = 0;
      const parts = segments.map(function (segment) {
        const start = cursor;
        cursor += (Math.max(segment.value || 0, 0) / total) * 100;
        return segment.color + " " + start.toFixed(3) + "% " + cursor.toFixed(3) + "%";
      });

      flowDialEl.style.background = "conic-gradient(from -90deg, " + parts.join(", ") + ")";
    }

    function updateFlowSummary(items) {
      const totals = getFlowTotals(items);
      const total = totals.chargePv + totals.chargeGrid + totals.dischargeLoad + totals.dischargeGrid;

      setFlowValue(chargePvValueEl, totals.chargePv, total);
      setFlowValue(chargeGridValueEl, totals.chargeGrid, total);
      setFlowValue(dischargeLoadValueEl, totals.dischargeLoad, total);
      setFlowValue(dischargeGridValueEl, totals.dischargeGrid, total);
      updateFlowDial(totals);

      return totals;
    }

    function isLivePathStatusWindow(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return false;
      }

      const second = date.getSeconds();
      return BANK_LIVE_PATH_STATUS_SECONDS.some(function (targetSecond) {
        return Math.abs(second - targetSecond) <= BANK_LIVE_PATH_STATUS_TOLERANCE_SECONDS;
      });
    }

    function getLivePathAgeSeconds(livePaths) {
      const datastats = parseSqlDateTime(livePaths && livePaths.datastats);
      if (!datastats) {
        return null;
      }

      const serverTime = parseSqlDateTime(livePaths && livePaths.serverTime);
      const now = serverTime || new Date();
      return Math.abs(now.getTime() - datastats.getTime()) / 1000;
    }

    function isLivePathsFresh(livePaths) {
      if (!livePaths || typeof livePaths !== "object") {
        return false;
      }

      const datastats = parseSqlDateTime(livePaths.datastats);
      const ageSeconds = firstNumber(livePaths.ageSeconds, getLivePathAgeSeconds(livePaths));
      const statusWindowValid = livePaths.statusWindowValid === true || isLivePathStatusWindow(datastats);

      return statusWindowValid && ageSeconds != null && ageSeconds <= BANK_LIVE_PATH_MAX_AGE_SECONDS;
    }

    function getLiveBankPowerBreakdown(payload) {
      const livePaths = payload && payload.livePaths ? payload.livePaths : null;
      const paths = livePaths && livePaths.paths && typeof livePaths.paths === "object"
        ? livePaths.paths
        : null;

      if (!paths || !isLivePathsFresh(livePaths)) {
        return null;
      }

      const chargePowerW = Math.max(0, firstNumber(paths.pvToBank, 0) || 0) +
        Math.max(0, firstNumber(paths.gridToBank, 0) || 0);
      const dischargeLoadPowerW = Math.max(0, firstNumber(paths.bankToLoad, 0) || 0);
      const dischargeGridPowerW = Math.max(0, firstNumber(paths.bankToSell, paths.victronToSale, 0) || 0);

      return {
        chargePowerW: chargePowerW,
        dischargePowerW: dischargeLoadPowerW + dischargeGridPowerW
      };
    }

    function setCurrentStateValue(powerW, socPercent) {
      if (!currentStateValueEl) {
        return;
      }

      const powerText = powerW == null ? "--" : formatDecimal(powerW, 0);
      const socText = socPercent == null ? "--" : formatDecimal(socPercent, 0);
      currentStateValueEl.innerHTML = powerText + " <span>W / " + socText + " %</span>";
    }

    function updateCurrentBankSnapshot(payload) {
      const currentPayload = payload || window.dashboardLatestPayload || {};
      const measured = getMeasuredBreakdown(currentPayload);
      const livePower = getLiveBankPowerBreakdown(currentPayload);
      const chargePowerW = firstNumber(
        livePower && livePower.chargePowerW,
        measured.chargeKw != null ? measured.chargeKw * 1000 : null
      );
      const dischargePowerW = firstNumber(
        livePower && livePower.dischargePowerW,
        measured.dischargeKw != null ? measured.dischargeKw * 1000 : null
      );
      const status = getStatusState(
        (chargePowerW || 0) / 1000,
        (dischargePowerW || 0) / 1000
      );
      const currentPowerW = status.key === "charging"
        ? chargePowerW
        : (status.key === "discharging" ? dischargePowerW : firstNumber(chargePowerW, dischargePowerW, 0));
      const safeSoc = measured.socPercent == null ? null : clamp(measured.socPercent, 0, 100);

      setCurrentStateValue(currentPowerW, safeSoc);
      setKwhValue(storedEnergyValueEl, measured.levelKwh, 2);

      if (currentMeterThumbEl) {
        currentMeterThumbEl.style.left = safeSoc == null ? "0%" : safeSoc + "%";
      }
      if (currentStatusEl) {
        currentStatusEl.textContent = "Stan pracy: " + status.label;
        currentStatusEl.setAttribute("data-state", status.key);
      }
    }

    function updateMeasuredCards(payload, items) {
      const flowTotals = updateFlowSummary(items);

      updateCurrentBankSnapshot(payload);
      setKwhValue(dischargedEnergyValueEl, flowTotals.dischargeLoad + flowTotals.dischargeGrid, 2);
    }

    function updateCards(simulation, rangeWindow, items) {
      const rangeTotals = simulation ? simulation.getRangeTotals(rangeWindow) : null;
      const flowTotals = updateFlowSummary(items);

      updateCurrentBankSnapshot(window.dashboardLatestPayload || {});
      setKwhValue(
        dischargedEnergyValueEl,
        flowTotals.dischargeLoad + flowTotals.dischargeGrid,
        2
      );

      if (!simulation || !rangeTotals) {
        return;
      }
    }

    const state = {
      range: "day",
      anchorDate: new Date(),
      anchorSourceKey: "",
      anchorTouched: false,
      chart: null,
      items: [],
      bankSocValues: [],
      windowOrigin: "start",
      windowStartIndex: null,
      windowCount: null,
      zoom: 1,
      simulationPayload: null,
      simulationSignature: "",
      simulation: null
    };
    let currentHourHighlighter = null;
    let bankTimelineWorker = null;
    let bankTimelineWorkerRequestId = 0;
    let latestBankTimelineWorkerRequestId = 0;
    const bankTimelineWorkerRequests = new Map();

    function isBankDetailVisible() {
      return Boolean(
        bankPage &&
        !bankPage.hidden &&
        document.body &&
        document.body.getAttribute("data-active-detail-view") === "bank"
      );
    }

    function getCompactSignature(value) {
      if (value == null) {
        return "";
      }

      try {
        return JSON.stringify(value);
      } catch (error) {
        return String(value);
      }
    }

    function getRecordCollectionSignature(collection) {
      const records = collection && Array.isArray(collection.records) ? collection.records : [];
      if (!records.length) {
        return "0";
      }

      const first = records[0] || {};
      const last = records[records.length - 1] || {};
      return [
        records.length,
        first.date || first.data || first.timestamp || "",
        last.date || last.data || last.timestamp || "",
        getCompactSignature(last)
      ].join("|");
    }

    function getBankSimulationSignature(payload) {
      const sourcePayload = payload || {};
      const rawEnergy = sourcePayload.rawEnergy || {};
      const energy = sourcePayload.energy || {};
      const installedPowerKw = firstNumber(
        rawEnergy.installedPowerKw,
        rawEnergy.installationPowerKw,
        rawEnergy.mocInstalacjiKw,
        energy.installedPowerKw,
        BANK_DEFAULT_INSTALLED_POWER_KW
      );

      return [
        "bank-v2",
        installedPowerKw == null ? "" : installedPowerKw,
        getRecordCollectionSignature(sourcePayload.usageData),
        getRecordCollectionSignature(sourcePayload.weatherData),
        getRecordCollectionSignature(sourcePayload.priceHistory),
        JSON.stringify([sourcePayload.tariffHistory?.revision, sourcePayload.tariffHistory?.cacheKey]),
        getCompactSignature(sourcePayload.rce),
        getCompactSignature(sourcePayload.tariffData)
      ].join("||");
    }

    function publishBankSimulation(sourcePayload, signature, simulation, incrementalUpdate) {
      state.simulationPayload = sourcePayload;
      state.simulationSignature = signature;
      state.simulation = simulation;

      window.dashboardBaseProsumerSimulation = simulation;
      const activeSimulation = window.dashboardReForecastEnabled && window.dashboardReForecastSimulation
        ? window.dashboardReForecastSimulation
        : simulation;
      window.dashboardBankSimulation = activeSimulation;
      window.dashboardProsumerSimulation = activeSimulation;
      if (incrementalUpdate) {
        document.dispatchEvent(new CustomEvent("dashboard:bank-incremental-updated", {
          detail: activeSimulation
        }));
      } else {
        document.dispatchEvent(new CustomEvent("dashboard:bank-updated", {
          detail: activeSimulation
        }));
        document.dispatchEvent(new CustomEvent("dashboard:prosumer-updated", {
          detail: activeSimulation
        }));
      }
    }

    function getBankTimelineWorker() {
      if (bankTimelineWorker) {
        return bankTimelineWorker;
      }

      const workerSource = "(" + window.createDashboardProsumerEngine.toString() + ")(self);\n" +
        "self.addEventListener('message',function(event){" +
        "var message=event&&event.data?event.data:{};" +
        "try{" +
        "var currentDay=self.DashboardProsumerEngine.runCurrentDayTask(message.task||null);" +
        "self.postMessage({requestId:message.requestId,currentDay:currentDay});" +
        "}catch(error){" +
        "self.postMessage({requestId:message.requestId,error:error&&error.message?error.message:String(error)});" +
        "}" +
        "});";
      const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
      bankTimelineWorker = new Worker(workerUrl);
      URL.revokeObjectURL(workerUrl);
      bankTimelineWorker.addEventListener("message", function (event) {
        const message = event && event.data ? event.data : {};
        const pending = bankTimelineWorkerRequests.get(message.requestId);
        bankTimelineWorkerRequests.delete(message.requestId);
        if (!pending || message.requestId !== latestBankTimelineWorkerRequestId) {
          return;
        }
        if (message.error) {
          state.simulationSignature = "";
          console.error("Dashboard current-day worker error", message.error);
          return;
        }

        const simulation = finalizeBankSimulation(
          window.DashboardProsumerEngine.completeCurrentDayTask(pending.timeline.context, message.currentDay),
          pending.timeline
        );
        if (!simulation) {
          state.simulationSignature = "";
          return;
        }
        publishBankSimulation(pending.payload, pending.signature, simulation, true);
      });
      bankTimelineWorker.addEventListener("error", function (event) {
        state.simulationSignature = "";
        console.error("Dashboard current-day worker failed", event && event.message ? event.message : event);
      });
      return bankTimelineWorker;
    }

    function requestIncrementalBankSimulation(sourcePayload, signature) {
      const timeline = buildBankTimelineContext(sourcePayload);
      const task = timeline && typeof window.DashboardProsumerEngine.createCurrentDayTask === "function"
        ? window.DashboardProsumerEngine.createCurrentDayTask(timeline.context)
        : null;
      if (!timeline || !task) {
        return false;
      }

      const requestId = ++bankTimelineWorkerRequestId;
      latestBankTimelineWorkerRequestId = requestId;
      bankTimelineWorkerRequests.set(requestId, {
        payload: sourcePayload,
        signature: signature,
        timeline: timeline
      });
      state.simulationPayload = sourcePayload;
      state.simulationSignature = signature;
      getBankTimelineWorker().postMessage({
        requestId: requestId,
        task: task
      });
      return true;
    }

    function getCachedBankSimulation(payload) {
      const sourcePayload = payload || {};
      const signature = getBankSimulationSignature(sourcePayload);

      if (state.simulationSignature === signature) {
        state.simulationPayload = sourcePayload;
        return state.simulation;
      }

      if (sourcePayload.incrementalUpdate && requestIncrementalBankSimulation(sourcePayload, signature)) {
        return state.simulation;
      }

      const simulation = buildBankSimulation(sourcePayload);
      publishBankSimulation(sourcePayload, signature, simulation, Boolean(sourcePayload.incrementalUpdate));

      return simulation;
    }

    function updateToolbar() {
      const anchorDate = state.anchorDate;
      let label = formatLongDate(anchorDate);

      if (state.range === "week") {
        label = formatWeekLabel(anchorDate);
      } else if (state.range === "month") {
        label = formatMonthLabel(anchorDate);
      } else if (state.range === "year") {
        label = formatYearLabel(anchorDate);
      }

      if (breadcrumbRangeEl) {
        breadcrumbRangeEl.textContent = formatRangeName(state.range);
      }

      if (rangeLabelEl) {
        rangeLabelEl.textContent = label;
        window.DashboardCalendar.sync(rangeLabelEl, {
          date: state.anchorDate, range: state.range,
          clamp: function (date) { return clampDashboardNavigationDate(date, state.range); },
          select: function (date) {
            state.anchorTouched = true;
            state.anchorDate = clampDashboardNavigationDate(date, state.range);
            state.windowStartIndex = null;
            updateToolbar();
            applyPayload();
          }
        });
      }

      rangeButtons.forEach(function (button) {
        const isActive = button.getAttribute("data-bank-range") === state.range;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });

      updateDashboardShiftButtons(shiftButtons, state.range, state.anchorDate, "data-bank-shift");
    }

    function shiftRange(step) {
      let nextDate = new Date(state.anchorDate);
      if (state.range === "week") {
        nextDate = addDays(state.anchorDate, step * 7);
      } else if (state.range === "month") {
        nextDate = addMonths(state.anchorDate, step);
      } else if (state.range === "year") {
        nextDate = addYears(state.anchorDate, step);
      } else {
        nextDate = addDays(state.anchorDate, step);
      }

      state.anchorDate = clampDashboardNavigationDate(nextDate, state.range);
      state.anchorTouched = true;
      state.windowStartIndex = null;
      updateToolbar();
      applyPayload();
    }

    function applyPayload() {
      const payload = window.dashboardLatestPayload || {};
      const payloadAnchorDate = getPayloadAnchorDate(payload);
      const payloadAnchorKey = formatDateKey(payloadAnchorDate);

      if (!state.anchorSourceKey || (!state.anchorTouched && state.anchorSourceKey !== payloadAnchorKey)) {
        state.anchorDate = payloadAnchorDate;
        state.anchorSourceKey = payloadAnchorKey;
        updateToolbar();
      }

      state.anchorDate = clampDashboardNavigationDate(state.anchorDate, state.range);
      updateToolbar();
      const baseSimulation = getCachedBankSimulation(payload);
      const simulation = window.dashboardReForecastEnabled && window.dashboardReForecastSimulation
        ? window.dashboardReForecastSimulation
        : baseSimulation;

      if (!isBankDetailVisible()) {
        return;
      }

      const rangeWindow = getRangeWindow(state.range, state.anchorDate);
      const useForecastSimulation = !!(window.dashboardReForecastEnabled && simulation && simulation.isForecast);
      const rangeItems = useForecastSimulation
        ? buildForecastAwareBankRangeItems(payload, simulation, state.range, state.anchorDate)
        : buildRangeItems(simulation, state.range, state.anchorDate);
      const measuredItems = useForecastSimulation ? [] : buildMeasuredRangeItems(payload, state.range, state.anchorDate);
      const measuredBreakdown = useForecastSimulation ? {} : getMeasuredBreakdown(payload);
      const hasMeasuredBreakdown = measuredBreakdown.levelKwh != null
        || measuredBreakdown.socPercent != null
        || measuredBreakdown.chargeKw != null
        || measuredBreakdown.dischargeKw != null;

      if (isDashboardSelectionBeforeHistoryStart(state.range, state.anchorDate, payload)) {
        renderZeroState("Brak historii magazynu energii");
        if (hasMeasuredBreakdown) {
          updateMeasuredCards(payload, [], payloadAnchorDate);
        } else {
          updateCards(simulation, rangeWindow, [], payloadAnchorDate);
        }
      } else if (measuredItems.length) {
        renderBankChart(measuredItems);
        updateMeasuredCards(payload, measuredItems, payloadAnchorDate);
      } else if (hasMeasuredBreakdown) {
        if (simulation && rangeItems.length) {
          renderBankChart(rangeItems);
        } else {
          renderZeroState("Brak historii magazynu energii");
        }
        updateMeasuredCards(payload, rangeItems, payloadAnchorDate);
      } else if (!simulation || !rangeItems.length) {
        renderZeroState("Brak danych magazynu energii");
        updateCards(simulation, rangeWindow, rangeItems, payloadAnchorDate);
      } else {
        renderBankChart(rangeItems);
        updateCards(simulation, rangeWindow, rangeItems, payloadAnchorDate);
      }
    }

    rangeButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        state.range = button.getAttribute("data-bank-range") || "day";
        state.anchorDate = clampDashboardNavigationDate(state.anchorDate, state.range);
        state.anchorTouched = true;
        state.windowOrigin = getBankWindowOrigin(state.range);
        state.windowStartIndex = null;
        state.windowCount = null;
        updateToolbar();
        applyPayload();
      });
    });

    shiftButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        shiftRange(Number(button.getAttribute("data-bank-shift") || 0));
      });
    });

    zoomButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        const direction = Number(button.getAttribute("data-bank-chart-zoom") || 0);
        zoomBankChart(direction);
      });
    });

    if (zoomResetButton) {
      zoomResetButton.addEventListener("click", function () {
        jumpToCurrentBankDay();
      });
    }

    [currentDateButton, currentTimeButton].forEach(function (button) {
      if (!button) {
        return;
      }

      button.addEventListener("click", function () {
        jumpToCurrentBankDay();
      });
    });

    document.addEventListener("dashboard:payload-updated", applyPayload);
    document.addEventListener("dashboard:incremental-data-updated", applyPayload);
    document.addEventListener("dashboard:bank-incremental-updated", function () {
      if (isBankDetailVisible()) {
        applyPayload();
      }
    });
    document.addEventListener("dashboard:live-paths-updated", function (event) {
      const detail = event && event.detail ? event.detail : {};
      updateCurrentBankSnapshot(detail.payload || window.dashboardLatestPayload || {});
    });

    document.addEventListener("detailview:open", function (event) {
      if (!event.detail || event.detail.view !== "bank") {
        return;
      }

      requestAnimationFrame(function () {
        applyPayload();
        if (state.chart) {
          state.chart.resize();
          requestAnimationFrame(renderBankSunMarkersEcharts);
        }
      });
    });

    document.addEventListener("detailview:themechange", function () {
      if (state.chart && state.items.length) {
        renderBankChart(state.items);
        state.chart.resize();
      }
    });

    window.addEventListener("resize", function () {
      if (state.chart) {
        state.chart.resize();
        requestAnimationFrame(renderBankSunMarkersEcharts);
      }
    });

    updateToolbar();
    applyPayload();
  }

  function initSummaryView() {
    const summaryPage = document.getElementById("summary-detail");
    const breadcrumbRangeEl = document.getElementById("summary-breadcrumb-range");
    const rangeLabelEl = document.getElementById("summary-range-label");
    const currentListEl = document.getElementById("summary-current-list");
    const nextListEl = document.getElementById("summary-next-list");
    const currentBarEl = document.getElementById("summary-current-bar");
    const nextBarEl = document.getElementById("summary-next-bar");
    const currentTotalEl = document.getElementById("summary-current-total");
    const nextTotalEl = document.getElementById("summary-next-total");
    const nextSavingsEl = document.getElementById("summary-next-savings");
    const nextDepositCardEl = document.getElementById("summary-next-deposit-card");
    const nextDepositBalanceEl = document.getElementById("summary-next-deposit-balance");
    const nextDepositDaysEl = document.getElementById("summary-next-deposit-days");
    const nextDepositEarnedEl = document.getElementById("summary-next-deposit-earned");
    const nextDepositUsedEl = document.getElementById("summary-next-deposit-used");
    const currentDateButton = document.getElementById("summary-current-date");
    const currentTimeButton = document.getElementById("summary-current-time");
    const rangeButtons = Array.from(document.querySelectorAll("[data-summary-range]"));
    const shiftButtons = Array.from(document.querySelectorAll("[data-summary-shift]"));
    const toggleButtons = {
      current: document.querySelector("[data-summary-card-toggle='current']"),
      next: document.querySelector("[data-summary-card-toggle='next']")
    };
    const tariffToggleButtons = {
      current: document.querySelector("[data-summary-tariff-toggle='current']"),
      next: document.querySelector("[data-summary-tariff-toggle='next']")
    };
    const tariffPanels = {
      current: document.querySelector("[data-summary-tariff-panel='current']"),
      next: document.querySelector("[data-summary-tariff-panel='next']")
    };
    const tariffContents = {
      current: document.querySelector("[data-summary-tariff-content='current']"),
      next: document.querySelector("[data-summary-tariff-content='next']")
    };
    const tariffLabels = {
      current: document.querySelector("[data-summary-tariff-label='current']"),
      next: document.querySelector("[data-summary-tariff-label='next']")
    };
    const monthTitleFormatter = new Intl.DateTimeFormat("pl-PL", {
      month: "long",
      year: "numeric"
    });
    const DEFAULT_INSTALLED_POWER_KW = 5;
    const LIGHT_LUX_REFERENCE = 20000;
    const UVI_REFERENCE = 10.5;
    const SUMMARY_MAX_YEAR = 2026;

    if (!summaryPage) {
      return;
    }

    function numberOrNull(value) {
      if (value == null || value === "") {
        return null;
      }

      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }

    function firstNumber() {
      for (let i = 0; i < arguments.length; i += 1) {
        const numeric = numberOrNull(arguments[i]);
        if (numeric != null) {
          return numeric;
        }
      }

      return null;
    }

    function firstText() {
      for (let i = 0; i < arguments.length; i += 1) {
        const value = arguments[i];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }

      return "";
    }

    function shouldUseMeasuredUsageSplit(usageData) {
      return isMeasuredUsageDataset(usageData);
    }

    function clamp(value, min, max) {
      if (value == null) {
        return null;
      }

      return Math.min(Math.max(value, min), max);
    }

    function formatDecimal(value, digits) {
      return Number(value || 0).toFixed(digits == null ? 2 : digits).replace(".", ",");
    }

    function formatRangeName(range) {
      switch (range) {
        case "week":
          return "Tydzień";
        case "month":
          return "Miesiąc";
        case "year":
          return "Rok";
        default:
          return "Dzień";
      }
    }

    function formatLongDate(date) {
      return capitalize(weekdayFormatter.format(date)) + " " + dateFormatter.format(date);
    }

    function addDays(date, days) {
      const next = new Date(date);
      next.setDate(next.getDate() + days);
      return next;
    }

    function addMonths(date, months) {
      const next = new Date(date);
      next.setMonth(next.getMonth() + months);
      return next;
    }

    function addYears(date, years) {
      const next = new Date(date);
      next.setFullYear(next.getFullYear() + years);
      return next;
    }

    function formatWeekLabel(date) {
      const start = getStartOfWeek(date);
      const end = addDays(start, 6);
      return dateFormatter.format(start) + " - " + dateFormatter.format(end);
    }

    function formatMonthLabel(date) {
      return capitalize(monthTitleFormatter.format(date));
    }

    function formatYearLabel(date) {
      return String(date.getFullYear());
    }

    function clampSummaryAnchorDate(date) {
      const next = new Date(date);
      if (state.range === "year" && next.getFullYear() > SUMMARY_MAX_YEAR) {
        return new Date(SUMMARY_MAX_YEAR, 0, 1);
      }

      return clampDashboardNavigationDate(next, state.range);
    }

    function getStartOfWeek(date) {
      const next = new Date(date);
      const day = next.getDay();
      const shift = day === 0 ? -6 : 1 - day;

      next.setDate(next.getDate() + shift);
      return next;
    }

    function allocateByWeights(total, weights) {
      if (total == null) {
        return weights.map(function () {
          return null;
        });
      }

      const sum = weights.reduce(function (accumulator, value) {
        return accumulator + value;
      }, 0) || 1;
      let remaining = total;

      return weights.map(function (weight, index) {
        if (index === weights.length - 1) {
          return Math.max(remaining, 0);
        }

        const part = total * (weight / sum);
        remaining -= part;
        return part;
      });
    }

    function formatValue(value, unit, showUnitWhenEmpty) {
      if (value == null) {
        return showUnitWhenEmpty && unit ? ("-- " + unit) : "--";
      }

      return formatDecimal(value, 2) + " " + unit;
    }

    function setTotal(element, value) {
      if (!element) {
        return;
      }

      if (value == null) {
        element.innerHTML = "-- <span>PLN</span>";
        return;
      }

      element.innerHTML = formatDecimal(value, 2) + " <span>PLN</span>";
    }

    function setSavings(element, value) {
      if (!element) {
        return;
      }

      const valueElement = element.querySelector("strong");
      const hasValue = value != null;
      element.hidden = !hasValue;

      if (valueElement) {
        valueElement.innerHTML = hasValue
          ? ("+ " + formatDecimal(value, 2) + " <span>PLN</span>")
          : "-- <span>PLN</span>";
      }
    }

    function formatDepositAmount(value, unit, digits) {
      if (value == null) {
        return "--" + (unit ? " " + unit : "");
      }

      return formatDecimal(value, digits == null ? 2 : digits) + (unit ? " " + unit : "");
    }

    function renderDepositBox(model) {
      const ledger = model && model.depositLedger ? model.depositLedger : null;

      if (!nextDepositCardEl) {
        return;
      }

      nextDepositCardEl.hidden = !ledger;

      if (!ledger) {
        return;
      }

      const rangeWindow = getRangeWindow(state.range, state.anchorDate);
      const dailyBill = model.total != null && rangeWindow.days > 0
        ? model.total / rangeWindow.days
        : null;
      const estimatedCoverageDays = dailyBill && dailyBill > 0
        ? Math.floor((ledger.endBalancePln || 0) / dailyBill)
        : null;
      const coverageDays = firstNumber(ledger.coverageDays, estimatedCoverageDays);

      if (nextDepositBalanceEl) {
        nextDepositBalanceEl.innerHTML = formatDepositAmount(ledger.endBalancePln, "") + " <span>PLN</span>";
      }

      if (nextDepositDaysEl) {
        nextDepositDaysEl.textContent = coverageDays != null ? (coverageDays + " dni") : "-- dni";
      }

      if (nextDepositEarnedEl) {
        nextDepositEarnedEl.textContent =
          formatDepositAmount(ledger.earnedPln, "PLN") + " / " +
          formatDepositAmount(ledger.earnedKwh, "kWh", 1);
      }

      if (nextDepositUsedEl) {
        nextDepositUsedEl.textContent =
          formatDepositAmount(ledger.usedPln, "PLN") + " / " +
          formatDepositAmount(ledger.usedKwh, "kWh", 1);
      }
    }

    function buildModels(payload) {
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const usageKwh = firstNumber(rawEnergy.usageTodayKwh, rawEnergy.usageKwh, energy.usageKwh);
      const selfUseKwh = firstNumber(
        rawEnergy.selfConsumptionKwh,
        rawEnergy.autoconsumptionKwh,
        rawEnergy.autokonsumpcjaKwh,
        rawEnergy.selfUseKwh,
        usageKwh != null ? usageKwh * 0.22 : null
      );
      const purchaseKwh = firstNumber(
        rawEnergy.purchaseEnergyKwh,
        rawEnergy.purchaseKwh,
        rawEnergy.importKwh,
        rawEnergy.importEnergyKwh,
        rawEnergy.boughtEnergyKwh,
        rawEnergy.poborKwh,
        usageKwh != null ? Math.max(usageKwh - (selfUseKwh || 0), usageKwh * 0.52) : null
      );
      const purchasePricePln = firstNumber(rawEnergy.purchasePricePln, rawEnergy.purchasePrice, energy.purchasePricePln);
      const currentTotal = firstNumber(
        rawEnergy.currentBillPln,
        rawEnergy.billG11Pln,
        rawEnergy.dailyBillPln,
        energy.dailyBillPln,
        purchaseKwh != null && purchasePricePln != null ? purchaseKwh * purchasePricePln * 1.32 : null
      );
      const currentSavingsCandidate = firstNumber(
        rawEnergy.newPlanSavingsPln,
        rawEnergy.oszczednoscPln,
        energy.dailySavingsPln,
        currentTotal != null ? currentTotal * 0.18 : null
      );
      const savingsPln = currentTotal != null
        ? clamp(currentSavingsCandidate != null ? currentSavingsCandidate : currentTotal * 0.18, 0, currentTotal * 0.28)
        : currentSavingsCandidate;
      const nextTotal = currentTotal != null && savingsPln != null
        ? Math.max(currentTotal - savingsPln, currentTotal * 0.62)
        : null;
      const nextSelfUseKwh = firstNumber(
        rawEnergy.reflowSelfConsumptionKwh,
        rawEnergy.optimizedAutoconsumptionKwh,
        rawEnergy.reflowAutokonsumpcjaKwh,
        selfUseKwh != null ? Math.min(usageKwh != null ? usageKwh : Infinity, selfUseKwh * 1.18) : usageKwh != null ? usageKwh * 0.3 : null
      );
      const nextPurchaseKwh = firstNumber(
        rawEnergy.optimizedPurchaseEnergyKwh,
        rawEnergy.reflowPurchaseKwh,
        usageKwh != null ? Math.max(usageKwh - (nextSelfUseKwh || 0), usageKwh * 0.38) : purchaseKwh != null ? purchaseKwh * 0.82 : null
      );
      const currentParts = allocateByWeights(currentTotal, [0.43, 0.31, 0.18, 0.08]);
      const currentDistributionParts = allocateByWeights(currentParts[1], [0.39, 0.18, 0.21, 0.22]);
      const currentFixedParts = allocateByWeights(currentParts[2], [0.34, 0.38, 0.28]);
      const nextParts = allocateByWeights(nextTotal, [0.41, 0.29, 0.17, 0.13]);
      const nextDistributionParts = allocateByWeights(nextParts[1], [0.38, 0.17, 0.21, 0.24]);
      const nextFixedParts = allocateByWeights(nextParts[2], [0.34, 0.36, 0.30]);
      const scaleTotal = currentTotal != null
        ? currentTotal
        : (nextTotal != null ? nextTotal + (savingsPln || 0) : null);

      return {
        scaleTotal: scaleTotal,
        current: {
          total: currentTotal,
          barSegments: [
            { tone: "subscription", value: currentParts[3] },
            { tone: "fixed", value: currentParts[2] },
            { tone: "distribution", value: currentParts[1] },
            { tone: "purchase", value: currentParts[0] }
          ],
          items: [
            {
              id: "usage",
              tone: "energy",
              label: "Zużycie energii",
              value: usageKwh,
              unit: "kWh",
              details: [
                { label: "W tym autokonsumpcja", value: selfUseKwh, unit: "kWh" }
              ]
            },
            {
              id: "purchase",
              tone: "purchase",
              label: "Zakup energii",
              value: currentParts[0],
              unit: "PLN",
              details: [
                { label: "Energia zakupiona z sieci", value: purchaseKwh, unit: "kWh" }
              ]
            },
            {
              id: "distribution",
              tone: "distribution",
              label: "Dystrybucja energii",
              value: currentParts[1],
              unit: "PLN",
              details: [
                { label: "Opłata zmienna sieciowa", value: currentDistributionParts[0], unit: "PLN" },
                { label: "Opłata jakościowa", value: currentDistributionParts[1], unit: "PLN" },
                { label: "Opłata OZE", value: currentDistributionParts[2], unit: "PLN" },
                { label: "Opłata kogeneracyjna", value: currentDistributionParts[3], unit: "PLN" }
              ]
            },
            {
              id: "fixed",
              tone: "fixed",
              label: "Opłaty stałe",
              value: currentParts[2],
              unit: "PLN",
              details: [
                { label: "Opłata handlowa", value: currentFixedParts[0], unit: "PLN" },
                { label: "Składnik stały", value: currentFixedParts[1], unit: "PLN" },
                { label: "Opłata mocowa", value: currentFixedParts[2], unit: "PLN" }
              ]
            },
            {
              id: "subscription",
              tone: "subscription",
              label: "Stała cena abonamentu",
              value: currentParts[3],
              unit: "PLN",
              details: []
            }
          ]
        },
        next: {
          total: nextTotal,
          barSegments: [
            { tone: "subscription", value: nextParts[3] },
            { tone: "fixed", value: nextParts[2] },
            { tone: "distribution", value: nextParts[1] },
            { tone: "purchase", value: nextParts[0] },
            { tone: "savings", value: savingsPln }
          ],
          items: [
            {
              id: "usage",
              tone: "energy",
              label: "Zużycie energii",
              value: usageKwh,
              unit: "kWh",
              details: [
                { label: "W tym autokonsumpcja", value: nextSelfUseKwh, unit: "kWh" }
              ]
            },
            {
              id: "purchase",
              tone: "purchase",
              label: "Zakup energii",
              value: nextParts[0],
              unit: "PLN",
              details: [
                { label: "Energia zakupiona z sieci", value: nextPurchaseKwh, unit: "kWh" }
              ]
            },
            {
              id: "distribution",
              tone: "distribution",
              label: "Dystrybucja energii",
              value: nextParts[1],
              unit: "PLN",
              details: [
                { label: "Opłata zmienna sieciowa", value: nextDistributionParts[0], unit: "PLN" },
                { label: "Opłata jakościowa", value: nextDistributionParts[1], unit: "PLN" },
                { label: "Opłata OZE", value: nextDistributionParts[2], unit: "PLN" },
                { label: "Opłata kogeneracyjna", value: nextDistributionParts[3], unit: "PLN" }
              ]
            },
            {
              id: "fixed",
              tone: "fixed",
              label: "Opłaty stałe",
              value: nextParts[2],
              unit: "PLN",
              details: [
                { label: "Opłata handlowa", value: nextFixedParts[0], unit: "PLN" },
                { label: "Składnik stały", value: nextFixedParts[1], unit: "PLN" },
                { label: "Opłata mocowa", value: nextFixedParts[2], unit: "PLN" }
              ]
            },
            {
              id: "subscription",
              tone: "subscription",
              label: "Stała cena abonamentu",
              value: nextParts[3],
              unit: "PLN",
              details: []
            }
          ],
          savingsPln: savingsPln
        }
      };
    }

    function toStartOfDay(date) {
      const next = new Date(date);
      next.setHours(0, 0, 0, 0);
      return next;
    }

    function countCalendarDays(start, end) {
      const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
      const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
      return Math.max(1, Math.round((endUtc - startUtc) / 86400000) + 1);
    }

    function getMonthlyChargeFactor(start, end) {
      let factor = 0;

      for (let day = new Date(start); day <= end; day = addDays(day, 1)) {
        factor += 1 / new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
      }

      return factor;
    }

    function getRangeWindow(range, anchorDate) {
      const base = toStartOfDay(anchorDate);
      let start = new Date(base);
      let end = new Date(base);

      if (range === "week") {
        start = toStartOfDay(getStartOfWeek(base));
        end = toStartOfDay(addDays(start, 6));
      } else if (range === "month") {
        start = new Date(base.getFullYear(), base.getMonth(), 1);
        end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      } else if (range === "year") {
        start = new Date(base.getFullYear(), 0, 1);
        end = new Date(base.getFullYear(), 11, 31);
      }

      const days = countCalendarDays(start, end);

      return {
        start: start,
        end: end,
        days: days,
        monthlyChargeFactor: getMonthlyChargeFactor(start, end)
      };
    }

    function normalizeText(value) {
      return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[łŁ]/g, "l")
        .replace(/\s+/g, " ")
        .trim();
    }

    function sumTariffVariableRows(rows, matcher, windowCode) {
      return (rows || []).reduce(function (sum, row) {
        const rowCode = normalizeText(row && row.window_code ? row.window_code : "all");
        if (rowCode !== windowCode) {
          return sum;
        }

        if (!matcher(normalizeText(row && row.label))) {
          return sum;
        }

        return sum + (Number(row && row.price) || 0);
      }, 0);
    }

    function normalizeText(value) {
      let text = String(value || "").toLowerCase();
      const replacements = {
        "\u0105": "a",
        "\u0107": "c",
        "\u0119": "e",
        "\u0142": "l",
        "\u0144": "n",
        "\u00f3": "o",
        "\u015b": "s",
        "\u017a": "z",
        "\u017c": "z"
      };

      text = text.replace(/[\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c]/g, function (match) {
        return replacements[match] || match;
      });

      return text.replace(/\s+/g, " ").trim();
    }

    function getFixedMonthlyAmount(rows, matcher) {
      return (rows || []).reduce(function (sum, row) {
        return matcher(normalizeText(row && row.label))
          ? sum + (Number(row && row.amount) || 0)
          : sum;
      }, 0);
    }

    function pickSubscriptionMonthly(rows, billingCycleMonths) {
      const candidates = (rows || []).filter(function (row) {
        return normalizeText(row && row.label).indexOf("abonament") !== -1;
      });

      const exact = candidates.find(function (row) {
        return Number(row && row.billing_cycle_months) === billingCycleMonths;
      });

      if (exact) {
        return Number(exact.amount) || 0;
      }

      return candidates.length ? (Number(candidates[0].amount) || 0) : 0;
    }

    function pickPowerMonthly(rows, annualUsageKwh) {
      const candidates = (rows || []).filter(function (row) {
        return normalizeText(row && row.label).indexOf("mocowa") !== -1;
      });

      const match = candidates.find(function (row) {
        const min = numberOrNull(row && row.annual_usage_min_kwh);
        const max = numberOrNull(row && row.annual_usage_max_kwh);
        const meetsMin = min == null || annualUsageKwh >= min;
        const meetsMax = max == null || annualUsageKwh < max;
        return meetsMin && meetsMax;
      });

      if (match) {
        return Number(match.amount) || 0;
      }

      return candidates.length ? (Number(candidates[candidates.length - 1].amount) || 0) : 0;
    }

    function getZoneHours(tariff, rangeWindow, optimized) {
      const hours = { high: 0, mid: 0, low: 0 };
      const monthly = tariff && tariff.monthly ? tariff.monthly : null;

      if (!monthly) {
        hours.mid = rangeWindow.days * 24;
      } else {
        for (let day = new Date(rangeWindow.start); day <= rangeWindow.end; day = addDays(day, 1)) {
          const monthKey = String(day.getMonth() + 1);
          const row = monthly[monthKey] || monthly[day.getMonth() + 1];

          if (!row || !row.length) {
            hours.mid += 24;
            continue;
          }

          for (let hour = 0; hour < 24; hour += 1) {
            const zoneValue = Number(row[hour]) || 2;
            if (zoneValue === 1) {
              hours.high += 1;
            } else if (zoneValue === 3) {
              hours.low += 1;
            } else {
              hours.mid += 1;
            }
          }
        }
      }

      if (!optimized) {
        return hours;
      }

      return {
        high: (hours.high * 0.38) + (hours.mid * 0.04),
        mid: hours.mid * 0.92,
        low: (hours.low * 1.42) + (hours.mid * 0.12)
      };
    }

    function normalizeZoneShares(zoneHours) {
      const total = (zoneHours.high + zoneHours.mid + zoneHours.low) || 1;
      return {
        high: zoneHours.high / total,
        mid: zoneHours.mid / total,
        low: zoneHours.low / total
      };
    }

    function formatDateKey(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return year + "-" + month + "-" + day;
    }

    function parseDateKey(value) {
      if (typeof value !== "string" || !value.trim()) {
        return null;
      }

      const parsed = new Date(value.trim() + "T00:00:00");
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function parseSqlDateTime(value) {
      if (typeof value !== "string" || !value.trim()) {
        return null;
      }

      const normalized = value.trim().replace(" ", "T");
      const parsed = new Date(normalized);

      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function parseDateKey(value) {
      if (typeof value !== "string" || !value.trim()) {
        return null;
      }
      const parsed = new Date(value.trim() + "T00:00:00");
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function getSummaryAnchorDate(payload) {
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const records = usageData && Array.isArray(usageData.records) ? usageData.records : [];
      const latestUsageDate = parseDateKey(
        firstText(
          usageData && usageData.latestDate,
          records.length ? records[records.length - 1].date : null
        )
      );
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const energyDate = parseSqlDateTime(
        firstText(
          rawEnergy.datetime,
          rawEnergy.reading_time,
          rawEnergy.timestamp,
          energy.datetime,
          energy.reading_time,
          energy.timestamp
        )
      );

      return latestUsageDate || energyDate || new Date();
    }

    function inferMinuteFromLabel(label) {
      if (typeof label !== "string") {
        return null;
      }

      const match = label.match(/(\d{1,2}):(\d{2})/);
      return match ? clamp(Number(match[2]), 0, 59) : null;
    }

    function normalizeWeatherQuarterPoint(point, fallbackIndex) {
      const rawHour = firstNumber(point && point.hour, Math.floor(fallbackIndex / 4));
      const hour = clamp(Math.round(rawHour == null ? 0 : rawHour), 0, 23);
      const minute = clamp(Math.floor((firstNumber(
        point && point.minute,
        point && point.minuteOfHour,
        inferMinuteFromLabel(point && point.label)
      ) || 0) / 15) * 15, 0, 45);

      return {
        hour: hour,
        minute: minute,
        temperatureC: firstNumber(point && point.temperature_C, point && point.temperatureC),
        rainMm: firstNumber(point && point.rain_mm, point && point.rainMm),
        uvi: firstNumber(point && point.uvi),
        lightLux: firstNumber(point && point.light_lux, point && point.lightLux),
        isNight: Boolean(point && point.isNight) || hour < 5 || hour >= 20
      };
    }

    function createQuarterArray(factory) {
      return Array.from({ length: 96 }, function (_, index) {
        return factory(index);
      });
    }

    function buildQuarterWeatherSeries(rawPoints) {
      const normalizedPoints = (Array.isArray(rawPoints) ? rawPoints : [])
        .map(normalizeWeatherQuarterPoint)
        .filter(Boolean);

      if (!normalizedPoints.length) {
        return createQuarterArray(function () { return null; });
      }

      const shouldReplicateHourly = normalizedPoints.length <= 24 && normalizedPoints.every(function (point) {
        return point.minute === 0;
      });
      const buckets = createQuarterArray(function () {
        return {
          temperatureSum: 0,
          temperatureCount: 0,
          rainSum: 0,
          rainCount: 0,
          uviSum: 0,
          uviCount: 0,
          lightLuxSum: 0,
          lightLuxCount: 0,
          isNight: false,
          sampleCount: 0
        };
      });

      function applyPointToBucket(point, quarterIndex) {
        const bucket = buckets[(point.hour * 4) + quarterIndex];
        bucket.sampleCount += 1;
        bucket.isNight = point.isNight;

        if (point.temperatureC != null) {
          bucket.temperatureSum += point.temperatureC;
          bucket.temperatureCount += 1;
        }
        if (point.rainMm != null) {
          bucket.rainSum += point.rainMm;
          bucket.rainCount += 1;
        }
        if (point.uvi != null) {
          bucket.uviSum += point.uvi;
          bucket.uviCount += 1;
        }
        if (point.lightLux != null) {
          bucket.lightLuxSum += point.lightLux;
          bucket.lightLuxCount += 1;
        }
      }

      normalizedPoints.forEach(function (point) {
        if (shouldReplicateHourly) {
          for (let quarterIndex = 0; quarterIndex < 4; quarterIndex += 1) {
            applyPointToBucket(point, quarterIndex);
          }
          return;
        }

        applyPointToBucket(point, clamp(Math.floor(point.minute / 15), 0, 3));
      });

      return buckets.map(function (bucket, index) {
        if (!bucket.sampleCount) {
          return null;
        }

        return {
          hour: Math.floor(index / 4),
          quarter: index % 4,
          isNight: bucket.isNight,
          temperatureC: bucket.temperatureCount ? bucket.temperatureSum / bucket.temperatureCount : null,
          rainMm: bucket.rainCount ? bucket.rainSum / bucket.rainCount : null,
          uvi: bucket.uviCount ? bucket.uviSum / bucket.uviCount : null,
          lightLux: bucket.lightLuxCount ? bucket.lightLuxSum / bucket.lightLuxCount : null
        };
      });
    }

    function getSolarCurveRatio(hour, quarter) {
      const decimalHour = hour + (quarter * 0.25);
      if (decimalHour < 5 || decimalHour > 20) {
        return 0;
      }

      const phase = (decimalHour - 5) / 15;
      return Math.pow(Math.sin(Math.PI * clamp(phase, 0, 1)), 1.35);
    }

    function getQuarterProduction(sample, installedPowerKw) {
      if (!sample) {
        return { energyKwh: null, powerKw: null };
      }

      if (sample.isNight) {
        return { energyKwh: 0, powerKw: 0 };
      }

      const luxRatio = sample.lightLux == null ? null : clamp(sample.lightLux / LIGHT_LUX_REFERENCE, 0, 1.15);
      const uviRatio = sample.uvi == null ? null : clamp(sample.uvi / UVI_REFERENCE, 0, 1.15);
      let solarRatio = null;

      if (luxRatio != null && uviRatio != null) {
        solarRatio = clamp(Math.max(luxRatio, uviRatio * 0.96), 0, 1);
      } else if (luxRatio != null || uviRatio != null) {
        solarRatio = clamp(luxRatio != null ? luxRatio : uviRatio, 0, 1);
      } else {
        solarRatio = getSolarCurveRatio(sample.hour, sample.quarter) * 0.68;
      }

      const temperaturePenalty = sample.temperatureC != null && sample.temperatureC > 25
        ? clamp(1 - ((sample.temperatureC - 25) * 0.0045), 0.82, 1)
        : 1;
      const rainPenalty = sample.rainMm != null
        ? clamp(1 - (Math.min(sample.rainMm, 2.2) * 0.18), 0.45, 1)
        : 1;
      const powerKw = clamp(installedPowerKw * solarRatio * temperaturePenalty * rainPenalty, 0, installedPowerKw);

      return {
        powerKw: powerKw,
        energyKwh: powerKw * 0.25
      };
    }

    function estimatePvAutoconsumptionForRange(payload, rangeWindow, tariff) {
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const weatherData = payload && payload.weatherData ? payload.weatherData : null;
      if (!usageData || !Array.isArray(usageData.records) || !weatherData || !Array.isArray(weatherData.records)) {
        return null;
      }

      const installedPowerKw = firstNumber(
        payload && payload.rawEnergy && payload.rawEnergy.installedPowerKw,
        payload && payload.rawEnergy && payload.rawEnergy.installationPowerKw,
        payload && payload.rawEnergy && payload.rawEnergy.mocInstalacjiKw,
        DEFAULT_INSTALLED_POWER_KW
      );
      const startKey = formatDateKey(rangeWindow.start);
      const endKey = formatDateKey(rangeWindow.end);
      const weatherByDate = new Map(weatherData.records
        .filter(function (record) {
          return record && typeof record.date === "string" && Array.isArray(record.hours);
        })
        .map(function (record) {
          return [record.date, buildQuarterWeatherSeries(record.hours)];
        }));
      const totals = {
        pvKwh: 0,
        pvByZone: {
          all: 0,
          high: 0,
          mid: 0,
          low: 0
        }
      };
      let hasEstimate = false;

      usageData.records.forEach(function (record) {
        const dateKey = String(record && record.date ? record.date : "");
        const weatherQuarters = weatherByDate.get(dateKey);
        if (!dateKey || dateKey < startKey || dateKey > endKey || !Array.isArray(record.quarters) || !weatherQuarters) {
          return;
        }

        record.quarters.forEach(function (quarter, index) {
          const rawPv = numberOrNull(quarter && quarter.pv) || 0;
          if (rawPv > 0) {
            return;
          }

          const grid = numberOrNull(quarter && quarter.grid) || 0;
          if (grid <= 0) {
            return;
          }

          const weatherQuarter = weatherQuarters[index] || null;
          const production = getQuarterProduction(weatherQuarter, installedPowerKw);
          const estimatedPvKwh = production && production.energyKwh != null
            ? Math.min(production.energyKwh, grid)
            : 0;

          if (estimatedPvKwh <= 0) {
            return;
          }

          hasEstimate = true;
          totals.pvKwh += estimatedPvKwh;
          totals.pvByZone.all += estimatedPvKwh;

          if (tariff && ((tariff.zone_model || "") === "highmidlow" || tariff.use_monthly)) {
            const hour = getQuarterHour(quarter, index);
            const zoneCode = getZoneCodeForDateHour(tariff, dateKey, hour);
            totals.pvByZone[zoneCode] += estimatedPvKwh;
          }
        });
      });

      return hasEstimate ? totals : null;
    }

    function isTwoZoneTariff(tariff) {
      return tariff && (tariff.zone_model === "daynight" || tariff.zone_model === "peakoffpeak");
    }

    const summaryZoneProviders = new WeakMap();

    function getZoneCodeForDateHour(tariff, dateKey, hour) {
      if (tariff?.clientTariffHistory?.strict) return ReTariffEngine.zone(ReTariffEngine.resolve(tariff.clientTariffHistory, dateKey, null), dateKey, hour);
      if (isTwoZoneTariff(tariff)) {
        // Use the same calendar/zone rules as the simulation, including cheap weekends.
        if (!summaryZoneProviders.has(tariff)) {
          summaryZoneProviders.set(tariff, window.DashboardProsumerEngine.createPriceProvider({ tariff: tariff }));
        }
        return summaryZoneProviders.get(tariff).getSlotPrice(dateKey, { hour: hour, index: hour * 4 }).windowCode;
      }
      const monthNumber = parseInt(String(dateKey || "").slice(5, 7), 10);
      const monthly = tariff && tariff.monthly ? tariff.monthly : null;
      const row = monthly && monthNumber ? (monthly[String(monthNumber)] || monthly[monthNumber]) : null;
      const zoneValue = row && row.length ? (Number(row[hour]) || 2) : 2;

      if (zoneValue === 1) {
        return "high";
      }
      if (zoneValue === 3) {
        return "low";
      }
      return "mid";
    }

    function aggregateUsageForRange(usageData, rangeWindow, tariff) {
      if (!usageData || !Array.isArray(usageData.records)) {
        return null;
      }

      const startKey = formatDateKey(rangeWindow.start);
      const endKey = formatDateKey(rangeWindow.end);
      const measuredUsageSplit = shouldUseMeasuredUsageSplit(usageData);
      const totals = {
        usageKwh: 0,
        purchaseKwh: 0,
        storageKwh: 0,
        pvKwh: 0,
        usageByZone: {
          all: 0,
          high: 0,
          mid: 0,
          low: 0
        },
        pvByZone: {
          all: 0,
          high: 0,
          mid: 0,
          low: 0
        },
        storageByZone: {
          all: 0,
          high: 0,
          mid: 0,
          low: 0
        },
        purchaseByZone: {
          all: 0,
          high: 0,
          mid: 0,
          low: 0
        }
      };
      let hasValues = false;

      [totals.usageByZone, totals.pvByZone, totals.storageByZone, totals.purchaseByZone].forEach(function (zones) {
        zones.day = zones.night = zones.peak = zones.offpeak = 0;
      });

      usageData.records.forEach(function (record) {
        const dateKey = String(record && record.date ? record.date : "");
        if (!dateKey || dateKey < startKey || dateKey > endKey || !Array.isArray(record.quarters)) {
          return;
        }

        record.quarters.forEach(function (quarter, index) {
          const gridPhysical = firstNumber(quarter && quarter.gridPhysical, quarter && quarter.grid, 0) || 0;
          const grid = firstNumber(quarter && quarter.gridBilled, quarter && quarter.billedGrid, gridPhysical, 0) || 0;
          const storage = numberOrNull(quarter && quarter.storage) || 0;
          const pv = numberOrNull(quarter && quarter.pv) || 0;
          const total = gridPhysical + storage + pv;

          if (total > 0) {
            hasValues = true;
          }

          totals.usageKwh += total;
          totals.purchaseKwh += grid;
          totals.storageKwh += storage;
          totals.pvKwh += pv;
          totals.usageByZone.all += total;
          totals.pvByZone.all += pv;
          totals.storageByZone.all += storage;
          totals.purchaseByZone.all += grid;

          if (tariff && (isTwoZoneTariff(tariff) || (tariff.zone_model || "") === "highmidlow" || tariff.use_monthly)) {
            const hour = getQuarterHour(quarter, index);
            const zoneCode = getZoneCodeForDateHour(tariff, dateKey, hour);
            totals.usageByZone[zoneCode] += total;
            totals.pvByZone[zoneCode] += pv;
            totals.storageByZone[zoneCode] += storage;
            totals.purchaseByZone[zoneCode] += grid;
          }
        });
      });

      return hasValues ? totals : null;
    }

    function scalePurchaseByZone(purchaseByZone, targetTotal) {
      const source = purchaseByZone || { all: 0, high: 0, mid: 0, low: 0 };
      const currentTotal = source.all || (source.high + source.mid + source.low);
      if (targetTotal == null) {
        return null;
      }

      if (targetTotal <= 0) {
        return {
          all: 0,
          high: 0,
          mid: 0,
          low: 0
        };
      }

      if (!currentTotal) {
        return null;
      }

      const scale = targetTotal / currentTotal;
      return {
        all: targetTotal,
        high: source.high * scale,
        mid: source.mid * scale,
        low: source.low * scale
      };
    }

    function subtractZoneTotals(baseTotals, deductionTotals) {
      const base = baseTotals || { all: 0, high: 0, mid: 0, low: 0 };
      const deduction = deductionTotals || { all: 0, high: 0, mid: 0, low: 0 };

      return {
        all: Math.max((base.all || 0) - (deduction.all || 0), 0),
        high: Math.max((base.high || 0) - (deduction.high || 0), 0),
        mid: Math.max((base.mid || 0) - (deduction.mid || 0), 0),
        low: Math.max((base.low || 0) - (deduction.low || 0), 0),
        day: Math.max((base.day || 0) - (deduction.day || 0), 0),
        night: Math.max((base.night || 0) - (deduction.night || 0), 0),
        peak: Math.max((base.peak || 0) - (deduction.peak || 0), 0),
        offpeak: Math.max((base.offpeak || 0) - (deduction.offpeak || 0), 0)
      };
    }

    function getPayloadRceForDate(payload, dateKey) {
      const priceHistory = payload && payload.priceHistory ? payload.priceHistory : null;
      const byDate = priceHistory && priceHistory.rceByDate ? priceHistory.rceByDate : null;

      if (byDate && dateKey && Object.prototype.hasOwnProperty.call(byDate, dateKey)) {
        return byDate[dateKey];
      }

      const rce = payload && payload.rce ? payload.rce : null;
      return rce && rce.businessDate === dateKey ? rce : null;
    }

    function resolveRcePriceForDateHour(payload, dateKey, hour) {
      const rce = getPayloadRceForDate(payload, dateKey);
      const hourlyRates = rce && Array.isArray(rce.hourlyRates) ? rce.hourlyRates : [];

      for (let index = 0; index < hourlyRates.length; index += 1) {
        const entry = hourlyRates[index];
        if (Number(entry && entry.hour) === hour) {
          return firstNumber(entry && entry.pricePln, entry && entry.price, entry && entry.value);
        }
      }

      return firstNumber(rce && rce.currentPricePln);
    }

    function resolveEnergyPurchaseRate(tariff, dateKey, hour, rcePricePln) {
      if (tariff?.clientTariffHistory?.strict) return ReTariffEngine.rates(ReTariffEngine.resolve(tariff.clientTariffHistory, dateKey, null), dateKey, hour, rcePricePln).energy;
      if (!tariff) {
        return null;
      }

      const variableRows = Array.isArray(tariff.variable) ? tariff.variable : [];
      const sellMethod = normalizeText(tariff.sell_method || "fixed");
      const windowCode = isTwoZoneTariff(tariff) || (tariff.zone_model || "") === "highmidlow" || tariff.use_monthly
        ? getZoneCodeForDateHour(tariff, dateKey, hour)
        : "all";
      const energyRate = sumTariffVariableRows(variableRows, function (label) {
        return label.indexOf("energia") !== -1;
      }, windowCode);

      if (sellMethod === "rdn") {
        const rcePrice = firstNumber(rcePricePln);
        return rcePrice == null ? null : rcePrice;
      }

      return energyRate;
    }

    function getRecordByDate(dataset, dateKey) {
      const records = dataset && Array.isArray(dataset.records) ? dataset.records : [];
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (String(record && record.date ? record.date : "") === dateKey) {
          return record;
        }
      }

      return null;
    }

    function collectPayloadDateKeys(payload, endKey, startKey) {
      const keys = {};
      const sources = [
        payload && payload.usageData,
        payload && payload.pvData
      ];

      sources.forEach(function (dataset) {
        const records = dataset && Array.isArray(dataset.records) ? dataset.records : [];
        records.forEach(function (record) {
          const dateKey = String(record && record.date ? record.date : "");
          if (dateKey && (!startKey || dateKey >= startKey) && dateKey <= endKey) {
            keys[dateKey] = true;
          }
        });
      });

      return Object.keys(keys).sort();
    }

    function getQuarterHour(quarter, index) {
      const rawHour = firstNumber(quarter && quarter.hour, Math.floor(index / 4));
      return clamp(Math.round(rawHour == null ? Math.floor(index / 4) : rawHour), 0, 23);
    }

    function buildMeasuredDepositLedger(payload, rangeWindow, tariff) {
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const pvData = payload && payload.pvData ? payload.pvData : null;

      if (!shouldUseMeasuredUsageSplit(usageData) || !rangeWindow || !tariff) {
        return null;
      }

      const rangeStartKey = formatDateKey(rangeWindow.start);
      const rangeEndKey = formatDateKey(rangeWindow.end);
      const depositStartKey = getDashboardHistoryStartKey(payload);
      const dateKeys = collectPayloadDateKeys(payload, rangeEndKey, depositStartKey);
      let balancePln = getDashboardDepositStartPln(payload);
      const result = {
        startBalancePln: balancePln,
        earnedPln: 0,
        earnedKwh: 0,
        usedPln: 0,
        usedKwh: 0,
        eligiblePurchasePln: 0,
        endBalancePln: balancePln
      };

      dateKeys.forEach(function (dateKey) {
        const usageRecord = getRecordByDate(usageData, dateKey);
        const pvRecord = getRecordByDate(pvData, dateKey);
        const isInRange = dateKey >= rangeStartKey && dateKey <= rangeEndKey;

        if (isInRange && dateKey === rangeStartKey) {
          result.startBalancePln = balancePln;
        }

        const usageQuarters = usageRecord && Array.isArray(usageRecord.quarters) ? usageRecord.quarters : [];
        const pvQuarters = pvRecord && Array.isArray(pvRecord.quarters) ? pvRecord.quarters : [];

        const hourBalances = Array.from({ length: 24 }, function () {
          return { physicalImportKwh: 0, physicalExportKwh: 0 };
        });
        const slotCount = Math.max(usageQuarters.length, pvQuarters.length) || 96;

        for (let index = 0; index < slotCount; index += 1) {
          const usageQuarter = usageQuarters[index] || null;
          const pvQuarter = pvQuarters[index] || null;
          const hour = getQuarterHour(usageQuarter || pvQuarter, index);
          hourBalances[hour].physicalImportKwh += getQuarterPhysicalImportKwh(usageQuarter);
          hourBalances[hour].physicalExportKwh += getQuarterPhysicalExportKwh(usageQuarter, pvQuarter);
        }

        for (let hour = 0; hour < 24; hour += 1) {
          const physicalImportKwh = hourBalances[hour].physicalImportKwh;
          const physicalExportKwh = hourBalances[hour].physicalExportKwh;
          const saleKwh = Math.max(physicalExportKwh - physicalImportKwh, 0);
          const gridKwh = Math.max(physicalImportKwh - physicalExportKwh, 0);
          const rcePricePln = resolveRcePriceForDateHour(payload, dateKey, hour);
          const salePricePln = getProsumerSalePricePln(rcePricePln) || 0;
          const purchaseRatePln = resolveEnergyPurchaseRate(tariff, dateKey, hour, rcePricePln) || 0;
          const earnedPln = saleKwh * salePricePln;
          const eligiblePurchasePln = gridKwh * purchaseRatePln;

          balancePln += earnedPln;
          const usedPln = Math.min(balancePln, eligiblePurchasePln);
          const usedKwh = eligiblePurchasePln > 0 ? gridKwh * (usedPln / eligiblePurchasePln) : 0;
          balancePln -= usedPln;

          if (isInRange) {
            result.earnedPln += earnedPln;
            result.earnedKwh += saleKwh;
            result.eligiblePurchasePln += eligiblePurchasePln;
            result.usedPln += usedPln;
            result.usedKwh += usedKwh;
          }
        }
      });

      result.endBalancePln = balancePln;

      return result;
    }

    function shouldUseSummaryForecast() {
      return !!(state.forceForecast || window.dashboardReForecastEnabled);
    }

    function getSummaryForecastSimulation(rangeWindow) {
      if (!shouldUseSummaryForecast()) {
        return null;
      }

      return typeof window.getDashboardForecastSimulationForRange === "function"
        ? window.getDashboardForecastSimulationForRange(rangeWindow)
        : null;
    }

    function getSummarySimulationForRange(rangeWindow) {
      const forecastSimulation = getSummaryForecastSimulation(rangeWindow);
      return forecastSimulation || window.dashboardProsumerSimulation || window.dashboardBankSimulation || null;
    }

    function estimateSimulationDepositUsedKwh(simulation, rangeWindow) {
      if (!simulation || !Array.isArray(simulation.days) || !rangeWindow) {
        return null;
      }

      const startKey = formatDateKey(rangeWindow.start);
      const endKey = formatDateKey(rangeWindow.end);
      let totalKwh = 0;
      let hasValue = false;

      simulation.days.forEach(function (day) {
        if (!day || day.dateKey < startKey || day.dateKey > endKey) {
          return;
        }

        const entries = Array.isArray(day.slots) && day.slots.length
          ? day.slots
          : (Array.isArray(day.hours) ? day.hours : []);

        entries.forEach(function (entry) {
          const explicitKwh = firstNumber(entry && entry.depositUsedKwh, entry && entry.billedDepositUsedKwh);
          if (explicitKwh != null) {
            totalKwh += explicitKwh;
            hasValue = true;
            return;
          }

          const usedPln = firstNumber(entry && entry.depositUsedPln, entry && entry.billedDepositUsedPln, 0) || 0;
          if (usedPln <= 0) {
            return;
          }

          const purchaseKwh = (firstNumber(
            entry && entry.billedGridPurchaseForLoadKwh,
            entry && entry.gridPurchaseForLoadKwh,
            entry && entry.gridBuyLoad,
            0
          ) || 0) + (firstNumber(entry && entry.gridTopupKwh, entry && entry.gridToBankKwh, 0) || 0);
          const purchasePln = firstNumber(
            entry && entry.gridPurchaseCostPln,
            entry && entry.purchaseCostPln,
            entry && entry.energyBuyCostPln,
            entry && entry.nominalCostPln
          );

          if (purchaseKwh > 0 && purchasePln != null && purchasePln > 0) {
            totalKwh += purchaseKwh * Math.min(1, usedPln / purchasePln);
            hasValue = true;
            return;
          }

          const ratePln = firstNumber(entry && entry.energyBuyPricePln, entry && entry.buyPricePln, entry && entry.purchasePricePln);
          if (ratePln != null && ratePln > 0) {
            totalKwh += usedPln / ratePln;
            hasValue = true;
          }
        });
      });

      return hasValue ? totalKwh : null;
    }

    function buildSimulationDepositLedger(rangeWindow, rangeTotals, simulation) {
      const totals = rangeTotals && rangeTotals.totals ? rangeTotals.totals : null;
      if (!rangeWindow || !totals) {
        return null;
      }

      const earnedPln = firstNumber(totals.depositEarnedPln);
      const usedPln = firstNumber(
        totals.depositUsedPln,
        totals.buyOwnFromDepositPln != null || totals.buyBankFromDepositPln != null
          ? (totals.buyOwnFromDepositPln || 0) + (totals.buyBankFromDepositPln || 0)
          : null
      );
      const earnedKwh = firstNumber(
        totals.billedGridExportKwh,
        totals.exportKwh,
        totals.soldImmediateKwh != null || totals.soldBankKwh != null
          ? (totals.soldImmediateKwh || 0) + (totals.soldBankKwh || 0)
          : null
      );
      const usedKwh = firstNumber(totals.depositUsedKwh, estimateSimulationDepositUsedKwh(simulation, rangeWindow));
      const endBalancePln = firstNumber(rangeTotals.endDepositPln);

      if (earnedPln == null && usedPln == null && earnedKwh == null && usedKwh == null && endBalancePln == null) {
        return null;
      }

      return {
        startBalancePln: firstNumber(rangeTotals.startDepositPln, 0) || 0,
        earnedPln: earnedPln || 0,
        earnedKwh: earnedKwh || 0,
        usedPln: usedPln || 0,
        usedKwh: usedKwh || 0,
        eligiblePurchasePln: firstNumber(totals.eligiblePurchasePln, 0) || 0,
        endBalancePln: endBalancePln || 0,
        coverageDays: getDashboardDepositCoverageDays(simulation, formatDateKey(rangeWindow.start))
      };
    }

    function buildPowerFeeUsageByMonth(payload, rangeWindow, tariff) {
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const forecastSimulation = getSummaryForecastSimulation(rangeWindow);
      const usageByMonth = {};

      for (let year = rangeWindow.start.getFullYear(); year <= rangeWindow.end.getFullYear(); year += 1) {
        const lastMonth = year === rangeWindow.end.getFullYear() ? rangeWindow.end.getMonth() : 11;

        for (let month = 0; month <= lastMonth; month += 1) {
          const monthWindow = {
            start: new Date(year, month, 1),
            end: new Date(year, month + 1, 0)
          };
          const monthKey = year + "-" + String(month + 1).padStart(2, "0");
          let usageKwh = null;

          if (forecastSimulation && typeof forecastSimulation.getRangeTotals === "function") {
            const rangeTotals = forecastSimulation.getRangeTotals(monthWindow);
            usageKwh = firstNumber(
              rangeTotals && rangeTotals.totals && rangeTotals.totals.usageKwh,
              rangeTotals && rangeTotals.totals && rangeTotals.totals.oldUsageKwh
            );
          } else {
            const aggregate = aggregateUsageForRange(usageData, monthWindow, tariff);
            usageKwh = aggregate ? aggregate.usageKwh : 0;
          }

          usageByMonth[monthKey] = Math.max(0, usageKwh || 0);
        }
      }

      return usageByMonth;
    }

    function getFixedCostOptions(payload, optimized) {
      const account = payload && payload.account ? payload.account : {};
      const settings = account && account.tariffSettings && typeof account.tariffSettings === "object"
        ? account.tariffSettings
        : {};
      const selected = optimized
        ? (settings.target && typeof settings.target === "object" ? settings.target : {})
        : (settings.current && typeof settings.current === "object" ? settings.current : {});

      return {
        billingCycleMonths: firstNumber(
          selected.billingCycleMonths,
          selected.billing_cycle_months,
          settings.billingCycleMonths,
          account.billingCycleMonths,
          account.billing_cycle_months,
          1
        ) || 1,
        contractPowerKw: firstNumber(
          selected.contractPowerKw,
          selected.contract_power_kw,
          settings.contractPowerKw,
          account.contractPowerKw,
          account.contract_power_kw,
          0
        ) || 0
      };
    }

    function fixedRowAppliesForMonth(row, yearUsageKwh, billingCycleMonths) {
      const rowCycle = numberOrNull(row && row.billing_cycle_months);
      const usageMin = numberOrNull(row && row.annual_usage_min_kwh);
      const usageMax = numberOrNull(row && row.annual_usage_max_kwh);

      return (rowCycle == null || rowCycle === billingCycleMonths) &&
        (usageMin == null || yearUsageKwh >= usageMin) &&
        (usageMax == null || yearUsageKwh < usageMax);
    }

    function getFixedRowMonthlyCost(row, contractPowerKw) {
      const amount = Number(row && row.amount) || 0;
      const amountMode = String(row && row.amount_mode ? row.amount_mode : "flat_month").toLowerCase();
      return amountMode === "per_kw_month" ? amount * contractPowerKw : amount;
    }

    function calculateFixedRowsForRange(rows, rangeWindow, usageByMonth, options) {
      const totalsByLabel = new Map();
      const billingCycleMonths = Number(options && options.billingCycleMonths) || 1;
      const contractPowerKw = Number(options && options.contractPowerKw) || 0;

      for (let year = rangeWindow.start.getFullYear(); year <= rangeWindow.end.getFullYear(); year += 1) {
        const lastMonth = year === rangeWindow.end.getFullYear() ? rangeWindow.end.getMonth() : 11;
        let yearUsageKwh = 0;

        for (let month = 0; month <= lastMonth; month += 1) {
          const monthKey = year + "-" + String(month + 1).padStart(2, "0");
          const monthStart = new Date(year, month, 1);
          const monthEnd = new Date(year, month + 1, 0);
          const overlapStart = rangeWindow.start > monthStart ? rangeWindow.start : monthStart;
          const overlapEnd = rangeWindow.end < monthEnd ? rangeWindow.end : monthEnd;

          yearUsageKwh += Number(usageByMonth && usageByMonth[monthKey]) || 0;
          if (overlapStart > overlapEnd) {
            continue;
          }

          const monthFraction = countCalendarDays(overlapStart, overlapEnd) / monthEnd.getDate();
          (rows || []).forEach(function (row) {
            if (!fixedRowAppliesForMonth(row, yearUsageKwh, billingCycleMonths)) {
              return;
            }

            const label = String(row && row.label ? row.label : "Opłata stała").trim();
            const key = normalizeText(label);
            const monthlyCost = getFixedRowMonthlyCost(row, contractPowerKw);
            const existing = totalsByLabel.get(key) || { label: label, value: 0 };
            existing.value += monthlyCost * monthFraction;
            totalsByLabel.set(key, existing);
          });
        }
      }

      return Array.from(totalsByLabel.values());
    }

    function buildTariffBreakdown(tariff, purchaseKwh, rangeWindow, optimized, purchaseByZoneInput, powerUsageByMonth, fixedCostOptions) {
      if (!tariff) {
        return null;
      }

      const variableRows = Array.isArray(tariff.variable) ? tariff.variable : [];
      const fixedRows = Array.isArray(tariff.fixed) ? tariff.fixed : [];
      const calculatedFixedRows = calculateFixedRowsForRange(
        fixedRows,
        rangeWindow,
        powerUsageByMonth,
        fixedCostOptions
      );
      const qualityRate = sumTariffVariableRows(variableRows, function (label) {
        return label.indexOf("jak") !== -1;
      }, "all");
      const ozeRate = sumTariffVariableRows(variableRows, function (label) {
        return label.indexOf("oze") !== -1;
      }, "all");
      const cogenerationRate = sumTariffVariableRows(variableRows, function (label) {
        return label.indexOf("kogener") !== -1;
      }, "all");
      const sellMethod = normalizeText(tariff && tariff.sell_method ? tariff.sell_method : "fixed");

      let purchaseCost = 0;
      let distributionNetworkCost = 0;

      if (isTwoZoneTariff(tariff)) {
        getTariffZoneDefinitions(tariff).forEach(function (zone) {
          const quantity = Number(purchaseByZoneInput && purchaseByZoneInput[zone.code]) || 0;
          purchaseCost += quantity * sumTariffVariableRows(variableRows, function (label) {
            return label.indexOf("energia") !== -1;
          }, zone.code);
          distributionNetworkCost += quantity * sumTariffVariableRows(variableRows, function (label) {
            return label.indexOf("sieciowa") !== -1;
          }, zone.code);
        });
      } else if ((tariff.zone_model || "") === "highmidlow" || tariff.use_monthly) {
        const purchaseByZone = purchaseByZoneInput || (function () {
          const zoneShares = normalizeZoneShares(getZoneHours(tariff, rangeWindow, optimized));
          return {
            all: purchaseKwh || 0,
            high: (purchaseKwh || 0) * zoneShares.high,
            mid: (purchaseKwh || 0) * zoneShares.mid,
            low: (purchaseKwh || 0) * zoneShares.low
          };
        }());
        const energyRates = {
          high: sumTariffVariableRows(variableRows, function (label) { return label.indexOf("energia") !== -1; }, "high"),
          mid: sumTariffVariableRows(variableRows, function (label) { return label.indexOf("energia") !== -1; }, "mid"),
          low: sumTariffVariableRows(variableRows, function (label) { return label.indexOf("energia") !== -1; }, "low")
        };
        const networkRates = {
          high: sumTariffVariableRows(variableRows, function (label) { return label.indexOf("sieciowa") !== -1; }, "high"),
          mid: sumTariffVariableRows(variableRows, function (label) { return label.indexOf("sieciowa") !== -1; }, "mid"),
          low: sumTariffVariableRows(variableRows, function (label) { return label.indexOf("sieciowa") !== -1; }, "low")
        };

        purchaseCost =
          (purchaseByZone.high * energyRates.high) +
          (purchaseByZone.mid * energyRates.mid) +
          (purchaseByZone.low * energyRates.low);
        distributionNetworkCost =
          (purchaseByZone.high * networkRates.high) +
          (purchaseByZone.mid * networkRates.mid) +
          (purchaseByZone.low * networkRates.low);
      } else {
        const purchaseRate = sumTariffVariableRows(variableRows, function (label) {
          return label.indexOf("energia") !== -1;
        }, "all");
        const networkRate = sumTariffVariableRows(variableRows, function (label) {
          return label.indexOf("sieciowa") !== -1;
        }, "all");

        purchaseCost = (purchaseKwh || 0) * purchaseRate;
        distributionNetworkCost = (purchaseKwh || 0) * networkRate;
      }

      const qualityCost = (purchaseKwh || 0) * qualityRate;
      const ozeCost = (purchaseKwh || 0) * ozeRate;
      const cogenerationCost = (purchaseKwh || 0) * cogenerationRate;
      const fixedCost = calculatedFixedRows.reduce(function (sum, row) { return sum + row.value; }, 0);
      const distributionCost = distributionNetworkCost + qualityCost + ozeCost + cogenerationCost;

      return {
        total: purchaseCost + distributionCost + fixedCost,
        purchaseCost: purchaseCost,
        distributionCost: distributionCost,
        fixedCost: fixedCost,
        subscriptionCost: 0,
        distributionDetails: {
          network: distributionNetworkCost,
          quality: qualityCost,
          oze: ozeCost,
          cogeneration: cogenerationCost
        },
        fixedDetails: calculatedFixedRows,
        subscriptionDetails: []
      };
    }

    function collectTariffRateRows(variableRows, zoneCode) {
      const totalsByLabel = new Map();

      (variableRows || []).forEach(function (row) {
        const rowZone = String(row && row.window_code ? row.window_code : "all").toLowerCase();
        if (rowZone !== "all" && rowZone !== zoneCode) {
          return;
        }

        const label = String(row && row.label ? row.label : "Składnik zmienny").trim();
        const key = normalizeText(label);
        const existing = totalsByLabel.get(key) || { label: label, value: 0 };
        existing.value += Number(row && row.price) || 0;
        totalsByLabel.set(key, existing);
      });

      return Array.from(totalsByLabel.values());
    }

    function getTariffZoneDefinitions(tariff) {
      const variableRows = Array.isArray(tariff && tariff.variable) ? tariff.variable : [];
      const availableCodes = new Set(variableRows.map(function (row) {
        return String(row && row.window_code ? row.window_code : "all").toLowerCase();
      }).filter(function (code) {
        return code !== "all";
      }));
      const zoneModel = String(tariff && tariff.zone_model ? tariff.zone_model : "all").toLowerCase();
      let orderedCodes = [];

      if (zoneModel === "highmidlow") {
        orderedCodes = ["low", "high", "mid"];
      } else if (zoneModel === "daynight") {
        orderedCodes = ["night", "day"];
      } else if (zoneModel === "peakoffpeak") {
        orderedCodes = ["offpeak", "peak"];
      } else if (availableCodes.size) {
        orderedCodes = Array.from(availableCodes);
      } else {
        orderedCodes = ["all"];
      }

      return orderedCodes.filter(function (code) {
        return code === "all" || availableCodes.has(code);
      }).map(function (code) {
        let label = "Pozostałe godziny";
        let context = "w pozostałych godzinach";
        if (code === "low" || code === "night" || code === "offpeak") {
          label = "Strefa zalecanego poboru";
          context = "w strefie zalecanego poboru";
        } else if (code === "high" || code === "day" || code === "peak") {
          label = "Strefa zalecanego ograniczania";
          context = "w strefie zalecanego ograniczania";
        }
        return { code: code, label: label, context: context };
      });
    }

    function getTariffSettlementLabel(payload, optimized) {
      const account = payload && payload.account ? payload.account : {};
      const settings = account && account.tariffSettings && typeof account.tariffSettings === "object"
        ? account.tariffSettings
        : {};
      const selected = optimized
        ? (settings.target && typeof settings.target === "object" ? settings.target : {})
        : (settings.current && typeof settings.current === "object" ? settings.current : {});
      const explicit = firstText(
        selected.settlementSystem,
        selected.settlement_system,
        selected.prosumerSettlement,
        selected.prosumer_settlement,
        optimized ? account.targetSettlementSystem : account.currentSettlementSystem
      );

      return explicit || (optimized ? "net billing" : "brak");
    }

    function getTariffSaleLabel(tariff, optimized) {
      if (optimized) {
        return "RCE / RCEm";
      }

      const method = normalizeText(tariff && tariff.sell_method ? tariff.sell_method : "fixed");
      if (method === "rdn") {
        return "RCE / RCEm";
      }

      const fixedPrice = numberOrNull(tariff && tariff.sell_fixed_price);
      return fixedPrice != null && fixedPrice > 0
        ? formatDecimal(fixedPrice, 5) + " PLN/kWh"
        : "brak";
    }

    function buildTariffInfo(payload, tariff, optimized, anchorDate, powerUsageByMonth, fixedCostOptions) {
      const tariffData = payload && payload.tariffData ? payload.tariffData : {};
      const account = payload && payload.account ? payload.account : {};
      const settings = account && account.tariffSettings && typeof account.tariffSettings === "object"
        ? account.tariffSettings
        : {};
      const selected = optimized
        ? (settings.target && typeof settings.target === "object" ? settings.target : {})
        : (settings.current && typeof settings.current === "object" ? settings.current : {});
      const variableRows = Array.isArray(tariff.variable) ? tariff.variable : [];
      const zoneDefinitions = getTariffZoneDefinitions(tariff);
      const zones = zoneDefinitions.map(function (zone) {
        const rows = collectTariffRateRows(variableRows, zone.code);
        return {
          code: zone.code,
          label: zone.label,
          totalUnitRate: rows.reduce(function (sum, row) { return sum + row.value; }, 0)
        };
      });
      const primaryZone = zoneDefinitions[0] || { code: "all", label: "Pozostałe godziny", context: "w pozostałych godzinach" };
      const isMultiZone = zones.length > 1;
      const rateRows = collectTariffRateRows(variableRows, primaryZone.code);
      const energyRows = rateRows.filter(function (row) {
        return normalizeText(row.label).indexOf("energia") !== -1;
      });
      const distributionRows = rateRows.filter(function (row) {
        return normalizeText(row.label).indexOf("energia") === -1;
      });
      const energyRate = energyRows.reduce(function (sum, row) { return sum + row.value; }, 0);
      const distributionRate = distributionRows.reduce(function (sum, row) { return sum + row.value; }, 0);
      const selectedDate = anchorDate instanceof Date && Number.isFinite(anchorDate.getTime())
        ? anchorDate
        : new Date();
      const monthWindow = {
        start: new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1),
        end: new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0)
      };
      const fixedRows = calculateFixedRowsForRange(
        Array.isArray(tariff.fixed) ? tariff.fixed : [],
        monthWindow,
        powerUsageByMonth,
        fixedCostOptions
      );
      const providerName = firstText(
        selected.operator,
        selected.provider,
        selected.osdName,
        tariff.provider,
        tariff.osd_name,
        tariffData.provider
      );
      const tariffCode = firstText(tariff.code, tariff.name, selected.code, selected.name);
      const tariffTitle = "Taryfa " + tariffCode + (optimized ? " + system Re:flow" : "");

      return {
        tariffLabel: tariffTitle,
        priceBasisLabel: window.DashboardPricing ? window.DashboardPricing.caption() : "Ceny brutto",
        vatRows: window.DashboardPricing ? window.DashboardPricing.componentLabels(tariff) : [],
        settlementLabel: getTariffSettlementLabel(payload, optimized),
        purchaseLabel: [providerName, tariffCode ? "Taryfa " + tariffCode : ""].filter(Boolean).join(", "),
        unitContext: isMultiZone ? primaryZone.context : "",
        zones: zones,
        totalUnitRate: energyRate + distributionRate,
        energyRate: energyRate,
        distributionRate: distributionRate,
        distributionRows: distributionRows,
        fixedTotal: fixedRows.reduce(function (sum, row) { return sum + row.value; }, 0),
        fixedRows: fixedRows,
        saleLabel: getTariffSaleLabel(tariff, optimized)
      };
    }

    function createTariffCardModel(total, usageKwh, selfUseKwh, purchaseKwh, breakdown, savingsPln, includeSavings) {
      const barSegments = [
        { tone: "subscription", value: breakdown ? breakdown.subscriptionCost : null },
        { tone: "fixed", value: breakdown ? breakdown.fixedCost : null },
        { tone: "distribution", value: breakdown ? breakdown.distributionCost : null },
        { tone: "purchase", value: breakdown ? breakdown.purchaseCost : null }
      ];

      if (includeSavings) {
        barSegments.push({ tone: "savings", value: savingsPln });
      }

      const items = [
        {
          id: "usage",
          tone: "energy",
          label: "Zużycie energii",
          value: usageKwh,
          unit: "kWh",
          details: [
            { label: "W tym autokonsumpcja", value: selfUseKwh, unit: "kWh" }
          ]
        },
        {
          id: "purchase",
          tone: "purchase",
          label: "Zakup energii",
          value: breakdown ? breakdown.purchaseCost : null,
          unit: "PLN",
          details: [
            { label: "Energia zakupiona z sieci", value: purchaseKwh, unit: "kWh" }
          ]
        },
        {
          id: "distribution",
          tone: "distribution",
          label: "Dystrybucja energii",
          value: breakdown ? breakdown.distributionCost : null,
          unit: "PLN",
          details: [
            { label: "Opłata zmienna sieciowa", value: breakdown ? breakdown.distributionDetails.network : null, unit: "PLN" },
            { label: "Opłata jakościowa", value: breakdown ? breakdown.distributionDetails.quality : null, unit: "PLN" },
            { label: "Opłata OZE", value: breakdown ? breakdown.distributionDetails.oze : null, unit: "PLN" },
            { label: "Opłata kogeneracyjna", value: breakdown ? breakdown.distributionDetails.cogeneration : null, unit: "PLN" }
          ]
        },
        {
          id: "fixed",
          tone: "fixed",
          label: "Opłaty stałe",
          value: breakdown ? breakdown.fixedCost : null,
          unit: "PLN",
          details: [
            { label: "Opłata handlowa", value: breakdown ? breakdown.fixedDetails.trade : null, unit: "PLN" },
            { label: "Składnik stały", value: breakdown ? breakdown.fixedDetails.network : null, unit: "PLN" },
            { label: "Opłata mocowa", value: breakdown ? breakdown.fixedDetails.power : null, unit: "PLN" }
          ]
        },
        {
          id: "subscription",
          tone: "subscription",
          label: "Stała cena abonamentu",
          value: breakdown ? breakdown.subscriptionCost : null,
          unit: "PLN",
          details: []
        }
      ];

      return {
        total: total,
        barSegments: barSegments,
        items: items,
        savingsPln: includeSavings ? savingsPln : null
      };
    }

    function createTariffCardModel(total, usageKwh, usageDetails, purchaseKwh, breakdown, savingsPln, includeSavings, depositLedger, tariffInfo) {
      const effectivePurchaseCost = breakdown && breakdown.purchaseCostCash != null
        ? breakdown.purchaseCostCash
        : (breakdown ? breakdown.purchaseCost : null);
      const fixedDetails = breakdown && Array.isArray(breakdown.fixedDetails)
        ? breakdown.fixedDetails.map(function (row) {
          return { label: row.label, value: row.value, unit: "PLN" };
        })
        : [];
      const subscriptionDetails = breakdown && Array.isArray(breakdown.subscriptionDetails)
        ? breakdown.subscriptionDetails
        : [];
      const purchaseDetails = [
        { label: "Energia zakupiona z sieci", value: purchaseKwh, unit: "kWh" }
      ];
      if (breakdown && breakdown.depositUsedPln > 0) {
        purchaseDetails.push({
          label: "Pokryte z depozytu",
          value: breakdown.depositUsedPln,
          unit: "PLN"
        });
      }
      const barSegments = [
        { tone: "subscription", value: breakdown ? breakdown.subscriptionCost : null },
        { tone: "fixed", value: breakdown ? breakdown.fixedCost : null },
        { tone: "distribution", value: breakdown ? breakdown.distributionCost : null },
        { tone: "purchase", value: effectivePurchaseCost }
      ];

      if (includeSavings) {
        barSegments.push({ tone: "savings", value: savingsPln });
      }

      const items = [
        {
          id: "usage",
          tone: "energy",
          label: "Zużycie energii",
          value: usageKwh,
          unit: "kWh",
          details: usageDetails || []
        },
        {
          id: "purchase",
          tone: "purchase",
          label: "Zakup energii",
          value: effectivePurchaseCost,
          unit: "PLN",
          details: purchaseDetails
        },
        {
          id: "distribution",
          tone: "distribution",
          label: "Dystrybucja energii",
          value: breakdown ? breakdown.distributionCost : null,
          unit: "PLN",
          details: [
            { label: "Opłata zmienna sieciowa", value: breakdown ? breakdown.distributionDetails.network : null, unit: "PLN" },
            { label: "Opłata jakościowa", value: breakdown ? breakdown.distributionDetails.quality : null, unit: "PLN" },
            { label: "Opłata OZE", value: breakdown ? breakdown.distributionDetails.oze : null, unit: "PLN" },
            { label: "Opłata kogeneracyjna", value: breakdown ? breakdown.distributionDetails.cogeneration : null, unit: "PLN" }
          ]
        },
        {
          id: "fixed",
          tone: "fixed",
          label: "Opłaty stałe",
          value: breakdown ? breakdown.fixedCost : null,
          unit: "PLN",
          details: fixedDetails
        }
      ];

      if (subscriptionDetails.length) {
        items.push({
          id: "subscription",
          tone: "subscription",
          label: breakdown.subscriptionLabel,
          value: breakdown.subscriptionCost,
          unit: "PLN",
          details: subscriptionDetails.length > 1
            ? subscriptionDetails.map(function (row) {
              return { label: row.label, value: row.value, unit: "PLN" };
            })
            : []
        });
      }

      return {
        total: total,
        barSegments: barSegments,
        items: items,
        savingsPln: includeSavings ? savingsPln : null,
        depositLedger: depositLedger || null,
        tariffInfo: tariffInfo || null
      };
    }

    function buildTariffModels(payload) {
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const tariffData = payload && payload.tariffData ? payload.tariffData : {};
      const currentTariff = payload.tariffHistory?.strict ? ReTariffEngine.resolve(payload.tariffHistory, formatDateKey(state.anchorDate), null) : tariffData.current || null;
      const nextTariff = tariffData.next || null;

      if (!currentTariff || !nextTariff) {
        return null;
      }

      const rangeWindow = getRangeWindow(state.range, state.anchorDate);
      const usageAggregate = aggregateUsageForRange(usageData, rangeWindow, nextTariff);
      const estimatedPvSupport = usageAggregate && usageAggregate.pvKwh <= 0
        ? estimatePvAutoconsumptionForRange(payload, rangeWindow, nextTariff)
        : null;
      const usagePerDay = firstNumber(rawEnergy.usageTodayKwh, rawEnergy.usageKwh, energy.usageKwh);
      const selfUsePerDay = firstNumber(
        rawEnergy.selfConsumptionKwh,
        rawEnergy.autoconsumptionKwh,
        rawEnergy.autokonsumpcjaKwh,
        rawEnergy.selfUseKwh,
        usagePerDay != null ? usagePerDay * 0.22 : null
      );
      const purchasePerDay = firstNumber(
        rawEnergy.purchaseEnergyKwh,
        rawEnergy.purchaseKwh,
        rawEnergy.importKwh,
        rawEnergy.importEnergyKwh,
        rawEnergy.boughtEnergyKwh,
        rawEnergy.poborKwh,
        usagePerDay != null ? Math.max(usagePerDay - (selfUsePerDay || 0), usagePerDay * 0.52) : null
      );
      const usageKwh = usageAggregate && usageAggregate.usageKwh > 0
        ? usageAggregate.usageKwh + (estimatedPvSupport ? estimatedPvSupport.selfUseKwh : 0)
        : (usagePerDay != null ? usagePerDay * rangeWindow.days : null);
      const selfUseKwh = usageAggregate && usageAggregate.selfUseKwh > 0
        ? usageAggregate.selfUseKwh + (estimatedPvSupport ? estimatedPvSupport.selfUseKwh : 0)
        : (selfUsePerDay != null ? selfUsePerDay * rangeWindow.days : null);
      const purchaseKwh = usageAggregate && usageAggregate.purchaseKwh > 0
        ? Math.max(usageAggregate.purchaseKwh - (estimatedPvSupport ? estimatedPvSupport.purchaseReductionKwh : 0), 0)
        : (purchasePerDay != null ? purchasePerDay * rangeWindow.days : null);
      const nextSelfUseKwh = firstNumber(
        rawEnergy.reflowSelfConsumptionKwh,
        rawEnergy.optimizedAutoconsumptionKwh,
        rawEnergy.reflowAutokonsumpcjaKwh,
        selfUseKwh != null ? Math.min(usageKwh != null ? usageKwh : Infinity, selfUseKwh * 1.18) : null,
        selfUseKwh
      );
      const nextPurchaseKwh = firstNumber(
        rawEnergy.optimizedPurchaseEnergyKwh,
        rawEnergy.reflowPurchaseKwh,
        purchaseKwh
      );
      const purchaseByZone = scalePurchaseByZone(
        usageAggregate ? {
          all: Math.max((usageAggregate.purchaseByZone.all || 0) - (estimatedPvSupport ? estimatedPvSupport.purchaseReductionByZone.all : 0), 0),
          high: Math.max((usageAggregate.purchaseByZone.high || 0) - (estimatedPvSupport ? estimatedPvSupport.purchaseReductionByZone.high : 0), 0),
          mid: Math.max((usageAggregate.purchaseByZone.mid || 0) - (estimatedPvSupport ? estimatedPvSupport.purchaseReductionByZone.mid : 0), 0),
          low: Math.max((usageAggregate.purchaseByZone.low || 0) - (estimatedPvSupport ? estimatedPvSupport.purchaseReductionByZone.low : 0), 0)
        } : null,
        nextPurchaseKwh != null ? nextPurchaseKwh : purchaseKwh
      );
      const powerUsageByMonth = buildPowerFeeUsageByMonth(payload, rangeWindow, nextTariff);
      const currentBreakdown = payload.tariffHistory?.strict ? clientTariffDashboardCost(payload, rangeWindow, { ...getFixedCostOptions(payload, false), connectionPowerKw: getFixedCostOptions(payload, false).contractPowerKw, annualUsageKwh: clientTariffAnnualUsage(payload) }, getQuarterHour) : buildTariffBreakdown(currentTariff, purchaseKwh, rangeWindow, false, null, powerUsageByMonth, getFixedCostOptions(payload, false));
      const nextBreakdown = buildTariffBreakdown(nextTariff, nextPurchaseKwh, rangeWindow, true, purchaseByZone, powerUsageByMonth, getFixedCostOptions(payload, true));

      if (!currentBreakdown || !nextBreakdown) {
        return null;
      }

      const savingsPln = Math.max((currentBreakdown.total || 0) - (nextBreakdown.total || 0), 0);

      return {
        scaleTotal: Math.max(currentBreakdown.total || 0, (nextBreakdown.total || 0) + savingsPln),
        current: createTariffCardModel(
          currentBreakdown.total,
          usageKwh,
          selfUseKwh,
          purchaseKwh,
          currentBreakdown,
          null,
          false
        ),
        next: createTariffCardModel(
          nextBreakdown.total,
          usageKwh,
          nextSelfUseKwh,
          nextPurchaseKwh,
          nextBreakdown,
          savingsPln,
          true
        )
      };
    }

    function buildZoneTotalsFromTotal(total, tariff, rangeWindow) {
      if (total == null) {
        return null;
      }

      const zoneShares = normalizeZoneShares(getZoneHours(tariff, rangeWindow, false));
      return {
        all: total,
        high: total * zoneShares.high,
        mid: total * zoneShares.mid,
        low: total * zoneShares.low
      };
    }

    function createZoneTotals() {
      return {
        all: 0,
        high: 0,
        mid: 0,
        low: 0,
        day: 0,
        night: 0,
        peak: 0,
        offpeak: 0
      };
    }

    function getBankRangeTotals(rangeWindow) {
      const simulation = getSummarySimulationForRange(rangeWindow);
      if (!simulation || typeof simulation.getRangeTotals !== "function") {
        return null;
      }

      return simulation.getRangeTotals(rangeWindow);
    }

    function getProsumerRangeEnergy(rangeWindow, tariff) {
      const simulation = getSummarySimulationForRange(rangeWindow);
      if (!simulation || !Array.isArray(simulation.days) || !rangeWindow) {
        return null;
      }

      const startKey = formatDateKey(rangeWindow.start);
      const endKey = formatDateKey(rangeWindow.end);
      const usageByZone = createZoneTotals();
      const pvByZone = createZoneTotals();
      const bankByZone = createZoneTotals();
      const gridByZone = createZoneTotals();
      let usageKwh = 0;
      let pvToLoadKwh = 0;
      let bankToLoadKwh = 0;
      let gridLoadKwh = 0;

      simulation.days.forEach(function (day) {
        if (!day || day.dateKey < startKey || day.dateKey > endKey) {
          return;
        }

        const entries = Array.isArray(day.slots) && day.slots.length
          ? day.slots
          : (Array.isArray(day.hours) ? day.hours : []);

        entries.forEach(function (entry, index) {
          if (!entry || entry.actual === false) {
            return;
          }

          const hour = clamp(Math.round(firstNumber(entry.hour, index, 0) || 0), 0, 23);
          const windowCode = entry.windowCode || (
            tariff && (isTwoZoneTariff(tariff) || (tariff.zone_model || "") === "highmidlow" || tariff.use_monthly)
              ? getZoneCodeForDateHour(tariff, day.dateKey, hour)
              : "all"
          );
          const loadKwh = firstNumber(
            entry.load,
            entry.totalLoadKwh,
            entry.usageKwh,
            entry.demandKwh,
            0
          ) || 0;
          const gridLoadSlotKwh = firstNumber(
            entry.billedGridPurchaseForLoadKwh,
            entry.gridPurchaseForLoadKwh,
            entry.gridBuyLoad,
            entry.gridKwh,
            0
          ) || 0;
          const bankLoadKwh = firstNumber(
            entry.bankToLoad,
            entry.bankToLoadKwh,
            entry.dischargeToLoadKwh,
            0
          ) || 0;
          const pvLoadKwh = firstNumber(
            entry.pvToLoad,
            entry.pvKwh,
            Math.max(0, loadKwh - gridLoadSlotKwh - bankLoadKwh)
          ) || 0;

          usageKwh += loadKwh;
          pvToLoadKwh += pvLoadKwh;
          bankToLoadKwh += bankLoadKwh;
          gridLoadKwh += gridLoadSlotKwh;

          usageByZone.all += loadKwh;
          pvByZone.all += pvLoadKwh;
          bankByZone.all += bankLoadKwh;
          gridByZone.all += gridLoadSlotKwh;

          if (windowCode !== "all" && Object.prototype.hasOwnProperty.call(usageByZone, windowCode)) {
            usageByZone[windowCode] += loadKwh;
            pvByZone[windowCode] += pvLoadKwh;
            bankByZone[windowCode] += bankLoadKwh;
            gridByZone[windowCode] += gridLoadSlotKwh;
          }
        });
      });

      return {
        usageKwh: usageKwh,
        pvToLoadKwh: pvToLoadKwh,
        bankToLoadKwh: bankToLoadKwh,
        gridLoadKwh: gridLoadKwh,
        usageByZone: usageByZone,
        pvByZone: pvByZone,
        bankByZone: bankByZone,
        gridByZone: gridByZone
      };
    }

    function buildUsageDetailsForCurrentTariff() {
      return [];
    }

    function buildUsageDetailsForNextTariff(gridKwh, pvKwh, bankKwh) {
      const gridValue = gridKwh != null ? gridKwh : null;
      const pvValue = pvKwh != null ? pvKwh : 0;
      const bankValue = bankKwh != null ? bankKwh : null;
      return [
        { label: "Zakup z sieci", value: gridValue, unit: "kWh", showUnitWhenEmpty: true },
        { label: "Autokonsumpcja z PV", value: pvValue, unit: "kWh" },
        { label: "z banku energii", value: bankValue, unit: "kWh", showUnitWhenEmpty: true }
      ];
    }

    function buildReForecastSummaryModels(rangeWindow, rangeTotals, simulation) {
      const totals = rangeTotals && rangeTotals.totals ? rangeTotals.totals : null;
      if (!rangeWindow || !totals) {
        return null;
      }

      const currentTotal = firstNumber(totals.currentBillPln, totals.oldBillPln);
      const nextCashBeforeRefund = firstNumber(
        totals.cashCostWithFixedPln,
        totals.billedPurchaseCashWithFixedPln,
        totals.billedPurchaseCashPln,
        totals.cashCostPln
      );
      if (currentTotal == null || nextCashBeforeRefund == null) {
        return null;
      }

      const endDepositPln = firstNumber(rangeTotals.endDepositPln, 0) || 0;
      const nextTotal = Math.max(nextCashBeforeRefund, 0);
      const savingsPln = Math.max(currentTotal - nextTotal, 0);
      const usageKwh = firstNumber(totals.usageKwh, totals.oldUsageKwh);
      const currentEnergyCost = firstNumber(totals.oldEnergyCostPln, currentTotal);
      const currentFixedCost = firstNumber(totals.oldFixedCostPln, 0) || 0;
      const nextPurchaseCash = firstNumber(totals.billedPurchaseCashPln, totals.cashCostPln, nextCashBeforeRefund);
      const nextFixedCost = firstNumber(totals.newFixedCostPln, 0) || 0;
      const gridKwh = firstNumber(
        totals.billedGridPurchaseForLoadKwh,
        totals.gridPurchaseForLoadKwh,
        totals.billedGridPurchaseKwh,
        totals.gridPurchaseKwh
      );
      const depositUsedPln = firstNumber(totals.billedDepositUsedPln, totals.depositUsedPln, 0) || 0;
      const depositEarnedPln = firstNumber(totals.billedDepositEarnedPln, totals.depositEarnedPln, 0) || 0;
      const depositEarnedKwh = firstNumber(totals.billedGridExportKwh, totals.exportKwh, 0) || 0;
      const depositUsedKwh = firstNumber(totals.depositUsedKwh, estimateSimulationDepositUsedKwh(simulation, rangeWindow), 0) || 0;
      const coverageDays = typeof getDashboardDepositCoverageDays === "function"
        ? getDashboardDepositCoverageDays(simulation, formatDateKey(rangeWindow.end), endDepositPln)
        : null;
      const currentItems = [
        {
          id: "usage",
          tone: "energy",
          label: "Zużycie energii",
          value: usageKwh,
          unit: "kWh",
          details: []
        },
        {
          id: "purchase",
          tone: "purchase",
          label: "Zakup energii",
          value: currentEnergyCost,
          unit: "PLN",
          details: [
            { label: "Energia zakupiona z sieci", value: usageKwh, unit: "kWh", showUnitWhenEmpty: true }
          ]
        },
        {
          id: "fixed",
          tone: "fixed",
          label: "Opłaty stałe",
          value: currentFixedCost,
          unit: "PLN",
          details: []
        }
      ];
      const nextItems = [
        {
          id: "usage",
          tone: "energy",
          label: "Zużycie energii",
          value: usageKwh,
          unit: "kWh",
          details: [
            { label: "Zakup z sieci", value: gridKwh, unit: "kWh", showUnitWhenEmpty: true },
            { label: "Oddane do depozytu", value: depositEarnedKwh, unit: "kWh" },
            { label: "Wykorzystane z depozytu", value: depositUsedKwh, unit: "kWh" }
          ]
        },
        {
          id: "purchase",
          tone: "purchase",
          label: "Zakup energii",
          value: nextPurchaseCash,
          unit: "PLN",
          details: [
            { label: "Energia zakupiona z sieci", value: gridKwh, unit: "kWh", showUnitWhenEmpty: true },
            { label: "Pokryte z depozytu", value: depositUsedPln, unit: "PLN" }
          ]
        },
        {
          id: "fixed",
          tone: "fixed",
          label: "Opłaty stałe",
          value: nextFixedCost,
          unit: "PLN",
          details: []
        }
      ];

      return {
        scaleTotal: Math.max(currentTotal || 0, nextCashBeforeRefund || 0, (nextTotal || 0) + savingsPln),
        current: {
          total: currentTotal,
          barSegments: [
            { tone: "fixed", value: currentFixedCost },
            { tone: "purchase", value: currentEnergyCost }
          ],
          items: currentItems
        },
        next: {
          total: nextTotal,
          barSegments: [
            { tone: "fixed", value: nextFixedCost },
            { tone: "purchase", value: nextPurchaseCash },
            { tone: "savings", value: savingsPln }
          ],
          items: nextItems,
          savingsPln: savingsPln,
          depositLedger: {
            startBalancePln: firstNumber(rangeTotals.startDepositPln, 0) || 0,
            earnedPln: depositEarnedPln,
            earnedKwh: depositEarnedKwh,
            usedPln: depositUsedPln,
            usedKwh: depositUsedKwh,
            eligiblePurchasePln: firstNumber(totals.eligiblePurchasePln, 0) || 0,
            endBalancePln: endDepositPln,
            coverageDays: coverageDays
          }
        }
      };
    }

    function buildTariffModels(payload) {
      const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : {};
      const energy = payload && payload.energy ? payload.energy : {};
      const usageData = payload && payload.usageData ? payload.usageData : null;
      const tariffData = payload && payload.tariffData ? payload.tariffData : {};
      const currentTariff = payload.tariffHistory?.strict ? ReTariffEngine.resolve(payload.tariffHistory, formatDateKey(state.anchorDate), null) : tariffData.current || null;
      const nextTariff = tariffData.next || null;

      if (!currentTariff || !nextTariff) {
        return null;
      }

      const rangeWindow = getRangeWindow(state.range, state.anchorDate);
      const usageAggregate = aggregateUsageForRange(usageData, rangeWindow, nextTariff);
      const dataMode = getDashboardDataMode(payload);
      const hasMeasuredUsageSplit = dataMode === DASHBOARD_DATA_MODE_REAL;
      const forecastSimulation = getSummaryForecastSimulation(rangeWindow);
      const summarySimulation = getSummarySimulationForRange(rangeWindow);
      const useForecastRange = !!forecastSimulation;
      const estimatedPvSupport = !useForecastRange && !hasMeasuredUsageSplit && usageAggregate && usageAggregate.pvKwh <= 0
        ? estimatePvAutoconsumptionForRange(payload, rangeWindow, nextTariff)
        : null;
      const bankRangeTotals = useForecastRange || !hasMeasuredUsageSplit ? getBankRangeTotals(rangeWindow) : null;
      const prosumerRange = useForecastRange || !hasMeasuredUsageSplit ? getProsumerRangeEnergy(rangeWindow, nextTariff) : null;
      const bankSupportKwh = prosumerRange
        ? prosumerRange.bankToLoadKwh
        : (hasMeasuredUsageSplit && usageAggregate
          ? usageAggregate.storageKwh
          : (bankRangeTotals && bankRangeTotals.totals
          ? firstNumber(bankRangeTotals.totals.bankToLoadKwh, bankRangeTotals.totals.dischargeKwh, bankRangeTotals.totals.dischargeByZone && bankRangeTotals.totals.dischargeByZone.all)
          : null));
      const bankByZone = prosumerRange
        ? prosumerRange.bankByZone
        : (hasMeasuredUsageSplit && usageAggregate && usageAggregate.storageByZone
          ? usageAggregate.storageByZone
          : (bankRangeTotals && bankRangeTotals.totals && bankRangeTotals.totals.dischargeByZone
          ? bankRangeTotals.totals.dischargeByZone
          : null));
      const usagePerDay = firstNumber(rawEnergy.usageTodayKwh, rawEnergy.usageKwh, energy.usageKwh);
      const sharedUsageKwh = prosumerRange && prosumerRange.usageKwh > 0
        ? prosumerRange.usageKwh
        : (usageAggregate && usageAggregate.usageKwh > 0
          ? usageAggregate.usageKwh
          : (usagePerDay != null ? usagePerDay * rangeWindow.days : null));
      const pvFallbackPerDay = firstNumber(
        rawEnergy.selfConsumptionKwh,
        rawEnergy.autoconsumptionKwh,
        rawEnergy.autokonsumpcjaKwh,
        rawEnergy.selfUseKwh
      );
      const pvKwh = prosumerRange && prosumerRange.pvToLoadKwh > 0
        ? prosumerRange.pvToLoadKwh
        : (hasMeasuredUsageSplit && usageAggregate
          ? usageAggregate.pvKwh
          : (usageAggregate
          ? ((usageAggregate.pvKwh > 0 ? usageAggregate.pvKwh : 0) + (estimatedPvSupport ? estimatedPvSupport.pvKwh : 0))
          : (pvFallbackPerDay != null
            ? pvFallbackPerDay * rangeWindow.days
            : (estimatedPvSupport ? estimatedPvSupport.pvKwh : null))));
      const usageByZone = prosumerRange && prosumerRange.usageByZone && prosumerRange.usageByZone.all > 0
        ? prosumerRange.usageByZone
        : (usageAggregate && usageAggregate.usageByZone && usageAggregate.usageByZone.all > 0
          ? usageAggregate.usageByZone
          : buildZoneTotalsFromTotal(sharedUsageKwh, nextTariff, rangeWindow));
      const pvByZone = prosumerRange && prosumerRange.pvByZone && prosumerRange.pvByZone.all > 0
        ? prosumerRange.pvByZone
        : (hasMeasuredUsageSplit && usageAggregate && usageAggregate.pvByZone
          ? usageAggregate.pvByZone
          : (usageAggregate && usageAggregate.pvByZone && usageAggregate.pvByZone.all > 0
          ? usageAggregate.pvByZone
          : (estimatedPvSupport ? estimatedPvSupport.pvByZone : buildZoneTotalsFromTotal(pvKwh, nextTariff, rangeWindow))));
      const g11PurchaseKwh = sharedUsageKwh;
      const g13PurchaseAfterPv = subtractZoneTotals(usageByZone, pvByZone);
      const g13PurchaseByZone = prosumerRange && prosumerRange.gridByZone && prosumerRange.gridByZone.all >= 0
        ? prosumerRange.gridByZone
        : (hasMeasuredUsageSplit && usageAggregate && usageAggregate.purchaseByZone
        ? usageAggregate.purchaseByZone
        : subtractZoneTotals(g13PurchaseAfterPv, bankByZone));
      const fallbackG13PurchaseKwh = g13PurchaseByZone
        ? g13PurchaseByZone.all
        : (sharedUsageKwh != null ? Math.max(sharedUsageKwh - (pvKwh || 0) - (bankSupportKwh || 0), 0) : null);
      const g13PurchaseKwh = prosumerRange
        ? prosumerRange.gridLoadKwh
        : (hasMeasuredUsageSplit && usageAggregate
        ? usageAggregate.purchaseKwh
        : fallbackG13PurchaseKwh);
      const powerUsageByMonth = buildPowerFeeUsageByMonth(payload, rangeWindow, nextTariff);
      const currentFixedCostOptions = getFixedCostOptions(payload, false);
      const nextFixedCostOptions = getFixedCostOptions(payload, true);
      const currentUsageAggregate = isTwoZoneTariff(currentTariff)
        ? aggregateUsageForRange(usageData, rangeWindow, currentTariff)
        : null;
      const currentBreakdown = payload.tariffHistory?.strict ? clientTariffDashboardCost(payload, rangeWindow, { ...currentFixedCostOptions, connectionPowerKw: currentFixedCostOptions.contractPowerKw, annualUsageKwh: clientTariffAnnualUsage(payload) }, getQuarterHour) : buildTariffBreakdown(currentTariff, g11PurchaseKwh, rangeWindow, false,
        currentUsageAggregate ? currentUsageAggregate.usageByZone : null, powerUsageByMonth, currentFixedCostOptions);
      const actualHistory = payload.tariffHistory?.strict && !useForecastRange && hasMeasuredUsageSplit;
      const nextBreakdown = actualHistory ? clientTariffDashboardCost(payload, rangeWindow, { ...currentFixedCostOptions, gridOnly: true, connectionPowerKw: currentFixedCostOptions.contractPowerKw, annualUsageKwh: clientTariffAnnualUsage(payload) }, getQuarterHour) : buildTariffBreakdown(nextTariff, g13PurchaseKwh, rangeWindow, true, g13PurchaseByZone, powerUsageByMonth, nextFixedCostOptions);
      const currentTariffInfo = buildTariffInfo(payload, currentTariff, false, state.anchorDate, powerUsageByMonth, currentFixedCostOptions);
      const nextTariffInfo = buildTariffInfo(payload, actualHistory ? currentTariff : nextTariff, !actualHistory, state.anchorDate, powerUsageByMonth, actualHistory ? currentFixedCostOptions : nextFixedCostOptions);

      if (!currentBreakdown || !nextBreakdown) {
        return null;
      }

      const measuredDepositLedger = !useForecastRange && hasMeasuredUsageSplit
        ? buildMeasuredDepositLedger(payload, rangeWindow, actualHistory ? clientTariffActual(payload, nextTariff) : nextTariff)
        : null;
      const depositLedger = measuredDepositLedger || buildSimulationDepositLedger(rangeWindow, bankRangeTotals, summarySimulation);
      const depositUsedPln = depositLedger
        ? depositLedger.usedPln
        : (bankRangeTotals && bankRangeTotals.totals
          ? firstNumber(
          bankRangeTotals.totals.depositUsedPln,
          bankRangeTotals.totals.buyOwnFromDepositPln,
          bankRangeTotals.totals.buyBankFromDepositPln
        )
          : null);
      const purchaseCostCash = nextBreakdown.purchaseCost != null
        ? Math.max(nextBreakdown.purchaseCost - (depositUsedPln || 0), 0)
        : null;
      const nextActualTotal = (nextBreakdown.fixedCost || 0) +
        (nextBreakdown.subscriptionCost || 0) +
        (nextBreakdown.distributionCost || 0) +
        (purchaseCostCash || 0);
      nextBreakdown.depositUsedPln = depositUsedPln || 0;
      nextBreakdown.purchaseCostCash = purchaseCostCash;
      nextBreakdown.totalCash = nextActualTotal;

      const savingsPln = Math.max((currentBreakdown.total || 0) - nextActualTotal, 0);

      return {
        scaleTotal: Math.max(currentBreakdown.total || 0, nextActualTotal + savingsPln),
        current: createTariffCardModel(
          currentBreakdown.total,
          sharedUsageKwh,
          buildUsageDetailsForCurrentTariff(),
          g11PurchaseKwh,
          currentBreakdown,
          null,
          false,
          null,
          currentTariffInfo
        ),
        next: createTariffCardModel(
          nextActualTotal,
          sharedUsageKwh,
          buildUsageDetailsForNextTariff(g13PurchaseKwh, pvKwh, bankSupportKwh),
          g13PurchaseKwh,
          nextBreakdown,
          savingsPln,
          true,
          depositLedger,
          nextTariffInfo
        )
      };
    }

    const state = {
      range: "day",
      anchorDate: new Date(),
      anchorTouched: false,
      anchorSourceKey: "",
      rows: {
        current: {},
        next: {}
      },
      models: {
        current: null,
        next: null
      },
      scaleTotal: null,
      forceForecast: false,
      tariffOpen: null
    };

    function updateToolbar() {
      const anchorDate = state.anchorDate;
      let label = formatLongDate(anchorDate);

      if (state.range === "week") {
        label = formatWeekLabel(anchorDate);
      } else if (state.range === "month") {
        label = formatMonthLabel(anchorDate);
      } else if (state.range === "year") {
        label = formatYearLabel(anchorDate);
      }

      if (breadcrumbRangeEl) {
        breadcrumbRangeEl.textContent = formatRangeName(state.range);
      }

      if (rangeLabelEl) {
        rangeLabelEl.textContent = label;
        window.DashboardCalendar.sync(rangeLabelEl, {
          date: state.anchorDate, range: state.range,
          clamp: function (date) { return clampSummaryAnchorDate(date); },
          select: function (date) {
            state.anchorTouched = true;
            state.anchorDate = clampSummaryAnchorDate(date);
            state.windowStartIndex = null;
            updateToolbar();
            applyPayload();
          }
        });
      }

      rangeButtons.forEach(function (button) {
        const isActive = button.getAttribute("data-summary-range") === state.range;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });

      shiftButtons.forEach(function (button) {
        const direction = Number(button.getAttribute("data-summary-shift") || 0);
        const disabled = direction > 0 &&
          (shouldDisableDashboardNextRange(state.range, state.anchorDate) ||
            (state.range === "year" && state.anchorDate.getFullYear() >= SUMMARY_MAX_YEAR));
        button.disabled = disabled;
        button.setAttribute("aria-disabled", disabled ? "true" : "false");
      });
    }

    function shiftRange(step) {
      state.anchorTouched = true;

      let nextDate = new Date(state.anchorDate);
      if (state.range === "week") {
        nextDate = addDays(state.anchorDate, step * 7);
      } else if (state.range === "month") {
        nextDate = addMonths(state.anchorDate, step);
      } else if (state.range === "year") {
        nextDate = addYears(state.anchorDate, step);
      } else {
        nextDate = addDays(state.anchorDate, step);
      }

      state.anchorDate = clampSummaryAnchorDate(nextDate);
      updateToolbar();
      applyPayload();
    }

    function ensureRowState(cardKey, model) {
      model.items.forEach(function (item) {
        if (!item.details || !item.details.length) {
          return;
        }

        if (typeof state.rows[cardKey][item.id] !== "boolean") {
          state.rows[cardKey][item.id] = false;
        }
      });
    }

    function getCardReferences(cardKey) {
      if (cardKey === "current") {
        return {
          list: currentListEl,
          bar: currentBarEl,
          total: currentTotalEl,
          savings: null,
          deposit: null,
          toggle: toggleButtons.current
        };
      }

      return {
        list: nextListEl,
        bar: nextBarEl,
        total: nextTotalEl,
        savings: nextSavingsEl,
        deposit: nextDepositCardEl,
        toggle: toggleButtons.next
      };
    }

    function renderBar(barElement, segments, scaleTotal) {
      if (!barElement) {
        return;
      }

      barElement.textContent = "";

      const referenceTotal = scaleTotal && scaleTotal > 0 ? scaleTotal : null;

      segments.forEach(function (segment) {
        if (segment.value == null || segment.value <= 0 || referenceTotal == null) {
          return;
        }

        const segmentElement = document.createElement("span");
        segmentElement.className = "summary-bill-chart__segment summary-bill-chart__segment--" + segment.tone;
        segmentElement.style.height = ((segment.value / referenceTotal) * 100) + "%";
        barElement.appendChild(segmentElement);
      });
    }

    function updateCardToggle(cardKey, model) {
      const toggle = getCardReferences(cardKey).toggle;
      const suffix = cardKey === "current" ? "starego rachunku" : "nowego rachunku";

      if (!toggle) {
        return;
      }

      const isExpanded = model.items.some(function (item) {
        return item.details && item.details.length && state.rows[cardKey][item.id];
      });

      toggle.textContent = isExpanded ? "−" : "+";
      toggle.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      toggle.setAttribute("aria-label", (isExpanded ? "Zwiń szczegóły " : "Rozwiń szczegóły ") + suffix);
    }

    function createDetailNode(tone, detail) {
      const detailNode = document.createElement("div");
      detailNode.className = "summary-line-item__detail";

      const dot = document.createElement("span");
      dot.className = "summary-line-item__detail-dot";
      dot.style.background = "";

      const label = document.createElement("span");
      label.className = "summary-line-item__detail-label";
      label.textContent = detail.label;

      const value = document.createElement("span");
      value.className = "summary-line-item__detail-value";
      value.textContent = formatValue(detail.value, detail.unit, detail.showUnitWhenEmpty);

      detailNode.appendChild(dot);
      detailNode.appendChild(label);
      detailNode.appendChild(value);
      detailNode.classList.add("summary-line-item--" + tone);

      return detailNode;
    }

    function createItemNode(cardKey, item) {
      const itemNode = document.createElement("article");
      itemNode.className = "summary-line-item summary-line-item--" + item.tone;

      const hasDetails = Boolean(item.details && item.details.length);
      const isOpen = hasDetails && state.rows[cardKey][item.id];

      if (isOpen) {
        itemNode.classList.add("is-open");
      }

      const header = document.createElement(hasDetails ? "button" : "div");
      header.className = "summary-line-item__button";
      if (!hasDetails) {
        header.classList.add("summary-line-item__button--static");
      }

      const meta = document.createElement("div");
      meta.className = "summary-line-item__meta";

      const dot = document.createElement("span");
      dot.className = "summary-line-item__dot";

      const label = document.createElement("span");
      label.className = "summary-line-item__label";
      label.textContent = item.label;

      meta.appendChild(dot);
      meta.appendChild(label);

      const value = document.createElement("span");
      value.className = "summary-line-item__value";
      value.textContent = formatValue(item.value, item.unit, item.showUnitWhenEmpty);

      header.appendChild(meta);
      header.appendChild(value);

      if (hasDetails) {
        const indicator = document.createElement("span");
        indicator.className = "summary-line-item__indicator";
        indicator.textContent = isOpen ? "−" : "+";
        header.setAttribute("type", "button");
        header.setAttribute("aria-expanded", isOpen ? "true" : "false");
        header.setAttribute("aria-label", (isOpen ? "Zwiń " : "Rozwiń ") + item.label.toLowerCase());
        header.appendChild(indicator);
        header.addEventListener("click", function () {
          state.rows[cardKey][item.id] = !state.rows[cardKey][item.id];
          renderCard(cardKey);
        });
      } else {
        const spacer = document.createElement("span");
        spacer.className = "summary-line-item__indicator";
        spacer.setAttribute("aria-hidden", "true");
        spacer.textContent = "";
        header.appendChild(spacer);
      }

      itemNode.appendChild(header);

      if (hasDetails) {
        const detailsNode = document.createElement("div");
        detailsNode.className = "summary-line-item__details";

        item.details.forEach(function (detail) {
          detailsNode.appendChild(createDetailNode(item.tone, detail));
        });

        itemNode.appendChild(detailsNode);
      }

      return itemNode;
    }

    function formatTariffUnitRate(value) {
      if (value == null) {
        return "-- PLN";
      }

      return formatDecimal(value, Math.abs(value) < 0.01 ? 5 : 4) + " PLN";
    }

    function formatTariffUnitPrice(value) {
      if (value == null) {
        return "-- PLN/kWh";
      }

      return formatDecimal(value, Math.abs(value) < 0.01 ? 5 : 4) + " PLN/kWh";
    }

    function createTariffPanelRow(labelText, valueText, modifier) {
      const row = document.createElement("div");
      row.className = "summary-tariff-panel__row" + (modifier ? " summary-tariff-panel__row--" + modifier : "");

      const label = document.createElement("span");
      label.textContent = labelText;

      const value = document.createElement("strong");
      value.textContent = valueText;

      row.appendChild(label);
      row.appendChild(value);
      return row;
    }

    function createTariffUnitTotalRow(info) {
      const row = createTariffPanelRow("Całkowity koszt zakupu 1 kWh", formatTariffUnitRate(info.totalUnitRate), "total");
      if (info.unitContext) {
        const label = row.firstElementChild;
        label.appendChild(document.createTextNode(" "));
        const context = document.createElement("span");
        context.className = "summary-tariff-panel__zone";
        context.textContent = info.unitContext;
        label.appendChild(context);
      }
      return row;
    }

    function renderTariffPanel(cardKey) {
      const model = state.models[cardKey];
      const info = model && model.tariffInfo ? model.tariffInfo : null;
      const toggle = tariffToggleButtons[cardKey];
      const panel = tariffPanels[cardKey];
      const content = tariffContents[cardKey];
      const tariffLabel = tariffLabels[cardKey];
      const isOpen = Boolean(info && state.tariffOpen === cardKey);

      if (tariffLabel && info && info.tariffLabel) {
        tariffLabel.textContent = info.tariffLabel;
      }

      if (toggle) {
        toggle.disabled = !info;
        toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      }

      if (!panel || !content) {
        return;
      }

      panel.hidden = !isOpen;
      content.textContent = "";
      if (!info) {
        return;
      }

      content.appendChild(createTariffPanelRow("Podstawa cen", info.priceBasisLabel, "detail"));
      content.appendChild(createTariffPanelRow("System rozliczeniowy", info.settlementLabel, "heading"));
      content.appendChild(createTariffPanelRow("Zakup energii", info.purchaseLabel, "heading"));
      (info.zones || []).forEach(function (zone) {
        content.appendChild(createTariffPanelRow(zone.label, formatTariffUnitPrice(zone.totalUnitRate), "zone"));
      });

      const purchaseSection = document.createElement("div");
      purchaseSection.className = "summary-tariff-panel__section";
      purchaseSection.appendChild(createTariffUnitTotalRow(info));
      purchaseSection.appendChild(createTariffPanelRow("Zakup energii", formatTariffUnitRate(info.energyRate)));
      purchaseSection.appendChild(createTariffPanelRow("Dystrybucja energii", formatTariffUnitRate(info.distributionRate)));
      (info.distributionRows || []).forEach(function (row) {
        purchaseSection.appendChild(createTariffPanelRow(row.label, formatTariffUnitRate(row.value), "detail"));
      });
      purchaseSection.appendChild(createTariffPanelRow("Opłaty stałe/miesiąc", formatValue(info.fixedTotal, "PLN", true)));
      (info.fixedRows || []).forEach(function (row) {
        purchaseSection.appendChild(createTariffPanelRow(row.label, formatValue(row.value, "PLN", true), "detail"));
      });
      content.appendChild(purchaseSection);

      const saleSection = document.createElement("div");
      saleSection.className = "summary-tariff-panel__section";
      saleSection.appendChild(createTariffPanelRow("Sprzedaż energii", info.saleLabel, "heading"));
      content.appendChild(saleSection);
      if (info.vatRows && info.vatRows.length) {
        const vatDetails = document.createElement("details");
        const vatSummary = document.createElement("summary");
        vatSummary.textContent = "VAT składników taryfy";
        vatDetails.appendChild(vatSummary);
        info.vatRows.forEach(function (row) {
          vatDetails.appendChild(createTariffPanelRow(row.label, row.basis, "detail"));
        });
        content.appendChild(vatDetails);
      }
    }

    function renderCard(cardKey) {
      const model = state.models[cardKey];
      const refs = getCardReferences(cardKey);

      if (!model) {
        setTotal(refs.total, null); setSavings(refs.savings, null);
        if (refs.list) refs.list.textContent = '';
        renderBar(refs.bar, [], null);
        if (cardKey === 'next') renderDepositBox(null);
        return;
      }

      ensureRowState(cardKey, model);
      renderBar(refs.bar, model.barSegments, state.scaleTotal);
      setTotal(refs.total, model.total);
      setSavings(refs.savings, model.savingsPln);

      if (refs.list) {
        refs.list.textContent = "";
        model.items.forEach(function (item) {
          refs.list.appendChild(createItemNode(cardKey, item));
        });
      }

      if (cardKey === "next") {
        renderDepositBox(model);
      }

      updateCardToggle(cardKey, model);
      renderTariffPanel(cardKey);
    }

    function createSummaryTotals(models, range) {
      const currentTotal = models && models.current ? models.current.total : null;
      const nextTotal = models && models.next ? models.next.total : null;

      return {
        range: range,
        currentTotal: currentTotal,
        nextTotal: nextTotal,
        savingsPln: currentTotal != null && nextTotal != null
          ? Math.max(currentTotal - nextTotal, 0)
          : null
      };
    }

    function getReYearSummaryTotals() {
      const totals = window.dashboardReYearTotals || null;
      if (!totals || totals.range !== "year") {
        return null;
      }

      const expectedEndKey = getSummaryYearEndKey();
      if (expectedEndKey && totals.endDateKey && totals.endDateKey !== expectedEndKey) {
        return null;
      }

      const currentTotal = firstFiniteNumber(totals.currentTotal);
      const nextTotal = firstFiniteNumber(totals.nextTotal);
      const savingsPln = firstFiniteNumber(
        totals.savingsPln,
        currentTotal != null && nextTotal != null ? Math.max(currentTotal - nextTotal, 0) : null
      );

      if (currentTotal == null && nextTotal == null && savingsPln == null) {
        return null;
      }

      return {
        range: "year",
        currentTotal: currentTotal,
        nextTotal: nextTotal,
        savingsPln: savingsPln,
        reBalancePln: firstFiniteNumber(totals.reBalancePln),
        depositPln: firstFiniteNumber(totals.depositPln),
        endDateKey: totals.endDateKey || "",
        source: "re"
      };
    }

    function cloneSummaryCardModel(model) {
      if (!model) {
        return null;
      }

      return Object.assign({}, model, {
        barSegments: (model.barSegments || []).map(function (segment) {
          return Object.assign({}, segment);
        }),
        items: (model.items || []).map(function (item) {
          return Object.assign({}, item, {
            details: (item.details || []).map(function (detail) {
              return Object.assign({}, detail);
            })
          });
        }),
        depositLedger: model.depositLedger ? Object.assign({}, model.depositLedger) : null
      });
    }

    function scaleSummaryMoney(value, factor) {
      return value != null && Number.isFinite(factor) ? value * factor : value;
    }

    function scaleSummaryCardMoney(model, targetTotal, savingsPln) {
      const next = cloneSummaryCardModel(model);
      if (!next) {
        return null;
      }

      const baseTotal = firstNumber(model.total);
      const factor = baseTotal && baseTotal > 0 && targetTotal != null
        ? targetTotal / baseTotal
        : 1;

      if (targetTotal != null) {
        next.total = targetTotal;
      }

      next.barSegments.forEach(function (segment) {
        if (segment.tone === "savings") {
          segment.value = savingsPln != null ? savingsPln : segment.value;
          return;
        }

        segment.value = scaleSummaryMoney(segment.value, factor);
      });

      next.items.forEach(function (item) {
        if (item.unit === "PLN") {
          item.value = scaleSummaryMoney(item.value, factor);
        }

        (item.details || []).forEach(function (detail) {
          if (detail.unit === "PLN") {
            detail.value = scaleSummaryMoney(detail.value, factor);
          }
        });
      });

      if (savingsPln != null) {
        next.savingsPln = savingsPln;
      }

      return next;
    }

    function applyReYearTotalsToModels(models) {
      if (!models || state.range !== "year" || !shouldUseSummaryForecast()) {
        return models;
      }

      syncReSliderToSummaryYear();
      const reYearTotals = getReYearSummaryTotals();
      if (!reYearTotals) {
        return models;
      }

      const current = scaleSummaryCardMoney(models.current, reYearTotals.currentTotal, null);
      const next = scaleSummaryCardMoney(models.next, reYearTotals.nextTotal, reYearTotals.savingsPln);
      if (!current || !next) {
        return models;
      }

      if (reYearTotals.depositPln != null) {
        next.depositLedger = Object.assign({}, next.depositLedger || {}, {
          endBalancePln: reYearTotals.depositPln
        });
      }

      return {
        scaleTotal: Math.max(
          reYearTotals.currentTotal || 0,
          (reYearTotals.nextTotal || 0) + (reYearTotals.savingsPln || 0)
        ),
        current: current,
        next: next
      };
    }

    function isReSummaryRange(range) {
      return range === "week" || range === "month" || range === "year";
    }

    function getSummaryRangeEndKey(range) {
      const anchor = state.anchorDate instanceof Date && Number.isFinite(state.anchorDate.getTime())
        ? state.anchorDate
        : new Date();
      const endDate = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());

      if (range === "year") {
        endDate.setMonth(11, 31);
      } else if (range === "month") {
        endDate.setMonth(endDate.getMonth() + 1, 0);
      } else if (range === "week") {
        const daysToSunday = (7 - endDate.getDay()) % 7;
        endDate.setDate(endDate.getDate() + daysToSunday);
      } else {
        return "";
      }

      return formatDateKey(endDate);
    }

    function getSummaryYearEndKey() {
      return getSummaryRangeEndKey("year");
    }

    function syncReSliderToSummaryRange(range) {
      if (!isReSummaryRange(range)) {
        return false;
      }

      const slider = document.getElementById("dateRange");
      if (!slider) {
        return false;
      }

      const startDate = parseDashboardDateKey(getDashboardReStartDate());
      const targetDate = parseDashboardDateKey(getSummaryRangeEndKey(range));
      if (!startDate || !targetDate) {
        return false;
      }

      const maxValue = firstFiniteNumber(slider.max);
      const targetValue = Math.max(0, Math.round((targetDate.getTime() - startDate.getTime()) / 86400000));
      const clampedValue = maxValue == null ? targetValue : Math.min(targetValue, maxValue);
      const nextValue = String(clampedValue);
      if (slider.value === nextValue) {
        return false;
      }

      slider.value = nextValue;
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    function syncReSliderToSummaryYear() {
      return syncReSliderToSummaryRange("year");
    }

    function publishSummaryTotals() {
      const summaryTotals = createSummaryTotals(state.models, state.range);

      window.dashboardSummaryTotals = summaryTotals;
      document.dispatchEvent(new CustomEvent("dashboard:summary-updated", {
        detail: summaryTotals
      }));
    }

    function publishSummaryPanelTotals() {
      const payload = window.dashboardLatestPayload || {};
      const previousForceForecast = state.forceForecast;
      let models = null;

      if (isReSummaryRange(state.range)) {
        syncReSliderToSummaryRange(state.range);
      }

      if (state.range === "year") {
        const reYearTotals = getReYearSummaryTotals();
        if (reYearTotals) {
          window.dashboardSummaryPanelTotals = reYearTotals;
          document.dispatchEvent(new CustomEvent("dashboard:summary-panel-updated", {
            detail: window.dashboardSummaryPanelTotals
          }));
          return;
        }
      }

      state.forceForecast = true;
      models = buildTariffModels(payload) || buildModels(payload);
      state.forceForecast = previousForceForecast;

      window.dashboardSummaryPanelTotals = createSummaryTotals(models, state.range);
      document.dispatchEvent(new CustomEvent("dashboard:summary-panel-updated", {
        detail: window.dashboardSummaryPanelTotals
      }));
    }

    function applyPayload() {
try {
      const payload = window.dashboardLatestPayload || {};
      const payloadAnchorDate = getSummaryAnchorDate(payload);
      const payloadAnchorKey = formatDateKey(payloadAnchorDate);

      if (!state.anchorSourceKey || (!state.anchorTouched && state.anchorSourceKey !== payloadAnchorKey)) {
        state.anchorDate = payloadAnchorDate;
        state.anchorSourceKey = payloadAnchorKey;
        updateToolbar();
      }

      state.anchorDate = clampSummaryAnchorDate(state.anchorDate);
      updateToolbar();
      const tariffModels = buildTariffModels(payload);
      const models = payload.tariffHistory?.strict && !window.dashboardReForecastEnabled ? tariffModels : applyReYearTotalsToModels(payload.tariffHistory?.strict ? tariffModels : tariffModels || buildModels(payload));
      if (!models) {
        state.scaleTotal = null;
        state.models.current = null;
        state.models.next = null;
        state.tariffOpen = null;
        renderTariffPanel("current");
        renderTariffPanel("next");
        renderCard("current"); renderCard("next");
        publishSummaryTotals(); publishSummaryPanelTotals();
        return;
      }

      state.scaleTotal = models.scaleTotal;
      state.models.current = models.current;
      state.models.next = models.next;

      renderCard("current");
      renderCard("next");
      publishSummaryTotals();
      publishSummaryPanelTotals();
    
} catch (error) {
  if (!window.dashboardLatestPayload?.tariffHistory?.strict) throw error;
  clientTariffNotice(error.message); state.scaleTotal = null; state.models.current = null; state.models.next = null;
  renderCard("current"); renderCard("next"); renderTariffPanel("current"); renderTariffPanel("next");
  publishSummaryTotals(); publishSummaryPanelTotals();
}
}

    function setSummaryRange(nextRange) {
      const allowedRanges = ["day", "week", "month", "year"];
      state.range = allowedRanges.indexOf(nextRange) !== -1 ? nextRange : "day";
      state.anchorDate = clampSummaryAnchorDate(state.anchorDate);
      updateToolbar();
      applyPayload();
    }

    window.setDashboardSummaryRange = function (nextRange) {
      setSummaryRange(nextRange);
    };

    window.getDashboardSummaryRange = function () {
      return state.range;
    };

    rangeButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        setSummaryRange(button.getAttribute("data-summary-range") || "day");
      });
    });

    shiftButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        shiftRange(Number(button.getAttribute("data-summary-shift") || 0));
      });
    });

    [currentDateButton, currentTimeButton].forEach(function (button) {
      if (!button) {
        return;
      }

      button.addEventListener("click", function () {
        state.range = "day";
        state.anchorDate = getDashboardNavigationDay(new Date());
        state.anchorTouched = true;
        state.anchorSourceKey = formatDateKey(state.anchorDate);
        updateToolbar();
        applyPayload();
      });
    });

    Object.keys(toggleButtons).forEach(function (cardKey) {
      const toggle = toggleButtons[cardKey];

      if (!toggle) {
        return;
      }

      toggle.addEventListener("click", function () {
        const model = state.models[cardKey];
        if (!model) {
          return;
        }

        const shouldOpen = !model.items.some(function (item) {
          return item.details && item.details.length && state.rows[cardKey][item.id];
        });

        model.items.forEach(function (item) {
          if (item.details && item.details.length) {
            state.rows[cardKey][item.id] = shouldOpen;
          }
        });

        renderCard(cardKey);
      });
    });

    Object.keys(tariffToggleButtons).forEach(function (cardKey) {
      const toggle = tariffToggleButtons[cardKey];
      if (!toggle) {
        return;
      }

      toggle.addEventListener("click", function () {
        if (!state.models[cardKey] || !state.models[cardKey].tariffInfo) {
          return;
        }

        state.tariffOpen = state.tariffOpen === cardKey ? null : cardKey;
        renderTariffPanel("current");
        renderTariffPanel("next");
      });
    });

    document.addEventListener("click", function (event) {
      if (!state.tariffOpen || event.target.closest("[data-summary-tariff-toggle], [data-summary-tariff-panel]")) {
        return;
      }

      state.tariffOpen = null;
      renderTariffPanel("current");
      renderTariffPanel("next");
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape" || !state.tariffOpen) {
        return;
      }

      state.tariffOpen = null;
      renderTariffPanel("current");
      renderTariffPanel("next");
    });

    document.addEventListener("dashboard:payload-updated", applyPayload);
    document.addEventListener("dashboard:bank-updated", applyPayload);
    document.addEventListener("dashboard:prosumer-updated", applyPayload);
    document.addEventListener("dashboard:bank-incremental-updated", applyPayload);
    document.addEventListener("dashboard:re-forecast-updated", function () {
      if (window.dashboardReForecastEnabled) {
        applyPayload();
      } else {
        publishSummaryPanelTotals();
      }
    });
    document.addEventListener("dashboard:re-year-totals-updated", function () {
      if (isReSummaryRange(state.range)) {
        if (shouldUseSummaryForecast()) {
          applyPayload();
        } else {
          publishSummaryPanelTotals();
        }
      }
    });
    document.addEventListener("dashboard:re-native-ready", function () {
      if (isReSummaryRange(state.range)) {
        if (shouldUseSummaryForecast()) {
          applyPayload();
        } else {
          publishSummaryPanelTotals();
        }
      }
    });
    document.addEventListener("detailview:open", function (event) {
      const viewName = event && event.detail ? event.detail.view : "";

      if (viewName !== "summary") {
        return;
      }

      if (window.dashboardReForecastEnabled && window.dashboardReForecastSimulation) {
        return;
      }

      if (typeof setDashboardReForecastEnabled === "function") {
        setDashboardReForecastEnabled(true).catch(function () {});
      }
    });

    updateToolbar();
    applyPayload();
  }

  function initDashboardBindings() {
    const depositValue = document.getElementById("dashboard-deposit-value");
    const depositDays = document.getElementById("dashboard-deposit-days");
    const depositScene = document.querySelector(".scene-object--deposit");
    const salePrice = document.getElementById("dashboard-sale-price");
    const saleCard = document.querySelector(".card-sale");
    const saleCardTitle = saleCard ? saleCard.querySelector("h2") : null;
    const weatherTitle = document.getElementById("dashboard-weather-title");
    const weatherLabel = document.getElementById("dashboard-weather-label");
    const weatherDetails = document.getElementById("dashboard-weather-details");
    const weatherIcon = document.getElementById("dashboard-weather-icon");
    const productionValue = document.getElementById("dashboard-production-value");
    const productionPowerValue = document.getElementById("dashboard-production-power-value");
    const productionTrend = document.getElementById("dashboard-production-trend");
    const purchasePrice = document.getElementById("dashboard-purchase-price");
    const usageValue = document.getElementById("dashboard-usage-value");
    const usagePowerValue = document.getElementById("dashboard-usage-power-value");
    const usageTrend = document.getElementById("dashboard-usage-trend");
    const bankValue = document.getElementById("dashboard-bank-value");
    const bankPowerValue = document.getElementById("dashboard-bank-power-value");
    const bankIconBars = Array.from(document.querySelectorAll(".card-bank .battery-level__bar"));
    const dailyBill = document.getElementById("dashboard-daily-bill");
    const dailySavings = document.getElementById("dashboard-daily-savings");
    const strategyBar = document.getElementById("dashboard-strategy");
    const strategyViewport = document.getElementById("dashboard-strategy-viewport");
    const strategyText = document.getElementById("dashboard-strategy-text");
    const strategyTitle = document.getElementById("dashboard-strategy-title");
    const strategyTime = document.getElementById("dashboard-strategy-time");
    const strategyNav = document.getElementById("dashboard-strategy-nav");
    const summaryRangeButtons = Array.from(document.querySelectorAll("[data-dashboard-summary-range]"));
    const saleChart = document.getElementById("dashboard-sale-chart");
    const saleChartFallback = document.getElementById("dashboard-sale-chart-fallback");
    const saleChartTooltip = document.getElementById("dashboard-sale-chart-tooltip");
    const saleChartOverlay = saleChart ? saleChart.parentElement : null;
    const purchaseCard = document.querySelector(".card-purchase");
    const purchaseCardTitle = purchaseCard ? purchaseCard.querySelector("h2") : null;
    const purchaseChart = document.getElementById("dashboard-purchase-chart");
    const purchaseChartFallback = document.getElementById("dashboard-purchase-chart-fallback");
    const purchaseTariffLabel = document.getElementById("dashboard-purchase-tariff-label");
    const purchaseChartTooltip = document.getElementById("dashboard-purchase-chart-tooltip");
    const purchaseChartOverlay = purchaseChart ? purchaseChart.parentElement : null;
    let strategyMessages = [];
    let strategyMessageIndex = 0;
    let latestStrategyTime = "";
    let latestStrategyView = "bank";
    let dashboardOnlineWeather = null;
    let dashboardWeatherFetchedAt = 0;
    let dashboardWeatherLocationKey = "";
    let dashboardWeatherPending = false;
    const depositSceneLevels = [
      "images/depozyt_v2-subtle.gif",
      "images/depozyt_v2-subtle2.gif",
      "images/depozyt_v2-subtle3.gif",
      "images/depozyt_v2-subtle4.gif",
      "images/depozyt_v2-subtle5.gif",
      "images/depozyt_v2-subtle6.gif",
      "images/depozyt_v2-subtle7.gif",
      "images/depozyt_v2-subtle9.gif"
    ];

    function updateDashboardTrend(element, status) {
      if (!element) {
        return;
      }

      const directions = {
        niski: "down",
        optymalny: "level",
        wysoki: "up"
      };
      const direction = directions[String(status || "").toLowerCase()] || "";

      element.hidden = !direction;
      if (direction) {
        element.setAttribute("data-direction", direction);
      } else {
        element.removeAttribute("data-direction");
      }
    }

    function numberOrNull(value) {
      if (value == null || value === "") {
        return null;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    }

    function firstNumber() {
      for (let i = 0; i < arguments.length; i += 1) {
        const numeric = numberOrNull(arguments[i]);
        if (numeric != null) {
          return numeric;
        }
      }
      return null;
    }

    function firstText() {
      for (let i = 0; i < arguments.length; i += 1) {
        const value = arguments[i];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
      return "";
    }

    function getPurchaseTariffLabelSrc(payload) {
      const source = payload || {};
      const account = source.account || {};
      const tariffData = source.tariffData || {};
      const settings = account.tariffSettings && typeof account.tariffSettings === "object"
        ? account.tariffSettings
        : {};
      const target = settings.target || {};
      const current = settings.current || {};
      const nextTariff = tariffData.next || {};
      const currentTariff = tariffData.current || {};
      const providerKey = normalizeText(firstText(
        target.operator,
        target.provider,
        target.osdName,
        nextTariff.provider,
        nextTariff.osd_name,
        tariffData.provider,
        current.operator,
        current.provider,
        current.osdName,
        currentTariff.provider,
        currentTariff.osd_name
      ));
      const tariffKey = normalizeText(firstText(
        target.code && target.name ? target.code + " " + target.name : "",
        target.code,
        target.name,
        nextTariff.code && nextTariff.name ? nextTariff.code + " " + nextTariff.name : "",
        nextTariff.code,
        nextTariff.name,
        current.code && current.name ? current.code + " " + current.name : "",
        current.code,
        current.name,
        currentTariff.code && currentTariff.name ? currentTariff.code + " " + currentTariff.name : "",
        currentTariff.code,
        currentTariff.name
      )).replace(/[^a-z0-9]/g, "");
      const provider = providerKey.replace(/[^a-z0-9]/g, "");

      if (provider.indexOf("pge") !== -1 && tariffKey.indexOf("g12e") !== -1) {
        return "images/taryfa-pge-g12e.svg?v=20260617b";
      }

      if (provider.indexOf("enea") !== -1 && tariffKey.indexOf("c13active") !== -1) {
        return "images/taryfa-enea-c13active.svg";
      }

      if (provider.indexOf("enea") !== -1 && tariffKey.indexOf("g13active") !== -1) {
        return "images/taryfa-g13-active.svg";
      }

      return "images/taryfa-g13-active.svg";
    }

    function updatePurchaseTariffLabel(payload) {
      if (!purchaseTariffLabel) {
        return;
      }

      const nextSrc = getPurchaseTariffLabelSrc(payload);
      const nextVariant = nextSrc.indexOf("taryfa-pge-g12e.svg") !== -1
        ? "pge-g12e"
        : nextSrc.indexOf("taryfa-enea-c13active.svg") !== -1
          ? "enea-c13active"
          : "g13active";

      purchaseTariffLabel.setAttribute("data-tariff-label", nextVariant);
      if (purchaseTariffLabel.getAttribute("src") !== nextSrc) {
        purchaseTariffLabel.setAttribute("src", nextSrc);
      }
    }

    function formatNumber(value, digits) {
      return Number(value || 0).toFixed(digits == null ? 1 : digits).replace(".", ",");
    }

    function parseSqlDateTime(value) {
      if (typeof value !== "string" || !value.trim()) {
        return null;
      }

      const normalized = value.trim().replace(" ", "T");
      const parsed = new Date(normalized);

      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function setMetric(element, value, unit, digits) {
      if (!element) {
        return;
      }

      if (value == null) {
        element.innerHTML = "-- <span>" + unit + "</span>";
        return;
      }

      element.innerHTML = formatNumber(value, digits) + " <span>" + unit + "</span>";
    }

    function setPrice(element, value) {
      if (!element) {
        return;
      }

      if (value == null) {
        element.innerHTML = "-- <span>PLN / kWh</span>";
        return;
      }

      const isSale = element === salePrice && window.DashboardPricing;
      const suffix = isSale && window.DashboardPricing.basis === "net" ? " netto" : "";
      element.innerHTML = formatNumber(value, 2) + " <span>PLN / kWh" + suffix + "</span>";
      if (isSale) element.title = window.DashboardPricing.saleDescription();
    }

    function setMoney(element, value) {
      if (!element) {
        return;
      }

      if (value == null) {
        element.innerHTML = "-- <span>PLN</span>";
        return;
      }

      element.innerHTML = formatNumber(value, 1) + " <span>PLN</span>";
    }

    function setDays(element, value) {
      if (!element) {
        return;
      }

      if (value == null) {
        element.innerHTML = "-- <span>dni</span>";
        return;
      }

      element.innerHTML = Math.max(0, Math.round(value)) + " <span>dni</span>";
    }

    function updateDepositSceneLevel(coverageDays) {
      if (!depositScene || coverageDays == null || !depositSceneLevels.length) {
        return;
      }

      const numericCoverageDays = Number(coverageDays);
      if (!Number.isFinite(numericCoverageDays)) {
        return;
      }

      const fillRatio = Math.max(0, Math.min(1, numericCoverageDays / 365));
      const levelIndex = Math.round(fillRatio * (depositSceneLevels.length - 1));
      const nextSrc = depositSceneLevels[levelIndex];

      if (depositScene.getAttribute("src") !== nextSrc) {
        depositScene.setAttribute("src", nextSrc);
      }
    }

    function getDashboardReNativeDepositCoverageDays(anchorKey, initialDepositPln) {
      if (!window.__dashboardReFullAppReady) return null;
      const bridge = window.__dashboardReBridge || {};
      const fn = typeof window.getReDepositCoverageDays === "function"
        ? window.getReDepositCoverageDays
        : (typeof bridge.getReDepositCoverageDays === "function" ? bridge.getReDepositCoverageDays : null);

      if (typeof fn !== "function") {
        return null;
      }

      try {
        return numberOrNull(fn(anchorKey, {
          maxDays: 730,
          initialDepositPln: initialDepositPln
        }));
      } catch (error) {
        console.warn("Nie udało się policzyć dni pokrycia depozytu z Re", error);
        return null;
      }
    }

    function setSummaryMoney(element, value, signed) {
      if (!element) {
        return;
      }

      if (value == null) {
        element.innerHTML = "-- <span>PLN</span>";
        return;
      }

      const numeric = Number(value);
      const sign = signed && numeric > 0 ? "+ " : signed && numeric < 0 ? "- " : "";
      element.innerHTML = sign + formatNumber(Math.abs(numeric), 2) + " <span>PLN</span>";
    }

    function normalizePercent(value) {
      if (value == null) {
        return null;
      }

      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return null;
      }

      const percent = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
      return Math.max(0, Math.min(100, percent));
    }

    function setPercentMetric(element, value) {
      if (!element) {
        return;
      }

      const percent = normalizePercent(value);
      if (percent == null) {
        element.innerHTML = "--<span>%</span>";
        return;
      }

      element.innerHTML = formatNumber(percent, 0) + "<span>%</span>";
    }

    function getDashboardDepositPln(rawEnergy, normalizedEnergy, breakdown, simulation, day, hourEntry) {
      const raw = rawEnergy || {};
      const energy = normalizedEnergy || {};

      return firstNumber(
        window.dashboardCurrentDepositPln,
        breakdown && breakdown.currentDepositPln,
        breakdown && breakdown.depositWorthPln,
        hourEntry && hourEntry.endDepositPln,
        day && day.endDepositPln,
        simulation && simulation.latestDepositPln,
        simulation && simulation.endDepositPln,
        raw.depositValuePln,
        raw.depositWorthPln,
        raw.depositPln,
        raw.wartoscDepozytuPln,
        energy.depositValuePln
      );
    }

    function applyDashboardDepositValue(rawEnergy, normalizedEnergy) {
      const simulation = window.dashboardProsumerSimulation || window.dashboardBankSimulation;
      const coverageSimulation = window.dashboardReForecastSimulation || simulation;
      const day = getLatestSimulationDay();
      const hourEntry = getLatestSimulationHour(day);
      const currentDepositPln = getDashboardDepositPln(
        rawEnergy,
        normalizedEnergy,
        window.dashboardDepositBreakdown || null,
        simulation,
        day,
        hourEntry
      );

      setMoney(depositValue, currentDepositPln);
      const anchorKey = formatDashboardDateKey(getDashboardPayloadAnchorDate(window.dashboardLatestPayload || {}));
      const nativeCoverageDays = getDashboardReNativeDepositCoverageDays(anchorKey, currentDepositPln);
      const coverageDays = nativeCoverageDays != null
        ? nativeCoverageDays
        : getDashboardDepositCoverageDays(
            coverageSimulation,
            anchorKey,
            currentDepositPln
          );

      setDays(depositDays, coverageDays);
      updateDepositSceneLevel(coverageDays);
    }

    function updateSummaryCardTabs(range) {
      const activeRange = range || "day";

      summaryRangeButtons.forEach(function (button) {
        const isActive = button.getAttribute("data-dashboard-summary-range") === activeRange;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }

    function splitStrategyMessages(value) {
      if (typeof value !== "string") {
        return [];
      }

      return value
        .split("|")
        .map(function (entry) {
          return compactStrategySlotMessage(entry.replace(/\s+/g, " ").trim());
        })
        .filter(Boolean);
    }

    function compactStrategySlotMessage(message) {
      if (typeof message !== "string" || !/15[- ]minut/i.test(message)) {
        return message;
      }

      const slotPattern = /(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})-(\d{2}):(\d{2})\s+~\s*([0-9]+(?:[.,][0-9]+)?)\s*kWh/g;
      const slots = [];
      let match = null;

      while ((match = slotPattern.exec(message)) !== null) {
        const datePart = match[1];
        const startText = match[2] + ":" + match[3];
        const endText = match[4] + ":" + match[5];
        const startDate = new Date(datePart + "T" + startText + ":00");
        const endDate = new Date(datePart + "T" + endText + ":00");
        const kwh = Number(String(match[6]).replace(",", "."));

        if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
          slots.push({
            datePart: datePart,
            startText: startText,
            endText: endText,
            startDate: startDate,
            endDate: endDate,
            kwh: Number.isFinite(kwh) ? kwh : null,
            matchIndex: match.index
          });
        }
      }

      if (!slots.length) {
        return message;
      }

      slots.sort(function (a, b) {
        return a.startDate.getTime() - b.startDate.getTime();
      });

      const groups = [];
      slots.forEach(function (slot) {
        const last = groups[groups.length - 1];
        if (
          last &&
          slot.datePart === last.datePart &&
          slot.startDate.getTime() - last.endDate.getTime() <= 60000
        ) {
          last.endText = slot.endText;
          last.endDate = slot.endDate;
          last.kwh += slot.kwh || 0;
          return;
        }

        groups.push({
          datePart: slot.datePart,
          startText: slot.startText,
          endText: slot.endText,
          startDate: slot.startDate,
          endDate: slot.endDate,
          kwh: slot.kwh || 0
        });
      });

      const hasMultipleDates = groups.some(function (group) {
        return group.datePart !== groups[0].datePart;
      });

      const rangeText = groups.map(function (group) {
        const prefix = hasMultipleDates ? formatStrategyShortDate(group.datePart) + " " : "";
        return prefix + group.startText + "-" + group.endText;
      }).join(", ");

      const now = new Date();
      const nearestSlot = slots.find(function (slot) {
        return slot.startDate.getTime() >= now.getTime();
      }) || slots[0];
      const nearestText = formatStrategySlotStart(nearestSlot, now);
      const intro = message.slice(0, Math.max(0, slots[0].matchIndex)).replace(/:\s*$/, "");
      const compactIntro = (intro || "Plan")
        .replace(/\bwe\s+\d+\s+najlepszych\s+15[- ]minut[^\s,:]*/i, "w najlepszych godzinach")
        .replace(/\bw\s+\d+\s+najlepszych\s+15[- ]minut[^\s,:]*/i, "w najlepszych godzinach")
        .replace(/\b\d+\s+najlepszych\s+15[- ]minut[^\s,:]*/i, "najlepszych godzinach");

      return compactIntro + ": " + rangeText + ". Najbliższy slot 15 min zacznie się o " + nearestText + ".";
    }

    function formatStrategyShortDate(datePart) {
      const parts = String(datePart || "").split("-");
      if (parts.length !== 3) {
        return datePart;
      }

      return parts[2] + "." + parts[1];
    }

    function isSameStrategyDate(dateA, dateB) {
      return dateA instanceof Date &&
        dateB instanceof Date &&
        !Number.isNaN(dateA.getTime()) &&
        !Number.isNaN(dateB.getTime()) &&
        dateA.getFullYear() === dateB.getFullYear() &&
        dateA.getMonth() === dateB.getMonth() &&
        dateA.getDate() === dateB.getDate();
    }

    function formatStrategySlotStart(slot, referenceDate) {
      if (!slot) {
        return "--:--";
      }

      if (isSameStrategyDate(slot.startDate, referenceDate)) {
        return slot.startText;
      }

      return formatStrategyShortDate(slot.datePart) + " o " + slot.startText;
    }

    function formatStrategyClock(value) {
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return String(value.getHours()).padStart(2, "0") + ":" + String(value.getMinutes()).padStart(2, "0");
      }

      if (typeof value === "string" && value.trim()) {
        const clockMatch = value.match(/\b(\d{1,2}):(\d{2})\b/);
        if (clockMatch) {
          return String(clockMatch[1]).padStart(2, "0") + ":" + clockMatch[2];
        }

        const parsed = parseSqlDateTime(value);
        if (parsed) {
          return formatStrategyClock(parsed);
        }
      }

      return "";
    }

    function getStrategyClock(livePaths) {
      return formatStrategyClock(firstText(
        livePaths && livePaths.datastats,
        livePaths && livePaths.serverTime,
        livePaths && livePaths.timestamp,
        livePaths && livePaths.datetime
      )) || formatStrategyClock(new Date());
    }

    function getStrategyMeta(message) {
      const lower = String(message || "").toLowerCase();

      if (lower.indexOf("zakup") !== -1) {
        return { title: "Zakup energii", view: "purchase" };
      }
      if (lower.indexOf("sprzeda") !== -1) {
        return { title: "Sprzedaż energii", view: "sale" };
      }
      if (lower.indexOf("produkc") !== -1 || lower.indexOf("fotowolta") !== -1) {
        return { title: "Produkcja PV", view: "pv" };
      }
      if (lower.indexOf("pogod") !== -1 || lower.indexOf("temperatur") !== -1) {
        return { title: "Pogoda", view: "weather" };
      }
      if (lower.indexOf("depozy") !== -1) {
        return { title: "Stan depozytu", view: "deposit" };
      }
      if (lower.indexOf("magazyn") !== -1 || lower.indexOf("bank") !== -1) {
        return { title: "Stan banku energii", view: "bank" };
      }
      if (lower.indexOf("zuży") !== -1 || lower.indexOf("zuzy") !== -1) {
        return { title: "Zużycie energii", view: "usage" };
      }

      return { title: "Komunikat systemu", view: "summary" };
    }

    function renderStrategyNav() {
      if (!strategyNav) {
        return;
      }

      strategyNav.innerHTML = "";
      if (strategyMessages.length <= 1) {
        strategyNav.hidden = true;
        return;
      }

      strategyNav.hidden = false;
      [
        { direction: "previous", label: "Poprzedni komunikat", disabled: strategyMessageIndex <= 0 },
        { direction: "next", label: "Następny komunikat", disabled: strategyMessageIndex >= strategyMessages.length - 1 }
      ].forEach(function (item) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "summary-info-card__nav-button summary-info-card__nav-button--" + item.direction;
        button.setAttribute("data-strategy-message-direction", item.direction);
        button.setAttribute("aria-label", item.label);
        button.disabled = Boolean(item.disabled);
        button.innerHTML = item.direction === "previous"
          ? '<svg viewBox="0 0 25 25" aria-hidden="true" focusable="false"><path d="M14.7393 19.4806L7.49902 12.2403L14.7393 5L15.8038 6.06444L9.62771 12.2403L15.8038 18.4162L14.7393 19.4806Z" fill="currentColor"/></svg>'
          : '<svg viewBox="0 0 25 25" aria-hidden="true" focusable="false"><path d="M10.2597 5.51937L17.5 12.7597L10.2597 20L9.19525 18.9356L15.3713 12.7597L9.19525 6.58381L10.2597 5.51937Z" fill="currentColor"/></svg>';
        strategyNav.appendChild(button);
      });
    }

    function renderStrategyText() {
      if (!strategyBar || !strategyText) {
        return;
      }

      const currentMessage = strategyMessages[strategyMessageIndex] || "";
      if (!currentMessage) {
        strategyBar.hidden = true;
        strategyBar.removeAttribute("data-strategy-view");
        strategyText.textContent = "";
        if (strategyTitle) {
          strategyTitle.textContent = "Komunikat systemu";
        }
        if (strategyTime) {
          strategyTime.textContent = "--:--";
        }
        renderStrategyNav();
        return;
      }

      const meta = getStrategyMeta(currentMessage);

      latestStrategyView = meta.view;
      strategyBar.setAttribute("data-strategy-view", meta.view);
      strategyText.textContent = currentMessage;
      if (strategyTitle) {
        strategyTitle.textContent = meta.title;
      }
      if (strategyTime) {
        strategyTime.textContent = latestStrategyTime || formatStrategyClock(new Date());
      }
      if (strategyViewport) {
        strategyViewport.setAttribute(
          "aria-label",
          "Otwórz ekran: " + meta.title
        );
      }

      strategyBar.hidden = false;
      renderStrategyNav();
    }

    function showNextStrategyMessage() {
      if (strategyMessages.length <= 1 || strategyMessageIndex >= strategyMessages.length - 1) {
        return;
      }

      strategyMessageIndex += 1;
      renderStrategyText();
    }

    function showPreviousStrategyMessage() {
      if (strategyMessages.length <= 1 || strategyMessageIndex <= 0) {
        return;
      }

      strategyMessageIndex -= 1;
      renderStrategyText();
    }

    function openStrategyDetailView() {
      const targetTrigger = document.querySelector("[data-open-view='" + (latestStrategyView || "summary") + "']");
      if (targetTrigger && typeof targetTrigger.click === "function") {
        targetTrigger.click();
      }
    }

    function updateStrategyText(livePaths) {
      const previousMessage = strategyMessages[strategyMessageIndex] || "";
      const nextMessages = splitStrategyMessages(firstText(livePaths && livePaths.strategy));
      const preservedIndex = previousMessage ? nextMessages.indexOf(previousMessage) : -1;

      strategyMessages = nextMessages;
      strategyMessageIndex = preservedIndex >= 0 ? preservedIndex : 0;
      latestStrategyTime = getStrategyClock(livePaths || null);
      renderStrategyText();
    }

    function applyLivePathsUpdate(livePaths) {
      const previousPayload = window.dashboardLatestPayload || {};

      window.dashboardLatestPayload = Object.assign({}, previousPayload, {
        livePaths: livePaths || null
      });
      if (typeof window.updateDashboardFreshnessState === "function") {
        window.updateDashboardFreshnessState(window.dashboardLatestPayload);
      }
      updateStrategyText(livePaths || null);
      applyDashboardFlowCardMetrics(window.dashboardLatestPayload);

      document.dispatchEvent(new CustomEvent("dashboard:live-paths-updated", {
        detail: {
          source: previousPayload.source || "remote-live",
          payload: window.dashboardLatestPayload,
          livePaths: livePaths || null
        }
      }));
    }

    function setPowerMetric(element, value, unit) {
      if (!element) {
        return;
      }

      const unitLabel = unit || "W";

      if (value == null) {
        element.innerHTML = "--,-- <span>" + unitLabel + "</span>";
        return;
      }

      element.innerHTML = formatNumber(value, 0) + " <span>" + unitLabel + "</span>";
    }

    function isMainLivePathStatusWindow(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return false;
      }

      const second = date.getSeconds();
      return [10, 20, 30, 40, 50].some(function (targetSecond) {
        return Math.abs(second - targetSecond) <= 4;
      });
    }

    function getMainLivePathAgeSeconds(livePaths) {
      const datastats = parseSqlDateTime(livePaths && livePaths.datastats);
      if (!datastats) {
        return null;
      }

      const serverTime = parseSqlDateTime(livePaths && livePaths.serverTime);
      const now = serverTime || new Date();
      return Math.abs(now.getTime() - datastats.getTime()) / 1000;
    }

    function isMainLivePathsFresh(livePaths) {
      if (!livePaths || typeof livePaths !== "object") {
        return false;
      }

      const datastats = parseSqlDateTime(livePaths.datastats);
      const ageSeconds = firstNumber(livePaths.ageSeconds, getMainLivePathAgeSeconds(livePaths));
      const statusWindowValid = livePaths.statusWindowValid === true || isMainLivePathStatusWindow(datastats);

      return statusWindowValid && ageSeconds != null && ageSeconds <= 14;
    }

    function getFreshLivePaths(payload) {
      const livePaths = payload && payload.livePaths ? payload.livePaths : null;
      const paths = livePaths && livePaths.paths && typeof livePaths.paths === "object"
        ? livePaths.paths
        : null;

      return paths && isMainLivePathsFresh(livePaths) ? paths : null;
    }

    function getLiveUsagePowerW(payload) {
      const paths = getFreshLivePaths(payload);

      if (!paths) {
        return null;
      }

      const pathLoadPowerW = firstNumber(paths.victronToLoad);

      if (pathLoadPowerW != null) {
        return Math.max(0, pathLoadPowerW);
      }

      const explicitLoadPowerW = firstNumber(
        paths.load,
        paths.loadPowerW,
        paths.loadW,
        paths.homeLoad,
        paths.homeLoadPowerW,
        paths.currentLoadPowerW,
        paths.currentUsagePowerW,
        paths.usagePowerW,
        paths.consumptionPowerW,
        paths.currentConsumptionPowerW
      );

      if (explicitLoadPowerW != null) {
        return Math.max(0, explicitLoadPowerW);
      }

      const loadPathNames = [
        "gridToLoad",
        "bankToLoad",
        "storageToLoad",
        "batteryToLoad",
        "pvToLoad",
        "victronToLoad",
        "depositToLoad"
      ];
      let hasLoadPath = false;
      const loadPowerW = loadPathNames.reduce(function (total, pathName) {
        const value = firstNumber(paths[pathName]);

        if (value == null) {
          return total;
        }

        hasLoadPath = true;
        return total + Math.max(0, value);
      }, 0);

      return hasLoadPath ? loadPowerW : null;
    }

    function getLiveProductionPowerW(payload) {
      const paths = getFreshLivePaths(payload);

      if (!paths) {
        return null;
      }

      const explicitProductionPowerW = firstNumber(
        paths.pv,
        paths.pvPowerW,
        paths.productionPowerW,
        paths.currentProductionW,
        paths.currentProductionPowerW,
        paths.pvCurrentPowerW
      );

      if (explicitProductionPowerW != null) {
        return Math.max(0, explicitProductionPowerW);
      }

      const pvToVictronPowerW = firstNumber(
        paths.pvToVictron,
        paths.pvToInverter,
        paths.pvToHybrid,
        paths.pvToBus
      );

      if (pvToVictronPowerW != null) {
        return Math.max(0, pvToVictronPowerW);
      }

      const pvPathNames = Object.keys(paths).filter(function (pathName) {
        return /^pvTo/i.test(pathName);
      });
      let hasPvPath = false;
      const pvPowerW = pvPathNames.reduce(function (total, pathName) {
        const value = firstNumber(paths[pathName]);

        if (value == null) {
          return total;
        }

        hasPvPath = true;
        return total + Math.max(0, value);
      }, 0);

      return hasPvPath ? pvPowerW : null;
    }

    function getLiveBankPowerW(payload) {
      const paths = getFreshLivePaths(payload);

      if (!paths) {
        return null;
      }

      const chargePowerW = Math.max(0, firstNumber(paths.pvToBank, 0) || 0) +
        Math.max(0, firstNumber(paths.gridToBank, 0) || 0);
      const dischargePowerW = Math.max(0, firstNumber(paths.bankToLoad, 0) || 0) +
        Math.max(0, firstNumber(paths.bankToSell, paths.victronToSale, 0) || 0);
      const currentPowerW = Math.max(chargePowerW, dischargePowerW);

      return currentPowerW > 0 ? currentPowerW : null;
    }

    function getFallbackBankPowerW(rawEnergy, normalizedEnergy) {
      const raw = rawEnergy || {};
      const energy = normalizedEnergy || {};
      const directPowerW = firstNumber(
        raw.batteryPowerW,
        raw.storagePowerW,
        raw.batteryCurrentPowerW,
        energy.batteryPowerW,
        energy.storagePowerW
      );

      if (directPowerW != null) {
        return Math.abs(directPowerW);
      }

      const signedPowerKw = firstNumber(
        raw.batteryPowerKw,
        raw.storagePowerKw,
        energy.batteryPowerKw,
        energy.storagePowerKw
      );

      if (signedPowerKw != null) {
        return Math.abs(signedPowerKw * 1000);
      }

      const chargeKw = firstNumber(raw.batteryChargeKw, raw.storageChargeKw, raw.chargePowerKw);
      const dischargeKw = firstNumber(raw.batteryDischargeKw, raw.storageDischargeKw, raw.dischargePowerKw);
      const activeKw = Math.max(
        chargeKw == null ? 0 : Math.max(0, chargeKw),
        dischargeKw == null ? 0 : Math.max(0, dischargeKw)
      );

      return activeKw > 0 ? activeKw * 1000 : null;
    }

    function setBankStateMetric(kwhValue, socValue) {
      if (!bankValue) {
        return;
      }

      const kwhText = kwhValue == null ? "--" : formatNumber(kwhValue, 2);
      const percent = normalizePercent(socValue);
      const percentText = percent == null ? "--" : formatNumber(percent, 0);
      const filledBars = percent == null ? 0 : Math.min(4, Math.floor((percent + 5) / 25));
      bankIconBars.forEach(function (bar, index) {
        bar.setAttribute("visibility", index < filledBars ? "visible" : "hidden");
      });

      bankValue.innerHTML = kwhText +
        " <span>kWh</span> <span class=\"metric-card__separator\">/</span> " +
        "<span id=\"dashboard-bank-soc-value\" class=\"metric-card__percent\">" + percentText + "</span><span>%</span>";
    }

    function getLatestSimulationDay() {
      const simulation = window.dashboardProsumerSimulation || window.dashboardBankSimulation;
      if (!simulation) {
        return null;
      }

      const anchorKey = formatDashboardDateKey(getDashboardPayloadAnchorDate(window.dashboardLatestPayload || {}));
      if (anchorKey && simulation.dayMap && simulation.dayMap[anchorKey]) {
        return simulation.dayMap[anchorKey];
      }

      if (simulation.latestDateKey && simulation.dayMap && simulation.dayMap[simulation.latestDateKey]) {
        return simulation.dayMap[simulation.latestDateKey];
      }

      return simulation.days && simulation.days.length
        ? simulation.days[simulation.days.length - 1]
        : null;
    }

    function parseDateKey(value) {
      if (typeof value !== "string" || !value.trim()) {
        return null;
      }

      const parsed = new Date(value.trim().slice(0, 10) + "T00:00:00");
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function getLatestSimulationHour(day) {
      if (!day || !Array.isArray(day.hours) || !day.hours.length) {
        return null;
      }

      const payload = window.dashboardLatestPayload || {};
      const rawEnergy = payload.rawEnergy || {};
      const energy = payload.energy || {};
      const timestamp = parseSqlDateTime(firstText(
        rawEnergy.datetime,
        rawEnergy.reading_time,
        rawEnergy.timestamp,
        energy.timestamp
      ));
      const dayDate = parseDateKey(day.dateKey);
      if (!timestamp || !dayDate) {
        return day.hours[day.hours.length - 1];
      }

      if (
        timestamp.getFullYear() !== dayDate.getFullYear() ||
        timestamp.getMonth() !== dayDate.getMonth() ||
        timestamp.getDate() !== dayDate.getDate()
      ) {
        return day.hours[day.hours.length - 1];
      }

      const hourIndex = Math.max(0, Math.min(23, timestamp.getHours()));
      return day.hours[hourIndex] || day.hours[day.hours.length - 1];
    }

    function getLatestMeasuredStorageState(payload) {
      const storageRecords = payload && payload.storageData && Array.isArray(payload.storageData.records)
        ? payload.storageData.records
        : [];
      const state = {
        kwh: null,
        soc: null
      };

      for (let recordIndex = storageRecords.length - 1; recordIndex >= 0 && (state.kwh == null && state.soc == null); recordIndex -= 1) {
        const quarters = storageRecords[recordIndex] && Array.isArray(storageRecords[recordIndex].quarters)
          ? storageRecords[recordIndex].quarters
          : [];
        for (let quarterIndex = quarters.length - 1; quarterIndex >= 0; quarterIndex -= 1) {
          const quarter = quarters[quarterIndex] || null;
          state.kwh = firstNumber(quarter && quarter.energyKwh);
          state.soc = firstNumber(quarter && quarter.socPercent);
          if (state.kwh != null || state.soc != null) {
            return state;
          }
        }
      }

      return state;
    }

    function applyDashboardFlowCardMetrics(inputPayload) {
      const payload = inputPayload || window.dashboardLatestPayload || {};
      const rawEnergy = payload.rawEnergy || {};
      const normalizedEnergy = payload.energy || {};
      const latestMeasuredStorage = getLatestMeasuredStorageState(payload);
      const day = getLatestSimulationDay();
      const hourEntry = getLatestSimulationHour(day);
      const measuredProductionKwh = firstNumber(
        rawEnergy.pvTodayKwh,
        rawEnergy.productionKwh,
        normalizedEnergy.productionKwh
      );
      const measuredUsageKwh = firstNumber(
        rawEnergy.usageTodayKwh,
        rawEnergy.usageKwh,
        normalizedEnergy.usageKwh
      );
      const measuredBankKwh = firstNumber(
        rawEnergy.batteryLevelKwh,
        rawEnergy.storageLevelKwh,
        normalizedEnergy.batteryLevelKwh,
        latestMeasuredStorage.kwh
      );
      const measuredBankSoc = firstNumber(
        rawEnergy.batterySocPercent,
        rawEnergy.socPercent,
        rawEnergy.batterySoc,
        normalizedEnergy.batterySocPercent,
        normalizedEnergy.socPercent,
        latestMeasuredStorage.soc,
        measuredBankKwh != null && normalizedEnergy.batteryCapacityKwh != null && normalizedEnergy.batteryCapacityKwh > 0
          ? (measuredBankKwh / normalizedEnergy.batteryCapacityKwh) * 100
          : null,
        hourEntry && hourEntry.socPercent,
        day && day.endSocPercent
      );
      const usagePowerW = firstNumber(
        getLiveUsagePowerW(payload),
        normalizedEnergy.homeLoadPowerW,
        normalizedEnergy.acLoadPowerW,
        normalizedEnergy.usagePowerW,
        rawEnergy.homeLoadPowerW,
        rawEnergy.acLoadPowerW,
        rawEnergy.usagePowerW,
        normalizedEnergy.instantPowerW
      );
      const bankPowerW = firstNumber(
        getLiveBankPowerW(payload),
        getFallbackBankPowerW(rawEnergy, normalizedEnergy)
      );
      const productionPowerW = firstNumber(
        getLiveProductionPowerW(payload),
        normalizedEnergy.currentProductionW,
        normalizedEnergy.currentProductionPowerW,
        normalizedEnergy.pvCurrentPowerW,
        normalizedEnergy.pvPowerW,
        normalizedEnergy.productionPowerW,
        rawEnergy.currentProductionW,
        rawEnergy.currentProductionPowerW,
        rawEnergy.pvCurrentPowerW,
        rawEnergy.pvPowerW,
        rawEnergy.productionPowerW
      );

      setMetric(
        productionValue,
        measuredProductionKwh != null ? measuredProductionKwh : (day && day.totals ? day.totals.generationKwh : null),
        "kWh",
        2
      );
      setPowerMetric(productionPowerValue, productionPowerW, "W");
      setMetric(
        usageValue,
        measuredUsageKwh != null ? measuredUsageKwh : (day && day.totals ? day.totals.usageKwh : null),
        "kWh",
        2
      );
      setPowerMetric(usagePowerValue, usagePowerW, "W");
      setBankStateMetric(
        measuredBankKwh != null ? measuredBankKwh : (hourEntry ? hourEntry.endSocKwh : (day ? day.endSocKwh : null)),
        measuredBankSoc
      );
      setPowerMetric(bankPowerValue, bankPowerW, "W");
    }

    function applySimulationCardMetrics() {
      const payload = window.dashboardLatestPayload || {};

      applyDashboardDepositValue(payload.rawEnergy || {}, payload.energy || {});
      applyDashboardFlowCardMetrics(payload);
    }

    function normalizeEnergy(rawEnergy, source) {
      const energy = rawEnergy || {};
      const useSyntheticFallbacks = source === "random";
      const energyTimestamp = parseSqlDateTime(
        firstText(energy.datetime, energy.reading_time, energy.timestamp)
      );
      const isFreshLocalReading = source !== "local"
        || (energyTimestamp != null && (Date.now() - energyTimestamp.getTime()) <= 5000);
      const instantPowerW = isFreshLocalReading
        ? firstNumber(energy.instantPowerW, energy.WSYS, energy.power_w, energy.powerW)
        : null;
      const exportedEnergyKwh = instantPowerW != null && instantPowerW < 0
        ? Math.abs(instantPowerW) / 1000
        : null;
      const totalImportKwh = firstNumber(energy.totalImportKwh, energy.KWHPTOT, energy.total_kwh);
      const usageKwh = firstNumber(
        energy.usageTodayKwh,
        energy.usageKwh,
        useSyntheticFallbacks && instantPowerW != null ? Math.max(instantPowerW, 0) / 1000 * 4 : null
      );
      const productionKwh = firstNumber(
        energy.pvTodayKwh,
        energy.productionKwh,
        exportedEnergyKwh,
        useSyntheticFallbacks && usageKwh != null ? usageKwh * 0.58 : null
      );
      const productionPowerW = firstNumber(
        energy.currentProductionW,
        energy.currentProductionPowerW,
        energy.pvCurrentPowerW,
        energy.pvPowerW,
        energy.productionPowerW,
        energy.generatedPowerW,
        energy.generationPowerW,
        instantPowerW != null && instantPowerW < 0 ? Math.abs(instantPowerW) : null,
        useSyntheticFallbacks && productionKwh != null ? productionKwh * 250 : null
      );
      const explicitHomeLoadPowerW = firstNumber(
        energy.homeLoadPowerW,
        energy.acLoadPowerW,
        energy.usagePowerW,
        energy.acConsumptionPowerW,
        energy.loadPowerW
      );
      const batteryPowerKw = firstNumber(energy.batteryPowerKw, energy.storagePowerKw);
      const batteryChargeKw = firstNumber(energy.batteryChargeKw, energy.storageChargeKw, energy.chargePowerKw);
      const batteryDischargeKw = firstNumber(energy.batteryDischargeKw, energy.storageDischargeKw, energy.dischargePowerKw);
      let homeLoadPowerW = explicitHomeLoadPowerW != null ? Math.max(0, explicitHomeLoadPowerW) : null;

      if (homeLoadPowerW == null && (batteryPowerKw != null || batteryChargeKw != null || batteryDischargeKw != null || productionPowerW != null || instantPowerW != null)) {
        const gridNetPowerW = firstNumber(energy.gridNetPowerW, instantPowerW, 0) || 0;
        if (batteryPowerKw != null) {
          homeLoadPowerW = Math.max(0, (productionPowerW || 0) + gridNetPowerW - (batteryPowerKw * 1000));
        } else if (batteryChargeKw != null || batteryDischargeKw != null) {
          homeLoadPowerW = Math.max(0, (productionPowerW || 0) + gridNetPowerW + ((batteryDischargeKw || 0) * 1000) - ((batteryChargeKw || 0) * 1000));
        }
      }
      const depositKwh = firstNumber(
        energy.depositKwh,
        useSyntheticFallbacks && totalImportKwh != null ? Math.max(totalImportKwh * 0.08, 0) : null
      );
      const batteryLevelKwh = firstNumber(
        energy.batteryLevelKwh,
        energy.storageLevelKwh,
        energy.bankKwh,
        useSyntheticFallbacks && usageKwh != null ? usageKwh * 1.7 : null
      );
      const batteryCapacityKwh = firstNumber(
        energy.batteryCapacityKwh,
        energy.storageCapacityKwh,
        energy.bankCapacityKwh
      );
      const batterySocPercent = firstNumber(
        normalizePercent(firstNumber(
          energy.batterySocPercent,
          energy.socPercent,
          energy.batterySoc,
          energy.storageSocPercent
        )),
        batteryLevelKwh != null && batteryCapacityKwh != null && batteryCapacityKwh > 0
          ? (batteryLevelKwh / batteryCapacityKwh) * 100
          : null
      );
      const salePricePln = firstNumber(energy.salePricePln, energy.salePrice, useSyntheticFallbacks ? 0.82 : null);
      const purchasePricePln = firstNumber(energy.purchasePricePln, energy.purchasePrice, useSyntheticFallbacks ? 0.53 : null);
      const dailyBillPln = firstNumber(
        energy.dailyBillPln,
        useSyntheticFallbacks && usageKwh != null && purchasePricePln != null ? usageKwh * purchasePricePln : null
      );
      const dailySavingsPln = firstNumber(
        energy.dailySavingsPln,
        useSyntheticFallbacks && productionKwh != null && salePricePln != null ? productionKwh * salePricePln * 0.45 : null
      );

      return {
        instantPowerW: instantPowerW,
        homeLoadPowerW: homeLoadPowerW,
        acLoadPowerW: homeLoadPowerW,
        usagePowerW: homeLoadPowerW,
        productionPowerW: productionPowerW,
        totalImportKwh: totalImportKwh,
        usageKwh: usageKwh,
        productionKwh: productionKwh,
        depositKwh: depositKwh,
        batteryLevelKwh: batteryLevelKwh,
        batteryCapacityKwh: batteryCapacityKwh,
        batterySocPercent: batterySocPercent,
        socPercent: batterySocPercent,
        salePricePln: salePricePln,
        purchasePricePln: purchasePricePln,
        dailyBillPln: dailyBillPln,
        dailySavingsPln: dailySavingsPln,
        timestamp: energyTimestamp ? energyTimestamp.toISOString() : null,
        isFresh: isFreshLocalReading
      };
    }

    function normalizeWeather(rawWeather) {
      const weather = rawWeather || {};
      const temperatureC = firstNumber(weather.temperatureC, weather.temperature_C, weather.temp_c);
      const humidity = firstNumber(weather.humidity);
      const windAvgKmH = firstNumber(weather.windAvgKmH, weather.wind_avg_km_h);
      const windMaxKmH = firstNumber(
        weather.windMaxKmH,
        weather.wind_max_km_h,
        weather.windGustKmH,
        weather.wind_gust_km_h,
        windAvgKmH != null ? windAvgKmH * 1.7 : null
      );
      const rainMm = firstNumber(weather.rainMm, weather.rain_mm, weather.precipitationMm, weather.precipitation_mm);
      const cloudinessValue = firstNumber(
        weather.cloudinessPercent,
        weather.cloudiness,
        weather.cloudCover,
        weather.cloud_cover
      );
      const cloudiness = cloudinessValue == null
        ? null
        : (cloudinessValue > 1 ? clampNumber(cloudinessValue / 100, 0, 1) : clampNumber(cloudinessValue, 0, 1));
      const rawCondition = firstText(weather.condition, weather.description);
      const isNight = Boolean(weather.isNight) || /noc|night/.test(normalizeWeatherToken(rawCondition));
      const condition = firstText(
        weather.conditionLabel,
        describeWeatherCondition(rawCondition, {
          isNight: isNight,
          cloudiness: cloudiness,
          temperatureC: temperatureC
        }),
        "Pochmurnie"
      );
      const label = humidity != null
        ? "Wilgotność " + formatNumber(humidity, 0) + "%"
        : "Wilgotność --";

      const details = windAvgKmH != null
        ? "Śr. wiatr " + formatNumber(windAvgKmH, 1) + " km/h"
        : "Śr. wiatr --";

      return {
        temperatureC: temperatureC,
        humidity: humidity,
        windAvgKmH: windAvgKmH,
        windMaxKmH: windMaxKmH,
        rainMm: rainMm,
        condition: condition,
        label: label,
        iconPath: resolveWeatherIconPath(rawCondition || condition, {
          isNight: isNight,
          cloudiness: cloudiness,
          temperatureC: temperatureC
        }),
        iconKey: resolveWeatherIconKey(rawCondition || condition, {
          isNight: isNight,
          cloudiness: cloudiness,
          temperatureC: temperatureC
        }),
        cloudiness: cloudiness,
        isNight: isNight,
        details: details || "Brak szczegółów"
      };
    }

    function renderWeatherCard(rawWeather) {
      const weather = normalizeWeather(rawWeather);

      if (weatherTitle) {
        weatherTitle.textContent = (weather.temperatureC == null ? "--" : formatNumber(weather.temperatureC, 1)) + "\u00b0C, " + weather.condition;
      }
      if (weatherLabel) {
        weatherLabel.textContent = weather.label;
      }
      if (weatherDetails) {
        weatherDetails.textContent = weather.details;
      }
      if (weatherIcon && weather.iconPath) {
        weatherIcon.setAttribute("src", weather.iconPath);
      }

      return weather;
    }

    function requestDashboardWeather(force) {
      const now = Date.now();
      const location = getDashboardWeatherLocation();
      const locationKey = getDashboardWeatherLocationKey(location);

      if (dashboardWeatherPending) {
        return;
      }

      if (
        !force &&
        dashboardWeatherFetchedAt &&
        dashboardWeatherLocationKey === locationKey &&
        now - dashboardWeatherFetchedAt < DASHBOARD_WEATHER_REFRESH_MS
      ) {
        return;
      }

      if (typeof window.fetch !== "function") {
        return;
      }

      dashboardWeatherPending = true;

      window.fetch(getDashboardWeatherUrl(location), { cache: "no-store" })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("Open-Meteo HTTP " + response.status);
          }
          return response.json();
        })
        .then(function (openMeteoData) {
          if (getDashboardWeatherLocationKey() !== locationKey) {
            dashboardWeatherFetchedAt = 0;
            return;
          }

          dashboardOnlineWeather = normalizeDashboardOpenMeteoWeather(openMeteoData, location);
          dashboardWeatherFetchedAt = Date.now();
          dashboardWeatherLocationKey = locationKey;
          const weather = renderWeatherCard(dashboardOnlineWeather);

          if (window.dashboardLatestPayload) {
            window.dashboardLatestPayload.weather = weather;
            window.dashboardLatestPayload.dashboardOnlineWeather = dashboardOnlineWeather;
          }
        })
        .catch(function () {
          dashboardWeatherFetchedAt = Date.now();
        })
        .finally(function () {
          dashboardWeatherPending = false;
          if (getDashboardWeatherLocationKey() !== locationKey) {
            requestDashboardWeather(true);
          }
        });
    }

    function getLatestWeatherPoint(weatherData) {
      if (!weatherData || !Array.isArray(weatherData.records) || !weatherData.records.length) {
        return null;
      }

      const latestRecord = weatherData.records[weatherData.records.length - 1];
      const points = latestRecord && Array.isArray(latestRecord.hours) ? latestRecord.hours : null;

      if (!points || !points.length) {
        return null;
      }

      return points[points.length - 1];
    }

    function getCurrentPvWeatherSample(rawWeather, weatherData) {
      const latestPoint = getLatestWeatherPoint(weatherData);
      const weather = rawWeather || {};
      const now = new Date();
      const sample = {
        temperatureC: firstNumber(
          weather.temperatureC,
          weather.temperature_C,
          weather.temp_c,
          latestPoint && latestPoint.temperature_C,
          latestPoint && latestPoint.temperatureC
        ),
        rainMm: firstNumber(
          weather.rainMm,
          weather.rain_mm,
          latestPoint && latestPoint.rain_mm,
          latestPoint && latestPoint.rainMm
        ),
        uvi: firstNumber(weather.uvi, latestPoint && latestPoint.uvi),
        lightLux: firstNumber(
          weather.light_lux,
          weather.lightLux,
          latestPoint && latestPoint.light_lux,
          latestPoint && latestPoint.lightLux
        ),
        isNight: Boolean(weather.isNight) || Boolean(latestPoint && latestPoint.isNight),
        hour: firstNumber(latestPoint && latestPoint.hour, now.getHours()),
        minute: firstNumber(
          latestPoint && latestPoint.minute,
          latestPoint && latestPoint.minuteOfHour,
          now.getMinutes()
        )
      };

      if (
        sample.temperatureC == null &&
        sample.rainMm == null &&
        sample.uvi == null &&
        sample.lightLux == null
      ) {
        return null;
      }

      return sample;
    }

    function estimateCurrentPvPowerW(rawEnergy, rawWeather, weatherData) {
      const installedPowerKw = firstNumber(
        rawEnergy && rawEnergy.installedPowerKw,
        rawEnergy && rawEnergy.installationPowerKw,
        rawEnergy && rawEnergy.mocInstalacjiKw,
        rawEnergy && rawEnergy.powerKw,
        5
      );
      const sample = getCurrentPvWeatherSample(rawWeather, weatherData);

      if (!sample || !installedPowerKw) {
        return null;
      }

      if (sample.isNight) {
        return 0;
      }

      const luxRatio = sample.lightLux == null ? null : clampNumber(sample.lightLux / PV_LIGHT_LUX_REFERENCE, 0, 1.15);
      const uviRatio = sample.uvi == null ? null : clampNumber(sample.uvi / PV_UVI_REFERENCE, 0, 1.15);
      let solarRatio = null;

      if (luxRatio != null && uviRatio != null) {
        solarRatio = clampNumber(Math.max(luxRatio, uviRatio * 0.96), 0, 1);
      } else if (luxRatio != null || uviRatio != null) {
        solarRatio = clampNumber(luxRatio != null ? luxRatio : uviRatio, 0, 1);
      } else {
        const decimalHour = sample.hour + ((sample.minute || 0) / 60);
        if (decimalHour < 5 || decimalHour > 20) {
          return 0;
        }

        const phase = clampNumber((decimalHour - 5) / 15, 0, 1);
        solarRatio = Math.pow(Math.sin(Math.PI * phase), 1.35) * 0.68;
      }

      const temperaturePenalty = sample.temperatureC != null && sample.temperatureC > 25
        ? clampNumber(1 - ((sample.temperatureC - 25) * 0.0045), 0.82, 1)
        : 1;
      const rainPenalty = sample.rainMm != null
        ? clampNumber(1 - (Math.min(sample.rainMm, 2.2) * 0.18), 0.45, 1)
        : 1;
      const powerKw = clampNumber(installedPowerKw * solarRatio * temperaturePenalty * rainPenalty, 0, installedPowerKw);

      return Math.round(powerKw * 1000);
    }

    function normalizeRce(rawRce) {
      const rce = rawRce || {};
      const hourlyRates = Array.from({ length: 24 }, function (_, hour) {
        return { hour: hour, pricePln: null };
      });

      if (Array.isArray(rce.hourlyRates)) {
        rce.hourlyRates.forEach(function (entry) {
          const hour = Number(entry && entry.hour);
          if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
            return;
          }

          hourlyRates[hour] = {
            hour: hour,
            pricePln: firstNumber(entry.pricePln, entry.price, entry.value),
            salePricePln: getProsumerSalePricePln(firstNumber(entry.pricePln, entry.price, entry.value)),
            sampleCount: firstNumber(entry.sampleCount, entry.samples)
          };
        });
      }

      return {
        businessDate: firstText(rce.businessDate),
        currentPricePln: firstNumber(rce.currentPricePln, rce.pricePln),
        currentSalePricePln: getProsumerSalePricePln(firstNumber(rce.currentPricePln, rce.pricePln)),
        hourlyRates: hourlyRates
      };
    }

    function normalizePurchaseData(rawPurchase) {
      const purchase = rawPurchase || {};
      const hourlyRates = Array.from({ length: 24 }, function (_, hour) {
        return { hour: hour, pricePln: null, windowCode: null };
      });

      if (Array.isArray(purchase.hourlyRates)) {
        purchase.hourlyRates.forEach(function (entry) {
          const hour = Number(entry && entry.hour);
          if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
            return;
          }

          hourlyRates[hour] = {
            hour: hour,
            pricePln: firstNumber(entry.pricePln, entry.price, entry.value),
            windowCode: firstText(entry.windowCode, entry.window, entry.code)
          };
        });
      }

      return {
        businessDate: firstText(purchase.businessDate),
        tariffCode: firstText(purchase.tariffCode, purchase.code),
        tariffName: firstText(purchase.tariffName, purchase.name),
        currentHour: firstNumber(purchase.currentHour),
        currentPricePln: firstNumber(purchase.currentPricePln),
        lowestHour: firstNumber(purchase.lowestHour),
        lowestPricePln: firstNumber(purchase.lowestPricePln),
        lowestWindowCode: firstText(purchase.lowestWindowCode),
        hourlyRates: hourlyRates
      };
    }

    function resolveRcePriceForHour(rce, hour) {
      if (!rce || !Array.isArray(rce.hourlyRates)) {
        return null;
      }

      for (let index = 0; index < rce.hourlyRates.length; index += 1) {
        const entry = rce.hourlyRates[index];
        if (Number(entry && entry.hour) !== hour) {
          continue;
        }

        return firstNumber(entry && entry.pricePln, entry && entry.price, entry && entry.value);
      }

      return null;
    }

    function isEnergyActiveTariffLabel(label) {
      return normalizeText(label).indexOf("energia czynna") !== -1;
    }

    function isCapacityChargeTariffLabel(label) {
      return normalizeText(label).replace(/ł/g, "l").indexOf("oplata mocowa") !== -1;
    }

    function sumTariffVariableRowsForWindow(rows, windowCode, includeEnergyActive) {
      const normalizedWindowCode = normalizeText(windowCode || "all");

      return (rows || []).reduce(function (sum, row) {
        const rowWindowCode = normalizeText(row && row.window_code ? row.window_code : "all");
        if (normalizedWindowCode === "all") {
          if (rowWindowCode !== "all") {
            return sum;
          }
        } else if (rowWindowCode !== "all" && rowWindowCode !== normalizedWindowCode) {
          return sum;
        }

        const label = normalizeText(row && row.label);
        if (isCapacityChargeTariffLabel(label)) {
          return sum;
        }
        if (!includeEnergyActive && isEnergyActiveTariffLabel(label)) {
          return sum;
        }

        return sum + (Number(row && row.price) || 0);
      }, 0);
    }

    function resolveTariffWindowCodeForDateHour(tariff, dateKey, hour) {
      const zoneModel = normalizeText(tariff && tariff.zone_model ? tariff.zone_model : "all");
      if (!zoneModel || zoneModel === "all") {
        return "all";
      }

      const timestamp = new Date(dateKey + "T" + String(hour).padStart(2, "0") + ":00:00");
      if (!Number.isNaN(timestamp.getTime())) {
        const weekday = timestamp.getDay();
        const cheapSaturday = Boolean(tariff && tariff.cheap_saturday);
        const cheapSunday = Boolean(tariff && tariff.cheap_sunday);
        if ((weekday === 6 && cheapSaturday) || (weekday === 0 && cheapSunday)) {
          if (zoneModel === "daynight") {
            return "night";
          }
          if (zoneModel === "peakoffpeak") {
            return "offpeak";
          }
          if (zoneModel === "highmidlow") {
            return "low";
          }
        }
      }

      if (tariff && tariff.use_monthly && tariff.monthly) {
        const month = Number(String(dateKey || "").slice(5, 7));
        const row = tariff.monthly[String(month)] || tariff.monthly[month] || null;
        if (Array.isArray(row) && Object.prototype.hasOwnProperty.call(row, hour)) {
          const value = Number(row[hour]) || 2;
          if (zoneModel === "highmidlow") {
            return value === 1 ? "high" : (value === 3 ? "low" : "mid");
          }
          if (zoneModel === "daynight") {
            return value === 1 ? "night" : "day";
          }
          if (zoneModel === "peakoffpeak") {
            return value === 1 ? "offpeak" : "peak";
          }
        }
      }

      if (zoneModel === "daynight") {
        const nightHours = Array.isArray(tariff && tariff.dn_night) ? tariff.dn_night.map(Number) : [];
        return nightHours.indexOf(hour) !== -1 ? "night" : "day";
      }

      if (zoneModel === "peakoffpeak") {
        const offPeakHours = Array.isArray(tariff && tariff.po_off) ? tariff.po_off.map(Number) : [];
        return offPeakHours.indexOf(hour) !== -1 ? "offpeak" : "peak";
      }

      if (zoneModel === "highmidlow") {
        return "mid";
      }

      return "all";
    }

    function resolveTariffPurchasePrice(tariff, dateKey, hour, rce) {
      if (!tariff) return null;
      const sellMethod = normalizeText(tariff.sell_method || "fixed");
      const rcePrice = sellMethod === "rdn" ? resolveRcePriceForHour(rce, hour) : undefined;
      if (sellMethod === "rdn" && rcePrice == null) return null;
      return ReTariffEngine.rates(tariff, dateKey, hour, rcePrice, capacityOptions).total;
    }

    function buildCapacityChargeProfile(payload) {
      const totals = Array(24).fill(0);
      let samples = 0;
      const records = payload && payload.usageData && Array.isArray(payload.usageData.records) ? payload.usageData.records : [];
      records.forEach(function (record) {
        const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
        if (!quarters.length) return;
        samples += 1;
        quarters.forEach(function (quarter, index) {
          const hour = clampNumber(Math.round(firstNumber(quarter && quarter.hour, Math.floor(index / 4)) || 0), 0, 23);
          totals[hour] += Math.max(0, firstNumber(quarter && quarter.gridBilled, quarter && quarter.billedGrid,
            quarter && quarter.gridPhysical, quarter && quarter.grid, 0) || 0);
        });
      });
      return samples ? totals.map(function (value) { return value / samples; }) : null;
    }

    function buildPurchaseDataFromTariffPayload(payload, rce) {
      const tariffData = payload && payload.tariffData ? payload.tariffData : null;
      const tariff = tariffData && tariffData.next ? tariffData.next : null;
      if (!tariff) {
        return null;
      }

      const businessDate = formatDashboardDateKey(getDashboardPayloadAnchorDate(payload)) ||
        normalizeDashboardDateKey(rce && rce.businessDate) ||
        formatDashboardDateKey(new Date());
      const currentHour = new Date().getHours();
      const account = payload && payload.account || {};
      const settings = account.tariffSettings || {};
      const currentSettings = settings.current || {};
      const capacityOptions = {
        connectionPowerKw: firstNumber(currentSettings.contractPowerKw, settings.contractPowerKw, account.contractPowerKw),
        dayProfileKwh: buildCapacityChargeProfile(payload)
      };
      const hourlyRates = [];
      let currentPrice = null;
      let lowestEntry = null;

      for (let hour = 0; hour < 24; hour += 1) {
        const price = resolveTariffPurchasePrice(tariff, businessDate, hour, rce, capacityOptions);
        const windowCode = resolveTariffWindowCodeForDateHour(tariff, businessDate, hour);
        const entry = {
          hour: hour,
          windowCode: windowCode
        };

        if (price != null) {
          entry.pricePln = Number(price.toFixed(6));
          if (currentHour === hour) {
            currentPrice = price;
          }
          if (!lowestEntry || price < lowestEntry.pricePln) {
            lowestEntry = {
              hour: hour,
              pricePln: price,
              windowCode: windowCode
            };
          }
        }

        hourlyRates.push(entry);
      }

      if (currentPrice == null) {
        let firstAvailable = null;
        for (let index = 0; index < hourlyRates.length; index += 1) {
          if (hourlyRates[index] && hourlyRates[index].pricePln != null) {
            firstAvailable = hourlyRates[index];
            break;
          }
        }
        currentPrice = firstAvailable ? firstAvailable.pricePln : null;
      }

      if (!lowestEntry) {
        return null;
      }

      const result = {
        businessDate: businessDate,
        currentHour: currentHour,
        tariffCode: firstText(tariff.code),
        tariffName: firstText(tariff.name),
        hourlyRates: hourlyRates,
        lowestHour: lowestEntry.hour,
        lowestPricePln: Number(lowestEntry.pricePln.toFixed(6)),
        lowestWindowCode: lowestEntry.windowCode
      };

      if (currentPrice != null) {
        result.currentPricePln = Number(currentPrice.toFixed(6));
      }

      return result;
    }

    const saleChartTemplates = [
      { x1: 0, yb1: 228.094, yt1: 194.062, x2: 5.68329, yb2: 224.812, yt2: 190.781 },
      { x1: 11.3665, yb1: 221.531, yt1: 187.5, x2: 17.0497, yb2: 218.25, yt2: 184.219 },
      { x1: 22.7332, yb1: 214.969, yt1: 182.437, x2: 28.4164, yb2: 211.687, yt2: 179.156 },
      { x1: 34.0999, yb1: 208.406, yt1: 175.875, x2: 39.7831, yb2: 205.125, yt2: 172.594 },
      { x1: 45.4663, yb1: 201.844, yt1: 169.312, x2: 51.1496, yb2: 198.562, yt2: 166.031 },
      { x1: 56.833, yb1: 195.281, yt1: 160.125, x2: 62.5163, yb2: 192, yt2: 156.844 },
      { x1: 68.1995, yb1: 188.719, yt1: 146.062, x2: 73.8827, yb2: 185.437, yt2: 142.781 },
      { x1: 79.5662, yb1: 182.156, yt1: 131.625, x2: 85.2494, yb2: 178.875, yt2: 128.344 },
      { x1: 90.9326, yb1: 175.594, yt1: 128.062, x2: 96.6159, yb2: 172.312, yt2: 124.781 },
      { x1: 102.299, yb1: 169.031, yt1: 130.875, x2: 107.983, yb2: 165.75, yt2: 127.594 },
      { x1: 113.666, yb1: 162.469, yt1: 128.625, x2: 119.349, yb2: 159.187, yt2: 125.344 },
      { x1: 125.032, yb1: 155.906, yt1: 122.625, x2: 130.716, yb2: 152.625, yt2: 119.344 },
      { x1: 136.399, yb1: 149.344, yt1: 118.312, x2: 142.082, yb2: 146.062, yt2: 115.031 },
      { x1: 147.766, yb1: 142.781, yt1: 111.187, x2: 153.449, yb2: 139.5, yt2: 107.906 },
      { x1: 159.132, yb1: 136.219, yt1: 102.937, x2: 164.816, yb2: 132.937, yt2: 99.6562 },
      { x1: 170.499, yb1: 129.656, yt1: 92.4375, x2: 176.182, yb2: 126.375, yt2: 89.1562 },
      { x1: 181.865, yb1: 123.094, yt1: 73.6875, x2: 187.549, yb2: 119.812, yt2: 70.4062 },
      { x1: 193.232, yb1: 116.531, yt1: 45.9375, x2: 198.915, yb2: 113.25, yt2: 42.6562 },
      { x1: 204.598, yb1: 109.969, yt1: 42.375, x2: 210.282, yb2: 106.687, yt2: 39.0937 },
      { x1: 215.965, yb1: 103.406, yt1: 39.5625, x2: 221.648, yb2: 100.125, yt2: 36.2812 },
      { x1: 227.332, yb1: 96.8437, yt1: 45.1875, x2: 233.015, yb2: 93.5625, yt2: 41.9062 },
      { x1: 238.698, yb1: 90.2812, yt1: 50.0625, x2: 244.382, yb2: 87, yt2: 46.7812 },
      { x1: 250.065, yb1: 83.7187, yt1: 46.3125, x2: 255.748, yb2: 80.4375, yt2: 43.0312 },
      { x1: 261.431, yb1: 77.1562, yt1: 44.25, x2: 267.115, yb2: 73.875, yt2: 40.9687 }
    ];
    const purchaseChartTemplates = [
      { x1: 0, yb1: 236.156, yt1: 185.625, x2: 5.68329, yb2: 232.875, yt2: 229.594 },
      { x1: 11.3667, yb1: 229.594, yt1: 179.063, x2: 17.05, yb2: 226.312, yt2: 223.031 },
      { x1: 22.7332, yb1: 223.031, yt1: 172.5, x2: 28.4164, yb2: 219.75, yt2: 216.469 },
      { x1: 34.0999, yb1: 216.469, yt1: 165.937, x2: 39.7831, yb2: 213.188, yt2: 209.906 },
      { x1: 45.4663, yb1: 209.906, yt1: 159.375, x2: 51.1496, yb2: 206.625, yt2: 203.344 },
      { x1: 56.833, yb1: 203.344, yt1: 152.812, x2: 62.5163, yb2: 200.063, yt2: 196.782 },
      { x1: 68.1995, yb1: 184.781, yt1: 118.125, x2: 73.8827, yb2: 181.5, yt2: 178.219 },
      { x1: 79.5662, yb1: 178.219, yt1: 111.563, x2: 85.2494, yb2: 174.938, yt2: 171.656 },
      { x1: 90.9326, yb1: 171.656, yt1: 105, x2: 96.6159, yb2: 168.375, yt2: 165.094 },
      { x1: 102.299, yb1: 177.094, yt1: 126.562, x2: 107.983, yb2: 173.813, yt2: 170.531 },
      { x1: 113.666, yb1: 184.156, yt1: 156, x2: 119.349, yb2: 180.875, yt2: 177.594 },
      { x1: 125.032, yb1: 177.594, yt1: 149.438, x2: 130.716, yb2: 174.313, yt2: 171.031 },
      { x1: 136.399, yb1: 171.031, yt1: 142.875, x2: 142.082, yb2: 167.75, yt2: 164.469 },
      { x1: 147.766, yb1: 164.469, yt1: 136.313, x2: 153.449, yb2: 161.188, yt2: 157.906 },
      { x1: 159.132, yb1: 157.906, yt1: 129.75, x2: 164.815, yb2: 154.625, yt2: 151.344 },
      { x1: 170.499, yb1: 151.344, yt1: 123.188, x2: 176.182, yb2: 148.063, yt2: 144.781 },
      { x1: 181.865, yb1: 119.156, yt1: 52.5, x2: 187.549, yb2: 115.875, yt2: 112.594 },
      { x1: 193.232, yb1: 112.594, yt1: 45.9375, x2: 198.915, yb2: 109.313, yt2: 106.031 },
      { x1: 204.598, yb1: 106.031, yt1: 39.375, x2: 210.282, yb2: 102.75, yt2: 99.4688 },
      { x1: 215.965, yb1: 99.4688, yt1: 32.8125, x2: 221.648, yb2: 96.1875, yt2: 92.9062 },
      { x1: 227.332, yb1: 92.9062, yt1: 26.25, x2: 233.015, yb2: 89.625, yt2: 86.3438 },
      { x1: 238.698, yb1: 86.3438, yt1: 19.6875, x2: 244.382, yb2: 83.0625, yt2: 79.7812 },
      { x1: 250.065, yb1: 79.7812, yt1: 13.125, x2: 255.748, yb2: 76.5, yt2: 73.2188 },
      { x1: 261.431, yb1: 85.2188, yt1: 34.6875, x2: 267.115, yb2: 81.9375, yt2: 78.6563 }
    ];

    const saleBarHeightMultiplier = 1;
    const saleCardTailHeight = 18;
    const saleCardGap = 2;
    const saleCardMargin = 16;
    const saleCardTailWidth = 36;
    const floatingCardLift = 5;
    const saleCardRestoreDelayMs = 2000;
    let saleCardPeakEntry = null;
    let saleCardRestoreTimer = 0;
    let purchaseCardDefaultEntry = null;
    let purchaseCardRestoreTimer = 0;
    const saleChartTouchHandlers = Array.from({ length: 24 }, function () { return null; });
    const purchaseChartTouchHandlers = Array.from({ length: 24 }, function () { return null; });
    const dashboardWidth = 1920;
    const defaultChartMaxPrice = 1.80;
    let dashboardChartMaxPrice = defaultChartMaxPrice;
    const saleBarMaxHeight = 117;
    const saleBarRightYOffset = 3.28125;
    const saleBarBaselineLeft = [
      228.094, 221.531, 214.969, 208.406, 201.844, 195.281,
      188.719, 182.156, 175.594, 169.031, 162.469, 155.906,
      149.344, 142.781, 136.219, 129.656, 123.094, 116.531,
      109.969, 103.406, 96.8437, 90.2812, 83.7187, 77.1562
    ];
    const purchaseBarMaxHeight = 117;
    const purchaseBarRightYOffset = 3.28125;
    const purchaseBarBaselineLeft = [
      263.156, 256.594, 250.031, 243.469, 236.906, 230.344,
      223.781, 217.219, 210.656, 204.094, 197.531, 190.969,
      184.406, 177.844, 171.281, 164.719, 158.156, 151.594,
      145.031, 138.469, 131.906, 125.344, 118.781, 112.219
    ];

    function getSaleChartPrice(entry) {
      return firstNumber(
        entry && entry.salePricePln,
        getProsumerSalePricePln(entry && entry.pricePln)
      );
    }

    function updateDashboardChartMaxPrice(rce, purchaseData) {
      const prices = [];
      const saleRates = rce && Array.isArray(rce.hourlyRates) ? rce.hourlyRates : [];
      const purchaseRates = purchaseData && Array.isArray(purchaseData.hourlyRates) ? purchaseData.hourlyRates : [];

      saleRates.forEach(function (entry) {
        const price = getSaleChartPrice(entry);
        if (price != null && Number.isFinite(price) && price > 0) {
          prices.push(price);
        }
      });

      purchaseRates.forEach(function (entry) {
        const price = firstNumber(entry && entry.pricePln);
        if (price != null && Number.isFinite(price) && price > 0) {
          prices.push(price);
        }
      });

      if (!prices.length) {
        dashboardChartMaxPrice = defaultChartMaxPrice;
        return;
      }

      const maxPrice = Math.max.apply(null, prices);
      dashboardChartMaxPrice = (Math.ceil(maxPrice * 10) / 10) + 0.2;
    }

    function getPeakRceEntry(rce) {
      const rates = rce && Array.isArray(rce.hourlyRates) ? rce.hourlyRates : [];

      return rates.reduce(function (best, entry) {
        const price = getSaleChartPrice(entry);

        if (price == null) {
          return best;
        }

        if (!best || price > best.pricePln) {
          return {
            hour: entry.hour,
            pricePln: price,
            rcePricePln: firstNumber(entry && entry.pricePln)
          };
        }

        return best;
      }, null);
    }

    function getSaleBarGeometry(hour, ratio) {
      const template = saleChartTemplates[hour];
      if (!template) {
        return null;
      }

      const normalizedRatio = Math.max(0, Math.min(1, ratio == null ? 1 : ratio));
      const bottomLeft = saleBarBaselineLeft[hour];
      const bottomRight = bottomLeft - saleBarRightYOffset;
      const topLeft = bottomLeft - (saleBarMaxHeight * normalizedRatio);
      const topRight = bottomRight - (saleBarMaxHeight * normalizedRatio);

      return {
        x1: template.x1,
        x2: template.x2,
        yb1: bottomLeft,
        yb2: bottomRight,
        yt1: topLeft,
        yt2: topRight
      };
    }

    function lerpNumber(start, end, ratio) {
      return start + ((end - start) * ratio);
    }

    function getPurchaseBarGeometry(hour, ratio) {
      const template = purchaseChartTemplates[hour];
      if (!template) {
        return null;
      }

      const normalizedRatio = Math.max(0, Math.min(1, ratio == null ? 1 : ratio));
      const bottomLeft = purchaseBarBaselineLeft[hour];
      const bottomRight = bottomLeft - purchaseBarRightYOffset;
      const topLeft = bottomLeft - (purchaseBarMaxHeight * normalizedRatio);
      const topRight = bottomRight - (purchaseBarMaxHeight * normalizedRatio);

      return {
        x1: template.x1,
        x2: template.x2,
        yb1: bottomLeft,
        yb2: bottomRight,
        yt1: topLeft,
        yt2: topRight
      };
    }

    function getPurchaseBarRatio(pricePln) {
      if (pricePln == null) {
        return 0.12;
      }

      return Math.max(0, Math.min(1, pricePln / dashboardChartMaxPrice));
    }

    function getSaleBarRatio(pricePln) {
      if (pricePln == null) {
        return 0.05;
      }

      return Math.max(0, Math.min(1, pricePln / dashboardChartMaxPrice));
    }

    function buildRoundedBarPath(geometry) {
      if (!geometry) {
        return "";
      }

      const topDx = geometry.x2 - geometry.x1;
      const topDy = geometry.yt2 - geometry.yt1;
      const topLength = Math.sqrt((topDx * topDx) + (topDy * topDy)) || 1;
      const leftHeight = Math.max(0, geometry.yb1 - geometry.yt1);
      const rightHeight = Math.max(0, geometry.yb2 - geometry.yt2);
      const minSideHeight = Math.min(leftHeight, rightHeight);
      const maxRadius = Math.min(6, (geometry.x2 - geometry.x1) / 2, minSideHeight / 2);

      if (maxRadius <= 0.5) {
        return "M" + geometry.x1 + " " + geometry.yb1 +
          "L" + geometry.x1 + " " + geometry.yt1 +
          "L" + geometry.x2 + " " + geometry.yt2 +
          "L" + geometry.x2 + " " + geometry.yb2 + "Z";
      }

      const topInsetX = (topDx / topLength) * maxRadius;
      const topInsetY = (topDy / topLength) * maxRadius;
      const leftVerticalY = geometry.yt1 + maxRadius;
      const rightVerticalY = geometry.yt2 + maxRadius;
      const topStartX = geometry.x1 + topInsetX;
      const topStartY = geometry.yt1 + topInsetY;
      const topEndX = geometry.x2 - topInsetX;
      const topEndY = geometry.yt2 - topInsetY;

      return "M" + geometry.x1 + " " + geometry.yb1 +
        "L" + geometry.x1 + " " + leftVerticalY +
        "Q" + geometry.x1 + " " + geometry.yt1 + " " + topStartX + " " + topStartY +
        "L" + topEndX + " " + topEndY +
        "Q" + geometry.x2 + " " + geometry.yt2 + " " + geometry.x2 + " " + rightVerticalY +
        "L" + geometry.x2 + " " + geometry.yb2 + "Z";
    }

    function getCurrentChartHour(source) {
      const hour = firstNumber(source && source.currentHour);
      if (hour != null && hour >= 0 && hour <= 23) {
        return Math.floor(hour);
      }

      return new Date().getHours();
    }

    function buildCurrentHourHighlightPath(geometry) {
      if (!geometry) {
        return "";
      }

      const padX = 1.8;
      const slopeY = (geometry.yb2 - geometry.yb1) * 2.2;
      return "M" + (geometry.x1 - padX) + " " + geometry.yb1 +
        "L" + (geometry.x1 - padX) + " " + geometry.yt1 +
        "L" + (geometry.x2 + padX) + " " + (geometry.yt1 + slopeY) +
        "L" + (geometry.x2 + padX) + " " + (geometry.yb1 + slopeY) + "Z";
    }

    function buildChartHitAreaPath(geometry) {
      if (!geometry) {
        return "";
      }

      const padX = 3.8;
      return "M" + (geometry.x1 - padX) + " " + geometry.yb1 +
        "L" + (geometry.x1 - padX) + " " + geometry.yt1 +
        "L" + (geometry.x2 + padX) + " " + geometry.yt2 +
        "L" + (geometry.x2 + padX) + " " + geometry.yb2 + "Z";
    }

    function appendCurrentHourHighlight(chart, hour, getGeometry) {
      if (!chart || hour == null || hour < 0 || hour > 23) {
        return;
      }

      const geometry = getGeometry(Math.floor(hour), 1);
      const path = buildCurrentHourHighlightPath(geometry);
      if (!path) {
        return;
      }

      const highlight = document.createElementNS("http://www.w3.org/2000/svg", "path");
      highlight.classList.add("chart-bars__current-hour");
      highlight.setAttribute("d", path);
      highlight.setAttribute("aria-hidden", "true");
      chart.insertBefore(highlight, chart.firstChild);
    }

    function getChartPointerHour(event, chart, templates) {
      if (!event || !chart || !templates) {
        return null;
      }

      const rect = chart.getBoundingClientRect();
      const viewBox = chart.viewBox && chart.viewBox.baseVal ? chart.viewBox.baseVal : null;
      if (!rect.width || !viewBox || !viewBox.width) {
        return null;
      }

      const pointerX = ((event.clientX - rect.left) / rect.width) * viewBox.width;
      let nearestHour = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      templates.forEach(function (template, hour) {
        if (!template) {
          return;
        }

        const left = Math.min(template.x1, template.x2) - 4;
        const right = Math.max(template.x1, template.x2) + 4;
        const center = (template.x1 + template.x2) / 2;
        const distance = Math.abs(pointerX - center);

        if (pointerX >= left && pointerX <= right) {
          nearestHour = hour;
          nearestDistance = -1;
          return;
        }

        if (nearestDistance >= 0 && distance < nearestDistance) {
          nearestHour = hour;
          nearestDistance = distance;
        }
      });

      return nearestDistance <= 8 ? nearestHour : null;
    }

    function bindChartTouchTracking(chart, templates, handlers, scheduleRestore) {
      if (!chart) {
        return;
      }

      let activeHour = null;

      function updateFromPointer(event) {
        if (!event || event.pointerType === "mouse") {
          return;
        }

        if (event.cancelable) {
          event.preventDefault();
        }

        const hour = getChartPointerHour(event, chart, templates);
        if (hour === activeHour) {
          return;
        }

        activeHour = hour;
        const handler = hour == null ? null : handlers[hour];
        if (typeof handler === "function") {
          handler();
        }
      }

      chart.addEventListener("pointerdown", function (event) {
        if (!event || event.pointerType === "mouse") {
          return;
        }

        if (typeof chart.setPointerCapture === "function") {
          try {
            chart.setPointerCapture(event.pointerId);
          } catch (error) {}
        }
        updateFromPointer(event);
      });
      chart.addEventListener("pointermove", updateFromPointer);
      chart.addEventListener("pointerup", function (event) {
        activeHour = null;
        if (event && typeof chart.releasePointerCapture === "function" && chart.hasPointerCapture(event.pointerId)) {
          chart.releasePointerCapture(event.pointerId);
        }
        scheduleRestore();
      });
      chart.addEventListener("pointercancel", function () {
        activeHour = null;
        scheduleRestore();
      });
    }

    function resetSaleCardPosition() {
      if (!saleCard) {
        return;
      }

      saleCard.style.left = "";
      saleCard.style.top = "";
      saleCard.style.removeProperty("--sale-card-tail-center");
    }

    function clearSaleCardRestoreTimer() {
      if (!saleCardRestoreTimer) {
        return;
      }

      window.clearTimeout(saleCardRestoreTimer);
      saleCardRestoreTimer = 0;
    }

    function setSaleCardTitleHour(hour) {
      if (!saleCardTitle) {
        return;
      }

      if (hour == null) {
        saleCardTitle.textContent = "Sprzedaż energii";
        return;
      }

      saleCardTitle.innerHTML = "Sprzedaż energii <span class=\"tooltip-card__hour\">(" +
        String(hour).padStart(2, "0") + ":00)</span>";
    }

    function setSaleCardForEntry(entry) {
      if (!entry || entry.pricePln == null) {
        setSaleCardTitleHour(null);
        resetSaleCardPosition();
        return;
      }

      setSaleCardTitleHour(entry.hour);
      setPrice(salePrice, entry.pricePln);
      positionSaleCardForEntry(entry);
    }

    function restoreSaleCardToPeak() {
      clearSaleCardRestoreTimer();
      setSaleCardForEntry(saleCardPeakEntry);
    }

    function scheduleSaleCardPeakRestore() {
      clearSaleCardRestoreTimer();
      saleCardRestoreTimer = window.setTimeout(restoreSaleCardToPeak, saleCardRestoreDelayMs);
    }

    function activateSaleCardEntry(entry) {
      if (!entry || entry.pricePln == null) {
        return;
      }

      clearSaleCardRestoreTimer();
      hideSaleChartTooltip();
      setSaleCardForEntry(entry);
    }

    function hideSaleChartTooltip() {
      if (!saleChartTooltip) {
        return;
      }

      saleChartTooltip.hidden = true;
      saleChartTooltip.textContent = "";
    }

    function showSaleChartTooltip(text, x, y) {
      if (!saleChartTooltip) {
        return;
      }

      const overlayLeft = saleChartOverlay ? saleChartOverlay.offsetLeft : 0;
      const overlayTop = saleChartOverlay ? saleChartOverlay.offsetTop : 0;
      const absoluteX = overlayLeft + x;
      const absoluteY = overlayTop + y;
      saleChartTooltip.textContent = text;
      saleChartTooltip.style.left = Math.round(absoluteX) + "px";
      saleChartTooltip.style.top = Math.round(absoluteY) + "px";
      saleChartTooltip.hidden = false;
    }

    function positionSaleCardForEntry(entry) {
      if (!saleCard || !saleChartOverlay || !entry) {
        resetSaleCardPosition();
        return;
      }

      const template = saleChartTemplates[entry.hour];
      if (!template) {
        resetSaleCardPosition();
        return;
      }

      const overlayLeft = saleChartOverlay.offsetLeft;
      const overlayTop = saleChartOverlay.offsetTop;
      const geometry = getSaleBarGeometry(entry.hour, getSaleBarRatio(entry.pricePln));
      if (!geometry) {
        resetSaleCardPosition();
        return;
      }
      const baseCenterX = (geometry.x1 + geometry.x2) / 2;
      const ratio = getSaleBarRatio(entry.pricePln);
      const topLeft = geometry.yt1;
      const topRight = geometry.yt2;
      const fullTopY = Math.max(6, Math.min(topLeft, topRight));
      const tipX = overlayLeft + baseCenterX;
      const tipY = overlayTop + fullTopY - saleCardGap;
      const cardWidth = saleCard.offsetWidth || 286;
      const cardHeight = saleCard.offsetHeight || 118;
      const left = Math.min(
        dashboardWidth - cardWidth - saleCardMargin,
        Math.max(saleCardMargin, tipX - (cardWidth / 2))
      );
      const top = Math.max(saleCardMargin, tipY - cardHeight - saleCardTailHeight - floatingCardLift);
      const tailCenter = Math.min(
        cardWidth - 8 - (saleCardTailWidth / 2),
        Math.max(8 + (saleCardTailWidth / 2), tipX - left)
      );

      saleCard.style.left = Math.round(left) + "px";
      saleCard.style.top = Math.round(top) + "px";
      saleCard.style.setProperty("--sale-card-tail-center", Math.round(tailCenter) + "px");
    }

    function getSaleChartDateKey(rce) {
      const latestPayload = window.dashboardLatestPayload || {};

      return normalizeDashboardDateKey(rce && rce.businessDate) ||
        formatDashboardDateKey(getDashboardPayloadAnchorDate(latestPayload)) ||
        normalizeDashboardDateKey(latestPayload && latestPayload.usageData && latestPayload.usageData.latestDate) ||
        formatDashboardDateKey(new Date());
    }

    function findUsageRecordForSaleChart(rce) {
      const latestPayload = window.dashboardLatestPayload || {};
      const usageData = latestPayload && latestPayload.usageData ? latestPayload.usageData : null;
      const records = usageData && Array.isArray(usageData.records) ? usageData.records : [];
      const dateKey = getSaleChartDateKey(rce);

      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (normalizeDashboardDateKey(record && record.date) === dateKey) {
          return record;
        }
      }

      return null;
    }

    function findPvRecordForSaleChart(rce) {
      const latestPayload = window.dashboardLatestPayload || {};
      const pvData = latestPayload && latestPayload.pvData ? latestPayload.pvData : null;
      const records = pvData && Array.isArray(pvData.records) ? pvData.records : [];
      const dateKey = getSaleChartDateKey(rce);

      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (normalizeDashboardDateKey(record && record.date) === dateKey) {
          return record;
        }
      }

      return null;
    }

    function getSaleAmountKwh(source) {
      const direct = firstNumber(
        source && source.saleKwh,
        source && source.exportKwh,
        source && source.gridExportKwh,
        source && source.exportPhysical,
        source && source.salePhysical
      );

      return Math.max(0, direct || 0);
    }

    function addSaleAmountByHour(amounts, source, fallbackHour) {
      if (!amounts || !source) {
        return;
      }

      const rawHour = firstNumber(source.hour, source.hourIndex, source.h, fallbackHour);
      const hour = rawHour == null ? null : Math.floor(rawHour);

      if (hour == null || hour < 0 || hour > 23) {
        return;
      }

      amounts[hour] += getSaleAmountKwh(source);
    }

    function addQuarterBalancedSaleAmounts(amounts, record, pvRecord) {
      const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
      const slots = record && Array.isArray(record.slots) ? record.slots : [];
      const pvQuarters = pvRecord && Array.isArray(pvRecord.quarters) ? pvRecord.quarters : [];
      const sourceSlots = quarters.length ? quarters : slots;
      const importsByHour = Array.from({ length: 24 }, function () { return 0; });
      const exportsByHour = Array.from({ length: 24 }, function () { return 0; });
      const slotCount = Math.max(sourceSlots.length, pvQuarters.length);

      for (let index = 0; index < slotCount; index += 1) {
        const slot = sourceSlots[index] || null;
        const pvSlot = pvQuarters[index] || null;
        const rawHour = firstNumber(slot && slot.hour, pvSlot && pvSlot.hour, Math.floor(index / 4));
        const hour = rawHour == null ? null : Math.floor(rawHour);

        if (hour == null || hour < 0 || hour > 23) {
          continue;
        }

        importsByHour[hour] += getQuarterPhysicalImportKwh(slot);
        exportsByHour[hour] += getQuarterPhysicalExportKwh(slot, pvSlot);
      }

      for (let hour = 0; hour < 24; hour += 1) {
        amounts[hour] += Math.max(exportsByHour[hour] - importsByHour[hour], 0);
      }
    }

    function addRecordSaleAmounts(amounts, record, pvRecord) {
      const hours = record && Array.isArray(record.hours) ? record.hours : [];
      const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
      const slots = record && Array.isArray(record.slots) ? record.slots : [];

      hours.forEach(function (hourEntry, index) {
        addSaleAmountByHour(amounts, hourEntry, index);
      });

      if (hours.length) {
        return;
      }

      if (quarters.length || slots.length) {
        addQuarterBalancedSaleAmounts(amounts, record, pvRecord);
      }
    }

    function addSimulationSaleAmounts(amounts, rce) {
      const simulation = window.dashboardProsumerSimulation || window.dashboardBankSimulation;
      const dateKey = getSaleChartDateKey(rce);
      const day = simulation && simulation.dayMap ? simulation.dayMap[dateKey] : null;
      const hours = day && Array.isArray(day.hours) ? day.hours : [];
      const slots = day && Array.isArray(day.slots) ? day.slots : [];

      hours.forEach(function (hourEntry, index) {
        addSaleAmountByHour(amounts, hourEntry, index);
      });

      if (hours.length) {
        return;
      }

      slots.forEach(function (slot, index) {
        addSaleAmountByHour(amounts, slot, Math.floor(index / 4));
      });
    }

    function getSaleChartHourlyAmounts(rce) {
      const amounts = Array.from({ length: 24 }, function () { return 0; });
      const record = findUsageRecordForSaleChart(rce);

      if (record) {
        addRecordSaleAmounts(amounts, record, findPvRecordForSaleChart(rce));
      } else {
        addSimulationSaleAmounts(amounts, rce);
      }

      return amounts;
    }

    function renderRceChart(rce) {
      if (!saleChart) {
        return;
      }

      saleChartTouchHandlers.fill(null);

      const rates = rce && Array.isArray(rce.hourlyRates) ? rce.hourlyRates : [];
      const availableValues = rates
        .map(getSaleChartPrice)
        .filter(function (value) { return value != null; });

      if (!availableValues.length) {
        saleChart.hidden = true;
        saleChart.innerHTML = "";
        hideSaleChartTooltip();
        clearSaleCardRestoreTimer();
        saleCardPeakEntry = null;
        setSaleCardTitleHour(null);
        resetSaleCardPosition();
        if (saleChartFallback) {
          saleChartFallback.hidden = false;
          saleChartFallback.style.display = "";
        }
        return;
      }

      const lowThreshold = availableValues
        .slice()
        .sort(function (left, right) { return left - right; })[Math.min(2, availableValues.length - 1)];
      const highThreshold = availableValues
        .slice()
        .sort(function (left, right) { return right - left; })[Math.min(2, availableValues.length - 1)];

      saleChart.innerHTML = "";
      hideSaleChartTooltip();
      clearSaleCardRestoreTimer();
      saleCardPeakEntry = getPeakRceEntry(rce);
      const saleAmounts = getSaleChartHourlyAmounts(rce);
      appendCurrentHourHighlight(saleChart, getCurrentChartHour(rce), getSaleBarGeometry);

      rates.forEach(function (entry) {
        const template = saleChartTemplates[entry.hour];
        const bar = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const price = getSaleChartPrice(entry);
        const sampleCount = firstNumber(entry.sampleCount);
        const labelHour = String(entry.hour).padStart(2, "0") + ":00";
        const geometry = getSaleBarGeometry(entry.hour, getSaleBarRatio(price));
        let pointerEnterHandler = null;

        if (!template || !geometry) {
          return;
        }

        if (price == null) {
          bar.classList.add("is-empty");
          const emptyGeometry = getSaleBarGeometry(entry.hour, 0.12);
          const tooltipText = labelHour + " - brak danych";
          bar.setAttribute("d", buildRoundedBarPath(emptyGeometry));
          bar.setAttribute("aria-label", tooltipText);
          pointerEnterHandler = function () {
            hideSaleChartTooltip();
            scheduleSaleCardPeakRestore();
          };
        } else {
          const isLow = price <= lowThreshold;
          const saleKwh = Math.max(0, firstNumber(saleAmounts[entry.hour], 0) || 0);
          const hasSale = saleKwh > DASHBOARD_SALE_ACTIVE_THRESHOLD_KWH;
          const isHigh = !isLow && price >= highThreshold;
          const tooltipText = labelHour + " - " + formatNumber(price, 2) + " PLN/kWh" +
            (hasSale ? ", sprzedaż " + formatNumber(saleKwh, 2) + " kWh" : "") +
            (sampleCount != null && sampleCount > 1 ? " (sr. z " + formatNumber(sampleCount, 0) + ")" : "");
          const saleEntry = {
            hour: entry.hour,
            pricePln: price,
            rcePricePln: firstNumber(entry && entry.pricePln)
          };

          if (isHigh) {
            bar.classList.add("is-high");
          } else if (!hasSale) {
            bar.classList.add("is-idle");
          } else if (isLow) {
            bar.classList.add("is-low");
          }

          bar.setAttribute("d", buildRoundedBarPath(geometry));
          bar.setAttribute("aria-label", tooltipText);
          pointerEnterHandler = function () {
            activateSaleCardEntry(saleEntry);
          };
        }

        if (pointerEnterHandler) {
          saleChartTouchHandlers[entry.hour] = pointerEnterHandler;
          bar.addEventListener("pointerenter", pointerEnterHandler);
        }

        bar.addEventListener("pointerleave", scheduleSaleCardPeakRestore);
        saleChart.appendChild(bar);

        const hitAreaPath = buildChartHitAreaPath(getSaleBarGeometry(entry.hour, 1));
        if (hitAreaPath && pointerEnterHandler) {
          const hitArea = document.createElementNS("http://www.w3.org/2000/svg", "path");
          hitArea.classList.add("chart-bars__hit-area");
          hitArea.setAttribute("d", hitAreaPath);
          hitArea.setAttribute("aria-hidden", "true");
          hitArea.addEventListener("pointerenter", pointerEnterHandler);
          hitArea.addEventListener("pointerleave", scheduleSaleCardPeakRestore);
          saleChart.appendChild(hitArea);
        }
      });

      saleChart.hidden = false;
      restoreSaleCardToPeak();
      if (saleChartFallback) {
        saleChartFallback.hidden = true;
        saleChartFallback.style.display = "none";
      }
    }

    function getLowestPurchaseEntry(purchaseData) {
      const rates = purchaseData && Array.isArray(purchaseData.hourlyRates) ? purchaseData.hourlyRates : [];

      return rates.reduce(function (best, entry) {
        const price = firstNumber(entry && entry.pricePln);

        if (price == null) {
          return best;
        }

        if (!best || price < best.pricePln) {
          return {
            hour: entry.hour,
            pricePln: price,
            windowCode: firstText(entry && entry.windowCode)
          };
        }

        return best;
      }, null);
    }

    function resetPurchaseCardPosition() {
      if (!purchaseCard) {
        return;
      }

      purchaseCard.style.left = "";
      purchaseCard.style.top = "";
      purchaseCard.style.removeProperty("--purchase-card-tail-center");
    }

    function clearPurchaseCardRestoreTimer() {
      if (!purchaseCardRestoreTimer) {
        return;
      }

      window.clearTimeout(purchaseCardRestoreTimer);
      purchaseCardRestoreTimer = 0;
    }

    function setPurchaseCardTitleHour(hour) {
      if (!purchaseCardTitle) {
        return;
      }

      if (hour == null) {
        purchaseCardTitle.textContent = "Zakup energii";
        return;
      }

      purchaseCardTitle.innerHTML = "Zakup energii <span class=\"tooltip-card__hour\">(" +
        String(hour).padStart(2, "0") + ":00)</span>";
    }

    function hidePurchaseChartTooltip() {
      if (!purchaseChartTooltip) {
        return;
      }

      purchaseChartTooltip.hidden = true;
      purchaseChartTooltip.textContent = "";
    }

    function showPurchaseChartTooltip(text, x, y) {
      if (!purchaseChartTooltip) {
        return;
      }

      const overlayLeft = purchaseChartOverlay ? purchaseChartOverlay.offsetLeft : 0;
      const overlayTop = purchaseChartOverlay ? purchaseChartOverlay.offsetTop : 0;
      const absoluteX = overlayLeft + x;
      const absoluteY = overlayTop + y;
      purchaseChartTooltip.textContent = text;
      purchaseChartTooltip.style.left = Math.round(absoluteX) + "px";
      purchaseChartTooltip.style.top = Math.round(absoluteY) + "px";
      purchaseChartTooltip.hidden = false;
    }

    function positionPurchaseCardForEntry(entry) {
      if (!purchaseCard || !purchaseChartOverlay || !entry) {
        resetPurchaseCardPosition();
        return;
      }

      const geometry = getPurchaseBarGeometry(entry.hour, getPurchaseBarRatio(entry.pricePln));
      if (!geometry) {
        resetPurchaseCardPosition();
        return;
      }

      const overlayLeft = purchaseChartOverlay.offsetLeft;
      const overlayTop = purchaseChartOverlay.offsetTop;
      const baseCenterX = (geometry.x1 + geometry.x2) / 2;
      const fullTopY = Math.max(8, Math.min(geometry.yt1, geometry.yt2));
      const tipX = overlayLeft + baseCenterX;
      const tipY = overlayTop + fullTopY - saleCardGap;
      const cardWidth = purchaseCard.offsetWidth || 286;
      const cardHeight = purchaseCard.offsetHeight || 118;
      const left = Math.min(
        dashboardWidth - cardWidth - saleCardMargin,
        Math.max(saleCardMargin, tipX - (cardWidth / 2))
      );
      const top = Math.max(saleCardMargin, tipY - cardHeight - saleCardTailHeight - floatingCardLift);
      const tailCenter = Math.min(
        cardWidth - 8 - (saleCardTailWidth / 2),
        Math.max(8 + (saleCardTailWidth / 2), tipX - left)
      );

      purchaseCard.style.left = Math.round(left) + "px";
      purchaseCard.style.top = Math.round(top) + "px";
      purchaseCard.style.setProperty("--purchase-card-tail-center", Math.round(tailCenter) + "px");
    }

    function setPurchaseCardForEntry(entry) {
      if (!entry || entry.pricePln == null) {
        setPurchaseCardTitleHour(null);
        resetPurchaseCardPosition();
        return;
      }

      setPurchaseCardTitleHour(entry.hour);
      setPrice(purchasePrice, entry.pricePln);
      positionPurchaseCardForEntry(entry);
    }

    function restorePurchaseCardToDefault() {
      clearPurchaseCardRestoreTimer();
      setPurchaseCardForEntry(purchaseCardDefaultEntry);
    }

    function schedulePurchaseCardDefaultRestore() {
      clearPurchaseCardRestoreTimer();
      purchaseCardRestoreTimer = window.setTimeout(restorePurchaseCardToDefault, saleCardRestoreDelayMs);
    }

    const purchaseChartActiveThresholdKwh = 0.25;

    function sumPurchaseParts(source) {
      const purchaseForLoadKwh = firstNumber(source && source.gridPurchaseForLoadKwh);
      const topupKwh = firstNumber(source && source.gridTopupKwh);

      if (purchaseForLoadKwh != null || topupKwh != null) {
        return Math.max(0, (purchaseForLoadKwh || 0) + (topupKwh || 0));
      }

      return null;
    }

    function getPurchaseAmountKwh(source) {
      const parts = sumPurchaseParts(source);
      const direct = firstNumber(
        source && source.purchaseKwh,
        source && source.gridPurchaseKwh,
        parts,
        source && source.gridBilled,
        source && source.billedGrid
      );

      return Math.max(0, direct || 0);
    }

    function addPurchaseAmountByHour(amounts, source, fallbackHour) {
      if (!amounts || !source) {
        return;
      }

      const rawHour = firstNumber(source.hour, source.hourIndex, source.h, fallbackHour);
      const hour = rawHour == null ? null : Math.floor(rawHour);

      if (hour == null || hour < 0 || hour > 23) {
        return;
      }

      amounts[hour] += getPurchaseAmountKwh(source);
    }

    function getPurchaseChartDateKey(purchaseData) {
      const latestPayload = window.dashboardLatestPayload || {};

      return normalizeDashboardDateKey(purchaseData && purchaseData.businessDate) ||
        formatDashboardDateKey(getDashboardPayloadAnchorDate(latestPayload)) ||
        normalizeDashboardDateKey(latestPayload && latestPayload.usageData && latestPayload.usageData.latestDate) ||
        formatDashboardDateKey(new Date());
    }

    function findUsageRecordForPurchaseChart(purchaseData) {
      const latestPayload = window.dashboardLatestPayload || {};
      const usageData = latestPayload && latestPayload.usageData ? latestPayload.usageData : null;
      const records = usageData && Array.isArray(usageData.records) ? usageData.records : [];
      const dateKey = getPurchaseChartDateKey(purchaseData);

      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (normalizeDashboardDateKey(record && record.date) === dateKey) {
          return record;
        }
      }

      return null;
    }

    function findPvRecordForPurchaseChart(purchaseData) {
      const latestPayload = window.dashboardLatestPayload || {};
      const pvData = latestPayload && latestPayload.pvData ? latestPayload.pvData : null;
      const records = pvData && Array.isArray(pvData.records) ? pvData.records : [];
      const dateKey = getPurchaseChartDateKey(purchaseData);

      for (let index = 0; index < records.length; index += 1) {
        const record = records[index];
        if (normalizeDashboardDateKey(record && record.date) === dateKey) {
          return record;
        }
      }

      return null;
    }

    function addQuarterBalancedPurchaseAmounts(amounts, record, pvRecord) {
      const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
      const slots = record && Array.isArray(record.slots) ? record.slots : [];
      const pvQuarters = pvRecord && Array.isArray(pvRecord.quarters) ? pvRecord.quarters : [];
      const sourceSlots = quarters.length ? quarters : slots;
      const importsByHour = Array.from({ length: 24 }, function () { return 0; });
      const exportsByHour = Array.from({ length: 24 }, function () { return 0; });
      const slotCount = Math.max(sourceSlots.length, pvQuarters.length);

      for (let index = 0; index < slotCount; index += 1) {
        const slot = sourceSlots[index] || null;
        const pvSlot = pvQuarters[index] || null;
        const rawHour = firstNumber(slot && slot.hour, pvSlot && pvSlot.hour, Math.floor(index / 4));
        const hour = rawHour == null ? null : Math.floor(rawHour);

        if (hour == null || hour < 0 || hour > 23) {
          continue;
        }

        importsByHour[hour] += getQuarterPhysicalImportKwh(slot);
        exportsByHour[hour] += getQuarterPhysicalExportKwh(slot, pvSlot);
      }

      for (let hour = 0; hour < 24; hour += 1) {
        amounts[hour] += Math.max(importsByHour[hour] - exportsByHour[hour], 0);
      }
    }

    function addRecordPurchaseAmounts(amounts, record, pvRecord) {
      const hours = record && Array.isArray(record.hours) ? record.hours : [];
      const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
      const slots = record && Array.isArray(record.slots) ? record.slots : [];

      hours.forEach(function (hourEntry, index) {
        addPurchaseAmountByHour(amounts, hourEntry, index);
      });

      if (hours.length) {
        return;
      }

      if (quarters.length || slots.length) {
        addQuarterBalancedPurchaseAmounts(amounts, record, pvRecord);
      }
    }

    function addSimulationPurchaseAmounts(amounts, purchaseData) {
      const simulation = window.dashboardProsumerSimulation || window.dashboardBankSimulation;
      const dateKey = getPurchaseChartDateKey(purchaseData);
      const day = simulation && simulation.dayMap ? simulation.dayMap[dateKey] : null;
      const hours = day && Array.isArray(day.hours) ? day.hours : [];
      const slots = day && Array.isArray(day.slots) ? day.slots : [];

      hours.forEach(function (hourEntry, index) {
        addPurchaseAmountByHour(amounts, hourEntry, index);
      });

      if (hours.length) {
        return;
      }

      slots.forEach(function (slot, index) {
        addPurchaseAmountByHour(amounts, slot, Math.floor(index / 4));
      });
    }

    function getPurchaseChartHourlyAmounts(purchaseData) {
      const amounts = Array.from({ length: 24 }, function () { return 0; });
      const record = findUsageRecordForPurchaseChart(purchaseData);

      if (record) {
        addRecordPurchaseAmounts(amounts, record, findPvRecordForPurchaseChart(purchaseData));
      } else {
        addSimulationPurchaseAmounts(amounts, purchaseData);
      }

      return amounts;
    }

    function activatePurchaseCardEntry(entry) {
      if (!entry || entry.pricePln == null) {
        return;
      }

      clearPurchaseCardRestoreTimer();
      hidePurchaseChartTooltip();
      setPurchaseCardForEntry(entry);
    }

    function renderPurchaseChart(purchaseData) {
      if (!purchaseChart) {
        return;
      }

      purchaseChartTouchHandlers.fill(null);

      const rates = purchaseData && Array.isArray(purchaseData.hourlyRates) ? purchaseData.hourlyRates : [];
      const renderEntries = purchaseChartTemplates.map(function (_, hour) {
        return rates[hour] || { hour: hour, pricePln: null, windowCode: null };
      });
      const purchaseAmounts = getPurchaseChartHourlyAmounts(purchaseData);

      purchaseChart.innerHTML = "";
      hidePurchaseChartTooltip();
      clearPurchaseCardRestoreTimer();
      purchaseCardDefaultEntry = getLowestPurchaseEntry(purchaseData);
      appendCurrentHourHighlight(purchaseChart, getCurrentChartHour(purchaseData), getPurchaseBarGeometry);

      renderEntries.forEach(function (entry) {
        const geometry = getPurchaseBarGeometry(entry.hour, getPurchaseBarRatio(entry.pricePln));
        if (!geometry) {
          return;
        }

        const bar = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const price = entry.pricePln;
        const labelHour = String(entry.hour).padStart(2, "0") + ":00";
        let pointerEnterHandler = null;

        if (price == null) {
          const tooltipText = labelHour + " - brak danych";
          bar.classList.add("is-empty");
          bar.setAttribute("d", buildRoundedBarPath(geometry));
          bar.setAttribute("aria-label", tooltipText);
          pointerEnterHandler = function () {
            hidePurchaseChartTooltip();
            schedulePurchaseCardDefaultRestore();
          };
        } else {
          const purchaseKwh = Math.max(0, firstNumber(purchaseAmounts[entry.hour], 0) || 0);
          const hasPurchase = purchaseKwh > purchaseChartActiveThresholdKwh;
          const tooltipText = labelHour + " - " + formatNumber(price, 2) + " PLN/kWh" +
            (hasPurchase ? ", zakup " + formatNumber(purchaseKwh, 2) + " kWh" : "");
          const windowCode = normalizeText(firstText(entry && entry.windowCode));
          const purchaseEntry = {
            hour: entry.hour,
            pricePln: price,
            windowCode: firstText(entry && entry.windowCode)
          };

          if (windowCode === "low" || windowCode === "night" || windowCode === "offpeak") {
            bar.classList.add("is-low");
          } else if (windowCode === "high" || windowCode === "day" || windowCode === "peak") {
            bar.classList.add("is-high");
          }

          bar.setAttribute("d", buildRoundedBarPath(geometry));
          bar.setAttribute("aria-label", tooltipText);
          pointerEnterHandler = function () {
            activatePurchaseCardEntry(purchaseEntry);
          };
        }

        if (pointerEnterHandler) {
          purchaseChartTouchHandlers[entry.hour] = pointerEnterHandler;
          bar.addEventListener("pointerenter", pointerEnterHandler);
        }

        bar.addEventListener("pointerleave", schedulePurchaseCardDefaultRestore);
        purchaseChart.appendChild(bar);
      });

      purchaseChart.hidden = false;
      restorePurchaseCardToDefault();
      if (purchaseChartFallback) {
        purchaseChartFallback.hidden = true;
        purchaseChartFallback.style.display = "none";
      }
    }

    bindChartTouchTracking(saleChart, saleChartTemplates, saleChartTouchHandlers, scheduleSaleCardPeakRestore);
    bindChartTouchTracking(purchaseChart, purchaseChartTemplates, purchaseChartTouchHandlers, schedulePurchaseCardDefaultRestore);

    function normalizePayload(input) {
      const previousPayload = window.dashboardLatestPayload || {};

      if (!input || typeof input !== "object") {
        return {
          source: previousPayload.source || "unknown",
          dataMode: previousPayload.dataMode || window.dashboardDataMode || DASHBOARD_DATA_MODE_DEMO,
          energy: previousPayload.energy || {},
          weather: previousPayload.weather || {},
          storageData: previousPayload.storageData || null,
          pvData: previousPayload.pvData || null,
          weatherData: previousPayload.weatherData || null,
          weatherSources: previousPayload.weatherSources || null,
          account: previousPayload.account || null,
          history: previousPayload.history || null,
          dataQuality: previousPayload.dataQuality || null,
          tariffData: previousPayload.tariffData || null,
          tariffHistory: previousPayload.tariffHistory || null,
          purchaseData: previousPayload.purchaseData || null,
          rce: previousPayload.rce || null,
          priceHistory: previousPayload.priceHistory || null,
          usageData: previousPayload.usageData || null,
          livePaths: previousPayload.livePaths || null,
          useRandomUsageData: Boolean(previousPayload.useRandomUsageData)
        };
      }

      if (input.energy || input.weather || input.usageData || input.rce || input.priceHistory || input.tariffData || input.tariffHistory || input.weatherData || input.weatherSources || input.purchaseData || input.storageData || input.pvData || input.livePaths || input.account || input.history || input.dataQuality) {
        const hasUsageData = Object.prototype.hasOwnProperty.call(input, "usageData") &&
          input.usageData && Array.isArray(input.usageData.records);

        return {
          source: input.source || previousPayload.source || "unknown",
          dataMode: input.dataMode || previousPayload.dataMode || null,
          energy: input.energy || previousPayload.energy || {},
          weather: input.weather || previousPayload.weather || {},
          storageData: Object.prototype.hasOwnProperty.call(input, "storageData")
            ? input.storageData
            : (previousPayload.storageData || null),
          pvData: Object.prototype.hasOwnProperty.call(input, "pvData")
            ? input.pvData
            : (previousPayload.pvData || null),
          weatherData: Object.prototype.hasOwnProperty.call(input, "weatherData")
            ? input.weatherData
            : (previousPayload.weatherData || null),
          weatherSources: Object.prototype.hasOwnProperty.call(input, "weatherSources")
            ? input.weatherSources
            : (previousPayload.weatherSources || null),
          account: Object.prototype.hasOwnProperty.call(input, "account")
            ? input.account
            : (previousPayload.account || null),
          history: Object.prototype.hasOwnProperty.call(input, "history")
            ? input.history
            : (previousPayload.history || null),
          dataQuality: Object.prototype.hasOwnProperty.call(input, "dataQuality")
            ? input.dataQuality
            : (previousPayload.dataQuality || null),
          tariffData: Object.prototype.hasOwnProperty.call(input, "tariffData")
            ? input.tariffData
            : (previousPayload.tariffData || null),
          tariffHistory: Object.prototype.hasOwnProperty.call(input, "tariffHistory")
            ? input.tariffHistory
            : (previousPayload.tariffHistory || null),
          purchaseData: Object.prototype.hasOwnProperty.call(input, "purchaseData")
            ? input.purchaseData
            : (previousPayload.purchaseData || null),
          rce: Object.prototype.hasOwnProperty.call(input, "rce")
            ? input.rce
            : (previousPayload.rce || null),
          priceHistory: Object.prototype.hasOwnProperty.call(input, "priceHistory")
            ? input.priceHistory
            : (previousPayload.priceHistory || null),
          usageData: Object.prototype.hasOwnProperty.call(input, "usageData")
            ? input.usageData
            : (previousPayload.usageData || null),
          livePaths: Object.prototype.hasOwnProperty.call(input, "livePaths")
            ? input.livePaths
            : (previousPayload.livePaths || null),
          useRandomUsageData: hasUsageData
            ? false
            : (Object.prototype.hasOwnProperty.call(input, "useRandomUsageData")
            ? Boolean(input.useRandomUsageData)
            : Boolean(previousPayload.useRandomUsageData))
        };
      }

      return {
        source: input.source || previousPayload.source || "unknown",
        dataMode: input.dataMode || previousPayload.dataMode || null,
        energy: input,
        weather: previousPayload.weather || {},
        storageData: previousPayload.storageData || null,
        pvData: previousPayload.pvData || null,
        weatherData: previousPayload.weatherData || null,
        weatherSources: previousPayload.weatherSources || null,
        account: previousPayload.account || null,
        history: previousPayload.history || null,
        dataQuality: previousPayload.dataQuality || null,
        tariffData: previousPayload.tariffData || null,
        tariffHistory: previousPayload.tariffHistory || null,
        purchaseData: previousPayload.purchaseData || null,
        rce: previousPayload.rce || null,
        priceHistory: previousPayload.priceHistory || null,
        usageData: previousPayload.usageData || null,
        livePaths: previousPayload.livePaths || null,
        useRandomUsageData: Boolean(previousPayload.useRandomUsageData)
      };
    }

    function mergeIncrementalRecordDataset(previousDataset, incrementalDataset) {
      if (!incrementalDataset || !Array.isArray(incrementalDataset.records)) {
        return previousDataset || null;
      }

      const recordsByDate = new Map();
      const previousRecords = previousDataset && Array.isArray(previousDataset.records)
        ? previousDataset.records
        : [];

      previousRecords.forEach(function (record) {
        if (record && record.date) {
          recordsByDate.set(record.date, record);
        }
      });
      incrementalDataset.records.forEach(function (record) {
        if (record && record.date) {
          recordsByDate.set(record.date, record);
        }
      });

      const records = Array.from(recordsByDate.values()).sort(function (left, right) {
        return String(left && left.date || "").localeCompare(String(right && right.date || ""));
      });
      return Object.assign({}, previousDataset || {}, incrementalDataset, {
        latestDate: records.length ? records[records.length - 1].date : "",
        totalDays: records.length,
        records: records
      });
    }

    function applyUsageData(payload, incrementalUpdate) {
      let usageDataChanged = false;

      if (payload.usageData && Array.isArray(payload.usageData.records)) {
        window.usageSampleData = payload.usageData;
        usageDataChanged = true;
      } else if (payload.useRandomUsageData && typeof window.createRandomUsageSampleData === "function") {
        window.usageSampleData = window.createRandomUsageSampleData();
        usageDataChanged = true;
      }

      document.dispatchEvent(new CustomEvent(
        incrementalUpdate ? "dashboard:incremental-data-updated" : "dashboard:payload-updated",
        {
        detail: {
          source: payload.source || "unknown",
          payload: window.dashboardLatestPayload || null,
          usageData: window.usageSampleData || null
        }
        }
      ));

      if (!usageDataChanged || incrementalUpdate) {
        return;
      }

      document.dispatchEvent(new CustomEvent("dashboard:data-updated", {
        detail: {
          source: payload.source || "unknown",
          payload: window.dashboardLatestPayload || null,
          usageData: window.usageSampleData || null
        }
      }));
    }

    function applyPayload(input, incrementalUpdate) {
      if (input?.tariffHistory) input = Object.assign({}, input, { tariffHistory: ReTariffEngine.expand(input.tariffHistory) });
      const normalized = applyDashboardHistoryFilter(normalizePayload(input));
      const payload = window.DashboardPricing ? window.DashboardPricing.projectPayload(normalized) : normalized;
      const source = payload.source || "unknown";
      const dataMode = resolveDashboardDataMode(payload);
      const energy = normalizeEnergy(payload.energy, source);
      const nextWeatherLocationKey = getDashboardWeatherLocationKey(getDashboardWeatherLocation(payload));
      if (dashboardWeatherLocationKey && dashboardWeatherLocationKey !== nextWeatherLocationKey) {
        dashboardOnlineWeather = null;
        dashboardWeatherFetchedAt = 0;
      }
      const weatherRawForCard = dashboardOnlineWeather || payload.weather;
      const weather = normalizeWeather(weatherRawForCard);
      const rce = normalizeRce(payload.rce);
      const purchaseData = normalizePurchaseData(buildPurchaseDataFromTariffPayload(payload, rce) || payload.purchaseData);
      const estimatedProductionPowerW = estimateCurrentPvPowerW(payload.energy || {}, payload.weather || {}, payload.weatherData || null);

      if (energy.productionPowerW == null && estimatedProductionPowerW != null) {
        energy.productionPowerW = estimatedProductionPowerW;
      }

      window.dashboardLatestPayload = {
        source: source,
        dataMode: dataMode,
        rawEnergy: payload.energy || {},
        rawWeather: payload.weather || {},
        energy: energy,
        weather: weather,
        dashboardOnlineWeather: dashboardOnlineWeather,
        storageData: payload.storageData || null,
        pvData: payload.pvData || null,
        weatherData: payload.weatherData || null,
        weatherSources: payload.weatherSources || null,
        account: payload.account || null,
        history: payload.history || null,
        dataQuality: payload.dataQuality || null,
        tariffData: payload.tariffData || null,
        tariffHistory: payload.tariffHistory || null,
        pricingDisplay: payload.pricingDisplay || null,
        purchaseData: purchaseData,
        rce: rce,
        priceHistory: payload.priceHistory || null,
        usageData: payload.usageData || null,
        livePaths: payload.livePaths || null,
        incrementalUpdate: Boolean(incrementalUpdate),
        useRandomUsageData: Boolean(payload.useRandomUsageData)
      };
      window.updateDashboardScene(window.dashboardLatestPayload);
      rememberDashboardRePayload(window.dashboardLatestPayload);
      window.dashboardDataMode = dataMode;
      updateDashboardDocumentTitle(window.dashboardLatestPayload);
      if (typeof window.updateDashboardFreshnessState === "function") {
        window.updateDashboardFreshnessState(window.dashboardLatestPayload);
      }

      const peakRceEntry = getPeakRceEntry(rce);
      const lowestPurchaseEntry = getLowestPurchaseEntry(purchaseData);
      updateDashboardChartMaxPrice(rce, purchaseData);

      applyDashboardDepositValue(payload.energy || {}, energy);
      setPrice(salePrice, peakRceEntry ? peakRceEntry.pricePln : energy.salePricePln);
      setPrice(purchasePrice, lowestPurchaseEntry ? lowestPurchaseEntry.pricePln : energy.purchasePricePln);
      applyDashboardFlowCardMetrics(window.dashboardLatestPayload);
      setSummaryMoney(dailyBill, energy.dailyBillPln, false);
      setSummaryMoney(dailySavings, energy.dailySavingsPln, true);

      if (weatherTitle) {
        weatherTitle.textContent = (weather.temperatureC == null ? "--" : formatNumber(weather.temperatureC, 1)) + "°C, " + weather.condition;
      }
      if (weatherLabel) {
        weatherLabel.textContent = weather.label;
      }
      if (weatherDetails) {
        weatherDetails.textContent = weather.details;
      }
      if (weatherIcon && weather.iconPath) {
        weatherIcon.setAttribute("src", weather.iconPath);
      }

      renderRceChart(rce);
      updatePurchaseTariffLabel(window.dashboardLatestPayload);
      renderPurchaseChart(purchaseData);
      updateStrategyText(payload.livePaths || null);
      applyUsageData(payload, incrementalUpdate);
      applyDashboardDepositValue(payload.energy || {}, energy);
      requestDashboardWeather(false);
    }

    function applyIncrementalPayload(input) {
      const previousPayload = window.dashboardLatestPayload || {};
      const incrementalPayload = Object.assign({}, input || {});

      ["usageData", "storageData", "pvData", "weatherData"].forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(incrementalPayload, key)) {
          incrementalPayload[key] = mergeIncrementalRecordDataset(previousPayload[key], incrementalPayload[key]);
        }
      });

      applyPayload(incrementalPayload, true);
    }

    function applySummaryCardTotals() {
      const latestPayload = window.dashboardLatestPayload || {};
      const energy = latestPayload.energy || {};
      let summaryTotals = window.dashboardSummaryPanelTotals || window.dashboardSummaryTotals || {};
      let activeRange = summaryTotals.range ||
        (typeof window.getDashboardSummaryRange === "function" ? window.getDashboardSummaryRange() : "day");

      updateSummaryCardTabs(activeRange);
      setSummaryMoney(dailyBill, firstNumber(summaryTotals.nextTotal, summaryTotals.currentTotal, energy.dailyBillPln), false);
      setSummaryMoney(dailySavings, firstNumber(summaryTotals.savingsPln, energy.dailySavingsPln), true);
    }

    summaryRangeButtons.forEach(function (button) {
      button.addEventListener("click", function (event) {
        const nextRange = button.getAttribute("data-dashboard-summary-range") || "day";

        event.preventDefault();
        event.stopPropagation();
        updateSummaryCardTabs(nextRange);

        if (typeof window.setDashboardSummaryRange === "function") {
          window.setDashboardSummaryRange(nextRange);
        } else {
          applySummaryCardTotals();
        }
      });

      button.addEventListener("keydown", function (event) {
        event.stopPropagation();
      });
    });

    if (strategyViewport) {
      strategyViewport.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        openStrategyDetailView();
      });

      strategyViewport.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        openStrategyDetailView();
      });
    }

    if (strategyNav) {
      strategyNav.addEventListener("click", function (event) {
        const target = event.target && event.target.closest
          ? event.target.closest("[data-strategy-message-direction]")
          : null;

        if (!target) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        if (target.getAttribute("data-strategy-message-direction") === "previous") {
          showPreviousStrategyMessage();
        } else {
          showNextStrategyMessage();
        }
      });
    }

    if (strategyBar) {
      strategyBar.addEventListener("click", function (event) {
        const target = event.target && event.target.closest
          ? event.target.closest("[data-strategy-message-direction]")
          : null;
        if (target) {
          return;
        }

        event.preventDefault();
        openStrategyDetailView();
      });
    }

    document.addEventListener("dashboard:bank-updated", applySimulationCardMetrics);
    document.addEventListener("dashboard:bank-incremental-updated", applySimulationCardMetrics);
    document.addEventListener("dashboard:production-status-updated", function (event) {
      updateDashboardTrend(productionTrend, event && event.detail ? event.detail.status : "");
    });
    document.addEventListener("dashboard:consumption-status-updated", function (event) {
      updateDashboardTrend(usageTrend, event && event.detail ? event.detail.status : "");
    });
    document.addEventListener("dashboard:summary-updated", applySummaryCardTotals);
    document.addEventListener("dashboard:summary-panel-updated", applySummaryCardTotals);
    document.addEventListener("dashboard:re-year-totals-updated", function () {
      applyDashboardDepositValue(
        (window.dashboardLatestPayload && window.dashboardLatestPayload.rawEnergy) || {},
        (window.dashboardLatestPayload && window.dashboardLatestPayload.energy) || {}
      );
      applySummaryCardTotals();
    });
    document.addEventListener("dashboard:re-native-ready", function () {
      applyDashboardDepositValue(
        (window.dashboardLatestPayload && window.dashboardLatestPayload.rawEnergy) || {},
        (window.dashboardLatestPayload && window.dashboardLatestPayload.energy) || {}
      );
    });

    updateDashboardTrend(productionTrend, window.dashboardCurrentProductionStatus);
    updateDashboardTrend(usageTrend, window.dashboardCurrentConsumptionStatus);

    window.updateDashboardPayload = applyPayload;
    window.updateDashboardIncrementalPayload = applyIncrementalPayload;
    window.updateDashboardLivePaths = applyLivePathsUpdate;
    window.updateData = function (data) {
      applyPayload(data);
    };

    requestDashboardWeather(true);
    window.setInterval(function () {
      requestDashboardWeather(false);
    }, DASHBOARD_WEATHER_REFRESH_MS);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        requestDashboardWeather(false);
      }
    });
  }

  function initWebRuntimeDataSource() {
    const runtime = getDashboardRuntime();
    const body = document.body;
    let fullRefreshTimer = null;
    let liveRefreshTimer = null;

    function handleViewportResize() {
      applyDashboardScaleForViewport();
    }

    window.dashboardRuntime = runtime;

    if (body) {
      body.setAttribute("data-dashboard-runtime", runtime);
    }
    if (document.documentElement) {
      document.documentElement.setAttribute("data-dashboard-runtime", runtime);
    }

    applyDashboardScaleForViewport();

    if (runtime === "web") {
      window.addEventListener("resize", handleViewportResize);
      window.addEventListener("orientationchange", handleViewportResize);
    }

    if (runtime !== "web" || typeof window.updateDashboardPayload !== "function") {
      return;
    }

    const config = getDashboardWebConfig();
    if (!config.station) {
      console.warn("Dashboard web runtime: missing station query parameter.");
      return;
    }

    let historyRequestPromise = null;
    let liveRequestInFlight = false;
    let lastPayloadSignature = "";
    let lastLivePathsSignature = "";
    let firstPayloadApplied = false;
    let resolveFirstPayloadReady = null;
    const monthlyPayloads = new Map();

    window.__dashboardFirstPayloadReadyPromise = new Promise(function (resolve) {
      resolveFirstPayloadReady = resolve;
    });

    function markFirstPayloadReady(payload) {
      if (firstPayloadApplied) {
        return;
      }

      firstPayloadApplied = true;
      if (typeof resolveFirstPayloadReady === "function") {
        resolveFirstPayloadReady(payload || window.dashboardLatestPayload || {});
      }
    }

    async function fetchDashboardJson(url) {
      const response = await fetch(url.toString(), {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Accept": "application/json"
        }
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      if (!body.trim()) {
        throw new Error("Pusta odpowiedź dashboard API.");
      }
      return JSON.parse(body);
    }

    async function fetchDashboardMetadata() {
      const url = new URL(config.apiUrl, window.location.href);
      url.searchParams.set("station", config.station);
      url.searchParams.set("live", "1");
      url.searchParams.set("_ts", String(Date.now()));
      return fetchDashboardJson(url);
    }

    function buildDashboardMonthlyRanges(metadata) {
      const startKey = getDashboardHistoryStartKey(metadata);
      const startDate = parseDashboardDateKey(startKey);
      if (!startDate) {
        throw new Error("Brak daty startu danych dashboardu.");
      }

      const endDate = getDashboardStartOfDay(new Date());
      endDate.setDate(endDate.getDate() + 1);
      if (startDate.getTime() >= endDate.getTime()) {
        throw new Error("Data startu danych dashboardu jest późniejsza niż bieżący dzień.");
      }

      const ranges = [];
      const cursor = new Date(startDate);
      while (cursor.getTime() < endDate.getTime()) {
        const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        const rangeEnd = nextMonth.getTime() < endDate.getTime() ? nextMonth : endDate;
        ranges.push({
          key: String(cursor.getFullYear()) + "-" + String(cursor.getMonth() + 1).padStart(2, "0"),
          from: formatDashboardDateKey(cursor),
          to: formatDashboardDateKey(rangeEnd)
        });
        cursor.setTime(rangeEnd.getTime());
      }
      return ranges;
    }

    async function fetchDashboardMonth(range, includeContext) {
      const url = new URL(config.apiUrl, window.location.href);
      url.searchParams.set("station", config.station);
      url.searchParams.set("from", range.from);
      url.searchParams.set("to", range.to);
      url.searchParams.set("context", includeContext ? "1" : "0");
      return fetchDashboardJson(url);
    }

    function getDashboardRecordDateKey(record) {
      return normalizeDashboardDateKey(record && (
        record.date || record.day || record.dateKey || record.timestamp || record.datetime
      ));
    }

    function mergeDashboardMonthlyDataset(payloads, key) {
      let metadata = null;
      const recordsByDate = new Map();

      payloads.forEach(function (payload) {
        const dataset = payload && payload[key];
        if (!dataset || !Array.isArray(dataset.records)) {
          return;
        }
        metadata = Object.assign(metadata || {}, dataset);
        dataset.records.forEach(function (record) {
          const dateKey = getDashboardRecordDateKey(record);
          if (dateKey) {
            recordsByDate.set(dateKey, record);
          }
        });
      });

      if (!metadata || !recordsByDate.size) {
        return null;
      }
      const dateKeys = Array.from(recordsByDate.keys()).sort();
      return Object.assign({}, metadata, {
        oldestDate: dateKeys[0],
        latestDate: dateKeys[dateKeys.length - 1],
        totalDays: dateKeys.length,
        records: dateKeys.map(function (dateKey) {
          return recordsByDate.get(dateKey);
        })
      });
    }

    function mergeDashboardMonthlyPriceHistory(payloads) {
      let merged = null;
      const rceByDate = {};

      payloads.forEach(function (payload) {
        const priceHistory = payload && payload.priceHistory;
        if (!priceHistory || typeof priceHistory !== "object") {
          return;
        }
        merged = Object.assign(merged || {}, priceHistory);
        if (priceHistory.rceByDate && typeof priceHistory.rceByDate === "object") {
          Object.assign(rceByDate, priceHistory.rceByDate);
        }
      });

      return merged ? Object.assign({}, merged, { rceByDate: rceByDate }) : null;
    }

    function mergeDashboardMonthlyQuality(payloads) {
      let merged = null;
      const issues = [];

      payloads.forEach(function (payload) {
        const quality = payload && payload.dataQuality;
        if (!quality || typeof quality !== "object") {
          return;
        }
        merged = Object.assign(merged || {}, quality);
        if (Array.isArray(quality.issues)) {
          issues.push.apply(issues, quality.issues);
        }
      });

      if (!merged) {
        return null;
      }
      return Object.assign({}, merged, {
        issues: issues,
        issueCount: issues.length,
        ok: issues.length === 0,
        status: issues.length === 0 ? "ok" : "error"
      });
    }

    function mergeDashboardMonthlyPayloads(ranges) {
      const payloads = ranges.map(function (range) {
        return monthlyPayloads.get(range.key);
      }).filter(Boolean);
      if (!payloads.length) {
        throw new Error("Brak miesięcznych danych dashboardu.");
      }

      const excludedKeys = new Set([
        "range",
        "usageData",
        "storageData",
        "pvData",
        "weatherData",
        "priceHistory",
        "dataQuality"
      ]);
      const merged = {};
      payloads.forEach(function (payload) {
        Object.keys(payload).forEach(function (key) {
          if (!excludedKeys.has(key)) {
            merged[key] = payload[key];
          }
        });
      });

      ["usageData", "storageData", "pvData", "weatherData"].forEach(function (key) {
        const dataset = mergeDashboardMonthlyDataset(payloads, key);
        if (dataset) {
          merged[key] = dataset;
        }
      });
      const priceHistory = mergeDashboardMonthlyPriceHistory(payloads);
      if (priceHistory) {
        merged.priceHistory = priceHistory;
      }
      const dataQuality = mergeDashboardMonthlyQuality(payloads);
      if (dataQuality) {
        merged.dataQuality = dataQuality;
      }

      merged.source = "remote-monthly";
      merged.range = {
        from: ranges[0].from,
        to: ranges[ranges.length - 1].to
      };
      return merged;
    }

    function toSignatureNumber(value, digits) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return "";
      }

      return numeric.toFixed(digits == null ? 3 : digits);
    }

    function firstSignatureValue() {
      for (let index = 0; index < arguments.length; index += 1) {
        const value = arguments[index];
        if (value != null && value !== "") {
          return value;
        }
      }

      return null;
    }

    function getSlotSignature(slot) {
      if (!slot || typeof slot !== "object") {
        return "";
      }

      return [
        slot.label,
        slot.hour,
        slot.quarter,
        toSignatureNumber(firstSignatureValue(slot.load, slot.totalLoadKwh, slot.grid), 4),
        toSignatureNumber(firstSignatureValue(slot.pv, slot.pvGenerationKwh), 4),
        toSignatureNumber(firstSignatureValue(slot.storage, slot.storageLevelKwh, slot.storageSocPercent), 4)
      ].join(":");
    }

    function getDatasetSignature(dataset) {
      const records = dataset && Array.isArray(dataset.records) ? dataset.records : [];

      return [
        dataset && dataset.latestDate,
        dataset && dataset.totalDays,
        records.length,
        records.map(function (record) {
          const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
          const hours = record && Array.isArray(record.hours) ? record.hours : [];
          const samples = quarters.length ? quarters : hours;
          const lastSample = samples.length ? samples[samples.length - 1] : null;

          return [
            record && record.date,
            samples.length,
            getSlotSignature(lastSample)
          ].join("#");
        }).join("|")
      ].join(";");
    }

    function getHourlyPriceSignature(series) {
      const rates = series && Array.isArray(series.hourlyRates) ? series.hourlyRates : [];
      const first = rates.length ? rates[0] : null;
      const last = rates.length ? rates[rates.length - 1] : null;

      return [
        series && series.businessDate,
        series && series.currentHour,
        rates.length,
        first && first.hour,
        toSignatureNumber(first && first.pricePln, 6),
        last && last.hour,
        toSignatureNumber(last && last.pricePln, 6),
        toSignatureNumber(series && series.currentPricePln, 6)
      ].join(":");
    }

    function getPriceHistorySignature(priceHistory) {
      const rceByDate = priceHistory && priceHistory.rceByDate && typeof priceHistory.rceByDate === "object"
        ? priceHistory.rceByDate
        : null;
      const dates = rceByDate ? Object.keys(rceByDate).sort() : [];
      const latestDate = dates.length ? dates[dates.length - 1] : "";

      return [
        dates.join(","),
        latestDate,
        latestDate ? getHourlyPriceSignature(rceByDate[latestDate]) : ""
      ].join(";");
    }

    function getLivePathsSignature(livePaths) {
      const paths = livePaths && livePaths.paths && typeof livePaths.paths === "object"
        ? livePaths.paths
        : null;
      const pathSignature = paths
        ? Object.keys(paths).sort().map(function (key) {
          return key + ":" + toSignatureNumber(paths[key], 3);
        }).join(",")
        : "";

      return [
        livePaths && livePaths.datastats,
        livePaths && livePaths.serverTime,
        livePaths && livePaths.fresh,
        livePaths && livePaths.statusWindowValid,
        livePaths && livePaths.strategy,
        pathSignature
      ].join(":");
    }

    function getPayloadSignature(payload) {
      if (!payload || typeof payload !== "object") {
        return "";
      }

      const energy = payload.energy || {};
      const weather = payload.weather || {};

      return [
        payload.source,
        firstSignatureValue(energy.datetime, energy.reading_time, energy.timestamp),
        energy.station,
        toSignatureNumber(firstSignatureValue(energy.WSYS, energy.instantPowerW), 3),
        toSignatureNumber(energy.usageTodayKwh, 4),
        toSignatureNumber(firstSignatureValue(energy.batteryLevelKwh, energy.storageLevelKwh), 4),
        toSignatureNumber(firstSignatureValue(energy.batterySocPercent, energy.socPercent), 3),
        toSignatureNumber(firstSignatureValue(energy.storageChargeKw, energy.batteryChargeKw), 4),
        toSignatureNumber(firstSignatureValue(energy.storageDischargeKw, energy.batteryDischargeKw), 4),
        toSignatureNumber(firstSignatureValue(energy.productionPowerW, energy.pvCurrentPowerW, energy.currentProductionW), 3),
        toSignatureNumber(firstSignatureValue(energy.pvTodayKwh, energy.productionKwh), 4),
        firstSignatureValue(weather.reading_time, weather.datetime, weather.timestamp),
        toSignatureNumber(firstSignatureValue(weather.temperature_C, weather.temperatureC), 2),
        getDatasetSignature(payload.usageData),
        getDatasetSignature(payload.storageData),
        getDatasetSignature(payload.pvData),
        getDatasetSignature(payload.weatherData),
        getHourlyPriceSignature(payload.rce),
        getHourlyPriceSignature(payload.purchaseData),
        getPriceHistorySignature(payload.priceHistory),
        getLivePathsSignature(payload.livePaths),
        JSON.stringify(payload.dataQuality || null)
      ].join("||");
    }

    function applyPayloadOnIdle(payload) {
      const apply = function () {
        window.updateDashboardPayload(payload);
        markFirstPayloadReady(payload);
      };

      if (!firstPayloadApplied) {
        apply();
        return;
      }

      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(apply, { timeout: 1000 });
        return;
      }

      window.setTimeout(apply, 0);
    }

    function fetchDashboardPayload() {
      if (historyRequestPromise) {
        return historyRequestPromise;
      }

      historyRequestPromise = (async function () {
        const metadata = await fetchDashboardMetadata();
        const ranges = buildDashboardMonthlyRanges(metadata);
        const activeKeys = new Set(ranges.map(function (range) { return range.key; }));
        Array.from(monthlyPayloads.keys()).forEach(function (key) {
          if (!activeKeys.has(key)) {
            monthlyPayloads.delete(key);
          }
        });

        for (let index = 0; index < ranges.length; index += 1) {
          const range = ranges[index];
          const isCurrentRange = index === ranges.length - 1;
          const cachedPayload = monthlyPayloads.get(range.key);
          const cachedRange = cachedPayload && cachedPayload.range;
          const cachedRangeMatches = cachedRange &&
            cachedRange.from === range.from &&
            cachedRange.to === range.to;
          if (!cachedRangeMatches || isCurrentRange) {
            const monthPayload = await fetchDashboardMonth(range, isCurrentRange);
            monthlyPayloads.set(range.key, monthPayload);
          }
        }

        const payload = mergeDashboardMonthlyPayloads(ranges);
        payload.account = Object.assign({}, payload.account || {}, metadata.account || {});
        payload.history = Object.assign({}, payload.history || {}, metadata.history || {});
        if (metadata.livePaths) {
          payload.livePaths = metadata.livePaths;
        }

        if (typeof window.updateDashboardFreshnessState === "function") {
          window.updateDashboardFreshnessState(payload);
        }
        const payloadSignature = getPayloadSignature(payload);
        if (!payloadSignature || payloadSignature !== lastPayloadSignature) {
          lastPayloadSignature = payloadSignature;
          lastLivePathsSignature = getLivePathsSignature(payload.livePaths);
          applyPayloadOnIdle(payload);
        }
        return payload;
      }()).catch(function (error) {
        console.error("Dashboard web runtime fetch failed:", error);
        throw error;
      }).finally(function () {
        historyRequestPromise = null;
        window.__dashboardWebHistoryPayloadPromise = null;
      });

      window.__dashboardWebHistoryPayloadPromise = historyRequestPromise;
      return historyRequestPromise;
    }

    window.__dashboardFetchWebHistoryPayload = fetchDashboardPayload;

    async function fetchDashboardLivePaths() {
      if (liveRequestInFlight || typeof window.updateDashboardLivePaths !== "function") {
        return;
      }

      liveRequestInFlight = true;
      try {
        const url = new URL(config.apiUrl, window.location.href);
        url.searchParams.set("station", config.station);
        url.searchParams.set("live", "1");
        url.searchParams.set("_ts", String(Date.now()));

        const response = await fetch(url.toString(), {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Accept": "application/json"
          }
        });

        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }

        const payload = await response.json();
        const livePaths = payload && payload.livePaths ? payload.livePaths : null;
        const account = payload && payload.account ? payload.account : null;
        const history = payload && payload.history ? payload.history : null;
        if (account || history) {
          window.dashboardLatestPayload = Object.assign({}, window.dashboardLatestPayload || {}, {
            account: account ? Object.assign({}, (window.dashboardLatestPayload && window.dashboardLatestPayload.account) || {}, account) : (window.dashboardLatestPayload && window.dashboardLatestPayload.account) || null,
            history: history || (window.dashboardLatestPayload && window.dashboardLatestPayload.history) || null
          });
        }
        if (typeof window.updateDashboardFreshnessState === "function") {
          window.updateDashboardFreshnessState(Object.assign({}, window.dashboardLatestPayload || {}, {
            account: account ? Object.assign({}, (window.dashboardLatestPayload && window.dashboardLatestPayload.account) || {}, account) : (window.dashboardLatestPayload && window.dashboardLatestPayload.account) || null,
            history: history || (window.dashboardLatestPayload && window.dashboardLatestPayload.history) || null,
            livePaths: livePaths || null
          }));
        }
        const liveSignature = getLivePathsSignature(livePaths);

        if (liveSignature && liveSignature === lastLivePathsSignature) {
          return;
        }

        lastLivePathsSignature = liveSignature;
        window.updateDashboardLivePaths(livePaths);
      } catch (error) {
        console.error("Dashboard live paths fetch failed:", error);
      } finally {
        liveRequestInFlight = false;
      }
    }

    function getNextWebLiveRefreshDelayMs() {
      const now = new Date();
      const currentMs = (now.getSeconds() * 1000) + now.getMilliseconds();
      const targetMs = WEB_RUNTIME_LIVE_REFRESH_SECONDS
        .map(function (second) {
          return second * 1000;
        })
        .find(function (target) {
          return target > currentMs + 50;
        });
      const baseDelay = targetMs != null
        ? targetMs - currentMs
        : ((60 * 1000) - currentMs) + (WEB_RUNTIME_LIVE_REFRESH_SECONDS[0] * 1000);

      return Math.max(250, baseDelay + Math.floor(Math.random() * (WEB_RUNTIME_LIVE_REFRESH_JITTER_MS + 1)));
    }

    let refreshStopped = false;

    function scheduleNextFullDashboardFetch() {
      if (refreshStopped) {
        return;
      }

      if (fullRefreshTimer != null) {
        window.clearTimeout(fullRefreshTimer);
      }

      fullRefreshTimer = window.setTimeout(function () {
        fetchDashboardPayload().catch(function () {}).finally(scheduleNextFullDashboardFetch);
      }, WEB_RUNTIME_FULL_REFRESH_MS);
    }

    function scheduleNextLiveDashboardFetch() {
      if (refreshStopped) {
        return;
      }

      if (liveRefreshTimer != null) {
        window.clearTimeout(liveRefreshTimer);
      }

      liveRefreshTimer = window.setTimeout(function () {
        fetchDashboardLivePaths().finally(scheduleNextLiveDashboardFetch);
      }, getNextWebLiveRefreshDelayMs());
    }

    fetchDashboardPayload().catch(function () {});
    fetchDashboardLivePaths();
    scheduleNextFullDashboardFetch();
    scheduleNextLiveDashboardFetch();

    window.addEventListener("beforeunload", function () {
      refreshStopped = true;
      window.removeEventListener("resize", handleViewportResize);
      window.removeEventListener("orientationchange", handleViewportResize);
      if (fullRefreshTimer != null) {
        window.clearTimeout(fullRefreshTimer);
      }
      if (liveRefreshTimer != null) {
        window.clearTimeout(liveRefreshTimer);
      }
    }, { once: true });
  }

  initDateTime();
  initDetailViews();
  initAppTheme();
  initDashboardFreshnessNotice();
  initModeratorStationSwitcher();
  initInstallationSettingsModal();
  initDashboardForecastControls();
  initDepositView();
  initPvView();
  initBankView();
  initSaleView();
  initPurchaseView();
  initSummaryView();
  initDashboardBindings();
  initWebRuntimeDataSource();
  initDashboardReModule();
}());

