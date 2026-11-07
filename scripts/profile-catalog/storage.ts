import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  prepareCatalog,
  PreparedCatalog,
  PreparedProfile,
  PreparedSource,
  profileContentHash,
  profileSignature,
  sourceSignature,
} from './storage-core';

type RawSource = {
  key: string;
  title: string;
  publisher: string;
  url: string;
  downloadUrl: string | null;
  retrievedAt: string;
  license: string;
  rawSha256: string;
  notes: string | null;
};

type RawProfile = {
  key: string;
  sourceKey: string;
  name: string;
  category: string;
  kind: string;
  quantity: string;
  unit: string;
  timeBasis: string;
  resolutionMinutes: number;
  start: string;
  end: string;
  pointCount: number;
  contentHash: string;
  seriesJson: string;
  metadataJson: string;
  qualityJson: string;
};

type RawClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

function loadEnvFile(fileName: string): void {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (process.env[key]) continue;
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function decodeJson(json: string, label: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new Error(`Stored ${label} is not valid JSON.`);
  }
}

function rowToPreparedSource(row: RawSource): PreparedSource {
  return {
    key: row.key,
    title: row.title,
    publisher: row.publisher,
    url: row.url,
    downloadUrl: row.downloadUrl,
    retrievedAt: row.retrievedAt,
    license: row.license,
    sha256: row.rawSha256,
    notes: row.notes,
  };
}

function rowToPreparedProfile(row: RawProfile): PreparedProfile {
  return {
    key: row.key,
    sourceKey: row.sourceKey,
    name: row.name,
    category: row.category,
    kind: row.kind,
    quantity: row.quantity,
    unit: row.unit,
    timeBasis: row.timeBasis,
    resolutionMinutes: Number(row.resolutionMinutes),
    start: row.start,
    end: row.end,
    pointCount: Number(row.pointCount),
    contentHash: row.contentHash,
    series: decodeJson(row.seriesJson, `profile ${row.key} series`) as PreparedProfile['series'],
    metadata: decodeJson(row.metadataJson, `profile ${row.key} metadata`) as Record<string, unknown>,
    quality: decodeJson(row.qualityJson, `profile ${row.key} quality`) as Record<string, unknown>,
  };
}

async function getSource(client: RawClient, key: string): Promise<RawSource | undefined> {
  const rows = await client.$queryRaw<RawSource[]>`
    SELECT
      \`key\`, \`title\`, \`publisher\`, \`url\`, \`downloadUrl\`, \`retrievedAt\`,
      \`license\`, \`rawSha256\`, \`notes\`
    FROM \`ReferenceLoadProfileSource\`
    WHERE \`key\` = ${key}
    LIMIT 1
  `;
  return rows[0];
}

async function getProfile(client: RawClient, key: string): Promise<RawProfile | undefined> {
  const rows = await client.$queryRaw<RawProfile[]>`
    SELECT
      \`key\`, \`sourceKey\`, \`name\`, \`category\`, \`kind\`, \`quantity\`, \`unit\`,
      \`timeBasis\`, \`resolutionMinutes\`, \`start\`, \`end\`, \`pointCount\`, \`contentHash\`,
      CAST(\`series\` AS CHAR) AS \`seriesJson\`,
      CAST(\`metadata\` AS CHAR) AS \`metadataJson\`,
      CAST(\`quality\` AS CHAR) AS \`qualityJson\`
    FROM \`ReferenceLoadProfile\`
    WHERE \`key\` = ${key}
    LIMIT 1
  `;
  return rows[0];
}

function planCatalog(catalog: PreparedCatalog, existingSources: Map<string, PreparedSource>, existingProfiles: Map<string, PreparedProfile>) {
  const conflicts: string[] = [];
  const newSources: PreparedSource[] = [];
  const newProfiles: PreparedProfile[] = [];

  for (const source of catalog.sources) {
    const existing = existingSources.get(source.key);
    if (!existing) {
      newSources.push(source);
    } else if (sourceSignature(existing) !== sourceSignature(source)) {
      conflicts.push(`source ${source.key} already exists with a different immutable payload`);
    }
  }

  for (const profile of catalog.profiles) {
    const existing = existingProfiles.get(profile.key);
    if (!existing) {
      newProfiles.push(profile);
    } else if (profileSignature(existing) !== profileSignature(profile)) {
      conflicts.push(`profile ${profile.key} already exists with a different immutable payload`);
    }
  }

  if (conflicts.length > 0) throw new Error(`Catalog conflicts:\n- ${conflicts.join('\n- ')}`);
  return { newSources, newProfiles };
}

