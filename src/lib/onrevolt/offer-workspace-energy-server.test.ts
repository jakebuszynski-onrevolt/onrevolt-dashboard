import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const filename = path.resolve(__dirname, 'offer-workspace-energy-server.ts');
const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: filename,
}).outputText;

function fixture(options: { sourceRevision?: string; profileSourceRevision?: string; revisionAfterProfile?: string; powerKw?: number;
  batteryPresent?: boolean | null; availability?: 'NO_FILES' | 'FILES_PRESENT' | 'UNKNOWN'; annualKwh?: number | null;
  energyProfileSource?: 'ANNUAL_DECLARATION' | 'MONTHLY_MANUAL' | 'OPERATOR_HOURLY' | null;
  referenceProfile?: { key: string | null; revision: number; contentHash: string | null; profileName: string | null } } = {}) {
  const state = {
    sourceRevision: options.sourceRevision ?? 'pv-source-a',
    profileCalls: 0,
    buildCalls: 0,
    buildInputs: [] as any[],
    artifactReads: 0,
    artifactWrites: 0,
    artifactKeys: [] as string[],
    annualProfileCalls: 0,
    annualEnergyCalls: 0,
    annualEnergyInputs: [] as any[],
    annualProfileInputs: [] as any[],
    resolvedProfileCalls: 0,
    resolvedProfileSelection: null as any,
    refreshedSeries: null as any,
    refreshInputs: [] as any[],
  };
  const artifacts = new Map<string, unknown>();
  const workspace: any = {
    projectId: 'project-1', revision: 'workspace-revision-7',
    input: { location: { latitude: 52.23, longitude: 21.01 }, existingBatteryPresent: options.batteryPresent === undefined ? false : options.batteryPresent,
      annualConsumptionKwh: options.annualKwh === undefined ? 3650 : options.annualKwh,
      energyProfileSource: options.energyProfileSource === undefined ? 'ANNUAL_DECLARATION' : options.energyProfileSource,
      referenceProfile: options.referenceProfile },
    period: { startMonth: '2026-01', endMonth: '2026-12', endDate: '2026-12-31',
      periodKeys: Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`),
      fromUtc: '2025-12-31T23:00:00.000Z', untilUtc: '2026-12-31T23:00:00.000Z' },
    measurements: { availability: options.availability ?? 'NO_FILES', months: Array.from({ length: 12 }, (_, index) => ({
      period: `2026-${String(index + 1).padStart(2, '0')}`, importKwh: null, exportKwh: null,
    })), periods: [], dayProfiles: [], intervalCount: null, totalsImportKwh: null, totalsExportKwh: null, missingDirections: [], issues: [] },
  };
  const draft: any = {
    existingBatteryPresent: false,
    existingPv: { powerKw: options.powerKw ?? 5, tiltDegrees: 35, azimuthDegrees: 180, lossPercent: 14 },
    calculation: { pvReconstructionAccepted: false },
  };
  const series: any = { intervals: [{
    startUtc: '2026-10-01T00:00:00.000Z', endUtc: '2026-10-01T01:00:00.000Z',
  }] };
  const builtEnergy = {
    quality: 'MODELLED', source: 'test', model: 'test', months: [], dayProfiles: [],
    totals: { loadKwh: null, pvKwh: null, directKwh: null }, issues: [], modelBelowExportKwh: 0,
    intervals: [{ startUtc: '2026-10-01T00:00:00.000Z', endUtc: '2026-10-01T01:00:00.000Z',
      loadKwh: 1, pvKwh: 1, directKwh: 0, importKwh: 1, exportKwh: 0 }],
  };
  const modules: Record<string, unknown> = {
    './offer-measurement-completion-server': { refreshCompletedOfferMeasurements: async (series: any, pv: any) => {
      state.refreshInputs.push(pv);
      return state.refreshedSeries || series;
    } },
    './offer-workspace-server': { summarizeOfferMeasurementSeries: () => ({ months: [{ period: '2026-01', importKwh: 123, exportKwh: 0 }], dayProfiles: [], issues: [] }) },
    './offer-pv-source-revision': { getOfferPvSourceRevision: () => state.sourceRevision },
    './offer-pv-profile': {
      OfferPvSourceRevisionError: class OfferPvSourceRevisionError extends Error {},
      readOfferPvProfileWithSourceRevision: async () => {
        state.profileCalls += 1;
        const profileSourceRevision = options.profileSourceRevision ?? state.sourceRevision;
        if (options.revisionAfterProfile) state.sourceRevision = options.revisionAfterProfile;
        return { profile: { hours: [{ startUtc: '2026-10-01T00:00:00.000Z', pvKwh: 1 }],
          source: 'PVGIS 6 / SARAH-3', model: 'model' }, sourceRevision: profileSourceRevision };
      },
    },
    './offer-workspace-artifacts': {
      getOfferWorkspaceArtifact: async (identity: any) => {
        state.artifactReads += 1;
        const key = JSON.stringify(identity.key);
        state.artifactKeys.push(key);
        return artifacts.get(key) ?? null;
      },
      putOfferWorkspaceArtifact: async (identity: any, value: unknown) => {
        state.artifactWrites += 1;
        artifacts.set(JSON.stringify(identity.key), value);
      },
    },
    './offer-workspace-annual-profile': { buildAnnualOfferConsumptionProfile: (input: unknown) => {
      state.annualProfileCalls += 1;
      state.annualProfileInputs.push(input);
      const selected = (input as any).referenceProfile;
      const referenceProfile = selected ? { key: selected.profile.key, name: selected.profile.name,
        contentHash: selected.contentHash, method: 'bdew-standard-profile', projectionVersion: 1, notes: [] } : undefined;
      const source = referenceProfile ? `Roczne zużycie · profil referencyjny ${referenceProfile.name}` : 'Roczne zużycie · profil godzinowy RE';
      return { annualConsumptionKwh: (input as any).annualConsumptionKwh, source, referenceProfile, intervals: [], dayProfiles: [] };
    } },
    './offer-workspace-energy': { buildOfferWorkspaceEnergy: (input: unknown) => {
      state.buildCalls += 1;
      state.buildInputs.push(input);
      return builtEnergy;
    }, buildAnnualProfileOfferWorkspaceEnergy: (input: unknown) => {
      state.annualEnergyCalls += 1;
      state.annualEnergyInputs.push(input);
      const referenceProfile = (input as any).profile.referenceProfile;
      const source = referenceProfile ? `Roczne zużycie · profil referencyjny ${referenceProfile.name}` : 'Roczne zużycie · profil godzinowy RE';
      return { ...builtEnergy, quality: 'MODELLED', source,
        modelledMeasurements: { provenance: { kind: 'annual-consumption', source, annualConsumptionKwh: 3650,
          ...(referenceProfile ? { referenceProfile } : {}) },
          months: [], dayProfiles: [], totalsImportKwh: 3650, totalsExportKwh: 0, intervalCount: 0 } };
    } },
    './project-reference-profile': { resolveSelectedReferenceProfile: async (selection: unknown) => {
      state.resolvedProfileCalls += 1;
      state.resolvedProfileSelection = selection;
      if (!(selection as any)?.key) return null;
      return { profile: { key: 'bdew-2025-h25', name: 'Gospodarstwo domowe — BDEW H25' }, contentHash: 'a'.repeat(64) };
    } },
  };
  const exports: any = {};
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected energy-server import: ${name}`);
      return modules[name];
    },
  });
  return {
    state,
    workspace,
    draft,
    series,
    calculate: () => exports.calculateOfferWorkspaceEnergy(workspace, draft, series),
    sourceRevisionOf: (energy: unknown) => exports.getOfferWorkspaceEnergySourceRevision(energy),
  };
}

