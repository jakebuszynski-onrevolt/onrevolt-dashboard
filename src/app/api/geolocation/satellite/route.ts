import { NextRequest, NextResponse } from 'next/server';
import { GoogleMapsConfigurationError } from 'lib/onrevolt/google-maps';
import { fetchLocationMapImage } from 'lib/onrevolt/location-map-images';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) return access.response;
  try {
    const latitude = Number(req.nextUrl.searchParams.get('lat'));
    const longitude = Number(req.nextUrl.searchParams.get('lng'));
    const provider = req.nextUrl.searchParams.get('provider');
    const image = await fetchLocationMapImage(provider, latitude, longitude);
    return new NextResponse(Uint8Array.from(image.bytes), {
      headers: {
        'Content-Type': image.contentType,
        'X-Map-Provider': image.provider,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    const status = error instanceof GoogleMapsConfigurationError ? 503 : 400;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