async function importCatalog(client: PrismaClient, catalog: PreparedCatalog, apply: boolean) {
  return client.$transaction(async (transaction) => {
    const existingSources = new Map<string, PreparedSource>();
    const existingProfiles = new Map<string, PreparedProfile>();

    for (const source of catalog.sources) {
      const row = await getSource(transaction, source.key);
      if (row) existingSources.set(source.key, rowToPreparedSource(row));
    }
    for (const profile of catalog.profiles) {
      const row = await getProfile(transaction, profile.key);
      if (row) existingProfiles.set(profile.key, rowToPreparedProfile(row));
    }

    // All payloads and existing-key conflicts are checked before the first insert.
    const plan = planCatalog(catalog, existingSources, existingProfiles);
    if (apply) {
      for (const source of plan.newSources) {
        await transaction.$executeRaw`
          INSERT INTO \`ReferenceLoadProfileSource\`
            (\`key\`, \`title\`, \`publisher\`, \`url\`, \`downloadUrl\`, \`retrievedAt\`, \`license\`, \`rawSha256\`, \`notes\`)
          VALUES
            (${source.key}, ${source.title}, ${source.publisher}, ${source.url}, ${source.downloadUrl}, ${source.retrievedAt}, ${source.license}, ${source.sha256}, ${source.notes})
        `;
      }
      for (const profile of plan.newProfiles) {
        await transaction.$executeRaw`
          INSERT INTO \`ReferenceLoadProfile\`
            (\`key\`, \`sourceKey\`, \`name\`, \`category\`, \`kind\`, \`quantity\`, \`unit\`, \`timeBasis\`, \`resolutionMinutes\`, \`start\`, \`end\`, \`pointCount\`, \`contentHash\`, \`series\`, \`metadata\`, \`quality\`)
          VALUES
            (${profile.key}, ${profile.sourceKey}, ${profile.name}, ${profile.category}, ${profile.kind}, ${profile.quantity}, ${profile.unit}, ${profile.timeBasis}, ${profile.resolutionMinutes}, ${profile.start}, ${profile.end}, ${profile.pointCount}, ${profile.contentHash}, ${JSON.stringify(profile.series)}, ${JSON.stringify(profile.metadata)}, ${JSON.stringify(profile.quality)})
        `;
      }
    }

    return {
      mode: apply ? 'apply' : 'dry-run',
      sources: { catalog: catalog.sources.length, alreadyPresent: catalog.sources.length - plan.newSources.length, toInsert: plan.newSources.length },
      profiles: { catalog: catalog.profiles.length, alreadyPresent: catalog.profiles.length - plan.newProfiles.length, toInsert: plan.newProfiles.length },
    };
  }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 120000 });
}

