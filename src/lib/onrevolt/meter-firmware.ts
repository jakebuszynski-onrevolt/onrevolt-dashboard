export type MeterFirmwareFamily = 'ENERGYMETER' | 'PGE';
export type MeterFirmwareRelease = { version: string; size: number };

const catalogUrls: Record<MeterFirmwareFamily, string> = {
  ENERGYMETER: 'https://windyone.pl/OTA/EnergyMeter/releases.php',
  PGE: 'https://windyone.pl/OTA/EnergyMeter/PGE/releases.php',
};

export function parseMeterFirmwareRelease(
  value: unknown,
  family: MeterFirmwareFamily,
  filename: string,
): MeterFirmwareRelease & { binaryName: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Nieprawidłowy manifest firmware ${family}: ${filename}`);
  }
  const record = value as Record<string, unknown>;
  const version = typeof record.version === 'string' ? record.version : '';
  const pattern = family === 'PGE' ? /^PGE-\d{4}\.\d{2}\.\d{2}\.\d+$/ : /^\d{4}\.\d{2}\.\d{2}\.\d+$/;
  if (!pattern.test(version) || filename !== `${version}.json`
    || (family === 'PGE' && record.family !== 'PGE-SX1276')
    || typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(record.sha256)
    || typeof record.size !== 'number' || !Number.isSafeInteger(record.size) || record.size <= 0) {
    throw new Error(`Nieprawidłowe metadane firmware ${family}: ${filename}`);
  }
  const url = new URL(String(record.url || ''));
  const prefix = family === 'PGE' ? '/OTA/EnergyMeter/PGE/firmware/' : '/OTA/EnergyMeter/firmware/';
  const binaryName = url.pathname.slice(prefix.length);
  if (url.origin !== 'https://windyone.pl' || !url.pathname.startsWith(prefix)
    || url.search || url.hash || url.username || url.password
    || !/^[A-Za-z0-9._-]+\.bin$/.test(binaryName)) {
    throw new Error(`Nieprawidłowy plik firmware ${family}: ${filename}`);
  }
  return { version, size: record.size, binaryName };
}

export async function listMeterFirmwareReleases(
  family: MeterFirmwareFamily,
  fetchCatalog: typeof fetch = fetch,
): Promise<MeterFirmwareRelease[]> {
  const response = await fetchCatalog(catalogUrls[family], {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Katalog firmware ${family} zwrócił HTTP ${response.status}`);
  const payload = await response.json() as { family?: unknown; releases?: unknown };
  if (!payload || payload.family !== family || !Array.isArray(payload.releases)) {
    throw new Error(`Nieprawidłowy katalog firmware ${family}`);
  }
  const releases = payload.releases.map((candidate: unknown) => {
    const version = candidate && typeof candidate === 'object' && 'version' in candidate ? candidate.version : '';
    const release = parseMeterFirmwareRelease(candidate, family, `${version}.json`);
    return { version: release.version, size: release.size };
  });
  if (!releases.length) throw new Error(`Brak opublikowanych wydań firmware ${family}`);
  return releases.sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }));
}
