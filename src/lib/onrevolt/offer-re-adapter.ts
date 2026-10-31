import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const OFFER_RE_ENGINE_SHA256 = '1c09e3f720567e89265eda570568866c6339adf9ad46cf53a3f83f4486b2fa6b';
export const OFFER_RE_MAX_WORK_UNITS = 10_000_000;

export type OfferReInterval = {
  startUtc: string;
  endUtc: string;
  demandKwh: number;
  pvKwh: number;
  energyBuyPrice: number;
  distributionBuyPrice: number;
  sellPrice: number;
};

export type OfferReInput = {
  settlement: 'NET_BILLING';
  intervals: OfferReInterval[];
  battery: {
    capacityKwh: number;
    reserveKwh: number;
    maxChargeKw: number; // AC input power
    maxDischargeKw: number; // AC output power
    chargeEfficiency: number;
    dischargeEfficiency: number;
  };
  initialSocKwh: number;
  initialDepositPln: number;
  socStepKwh: number;
};

type RuntimeSlot = {
  slotStart: string; slotEnd: string; load: number; pv: number;
  bankStart: number; bankEnd: number; gridBuyLoad: number; gridBuyBank: number;
  pvToLoad: number; pvToBank: number; bankToLoad: number; bankToSell: number;
  sellImmediate: number;
};
type RuntimeResult = {
  days: Array<{ dateKey: string; slots: RuntimeSlot[]; totals: Record<string, number>; stateOut: { socKwh: number; depositPln: number } }>;
  finalState: { socKwh: number; depositPln: number };
};
type OfferReValidationIssue = { code: string; interval?: string; differenceKwh?: number };
type PreparedOfferReInput = ReturnType<typeof prepareOfferReInput>;

const physicalValidationToleranceKwh = 0.00001;