async function readback(client: PrismaClient) {
  const sources = await client.$queryRaw<RawSource[]>`
    SELECT
      \`key\`, \`title\`, \`publisher\`, \`url\`, \`downloadUrl\`, \`retrievedAt\`,
      \`license\`, \`rawSha256\`, \`notes\`
    FROM \`ReferenceLoadProfileSource\`
    ORDER BY \`key\`
  `;
  const profiles = await client.$queryRaw<RawProfile[]>`
    SELECT
      \`key\`, \`sourceKey\`, \`name\`, \`category\`, \`kind\`, \`quantity\`, \`unit\`,
      \`timeBasis\`, \`resolutionMinutes\`, \`start\`, \`end\`, \`pointCount\`, \`contentHash\`,
      CAST(\`series\` AS CHAR) AS \`seriesJson\`,
      CAST(\`metadata\` AS CHAR) AS \`metadataJson\`,
      CAST(\`quality\` AS CHAR) AS \`qualityJson\`
    FROM \`ReferenceLoadProfile\`
    ORDER BY \`key\`
  `;
  const sourceProfileCounts = new Map<string, number>();
  for (const profile of profiles) sourceProfileCounts.set(profile.sourceKey, (sourceProfileCounts.get(profile.sourceKey) || 0) + 1);

  const sourceSummaries = sources.map((row) => ({
    key: row.key,
    title: row.title,
    publisher: row.publisher,
    url: row.url,
    downloadUrl: row.downloadUrl,
    retrievedAt: row.retrievedAt,
    license: row.license,
    sha256: row.rawSha256,
    notes: row.notes,
    profileCount: sourceProfileCounts.get(row.key) || 0,
    rawSha256FormatValid: /^[0-9a-f]{64}$/i.test(row.rawSha256),
  }));

  const profileSummaries = profiles.map((row) => {
    const profile = rowToPreparedProfile(row);
    const computedHash = profileContentHash(profile);
    const actualPointCount = Array.isArray(profile.series) ? profile.series.length : -1;
    return {
      key: profile.key,
      sourceKey: profile.sourceKey,
      name: profile.name,
      category: profile.category,
      kind: profile.kind,
      quantity: profile.quantity,
      unit: profile.unit,
      timeBasis: profile.timeBasis,
      resolutionMinutes: profile.resolutionMinutes,
      start: profile.start,
      end: profile.end,
      pointCount: profile.pointCount,
      contentHash: profile.contentHash,
      computedContentHash: computedHash,
      contentIntegrity: computedHash === profile.contentHash && actualPointCount === profile.pointCount ? 'OK' : 'MISMATCH',
    };
  });

  return {
    sources: sourceSummaries,
    profiles: profileSummaries,
    integrity: {
      sourcesWithInvalidRawSha256: sourceSummaries.filter((source) => !source.rawSha256FormatValid).length,
      profilesWithContentMismatch: profileSummaries.filter((profile) => profile.contentIntegrity !== 'OK').length,
    },
  };
}

function optionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}

function assertAllowedArgs(args: string[], allowed: string[]): void {
  for (const arg of args) {
    if (arg.startsWith('--') && !allowed.includes(arg)) throw new Error(`Unsupported option: ${arg}`);
  }
}

function help(): string {
  return [
    'Reference load profile catalog storage',
    '',
    'Import (dry-run by default):',
    '  npx tsx scripts/profile-catalog/storage.ts import --file catalog.json',
    '  npx tsx scripts/profile-catalog/storage.ts import --file catalog.json --apply',
    '',
    'Read back compact summaries and verify stored content hashes:',
    '  npx tsx scripts/profile-catalog/storage.ts list [--out summary.json]',
  ].join('\n');
}

async function run(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h' || !command) {
    process.stdout.write(`${help()}\n`);
    return;
  }

  loadEnvFile('.env.local');
  loadEnvFile('.env');
  const client = new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });
  try {
    if (command === 'import') {
      assertAllowedArgs(args, ['--file', '--apply', '--dry-run']);
      const fileArgument = optionValue(args, '--file');
      if (!fileArgument) throw new Error('import requires --file catalog.json.');
      if (args.includes('--apply') && args.includes('--dry-run')) throw new Error('Choose either --apply or --dry-run.');
      const filePath = path.resolve(process.cwd(), fileArgument);
      const input = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
      const catalog = prepareCatalog(input);
      const result = await importCatalog(client, catalog, args.includes('--apply'));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (command === 'list' || command === 'readback') {
      assertAllowedArgs(args, ['--out']);
      const output = await readback(client);
      const json = `${JSON.stringify(output, null, 2)}\n`;
      const outputPath = optionValue(args, '--out');
      if (outputPath) {
        const absolutePath = path.resolve(process.cwd(), outputPath);
        fs.writeFileSync(absolutePath, json, { encoding: 'utf8' });
        process.stdout.write(`Wrote ${output.profiles.length} profile summaries to ${absolutePath}.\n`);
      } else {
        process.stdout.write(json);
      }
      if (output.integrity.sourcesWithInvalidRawSha256 > 0 || output.integrity.profilesWithContentMismatch > 0) {
        process.stderr.write('Readback detected content integrity mismatches.\n');
        process.exitCode = 1;
      }
      return;
    }

    throw new Error(`Unknown command: ${command}\n\n${help()}`);
  } finally {
    await client.$disconnect();
  }
}

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
