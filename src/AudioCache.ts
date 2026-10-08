import { FileSystem } from './fs';

import { CacheStore } from './CacheStore';
import { DownloadManager } from './DownloadManager';
import { pickLruVictims, sumReadyBytes } from './eviction';
import { assertSafeCacheId } from './reconcile';
import type {
  AudioCacheConfig,
  CacheEntry,
  CacheStats,
  CachedAudio,
  DownloadOptions,
  ProgressListener,
  StatusListener,
} from './types';

const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;

class AudioCacheController {
  private store = new CacheStore();
  private downloads = new DownloadManager(this.store);
  private maxBytes = DEFAULT_MAX_BYTES;
  private configured = false;
  private statusListeners = new Set<StatusListener>();
  /** Coalesce concurrent download(id) calls into one promise. */
  private inflightDownloads = new Map<string, Promise<CachedAudio>>();
  /** Serialize mutating ops so LRU / index writes stay consistent. */
  private opChain: Promise<unknown> = Promise.resolve();

  configure(config: AudioCacheConfig = {}): void {
    if (config.directoryName) {
      this.store.setDirectoryName(config.directoryName);
    }
    if (typeof config.maxBytes === 'number' && config.maxBytes > 0) {
      this.maxBytes = config.maxBytes;
    }
    if (config.headers) {
      this.downloads.setDefaultHeaders(config.headers);
    }
    if (typeof config.downloadTimeoutMs === 'number' && config.downloadTimeoutMs > 0) {
      this.downloads.setDownloadTimeoutMs(config.downloadTimeoutMs);
    }
    this.configured = true;
  }

