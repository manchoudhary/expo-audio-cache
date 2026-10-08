import { FileSystem } from './fs';
import {
  assertSafeCacheId,
  assertSafeDirectoryName,
  reconcileEntry,
} from './reconcile';

import type { CacheEntry, IndexFile, SavableDownload } from './types';

const INDEX_VERSION = 1 as const;
const DEFAULT_DIRECTORY_NAME = 'expo-audio-cache';

function emptyIndex(): IndexFile {
  return { version: INDEX_VERSION, entries: {}, savable: {} };
}

export class CacheStore {
  private directoryName: string;
  private ready: Promise<void> | null = null;
  private index: IndexFile = emptyIndex();
  /** Serialize index writes so concurrent upserts don't clobber each other. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(directoryName: string = DEFAULT_DIRECTORY_NAME) {
    this.directoryName = assertSafeDirectoryName(directoryName);
  }

  setDirectoryName(directoryName: string): void {
    this.directoryName = assertSafeDirectoryName(directoryName);
    this.ready = null;
  }

  getRootUri(): string {
    const base = FileSystem.documentDirectory;
    if (!base) {
      throw new Error(
        'expo-audio-cache: documentDirectory is unavailable. This package targets iOS/Android (not web).'
      );
    }
    return `${base}${this.directoryName}/`;
  }

  getIndexUri(): string {
    return `${this.getRootUri()}index.json`;
  }

  getIndexTmpUri(): string {
    return `${this.getRootUri()}index.json.tmp`;
  }

  getFileUri(id: string, url: string): string {
    const safeId = assertSafeCacheId(id);
    const ext = extensionFromUrl(url);
    return `${this.getRootUri()}files/${safeId}${ext}`;
  }

  async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.bootstrap();
    }
    await this.ready;
  }

  private async bootstrap(): Promise<void> {
    const root = this.getRootUri();
    const filesDir = `${root}files/`;
    await FileSystem.makeDirectoryAsync(filesDir, { intermediates: true });

    // Recover a previous atomic write if the process died mid-rename.
    await this.recoverTempIndex();

    const indexInfo = await FileSystem.getInfoAsync(this.getIndexUri());
    if (indexInfo.exists) {
      try {
        const raw = await FileSystem.readAsStringAsync(this.getIndexUri());
        const parsed = JSON.parse(raw) as IndexFile;
        if (parsed?.version === INDEX_VERSION && parsed.entries && parsed.savable) {
          this.index = parsed;
          // Drop any accidentally persisted secrets from older versions.
          this.stripPersistedSecrets();
          await this.reconcileWithFileSystem();
          return;
        }
      } catch {
        // Fall through and rewrite a fresh index.
      }
    }
    this.index = emptyIndex();
    await this.persist();
  }

  private stripPersistedSecrets(): void {
    for (const id of Object.keys(this.index.savable)) {
      const item = this.index.savable[id] as SavableDownload & {
        options?: { headers?: Record<string, string> };
      };
      if (item && 'options' in item) {
        const { options: _ignored, ...rest } = item;
        this.index.savable[id] = rest;
      }
    }
  }

  private async recoverTempIndex(): Promise<void> {
    const tmp = this.getIndexTmpUri();
    const finalUri = this.getIndexUri();
    try {
      const tmpInfo = await FileSystem.getInfoAsync(tmp);
      if (!tmpInfo.exists) {
        return;
      }
      const raw = await FileSystem.readAsStringAsync(tmp);
      JSON.parse(raw); // validate
      await FileSystem.deleteAsync(finalUri, { idempotent: true });
      await FileSystem.moveAsync({ from: tmp, to: finalUri });
    } catch {
      await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => undefined);
    }
  }

  /**
   * After a crash or swipe-away, align index.json with what is actually on disk
   * so IDs are never stuck forever in downloading/paused limbo.
   */
  private async reconcileWithFileSystem(): Promise<void> {
    let dirty = false;
    const ids = Object.keys(this.index.entries);

    for (const id of ids) {
      const entry = this.index.entries[id];
      if (!entry) {
        continue;
      }
      const info = await safeGetInfo(entry.localUri);
      const exists = info.exists;
      const fileBytes = exists && 'size' in info ? (info.size ?? 0) : 0;
      const action = reconcileEntry({
        id,
        entry,
        fileExists: exists,
        fileBytes,
        hasSavable: Boolean(this.index.savable[id]),
      });

      if (action.type === 'drop') {
        delete this.index.entries[id];
        delete this.index.savable[id];
        if (exists) {
          await deleteIfExists(entry.localUri);
        }
        dirty = true;
      } else if (action.type === 'update') {
        this.index.entries[id] = action.entry;
        dirty = true;
      }
    }

    for (const id of Object.keys(this.index.savable)) {
      if (!this.index.entries[id]) {
        const orphan = this.index.savable[id];
        delete this.index.savable[id];
        if (orphan?.fileUri) {
          await deleteIfExists(orphan.fileUri);
        }
        dirty = true;
      }
    }

    if (dirty) {
      await this.persist();
    }
  }

