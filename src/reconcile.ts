import type { CacheEntry, CacheStatus } from './types';

export type ReconcileInput = {
  id: string;
  entry: CacheEntry;
  fileExists: boolean;
  hasSavable: boolean;
};

export type ReconcileAction =
  | { type: 'keep'; entry: CacheEntry }
  | { type: 'update'; entry: CacheEntry }
  | { type: 'drop' };

/**
 * Decide how to fix an index entry after a crash / force-quit.
 * - ready without a file → drop (stale)
 * - downloading/paused without partial file or savable → drop (reset to idle)
 * - downloading with file+savable → mark paused so resume() works
 */
export function reconcileEntry(input: ReconcileInput): ReconcileAction {
  const { entry, fileExists, hasSavable } = input;

  if (entry.status === 'ready') {
    if (!fileExists) {
      return { type: 'drop' };
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
          updatedAt: Date.now(),
        },
      };
    }
    return { type: 'keep', entry };
  }

  if (entry.status === 'error') {
    return { type: 'keep', entry };
  }

  // idle or unknown — keep
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

export function shouldPreferSimpleDownload(
  acceptRangesHeader: string | null
): boolean {
  if (!acceptRangesHeader) {
    return false;
  }
  return acceptRangesHeader.trim().toLowerCase() === 'none';
}
