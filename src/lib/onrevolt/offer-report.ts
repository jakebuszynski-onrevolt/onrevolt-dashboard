import {
  buildingTypeLabel,
  connectionTypeLabel,
  energySupplierLabel,
  heatSourceDetailLabel,
  heatSourceLabel as energyHeatSourceLabel,
  roofShapeLabel,
  settlementSystemLabel,
  terrainTypeLabel,
} from './energy-intake';

export const offerReportTemplateVersion = 'REFORM_2026_08_V1';

export const monthNames = [
  'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień',
];

type MonthlyBalance = {
  month: number;
  consumptionKwh: number;
  pvGenerationKwh: number;
  directPvKwh: number;
  batteryKwh: number;
  gridImportKwh: number;
  exportKwh: number;
};

type DailyBalance = {
  available: boolean;
  month: number;
  year?: number;
  dayType: 'weekday' | 'weekend';
  consumption: number[];
  pvGeneration: number[];
  directPv: number[];
  gridImport: number[];
  export: number[];
};

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: unknown) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function snapshot<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + numberValue(value), 0);
}

function normalize(values: number[]) {
  const total = sum(values);
  return total > 0 ? values.map((value) => value / total) : values.map(() => 0);
}

function lineValue(line: any, b2b: boolean) {
  return numberValue(b2b ? line.saleNet : line.saleGross);
}

function groupOfferLines(lines: any[], b2b: boolean) {
  const sorted = lines.slice().sort((a, b) => numberValue(a.position) - numberValue(b.position));
  const primary = sorted.filter((line) => ['MAIN_EQUIPMENT', 'MONITORING'].includes(line.role));
  const selected = primary.slice(0, 6);
  const selectedLines = new Set(selected);
  const rows = selected.map((line) => {
    const quantity = numberValue(line.quantity) || 1;
    const value = lineValue(line, b2b);
    return {
      description: text(line.description || line.name) || 'Element systemu',
      model: text(line.model || line.sku || line.producer),
      quantity,
      unitValue: round(value / quantity),
      value: round(value),
      source: text(line.sourceConfigurationName),
    };
  });
  const remaining = sorted.filter((line) => !selectedLines.has(line));
  if (remaining.length) {
    const sourceNames = Array.from(new Set(remaining.map((line) => text(line.sourceConfigurationName)).filter(Boolean)));
    rows.push({
      description: 'Montaż, osprzęt i uruchomienie',
      model: sourceNames.join(' + '),
      quantity: 1,
      unitValue: round(remaining.reduce((total, line) => total + lineValue(line, b2b), 0)),
      value: round(remaining.reduce((total, line) => total + lineValue(line, b2b), 0)),
      source: '',
    });
  }
  return rows;
}

function existingMonthlyBalance(resultMonths: any[], energy: any): MonthlyBalance[] {
  const audit = energy.audit || {};
  const scenario = energy.scenario || {};
  const existingPvKw = numberValue(audit.existingPvKw);
  const targetPvKw = numberValue(scenario.pvPowerKw);
  const pvRatio = targetPvKw > 0 ? Math.min(1, existingPvKw / targetPvKw) : 0;
  const existingBatteryKwh = numberValue(audit.existingBatteryKwh);
  const targetBatteryKwh = numberValue(scenario.batteryCapacityKwh);
  const batteryRatio = targetBatteryKwh > 0 ? Math.min(1, existingBatteryKwh / targetBatteryKwh) : 0;

  return resultMonths.map((month: any, index: number) => {
    const consumptionKwh = numberValue(month.consumptionKwh);
    const pvGenerationKwh = numberValue(month.pvGenerationKwh) * pvRatio;
    const directPvKwh = Math.min(consumptionKwh, numberValue(month.directPvKwh) * pvRatio);
    const batteryKwh = Math.min(consumptionKwh - directPvKwh, numberValue(month.batteryDischargeToLoadKwh) * batteryRatio);
    return {
      month: numberValue(month.month) || index + 1,
      consumptionKwh: round(consumptionKwh),
      pvGenerationKwh: round(pvGenerationKwh),
      directPvKwh: round(directPvKwh),
      batteryKwh: round(batteryKwh),
      gridImportKwh: round(Math.max(0, consumptionKwh - directPvKwh - batteryKwh)),
      exportKwh: round(Math.max(0, pvGenerationKwh - directPvKwh)),
    };
  });
}