const warsaw = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function number(value: unknown, min: number, max: number, name: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Nieprawidłowe ${name}`);
  return value;
}

export function recommendOfferReSocStepKwh(capacityKwh: number, intervalCount: number, initialSocKwh: number): number {
  number(capacityKwh, 0, 1000, 'pojemność magazynu');
  number(initialSocKwh, 0, capacityKwh, 'początkowy SOC');
  if (!Number.isSafeInteger(intervalCount) || intervalCount < 1 || intervalCount > 35136) {
    throw new Error('Nieprawidłowa liczba interwałów RE');
  }
  if (capacityKwh === 0) return 0.25;
  const maxStates = Math.floor(Math.sqrt(OFFER_RE_MAX_WORK_UNITS / intervalCount));
  if (maxStates < 2) throw new Error('Seria RE przekracza budżet obliczeń SOC');
  for (let intervals = maxStates - 1; intervals >= 1; intervals--) {
    const step = Math.max(0.05, capacityKwh / intervals);
    if (step > 10) break;
    const nearestSoc = Math.round(initialSocKwh / step) * step;
    if ((Math.abs(nearestSoc - initialSocKwh) <= 0.000001 || Math.abs(capacityKwh - initialSocKwh) <= 0.000001)
      && intervalCount * (Math.ceil(capacityKwh / step) + 1) ** 2 <= OFFER_RE_MAX_WORK_UNITS) return step;
  }
  throw new Error('Początkowy SOC lub pojemność magazynu nie mieści się w budżecie obliczeń SOC');
}

export function prepareOfferReInput(input: OfferReInput) {
  if (input.settlement !== 'NET_BILLING') throw new Error('Ten adapter RE nie obsługuje jeszcze net-meteringu');
  if (!Array.isArray(input.intervals) || input.intervals.length < 1 || input.intervals.length > 35136) throw new Error('Nieprawidłowa liczba interwałów RE');
  const b = input.battery;
  number(b.capacityKwh, 0, 1000, 'pojemność magazynu');
  number(b.reserveKwh, 0, b.capacityKwh, 'rezerwa magazynu');
  number(b.maxChargeKw, 0, 1000, 'moc ładowania');
  number(b.maxDischargeKw, 0, 1000, 'moc rozładowania');
  number(b.chargeEfficiency, 0.01, 1, 'sprawność ładowania');
  number(b.dischargeEfficiency, 0.01, 1, 'sprawność rozładowania');
  number(input.initialSocKwh, 0, b.capacityKwh, 'początkowy SOC');
  number(input.initialDepositPln, 0, 10000000, 'depozyt początkowy');
  number(input.socStepKwh, 0.05, 10, 'krok SOC');
  if (b.capacityKwh / input.socStepKwh > 400) throw new Error('Zbyt duża liczba stanów symulacji RE');
  const stateCountBound = Math.ceil(b.capacityKwh / input.socStepKwh) + 1;
  if (input.intervals.length * stateCountBound ** 2 > OFFER_RE_MAX_WORK_UNITS) {
    throw new Error('Zbyt kosztowna siatka SOC dla tej serii RE; użyj recommendOfferReSocStepKwh');
  }
  if (b.capacityKwh === 0 && (b.maxChargeKw !== 0 || b.maxDischargeKw !== 0)) throw new Error('Brak magazynu wymaga zerowej mocy ładowania i rozładowania');
  const nearestSoc = Math.round(input.initialSocKwh / input.socStepKwh) * input.socStepKwh;
  if (Math.abs(nearestSoc - input.initialSocKwh) > 0.000001 && Math.abs(b.capacityKwh - input.initialSocKwh) > 0.000001) {
    throw new Error('Początkowy SOC nie należy do siatki stanów RE; wybierz dokładniejszy krok zamiast zaokrąglać energię');
  }

  const days: Array<{ dateKey: string; slots: Record<string, unknown>[] }> = [];
  let previousEnd: number | null = null;
  let duration: number | null = null;
  for (const interval of input.intervals) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/.test(interval.startUtc)
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/.test(interval.endUtc)) throw new Error('Interwały RE wymagają jawnych znaczników UTC');
    const start = Date.parse(interval.startUtc);
    const end = Date.parse(interval.endUtc);
    const minutes = (end - start) / 60000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || ![15, 60].includes(minutes)
      || (previousEnd !== null && start !== previousEnd)) throw new Error('Luka, duplikat lub nieprawidłowy interwał RE');
    if (duration !== null && duration !== minutes) throw new Error('Jedna symulacja wymaga tej samej długości interwałów');
    duration = minutes;
    previousEnd = end;
    const local = warsaw.format(new Date(start));
    const dateKey = local.slice(0, 10);
    const hour = Number(local.slice(11, 13));
    const minute = Number(local.slice(14, 16));
    if (minute % minutes !== 0) throw new Error('Początek interwału nie pasuje do rozdzielczości');
    if (days.at(-1)?.dateKey !== dateKey) days.push({ dateKey, slots: [] });
    const day = days.at(-1)!;
    const energy = number(interval.energyBuyPrice, 0, 100, 'cena energii');
    const distribution = number(interval.distributionBuyPrice, 0, 100, 'cena dystrybucji');
    day.slots.push({
      index: day.slots.length, dateKey, hour, quarter: minute / 15,
      slotStart: interval.startUtc, slotEnd: interval.endUtc,
      timezoneOffsetMinutes: (Date.parse(local.replace(' ', 'T') + 'Z') - start) / 60000,
      actual: true,
      load: number(interval.demandKwh, 0, 10000, 'zużycie'),
      pv: number(interval.pvKwh, 0, 10000, 'produkcja PV'),
      price: { buyPrice: energy + distribution, energyBuyPrice: energy, distributionBuyPrice: distribution,
        sellPrice: number(interval.sellPrice, 0, 100, 'cena eksportu'), windowCode: 'all' },
    });
  }
  return {
    days, initialSocKwh: input.initialSocKwh, initialDepositPln: input.initialDepositPln,
    socStepKwh: input.socStepKwh,
    battery: { capacityKwh: b.capacityKwh, reserveKwh: b.reserveKwh,
      // RE transition limits are on the stored-energy side; input limits are AC.
      maxChargePerSlotKwh: b.maxChargeKw * duration! / 60 * b.chargeEfficiency,
      maxDischargePerSlotKwh: b.maxDischargeKw * duration! / 60 / b.dischargeEfficiency,
      chargeEfficiency: b.chargeEfficiency, dischargeEfficiency: b.dischargeEfficiency },
  };
}

function preparedPrice(slot: Record<string, unknown>, name: 'buyPrice' | 'sellPrice'): number | null {
  const price = slot.price;
  if (!price || typeof price !== 'object') return null;
  const value = (price as Record<string, unknown>)[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function opportunityExportFlags(slots: Record<string, unknown>[]): boolean[] {
  const futureBuyPrices: Array<number | null> = Array(slots.length).fill(null);
  let futureMinBuyPrice: number | null = null;
  for (let index = slots.length - 1; index >= 0; index--) {
    futureBuyPrices[index] = futureMinBuyPrice;
    const buyPrice = preparedPrice(slots[index], 'buyPrice');
    if (buyPrice !== null) futureMinBuyPrice = futureMinBuyPrice === null ? buyPrice : Math.min(futureMinBuyPrice, buyPrice);
  }

  const salesByDateHour = new Map<string, Map<number, { total: number; count: number }>>();
  for (const slot of slots) {
    const dateKey = slot.dateKey;
    const hour = slot.hour;
    const sellPrice = preparedPrice(slot, 'sellPrice');
    if (typeof dateKey !== 'string' || typeof hour !== 'number' || hour < 15 || hour > 23 || sellPrice === null) continue;
    let salesByHour = salesByDateHour.get(dateKey);
    if (!salesByHour) {
      salesByHour = new Map();
      salesByDateHour.set(dateKey, salesByHour);
    }
    const current = salesByHour.get(hour) ?? { total: 0, count: 0 };
    current.total += sellPrice;
    current.count++;
    salesByHour.set(hour, current);
  }

  const topHoursByDate = new Map<string, Set<number>>();
  for (const [dateKey, salesByHour] of salesByDateHour) {
    const topHours = [...salesByHour.entries()]
      .sort(([leftHour, left], [rightHour, right]) => right.total / right.count - left.total / left.count || leftHour - rightHour)
      .slice(0, 4)
      .map(([hour]) => hour);
    topHoursByDate.set(dateKey, new Set(topHours));
  }

  return slots.map((slot, index) => {
    const dateKey = slot.dateKey;
    const hour = slot.hour;
    const sellPrice = preparedPrice(slot, 'sellPrice');
    const futureBuyPrice = futureBuyPrices[index];
    return typeof dateKey === 'string' && typeof hour === 'number' && sellPrice !== null && futureBuyPrice !== null
      && Boolean(topHoursByDate.get(dateKey)?.has(hour)) && sellPrice - futureBuyPrice >= 0.35;
  });
}

function opportunityExportByInterval(prepared: PreparedOfferReInput): boolean[] {
  const flags: boolean[] = [];
  for (let dayIndex = 0; dayIndex < prepared.days.length; dayIndex++) {
    const planningSlots = prepared.days.slice(dayIndex, dayIndex + 2).flatMap((day) => day.slots);
    flags.push(...opportunityExportFlags(planningSlots).slice(0, prepared.days[dayIndex].slots.length));
  }
  return flags;
}

function addDifferenceIssue(issues: OfferReValidationIssue[], code: string, interval: string, difference: number) {
  issues.push({ code, interval, ...(Number.isFinite(difference) ? { differenceKwh: difference } : {}) });
}

export function validateOfferReResult(
  input: OfferReInput,
  prepared: PreparedOfferReInput,
  result: RuntimeResult,
): OfferReValidationIssue[] {
  const issues: OfferReValidationIssue[] = [];
  const outputDays = Array.isArray(result?.days) ? result.days : [];
  if (!Array.isArray(result?.days)) issues.push({ code: 'INVALID_RESULT_DAYS' });
  if (outputDays.length !== prepared.days.length) issues.push({ code: 'DAY_COUNT_MISMATCH' });
  const slots = outputDays.flatMap((day) => Array.isArray(day?.slots) ? day.slots : []);
  if (slots.length !== input.intervals.length) issues.push({ code: 'INTERVAL_COUNT_MISMATCH' });

  const exportOpportunity = opportunityExportByInterval(prepared);
  const flowFields: Array<keyof Pick<RuntimeSlot,
    'gridBuyLoad' | 'gridBuyBank' | 'pvToLoad' | 'pvToBank' | 'bankToLoad' | 'bankToSell' | 'sellImmediate'>> = [
      'gridBuyLoad', 'gridBuyBank', 'pvToLoad', 'pvToBank', 'bankToLoad', 'bankToSell', 'sellImmediate',
    ];
  let previousSoc = input.initialSocKwh;
  for (const [index, slot] of slots.entries()) {
    const source = input.intervals[index];
    if (!source) continue;
    if (!slot || typeof slot !== 'object') {
      issues.push({ code: 'INVALID_RUNTIME_SLOT', interval: source.startUtc });
      continue;
    }
    if (slot.slotStart !== source.startUtc || slot.slotEnd !== source.endUtc) {
      issues.push({ code: 'INTERVAL_TIMESTAMP_MISMATCH', interval: source.startUtc });
    }

    for (const field of flowFields) {
      const value = slot[field];
      if (!Number.isFinite(value) || value < 0) issues.push({ code: 'INVALID_FLOW_QUANTITY', interval: source.startUtc });
    }

    if (!Number.isFinite(slot.bankStart) || !Number.isFinite(slot.bankEnd)) {
      issues.push({ code: 'INVALID_SOC', interval: source.startUtc });
    } else {
      if (slot.bankStart < -physicalValidationToleranceKwh || slot.bankStart > input.battery.capacityKwh + physicalValidationToleranceKwh
        || slot.bankEnd < -physicalValidationToleranceKwh || slot.bankEnd > input.battery.capacityKwh + physicalValidationToleranceKwh) {
        issues.push({ code: 'SOC_OUT_OF_BOUNDS', interval: source.startUtc });
      }
      const continuityDifference = slot.bankStart - previousSoc;
      if (Math.abs(continuityDifference) > physicalValidationToleranceKwh) {
        addDifferenceIssue(issues, 'SOC_CONTINUITY_MISMATCH', source.startUtc, continuityDifference);
      }
      const opportunityReserve = exportOpportunity[index]
        ? Math.min(input.battery.reserveKwh, input.battery.capacityKwh * 0.1)
        : input.battery.reserveKwh;
      const minimumSoc = Math.min(opportunityReserve, slot.bankStart);
      if (slot.bankEnd < minimumSoc - physicalValidationToleranceKwh) {
        addDifferenceIssue(issues, 'RESERVE_VIOLATION', source.startUtc, slot.bankEnd - minimumSoc);
      }
      previousSoc = slot.bankEnd;
    }

    const durationHours = (Date.parse(source.endUtc) - Date.parse(source.startUtc)) / 3600000;
    const chargeAc = slot.gridBuyBank + slot.pvToBank / input.battery.chargeEfficiency;
    const dischargeAc = slot.bankToLoad + slot.bankToSell;
    const flowsFinite = flowFields.every((field) => Number.isFinite(slot[field]));
    if (flowsFinite) {
      const chargeLimit = input.battery.maxChargeKw * durationHours;
      if (chargeAc > chargeLimit + physicalValidationToleranceKwh) {
        addDifferenceIssue(issues, 'CHARGE_AC_LIMIT_EXCEEDED', source.startUtc, chargeAc - chargeLimit);
      }
      const dischargeLimit = input.battery.maxDischargeKw * durationHours;
      if (dischargeAc > dischargeLimit + physicalValidationToleranceKwh) {
        addDifferenceIssue(issues, 'DISCHARGE_AC_LIMIT_EXCEEDED', source.startUtc, dischargeAc - dischargeLimit);
      }

      const loadDifference = slot.pvToLoad + slot.gridBuyLoad + slot.bankToLoad - source.demandKwh;
      if (Math.abs(loadDifference) > physicalValidationToleranceKwh) {
        addDifferenceIssue(issues, 'LOAD_BALANCE_MISMATCH', source.startUtc, loadDifference);
      }
      const pvDifference = slot.pvToLoad + slot.pvToBank / input.battery.chargeEfficiency + slot.sellImmediate - source.pvKwh;
      if (Math.abs(pvDifference) > physicalValidationToleranceKwh) {
        addDifferenceIssue(issues, 'PV_ALLOCATION_MISMATCH', source.startUtc, pvDifference);
      }

      const expectedSoc = slot.bankStart + chargeAc * input.battery.chargeEfficiency - dischargeAc / input.battery.dischargeEfficiency;
      const storageDifference = slot.bankEnd - expectedSoc;
      if (Math.abs(storageDifference) > physicalValidationToleranceKwh) {
        addDifferenceIssue(issues, 'STORAGE_BALANCE_MISMATCH', source.startUtc, storageDifference);
      }
      const grid = slot.gridBuyLoad + slot.gridBuyBank;
      const exported = slot.sellImmediate + slot.bankToSell;
      const flowDifference = grid + source.pvKwh + dischargeAc - source.demandKwh - chargeAc - exported;
      if (Math.abs(flowDifference) > physicalValidationToleranceKwh) {
        addDifferenceIssue(issues, 'ENERGY_BALANCE_MISMATCH', source.startUtc, flowDifference);
      }
    }
  }

  for (const day of outputDays) {
    const daySlots = Array.isArray(day?.slots) ? day.slots : [];
    const stateOut = day?.stateOut;
    const lastSlot = daySlots.at(-1);
    if (!stateOut || !Number.isFinite(stateOut.socKwh) || !Number.isFinite(stateOut.depositPln) || stateOut.depositPln < 0) {
      issues.push({ code: 'INVALID_DAY_STATE' });
    } else {
      if (stateOut.socKwh < -physicalValidationToleranceKwh
        || stateOut.socKwh > input.battery.capacityKwh + physicalValidationToleranceKwh) {
        issues.push({ code: 'SOC_OUT_OF_BOUNDS' });
      }
      if (lastSlot && Number.isFinite(lastSlot.bankEnd)
        && Math.abs(stateOut.socKwh - lastSlot.bankEnd) > physicalValidationToleranceKwh) {
        addDifferenceIssue(issues, 'DAY_STATE_MISMATCH', lastSlot.slotStart, stateOut.socKwh - lastSlot.bankEnd);
      }
    }
  }

  const lastDay = outputDays.at(-1);
  const finalState = result?.finalState;
  if (!finalState || !Number.isFinite(finalState.socKwh) || !Number.isFinite(finalState.depositPln) || finalState.depositPln < 0) {
    issues.push({ code: 'INVALID_FINAL_STATE' });
  } else {
    if (finalState.socKwh < -physicalValidationToleranceKwh
      || finalState.socKwh > input.battery.capacityKwh + physicalValidationToleranceKwh) {
      issues.push({ code: 'SOC_OUT_OF_BOUNDS' });
    }
    if (lastDay?.stateOut && Number.isFinite(lastDay.stateOut.socKwh) && Number.isFinite(lastDay.stateOut.depositPln)
      && (Math.abs(finalState.socKwh - lastDay.stateOut.socKwh) > physicalValidationToleranceKwh
        || Math.abs(finalState.depositPln - lastDay.stateOut.depositPln) > 0.00001)) {
      issues.push({ code: 'FINAL_STATE_MISMATCH' });
    }
  }
  return issues;
}

export async function runOfferReDiagnostic(input: OfferReInput) {
  const prepared = prepareOfferReInput(input);
  const raw = await new Promise<string>((resolve, reject) => {
    const worker = spawn(process.execPath, [path.join(process.cwd(), 'scripts', 'run-offer-re.cjs')], {
      windowsHide: true, shell: false, env: { NODE_ENV: 'production', TZ: 'Europe/Warsaw', SYSTEMROOT: process.env.SYSTEMROOT },
      stdio: ['pipe', 'pipe', 'pipe'] as const,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { worker.kill(); reject(new Error('Przekroczono czas symulacji RE')); }, 130000);
    worker.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf8');
      if (Buffer.byteLength(stdout) > 64 * 1024 * 1024) { worker.kill(); reject(new Error('Zbyt duży wynik RE')); }
    });
    worker.stderr.on('data', (data: Buffer) => { stderr = (stderr + data.toString('utf8')).slice(0, 4000); });
    worker.on('error', (error) => { clearTimeout(timer); reject(error); });
    worker.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Nie udało się uruchomić izolowanego RE: ${stderr}`));
      else resolve(stdout);
    });
    worker.stdin.on('error', (error) => { clearTimeout(timer); reject(error); });
    worker.stdin.end(JSON.stringify(prepared));
  });
  const result: RuntimeResult = JSON.parse(raw);
  const issues = validateOfferReResult(input, prepared, result);
  return {
    engineSha256: OFFER_RE_ENGINE_SHA256,
    inputSha256: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    purpose: 'DIAGNOSTIC_ONLY' as const,
    settlement: 'NET_BILLING' as const,
    includesFixedCharges: false,
    foresight: 'TWO_DAY_KNOWN_INPUT' as const,
    verifiedPhysicalBalance: issues.length === 0,
    issues, result,
  };
}
