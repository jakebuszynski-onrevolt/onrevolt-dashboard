import { NextRequest, NextResponse } from 'next/server';
import { parseSatelliteCoordinates, parseSatelliteZoom, satelliteMapErrorResponse } from 'lib/onrevolt/geolocation-satellite';
import { fetchLocationMapImage } from 'lib/onrevolt/location-map-images';
import { authorizeStaffRequest } from 'lib/onrevolt/staff-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const access = await authorizeStaffRequest(req);
  if (!access.ok) {
    access.response.headers.set('Cache-Control', 'no-store');
    return access.response;
  }
  try {
    const { latitude, longitude } = parseSatelliteCoordinates(req.nextUrl.searchParams);
    const zoom = parseSatelliteZoom(req.nextUrl.searchParams);
    const provider = req.nextUrl.searchParams.get('provider');
    const image = await fetchLocationMapImage(provider, latitude, longitude, { zoom });
    return new NextResponse(Uint8Array.from(image.bytes), {
      headers: {
        'Content-Type': image.contentType,
        'X-Map-Provider': image.provider,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    return satelliteMapErrorResponse(error);
  }
}
