export type CacheStatus =
  | 'idle'
  | 'downloading'
  | 'paused'
  | 'ready'
  | 'error';

export type AudioCacheConfig = {
  /** Folder name under documentDirectory. Default: `expo-audio-cache`. */
  directoryName?: string;
  /** Max total size of ready files before LRU eviction. Default: 500MB. */
  maxBytes?: number;
  /** Default HTTP headers for downloads. */
  headers?: Record<string, string>;
};

export type CacheEntry = {
  id: string;
  url: string;
  localUri: string;
  bytes: number;
  updatedAt: number;
  status: CacheStatus;
  errorMessage?: string;
  /** Progress 0–1 while downloading/paused. */
  progress?: number;
};

export type CachedAudio = {
  id: string;
  url: string;
  localUri: string;
  bytes: number;
};

export type CacheStats = {
  totalBytes: number;
  count: number;
};

export type DownloadOptions = {
  headers?: Record<string, string>;
};

export type ProgressListener = (id: string, progress: number) => void;

export type StatusListener = (entry: CacheEntry) => void;

/** Persisted state for resuming a download after app restart. */
export type SavableDownload = {
  url: string;
  fileUri: string;
  options: { headers?: Record<string, string> };
  resumeData?: string;
};

export type IndexFile = {
  version: 1;
  entries: Record<string, CacheEntry>;
  savable: Record<string, SavableDownload>;
};
