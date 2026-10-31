import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareOfferReInput, recommendOfferReSocStepKwh, runOfferReDiagnostic, validateOfferReResult, type OfferReInput } from './offer-re-adapter';

function fixture(start = '2026-01-01T23:00:00Z', hours = 24): OfferReInput {
  return {
    settlement: 'NET_BILLING', initialSocKwh: 0, initialDepositPln: 0, socStepKwh: 0.25,
    battery: { capacityKwh: 0, reserveKwh: 0, maxChargeKw: 0, maxDischargeKw: 0, chargeEfficiency: 1, dischargeEfficiency: 1 },
    intervals: Array.from({ length: hours }, (_, index) => ({
      startUtc: new Date(Date.parse(start) + index * 3600000).toISOString(),
      endUtc: new Date(Date.parse(start) + (index + 1) * 3600000).toISOString(),
      demandKwh: 1, pvKwh: 0, energyBuyPrice: index % 24 < 6 ? 0.2 : 1,
      distributionBuyPrice: 0.1, sellPrice: 0,
    })),
  };
}

test('zerowy magazyn pozostaje zerowy, pobór obejmuje całe zużycie', async () => {
  const result = await runOfferReDiagnostic(fixture());
  assert.equal(result.verifiedPhysicalBalance, true);
  assert.equal(result.result.finalState.socKwh, 0);
  const slots = result.result.days.flatMap((day) => day.slots);
  assert.equal(slots.reduce((sum, slot) => sum + slot.gridBuyLoad, 0), 24);
  assert.equal(slots.reduce((sum, slot) => sum + slot.gridBuyBank, 0), 0);
});

test('RE przesuwa zakup do tańszej strefy bez tworzenia energii', async () => {
  const input = fixture();
  input.battery = { ...input.battery, capacityKwh: 4, maxChargeKw: 2, maxDischargeKw: 2 };
  const result = await runOfferReDiagnostic(input);
  assert.equal(result.verifiedPhysicalBalance, true);
  const slots = result.result.days.flatMap((day) => day.slots);
  assert.ok(slots.some((slot) => slot.gridBuyBank > 0));
  assert.ok(slots.some((slot) => slot.bankToLoad > 0));
  const totalImport = slots.reduce((sum, slot) => sum + slot.gridBuyLoad + slot.gridBuyBank, 0);
  assert.ok(Math.abs(totalImport - 24 - result.result.finalState.socKwh) < 1e-6);
});

test('pusty magazyn z rezerwą nie otrzymuje darmowej energii na starcie', async () => {
  const input = fixture();
  input.battery = { ...input.battery, capacityKwh: 16, reserveKwh: 1.6, maxChargeKw: 5, maxDischargeKw: 5,
    chargeEfficiency: 0.95, dischargeEfficiency: 0.95 };
  input.socStepKwh = 0.1;
  const result = await runOfferReDiagnostic(input);
  assert.equal(result.verifiedPhysicalBalance, true, JSON.stringify(result.issues));
  const slots = result.result.days.flatMap(day => day.slots);
  assert.equal(slots[0].bankStart, 0);
  assert.equal(slots[0].bankToLoad, 0);
  const imports = slots.reduce((sum, slot) => sum + slot.gridBuyLoad + slot.gridBuyBank, 0);
  assert.ok(imports >= 24, `Za mały zakup z sieci: ${imports}`);
});

