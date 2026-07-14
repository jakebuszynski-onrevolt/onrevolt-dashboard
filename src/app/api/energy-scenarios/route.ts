import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { jsonResponse, readJsonObject, requireString, serverError } from 'lib/onrevolt/api';
import { writeAuditLog } from 'lib/onrevolt/audit';
import { calculateEnergyScenario, energyScenarioEngineVersion, EnergyScenarioInput } from 'lib/onrevolt/energy-scenario';
import { prisma } from 'lib/onrevolt/prisma';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

function numeric(value: unknown, name: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Nieprawidłowa wartość ${name}`);
  return number;
}

function numberArray(value: unknown, length: number, name: string) {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`${name} musi mieć ${length} pozycji`);
  return value.map((item, index) => numeric(item, `${name}[${index}]`));
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  try {
    const body = await readJsonObject(req);
    const auditId = requireString(body, 'auditId');
    const audit = await prisma.energyAudit.findUnique({ where: { id: auditId }, include: { project: true } });
    if (!audit) throw new Error('Nie znaleziono audytu');
    const input = body.input as Record<string, unknown>;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Brak danych wejściowych scenariusza');
    const scenarioInput: EnergyScenarioInput = {
      monthlyConsumptionKwh: numberArray(input.monthlyConsumptionKwh, 12, 'monthlyConsumptionKwh'),
      hourlyLoadProfile: numberArray(input.hourlyLoadProfile, 24, 'hourlyLoadProfile'),
      pvPowerKw: numeric(input.pvPowerKw, 'pvPowerKw'),
      pvSpecificYieldKwhPerKw: numeric(input.pvSpecificYieldKwhPerKw, 'pvSpecificYieldKwhPerKw'),
      pvMonthlyDistribution: numberArray(input.pvMonthlyDistribution, 12, 'pvMonthlyDistribution'),
      pvHourlyProfiles: Array.isArray(input.pvHourlyProfiles)
        ? input.pvHourlyProfiles.map((profile, month) => numberArray(profile, 24, `pvHourlyProfiles[${month}]`))
        : [],
      batteryCapacityKwh: numeric(input.batteryCapacityKwh, 'batteryCapacityKwh'),
      batteryMaxChargeKw: numeric(input.batteryMaxChargeKw, 'batteryMaxChargeKw'),
      batteryMaxDischargeKw: numeric(input.batteryMaxDischargeKw, 'batteryMaxDischargeKw'),
      batteryRoundTripEfficiency: numeric(input.batteryRoundTripEfficiency, 'batteryRoundTripEfficiency'),
      initialBatterySocPercent: numeric(input.initialBatterySocPercent, 'initialBatterySocPercent'),
      energyBuyGrossPerKwh: numeric(input.energyBuyGrossPerKwh, 'energyBuyGrossPerKwh'),
      distributionGrossPerKwh: numeric(input.distributionGrossPerKwh, 'distributionGrossPerKwh'),
      exportGrossPerKwh: numeric(input.exportGrossPerKwh, 'exportGrossPerKwh'),
      fixedMonthlyGross: numeric(input.fixedMonthlyGross, 'fixedMonthlyGross'),
      depositPayoutRate: numeric(input.depositPayoutRate, 'depositPayoutRate'),
      investmentGross: input.investmentGross == null ? undefined : numeric(input.investmentGross, 'investmentGross'),
    };
    const result = calculateEnergyScenario(scenarioInput);
    const recommended = body.recommended === true;
    const scenario = await prisma.$transaction(async (tx) => {
      if (recommended) await tx.energyScenario.updateMany({ where: { auditId }, data: { recommended: false } });
      const saved = await tx.energyScenario.create({
        data: {
          auditId,
          name: requireString(body, 'name'),
          engineVersion: energyScenarioEngineVersion,
          inputSnapshot: scenarioInput as unknown as Prisma.InputJsonValue,
          resultSnapshot: result as unknown as Prisma.InputJsonValue,
          pvPowerKw: scenarioInput.pvPowerKw,
          batteryCapacityKwh: scenarioInput.batteryCapacityKwh,
          investmentGross: scenarioInput.investmentGross,
          recommended,
          createdById: access.user.id,
        },
      });
      await tx.energyAudit.update({ where: { id: auditId }, data: { status: 'READY', annualConsumptionKwh: result.annualConsumptionKwh } });
      return saved;
    });
    await writeAuditLog({
      actorId: access.user.id,
      clientId: audit.project.clientId,
      entityType: 'EnergyScenario',
      entityId: scenario.id,
      action: 'CALCULATE',
      after: { ...scenario, result },
    });
    return jsonResponse({ ok: true, data: { ...scenario, resultSnapshot: result } }, { status: 201 });
  } catch (error) {
    return serverError('Nie udało się obliczyć scenariusza', error);
  }
}
