import { FileSystem } from './fs';
import { reconcileEntry } from './reconcile';

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

  constructor(directoryName: string = DEFAULT_DIRECTORY_NAME) {
    this.directoryName = directoryName;
  }

  setDirectoryName(directoryName: string): void {
    this.directoryName = directoryName;
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

  getFileUri(id: string, url: string): string {
    const ext = extensionFromUrl(url);
    const safeId = sanitizeId(id);
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

    const indexInfo = await FileSystem.getInfoAsync(this.getIndexUri());
    if (indexInfo.exists) {
      try {
        const raw = await FileSystem.readAsStringAsync(this.getIndexUri());
        const parsed = JSON.parse(raw) as IndexFile;
        if (parsed?.version === INDEX_VERSION && parsed.entries && parsed.savable) {
          this.index = parsed;
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
      const exists = await pathExists(entry.localUri);
      const action = reconcileEntry({
        id,
        entry,
        fileExists: exists,
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
      this.index.savable[id] = savable;
    } else {
      delete this.index.savable[id];
    }
    await this.persist();
  }

  async persist(): Promise<void> {
    await FileSystem.writeAsStringAsync(
      this.getIndexUri(),
      JSON.stringify(this.index)
    );
  }
}

export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-_]/g, '_');
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

async function pathExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists;
  } catch {
    return false;
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
