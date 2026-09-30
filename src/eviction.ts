import type { CacheEntry } from './types';

/**
 * Pick ready entries to delete (oldest updatedAt first) until
 * totalBytes - sum(selected.bytes) <= maxBytes.
 * Never selects in-flight ids.
 */
export function pickLruVictims(
  entries: CacheEntry[],
  totalBytes: number,
  maxBytes: number
): CacheEntry[] {
  if (totalBytes <= maxBytes) {
    return [];
  }

  const ready = entries
    .filter((e) => e.status === 'ready')
    .sort((a, b) => a.updatedAt - b.updatedAt);

  const victims: CacheEntry[] = [];
  let bytes = totalBytes;

  for (const entry of ready) {
    if (bytes <= maxBytes) {
      break;
    }
    victims.push(entry);
    bytes -= entry.bytes;
  }

  return victims;
}

export function sumReadyBytes(entries: CacheEntry[]): number {
  return entries
    .filter((e) => e.status === 'ready')
    .reduce((sum, e) => sum + (e.bytes || 0), 0);
}
