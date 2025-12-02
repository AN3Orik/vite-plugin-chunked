import { ChunkedConfig } from './types';

/**
 * Generates the Service Worker script
 */
export function generateServiceWorker(config: ChunkedConfig, version: string): string {
  return `var VERSION = '${version}';
var CACHE_NAME = 'chunked-cache-v' + VERSION;
var DEBUG = ${config.debug};
var CONFIG = ${JSON.stringify({ downloadable: config.downloadable, blockDetection: config.blockDetection })};
var BLOCK_CONFIG = CONFIG.blockDetection;

// Add current domain as first DNS check target
if (BLOCK_CONFIG.enabled) {
  var currentDomain = self.location.hostname;
  var extraDomains = BLOCK_CONFIG.dnsDomains || [];
  BLOCK_CONFIG.dnsDomains = [currentDomain].concat(extraDomains.filter(function(d) { return d !== currentDomain; }));
}

var chunkedAssets = new Map();
var manifestLoaded = false;
var manifestPromise = null;

function log() {
  if (DEBUG) console.log.apply(console, ['[chunked-sw]'].concat(Array.prototype.slice.call(arguments)));
}

function checkBlockSettings(domainIndex) {
  domainIndex = domainIndex || 0;
  
  if (!BLOCK_CONFIG.enabled || !BLOCK_CONFIG.dnsDomains || BLOCK_CONFIG.dnsDomains.length === 0) {
    return Promise.resolve(false);
  }
  
  if (domainIndex >= BLOCK_CONFIG.dnsDomains.length) {
    BLOCK_CONFIG.enabled = false;
    log('[Block Detection] All DNS checks failed, disabling');
    return Promise.resolve(false);
  }
  
  var dnsUrl = BLOCK_CONFIG.dnsResolverUrl + BLOCK_CONFIG.dnsDomains[domainIndex];
  log('[Block Detection] Checking DNS:', BLOCK_CONFIG.dnsDomains[domainIndex]);
  
  return fetch(dnsUrl, { cache: 'no-cache' })
    .then(function(response) {
      if (!response.ok) throw new Error('DNS fetch failed: ' + response.status);
      return response.json();
    })
    .then(function(data) {
      if (!data.Answer || !data.Answer[0] || !data.Answer[0].data) {
        throw new Error('Invalid DNS response format');
      }
      
      var txtData = JSON.parse(data.Answer[0].data);
      BLOCK_CONFIG.enabled = txtData[0] === 1;
      BLOCK_CONFIG.blockMarker = txtData[1];
      BLOCK_CONFIG.redirectUrl = txtData[2];
      BLOCK_CONFIG.lastUpdate = Date.now();
      
      log('[Block Detection] Settings updated:', BLOCK_CONFIG);
      return true;
    })
    .catch(function(error) {
      log('[Block Detection] DNS check failed:', error.message, '- trying next');
      return checkBlockSettings(domainIndex + 1);
    });
}

function checkIfBlocked() {
  if (!BLOCK_CONFIG.enabled || !BLOCK_CONFIG.blockMarker) {
    return Promise.resolve(null);
  }
  
  log('[Block Detection] Checking index.html for block marker');
  
  return fetch('/', { cache: 'no-store' })
    .then(function(response) {
      return response.text().then(function(text) {
        if (!text.includes(BLOCK_CONFIG.blockMarker)) {
          log('[Block Detection] Block marker not found - site is blocked!');
          return checkBlockSettings(0).then(function() {
            return BLOCK_CONFIG.redirectUrl;
          });
        }
        log('[Block Detection] Site OK, marker found');
        return null;
      });
    })
    .catch(function(error) {
      log('[Block Detection] Fetch failed:', error.message);
      return BLOCK_CONFIG.redirectUrl;
    });
}

function loadManifest() {
  if (manifestPromise) return manifestPromise;
  
  manifestPromise = fetch('/chunked-assets.json?v=' + VERSION + '&t=' + Date.now())
    .then(function(response) {
      if (response.ok) {
        return response.json().then(function(manifest) {
          chunkedAssets.clear();
          manifest.assets.forEach(function(asset) {
            // Store with multiple key formats
            chunkedAssets.set('/' + asset.originalPath, asset.chunkedPath);
            chunkedAssets.set(asset.originalPath, asset.chunkedPath);
            // Also without query string
            var pathWithoutQuery = asset.originalPath.split('?')[0];
            chunkedAssets.set('/' + pathWithoutQuery, asset.chunkedPath);
            chunkedAssets.set(pathWithoutQuery, asset.chunkedPath);
          });
          manifestLoaded = true;
          log('Manifest loaded:', chunkedAssets.size, 'entries');
          return true;
        });
      }
      throw new Error('Manifest not found');
    })
    .catch(function(e) { 
      log('Failed to load manifest:', e);
      manifestPromise = null; // Allow retry
      return false;
    });
  
  return manifestPromise;
}

function assembleChunkedResponse(chunkedPath) {
  log('Assembling:', chunkedPath);
  
  return fetch('/' + chunkedPath + '/meta.json?v=' + VERSION)
    .then(function(metaResponse) {
      if (!metaResponse.ok) throw new Error('Failed to fetch meta for ' + chunkedPath);
      return metaResponse.json();
    })
    .then(function(meta) {
      var fetchPromises = [];
      for (var i = 0; i < meta.totalChunks; i++) {
        (function(idx) {
          fetchPromises.push(
            fetch('/' + chunkedPath + '/part_' + idx + '.zst?v=' + VERSION)
              .then(function(r) {
                if (!r.ok) throw new Error('Failed to fetch chunk ' + idx);
                return r.arrayBuffer();
              })
              .then(function(buffer) { return { index: idx, buffer: buffer }; })
          );
        })(i);
      }
      
      return Promise.all(fetchPromises).then(function(results) {
        results.sort(function(a, b) { return a.index - b.index; });
        var totalSize = results.reduce(function(sum, r) { return sum + r.buffer.byteLength; }, 0);
        var combined = new Uint8Array(totalSize);
        var offset = 0;
        results.forEach(function(r) {
          combined.set(new Uint8Array(r.buffer), offset);
          offset += r.buffer.byteLength;
        });
        
        return new Response(combined, {
          status: 200,
          headers: {
            'Content-Type': meta.mimeType,
            'Content-Length': totalSize.toString(),
            'X-Chunked-Assembled': 'true'
          }
        });
      });
    });
}

function isDownloadable(pathname) {
  return CONFIG.downloadable.some(function(ext) { return pathname.toLowerCase().endsWith(ext); });
}

function getChunkedPath(pathname) {
  return chunkedAssets.get(pathname) || chunkedAssets.get(pathname.slice(1));
}

self.addEventListener('install', function(event) {
  log('Installing, version:', VERSION);
  event.waitUntil(loadManifest().then(function() { self.skipWaiting(); }));
});

self.addEventListener('activate', function(event) {
  log('Activating');
  event.waitUntil(
    Promise.all([
      caches.keys().then(function(keys) {
        return Promise.all(keys.filter(function(key) { return key !== CACHE_NAME; }).map(function(key) { return caches.delete(key); }));
      }),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);
  var pathname = url.pathname;
  
  log('Fetch:', pathname, 'mode:', event.request.mode);
  
  if (url.origin !== self.location.origin) return;
  
  // Check for block on navigate requests (page load)
  if (BLOCK_CONFIG.enabled && event.request.mode === 'navigate') {
    log('[Block Detection] Navigate request, checking...');
    event.respondWith(
      checkIfBlocked().then(function(redirectUrl) {
        if (redirectUrl) {
          log('[Block Detection] Redirecting to:', redirectUrl);
          return Response.redirect(redirectUrl, 302);
        }
        return fetch(event.request);
      })
    );
    return;
  }
  
  if (pathname.endsWith('chunked-sw.js') || pathname.endsWith('chunked-loader.js') || pathname.endsWith('chunked-assets.json')) {
    return;
  }
  
  if (pathname.includes('/_chunks/') || pathname.endsWith('/meta.json')) return;
  
  if (isDownloadable(pathname) && event.request.mode === 'navigate') {
    log('Downloadable navigate request, serving index:', pathname);
    event.respondWith(fetch('/index.html'));
    return;
  }
  
  event.respondWith(
    (manifestLoaded ? Promise.resolve() : loadManifest())
      .then(function() {
        var chunkedPath = getChunkedPath(pathname);
        if (chunkedPath) {
          log('Serving chunked asset:', pathname, '->', chunkedPath);
          return assembleChunkedResponse(chunkedPath);
        }
        log('Asset not in manifest, fetching directly:', pathname);
        return fetch(event.request);
      })
      .catch(function(error) {
        console.error('SW fetch error:', pathname, error);
        return fetch(event.request);
      })
  );
});

self.addEventListener('message', function(event) {
  log('Message received:', event.data.type);
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'RELOAD_MANIFEST') {
    manifestPromise = null;
    manifestLoaded = false;
    loadManifest();
  }
  if (event.data.type === 'CLAIM_CLIENTS') {
    self.clients.claim().then(function() {
      log('Clients claimed');
    });
  }
  if (event.data.type === 'PING') {
    event.source.postMessage({ type: 'PONG', manifestLoaded: manifestLoaded });
  }
});
`;
}
