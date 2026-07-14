import path from 'path';

type CatalogMediaPathSource = {
  storagePath?: string | null;
  url?: string | null;
};

const legacyPublicPrefix = '/uploads/catalog/products/';

export function catalogMediaStorageRoot() {
  const configuredRoot = process.env.ONREVOLT_CATALOG_UPLOAD_DIR?.trim();
  if (!configuredRoot) {
    throw new Error('Brak ONREVOLT_CATALOG_UPLOAD_DIR dla załączników katalogu');
  }
  return path.resolve(configuredRoot);
}

export function legacyCatalogMediaRoot() {
  return path.resolve(process.cwd(), 'public', 'uploads', 'catalog', 'products');
}

export function isPathInsideRoot(filePath: string, rootPath: string) {
  const relative = path.relative(rootPath, filePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function resolveCatalogMediaPath(media: CatalogMediaPathSource) {
  const storagePath = media.storagePath?.trim();
  const configuredRoot = catalogMediaStorageRoot();

  if (storagePath) {
    const filePath = path.isAbsolute(storagePath)
      ? path.resolve(storagePath)
      : path.resolve(configuredRoot, storagePath);
    const allowedRoots = [configuredRoot, legacyCatalogMediaRoot()];
    if (!allowedRoots.some((rootPath) => isPathInsideRoot(filePath, rootPath))) {
      throw new Error('Plik załącznika jest poza dozwolonym katalogiem uploadów');
    }
    return filePath;
  }

  if (media.url?.startsWith(legacyPublicPrefix)) {
    const relativePath = decodeURIComponent(media.url.slice(legacyPublicPrefix.length));
    const legacyRoot = legacyCatalogMediaRoot();
    const filePath = path.resolve(legacyRoot, relativePath);
    if (!isPathInsideRoot(filePath, legacyRoot)) {
      throw new Error('Nieprawidłowa ścieżka załącznika katalogu');
    }
    return filePath;
  }

  return null;
}

export function catalogMediaRelativePath(productId: string, fileName: string) {
  const rootPath = catalogMediaStorageRoot();
  const filePath = path.resolve(rootPath, productId, fileName);
  if (!isPathInsideRoot(filePath, rootPath)) {
    throw new Error('Nieprawidłowa ścieżka załącznika katalogu');
  }
  return {
    filePath,
    relativePath: path.relative(rootPath, filePath),
  };
}