test('walidator RE odrzuca uszkodzone przepływy, SOC, limity mocy i stan końcowy', async () => {
  const input = fixture();
  input.battery = { capacityKwh: 4, reserveKwh: 1, maxChargeKw: 2, maxDischargeKw: 2,
    chargeEfficiency: 0.9, dischargeEfficiency: 0.9 };
  input.initialSocKwh = 2;
  input.socStepKwh = 1;
  const prepared = prepareOfferReInput(input);
  const baseline = await runOfferReDiagnostic(input);
  assert.equal(baseline.verifiedPhysicalBalance, true, JSON.stringify(baseline.issues));

  const clone = () => JSON.parse(JSON.stringify(baseline.result)) as typeof baseline.result;
  const assertIssue = (code: string, mutate: (result: typeof baseline.result) => void) => {
    const damaged = clone();
    mutate(damaged);
    assert.ok(validateOfferReResult(input, prepared, damaged).some((issue) => issue.code === code), code);
  };

  const flowFields = ['gridBuyLoad', 'gridBuyBank', 'pvToLoad', 'pvToBank', 'bankToLoad', 'bankToSell', 'sellImmediate'] as const;
  for (const field of flowFields) {
    assertIssue('INVALID_FLOW_QUANTITY', (result) => { result.days[0].slots[0][field] = -0.01; });
  }
  assertIssue('INVALID_FLOW_QUANTITY', (result) => { result.days[0].slots[0].pvToBank = Number.NaN; });
  assertIssue('SOC_CONTINUITY_MISMATCH', (result) => { result.days[0].slots[1].bankStart += 0.1; });
  assertIssue('SOC_OUT_OF_BOUNDS', (result) => { result.days[0].slots[0].bankEnd = input.battery.capacityKwh + 0.01; });
  assertIssue('RESERVE_VIOLATION', (result) => { result.days[0].slots[0].bankEnd = input.battery.reserveKwh - 0.01; });
  assertIssue('CHARGE_AC_LIMIT_EXCEEDED', (result) => { result.days[0].slots[0].gridBuyBank = input.battery.maxChargeKw + 0.1; });
  assertIssue('DISCHARGE_AC_LIMIT_EXCEEDED', (result) => { result.days[0].slots[0].bankToLoad = input.battery.maxDischargeKw + 0.1; });
  assertIssue('LOAD_BALANCE_MISMATCH', (result) => { result.days[0].slots[0].pvToLoad += 0.1; });
  assertIssue('DAY_STATE_MISMATCH', (result) => { result.days[0].stateOut.socKwh += 0.1; });
  assertIssue('FINAL_STATE_MISMATCH', (result) => { result.finalState.socKwh += 0.1; });
  assertIssue('FINAL_STATE_MISMATCH', (result) => { result.finalState.depositPln += 1; });
});

test('walidator respektuje obniżoną rezerwę dla okazji eksportowej silnika', () => {
  const input: OfferReInput = {
    settlement: 'NET_BILLING', initialSocKwh: 1.5, initialDepositPln: 0, socStepKwh: 0.5,
    battery: { capacityKwh: 4, reserveKwh: 1.6, maxChargeKw: 1, maxDischargeKw: 1,
      chargeEfficiency: 1, dischargeEfficiency: 1 },
    intervals: [
      { startUtc: '2026-01-01T17:00:00Z', endUtc: '2026-01-01T18:00:00Z', demandKwh: 0, pvKwh: 0,
        energyBuyPrice: 0.4, distributionBuyPrice: 0, sellPrice: 1 },
      { startUtc: '2026-01-01T18:00:00Z', endUtc: '2026-01-01T19:00:00Z', demandKwh: 0, pvKwh: 0,
        energyBuyPrice: 0.1, distributionBuyPrice: 0, sellPrice: 0.2 },
    ],
  };
  const prepared = prepareOfferReInput(input);
  const result = {
    days: [{ dateKey: prepared.days[0].dateKey, totals: {}, slots: [
      { slotStart: input.intervals[0].startUtc, slotEnd: input.intervals[0].endUtc, load: 0, pv: 0, bankStart: 1.5, bankEnd: 1,
        gridBuyLoad: 0, gridBuyBank: 0, pvToLoad: 0, pvToBank: 0, bankToLoad: 0, bankToSell: 0.5, sellImmediate: 0 },
      { slotStart: input.intervals[1].startUtc, slotEnd: input.intervals[1].endUtc, load: 0, pv: 0, bankStart: 1, bankEnd: 1,
        gridBuyLoad: 0, gridBuyBank: 0, pvToLoad: 0, pvToBank: 0, bankToLoad: 0, bankToSell: 0, sellImmediate: 0 },
    ], stateOut: { socKwh: 1, depositPln: 0.5 } }],
    finalState: { socKwh: 1, depositPln: 0.5 },
  };
  assert.deepEqual(validateOfferReResult(input, prepared, result), []);
});

