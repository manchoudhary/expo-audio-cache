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
    // Reset immediately when the id changes so we never show stale progress.
    setStatus('idle');
    setProgress(0);
    setLocalUri(null);
    setError(null);

    void getEntry(id)
      .then((entry) => {
        if (cancelled) {
          return;
        }
        if (!entry) {
          setStatus('idle');
          setProgress(0);
          setLocalUri(null);
          setError(null);
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
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('idle');
        }
      });

    const unsubStatus = addStatusListener((entry) => {
      if (cancelled || entry.id !== id) {
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
      if (cancelled || progressId !== id) {
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