  getEntry(id: string): CacheEntry | null {
    return this.index.entries[id] ?? null;
  }

  /** Update entry in memory only (e.g. progress ticks). Call persist later. */
  patchEntry(entry: CacheEntry): void {
    this.index.entries[entry.id] = entry;
  }

  listEntries(): CacheEntry[] {
    return Object.values(this.index.entries);
  }

  async upsertEntry(entry: CacheEntry): Promise<void> {
    await this.ensureReady();
    this.index.entries[entry.id] = entry;
    await this.persist();
  }

  async removeEntry(id: string): Promise<void> {
    await this.ensureReady();
    const entry = this.index.entries[id];
    delete this.index.entries[id];
    delete this.index.savable[id];
    await this.persist();
    if (entry?.localUri) {
      await deleteIfExists(entry.localUri);
    }
  }

  async clearAll(): Promise<void> {
    await this.ensureReady();
    const root = this.getRootUri();
    await FileSystem.deleteAsync(root, { idempotent: true });
    this.index = emptyIndex();
    this.ready = null;
    await this.ensureReady();
  }

  getSavable(id: string): SavableDownload | null {
    return this.index.savable[id] ?? null;
  }

  async setSavable(id: string, savable: SavableDownload | null): Promise<void> {
    await this.ensureReady();
    if (savable) {
      // Never persist headers / tokens.
      this.index.savable[id] = {
        url: savable.url,
        fileUri: savable.fileUri,
        resumeData: savable.resumeData,
      };
    } else {
      delete this.index.savable[id];
    }
    await this.persist();
  }

  /** Atomic write: index.json.tmp → move → index.json */
  async persist(): Promise<void> {
    const run = async () => {
      const finalUri = this.getIndexUri();
      const tmpUri = this.getIndexTmpUri();
      const payload = JSON.stringify(this.index);
      await FileSystem.writeAsStringAsync(tmpUri, payload);
      await FileSystem.deleteAsync(finalUri, { idempotent: true });
      await FileSystem.moveAsync({ from: tmpUri, to: finalUri });
    };

    this.writeChain = this.writeChain.then(run, run);
    await this.writeChain;
  }

  /** Re-read file sizes from disk for ready entries (stats accuracy). */
  async refreshReadyBytes(): Promise<void> {
    await this.ensureReady();
    let dirty = false;
    for (const entry of Object.values(this.index.entries)) {
      if (entry.status !== 'ready') {
        continue;
      }
      const info = await safeGetInfo(entry.localUri);
      if (!info.exists) {
        delete this.index.entries[entry.id];
        delete this.index.savable[entry.id];
        dirty = true;
        continue;
      }
      const size = 'size' in info ? (info.size ?? 0) : 0;
      if (size !== entry.bytes) {
        this.index.entries[entry.id] = { ...entry, bytes: size };
        dirty = true;
      }
    }
    if (dirty) {
      await this.persist();
    }
  }
}

export function extensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/(\.[a-zA-Z0-9]{1,8})$/);
    if (match) {
      return match[1].toLowerCase();
    }
  } catch {
    // ignore invalid URL
  }
  return '.mp3';
}

async function safeGetInfo(uri: string) {
  try {
    return await FileSystem.getInfoAsync(uri);
  } catch {
    return { exists: false as const, uri };
  }
}

async function deleteIfExists(uri: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }
  } catch {
    // ignore
  }
}
