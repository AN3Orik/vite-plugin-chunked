import { useState, useCallback } from 'react';
import { downloadChunkedFile, type DownloadProgress } from './download-utils';

export type { DownloadProgress };

export interface UseChunkedDownloadResult {
  /** Current download progress */
  progress: DownloadProgress | null;
  /** Is download in progress */
  isDownloading: boolean;
  /** Start downloading a file */
  download: (path: string) => Promise<void>;
  /** Cancel current download */
  cancel: () => void;
  /** Last error */
  error: string | null;
}

/**
 * Hook for managing chunked file downloads
 */
export function useChunkedDownload(): UseChunkedDownloadResult {
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const download = useCallback(async (path: string) => {
    if (isDownloading) return;
    
    setIsDownloading(true);
    setError(null);
    setProgress(null);
    
    const controller = new AbortController();
    setAbortController(controller);
    
    try {
      await downloadChunkedFile(path, (p) => {
        if (controller.signal.aborted) {
          throw new Error('Download cancelled');
        }
        setProgress(p);
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Download failed';
      setError(errorMessage);
      setProgress(prev => prev ? { ...prev, error: errorMessage } : null);
    } finally {
      setIsDownloading(false);
      setAbortController(null);
    }
  }, [isDownloading]);

  const cancel = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setError('Download cancelled');
      setIsDownloading(false);
    }
  }, [abortController]);

  return {
    progress,
    isDownloading,
    download,
    cancel,
    error
  };
}
