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

//select SUM(0.6398189 * POW(wind_speed_10m, 3.466507))/1000 from weather where parent_id=1495005799 and time>="2024-06-14 00:00:00" and time<"2025-06-14 00:00:00";
//select SUM(0.6398189 * POW(wind_speed_10m, 3.466507))/1000 from weather where parent_id=1495005799 and time>="2024-06-14 00:00:00" and time<"2025-06-14 00:00:00";
/********************************************************************
 * 1 ▪  cenniki i stałe
 *******************************************************************/
//  kolejność: ENEA, ENERGA, TAURON, PGE
const START = getReDataStartDate();

USE24 = [
  2.97, 2.89, 2.89, 2.89, 2.97, 3.4, 4.25, 5.1,
  4.67, 4.25, 4.08, 3.82, 3.82, 3.91, 3.99, 4.25,
  6.63, 6.37, 5.78, 5.1, 4.67, 4.25, 3.82, 3.23,
];

const BANK=15, CHUNK=BANK/2;          // kWh
const BANK_CAPACITY_OPTIONS = [5, 10, 15];
const LEGACY_BANK_MULTIPLIER_MAX = 3;

const M=['Sty','Lut','Mar','Kwi','Maj','Cze','Lip','Sie','Wrz','Paź','Lis','Gru'];
const MONTH_FULL=['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];

let usageMonthlyProfileKWh = null;
let usageMonthlySources = null;
let usageMonthlyExportSources = null;
let usageProfileLoaded = false;
let usageProfileRefreshTimer = null;
let usageHourlyByDay = new Map();
let usageExportHourlyByDay = new Map();
let usageProfileSelectedMonthIndex = 0;
let profilePvLookupSource = null;
let profilePvLookupByMonthDayHour = null;
let reUsageForecastModel = null;
let reUsageForecastSummaryCache = null;
let usageHourlyPatternByMonthDay = new Map();
let reDepositCoverageCache = null;

const round3 = v => Math.round(v*1000)/1000;

function resolveBankConfig(rawValue = bankV?.value) {
  const raw = Number(rawValue);
  if (!Number.isFinite(raw) || raw <= 0) {
    return { raw: 0, capacityKWh: 0, isLegacyMultiplier: false, legacyMultiplier: 0 };
  }

  const isLegacyMultiplier =
    Number.isInteger(raw) &&
    raw >= 1 &&
    raw <= LEGACY_BANK_MULTIPLIER_MAX &&
    !BANK_CAPACITY_OPTIONS.includes(raw);

  return {
    raw,
    capacityKWh: isLegacyMultiplier ? raw * BANK : raw,
    isLegacyMultiplier,
    legacyMultiplier: isLegacyMultiplier ? raw : 0,
  };
}

function getBankCapacityKWh(rawValue = bankV?.value) {
  return resolveBankConfig(rawValue).capacityKWh;
}

let deposit = 0;     // zł
let zdepositSumAll =0;
let zg11Sum = 0;
// ── Bazowe koszty "przed optymalizacją" (z pierwszej taryfy danego OSD)
window.oldKosztKWh  = null;  // zł/kWh
window.oldKosztMies = null;  // zł/mies.
window.selKosztMies = null; // zł/mies. dla aktualnie wybranej taryfy (tariff)
window.oldFixedRows = [];
window.selFixedRows = [];
window.oldTariffIdUsed = null; // do podglądu która taryfa została użyta

  // Limity prosumenckie (net-billing) – roczne
window._greenYearGenKWh  = 0; // łączna produkcja PV+wiatr [kWh]
window._greenYearSoldKWh = 0; // łączna sprzedaż energii "zielonej" [kWh]

/********************************************************************
 * 2 ▪  elementy DOM (skrót)
 *******************************************************************/
const $ = (id) => document.getElementById(id);

// helper: DOM -> fallback do window.* (mock)
const EL = (id, winKey=id) => $(id) || (typeof window !== 'undefined' ? window[winKey] : null);

const bankV   = EL('bankV',   'bankV');
const windV   = EL('windV',   'windV');

const slider  = EL('dateRange','slider');
const dateLbl = EL('dateLabel','dateLbl');
const usage   = EL('annualUsage','usage');
const pvInp   = EL('pvPower','pvInp');

const tariffLon = EL('tariffSelect','tariffLon');
const tariff    = EL('tariffShort','tariff');
const provider  = EL('providerSelect','provider');
const contractPowerKw = EL('contractPowerKw', 'contractPowerKw');
const contractPowerWrap = EL('contractPowerWrap', 'contractPowerWrap');
const billingCycleMonths = EL('billingCycleMonths', 'billingCycleMonths');
const billingCycleWrap = EL('billingCycleWrap', 'billingCycleWrap');

const chkBank = EL('bankEnergy','chkBank');
const chkPV   = EL('cPV','chkPV');
const chkSell = EL('cSell','chkSell');
const chkRcem = EL('useRcem','chkRcem');
const chkWind = EL('cWind','chkWind');

const cAddMonth = EL('cAddMonth','cAddMonth');
const usageProfileToggle = EL('usageProfileToggle','usageProfileToggle');
const usageProfilePanel = EL('usageProfilePanel','usageProfilePanel');
const usageMonthsChart = EL('usageMonthsChart','usageMonthsChart');
const usageDayProfileChart = EL('usageDayProfileChart','usageDayProfileChart');
const usageProfileSave = EL('usageProfileSave','usageProfileSave');
const usageProfileUpload = EL('usageProfileUpload','usageProfileUpload');
const usageProfileFile = EL('usageProfileFile','usageProfileFile');
const usageProfileStatus = EL('usageProfileStatus','usageProfileStatus');
const usageProfileTotal = EL('usageProfileTotal','usageProfileTotal');

function applyFixedEnergyOptions(){
  if (chkSell) {
    chkSell.checked = true;
    chkSell.disabled = true;
  }
  if (chkWind) {
    chkWind.checked = false;
    chkWind.disabled = true;
  }
  if (windV) {
    windV.value = '0';
    windV.disabled = true;
  }
}
applyFixedEnergyOptions();

const battI = EL('batteryImg','battI');
const windI = EL('windImg','windI');
const solTop= EL('solarImg1','solTop');
const solBot= EL('solarImg','solBot');
const bankI = EL('bankImg','bankI');

const mini = EL('bilansMini','mini');
const main = EL('bilansMain','main');
const g11E = EL('g11Sum','g11E');
const rvE  = EL('rvSum','rvE');
const saveE= EL('savingSum','saveE');



/********************************************************************
 * 3 ▪  ikony
 *******************************************************************/
function updateIcons(){

  applyFixedEnergyOptions();
  if (!battI || !chkBank || !tariffLon || !solTop || !solBot || !chkPV || !windI || !chkWind || !bankI || !chkSell || !pvInp) return;
	
  battI.classList.toggle('disabled-icon',!chkBank.checked);

  const pvOn  = tariffLon.selectedIndex>0;
  solTop.classList.toggle('disabled-icon',!pvOn);

  solBot.classList.toggle('disabled-icon',!chkPV.checked);
  windI.classList.toggle('disabled-icon',!chkWind.checked);

  bankI.classList.toggle('disabled-icon',!chkSell.checked);
  pvInp.disabled=!chkPV.checked;
}

/********************************************************************
 * 4 ▪  utils
 *******************************************************************/
const pvK = (irr, kWp) => (irr * kWp * 1.05) / 1000;

const windK = (v) => {
  if (!chkWind?.checked) return 0;
  //const watts = 0.6398189 * Math.pow(v_mps, 3.466507); // już policzone na podstawie adresu
  const mult = Number(windV?.value ?? 1);
  // ✅ Nowe dane z DB: v to już kWh/h
  return Number(v || 0) * mult;
};

function getContractPowerKw(rawValue = contractPowerKw?.value){
  const value = parseFloat(rawValue ?? '0');
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getAnnualUsageInput(){
  return usage ||
    (typeof document !== 'undefined' ? document.getElementById('annualUsage') : null) ||
    (typeof window !== 'undefined' ? window.usage : null);
}

function setAnnualUsageInputValue(value){
  const input = getAnnualUsageInput();
  if (input) {
    input.value = String(Math.round(parseUsageKWh(value)));
  }
}

function getAnnualUsageKWh(rawValue = getAnnualUsageInput()?.value){
  if (arguments.length === 0) {
    const summary = getReUsageForecastSummary();
    if (summary.ready) return summary.annualKwh;
  }
  const value = parseFloat(rawValue ?? '0');
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function getBillingCycleMonths(rawValue = billingCycleMonths?.value){
  const value = parseInt(rawValue ?? '1', 10);
  return [1, 2, 6, 12].includes(value) ? value : 1;
}

function parseUsageKWh(value){
  const parsed = parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeMonthlyUsageProfile(values){
  if (!Array.isArray(values) || values.length !== 12) return null;
  const months = values.map(parseUsageKWh);
  return months;
}

function normalizeUsageSource(source){
  const value = String(source || '').toLowerCase();
  return ['standard', 'manual', 'xlsx', 'real', 'part', 'forecast'].includes(value) ? value : 'manual';
}

function normalizeUsageSources(sources, fallback = 'manual'){
  const defaultSource = normalizeUsageSource(fallback);
  return Array.from({ length: 12 }, (_, index) => normalizeUsageSource(Array.isArray(sources) ? sources[index] : defaultSource));
}

function usageSourceLabel(source){
  switch (normalizeUsageSource(source)) {
    case 'forecast': return 'prognoza';
    case 'real': return 'real';
    case 'part': return 'part';
    case 'xlsx': return 'XLSX';
    case 'manual': return 'ręcznie';
    default: return 'standard';
  }
}

function usageExportSourceLabel(source){
  const normalized = normalizeUsageSource(source);
  if (normalized === 'standard' || normalized === 'manual') return '--';
  return usageSourceLabel(normalized);
}

function reUsageDateKey(date){
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function applyUsageHourlyProfile(data){
  window.reUsageProfileError = '';
  const map = new Map();
  const exportMap = new Map();
  (Array.isArray(data) ? data : []).forEach(row => {
    const stamp = String(row && row[0] || '');
    const value = Number(row && row[1]);
    const exportValue = Number(row && row[2]);
    if (!stamp || !Number.isFinite(value)) return;
    const day = stamp.slice(0, 10);
    const hour = Number(stamp.slice(11, 13));
    if (!day || !Number.isInteger(hour) || hour < 0 || hour > 23) return;
    if (!map.has(day)) map.set(day, new Array(24).fill(null));
    map.get(day)[hour] = Math.max(0, value);
    if (!exportMap.has(day)) exportMap.set(day, new Array(24).fill(null));
    exportMap.get(day)[hour] = Number.isFinite(exportValue) ? Math.max(0, exportValue) : 0;
  });
  for (const [day, values] of Array.from(map.entries())) {
    if (values.some(value => value == null)) map.delete(day);
  }
  for (const [day, values] of Array.from(exportMap.entries())) {
    if (values.some(value => value == null) || !map.has(day)) exportMap.delete(day);
  }
  usageHourlyByDay = map;
  usageExportHourlyByDay = exportMap;
  usageHourlyPatternByMonthDay = new Map();
  for (const dayKey of Array.from(map.keys()).sort()) {
    usageHourlyPatternByMonthDay.set(dayKey.slice(5), dayKey);
  }
  clearReDepositCoverageCache();
  window.reUsageHourlyByDay = usageHourlyByDay;
  window.reUsageExportHourlyByDay = usageExportHourlyByDay;
  if (usageMonthsChart && usageMonthsChart.children.length) {
    recalculateUsageProfile();
  }
  return usageHourlyByDay;
}

if (Array.isArray(window.reUsageHourlyRaw)) {
  applyUsageHourlyProfile(window.reUsageHourlyRaw);
}

function getUsageProfileMonthIndex(dayDate){
  const day = new Date(dayDate);
  return Number.isFinite(day.getTime()) ? day.getMonth() : null;
}

function currentUsageMonthExportSources(){
  return normalizeUsageSources(usageMonthlyExportSources, 'standard');
}

function hasUsageExportProfileForDay(dayDate){
  const monthIndex = getUsageProfileMonthIndex(dayDate);
  if (monthIndex == null) return false;
  return normalizeUsageSource(currentUsageMonthExportSources()[monthIndex]) === 'xlsx';
}

function getCurrentPvKwp(){
  return (parseFloat(pvInp?.value) || 0) / 1000;
}

function getProfilePvOffsetForDate(dayDate){
  const start = new Date(START);
  const day = new Date(dayDate);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(day.getTime())) return null;
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const targetDay = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  return Math.round((targetDay - startDay) / 86400000) * 24;
}

function getMonthDayHourKey(value, hour = null){
  const text = String(value || '');
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}))?/);
  if (match) {
    return `${match[2]}-${match[3]} ${String(hour ?? match[4] ?? '00').padStart(2, '0')}`;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(hour ?? date.getHours()).padStart(2, '0')}`;
}

function getProfilePvLookup(){
  const rows = Array.isArray(window.pv) ? window.pv : [];
  if (profilePvLookupSource === rows && profilePvLookupByMonthDayHour) {
    return profilePvLookupByMonthDayHour;
  }
  const map = new Map();
  rows.forEach(row => {
    const key = getMonthDayHourKey(row && row[0]);
    if (key && !map.has(key)) map.set(key, row);
  });
  profilePvLookupSource = rows;
  profilePvLookupByMonthDayHour = map;
  return map;
}

function getProfilePvPatternRow(dayDate, hour){
  const lookup = getProfilePvLookup();
  if (!lookup.size) return null;
  const base = new Date(dayDate);
  if (!Number.isFinite(base.getTime())) return null;

  for (let i = 0; i < 367; i += 1) {
    const probe = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    const key = getMonthDayHourKey(probe, hour);
    if (lookup.has(key)) return lookup.get(key);
  }
  return null;
}

function getProfilePvKWhForHour(hour, options = {}){
  const kWp = Number.isFinite(Number(options.kWp)) ? Number(options.kWp) : getCurrentPvKwp();
  const pvOffset = Number.isFinite(Number(options.pvOffset)) ? Number(options.pvOffset) : null;
  if (kWp <= 0) {
    throw new Error('Brak mocy PV do przeliczenia profilu OSD z energią oddaną');
  }
  const pvRows = Array.isArray(window.pv) ? window.pv : [];
  const row = (pvOffset != null && pvRows[pvOffset + hour])
    ? pvRows[pvOffset + hour]
    : getProfilePvPatternRow(options.dayDate, hour);
  if (!row) {
    throw new Error('Brak danych PV do przeliczenia profilu OSD z energią oddaną');
  }
  return pvK(row[1], kWp);
}

function getHourlyUsageProfileForDay(dayDate, options = {}){
  const dayKey = typeof dayDate === 'string' ? dayDate.slice(0, 10) : reUsageDateKey(dayDate);
  // Profil OSD jest wzorcem miesiąc/dzień, również poza rokiem zwróconym przez API.
  const profileKey = usageHourlyByDay.has(dayKey) ? dayKey : usageHourlyPatternByMonthDay.get(dayKey.slice(5));
  const values = profileKey ? usageHourlyByDay.get(profileKey) : null;
  if (!Array.isArray(values) || values.length !== 24) return null;

  if (!hasUsageExportProfileForDay(dayDate)) {
    return values;
  }

  const exportValues = usageExportHourlyByDay.get(profileKey);
  if (!Array.isArray(exportValues) || exportValues.length !== 24) {
    throw new Error('Brak godzinowej energii oddanej dla profilu OSD');
  }
  const pvOffset = Number.isFinite(Number(options.pvOffset)) ? Number(options.pvOffset) : getProfilePvOffsetForDate(dayDate);
  return ReConsumptionEngine.resolveDay({
    dayKey, annualKwh: 0, sources: Array(12).fill('xlsx'), hourlyProfile: values, hasExport: true,
    exportHourlyKwh: exportValues,
    pvHourlyKwh: Array.from({ length: 24 }, (_, hour) => getProfilePvKWhForHour(hour, { ...options, dayDate, pvOffset })),
  });
}

function assertUsageHourlyProfileIsHealthy(){
  if (window.reUsageProfileError) {
    throw new Error(window.reUsageProfileError);
  }
}

function getUsageProfileYear(){
  const start = new Date(START);
  return Number.isFinite(start.getTime()) ? start.getFullYear() : 2025;
}

function getDaysInYear(year){
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  return Math.round((end - start) / 86400000) || 365;
}

function getDaysInMonthForProfile(year, monthIndex){
  return new Date(year, monthIndex + 1, 0).getDate();
}

function getDefaultMonthlyUsageKWh(annualUsageKWh = getAnnualUsageKWh(getAnnualUsageInput()?.value)){
  const year = getUsageProfileYear();
  const daysInYear = getDaysInYear(year);
  return MONTH_FULL.map((_, monthIndex) => {
    const days = getDaysInMonthForProfile(year, monthIndex);
    return annualUsageKWh * days / daysInYear;
  });
}

function getEffectiveMonthlyUsageKWh(annualUsageKWh = getAnnualUsageKWh(getAnnualUsageInput()?.value)){
  return normalizeMonthlyUsageProfile(usageMonthlyProfileKWh) || getDefaultMonthlyUsageKWh(annualUsageKWh);
}

function getDisplayMonthlyUsageKWh(values){
  const months = Array.isArray(values) && values.length === 12 ? values : getEffectiveMonthlyUsageKWh();
  const rounded = months.map(value => Math.max(0, Math.round(Number(value) || 0)));
  const target = Math.round(months.reduce((sum, value) => sum + (Number(value) || 0), 0));
  const diff = target - rounded.reduce((sum, value) => sum + value, 0);
  rounded[rounded.length - 1] = Math.max(0, rounded[rounded.length - 1] + diff);
  return rounded;
}

let reActualHourlyByDay = new Map();
window.reActualHourlyByDay = reActualHourlyByDay;

function reActualNumber(value){
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function reActualFirstNumber(source, keys){
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source || {}, key)) continue;
    const value = reActualNumber(source[key]);
    if (value != null) return value;
  }
  return null;
}

function reActualDateKey(date){
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function reActualDayKeyFromRecord(record){
  return String(record && record.date || '').slice(0, 10);
}

function reActualHourFromQuarter(quarter){
  const hour = Number(quarter && quarter.hour);
  if (Number.isInteger(hour) && hour >= 0 && hour <= 23) return hour;
  const slotStart = String(quarter && quarter.slotStart || '');
  const parsed = Number(slotStart.slice(11, 13));
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : null;
}

function createReActualHour(){
  return {
    use: 0,
    pv: 0,
    buy: 0,
    buyBank: 0,
    sell: 0,
    soldBank: 0,
    batteryKwh: null,
    hasUse: false,
    hasPv: false,
    hasBuy: false,
    hasSell: false
  };
}

function createReActualDay(dateKey){
  return {
    date: dateKey,
    hours: Array.from({ length: 24 }, createReActualHour),
    totalUse: 0,
    socOut: null,
    hasUsage: false,
    isComplete: false
  };
}

function getReActualDay(dayDate){
  const dayKey = typeof dayDate === 'string' ? dayDate.slice(0, 10) : reActualDateKey(dayDate);
  return dayKey ? reActualHourlyByDay.get(dayKey) || null : null;
}

function addReActualQuarterValue(day, quarter, keys, targetKey, flagKey){
  const hour = reActualHourFromQuarter(quarter);
  if (hour == null) return;
  const value = reActualFirstNumber(quarter, keys);
  if (value == null) return;
  const bucket = day.hours[hour];
  bucket[targetKey] += Math.max(0, value);
  if (flagKey) bucket[flagKey] = true;
}

function applyReActualUsageRecord(day, record){
  const quarters = Array.isArray(record && record.quarters) ? record.quarters : [];
  quarters.forEach(quarter => {
    addReActualQuarterValue(day, quarter, ['totalLoadKwh', 'load', 'usageKwh', 'usage'], 'use', 'hasUse');
    addReActualQuarterValue(day, quarter, ['pvGenerationKwh'], 'pv', 'hasPv');
    addReActualQuarterValue(day, quarter, ['gridImportKwh'], 'buy', 'hasBuy');
    addReActualQuarterValue(day, quarter, ['gridToStorageKwh', 'chargeFromGridKwh'], 'buyBank', null);
    addReActualQuarterValue(day, quarter, ['gridExportKwh'], 'sell', 'hasSell');
    addReActualQuarterValue(day, quarter, ['storageToGridKwh'], 'soldBank', null);
  });
  day.hasUsage = true;
}

function applyReActualPvRecord(day, record){
  const quarters = Array.isArray(record && record.quarters) ? record.quarters : [];
  day.hours.forEach(hour => {
    hour.pv = 0;
    hour.hasPv = false;
  });
  quarters.forEach(quarter => {
    const hour = reActualHourFromQuarter(quarter);
    if (hour == null) return;
    const value = reActualFirstNumber(quarter, ['productionKwh', 'production', 'pvGenerationKwh']);
    if (value == null) return;
    const bucket = day.hours[hour];
    bucket.pv += Math.max(0, value);
    bucket.hasPv = true;
  });
}

function applyReActualStorageRecord(day, record){
  const quarters = Array.isArray(record && record.quarters) ? record.quarters : [];
  quarters.forEach(quarter => {
    const hour = reActualHourFromQuarter(quarter);
    if (hour == null) return;
    let value = reActualFirstNumber(quarter, ['energyKwh', 'storageLevelKwh', 'batteryLevelKwh']);
    if (value == null) {
      const socPercent = reActualFirstNumber(quarter, ['socPercent', 'storageSocPercent']);
      const capacity = reActualFirstNumber(quarter, ['capacityKwh', 'storageCapacityKwh']);
      if (socPercent != null && capacity != null) value = capacity * socPercent / 100;
    }
    if (value == null) return;
    day.hours[hour].batteryKwh = Math.max(0, value);
    day.socOut = Math.max(0, value);
  });
}

function isCompleteReActualRecord(record){
  const quarters = Array.isArray(record && record.quarters) ? record.quarters : [];
  const expectedSlots = Number(record && record.slotCount) || 96;
  return quarters.length >= expectedSlots;
}

function getReActualCutoff(payload){
  const raw = String(payload && payload.rawEnergy && payload.rawEnergy.datetime || '').trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;

  const date = new Date(
    Number(match[1].slice(0, 4)),
    Number(match[1].slice(5, 7)) - 1,
    Number(match[1].slice(8, 10)),
    Number(match[2]),
    Number(match[3]),
    Number(match[4] || 0),
    0
  );
  if (!Number.isFinite(date.getTime())) return null;
  return { dateKey: match[1], timestamp: date.getTime() };
}

function trimReActualRecordToCutoff(record, cutoff){
  if (!cutoff || reActualDayKeyFromRecord(record) !== cutoff.dateKey) return record;
  const quarters = Array.isArray(record && record.quarters) ? record.quarters : [];
  return Object.assign({}, record, {
    quarters: quarters.filter(quarter => {
      const slotStart = String(quarter && quarter.slotStart || '');
      const slotTimestamp = new Date(slotStart).getTime();
      return Number.isFinite(slotTimestamp) && slotTimestamp <= cutoff.timestamp;
    })
  });
}

function buildReActualHourlyMapFromPayload(payload) {
  return ReConsumptionEngine.buildActualMap(payload);
}

// Uczymy prognozę tylko z zamkniętych dób. Historia rozliczeń pozostaje bez zmian.
function buildReUsageForecastModel(payload) {
  return ReConsumptionEngine.buildForecastModel(payload);
}

function getReUsageForecastSummary(year = getUsageProfileYear()){
  const model = reUsageForecastModel;
  const annual = getAnnualUsageKWh(getAnnualUsageInput()?.value);
  const keys = [year, annual, getCurrentPvKwp(), usageMonthlyProfileKWh, usageMonthlySources,
    usageMonthlyExportSources, usageHourlyByDay, reActualHourlyByDay, model, window.pv];
  if (reUsageForecastSummaryCache?.keys.every((value, index) => value === keys[index])) {
    return reUsageForecastSummaryCache.summary;
  }
  const sources = currentUsageMonthSources();
  const profileMonths = sources.filter(source => source !== 'standard').length;
  const needsHourly = sources.includes('xlsx');
  const needsPv = currentUsageMonthExportSources().includes('xlsx');
  const ready = (!needsHourly || usageHourlyByDay.size > 0) &&
    (!needsPv || (getCurrentPvKwp() > 0 && Array.isArray(window.pv) && window.pv.length > 0));
  // Ten sam wybór danych co w symulacji. Suma roczna nie jest drugim modelem prognozy.
  const monthlyKwh = ready ? Array.from({ length: 12 }, (_, month) => {
    let total = 0;
    for (let day = 1; day <= getDaysInMonthForProfile(year, month); day += 1) {
      total += buildHourlyUseForDay(new Date(year, month, day), annual)
        .reduce((sum, value) => sum + value, 0);
    }
    return total;
  }) : null;
  const learnedMonths = model ? model.monthDays.filter(count => count >= 7).length : 0;
  const summary = {
    ready, profileMonths,
    source: !ready ? 'loading' : profileMonths ? (model ? 'profile_measured' : 'profile')
      : model ? (learnedMonths > 1 ? 'seasonal' : 'measured') : 'entered',
    annualKwh: monthlyKwh ? monthlyKwh.reduce((a, b) => a + b, 0) : null, monthlyKwh,
    observedDays: model?.days || 0, recentDays: model?.recentDays || 0,
    learnedMonths, monthDays: model?.monthDays.slice() || new Array(12).fill(0),
    firstDate: model?.firstDate || null, lastDate: model?.lastDate || null
  };
  reUsageForecastSummaryCache = { keys, summary };
  return summary;
}

function publishReUsageForecast(){
  const summary = getReUsageForecastSummary();
  window.reUsageForecast = summary;
  const text = !summary.ready ? 'Prognoza zużycia: wczytywanie profilu i danych PV.'
    : summary.profileMonths
    ? `Prognoza zużycia: ${Math.round(summary.annualKwh).toLocaleString('pl-PL')} kWh/rok. Profil miesięczny lub godzinowy uzupełniony rzeczywistymi pomiarami.`
    : summary.observedDays
    ? `Prognoza zużycia: ${Math.round(summary.annualKwh).toLocaleString('pl-PL')} kWh/rok. Pomiary: ${summary.observedDays} dni; poznane miesiące: ${summary.learnedMonths}/12.`
    : `Prognoza startowa: ${Math.round(summary.annualKwh).toLocaleString('pl-PL')} kWh/rok.`;
  const label = document.getElementById('usageForecastSummary');
  if (label) label.textContent = text;
  const section = document.getElementById('dashboard-re-native');
  if (section?.dataset) {
    section.dataset.reUsageForecastSource = summary.source;
    section.dataset.reUsageForecastAnnual = String(summary.annualKwh);
    section.dataset.reUsageForecastDays = String(summary.observedDays);
    section.dataset.reUsageForecastMonths = String(summary.learnedMonths);
  }
  return summary;
}

window.getReUsageForecastSummary = getReUsageForecastSummary;

function applyReActualDashboardData(payload){
  window.reClientTariffHistory = ReTariffEngine.expand(payload?.tariffHistory || null);
  reActualHourlyByDay = buildReActualHourlyMapFromPayload(payload || {});
  window.reActualHourlyByDay = reActualHourlyByDay;
  reUsageForecastModel = buildReUsageForecastModel(payload || {});
  publishReUsageForecast();
  clearReDepositCoverageCache();
  if (typeof window.applyEffectiveRdn === 'function') {
    window.applyEffectiveRdn();
  }
  if (typeof window.applyEffectiveRce === 'function') {
    window.applyEffectiveRce();
  }
  if (usageMonthsChart && usageMonthsChart.children.length) {
    recalculateUsageProfile();
  }
  const keys = Array.from(reActualHourlyByDay.keys()).sort();
  return {
    days: keys.length,
    firstDate: keys[0] || '',
    lastDate: keys[keys.length - 1] || ''
  };
}

window.applyReActualDashboardData = applyReActualDashboardData;

window.addEventListener('data:pv-updated', () => {
  clearReDepositCoverageCache();
  publishReUsageForecast();
  if (usageMonthsChart && usageMonthsChart.children.length) {
    recalculateUsageProfile();
  }
});

function getDayUsageKWh(dayDate, annualUsageKWh = getAnnualUsageKWh(getAnnualUsageInput()?.value), options = {}){
  return buildHourlyUseForDay(dayDate, annualUsageKWh, USE24, options)
    .reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function buildHourlyUseForDay(dayDate, annualUsageKWh = getAnnualUsageKWh(getAnnualUsageInput()?.value), use24Profile = USE24, options = {}) {
  const dayKey = typeof dayDate === 'string' ? dayDate.slice(0, 10) : reActualDateKey(dayDate);
  const monthIndex = Number(dayKey.slice(5, 7)) - 1;
  const sources = currentUsageMonthSources();
  const actualDay = getReActualDay(dayDate);
  const complete = actualDay?.isComplete && actualDay.hours.every(hour => hour.hasUse);
  const detailed = sources[monthIndex] !== 'standard';
  const hourlyProfile = !complete && detailed ? getHourlyUsageProfileForDay(dayDate, options) : null;
  const learnedHours = !detailed && reUsageForecastModel ? reUsageForecastModel.monthlyHours[monthIndex] : null;
  if (!complete && !hourlyProfile && !learnedHours) assertUsageHourlyProfileIsHealthy();
  return ReConsumptionEngine.resolveDay({
    dayKey, annualKwh: annualUsageKWh, monthlyKwh: normalizeMonthlyUsageProfile(usageMonthlyProfileKWh),
    sources, defaultHourlyPercent: use24Profile, hourlyProfile, learnedHours, actualDay,
  });
}

function sumUsageForSpan(startDate, spanDays, annualUsageKWh = getAnnualUsageKWh(getAnnualUsageInput()?.value), options = {}){
  let total = 0;
  const start = new Date(startDate);
  for (let i = 0; i < spanDays; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const dayOptions = { ...options };
    if (Number.isFinite(Number(options.pvOffset))) {
      dayOptions.pvOffset = Number(options.pvOffset) + i * 24;
    }
    total += getDayUsageKWh(day, annualUsageKWh, dayOptions);
  }
  return total;
}

function fixedCostRowApplies(row, annualUsageKWh = getAnnualUsageKWh(), billingCycle = getBillingCycleMonths()){
  const cycleRaw = parseInt(row?.billing_cycle_months, 10);
  if (Number.isFinite(cycleRaw) && cycleRaw > 0 && cycleRaw !== billingCycle) {
    return false;
  }

  const usageMin = parseFloat(row?.annual_usage_min_kwh);
  if (Number.isFinite(usageMin) && annualUsageKWh < usageMin) {
    return false;
  }

  const usageMax = parseFloat(row?.annual_usage_max_kwh);
  if (Number.isFinite(usageMax) && annualUsageKWh >= usageMax) {
    return false;
  }

  return true;
}

function calcTariffFixedMonthly(fixedRows, optionsOrContractPower = undefined){
  const opts = (typeof optionsOrContractPower === 'object' && optionsOrContractPower !== null)
    ? optionsOrContractPower
    : { contractPower: optionsOrContractPower };
  const contractPower = getContractPowerKw(opts.contractPower ?? contractPowerKw?.value);
  const annualUsageKWh = Object.prototype.hasOwnProperty.call(opts, 'annualUsageKWh')
    ? getAnnualUsageKWh(opts.annualUsageKWh)
    : getAnnualUsageKWh();
  const billingCycle = getBillingCycleMonths(opts.billingCycleMonths ?? billingCycleMonths?.value);
  const rows = Array.isArray(fixedRows) ? fixedRows : [];
  return rows.reduce((sum, row) => {
    if (!fixedCostRowApplies(row, annualUsageKWh, billingCycle)) {
      return sum;
    }
    const amount = parseFloat(row?.amount) || 0;
    const mode = String(row?.amount_mode || 'flat_month').toLowerCase();
    return sum + (mode === 'per_kw_month' ? amount * contractPower : amount);
  }, 0);
}

function tariffNeedsContractPower(tariffData){
  if (!tariffData) return false;
  const segment = String(tariffData.segment || tariffData.tariff?.segment || 'household').toLowerCase();
  const fixedRows = Array.isArray(tariffData.fixed) ? tariffData.fixed : [];
  return segment !== 'household' || fixedRows.some(row => String(row?.amount_mode || 'flat_month').toLowerCase() === 'per_kw_month');
}

function tariffNeedsBillingCycle(tariffData){
  if (!tariffData) return false;
  const fixedRows = Array.isArray(tariffData.fixed) ? tariffData.fixed : [];
  return fixedRows.some(row => {
    const cycle = parseInt(row?.billing_cycle_months, 10);
    return Number.isFinite(cycle) && cycle > 0;
  });
}

function updateContractPowerVisibility(tariffData){
  if (!contractPowerWrap) return;
  contractPowerWrap.classList.toggle('d-none', !tariffNeedsContractPower(tariffData));
}

function updateBillingCycleVisibility(tariffData){
  if (!billingCycleWrap) return;
  billingCycleWrap.classList.remove('d-none');
}

window.getContractPowerKw = getContractPowerKw;
window.getAnnualUsageKWh = getAnnualUsageKWh;
window.getEffectiveMonthlyUsageKWh = getEffectiveMonthlyUsageKWh;
window.getDayUsageKWh = getDayUsageKWh;
window.buildHourlyUseForDay = buildHourlyUseForDay;
window.applyUsageHourlyProfile = applyUsageHourlyProfile;
window.getBillingCycleMonths = getBillingCycleMonths;
window.fixedCostRowApplies = fixedCostRowApplies;
window.calcTariffFixedMonthly = calcTariffFixedMonthly;
window.tariffNeedsContractPower = tariffNeedsContractPower;
window.updateContractPowerVisibility = updateContractPowerVisibility;
window.tariffNeedsBillingCycle = tariffNeedsBillingCycle;
window.updateBillingCycleVisibility = updateBillingCycleVisibility;

function getReStationId(){
  const params = new URLSearchParams(window.location.search || '');
  const payload = window.dashboardLatestPayload || {};
  const account = payload.account || {};
  const energy = payload.energy || {};
  const station = account.station
    || account.stationId
    || energy.station
    || energy.stationId
    || window.dashboardStation
    || payload.station
    || params.get('station')
    || document.body?.dataset?.station
    || '';
  return String(station).trim();
}

function setUsageProfileStatus(text, isError = false){
  if (!usageProfileStatus) return;
  usageProfileStatus.textContent = text || '';
  usageProfileStatus.style.color = isError ? '#ff7b7b' : '';
}

function queueUsageProfileRefresh(){
  window.clearTimeout(usageProfileRefreshTimer);
  usageProfileRefreshTimer = window.setTimeout(() => {
    refreshTariffDerivedState().catch(console.error);
  }, 250);
}

function readUsageMonthInputs(options = {}){
  if (!usageMonthsChart) return getEffectiveMonthlyUsageKWh();
  const useBaseValue = options.base === true;
  return Array.from(usageMonthsChart.querySelectorAll('.usage-month-input')).map(input => {
    if (useBaseValue && input.dataset.baseValue != null) {
      return parseUsageKWh(input.dataset.baseValue);
    }
    return parseUsageKWh(input.value);
  });
}

function currentUsageMonthSources(){
  return normalizeUsageSources(usageMonthlySources, normalizeMonthlyUsageProfile(usageMonthlyProfileKWh) ? 'manual' : 'standard');
}

function sumUsageMonthsKWh(values){
  const months = Array.isArray(values) ? values : [];
  return months.reduce((sum, value) => sum + parseUsageKWh(value), 0);
}

function normalizeHourProfileToPercent(profile){
  const values = Array.isArray(profile) && profile.length === 24
    ? profile.map(value => Math.max(0, Number(value) || 0))
    : new Array(24).fill(100 / 24);
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0 ? values.map(value => value / total * 100) : new Array(24).fill(100 / 24);
}

function actualUsageHourValues(day){
  const hours = Array.isArray(day?.hours) ? day.hours : [];
  if (hours.length !== 24) return null;
  return hours.map(hour => Math.max(0, Number(hour?.use) || 0));
}

function getActualUsageMonthStats(monthIndex){
  const selectedMonth = Math.min(11, Math.max(0, Number(monthIndex) || 0));
  const hourTotals = new Array(24).fill(0);
  const daysByYear = new Map();
  const dayNumbers = new Set();
  let total = 0;

  for (const [dayKey, day] of reActualHourlyByDay.entries()) {
    const stamp = String(dayKey || '');
    const year = Number(stamp.slice(0, 4));
    const monthNo = Number(stamp.slice(5, 7));
    const dayNo = Number(stamp.slice(8, 10));
    if (year !== getUsageProfileYear() || monthNo !== selectedMonth + 1 || !Number.isInteger(dayNo)) continue;
    const values = actualUsageHourValues(day);
    if (!values) continue;
    if (!daysByYear.has(year)) daysByYear.set(year, new Set());
    daysByYear.get(year).add(dayNo);
    dayNumbers.add(dayNo);
    values.forEach((value, hour) => {
      hourTotals[hour] += value;
      total += value;
    });
  }

  const days = Array.from(daysByYear.values()).reduce((sum, set) => sum + set.size, 0);
  const expectedDays = Array.from(daysByYear.keys()).reduce((sum, year) => sum + getDaysInMonthForProfile(year, selectedMonth), 0);
  const status = days > 0 && expectedDays > 0 && days >= expectedDays ? 'real' : (days > 0 ? 'part' : '');
  return {
    days,
    expectedDays,
    status,
    total,
    hourTotals,
    dayNumbers,
    year: Array.from(daysByYear.keys())[0] || getUsageProfileYear(),
    profile: total > 0 ? hourTotals.map(value => value / total * 100) : null
  };
}

function sumUsageHourValues(values){
  return Array.isArray(values)
    ? values.reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0)
    : null;
}

function getProfileDayUsageValues(year, monthIndex, dayNo){
  const monthPart = String(monthIndex + 1).padStart(2, '0');
  const dayPart = String(dayNo).padStart(2, '0');
  const directKey = `${year}-${monthPart}-${dayPart}`;
  const direct = getHourlyUsageProfileForDay(directKey);
  if (Array.isArray(direct) && direct.length === 24) return direct;

  const monthDaySuffix = `-${monthPart}-${dayPart}`;
  for (const dayKey of usageHourlyByDay.keys()) {
    if (String(dayKey).slice(4, 10) === monthDaySuffix) {
      const values = getHourlyUsageProfileForDay(dayKey);
      if (Array.isArray(values) && values.length === 24) return values;
    }
  }
  return null;
}

function getProfileUsageMonthStats(monthIndex){
  const selectedMonth = Math.min(11, Math.max(0, Number(monthIndex) || 0));
  const monthNo = selectedMonth + 1;
  const shouldUseHourlyProfile =
    normalizeUsageSource(currentUsageMonthSources()[selectedMonth]) === 'xlsx' ||
    normalizeUsageSource(currentUsageMonthExportSources()[selectedMonth]) === 'xlsx';
  if (!shouldUseHourlyProfile || !usageHourlyByDay.size) {
    return null;
  }

  const hourTotals = new Array(24).fill(0);
  let total = 0;
  let days = 0;

  for (const dayKey of usageHourlyByDay.keys()) {
    if (Number(String(dayKey).slice(5, 7)) !== monthNo) continue;
    const values = getHourlyUsageProfileForDay(dayKey);
    if (!Array.isArray(values) || values.length !== 24) continue;
    days += 1;
    values.forEach((value, hour) => {
      const kwh = Math.max(0, Number(value) || 0);
      hourTotals[hour] += kwh;
      total += kwh;
    });
  }

  return days > 0
    ? { days, total, profile: total > 0 ? hourTotals.map(value => value / total * 100) : null }
    : null;
}

function buildFallbackDayUsageValues(monthKWh, expectedDays, missingDaysCount){
  if (!expectedDays || expectedDays <= 0 || missingDaysCount <= 0) {
    return null;
  }
  const dayUsageKWh = Math.max(0, Number(monthKWh) || 0) / expectedDays;
  const profile = normalizeHourProfileToPercent(USE24);
  return profile.map(percent => dayUsageKWh * percent / 100);
}

function getEffectiveUsageMonthStats(monthIndex, baseMonthKWh){
  const actualStats = getActualUsageMonthStats(monthIndex);
  const status = actualStats.status;
  const expectedDays = actualStats.expectedDays || getDaysInMonthForProfile(actualStats.year, monthIndex);

  if (!status) {
    return {
      status: '',
      total: Math.max(0, Number(baseMonthKWh) || 0),
      profile: null
    };
  }

  const hourTotals = actualStats.hourTotals.slice();
  let total = actualStats.total;

  if (status === 'part') {
    let usedProfileDays = 0;
    for (let dayNo = 1; dayNo <= expectedDays; dayNo += 1) {
      if (actualStats.dayNumbers.has(dayNo)) continue;
      const values = getProfileDayUsageValues(actualStats.year, monthIndex, dayNo);
      if (!values) continue;
      usedProfileDays += 1;
      values.forEach((value, hour) => {
        const kwh = Math.max(0, Number(value) || 0);
        hourTotals[hour] += kwh;
        total += kwh;
      });
    }

    const missingProfileDays = Math.max(0, expectedDays - actualStats.days - usedProfileDays);
    const fallbackValues = buildFallbackDayUsageValues(baseMonthKWh, expectedDays, missingProfileDays);
    if (fallbackValues) {
      for (let day = 0; day < missingProfileDays; day += 1) {
        fallbackValues.forEach((value, hour) => {
          hourTotals[hour] += value;
          total += value;
        });
      }
    }
  }

  return {
    status,
    total,
    profile: total > 0 ? hourTotals.map(value => value / total * 100) : null
  };
}

function getUsageMonthDisplayValues(baseValues){
  const values = Array.isArray(baseValues) && baseValues.length === 12 ? baseValues : getEffectiveMonthlyUsageKWh();
  const summary = getReUsageForecastSummary();
  return summary.ready ? summary.monthlyKwh.slice() : values.slice();
}

function getUsageMonthDisplaySource(monthIndex){
  const actualStats = getActualUsageMonthStats(monthIndex);
  const source = normalizeUsageSource(currentUsageMonthSources()[monthIndex]);
  return actualStats.status || (source !== 'standard' ? source : reUsageForecastModel ? 'forecast' : source);
}

function getUsageMonthExportDisplaySource(monthIndex, importDisplaySource = getUsageMonthDisplaySource(monthIndex)){
  const source = normalizeUsageSource(importDisplaySource);
  if (source === 'forecast') return 'standard';
  if (source === 'real' || source === 'part') return source;
  return normalizeUsageSource(currentUsageMonthExportSources()[monthIndex]);
}

function getUsageDayProfilePercentForMonth(monthIndex = usageProfileSelectedMonthIndex){
  const selectedMonth = Math.min(11, Math.max(0, Number(monthIndex) || 0));
  const baseValues = usageMonthsChart ? readUsageMonthInputs({ base: true }) : getEffectiveMonthlyUsageKWh();
  const effectiveStats = getEffectiveUsageMonthStats(selectedMonth, baseValues[selectedMonth]);
  if (effectiveStats.profile) {
    return effectiveStats.profile;
  }
  const profileStats = getProfileUsageMonthStats(selectedMonth);
  if (profileStats?.profile) {
    return profileStats.profile;
  }
  const hourTotals = new Array(24).fill(0);
  let total = 0;

  for (const dayKey of usageHourlyByDay.keys()) {
    const monthNo = Number(String(dayKey).slice(5, 7));
    if (monthNo !== selectedMonth + 1) continue;
    const values = getHourlyUsageProfileForDay(dayKey);
    if (!Array.isArray(values) || values.length !== 24) continue;
    values.forEach((value, hour) => {
      const kwh = Math.max(0, Number(value) || 0);
      hourTotals[hour] += kwh;
      total += kwh;
    });
  }

  return total > 0 ? hourTotals.map(value => value / total * 100) : normalizeHourProfileToPercent(USE24);
}

function syncAnnualUsageFromMonthlyProfile(values){
  const total = sumUsageMonthsKWh(values);
  if (total > 0) {
    setAnnualUsageInputValue(total);
  }
  return total;
}

function refreshUsageMonthBars(){
  if (!usageMonthsChart) return;
  const baseValues = readUsageMonthInputs({ base: true });
  let values;
  try {
    values = getUsageMonthDisplayValues(baseValues);
  } catch (error) {
    setUsageProfileStatus(error?.message || 'Błąd profilu zużycia', true);
    return;
  }
  if (usageProfileStatus?.style.color && /Brak danych PV|Dane PV|Błąd profilu/.test(usageProfileStatus.textContent || '')) {
    setUsageProfileStatus('');
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  const shares = values.map(value => total > 0 ? value / total * 100 : 0);
  const maxShare = Math.max(1, ...shares);

  usageMonthsChart.querySelectorAll('.usage-month').forEach((item, index) => {
    const input = item.querySelector('.usage-month-input');
    const bar = item.querySelector('.usage-month-bar');
    const share = item.querySelector('.usage-month-share');
    const source = item.querySelector('.usage-month-source-import');
    const exportSource = item.querySelector('.usage-month-source-export');
    const reset = item.querySelector('.usage-month-source-row:not(.usage-month-export-source-row) .usage-month-reset');
    const exportReset = item.querySelector('.usage-month-export-source-row .usage-month-reset');
    const height = Math.max(2, shares[index] / maxShare * 72);
    if (bar) bar.style.height = `${height}px`;
    if (share) share.textContent = `${shares[index].toFixed(1)}%`;
    const baseSourceValue = normalizeUsageSource(currentUsageMonthSources()[index]);
    const sourceValue = getUsageMonthDisplaySource(index);
    const isActualSource = sourceValue === 'real' || sourceValue === 'part' || sourceValue === 'forecast';
    if (input) {
      input.dataset.baseValue = String(Math.round(baseValues[index] || 0));
      if (document.activeElement !== input) {
        input.value = String(Math.round(values[index] || 0));
      }
      input.readOnly = isActualSource;
      input.classList.toggle('is-readonly-actual', isActualSource);
      input.title = isActualSource
        ? 'Wartość wyliczona z realnych danych; profil ręczny/XLSX nie jest nadpisywany'
        : '';
    }
    if (source) {
      source.textContent = `↓ ${usageSourceLabel(sourceValue)}`;
      source.dataset.source = sourceValue;
    }
    const exportBaseSourceValue = normalizeUsageSource(currentUsageMonthExportSources()[index]);
    const exportSourceValue = getUsageMonthExportDisplaySource(index, sourceValue);
    if (exportSource) {
      exportSource.textContent = `↑ ${usageExportSourceLabel(exportSourceValue)}`;
      exportSource.dataset.source = exportSourceValue;
    }
    if (reset) reset.hidden = baseSourceValue !== 'xlsx' || isActualSource;
    if (exportReset) exportReset.hidden = exportBaseSourceValue !== 'xlsx' || isActualSource;
    item.dataset.source = sourceValue;
    item.dataset.exportSource = exportSourceValue;
    item.classList.toggle('is-active', index === usageProfileSelectedMonthIndex);
    item.querySelector('.usage-month-bar-wrap')?.setAttribute('aria-pressed', String(index === usageProfileSelectedMonthIndex));
  });

  if (usageProfileTotal) {
    const source = usageHourlyByDay.size ? 'profil godzinowy' : (normalizeMonthlyUsageProfile(usageMonthlyProfileKWh) ? 'profil miesięczny' : 'profil standardowy');
    usageProfileTotal.textContent = `Suma: ${Math.round(total)} kWh/rok (${source})`;
  }
  if (!reUsageForecastModel) syncAnnualUsageFromMonthlyProfile(values);
}

function renderUsageDayProfile(){
  if (!usageDayProfileChart) return;
  const title = usageDayProfileChart.closest('.usage-day-profile')?.querySelector('h6');
  if (title) title.textContent = `Rozkład zużycia w trakcie dnia - ${MONTH_FULL[usageProfileSelectedMonthIndex]}`;
  let profile;
  try {
    profile = getUsageDayProfilePercentForMonth();
  } catch (error) {
    usageDayProfileChart.innerHTML = '';
    setUsageProfileStatus(error?.message || 'Błąd profilu zużycia', true);
    return;
  }
  const maxPercent = Math.max(1, ...profile.map(value => Number(value) || 0));
  usageDayProfileChart.innerHTML = '';
  profile.forEach((percent, hour) => {
    const col = document.createElement('div');
    col.className = 'usage-day-col';
    col.title = `${MONTH_FULL[usageProfileSelectedMonthIndex]} ${String(hour).padStart(2, '0')}:00 - ${Number(percent || 0).toFixed(2)}%`;

    const bar = document.createElement('div');
    bar.className = 'usage-day-bar';
    bar.style.height = `${Math.max(2, Number(percent || 0) / maxPercent * 72)}px`;
    const label = document.createElement('div');
    label.className = 'usage-day-hour';
    label.textContent = String(hour).padStart(2, '0');
    col.appendChild(bar);
    col.appendChild(label);
    usageDayProfileChart.appendChild(col);
  });
}

function recalculateUsageProfile(){
  publishReUsageForecast();
  if (usageMonthsChart && usageMonthsChart.children.length) {
    refreshUsageMonthBars();
  }
  renderUsageDayProfile();
}

function renderUsageProfilePanel(){
  if (!usageMonthsChart) return;
  usageProfileSelectedMonthIndex = Math.min(11, Math.max(0, Number(usageProfileSelectedMonthIndex) || 0));
  const values = getDisplayMonthlyUsageKWh(getEffectiveMonthlyUsageKWh());
  usageMonthsChart.innerHTML = '';

  values.forEach((value, index) => {
    const month = document.createElement('div');
    month.className = 'usage-month';
    month.dataset.source = normalizeUsageSource(currentUsageMonthSources()[index]);

    const input = document.createElement('input');
    input.className = 'form-control form-control-sm usage-month-input';
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.value = String(value);
    input.dataset.baseValue = String(value);
    input.setAttribute('aria-label', `${MONTH_FULL[index]} kWh`);

    const barWrap = document.createElement('div');
    barWrap.className = 'usage-month-bar-wrap';
    barWrap.role = 'button';
    barWrap.tabIndex = 0;
    barWrap.setAttribute('aria-label', `Pokaż rozkład dobowy: ${MONTH_FULL[index]}`);
    const bar = document.createElement('div');
    bar.className = 'usage-month-bar';
    barWrap.appendChild(bar);
    barWrap.addEventListener('click', () => {
      usageProfileSelectedMonthIndex = index;
      recalculateUsageProfile();
    });
    barWrap.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      usageProfileSelectedMonthIndex = index;
      recalculateUsageProfile();
    });

    const name = document.createElement('div');
    name.className = 'usage-month-name';
    name.textContent = MONTH_FULL[index];

    const share = document.createElement('div');
    share.className = 'usage-month-share';

    input.addEventListener('input', () => {
      input.dataset.baseValue = String(parseUsageKWh(input.value));
      usageMonthlyProfileKWh = readUsageMonthInputs({ base: true });
      usageMonthlySources = currentUsageMonthSources();
      usageMonthlySources[index] = 'manual';
      recalculateUsageProfile();
      setUsageProfileStatus('Niezapisane zmiany');
      queueUsageProfileRefresh();
    });

    const sourceRow = document.createElement('div');
    sourceRow.className = 'usage-month-source-row';
    const source = document.createElement('span');
    source.className = 'usage-month-source usage-month-source-import';
    source.textContent = `↓ ${usageSourceLabel(month.dataset.source)}`;
    const reset = document.createElement('button');
    reset.className = 'usage-month-reset';
    reset.type = 'button';
    reset.title = 'Wyczyść XLSX pobranej i wróć do standardowego rozkładu';
    reset.textContent = '×';
    reset.hidden = month.dataset.source !== 'xlsx';
    reset.addEventListener('click', () => {
      resetUsageProfileMonth(index + 1, 'import').catch(error => {
        console.error(error);
        setUsageProfileStatus(error?.message || 'Błąd czyszczenia miesiąca', true);
      });
    });
    sourceRow.appendChild(source);
    sourceRow.appendChild(reset);

    const exportSourceRow = document.createElement('div');
    exportSourceRow.className = 'usage-month-source-row usage-month-export-source-row';
    const exportSource = document.createElement('span');
    exportSource.className = 'usage-month-source usage-month-source-export';
    const initialImportSourceValue = getUsageMonthDisplaySource(index);
    const exportSourceValue = getUsageMonthExportDisplaySource(index, initialImportSourceValue);
    exportSource.textContent = `↑ ${usageExportSourceLabel(exportSourceValue)}`;
    const exportReset = document.createElement('button');
    exportReset.className = 'usage-month-reset';
    exportReset.type = 'button';
    exportReset.title = 'Wyczyść XLSX oddanej';
    exportReset.textContent = '×';
    exportReset.hidden = exportSourceValue !== 'xlsx';
    exportReset.addEventListener('click', () => {
      resetUsageProfileMonth(index + 1, 'export').catch(error => {
        console.error(error);
        setUsageProfileStatus(error?.message || 'Błąd czyszczenia miesiąca', true);
      });
    });
    exportSourceRow.appendChild(exportSource);
    exportSourceRow.appendChild(exportReset);

    month.appendChild(input);
    month.appendChild(barWrap);
    month.appendChild(name);
    month.appendChild(share);
    month.appendChild(sourceRow);
    month.appendChild(exportSourceRow);
    usageMonthsChart.appendChild(month);
  });

  recalculateUsageProfile();
}

async function loadUsageProfileFromDb(){
  const station = getReStationId();
  usageProfileLoaded = true;
  if (!station) {
    usageMonthlySources = normalizeUsageSources(null, 'standard');
    usageMonthlyExportSources = normalizeUsageSources(null, 'standard');
    renderUsageProfilePanel();
    return;
  }

  const response = await fetchJSONplain(`setup_func.php?action=user_consumption_get&station=${encodeURIComponent(station)}`);
  applyUsageProfileData(response?.data);
}

function applyUsageProfileData(data){
  usageMonthlyProfileKWh = normalizeMonthlyUsageProfile(data?.months);
  usageMonthlySources = normalizeUsageSources(data?.sources, usageMonthlyProfileKWh ? 'manual' : 'standard');
  usageMonthlyExportSources = normalizeUsageSources(data?.exportSources, 'standard');
  if (data?.annualUsageKwh != null) {
    setAnnualUsageInputValue(data.annualUsageKwh);
  }
  clearReDepositCoverageCache();
  publishReUsageForecast();
  renderUsageProfilePanel();
}

async function reloadUsageHourlySeriesFromDb(){
  const station = getReStationId();
  const loader = window.fetchSeriesUsage || (typeof fetchSeriesUsage === 'function' ? fetchSeriesUsage : null);
  if (!station || typeof loader !== 'function') return;
  const data = await loader(station, getReDataStartDate(), getReDataEndDate());
  applyUsageHourlyProfile(data);
}

async function saveUsageProfileToDb(){
  const station = getReStationId();
  if (!station) {
    setUsageProfileStatus('Brak numeru stacji', true);
    return;
  }

  const months = normalizeMonthlyUsageProfile(readUsageMonthInputs({ base: true }));
  if (!months) {
    setUsageProfileStatus('Wpisz zużycie miesięczne', true);
    return;
  }

  usageMonthlyProfileKWh = months;
  usageMonthlySources = currentUsageMonthSources();
  const annualUsageKwh = Math.round(sumUsageMonthsKWh(months));
  syncAnnualUsageFromMonthlyProfile(months);
  setUsageProfileStatus('Zapisywanie...');
  const response = await fetch('setup_func.php?action=user_consumption_save', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ station, months, sources: usageMonthlySources, annualUsageKwh })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  const data = JSON.parse(text);
  if (!data?.ok) {
    throw new Error(data?.error || 'Nie zapisano profilu');
  }
  applyUsageProfileData(data.data);
  await reloadUsageHourlySeriesFromDb();
  setUsageProfileStatus('Zapisano');
  await refreshTariffDerivedState().catch(console.error);
}

async function uploadUsageProfileXlsx(file){
  const station = getReStationId();
  if (!station) {
    setUsageProfileStatus('Brak numeru stacji', true);
    return;
  }
  if (!file) return;
  const form = new FormData();
  form.append('station', station);
  form.append('file', file);
  setUsageProfileStatus('Wczytywanie XLSX...');
  const response = await fetch('setup_func.php?action=user_consumption_xlsx_upload', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    body: form
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text);
  }
  const data = JSON.parse(text);
  if (!data?.ok) {
    throw new Error(data?.error || 'Nie wczytano XLSX');
  }
  applyUsageProfileData(data.data);
  await reloadUsageHourlySeriesFromDb();
  const imported = data.data?.imported;
  const exported = data.data?.exported;
  const parts = [];
  if (imported) parts.push(`↓ ${MONTH_FULL[(imported.month || 1) - 1]}: ${Math.round(imported.totalKwh || 0)} kWh`);
  if (exported) parts.push(`↑ ${MONTH_FULL[(exported.month || 1) - 1]}: ${Math.round(exported.totalKwh || 0)} kWh`);
  setUsageProfileStatus(parts.length ? `Wczytano ${parts.join(', ')}` : 'Wczytano XLSX');
  await refreshTariffDerivedState().catch(console.error);
}

async function resetUsageProfileMonth(month, direction = 'import'){
  const station = getReStationId();
  if (!station) {
    setUsageProfileStatus('Brak numeru stacji', true);
    return;
  }
  setUsageProfileStatus('Czyszczenie miesiąca...');
  const response = await fetch('setup_func.php?action=user_consumption_month_reset', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ station, month, direction })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text);
  }
  const data = JSON.parse(text);
  if (!data?.ok) {
    throw new Error(data?.error || 'Nie wyczyszczono miesiąca');
  }
  applyUsageProfileData(data.data);
  await reloadUsageHourlySeriesFromDb();
  setUsageProfileStatus(direction === 'export' ? 'Oddana energia XLSX została wyczyszczona' : 'Miesiąc wrócił do standardowego rozkładu');
  await refreshTariffDerivedState().catch(console.error);
}

function initUsageProfilePanel(){
  if (!usageProfileToggle || !usageProfilePanel) return;
  usageProfileToggle.addEventListener('click', () => {
    const isHidden = usageProfilePanel.hidden;
    usageProfilePanel.hidden = !isHidden;
    usageProfileToggle.setAttribute('aria-expanded', String(isHidden));
    renderUsageProfilePanel();
  });
  usageProfileSave?.addEventListener('click', () => {
    saveUsageProfileToDb().catch(error => {
      console.error(error);
      setUsageProfileStatus(error?.message || 'Błąd zapisu', true);
    });
  });
  if (usageProfileUpload && usageProfileUpload.tagName !== 'LABEL') {
    usageProfileUpload.addEventListener('click', () => usageProfileFile?.click());
  }
  usageProfileFile?.addEventListener('change', () => {
    const file = usageProfileFile.files && usageProfileFile.files[0];
    uploadUsageProfileXlsx(file).catch(error => {
      console.error(error);
      setUsageProfileStatus(error?.message || 'Błąd importu XLSX', true);
    }).finally(() => {
      usageProfileFile.value = '';
    });
  });
  loadUsageProfileFromDb().then(() => {
    return reloadUsageHourlySeriesFromDb().catch(error => {
      console.error(error);
      window.reUsageProfileError = error?.message || 'Błąd godzinowego profilu zużycia';
      setUsageProfileStatus(window.reUsageProfileError, true);
    });
  }).then(() => {
    refreshTariffDerivedState().catch(console.error);
  }).catch(error => {
    console.error(error);
    usageMonthlyProfileKWh = null;
    usageMonthlySources = normalizeUsageSources(null, 'standard');
    usageMonthlyExportSources = normalizeUsageSources(null, 'standard');
    renderUsageProfilePanel();
    setUsageProfileStatus('Nie wczytano profilu', true);
  });
}

// ===== CSV trace (tabela godzinowa) =====
window.traceRows = [];
const TRACE_HEADERS = [
  'data','use_kWh','pv_kWh','battery_kWh','deposit_zl',
  'bat_plus','peak_bat_minus','peak_deposit_plus','bat_minus',
  'cheap_bat_plus','cheap_pay_deposit','cheap_pay_cash','pay_deposit',
  'buyOwn_kWh','buyBank_kWh','soldImmediate_kWh','soldBank_kWh'
];

function resetTrace(){ window.traceRows = []; renderTraceTable(); }

function renderTraceTable(){
  const tbl = document.getElementById('traceTable');
  if(!tbl) return;
  if(window.traceRows.length===0){ tbl.innerHTML=''; return; }
  const thead = '<thead><tr>'+TRACE_HEADERS.map(h=>`<th>${h}</th>`).join('')+'</tr></thead>';
  const rows  = window.traceRows.map(r=>'<tr>'+TRACE_HEADERS.map(h=>`<td>${(r[h]??'')}</td>`).join('')+'</tr>').join('');
  tbl.innerHTML = thead + '<tbody>'+rows+'</tbody>';
  publishHourSeriesFromTrace();
}

function startOfLocalDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(date, n){ const x=new Date(date); x.setDate(x.getDate()+Number(n||0)); return x; }
function ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

/**
 * Publikuje serie godzinowe dla *doby z suwaka*.
 * @param {number|Date} [day] - ms lub Date wybranej doby; gdy brak, bierze z ostatniego wpisu.
 */
function publishHourSeriesFromTrace(day){
  const rows = Array.isArray(window.traceRows) ? window.traceRows : [];
  if (!rows.length) return;

  // 1) Ustal dzień
  let dayMs;
  if (day != null) {
    dayMs = (day instanceof Date) ? day.getTime() : Number(day);
  } else if (rows[rows.length-1]?.ms != null) {
    dayMs = startOfLocalDay(new Date(rows[rows.length-1].ms)).getTime();
  } else {
    const dstr = String(rows[rows.length-1]?.data || '').slice(0,10);
    dayMs = startOfLocalDay(new Date(dstr)).getTime();
  }
  const startDate = startOfLocalDay(new Date(dayMs));
  const endDate   = startOfLocalDay(addDays(startDate, 1)); // NIE +24h ms!
  const start = startDate.getTime();
  const end   = endDate.getTime();

  // 2) Zindeksuj wpisy *po początku GODZINY lokalnej* (00..23)
  // normalizujemy ms każdego wpisu do ms początku lokalnej godziny
  const normHourMs = (ms)=>{ const d=new Date(ms); d.setMinutes(0,0,0); return d.getTime(); };

  const dayRows = rows
    .map(r => {
      const ms = (r.ms != null)
        ? Number(r.ms)
        : new Date(String(r.data||'').replace(' ','T')+':00').getTime();
      return { ms, r };
    })
    .filter(x => x.ms >= start && x.ms < end)
    .map(x => ({ hms: normHourMs(x.ms), r: x.r }));

  // Hash: ms_poczatek_godziny → rekord (ostatni wygrywa przy duplikatach)
  const map = new Map();
  for (const x of dayRows) map.set(x.hms, x.r);

  // 3) Zbuduj 24 sloty 00..23 po *nazwach godzin* tej doby
  const H=24;
  const hSlotMs = Array.from({length:H}, (_,h)=>{ const d=new Date(start); d.setHours(h,0,0,0); return d.getTime(); });
  const pick = (ms, key, alt=0) => Number((map.get(ms)?.[key]) ?? alt);

  window.usedKwhHour    = hSlotMs.map(ms => pick(ms, 'use_kWh',   map.get(ms)?.use   ?? 0));
  window.pvKwhHour      = hSlotMs.map(ms => pick(ms, 'pv_kWh',    0));
  window.windKwhHour    = hSlotMs.map(ms => pick(ms, 'wind_kWh',  0));
  window.batterySocHour = hSlotMs.map(ms => pick(ms, 'battery_kWh', map.get(ms)?.bat ?? 0));
  window.boughtKwhHour  = hSlotMs.map(ms => pick(ms, 'buy_kWh',   0));
  window.soldKwhHour    = hSlotMs.map(ms => pick(ms, 'sold_kWh',  0));

  // 4) Odśwież wykresy dla TEGO dnia
  if (typeof drawRceChart === 'function') {
    drawRceChart( ymd(startDate) );
  }
}


function downloadCSVFromTrace(){
  if(!Array.isArray(window.traceRows) || !window.traceRows.length){
    alert('Brak danych do eksportu. Uruchom najpierw symulację.');
    return;
  }

  const sep = ';';

  // 1) zbierz wszystkie klucze z rekordów (to jest klucz do “pełnego” CSV)
  const keySet = new Set();
  for (const r of window.traceRows) Object.keys(r || {}).forEach(k => keySet.add(k));

  // 2) ułóż nagłówki sensownie: data na początku, reszta alfabetycznie
  const keys = Array.from(keySet);
  keys.sort((a,b)=> a.localeCompare(b));
  const headers = ['data', ...keys.filter(k => k !== 'data')];

  // 3) buduj CSV
  let csv = 'price_basis' + sep + headers.map(csvEscape).join(sep) + '\n';
  for (const r of window.traceRows){
    csv += csvEscape(window.DashboardPricing ? window.DashboardPricing.basis : 'gross') + sep + headers.map(h => csvEscape(r?.[h])).join(sep) + '\n';
  }

  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const now = new Date();
  a.download = `rev_bilans_${now.toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}
// ===== CSV (rok) – godzinowo 365×24 =====

function csvEscape(v){
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

function computeSpanDaysSafe(){
  // jeśli masz dane PV/Wind krótsze niż rok, to tniemy do min
  const pvDays   = (Array.isArray(window.pv)   ? Math.floor(window.pv.length   / 24) : 365);
  const windDays = (Array.isArray(window.wind) ? Math.floor(window.wind.length / 24) : 365);
  return Math.max(1, Math.min(365, pvDays || 365, windDays || 365));
}

function pickCostFn(){
  return window.costBankPVWindSell;
}

function downloadCSVYearHourly(){
  const fn = pickCostFn();
  if (!fn){
    alert('CSV (rok) godzinowo działa dla net-billing / RCE.');
    return;
  }
  if (typeof fn !== 'function'){
    alert('Brak funkcji symulacji costBankPVWindSell.');
    return;
  }

  // parametry jak w calc()
  const annualK  = getAnnualUsageKWh();                    // kWh/rok
  const kWp      = (parseFloat(pvInp?.value) || 0) / 1000; // kWp
  const days     = computeSpanDaysSafe();

  // reset globali, bo costBankPVWindSell używa depozytu / limitów rocznych
  deposit = getReInitialDepositPln();
  window._greenYearGenKWh  = 0;
  window._greenYearSoldKWh = 0;

  // zrobimy to bez psucia bieżącego dnia na ekranie:
  const savedTrace = window.traceRows;
  const yearRows = [];
  window.traceRows = yearRows;

  let soc = 0;
  let pvOffset = 0;

  const start = new Date(START); // START masz w scripts.js
  for (let d = 0; d < days; d++){
    const dayDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d, 0,0,0,0);
    const baseMs = dayDate.getTime();
    const hourUse = buildHourlyUseForDay(dayDate, annualK, USE24, { kWp, pvOffset });
    const { socOut } = fn(hourUse, soc, kWp, pvOffset, baseMs, true); // doLog=true => 24 rekordy
    if (socOut !== undefined) soc = socOut;
    pvOffset += 24;
  }

  // przywróć traceRows dla UI
  window.traceRows = savedTrace;

  if (!yearRows.length){
    alert('Brak danych rocznych do eksportu.');
    return;
  }

  // nagłówki = union kluczy (żeby złapać też np. buy_kWh, sold_kWh, wind_kWh itd.)
  const keySet = new Set();
  for (const r of yearRows) Object.keys(r || {}).forEach(k => keySet.add(k));
  const headers = Array.from(keySet);

  let csv = 'price_basis;' + headers.map(csvEscape).join(';') + '\n';
  for (const r of yearRows){
    csv += csvEscape(window.DashboardPricing ? window.DashboardPricing.basis : 'gross') + ';' + headers.map(h => csvEscape(r?.[h])).join(';') + '\n';
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;

  const kWpStr = ((parseFloat(pvInp?.value) || 0) / 1000).toFixed(2);
  const annStr = (parseFloat(getAnnualUsageInput()?.value) || 0).toFixed(0);
  a.download = `rev_hourly_${START}_${days}d_${annStr}kWh_${kWpStr}kWp.csv`;

  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


document.getElementById('downloadCsvDay')?.addEventListener('click', downloadCSVFromTrace);
document.getElementById('downloadCsvYear')?.addEventListener('click', downloadCSVYearHourly);


 
 /* =========  BANK + PV + WIATR + sprzedaż nadwyżek (net-billing)  =========
   - hourUse: [24] zużycie kWh/h
   - socIn:   początkowy stan magazynu (kWh)
   - kWp:     moc PV
   - pvOffset: offset do tablic pv/wind
   - baseMs:  timestamp (ms) północy doby
   - doLog:   czy logować do window.traceRows (24 rekordy)
   Zwraca: { cost, socOut }
   Zasady:
   - Depozyt prosumencki pokrywa TYLKO energię (nie dystrybucję) – liczymy BRUTTO (jak u Ciebie).
   - Kupno: ENERGIA + DYSTRYBUCJA; sprzedaż: cena z getTariffPriceSellAt().
   - Zakup do magazynu tylko pod brak do najbliższego PV albo kolejnej tańszej godziny zakupu.
============================================================================ */
function getReHardwareScenario(pvKwp, storageKwh) {
  const baseline = document.getElementById('dashboard-re-native')?.dataset;
  const differs = (value, actual) => actual != null && actual !== '' &&
    Number.isFinite(Number(actual)) && Math.abs(value - Number(actual)) > 0.001;
  const pvChanged = differs(pvKwp, baseline?.rePvKwp);
  const storageChanged = differs(storageKwh, baseline?.reStorageKwh);
  return { pvChanged, flowsChanged: pvChanged || storageChanged };
}

function costBankPVWindSell(hourUse, socIn, kWp, pvOffset, baseMs, doLog = false) {
  // --- stałe i przełączniki ---
  const CAP   = chkBank.checked ? getBankCapacityKWh() : 0;
  const ETA   = 0.99;                     // sprawność rozładowania
  const CHUNK = CAP / 2;                  // max ładow./rozładow. w 1h (kWh)
  const RESERVE = CAP * 0.10;             // rezerwa 5%
  const SELL_SOC_MARGIN = CAP * 0.05;     // zostaw dodatkowe 5% SOC przy sprzedaży z magazynu
  const MORNING_PV_OVERFLOW_START = 5;    // godziny, w których wolno wyprzedzić nadmiar PV
  const MORNING_PV_OVERFLOW_END = 11;
  const MORNING_PV_OVERFLOW_SOC_LIMIT = CAP * 1.00;
  const MORNING_PV_OVERFLOW_MIN_PRICE = 0.10; // 10 gr/kWh
  const OPPORTUNITY_EXPORT_MIN_SPREAD_PLN = 0.35;
  const OPPORTUNITY_ACCEPTABLE_BUY_QUANTILE = 0.55;
  const OPPORTUNITY_EVENING_TOP_HOUR_COUNT = 4;

  // włączniki źródeł
  const pvOn    = (typeof chkPV   !== "undefined" && chkPV.checked && kWp);
  const windOn  = (typeof chkWind !== "undefined" && chkWind.checked);
  const hasPV   = (typeof pv   !== "undefined");
  const hasWind = Array.isArray(window.wind);
  // Zmieniony sprzęt symulujemy na zmierzonym zużyciu, bez odtwarzania dawnych przepływów.
  const hardwareScenario = getReHardwareScenario(pvOn ? Number(kWp) : 0, CAP);
  const replayActualFlows = !!window.__dashboardReHybridForecastBatch || !hardwareScenario.flowsChanged;

  // utilki
  const R3 = (typeof round3 === 'function') ? round3 :
             (x)=> Math.round((Number(x)+Number.EPSILON)*1000)/1000;

  // ---- ceny (energia/dystrybucja/sprzedaż) ----
  function resolveCodeAt(dtMs){
    if (window.TARIFF_RT?.resolveWindowAt) return window.TARIFF_RT.resolveWindowAt(dtMs);
    const d = new Date(dtMs), h=d.getHours(), m=d.getMonth()+1;
    const T = window.CUR_TARIFF||{};
    const zm = String(T.zone_model||'all').toLowerCase();
    if (zm==='all') return 'all';
    if (T.use_monthly && T.monthly?.[m]) {
      const val = parseInt(T.monthly[m][h] ?? 2, 10);
      if (zm==='highmidlow') return ({1:'high',2:'mid',3:'low'})[val] || 'mid';
      if (zm==='daynight')   return ({1:'night',2:'day'})[val] || 'day';
      if (zm==='peakoffpeak')return ({1:'offpeak',2:'peak'})[val] || 'peak';
    }
    if (zm==='daynight')    return (T.dn_night||[]).includes(h) ? 'night'   : 'day';
    if (zm==='peakoffpeak') return (T.po_off||[]).includes(h)   ? 'offpeak' : 'peak';
    return 'all';
  }
  const stripD = s => (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const isEA = label => {
    const x = stripD(label);
    return x==='energia czynna' || x.startsWith('energia czynna') ||
           (x.includes('energia') && x.includes('czynna')) || x==='energia';
  };
  function energyPriceAt(dtMs){
    const T = window.CUR_TARIFF || {};
    const code = resolveCodeAt(dtMs);
    if ((T.sell_method||'rdn') === 'rdn'){
      const buyIndex = window.TARIFF_RT?._rdnBuyIndex || window.TARIFF_RT?._buyIndex || window.TARIFF_RT?._rdnIndex;
      const indexed = buyIndex?.get(new Date(dtMs).toISOString().slice(0,13));
      const rdn = indexed ?? 0;
      const add = Number(T.osd_add_rdn||0);
      const ak  = Number(T.osd_add_akcyza||0);
      return rdn + add + ak; // energia czynna zakupu dynamicznego
    }
    const T2 = window.CUR_TARIFF || {};
    let sum = 0;
    for (const v of (T2.variable||[])){
      const wc = String(v.window_code||'').toLowerCase();
      if ((wc==='all' || wc===code) && isEA(v.label)) sum += Number(v.price||0);
    }
    return sum;
  }
  function totalBuyAt(dtMs){
    // pełna cena zakupu = energia (RDN + dodatki) + dystrybucja
    return (typeof getTariffPriceBuyAt==='function') ? getTariffPriceBuyAt(dtMs) : 0;
  }

  const dynamicBuyTariff = String((window.CUR_TARIFF || {}).sell_method || 'rdn').toLowerCase() === 'rdn';

  // --- 1) Przygotuj godzinowe rekordy: dynamiczna taryfa liczy bieżącą dobę, niedynamiczna patrzy też na jutro ---
  const H = [];
  const actualDayCandidate = getReActualDay(baseMs);
  const actualDay = actualDayCandidate && (
    actualDayCandidate.isComplete ||
    (typeof window !== 'undefined' && window.__dashboardReHybridForecastBatch)
  ) ? actualDayCandidate : null;
  const HORIZON_HOURS = dynamicBuyTariff ? 24 : 48;
  const lookaheadUseByDay = new Map();

  function dayStartForDate(date){
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  }

  function pvKWhForHourIndex(i, dt, actualHour){
    if ((window.__dashboardReHybridForecastBatch || !hardwareScenario.pvChanged) && actualHour && actualHour.hasPv) return Number(actualHour.pv || 0);
    if (!pvOn) return 0;
    if (hasPV && pv[pvOffset+i]) return pvK(pv[pvOffset+i][1], kWp);
    const dayBaseOffset = pvOffset + i - dt.getHours();
    return getProfilePvKWhForHour(dt.getHours(), { kWp, dayDate: dt, pvOffset: dayBaseOffset });
  }

  function useKWhForHourIndex(i, dt, actualHour){
    if (actualHour && actualHour.hasUse) return Number(actualHour.use || 0);
    if (i < 24) return hourUse[i] || 0;

    const dayStart = dayStartForDate(dt);
    const dayKey = reUsageDateKey(dayStart);
    if (!lookaheadUseByDay.has(dayKey)) {
      const dayBaseOffset = pvOffset + i - dt.getHours();
      lookaheadUseByDay.set(
        dayKey,
        buildHourlyUseForDay(dayStart, getAnnualUsageKWh(), USE24, { kWp, pvOffset: dayBaseOffset })
      );
    }
    const values = lookaheadUseByDay.get(dayKey);
    return Array.isArray(values) ? Number(values[dt.getHours()] || 0) : 0;
  }

  for (let i=0;i<HORIZON_HOURS;i++){
    const dt = new Date(baseMs);
    dt.setHours(dt.getHours() + i);
    const dtMs = dt.getTime();
    const ts = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:00`;

    const eBuy  = energyPriceAt(dtMs);
    const all   = totalBuyAt(dtMs);
    const dBuy  = Math.max(0, all - eBuy);
    const sell  = (typeof getTariffPriceSellAt==='function') ? getTariffPriceSellAt(dtMs) : 0;

    const actualHourDay = i < 24 ? actualDay : getReActualDay(dtMs);
    const actualHour = actualHourDay && actualHourDay.hours ? actualHourDay.hours[dt.getHours()] : null;
    const pvKWh = pvKWhForHourIndex(i, dt, actualHour);
    const wKWh  = (windOn && hasWind && window.wind[pvOffset+i]) ? windK(window.wind[pvOffset+i][1]) : 0;
    const useKWh = useKWhForHourIndex(i, dt, actualHour);

	// Aktywna cena sprzedaży (RCE*1.23 albo RCEm), nazwa pola zostaje dla zgodności z resztą kodu.
	const rceOnly = Math.max(0, Number(sell || 0));
	
    // roczna produkcja PV + wiatr (dla limitu prosumenckiego)
    if (i < 24 && typeof window !== 'undefined' && typeof window._greenYearGenKWh === 'number') {
      window._greenYearGenKWh += (pvKWh + wKWh);
    }

    H.push({
      idx:i, dtMs, ts,
	  rce: rceOnly, 
      eBuy, dBuy, sell, financialBuy: all,
      totalBuy: window.TARIFF_CONTROL_RT ? window.TARIFF_CONTROL_RT.getBuyAt(dtMs) : all,
      pv_kWh: pvKWh, wind_kWh: wKWh, use_kWh: useKWh,
      gen_kWh: pvKWh + wKWh,
      store_kWh: 0, dis_kWh: 0, buy_kWh: 0, topup_kWh: 0,
      sold_kWh: 0, soldImmediate_kWh: 0, soldBank_kWh: 0, bat_after: 0,
      actualBuyKWh: actualHour ? Number(actualHour.buy || 0) : 0,
      actualBuyBankKWh: actualHour ? Number(actualHour.buyBank || 0) : 0,
      actualSellKWh: actualHour ? Number(actualHour.sell || 0) : 0,
      actualSoldBankKWh: actualHour ? Number(actualHour.soldBank || 0) : 0,
      actualBatteryKWh: actualHour && actualHour.batteryKwh != null ? Number(actualHour.batteryKwh) : null
    });

  }

  // helper: aktywna cena sprzedaży z runtime dla indeksu godziny H[i]
  function priceSellIdx(i){
    const dt = H[i]?.dtMs;
    const price = window.TARIFF_CONTROL_RT ? window.TARIFF_CONTROL_RT.getSellAt(dt)
      : ((typeof getTariffPriceSellAt === 'function') ? Number(getTariffPriceSellAt(dt)) : Number(H[i]?.sell||0));
    return Number.isFinite(price) ? Math.max(0, price) : 0;
  }

  function financialSellIdx(i) { return Math.max(0, Number(H[i]?.sell || 0)); }

  // helpery do limitu rocznej sprzedaży (Σ_sprzedane <= Σ_wyprodukowane)
  function remainingGreenQuotaKWh(){
    if (typeof window === 'undefined') return Infinity;
    const gen  = Number(window._greenYearGenKWh  || 0);
    const sold = Number(window._greenYearSoldKWh || 0);
    return Math.max(0, gen - sold);
  }
  function registerGreenSale(kWh){
    if (typeof window === 'undefined') return;
    if (!kWh) return;
    window._greenYearSoldKWh = Number(window._greenYearSoldKWh || 0) + kWh;
  }

  // --- 2) Plan: sprzedaż z banku zostaje po droższych godzinach, zakup do banku jest liczony godzinowo pod potrzeby ---
  const A_SELL_RANGE = [...Array(7).keys()].map(i=>i+5);      // 05–11
  const B_SELL_RANGE = [...Array(8).keys()].map(i=>i+16);     // 16–23
  const OPPORTUNITY_SELL_RANGE = [...Array(9).keys()].map(i=>i+15); // 15–23

  function topSellIdx(idxRange, count = 2){
    return idxRange
      .map(i => ({ i, v: priceSellIdx(i) }))
      .sort((a,b) => b.v - a.v)     // malejąco po aktywnej cenie sprzedaży
      .slice(0,count)
      .map(o => o.i);
  }

  function quantile(values, q){
    const arr = values
      .map(value => Number(value))
      .filter(value => Number.isFinite(value))
      .sort((a,b) => a - b);
    if (!arr.length) return null;
    const pos = (arr.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return arr[base + 1] !== undefined ? arr[base] + rest * (arr[base + 1] - arr[base]) : arr[base];
  }

  function futureAcceptableBuyPriceAfter(t){
    const refs = [];
    for (let i=t+1; i<H.length; i++){
      const price = Number(H[i]?.totalBuy);
      if (Number.isFinite(price)) refs.push(price);
    }
    return quantile(refs, OPPORTUNITY_ACCEPTABLE_BUY_QUANTILE);
  }

  const sellTopA  = topSellIdx(A_SELL_RANGE, 2);
  const sellTopB  = topSellIdx(B_SELL_RANGE, 2);
  const opportunitySellTop = topSellIdx(OPPORTUNITY_SELL_RANGE, OPPORTUNITY_EVENING_TOP_HOUR_COUNT);
  const opportunitySellHours = opportunitySellTop.filter(i => {
    const acceptableBuy = futureAcceptableBuyPriceAfter(i);
    return acceptableBuy !== null && priceSellIdx(i) - acceptableBuy >= OPPORTUNITY_EXPORT_MIN_SPREAD_PLN;
  });
  const opportunitySellSet = new Set(opportunitySellHours);

  // te same dwie godziny, ale w kolejności czasowej (earlier, later)
  const sellPairA = [...sellTopA].sort((a,b)=> a - b);
  const sellPairB = [...sellTopB].sort((a,b)=> a - b);

  const plan = {
    doSellA: (sellTopA.length>0),
    doSellB: (sellTopB.length>0),
    sellPairA, sellPairB,
    opportunitySellHours
  };

  // pomoc: sumy/deficyty
  function sumUse(a,b){ let s=0; for(let i=Math.max(0,a);i<=Math.min(b,H.length-1);i++) s+=H[i].use_kWh; return s; }
  function sumGen(a,b){ let s=0; for(let i=Math.max(0,a);i<=Math.min(b,H.length-1);i++) s+=H[i].gen_kWh; return s; }
  function needDef(a,b){ const n = sumUse(a,b) - sumGen(a,b); return Math.max(0, n); }
  const BUY_PRICE_EPS = 0.0005;

  function isDynamicBuyTariff(){
    return dynamicBuyTariff;
  }

  function buildBuySupportHours(){
    const byDay = new Map();
    H.forEach((row, hour) => {
      const price = Number(row?.totalBuy || 0);
      if (!Number.isFinite(price)) return;
      const dayIndex = Math.floor(hour / 24);
      if (!byDay.has(dayIndex)) byDay.set(dayIndex, []);
      byDay.get(dayIndex).push({ hour, price });
    });

    const out = [];
    for (const hours of byDay.values()) {
      if (isDynamicBuyTariff()) {
        out.push(
          ...hours
            .slice()
            .sort((a, b) => a.price - b.price || a.hour - b.hour)
            .slice(0, 3)
            .map(row => row.hour)
        );
        continue;
      }

      const minPrice = Math.min(...hours.map(row => row.price));
      out.push(
        ...hours
          .filter(row => row.price <= minPrice + BUY_PRICE_EPS)
          .map(row => row.hour)
      );
    }

    return out
      .sort((a, b) => a - b);
  }

  const buySupportHours = buildBuySupportHours();
  const buySupportSet = new Set(buySupportHours);
  plan.buySupportHours = buySupportHours.slice();
  plan.dynamicBuyTariff = isDynamicBuyTariff();

  function nextPvHourAfter(t){
    for (let i = t + 1; i < H.length; i += 1) {
      if (Number(H[i]?.pv_kWh || 0) > 0.05) return i;
    }
    return null;
  }

  function nextBuySupportHourAfter(t, endExclusive = H.length){
    for (const hour of buySupportHours) {
      if (hour > t && hour < endExclusive) return hour;
    }
    return null;
  }

  const staticPriceLevelsByDay = new Map();

  function priceAtHour(hour){
    return Number(H[hour]?.totalBuy || 0);
  }

  function pricesEqual(a, b){
    return Math.abs(Number(a || 0) - Number(b || 0)) <= BUY_PRICE_EPS;
  }

  function staticPriceLevelsForDay(dayIndex){
    if (staticPriceLevelsByDay.has(dayIndex)) return staticPriceLevelsByDay.get(dayIndex);

    const levels = [];
    H.forEach((row, hour) => {
      if (Math.floor(hour / 24) !== dayIndex) return;
      const price = Number(row?.totalBuy || 0);
      if (!Number.isFinite(price)) return;
      if (!levels.some(level => pricesEqual(level, price))) levels.push(price);
    });
    levels.sort((a, b) => a - b);
    staticPriceLevelsByDay.set(dayIndex, levels);
    return levels;
  }

  function isStaticMediumPriceHour(hour){
    if (isDynamicBuyTariff()) return false;
    const levels = staticPriceLevelsForDay(Math.floor(hour / 24));
    if (levels.length < 3) return false;
    const price = priceAtHour(hour);
    return price > levels[0] + BUY_PRICE_EPS && price < levels[levels.length - 1] - BUY_PRICE_EPS;
  }

  function endOfSamePriceBlock(t){
    let end = t;
    const price = priceAtHour(t);
    while (end + 1 < H.length && pricesEqual(priceAtHour(end + 1), price)) {
      end += 1;
    }
    return end;
  }

  function nextDistinctPriceBlockAfter(t){
    const start = endOfSamePriceBlock(t) + 1;
    if (start >= H.length) return null;
    return {
      start,
      end: endOfSamePriceBlock(start),
      price: priceAtHour(start)
    };
  }

  function nextDynamicBuySupportHourBefore(t, endExclusive){
    return nextBuySupportHourAfter(t, endExclusive);
  }

  function endOfBuySupportBlock(t){
    let end = t;
    while (end + 1 < H.length && buySupportSet.has(end + 1)) {
      end += 1;
    }
    return end;
  }

  function nextSupportHour(t){
    if (!isDynamicBuyTariff()) {
      const startAfterCurrentBuyBlock = buySupportSet.has(t) ? endOfBuySupportBlock(t) : t;
      const buyHour = nextBuySupportHourAfter(startAfterCurrentBuyBlock, H.length);
      return buyHour != null ? buyHour : H.length;
    }

    const pvHour = nextPvHourAfter(t);
    const endExclusive = pvHour == null ? H.length : pvHour;
    const buyHour = nextDynamicBuySupportHourBefore(t, endExclusive);
    return buyHour != null ? buyHour : endExclusive;
  }

  function targetSOCForSupportAt(t){
    const inStaticBuyBlock = !isDynamicBuyTariff() && buySupportSet.has(t);
    const buyBlockEnd = inStaticBuyBlock ? endOfBuySupportBlock(t) : t;
    const startAfterBuyBlock = buyBlockEnd + 1;
    const boundary = nextSupportHour(t);
    const end = boundary - 1;
    if (end < startAfterBuyBlock) return 0;
    return Math.min(CAP, needDef(startAfterBuyBlock, end) / ETA);
  }

  function mediumBridgeBlockForHour(t){
    if (!isStaticMediumPriceHour(t)) return null;
    if (endOfSamePriceBlock(t) !== t) return null;

    const nextBlock = nextDistinctPriceBlockAfter(t);
    if (!nextBlock) return null;
    return nextBlock.price > priceAtHour(t) + BUY_PRICE_EPS ? nextBlock : null;
  }

  function targetSOCForMediumBridgeAt(t){
    const block = mediumBridgeBlockForHour(t);
    if (!block) return 0;
    return Math.min(CAP, needDef(block.start, block.end) / ETA);
  }

  // minimalny SOC po sprzedaży
  function minSOCAfterSellAt(t){
    const boundary = nextSupportHour(t);
    const end = boundary - 1;
    const need = end > t ? needDef(t + 1, end) : 0;
    return Math.min(CAP, Math.max(RESERVE, need / ETA) + SELL_SOC_MARGIN);
  }

  function projectedPvSocPeakAfterHour(t, currentSoc){
    let projected = Math.max(0, Number(currentSoc) || 0);
    let peak = projected;

    for (let i=t+1; i<24 && i<H.length; i++){
      const pvSurplus = Math.max(0, Number(H[i]?.pv_kWh || 0) - Number(H[i]?.use_kWh || 0));
      projected += Math.min(CHUNK, pvSurplus);
      if (projected > peak) peak = projected;
    }

    return peak;
  }

  function sellMorningPvOverflow(t, h){
    if (!(typeof chkSell !== 'undefined' && chkSell.checked)) return 0;
    if (t < MORNING_PV_OVERFLOW_START || t > MORNING_PV_OVERFLOW_END) return 0;

    const priceNow = priceSellIdx(t);
    if (priceNow <= MORNING_PV_OVERFLOW_MIN_PRICE) return 0;

    const projectedPeak = projectedPvSocPeakAfterHour(t, bat);
    const excessSoc = projectedPeak - MORNING_PV_OVERFLOW_SOC_LIMIT;
    if (excessSoc <= 0) return 0;

    const minSOC = minSOCAfterSellAt(t);
    const available = Math.max(0, (bat - minSOC) * ETA);
    const quota = remainingGreenQuotaKWh();
    const sellable = Math.min(
      CHUNK,
      available,
      excessSoc * ETA,
      Number.isFinite(quota) ? quota : Infinity
    );

    if (sellable <= 0) return 0;

    bat -= sellable / ETA;
    if (typeof deposit !== 'undefined') deposit += sellable * financialSellIdx(t);
    h.sold_kWh += sellable;
    h.soldBank_kWh += sellable;
    day.soldBank_kWh += sellable;
    day.soldBank_zl += sellable * financialSellIdx(t);
    registerGreenSale(sellable);
    return sellable;
  }

  // --- 4) stan, rozliczenia, SUMY do panelu ---
  let bat  = Math.min(socIn||0, CAP);
  let cost = 0;

  const day = {
    use_kWh_sum: 0,
    sum_PV: 0,
    sum_wind: 0,
    buyOwn_kWh: 0,
    buyOwn_zl_cash: 0,
    buyOwn_zl_fromDeposit: 0,
    buyOwn_zl_total: 0,
    buyBank_kWh: 0,
    buyBank_zl_cash: 0,
    buyBank_zl_fromDeposit: 0,
    buyBank_zl_total: 0,
    soldImmediate_kWh: 0,
    soldImmediate_zl: 0,
    soldBank_kWh: 0,
    soldBank_zl: 0
  };

function payWithDeposit(kWh, h){
  // koszt kupna zawsze pełną ceną: energia (depozyt może pokryć) + dystrybucja (zawsze gotówka)
  const energyCost = kWh * h.eBuy;   // tylko to może „zejść” z depozytu
  let used = 0;
  if (typeof deposit !== 'undefined' && deposit > 0){
    used = Math.min(deposit, energyCost);
    deposit -= used;
  }
  const payEnergy = energyCost - used;   // część energii płacona gotówką
  const payDist   = kWh * h.dBuy;        // dystrybucja zawsze gotówką
  const total     = payEnergy + payDist;

  cost += total;

  return {
    used_deposit:    used,       // ile z depozytu poszło na ENERGIĘ
    pay_energy_cash: payEnergy,  // ile za ENERGIĘ zapłacono z kieszeni
    pay_dist_cash:   payDist,    // ile za DYSTRYBUCJĘ zapłacono z kieszeni
    total
  };
}

  if (replayActualFlows && actualDay && actualDay.isComplete) {
    if (doLog && !Array.isArray(window.traceRows)) window.traceRows = [];

    for (let t=0;t<24;t++){
      const h = H[t];
      const sellPrice = financialSellIdx(t);
      const buyTotal = Math.max(0, Number(h.actualBuyKWh) || 0);
      const buyBank = Math.min(buyTotal, Math.max(0, Number(h.actualBuyBankKWh) || 0));
      const buyOwn = Math.max(0, buyTotal - buyBank);
      const soldTotal = Math.max(0, Number(h.actualSellKWh) || 0);
      const soldBank = Math.min(soldTotal, Math.max(0, Number(h.actualSoldBankKWh) || 0));
      const soldImmediate = Math.max(0, soldTotal - soldBank);

      day.use_kWh_sum += h.use_kWh;
      day.sum_PV      += h.pv_kWh;
      day.sum_wind    += h.wind_kWh;

      if (soldTotal > 0) {
        if (typeof deposit !== 'undefined') deposit += soldTotal * sellPrice;
        h.sold_kWh = soldTotal;
        h.soldImmediate_kWh = soldImmediate;
        h.soldBank_kWh = soldBank;
        day.soldImmediate_kWh += soldImmediate;
        day.soldImmediate_zl  += soldImmediate * sellPrice;
        day.soldBank_kWh      += soldBank;
        day.soldBank_zl       += soldBank * sellPrice;
        registerGreenSale(soldTotal);
      }

      if (buyOwn > 0) {
        h.buy_kWh = buyOwn;
        const paid = payWithDeposit(buyOwn, h);
        h.buyOwn_zl_fromDeposit = (h.buyOwn_zl_fromDeposit || 0) + paid.used_deposit;
        h.buyOwn_zl_cash = (h.buyOwn_zl_cash || 0) + paid.pay_energy_cash + paid.pay_dist_cash;
        day.buyOwn_kWh += buyOwn;
        day.buyOwn_zl_fromDeposit += paid.used_deposit;
        day.buyOwn_zl_cash += (paid.pay_energy_cash + paid.pay_dist_cash);
        day.buyOwn_zl_total += buyOwn * h.financialBuy;
      }

      if (buyBank > 0) {
        h.topup_kWh = buyBank;
        const paid = payWithDeposit(buyBank, h);
        h.buyBank_zl_fromDeposit = (h.buyBank_zl_fromDeposit || 0) + paid.used_deposit;
        h.buyBank_zl_cash = (h.buyBank_zl_cash || 0) + paid.pay_energy_cash + paid.pay_dist_cash;
        day.buyBank_kWh += buyBank;
        day.buyBank_zl_fromDeposit += paid.used_deposit;
        day.buyBank_zl_cash += (paid.pay_energy_cash + paid.pay_dist_cash);
        day.buyBank_zl_total += buyBank * h.financialBuy;
      }

      h.bat_after = h.actualBatteryKWh != null && Number.isFinite(h.actualBatteryKWh)
        ? h.actualBatteryKWh
        : (actualDay.socOut != null && Number.isFinite(actualDay.socOut) ? actualDay.socOut : (socIn || 0));

      if (doLog){
        window.traceRows.push({
          data: h.ts,
          rce_zl_kWh: R3(h.rce),
          use_kWh:  R3(h.use_kWh),
          pv_kWh:   R3(h.pv_kWh),
          wind_kWh: R3(h.wind_kWh),
          gen_kWh:  R3(h.gen_kWh),
          store_kWh: R3(h.store_kWh || 0),
          dis_kWh: R3(h.dis_kWh || 0),
          battery_kWh: R3(h.bat_after),
          priceBuy:  R3(h.financialBuy),
          priceSell: R3(Math.max(0, h.sell)),
          buy_kWh:  R3(buyTotal),
          topup_kWh: R3(buyBank),
          buyOwn_kWh: R3(buyOwn),
          buyBank_kWh: R3(buyBank),
          buyOwn_zl_total: R3(buyOwn * h.financialBuy),
          buyBank_zl_total: R3(buyBank * h.financialBuy),
          buyOwn_zl_fromDeposit: R3(h.buyOwn_zl_fromDeposit || 0),
          buyBank_zl_fromDeposit: R3(h.buyBank_zl_fromDeposit || 0),
          buyOwn_zl_cash: R3(h.buyOwn_zl_cash || 0),
          buyBank_zl_cash: R3(h.buyBank_zl_cash || 0),
          sold_kWh: R3(soldTotal),
          soldImmediate_kWh: R3(soldImmediate),
          soldBank_kWh: R3(soldBank),
          soldImmediate_zl: R3(soldImmediate * sellPrice),
          soldBank_zl: R3(soldBank * sellPrice),
          deposit_zl: R3(typeof deposit !== 'undefined' ? deposit : 0),
          source: 'actual'
        });
      }
    }

    if (doLog && !(typeof window !== 'undefined' && window.__reBatchSimulation)) {
      updateDayPanel && updateDayPanel(buildDayForPanelFromTrace(window.traceRows));
    }

    return {
      cost,
      socOut: actualDay.socOut != null && Number.isFinite(actualDay.socOut) ? actualDay.socOut : (socIn || 0),
      day,
      plan: { actual: true }
    };
  }


  if (doLog && !Array.isArray(window.traceRows)) window.traceRows = [];

  // --- 5) Godzina po godzinie ---
  for (let t=0;t<24;t++){
    const h = H[t];
    const measuredHour = actualDay && actualDay.hours ? actualDay.hours[t] : null;
    if (replayActualFlows && measuredHour && measuredHour.hasUse) {
      const sellPrice = financialSellIdx(t);
      const buyTotal = Math.max(0, Number(h.actualBuyKWh) || 0);
      const buyBank = Math.min(buyTotal, Math.max(0, Number(h.actualBuyBankKWh) || 0));
      const buyOwn = Math.max(0, buyTotal - buyBank);
      const soldTotal = Math.max(0, Number(h.actualSellKWh) || 0);
      const soldBank = Math.min(soldTotal, Math.max(0, Number(h.actualSoldBankKWh) || 0));
      const soldImmediate = Math.max(0, soldTotal - soldBank);

      day.use_kWh_sum += h.use_kWh;
      day.sum_PV += h.pv_kWh;
      day.sum_wind += h.wind_kWh;

      if (soldTotal > 0) {
        if (typeof deposit !== 'undefined') deposit += soldTotal * sellPrice;
        h.sold_kWh = soldTotal;
        h.soldImmediate_kWh = soldImmediate;
        h.soldBank_kWh = soldBank;
        day.soldImmediate_kWh += soldImmediate;
        day.soldImmediate_zl += soldImmediate * sellPrice;
        day.soldBank_kWh += soldBank;
        day.soldBank_zl += soldBank * sellPrice;
        registerGreenSale(soldTotal);
      }

      if (buyOwn > 0) {
        h.buy_kWh = buyOwn;
        const paid = payWithDeposit(buyOwn, h);
        h.buyOwn_zl_fromDeposit = paid.used_deposit;
        h.buyOwn_zl_cash = paid.pay_energy_cash + paid.pay_dist_cash;
        day.buyOwn_kWh += buyOwn;
        day.buyOwn_zl_fromDeposit += paid.used_deposit;
        day.buyOwn_zl_cash += paid.pay_energy_cash + paid.pay_dist_cash;
        day.buyOwn_zl_total += buyOwn * h.financialBuy;
      }

      if (buyBank > 0) {
        h.topup_kWh = buyBank;
        const paid = payWithDeposit(buyBank, h);
        h.buyBank_zl_fromDeposit = paid.used_deposit;
        h.buyBank_zl_cash = paid.pay_energy_cash + paid.pay_dist_cash;
        day.buyBank_kWh += buyBank;
        day.buyBank_zl_fromDeposit += paid.used_deposit;
        day.buyBank_zl_cash += paid.pay_energy_cash + paid.pay_dist_cash;
        day.buyBank_zl_total += buyBank * h.financialBuy;
      }

      if (h.actualBatteryKWh != null && Number.isFinite(h.actualBatteryKWh)) {
        bat = Math.min(CAP, Math.max(0, h.actualBatteryKWh));
      }
      h.bat_after = bat;

      if (doLog) {
        window.traceRows.push({
          data: h.ts,
          rce_zl_kWh: R3(h.rce),
          use_kWh: R3(h.use_kWh),
          pv_kWh: R3(h.pv_kWh),
          wind_kWh: R3(h.wind_kWh),
          gen_kWh: R3(h.gen_kWh),
          store_kWh: 0,
          dis_kWh: 0,
          battery_kWh: R3(h.bat_after),
          priceBuy: R3(h.financialBuy),
          priceSell: R3(Math.max(0, h.sell)),
          buy_kWh: R3(buyTotal),
          topup_kWh: R3(buyBank),
          buyOwn_kWh: R3(buyOwn),
          buyBank_kWh: R3(buyBank),
          buyOwn_zl_total: R3(buyOwn * h.financialBuy),
          buyBank_zl_total: R3(buyBank * h.financialBuy),
          buyOwn_zl_fromDeposit: R3(h.buyOwn_zl_fromDeposit || 0),
          buyBank_zl_fromDeposit: R3(h.buyBank_zl_fromDeposit || 0),
          buyOwn_zl_cash: R3(h.buyOwn_zl_cash || 0),
          buyBank_zl_cash: R3(h.buyBank_zl_cash || 0),
          sold_kWh: R3(soldTotal),
          soldImmediate_kWh: R3(soldImmediate),
          soldBank_kWh: R3(soldBank),
          soldImmediate_zl: R3(soldImmediate * sellPrice),
          soldBank_zl: R3(soldBank * sellPrice),
          deposit_zl: R3(typeof deposit !== 'undefined' ? deposit : 0),
          source: 'actual'
        });
      }
      continue;
    }
    const isBuySupportHour = buySupportSet.has(t);
    const mediumBridgeBlock = mediumBridgeBlockForHour(t);
    const isMediumBridgeHour = !!mediumBridgeBlock;
    const isTopupOpportunityHour = isBuySupportHour || isMediumBridgeHour;

    // log (nagłówek rekordu)
    let rec = null;
    if (doLog){
      rec = {
        data: h.ts,
		rce_zl_kWh: R3(h.rce),
        use_kWh:  R3(h.use_kWh),
        pv_kWh:   R3(h.pv_kWh),
        wind_kWh: R3(h.wind_kWh),
        gen_kWh:  R3(h.gen_kWh),
        store_kWh: 0,
        dis_kWh: 0,
        battery_kWh: 0,
        priceBuy:  R3(h.financialBuy),
        priceSell: R3(Math.max(0, h.sell)),
        buy_kWh:  0,
        sold_kWh: 0
      };
    }

    // — sumy stałe z tej godziny —
    day.use_kWh_sum += h.use_kWh;
    day.sum_PV      += h.pv_kWh;
    day.sum_wind    += h.wind_kWh;

    // 1) Generacja -> dom
    let need = h.use_kWh;
    const useGen = Math.min(need, h.gen_kWh);
    need -= useGen;
    let surplus = h.gen_kWh - useGen;

    // nadwyżka -> bank; reszta sprzedaj natychmiast (Immediate) po aktywnej cenie sprzedaży
    if (surplus > 0){
      const space = Math.max(0, CAP - bat);
      const store = Math.min(space, surplus);
      if (store > 0){ bat += store; h.store_kWh += store; surplus -= store; }
    }
    if (surplus > 0){
      const priceNow = priceSellIdx(t);

      // ile jeszcze rocznie możemy sprzedać jako „zielonej” energii
      let sellable = surplus;
      const quota = remainingGreenQuotaKWh();
      if (Number.isFinite(quota)) {
        sellable = Math.min(sellable, quota);
      }

      if (sellable > 0){
        if (typeof deposit !== 'undefined') deposit += sellable * financialSellIdx(t);
        h.sold_kWh           += sellable;
        h.soldImmediate_kWh  += sellable;
        day.soldImmediate_kWh += sellable;
        day.soldImmediate_zl  += sellable * financialSellIdx(t);
        registerGreenSale(sellable);
      }

      // nadwyżka ponad roczny limit nie jest sprzedawana (spięcie / ucięta)
      surplus = 0;
    }


    // 2) pokryj z banku (na potrzeby)
    if (need > 0 && bat > 0 && !isTopupOpportunityHour){
      const take = Math.min(need, bat*ETA);
      if (take > 0){
        h.dis_kWh = take;
        bat -= (take/ETA);
        need -= take;
      }
    }

    sellMorningPvOverflow(t, h);

    // 3) SPRZEDAŻ z banku - normalnie dwie najdroższe godziny; przy dużym spreadzie mocniejsza sprzedaż
    const inSellA = (plan.doSellA && (t === (plan.sellPairA?.[0]) || t === (plan.sellPairA?.[1])));
    const inSellB = (plan.doSellB && (t === (plan.sellPairB?.[0]) || t === (plan.sellPairB?.[1])));
    const inOpportunitySell = opportunitySellSet.has(t);
    const isPlannedSell = inSellA || inSellB || inOpportunitySell;

    if (isPlannedSell && bat*ETA > 0){
      const pair = inSellA ? plan.sellPairA : plan.sellPairB; // [earlier, later]
      const earlier = pair[0], later = pair[1] ?? pair[0];
      const isEarlierNow = (t === earlier);

      const priceEarlier = priceSellIdx(earlier);
      const priceLater   = priceSellIdx(later);
      const priceNow     = priceSellIdx(t);

      const minSOC_now = inOpportunitySell ? RESERVE : minSOCAfterSellAt(t);
      const available_now = Math.max(0, (bat - minSOC_now) * ETA);

      let give = 0;
      if (!inOpportunitySell && isEarlierNow && later !== earlier && priceLater > priceEarlier){
        // wcześniejsza tańsza → zostaw, by w późniejszej sprzedać CHUNK
        const needToLater  = needDef(t+1, later);
        const minSOC_later = minSOCAfterSellAt(later);
        const requiredSOC_beforeLater = (needToLater/ETA) + (minSOC_later + CHUNK/ETA);
        const maxEarlySellToKeepLaterChunk = Math.max(0, (bat - requiredSOC_beforeLater) * ETA);
        give = Math.min(CHUNK, available_now, maxEarlySellToKeepLaterChunk);
      } else {
        // wcześniejsza ≥ późniejszej lub to późniejsza → sprzedaj ile się da (do CHUNK)
        give = Math.min(CHUNK, available_now);
      }

      if (give > 0){
        // roczny limit: nie sprzedajemy więcej niż całkowita produkcja PV+wiatr
        let sellable = give;
        const quota = remainingGreenQuotaKWh();
        if (Number.isFinite(quota)) {
          sellable = Math.min(sellable, quota);
        }

        if (sellable > 0){
          bat -= sellable/ETA;
          if (typeof deposit !== 'undefined') deposit += sellable * financialSellIdx(t);  // wpływ = aktywna cena sprzedaży
          h.sold_kWh       += sellable;
          h.soldBank_kWh   += sellable;
          day.soldBank_kWh += sellable;
          day.soldBank_zl  += sellable * financialSellIdx(t);
          registerGreenSale(sellable);
        }
        // jeśli sellable < give → nadwyżka zostaje w magazynie
      }

    }

    // 4) zakup na bieżący brak (pełna cena)
    if (need > 0){
      const qty = need;
      h.buy_kWh += qty;
      const p = payWithDeposit(qty, h);

      day.buyOwn_kWh += qty;
      day.buyOwn_zl_fromDeposit += p.used_deposit;
      day.buyOwn_zl_cash        += (p.pay_energy_cash + p.pay_dist_cash);
      day.buyOwn_zl_total       += qty * h.financialBuy;
      h.buyOwn_zl_fromDeposit = (h.buyOwn_zl_fromDeposit || 0) + p.used_deposit;
      h.buyOwn_zl_cash = (h.buyOwn_zl_cash || 0) + p.pay_energy_cash + p.pay_dist_cash;
      need = 0;
    }

    // 5) ZAKUP „do banku” - tylko tyle, aby wystarczyło do najbliższego PV
    //    albo do kolejnej godziny wsparcia. Dla taryf niedynamicznych może to być następna doba.
    if (t < 24 && isTopupOpportunityHour){
      const target = Math.max(
        isBuySupportHour ? targetSOCForSupportAt(t) : 0,
        isMediumBridgeHour ? targetSOCForMediumBridgeAt(t) : 0
      );
      const isEarlyCheapBlockHour = !isDynamicBuyTariff() && isBuySupportHour && t < endOfBuySupportBlock(t);
      const targetCap = isEarlyCheapBlockHour ? CAP * 0.90 : CAP;
      const cappedTarget = Math.min(target, targetCap);
      const qty = Math.min(CHUNK, Math.max(0, targetCap - bat), Math.max(0, cappedTarget - bat));
      if (qty > 0){
        const p = payWithDeposit(qty, h);
        h.topup_kWh += qty;
        bat += qty;

        day.buyBank_kWh += qty;
        day.buyBank_zl_fromDeposit += p.used_deposit;
        day.buyBank_zl_cash        += (p.pay_energy_cash + p.pay_dist_cash);
        day.buyBank_zl_total       += qty * h.financialBuy;
        h.buyBank_zl_fromDeposit = (h.buyBank_zl_fromDeposit || 0) + p.used_deposit;
        h.buyBank_zl_cash = (h.buyBank_zl_cash || 0) + p.pay_energy_cash + p.pay_dist_cash;
      }
    }

    h.bat_after = bat;

    if (doLog){
      const sellPrice = financialSellIdx(t);
      rec.buy_kWh     = R3(h.buy_kWh + h.topup_kWh);
      rec.topup_kWh   = R3(h.topup_kWh);
      rec.buyOwn_kWh  = R3(h.buy_kWh);
      rec.buyBank_kWh = R3(h.topup_kWh);
      rec.buyOwn_zl_total  = R3(h.buy_kWh * h.financialBuy);
      rec.buyBank_zl_total = R3(h.topup_kWh * h.financialBuy);
      rec.buyOwn_zl_fromDeposit = R3(h.buyOwn_zl_fromDeposit || 0);
      rec.buyBank_zl_fromDeposit = R3(h.buyBank_zl_fromDeposit || 0);
      rec.buyOwn_zl_cash = R3(h.buyOwn_zl_cash || 0);
      rec.buyBank_zl_cash = R3(h.buyBank_zl_cash || 0);
      rec.sold_kWh    = R3(h.sold_kWh);
      rec.soldImmediate_kWh = R3(h.soldImmediate_kWh);
      rec.soldBank_kWh      = R3(h.soldBank_kWh);
      rec.soldImmediate_zl  = R3(h.soldImmediate_kWh * sellPrice);
      rec.soldBank_zl       = R3(h.soldBank_kWh * sellPrice);
      rec.store_kWh = R3(h.store_kWh || 0);
      rec.dis_kWh = R3(h.dis_kWh || 0);
      rec.battery_kWh = R3(h.bat_after);
      rec.deposit_zl = R3(typeof deposit !== 'undefined' ? deposit : 0);
      window.traceRows.push(rec);
      if (!(typeof window !== 'undefined' && window.__reBatchSimulation)) {
        updateDayPanel && updateDayPanel(buildDayForPanelFromTrace(window.traceRows));
      }
    }
  }

  // 6) wynik
  return { cost, socOut: bat, day, plan };
}

function runDashboardReHybridForecast(options){
  if (typeof window.simulateYearBankPVWindSell !== 'function') {
    throw new Error('Silnik prognozy Re nie jest gotowy.');
  }

  const savedDeposit = deposit;
  const savedTraceRows = window.traceRows;
  const savedGreenGen = window._greenYearGenKWh;
  const savedGreenSold = window._greenYearSoldKWh;
  const savedBatch = window.__reBatchSimulation;
  const savedHybrid = window.__dashboardReHybridForecastBatch;

  try {
    window.__reBatchSimulation = true;
    window.__dashboardReHybridForecastBatch = true;
    return window.simulateYearBankPVWindSell(options || {});
  } finally {
    deposit = savedDeposit;
    window.traceRows = savedTraceRows;
    window._greenYearGenKWh = savedGreenGen;
    window._greenYearSoldKWh = savedGreenSold;
    window.__reBatchSimulation = savedBatch;
    window.__dashboardReHybridForecastBatch = savedHybrid;
  }
}

window.runDashboardReHybridForecast = runDashboardReHybridForecast;


function indexRceByDay(data){
  const map = new Map();
  if (!Array.isArray(data)) return map;

  for (const r of data){
    // Obsłuż oba formaty: [date, priceMWh] albo [id, date, priceMWh]
    const stamp = String((r[1] && isNaN(r[1])) ? r[1] : r[0] || '');
    if (!/^\d{4}-\d{2}-\d{2} /.test(stamp)) continue;

    const day  = stamp.slice(0,10);               // 'YYYY-MM-DD'
    const hour = parseInt(stamp.slice(11,13),10); // 0..23
    if (hour < 0 || hour > 23) continue;

    const priceMWh = Number((r.length >= 3 ? r[2] : r[1]) || 0);
    const priceKWh = priceMWh / 1000;

    if (!map.has(day)) map.set(day, Array(24).fill(null));
    map.get(day)[hour] = priceKWh;
  }
  return map;
}

// format 'YYYY-MM-DD' w CZASIE LOKALNYM (bez UTC!)
function fmtDayLocal(y, m0, d){
  const mm = String(m0+1).padStart(2,'0');
  const dd = String(d).padStart(2,'0');
  return `${y}-${mm}-${dd}`;
}

function publishDashboardReYearTotals(totG11, totOpt, depositValue, endDate){
  const oldBill = Number(totG11);
  const reBalance = Number(totOpt);
  const depositPln = Number(depositValue);
  const newBill = Number.isFinite(reBalance) ? Math.max(reBalance, 0) : null;
  const savings = Number.isFinite(oldBill) && newBill != null
    ? Math.max(oldBill - newBill, 0)
    : null;

  const totals = {
    source: 're',
    range: 'year',
    currentTotal: Number.isFinite(oldBill) ? oldBill : null,
    nextTotal: newBill,
    savingsPln: savings,
    reBalancePln: Number.isFinite(reBalance) ? reBalance : null,
    depositPln: Number.isFinite(depositPln) ? depositPln : null,
    endDateKey: endDate ? fmtDayLocal(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()) : ''
  };

  window.dashboardReYearTotals = totals;
  document.dispatchEvent(new CustomEvent('dashboard:re-year-totals-updated', { detail: totals }));
}


/********************************************************************
 * 7 ▪  pełna symulacja  (obsługuje G11, G12, Dynamiczną)
 *******************************************************************/
function calc() {
	
   if (typeof window !== 'undefined' && window.HEADLESS === true) return;
  applyFixedEnergyOptions();

  /* ── dane wejściowe ─────────────────────────────────────────── */
  const spanDays = parseInt(slider.value, 10) + 1;        // suwak
  const annualK  = getAnnualUsageKWh();                   // kWh/rok
  const osd      = provider.selectedIndex;                // ENEA=0…
  const kWp      = (parseFloat(pvInp.value) || 0) / 1000; // moc PV kWp
  deposit = getReInitialDepositPln();

  // reset rocznego salda prosumenckiego
  window._greenYearGenKWh  = 0;
  window._greenYearSoldKWh = 0;
  
  /* ── wyzeruj widoki ─────────────────────────────────────────── */
  mini.innerHTML = '';
  main.innerHTML = '';
  resetTrace(); 
  window.traceRows = []; 
  /* ── liczniki i kursory ─────────────────────────────────────── */
  let totG11 = 0, totOpt = 0;
  let soc    = 0;                 // stan magazynu przenoszony między dobami
  let rdPtr  = 0;                 // wskaźnik na blok 24 h w tablicy RCE
  let off    = 0;                 // przesunięcie godzin w tablicy PV
  let left   = spanDays;
  let cur    = new Date(START);
  let fixedUsageYear = null;
  let cumulativeYearUsageKWh = 0;
  
  const rceSource = window.rce;
  const RCE_BY_DAY = indexRceByDay(rceSource);
/* wybierz funkcję kosztu dla jednej doby */
  const fn = costBankPVWindSell;

    // >>> nowość: globalny indeks dnia, żeby wiedzieć, który jest „ostatni”
    let dayIdxGlobal = 0;
  
  /* ── pętla po miesiącach ─────────────────────────────────────── */
  while (left > 0) {
    const m   = cur.getMonth();
    const dim = new Date(cur.getFullYear(), m + 1, 0).getDate();
    const span = Math.min(left, dim - cur.getDate() + 1);
	const price_g11 = window.oldKosztKWh;
	const monthUsageKWh = sumUsageForSpan(cur, span, annualK, { kWp, pvOffset: off });
	if (fixedUsageYear !== cur.getFullYear()) {
	  fixedUsageYear = cur.getFullYear();
	  cumulativeYearUsageKWh = 0;
	}
	const fullMonthUsageKWh = sumUsageForSpan(new Date(cur.getFullYear(), m, 1), dim, annualK, { kWp });
	cumulativeYearUsageKWh += fullMonthUsageKWh;
	const monthFraction = span / dim;
	const oldMonthFixed = calcTariffFixedMonthly(window.oldFixedRows, { annualUsageKWh: cumulativeYearUsageKWh });
	const newMonthFixed = calcTariffFixedMonthly(window.selFixedRows, { annualUsageKWh: cumulativeYearUsageKWh });
	let base = monthUsageKWh * price_g11;

	if (cAddMonth.checked)
		base += oldMonthFixed * monthFraction;

	if (window.reClientTariffHistory?.strict) {
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
	totG11 += base;
		
	mini.insertAdjacentHTML(
	  'beforeend',
  '<li>' + M[m] + ': <strong>' + base.toFixed(2) + ' zł</strong></li>'
	);

    /* koszt zoptymalizowany */
	window.traceRows = [];	
    let monthCost = 0;
	
    for (let d = 0; d < span; d++, off += 24) {
	  const dayDate = new Date(cur.getFullYear(), m, cur.getDate() + d, 0, 0, 0, 0);
	  const hourK = buildHourlyUseForDay(dayDate, annualK, USE24, { kWp, pvOffset: off });
	  
	  const dayStr = fmtDayLocal(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate());
      const rceDay = RCE_BY_DAY.get(dayStr) || null; // [24] zł/kWh lub null	  
	  
	  const baseMs = dayDate.getTime();

      const doLog = (1 === left-d );
	  
	  const { cost, socOut, day } = fn(hourK, soc, kWp, off, baseMs, doLog);
    
//monthCost += cost;
      // Teraz liczmy miesięczny rachunek jako realny wydatek z kieszeni:
      // tylko gotówkowa część zakupów (energia + dystrybucja),
      // bez odejmowania sprzedaży (ta trafia na depozyt).
      monthCost += (day.buyOwn_zl_cash + day.buyBank_zl_cash);

      if (socOut !== undefined) soc = socOut;

    }

	if (cAddMonth.checked)
		monthCost += newMonthFixed * monthFraction;
	
    totOpt += monthCost;
	let monthdraw=monthCost;
	if (monthCost<0) {
		monthdraw=0;
		if (cAddMonth.checked)
			monthdraw += newMonthFixed * monthFraction;
	}
    main.insertAdjacentHTML(
      'beforeend',
      `<li class="mb-1">${M[m]}: <strong>${monthdraw.toFixed(2)} zł</strong></li>`
    );


    /* kolejny miesiąc */
    left -= span;
    cur.setMonth(m + 1, 1);
  }
  
  // ► Wypchnij ostatnią dobę do globali dla tabeli/wykresu
  const selectedDate = addDays(START, Number(slider.value)); // jak ustalacie „dzień z suwaka”
  publishHourSeriesFromTrace(selectedDate);

  /* ── sumy roczne ─────────────────────────────────────────────── */
  zg11sum = totG11.toFixed(2);
  g11E.textContent = totG11.toFixed(2) + ' zł';
  if (totOpt<0)
	  totOpt=0;
  rvE .textContent = totOpt.toFixed(2) + ' zł';
  depositSum.textContent = deposit.toFixed(2) + ' zł';
  depositSumPrc.textContent = (deposit * 0.3).toFixed(2) + ' zł';
  zdepositSumAll=totOpt.toFixed(2);
  clearReDepositCoverageCache();
  depositSumAll.textContent = totOpt.toFixed(2) + ' zł';
  saveE.textContent = Math.max(totG11 - totOpt, 0).toFixed(2) + ' zł';
  publishDashboardReYearTotals(totG11, totOpt, deposit, selectedDate);
}


/********************************************************************
 * 9 ▪  init & listeners
 *******************************************************************/
function clearReDepositCoverageCache(){
  reDepositCoverageCache = null;
  reUsageForecastSummaryCache = null;
}

function reLocalDateFromKey(dateKey){
  const parts = String(dateKey || '').slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some(value => !Number.isFinite(value))) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
}

function reDateKeyFromLocalDate(date){
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function reDaysBetweenKeys(fromKey, toKey){
  const from = reLocalDateFromKey(fromKey);
  const to = reLocalDateFromKey(toKey);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function getReActualCoverageVersionKey(){
  const map = window.reActualHourlyByDay;
  if (!map || typeof map.keys !== 'function') return 'actual:0';
  const keys = Array.from(map.keys()).sort();
  return `actual:${keys.length}:${keys[0] || ''}:${keys[keys.length - 1] || ''}`;
}

function getReDepositCoverageCacheKey(maxDays){
  return [
    START,
    Math.round(Number(maxDays) || 0),
    Math.round(Number(getAnnualUsageKWh()) || 0),
    String(pvInp && pvInp.value || ''),
    String(bankV && bankV.value || ''),
    String(provider && provider.value || provider && provider.selectedIndex || ''),
    String(tariff && tariff.value || tariff && tariff.selectedIndex || ''),
    String(tariffLon && tariffLon.value || ''),
    chkPV && chkPV.checked ? 'pv1' : 'pv0',
    chkBank && chkBank.checked ? 'bank1' : 'bank0',
    chkSell && chkSell.checked ? 'sell1' : 'sell0',
    chkRcem && chkRcem.checked ? 'rcem1' : 'rcem0',
    getReActualCoverageVersionKey()
  ].join('|');
}

function computeReDepositCoverage(options = {}){
  if (typeof costBankPVWindSell !== 'function') return null;

  const sliderMaxDays = slider ? (parseInt(slider.max, 10) + 1) : 0;
  const requestedMaxDays = Number(options.maxDays);
  const anchorKey = String(options.anchorDateKey || '').slice(0, 10);
  const initialDepositPln = Number(options.initialDepositPln);
  const maxDays = Math.max(1, Math.min(730, Math.round(
    Number.isFinite(requestedMaxDays) && requestedMaxDays > 0
      ? requestedMaxDays
      : Math.max(365, sliderMaxDays || 0)
  )));
  const cacheKey = getReDepositCoverageCacheKey(maxDays) + '|anchor:' + anchorKey + '|deposit:' + (
    Number.isFinite(initialDepositPln) ? initialDepositPln.toFixed(2) : ''
  );
  if (reDepositCoverageCache && reDepositCoverageCache.key === cacheKey) {
    return reDepositCoverageCache.result;
  }

  const savedDeposit = deposit;
  const savedTraceRows = window.traceRows;
  const savedGreenGen = window._greenYearGenKWh;
  const savedGreenSold = window._greenYearSoldKWh;

  let result = {
    zeroDateKey: '',
    zeroIndex: null,
    lastDateKey: '',
    lastDepositPln: null,
    maxDays
  };

  try {
    applyFixedEnergyOptions();
    deposit = Number.isFinite(initialDepositPln) ? Math.max(0, initialDepositPln) : 0;
    window._greenYearGenKWh = 0;
    window._greenYearSoldKWh = 0;

    const annualK = getAnnualUsageKWh();
    const kWp = (parseFloat(pvInp && pvInp.value) || 0) / 1000;
    let soc = 0;
    const start = reLocalDateFromKey(anchorKey) || reLocalDateFromKey(START) || new Date(START);
    const startOffsetDays = Math.max(0, reDaysBetweenKeys(START, reDateKeyFromLocalDate(start)) || 0);
    let off = startOffsetDays * 24;
    let seenPositiveDeposit = deposit > 0.005;

    for (let d = 0; d < maxDays; d++, off += 24) {
      const dayDate = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d, 0, 0, 0, 0);
      const dayKey = reDateKeyFromLocalDate(dayDate);
      const hourK = buildHourlyUseForDay(dayDate, annualK, USE24, { kWp, pvOffset: off });
      const { socOut } = costBankPVWindSell(hourK, soc, kWp, off, dayDate.getTime(), false);

      if (typeof socOut === 'number') soc = socOut;

      const currentDeposit = Number(deposit || 0);
      result.lastDateKey = dayKey;
      result.lastDepositPln = currentDeposit;

      if (currentDeposit > 0.005) {
        seenPositiveDeposit = true;
      } else if (seenPositiveDeposit) {
        result.zeroDateKey = dayKey;
        result.zeroIndex = d;
        break;
      }
    }
  } finally {
    deposit = savedDeposit;
    window.traceRows = savedTraceRows;
    window._greenYearGenKWh = savedGreenGen;
    window._greenYearSoldKWh = savedGreenSold;
  }

  reDepositCoverageCache = { key: cacheKey, result };
  return result;
}

function getReDepositCoverageDays(anchorDateKey, options = {}){
  const coverage = computeReDepositCoverage(Object.assign({}, options, {
    anchorDateKey: anchorDateKey
  }));
  if (!coverage || !coverage.zeroDateKey) return null;

  const anchorKey = String(anchorDateKey || '').slice(0, 10) || reDateKeyFromLocalDate(new Date());
  const days = reDaysBetweenKeys(anchorKey, coverage.zeroDateKey);
  return days == null ? null : Math.max(0, days);
}

window.clearReDepositCoverageCache = clearReDepositCoverageCache;
window.computeReDepositCoverage = computeReDepositCoverage;
window.getReDepositCoverageDays = getReDepositCoverageDays;

function upd(){
  const d = addDays(START, Number(slider.value));
  dateLbl.textContent = d.toLocaleDateString('pl-PL');

  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd= String(d.getDate()).padStart(2,'0');
  const dateStr = `${y}-${m}-${dd}`;

  if (typeof drawRceChart === 'function') drawRceChart(dateStr);
}


//slider.addEventListener('input', ()=>{ upd(); calc(); });

function init(){
  updateIcons(); initUsageProfilePanel(); upd();
  slider.addEventListener('input',()=>{upd();calc();});
  pvInp?.addEventListener('input', () => {
    recalculateUsageProfile();
    calc();
  });
  usage?.addEventListener('input', async ()=>{
    if (!normalizeMonthlyUsageProfile(usageMonthlyProfileKWh)) {
      renderUsageProfilePanel();
    }
    await refreshTariffDerivedState().catch(console.error);
  });
  [tariffLon,chkBank,chkPV,chkSell,chkRcem,chkWind,bankV,windV,cAddMonth]
  .filter(Boolean)
  .forEach(e=>e.addEventListener('change',()=>{
    applyFixedEnergyOptions();
    updateIcons();
    if (e === chkRcem && typeof window.applyEffectiveRce === 'function') {
      window.applyEffectiveRce();
    }
    calc();
  }));
  contractPowerKw?.addEventListener('input', async ()=>{
    await refreshTariffDerivedState().catch(console.error);
  });
  billingCycleMonths?.addEventListener('change', async ()=>{
    await refreshTariffDerivedState().catch(console.error);
  });

	provider.addEventListener('change', async () => {
	  await refreshTariffDerivedState({ reloadCurrentTariff: true });
	});

	tariff.addEventListener('change', async () => {
	  // zmiana wybranej taryfy do „optymalizacji” – „old” nadal liczymy z pierwszej taryfy tego samego segmentu
	  await refreshTariffDerivedState({ reloadCurrentTariff: true });
	});

  try {
    calc();
  } catch (error) {
    console.error(error);
    setUsageProfileStatus(error?.message || 'Błąd profilu zużycia', true);
  }
}
// init();
// HEADLESS: nie uruchamiamy init()/calc() bez UI
let reUiInitialized = false;
function startReUiWhenReady(){
  if (typeof window !== 'undefined' && window.HEADLESS === true) return;
  if (reUiInitialized) return;
  if (!(Array.isArray(window.pv) && window.pv.length)) return;
  reUiInitialized = true;
  window.__reUiInitialized = true;
  init();
}
if (!(typeof window !== 'undefined' && window.HEADLESS === true)) {
  if (window.__reInputReady) {
    startReUiWhenReady();
  } else {
    window.addEventListener('data:re-input-ready', startReUiWhenReady, { once: true });
  }
}

if (!(typeof window !== 'undefined' && window.HEADLESS === true)) {
  refreshTariffDerivedState({ reloadCurrentTariff: true }).catch(console.error);
}



// deposit *= 0.30;   // 70% przepada, 30% wypłacają


// stan globalny (bezpieczny fallback)
window.__TariffFull = null;
window.__currentTariff = null;

window.getTariffFull = () => window.__TariffFull;





async function fetchJSON(url){
	const r = await fetch(url, { credentials: 'same-origin' });
	if(!r.ok) throw new Error('HTTP '+r.status);
	const result = await r.json();
	return window.DashboardPricing ? window.DashboardPricing.projectReResponse(result, false) : result;
}


window.setCurrentTariff = function(t){
  window.__currentTariff = t;
  try { localStorage.setItem('currentTariff', JSON.stringify(t)); } catch {}
  // powiadom resztę appki (scripts.js może się podpiąć)
  window.dispatchEvent(new CustomEvent('tariff:changed', { detail: t }));
};


window.loadCurrentTariff = async function(osdId, tariffId){
  const url = `setup_func.php?act=get&osd_id=${encodeURIComponent(osdId)}&tariff_id=${encodeURIComponent(tariffId)}`;
  const r   = await fetch(url, { cache:'no-store', credentials:'same-origin' });
  const raw = await r.text();
  let j;
  try { j = JSON.parse(raw); } catch (e){ console.error('Non-JSON from act=get:', raw); throw e; }
  if (!j.ok) throw new Error(j.error || 'Błąd pobierania taryfy');
  if (window.DashboardPricing) j = window.DashboardPricing.projectReResponse(j, true);
  window.CUR_TARIFF = j.data;
  return window.CUR_TARIFF;
};


async function reloadTariffFromUI(){
  if (!provider || !tariff) return;
  const osdId    = Number(provider.value);      // <— PRAWDZIWE ID
  const tariffId = Number(tariff.value);        // <— PRAWDZIWE ID
  if (!osdId || !tariffId) return;

  const T = await window.loadCurrentTariff(osdId, tariffId);  // zwróci window.CUR_TARIFF
  updateContractPowerVisibility(T);
  updateBillingCycleVisibility(T);
  // po załadowaniu warto przebudować runtime (sekcja B poniżej)
  buildTariffRuntime(T, window.rdn, window.rce);
  return T;
}

async function refreshTariffDerivedState({ reloadCurrentTariff = false } = {}){
  if (reloadCurrentTariff) {
    await reloadTariffFromUI();
  }
  await computeOldFromFirstTariff();
  await computeSelMonthlyFromTariff();
  upd();
  if (window.__reUiInitialized) {
    calc();
  }
}
async function fetchJSONplain(url){
  const r = await fetch(url, { credentials: 'same-origin', cache:'no-store' });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t}`);
  try { const result = JSON.parse(t); return window.DashboardPricing ? window.DashboardPricing.projectReResponse(result, false) : result; } catch(e){ console.error('Bad JSON from', url, '→', t); throw e; }
}

// ── ZAWSZE bierze pierwszą taryfę dla aktualnie wybranego OSD
async function computeOldFromFirstTariff(){
  const sel = document.getElementById('providerSelect');
  const osdId = sel ? parseInt(sel.value||'0',10) : 0;
  if (!osdId) return;

  // 1) Lista taryf dla OSD
  const listResp = await fetchJSONplain(`setup_func.php?action=json_tariffs&osd=${encodeURIComponent(osdId)}`);
  if (!listResp?.ok || !Array.isArray(listResp.tariffs) || listResp.tariffs.length === 0) {
    console.warn('Brak taryf dla OSD', osdId);
    return;
  }

  // 2) Wybór PIERWSZEJ taryfy (po order/sort/id)
  const tariffs = listResp.tariffs
    .filter(t => t.active === undefined ? true : !!t.active);
  const selTariffId = parseInt(document.getElementById('tariffShort')?.value || '0', 10);
  const selectedTariffMeta = tariffs.find(t => Number(t.id) === selTariffId) || null;
  const targetSegment = String(selectedTariffMeta?.segment || 'household').toLowerCase();
  tariffs.sort((a,b)=>{
    const ka = (a.order ?? a.sort ?? a.id ?? 0);
    const kb = (b.order ?? b.sort ?? b.id ?? 0);
    return ka - kb;
  });
  const sameSegmentTariffs = tariffs.filter(t => String(t.segment || 'household').toLowerCase() === targetSegment);
  const firstTariffId = (sameSegmentTariffs[0] || tariffs[0]).id;
  window.oldTariffIdUsed = firstTariffId;

  // 3) Pobierz pełne dane taryfy z aktualnego endpointu
  const fullB = await fetchJSONplain(`setup_func.php?act=get&osd_id=${encodeURIComponent(osdId)}&tariff_id=${encodeURIComponent(firstTariffId)}`);
  const T = fullB?.ok ? fullB.data : null;
  if (!T) { console.warn('Nie udało się pobrać danych taryfy', firstTariffId); return; }

  // 4) Stałe miesięczne
  const fixedRows = Array.isArray(T.fixed) ? T.fixed : [];
  window.oldFixedRows = fixedRows;
  const oldMies = calcTariffFixedMonthly(fixedRows);

  // 5) Zmienna zł/kWh – „all” + strefa, ważone godzinami doby
  const vars = Array.isArray(T.variable) ? T.variable : [];
  const sumsByCode = vars.reduce((acc, v)=>{
    const code = String(v.window_code||'all').toLowerCase();
    const price= parseFloat(v.price)||0;
    acc[code] = (acc[code]||0) + price;
    return acc;
  }, {});
  const getSumFor = (code) => (code === 'all')
    ? (sumsByCode.all||0)
    : (sumsByCode.all||0) + (sumsByCode[code]||0);

  function hoursWeightMap(){
    const out = { all:24 };
    if (T.use_monthly && T.monthly){
      out.all = 0;
      const row = Array.isArray(T.monthly[1]) ? T.monthly[1] : null; // styczeń
      if (row && row.length === 24){
        const zm = String(T.zone_model||'all').toLowerCase();
        for (let h=0; h<24; h++){
          let code = 'all';
          if (zm==='highmidlow') code = ({1:'high',2:'mid',3:'low'})[row[h]] || 'mid';
          else if (zm==='daynight') code = ({1:'night',2:'day'})[row[h]] || 'day';
          else if (zm==='peakoffpeak') code = ({1:'offpeak',2:'peak'})[row[h]] || 'peak';
          out[code] = (out[code]||0) + 1;
        }
      }
    } else if (Array.isArray(T.windows) || Array.isArray(T.dn_night) || Array.isArray(T.po_off)) {
      out.all = 0;
      const addRange = (code, from, to)=>{
        if (from===to) { out[code]=(out[code]||0)+1; return; }
        if (from < to) for(let h=from; h<=to; h++) out[code]=(out[code]||0)+1;
        else { for(let h=from; h<24; h++) out[code]=(out[code]||0)+1; for(let h=0; h<=to; h++) out[code]=(out[code]||0)+1; }
      };
      if (Array.isArray(T.windows) && T.windows.length){
        for (const w of T.windows) addRange(String(w.code||'all').toLowerCase(), w.from_h|0, w.to_h|0);
      } else {
        if (Array.isArray(T.dn_night)){
          const nightSet = new Set(T.dn_night);
          for (let h=0; h<24; h++){
            const code = nightSet.has(h) ? 'night' : 'day';
            out[code] = (out[code]||0)+1;
          }
        }
        if (Array.isArray(T.po_off)){
          const offSet = new Set(T.po_off);
          out.day = out.night = 0;
          for (let h=0; h<24; h++){
            const code = offSet.has(h) ? 'offpeak' : 'peak';
            out[code] = (out[code]||0)+1;
          }
        }
      }
    }
    return out;
  }

  const weights = hoursWeightMap();
  const codes = Object.keys(weights).filter(k => weights[k] > 0 && (k==='all' || sumsByCode[k] || sumsByCode.all));
  let oldKwh = null;
  if (codes.length === 1 && codes[0] === 'all'){
    oldKwh = getSumFor('all');
  } else if (codes.length){
    const totalH = codes.reduce((s,k)=> s + weights[k], 0) || 24;
    let acc = 0;
    for (const k of codes){
      acc += (weights[k]/totalH) * getSumFor(k);
    }
    oldKwh = acc;
  } else {
    const present = Object.keys(sumsByCode).filter(k => k);
    if (present.length) oldKwh = present.reduce((s,k)=> s + getSumFor(k), 0) / present.length;
  }

  window.oldKosztKWh  = oldKwh ?? null;
  window.oldKosztMies = oldMies;

  console.log('[OLD] osd=', osdId, 'tariff(first)=', window.oldTariffIdUsed,
              'kWh=', window.oldKosztKWh, 'stałe=', window.oldKosztMies);
}

async function computeSelMonthlyFromTariff(){
  const osdId = parseInt(document.getElementById('providerSelect')?.value || '0', 10);
  const tariffSelect = document.getElementById('tariffShort');
  const selTariffId = parseInt(tariffSelect?.value || '0', 10);

  if (!osdId || !selTariffId) return;

  // pobierz pełne dane taryfy z aktualnego endpointu
  const fullB = await fetchJSONplain(`setup_func.php?act=get&osd_id=${encodeURIComponent(osdId)}&tariff_id=${encodeURIComponent(selTariffId)}`);
  const T = fullB?.ok ? fullB.data : null;
  if (!T) { console.warn('Nie udało się pobrać danych taryfy (wybranej):', selTariffId); return; }

  // suma kosztów stałych miesięcznych
  const fixedRows = Array.isArray(T.fixed) ? T.fixed : [];
  window.selFixedRows = fixedRows;
  window.selKosztMies = calcTariffFixedMonthly(fixedRows);
  updateContractPowerVisibility(T);
  updateBillingCycleVisibility(T);

  console.log('[SEL] tariff=', selTariffId, ' stałe=', window.selKosztMies);
}


function buildDayForPanelFromTrace(traceRows){
  const day = {
    use_kWh_sum: 0,
    sum_PV: 0,
    sum_wind: 0,

    buyOwn_kWh: 0,
    buyOwn_zl_cash: 0,
    buyOwn_zl_fromDeposit: 0,
    buyOwn_zl_total: 0,

    soldImmediate_kWh: 0,
    soldImmediate_zl: 0,

    buyBank_kWh: 0,
    buyBank_zl_cash: 0,
    buyBank_zl_fromDeposit: 0,
    buyBank_zl_total: 0,

    soldBank_kWh: 0,
    soldBank_zl: 0
  };

  if (!Array.isArray(traceRows) || traceRows.length === 0) return day;

  const num = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const hasValue = (row, key) => Object.prototype.hasOwnProperty.call(row || {}, key)
    && row[key] !== undefined
    && row[key] !== null
    && row[key] !== '';
  const pickValue = (row, keys) => {
    for (const key of keys) {
      if (hasValue(row, key)) return row[key];
    }
    return undefined;
  };

  for (const r of traceRows){
    // energia
    // U Ciebie zużycie bywa logowane jako ujemne (jak w tabeli), więc bierzemy abs
    const use = Math.abs(num(r.use_kWh));
    const pv  = num(r.pv_kWh);
    const wi  = num(r.wind_kWh);

    day.use_kWh_sum += use;
    day.sum_PV      += pv;
    day.sum_wind    += wi;

    // BUY rozdział: jeśli masz topup_kWh -> to jest kupno do banku
    const buyTotal = Math.abs(num(r.buy_kWh));
    const topup    = Math.abs(num(pickValue(r, ['buyBank_kWh', 'buy_bank_kWh', 'topup_kWh'])));

    const buyBank = Math.min(buyTotal, topup);
    const buyOwn  = hasValue(r, 'buyOwn_kWh') ? Math.abs(num(r.buyOwn_kWh)) : Math.max(0, buyTotal - buyBank);

    const pBuy = num(r.priceBuy);

    day.buyOwn_kWh += buyOwn;
    day.buyOwn_zl_cash += hasValue(r, 'buyOwn_zl_total') ? num(r.buyOwn_zl_total) : buyOwn * pBuy;
    day.buyOwn_zl_total += hasValue(r, 'buyOwn_zl_total') ? num(r.buyOwn_zl_total) : buyOwn * pBuy;

    day.buyBank_kWh += buyBank;
    day.buyBank_zl_cash += hasValue(r, 'buyBank_zl_total') ? num(r.buyBank_zl_total) : buyBank * pBuy;
    day.buyBank_zl_total += hasValue(r, 'buyBank_zl_total') ? num(r.buyBank_zl_total) : buyBank * pBuy;

    // SELL: jeśli nie sprzedajesz, to r.sold_kWh będzie 0 albo brak
    const sold = Math.abs(num(r.sold_kWh));
    const soldBank = Math.abs(num(pickValue(r, ['soldBank_kWh', 'sold_bank_kWh'])));
    const soldImmediate = hasValue(r, 'soldImmediate_kWh')
      ? Math.abs(num(r.soldImmediate_kWh))
      : Math.max(0, sold - soldBank);

    // cena sprzedaży:
    // 1) jeśli masz priceSell - użyj
    // 2) jeśli masz rce_zl_kWh - to jest już aktywna cena sprzedaży
    // 3) w przeciwnym razie 0
    let pSell = 0;
    if (r.priceSell !== undefined && r.priceSell !== '') pSell = Math.max(0, num(r.priceSell));
    else if (r.rce_zl_kWh !== undefined && r.rce_zl_kWh !== '') pSell = Math.max(0, num(r.rce_zl_kWh));

    // Na razie wszystko wrzucamy jako "sprzedaż bez banku", bo godzinowe dane zwykle nie rozdzielają:
    // - sprzedaż natychmiastowa
    // - sprzedaż z banku
    // Jeśli masz osobno pola (np. soldBank_kWh), dopasujemy.
    day.soldImmediate_kWh += soldImmediate;
    day.soldImmediate_zl  += hasValue(r, 'soldImmediate_zl') ? num(r.soldImmediate_zl) : soldImmediate * pSell;
    day.soldBank_kWh += soldBank;
    day.soldBank_zl  += hasValue(r, 'soldBank_zl') ? num(r.soldBank_zl) : soldBank * pSell;
  }

  // zaokrąglenia jak w reszcie UI
  const R3 = (typeof round3 === 'function')
    ? round3
    : (x)=> Math.round((Number(x)+Number.EPSILON)*1000)/1000;

  for (const k of Object.keys(day)) day[k] = R3(day[k]);

  return day;
}


function fmtKWh(x){ return (Number(x)||0).toFixed(2) + ' k'; }
function fmtPLN(x){ return (Number(x)||0).toFixed(2) + ' zł'; }

function byId(id){ return document.getElementById(id); }

function updateDayPanel(day){
  // Zużycie / Uzyski
  byId('day_use').textContent        = fmtKWh(day.use_kWh_sum);
  byId('day_PV').textContent         = fmtKWh(day.sum_PV);
  byId('day_wind').textContent       = fmtKWh(day.sum_wind);

  // Kupno (na potrzeby)
  byId('day_bayV').textContent       = fmtKWh(day.buyOwn_kWh);
  byId('day_bay').textContent        = fmtPLN(day.buyOwn_zl_total);

  // Sprzedaż (z nadwyżki – bez banku)
  byId('day_sellV').textContent      = fmtKWh(day.soldImmediate_kWh);
  byId('day_sell').textContent       = fmtPLN(day.soldImmediate_zl);

  // Kupno BANK
  byId('day_bank_bayV').textContent  = fmtKWh(day.buyBank_kWh);
  byId('day_bank_bay').textContent   = fmtPLN(day.buyBank_zl_total);

  // Sprzedaż BANK
  byId('day_bank_sellV').textContent = fmtKWh(day.soldBank_kWh);
  byId('day_bank_sell').textContent  = fmtPLN(day.soldBank_zl);

  byId('day_sum').textContent  = fmtPLN(day.soldBank_zl+day.soldImmediate_zl-day.buyOwn_zl_total-day.buyBank_zl_total);
}
