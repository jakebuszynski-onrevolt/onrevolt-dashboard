import type { Prisma } from '@prisma/client';
import { profileContentHash } from '../../../scripts/profile-catalog/storage-core';
import {
  getReferenceProfileCalculationEligibility,
  type CatalogProfile,
} from './reference-profile-comparison';
import { prisma } from './prisma';
import { rePrisma, resolveReStation } from './re-stations';

const RE_REFERENCE_PROFILE_TABLE = 'EnergyMeter_reference_load_profiles';
const RE_REFERENCE_PROFILE_VERSION = 1;
const MAX_REFERENCE_PROFILE_JSON_BYTES = 16 * 1024 * 1024;

export type SelectedReReferenceProfile = {
  profile: CatalogProfile;
  contentHash: string;
};

export type ReReferenceProfileSyncResult = {
  status: 'synced' | 'skipped' | 'failed';
  station: string | null;
  message: string;
  retryAllowed: boolean;
};

type ReReferenceProfileRow = {
  projectId: string;
  profileKey: string | null;
  contentHash: string | null;
  payloadJson: string | null;
  annualKwh: number | string | null;
  projectionVersion: number | string | null;
};

type ProjectReferenceScope = {
  clientId: string;
  dashboardStation: string | null;
  dashboardStationNumber: string | null;
};

type CrmProjectReader = Pick<Prisma.TransactionClient, 'project'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalAnnualKwh(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('Nieprawidłowa roczna deklaracja zużycia');
  return Math.round(value * 1000) / 1000;
}

function validateSelectedProfile(value: SelectedReReferenceProfile | null): {
  profileKey: string | null;
  contentHash: string | null;
  payloadJson: string | null;
} {
  if (value === null) return { profileKey: null, contentHash: null, payloadJson: null };
  if (!isRecord(value) || !isRecord(value.profile)
    || typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.contentHash)) {
    throw new Error('Nieprawidłowy wybrany profil referencyjny RE; zapis odrzucono.');
  }
  const profile = value.profile as unknown as CatalogProfile;
  const eligibility = getReferenceProfileCalculationEligibility(profile);
  if (!eligibility.eligible) {
    throw new Error(`Wybrany profil RE nie kwalifikuje się do projekcji: ${eligibility.reason || 'nieprawidłowy profil'}`);
  }
  const expectedHash = profileContentHash(profile as any);
  if (expectedHash !== value.contentHash) throw new Error('Suma kontrolna wybranego profilu RE jest niezgodna.');
  const payloadJson = JSON.stringify(profile);
  if (Buffer.byteLength(payloadJson, 'utf8') > MAX_REFERENCE_PROFILE_JSON_BYTES) {
    throw new Error('Wybrany profil referencyjny RE przekracza limit rozmiaru.');
  }
  return { profileKey: profile.key, contentHash: value.contentHash, payloadJson };
}