  private ensureConfigured(): void {
    if (!this.configured) {
      this.configure();
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(fn, fn);
    this.opChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  addStatusListener(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  addProgressListener(listener: ProgressListener): () => void {
    return this.downloads.addProgressListener(listener);
  }

  private async emit(entry: CacheEntry): Promise<void> {
    await this.store.upsertEntry(entry);
    for (const listener of this.statusListeners) {
      listener(entry);
    }
  }

  async download(
    id: string,
    url: string,
    options?: DownloadOptions
  ): Promise<CachedAudio> {
    assertSafeCacheId(id);
    const existingInflight = this.inflightDownloads.get(id);
    if (existingInflight) {
      return existingInflight;
    }

    const promise = this.enqueue(() => this.downloadExclusive(id, url, options));
    this.inflightDownloads.set(id, promise);
    try {
      return await promise;
    } finally {
      this.inflightDownloads.delete(id);
    }
  }

  private async downloadExclusive(
    id: string,
    url: string,
    options?: DownloadOptions
  ): Promise<CachedAudio> {
    this.ensureConfigured();
    await this.store.ensureReady();

    const existing = this.store.getEntry(id);

    // Same id, different URL → invalidate stale cache.
    if (existing && existing.url !== url) {
      await this.downloads.cancel(id);
      await this.store.removeEntry(id);
    } else if (existing?.status === 'ready') {
      const stillThere = await fileExists(existing.localUri);
      if (stillThere) {
        const info = await FileSystem.getInfoAsync(existing.localUri);
        const bytes =
          info.exists && 'size' in info ? (info.size ?? existing.bytes) : existing.bytes;
        const touched: CacheEntry = {
          ...existing,
          bytes,
          updatedAt: Date.now(),
          progress: 1,
        };
        await this.emit(touched);
        return toCachedAudio(touched);
      }
      await this.store.removeEntry(id);
    } else if (
      existing &&
      (existing.status === 'downloading' || existing.status === 'paused') &&
      this.downloads.isActive(id)
    ) {
      throw new Error(`expo-audio-cache: download already in progress for id "${id}"`);
    }

    const fileUri = this.store.getFileUri(id, url);
    const downloading: CacheEntry = {
      id,
      url,
      localUri: fileUri,
      bytes: 0,
      updatedAt: Date.now(),
      status: 'downloading',
      progress: 0,
    };
    await this.emit(downloading);

    const unsubProgress = this.downloads.addProgressListener((progressId, progress) => {
      if (progressId !== id) {
        return;
      }
      const current = this.store.getEntry(id);
      if (!current || current.status !== 'downloading') {
        return;
      }
      const next = { ...current, progress, updatedAt: Date.now() };
      this.store.patchEntry(next);
      for (const listener of this.statusListeners) {
        listener(next);
      }
    });

    try {
      const result = await this.downloads.start(id, url, fileUri, options);
      const ready: CacheEntry = {
        id,
        url,
        localUri: result.localUri,
        bytes: result.bytes,
        updatedAt: Date.now(),
        status: 'ready',
        progress: 1,
      };
      await this.emit(ready);
      await this.evictIfNeeded();
      return toCachedAudio(ready);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Never leave the entry stuck in downloading.
      const failed: CacheEntry = {
        id,
        url,
        localUri: fileUri,
        bytes: 0,
        updatedAt: Date.now(),
        status: 'error',
        errorMessage: message,
        progress: this.store.getEntry(id)?.progress ?? 0,
      };
      await this.emit(failed);
      throw error;
    } finally {
      unsubProgress();
    }
  }

  async pause(id: string): Promise<void> {
    assertSafeCacheId(id);
    return this.enqueue(async () => {
      this.ensureConfigured();
      await this.downloads.pause(id);
      const current = this.store.getEntry(id);
      if (!current) {
        return;
      }
      await this.emit({
        ...current,
        status: 'paused',
        updatedAt: Date.now(),
      });
    });
  }

  async resume(id: string, options?: DownloadOptions): Promise<CachedAudio> {
    assertSafeCacheId(id);
    const existingInflight = this.inflightDownloads.get(id);
    if (existingInflight) {
      return existingInflight;
    }

    const promise = this.enqueue(() => this.resumeExclusive(id, options));
    this.inflightDownloads.set(id, promise);
    try {
      return await promise;
    } finally {
      this.inflightDownloads.delete(id);
    }
  }

  private async resumeExclusive(
    id: string,
    options?: DownloadOptions
  ): Promise<CachedAudio> {
    this.ensureConfigured();
    await this.store.ensureReady();

    const current = this.store.getEntry(id);
    if (!current) {
      throw new Error(`expo-audio-cache: unknown id "${id}"`);
    }

    await this.emit({
      ...current,
      status: 'downloading',
      updatedAt: Date.now(),
    });

    const unsubProgress = this.downloads.addProgressListener((progressId, progress) => {
      if (progressId !== id) {
        return;
      }
      const entry = this.store.getEntry(id);
      if (!entry || entry.status !== 'downloading') {
        return;
      }
      const next = { ...entry, progress, updatedAt: Date.now() };
      this.store.patchEntry(next);
      for (const listener of this.statusListeners) {
        listener(next);
      }
    });

    try {
      const result = await this.downloads.resume(id, options);
      const ready: CacheEntry = {
        ...current,
        localUri: result.localUri,
        bytes: result.bytes,
        updatedAt: Date.now(),
        status: 'ready',
        progress: 1,
        errorMessage: undefined,
      };
      await this.emit(ready);
      await this.evictIfNeeded();
      return toCachedAudio(ready);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.emit({
        ...current,
        status: 'error',
        errorMessage: message,
        updatedAt: Date.now(),
      });
      throw error;
    } finally {
      unsubProgress();
    }
  }

  async cancel(id: string): Promise<void> {
    assertSafeCacheId(id);
    return this.enqueue(async () => {
      this.ensureConfigured();
      await this.downloads.cancel(id);
      await this.store.removeEntry(id);
    });
  }

  async remove(id: string): Promise<void> {
    assertSafeCacheId(id);
    return this.enqueue(async () => {
      this.ensureConfigured();
      await this.downloads.cancel(id);
      await this.store.removeEntry(id);
    });
  }

  async clear(): Promise<void> {
    this.ensureConfigured();
    // Cancel outside the queue so a hung download can still be cleared.
    await this.downloads.cancelAll();
    return this.enqueue(async () => {
      await this.store.clearAll();
    });
  }

  async getLocalUri(id: string): Promise<string | null> {
    assertSafeCacheId(id);
    this.ensureConfigured();
    await this.store.ensureReady();
    const entry = this.store.getEntry(id);
    if (!entry || entry.status !== 'ready') {
      return null;
    }
    if (!(await fileExists(entry.localUri))) {
      await this.store.removeEntry(id);
      return null;
    }
    await this.emit({ ...entry, updatedAt: Date.now() });
    // expo-audio accepts the file:// URI returned by expo-file-system as-is.
    return entry.localUri;
  }

  async getEntry(id: string): Promise<CacheEntry | null> {
    assertSafeCacheId(id);
    this.ensureConfigured();
    await this.store.ensureReady();
    return this.store.getEntry(id);
  }

  async list(): Promise<CacheEntry[]> {
    this.ensureConfigured();
    await this.store.ensureReady();
    return this.store.listEntries();
  }

  async getStats(): Promise<CacheStats> {
    this.ensureConfigured();
    await this.store.ensureReady();
    await this.store.refreshReadyBytes();
    const entries = this.store.listEntries();
    return {
      totalBytes: sumReadyBytes(entries),
      count: entries.filter((e) => e.status === 'ready').length,
    };
  }

  async resolveSource(
    id: string,
    remoteUrl: string
  ): Promise<{ uri: string }> {
    assertSafeCacheId(id);
    const entry = await this.getEntry(id);
    if (entry && entry.url !== remoteUrl) {
      // URL changed — do not return stale local file.
      return { uri: remoteUrl };
    }
    const local = await this.getLocalUri(id);
    return { uri: local ?? remoteUrl };
  }

  private async evictIfNeeded(): Promise<void> {
    await this.store.refreshReadyBytes();
    const entries = this.store.listEntries();
    const total = sumReadyBytes(entries);
    const victims = pickLruVictims(entries, total, this.maxBytes);
    for (const victim of victims) {
      // Never evict an in-flight download.
      if (this.downloads.isActive(victim.id) || this.inflightDownloads.has(victim.id)) {
        continue;
      }
      await this.downloads.cancel(victim.id);
      await this.store.removeEntry(victim.id);
    }
  }
}

async function fileExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
  }
}

function toCachedAudio(entry: CacheEntry): CachedAudio {
  return {
    id: entry.id,
    url: entry.url,
    localUri: entry.localUri,
    bytes: entry.bytes,
  };
}

const controller = new AudioCacheController();

export function configureAudioCache(config?: AudioCacheConfig): void {
  controller.configure(config ?? {});
}

export function download(
  id: string,
  url: string,
  options?: DownloadOptions
): Promise<CachedAudio> {
  return controller.download(id, url, options);
}

export function pause(id: string): Promise<void> {
  return controller.pause(id);
}

export function resume(
  id: string,
  options?: DownloadOptions
): Promise<CachedAudio> {
  return controller.resume(id, options);
}

export function cancel(id: string): Promise<void> {
  return controller.cancel(id);
}

export function remove(id: string): Promise<void> {
  return controller.remove(id);
}

export function clear(): Promise<void> {
  return controller.clear();
}

export function getLocalUri(id: string): Promise<string | null> {
  return controller.getLocalUri(id);
}

export function getEntry(id: string): Promise<CacheEntry | null> {
  return controller.getEntry(id);
}

export function list(): Promise<CacheEntry[]> {
  return controller.list();
}

export function getStats(): Promise<CacheStats> {
  return controller.getStats();
}

export function resolveSource(
  id: string,
  remoteUrl: string
): Promise<{ uri: string }> {
  return controller.resolveSource(id, remoteUrl);
}

export function addStatusListener(listener: StatusListener): () => void {
  return controller.addStatusListener(listener);
}

export function addProgressListener(listener: ProgressListener): () => void {
  return controller.addProgressListener(listener);
}

/** @internal exported for tests */
export { AudioCacheController, pickLruVictims, sumReadyBytes };
