import { useEffect, useState } from 'react';

import {
  addProgressListener,
  addStatusListener,
  getEntry,
} from './AudioCache';
import type { CacheStatus } from './types';

export type UseAudioCacheDownloadResult = {
  status: CacheStatus;
  progress: number;
  localUri: string | null;
  error: Error | null;
};

export function useAudioCacheDownload(id: string): UseAudioCacheDownloadResult {
  const [status, setStatus] = useState<CacheStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getEntry(id).then((entry) => {
      if (cancelled || !entry) {
        return;
      }
      setStatus(entry.status);
      setProgress(entry.progress ?? (entry.status === 'ready' ? 1 : 0));
      setLocalUri(entry.status === 'ready' ? entry.localUri : null);
      setError(
        entry.status === 'error' && entry.errorMessage
          ? new Error(entry.errorMessage)
          : null
      );
    });

    const unsubStatus = addStatusListener((entry) => {
      if (entry.id !== id) {
        return;
      }
      setStatus(entry.status);
      setProgress(entry.progress ?? (entry.status === 'ready' ? 1 : 0));
      setLocalUri(entry.status === 'ready' ? entry.localUri : null);
      setError(
        entry.status === 'error' && entry.errorMessage
          ? new Error(entry.errorMessage)
          : null
      );
    });

    const unsubProgress = addProgressListener((progressId, value) => {
      if (progressId !== id) {
        return;
      }
      setProgress(value);
    });

    return () => {
      cancelled = true;
      unsubStatus();
      unsubProgress();
    };
  }, [id]);

  return { status, progress, localUri, error };
}
