import { NextRequest, NextResponse } from 'next/server';
import { GoogleMapsConfigurationError, searchGoogleAddresses } from 'lib/onrevolt/google-maps';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const query = req.nextUrl.searchParams.get('q')?.trim() || '';
    const results = await searchGoogleAddresses(query);
    return NextResponse.json({ ok: true, data: results });
  } catch (error) {
    const status = error instanceof GoogleMapsConfigurationError ? 503 : 400;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