test('roczna siatka SOC mieści się w budżecie pracy bez ukrytej zmiany kroku', () => {
  const input = fixture('2024-12-31T23:00:00Z', 8760);
  input.battery = { capacityKwh: 16, reserveKwh: 1.6, maxChargeKw: 5, maxDischargeKw: 5,
    chargeEfficiency: 0.95, dischargeEfficiency: 0.95 };
  input.socStepKwh = 0.1;
  assert.throws(() => prepareOfferReInput(input), /Zbyt kosztowna siatka SOC/);
  input.socStepKwh = recommendOfferReSocStepKwh(input.battery.capacityKwh, input.intervals.length, input.initialSocKwh);
  assert.equal(input.socStepKwh, 0.5);
  assert.doesNotThrow(() => prepareOfferReInput(input));
  input.initialSocKwh = 1.6;
  input.socStepKwh = recommendOfferReSocStepKwh(input.battery.capacityKwh, input.intervals.length, input.initialSocKwh);
  assert.ok(Math.abs(input.socStepKwh - 16 / 30) < 1e-9);
  assert.doesNotThrow(() => prepareOfferReInput(input));
  assert.throws(() => recommendOfferReSocStepKwh(16, 8760, 0.14), /budżecie obliczeń SOC/);
});

test('48 godzin PV: rzadsza siatka zachowuje fizykę i jawny limit błędu względem 0,1 kWh', async () => {
  const input = fixture('2026-06-01T22:00:00Z', 48);
  input.battery = { capacityKwh: 16, reserveKwh: 1.6, maxChargeKw: 5, maxDischargeKw: 5,
    chargeEfficiency: 0.95, dischargeEfficiency: 0.95 };
  input.intervals = input.intervals.map((interval, index) => {
    const hour = index % 24;
    return { ...interval,
      demandKwh: hour < 6 ? 0.45 : hour < 18 ? 1.3 : 1.8,
      pvKwh: hour >= 7 && hour <= 17 ? 3.3 * Math.sin(Math.PI * (hour - 7) / 10) : 0,
      energyBuyPrice: hour < 6 ? 0.3 : hour < 16 ? 0.8 : 1.15,
      distributionBuyPrice: 0.22,
      sellPrice: hour >= 10 && hour <= 16 ? 0.25 : 0.18,
    };
  });
  const fine = await runOfferReDiagnostic({ ...input, socStepKwh: 0.1 });
  const coarse = await runOfferReDiagnostic({ ...input, socStepKwh: recommendOfferReSocStepKwh(16, 8760, 0) });
  assert.equal(fine.verifiedPhysicalBalance, true, JSON.stringify(fine.issues));
  assert.equal(coarse.verifiedPhysicalBalance, true, JSON.stringify(coarse.issues));
  const cash = (result: typeof fine) => result.result.days.reduce((total, day) => total + day.totals.cashCostPln, 0);
  const relativeCashDifference = Math.abs(cash(coarse) - cash(fine)) / cash(fine);
  assert.ok(relativeCashDifference < 0.16, `Błąd kosztu 48h: ${(relativeCashDifference * 100).toFixed(1)}%`);
  assert.ok(Math.abs(coarse.result.finalState.socKwh - fine.result.finalState.socKwh) <= 0.5 + 1e-6);
  assert.ok(coarse.result.days.flatMap(day => day.slots).every(slot => slot.bankEnd >= 0 && slot.bankEnd <= 16));
});

test('ładowanie z sieci uwzględnia straty i zachowuje bilans w diagnostycznej poprawce RE', async () => {
  const input = fixture();
  input.battery = { ...input.battery, capacityKwh: 4, maxChargeKw: 2, maxDischargeKw: 2, chargeEfficiency: 0.9 };
  const result = await runOfferReDiagnostic(input);
  assert.equal(result.purpose, 'DIAGNOSTIC_ONLY');
  assert.equal(result.verifiedPhysicalBalance, true);
  const slots = result.result.days.flatMap((day) => day.slots);
  const gridCharge = slots.reduce((sum, slot) => sum + slot.gridBuyBank, 0);
  assert.ok(gridCharge > 0);
  const totalImport = slots.reduce((sum, slot) => sum + slot.gridBuyBank + slot.gridBuyLoad, 0);
  assert.ok(Math.abs(totalImport - 24 - result.result.finalState.socKwh - gridCharge * 0.1) < 1e-5);
  assert.ok(slots.every((slot) => slot.gridBuyBank <= 2 + 1e-6));
});

test('nie zaokrągla początkowego SOC bez przepływu energii', () => {
  const input = fixture();
  input.battery.capacityKwh = 4;
  input.initialSocKwh = 0.14;
  assert.throws(() => prepareOfferReInput(input), /siatki stanów/);
  input.socStepKwh = 0.07;
  assert.doesNotThrow(() => prepareOfferReInput(input));
});

