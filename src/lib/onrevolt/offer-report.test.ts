import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOfferReport, offerReportTemplateKey, offerReportTemplateVersion } from './offer-report';

function scenario() {
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    consumptionKwh: 500,
    pvGenerationKwh: 600,
    directPvKwh: 220,
    batteryDischargeToLoadKwh: 120,
    gridImportKwh: 160,
    exportKwh: 260,
  }));
  return {
    pvPowerKw: 6,
    batteryCapacityKwh: 16,
    input: {
      energyBuyGrossPerKwh: 0.7,
      distributionGrossPerKwh: 0.3,
      exportGrossPerKwh: 0.5,
      fixedMonthlyGross: 30,
      pvHourlyProfiles: Array.from({ length: 12 }, () => Array.from({ length: 24 }, (_, hour) => hour >= 7 && hour <= 17 ? 1 : 0)),
    },
    result: {
      months,
      annualConsumptionKwh: 6000,
      annualPvGenerationKwh: 7200,
      annualGridImportKwh: 1920,
      annualExportKwh: 3120,
      annualDirectPvKwh: 2640,
      annualBatteryDischargeKwh: 1440,
      baselineAnnualCostGross: 6360,
      scenarioAnnualCostGross: 1900,
      annualSavingsGross: 4460,
      savingsPercent: 70.1,
      finalDepositGross: 600,
      depositPayoutGross: 180,
    },
  };
}

function offer(clientType: 'B2C' | 'B2B') {
  return {
    number: 'ONR/2026/08/0001',
    clientSnapshot: {
      clientName: 'Klient testowy',
      clientType,
      email: 'klient@example.com',
      phone: '+48 500 000 000',
      investmentAddress: 'Poznań',
    },
    lineItemsSnapshot: [
      { position: 1, description: 'Magazyn energii', model: 'PowerBrick', category: 'MAGAZYN_ENERGII', quantity: 1, saleNet: 20000, saleGross: 21600, role: 'MAIN_EQUIPMENT', sourceConfigurationName: 'Magazyn 16 kWh', sourceConfigurationKind: 'MAGAZYN' },
      { position: 2, description: 'Przewody', quantity: 10, saleNet: 1000, saleGross: 1080, role: 'CABLING', sourceConfigurationName: 'Magazyn 16 kWh', sourceConfigurationKind: 'MAGAZYN' },
    ],
    calculationSnapshot: {
      totalNet: 21000,
      totalGross: 22680,
      totalAfterSupportGross: 20000,
      currentAnnualBillGross: 6360,
      projectedAnnualBillGross: 1900,
      annualSavingsGross: 4460,
      savingsPercent: 70.1,
      paybackYears: 4.5,
    },
    energySnapshot: {
      measurementMonths: ['2025-09', '2026-08'],
      audit: {
        existingPvKw: 0,
        existingBatteryKwh: 0,
        terrainType: 'SUBURBAN',
        buildingType: 'SINGLE_FAMILY',
        roofShape: 'GABLE_BARN',
        settlementSystem: 'net-billing',
        energySupplier: 'ENEA',
        connectionType: 'LOW_VOLTAGE',
        connectionPowerKw: 11,
        heatingSource: 'NATURAL_GAS',
        heatingSourceDetail: 'GAS_CONDENSING',
      },
      scenario: scenario(),
      usageProfile: {
        annualKwh: 6000,
        warnings: [],
        months: [{
          key: '2026-07', year: 2026, month: 7, totalKwh: 500,
          hourly: Array.from({ length: 24 }, () => 20),
          weekdayHourly: Array.from({ length: 24 }, () => 1),
          weekendHourly: Array.from({ length: 24 }, () => 0.8),
          weekdayDays: 22, weekendDays: 9, sourceFiles: 1,
        }],
      },
    },
  };
}

