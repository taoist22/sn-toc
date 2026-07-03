const STORAGE_ROOT = '/storage/emulated/0';

export function normalizeStoragePath(path: string): string {
  let normalized = path.trim();
  if (!normalized) {
    return normalized;
  }

  if (normalized.startsWith('/storage/emulated/0/')) {
    return normalized;
  }

  if (normalized.startsWith('storage/emulated/0/')) {
    return `/${normalized}`;
  }

  if (normalized.startsWith('/')) {
    return `${STORAGE_ROOT}${normalized}`;
  }

  return `${STORAGE_ROOT}/${normalized}`;
}