test('energy artifact misses once, then returns the persisted result without rebuilding PV', async () => {
  const f = fixture();
  const first = await f.calculate();
  const second = await f.calculate();

  assert.equal(first.intervals?.[0].pvKwh, 1);
  assert.equal(second.intervals?.[0].pvKwh, 1);
  assert.equal(f.state.profileCalls, 1);
  assert.equal(f.state.buildCalls, 1);
  assert.equal(f.state.artifactReads, 2);
  assert.equal(f.state.artifactWrites, 1);
  assert.equal(f.sourceRevisionOf(first), 'pv-source-a');
  assert.equal(f.sourceRevisionOf(second), 'pv-source-a', 'persisted energy retains its exact profile-source identity');
});

test('niezapisana geometria PV odtwarza uzupełnienia i ich sumy przed obliczeniem energii', async () => {
  const f = fixture();
  f.state.refreshedSeries = { intervals: [{ ...f.series.intervals[0], import: { valueKwh: 123, source: 'modelled', fileIds: [] } }] };
  f.draft.existingPv.tiltDegrees = 20;
  await f.calculate();
  assert.equal(f.state.refreshInputs[0].tiltDegrees, 20);
  assert.equal(f.state.refreshInputs[0].latitude, 52.23);
  assert.equal(f.state.buildInputs[0].intervals[0].import.valueKwh, 123);
  assert.equal(f.state.buildInputs[0].months[0].importKwh, 123);
});

