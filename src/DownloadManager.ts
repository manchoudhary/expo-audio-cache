import { FileSystem } from './fs';
import type { DownloadProgressData, DownloadResumable, DownloadResult } from './fs';
import {
  isRangeOrResumeFailure,
  isSuccessfulDownloadStatus,
  shouldPreferSimpleDownload,
} from './reconcile';

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

  isActive(id: string): boolean {
    return this.active.has(id);
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

    const preferSimple = await this.serverPrefersSimpleDownload(url, headers);
    if (preferSimple) {
      return this.simpleDownload(id, url, fileUri, downloadOptions);
    }

    try {
      return await this.resumableDownload(id, url, fileUri, downloadOptions);
    } catch (error) {
      if (!isRangeOrResumeFailure(error)) {
        throw error;
      }
      await deleteQuiet(fileUri);
      await this.store.setSavable(id, null);
      return this.simpleDownload(id, url, fileUri, downloadOptions);
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

    // Auth headers come from live memory config / call options — never from disk.
    const headers = this.mergeHeaders(options);
    const downloadOptions = { headers };

    try {
      return await this.resumableResume(id, saved, downloadOptions);
    } catch (error) {
      if (!isRangeOrResumeFailure(error)) {
        throw error;
      }
      await deleteQuiet(saved.fileUri);
      await this.store.setSavable(id, null);
      return this.simpleDownload(id, saved.url, saved.fileUri, downloadOptions);
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
      await deleteQuiet(fileUri);
    }
  }

  private async resumableDownload(
    id: string,
    url: string,
    fileUri: string,
    downloadOptions: { headers?: Record<string, string> }
  ): Promise<{ localUri: string; bytes: number }> {
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

    this.active.set(id, { resumable, url, fileUri });
    await this.persistSavable(id);

    try {
      const result = await resumable.downloadAsync();
      this.active.delete(id);
      await this.store.setSavable(id, null);
      return this.validateAndStat(id, result, fileUri);
    } catch (error) {
      this.active.delete(id);
      await this.persistSavable(id).catch(() => undefined);
      throw error;
    }
  }

  private async resumableResume(
    id: string,
    saved: SavableDownload,
    downloadOptions: { headers?: Record<string, string> }
  ): Promise<{ localUri: string; bytes: number }> {
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
    });
    await this.persistSavable(id);

    try {
      const result = await resumable.resumeAsync();
      this.active.delete(id);
      await this.store.setSavable(id, null);
      return this.validateAndStat(id, result, saved.fileUri);
    } catch (error) {
      this.active.delete(id);
      await this.persistSavable(id).catch(() => undefined);
      throw error;
    }
  }

  private async simpleDownload(
    id: string,
    url: string,
    fileUri: string,
    downloadOptions: { headers?: Record<string, string> }
  ): Promise<{ localUri: string; bytes: number }> {
    await deleteQuiet(fileUri);
    await this.store.setSavable(id, null);
    this.emitProgress(id, 0);

    const result = await FileSystem.downloadAsync(url, fileUri, downloadOptions);
    return this.validateAndStat(id, result, fileUri);
  }

  private async validateAndStat(
    id: string,
    result: DownloadResult | undefined,
    expectedUri: string
  ): Promise<{ localUri: string; bytes: number }> {
    if (!result?.uri) {
      await deleteQuiet(expectedUri);
      throw new Error('expo-audio-cache: download finished without a file URI');
    }

    if (!isSuccessfulDownloadStatus(result.status)) {
      await deleteQuiet(result.uri);
      throw new Error(
        `expo-audio-cache: unexpected HTTP status ${result.status ?? 'unknown'}`
      );
    }

    // 416 should have been handled as range failure; belt-and-suspenders.
    if (result.status === 416) {
      await deleteQuiet(result.uri);
      throw new Error('expo-audio-cache: HTTP 416 Range Not Satisfiable');
    }

    const info = await FileSystem.getInfoAsync(result.uri);
    const bytes = info.exists && 'size' in info ? (info.size ?? 0) : 0;
    if (!info.exists || bytes <= 0) {
      await deleteQuiet(result.uri);
      throw new Error(
        'expo-audio-cache: download produced an empty or missing file (invalid audio response)'
      );
    }

    this.emitProgress(id, 1);
    return { localUri: result.uri, bytes };
  }

  private async serverPrefersSimpleDownload(
    url: string,
    headers: Record<string, string>
  ): Promise<boolean> {
    try {
      const response = await fetch(url, { method: 'HEAD', headers });
      if (!response.ok && response.status !== 405) {
        // Non-OK HEAD: still attempt download; downloadAsync will surface real errors.
        return false;
      }
      return shouldPreferSimpleDownload(response.headers.get('accept-ranges'));
    } catch {
      return false;
    }
  }

  private async persistSavable(id: string): Promise<void> {
    const task = this.active.get(id);
    if (!task) {
      return;
    }
    const snapshot = task.resumable.savable();
    // Intentionally omit snapshot.options.headers — never persist JWTs.
    await this.store.setSavable(id, {
      url: snapshot.url,
      fileUri: snapshot.fileUri,
      resumeData: snapshot.resumeData,
    } satisfies SavableDownload);
  }
}

async function deleteQuiet(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // ignore
  }
}
