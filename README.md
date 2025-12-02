# @anzohost/vite-plugin-chunked

Vite plugin for chunked asset delivery with Service Worker. Splits large files into small chunks that bypass DPI/throttling and assembles them client-side.

## Installation

```bash
npm install @anzohost/vite-plugin-chunked
```

## Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "build:chunked": "vite build -- --chunked",
    "preview:chunked": "npm run build:chunked && cross-env CHUNKED=true vite preview"
  }
}
```

For multiple environments:

```json
{
  "scripts": {
    "build:prod:chunked": "vite build --mode production -- --chunked",
    "preview:prod:chunked": "npm run build:prod:chunked && cross-env CHUNKED=true vite preview --mode production"
  }
}
```

## Usage

```ts
// vite.config.ts
import { chunkedPlugin } from '@anzohost/vite-plugin-chunked';

export default defineConfig({
  plugins: [
    chunkedPlugin({
      chunkSize: 15,           // KB per chunk
      concurrency: 6,          // parallel downloads
      debug: false,
      
      // Block detection - redirects to mirror if site is blocked
      blockDetection: {
        enabled: true,
        // dnsDomain: 'example.com'  // optional, defaults to current hostname
      }
    })
  ]
});
```

## Block Detection

Service Worker checks for block marker in index.html on every page load. If missing (ISP replaced content), redirects to mirror.

**DNS Domain:**
- If `dnsDomain` is set in config — uses that domain
- Otherwise — uses current `location.hostname`

**DNS TXT Record Format**:
```json
[1, "<!-- SUCCESS_MARKER -->", "https://mirror.example.com"]
```
- `[0]` — enabled (1/0)
- `[1]` — block marker
- `[2]` — redirect URL

This allows updating block detection settings without redeploying.

## Download Manager

Intercepts navigation to large files (`.zip`, `.exe`, `.7z`, `.rar`) and downloads them via chunked assembly with progress UI. Uses `concurrency` setting for parallel chunk downloads.

**Auto-injected** — built-in vanilla JS toast, works without setup.

**Override with custom toast** — use `DownloadManager` component. When mounted, it takes full control of downloads and built-in toast is disabled:

```tsx
import { DownloadManager } from '@anzohost/vite-plugin-chunked/client';
import { toast } from 'react-toastify';

<DownloadManager toast={{ success: toast.success, error: toast.error, info: toast.info }}>
  <App />
</DownloadManager>
```

## Output Structure

```
dist/
├── index.html           # Modified to load via SW
├── chunked-loader.js    # Registers SW, loads assets
├── chunked-sw.js        # Assembles chunks, block detection
├── chunked-assets.json  # Manifest
└── _chunks/
    └── assets_main.js/
        ├── meta.json    # Chunk count, mime type
        ├── part_0.zst   # Zstandard compressed
        └── part_1.zst
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `chunkSize` | 15 | KB per chunk |
| `concurrency` | 6 | Parallel chunk downloads |
| `chunkable` | `.js .css .json .webp .jpg .png .gif .ico .mp3 .zip .exe .7z .rar` | Extensions to chunk |
| `downloadable` | `.zip .7z .rar .exe` | Trigger download UI |
| `debug` | false | Console logs |
| `blockDetection.enabled` | false | Enable marker check |
| `blockDetection.dnsDomain` | `location.hostname` | Domain for TXT lookup |

## License

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — free for non-commercial use, attribution required. Commercial use requires permission.