function projectedMonthlyBalance(resultMonths: any[]): MonthlyBalance[] {
  return resultMonths.map((month: any, index: number) => ({
    month: numberValue(month.month) || index + 1,
    consumptionKwh: round(numberValue(month.consumptionKwh)),
    pvGenerationKwh: round(numberValue(month.pvGenerationKwh)),
    directPvKwh: round(numberValue(month.directPvKwh)),
    batteryKwh: round(numberValue(month.batteryDischargeToLoadKwh)),
    gridImportKwh: round(numberValue(month.gridImportKwh)),
    exportKwh: round(numberValue(month.exportKwh)),
  }));
}

function characteristic(months: MonthlyBalance[]) {
  const available = months.filter((month) => month.consumptionKwh > 0);
  if (!available.length) return { high: null, medium: null, low: null };
  const sorted = available.slice().sort((a, b) => a.consumptionKwh - b.consumptionKwh);
  return {
    low: sorted[0],
    medium: sorted[Math.floor((sorted.length - 1) / 2)],
    high: sorted[sorted.length - 1],
  };
}

function profileMonth(usageProfile: any, candidates: number[]) {
  const months = Array.isArray(usageProfile?.months) ? usageProfile.months : [];
  return candidates.map((month) => months.find((entry: any) => numberValue(entry.month) === month)).find(Boolean) || null;
}

function dailyBalance(energy: any, dayType: 'weekday' | 'weekend', season: 'summer' | 'winter'): DailyBalance {
  const usageMonth = profileMonth(energy.usageProfile, season === 'summer' ? [7, 6, 5, 8] : [1, 12, 2]);
  const scenarioInput = energy.scenario?.input || {};
  const scenarioMonths = energy.scenario?.result?.months || [];
  const monthNumber = numberValue(usageMonth?.month);
  const profile = usageMonth?.[dayType === 'weekday' ? 'weekdayHourly' : 'weekendHourly'];
  const dayCount = numberValue(usageMonth?.[dayType === 'weekday' ? 'weekdayDays' : 'weekendDays']);
  if (!usageMonth || !Array.isArray(profile) || profile.length !== 24 || dayCount === 0) {
    return {
      available: false,
      month: monthNumber || (season === 'summer' ? 7 : 1),
      year: optionalNumber(usageMonth?.year) || undefined,
      dayType,
      consumption: Array.from({ length: 24 }, () => 0),
      pvGeneration: Array.from({ length: 24 }, () => 0),
      directPv: Array.from({ length: 24 }, () => 0),
      gridImport: Array.from({ length: 24 }, () => 0),
      export: Array.from({ length: 24 }, () => 0),
    };
  }

  const consumption = profile.map(numberValue);
  const scenarioMonth = scenarioMonths.find((month: any) => numberValue(month.month) === monthNumber);
  const pvProfile = normalize(Array.isArray(scenarioInput.pvHourlyProfiles?.[monthNumber - 1])
    ? scenarioInput.pvHourlyProfiles[monthNumber - 1].map(numberValue)
    : Array.from({ length: 24 }, () => 0));
  const daysInMonth = new Date(numberValue(usageMonth.year), monthNumber, 0).getDate();
  const pvDaily = numberValue(scenarioMonth?.pvGenerationKwh) / Math.max(daysInMonth, 1);
  const pvGeneration = pvProfile.map((share) => round(share * pvDaily));
  const directPv = consumption.map((load, hour) => round(Math.min(load, pvGeneration[hour])));
  const gridImport = consumption.map((load, hour) => round(Math.max(0, load - directPv[hour])));
  const exportKwh = pvGeneration.map((pv, hour) => round(Math.max(0, pv - directPv[hour])));
  return {
    available: true,
    month: monthNumber,
    year: numberValue(usageMonth.year),
    dayType,
    consumption: rounded24(consumption),
    pvGeneration,
    directPv,
    gridImport,
    export: exportKwh,
  };
}

function rounded24(values: number[]) {
  return Array.from({ length: 24 }, (_, hour) => round(numberValue(values[hour])));
}

function periodLabel(measurementMonths: string[]) {
  if (!measurementMonths.length) return 'Model roczny';
  const sorted = measurementMonths.slice().sort();
  const format = (value: string) => {
    const [year, month] = value.split('-').map(Number);
    return `${monthNames[month - 1] || month} ${year}`;
  };
  return sorted.length === 1 ? format(sorted[0]) : `${format(sorted[0])} - ${format(sorted[sorted.length - 1])}`;
}

