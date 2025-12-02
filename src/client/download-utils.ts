export interface DownloadProgress {
  /** File name being downloaded */
  fileName: string;
  /** Bytes downloaded */
  loaded: number;
  /** Total bytes */
  total: number;
  /** Percentage complete (0-100) */
  percentage: number;
  /** Download speed in bytes/sec */
  speed: number;
  /** Estimated time remaining in seconds */
  eta: number;
  /** Is download complete */
  complete: boolean;
  /** Error message if failed */
  error?: string;
}

interface ChunkMeta {
  totalChunks: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

declare const window: Window & { 
  __CHUNKED_VERSION__?: string;
  __CHUNKED_CONFIG__?: { concurrency?: number };
};

/**
 * Download a chunked file with progress reporting
 */
export async function downloadChunkedFile(
  assetPath: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  const version = window.__CHUNKED_VERSION__ || '';
  const config = window.__CHUNKED_CONFIG__ || { concurrency: 6 };
  const concurrency = config.concurrency || 6;
  
  const normalizedPath = assetPath.startsWith('/') ? assetPath.slice(1) : assetPath;
  
  const manifestResponse = await fetch(`/chunked-assets.json?v=${version}`);
  if (!manifestResponse.ok) {
    throw new Error('Failed to fetch chunked manifest');
  }
  
  const manifest = await manifestResponse.json();
  const asset = manifest.assets.find((a: any) => 
    a.originalPath === normalizedPath || 
    a.originalPath === '/' + normalizedPath
  );
  
  if (!asset) {
    await downloadDirect(normalizedPath, onProgress);
    return;
  }
  
  const metaResponse = await fetch(`/${asset.chunkedPath}/meta.json?v=${version}`);
  if (!metaResponse.ok) {
    throw new Error('Failed to fetch chunk metadata');
  }
  
  const meta: ChunkMeta = await metaResponse.json();
  
  const startTime = Date.now();
  let loaded = 0;
  
  const reportProgress = () => {
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = loaded / elapsed;
    const remaining = meta.fileSize - loaded;
    const eta = speed > 0 ? remaining / speed : 0;
    
    onProgress?.({
      fileName: meta.fileName,
      loaded,
      total: meta.fileSize,
      percentage: Math.round((loaded / meta.fileSize) * 100),
      speed,
      eta,
      complete: false
    });
  };
  
  const chunks: ArrayBuffer[] = new Array(meta.totalChunks);
  
  for (let i = 0; i < meta.totalChunks; i += concurrency) {
    const batch = [];
    
    for (let j = i; j < Math.min(i + concurrency, meta.totalChunks); j++) {
      batch.push(
        fetch(`/${asset.chunkedPath}/part_${j}.zst?v=${version}`)
          .then(async (response) => {
            if (!response.ok) {
              throw new Error(`Failed to fetch chunk ${j}`);
            }
            const buffer = await response.arrayBuffer();
            loaded += buffer.byteLength;
            reportProgress();
            return { index: j, buffer };
          })
      );
    }
    
    const results = await Promise.all(batch);
    for (const { index, buffer } of results) {
      chunks[index] = buffer;
    }
  }
  
  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  
  const blob = new Blob([combined], { type: meta.mimeType });
  triggerDownload(blob, meta.fileName);
  
  onProgress?.({
    fileName: meta.fileName,
    loaded: meta.fileSize,
    total: meta.fileSize,
    percentage: 100,
    speed: 0,
    eta: 0,
    complete: true
  });
}

async function downloadDirect(
  path: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  const response = await fetch('/' + path);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }
  
  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  const fileName = path.split('/').pop() || 'download';
  
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }
  
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const startTime = Date.now();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    chunks.push(value);
    loaded += value.length;
    
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = loaded / elapsed;
    const remaining = total - loaded;
    const eta = speed > 0 ? remaining / speed : 0;
    
    onProgress?.({
      fileName,
      loaded,
      total,
      percentage: total > 0 ? Math.round((loaded / total) * 100) : 0,
      speed,
      eta,
      complete: false
    });
  }
  
  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  
  const blob = new Blob([combined]);
  triggerDownload(blob, fileName);
  
  onProgress?.({
    fileName,
    loaded,
    total: loaded,
    percentage: 100,
    speed: 0,
    eta: 0,
    complete: true
  });
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
