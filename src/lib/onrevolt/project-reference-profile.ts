import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { readReferenceProfileCatalog } from './reference-profile-catalog-server';
import { getReferenceProfileCalculationEligibility, type CatalogProfile } from './reference-profile-comparison';
import { profileContentHash } from '../../../scripts/profile-catalog/storage-core';

export type ProjectReferenceProfileSelection = {
  key: string | null;
  revision: number;
  contentHash: string | null;
  profileName: string | null;
};
export type SelectedReferenceProfile = { profile: CatalogProfile; contentHash: string };
type Database = Pick<Prisma.TransactionClient, '$queryRaw'>;

export async function readProjectReferenceProfileSelection(projectId: string, db: Database = prisma): Promise<ProjectReferenceProfileSelection> {
  const rows = await db.$queryRaw<Array<{ profileKey: string | null; revision: number; contentHash: string | null; profileName: string | null; projectionVersion: number }>>`
    SELECT profileKey, revision, contentHash, profileName, projectionVersion
    FROM ProjectReferenceLoadProfile WHERE projectId = ${projectId}
  `;
  if (!rows.length) return { key: null, revision: 0, contentHash: null, profileName: null };
  const row = rows[0];
  if (row.projectionVersion !== 1) throw new Error('Zapisany profil wymaga nieobsługiwanej wersji projekcji.');
  if (row.profileKey === null && (row.contentHash !== null || row.profileName !== null)) throw new Error('Niespójny zapis domyślnego profilu projektu.');
  return { key: row.profileKey, revision: row.revision, contentHash: row.contentHash, profileName: row.profileName };
}

export async function referenceProfileForKey(key: string): Promise<SelectedReferenceProfile> {
  const profile = (await readReferenceProfileCatalog()).find(item => item.key === key);
  if (!profile) throw new Error('Nie znaleziono wybranego profilu w katalogu.');
  const eligibility = getReferenceProfileCalculationEligibility(profile);
  if (!eligibility.eligible) throw new Error(eligibility.reason || 'Profil nie kwalifikuje się do obliczeń RE.');
  return { profile, contentHash: profileContentHash(profile as any) };
}

export async function resolveSelectedReferenceProfile(selection?: ProjectReferenceProfileSelection | null): Promise<SelectedReferenceProfile | null> {
  if (!selection || selection.key === null) return null;
  const selected = await referenceProfileForKey(selection.key);
  if (!selection.contentHash || selected.contentHash !== selection.contentHash) {
    throw new Error('Treść zapisanego profilu uległa zmianie. Wybierz i zapisz profil ponownie przed obliczeniami.');
  }
  return selected;
}

export async function readSelectedReferenceProfile(projectId: string, db: Database = prisma): Promise<SelectedReferenceProfile | null> {
  return resolveSelectedReferenceProfile(await readProjectReferenceProfileSelection(projectId, db));
}