function roofLabel(value: unknown) {
  const raw = text(value);
  return ({ SLOPED: 'Dach skośny', GROUND: 'Grunt', OTHER: 'Inny' } as Record<string, string>)[raw]
    || roofShapeLabel(raw);
}

function buildingLabel(value: unknown) {
  const raw = text(value);
  return ({ house: 'Budynek jednorodzinny', apartment: 'Budynek wielorodzinny', commercial: 'Obiekt usługowy', industrial: 'Obiekt produkcyjno-magazynowy', farm: 'Gospodarstwo rolne' } as Record<string, string>)[raw]
    || buildingTypeLabel(raw);
}

function tariffZoneRates(value: unknown, valueFactor: number) {
  const tariff = value && typeof value === 'object' ? value as Record<string, any> : {};
  const rates = Array.isArray(tariff.zoneRates) ? tariff.zoneRates : [];
  return rates.map((rate: any) => ({
    code: text(rate.code),
    label: text(rate.label || rate.code),
    energyPerKwh: round(numberValue(rate.energyGrossPerKwh) * valueFactor, 4),
    distributionPerKwh: round(numberValue(rate.distributionGrossPerKwh) * valueFactor, 4),
    totalPerKwh: round(numberValue(rate.totalGrossPerKwh) * valueFactor, 4),
  }));
}

