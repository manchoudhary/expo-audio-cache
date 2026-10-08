import type { CacheEntry, CacheStatus } from './types';

export type ReconcileInput = {
  id: string;
  entry: CacheEntry;
  fileExists: boolean;
  fileBytes: number;
  hasSavable: boolean;
};

export type ReconcileAction =
  | { type: 'keep'; entry: CacheEntry }
  | { type: 'update'; entry: CacheEntry }
  | { type: 'drop' };

/**
 * Decide how to fix an index entry after a crash / force-quit.
 * - ready without a file → drop (stale)
 * - ready with mismatched size → update bytes from disk
 * - downloading/paused without partial file or savable → drop (reset to idle)
 * - downloading with file+savable → mark paused so resume() works
 */
export function reconcileEntry(input: ReconcileInput): ReconcileAction {
  const { entry, fileExists, fileBytes, hasSavable } = input;

  if (entry.status === 'ready') {
    if (!fileExists || fileBytes <= 0) {
      return { type: 'drop' };
    }
    if (entry.bytes !== fileBytes) {
      return {
        type: 'update',
        entry: { ...entry, bytes: fileBytes, updatedAt: Date.now() },
      };
    }
    return { type: 'keep', entry };
  }

  if (entry.status === 'downloading' || entry.status === 'paused') {
    if (!fileExists || !hasSavable) {
      return { type: 'drop' };
    }
    if (entry.status === 'downloading') {
      return {
        type: 'update',
        entry: {
          ...entry,
          status: 'paused' satisfies CacheStatus,
          bytes: fileBytes > 0 ? fileBytes : entry.bytes,
          updatedAt: Date.now(),
        },
      };
    }
    if (fileBytes > 0 && entry.bytes !== fileBytes) {
      return {
        type: 'update',
        entry: { ...entry, bytes: fileBytes },
      };
    }
    return { type: 'keep', entry };
  }

  if (entry.status === 'error') {
    return { type: 'keep', entry };
  }

  return { type: 'keep', entry };
}

export function isRangeOrResumeFailure(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('416') ||
    msg.includes('range not satisfiable') ||
    msg.includes('requested range') ||
    msg.includes('accept-ranges') ||
    msg.includes('cannot resume') ||
    msg.includes('unable to resume') ||
    msg.includes('failed to resume') ||
    msg.includes('invalid resume') ||
    msg.includes('resume data')
  );
}

/** True for offline / DNS / aborted connectivity probes (RN + browsers). */
export function isNetworkOrAbortFailure(error: unknown): boolean {
  if (error != null && typeof error === 'object' && 'name' in error) {
    const name = String((error as { name: unknown }).name);
    if (name === 'AbortError' || name === 'TimeoutError') {
      return true;
    }
  }
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('the internet connection appears to be offline') ||
    msg.includes('aborted') ||
    msg.includes('abort') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('could not connect') ||
    msg.includes('connection refused') ||
    msg.includes('unreachable')
  );
}

export function shouldPreferSimpleDownload(
  acceptRangesHeader: string | null
): boolean {
  if (!acceptRangesHeader) {
    return false;
  }
  return acceptRangesHeader.trim().toLowerCase() === 'none';
}

/** Accept 200 (full) and 206 (partial content / resume). Reject other statuses. */
export function isSuccessfulDownloadStatus(status: number | undefined): boolean {
  if (status == null) {
    // Some platforms omit status on success — treat as OK and validate bytes instead.
    return true;
  }
  return status === 200 || status === 206;
}

export function assertSafeCacheId(id: string): string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('expo-audio-cache: id must be a non-empty string');
  }
  if (id.length > 200) {
    throw new Error('expo-audio-cache: id is too long (max 200 characters)');
  }
  if (id.includes('..') || id.includes('/') || id.includes('\\') || id.includes('\0')) {
    throw new Error('expo-audio-cache: id must not contain path separators or ".."');
  }
  const safe = id.replace(/[^a-zA-Z0-9-_]/g, '_');
  if (!safe || safe === '.' || safe === '..') {
    throw new Error('expo-audio-cache: id sanitizes to an unsafe filesystem name');
  }
  return safe;
}

export function assertSafeDirectoryName(name: string): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('expo-audio-cache: directoryName must be a non-empty string');
  }
  if (
    name.includes('..') ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throw new Error(
      'expo-audio-cache: directoryName must not contain path separators or ".."'
    );
  }
  return name;
}

/** Strip secrets so JWT / Authorization never land in index.json. */
export function stripSensitiveHeaders(
  headers?: Record<string, string>
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === 'authorization' ||
      lower === 'cookie' ||
      lower === 'set-cookie' ||
      lower === 'proxy-authorization' ||
      lower.startsWith('x-api-key')
    ) {
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