test('changed PV source fingerprint misses the prior energy artifact', async () => {
  const f = fixture();
  await f.calculate();
  f.state.sourceRevision = 'pv-source-b';
  await f.calculate();

  assert.equal(f.state.profileCalls, 2);
  assert.equal(f.state.buildCalls, 2);
  assert.equal(new Set(f.state.artifactKeys).size, 2);
  assert.equal(f.state.artifactWrites, 2);
});

test('audit battery presence overrides a stale draft flag and separates energy cache keys', async () => {
  const f = fixture();
  f.draft.existingBatteryPresent = false;
  f.workspace.input.existingBatteryPresent = true;
  await f.calculate();
  assert.equal(f.state.buildInputs[0].existingBatteryPresent, true);
  assert.match(f.state.artifactKeys[0], /"existingBatteryPresent":true/u);

  f.workspace.input.existingBatteryPresent = null;
  await f.calculate();
  assert.equal(f.state.buildInputs[1].existingBatteryPresent, null);
  assert.match(f.state.artifactKeys[1], /"existingBatteryPresent":null/u);
  assert.notEqual(f.state.artifactKeys[0], f.state.artifactKeys[1]);
  assert.equal(f.state.buildCalls, 2);
});

test('zero-PV energy uses its own persistent key and does not inspect PV sources', async () => {
  const f = fixture({ powerKw: 0 });
  f.workspace.input.location = null;
  f.state.sourceRevision = null;
  await f.calculate();
  await f.calculate();

  assert.equal(f.state.profileCalls, 0);
  assert.equal(f.state.buildCalls, 1);
  assert.equal(f.state.artifactReads, 2);
  assert.equal(f.state.artifactWrites, 1);
  assert.match(f.state.artifactKeys[0], /zero-capacity/u);
  assert.equal(f.sourceRevisionOf(await f.calculate()), null, 'the zero-capacity path has no external PV source identity');
});

test('PV source change while building energy rejects the result before artifact write', async () => {
  const f = fixture({ revisionAfterProfile: 'pv-source-b' });
  await assert.rejects(f.calculate(), /Źródło PV zmieniło się podczas obliczania energii/);
  assert.equal(f.state.buildCalls, 0, 'energy is not built from a profile whose source changed');
  assert.equal(f.state.artifactWrites, 0, 'unstable source energy is never cached');
});

test('annual-only input uses RE energy with zero PV, even when there is no PPE account issue', async () => {
  const f = fixture({ powerKw: 0 });
  f.workspace.measurements.issues = ['Nie znaleziono konta ENEA przypisanego do projektu.'];
  f.series.intervals = [];
  const energy = await f.calculate();
  assert.equal(energy.quality, 'MODELLED');
  assert.equal(energy.modelledMeasurements?.provenance.kind, 'annual-consumption');
  assert.equal(f.state.annualProfileCalls, 1);
  assert.equal(f.state.annualEnergyCalls, 1);
  assert.equal(f.state.annualEnergyInputs[0].noPv, true);
  assert.equal(f.state.annualEnergyInputs[0].pvHours.length, 0);
  assert.equal(f.state.annualProfileInputs[0].referenceProfile, undefined);
  assert.equal(f.state.resolvedProfileCalls, 1);
  assert.equal(f.state.profileCalls, 0);
  assert.equal(f.state.artifactReads, 0, 'synthetic energy is not read from a persistent artifact');
  assert.equal(f.state.artifactWrites, 0, 'synthetic energy is not written to a persistent artifact');
});