export function buildOfferReport(offer: any) {
  const client = snapshot<Record<string, any>>(offer.clientSnapshot, {});
  const energy = snapshot<Record<string, any>>(offer.energySnapshot, {});
  const calculation = snapshot<Record<string, any>>(offer.calculationSnapshot, {});
  const lines = snapshot<any[]>(offer.lineItemsSnapshot, []);
  const scenario = energy.scenario || {};
  const input = scenario.input || {};
  const result = scenario.result || {};
  const siteForm = energy.siteAudit?.formData || {};
  const audit = energy.audit || {};
  const account = Array.isArray(energy.operatorAccounts) ? energy.operatorAccounts[0] || {} : {};
  const b2b = client.clientType === 'B2B';
  const valueFactor = b2b ? 1 / 1.23 : 1;
  const monthlyResult = Array.isArray(result.months) && result.months.length === 12 ? result.months : [];
  const currentMonths = existingMonthlyBalance(monthlyResult, energy);
  const projectedMonths = projectedMonthlyBalance(monthlyResult);
  const annualConsumption = numberValue(result.annualConsumptionKwh || audit.annualConsumptionKwh || energy.usageProfile?.annualKwh);
  const annualPv = numberValue(result.annualPvGenerationKwh);
  const annualImport = numberValue(result.annualGridImportKwh);
  const annualExport = numberValue(result.annualExportKwh);
  const annualDirectPv = numberValue(result.annualDirectPvKwh);
  const annualBattery = numberValue(result.annualBatteryDischargeKwh);
  const energyBuy = numberValue(input.energyBuyGrossPerKwh);
  const distribution = numberValue(input.distributionGrossPerKwh);
  const fixedMonthly = numberValue(input.fixedMonthlyGross);
  const currentTariffSnapshot = input.currentTariff || null;
  const targetTariffSnapshot = input.targetTariff || null;
  const exportRate = numberValue(input.exportGrossPerKwh);
  const depositGenerated = annualExport * exportRate;
  const depositFinal = numberValue(result.finalDepositGross);
  const depositUsed = Math.max(0, depositGenerated - depositFinal);
  const depositPayout = numberValue(result.depositPayoutGross);
  const currentPurchase = optionalNumber(result.baselineAnnualEnergyCostGross) ?? annualConsumption * energyBuy;
  const currentDistribution = optionalNumber(result.baselineAnnualDistributionCostGross) ?? annualConsumption * distribution;
  const currentFixed = optionalNumber(result.baselineAnnualFixedCostGross) ?? fixedMonthly * 12;
  const projectedPurchaseDue = optionalNumber(result.scenarioAnnualEnergyDueGross) ?? annualImport * energyBuy;
  const projectedPurchaseCash = optionalNumber(result.scenarioAnnualEnergyCashGross)
    ?? Math.max(0, projectedPurchaseDue - depositUsed);
  const projectedDistribution = optionalNumber(result.scenarioAnnualDistributionCostGross) ?? annualImport * distribution;
  const projectedFixed = optionalNumber(result.scenarioAnnualFixedCostGross) ?? currentFixed;
  const currentEnergyRate = annualConsumption > 0 ? currentPurchase / annualConsumption : energyBuy;
  const currentDistributionRate = annualConsumption > 0 ? currentDistribution / annualConsumption : distribution;
  const projectedEnergyRate = annualImport > 0 ? projectedPurchaseDue / annualImport : energyBuy;
  const projectedDistributionRate = annualImport > 0 ? projectedDistribution / annualImport : distribution;
  const totalNet = numberValue(calculation.totalNet || offer.totalNet);
  const totalGross = numberValue(calculation.totalGross || offer.totalGross);
  const totalAfterSupportGross = numberValue(calculation.totalAfterSupportGross || offer.totalAfterSupportGross || totalGross);
  const currentBill = numberValue(calculation.currentAnnualBillGross || offer.currentAnnualBillGross || result.baselineAnnualCostGross);
  const projectedBill = numberValue(calculation.projectedAnnualBillGross || offer.projectedAnnualBillGross || result.scenarioAnnualCostGross);
  const annualSavings = numberValue(calculation.annualSavingsGross || offer.annualSavingsGross || result.annualSavingsGross);
  const configurations = Array.from(new Set(lines.map((line) => text(line.sourceConfigurationName)).filter(Boolean)));
  const existingPv = numberValue(audit.existingPvKw);

  return {
    templateVersion: offerReportTemplateVersion,
    variant: b2b ? 'B2B' as const : 'B2C' as const,
    number: text(offer.number) || '-',
    title: text(offer.title),
    validUntil: offer.validUntil,
    createdAt: offer.createdAt,
    client: {
      name: text(client.clientName) || '-',
      taxId: text(client.taxId),
      address: text(client.addressLine),
      postalCode: text(client.postalCode),
      city: text(client.city),
      investmentAddress: text(client.investmentAddress),
      email: text(client.email),
      phone: text(client.phone),
      ownerName: text(client.ownerName),
      coverImageDocumentId: text(energy.siteAudit?.coverImageDocumentId),
      coverImageTitle: text(energy.siteAudit?.coverImageTitle),
    },
    report: {
      terrain: terrainTypeLabel(siteForm.terrain_type || audit.terrainType),
      buildingType: buildingLabel(siteForm.building_type || audit.buildingType),
      roofType: roofLabel(siteForm.roof_type || audit.roofShape || audit.roofType),
      activityProfile: text(siteForm.activity_profile),
      workCycle: text(siteForm.work_cycle),
      transformer: text(siteForm.transformer),
      connectionPowerKw: optionalNumber(siteForm.connection_power_kw || audit.connectionPowerKw),
      phaseCount: optionalNumber(siteForm.phase_count ?? audit.phaseCount),
      connectionType: connectionTypeLabel(siteForm.connection_type || audit.connectionType),
      tariff: text(account.tariff || offer.tariffBefore),
      settlement: settlementSystemLabel(offer.settlementBefore || audit.settlementSystem),
      operator: text(account.operator),
      supplier: energySupplierLabel(siteForm.energy_supplier || audit.energySupplier),
      heatingSource: energyHeatSourceLabel(siteForm.heating_source || audit.heatingSource),
      heatingDetails: text(siteForm.heating_params)
        || heatSourceDetailLabel(audit.heatingSource, audit.heatingSourceDetail),
      currentLoads: Array.isArray(siteForm.loads) ? siteForm.loads.map((item: any) => text(item.device || item.params)).filter(Boolean).join(', ') : '',
      plannedLoads: text(siteForm.planned_loads),
      hasPv: existingPv > 0,
      existingPvKw: existingPv || null,
      pvPlace: text(siteForm.pv_place),
      configurations,
    },
    costs: {
      priceLabel: b2b ? 'netto' : 'brutto',
      rows: groupOfferLines(lines, b2b),
      systemValue: round(b2b ? totalNet : totalGross),
      subsidy: round(numberValue(calculation.subsidyGross || offer.subsidyGross) * valueFactor),
      thermoRelief: round(numberValue(calculation.thermoReliefGross || offer.thermoReliefGross) * valueFactor),
      afterSupport: round(totalAfterSupportGross * valueFactor),
    },
    savings: {
      currentBill: round(currentBill * valueFactor),
      projectedBill: round(projectedBill * valueFactor),
      annual: round(annualSavings * valueFactor),
      percent: numberValue(calculation.savingsPercent || result.savingsPercent),
      paybackYears: optionalNumber(calculation.paybackYears || offer.paybackYears || result.simplePaybackYears),
    },
    tariffs: {
      before: text(offer.tariffBefore || account.tariff),
      afterName: text(offer.tariffAfter),
      settlementBefore: text(offer.settlementBefore),
      settlementAfter: text(offer.settlementAfter) || 'net-billing',
      current: {
        energyPerKwh: round(currentEnergyRate * valueFactor, 4),
        distributionPerKwh: round(currentDistributionRate * valueFactor, 4),
        totalPerKwh: round((currentEnergyRate + currentDistributionRate) * valueFactor, 4),
        fixedMonthly: round(currentFixed / 12 * valueFactor, 2),
        zoneRates: tariffZoneRates(currentTariffSnapshot, valueFactor),
        sourceUrl: text(currentTariffSnapshot?.sourceUrl),
        fetchedAt: text(currentTariffSnapshot?.fetchedAt),
      },
      projected: {
        energyPerKwh: round(projectedEnergyRate * valueFactor, 4),
        distributionPerKwh: round(projectedDistributionRate * valueFactor, 4),
        totalPerKwh: round((projectedEnergyRate + projectedDistributionRate) * valueFactor, 4),
        fixedMonthly: round(projectedFixed / 12 * valueFactor, 2),
        zoneRates: tariffZoneRates(targetTariffSnapshot, valueFactor),
        sourceUrl: text(targetTariffSnapshot?.sourceUrl),
        fetchedAt: text(targetTariffSnapshot?.fetchedAt),
      },
    },
    bills: {
      current: {
        consumptionKwh: annualConsumption,
        pvDirectKwh: sum(currentMonths.map((month) => month.directPvKwh)),
        gridImportKwh: sum(currentMonths.map((month) => month.gridImportKwh)) || annualConsumption,
        energy: round(currentPurchase * valueFactor),
        distribution: round(currentDistribution * valueFactor),
        fixed: round(currentFixed * valueFactor),
        total: round(currentBill * valueFactor),
      },
      projected: {
        consumptionKwh: annualConsumption,
        pvDirectKwh: annualDirectPv,
        batteryKwh: annualBattery,
        gridImportKwh: annualImport,
        energyDue: round(projectedPurchaseDue * valueFactor),
        energyCash: round(projectedPurchaseCash * valueFactor),
        distribution: round(projectedDistribution * valueFactor),
        fixed: round(projectedFixed * valueFactor),
        total: round(projectedBill * valueFactor),
      },
    },
    deposit: {
      generated: round(depositGenerated * valueFactor),
      used: round(depositUsed * valueFactor),
      remaining: round(depositFinal * valueFactor),
      payout: round(depositPayout * valueFactor),
      exportKwh: annualExport,
      importCoveredKwh: projectedEnergyRate > 0 ? round(depositUsed / projectedEnergyRate) : 0,
    },
    energy: {
      period: periodLabel(Array.isArray(energy.measurementMonths) ? energy.measurementMonths : []),
      currentMonths,
      projectedMonths,
      characteristics: characteristic(projectedMonths.length ? projectedMonths : currentMonths),
      annualConsumption,
      annualPv,
      annualImport,
      annualExport,
      annualDirectPv,
      annualBattery,
      averageImportPrice: annualImport > 0 ? round(projectedPurchaseDue / annualImport, 4) : 0,
      averageExportPrice: annualExport > 0 ? round(depositGenerated / annualExport, 4) : 0,
      summerWeekday: dailyBalance(energy, 'weekday', 'summer'),
      summerWeekend: dailyBalance(energy, 'weekend', 'summer'),
      winterWeekday: dailyBalance(energy, 'weekday', 'winter'),
      winterWeekend: dailyBalance(energy, 'weekend', 'winter'),
      warnings: Array.isArray(energy.usageProfile?.warnings) ? energy.usageProfile.warnings : [],
    },
    description: {
      before: text(offer.descriptionBefore || client.clientProblem),
      after: text(offer.descriptionAfter || client.expectedResult),
    },
  };
}
