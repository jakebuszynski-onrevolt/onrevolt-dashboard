import { prisma } from './prisma';
import { profileContentHash } from '../../../scripts/profile-catalog/storage-core';
import type { CatalogProfile } from './reference-profile-comparison';

type Row = { key: string; sourceKey: string; name: string; category: string; kind: string; quantity: string;
  unit: string; timeBasis: string; resolutionMinutes: number; start: string | null; end: string | null;
  contentHash: string; pointCount: number | bigint; seriesJson: string; metadataJson: string; qualityJson: string };

let cache: { expires: number; profiles: CatalogProfile[] } | null = null;
let pending: Promise<CatalogProfile[]> | null = null;

// Catalog entries are immutable and contain public reference data, not client data.
export async function readReferenceProfileCatalog(): Promise<CatalogProfile[]> {
  if (cache && cache.expires > Date.now()) return cache.profiles;
  if (pending) return pending;
  pending = (async () => {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT \`key\`, \`sourceKey\`, \`name\`, \`category\`, \`kind\`, \`quantity\`, \`unit\`,
        \`timeBasis\`, \`resolutionMinutes\`, \`start\`, \`end\`, \`contentHash\`, \`pointCount\`,
        CAST(\`series\` AS CHAR) AS seriesJson, CAST(\`metadata\` AS CHAR) AS metadataJson,
        CAST(\`quality\` AS CHAR) AS qualityJson
      FROM ReferenceLoadProfile ORDER BY \`sourceKey\`, \`key\`
    `;
    const profiles = rows.map(row => {
      const profile: CatalogProfile = { key: row.key, sourceKey: row.sourceKey, name: row.name,
        category: row.category, kind: row.kind, quantity: row.quantity, unit: row.unit,
        timeBasis: row.timeBasis, resolutionMinutes: Number(row.resolutionMinutes), start: row.start, end: row.end,
        series: JSON.parse(row.seriesJson), metadata: JSON.parse(row.metadataJson), quality: JSON.parse(row.qualityJson) };
      if (!Array.isArray(profile.series) || profile.series.length !== Number(row.pointCount)
        || profileContentHash(profile as any) !== row.contentHash) throw new Error('Niezgodna suma kontrolna profilu referencyjnego.');
      return profile;
    });
    cache = { expires: Date.now() + 5 * 60_000, profiles };
    return profiles;
  })();
  try { return await pending; } finally { pending = null; }
}
