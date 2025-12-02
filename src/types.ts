/** Default block detection marker added to HTML */
export const SUCCESS_MARKER = '<!-- SUCCESS_MARKER -->';

export interface BlockDetectionConfig {
  /** Enable block detection via marker check */
  enabled: boolean;
  /** HTML marker to check for successful page load (from DNS TXT) */
  blockMarker?: string;
  /** Redirect URL if main domain is blocked (from DNS TXT) */
  redirectUrl?: string;
  /** DNS-over-HTTPS resolver URL */
  dnsResolverUrl: string;
  /** Domain for TXT record lookup. If not set, uses current location.hostname */
  dnsDomain?: string;
}

export interface LoadingScreenConfig {
  /** Enable loading screen */
  enabled: boolean;
  /** Background color */
  backgroundColor: string;
  /** Text color */
  textColor: string;
  /** Progress bar color */
  progressColor: string;
  /** Progress bar track color */
  progressTrackColor: string;
  /** Font family */
  fontFamily: string;
  /** Custom HTML to use instead of default loading screen */
  customHtml?: string;
}

export interface DownloadUIConfig {
  /** Position of download popup */
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** Background color */
  backgroundColor: string;
  /** Text color */
  textColor: string;
  /** Secondary text color */
  secondaryTextColor: string;
  /** Progress bar color */
  progressColor: string;
  /** Progress bar track color */
  progressTrackColor: string;
  /** Border radius in pixels */
  borderRadius: number;
  /** Use toast notifications instead of inline UI */
  useToast: boolean;
}

export interface I18nConfig {
  /** Enable i18n support */
  enabled: boolean;
  /** Translation keys */
  keys: {
    loading: string;
    downloading: string;
    complete: string;
    error: string;
    cancelled: string;
  };
}

export interface ChunkedConfig {
  /** Chunk size in KB */
  chunkSize: number;
  /** Concurrent chunk downloads */
  concurrency: number;
  /** File extensions to chunk */
  chunkable: string[];
  /** File extensions that trigger download manager */
  downloadable: string[];
  /** Enable debug logging */
  debug: boolean;
  /** Block detection configuration */
  blockDetection: BlockDetectionConfig;
  /** Loading screen configuration */
  loadingScreen: LoadingScreenConfig;
  /** Download UI configuration */
  downloadUI: DownloadUIConfig;
  /** i18n configuration */
  i18n: I18nConfig;
}

export interface ChunkMeta {
  /** Total number of chunks */
  totalChunks: number;
  /** Original file name */
  fileName: string;
  /** Original file size in bytes */
  fileSize: number;
  /** MIME type of the file */
  mimeType: string;
}

export interface ChunkedAsset {
  /** Original path relative to build output */
  originalPath: string;
  /** Chunked directory path */
  chunkedPath: string;
  /** Asset type: 'css' | 'js' | 'other' */
  type: 'css' | 'js' | 'other';
  /** Original file size */
  size: number;
  /** Number of chunks */
  chunks: number;
}

export interface ChunkedManifest {
  /** Build version/timestamp */
  version: string;
  /** List of chunked assets */
  assets: ChunkedAsset[];
  /** Configuration used for build */
  config: Partial<ChunkedConfig>;
}

export const DEFAULT_CONFIG: ChunkedConfig = {
  chunkSize: 15,
  concurrency: 6,
  chunkable: [
    '.js', '.css', '.json',
    '.ico', '.webp', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.bmp',
    '.mp3', '.mp4', '.webm',
    '.zip', '.7z', '.rar', '.exe'
  ],
  downloadable: ['.zip', '.7z', '.rar', '.exe'],
  debug: false,
  blockDetection: {
    enabled: false,
    dnsResolverUrl: 'https://dns.google.com/resolve?type=TXT&name='
  },
  loadingScreen: {
    enabled: true,
    backgroundColor: '#0e0f11',
    textColor: '#ffffff',
    progressColor: '#ffbe45',
    progressTrackColor: '#333333',
    fontFamily: 'system-ui, sans-serif'
  },
  downloadUI: {
    position: 'bottom-right',
    backgroundColor: '#1a1a2e',
    textColor: '#ffffff',
    secondaryTextColor: '#888888',
    progressColor: '#ffbe45',
    progressTrackColor: '#333333',
    borderRadius: 8,
    useToast: true
  },
  i18n: {
    enabled: false,
    keys: {
      loading: 'chunked.loading',
      downloading: 'chunked.downloading',
      complete: 'chunked.complete',
      error: 'chunked.error',
      cancelled: 'chunked.cancelled'
    }
  }
};

export const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.exe': 'application/octet-stream',
  '.txt': 'text/plain',
  '.xml': 'application/xml'
};
