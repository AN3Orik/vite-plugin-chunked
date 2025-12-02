import * as fs from 'fs/promises';
import * as path from 'path';
import { 
  ChunkedConfig, 
  ChunkedManifest, 
  ChunkedAsset, 
  ChunkMeta,
  MIME_TYPES 
} from './types';

const PLACEHOLDER_FAVICON = Buffer.from(
  'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
  'base64'
);

/**
 * Chunks assets in the build directory
 */
export async function chunkAssets(
  buildDir: string,
  config: ChunkedConfig,
  version: string
): Promise<ChunkedManifest> {
  const chunkSizeBytes = config.chunkSize * 1024;
  const assets: ChunkedAsset[] = [];
  
  const files = await findFiles(buildDir, buildDir);
  
  for (const file of files) {
    const ext = path.extname(file.relativePath).toLowerCase();
    
    if (!config.chunkable.includes(ext)) continue;
    if (file.size <= chunkSizeBytes) continue;
    
    let type: 'css' | 'js' | 'other' = 'other';
    if (ext === '.css') type = 'css';
    else if (ext === '.js' || ext === '.mjs') type = 'js';
    
    const chunkedDirName = file.relativePath.replace(/\//g, '_').replace(/\\/g, '_');
    const chunkedDir = path.join(buildDir, '_chunks', chunkedDirName);
    await fs.mkdir(chunkedDir, { recursive: true });
    
    const content = await fs.readFile(file.absolutePath);
    const totalChunks = Math.ceil(content.length / chunkSizeBytes);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSizeBytes;
      const end = Math.min(start + chunkSizeBytes, content.length);
      const chunk = content.subarray(start, end);
      await fs.writeFile(path.join(chunkedDir, `part_${i}.zst`), chunk);
    }
    
    const meta: ChunkMeta = {
      totalChunks,
      fileName: path.basename(file.relativePath),
      fileSize: content.length,
      mimeType: MIME_TYPES[ext] || 'application/octet-stream'
    };
    await fs.writeFile(path.join(chunkedDir, 'meta.json'), JSON.stringify(meta));
    
    const fileName = path.basename(file.relativePath).toLowerCase();
    if (fileName === 'favicon.ico') {
      await fs.writeFile(file.absolutePath, PLACEHOLDER_FAVICON);
    } else {
      await fs.unlink(file.absolutePath);
    }
    
    assets.push({
      originalPath: file.relativePath,
      chunkedPath: `_chunks/${chunkedDirName}`,
      type,
      size: content.length,
      chunks: totalChunks
    });
    
    if (config.debug) {
      console.log(`   Chunked: ${file.relativePath} (${totalChunks} chunks)`);
    }
  }
  
  return {
    version,
    assets,
    config: {
      chunkSize: config.chunkSize,
      concurrency: config.concurrency
    }
  };
}

interface FileInfo {
  absolutePath: string;
  relativePath: string;
  size: number;
}

async function findFiles(dir: string, baseDir: string): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, absolutePath).replace(/\\/g, '/');
    
    if (entry.isDirectory()) {
      if (entry.name === '_chunks') continue;
      files.push(...await findFiles(absolutePath, baseDir));
    } else {
      const stat = await fs.stat(absolutePath);
      files.push({ absolutePath, relativePath, size: stat.size });
    }
  }
  
  return files;
}