test('buduje ofertę B2C z pięciostronicowego szablonu Reform', () => {
  const report = buildOfferReport(offer('B2C'));
  assert.equal(report.templateKey, offerReportTemplateKey);
  assert.equal(report.templateVersion, offerReportTemplateVersion);
  assert.equal(report.variant, 'B2C');
  assert.equal(report.costs.priceLabel, 'brutto');
  assert.equal(report.costs.rows.length, 4);
  assert.equal(report.costs.rows[0].description, 'Zakup magazynu energii wraz z montażem');
  assert.equal(report.costs.rows[0].model, 'PowerBrick');
  assert.equal(report.costs.rows[0].value, 22680);
  assert.equal(report.costs.rows[1].available, false);
  assert.equal(report.costs.rows[2].available, false);
  assert.equal(report.costs.rows[3].available, false);
  assert.equal(report.costs.rows.reduce((total, row) => total + row.value, 0), 22680);
  assert.equal(report.energy.projectedMonths.length, 12);
  assert.equal(report.energy.period, 'Wrzesień 2025 - Sierpień 2026');
  assert.equal(report.deposit.exportKwh, 3120);
  assert.equal(report.report.terrain, 'Teren podmiejski');
  assert.equal(report.report.buildingType, 'Dom jednorodzinny');
  assert.equal(report.report.roofType, 'Dwuspadowy');
  assert.equal(report.report.connectionType, 'Niskie napięcie');
  assert.equal(report.report.connectionPowerKw, 11);
  assert.equal(report.report.supplier, 'Enea');
  assert.equal(report.report.heatingSource, 'Gaz ziemny');
  assert.equal(report.report.heatingDetails, 'Piec kondensacyjny');
});

test('nie zakłada net-meteringu, gdy system rozliczeniowy nie został wybrany', () => {
  const input = offer('B2C');
  Object.assign(input, { settlementBefore: 'net-metering' });
  input.energySnapshot.audit.settlementSystem = null;

  const report = buildOfferReport(input);

  assert.equal(report.report.settlement, '');
  assert.equal(report.tariffs.settlementBefore, '');
});

test('procent oszczędności wynika z kwot widocznych w raporcie', () => {
  const input = offer('B2C');
  input.calculationSnapshot.annualSavingsGross = 999;
  input.calculationSnapshot.savingsPercent = 99;

  const report = buildOfferReport(input);

  assert.equal(report.savings.currentBill, 6360);
  assert.equal(report.savings.projectedBill, 1900);
  assert.equal(report.savings.annual, 4460);
  assert.equal(report.savings.percent, 70.1);
});

test('wariant B2B używa cen netto i rzeczywistych profili dnia roboczego oraz wolnego', () => {
  const report = buildOfferReport(offer('B2B'));
  assert.equal(report.variant, 'B2B');
  assert.equal(report.costs.priceLabel, 'netto');
  assert.equal(report.costs.systemValue, 21000);
  assert.equal(report.energy.summerWeekday.available, true);
  assert.equal(report.energy.summerWeekend.available, true);
  assert.equal(report.energy.summerWeekday.month, 7);
  assert.equal(report.energy.summerWeekday.consumption.length, 24);
});

test('nie tworzy zastępczego wykresu dnia bez danych godzinowych ENEA', () => {
  const source = offer('B2B');
  source.energySnapshot.usageProfile.months = [];
  const report = buildOfferReport(source);
  assert.equal(report.energy.summerWeekday.available, false);
  assert.equal(report.energy.winterWeekend.available, false);
  assert.equal(report.energy.summerWeekday.consumption.every((value) => value === 0), true);
});

test('pokazuje wszystkie strefy taryfy G13active ze snapshotu RE', () => {
  const source = offer('B2C');
  (source.energySnapshot.scenario.input as any).targetTariff = {
    source: 'WINDYONE_RE',
    sourceUrl: 'https://windyone.pl/re/setup.php',
    fetchedAt: '2026-08-11T00:00:00.000Z',
    zoneRates: [
      { code: 'high', label: 'Wysoka', energyGrossPerKwh: 0.7915, distributionGrossPerKwh: 0.426441, totalGrossPerKwh: 1.217941 },
      { code: 'mid', label: 'Średnia', energyGrossPerKwh: 0.6089, distributionGrossPerKwh: 0.355593, totalGrossPerKwh: 0.964493 },
      { code: 'low', label: 'Niska', energyGrossPerKwh: 0.341, distributionGrossPerKwh: 0.143295, totalGrossPerKwh: 0.484295 },
    ],
  };
  const report = buildOfferReport(source);
  assert.equal(report.tariffs.projected.zoneRates.length, 3);
  assert.equal(report.tariffs.projected.zoneRates[2].label, 'Niska');
  assert.equal(report.tariffs.projected.zoneRates[2].totalPerKwh, 0.4843);
});
