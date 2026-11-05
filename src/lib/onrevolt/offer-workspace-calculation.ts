import type { ClientTariffHistory } from './client-tariffs';
import { defaultOfferCalculationAssumptions, type OfferWorkspaceDraft } from './offer-workspace';
import type { OfferWorkspace } from './offer-workspace-server';
import type { OfferWorkspaceEnergy } from './offer-workspace-energy';
import type { OfferWorkspaceCalculation, OfferForecastFlow } from './offer-workspace-calculation-types';
import { billOfferWorkspaceScenario, resolveOfferBillingRateSeries, type NetBillingPolicy, type NetMeteringPolicy } from './offer-workspace-billing';
import { priceOfferWorkspaceConfiguration } from './offer-workspace-pricing';
import { calculateOfferWorkspaceFinancing } from './offer-workspace-financing';
import { calculateThermomodernizationRelief } from './offer-financing-v2';
import { recommendOfferReSocStepKwh, runOfferReDiagnostic } from './offer-re-adapter';
import { configurationInvestmentScope } from './configuration-templates';
import { estimateOfferWorkspacePayback } from './offer-workspace-payback';

const localTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
export const offerLocalTime = (utc: string) => localTime.format(new Date(utc));

export function blockedOfferCalculation(reasons: string[]): OfferWorkspaceCalculation {
  return { status: 'blocked', reasons, warnings: [], baselineAnnualCostPln: null, proposedAnnualCostPln: null,
    annualSavingsPln: null, systemCostPln: null, costAfterFinancingPln: null, paybackYears: null,
    tariffOnlyAnnualCostPln: null, tariffOnlyAnnualSavingsPln: null, hardwareAnnualSavingsPln: null,
    paybackBasis: 'HARDWARE_INCREMENTAL', recommendationEligible: false, recommendationReasons: [],
    grantPln: null, taxReliefPln: null, rankings: [], recommendedTemplateIds: null };
}

export type OfferCalculationInput = {
  workspace: OfferWorkspace; draft: OfferWorkspaceDraft; energy: OfferWorkspaceEnergy;
  baselineHistory: ClientTariffHistory; targetHistory: ClientTariffHistory;
  rdnPricesNet: Map<string, number>; exportPrices: Map<string, number>;
  addedPvHours: Map<string, number>; pricesAsOf: string;
};

function forecastSummary(flows: OfferForecastFlow[], workspace: OfferWorkspace) {
  const months = new Map<string, OfferForecastFlow[]>();
  const days = new Map<string, OfferForecastFlow[]>();
  for (const flow of flows) {
    const local = offerLocalTime(flow.startUtc), period = local.slice(0, 7), date = local.slice(0, 10);
    if (!months.has(period)) months.set(period, []);
    if (!days.has(date)) days.set(date, []);
    months.get(period)!.push(flow); days.get(date)!.push(flow);
  }
  const sum = (rows: OfferForecastFlow[], key: keyof Pick<OfferForecastFlow, 'loadKwh' | 'pvKwh' | 'directKwh' | 'importKwh' | 'exportKwh'>) => rows.reduce((total, row) => total + row[key], 0);
  const energyValues = (rows: OfferForecastFlow[]) => ({ loadKwh: sum(rows, 'loadKwh'), pvKwh: sum(rows, 'pvKwh'), directKwh: sum(rows, 'directKwh') });
  const energy: OfferWorkspaceEnergy = {
    quality: 'MODELLED', source: 'Symulacja RE', model: 'Profil PV i model magazynu RE', issues: [], modelBelowExportKwh: 0,
    totals: energyValues(flows), months: [...months].map(([period, rows]) => ({ period, ...energyValues(rows) })),
    dayProfiles: (workspace.measurements.dayProfiles || []).map(day => ({ date: day.date,
      hours: day.hours.map(({ hour }) => ({ hour, ...energyValues((days.get(day.date) || []).filter(row => Number(offerLocalTime(row.startUtc).slice(11, 13)) === hour)) })) })),
  };
  const measurements = { ...workspace.measurements, issues: [], totalsImportKwh: sum(flows, 'importKwh'), totalsExportKwh: sum(flows, 'exportKwh'),
    months: [...months].map(([period, rows]) => ({ period, importKwh: sum(rows, 'importKwh'), exportKwh: sum(rows, 'exportKwh') })),
    dayProfiles: (workspace.measurements.dayProfiles || []).map(day => ({ ...day,
      hours: day.hours.map(slot => { const rows = (days.get(day.date) || []).filter(row => Number(offerLocalTime(row.startUtc).slice(11, 13)) === slot.hour);
        return { ...slot, importKwh: sum(rows, 'importKwh'), exportKwh: sum(rows, 'exportKwh') }; }) })),
  };
  return { forecastEnergy: energy, forecastMeasurements: measurements };
}

