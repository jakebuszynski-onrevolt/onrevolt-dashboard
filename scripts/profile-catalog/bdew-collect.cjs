#!/usr/bin/env node
'use strict';

// Rebuild the local BDEW profile catalog from the downloaded, unmodified source files.
// The collector reads spreadsheets only; it never executes workbook content or macros.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '..', '..');
const outDir = path.join(root, 'output', 'profile-catalog-20261106', 'bdew');
const currentFile = path.join(outDir, 'bdew-2025.xlsx');
const guideFile = path.join(outDir, 'bdew-2025-application-guide.pdf');
const legacyFile = path.join(outDir, 'legacy-extracted', fs.readdirSync(path.join(outDir, 'legacy-extracted')).find(n => /^Repr.*Profile.*\.xls$/i.test(n)));
const retrievalFile = path.join(outDir, 'retrieval.json');
if (!fs.existsSync(retrievalFile)) {
  fs.writeFileSync(retrievalFile, JSON.stringify({ retrievedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
}
const retrievedAt = JSON.parse(fs.readFileSync(retrievalFile, 'utf8')).retrievedAt;
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const workbooks = {
  current: XLSX.readFile(currentFile, { cellDates: false, cellFormula: false }),
  legacy: XLSX.readFile(legacyFile, { cellDates: false, cellFormula: false }),
};

const sources = [
  {
    key: 'bdew-standard-load-profiles-2025',
    title: 'Aktualisierte BDEW-Standardlastprofile Strom (2025)',
    publisher: 'BDEW',
    url: 'https://www.bdew.de/energie/standardlastprofile-strom/',
    downloadUrl: 'https://www.bdew.de/media/documents/Kopie_von_Repr%C3%A4sentative_Profile_BDEW_H25_G25_L25_P25_S25_Ver%C3%B6ffentlichung.xlsx',
    retrievedAt,
    license: 'UNVERIFIED',
    sha256: sha(currentFile),
    notes: 'Official 2025 workbook. The G25 sheet states exactly: "Bei Ausrollen der Profile ist die Dynamisierungsfunktion nicht anzuwenden!" The official application guide independently says not to apply dynamicization to G25. Profiles are normalized to 1 million kWh annual consumption; H25/P25/S25 require dynamicization, while G25/L25 do not. P25/S25 require SOT synchronization. Catalog retains the native month × day type × quarter-hour numeric pattern and does not expand to calendar dates. Review status CANDIDATE; country DE.',
  },
  {
    key: 'bdew-standard-load-profiles-2025-application-guide',
    title: 'Hinweise zu den aktualisierten Standardlastprofilen Strom (2025)',
    publisher: 'BDEW',
    url: 'https://www.bdew.de/energie/standardlastprofile-strom/',
    downloadUrl: 'https://www.bdew.de/media/documents/2025-03-17_AWH_Aktualisierte_SLP_Strom_2025_Ver%C3%B6ffentlichung.pdf',
    retrievedAt,
    license: 'UNVERIFIED',
    sha256: sha(guideFile),
    notes: 'Official application guide, sections 2.1-2.5. H25/P25/S25 are stated to need dynamicization; G25/L25 explicitly state it must not be applied. Confirms the workbook annotations for G25/L25; an earlier generated G25 dynamicization flag was a collector metadata error. P25/S25 require SOT-side consideration of self-supply. Review status CANDIDATE; country DE.',
  },
  {
    key: 'vdew-standard-load-profiles-1999-2000',
    title: 'VDEW-Standardlastprofile Strom (1999/2000)',
    publisher: 'VDEW (now BDEW)',
    url: 'https://www.bdew.de/energie/standardlastprofile-strom/',
    downloadUrl: 'https://www.bdew.de/media/documents/Profile.zip',
    retrievedAt,
    license: 'UNVERIFIED',
    sha256: sha(path.join(outDir, 'vdew-1999-2000.zip')),
    notes: 'Official legacy ZIP. Profiles are tabulated in W in the source workbook, with three seasons and Saturday/Sunday/weekday patterns. The source workbook and ZIP are preserved; no annual expansion is generated. Review status CANDIDATE; country DE.',
  },
];

const profiles = [];
function append2025(code, category, name) {
  const sheet = workbooks.current.Sheets[code];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const series = [];
  for (let col = 2; col < rows[2].length; col++) {
    const monthSerial = rows[2][col];
    if (typeof monthSerial !== 'number') continue;
    const monthDate = new Date(Date.UTC(1899, 11, 30) + monthSerial * 86400000);
    const dayType = rows[3][col];
    for (let row = 4; row < 100; row++) {
      const label = rows[row]?.[1];
      const value = rows[row]?.[col];
      if (typeof value !== 'number') continue;
      const [start, end] = String(label).split('-');
      series.push({ month: monthDate.getUTCMonth() + 1, dayType, slot: start, slotEnd: end, value });
    }
  }
  profiles.push({
    key: `bdew-2025-${code.toLowerCase()}`, sourceKey: 'bdew-standard-load-profiles-2025', name, category,
    kind: 'STANDARD_PATTERN', quantity: code === 'P25' ? 'grid_import_with_pv' : code === 'S25' ? 'grid_import_with_pv_storage' : 'relative_load',
    unit: 'kWh',
    timeBasis: 'TYPICAL_DAY', resolutionMinutes: 15, start: null, end: null,
    series,
    metadata: { reviewStatus: 'CANDIDATE', country: 'DE', sourceSheet: code, sourceUnit: '[kWh]', annualNormalization: '1,000,000 kWh', monthHeader: 'Excel date in header; month retained', dayTypeCodes: { SA: 'Saturday', FT: 'Sunday/holiday', WT: 'Weekday' }, dynamicizationRequired: ['H25', 'P25', 'S25'].includes(code), dynamicizationAuthority: '2025 BDEW application guide, sections 2.1-2.5; G25 and L25 explicitly say not to apply dynamicization', sotSynchronizationRequired: ['P25', 'S25'].includes(code), slotSemantics: 'interval_start' },
    quality: { expectedPoints: 12 * 3 * 96, actualPoints: series.length, complete: series.length === 12 * 3 * 96, numeric: series.every(p => Number.isFinite(p.value)), calendarExpanded: false },
  });
}

function appendLegacy(code) {
  const sheet = workbooks.legacy.Sheets[code];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const title = String(rows[0]?.[0] || code).trim();
  const series = [];
  const seasonStarts = [1, 4, 7];
  const seasons = ['winter', 'summer', 'transition'];
  const dayTypes = ['Saturday', 'Sunday', 'Weekday'];
  for (let si = 0; si < 3; si++) {
    for (let di = 0; di < 3; di++) {
      const col = seasonStarts[si] + di;
      for (let row = 3; row < 99; row++) {
        const slot = rows[row]?.[0];
        const value = rows[row]?.[col];
        if (typeof value !== 'number') continue;
        const minutes = Math.round(Number(slot) * 24 * 60);
        const hhmm = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
        series.push({ season: seasons[si], dayType: dayTypes[di], slot: hhmm, dayOffset: minutes === 0 ? 1 : 0, value });
      }
    }
  }
  profiles.push({
    key: `vdew-1999-${code.toLowerCase()}`, sourceKey: 'vdew-standard-load-profiles-1999-2000', name: title,
    category: code.startsWith('G') ? 'business' : code.startsWith('L') ? 'agriculture' : 'household',
    kind: 'STANDARD_PATTERN', quantity: 'load', unit: 'W',
    timeBasis: 'TYPICAL_DAY', resolutionMinutes: 15, start: null, end: null,
    series,
    metadata: { reviewStatus: 'CANDIDATE', country: 'DE', sourceSheet: code, seasons, dayTypes, annualNormalizationKwh: 1000, normalization: 'Source workbook labels the profiles as quarter-hour power values for annual consumption 1,000 kWh/a; values preserved as published without annual/calendar scaling', slotSemantics: 'interval_end', intervalDescription: 'Source time labels run 00:15 through 00:00; each value is associated with the preceding 15-minute interval. Final 00:00 is the next day boundary and is marked dayOffset: 1.' },
    quality: { expectedPoints: 3 * 3 * 96, actualPoints: series.length, complete: series.length === 3 * 3 * 96, numeric: series.every(p => Number.isFinite(p.value)), calendarExpanded: false },
  });
}

for (const [code, category, name] of [
  ['H25', 'household', 'Household'], ['G25', 'business', 'General business'],
  ['L25', 'agriculture', 'Agriculture'], ['P25', 'prosumer_pv', 'Combination profile with PV'],
  ['S25', 'prosumer_storage_pv', 'Combination profile with storage and PV'],
]) append2025(code, category, name);

for (const code of ['H0', 'G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'L0', 'L1', 'L2']) appendLegacy(code);

const catalog = { sources, profiles };
for (const p of profiles) {
  if (!p.quality.complete || !p.quality.numeric) throw new Error(`Profile validation failed: ${p.key}`);
}
fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ sources: sources.map(s => ({ key: s.key, sha256: s.sha256 })), profiles: profiles.map(p => ({ key: p.key, points: p.series.length, complete: p.quality.complete })) }, null, 2));
