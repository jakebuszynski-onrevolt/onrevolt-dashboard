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
