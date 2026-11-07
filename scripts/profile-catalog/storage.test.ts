import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { canonicalJson, prepareCatalog } from './storage-core';

const source = {
  key: 'source:sample',
  title: 'Sample public profile data',
  publisher: 'Example publisher',
  url: 'https://example.org/profiles',
  downloadUrl: null,
  retrievedAt: '2026-11-07T10:00:00Z',
  license: 'UNVERIFIED',
  sha256: 'a'.repeat(64),
  notes: 'License needs catalog review.',
};

function profile(overrides: Record<string, unknown> = {}) {
  return {
    key: 'profile:sample',
    sourceKey: source.key,
    name: 'Sample profile',
    category: 'residential',
    kind: 'electricity',
    quantity: 'energy',
    unit: 'kWh',
    timeBasis: 'local',
    resolutionMinutes: 60,
    start: '2025-01-01T00:00:00Z',
    end: '2025-01-01T00:00:00Z',
    series: [
      { timestamp: '2025-01-01T00:00:00Z', value: 0.42, slotEnd: '2025-01-01T01:00:00Z', missingInSource: false },
    ],
    metadata: { method: 'measured', nested: { source: 'meter' } },
    quality: { status: 'reviewed' },
    ...overrides,
  };
}

test('accepts dated and pattern points while retaining point metadata in the hash', () => {
  const dated = prepareCatalog({ sources: [source], profiles: [profile()] });
  assert.equal(dated.profiles[0].pointCount, 1);
  assert.match(dated.profiles[0].contentHash, /^[0-9a-f]{64}$/);
  assert.equal((dated.profiles[0].series[0] as Record<string, unknown>).missingInSource, false);

  const pattern = prepareCatalog({
    sources: [source],
    profiles: [profile({
      key: 'profile:pattern',
      start: null,
      end: null,
      series: [{ month: 1, dayType: 'weekday', slot: 0, value: null, interpolated: true, slotEnd: 1 }],
    })],
  });
  assert.equal(pattern.profiles[0].start, null);
  assert.equal((pattern.profiles[0].series[0] as Record<string, unknown>).interpolated, true);
});

test('hash includes all profile metadata and series fields with stable object key ordering', () => {
  const first = prepareCatalog({ sources: [source], profiles: [profile()] }).profiles[0].contentHash;
  const reordered = prepareCatalog({
    sources: [source],
    profiles: [profile({
      metadata: { nested: { source: 'meter' }, method: 'measured' },
      quality: { status: 'reviewed' },
      series: [{ missingInSource: false, slotEnd: '2025-01-01T01:00:00Z', value: 0.42, timestamp: '2025-01-01T00:00:00Z' }],
    })],
  }).profiles[0].contentHash;
  const changedMetadata = prepareCatalog({ sources: [source], profiles: [profile({ metadata: { method: 'estimated' } })] }).profiles[0].contentHash;
  const changedPointMetadata = prepareCatalog({
    sources: [source],
    profiles: [profile({ series: [{ timestamp: '2025-01-01T00:00:00Z', value: 0.42, missingInSource: true, slotEnd: '2025-01-01T01:00:00Z' }] })],
  }).profiles[0].contentHash;

  assert.equal(first, reordered);
  assert.notEqual(first, changedMetadata);
  assert.notEqual(first, changedPointMetadata);
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test('rejects duplicate coordinates before storage', () => {
  assert.throws(() => prepareCatalog({
    sources: [source],
    profiles: [profile({
      series: [
        { timestamp: '2025-01-01T00:00:00Z', value: 1 },
        { timestamp: '2025-01-01T00:00:00Z', value: 2, missingInSource: true },
      ],
      end: '2025-01-01T02:00:00Z',
    })],
  }), /duplicates a series coordinate/);
  assert.throws(() => prepareCatalog({
    sources: [source],
    profiles: [profile({
      key: 'profile:pattern',
      start: null,
      end: null,
      series: [
        { month: 1, dayType: 'weekday', slot: 0, value: 1 },
        { month: 1, dayType: 'weekday', slot: 0, value: 2, interpolated: true },
      ],
    })],
  }), /duplicates a series coordinate/);
});

test('rejects non-finite values, invalid hashes, and non-string source notes', () => {
  assert.throws(() => prepareCatalog({ sources: [source], profiles: [profile({ series: [{ timestamp: '2025-01-01T00:00:00Z', value: Infinity }] })] }), /finite number or null/);
  assert.throws(() => prepareCatalog({ sources: [{ ...source, sha256: 'bad' }], profiles: [profile()] }), /64-character SHA-256/);
  assert.throws(() => prepareCatalog({ sources: [{ ...source, notes: ['check license'] }], profiles: [profile()] }), /string or null/);
});

test('the three collected public catalog fixtures pass pure import validation', () => {
  const files = [
    'output/profile-catalog-20261106/when2heat/catalog.json',
    'output/profile-catalog-20261106/opsd/catalog.json',
    'output/profile-catalog-20261106/bdew/catalog.json',
  ];
  let sourceCount = 0;
  let profileCount = 0;
  let pointCount = 0;

  for (const file of files) {
    const catalog = prepareCatalog(JSON.parse(fs.readFileSync(file, 'utf8')));
    sourceCount += catalog.sources.length;
    profileCount += catalog.profiles.length;
    pointCount += catalog.profiles.reduce((sum, entry) => sum + entry.pointCount, 0);
  }

  assert.equal(sourceCount, 5);
  assert.equal(profileCount, 34);
  assert.equal(pointCount, 224259);
});