test('annual-only energy resolves and propagates the selected reference profile into the builder', async () => {
  const selection = { key: 'bdew-2025-h25', revision: 2, contentHash: 'a'.repeat(64), profileName: 'Gospodarstwo domowe — BDEW H25' };
  const f = fixture({ powerKw: 0, referenceProfile: selection });
  f.series.intervals = [];
  const energy = await f.calculate();
  assert.deepEqual(f.state.resolvedProfileSelection, selection);
  assert.equal(f.state.annualProfileInputs[0].referenceProfile.profile.key, 'bdew-2025-h25');
  assert.equal(f.state.annualProfileInputs[0].referenceProfile.contentHash, 'a'.repeat(64));
  assert.equal(f.state.annualEnergyInputs[0].profile.referenceProfile.key, 'bdew-2025-h25');
  assert.equal(energy.modelledMeasurements.provenance.referenceProfile.name, selection.profileName);
  assert.equal(energy.modelledMeasurements.provenance.source, `Roczne zużycie · profil referencyjny ${selection.profileName}`);
});

test('annual-only input rejects unknown PV capacity and unknown or present battery', async () => {
  const pvUnknown = fixture({ powerKw: 0 });
  pvUnknown.draft.existingPv.powerKw = null;
  pvUnknown.series.intervals = [];
  await assert.rejects(pvUnknown.calculate(), /Uzupełnij moc istniejącej PV/u);

  for (const batteryPresent of [null, true] as const) {
    const f = fixture({ powerKw: 0, batteryPresent });
    f.series.intervals = [];
    await assert.rejects(f.calculate(), /magazyn(?:u|em)? energii/u);
    assert.equal(f.state.annualProfileCalls, 0);
  }
});

test('annual-only input does not replace monthly manual, operator hourly, or unspecified audit profiles', async () => {
  for (const energyProfileSource of ['MONTHLY_MANUAL', 'OPERATOR_HOURLY', null] as const) {
    const f = fixture({ powerKw: 0, energyProfileSource });
    f.series.intervals = [];
    await assert.rejects(f.calculate(), /ANNUAL_DECLARATION/u);
    assert.equal(f.state.annualProfileCalls, 0);
  }
});

test('annual-only input never replaces existing files or partial monthly data', async () => {
  const filePresent = fixture({ powerKw: 0, availability: 'FILES_PRESENT' });
  filePresent.series.intervals = [];
  await assert.rejects(filePresent.calculate(), /brak plików pomiarowych/u);
  assert.equal(filePresent.state.annualProfileCalls, 0);

  const partial = fixture({ powerKw: 0 });
  partial.workspace.measurements.intervalCount = 2;
  partial.series.intervals = [];
  await assert.rejects(partial.calculate(), /niepełne pomiary/u);
  assert.equal(partial.state.annualProfileCalls, 0);

  const measured = fixture({ powerKw: 0 });
  await measured.calculate();
  assert.equal(measured.state.annualProfileCalls, 0, 'nonempty intervals always use the existing measured path');
});

test('annual-only PV model uses the existing weather loader and preserves PV source revision', async () => {
  const f = fixture();
  f.series.intervals = [];
  const energy = await f.calculate();
  assert.equal(f.state.annualProfileCalls, 1);
  assert.equal(f.state.profileCalls, 1);
  assert.equal(f.state.annualEnergyInputs[0].noPv, false);
  assert.equal(f.state.annualEnergyInputs[0].pvSource, 'PVGIS 6 / SARAH-3');
  assert.equal(f.sourceRevisionOf(energy), 'pv-source-a');
  assert.equal(f.state.artifactWrites, 0, 'annual model data is not persisted as synthetic measurements');
});
