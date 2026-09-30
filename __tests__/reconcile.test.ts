import {
  assertSafeCacheId,
  isRangeOrResumeFailure,
  isSuccessfulDownloadStatus,
  reconcileEntry,
  shouldPreferSimpleDownload,
  stripSensitiveHeaders,
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
        fileBytes: 10,
        hasSavable: false,
      }).type
    ).toBe('keep');
  });

  it('drops ready entries when the file is missing or empty', () => {
    expect(
      reconcileEntry({
        id: 'a',
        entry: entry('a', 'ready'),
        fileExists: false,
        fileBytes: 0,
        hasSavable: false,
      }).type
    ).toBe('drop');
    expect(
      reconcileEntry({
        id: 'a',
        entry: entry('a', 'ready'),
        fileExists: true,
        fileBytes: 0,
        hasSavable: false,
      }).type
    ).toBe('drop');
  });

  it('updates ready bytes when filesystem size differs', () => {
    const action = reconcileEntry({
      id: 'a',
      entry: entry('a', 'ready', { bytes: 10 }),
      fileExists: true,
      fileBytes: 42,
      hasSavable: false,
    });
    expect(action.type).toBe('update');
    if (action.type === 'update') {
      expect(action.entry.bytes).toBe(42);
    }
  });

  it('drops downloading/paused when partial file or savable is missing', () => {
    expect(
      reconcileEntry({
        id: 'a',
        entry: entry('a', 'downloading'),
        fileExists: false,
        fileBytes: 0,
        hasSavable: true,
      }).type
    ).toBe('drop');

    expect(
      reconcileEntry({
        id: 'a',
        entry: entry('a', 'paused'),
        fileExists: true,
        fileBytes: 5,
        hasSavable: false,
      }).type
    ).toBe('drop');
  });

  it('converts downloading + file + savable into paused', () => {
    const action = reconcileEntry({
      id: 'a',
      entry: entry('a', 'downloading', { progress: 0.4 }),
      fileExists: true,
      fileBytes: 5,
      hasSavable: true,
    });
    expect(action.type).toBe('update');
    if (action.type === 'update') {
      expect(action.entry.status).toBe('paused');
      expect(action.entry.progress).toBe(0.4);
    }
  });
});

describe('isRangeOrResumeFailure', () => {
  it('detects common range/resume failure messages', () => {
    expect(isRangeOrResumeFailure(new Error('HTTP 416'))).toBe(true);
    expect(
      isRangeOrResumeFailure(new Error('Requested Range Not Satisfiable'))
    ).toBe(true);
    expect(isRangeOrResumeFailure(new Error('network timeout'))).toBe(false);
  });
});

describe('isSuccessfulDownloadStatus', () => {
  it('accepts 200 and 206', () => {
    expect(isSuccessfulDownloadStatus(200)).toBe(true);
    expect(isSuccessfulDownloadStatus(206)).toBe(true);
    expect(isSuccessfulDownloadStatus(undefined)).toBe(true);
    expect(isSuccessfulDownloadStatus(416)).toBe(false);
    expect(isSuccessfulDownloadStatus(404)).toBe(false);
  });
});

describe('shouldPreferSimpleDownload', () => {
  it('only forces simple download when Accept-Ranges is none', () => {
    expect(shouldPreferSimpleDownload('none')).toBe(true);
    expect(shouldPreferSimpleDownload('bytes')).toBe(false);
    expect(shouldPreferSimpleDownload(null)).toBe(false);
  });
});

describe('assertSafeCacheId', () => {
  it('rejects path traversal and empty ids', () => {
    expect(() => assertSafeCacheId('../etc')).toThrow();
    expect(() => assertSafeCacheId('a/b')).toThrow();
    expect(() => assertSafeCacheId('')).toThrow();
    expect(assertSafeCacheId('episode-42')).toBe('episode-42');
  });
});

describe('stripSensitiveHeaders', () => {
  it('removes authorization and cookies', () => {
    expect(
      stripSensitiveHeaders({
        Authorization: 'Bearer secret',
        Cookie: 'a=1',
        'X-Request-Id': 'abc',
      })
    ).toEqual({ 'X-Request-Id': 'abc' });
  });
});