test('porównuje koszt ładowania PV i sieci w tych samych jednostkach energii zapisanej', async () => {
  const input = fixture('2026-01-01T23:00:00Z', 2);
  input.battery = { ...input.battery, capacityKwh: 1, maxChargeKw: 2, maxDischargeKw: 2, chargeEfficiency: 0.9 };
  input.intervals[0] = { ...input.intervals[0], demandKwh: 0, pvKwh: 1,
    energyBuyPrice: 0.2, distributionBuyPrice: 0, sellPrice: 0.19 };
  input.intervals[1] = { ...input.intervals[1], energyBuyPrice: 1, distributionBuyPrice: 0 };
  const result = await runOfferReDiagnostic(input);
  assert.equal(result.verifiedPhysicalBalance, true);
  const first = result.result.days[0].slots[0];
  assert.ok(Math.abs(first.pvToBank - 0.9) < 1e-6);
  assert.ok(Math.abs(first.gridBuyBank - 1 / 9) < 1e-6);
  assert.ok(first.sellImmediate < 1e-6);
});

for (const minutes of [15, 60]) {
  for (const efficiency of [0.85, 0.9, 0.99]) {
    test(`bilans i limity AC przy ${minutes} minutach, sprawności ${efficiency} i PV`, async () => {
      const input = fixture();
      input.battery = { ...input.battery, capacityKwh: 4, maxChargeKw: 2, maxDischargeKw: 1.5,
        chargeEfficiency: efficiency, dischargeEfficiency: efficiency };
      input.intervals = Array.from({ length: 24 * 60 / minutes }, (_, index) => ({
        startUtc: new Date(Date.parse('2026-01-01T23:00:00Z') + index * minutes * 60000).toISOString(),
        endUtc: new Date(Date.parse('2026-01-01T23:00:00Z') + (index + 1) * minutes * 60000).toISOString(),
        demandKwh: minutes / 60, pvKwh: index * minutes >= 600 && index * minutes < 840 ? 3 * minutes / 60 : 0,
        energyBuyPrice: index * minutes < 360 ? 0.2 : 1, distributionBuyPrice: 0.1, sellPrice: 0.05,
      }));
      const result = await runOfferReDiagnostic(input);
      assert.equal(result.verifiedPhysicalBalance, true, JSON.stringify(result.issues));
      for (const slot of result.result.days.flatMap((day) => day.slots)) {
        assert.ok(slot.gridBuyBank + slot.pvToBank / efficiency <= 2 * minutes / 60 + 1e-5);
        assert.ok(slot.bankToLoad + slot.bankToSell <= 1.5 * minutes / 60 + 1e-5);
      }
    });
  }
}

test('dobę jesiennej zmiany czasu zachowuje jako 25 różnych godzin', async () => {
  const input = fixture('2026-10-24T22:00:00Z', 25);
  const prepared = prepareOfferReInput(input);
  assert.equal(prepared.days.length, 1);
  const twice = prepared.days[0].slots.filter((slot) => slot.hour === 2);
  assert.equal(twice.length, 2);
  assert.notEqual(twice[0].timezoneOffsetMinutes, twice[1].timezoneOffsetMinutes);
  const result = await runOfferReDiagnostic(input);
  assert.equal(result.verifiedPhysicalBalance, true);
  assert.equal(result.result.days[0].slots.length, 25);
  assert.equal(result.result.days[0].totals.usageKwh, 25);
});

test('dobę wiosennej zmiany czasu zachowuje jako 23 godziny', () => {
  const prepared = prepareOfferReInput(fixture('2026-03-28T23:00:00Z', 23));
  assert.equal(prepared.days.length, 1);
  assert.equal(prepared.days[0].slots.filter((slot) => slot.hour === 2).length, 0);
});

test('brak ceny, luka i brak jawnego UTC zatrzymują symulację', () => {
  const input = fixture();
  input.intervals[2].energyBuyPrice = NaN;
  assert.throws(() => prepareOfferReInput(input));
  const gap = fixture();
  gap.intervals.splice(3, 1);
  assert.throws(() => prepareOfferReInput(gap), /Luka/);
  const local = fixture();
  local.intervals[0].startUtc = '2026-01-02T00:00:00';
  assert.throws(() => prepareOfferReInput(local), /UTC/);
});

test('net-metering nie jest cicho liczony jako net-billing', () => {
  assert.throws(() => prepareOfferReInput({ ...fixture(), settlement: 'NET_METERING' } as unknown as OfferReInput), /net-meteringu/);
});
