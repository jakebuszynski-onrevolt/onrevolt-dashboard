import { NextRequest } from 'next/server';
import { jsonResponse, serverError } from 'lib/onrevolt/api';
import { loadEnergyTariffCatalog } from 'lib/onrevolt/energy-tariff-pricing';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;

  try {
    return jsonResponse({ ok: true, data: await loadEnergyTariffCatalog() });
  } catch (error) {
    return serverError('Nie udało się pobrać listy OSD i taryf z RE', error);
  }
}
