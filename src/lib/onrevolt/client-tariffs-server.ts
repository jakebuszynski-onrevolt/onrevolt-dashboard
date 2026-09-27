import { execFile } from 'node:child_process';
import path from 'node:path';
import { prisma } from './prisma';
import { rePrisma, resolveReStation } from './re-stations';
import type { ClientTariffHistory, ClientTariffData, GeneralTariffSelection } from './client-tariffs';
import { projectGeneralTariff } from './client-tariffs';

export class ClientTariffError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type ClientTariffScope = { projectId: string; clientId: string; ppe: string | null; station: string | null; dataFrom?: string | null; generalTariff?: ClientTariffData['generalTariff'] };

export async function readProjectGeneralTariffs(scope: ClientTariffScope) {
  if (!scope.station) return { generalTariff: scope.generalTariff ?? null, targetTariff: null, generalTariffSource: 'CRM' as const };
  const db = rePrisma();
  const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    'SELECT tariff_current_osd_id, tariff_current_tariff_id, tariff_target_osd_id, tariff_target_tariff_id FROM EnergyMeter_users WHERE station = ? LIMIT 1', scope.station);
  if (!rows[0]) throw new ClientTariffError('Nie znaleziono ustawień taryf przypisanej stacji RE.', 409);
  async function selection(kind: 'current' | 'target'): Promise<GeneralTariffSelection | null> {
    const osd = rows[0][`tariff_${kind}_osd_id`];
    const tariff = rows[0][`tariff_${kind}_tariff_id`];
    if (osd == null && tariff == null) return null;
    if (!Number.isSafeInteger(Number(osd)) || Number(osd) <= 0 || !Number.isSafeInteger(Number(tariff)) || Number(tariff) <= 0) {
      throw new ClientTariffError('Niekompletny wybór taryfy w ustawieniach dashboardu RE.', 409);
    }
    const values = await db.$queryRawUnsafe<Array<{ operator: string; code: string }>>(
      'SELECT o.name AS operator, t.code FROM tariff t JOIN osd o ON o.id = t.osd_id WHERE t.id = ? AND t.osd_id = ?', Number(tariff), Number(osd));
    if (!values[0]) throw new ClientTariffError('Taryfa zapisana w dashboardzie RE nie istnieje w katalogu operatora.', 409);
    return { operator: values[0].operator, code: values[0].code, osdId: Number(osd), tariffId: Number(tariff) };
  }
  return { generalTariff: await selection('current'), targetTariff: await selection('target'), generalTariffSource: 'RE' as const };
}

export async function clientTariffScope(clientId: string, projectId: string, assignment?: { token: string | null; number: string | null }): Promise<ClientTariffScope> {
  if (!clientId || !projectId) throw new ClientTariffError('Wybierz projekt klienta.');
  const project = await prisma.project.findFirst({ where: { id: projectId, clientId },
    select: { id: true, clientId: true, dashboardStation: true, dashboardStationNumber: true } });
  if (!project) throw new ClientTariffError('Projekt nie należy do wskazanego klienta.', 404);
  const accounts = await prisma.energyPortalAccount.findMany({ where: { projectId, clientId },
    select: { ppeNumber: true, operator: true, tariff: true }, orderBy: { updatedAt: 'desc' } });
  const ppes = Array.from(new Set(accounts.map(a => a.ppeNumber?.trim()).filter(Boolean)));
  if (ppes.length > 1) throw new ClientTariffError('Projekt ma kilka PPE. Rozdziel punkty na osobne projekty przed ustawieniem historii taryf.', 409);
  const token = assignment ? assignment.token : project.dashboardStation;
  const stationRef = assignment ? assignment.number || token : project.dashboardStationNumber || token;
  const station = stationRef ? await resolveReStation(stationRef) : null;
  if (stationRef && !station) throw new ClientTariffError('Przypisana stacja RE nie istnieje. Popraw powiązanie w EMS.', 409);
  if (station && token && token !== station.stationHash) throw new ClientTariffError('Niespójne powiązanie stacji w EMS.', 409);
  const firstMeasurement = await prisma.energyMeasurementFile.findFirst({ where: { projectId, clientId, status: 'DOWNLOADED' },
    orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }], select: { periodYear: true, periodMonth: true } });
  return { projectId, clientId, ppe: ppes[0] || null, station: station?.station || null,
    generalTariff: projectGeneralTariff(accounts),
    dataFrom: firstMeasurement ? `${firstMeasurement.periodYear}-${String(firstMeasurement.periodMonth).padStart(2, '0')}-01` : null };
}

/** Validate conflicts before the CRM save; after commit, bind the existing RE profile only. */
export async function prepareClientTariffBinding(clientId: string, projectId: string, assignment: { token: string | null; number: string | null }, actorId: string) {
  const scope = await clientTariffScope(clientId, projectId, assignment);
  const data = await callClientTariffs<ClientTariffData>({ action: 'get', scope });
  if (!data.profile || data.profile.station === scope.station) return async () => undefined;
  const revision = data.profile.revision;
  await callClientTariffs({ action: 'preview', scope, revision, actorId });
  return async () => { await callClientTariffs({ action: 'bind', scope, revision, actorId }); };
}

export async function callClientTariffs<T>(input: { action: string; scope: ClientTariffScope } & Record<string, unknown>): Promise<T> {
  const root = process.env.ONREVOLT_RE_ROOT?.trim() || (process.platform === 'win32'
    ? 'D:\\Strona OVH 2023\\var\\www\\vhosts\\onrevolt.com\\my.onrevolt.com'
    : '/var/www/vhosts/onrevolt.com/my.onrevolt.com');
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(process.env.ONREVOLT_PHP_BIN?.trim() || 'php', [path.resolve('scripts/client-tariffs.php'), root],
      { encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 24 * 1024 * 1024 },
      (error, stdout) => error ? reject(new ClientTariffError('Nie udało się połączyć z modułem taryf RE.', 502)) : resolve(stdout));
    child.stdin?.on('error', () => { /* execFile reports the process failure. */ });
    child.stdin?.end(JSON.stringify(input));
  });
  let payload: any;
  try { payload = JSON.parse(output); } catch { throw new ClientTariffError('Moduł taryf RE nie zwrócił poprawnych danych.', 502); }
  if (!payload.ok) throw new ClientTariffError(String(payload.error || 'Błąd taryf RE.'), Number(payload.status) || 400);
  return payload.data as T;
}

export async function loadClientTariffHistory(clientId: string, projectId: string, from: string, until: string) {
  const scope = await clientTariffScope(clientId, projectId);
  return callClientTariffs<ClientTariffHistory | null>({ action: 'history', scope, from, until });
}
