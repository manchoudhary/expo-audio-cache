/**
 * Resolve expo-file-system APIs across Expo SDK versions.
 * SDK 54+ exposes resumable downloads under `expo-file-system/legacy`.
 * Older SDKs expose them on the package root.
 */

export type DownloadProgressData = {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
};

export type DownloadProgressCallback = (data: DownloadProgressData) => void;

export type DownloadResult = {
  uri: string;
  status?: number;
  headers?: Record<string, string>;
  mimeType?: string | null;
};

export type DownloadResumableSnapshot = {
  url: string;
  fileUri: string;
  options: { headers?: Record<string, string> };
  resumeData?: string;
};

export type DownloadResumable = {
  downloadAsync: () => Promise<DownloadResult | undefined>;
  pauseAsync: () => Promise<void>;
  resumeAsync: () => Promise<DownloadResult | undefined>;
  savable: () => DownloadResumableSnapshot;
};

export type FileInfo =
  | { exists: false; uri: string; isDirectory?: false }
  | {
      exists: true;
      uri: string;
      size?: number;
      isDirectory?: boolean;
      modificationTime?: number;
    };

export type ExpoFileSystemModule = {
  documentDirectory: string | null;
  EncodingType: { UTF8: string; Base64: string };
  makeDirectoryAsync: (
    fileUri: string,
    options?: { intermediates?: boolean }
  ) => Promise<void>;
  getInfoAsync: (
    fileUri: string,
    options?: { size?: boolean; md5?: boolean }
  ) => Promise<FileInfo>;
  readAsStringAsync: (
    fileUri: string,
    options?: { encoding?: string }
  ) => Promise<string>;
  writeAsStringAsync: (
    fileUri: string,
    contents: string,
    options?: { encoding?: string }
  ) => Promise<void>;
  deleteAsync: (
    fileUri: string,
    options?: { idempotent?: boolean }
  ) => Promise<void>;
  createDownloadResumable: (
    uri: string,
    fileUri: string,
    options?: { headers?: Record<string, string> },
    callback?: DownloadProgressCallback,
    resumeData?: string
  ) => DownloadResumable;
};

declare const require: (name: string) => ExpoFileSystemModule;

function loadFileSystem(): ExpoFileSystemModule {
  try {
    return require('expo-file-system/legacy');
  } catch {
    return require('expo-file-system');
  }
}

export const FileSystem: ExpoFileSystemModule = loadFileSystem();
