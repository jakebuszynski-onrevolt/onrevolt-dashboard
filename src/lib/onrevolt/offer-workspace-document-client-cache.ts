import type { OfferWorkspaceDocumentResult } from './offer-workspace-document';

export type OfferWorkspaceDocumentCacheEntry = {
  documentKey: string;
  document: OfferWorkspaceDocumentResult;
};

const databaseName = 'onrevolt-offer-workspace-documents-v1';
const storeName = 'documents';
const memoryCache = new Map<string, OfferWorkspaceDocumentCacheEntry>();

export function isOfferWorkspaceDocumentKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function offerWorkspaceDocumentCacheScope(actorId: string | undefined, projectId: string): string | null {
  if (!actorId?.trim() || !projectId.trim()) return null;
  return JSON.stringify([actorId, projectId]);
}

function isDocument(value: unknown): value is OfferWorkspaceDocumentResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const document = value as Partial<OfferWorkspaceDocumentResult>;
  return document.templateKey === 'REFORM_B2C/2026_10_V4'
    && document.pageCount === 10
    && Array.isArray(document.pages)
    && document.pages.length === 10
    && document.pages.every((page, index) => page?.page === index + 1 && typeof page.svg === 'string')
    && Array.isArray(document.missingData)
    && Array.isArray(document.suppressedCharts)
    && Array.isArray(document.limitations);
}

function isEntry(value: unknown): value is OfferWorkspaceDocumentCacheEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<OfferWorkspaceDocumentCacheEntry>;
  return isOfferWorkspaceDocumentKey(entry.documentKey) && isDocument(entry.document);
}

function openCache(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (database: IDBDatabase | null) => {
      if (settled) {
        database?.close();
        return;
      }
      settled = true;
      resolve(database);
    };
    try {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName);
      };
      request.onsuccess = () => finish(request.result);
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

function readPersistentCache(scope: string): Promise<OfferWorkspaceDocumentCacheEntry | null> {
  return openCache().then((database) => {
    if (!database) return null;
    return new Promise<OfferWorkspaceDocumentCacheEntry | null>((resolve) => {
      try {
        const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(scope);
        request.onsuccess = () => {
          database.close();
          resolve(isEntry(request.result) ? request.result : null);
        };
        request.onerror = () => {
          database.close();
          resolve(null);
        };
      } catch {
        database.close();
        resolve(null);
      }
    });
  }).catch(() => null);
}

function writePersistentCache(scope: string, entry: OfferWorkspaceDocumentCacheEntry): Promise<void> {
  return openCache().then((database) => {
    if (!database) return;
    return new Promise<void>((resolve) => {
      try {
        const request = database.transaction(storeName, 'readwrite').objectStore(storeName).put(entry, scope);
        request.onsuccess = () => { database.close(); resolve(); };
        request.onerror = () => { database.close(); resolve(); };
      } catch {
        database.close();
        resolve();
      }
    });
  }).catch(() => undefined);
}

/**
 * Best-effort client cache. A hit is only a candidate key; callers must wait for
 * the authorized document endpoint to confirm that key before displaying it.
 */
export async function getOfferWorkspaceDocumentCache(
  scope: string | null,
): Promise<OfferWorkspaceDocumentCacheEntry | null> {
  if (!scope) return null;
  const inMemory = memoryCache.get(scope);
  if (inMemory) return inMemory;
  const stored = await readPersistentCache(scope);
  if (stored) memoryCache.set(scope, stored);
  return stored;
}

export function setOfferWorkspaceDocumentCache(
  scope: string | null,
  entry: OfferWorkspaceDocumentCacheEntry,
): void {
  if (!scope || !isEntry(entry)) return;
  memoryCache.set(scope, entry);
  void writePersistentCache(scope, entry);
}

export function clearOfferWorkspaceDocumentMemoryCacheForTests() {
  memoryCache.clear();
}
