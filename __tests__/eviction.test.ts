import { pickLruVictims, sumReadyBytes } from '../src/eviction';
import type { CacheEntry } from '../src/types';

function entry(
  id: string,
  bytes: number,
  updatedAt: number,
  status: CacheEntry['status'] = 'ready'
): CacheEntry {
  return {
    id,
    url: `https://example.com/${id}.mp3`,
    localUri: `file:///${id}.mp3`,
    bytes,
    updatedAt,
    status,
  };
}

describe('sumReadyBytes', () => {
  it('sums only ready entries', () => {
    const entries = [
      entry('a', 100, 1),
      entry('b', 50, 2, 'downloading'),
      entry('c', 25, 3),
    ];
    expect(sumReadyBytes(entries)).toBe(125);
  });
});

describe('pickLruVictims', () => {
  it('returns empty when under budget', () => {
    const entries = [entry('a', 100, 1), entry('b', 100, 2)];
    expect(pickLruVictims(entries, 200, 500)).toEqual([]);
  });

  it('evicts oldest ready first', () => {
    const entries = [
      entry('old', 100, 1),
      entry('mid', 100, 2),
      entry('new', 100, 3),
    ];
    const victims = pickLruVictims(entries, 300, 150);
    expect(victims.map((v) => v.id)).toEqual(['old', 'mid']);
  });

  it('never selects in-flight entries', () => {
    const entries = [
      entry('ready-old', 200, 1, 'ready'),
      entry('downloading', 200, 0, 'downloading'),
    ];
    const victims = pickLruVictims(entries, 400, 100);
    expect(victims.map((v) => v.id)).toEqual(['ready-old']);
  });
});
