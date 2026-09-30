import {
  isRangeOrResumeFailure,
  reconcileEntry,
  shouldPreferSimpleDownload,
} from '../src/reconcile';
import type { CacheEntry } from '../src/types';

function entry(
  id: string,
  status: CacheEntry['status'],
  extra: Partial<CacheEntry> = {}
): CacheEntry {
  return {
    id,
    url: `https://example.com/${id}.mp3`,
    localUri: `file:///${id}.mp3`,
    bytes: 10,
    updatedAt: 1,
    status,
    ...extra,
  };
}

describe('reconcileEntry', () => {
  it('keeps ready entries when the file exists', () => {
    expect(
      reconcileEntry({
        id: 'a',
        entry: entry('a', 'ready'),
        fileExists: true,
        hasSavable: false,
      }).type
    ).toBe('keep');
  });

  it('drops ready entries when the file is missing', () => {
    expect(
      reconcileEntry({
        id: 'a',
        entry: entry('a', 'ready'),
        fileExists: false,
        hasSavable: false,
      }).type
    ).toBe('drop');
  });

  it('drops downloading/paused when partial file or savable is missing', () => {
    expect(
      reconcileEntry({
        id: 'a',
        entry: entry('a', 'downloading'),
        fileExists: false,
        hasSavable: true,
      }).type
    ).toBe('drop');

    expect(
      reconcileEntry({
        id: 'a',
        entry: entry('a', 'paused'),
        fileExists: true,
        hasSavable: false,
      }).type
    ).toBe('drop');
  });

  it('converts downloading + file + savable into paused', () => {
    const action = reconcileEntry({
      id: 'a',
      entry: entry('a', 'downloading', { progress: 0.4 }),
      fileExists: true,
      hasSavable: true,
    });
    expect(action.type).toBe('update');
    if (action.type === 'update') {
      expect(action.entry.status).toBe('paused');
      expect(action.entry.progress).toBe(0.4);
    }
  });

  it('keeps paused when file and savable exist', () => {
    expect(
      reconcileEntry({
        id: 'a',
        entry: entry('a', 'paused'),
        fileExists: true,
        hasSavable: true,
      }).type
    ).toBe('keep');
  });
});

describe('isRangeOrResumeFailure', () => {
  it('detects common range/resume failure messages', () => {
    expect(isRangeOrResumeFailure(new Error('HTTP 416'))).toBe(true);
    expect(
      isRangeOrResumeFailure(new Error('Requested Range Not Satisfiable'))
    ).toBe(true);
    expect(isRangeOrResumeFailure(new Error('Unable to resume download'))).toBe(
      true
    );
    expect(isRangeOrResumeFailure(new Error('network timeout'))).toBe(false);
  });
});

describe('shouldPreferSimpleDownload', () => {
  it('only forces simple download when Accept-Ranges is none', () => {
    expect(shouldPreferSimpleDownload('none')).toBe(true);
    expect(shouldPreferSimpleDownload('bytes')).toBe(false);
    expect(shouldPreferSimpleDownload(null)).toBe(false);
  });
});
