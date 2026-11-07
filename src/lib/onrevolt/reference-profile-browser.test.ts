import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildReferenceProfileProjection, getReferenceProfileCalculationEligibility, type CatalogProfile } from './reference-profile-comparison';
import { profileContentHash } from '../../../scripts/profile-catalog/storage-core';
import { buildAnnualOfferConsumptionProfile } from './offer-workspace-annual-profile';
import { resolveProjectAnalysisPeriod } from './project-analysis-period';
const engine = require('../../../public/shared/re-consumption-engine.js');
const catalog = JSON.parse(readFileSync('output/profile-catalog-20261106/catalog.json', 'utf8')).profiles as CatalogProfile[];
function adapter() {
  const window: any = { buildReferenceProfileProjection };
  vm.runInNewContext(readFileSync('integrations/re/reference-profile-browser.js', 'utf8'), { window, Date, Map, Number, Array, Math, Object });
  return window.REReferenceProfile;
}
test('browser RE adapter and CRM preserve identical annual and monthly totals for all eligible profiles', () => {
  const api = adapter();
  for (const profile of catalog.filter(p => getReferenceProfileCalculationEligibility(p).eligible)) {
    const contentHash = profileContentHash(profile as any), row = { profile, contentHash, annualKwh: 6000.001, projectionVersion: 1 };
    const projected = api.buildYear(row, 2024);
    assert.ok(Math.abs(projected.monthlyKwh.reduce((a: number, b: number) => a + b, 0) - 6000.001) < 1e-8);
    const crm = buildAnnualOfferConsumptionProfile({ annualConsumptionKwh: row.annualKwh,
      period: resolveProjectAnalysisPeriod('2024-01'), referenceProfile: { profile, contentHash } });
    const totals = new Array(12).fill(0);
    for (const hour of crm.intervals) totals[Number(hour.period.slice(5)) - 1] += hour.loadKwh;
    projected.monthlyKwh.forEach((value: number, month: number) => assert.ok(Math.abs(value - totals[month]) < 1e-7, profile.key));
    const resolved = engine.buildProfile({ year: 2024, annualKwh: row.annualKwh,
      sources: new Array(12).fill('standard'), getDayInputs: (dayKey: string) => api.getDayInputs(row, dayKey) });
    assert.ok(Math.abs(resolved.annualKwh - row.annualKwh) < 1e-7, profile.key);
  }
});
test('manual monthly totals preserve the selected daily energy differences and reset retains latest annual', () => {
  const api = adapter(), profile = catalog.find(p => p.key === 'vdew-1999-g1')!;
  const row = { profile, contentHash: profileContentHash(profile as any), annualKwh: 6000, projectionVersion: 1 };
  const monthly = new Array(12).fill(500);
  const result = engine.buildProfile({ year: 2026, annualKwh: 6000, monthlyKwh: monthly,
    sources: new Array(12).fill('manual'), getDayInputs: (dayKey: string) => api.getDayInputs(row, dayKey) });
  result.months.forEach((month: any) => assert.ok(Math.abs(month.totalKwh - 500) < 1e-8));
  assert.ok(result.months[0].weekdayHourly.reduce((a: number, b: number) => a + b, 0)
    > result.months[0].weekendHourly.reduce((a: number, b: number) => a + b, 0));
  const reset = api.getDayInputs({ profile: null, annualKwh: 7200.001, projectionVersion: 1 }, '2026-01-01');
  assert.equal(reset.referenceProfileSelected, false); assert.equal(reset.referenceAnnualKwh, 7200.001);
  assert.equal(api.getDayInputs(null, '2026-01-01'), null);
  assert.throws(() => api.getDayInputs({ ...row, projectionVersion: 2 }, '2026-01-01'), /wersja/);
});
