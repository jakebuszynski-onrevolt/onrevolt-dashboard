import { NextRequest } from 'next/server';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';
import { badRequest, jsonResponse } from 'lib/onrevolt/api';
import { readReferenceProfileCatalog } from 'lib/onrevolt/reference-profile-catalog-server';
import { compareReferenceProfiles, summarizeReferenceProfile, getReferenceProfileCalculationEligibility } from 'lib/onrevolt/reference-profile-comparison';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  try {
    const catalog = await readReferenceProfileCatalog();
    const profiles = catalog.map(profile => {
      const calculation = getReferenceProfileCalculationEligibility(profile);
      return { ...summarizeReferenceProfile(profile), calculationEligible: calculation.eligible, calculationReason: calculation.reason };
    });
    return jsonResponse({ data: { profiles, comparisonYear: 2025 } }, { headers });
  } catch (error) {
    console.error('[reference-load-profiles]', error instanceof Error ? error.message : 'catalog error');
    return jsonResponse({ error: 'Nie udało się odczytać katalogu profili. Spróbuj ponownie.' }, { status: 500, headers });
  }
}

export async function POST(req: NextRequest) {
  const access = await authorizeStaffRequest(req, 'energy.manage');
  if (!access.ok) return access.response;
  let input: { keys: string[]; annualKwh: number; month: number | null; dayType: 'all' | 'workday' | 'weekend' };
  try {
    const body = await req.json();
    if (!body || !Array.isArray(body.keys) || body.keys.length < 1 || body.keys.length > 6
      || body.keys.some((key: unknown) => typeof key !== 'string' || key.length > 191)
      || new Set(body.keys).size !== body.keys.length) throw new Error('Wybierz od 1 do 6 różnych profili.');
    if (typeof body.annualKwh !== 'number' || !Number.isFinite(body.annualKwh) || body.annualKwh <= 0 || body.annualKwh > 1e12)
      throw new Error('Podaj poprawne dodatnie zużycie roczne.');
    if (body.month !== null && (!Number.isInteger(body.month) || body.month < 1 || body.month > 12)) throw new Error('Nieprawidłowy miesiąc.');
    if (!['all', 'workday', 'weekend'].includes(body.dayType)) throw new Error('Nieprawidłowy typ dnia.');
    input = { keys: body.keys, annualKwh: body.annualKwh, month: body.month, dayType: body.dayType };
  } catch (error) { return badRequest(error instanceof Error ? error.message : 'Nieprawidłowe parametry porównania.'); }
  try {
    const catalog = await readReferenceProfileCatalog();
    const selected = input.keys.map(key => catalog.find(profile => profile.key === key));
    if (selected.some(profile => !profile)) return badRequest('Nie znaleziono wybranego profilu. Odśwież katalog.');
    const profiles = selected as typeof catalog;
    const unavailable = profiles.map(summarizeReferenceProfile).find(profile => !profile.eligible);
    if (unavailable) return badRequest(unavailable.reason || 'Profil nie nadaje się do porównania zużycia energii elektrycznej.');
    return jsonResponse({ data: { annualKwh: input.annualKwh, profiles: compareReferenceProfiles(profiles, input) } }, { headers });
  } catch (error) {
    console.error('[reference-load-profiles]', error instanceof Error ? error.message : 'comparison error');
    return jsonResponse({ error: 'Nie udało się przygotować porównania profili.' }, { status: 500, headers });
  }
}
