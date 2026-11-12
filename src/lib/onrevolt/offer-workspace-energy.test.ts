import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOfferWorkspaceEnergy } from './offer-workspace-energy';
import type { OfferMeasurementInterval } from './offer-measurements';

function interval(start: string, local: string, imported: number | null, exported: number | null, minutes = 60): OfferMeasurementInterval {
  const end = new Date(Date.parse(start) + minutes * 60_000).toISOString();
  const source = (value: number | null) => value == null ? null : { valueKwh: value, source: 'measured' as const, fileIds: ['file'] };
  return { startUtc: start, endUtc: end, localStart: local, localEnd: end, occurrence: 1, import: source(imported), export: source(exported) };
}
function input() {
  return {
    intervals: [interval('2026-01-01T11:00:00.000Z', '2026-01-01T12:00:00+01:00', 2, 1)],
    months: [{ period: '2026-01', importKwh: 2, exportKwh: 1 }],
    dayProfiles: [{ date: '2026-01-01', period: '2026-01', dayType: 'free' as const, hours: [{ hour: 12, importKwh: 2, exportKwh: 1 }] }],
    pvHours: [{ startUtc: '2026-01-01T11:00:00.000Z', pvKwh: 4 }],
    noPv: false, existingBatteryPresent: false, source: 'test', model: 'test',
  };
}
test('offer energy uses shared RE import plus PV self-consumption, not import as total load', () => {
  const result = buildOfferWorkspaceEnergy(input());
  assert.deepEqual(result.totals, { loadKwh: 5, pvKwh: 4, directKwh: 3 });
  assert.equal(result.dayProfiles[0].hours[0].loadKwh, 5);
  assert.equal(result.quality, 'MODELLED');
});
test('unknown or present battery does not produce an unsupported load reconstruction', () => {
  for (const existingBatteryPresent of [null, true]) {
    const result = buildOfferWorkspaceEnergy({ ...input(), existingBatteryPresent });
    assert.equal(result.totals.loadKwh, null);
    assert.equal(result.totals.directKwh, null);
    assert.equal(result.totals.pvKwh, 4);
    assert.equal(result.issues.length, 1);
  }
});
test('missing export is not replaced by zero for PV installations', () => {
  const data = input();
  data.intervals[0].export = null;
  const result = buildOfferWorkspaceEnergy(data);
  assert.equal(result.totals.loadKwh, null);
});

test('operator estimated readings remain usable with explicit provenance, not missing hours', () => {
  const data = input();
  data.intervals[0].import!.source = 'estimated';
  data.intervals[0].export!.source = 'estimated';
  const result = buildOfferWorkspaceEnergy(data);
  assert.deepEqual(result.totals, { loadKwh: 5, pvKwh: 4, directKwh: 3 });
  assert.equal(result.intervals![0].importKwh, 2);
  assert.equal(result.intervals![0].exportKwh, 1);
  assert.ok(result.issues.some(issue => issue.includes('operatora: 1 godz.')));
});

test('estimated quarter is summed once and marks the containing hour as estimated', () => {
  const data = input();
  data.intervals = [0, 15, 30, 45].map(minute => interval(`2026-01-01T11:${String(minute).padStart(2, '0')}:00.000Z`, `2026-01-01T12:${String(minute).padStart(2, '0')}:00+01:00`, 0.5, 0.25, 15));
  data.intervals[1].import!.source = 'estimated';
  const result = buildOfferWorkspaceEnergy(data);
  assert.equal(result.intervals![0].importKwh, 2);
  assert.equal(result.totals.loadKwh, 5);
  assert.ok(result.issues.some(issue => issue.includes('operatora: 1 godz.')));
  data.intervals[1].export = null;
  assert.equal(buildOfferWorkspaceEnergy(data).totals.loadKwh, null);
});

test('operator estimates without PV are not labelled as a PV model', () => {
  const data = input();
  data.intervals[0].import!.source = 'estimated';
  data.intervals[0].export = null;
  const result = buildOfferWorkspaceEnergy({ ...data, noPv: true, pvHours: [] });
  assert.equal(result.quality, 'MEASURED_IMPORT');
  assert.equal(result.totals.loadKwh, 2);
  assert.ok(result.issues.some(issue => issue.includes('szacowane przez operatora')));
});

