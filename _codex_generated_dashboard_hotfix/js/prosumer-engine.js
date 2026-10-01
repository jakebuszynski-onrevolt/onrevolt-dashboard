(function () {
  const DEFAULTS = {
    simulationStartKey: "",
    installedPowerKw: 5,
    batteryCapacityKwh: 10,
    initialSocKwh: 10,
    initialDepositPln: 0,
    depositStartKey: "",
    depositInitialPln: 0,
    reserveSocRatio: 0.15,
    chargeEfficiency: 0.99,
    dischargeEfficiency: 0.99,
    maxChargeKw: 5,
    maxDischargeKw: 5,
    planningHorizonDays: 2,
    socStepKwh: 0.25,
    terminalSocValueFactor: 1,
    preferRdnSellPrice: true,
    cheapBuyQuantile: 0.25,
    expensiveSellQuantile: 0.8,
    sellFromBankSpreadPln: 0.08,
    opportunityExportMinSpreadPln: 0.35,
    opportunityTechnicalMinSocRatio: 0.10,
    opportunityEveningTopHourCount: 4
  };

  const PROSUMER_SALE_PRICE_MULTIPLIER = 1.23;
  const LIGHT_LUX_REFERENCE = 20000;
  const UVI_REFERENCE = 10.5;

  function clamp(value, min, max) {
    if (value < min) {
      return min;
    }
    if (value > max) {
      return max;
    }
    return value;
  }

  function numberOrNull(value) {
    if (value == null || value === "") {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function firstNumber() {
    for (let index = 0; index < arguments.length; index += 1) {
      const numeric = numberOrNull(arguments[index]);
      if (numeric != null) {
        return numeric;
      }
    }
    return null;
  }

  function normalizeText(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value
      .toLowerCase()
      .replace(/[\u0105]/g, "a")
      .replace(/[\u0107]/g, "c")
      .replace(/[\u0119]/g, "e")
      .replace(/[\u0142]/g, "l")
      .replace(/[\u0144]/g, "n")
      .replace(/[\u00f3]/g, "o")
      .replace(/[\u015b]/g, "s")
      .replace(/[\u017a\u017c]/g, "z")
      .trim();
  }

  function parseDateKey(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }
    const parsed = new Date(value.trim().slice(0, 10) + "T00:00:00");
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function parseSqlDateTime(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }
    const parsed = new Date(value.trim().replace(" ", "T"));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatDateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function createQuarterArray(factory) {
    return Array.from({ length: 96 }, function (_, index) {
      return factory(index);
    });
  }

  function buildEmptyZoneTotals() {
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

  function cloneZoneTotals(source) {
    const target = buildEmptyZoneTotals();
    if (!source) {
      return target;
    }
    Object.keys(target).forEach(function (key) {
      target[key] = Number(source[key] || 0);
    });
    return target;
  }

  function addZoneValue(totals, windowCode, value) {
    const numeric = Number(value || 0);
    totals.all += numeric;
    if (windowCode && Object.prototype.hasOwnProperty.call(totals, windowCode)) {
      totals[windowCode] += numeric;
    }
  }

  function mergeZoneTotals(target, source) {
    Object.keys(target).forEach(function (key) {
      target[key] += Number(source && source[key] || 0);
    });
  }

  function roundValue(value, digits) {
    if (value == null) {
      return null;
    }
    const factor = Math.pow(10, digits == null ? 6 : digits);
    return Math.round(Number(value) * factor) / factor;
  }

  function inferMinuteFromLabel(label) {
    if (typeof label !== "string") {
      return null;
    }
    const match = label.match(/(\d{1,2}):(\d{2})/);
    return match ? clamp(Number(match[2]), 0, 59) : null;
  }

  function normalizeWeatherPoint(point, fallbackIndex) {
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

  function buildQuarterWeatherSeries(rawPoints) {
    const normalizedPoints = (Array.isArray(rawPoints) ? rawPoints : [])
      .map(normalizeWeatherPoint)
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

    function applyPoint(point, quarterIndex) {
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
          applyPoint(point, quarterIndex);
        }
        return;
      }
      applyPoint(point, clamp(Math.floor(point.minute / 15), 0, 3));
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

  function buildUsageMap(usageData) {
    const records = usageData && Array.isArray(usageData.records) ? usageData.records : [];
    return new Map(records
      .filter(function (record) {
        return record && typeof record.date === "string";
      })
      .map(function (record) {
        return [record.date, record];
      }));
  }

  function buildWeatherMap(weatherData) {
    const records = weatherData && Array.isArray(weatherData.records) ? weatherData.records : [];
    return new Map(records
      .filter(function (record) {
        return record && typeof record.date === "string" && Array.isArray(record.hours);
      })
      .map(function (record) {
        return [record.date, buildQuarterWeatherSeries(record.hours)];
      }));
  }

  function getLatestUsageDateKey(payload) {
    const usageData = payload && payload.usageData ? payload.usageData : null;
    const records = usageData && Array.isArray(usageData.records) ? usageData.records : [];
    if (usageData && typeof usageData.latestDate === "string" && usageData.latestDate.trim()) {
      return usageData.latestDate.trim().slice(0, 10);
    }
    return records.length ? String(records[records.length - 1].date || "").slice(0, 10) : "";
  }

  function parseTimestamp(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }
    const parsed = new Date(value.trim().replace(" ", "T"));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function getActualSlotLimitForDay(dateKey, payload, record) {
    const latestDateKey = getLatestUsageDateKey(payload);
    if (dateKey !== latestDateKey) {
      return Number.POSITIVE_INFINITY;
    }

    const rawEnergy = payload && payload.rawEnergy ? payload.rawEnergy : payload && payload.energy ? payload.energy : {};
    const energy = payload && payload.energy ? payload.energy : {};
    const timestamp = parseTimestamp(
      rawEnergy.datetime || rawEnergy.reading_time || rawEnergy.timestamp ||
      energy.datetime || energy.reading_time || energy.timestamp
    );

    if (!timestamp) {
      return Number.POSITIVE_INFINITY;
    }

    const timestampDateKey = formatDateKey(timestamp);
    if (timestampDateKey !== dateKey) {
      return Number.POSITIVE_INFINITY;
    }

    const quarters = record && Array.isArray(record.quarters) ? record.quarters : [];
    if (quarters.length && quarters.some(function (quarter) { return quarter && quarter.slotStart; })) {
      let latestSlotIndex = -1;
      quarters.forEach(function (quarter, index) {
        const slotStart = parseTimestamp(quarter && quarter.slotStart);
        if (slotStart && slotStart.getTime() <= timestamp.getTime()) {
          latestSlotIndex = index;
        }
      });
      return latestSlotIndex >= 0 ? latestSlotIndex : 0;
    }

    return clamp((timestamp.getHours() * 4) + Math.floor(timestamp.getMinutes() / 15), 0, 95);
  }

  function normalizeQuarterHour(quarter, slotIndex) {
    const fallbackHour = Math.floor(slotIndex / 4);
    const rawHour = firstNumber(quarter && quarter.hour, fallbackHour);
    return clamp(Math.round(rawHour == null ? fallbackHour : rawHour), 0, 23);
  }

  function formatQuarterLabel(hour, quarterIndex) {
    return String(hour).padStart(2, "0") + ":" + String(quarterIndex * 15).padStart(2, "0");
  }

  function buildDaySlots(dateKey, record, weatherSeries, options, actualSlotLimit) {
    const recordQuarters = record && Array.isArray(record.quarters) ? record.quarters : [];
    const slotCount = recordQuarters.length || (Array.isArray(weatherSeries) && weatherSeries.length ? weatherSeries.length : 96);
    const slots = Array.from({ length: slotCount }, function (_, slotIndex) {
      const quarter = recordQuarters[slotIndex] || null;
      const hour = normalizeQuarterHour(quarter, slotIndex);
      const quarterIndex = clamp(Math.round(firstNumber(quarter && quarter.quarter, slotIndex % 4) || 0), 0, 3);
      const weatherIndex = clamp(
        Math.round(firstNumber(quarter && quarter.localBucketIndex, slotIndex) || 0),
        0,
        Math.max((weatherSeries && weatherSeries.length ? weatherSeries.length : 1) - 1, 0)
      );
      const observedGridKwh = firstNumber(quarter && quarter.grid, 0) || 0;
      const observedStorageKwh = firstNumber(quarter && quarter.storage, 0) || 0;
      const observedPvToLoadKwh = firstNumber(quarter && quarter.pv, 0) || 0;
      const observedLoadKwh = firstNumber(
        quarter && quarter.load,
        quarter && quarter.totalLoadKwh,
        quarter && quarter.usageKwh,
        observedGridKwh + observedStorageKwh + observedPvToLoadKwh
      ) || 0;
      const weatherSample = weatherSeries && weatherSeries[weatherIndex] ? weatherSeries[weatherIndex] : null;
      const estimatedProduction = getQuarterProduction(weatherSample, options.installedPowerKw);
      const estimatedPvGenerationKwh = firstNumber(estimatedProduction && estimatedProduction.energyKwh, 0) || 0;
      const observedPvGenerationKwh = firstNumber(
        quarter && quarter.pvGenerationKwh,
        quarter && quarter.pv_generation,
        quarter && quarter.productionKwh,
        quarter && quarter.pvProducedKwh,
        observedPvToLoadKwh
      ) || 0;
      const pvGenerationKwh = Math.max(observedPvGenerationKwh, estimatedPvGenerationKwh);

      return {
        index: slotIndex,
        dateKey: dateKey,
        hour: hour,
        quarter: quarterIndex,
        label: formatQuarterLabel(hour, quarterIndex),
        slotStart: quarter && quarter.slotStart ? quarter.slotStart : null,
        slotEnd: quarter && quarter.slotEnd ? quarter.slotEnd : null,
        timezoneOffsetMinutes: firstNumber(quarter && quarter.timezoneOffsetMinutes),
        localBucketIndex: firstNumber(quarter && quarter.localBucketIndex, (hour * 4) + quarterIndex),
        slotOccurrence: firstNumber(quarter && quarter.slotOccurrence, 0) || 0,
        actual: slotIndex <= actualSlotLimit,
        load: observedLoadKwh,
        observedGridKwh: observedGridKwh,
        observedStorageKwh: observedStorageKwh,
        observedPvToLoadKwh: observedPvToLoadKwh,
        weatherPvKwh: estimatedPvGenerationKwh,
        pv: pvGenerationKwh
      };
    });

    return slots;
  }

  function getQuantile(values, quantile) {
    const cleaned = values
      .map(numberOrNull)
      .filter(function (value) { return value != null; })
      .sort(function (left, right) { return left - right; });

    if (!cleaned.length) {
      return null;
    }

    const index = clamp(Math.round((cleaned.length - 1) * quantile), 0, cleaned.length - 1);
    return cleaned[index];
  }

  function isCapacityChargeTariffLabel(label) {
    return normalizeText(label).indexOf("oplata mocowa") !== -1;
  }

  function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
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

  function isPolishPublicHoliday(dateKey) {
    const year = Number(String(dateKey || "").slice(0, 4));
    const fixed = new Set([
      year + "-01-01", year + "-01-06", year + "-05-01", year + "-05-03", year + "-08-15",
      year + "-11-01", year + "-11-11", year + "-12-25", year + "-12-26"
    ]);
    if (year >= 2025) {
      fixed.add(year + "-12-24");
    }
    const easter = easterSunday(year);
    fixed.add(dateWithOffset(easter, 1));
    fixed.add(dateWithOffset(easter, 60));
    return fixed.has(dateKey);
  }

  function capacityQualifyingHour(rule, dateKey, hour) {
    const day = new Date(dateKey + "T12:00:00Z").getUTCDay();
    if (rule.exclude_weekends && (day === 0 || day === 6)) {
      return false;
    }
    if (rule.exclude_public_holidays && isPolishPublicHoliday(dateKey)) {
      return false;
    }
    return hour >= Number(rule.qualifying_hour_from) && hour < Number(rule.qualifying_hour_until);
  }

  function capacityProfileFactor(rule, dateKey, profile) {
    if (!Array.isArray(profile) || profile.length !== 24) {
      throw new Error("Brak dobowego profilu zużycia do obliczenia opłaty mocowej dla " + dateKey + ".");
    }
    let peak = 0;
    let peakHours = 0;
    let other = 0;
    let otherHours = 0;
    profile.forEach(function (raw, hour) {
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error("Nieprawidłowy profil dobowy opłaty mocowej dla " + dateKey + ".");
      }
      if (capacityQualifyingHour(rule, dateKey, hour)) {
        peak += amount;
        peakHours += 1;
      } else {
        other += amount;
        otherHours += 1;
      }
    });
    if (!peakHours) {
      return 0;
    }
    if (!otherHours || other <= 0) {
      return 1;
    }
    const difference = (((peak / peakHours) / (other / otherHours)) - 1) * 100;
    const band = (rule.profile_factors || []).find(function (item) {
      return item.difference_max_percent == null || difference < Number(item.difference_max_percent);
    });
    if (!band || !Number.isFinite(Number(band.factor))) {
      throw new Error("Niekompletne współczynniki opłaty mocowej.");
    }
    return Number(band.factor);
  }

  function resolveCapacityCharge(tariff, dateKey, hour, connectionPowerKw, profile) {
    const capacityRow = (Array.isArray(tariff && tariff.variable) ? tariff.variable : []).find(function (row) {
      return isCapacityChargeTariffLabel(row && row.label);
    });
    if (!capacityRow) {
      return { rate: 0, factor: null, mode: null };
    }
    const rule = tariff && tariff.capacity_charge;
    if (!rule || rule.model !== "pl_capacity_charge") {
      throw new Error("Brak reguły rozliczenia opłaty mocowej dla taryfy " + String(tariff && tariff.code || "C") + ".");
    }
    if ((rule.effective_from && dateKey < rule.effective_from) || (rule.effective_until && dateKey >= rule.effective_until)) {
      throw new Error("Brak aktualnej reguły opłaty mocowej dla " + dateKey + ".");
    }
    const power = Number(connectionPowerKw);
    if (!Number.isFinite(power) || power <= 0) {
      throw new Error("Brak mocy umownej do obliczenia opłaty mocowej.");
    }
    if (rule.flat_eligible && power <= Number(rule.flat_max_power_kw)) {
      return { rate: 0, factor: null, mode: "flat" };
    }
    if (!capacityQualifyingHour(rule, dateKey, hour)) {
      return { rate: 0, factor: 0, mode: "variable" };
    }
    const factor = capacityProfileFactor(rule, dateKey, profile);
    return { rate: Number(rule.variable_rate) * factor, factor: factor, mode: "variable" };
  }

  function buildCapacityProfilesByDate(days) {
    return Object.fromEntries((days || []).map(function (day) {
      const profile = Array(24).fill(0);
      (day && Array.isArray(day.slots) ? day.slots : []).forEach(function (slot) {
        const hour = clamp(Math.round(firstNumber(slot && slot.hour, 0) || 0), 0, 23);
        const load = Number(slot && slot.load);
        if (Number.isFinite(load) && load >= 0) {
          profile[hour] += load;
        }
      });
      return [day.dateKey, profile];
    }));
  }

  function resolveConnectionPowerKw(context) {
    const payload = context && context.payload ? context.payload : {};
    const account = payload && payload.account ? payload.account : {};
    const settings = account && account.tariffSettings ? account.tariffSettings : {};
    const current = settings && settings.current ? settings.current : {};
    return firstNumber(
      context && context.connectionPowerKw,
      current.contractPowerKw,
      current.contract_power_kw,
      settings.contractPowerKw,
      account.contractPowerKw
    );
  }

  function createPriceProvider(context) {
    const providerOptions = Object.assign({}, DEFAULTS, context && context.options ? context.options : {});
    const fallbackTariff = context && context.tariff ? context.tariff : null;
    const tariffHistory = context && context.tariffHistory ? context.tariffHistory : null;
    const priceHistory = context && context.priceHistory ? context.priceHistory : null;
    const currentRce = context && context.currentRce ? context.currentRce : null;
    const connectionPowerKw = resolveConnectionPowerKw(context);
    const capacityProfilesByDate = context && context.capacityProfilesByDate ? context.capacityProfilesByDate : {};

    function resolveTariff(dateKey) {
      const tariffByDate = tariffHistory && tariffHistory.byDate ? tariffHistory.byDate : null;
      if (tariffByDate && dateKey && Object.prototype.hasOwnProperty.call(tariffByDate, dateKey)) {
        if (tariffHistory.strict && !tariffByDate[dateKey]) throw new Error("Wymaga uzupełnienia: brak cen dla " + dateKey);
        return tariffByDate[dateKey];
      }
      if (tariffHistory && tariffHistory.strict) throw new Error("Wymaga uzupełnienia: brak taryfy dla " + dateKey);
      return fallbackTariff;
    }

    function resolveRcePayload(dateKey) {
      const rceByDate = priceHistory && priceHistory.rceByDate ? priceHistory.rceByDate : {};
      if (dateKey && rceByDate && Object.prototype.hasOwnProperty.call(rceByDate, dateKey)) {
        return rceByDate[dateKey];
      }
      if (currentRce && currentRce.businessDate === dateKey) {
        return currentRce;
      }
      return currentRce || null;
    }

    function resolveRcePriceForHour(rcePayload, hour) {
      const hourlyRates = rcePayload && Array.isArray(rcePayload.hourlyRates) ? rcePayload.hourlyRates : [];
      for (let index = 0; index < hourlyRates.length; index += 1) {
        const entry = hourlyRates[index];
        if (Number(entry && entry.hour) === hour) {
          return firstNumber(entry && entry.pricePln, entry && entry.price, entry && entry.value);
        }
      }
      return null;
    }

    function isEnergyActiveTariffLabel(label) {
      return normalizeText(label).indexOf("energia czynna") !== -1;
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

    function resolveTariffWindowCodeForDateHour(dateKey, hour) {
      const tariff = resolveTariff(dateKey);
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

    function resolveEnergyBuyPrice(dateKey, hour, rcePayload) {
      const tariff = resolveTariff(dateKey);
      if (!tariff) {
        return null;
      }

      const windowCode = resolveTariffWindowCodeForDateHour(dateKey, hour);
      const sellMethod = normalizeText(tariff.sell_method || "fixed");
      const variableRows = Array.isArray(tariff.variable) ? tariff.variable : [];

      if (sellMethod === "rdn") {
        const rcePrice = resolveRcePriceForHour(rcePayload, hour);
        if (rcePrice == null) {
          return null;
        }

        return rcePrice;
      }

      return (variableRows || []).reduce(function (sum, row) {
        const rowWindowCode = normalizeText(row && row.window_code ? row.window_code : "all");
        if (normalizeText(windowCode || "all") === "all") {
          if (rowWindowCode !== "all") {
            return sum;
          }
        } else if (rowWindowCode !== "all" && rowWindowCode !== normalizeText(windowCode || "all")) {
          return sum;
        }
        return isEnergyActiveTariffLabel(row && row.label) ? sum + (Number(row && row.price) || 0) : sum;
      }, 0);
    }

    function resolveProsumerSalePrice(rcePrice) {
      const price = numberOrNull(rcePrice);
      const multiplier = numberOrNull(providerOptions.salePriceMultiplier) || PROSUMER_SALE_PRICE_MULTIPLIER;
      return price == null ? null : Math.max(price, 0) * multiplier;
    }

    const hasNetTariff = Boolean(fallbackTariff && fallbackTariff.pricingLegacyTariff);
    const controlHistory = tariffHistory && tariffHistory.byDate ? Object.assign({}, tariffHistory, {
      byDate: Object.fromEntries(Object.entries(tariffHistory.byDate).map(function (entry) { return [entry[0], entry[1] && (entry[1].pricingLegacyTariff || entry[1])]; }))
    }) : tariffHistory;
    return {
      controlProvider: hasNetTariff ? createPriceProvider(Object.assign({}, context, {tariff:fallbackTariff.pricingLegacyTariff, tariffHistory:controlHistory})) : null,
      getSlotPrice: function (dateKey, slotInput) {
        const slot = slotInput && typeof slotInput === "object" ? slotInput : null;
        const slotIndex = slot ? firstNumber(slot.index, slot.slotIndex, 0) : firstNumber(slotInput, 0);
        const tariff = resolveTariff(dateKey);
        const hour = slot ? clamp(Math.round(firstNumber(slot.hour, Math.floor(slotIndex / 4)) || 0), 0, 23) : Math.floor(slotIndex / 4);
        const rcePayload = resolveRcePayload(dateKey);
        const windowCode = resolveTariffWindowCodeForDateHour(dateKey, hour);
        const sellMethod = normalizeText(tariff && tariff.sell_method ? tariff.sell_method : "fixed");
        const variableRows = Array.isArray(tariff && tariff.variable) ? tariff.variable : [];
        const rce = resolveRcePriceForHour(rcePayload, hour);
        const capacityCharge = tariff
          ? resolveCapacityCharge(tariff, dateKey, hour, connectionPowerKw, capacityProfilesByDate[dateKey])
          : { rate: 0, factor: null, mode: null };
        let buyPrice = null;
        let energyBuyPrice = null;
        let distributionBuyPrice = null;
        let sellPrice = null;

        if (tariff) {
          if (sellMethod === "rdn") {
            if (rce != null) {
              buyPrice = sumTariffVariableRowsForWindow(variableRows, windowCode, false) + rce + capacityCharge.rate;
              energyBuyPrice = resolveEnergyBuyPrice(dateKey, hour, rcePayload);
              distributionBuyPrice = energyBuyPrice == null ? null : Math.max(buyPrice - energyBuyPrice, 0);
              sellPrice = resolveProsumerSalePrice(rce);
            }
          } else {
            buyPrice = sumTariffVariableRowsForWindow(variableRows, windowCode, true) + capacityCharge.rate;
            energyBuyPrice = resolveEnergyBuyPrice(dateKey, hour, rcePayload);
            distributionBuyPrice = energyBuyPrice == null ? null : Math.max(buyPrice - energyBuyPrice, 0);
            sellPrice = resolveProsumerSalePrice(rce);
          }
        }

        return {
          dateKey: dateKey,
          slotIndex: slotIndex,
          hour: hour,
          windowCode: windowCode,
          rce: rce,
          rdn: rce,
          buyPrice: buyPrice,
          energyBuyPrice: energyBuyPrice,
          distributionBuyPrice: distributionBuyPrice,
          capacityChargeRate: capacityCharge.rate,
          capacityChargeFactor: capacityCharge.factor,
          capacityChargeMode: capacityCharge.mode,
          sellPrice: window.DashboardPricing ? window.DashboardPricing.settlementAmount(sellPrice, tariff) : sellPrice
        };
      }
    };
  }

  function computeSlotPlanning(slots, priceProvider, options) {
    const slotMeta = slots.map(function (slot) {
      const price = priceProvider.getSlotPrice(slot.dateKey, slot);
      return {
        slot: slot,
        price: price,
        directNeed: Math.max(slot.load - Math.min(slot.load, slot.pv), 0),
        pvSurplus: Math.max(slot.pv - Math.min(slot.load, slot.pv), 0)
      };
    });

    const actualMeta = slotMeta.filter(function (entry) {
      return entry.slot.actual;
    });
    const buyThreshold = getQuantile(actualMeta.map(function (entry) {
      return entry.price && entry.price.buyPrice;
    }), options.cheapBuyQuantile);
    const sellThreshold = getQuantile(actualMeta.map(function (entry) {
      return entry.price && entry.price.sellPrice;
    }), options.expensiveSellQuantile);

    const futureNetNeed = Array(slotMeta.length + 1).fill(0);
    for (let index = slotMeta.length - 1; index >= 0; index -= 1) {
      const meta = slotMeta[index];
      futureNetNeed[index] = futureNetNeed[index + 1] + (meta.slot.actual ? meta.directNeed : 0);
    }

    const futureExpensiveNeed = Array(slotMeta.length + 1).fill(0);
    for (let index = slotMeta.length - 1; index >= 0; index -= 1) {
      const meta = slotMeta[index];
      const isExpensive = sellThreshold != null && meta.price && meta.price.buyPrice != null && meta.price.buyPrice >= sellThreshold;
      futureExpensiveNeed[index] = futureExpensiveNeed[index + 1] + (meta.slot.actual && isExpensive ? meta.directNeed : 0);
    }

    return {
      slotMeta: slotMeta,
      buyThreshold: buyThreshold,
      sellThreshold: sellThreshold,
      futureNetNeed: futureNetNeed,
      futureExpensiveNeed: futureExpensiveNeed
    };
  }

  function buildPlanningMeta(slots, priceProvider) {
    return (Array.isArray(slots) ? slots : []).map(function (slot) {
      const price = priceProvider.getSlotPrice(slot.dateKey, slot);
      const directPvKwh = Math.min(Number(slot.load || 0), Number(slot.pv || 0));
      return {
        slot: slot,
        price: price,
        directPvKwh: directPvKwh,
        remainingLoadKwh: Math.max(Number(slot.load || 0) - directPvKwh, 0),
        pvSurplusKwh: Math.max(Number(slot.pv || 0) - directPvKwh, 0)
      };
    });
  }

  function annotateOpportunityExportMeta(planningMeta, battery, options) {
    const topHourCount = Math.max(1, Math.round(Number(options && options.opportunityEveningTopHourCount || 4)));
    const minSpreadPln = Math.max(0, Number(options && options.opportunityExportMinSpreadPln || 0));
    const technicalReserveKwh = Math.max(
      0,
      Number(battery && battery.capacityKwh || 0) *
        Math.max(0, Number(options && options.opportunityTechnicalMinSocRatio || 0.10))
    );
    const futureBuyPrice = Array(planningMeta.length).fill(null);
    const topHoursByDate = {};
    let futureMinBuyPrice = null;

    for (let index = planningMeta.length - 1; index >= 0; index -= 1) {
      futureBuyPrice[index] = futureMinBuyPrice;
      const buyPrice = numberOrNull(planningMeta[index] && planningMeta[index].price && planningMeta[index].price.buyPrice);
      if (buyPrice != null) {
        futureMinBuyPrice = futureMinBuyPrice == null ? buyPrice : Math.min(futureMinBuyPrice, buyPrice);
      }
    }

    planningMeta.forEach(function (meta) {
      const slot = meta && meta.slot ? meta.slot : {};
      const hour = Math.floor(Number(slot.hour || 0));
      const dateKey = slot.dateKey || "";
      const sellPrice = numberOrNull(meta && meta.price && meta.price.sellPrice);
      if (!dateKey || sellPrice == null || hour < 15 || hour > 23) {
        return;
      }
      if (!topHoursByDate[dateKey]) {
        topHoursByDate[dateKey] = {};
      }
      if (!topHoursByDate[dateKey][hour]) {
        topHoursByDate[dateKey][hour] = {
          sum: 0,
          count: 0
        };
      }
      topHoursByDate[dateKey][hour].sum += sellPrice;
      topHoursByDate[dateKey][hour].count += 1;
    });

    Object.keys(topHoursByDate).forEach(function (dateKey) {
      const hourSet = {};
      Object.keys(topHoursByDate[dateKey])
        .map(function (hourKey) {
          const item = topHoursByDate[dateKey][hourKey];
          return {
            hour: Number(hourKey),
            avgSellPrice: item.count ? item.sum / item.count : 0
          };
        })
        .sort(function (left, right) {
          return right.avgSellPrice - left.avgSellPrice || left.hour - right.hour;
        })
        .slice(0, topHourCount)
        .forEach(function (item) {
          hourSet[item.hour] = true;
        });
      topHoursByDate[dateKey] = hourSet;
    });

    planningMeta.forEach(function (meta, index) {
      const slot = meta && meta.slot ? meta.slot : {};
      const hour = Math.floor(Number(slot.hour || 0));
      const dateKey = slot.dateKey || "";
      const sellPrice = numberOrNull(meta && meta.price && meta.price.sellPrice);
      const acceptableBuyPrice = futureBuyPrice[index];
      const spreadPln = sellPrice != null && acceptableBuyPrice != null ? sellPrice - acceptableBuyPrice : null;
      const isTopEveningHour = Boolean(topHoursByDate[dateKey] && topHoursByDate[dateKey][hour]);

      meta.opportunityExport = Boolean(isTopEveningHour && spreadPln != null && spreadPln >= minSpreadPln);
      meta.opportunitySpreadPln = spreadPln;
      meta.opportunityFutureBuyPricePln = acceptableBuyPrice;
      meta.opportunityReserveKwh = technicalReserveKwh;
    });
  }

  function buildSocStates(capacityKwh, stepKwh) {
    const limit = Math.max(0, Number(capacityKwh || 0));
    const step = Math.max(0.05, Number(stepKwh || 0.25));
    const states = [];
    let current = 0;

    while (current < limit) {
      states.push(roundValue(current, 6));
      current += step;
    }

    states.push(roundValue(limit, 6));
    return states.filter(function (value, index, array) {
      return index === 0 || Math.abs(value - array[index - 1]) > 1e-6;
    });
  }

  function findClosestSocStateIndex(states, socKwh) {
    const target = Number(socKwh || 0);
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < states.length; index += 1) {
      const distance = Math.abs(states[index] - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    return bestIndex;
  }

  function estimateTerminalSocValuePerKwh(planningMeta, battery, options) {
    const candidateValues = (planningMeta || []).map(function (meta) {
      return Math.max(
        Number(meta && meta.price && meta.price.buyPrice || 0),
        Number(meta && meta.price && meta.price.sellPrice || 0)
      );
    }).filter(function (value) {
      return value > 0;
    });

    if (!candidateValues.length) {
      return 0;
    }

    const referenceValue = getQuantile(candidateValues, 0.65) || candidateValues[candidateValues.length - 1] || 0;
    return referenceValue * Math.max(0, Number(battery && battery.dischargeEfficiency || 1)) * Number(options && options.terminalSocValueFactor || 1);
  }

  function evaluatePlanningTransition(socStartKwh, socEndKwh, meta, battery) {
    const capacityKwh = Number(battery && battery.capacityKwh || 0);
    const reserveKwh = Math.max(0, Number(battery && battery.reserveKwh || 0));
    const chargeEfficiency = Math.max(0.001, Number(battery && battery.chargeEfficiency || 1));
    const dischargeEfficiency = Math.max(0.001, Number(battery && battery.dischargeEfficiency || 1));
    const maxChargePerSlotKwh = Math.max(0, Number(battery && battery.maxChargePerSlotKwh || 0));
    const maxDischargePerSlotKwh = Math.max(0, Number(battery && battery.maxDischargePerSlotKwh || 0));
    const price = meta && meta.price ? meta.price : {};
    const buyPrice = numberOrNull(price.buyPrice);
    const sellPrice = numberOrNull(price.sellPrice);
    const opportunityReserveKwh = numberOrNull(meta && meta.opportunityReserveKwh);
    const opportunityExport = Boolean(meta && meta.opportunityExport && sellPrice != null && opportunityReserveKwh != null);
    const effectiveReserveKwh = opportunityExport ? Math.min(reserveKwh, opportunityReserveKwh) : reserveKwh;
    const remainingLoadKwh = Math.max(0, Number(meta && meta.remainingLoadKwh || 0));
    const pvSurplusKwh = Math.max(0, Number(meta && meta.pvSurplusKwh || 0));
    const deltaSocKwh = roundValue(Number(socEndKwh || 0) - Number(socStartKwh || 0), 6);
    const transition = {
      feasible: false,
      objectiveValue: Number.NEGATIVE_INFINITY,
      directPvKwh: Math.max(0, Number(meta && meta.directPvKwh || 0)),
      pvToLoad: Math.max(0, Number(meta && meta.directPvKwh || 0)),
      pvToBank: 0,
      chargeFromPvKwh: 0,
      sellImmediate: 0,
      bankToLoad: 0,
      bankToSell: 0,
      gridBuyLoad: 0,
      gridBuyBank: 0,
      nominalCostPln: 0,
      saleRevenuePln: 0,
      exportKwh: 0,
      dischargeKwh: 0,
      cycleWithdrawnRawKwh: 0
    };

    if (socEndKwh < -1e-6 || socEndKwh > capacityKwh + 1e-6) {
      return transition;
    }

    if (deltaSocKwh >= -1e-6) {
      const chargeRawKwh = Math.max(0, deltaSocKwh);
      if (chargeRawKwh > maxChargePerSlotKwh + 1e-6 || socEndKwh > capacityKwh + 1e-6) {
        return transition;
      }

      const maxPvChargeRawKwh = Math.min(chargeRawKwh, pvSurplusKwh * chargeEfficiency);
      const pvChargeUnitCost = sellPrice == null ? 0 : sellPrice / chargeEfficiency;
      const gridChargeUnitCost = buyPrice == null ? Number.POSITIVE_INFINITY : buyPrice;
      let pvChargeRawKwh = 0;

      if (maxPvChargeRawKwh > 0 && pvChargeUnitCost <= gridChargeUnitCost) {
        pvChargeRawKwh = maxPvChargeRawKwh;
      }

      const gridChargeRawKwh = Math.max(0, chargeRawKwh - pvChargeRawKwh);
      if (gridChargeRawKwh > 1e-6 && buyPrice == null) {
        return transition;
      }

      const consumedPvForChargeKwh = pvChargeRawKwh / chargeEfficiency;
      const soldImmediateKwh = Math.max(0, pvSurplusKwh - consumedPvForChargeKwh);
      const saleRevenuePln = soldImmediateKwh * (sellPrice || 0);
      const gridLoadKwh = remainingLoadKwh;
      if (gridLoadKwh > 1e-6 && buyPrice == null) {
        return transition;
      }

      transition.feasible = true;
      transition.pvToBank = pvChargeRawKwh;
      transition.chargeFromPvKwh = pvChargeRawKwh;
      transition.sellImmediate = soldImmediateKwh;
      transition.gridBuyLoad = gridLoadKwh;
      transition.gridBuyBank = gridChargeRawKwh;
      transition.nominalCostPln = ((gridLoadKwh + gridChargeRawKwh) * (buyPrice || 0));
      transition.saleRevenuePln = saleRevenuePln;
      transition.exportKwh = soldImmediateKwh;
      transition.objectiveValue = saleRevenuePln - transition.nominalCostPln;
      return transition;
    }

    const dischargeRawKwh = Math.max(0, -deltaSocKwh);
    if (dischargeRawKwh > maxDischargePerSlotKwh + 1e-6) {
      return transition;
    }
    if (socEndKwh < Math.min(effectiveReserveKwh, socStartKwh) - 1e-6) {
      return transition;
    }
    if (socStartKwh - socEndKwh > Math.max(0, socStartKwh - effectiveReserveKwh) + 1e-6) {
      return transition;
    }

    const deliverableKwh = dischargeRawKwh * dischargeEfficiency;
    const valueToLoad = buyPrice == null ? 0 : buyPrice;
    const valueToSell = sellPrice == null ? Number.NEGATIVE_INFINITY : sellPrice;
    let bankToLoadKwh = 0;
    let bankToSellKwh = 0;

    if (deliverableKwh > 0) {
      if (valueToLoad >= valueToSell) {
        bankToLoadKwh = Math.min(remainingLoadKwh, deliverableKwh);
        bankToSellKwh = Math.max(0, deliverableKwh - bankToLoadKwh);
      } else {
        bankToSellKwh = deliverableKwh;
      }
    }

    if (bankToSellKwh > 1e-6 && sellPrice == null) {
      return transition;
    }

    const gridLoadKwh = Math.max(0, remainingLoadKwh - bankToLoadKwh);
    if (gridLoadKwh > 1e-6 && buyPrice == null) {
      return transition;
    }

    const soldImmediateKwh = pvSurplusKwh;
    const saleRevenuePln = (soldImmediateKwh * (sellPrice || 0)) + (bankToSellKwh * (sellPrice || 0));

    transition.feasible = true;
    transition.sellImmediate = soldImmediateKwh;
    transition.bankToLoad = bankToLoadKwh;
    transition.bankToSell = bankToSellKwh;
    transition.gridBuyLoad = gridLoadKwh;
    transition.nominalCostPln = gridLoadKwh * (buyPrice || 0);
    transition.saleRevenuePln = saleRevenuePln;
    transition.exportKwh = soldImmediateKwh + bankToSellKwh;
    transition.dischargeKwh = bankToLoadKwh + bankToSellKwh;
    transition.cycleWithdrawnRawKwh = dischargeRawKwh;
    transition.objectiveValue = saleRevenuePln - transition.nominalCostPln;
    return transition;
  }

  function computeOptimalPolicy(planningSlots, priceProvider, battery, options) {
    const planningMeta = buildPlanningMeta(planningSlots, priceProvider);
    annotateOpportunityExportMeta(planningMeta, battery, options);
    const states = buildSocStates(battery.capacityKwh, options.socStepKwh);
    const stateCount = states.length;
    const slotCount = planningMeta.length;
    const terminalValuePerKwh = estimateTerminalSocValuePerKwh(planningMeta, battery, options);
    let nextValues = states.map(function (socKwh) {
      return socKwh * terminalValuePerKwh;
    });
    const nextStateBySlot = Array.from({ length: slotCount }, function () {
      return Array(stateCount).fill(0);
    });
    const transitionBySlot = Array.from({ length: slotCount }, function () {
      return Array(stateCount).fill(null);
    });

    for (let slotIndex = slotCount - 1; slotIndex >= 0; slotIndex -= 1) {
      const currentValues = Array(stateCount).fill(Number.NEGATIVE_INFINITY);
      const slotMeta = planningMeta[slotIndex];

      for (let startStateIndex = 0; startStateIndex < stateCount; startStateIndex += 1) {
        const socStartKwh = states[startStateIndex];
        let bestValue = Number.NEGATIVE_INFINITY;
        let bestNextStateIndex = startStateIndex;
        let bestTransition = null;

        for (let endStateIndex = 0; endStateIndex < stateCount; endStateIndex += 1) {
          const socEndKwh = states[endStateIndex];
          const transition = evaluatePlanningTransition(socStartKwh, socEndKwh, slotMeta, battery);
          if (!transition.feasible) {
            continue;
          }

          const candidateValue = transition.objectiveValue + nextValues[endStateIndex];
          if (candidateValue > bestValue) {
            bestValue = candidateValue;
            bestNextStateIndex = endStateIndex;
            bestTransition = transition;
          }
        }

        currentValues[startStateIndex] = bestValue;
        nextStateBySlot[slotIndex][startStateIndex] = bestNextStateIndex;
        transitionBySlot[slotIndex][startStateIndex] = bestTransition;
      }

      nextValues = currentValues;
    }

    return {
      planningMeta: planningMeta,
      states: states,
      nextStateBySlot: nextStateBySlot,
      transitionBySlot: transitionBySlot,
      terminalValuePerKwh: terminalValuePerKwh
    };
  }

  function createDayTotals() {
    return {
      usageKwh: 0,
      generationKwh: 0,
      directPvKwh: 0,
      bankToLoadKwh: 0,
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
      physicalGridImportKwh: 0,
      physicalGridExportKwh: 0,
      billedGridPurchaseKwh: 0,
      billedGridPurchaseForLoadKwh: 0,
      billedGridTopupKwh: 0,
      billedGridExportKwh: 0,
      billedSaleValuePln: 0,
      billedPurchaseNominalPln: 0,
      billedPurchaseCashPln: 0,
      billedDepositUsedPln: 0,
      billedDepositEarnedPln: 0,
      dischargeByZone: buildEmptyZoneTotals()
    };
  }

  function getAverageSlotPrice(slots, fieldName) {
    const prices = (slots || [])
      .map(function (slot) {
        return numberOrNull(slot && slot[fieldName]);
      })
      .filter(function (value) {
        return value != null;
      });

    if (!prices.length) {
      return null;
    }

    return prices.reduce(function (sum, value) {
      return sum + value;
    }, 0) / prices.length;
  }

  function setSettlementSlotDefaults(slot) {
    slot.physicalGridImportKwh = (slot.gridBuyLoad || 0) + (slot.gridBuyBank || 0);
    slot.physicalGridExportKwh = slot.exportKwh || 0;
    slot.billedGridPurchaseKwh = 0;
    slot.billedGridPurchaseForLoadKwh = 0;
    slot.billedGridTopupKwh = 0;
    slot.billedGridExportKwh = 0;
    slot.billedSoldImmediateKwh = 0;
    slot.billedSoldBankKwh = 0;
    slot.billedPurchaseNominalPln = 0;
    slot.billedPurchaseCashPln = 0;
    slot.billedDepositUsedPln = 0;
    slot.billedDepositEarnedPln = 0;
    slot.billedSaleValuePln = 0;
  }

  function getSlotHourGroupKey(slot, fallbackIndex) {
    if (slot && typeof slot.slotStart === "string" && slot.slotStart.length >= 13) {
      return [
        slot.dateKey || "",
        slot.slotStart.slice(0, 13),
        slot.timezoneOffsetMinutes == null ? "" : String(slot.timezoneOffsetMinutes)
      ].join("|");
    }

    return [
      slot && slot.dateKey ? slot.dateKey : "",
      String(slot && slot.hour != null ? slot.hour : Math.floor((fallbackIndex || 0) / 4)).padStart(2, "0"),
      String(slot && slot.slotOccurrence != null ? slot.slotOccurrence : 0)
    ].join("|");
  }

  function groupSlotsByHour(slots, includeFutureSlots) {
    const groups = [];
    const groupMap = new Map();

    (slots || []).forEach(function (slot, index) {
      if (!slot || (!includeFutureSlots && slot.actual === false)) {
        return;
      }

      const key = getSlotHourGroupKey(slot, index);
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
        groups.push(groupMap.get(key));
      }
      groupMap.get(key).push(slot);
    });

    return groups;
  }

  function applyHourlySettlement(resultSlots, totals, startDepositPln) {
    let depositPln = Math.max(0, Number(startDepositPln || 0));

    totals.physicalGridImportKwh = 0;
    totals.physicalGridExportKwh = 0;
    totals.billedGridPurchaseKwh = 0;
    totals.billedGridPurchaseForLoadKwh = 0;
    totals.billedGridTopupKwh = 0;
    totals.billedGridExportKwh = 0;
    totals.billedSaleValuePln = 0;
    totals.billedPurchaseNominalPln = 0;
    totals.billedPurchaseCashPln = 0;
    totals.billedDepositUsedPln = 0;
    totals.billedDepositEarnedPln = 0;

    totals.exportKwh = 0;
    totals.soldImmediateKwh = 0;
    totals.soldImmediatePln = 0;
    totals.soldBankKwh = 0;
    totals.soldBankPln = 0;
    totals.gridPurchaseKwh = 0;
    totals.gridPurchaseForLoadKwh = 0;
    totals.gridTopupKwh = 0;
    totals.nominalVariableCostPln = 0;
    totals.cashCostPln = 0;
    totals.topupCashCostPln = 0;
    totals.depositUsedPln = 0;
    totals.depositEarnedPln = 0;
    totals.buyOwnKwh = 0;
    totals.buyOwnCashPln = 0;
    totals.buyOwnFromDepositPln = 0;
    totals.buyOwnNominalPln = 0;
    totals.buyBankKwh = 0;
    totals.buyBankCashPln = 0;
    totals.buyBankFromDepositPln = 0;
    totals.buyBankNominalPln = 0;

    groupSlotsByHour(resultSlots, false).forEach(function (hourSlots) {
      const physicalImportKwh = hourSlots.reduce(function (sum, slot) {
        return sum + (slot.gridBuyLoad || 0) + (slot.gridBuyBank || 0);
      }, 0);
      const physicalExportKwh = hourSlots.reduce(function (sum, slot) {
        return sum + (slot.exportKwh || 0);
      }, 0);
      const importForLoadKwh = hourSlots.reduce(function (sum, slot) {
        return sum + (slot.gridBuyLoad || 0);
      }, 0);
      const importForBankKwh = hourSlots.reduce(function (sum, slot) {
        return sum + (slot.gridBuyBank || 0);
      }, 0);
      const exportImmediateKwh = hourSlots.reduce(function (sum, slot) {
        return sum + (slot.sellImmediate || 0);
      }, 0);
      const exportBankKwh = hourSlots.reduce(function (sum, slot) {
        return sum + (slot.bankToSell || 0);
      }, 0);
      const billedPurchaseKwh = Math.max(physicalImportKwh - physicalExportKwh, 0);
      const billedExportKwh = Math.max(physicalExportKwh - physicalImportKwh, 0);
      const slotCount = Math.max(hourSlots.length, 1);
      const buyPrice = getAverageSlotPrice(hourSlots, "buyPrice") || 0;
      const energyBuyPrice = getAverageSlotPrice(hourSlots, "energyBuyPrice") || 0;
      const distributionBuyPrice = getAverageSlotPrice(hourSlots, "distributionBuyPrice") || Math.max(buyPrice - energyBuyPrice, 0);
      const sellPrice = getAverageSlotPrice(hourSlots, "sellPrice") || 0;
      const purchaseNominalPln = billedPurchaseKwh * buyPrice;
      const purchaseEnergyPln = billedPurchaseKwh * energyBuyPrice;
      const purchaseDistributionPln = billedPurchaseKwh * distributionBuyPrice;
      const depositUsedPln = Math.min(depositPln, purchaseEnergyPln);
      const purchaseCashPln = Math.max(0, purchaseEnergyPln - depositUsedPln) + purchaseDistributionPln;
      const saleValuePln = billedExportKwh * sellPrice;
      const purchaseLoadShare = physicalImportKwh > 0 ? importForLoadKwh / physicalImportKwh : 0;
      const saleImmediateShare = physicalExportKwh > 0 ? exportImmediateKwh / physicalExportKwh : 0;
      const billedPurchaseForLoadKwh = billedPurchaseKwh * purchaseLoadShare;
      const billedGridTopupKwh = Math.max(0, billedPurchaseKwh - billedPurchaseForLoadKwh);
      const billedSoldImmediateKwh = billedExportKwh * saleImmediateShare;
      const billedSoldBankKwh = Math.max(0, billedExportKwh - billedSoldImmediateKwh);
      let purchaseRemainderKwh = billedPurchaseKwh;
      let saleRemainderKwh = billedExportKwh;
      let nominalRemainderPln = purchaseNominalPln;
      let cashRemainderPln = purchaseCashPln;
      let usedRemainderPln = depositUsedPln;
      let saleValueRemainderPln = saleValuePln;

      depositPln = Math.max(0, depositPln - depositUsedPln) + saleValuePln;

      totals.physicalGridImportKwh += physicalImportKwh;
      totals.physicalGridExportKwh += physicalExportKwh;
      totals.billedGridPurchaseKwh += billedPurchaseKwh;
      totals.billedGridPurchaseForLoadKwh += billedPurchaseForLoadKwh;
      totals.billedGridTopupKwh += billedGridTopupKwh;
      totals.billedGridExportKwh += billedExportKwh;
      totals.billedSaleValuePln += saleValuePln;
      totals.billedPurchaseNominalPln += purchaseNominalPln;
      totals.billedPurchaseCashPln += purchaseCashPln;
      totals.billedDepositUsedPln += depositUsedPln;
      totals.billedDepositEarnedPln += saleValuePln;

      totals.exportKwh += billedExportKwh;
      totals.soldImmediateKwh += billedSoldImmediateKwh;
      totals.soldImmediatePln += saleValuePln * saleImmediateShare;
      totals.soldBankKwh += billedSoldBankKwh;
      totals.soldBankPln += saleValuePln * (physicalExportKwh > 0 ? exportBankKwh / physicalExportKwh : 0);
      totals.gridPurchaseKwh += billedPurchaseKwh;
      totals.gridPurchaseForLoadKwh += billedPurchaseForLoadKwh;
      totals.gridTopupKwh += billedGridTopupKwh;
      totals.nominalVariableCostPln += purchaseNominalPln;
      totals.cashCostPln += purchaseCashPln;
      totals.topupCashCostPln += purchaseCashPln * (physicalImportKwh > 0 ? importForBankKwh / physicalImportKwh : 0);
      totals.depositUsedPln += depositUsedPln;
      totals.depositEarnedPln += saleValuePln;
      totals.buyOwnKwh += billedPurchaseForLoadKwh;
      totals.buyOwnCashPln += purchaseCashPln * purchaseLoadShare;
      totals.buyOwnFromDepositPln += depositUsedPln * purchaseLoadShare;
      totals.buyOwnNominalPln += purchaseNominalPln * purchaseLoadShare;
      totals.buyBankKwh += billedGridTopupKwh;
      totals.buyBankCashPln += purchaseCashPln * (physicalImportKwh > 0 ? importForBankKwh / physicalImportKwh : 0);
      totals.buyBankFromDepositPln += depositUsedPln * (physicalImportKwh > 0 ? importForBankKwh / physicalImportKwh : 0);
      totals.buyBankNominalPln += purchaseNominalPln * (physicalImportKwh > 0 ? importForBankKwh / physicalImportKwh : 0);

      hourSlots.forEach(function (slot, index) {
        const isLast = index === hourSlots.length - 1;
        const slotPurchaseKwh = isLast ? purchaseRemainderKwh : billedPurchaseKwh / slotCount;
        const slotSaleKwh = isLast ? saleRemainderKwh : billedExportKwh / slotCount;
        const slotNominalPln = isLast ? nominalRemainderPln : purchaseNominalPln / slotCount;
        const slotCashPln = isLast ? cashRemainderPln : purchaseCashPln / slotCount;
        const slotUsedPln = isLast ? usedRemainderPln : depositUsedPln / slotCount;
        const slotSaleValuePln = isLast ? saleValueRemainderPln : saleValuePln / slotCount;

        setSettlementSlotDefaults(slot);
        slot.billedGridPurchaseKwh = slotPurchaseKwh;
        slot.billedGridPurchaseForLoadKwh = slotPurchaseKwh * purchaseLoadShare;
        slot.billedGridTopupKwh = Math.max(0, slotPurchaseKwh - slot.billedGridPurchaseForLoadKwh);
        slot.billedGridExportKwh = slotSaleKwh;
        slot.billedSoldImmediateKwh = slotSaleKwh * saleImmediateShare;
        slot.billedSoldBankKwh = Math.max(0, slotSaleKwh - slot.billedSoldImmediateKwh);
        slot.billedPurchaseNominalPln = slotNominalPln;
        slot.billedPurchaseCashPln = slotCashPln;
        slot.billedDepositUsedPln = slotUsedPln;
        slot.billedDepositEarnedPln = slotSaleValuePln;
        slot.billedSaleValuePln = slotSaleValuePln;
        slot.nominalCostPln = slotNominalPln;
        slot.cashCost = slotCashPln;
        slot.cashCostPln = slotCashPln;
        slot.depositUsed = slotUsedPln;
        slot.depositUsedPln = slotUsedPln;
        slot.depositEarnedPln = slotSaleValuePln;

        purchaseRemainderKwh -= slotPurchaseKwh;
        saleRemainderKwh -= slotSaleKwh;
        nominalRemainderPln -= slotNominalPln;
        cashRemainderPln -= slotCashPln;
        usedRemainderPln -= slotUsedPln;
        saleValueRemainderPln -= slotSaleValuePln;
      });

      if (hourSlots.length) {
        hourSlots[hourSlots.length - 1].depositEnd = depositPln;
      }
    });

    let runningDeposit = Math.max(0, Number(startDepositPln || 0));
    for (let index = 0; index < (resultSlots || []).length; index += 1) {
      const slot = resultSlots[index];
      if (!slot) {
        continue;
      }
      if (slot.actual === false) {
        setSettlementSlotDefaults(slot);
        slot.depositStart = runningDeposit;
        slot.depositEnd = runningDeposit;
        continue;
      }
      slot.depositStart = runningDeposit;
      runningDeposit = Math.max(0, runningDeposit - (slot.billedDepositUsedPln || 0)) + (slot.billedDepositEarnedPln || 0);
      slot.depositEnd = runningDeposit;
    }

    return {
      endDepositPln: runningDeposit
    };
  }

  function simulateDay(input) {
    const options = Object.assign({}, DEFAULTS, input && input.options ? input.options : {});
    const dateKey = input && input.dayStart ? input.dayStart.dateKey : "";
    const slots = input && Array.isArray(input.slots) ? input.slots : [];
    const planningSlots = input && Array.isArray(input.planningSlots) && input.planningSlots.length
      ? input.planningSlots
      : slots;
    const priceProvider = input && input.priceProvider ? input.priceProvider : createPriceProvider({});
    const battery = Object.assign({
      capacityKwh: options.batteryCapacityKwh,
      reserveKwh: options.batteryCapacityKwh * options.reserveSocRatio,
      maxChargePerSlotKwh: options.maxChargeKw * 0.25,
      maxDischargePerSlotKwh: options.maxDischargeKw * 0.25,
      chargeEfficiency: options.chargeEfficiency,
      dischargeEfficiency: options.dischargeEfficiency
    }, input && input.battery ? input.battery : {});
    const controlProvider = priceProvider.controlProvider || priceProvider;
    const policy = computeOptimalPolicy(planningSlots, controlProvider, battery, options);
    const totals = createDayTotals();
    const resultSlots = [];
    let socKwh = clamp(
      policy.states[findClosestSocStateIndex(policy.states, firstNumber(input && input.dayStart && input.dayStart.socKwh, options.initialSocKwh, 0) || 0)],
      0,
      battery.capacityKwh
    );
    let depositPln = Math.max(0, firstNumber(input && input.dayStart && input.dayStart.depositPln, options.initialDepositPln, 0) || 0);
    let cycleCount = Math.max(0, firstNumber(input && input.dayStart && input.dayStart.cycleCount, 0) || 0);

    function payWithDeposit(quantityKwh, price) {
      const energyCostPln = Math.max(0, quantityKwh * (Number(price && price.energyBuyPrice) || 0));
      const distributionCostPln = Math.max(0, quantityKwh * (Number(price && price.distributionBuyPrice) || 0));
      const nominalCostPln = Math.max(0, quantityKwh * (Number(price && price.buyPrice) || 0));
      const depositUsedPln = Math.min(depositPln, energyCostPln);
      depositPln -= depositUsedPln;
      const cashCostPln = Math.max(0, energyCostPln - depositUsedPln) + distributionCostPln;

      totals.nominalVariableCostPln += nominalCostPln;
      totals.cashCostPln += cashCostPln;
      totals.depositUsedPln += depositUsedPln;

      return {
        nominalCostPln: nominalCostPln,
        energyCostPln: energyCostPln,
        distributionCostPln: distributionCostPln,
        depositUsedPln: depositUsedPln,
        cashCostPln: cashCostPln
      };
    }

    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      const slotMeta = policy.planningMeta[index] || buildPlanningMeta([slot], priceProvider)[0];
      const price = priceProvider.controlProvider ? priceProvider.getSlotPrice(dateKey, slot) : (slotMeta ? slotMeta.price : priceProvider.getSlotPrice(dateKey, slot));
      const actual = Boolean(slot.actual);
      const stateIndex = findClosestSocStateIndex(policy.states, socKwh);
      const nextStateIndex = policy.nextStateBySlot[index] ? policy.nextStateBySlot[index][stateIndex] : stateIndex;
      const socEndKwh = policy.states[nextStateIndex];
      const transition = evaluatePlanningTransition(socKwh, socEndKwh, slotMeta, battery);
      const slotResult = {
        index: slot.index,
        dateKey: dateKey,
        hour: slot.hour,
        quarter: slot.quarter,
        label: slot.label,
        slotStart: slot.slotStart || null,
        slotEnd: slot.slotEnd || null,
        timezoneOffsetMinutes: slot.timezoneOffsetMinutes,
        localBucketIndex: slot.localBucketIndex,
        slotOccurrence: slot.slotOccurrence || 0,
        actual: actual,
        load: slot.load,
        pv: slot.pv,
        pvGenerationKwh: slot.pv,
        bankStart: socKwh,
        bankEnd: socKwh,
        depositStart: depositPln,
        depositEnd: depositPln,
        bankStartPercent: battery.capacityKwh > 0 ? (socKwh / battery.capacityKwh) * 100 : 0,
        bankEndPercent: battery.capacityKwh > 0 ? (socKwh / battery.capacityKwh) * 100 : 0,
        gridBuyLoad: 0,
        gridBuyBank: 0,
        bankToLoad: 0,
        bankToSell: 0,
        pvToLoad: 0,
        pvToBank: 0,
        sellImmediate: 0,
        buyPrice: price.buyPrice,
        energyBuyPrice: price.energyBuyPrice,
        distributionBuyPrice: price.distributionBuyPrice,
        sellPrice: price.sellPrice,
        rce: price.rce,
        rdn: price.rdn,
        windowCode: price.windowCode || "all",
        nominalCostPln: 0,
        cashCost: 0,
        cashCostPln: 0,
        depositUsed: 0,
        depositUsedPln: 0,
        depositEarnedPln: 0,
        exportKwh: 0,
        topupKwh: 0,
        chargeFromPvKwh: 0,
        dischargeKwh: 0,
        cycleCount: cycleCount
      };

      if (!actual) {
        resultSlots.push(slotResult);
        continue;
      }

      totals.usageKwh += slot.load;
      totals.generationKwh += slot.pv;
      if (!transition.feasible) {
        resultSlots.push(slotResult);
        continue;
      }

      slotResult.pvToLoad = transition.pvToLoad;
      slotResult.pvToBank = transition.pvToBank;
      slotResult.chargeFromPvKwh = transition.chargeFromPvKwh;
      slotResult.sellImmediate = transition.sellImmediate;
      slotResult.bankToLoad = transition.bankToLoad;
      slotResult.bankToSell = transition.bankToSell;
      slotResult.gridBuyLoad = transition.gridBuyLoad;
      slotResult.gridBuyBank = transition.gridBuyBank;
      slotResult.topupKwh = transition.gridBuyBank;
      slotResult.dischargeKwh = transition.dischargeKwh;

      totals.directPvKwh += transition.pvToLoad;
      totals.chargeFromPvKwh += transition.chargeFromPvKwh;

      if (transition.sellImmediate > 0 && price.sellPrice != null) {
        const immediateEarnedPln = transition.sellImmediate * price.sellPrice;
        depositPln += immediateEarnedPln;
        slotResult.depositEarnedPln += immediateEarnedPln;
        totals.soldImmediateKwh += transition.sellImmediate;
        totals.soldImmediatePln += immediateEarnedPln;
        totals.depositEarnedPln += immediateEarnedPln;
      }

      if (transition.bankToLoad > 0) {
        totals.bankToLoadKwh += transition.bankToLoad;
        totals.dischargeKwh += transition.bankToLoad;
        addZoneValue(totals.dischargeByZone, slotResult.windowCode, transition.bankToLoad);
      }

      if (transition.gridBuyLoad > 0) {
        const loadPayment = payWithDeposit(transition.gridBuyLoad, price);
        slotResult.nominalCostPln += loadPayment.nominalCostPln;
        slotResult.cashCost += loadPayment.cashCostPln;
        slotResult.cashCostPln += loadPayment.cashCostPln;
        slotResult.depositUsed += loadPayment.depositUsedPln;
        slotResult.depositUsedPln += loadPayment.depositUsedPln;
        totals.gridPurchaseKwh += transition.gridBuyLoad;
        totals.gridPurchaseForLoadKwh += transition.gridBuyLoad;
        totals.buyOwnKwh += transition.gridBuyLoad;
        totals.buyOwnCashPln += loadPayment.cashCostPln;
        totals.buyOwnFromDepositPln += loadPayment.depositUsedPln;
        totals.buyOwnNominalPln += loadPayment.nominalCostPln;
      }

      if (transition.gridBuyBank > 0) {
        const topupPayment = payWithDeposit(transition.gridBuyBank, price);
        slotResult.nominalCostPln += topupPayment.nominalCostPln;
        slotResult.cashCost += topupPayment.cashCostPln;
        slotResult.cashCostPln += topupPayment.cashCostPln;
        slotResult.depositUsed += topupPayment.depositUsedPln;
        slotResult.depositUsedPln += topupPayment.depositUsedPln;
        totals.topupKwh += transition.gridBuyBank;
        totals.gridPurchaseKwh += transition.gridBuyBank;
        totals.gridTopupKwh += transition.gridBuyBank;
        totals.buyBankKwh += transition.gridBuyBank;
        totals.buyBankCashPln += topupPayment.cashCostPln;
        totals.buyBankFromDepositPln += topupPayment.depositUsedPln;
        totals.buyBankNominalPln += topupPayment.nominalCostPln;
        totals.topupCashCostPln += topupPayment.cashCostPln;
      }

      if (transition.bankToSell > 0 && price.sellPrice != null) {
        const soldFromBankPln = transition.bankToSell * price.sellPrice;
        depositPln += soldFromBankPln;
        slotResult.depositEarnedPln += soldFromBankPln;
        totals.dischargeKwh += transition.bankToSell;
        addZoneValue(totals.dischargeByZone, slotResult.windowCode, transition.bankToSell);
        totals.soldBankKwh += transition.bankToSell;
        totals.soldBankPln += soldFromBankPln;
        totals.depositEarnedPln += soldFromBankPln;
      }

      socKwh = socEndKwh;
      cycleCount += transition.cycleWithdrawnRawKwh / Math.max(battery.capacityKwh, 0.001);
      slotResult.exportKwh = transition.exportKwh;
      slotResult.bankEnd = socEndKwh;
      slotResult.depositEnd = depositPln;
      slotResult.bankEndPercent = battery.capacityKwh > 0 ? (socEndKwh / battery.capacityKwh) * 100 : 0;
      slotResult.cycleCount = cycleCount;
      totals.exportKwh += slotResult.exportKwh;
      resultSlots.push(slotResult);
    }

    const billingStartDepositPln = firstNumber(input && input.dayStart && input.dayStart.depositPln, options.initialDepositPln, 0) || 0;
    const settlement = applyHourlySettlement(resultSlots, totals, billingStartDepositPln);
    depositPln = settlement.endDepositPln;

    return {
      dateKey: dateKey,
      slots: resultSlots,
      totals: totals,
      startSocKwh: policy.states[findClosestSocStateIndex(policy.states, firstNumber(input && input.dayStart && input.dayStart.socKwh, options.initialSocKwh, 0) || 0)],
      endSocKwh: socKwh,
      startSocPercent: battery.capacityKwh > 0
        ? ((policy.states[findClosestSocStateIndex(policy.states, firstNumber(input && input.dayStart && input.dayStart.socKwh, options.initialSocKwh, 0) || 0)] || 0) / battery.capacityKwh) * 100
        : 0,
      endSocPercent: battery.capacityKwh > 0 ? (socKwh / battery.capacityKwh) * 100 : 0,
      startDepositPln: firstNumber(input && input.dayStart && input.dayStart.depositPln, options.initialDepositPln, 0) || 0,
      endDepositPln: depositPln,
      cycleCountEnd: cycleCount,
      stateOut: {
        socKwh: socKwh,
        depositPln: depositPln,
        cycleCount: cycleCount
      }
    };
  }

  function aggregateSlotsToHours(day, options) {
    return groupSlotsByHour(day.slots || [], true).map(function (hourSlots) {
      const firstSlot = hourSlots.length ? hourSlots[0] : null;
      const lastSlot = hourSlots.length ? hourSlots[hourSlots.length - 1] : firstSlot;
      const aggregate = {
        hour: firstSlot ? firstSlot.hour : 0,
        slotStart: firstSlot ? firstSlot.slotStart : null,
        slotEnd: lastSlot ? lastSlot.slotEnd : null,
        timezoneOffsetMinutes: firstSlot ? firstSlot.timezoneOffsetMinutes : null,
        slotOccurrence: firstSlot ? firstSlot.slotOccurrence : 0,
        dateKey: day.dateKey,
        windowCode: firstSlot ? firstSlot.windowCode : "all",
        totalBuyPricePln: firstSlot ? firstSlot.buyPrice : null,
        energyBuyPricePln: firstSlot ? firstSlot.energyBuyPrice : null,
        distributionBuyPricePln: firstSlot ? firstSlot.distributionBuyPrice : null,
        sellPricePln: firstSlot ? firstSlot.sellPrice : null,
        rcePricePln: firstSlot ? firstSlot.rce : null,
        demandKwh: 0,
        generationKwh: 0,
        directPvKwh: 0,
        chargeFromPvKwh: 0,
        topupKwh: 0,
        dischargeKwh: 0,
        soldImmediateKwh: 0,
        soldBankKwh: 0,
        gridPurchaseForLoadKwh: 0,
        gridTopupKwh: 0,
        gridPurchaseKwh: 0,
        physicalGridImportKwh: 0,
        physicalGridExportKwh: 0,
        billedGridPurchaseKwh: 0,
        billedGridPurchaseForLoadKwh: 0,
        billedGridTopupKwh: 0,
        billedGridExportKwh: 0,
        billedSaleValuePln: 0,
        billedPurchaseNominalPln: 0,
        billedPurchaseCashPln: 0,
        billedDepositUsedPln: 0,
        billedDepositEarnedPln: 0,
        nominalCostPln: 0,
        cashCostPln: 0,
        depositUsedPln: 0,
        depositEarnedPln: 0,
        exportKwh: 0,
        startSocKwh: firstSlot ? firstSlot.bankStart : day.startSocKwh,
        endSocKwh: lastSlot ? lastSlot.bankEnd : day.endSocKwh,
        startDepositPln: firstSlot ? firstSlot.depositStart : day.startDepositPln,
        endDepositPln: lastSlot ? lastSlot.depositEnd : day.endDepositPln,
        socPercent: lastSlot ? lastSlot.bankEndPercent : day.endSocPercent,
        cycleCount: lastSlot ? lastSlot.cycleCount : day.cycleCountEnd
      };

      hourSlots.forEach(function (slot) {
        aggregate.demandKwh += slot.load || 0;
        aggregate.generationKwh += slot.pvGenerationKwh || 0;
        aggregate.directPvKwh += slot.pvToLoad || 0;
        aggregate.chargeFromPvKwh += slot.pvToBank || 0;
        aggregate.topupKwh += slot.gridBuyBank || 0;
        aggregate.dischargeKwh += (slot.bankToLoad || 0) + (slot.bankToSell || 0);
        aggregate.physicalGridImportKwh += slot.physicalGridImportKwh != null ? slot.physicalGridImportKwh : ((slot.gridBuyLoad || 0) + (slot.gridBuyBank || 0));
        aggregate.physicalGridExportKwh += slot.physicalGridExportKwh != null ? slot.physicalGridExportKwh : (slot.exportKwh || 0);
        aggregate.billedGridPurchaseForLoadKwh += slot.billedGridPurchaseForLoadKwh || 0;
        aggregate.billedGridTopupKwh += slot.billedGridTopupKwh || 0;
        aggregate.billedGridPurchaseKwh += slot.billedGridPurchaseKwh || 0;
        aggregate.billedGridExportKwh += slot.billedGridExportKwh || 0;
        aggregate.billedSaleValuePln += slot.billedSaleValuePln || 0;
        aggregate.billedPurchaseNominalPln += slot.billedPurchaseNominalPln || 0;
        aggregate.billedPurchaseCashPln += slot.billedPurchaseCashPln || 0;
        aggregate.billedDepositUsedPln += slot.billedDepositUsedPln || 0;
        aggregate.billedDepositEarnedPln += slot.billedDepositEarnedPln || 0;
        aggregate.soldImmediateKwh += slot.billedSoldImmediateKwh || 0;
        aggregate.soldBankKwh += slot.billedSoldBankKwh || 0;
        aggregate.gridPurchaseForLoadKwh += slot.billedGridPurchaseForLoadKwh || 0;
        aggregate.gridTopupKwh += slot.billedGridTopupKwh || 0;
        aggregate.gridPurchaseKwh += slot.billedGridPurchaseKwh || 0;
        aggregate.nominalCostPln += slot.nominalCostPln || 0;
        aggregate.cashCostPln += slot.cashCostPln || 0;
        aggregate.depositUsedPln += slot.depositUsedPln || 0;
        aggregate.depositEarnedPln += slot.depositEarnedPln || 0;
        aggregate.exportKwh += slot.billedGridExportKwh || 0;
      });

      return aggregate;
    });
  }

  function buildUsageDataset(days) {
    return {
      latestDate: days.length ? days[days.length - 1].dateKey : "",
      totalDays: days.length,
      records: days.map(function (day) {
        return {
          date: day.dateKey,
          quarters: (day.slots || []).map(function (slot) {
            return {
              hour: slot.hour,
              quarter: slot.quarter,
              label: slot.label,
              slotIndex: slot.index,
              localBucketIndex: slot.localBucketIndex,
              slotOccurrence: slot.slotOccurrence,
              slotStart: slot.slotStart,
              slotEnd: slot.slotEnd,
              timezoneOffsetMinutes: slot.timezoneOffsetMinutes,
              grid: roundValue(slot.gridBuyLoad, 4) || 0,
              gridPhysical: roundValue(slot.gridBuyLoad, 4) || 0,
              gridBilled: roundValue(slot.billedGridPurchaseForLoadKwh, 4) || 0,
              importPhysical: roundValue((slot.gridBuyLoad || 0) + (slot.gridBuyBank || 0), 4) || 0,
              importBilled: roundValue(slot.billedGridPurchaseKwh, 4) || 0,
              exportBilled: roundValue(slot.billedGridExportKwh, 4) || 0,
              storage: roundValue(slot.bankToLoad, 4) || 0,
              pv: roundValue(slot.pvToLoad, 4) || 0
            };
          })
        };
      })
    };
  }

  function buildPvDataset(days) {
    function getImmediatePvSaleKwh(slot) {
      const totalExport = firstNumber(slot.billedGridExportKwh, slot.exportKwh, 0) || 0;
      const bankExport = firstNumber(
        slot.billedSoldBankKwh,
        slot.soldBankKwh,
        slot.bankToSell,
        slot.bankToSellKwh,
        slot.dischargeToGridKwh,
        0
      ) || 0;

      return Math.max(0, firstNumber(
        slot.billedSoldImmediateKwh,
        slot.soldImmediateKwh,
        slot.sellImmediate,
        totalExport - bankExport
      ) || 0);
    }

    return {
      latestDate: days.length ? days[days.length - 1].dateKey : "",
      totalDays: days.length,
      records: days.map(function (day) {
        return {
          date: day.dateKey,
          quarters: (day.slots || []).map(function (slot) {
            const immediatePvSaleKwh = getImmediatePvSaleKwh(slot);
            return {
              hour: slot.hour,
              quarter: slot.quarter,
              slotIndex: slot.index,
              localBucketIndex: slot.localBucketIndex,
              slotOccurrence: slot.slotOccurrence,
              slotStart: slot.slotStart,
              slotEnd: slot.slotEnd,
              timezoneOffsetMinutes: slot.timezoneOffsetMinutes,
              production: roundValue(slot.pvGenerationKwh, 4),
              selfUse: roundValue(slot.pvToLoad, 4),
              laterUse: roundValue(slot.pvToBank, 4),
              hourlyBalance: 0,
              sale: roundValue(immediatePvSaleKwh, 4),
              salePhysical: roundValue(immediatePvSaleKwh, 4)
            };
          })
        };
      })
    };
  }

  function aggregateForRange(simulation, rangeWindow) {
    if (!simulation || !rangeWindow) {
      return null;
    }

    const startKey = typeof rangeWindow.start === "string" ? rangeWindow.start : formatDateKey(rangeWindow.start);
    const endKey = typeof rangeWindow.end === "string" ? rangeWindow.end : formatDateKey(rangeWindow.end);
    const totals = createDayTotals();
    let firstDay = null;
    let lastDay = null;

    (simulation.days || []).forEach(function (day) {
      if (day.dateKey < startKey || day.dateKey > endKey) {
        return;
      }
      if (!firstDay) {
        firstDay = day;
      }
      lastDay = day;
      Object.keys(totals).forEach(function (key) {
        if (key === "dischargeByZone") {
          mergeZoneTotals(totals.dischargeByZone, day.totals.dischargeByZone);
          return;
        }
        totals[key] += Number(day.totals[key] || 0);
      });
    });

    if (!firstDay || !lastDay) {
      return null;
    }

    return {
      startDateKey: firstDay.dateKey,
      endDateKey: lastDay.dateKey,
      startSocKwh: firstDay.startSocKwh,
      endSocKwh: lastDay.endSocKwh,
      startSocPercent: firstDay.startSocPercent,
      endSocPercent: lastDay.endSocPercent,
      startDepositPln: firstDay.startDepositPln,
      endDepositPln: lastDay.endDepositPln,
      cycleCountEnd: lastDay.cycleCountEnd,
      totals: totals
    };
  }

  function buildSimulationResult(days, options, battery, cacheStats) {
    const dayMap = {};

    days.forEach(function (day) {
      dayMap[day.dateKey] = day;
    });

    return {
      days: days,
      dayMap: dayMap,
      latestDateKey: days.length ? days[days.length - 1].dateKey : "",
      latestCycleCount: days.length ? days[days.length - 1].cycleCountEnd : 0,
      options: options,
      battery: battery,
      usageDataset: buildUsageDataset(days),
      pvDataset: buildPvDataset(days),
      cacheStats: cacheStats || null,
      getRangeTotals: function (rangeWindow) {
        return aggregateForRange(this, rangeWindow);
      }
    };
  }

  function simulateRange(input) {
    const options = Object.assign({}, DEFAULTS, input && input.options ? input.options : {});
    const daysInput = input && Array.isArray(input.days) ? input.days : [];
    const battery = {
      capacityKwh: firstNumber(input && input.battery && input.battery.capacityKwh, options.batteryCapacityKwh, 10) || 10,
      reserveKwh: firstNumber(
        input && input.battery && input.battery.reserveKwh,
        (firstNumber(input && input.battery && input.battery.capacityKwh, options.batteryCapacityKwh, 10) || 10) * options.reserveSocRatio
      ) || 0,
      maxChargePerSlotKwh: firstNumber(input && input.battery && input.battery.maxChargePerSlotKwh, options.maxChargeKw * 0.25, 1.25) || 1.25,
      maxDischargePerSlotKwh: firstNumber(input && input.battery && input.battery.maxDischargePerSlotKwh, options.maxDischargeKw * 0.25, 1.25) || 1.25,
      chargeEfficiency: firstNumber(input && input.battery && input.battery.chargeEfficiency, options.chargeEfficiency, 0.99) || 0.99,
      dischargeEfficiency: firstNumber(input && input.battery && input.battery.dischargeEfficiency, options.dischargeEfficiency, 0.99) || 0.99
    };
    const priceProvider = input && input.priceProvider ? input.priceProvider : createPriceProvider(Object.assign({}, input, {
      capacityProfilesByDate: input && input.capacityProfilesByDate ? input.capacityProfilesByDate : buildCapacityProfilesByDate(daysInput)
    }));
    let state = {
      socKwh: firstNumber(input && input.dayStart && input.dayStart.socKwh, options.initialSocKwh, 0) || 0,
      depositPln: firstNumber(input && input.dayStart && input.dayStart.depositPln, options.initialDepositPln, 0) || 0,
      cycleCount: firstNumber(input && input.dayStart && input.dayStart.cycleCount, 0) || 0
    };
    const depositStartKey = typeof options.depositStartKey === "string" ? options.depositStartKey.trim().slice(0, 10) : "";
    const depositInitialPln = firstNumber(options.depositInitialPln, options.initialDepositPln, 0) || 0;
    let depositStartApplied = !depositStartKey;
    const days = [];

    daysInput.forEach(function (dayInput, dayIndex) {
      if (depositStartKey && !depositStartApplied && dayInput && dayInput.dateKey >= depositStartKey) {
        state.depositPln = depositInitialPln;
        depositStartApplied = true;
      }

      const planningDays = daysInput.slice(dayIndex, dayIndex + Math.max(1, Number(options.planningHorizonDays || 1)));
      const planningSlots = planningDays.reduce(function (result, planningDay) {
        return result.concat(Array.isArray(planningDay && planningDay.slots) ? planningDay.slots : []);
      }, []);
      const dayResult = simulateDay({
        dayStart: {
          dateKey: dayInput.dateKey,
          socKwh: state.socKwh,
          depositPln: state.depositPln,
          cycleCount: state.cycleCount
        },
        battery: battery,
        deposit: { startPln: state.depositPln },
        tariff: input && input.tariff ? input.tariff : null,
        priceProvider: priceProvider,
        slots: dayInput.slots,
        planningSlots: planningSlots,
        options: options
      });
      dayResult.hours = aggregateSlotsToHours(dayResult, options);
      days.push(dayResult);
      state = dayResult.stateOut;
    });

    return buildSimulationResult(days, options, battery, null);
  }

  const timelineMonthCaches = new Map();

  function updateTimelineHash(hash, value) {
    const text = value == null ? "" : String(value);
    let result = hash >>> 0;

    for (let index = 0; index < text.length; index += 1) {
      result ^= text.charCodeAt(index);
      result = Math.imul(result, 16777619) >>> 0;
    }

    result ^= 124;
    return Math.imul(result, 16777619) >>> 0;
  }

  function getTimelineMonthSignature(daysInput, priceProvider) {
    let hash = 2166136261;
    let slotCount = 0;

    daysInput.forEach(function (day) {
      hash = updateTimelineHash(hash, day && day.dateKey);
      (day && Array.isArray(day.slots) ? day.slots : []).forEach(function (slot) {
        const price = priceProvider.getSlotPrice(day.dateKey, slot);
        slotCount += 1;
        [
          slot.index,
          slot.hour,
          slot.quarter,
          slot.slotStart,
          slot.slotEnd,
          slot.timezoneOffsetMinutes,
          slot.actual ? 1 : 0,
          slot.load,
          slot.pv,
          price && price.buyPrice,
          price && price.energyBuyPrice,
          price && price.distributionBuyPrice,
          price && price.sellPrice,
          price && price.rce,
          price && price.rdn,
          price && price.windowCode
        ].forEach(function (value) {
          hash = updateTimelineHash(hash, value);
        });
      });
    });

    return slotCount + ":" + hash.toString(16);
  }

  function getTimelineStateSignature(state) {
    return [
      Number(state && state.socKwh || 0),
      Number(state && state.depositPln || 0),
      Number(state && state.cycleCount || 0)
    ].join("|");
  }

  function getTimelineMonthKey(dateKey) {
    return typeof dateKey === "string" ? dateKey.slice(0, 7) : "";
  }

  function getTimelineCacheConfigSignature(options, battery) {
    return JSON.stringify({
      options: options,
      battery: battery
    });
  }

  function getTimelineMonthCache(cacheKey, configSignature) {
    const existing = timelineMonthCaches.get(cacheKey);

    if (existing && existing.configSignature === configSignature) {
      return existing;
    }

    const cache = {
      configSignature: configSignature,
      months: new Map(),
      days: new Map()
    };
    timelineMonthCaches.set(cacheKey, cache);
    return cache;
  }

  function getSimulationStateAfterDays(days, fallbackState) {
    const lastDay = days.length ? days[days.length - 1] : null;
    return lastDay && lastDay.stateOut ? {
      socKwh: lastDay.stateOut.socKwh,
      depositPln: lastDay.stateOut.depositPln,
      cycleCount: lastDay.stateOut.cycleCount
    } : Object.assign({}, fallbackState);
  }

  function runTimeline(context) {
    const payload = context && context.payload ? context.payload : {};
    const options = Object.assign({}, DEFAULTS, context && context.options ? context.options : {});
    const usageMap = buildUsageMap(payload && payload.usageData ? payload.usageData : null);
    const usageDates = Array.from(usageMap.keys()).sort();
    if (!usageDates.length) {
      return null;
    }

    const weatherMap = buildWeatherMap(payload && payload.weatherData ? payload.weatherData : null);
    const simulationStartDate = parseDateKey(options.simulationStartKey) || parseDateKey(usageDates[0]);
    const simulationEndDate = parseDateKey(usageDates[usageDates.length - 1]);
    if (!simulationStartDate || !simulationEndDate || simulationStartDate.getTime() > simulationEndDate.getTime()) {
      return null;
    }

    const tariffData = payload && payload.tariffData ? payload.tariffData : null;
    const tariff = context && context.tariff ? context.tariff : (tariffData && (tariffData.next || tariffData.current) ? (tariffData.next || tariffData.current) : null);
    const battery = {
      capacityKwh: firstNumber(context && context.battery && context.battery.capacityKwh, options.batteryCapacityKwh, 10) || 10,
      reserveKwh: firstNumber(
        context && context.battery && context.battery.reserveKwh,
        (firstNumber(context && context.battery && context.battery.capacityKwh, options.batteryCapacityKwh, 10) || 10) * options.reserveSocRatio
      ) || 0,
      maxChargePerSlotKwh: firstNumber(context && context.battery && context.battery.maxChargePerSlotKwh, options.maxChargeKw * 0.25, 1.25) || 1.25,
      maxDischargePerSlotKwh: firstNumber(context && context.battery && context.battery.maxDischargePerSlotKwh, options.maxDischargeKw * 0.25, 1.25) || 1.25,
      chargeEfficiency: firstNumber(context && context.battery && context.battery.chargeEfficiency, options.chargeEfficiency, 0.99) || 0.99,
      dischargeEfficiency: firstNumber(context && context.battery && context.battery.dischargeEfficiency, options.dischargeEfficiency, 0.99) || 0.99
    };
    const initialState = {
      socKwh: firstNumber(context && context.dayStart && context.dayStart.socKwh, options.initialSocKwh, 0) || 0,
      depositPln: firstNumber(context && context.dayStart && context.dayStart.depositPln, options.initialDepositPln, 0) || 0,
      cycleCount: firstNumber(context && context.dayStart && context.dayStart.cycleCount, 0) || 0
    };
    const daysInput = [];

    for (let currentDate = new Date(simulationStartDate); currentDate.getTime() <= simulationEndDate.getTime(); currentDate = addDays(currentDate, 1)) {
      const dateKey = formatDateKey(currentDate);
      const usageRecord = usageMap.get(dateKey) || null;
      const weatherSeries = weatherMap.get(dateKey) || createQuarterArray(function () { return null; });
      const actualSlotLimit = getActualSlotLimitForDay(dateKey, payload, usageRecord);
      daysInput.push({
        dateKey: dateKey,
        slots: buildDaySlots(dateKey, usageRecord, weatherSeries, options, actualSlotLimit)
      });
    }

    const priceProvider = createPriceProvider({
      tariff: tariff,
      tariffHistory: context && context.useActualTariffHistory ? payload.tariffHistory : null,
      priceHistory: payload && payload.priceHistory ? payload.priceHistory : null,
      currentRce: payload && payload.rce ? payload.rce : null,
      connectionPowerKw: resolveConnectionPowerKw(context),
      capacityProfilesByDate: buildCapacityProfilesByDate(daysInput)
    });

    const monthGroups = [];
    daysInput.forEach(function (day) {
      const monthKey = getTimelineMonthKey(day.dateKey);
      let group = monthGroups.length ? monthGroups[monthGroups.length - 1] : null;
      if (!group || group.monthKey !== monthKey) {
        group = { monthKey: monthKey, days: [] };
        monthGroups.push(group);
      }
      group.days.push(day);
    });

    const cacheKey = String(context && context.cacheKey ? context.cacheKey : "default");
    const cache = getTimelineMonthCache(cacheKey, getTimelineCacheConfigSignature(options, battery));
    const currentMonthKey = formatDateKey(new Date()).slice(0, 7);
    const planningLookaheadDays = Math.max(0, Math.ceil(Number(options.planningHorizonDays || 1)) - 1);
    const resultDays = [];
    const cacheStats = {
      reusedMonths: 0,
      reusedDays: 0,
      calculatedMonths: 0,
      calculatedDays: 0
    };
    let state = initialState;

    monthGroups.forEach(function (group, groupIndex) {
      const followingDays = [];
      for (let nextIndex = groupIndex + 1; nextIndex < monthGroups.length && followingDays.length < planningLookaheadDays; nextIndex += 1) {
        followingDays.push.apply(followingDays, monthGroups[nextIndex].days.slice(0, planningLookaheadDays - followingDays.length));
      }

      if (group.monthKey === currentMonthKey) {
        const hasCurrentMonthDayCache = group.days.some(function (day) {
          return cache.days.has(day.dateKey);
        });

        if (!hasCurrentMonthDayCache) {
          const simulationDays = group.days.concat(followingDays);
          const depositStartKey = typeof options.depositStartKey === "string" ? options.depositStartKey : "";
          const monthOptions = Object.assign({}, options, {
            depositStartKey: depositStartKey &&
              depositStartKey >= group.days[0].dateKey &&
              depositStartKey <= group.days[group.days.length - 1].dateKey
              ? depositStartKey
              : ""
          });
          const monthStartState = Object.assign({}, state);
          const monthSimulation = simulateRange({
            dayStart: state,
            battery: battery,
            tariff: tariff,
            priceProvider: priceProvider,
            days: simulationDays,
            options: monthOptions
          });
          const monthDays = monthSimulation.days.slice(0, group.days.length);
          state = getSimulationStateAfterDays(monthDays, state);
          resultDays.push.apply(resultDays, monthDays);
          cacheStats.calculatedMonths += 1;
          cacheStats.calculatedDays += group.days.length;

          let dayStartState = monthStartState;
          monthDays.forEach(function (resultDay, dayIndex) {
            const isCompletedDay = resultDay.dateKey < usageDates[usageDates.length - 1];
            if (isCompletedDay) {
              const dayFollowingDays = group.days
                .slice(dayIndex + 1, dayIndex + 1 + planningLookaheadDays)
                .concat(followingDays)
                .slice(0, planningLookaheadDays);
              cache.days.set(resultDay.dateKey, {
                sourceSignature: getTimelineMonthSignature([group.days[dayIndex]].concat(dayFollowingDays), priceProvider),
                startStateSignature: getTimelineStateSignature(dayStartState),
                endState: getSimulationStateAfterDays([resultDay], dayStartState),
                day: resultDay
              });
            }
            dayStartState = getSimulationStateAfterDays([resultDay], dayStartState);
          });
          return;
        }

        group.days.forEach(function (day, dayIndex) {
          const dayFollowingDays = group.days
            .slice(dayIndex + 1, dayIndex + 1 + planningLookaheadDays)
            .concat(followingDays)
            .slice(0, planningLookaheadDays);
          const simulationDays = [day].concat(dayFollowingDays);
          const sourceSignature = getTimelineMonthSignature(simulationDays, priceProvider);
          const startStateSignature = getTimelineStateSignature(state);
          const cachedDay = cache.days.get(day.dateKey);
          const isCompletedDay = day.dateKey < usageDates[usageDates.length - 1];

          if (
            isCompletedDay &&
            cachedDay &&
            cachedDay.sourceSignature === sourceSignature &&
            cachedDay.startStateSignature === startStateSignature
          ) {
            resultDays.push(cachedDay.day);
            state = Object.assign({}, cachedDay.endState);
            cacheStats.reusedDays += 1;
            return;
          }

          const depositStartKey = typeof options.depositStartKey === "string" ? options.depositStartKey : "";
          const dayOptions = Object.assign({}, options, {
            depositStartKey: depositStartKey === day.dateKey ? depositStartKey : ""
          });
          const daySimulation = simulateRange({
            dayStart: state,
            battery: battery,
            tariff: tariff,
            priceProvider: priceProvider,
            days: simulationDays,
            options: dayOptions
          });
          const resultDay = daySimulation.days[0];
          state = getSimulationStateAfterDays(resultDay ? [resultDay] : [], state);
          if (resultDay) {
            resultDays.push(resultDay);
          }
          cacheStats.calculatedDays += 1;

          if (isCompletedDay && resultDay) {
            cache.days.set(day.dateKey, {
              sourceSignature: sourceSignature,
              startStateSignature: startStateSignature,
              endState: Object.assign({}, state),
              day: resultDay
            });
          }
        });
        cacheStats.calculatedMonths += 1;
        return;
      }

      const simulationDays = group.days.concat(followingDays);
      const sourceSignature = getTimelineMonthSignature(simulationDays, priceProvider);
      const startStateSignature = getTimelineStateSignature(state);
      const cachedMonth = cache.months.get(group.monthKey);
      const isClosedMonth = group.monthKey < currentMonthKey;

      if (
        isClosedMonth &&
        cachedMonth &&
        cachedMonth.sourceSignature === sourceSignature &&
        cachedMonth.startStateSignature === startStateSignature
      ) {
        resultDays.push.apply(resultDays, cachedMonth.days);
        state = Object.assign({}, cachedMonth.endState);
        cacheStats.reusedMonths += 1;
        return;
      }

      const depositStartKey = typeof options.depositStartKey === "string" ? options.depositStartKey : "";
      const chunkOptions = Object.assign({}, options, {
        depositStartKey: depositStartKey &&
          depositStartKey >= group.days[0].dateKey &&
          depositStartKey <= group.days[group.days.length - 1].dateKey
          ? depositStartKey
          : ""
      });
      const chunkSimulation = simulateRange({
        dayStart: state,
        battery: battery,
        tariff: tariff,
        priceProvider: priceProvider,
        days: simulationDays,
        options: chunkOptions
      });
      const monthDays = chunkSimulation.days.slice(0, group.days.length);
      state = getSimulationStateAfterDays(monthDays, state);
      resultDays.push.apply(resultDays, monthDays);
      cacheStats.calculatedMonths += 1;
      cacheStats.calculatedDays += group.days.length;

      if (isClosedMonth) {
        cache.months.set(group.monthKey, {
          sourceSignature: sourceSignature,
          startStateSignature: startStateSignature,
          endState: Object.assign({}, state),
          days: monthDays
        });
      }
    });

    return buildSimulationResult(resultDays, options, battery, cacheStats);
  }

  window.DashboardProsumerEngine = {
    createPriceProvider: createPriceProvider,
    simulateDay: simulateDay,
    simulateRange: simulateRange,
    runTimeline: runTimeline,
    aggregateForRange: aggregateForRange
  };
}());