async function requireReferenceProfileTable(db: ReturnType<typeof rePrisma>) {
  const tables = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SHOW TABLES LIKE '${RE_REFERENCE_PROFILE_TABLE}'`,
  );
  if (tables.length === 0) {
    throw new Error(`Brak tabeli ${RE_REFERENCE_PROFILE_TABLE} w bazie RE; zastosuj integracje/re/reference-load-profile-migration.sql.`);
  }
}

async function projectScope(
  projectId: string,
  clientId: string,
  db: CrmProjectReader,
): Promise<ProjectReferenceScope | null> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { clientId: true, dashboardStation: true, dashboardStationNumber: true },
  });
  if (!project || project.clientId !== clientId) return null;
  return {
    clientId: project.clientId,
    dashboardStation: project.dashboardStation,
    dashboardStationNumber: project.dashboardStationNumber,
  };
}

/** Persist the CRM-selected public profile in the linked RE database. Null records a default/reset row. */
export async function syncProjectReferenceLoadProfile(input: {
  projectId: string;
  clientId: string;
  annualKwh: number;
  referenceProfile: SelectedReReferenceProfile | null;
  actorId?: string | null;
  crmDb?: Prisma.TransactionClient;
}): Promise<ReReferenceProfileSyncResult> {
  let station: string | null = null;
  let retryAllowed = true;
  const skipped = (message: string): ReReferenceProfileSyncResult => ({ status: 'skipped', station, message, retryAllowed: false });
  try {
    if (!input.projectId.trim() || !input.clientId.trim()) throw new Error('Brakuje zakresu projektu CRM');
    const annualKwh = canonicalAnnualKwh(input.annualKwh);
    const selected = validateSelectedProfile(input.referenceProfile);
    const scope = await projectScope(input.projectId, input.clientId, input.crmDb ?? prisma);
    if (!scope) {
      retryAllowed = false;
      throw new Error('Nie znaleziono projektu tego klienta');
    }
    const stationReference = scope.dashboardStation?.trim() || scope.dashboardStationNumber?.trim();
    if (!stationReference) return skipped('Projekt nie ma powiązanej stacji RE; wybrany profil nie został zsynchronizowany.');

    const resolved = await resolveReStation(stationReference);
    if (!resolved
      || (scope.dashboardStationNumber?.trim() && scope.dashboardStationNumber.trim() !== resolved.station)
      || (scope.dashboardStation?.trim() && scope.dashboardStation.trim() !== resolved.stationHash)) {
      retryAllowed = false;
      throw new Error('Nieprawidłowe powiązanie stacji RE w projekcie');
    }
    station = resolved.station;

    const db = rePrisma();
    await requireReferenceProfileTable(db);
    await db.$transaction(async (tx) => {
      const existing = await tx.$queryRawUnsafe<ReReferenceProfileRow[]>(
        `SELECT \`projectId\`, \`profileKey\`, \`contentHash\`, \`payloadJson\`, \`annualKwh\`, \`projectionVersion\`
         FROM \`${RE_REFERENCE_PROFILE_TABLE}\` WHERE \`station\` = ? FOR UPDATE`,
        station,
      );
      if (existing.length && existing[0].projectId !== input.projectId) {
        retryAllowed = false;
        throw new Error('Stacja RE ma już profil referencyjny przypisany do innego projektu.');
      }

      await tx.$executeRawUnsafe(
        `INSERT INTO \`${RE_REFERENCE_PROFILE_TABLE}\`
          (\`station\`, \`projectId\`, \`profileKey\`, \`contentHash\`, \`payloadJson\`, \`annualKwh\`, \`projectionVersion\`, \`updatedAt\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
          \`profileKey\` = IF(\`projectId\` = VALUES(\`projectId\`), VALUES(\`profileKey\`), \`profileKey\`),
          \`contentHash\` = IF(\`projectId\` = VALUES(\`projectId\`), VALUES(\`contentHash\`), \`contentHash\`),
          \`payloadJson\` = IF(\`projectId\` = VALUES(\`projectId\`), VALUES(\`payloadJson\`), \`payloadJson\`),
          \`annualKwh\` = IF(\`projectId\` = VALUES(\`projectId\`), VALUES(\`annualKwh\`), \`annualKwh\`),
          \`projectionVersion\` = IF(\`projectId\` = VALUES(\`projectId\`), VALUES(\`projectionVersion\`), \`projectionVersion\`),
          \`updatedAt\` = IF(\`projectId\` = VALUES(\`projectId\`), CURRENT_TIMESTAMP, \`updatedAt\`)`,
        station,
        input.projectId,
        selected.profileKey,
        selected.contentHash,
        selected.payloadJson,
        annualKwh,
        RE_REFERENCE_PROFILE_VERSION,
      );

      const confirmed = await tx.$queryRawUnsafe<ReReferenceProfileRow[]>(
        `SELECT \`projectId\`, \`profileKey\`, \`contentHash\`, \`payloadJson\`, \`annualKwh\`, \`projectionVersion\`
         FROM \`${RE_REFERENCE_PROFILE_TABLE}\` WHERE \`station\` = ? LIMIT 1`,
        station,
      );
      const row = confirmed[0];
      if (!row || row.projectId !== input.projectId
        || row.profileKey !== selected.profileKey || row.contentHash !== selected.contentHash
        || Number(row.projectionVersion) !== RE_REFERENCE_PROFILE_VERSION
        || Number(row.annualKwh) !== annualKwh || row.payloadJson !== selected.payloadJson) {
        retryAllowed = false;
        throw new Error('RE nie potwierdziło zapisu wybranego profilu referencyjnego.');
      }
    }, { maxWait: 30_000, timeout: 30_000 });

    return {
      status: 'synced', station, retryAllowed: false,
      message: selected.profileKey
        ? `Zapisano profil ${selected.profileKey} w RE.`
        : 'Przywrócono domyślny profil RE.',
    };
  } catch (error) {
    return {
      status: 'failed', station, retryAllowed,
      message: `Nie potwierdzono zapisu profilu referencyjnego w RE: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }
}

/** Parse and validate the RE-owned payload returned by user_consumption_get. */
export function parseReReferenceProfileRow(row: ReReferenceProfileRow | null): {
  profile: CatalogProfile | null;
  contentHash: string | null;
  annualKwh: number | null;
  projectionVersion: 1;
} | null {
  if (row === null) return null;
  if (Number(row.projectionVersion) !== RE_REFERENCE_PROFILE_VERSION) {
    throw new Error('Zapisany profil referencyjny RE wymaga nieobsługiwanej wersji projekcji.');
  }
  const annualKwh = row.annualKwh === null ? null : Number(row.annualKwh);
  if (annualKwh !== null && (!Number.isFinite(annualKwh) || annualKwh < 0)) {
    throw new Error('Nieprawidłowe roczne zużycie zapisane dla profilu RE.');
  }
  if (row.profileKey === null) {
    if (row.contentHash !== null || row.payloadJson !== null) throw new Error('Niespójny zapis domyślnego profilu RE.');
    return { profile: null, contentHash: null, annualKwh, projectionVersion: RE_REFERENCE_PROFILE_VERSION };
  }
  if (typeof row.contentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(row.contentHash)
    || typeof row.payloadJson !== 'string' || Number(row.projectionVersion) !== RE_REFERENCE_PROFILE_VERSION
    || annualKwh === null) {
    throw new Error('Nieprawidłowy zapisany profil referencyjny RE.');
  }
  let profile: unknown;
  try { profile = JSON.parse(row.payloadJson); } catch { throw new Error('Nieprawidłowy JSON zapisanego profilu referencyjnego RE.'); }
  if (!isRecord(profile) || profile.key !== row.profileKey) throw new Error('Klucz zapisanego profilu RE nie zgadza się z jego danymi.');
  const eligibility = getReferenceProfileCalculationEligibility(profile as unknown as CatalogProfile);
  if (!eligibility.eligible || profileContentHash(profile as any) !== row.contentHash) {
    throw new Error(`Zapisany profil referencyjny RE nie przechodzi kontroli: ${eligibility.reason || 'niezgodna suma kontrolna'}.`);
  }
  return {
    profile: profile as unknown as CatalogProfile,
    contentHash: row.contentHash,
    annualKwh,
    projectionVersion: RE_REFERENCE_PROFILE_VERSION,
  };
}
