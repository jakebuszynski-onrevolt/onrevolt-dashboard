import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { resolveProjectAnalysisPeriod } from './project-analysis-period';
import * as projectPvSettings from './project-pv-settings';
import * as clientEnergyPvSummary from './client-energy-pv-summary';
import * as annualProfile from './offer-workspace-annual-profile';
import * as offerWorkspaceEnergy from './offer-workspace-energy';
import * as clientEnergyCostSummary from './client-energy-cost-summary';
import * as offerWorkspaceBilling from './offer-workspace-billing';
import { calculateClientEnergyCostSummaryOnServer, completeHistoryForSummary } from './client-energy-cost-summary-server';
import type { CatalogProfile } from './reference-profile-comparison';

const catalog = JSON.parse(readFileSync(path.join(process.cwd(), 'output', 'profile-catalog-20261106', 'catalog.json'), 'utf8')) as { profiles: CatalogProfile[] };
const bdewH25 = catalog.profiles.find(profile => profile.key === 'bdew-2025-h25')!;

const routePath = path.resolve(__dirname, '../../app/api/projects/[id]/energy-summary/route.ts');
const routeCode = ts.transpileModule(readFileSync(routePath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: routePath,
}).outputText;

test('energy-summary uses the selected period in queries, validation and response', async () => {
  const now = new Date('2026-10-30T12:00:00.000Z');
  const period = resolveProjectAnalysisPeriod('2025-10', now);
  const state = {
    seriesOptions: null as any,
    measurementQuery: null as any,
    pvSettingsInput: null as any,
    modelInput: null as any,
    modelCalls: 0,
    pvSummaryInput: null as any,
    costBounds: null as any,
    measurementIntervals: [] as any[],
    fullMeasurementCoverage: false,
    currentScenario: null as any,
    catalogTariff: null as any,
    catalogRequests: [] as any[],
    failModel: false,
    accounts: [{ id: 'account-1', ppeNumber: '590310600030743962', operator: 'ENEA' }],
    downloadedFiles: null as any[] | null,
    nonDownloadedFiles: [] as any[],
    referenceSelection: { key: null, revision: 0, contentHash: null, profileName: null } as any,
    referenceProfileBundle: null as any,
    referenceSelectionReads: 0,
    project: {
      id: 'project-1', clientId: 'client-1', clientType: 'B2C',
      investmentSite: { latitude: 52.2, longitude: 21 },
      offerWorkspace: { input: { existingBatteryPresent: false, existingPv: { powerKw: 5, tiltDegrees: 30, azimuthDegrees: 180, lossPercent: 12 } } },
      energyAudits: [{ existingPvKw: 9, roofTiltDeg: 25, roofOrientation: 'E', existingBatteryKwh: 4,
        annualConsumptionKwh: null, settlementSystem: null, connectionPowerKw: null }],
    },
  };
  const modules: Record<string, unknown> = {
    'lib/onrevolt/api': {
      jsonResponse: (value: unknown, init?: ResponseInit) => Response.json(value, init),
      notFound: (message: string) => Response.json({ ok: false, error: message }, { status: 404 }),
    },
    'lib/onrevolt/offer-measurements': {
      buildOfferMeasurementSeries: (_files: unknown[], options: unknown) => {
        state.seriesOptions = options;
        return {
          periods: period.periodKeys.map((key) => ({
            period: key, hasImport: state.fullMeasurementCoverage, hasExport: state.fullMeasurementCoverage,
            missingDirections: state.fullMeasurementCoverage ? [] : ['ACTIVE_IMPORT', 'ACTIVE_EXPORT'],
          })),
          intervals: state.measurementIntervals,
        };
      },
    },
    'lib/onrevolt/offer-pv-profile': {
      readOfferPvProfile: async (input: unknown) => {
        state.modelCalls++;
        state.modelInput = input;
        if (state.failModel) throw new Error('mock PV failure');
        return { hours: [{ startUtc: period.fromUtc, pvKwh: 1 }], source: 'mock', model: 'mock' };
      },
    },
    'lib/onrevolt/project-pv-settings': projectPvSettings,
    'lib/onrevolt/client-energy-pv-summary': {
      buildClientEnergyPvSummary: (input: unknown) => {
        state.pvSummaryInput = input;
        const summaryInput = input as any;
        return { productionKwh: summaryInput.modelHours ? 1 : null, selfConsumptionKwh: null,
          coveredMonths: 0, totalMonths: 12, coveredHours: 0, totalHours: 8760,
          modelUrl: summaryInput.modelUrl, note: 'estimate', issues: summaryInput.modelError ? [summaryInput.modelError] : [] };
      },
      resolveClientEnergyBatteryPresence: clientEnergyPvSummary.resolveClientEnergyBatteryPresence,
    },
    'lib/onrevolt/client-energy-cost-summary': clientEnergyCostSummary,
    'lib/onrevolt/client-energy-cost-summary-server': {
      calculateClientEnergyCostSummaryOnServer: (input: unknown) => calculateClientEnergyCostSummaryOnServer(input as any, {
        invoiceBillingCycleForPeriod: async () => ({ cycleMonths: null, startMonth: null, crossingCount: 0 }),
        currentScenario: async (_workspace: unknown, _settlement: unknown, bounds: unknown) => {
          state.costBounds = bounds;
          return state.currentScenario;
        },
        hourlyMarketPrices: async () => ({ prices: new Map(), issue: null }),
        completeHistoryForSummary: (input: any) => completeHistoryForSummary(input, {
          clientTariffScope: async () => ({ clientId: 'client-1', projectId: 'project-1' } as any),
          callClientTariffs: async <T>(request: any) => {
            state.catalogRequests.push(request);
            if (request.action === 'get') return { profile: { periods: [
              { id: 'current-g11', validFrom: '2025-10-01', validUntil: null, osdId: 4, tariffId: 11,
                source: 'ENEA', overrides: { energy: { net: 0.5, vatRate: 0.23 } }, schedule: null, note: '' },
            ] } } as T;
            return state.catalogTariff as T;
          },
          tariffToday: () => '2026-10-31',
        }),
        priceOfferWorkspaceGrid: offerWorkspaceBilling.priceOfferWorkspaceGrid,
        billOfferWorkspaceScenario: offerWorkspaceBilling.billOfferWorkspaceScenario,
      } as any),
    },
    'lib/onrevolt/offer-workspace-annual-profile': annualProfile,
    'lib/onrevolt/offer-workspace-energy': offerWorkspaceEnergy,
    'lib/onrevolt/offer-workspace-billing': offerWorkspaceBilling,
    'lib/onrevolt/offer-workspace-valuation-server': {
      currentScenario: async (_workspace: unknown, _settlement: unknown, bounds: unknown) => {
        state.costBounds = bounds;
        return state.currentScenario;
      },
      hourlyMarketPrices: async () => ({ prices: new Map(), issue: null }),
    },
    'lib/onrevolt/client-tariffs-server': {
      clientTariffScope: async () => ({ clientId: 'client-1', projectId: 'project-1' }),
      callClientTariffs: async (request: unknown) => {
        state.catalogRequests.push(request);
        return state.catalogTariff;
      },
    },
    'lib/onrevolt/client-tariffs': { tariffToday: () => '2026-10-31' },
    'lib/onrevolt/offer-workspace-server': {
      offerWorkspaceProjectWhere: (id: string) => ({ id }),
      readOfferWorkspaceMeasurement: async () => Buffer.from('xlsx'),
      summarizeOfferMeasurementSeries: (_series: unknown, _issues: unknown, expected: string[]) => ({
        months: expected.map((key) => ({ period: key, importKwh: null, exportKwh: null })),
      }),
    },
    'lib/onrevolt/prisma': {
      prisma: {
        project: { findFirst: async () => state.project },
        energyPortalAccount: { findMany: async () => state.accounts },
        energyMeasurementFile: { findMany: async (query: any) => {
          state.measurementQuery = query;
          if (query.where.status?.not) return state.nonDownloadedFiles;
          return state.downloadedFiles ?? [{
            id: 'file-1', clientId: 'client-1', projectId: 'project-1', accountId: 'account-1', kind: 'ACTIVE_IMPORT',
            periodYear: 2025, periodMonth: 10, aggregation: '60 min', storagePath: null, fileName: null,
            updatedAt: now, document: null,
          }];
        } },
      },
    },
    'lib/onrevolt/staff-server': { authorizeStaffRequest: async () => ({ ok: true, user: { id: 'staff' } }) },
    'lib/onrevolt/client-energy-summary': { buildClientEnergyActualDays: () => [] },
    'lib/onrevolt/project-analysis-period-server': {
      readProjectAnalysisPeriod: async () => ({ projectId: 'project-1', storedStartMonth: '2025-10', period }),
    },
    'lib/onrevolt/project-reference-profile': {
      readProjectReferenceProfileSelection: async () => {
        state.referenceSelectionReads += 1;
        return state.referenceSelection;
      },
      resolveSelectedReferenceProfile: async (selection: any) => selection?.key ? state.referenceProfileBundle : null,
    },
  };
  const exports: any = {};
  vm.runInNewContext(routeCode, {
    exports,
    require: (name: string) => {
      if (!Object.hasOwn(modules, name)) throw new Error(`Unexpected route import: ${name}`);
      return modules[name];
    },
    Response,
    Buffer,
    Date,
    URL,
  });

  const response = await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.data.period, period);
  assert.deepEqual(Array.from(state.seriesOptions.periodKeys), period.periodKeys);
  assert.equal(state.seriesOptions.now, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(state.measurementQuery.where.AND[0].OR)), period.periodKeys.map((key) => {
    const [periodYear, periodMonth] = key.split('-').map(Number);
    return { periodYear, periodMonth };
  }));
  assert.deepEqual(body.data.months.map(({ period: key }: { period: string }) => key), period.periodKeys);
  assert.equal(body.data.pv.productionKwh, 1);
  assert.equal(state.modelCalls, 1);
  assert.deepEqual(state.modelInput, {
    latitude: 52.2, longitude: 21, powerKw: 5, tiltDegrees: 30, azimuthDegrees: 180,
    lossPercent: 12, ...period,
  });
  assert.equal(state.pvSummaryInput.existingBatteryPresent, true,
    'the energy-data battery capacity overrides a contradictory offer-draft flag');
  assert.equal(state.pvSummaryInput.measurementSeries.intervals.length, 0);
  assert.equal(state.pvSummaryInput.fromUtc, period.fromUtc);
  assert.equal(state.pvSummaryInput.untilUtc, period.untilUtc);
  assert.equal(body.data.pv.modelUrl,
    'https://my.onrevolt.com/pv/?mode=manual&layout=single&lat=52.2&lon=21&capacityKwp=5&tilt=30&azimuth=180&lossPercent=12');

  state.accounts = [];
  const noAccountResponse = await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  const noAccountBody = await noAccountResponse.json();
  assert.equal(noAccountBody.data.pv.productionKwh, 1);
  assert.equal(state.pvSummaryInput.measurementSeries, null);
  assert.equal(state.modelCalls, 2);
  assert.deepEqual(noAccountBody.data.issues, ['Nie znaleziono konta operatora energii przypisanego do projektu.']);

  const savedOfferWorkspace = state.project.offerWorkspace;
  state.project.offerWorkspace = null;
  Object.assign(state.project.energyAudits[0], {
    profileSource: 'ANNUAL_DECLARATION', annualConsumptionKwh: 6000, existingPvKw: 0,
    existingBatteryKwh: 0, connectionPowerKw: 12, settlementSystem: 'NET_BILLING',
  });
  state.currentScenario = { tariffHistory: null, issues: ['Brak zapisanej historii taryfy.'] };
  const annualOnlyResponse = await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  const annualOnlyBody = await annualOnlyResponse.json();
  assert.equal(annualOnlyResponse.status, 200);
  assert.equal(annualOnlyBody.data.annualModel.source, 'MODELLED');
  assert.equal(annualOnlyBody.data.annualModel.flowAvailable, true);
  assert.equal(annualOnlyBody.data.annualModel.provenance.annualConsumptionKwh, 6000);
  assert.ok(Math.abs(annualOnlyBody.data.annualModel.months.reduce((sum: number, month: any) => sum + month.loadKwh, 0) - 6000) < 1e-6);
  assert.ok(Math.abs(annualOnlyBody.data.annualModel.months.reduce((sum: number, month: any) => sum + month.importKwh, 0) - 6000) < 1e-6);
  assert.equal(annualOnlyBody.data.annualModel.months.reduce((sum: number, month: any) => sum + month.exportKwh, 0), 0);
  assert.ok(annualOnlyBody.data.annualModel.days.length > 0);
  assert.equal(annualOnlyBody.data.cost.source, 'MODELLED');
  assert.equal(annualOnlyBody.data.days.length, 0, 'modeled profiles do not enter the meter-reading collection');

  state.referenceSelection = { key: bdewH25.key, revision: 1, contentHash: 'a'.repeat(64), profileName: bdewH25.name };
  state.referenceProfileBundle = { profile: bdewH25, contentHash: 'a'.repeat(64) };
  const selectedAnnualResponse = await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  const selectedAnnualBody = await selectedAnnualResponse.json();
  assert.equal(selectedAnnualBody.data.annualModel.provenance.referenceProfile.key, bdewH25.key);
  assert.equal(selectedAnnualBody.data.annualModel.provenance.referenceProfile.contentHash, 'a'.repeat(64));
  assert.match(selectedAnnualBody.data.annualModel.provenance.source, /profil referencyjny/u);
  assert.doesNotMatch(selectedAnnualBody.data.annualModel.provenance.source, /profil godzinowy RE/u);
  assert.equal(state.referenceSelectionReads, 2, 'the summary reads the project selection only when annual modelling is requested');

  Object.assign(state.project.energyAudits[0], { profileSource: 'MONTHLY_MANUAL' });
  const monthlyManualResponse = await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  const monthlyManualBody = await monthlyManualResponse.json();
  assert.equal(Object.hasOwn(monthlyManualBody.data, 'annualModel'), false,
    'an unrelated monthly manual profile is not reinterpreted as an annual declaration');

  state.accounts = [{ id: 'account-1', ppeNumber: '590310600030743962', operator: 'ENEA' }];
  state.downloadedFiles = [];
  state.nonDownloadedFiles = [{ id: 'failed-file', status: 'FAILED' }];
  Object.assign(state.project.energyAudits[0], { profileSource: 'ANNUAL_DECLARATION' });
  const failedFileResponse = await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  const failedFileBody = await failedFileResponse.json();
  assert.equal(Object.hasOwn(failedFileBody.data, 'annualModel'), false,
    'a failed file record is not treated as an empty measurement history');
  assert.ok(failedFileBody.data.issues.some((issue: string) => issue.includes('poza statusem DOWNLOADED')));
  state.downloadedFiles = null;
  state.nonDownloadedFiles = [];
  state.project.offerWorkspace = savedOfferWorkspace;

  state.accounts = [{ id: 'account-1', ppeNumber: '590310600030743962', operator: 'ENEA' }];
  state.failModel = true;
  const modelErrorResponse = await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  const modelErrorBody = await modelErrorResponse.json();
  assert.equal(modelErrorResponse.status, 200);
  assert.equal(modelErrorBody.data.period.startMonth, period.startMonth);
  assert.equal(modelErrorBody.data.pv.productionKwh, null);
  assert.ok(modelErrorBody.data.pv.issues.some((issue: string) => issue.includes('mock PV failure')));
  assert.ok(Array.isArray(modelErrorBody.data.months));
  assert.equal(state.modelCalls, 3);

  state.failModel = false;
  state.project.offerWorkspace.input.existingPv.powerKw = 0;
  const noPvResponse = await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  const noPvBody = await noPvResponse.json();
  assert.equal(Object.hasOwn(noPvBody.data, 'pv'), false);
  assert.equal(state.modelCalls, 3);

  state.project.offerWorkspace.input.existingPv.powerKw = 5;
  state.project.offerWorkspace.input.existingPv.lossPercent = null;
  const missingSettingsResponse = await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  const missingSettingsBody = await missingSettingsResponse.json();
  assert.equal(missingSettingsBody.data.pv.productionKwh, null);
  assert.ok(missingSettingsBody.data.pv.issues.some((issue: string) => issue.includes('straty PV')));
  assert.equal(state.modelCalls, 3);

  state.project.offerWorkspace.input.existingPv.powerKw = null;
  const unknownPvResponse = await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  const unknownPvBody = await unknownPvResponse.json();
  assert.equal(Object.hasOwn(unknownPvBody.data, 'pv'), false);
  assert.equal(state.modelCalls, 3);

  const historyTariff = {
    osd_id: 4, tariff_id: 11, osd_name: 'ENEA', code: 'G11', name: 'G11', segment: 'G',
    zone_model: 'all', use_monthly: false,
    fixed: [{ component_key: 'subscription', label: 'Abonament', amount: 1.23 }],
    variable: [
      { component_key: 'energy', label: 'Energia czynna', price: 0.615, window_code: 'all' },
      { component_key: 'distribution', label: 'Opłata sieciowa', price: 0.123, window_code: 'all' },
    ],
    pricing: { tariffStorage: { priceBasis: 'net', vatRate: 0.23, validFrom: '2025-01-01',
      fixed: [{ component_key: 'subscription', label: 'Abonament', net: 1, gross: 1.23, vatRate: 0.23 }],
      variable: [
        { component_key: 'energy', label: 'Energia czynna', net: 0.5, gross: 0.615, vatRate: 0.23, window_code: 'all' },
        { component_key: 'distribution', label: 'Opłata sieciowa', net: 0.1, gross: 0.123, vatRate: 0.23, window_code: 'all' },
      ],
    } },
  };
  state.project.energyAudits[0] = { ...state.project.energyAudits[0], annualConsumptionKwh: 6000,
    settlementSystem: 'NET_METERING', existingPvKw: 9.9, connectionPowerKw: 12 };
  state.project.offerWorkspace.input = {
    currentSettlement: 'NET_METERING',
    calculation: { billingCycleMonths: 2, billingCycleStartMonth: null, initialCreditKwh: null, initialCreditLots: [] },
  } as any;
  state.measurementIntervals = [{ localStart: '2025-10-01T00:00:00', localEnd: '2025-10-01T01:00:00',
    startUtc: period.fromUtc, endUtc: new Date(Date.parse(period.fromUtc) + 3_600_000).toISOString(), occurrence: 0,
    import: { valueKwh: 1, source: 'TEST', fileIds: ['file-1'] },
    export: { valueKwh: 0, source: 'TEST', fileIds: ['file-1'] } }];
  const missingTariffDates = period.periodKeys.flatMap((month) => {
    const [year, monthNumber] = month.split('-').map(Number);
    const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
  }).filter(date => date !== '2025-10-01');
  state.currentScenario = {
    settlement: 'NET_METERING', source: 'PROJECT_HISTORY',
    tariffHistory: { strict: true, revision: 18, byDate: { '2025-10-01': historyTariff }, tariffs: {},
      issues: missingTariffDates.map(date => ({ date, message: `Wymaga uzupełnienia: brak jednoznacznych cen dla ${date}` })) },
    issues: [],
  };
  state.catalogTariff = historyTariff;
  const costResponse = await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  const costBody = await costResponse.json();
  assert.equal(costResponse.status, 200);
  assert.equal(costBody.data.cost.status, 'partial');
  assert.equal(costBody.data.cost.settled, false);
  assert.equal(costBody.data.cost.pricedHours, 1);
  assert.ok(costBody.data.cost.totalPln > 0);
  assert.ok(costBody.data.cost.assumptions.some((value: string) => value.includes('364 dni bez ceny historycznej')));
  assert.deepEqual(JSON.parse(JSON.stringify(state.costBounds)), { from: '2025-10-01', until: '2026-10-01' });
  const catalogRequest = state.catalogRequests.find(request => request.action === 'catalog');
  assert.equal(catalogRequest.osdId, 4);
  assert.equal(catalogRequest.tariffId, 11);
  assert.equal(Object.keys(state.currentScenario.tariffHistory.byDate).length, 1);

  state.fullMeasurementCoverage = true;
  state.measurementIntervals = [];
  for (let start = Date.parse(period.fromUtc); start < Date.parse(period.untilUtc); start += 3_600_000) {
    state.measurementIntervals.push({
      localStart: new Date(start).toISOString(), localEnd: new Date(start + 3_600_000).toISOString(),
      startUtc: new Date(start).toISOString(), endUtc: new Date(start + 3_600_000).toISOString(), occurrence: 0,
      import: { valueKwh: 0.1, source: 'TEST', fileIds: ['file-1'] },
      export: { valueKwh: 0, source: 'TEST', fileIds: ['file-1'] },
    });
  }
  const fullCostResponse = await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  const fullCostBody = await fullCostResponse.json();
  assert.equal(fullCostBody.data.cost.settled, true);
  assert.ok(!fullCostBody.data.cost.assumptions.some((value: string) => value.includes('przed rozliczeniem oddania')));
  assert.ok(fullCostBody.data.cost.assumptions.some((value: string) => value.includes('przyjęto 0 kWh')));
  assert.ok(fullCostBody.data.cost.assumptions.some((value: string) => value.includes('przyjęto 2025-10')));
  assert.equal(fullCostBody.data.cost.totalHours, 8760);
  assert.equal(fullCostBody.data.cost.pricedHours, 8760);

  (state.project.offerWorkspace.input as Record<string, any>).calculation.billingCycleMonths = null;
  const defaultCycleResponse = await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  const defaultCycleBody = await defaultCycleResponse.json();
  assert.equal(defaultCycleResponse.status, 200);
  assert.equal(defaultCycleBody.data.cost.settled, true);
  assert.equal(defaultCycleBody.data.cost.totalPln, fullCostBody.data.cost.totalPln,
    'an absent billing cycle uses the approved two-month cycle');
  assert.ok(defaultCycleBody.data.cost.assumptions.some((value: string) => value.includes('w szacunku przyjęto cykl 2-miesięczny')));

  state.project.energyAudits[0].settlementSystem = 'NET_BILLING';
  state.project.offerWorkspace.input = {
    currentSettlement: 'NET_BILLING',
    calculation: { billingCycleMonths: 2, billingCycleStartMonth: null, initialDepositPln: 100, initialDepositLots: [] },
  } as any;
  const explicitDepositResponse = await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  const explicitDepositBody = await explicitDepositResponse.json();
  assert.equal(explicitDepositBody.data.cost.settled, false);
  const explicitDepositBaseTotal = fullCostBody.data.cost.energyPln
    + fullCostBody.data.cost.distributionPln + fullCostBody.data.cost.fixedPln;
  assert.ok(Math.abs(explicitDepositBody.data.cost.totalPln - explicitDepositBaseTotal) < 1e-8);
  assert.ok(explicitDepositBody.data.cost.issues.some((issue: string) => issue.includes('Jawne saldo depozytu')));

  state.project.energyAudits[0].existingBatteryKwh = null;
  state.project.offerWorkspace.input.existingBatteryPresent = true;
  state.project.offerWorkspace.input.existingPv = { powerKw: 5, tiltDegrees: 30, azimuthDegrees: 180, lossPercent: 12 };
  await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  assert.equal(state.pvSummaryInput.existingBatteryPresent, false,
    'empty energy-data battery capacity means absent even when an old offer draft says present');
  state.project.offerWorkspace = null;
  await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  assert.equal(state.pvSummaryInput.existingBatteryPresent, false,
    'removing a test offer draft cannot make the energy-data battery status unknown');

  state.accounts = [{ id: 'pge-account', ppeNumber: '590310600030743962', operator: 'PGE' }];
  state.measurementQuery = null;
  const pgeResponse = await exports.GET({}, { params: Promise.resolve({ id: 'project-1' }) });
  const pgeBody = await pgeResponse.json();
  assert.equal(pgeResponse.status, 200);
  assert.deepEqual(pgeBody.data.issues, ['Import pomiarów godzinowych dla operatora PGE nie jest jeszcze obsługiwany.']);
  assert.equal(state.measurementQuery, null, 'PGE files must not be passed to the ENEA-only parser');
  assert.ok(pgeBody.data.cost, 'lack of a supported measurement import must not skip tariff pricing');
  assert.ok(pgeBody.data.months.every((month: any) => month.importKwh === null && month.exportKwh === null));
});
