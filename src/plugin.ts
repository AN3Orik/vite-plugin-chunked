import type { Plugin, ResolvedConfig } from 'vite';
import { minify } from 'terser';
import { 
  ChunkedConfig, 
  DEFAULT_CONFIG,
  SUCCESS_MARKER,
  type BlockDetectionConfig,
  type LoadingScreenConfig,
  type DownloadUIConfig,
  type I18nConfig
} from './types';
import { chunkAssets } from './chunker';
import { generateLoader } from './loader-generator';
import { generateServiceWorker } from './sw-generator';

export interface ChunkedPluginOptions {
  /** Chunk size in KB (default: 15) */
  chunkSize?: number;
  /** Concurrent chunk downloads (default: 6) */
  concurrency?: number;
  /** File extensions to chunk */
  chunkable?: string[];
  /** File extensions that trigger download manager */
  downloadable?: string[];
  /** Enable debug logging */
  debug?: boolean;
  /** Block detection configuration */
  blockDetection?: Partial<BlockDetectionConfig>;
  /** Loading screen configuration */
  loadingScreen?: Partial<LoadingScreenConfig>;
  /** Download UI configuration */
  downloadUI?: Partial<DownloadUIConfig>;
  /** i18n configuration */
  i18n?: Partial<I18nConfig>;
}

function mergeConfig(options: ChunkedPluginOptions): ChunkedConfig {
  return {
    ...DEFAULT_CONFIG,
    ...options,
    blockDetection: { ...DEFAULT_CONFIG.blockDetection, ...options.blockDetection },
    loadingScreen: { ...DEFAULT_CONFIG.loadingScreen, ...options.loadingScreen },
    downloadUI: { ...DEFAULT_CONFIG.downloadUI, ...options.downloadUI },
    i18n: { 
      ...DEFAULT_CONFIG.i18n, 
      ...options.i18n,
      keys: { ...DEFAULT_CONFIG.i18n.keys, ...options.i18n?.keys }
    }
  };
}

function generateLoadingScreen(config: ChunkedConfig): string {
  const { loadingScreen } = config;
  
  if (!loadingScreen.enabled) return '';
  if (loadingScreen.customHtml) return loadingScreen.customHtml;
  
  return `
    <div id="chunked-loading" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:${loadingScreen.backgroundColor};color:${loadingScreen.textColor};font-family:${loadingScreen.fontFamily};z-index:9999;">
      <div style="text-align:center;">
        <div id="chunked-progress-text">Loading...</div>
        <div style="width:200px;height:4px;background:${loadingScreen.progressTrackColor};border-radius:2px;margin-top:10px;overflow:hidden;">
          <div id="chunked-progress-bar" style="width:0%;height:100%;background:${loadingScreen.progressColor};transition:width 0.3s;"></div>
        </div>
      </div>
    </div>`;
}

/**
 * Creates the chunked plugin for Vite
 */
export function chunkedPlugin(options: ChunkedPluginOptions = {}): Plugin[] {
  const config = mergeConfig(options);
  let viteConfig: ResolvedConfig;
  let outDir: string;
  let extractedScripts: string[] = [];
  let extractedStyles: string[] = [];

  return [
    {
      name: 'vite-plugin-chunked:config',
      configResolved(resolved) {
        viteConfig = resolved;
        outDir = resolved.build.outDir;
      }
    },

    {
      name: 'vite-plugin-chunked:build',
      apply: 'build',
      enforce: 'post',

      async closeBundle() {
        const buildDir = outDir;
        
        console.log('\n@anzohost/vite-plugin-chunked: Processing build...');
        
        try {
          const version = Date.now().toString(36);
          const manifest = await chunkAssets(buildDir, config, version);
          
          if (manifest.assets.length === 0) {
            console.log('   No assets to chunk (all files below threshold)');
            return;
          }
          
          console.log(`   Chunked ${manifest.assets.length} assets`);
          
          const loaderCode = generateLoader(config, version, extractedScripts, extractedStyles);
          const swCode = generateServiceWorker(config, version);
          
          const [minifiedLoader, minifiedSW] = await Promise.all([
            minify(loaderCode, { compress: true, mangle: true }),
            minify(swCode, { compress: true, mangle: true })
          ]);
          
          const fs = await import('fs/promises');
          const path = await import('path');
          
          await fs.writeFile(path.join(buildDir, 'chunked-loader.js'), minifiedLoader.code || loaderCode);
          console.log('   Generated chunked-loader.js');
          
          await fs.writeFile(path.join(buildDir, 'chunked-sw.js'), minifiedSW.code || swCode);
          console.log('   Generated chunked-sw.js');
          
          await fs.writeFile(
            path.join(buildDir, 'chunked-assets.json'),
            JSON.stringify(manifest, null, 2)
          );
          console.log('   Generated chunked-assets.json');
          
          console.log('Chunked build complete!\n');
          
        } catch (error) {
          console.error('Chunked build failed:', error);
          throw error;
        }
      }
    },

    {
      name: 'vite-plugin-chunked:html',
      apply: 'build',
      enforce: 'post',
      
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          let modified = html;
          
          modified = modified.replace(/<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (match, src) => {
            extractedScripts.push(src);
            return '';
          });
          
          modified = modified.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (match, href) => {
            if (!href.includes('fonts.googleapis.com')) {
              extractedStyles.push(href);
              return '';
            }
            return match;
          });
          modified = modified.replace(/<link[^>]*href="([^"]+)"[^>]*rel="stylesheet"[^>]*>/g, (match, href) => {
            if (!href.includes('fonts.googleapis.com')) {
              extractedStyles.push(href);
              return '';
            }
            return match;
          });
          
          const loaderScript = `\n    <script src="/chunked-loader.js"></script>`;
          
          modified = modified.replace('</head>', `${loaderScript}\n  </head>`);
          
          const loadingHtml = generateLoadingScreen(config);
          if (loadingHtml) {
            modified = modified.replace(/<body([^>]*)>/, `<body$1>${loadingHtml}`);
          }
          
          if (!modified.includes(SUCCESS_MARKER)) {
            modified = modified.trimEnd() + `\n${SUCCESS_MARKER}`;
          }
          
          return modified;
        }
      }
    },

    {
      name: 'vite-plugin-chunked:serve',
      apply: 'serve',
      
      configureServer(server) {
        if (config.debug) {
          console.log('@anzohost/vite-plugin-chunked: Dev mode (chunking disabled)');
        }
      }
    }
  ];
}
