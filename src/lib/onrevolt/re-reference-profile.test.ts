import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { profileContentHash } from '../../../scripts/profile-catalog/storage-core';
import type { CatalogProfile } from './reference-profile-comparison';
import { parseReReferenceProfileRow } from './re-reference-profile';

const catalog = JSON.parse(readFileSync(
  join(process.cwd(), 'output', 'profile-catalog-20261106', 'catalog.json'),
  'utf8',
)) as { profiles: CatalogProfile[] };
const profile = catalog.profiles.find(item => item.key === 'bdew-2025-h25')!;
const contentHash = profileContentHash(profile as any);

test('reads a selected profile only when key, annual amount, projection version and hash agree', () => {
  const result = parseReReferenceProfileRow({
    projectId: 'project', profileKey: profile.key, contentHash, payloadJson: JSON.stringify(profile),
    annualKwh: '3650.000', projectionVersion: 1,
  });
  assert.equal(result?.profile?.key, profile.key);
  assert.equal(result?.contentHash, contentHash);
  assert.equal(result?.annualKwh, 3650);
  assert.equal(result?.projectionVersion, 1);
});

test('keeps an explicit default row and its annual overlay while treating an absent row as unselected', () => {
  assert.equal(parseReReferenceProfileRow(null), null);
  assert.deepEqual(parseReReferenceProfileRow({
    projectId: 'project', profileKey: null, contentHash: null, payloadJson: null,
    annualKwh: '4200.000', projectionVersion: '1',
  }), { profile: null, contentHash: null, annualKwh: 4200, projectionVersion: 1 });
});

test('rejects a malformed reset row, tampered profile payload, invalid annual amount and unknown version', () => {
  assert.throws(() => parseReReferenceProfileRow({
    projectId: 'project', profileKey: null, contentHash: 'bad', payloadJson: null,
    annualKwh: 4200, projectionVersion: 1,
  }), /Niespójny/);
  assert.throws(() => parseReReferenceProfileRow({
    projectId: 'project', profileKey: profile.key, contentHash, payloadJson: JSON.stringify({ ...profile, key: 'wrong' }),
    annualKwh: 4200, projectionVersion: 1,
  }), /Klucz|suma kontrolna|kontroli/);
  assert.throws(() => parseReReferenceProfileRow({
    projectId: 'project', profileKey: null, contentHash: null, payloadJson: null,
    annualKwh: -1, projectionVersion: 1,
  }), /Nieprawidłowe roczne zużycie/);
  assert.throws(() => parseReReferenceProfileRow({
    projectId: 'project', profileKey: null, contentHash: null, payloadJson: null,
    annualKwh: 4200, projectionVersion: 2,
  }), /wersji projekcji/);
});
