import React, { useEffect, useCallback, useState, createContext, useContext } from 'react';
import { downloadChunkedFile, type DownloadProgress } from './download-utils';

declare const window: Window & { 
  __CHUNKED_CONFIG__?: ChunkedClientConfig;
  __chunkedRegisterDownloadHandler?: (handler: (path: string, fileName: string) => void) => void;
};

interface ChunkedClientConfig {
  downloadUI?: {
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    backgroundColor?: string;
    textColor?: string;
    secondaryTextColor?: string;
    progressColor?: string;
    progressTrackColor?: string;
    borderRadius?: number;
    useToast?: boolean;
  };
  i18n?: {
    enabled?: boolean;
    keys?: {
      downloading?: string;
      complete?: string;
      error?: string;
      cancelled?: string;
    };
  };
}

const defaultUIConfig = {
  position: 'bottom-right' as const,
  backgroundColor: '#1a1a2e',
  textColor: '#ffffff',
  secondaryTextColor: '#888888',
  progressColor: '#ffbe45',
  progressTrackColor: '#333333',
  borderRadius: 8,
  useToast: true
};

type TranslateFunction = (key: string, params?: Record<string, string | number>) => string;
const I18nContext = createContext<TranslateFunction | null>(null);

export const ChunkedI18nProvider = I18nContext.Provider;

export interface DownloadManagerProps {
  /** File extensions to intercept (default: .zip, .exe, .7z, .rar) */
  extensions?: string[];
  /** Custom render for download progress */
  renderProgress?: (progress: DownloadProgress, onCancel: () => void) => React.ReactNode;
  /** Called when download starts */
  onDownloadStart?: (fileName: string) => void;
  /** Called when download completes */
  onDownloadComplete?: (fileName: string) => void;
  /** Called when download fails */
  onDownloadError?: (fileName: string, error: string) => void;
  /** Children to wrap */
  children?: React.ReactNode;
  /** Theme overrides for download UI */
  theme?: Partial<typeof defaultUIConfig>;
  /** Toast notification handlers */
  toast?: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
  };
}

const DEFAULT_EXTENSIONS = ['.zip', '.exe', '.7z', '.rar'];

/**
 * Global download manager component that intercepts download links
 * and shows progress for chunked file downloads
 */
export function DownloadManager({
  extensions = DEFAULT_EXTENSIONS,
  renderProgress,
  onDownloadStart,
  onDownloadComplete,
  onDownloadError,
  children,
  theme,
  toast
}: DownloadManagerProps) {
  const [activeDownload, setActiveDownload] = useState<DownloadProgress | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const t = useContext(I18nContext);
  
  const clientConfig = typeof window !== 'undefined' ? window.__CHUNKED_CONFIG__ : undefined;
  const uiConfig = { ...defaultUIConfig, ...clientConfig?.downloadUI, ...theme };

  const isDownloadable = useCallback((href: string) => {
    const url = href.toLowerCase();
    return extensions.some(ext => url.endsWith(ext));
  }, [extensions]);

  const handleDownload = useCallback(async (href: string) => {
    const controller = new AbortController();
    setAbortController(controller);
    
    const fileName = href.split('/').pop() || 'download';
    onDownloadStart?.(fileName);
    
    if (toast && uiConfig.useToast) {
      toast.info(t ? t('chunked.downloading', { fileName }) : `Downloading ${fileName}...`);
    }
    
    try {
      await downloadChunkedFile(href, (progress) => {
        if (controller.signal.aborted) {
          throw new Error('Cancelled');
        }
        setActiveDownload(progress);
      });
      
      onDownloadComplete?.(fileName);
      if (toast && uiConfig.useToast) {
        toast.success(t ? t('chunked.complete', { fileName }) : `${fileName} downloaded`);
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      if (error !== 'Cancelled') {
        onDownloadError?.(fileName, error);
        if (toast && uiConfig.useToast) {
          toast.error(t ? t('chunked.error', { fileName, error }) : `Failed to download ${fileName}`);
        }
      }
    } finally {
      setActiveDownload(null);
      setAbortController(null);
    }
  }, [onDownloadStart, onDownloadComplete, onDownloadError, toast, uiConfig.useToast, t]);

  const handleCancel = useCallback(() => {
    abortController?.abort();
  }, [abortController]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest('a');
      
      if (!anchor) return;
      
      const href = anchor.getAttribute('href');
      if (!href) return;
      
      if (!isDownloadable(href)) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      handleDownload(href);
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [isDownloadable, handleDownload]);

  useEffect(() => {
    const path = window.location.pathname;
    if (isDownloadable(path)) {
      handleDownload(path);
    }
  }, [isDownloadable, handleDownload]);

  // Register handler to override built-in vanilla toast
  useEffect(() => {
    if (window.__chunkedRegisterDownloadHandler) {
      window.__chunkedRegisterDownloadHandler((path, fileName) => {
        handleDownload(path);
      });
    }
  }, [handleDownload]);

  return (
    <>
      {children}
      {activeDownload && (
        renderProgress ? (
          renderProgress(activeDownload, handleCancel)
        ) : (
          <DefaultProgressUI progress={activeDownload} onCancel={handleCancel} theme={uiConfig} />
        )
      )}
    </>
  );
}

type UIConfig = {
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  backgroundColor: string;
  textColor: string;
  secondaryTextColor: string;
  progressColor: string;
  progressTrackColor: string;
  borderRadius: number;
  useToast: boolean;
};

function DefaultProgressUI({ 
  progress, 
  onCancel,
  theme
}: { 
  progress: DownloadProgress; 
  onCancel: () => void;
  theme: UIConfig;
}) {
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatSpeed = (bytesPerSec: number) => {
    if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + ' B/s';
    if (bytesPerSec < 1024 * 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
    return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
  };

  const formatEta = (seconds: number) => {
    if (seconds < 60) return Math.round(seconds) + 's';
    if (seconds < 3600) return Math.round(seconds / 60) + 'm';
    return Math.round(seconds / 3600) + 'h';
  };

  const positionStyles: Record<string, React.CSSProperties> = {
    'bottom-right': { bottom: 20, right: 20 },
    'bottom-left': { bottom: 20, left: 20 },
    'top-right': { top: 20, right: 20 },
    'top-left': { top: 20, left: 20 }
  };

  return (
    <div style={{
      position: 'fixed',
      ...positionStyles[theme.position],
      background: theme.backgroundColor,
      color: theme.textColor,
      padding: 16,
      borderRadius: theme.borderRadius,
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      minWidth: 300,
      fontFamily: 'system-ui, sans-serif',
      zIndex: 10000
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
          {progress.fileName}
        </span>
        <button 
          onClick={onCancel}
          style={{
            background: 'none',
            border: 'none',
            color: theme.secondaryTextColor,
            cursor: 'pointer',
            padding: 0,
            fontSize: 18
          }}
        >
          ✕
        </button>
      </div>
      
      <div style={{
        height: 6,
        background: theme.progressTrackColor,
        borderRadius: 3,
        overflow: 'hidden',
        marginBottom: 8
      }}>
        <div style={{
          width: `${progress.percentage}%`,
          height: '100%',
          background: theme.progressColor,
          transition: 'width 0.2s'
        }} />
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: theme.secondaryTextColor }}>
        <span>{formatSize(progress.loaded)} / {formatSize(progress.total)}</span>
        <span>{formatSpeed(progress.speed)} • {formatEta(progress.eta)}</span>
      </div>
    </div>
  );
}

