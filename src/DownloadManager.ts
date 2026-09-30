import { FileSystem } from './fs';
import type { DownloadProgressData, DownloadResumable } from './fs';

import type { CacheStore } from './CacheStore';
import type {
  DownloadOptions,
  ProgressListener,
  SavableDownload,
} from './types';

type ActiveTask = {
  resumable: DownloadResumable;
  url: string;
  fileUri: string;
  options: DownloadOptions;
};

export class DownloadManager {
  private store: CacheStore;
  private defaultHeaders: Record<string, string>;
  private active = new Map<string, ActiveTask>();
  private progressListeners = new Set<ProgressListener>();

  constructor(store: CacheStore, defaultHeaders: Record<string, string> = {}) {
    this.store = store;
    this.defaultHeaders = defaultHeaders;
  }

  setDefaultHeaders(headers: Record<string, string>): void {
    this.defaultHeaders = headers;
  }

  addProgressListener(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  private emitProgress(id: string, progress: number): void {
    for (const listener of this.progressListeners) {
      listener(id, progress);
    }
  }

  private mergeHeaders(options?: DownloadOptions): Record<string, string> {
    return {
      ...this.defaultHeaders,
      ...(options?.headers ?? {}),
    };
  }

  async start(
    id: string,
    url: string,
    fileUri: string,
    options?: DownloadOptions
  ): Promise<{ localUri: string; bytes: number }> {
    await this.store.ensureReady();

    if (this.active.get(id)) {
      throw new Error(`expo-audio-cache: download already in progress for id "${id}"`);
    }

    const headers = this.mergeHeaders(options);
    const downloadOptions = { headers };

    const resumable = FileSystem.createDownloadResumable(
      url,
      fileUri,
      downloadOptions,
      (progress: DownloadProgressData) => {
        const total = progress.totalBytesExpectedToWrite;
        const written = progress.totalBytesWritten;
        const ratio = total > 0 ? Math.min(written / total, 1) : 0;
        this.emitProgress(id, ratio);
      }
    );

    this.active.set(id, { resumable, url, fileUri, options: downloadOptions });
    await this.persistSavable(id);

    try {
      const result = await resumable.downloadAsync();
      this.active.delete(id);
      await this.store.setSavable(id, null);

      if (!result?.uri) {
        throw new Error('expo-audio-cache: download finished without a file URI');
      }

      const info = await FileSystem.getInfoAsync(result.uri);
      const bytes = info.exists && 'size' in info ? (info.size ?? 0) : 0;
      this.emitProgress(id, 1);
      return { localUri: result.uri, bytes };
    } catch (error) {
      this.active.delete(id);
      await this.persistSavable(id).catch(() => undefined);
      throw error;
    }
  }

  async pause(id: string): Promise<void> {
    const task = this.active.get(id);
    if (!task) {
      return;
    }
    await task.resumable.pauseAsync();
    await this.persistSavable(id);
  }

  async resume(
    id: string,
    options?: DownloadOptions
  ): Promise<{ localUri: string; bytes: number }> {
    await this.store.ensureReady();

    if (this.active.has(id)) {
      throw new Error(`expo-audio-cache: download already in progress for id "${id}"`);
    }

    const saved = this.store.getSavable(id);
    if (!saved) {
      throw new Error(`expo-audio-cache: no paused download to resume for id "${id}"`);
    }

    const headers = this.mergeHeaders({
      headers: {
        ...saved.options.headers,
        ...options?.headers,
      },
    });
    const downloadOptions = { headers };

    const resumable = FileSystem.createDownloadResumable(
      saved.url,
      saved.fileUri,
      downloadOptions,
      (progress: DownloadProgressData) => {
        const total = progress.totalBytesExpectedToWrite;
        const written = progress.totalBytesWritten;
        const ratio = total > 0 ? Math.min(written / total, 1) : 0;
        this.emitProgress(id, ratio);
      },
      saved.resumeData
    );

    this.active.set(id, {
      resumable,
      url: saved.url,
      fileUri: saved.fileUri,
      options: downloadOptions,
    });
    await this.persistSavable(id);

    try {
      const result = await resumable.resumeAsync();
      this.active.delete(id);
      await this.store.setSavable(id, null);

      if (!result?.uri) {
        throw new Error('expo-audio-cache: resume finished without a file URI');
      }

      const info = await FileSystem.getInfoAsync(result.uri);
      const bytes = info.exists && 'size' in info ? (info.size ?? 0) : 0;
      this.emitProgress(id, 1);
      return { localUri: result.uri, bytes };
    } catch (error) {
      this.active.delete(id);
      await this.persistSavable(id).catch(() => undefined);
      throw error;
    }
  }

  async cancel(id: string): Promise<void> {
    const task = this.active.get(id);
    if (task) {
      try {
        await task.resumable.pauseAsync();
      } catch {
        // ignore
      }
      this.active.delete(id);
    }

    const saved = this.store.getSavable(id);
    const fileUri = task?.fileUri ?? saved?.fileUri;
    await this.store.setSavable(id, null);

    if (fileUri) {
      try {
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
      } catch {
        // ignore
      }
    }
  }

  private async persistSavable(id: string): Promise<void> {
    const task = this.active.get(id);
    if (!task) {
      return;
    }
    const snapshot = task.resumable.savable();
    await this.store.setSavable(id, {
      url: snapshot.url,
      fileUri: snapshot.fileUri,
      options: snapshot.options ?? task.options,
      resumeData: snapshot.resumeData,
    } satisfies SavableDownload);
  }
}