test('CRM gap estimates remain labelled MODELLED even without PV and are not described as OSD estimates', () => {
  const data = input();
  data.intervals[0].import!.source = 'modelled';
  data.intervals[0].export = null;
  const result = buildOfferWorkspaceEnergy({ ...data, noPv: true, pvHours: [] });
  assert.equal(result.quality, 'MODELLED');
  assert.equal(result.totals.loadKwh, 2);
  assert.match(result.source, /Model CRM/);
  assert.ok(result.issues.some(issue => issue.includes('Model CRM: 1 godz.')));
  assert.ok(!result.issues.some(issue => issue.includes('szacowane przez operatora')));
});
test('model versus observed export discrepancy is explicit and follows RE clipping', () => {
  const data = input();
  data.pvHours[0].pvKwh = 0.25;
  const result = buildOfferWorkspaceEnergy(data);
  assert.equal(result.totals.loadKwh, 2);
  assert.equal(result.totals.directKwh, 0);
  assert.equal(result.modelBelowExportKwh, 0.75);
  assert.equal(result.issues.length, 1);
});

test('accepted reconstruction preserves measured import/export and balances estimated PV/load', () => {
  const data = input();
  data.pvHours[0].pvKwh = 0.25;
  const raw = buildOfferWorkspaceEnergy(data);
  const result = buildOfferWorkspaceEnergy({ ...data, acceptMeasuredExportReconstruction: true });
  assert.equal(raw.totals.pvKwh, 0.25);
  assert.equal(result.totals.pvKwh, 1);
  assert.equal(result.totals.loadKwh, 2);
  assert.equal(result.totals.directKwh, 0);
  assert.equal(result.modelBelowExportKwh, 0.75);
  const row = result.intervals![0];
  assert.equal(row.pvKwh! + row.importKwh!, row.loadKwh! + row.exportKwh!);
  assert.ok(result.issues.some(issue => issue.includes('Zaakceptowany model')));
  assert.equal(result.quality, 'MODELLED');
});
test('quarter-hour profile conserves the hourly model energy', () => {
  const data = input();
  data.intervals = [0, 15, 30, 45].map(minute => interval(`2026-01-01T11:${String(minute).padStart(2, '0')}:00.000Z`, `2026-01-01T12:${String(minute).padStart(2, '0')}:00+01:00`, 0.5, 0.25, 15));
  assert.deepEqual(buildOfferWorkspaceEnergy(data).totals, { loadKwh: 5, pvKwh: 4, directKwh: 3 });
});
test('quarter export peaks are aggregated before RE clipping, matching the hourly model', () => {
  const data = input();
  data.intervals = [0, 15, 30, 45].map(minute => interval(`2026-01-01T11:${String(minute).padStart(2, '0')}:00.000Z`, `2026-01-01T12:${String(minute).padStart(2, '0')}:00+01:00`, 0.5, minute === 0 ? 2 : 0, 15));
  const result = buildOfferWorkspaceEnergy(data);
  assert.equal(result.totals.directKwh, 2);
  assert.equal(result.modelBelowExportKwh, 0);
});
test('both autumn DST hours use distinct UTC model hours', () => {
  const data = input();
  data.intervals = [
    interval('2026-10-25T00:00:00.000Z', '2026-10-25T02:00:00+02:00', 1, 0),
    interval('2026-10-25T01:00:00.000Z', '2026-10-25T02:00:00+01:00', 2, 0),
  ];
  data.months = [{ period: '2026-10', importKwh: 3, exportKwh: 0 }];
  data.pvHours = [{ startUtc: '2026-10-25T00:00:00.000Z', pvKwh: 0 }, { startUtc: '2026-10-25T01:00:00.000Z', pvKwh: 0 }];
  assert.equal(buildOfferWorkspaceEnergy(data).totals.loadKwh, 3);
});
test('no PV supports exact import and rejects conflicting export', () => {
  const data = input();
  assert.throws(() => buildOfferWorkspaceEnergy({ ...data, noPv: true }), /oddanie/);
  data.intervals[0].export = null;
  const result = buildOfferWorkspaceEnergy({ ...data, noPv: true, pvHours: [] });
  assert.deepEqual(result.totals, { loadKwh: 2, pvKwh: 0, directKwh: 0 });
});
test('missing month invalidates annual total without erasing available months', () => {
  const data = input();
  const result = buildOfferWorkspaceEnergy({ ...data, months: [...data.months, { period: '2026-02', importKwh: null, exportKwh: null }] });
  assert.equal(result.months[0].loadKwh, 5);
  assert.equal(result.totals.loadKwh, null);
  assert.equal(result.totals.pvKwh, null);
});
test('missing or duplicate PV UTC hours fail rather than invent production', () => {
  assert.throws(() => buildOfferWorkspaceEnergy({ ...input(), pvHours: [] }), /Brak modelu PV/);
  const data = input();
  assert.throws(() => buildOfferWorkspaceEnergy({ ...data, pvHours: [...data.pvHours, ...data.pvHours] }), /profil PV/);
});
