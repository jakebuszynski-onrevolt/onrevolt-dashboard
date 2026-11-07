(function (root) {
  'use strict';

  const YEAR_PROFILE_CACHE = new Map();
  const MAX_CACHED_YEARS = 4;
  const PROJECTION_VERSION = 1;
  const DAY_MS = 24 * 60 * 60 * 1000;

  function requireAnnualKwh(value) {
    const annualKwh = Number(value);
    if (!Number.isFinite(annualKwh) || annualKwh < 0) {
      throw new Error('Brak poprawnej rocznej deklaracji przy profilu referencyjnym.');
    }
    return annualKwh;
  }

  function dateKeysForYear(year) {
    if (!Number.isInteger(year) || year < 100 || year > 9999) {
      throw new Error('Nieprawidłowy rok profilu referencyjnego.');
    }
    const count = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(Date.UTC(year, 0, index + 1));
      return `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    });
  }

  function validateRow(row) {
    if (row == null) return null;
    if (typeof row !== 'object' || Array.isArray(row) || Number(row.projectionVersion) !== PROJECTION_VERSION) {
      throw new Error('Nieprawidłowa wersja wybranego profilu referencyjnego RE.');
    }
    return row;
  }

  function legacyMonthly(annualKwh, year) {
    const daysInYear = dateKeysForYear(year).length;
    return Array.from({ length: 12 }, (_, monthIndex) => {
      const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
      return annualKwh * days / daysInYear;
    });
  }

  function buildYear(rowInput, year) {
    const row = validateRow(rowInput);
    if (row === null) return null;
    const annualKwh = row.annualKwh == null ? null : requireAnnualKwh(row.annualKwh);
    if (row.profile == null) {
      return { selected: false, profileKey: null, annualKwh, monthlyKwh: annualKwh == null ? null : legacyMonthly(annualKwh, year),
        annualWeight: null, days: null, method: null, notes: [] };
    }
    if (typeof row.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.contentHash)
      || !row.profile || typeof row.profile.key !== 'string' || !Array.isArray(row.profile.series)) {
      throw new Error('Nieprawidłowe dane wybranego profilu referencyjnego RE.');
    }
    if (annualKwh === null) throw new Error('Brak rocznego zużycia dla wybranego profilu referencyjnego RE.');
    if (typeof root.buildReferenceProfileProjection !== 'function') {
      throw new Error('Nie załadowano projekcji profilu referencyjnego RE.');
    }

    const cacheKey = `${row.contentHash}/${year}/${annualKwh}`;
    if (YEAR_PROFILE_CACHE.has(cacheKey)) return YEAR_PROFILE_CACHE.get(cacheKey);
    const dates = dateKeysForYear(year);
    const projection = root.buildReferenceProfileProjection(row.profile, dates);
    if (!projection || !Array.isArray(projection.days) || projection.days.length !== dates.length) {
      throw new Error('Projekcja wybranego profilu RE nie obejmuje całego roku.');
    }

    const days = new Map();
    const monthlyWeight = new Array(12).fill(0);
    let annualWeight = 0;
    projection.days.forEach((day, index) => {
      if (!day || day.date !== dates[index] || !Array.isArray(day.hours) || day.hours.length !== 24
        || day.hours.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        throw new Error(`Nieprawidłowe godziny w profilu referencyjnym RE dla ${dates[index]}.`);
      }
      const hours = day.hours.slice();
      const total = hours.reduce((sum, value) => sum + value, 0);
      if (!Number.isFinite(total) || total < 0 || !Number.isInteger(day.month) || day.month < 1 || day.month > 12) {
        throw new Error(`Nieprawidłowa suma dobowa profilu referencyjnego RE dla ${day.date}.`);
      }
      days.set(day.date, hours);
      monthlyWeight[day.month - 1] += total;
      annualWeight += total;
    });
    if (!Number.isFinite(annualWeight) || annualWeight <= 0) {
      throw new Error('Wybrany profil referencyjny RE nie ma dodatniej sumy rocznej.');
    }
    const monthlyKwh = monthlyWeight.map(weight => weight * annualKwh / annualWeight);
    const correction = annualKwh - monthlyKwh.reduce((sum, value) => sum + value, 0);
    const correctionMonth = monthlyWeight.indexOf(Math.max(...monthlyWeight));
    monthlyKwh[correctionMonth] += correction;
    if (!Number.isFinite(monthlyKwh[correctionMonth]) || monthlyKwh[correctionMonth] < 0) {
      throw new Error('Roczny profil referencyjny RE wygenerował nieprawidłową korektę miesięczną.');
    }
    const value = { selected: true, profileKey: row.profile.key, profileName: row.profile.name,
      annualKwh, monthlyKwh, monthlyWeight, annualWeight, days,
      method: projection.method, notes: projection.notes || [] };
    YEAR_PROFILE_CACHE.set(cacheKey, value);
    while (YEAR_PROFILE_CACHE.size > MAX_CACHED_YEARS) YEAR_PROFILE_CACHE.delete(YEAR_PROFILE_CACHE.keys().next().value);
    return value;
  }

  function getDayInputs(row, dayKey) {
    if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
      throw new Error('Nieprawidłowa data przy odczycie profilu referencyjnego RE.');
    }
    const yearProfile = buildYear(row, Number(dayKey.slice(0, 4)));
    if (yearProfile === null) return null;
    if (!yearProfile.selected) {
      return { referenceProfileSelected: false, referenceAnnualKwh: yearProfile.annualKwh,
        referenceMonthlyKwh: yearProfile.monthlyKwh };
    }
    const referenceHours24 = yearProfile.days.get(dayKey);
    if (!referenceHours24) throw new Error(`Brak daty ${dayKey} w wybranym profilu referencyjnym RE.`);
    return { referenceProfileSelected: true, referenceHours24: referenceHours24.slice(),
      referenceMonthWeight: yearProfile.monthlyWeight[Number(dayKey.slice(5, 7)) - 1],
      referenceAnnualWeight: yearProfile.annualWeight, referenceAnnualKwh: yearProfile.annualKwh };
  }

  root.REReferenceProfile = Object.freeze({ buildYear, getDayInputs, dateKeysForYear });
}(typeof window !== 'undefined' ? window : globalThis));