export async function calculateOfferWorkspaceScenario(input: OfferCalculationInput,
  simulate: typeof runOfferReDiagnostic = runOfferReDiagnostic): Promise<OfferWorkspaceCalculation> {
  const { workspace, draft, energy } = input;
  const result = blockedOfferCalculation([]);
  result.warnings = [...energy.issues];
  const settings = { ...(draft.calculation || defaultOfferCalculationAssumptions()) };
  if (settings.billingCycleMonths == null) {
    settings.billingCycleMonths = 2;
    const assumption = 'Szacunek rachunku: nie podano cyklu rozliczeniowego; przyjęto 2 miesiące.';
    result.warnings.push(assumption);
    result.recommendationReasons!.push(assumption);
  }
  const billingCycleMonths = settings.billingCycleMonths;
  const firstEnergyMonth = energy.intervals?.length
    ? offerLocalTime(energy.intervals[0].startUtc).slice(0, 7) : null;
  if (billingCycleMonths > 1 && settings.billingCycleStartMonth == null && firstEnergyMonth) {
    settings.billingCycleStartMonth = firstEnergyMonth;
    const assumption = `Szacunek rachunku: nie podano początku cyklu (${billingCycleMonths} mies.); przyjęto pierwszy miesiąc danych (${firstEnergyMonth}) jako kotwicę.`;
    result.warnings.push(assumption);
    result.recommendationReasons!.push(assumption);
  }
  for (const mode of ['NET_METERING', 'NET_BILLING'] as const) {
    if (draft.currentSettlement !== mode && draft.targetSettlement !== mode) continue;
    const credit = mode === 'NET_METERING';
    const balanceKey = credit ? 'initialCreditKwh' : 'initialDepositPln';
    const lots = credit ? settings.initialCreditLots : settings.initialDepositLots;
    if (settings[balanceKey] === null && !lots?.length) {
      settings[balanceKey] = 0;
      const assumption = credit
        ? 'Szacunek rachunku: brak salda początkowego opustu; przyjęto 0 kWh.'
        : 'Szacunek rachunku: brak salda początkowego depozytu; przyjęto 0 zł.';
      result.warnings.push(assumption);
      if (draft.targetSettlement === mode) result.recommendationReasons!.push(assumption);
    }
  }
  const selected = workspace.templates.filter(template => draft.selectedTemplateIds.includes(template.id));
  if (selected.length !== draft.selectedTemplateIds.length) throw new Error('Wybrany zestaw nie istnieje już w katalogu.');
  result.evaluatedTemplateIds = selected.map(template => template.id);
  const storage = selected.find(template => configurationInvestmentScope(template.kind) === 'BATTERY');
  const addedPv = selected.find(template => configurationInvestmentScope(template.kind) === 'PV');
  const pricing = priceOfferWorkspaceConfiguration(selected, draft.saleVatMode, workspace.clientType);
  result.systemCostPln = selected.length ? pricing.systemCostBeforeFinancing : 0;
  const rows = energy.intervals;
  const reasons: string[] = [];
  const incomplete: string[] = [];
  if (selected.filter(template => configurationInvestmentScope(template.kind) === 'BATTERY').length > 1
    || selected.filter(template => configurationInvestmentScope(template.kind) === 'PV').length > 1) {
    reasons.push('Wybierz jeden zestaw magazynu i najwyżej jeden zestaw PV. Kilku zestawów tego samego rodzaju nie symulujemy jako jednego.');
  }
  if (selected.some(template => configurationInvestmentScope(template.kind) === null)) reasons.push('Wybrana konfiguracja nie ma obsługiwanego zakresu magazynu lub PV.');
  if (!rows?.length || rows.some(row => row.loadKwh === null || row.pvKwh === null || row.importKwh === null || row.exportKwh === null)) reasons.push('Brak pełnego godzinowego profilu energii do symulacji.');
  if (workspace.measurements.months.length !== 12 || workspace.measurements.months.some(month => month.importKwh === null || (draft.existingPv.powerKw !== 0 && month.exportKwh === null))) reasons.push('Porównanie roczne wymaga 12 pełnych miesięcy pomiarów.');
  if (draft.currentSettlement === null || draft.targetSettlement === null) reasons.push('Wybierz obecny i proponowany system rozliczeń.');
  if (!billingCycleMonths) incomplete.push('Uzupełnij cykl rozliczeniowy w założeniach obliczeń.');
  const connectionPower = workspace.input.reportDetails?.connectionPowerKw;
  if (!connectionPower) reasons.push('Uzupełnij moc przyłączeniową w danych energetycznych.');
  if (selected.length && pricing.systemCostBeforeFinancing === null) {
    const priceReasons = [...pricing.missingRequiredData, pricing.calculationError || 'Niepełna cena zestawu.'];
    incomplete.push(...priceReasons);
    result.recommendationReasons!.push(...priceReasons);
  }
  if (storage && (!(storage.capacityKwh! > 0) || !(storage.powerKw! > 0))) reasons.push('Zestaw magazynu wymaga pojemności i mocy ładowania/rozładowania.');
  const provisionalEnergy = Boolean((storage || addedPv) && energy.modelBelowExportKwh > 0.01);
  if (provisionalEnergy) incomplete.push('Model PV jest w części godzin niższy od zmierzonego eksportu. Wynik energii pozostaje szacunkiem; nie przypisujemy tej różnicy do pomiaru zużycia.');
  if (storage && draft.targetSettlement === 'NET_METERING') reasons.push('Optymalizacja magazynu w net-meteringu wymaga osobnej weryfikacji; nie używamy algorytmu net-billing do innego rozliczenia.');
  if (draft.pvStrategy === 'ADD_TEMPLATE' && !addedPv) reasons.push('Wybierz zestaw rozbudowy PV.');
  if (draft.pvStrategy === 'KEEP_EXISTING' && addedPv) reasons.push('Wybrano zestaw PV mimo pozostawienia obecnej instalacji.');
  if (draft.currentSettlement === 'NET_METERING' || draft.targetSettlement === 'NET_METERING') {
    if (settings.initialCreditKwh === null) {
      const sides = [draft.currentSettlement === 'NET_METERING' ? 'obecnego' : null,
        draft.targetSettlement === 'NET_METERING' ? 'docelowego' : null].filter(Boolean).join(' i ');
      incomplete.push(`Podaj początkowy zapas energii w opuście dla ${sides} rozliczenia; bez niego ten rachunek pozostaje nieobliczony.`);
    }
    else if (Math.abs((settings.initialCreditLots || []).reduce((sum, lot) => sum + lot.kwh, 0) - settings.initialCreditKwh) > 0.000001) {
      reasons.push('Dodatni zapas opustu wymaga datowanych transz, których suma odpowiada saldu początkowemu.');
    }
  }
  if (draft.currentSettlement === 'NET_BILLING' || draft.targetSettlement === 'NET_BILLING') {
    if (settings.initialDepositPln === null) {
      const sides = [draft.currentSettlement === 'NET_BILLING' ? 'obecnego' : null,
        draft.targetSettlement === 'NET_BILLING' ? 'docelowego' : null].filter(Boolean).join(' i ');
      incomplete.push(`Podaj depozyt początkowy dla ${sides} rozliczenia; bez niego ten rachunek pozostaje nieobliczony.`);
    }
    else if (Math.abs((settings.initialDepositLots || []).reduce((sum, lot) => sum + lot.amountPln, 0) - settings.initialDepositPln) > 0.000001) {
      reasons.push('Dodatni depozyt wymaga miesięcznych transz, których suma odpowiada saldu początkowemu.');
    }
  }
  if (rows?.length) {
    const startMonth = offerLocalTime(rows[0].startUtc).slice(0, 7);
    const openingLots = [
      ...(draft.currentSettlement === 'NET_METERING' || draft.targetSettlement === 'NET_METERING' ? settings.initialCreditLots || [] : []),
      ...(draft.currentSettlement === 'NET_BILLING' || draft.targetSettlement === 'NET_BILLING' ? settings.initialDepositLots || [] : []),
    ];
    if (openingLots.some(lot => lot.creditedMonth > startMonth)) reasons.push(`Saldo początkowe musi być dostępne na początku danych (${startMonth}), nie w późniejszym miesiącu.`);
    if (openingLots.some(lot => lot.expiresMonth <= startMonth)) reasons.push(`Saldo początkowe zawiera transzę wygasłą przed początkiem danych (${startMonth}).`);
  }
  if (reasons.length) return { ...result, reasons, warnings: [...new Set([...result.warnings, ...incomplete])] };
  const intervals = rows!;
  if (!billingCycleMonths) {
    return { ...result, reasons: ['Nie można rozliczyć roku bez jawnego cyklu rozliczeniowego.'],
      warnings: [...new Set([...result.warnings, ...incomplete])] };
  }
  const context = { annualUsageKwh: workspace.measurements.totalsImportKwh!, billingCycleMonths, connectionPowerKw: connectionPower! };
  const vatBasis = workspace.clientType === 'B2B' ? 'NET' as const : 'GROSS' as const;
  const totalPv = draft.existingPv.powerKw! + (addedPv?.powerKw || 0);
  const hasOpeningBalance = (mode: NonNullable<OfferWorkspaceDraft['targetSettlement']>) => mode === 'NET_METERING'
    ? settings.initialCreditKwh !== null : settings.initialDepositPln !== null;
  const policy = (mode: NonNullable<OfferWorkspaceDraft['targetSettlement']>, power: number): NetBillingPolicy | NetMeteringPolicy | null => {
    if (!hasOpeningBalance(mode)) return null;
    return mode === 'NET_METERING'
    ? { mode, netMeteringRatio: power <= 10 ? 0.8 : 0.7, initialCreditKwh: settings.initialCreditKwh!, initialCreditLots: settings.initialCreditLots || [],
      billingCycleStartMonth: settings.billingCycleStartMonth || undefined, initialCreditExpiresMonth: null, creditExpiryMonths: 12,
      coverage: 'ENERGY_AND_VARIABLE_DISTRIBUTION', fixedChargeTreatment: 'ALWAYS_BILLED' }
    : { mode, initialDeposit: settings.initialDepositLots || [], creditingDelayMonths: 1, depositExpiryMonths: 12, expiredRefundRate: 0, exportPriceMethod: 'RCE',
      depositCoverage: 'ENERGY_ONLY', fixedChargeTreatment: 'ALWAYS_BILLED',
      exportUnitPrices: intervals.map(row => { const price = input.exportPrices.get(row.startUtc);
        if (price === undefined) throw new Error(`Brak ceny eksportu dla ${row.startUtc}.`);
        return { startUtc: row.startUtc, endUtc: row.endUtc, depositCreditPricePlnPerKwh: price, refundCapPricePlnPerKwh: price / 1.23 }; }) };
  };
  const currentPolicy = policy(draft.currentSettlement!, draft.existingPv.powerKw!);
  const targetPolicy = policy(draft.targetSettlement!, totalPv);
  const baselineIntervals = intervals.map(row => ({ startUtc: row.startUtc, endUtc: row.endUtc, importKwh: row.importKwh!, exportKwh: row.exportKwh!, marketPriceNetPlnPerKwh: input.rdnPricesNet.get(row.startUtc) }));
  if (currentPolicy) {
    const before = billOfferWorkspaceScenario({ context, vatBasis, tariffHistory: input.baselineHistory, settlement: currentPolicy, intervals: baselineIntervals });
    if (before.status === 'ready') {
      result.baselineBill = before.result; result.baselineAnnualCostPln = before.result.totals.cashDuePln;
      result.warnings.push(...before.warnings);
    } else {
      incomplete.push(...before.reasons.map(reason => `Obecna taryfa: ${reason}`));
    }
  } else {
    incomplete.push('Rachunek obecny pominięto: nieznane saldo początkowe nie jest traktowane jako zero.');
  }
  if (!targetPolicy) {
    return { ...result, reasons: ['Nie można obliczyć taryfy docelowej bez jawnego salda początkowego właściwego dla tego rozliczenia.'],
      warnings: [...new Set([...result.warnings, ...incomplete])] };
  }
  // The hardware must beat the same target tariff without buying new equipment.
  const tariffOnly = billOfferWorkspaceScenario({ context, vatBasis, tariffHistory: input.targetHistory,
    settlement: policy(draft.targetSettlement!, draft.existingPv.powerKw!)!, intervals: baselineIntervals });
  if (tariffOnly.status === 'blocked') return { ...result, reasons: tariffOnly.reasons,
    warnings: [...new Set([...result.warnings, ...incomplete])] };
  result.tariffOnlyBill = tariffOnly.result;
  result.tariffOnlyAnnualCostPln = tariffOnly.result.totals.cashDuePln;
  result.tariffOnlyAnnualSavingsPln = result.baselineAnnualCostPln === null ? null
    : result.baselineAnnualCostPln - result.tariffOnlyAnnualCostPln;
  result.warnings.push(...tariffOnly.warnings);
  const rateSeries = resolveOfferBillingRateSeries({ context, vatBasis, tariffHistory: input.targetHistory, settlement: targetPolicy, intervals: baselineIntervals });
  if (rateSeries.status === 'blocked') return { ...result, reasons: rateSeries.reasons,
    warnings: [...new Set([...result.warnings, ...incomplete])] };
  const reInput = intervals.map((row, index) => {
    const rates = rateSeries.rates[index];
    const extraPv = addedPv ? input.addedPvHours.get(row.startUtc) : 0;
    if (extraPv === undefined) throw new Error(`Brak profilu rozbudowy PV dla ${row.startUtc}.`);
    return { startUtc: row.startUtc, endUtc: row.endUtc, demandKwh: row.loadKwh!, pvKwh: row.pvKwh! + extraPv,
      energyBuyPrice: rates.energyBuyPlnPerKwh, distributionBuyPrice: rates.distributionBuyPlnPerKwh, sellPrice: rates.depositCreditPricePlnPerKwh };
  });
  let flows: OfferForecastFlow[];
  if (storage) {
    const socStepKwh = recommendOfferReSocStepKwh(storage.capacityKwh!, reInput.length, 0);
    const simulation = await simulate({ settlement: 'NET_BILLING', intervals: reInput,
      battery: { capacityKwh: storage.capacityKwh!, reserveKwh: storage.capacityKwh! * settings.batteryReservePercent / 100,
        maxChargeKw: storage.powerKw!, maxDischargeKw: storage.powerKw!, chargeEfficiency: settings.chargeEfficiencyPercent / 100, dischargeEfficiency: settings.dischargeEfficiencyPercent / 100 },
      initialSocKwh: 0, initialDepositPln: 0, socStepKwh });
    if (!simulation.verifiedPhysicalBalance) throw new Error('RE zwrócił niespójny bilans energii. Wynik nie został użyty w ofercie.');
    flows = simulation.result.days.flatMap(day => day.slots).map((slot, index) => ({
      startUtc: slot.slotStart, endUtc: slot.slotEnd, loadKwh: reInput[index].demandKwh, pvKwh: reInput[index].pvKwh, directKwh: slot.pvToLoad,
      importKwh: slot.gridBuyLoad + slot.gridBuyBank, exportKwh: slot.sellImmediate + slot.bankToSell,
      batteryToLoadKwh: slot.bankToLoad, gridToBatteryKwh: slot.gridBuyBank,
      pvToBatteryKwh: slot.pvToBank / (settings.chargeEfficiencyPercent / 100), batteryToGridKwh: slot.bankToSell, socKwh: slot.bankEnd,
    }));
    result.warnings.push('Model RE optymalizuje z dwudniową znajomością profilu. Wynik jest prognozą, nie gwarancją oszczędności. Początkowy SOC: 0 kWh.');
    result.warnings.push(`Siatka obliczeniowa SOC: ${socStepKwh.toFixed(3)} kWh. To przybliżenie numeryczne, nie skok pojemności oferowanego magazynu.`);
  } else {
    flows = reInput.map((row, index) => ({ startUtc: row.startUtc, endUtc: row.endUtc, loadKwh: row.demandKwh, pvKwh: row.pvKwh,
      directKwh: addedPv ? Math.min(row.demandKwh, row.pvKwh) : intervals[index].directKwh!,
      importKwh: addedPv ? Math.max(0, row.demandKwh - row.pvKwh) : intervals[index].importKwh!,
      exportKwh: addedPv ? Math.max(0, row.pvKwh - row.demandKwh) : intervals[index].exportKwh!,
      batteryToLoadKwh: 0, gridToBatteryKwh: 0, pvToBatteryKwh: 0, batteryToGridKwh: 0, socKwh: 0 }));
  }
  const after = billOfferWorkspaceScenario({ context, vatBasis, tariffHistory: input.targetHistory, settlement: targetPolicy,
    intervals: flows.map(row => ({ startUtc: row.startUtc, endUtc: row.endUtc, importKwh: row.importKwh, exportKwh: row.exportKwh, marketPriceNetPlnPerKwh: input.rdnPricesNet.get(row.startUtc) })) });
  if (after.status === 'blocked') return { ...result, reasons: after.reasons,
    warnings: [...new Set([...result.warnings, ...incomplete])] };
  result.warnings.push(...after.warnings);
  result.proposedBill = after.result; result.proposedAnnualCostPln = after.result.totals.cashDuePln;
  result.annualSavingsPln = result.baselineAnnualCostPln === null ? null
    : result.baselineAnnualCostPln - result.proposedAnnualCostPln;
  result.hardwareAnnualSavingsPln = result.tariffOnlyAnnualCostPln - result.proposedAnnualCostPln;
  result.pricesAsOf = input.pricesAsOf;
  result.forecastFlows = flows;
  Object.assign(result, forecastSummary(flows, workspace));
  const financing = calculateOfferWorkspaceFinancing({ clientType: workspace.clientType === 'B2B' ? 'B2B' : 'B2C',
    selectedPricingLines: pricing.lines.filter(line => line.includedInSale).map(line => ({ id: line.itemId,
      category: selected.flatMap(template => template.items).find(item => item.id === line.itemId)?.product?.category || null,
      amountGross: line.calculation?.saleGross ?? null })),
    batteryCapacityKwh: storage?.capacityKwh || 0, pvPowerKwp: totalPv,
    billingModel: draft.targetSettlement === 'NET_BILLING' ? 'net-billing' : 'net-metering',
    pme2: { applicationDate: input.pricesAsOf },
  });
  result.grantPln = draft.financing.considerGrant ? financing.pme2.conditionalGross : 0;
  if (draft.financing.considerGrant) result.warnings.push(...financing.pme2.reasons, 'Dotacja warunkowa: wymagane spełnienie regulaminu i dostępność budżetu.');
  result.taxReliefPln = 0;
  if (draft.financing.considerTaxRelief) {
    if (workspace.clientType !== 'B2C') {
      incomplete.push('Ulga termomodernizacyjna wymaga odrębnej oceny podatnika; nie stosujemy jej automatycznie dla B2B.');
      result.recommendationReasons!.push(incomplete.at(-1)!);
    }
    else if (settings.taxEstimateAccepted === true && result.systemCostPln !== null && result.grantPln !== null) {
      const deduction = Math.min(53000, Math.max(0, result.systemCostPln - result.grantPln));
      result.taxReliefPln = Math.round(deduction * 0.12 * 100) / 100;
      result.warnings.push('Szacunkowa ulga: 12% kosztu systemu po dotacji, od podstawy nie większej niż 53 000 zł. Założono kwalifikowalność całego zakresu, niewykorzystany limit, brak odliczenia VAT i wystarczający dochód opodatkowany stawką 12%. To nie jest potwierdzenie prawa do ulgi.');
    }
    else if ([settings.taxRatePercent, settings.taxRemainingLimitPln, settings.taxEligibleCostPln, settings.taxBasePln].some(value => value === null) || result.grantPln === null) {
      result.taxReliefPln = null;
      incomplete.push('Uzupełnij stawkę podatku, podstawę opodatkowania, pozostały limit i koszty kwalifikowane do ulgi.');
      result.recommendationReasons!.push(incomplete.at(-1)!);
    } else {
      if (result.systemCostPln === null) {
        incomplete.push('Koszt kwalifikowany do ulgi nie może zostać porównany z nieustaloną ceną zestawu.');
        result.taxReliefPln = null;
        result.recommendationReasons!.push(incomplete.at(-1)!);
      } else {
        if (settings.taxEligibleCostPln! > result.systemCostPln) throw new Error('Koszt kwalifikowany do ulgi przekracza koszt systemu.');
        const tax = calculateThermomodernizationRelief({ ownerOrCoOwnerOfExistingSingleFamilyHome: 'unknown', eligibleExpenditureConfirmed: 'unknown',
          eligibleInvoiceCostsGross: settings.taxEligibleCostPln!, deductibleVatGross: 0, grantReimbursementGross: result.grantPln!, otherReimbursementsGross: 0,
          previouslyUsedDeductionGross: 53000 - settings.taxRemainingLimitPln!, taxableBaseBeforeDeductionGross: settings.taxBasePln!,
          taxRegime: 'flat', taxBands: [{ upperBoundGross: null, marginalRate: settings.taxRatePercent! / 100 }],
          firstExpenseDate: input.pricesAsOf, completionDate: null, asOfDate: input.pricesAsOf });
        result.taxReliefPln = tax.theoreticalTaxSavingGross;
        result.warnings.push('Ulga jest symulacją przy zadanej stawce podatku, bez innych zwrotów kosztów i odliczonego VAT. Uprawnienie podatnika i faktury wymagają potwierdzenia.');
      }
    }
  }
  result.costAfterFinancingPln = result.systemCostPln === null || result.grantPln === null || result.taxReliefPln === null ? null
    : Math.round(Math.max(0, result.systemCostPln - result.grantPln - result.taxReliefPln) * 100) / 100;
  result.recommendationReasons = [...new Set(result.recommendationReasons || [])];
  if (storage) result.recommendationReasons.push('Symulacja magazynu wymaga walidacji dokładności i optymalizacji zgodnej z rozliczeniem depozytu. Porównanie ekonomiczne jest szacunkowe, nie stanowi zatwierdzenia technicznego zestawu.');
  if (provisionalEnergy) result.recommendationReasons.push('Model produkcji jest poniżej zmierzonego eksportu; wartości pozostają prowizoryczne i nie kwalifikują wariantu do rekomendacji.');
  if (draft.financing.considerTaxRelief && settings.taxEstimateAccepted) result.recommendationReasons.push('Ulga 12% jest oszacowana przy założeniu kwalifikowalności kosztów, wolnego limitu i wystarczającego dochodu.');
  if (result.baselineAnnualCostPln === null) result.warnings.push('Brak rachunku bazowego; rocznej oszczędności łącznej nie obliczono. Porównanie sprzętu pozostaje względem tej samej taryfy docelowej.');
  if (incomplete.length) result.warnings.push(...incomplete);
  result.recommendationEligible = selected.length > 0 && result.costAfterFinancingPln !== null
    && result.recommendationReasons.length === 0 && result.reasons.length === 0;
  result.paybackYears = result.recommendationEligible && result.costAfterFinancingPln !== null && result.hardwareAnnualSavingsPln > 0
    ? result.costAfterFinancingPln / result.hardwareAnnualSavingsPln : null;
  if (selected.length && result.costAfterFinancingPln !== null && targetPolicy.mode === 'NET_BILLING'
    && (!provisionalEnergy || settings.pvReconstructionAccepted === true)) {
    const estimate = estimateOfferWorkspacePayback({ tariffOnly: tariffOnly.result, proposed: after.result,
      policy: targetPolicy, costAfterFinancingPln: result.costAfterFinancingPln });
    result.estimatedPaybackYears = estimate.estimatedPaybackYears;
    result.estimatedAnnualSavingsPln = estimate.annualSavingsPln;
    result.estimatedAnnualTargetCostPln = estimate.annualTargetCostPln;
    result.estimatedAnnualTariffOnlyCostPln = estimate.annualTariffOnlyCostPln;
    result.estimateHorizonYears = estimate.horizonYears;
    result.warnings.push(estimate.annualSavingsPln.length
      ? `Szacunkowy zwrot: powtórzenie profilu 12 miesięcy przez ${estimate.horizonYears} lat, z przenoszeniem i wygasaniem transz depozytu. Stałe ceny, zużycie i praca magazynu; bez dyskontowania, degradacji i kosztów serwisu.`
      : 'Nie obliczono wieloletniego zwrotu: ujemne ceny energii wymagają odtworzenia rozliczenia depozytu w każdym interwale. Obliczony rachunek pierwszego roku pozostaje dostępny.');
  } else if (provisionalEnergy && !settings.pvReconstructionAccepted) {
    result.warnings.push('Do szacunkowego zwrotu zatwierdź odtworzenie produkcji PV ze zmierzonego eksportu i modelowanej autokonsumpcji albo popraw dane instalacji.');
  }
  result.warnings.push('Zwrot sprzętu liczony względem tej samej taryfy docelowej bez inwestycji. Korzyść z samej zmiany taryfy nie skraca zwrotu sprzętu.');
  result.warnings.push(`Taryfa docelowa według cennika z ${input.pricesAsOf}; zużycie i ceny eksportu z okresu pomiarów.`, 'Prosty czas zwrotu: stałe ceny pierwszego roku, bez dyskontowania, degradacji i kosztów serwisu.', 'Nie zakładamy wypłaty niewykorzystanego depozytu jako gwarantowanego wpływu gotówkowego.');
  result.warnings = [...new Set(result.warnings)];
  result.status = result.reasons.length ? 'blocked' : 'ready';
  return result;
}
