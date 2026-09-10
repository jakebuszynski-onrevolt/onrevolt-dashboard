/**
 * Shared RE consumption calculations, without DOM, I/O or mutable global state.
 * Browser: ReConsumptionEngine. Node: require(...).
 *
 * Day keys are local civil YYYY-MM-DD dates, never UTC-truncated Date objects.
 * Actual/forecast payload timestamps retain the legacy RE local-time semantics:
 * the host timezone must match offset-less rawEnergy.datetime (Europe/Warsaw).
 * Callers select the XLSX month/day pattern and supply PV already converted to kWh.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.ReConsumptionEngine = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Keep the original percentages, including their rounding; do not renormalize.
  const DEFAULT_HOURLY_PERCENT = Object.freeze([
    2.97, 2.89, 2.89, 2.89, 2.97, 3.4, 4.25, 5.1,
    4.67, 4.25, 4.08, 3.82, 3.82, 3.91, 3.99, 4.25,
    6.63, 6.37, 5.78, 5.1, 4.67, 4.25, 3.82, 3.23,
  ]);

  // These pure declarations are copied from the canonical RE scripts.js.
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

  function buildReActualHourlyMapFromPayload(payload){
    const cutoff = getReActualCutoff(payload);
    const map = new Map();

    function ensureDay(dateKey){
      if (!dateKey || !cutoff || dateKey > cutoff.dateKey) return null;
      if (!map.has(dateKey)) map.set(dateKey, createReActualDay(dateKey));
      return map.get(dateKey);
    }

    function canUseRecord(record){
      const dateKey = reActualDayKeyFromRecord(record);
      return !!cutoff && (dateKey === cutoff.dateKey || (dateKey < cutoff.dateKey && isCompleteReActualRecord(record)));
    }

    const usageRecords = payload && payload.usageData && Array.isArray(payload.usageData.records)
      ? payload.usageData.records
      : [];
    usageRecords.forEach(record => {
      if (!canUseRecord(record)) return;
      const dateKey = reActualDayKeyFromRecord(record);
      const day = ensureDay(dateKey);
      if (day) {
        applyReActualUsageRecord(day, trimReActualRecordToCutoff(record, cutoff));
        day.isComplete = dateKey < cutoff.dateKey && isCompleteReActualRecord(record);
      }
    });

    const pvRecords = payload && payload.pvData && Array.isArray(payload.pvData.records)
      ? payload.pvData.records
      : [];
    pvRecords.forEach(record => {
      if (!canUseRecord(record)) return;
      const day = ensureDay(reActualDayKeyFromRecord(record));
      if (day) applyReActualPvRecord(day, trimReActualRecordToCutoff(record, cutoff));
    });

    const storageRecords = payload && payload.storageData && Array.isArray(payload.storageData.records)
      ? payload.storageData.records
      : [];
    storageRecords.forEach(record => {
      if (!canUseRecord(record)) return;
      const day = ensureDay(reActualDayKeyFromRecord(record));
      if (day) applyReActualStorageRecord(day, trimReActualRecordToCutoff(record, cutoff));
    });

    for (const [dateKey, day] of Array.from(map.entries())) {
      if (!day.hasUsage) {
        map.delete(dateKey);
        continue;
      }
      day.totalUse = day.hours.reduce((sum, hour) => sum + (Number(hour.use) || 0), 0);
      day.hours.forEach(hour => {
        hour.buyBank = Math.min(Math.max(0, hour.buyBank), Math.max(0, hour.buy));
        hour.soldBank = Math.min(Math.max(0, hour.soldBank), Math.max(0, hour.sell));
      });
    }

    return map;
  }

  function buildReUsageForecastModel(payload){
    const cutoff = getReActualCutoff(payload);
    if (!cutoff) return null;
    const oldest = new Date(cutoff.dateKey + 'T12:00:00');
    oldest.setFullYear(oldest.getFullYear() - 1);
    const oldestKey = reActualDateKey(oldest);
    const rows = new Map();
    const issues = Array.isArray(payload?.dataQuality?.issues) ? payload.dataQuality.issues : [];
    for (const record of payload?.usageData?.records || []) {
      const key = reActualDayKeyFromRecord(record);
      if (key < oldestKey || key >= cutoff.dateKey) continue;
      const slots = record.quarters;
      if (!Array.isArray(slots) || ![92, 96, 100].includes(slots.length)) continue;
      if (record.measurementCoverage != null && Number(record.measurementCoverage) < 0.98) continue;
      if (record.measuredSlotCount != null && Number(record.measuredSlotCount) !== slots.length) continue;
      if (issues.some(issue => {
        const from = String(issue.from || issue.datetime || '').slice(0, 10);
        const to = String(issue.to || issue.datetime || '').slice(0, 10);
        return from && to && from <= key && to >= key;
      })) continue;
      const hours = new Array(24).fill(0);
      const timestamps = new Set();
      let end = null;
      let duration = 0;
      let valid = true;
      for (const slot of slots) {
        const use = reActualFirstNumber(slot, ['totalLoadKwh', 'load', 'usageKwh', 'usage']);
        const hour = reActualHourFromQuarter(slot);
        const startTime = Date.parse(slot.slotStart);
        const endTime = Date.parse(slot.slotEnd);
        if (use == null || use < 0 || hour == null || !Number.isFinite(startTime) ||
            endTime - startTime !== 900000 || timestamps.has(startTime) ||
            (end != null && startTime !== end) || String(slot.slotStart).slice(0, 10) !== key) {
          valid = false;
          break;
        }
        timestamps.add(startTime);
        end = endTime;
        duration += (endTime - startTime) / 3600000;
        hours[hour] += use;
      }
      if (!valid || String(slots[0].slotStart).slice(11, 16) !== '00:00' ||
          String(slots[slots.length - 1].slotEnd).slice(11, 16) !== '00:00') continue;
      // Doby zmiany czasu mają 23/25 godzin; uczony profil jest dobą 24-godzinną.
      rows.set(key, { key, month: Number(key.slice(5, 7)) - 1, hours: hours.map(v => v * 24 / duration) });
    }
    const days = Array.from(rows.values()).sort((a, b) => a.key.localeCompare(b.key));
    if (!days.length) return null;
    const recent = days.slice(-28);
    const meanHours = samples => Array.from({ length: 24 }, (_, hour) =>
      samples.reduce((sum, row) => sum + row.hours[hour], 0) / samples.length);
    const baseline = meanHours(recent);
    const monthDays = Array.from({ length: 12 }, (_, month) => days.filter(day => day.month === month));
    const monthlyHours = monthDays.map(samples => {
      // Tydzień zaczyna uczyć miesiąca, cztery tygodnie zastępują profil ogólny.
      const weight = samples.length >= 7 ? Math.min(1, samples.length / 28) : 0;
      if (!weight) return baseline.slice();
      const measured = meanHours(samples);
      return baseline.map((value, hour) => value * (1 - weight) + measured[hour] * weight);
    });
    return {
      days: days.length, recentDays: recent.length, firstDate: days[0].key,
      lastDate: days[days.length - 1].key, cutoffDate: cutoff.dateKey,
      monthDays: monthDays.map(samples => samples.length), monthlyHours
    };
  }

  function parseUsageKWh(value) {
    const parsed = parseFloat(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function normalizeUsageSource(source) {
    const value = String(source || '').toLowerCase();
    return ['standard', 'manual', 'xlsx', 'real', 'part', 'forecast'].includes(value) ? value : 'manual';
  }

  function requireHourlyEnergy(values, message) {
    if (!Array.isArray(values) || values.length !== 24 ||
        Array.from(values).some(value => reActualNumber(value) == null)) {
      throw new Error(message);
    }
  }

  /** Reconstruct load from grid imports and XLSX exports; PV is already in kWh. */
  function reconstructPvLoad(importHourlyKwh, pvHourlyKwh, exportHourlyKwh) {
    requireHourlyEnergy(importHourlyKwh, 'Brak godzinowej energii pobranej dla profilu OSD');
    requireHourlyEnergy(exportHourlyKwh, 'Brak godzinowej energii oddanej dla profilu OSD');
    requireHourlyEnergy(pvHourlyKwh, 'Brak danych PV do przeliczenia profilu OSD z energią oddaną');
    return importHourlyKwh.map((importKwh, hour) =>
      Math.max(0, Number(importKwh) || 0) +
      Math.max(0, Number(pvHourlyKwh[hour]) - Math.max(0, Number(exportHourlyKwh[hour]) || 0)));
  }

  /**
   * @param {object} inputs
   * @param {string} inputs.dayKey Local civil date, YYYY-MM-DD.
   * @param {number} [inputs.year] Calendar year; defaults to the year in dayKey.
   * @param {number} inputs.annualKwh Entered annual consumption, before learning.
   * @param {Array<number|string>|null} [inputs.monthlyKwh] Twelve explicit monthly totals.
   * @param {string[]|null} [inputs.sources] Twelve RE source labels; omitted means
   * manual when monthlyKwh is present, otherwise standard.
   * @param {number[]|null} [inputs.defaultHourlyPercent] Original USE24 by default.
   * @param {number[]|null} [inputs.hourlyProfile] Selected 24-hour XLSX/import profile.
   * @param {number[]|null} [inputs.learnedHours] Selected monthlyHours[monthIndex].
   * @param {{isComplete: boolean, hours: Array<{hasUse: boolean, use: number}>}|null} [inputs.actualDay]
   * @param {number[]|null} [inputs.pvHourlyKwh] Required for XLSX export reconstruction.
   * @param {number[]|null} [inputs.exportHourlyKwh] Matching selected XLSX export day.
   * @param {boolean} [inputs.hasExport] True only for an XLSX monthly export source,
   * not merely because live measurements or a PV installation have exports.
   * @returns {number[]} A new array of 24 consumption values, in kWh.
   */
  function resolveDay(inputs) {
    const {
      dayKey, annualKwh, monthlyKwh, sources, hourlyProfile, learnedHours,
      actualDay, pvHourlyKwh, exportHourlyKwh, hasExport = false,
      defaultHourlyPercent = DEFAULT_HOURLY_PERCENT,
    } = inputs;
    const monthIndex = Number(dayKey.slice(5, 7)) - 1;
    const monthly = Array.isArray(monthlyKwh) && monthlyKwh.length === 12
      ? monthlyKwh.map(parseUsageKWh) : null;
    const source = normalizeUsageSource(Array.isArray(sources)
      ? sources[monthIndex] : monthly ? 'manual' : 'standard');
    const detailed = source !== 'standard';

    if (actualDay?.isComplete && actualDay.hours.every(hour => hour.hasUse)) {
      return actualDay.hours.map(hour => Number(hour.use) || 0);
    }

    const selectedProfile = detailed && Array.isArray(hourlyProfile) && hourlyProfile.length === 24
      ? hourlyProfile : null;
    const learned = !detailed ? learnedHours : null;
    let modeledHours;
    if (selectedProfile) {
      if (hasExport) {
        modeledHours = reconstructPvLoad(selectedProfile, pvHourlyKwh, exportHourlyKwh);
      } else {
        modeledHours = selectedProfile.map(value => Number(value) || 0);
      }
    } else if (learned) {
      modeledHours = learned.slice();
    } else {
      // Calendar arithmetic does not parse YYYY-MM-DD as a UTC instant.
      const year = inputs.year ?? Number(dayKey.slice(0, 4));
      const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
      const daysInYear = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
      const dayUsageKWh = detailed && monthly
        ? monthly[monthIndex] / daysInMonth
        : annualKwh / daysInYear;
      const profile = Array.isArray(defaultHourlyPercent) && defaultHourlyPercent.length === 24
        ? defaultHourlyPercent : new Array(24).fill(100 / 24);
      modeledHours = profile.map(percent => dayUsageKWh * Number(percent || 0) / 100);
    }

    if (!actualDay) return modeledHours;
    return modeledHours.map((value, hour) => {
      const actualHour = actualDay.hours[hour];
      return actualHour && actualHour.hasUse ? Number(actualHour.use) || 0 : value;
    });
  }

  /**
   * Full calendar projection using resolveDay, without rounding or another model.
   * inputs: year, annualKwh, monthlyKwh?, sources?, exportSources?,
   * defaultHourlyPercent?, getDayInputs?(dayKey) -> daily resolveDay inputs.
   * The callback selects XLSX/PV patterns, learnedHours and actualDay; it must be
   * deterministic. It may set hasExport:false when hourlyProfile is corrected.
   * month is 1-based. hourly contains monthly sums; weekdayHourly/weekendHourly
   * contain per-day means. hasData includes valid zero consumption and forecasts.
   * Source labels follow RE getUsageMonth[Export]DisplaySource, independently of
   * the arithmetic source precedence in resolveDay.
   */
  function buildProfile(inputs) {
    const { year, annualKwh, monthlyKwh, sources, exportSources, defaultHourlyPercent, getDayInputs } = inputs;
    if (!Number.isInteger(year) || year < 100 || year > 9999) {
      throw new Error('Nieprawidłowy rok profilu zużycia');
    }
    const hasMonthly = Array.isArray(monthlyKwh) && monthlyKwh.length === 12;
    const months = Array.from({ length: 12 }, (_, monthIndex) => {
      const month = monthIndex + 1;
      const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const source = normalizeUsageSource(Array.isArray(sources)
        ? sources[monthIndex] : hasMonthly ? 'manual' : 'standard');
      const baseExportSource = normalizeUsageSource(Array.isArray(exportSources)
        ? exportSources[monthIndex] : 'standard');
      const hourly = new Array(24).fill(0);
      const weekdaySums = new Array(24).fill(0);
      const weekendSums = new Array(24).fill(0);
      let totalKwh = 0;
      let weekdayDays = 0;
      let weekendDays = 0;
      let actualDays = 0;
      let hasLearned = false;
      for (let day = 1; day <= dayCount; day += 1) {
        const dayKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const daily = getDayInputs ? getDayInputs(dayKey) : {};
        const resolved = resolveDay({
          annualKwh, monthlyKwh, sources, defaultHourlyPercent,
          hasExport: baseExportSource === 'xlsx', ...daily, dayKey, year,
        });
        requireHourlyEnergy(resolved, `Brak kompletnego profilu zużycia dla ${dayKey}`);
        if (Array.isArray(daily?.actualDay?.hours) && daily.actualDay.hours.length === 24) actualDays += 1;
        if (daily?.learnedHours) hasLearned = true;
        const dayOfWeek = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
        const weekend = dayOfWeek === 0 || dayOfWeek === 6;
        if (weekend) weekendDays += 1;
        else weekdayDays += 1;
        const grouped = weekend ? weekendSums : weekdaySums;
        resolved.forEach((value, hour) => {
          hourly[hour] += value;
          grouped[hour] += value;
        });
        totalKwh += resolved.reduce((sum, value) => sum + value, 0);
      }
      const actualSource = actualDays >= dayCount ? 'real' : actualDays > 0 ? 'part' : '';
      const importSource = actualSource || (source !== 'standard' ? source : hasLearned ? 'forecast' : source);
      const exportSource = importSource === 'forecast' ? 'standard'
        : importSource === 'real' || importSource === 'part' ? importSource : baseExportSource;
      return {
        month, year, totalKwh, hourly,
        weekdayHourly: weekdaySums.map(value => value / weekdayDays),
        weekendHourly: weekendSums.map(value => value / weekendDays),
        weekdayDays, weekendDays, importSource, exportSource, hasData: true,
      };
    });
    return { months, annualKwh: months.reduce((sum, month) => sum + month.totalKwh, 0) };
  }

  return Object.freeze({
    DEFAULT_HOURLY_PERCENT,
    buildActualMap: buildReActualHourlyMapFromPayload,
    buildForecastModel: buildReUsageForecastModel,
    reconstructPvLoad,
    resolveDay,
    buildProfile,
  });
}));
