import { ChunkedConfig } from './types';

/**
 * Generates the client-side loader script.
 * Registers SW first, then loads app scripts/styles through SW.
 * Includes automatic DownloadManager UI for downloadable files.
 */
export function generateLoader(
  config: ChunkedConfig, 
  version: string,
  scripts: string[] = [],
  styles: string[] = []
): string {
  const downloadUIStyles = generateDownloadUIStyles(config);
  
  return `(function() {
  'use strict';
  
  var VERSION = '${version}';
  var DEBUG = ${config.debug};
  var CONFIG = ${JSON.stringify({
    concurrency: config.concurrency,
    downloadable: config.downloadable,
    downloadUI: config.downloadUI,
    i18n: config.i18n
  })};
  var BLOCK_CONFIG = ${JSON.stringify(config.blockDetection)};
  var SCRIPTS = ${JSON.stringify(scripts)};
  var STYLES = ${JSON.stringify(styles)};
  
  function log() {
    if (DEBUG) console.log.apply(console, ['[chunked-loader]'].concat(Array.prototype.slice.call(arguments)));
  }
  
  function updateProgress(percent, text) {
    var progressBar = document.getElementById('chunked-progress-bar');
    var progressText = document.getElementById('chunked-progress-text');
    if (progressBar) progressBar.style.width = percent + '%';
    if (progressText && text) progressText.textContent = text;
  }
  
  function hideLoading() {
    var loading = document.getElementById('chunked-loading');
    if (loading) {
      loading.style.opacity = '0';
      loading.style.transition = 'opacity 0.3s';
      setTimeout(function() { loading.remove(); }, 300);
    }
  }
  
  ${generateDownloadManagerCode(config)}
  
  function loadStyles() {
    log('Loading styles:', STYLES);
    return Promise.all(STYLES.map(function(href) {
      return new Promise(function(resolve, reject) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href + '?v=' + VERSION;
        link.onload = resolve;
        link.onerror = function(e) {
          console.error('Failed to load style:', href, e);
          reject(e);
        };
        document.head.appendChild(link);
      });
    }));
  }
  
  function loadScripts() {
    log('Loading scripts:', SCRIPTS);
    return SCRIPTS.reduce(function(promise, src) {
      return promise.then(function() {
        return new Promise(function(resolve, reject) {
          var script = document.createElement('script');
          script.type = 'module';
          script.src = src + '?v=' + VERSION;
          script.onload = resolve;
          script.onerror = function(e) {
            console.error('Failed to load script:', src, e);
            reject(e);
          };
          document.head.appendChild(script);
        });
      });
    }, Promise.resolve());
  }
  
  function loadApp() {
    updateProgress(30, 'Loading styles...');
    return loadStyles()
      .then(function() {
        updateProgress(60, 'Loading application...');
        return loadScripts();
      })
      .then(function() {
        updateProgress(100, 'Ready!');
        setTimeout(hideLoading, 200);
        log('App loaded successfully');
        reloadFavicon();
      });
  }
  
  function reloadFavicon() {
    var link = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]');
    if (link) {
      var href = link.getAttribute('href') || '/favicon.ico';
      link.setAttribute('href', href + '?v=' + VERSION);
    } else {
      var newLink = document.createElement('link');
      newLink.rel = 'icon';
      newLink.href = '/favicon.ico?v=' + VERSION;
      document.head.appendChild(newLink);
    }
    log('Favicon reloaded via SW');
  }
  
  function testSWInterception() {
    return fetch('/chunked-assets.json?v=' + VERSION + '&test=' + Date.now())
      .then(function(response) {
        // If we get a valid response, SW is working OR file exists directly
        return response.ok;
      })
      .catch(function() {
        return false;
      });
  }
  
  function ensureSWReady() {
    return new Promise(function(resolve, reject) {
      if (!('serviceWorker' in navigator)) {
        reject(new Error('Service Worker not supported'));
        return;
      }
      
      if (navigator.serviceWorker.controller) {
        log('SW already controlling');
        resolve(true);
        return;
      }
      
      log('Registering Service Worker...');
      
      navigator.serviceWorker.register('/chunked-sw.js?v=' + VERSION, { scope: '/' })
        .then(function(registration) {
          log('SW registered');
          
          var controllerChanged = false;
          navigator.serviceWorker.addEventListener('controllerchange', function() {
            if (!controllerChanged) {
              controllerChanged = true;
              log('SW now controlling (via controllerchange)');
              resolve(true);
            }
          });
          
          if (registration.active) {
            log('SW active, sending CLAIM_CLIENTS');
            registration.active.postMessage({ type: 'CLAIM_CLIENTS' });
            
            setTimeout(function() {
              if (navigator.serviceWorker.controller) {
                if (!controllerChanged) {
                  controllerChanged = true;
                  log('SW controlling after claim');
                  resolve(true);
                }
              } else {
                log('SW not controlling after claim, reloading...');
                location.reload();
              }
            }, 200);
            return;
          }
          
          var sw = registration.installing || registration.waiting;
          if (sw) {
            log('Waiting for SW to activate, state:', sw.state);
            sw.addEventListener('statechange', function() {
              log('SW state:', this.state);
              if (this.state === 'activated') {
                this.postMessage({ type: 'CLAIM_CLIENTS' });
                
                setTimeout(function() {
                  if (navigator.serviceWorker.controller) {
                    if (!controllerChanged) {
                      controllerChanged = true;
                      log('SW controlling after activation');
                      resolve(true);
                    }
                  } else {
                    log('SW activated but not controlling, reloading...');
                    location.reload();
                  }
                }, 200);
              }
            });
          }
          
          setTimeout(function() {
            if (!controllerChanged) {
              log('SW timeout, reloading...');
              location.reload();
            }
          }, 5000);
        })
        .catch(function(error) {
          console.error('SW registration failed:', error);
          reject(error);
        });
    });
  }
  
  function init() {
    log('Chunked loader init, version:', VERSION);
    log('Scripts:', SCRIPTS);
    log('Styles:', STYLES);
    
    updateProgress(5, 'Initializing...');
    
    if (!('serviceWorker' in navigator)) {
      console.error('Service Worker not supported');
      updateProgress(0, 'Browser not supported');
      return;
    }
    
    ensureSWReady()
      .then(function() {
        updateProgress(20, 'Loading...');
        handleDownloadableNavigation();
        setupDownloadLinkInterceptor();
        return loadApp();
      })
      .catch(function(error) {
        console.error('Chunked loader error:', error);
        updateProgress(0, 'Failed to load');
        
        setTimeout(function() {
          location.reload();
        }, 2000);
      });
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
}

function generateDownloadUIStyles(config: ChunkedConfig): string {
  const ui = config.downloadUI;
  const pos = ui.position;
  const posStyles = pos === 'bottom-right' ? 'bottom:20px;right:20px;' :
                    pos === 'bottom-left' ? 'bottom:20px;left:20px;' :
                    pos === 'top-right' ? 'top:20px;right:20px;' : 'top:20px;left:20px;';
  
  return `
.chunked-toast-container{position:fixed;${posStyles}z-index:99999;display:flex;flex-direction:column;gap:10px;max-width:320px;}
.chunked-toast{background:${ui.backgroundColor};color:${ui.textColor};padding:12px 16px;border-radius:${ui.borderRadius}px;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:chunked-slide-in 0.3s ease;}
.chunked-toast.removing{animation:chunked-slide-out 0.3s ease forwards;}
.chunked-toast-title{font-weight:500;margin-bottom:4px;font-size:14px;}
.chunked-toast-message{font-size:12px;color:${ui.secondaryTextColor};}
.chunked-toast-progress{width:100%;height:4px;background:${ui.progressTrackColor};border-radius:2px;margin-top:8px;overflow:hidden;}
.chunked-toast-progress-bar{height:100%;background:${ui.progressColor};transition:width 0.1s ease;}
.chunked-toast-close{position:absolute;top:8px;right:8px;background:none;border:none;color:${ui.secondaryTextColor};cursor:pointer;font-size:16px;line-height:1;}
.chunked-toast.success .chunked-toast-title{color:#4caf50;}
.chunked-toast.error .chunked-toast-title{color:#f44336;}
@keyframes chunked-slide-in{from{opacity:0;transform:translateX(${pos.includes('right') ? '100%' : '-100%'});}}
@keyframes chunked-slide-out{to{opacity:0;transform:translateX(${pos.includes('right') ? '100%' : '-100%'});}}
`;
}

function generateDownloadManagerCode(config: ChunkedConfig): string {
  return `
  var toastContainer = null;
  var toastIdCounter = 0;
  var customDownloadHandler = null;
  
  // Allow React app to register custom handler
  window.__chunkedRegisterDownloadHandler = function(handler) {
    customDownloadHandler = handler;
    log('Custom download handler registered');
  };
  
  function initDownloadUI() {
    if (toastContainer) return;
    
    var style = document.createElement('style');
    style.textContent = \`${generateDownloadUIStyles(config).replace(/\n/g, '')}\`;
    document.head.appendChild(style);
    
    toastContainer = document.createElement('div');
    toastContainer.className = 'chunked-toast-container';
    document.body.appendChild(toastContainer);
  }
  
  function showToast(options) {
    initDownloadUI();
    var id = 'toast-' + (++toastIdCounter);
    var toast = document.createElement('div');
    toast.id = id;
    toast.className = 'chunked-toast' + (options.type ? ' ' + options.type : '');
    toast.style.position = 'relative';
    
    var html = '<div class="chunked-toast-title">' + (options.title || '') + '</div>';
    if (options.message) html += '<div class="chunked-toast-message">' + options.message + '</div>';
    if (options.showProgress) {
      html += '<div class="chunked-toast-progress"><div class="chunked-toast-progress-bar" style="width:0%"></div></div>';
    }
    if (options.closable !== false) {
      html += '<button class="chunked-toast-close" onclick="window.chunkedCloseToast(\\'' + id + '\\')">&times;</button>';
    }
    
    toast.innerHTML = html;
    toastContainer.appendChild(toast);
    
    if (options.autoClose) {
      setTimeout(function() { removeToast(id); }, options.autoClose);
    }
    
    return id;
  }
  
  function updateToast(id, options) {
    var toast = document.getElementById(id);
    if (!toast) return;
    
    if (options.title) {
      var titleEl = toast.querySelector('.chunked-toast-title');
      if (titleEl) titleEl.textContent = options.title;
    }
    if (options.message) {
      var msgEl = toast.querySelector('.chunked-toast-message');
      if (msgEl) msgEl.textContent = options.message;
    }
    if (typeof options.progress === 'number') {
      var bar = toast.querySelector('.chunked-toast-progress-bar');
      if (bar) bar.style.width = options.progress + '%';
    }
    if (options.type) {
      toast.className = 'chunked-toast ' + options.type;
    }
    if (options.autoClose) {
      setTimeout(function() { removeToast(id); }, options.autoClose);
    }
  }
  
  function removeToast(id) {
    var toast = document.getElementById(id);
    if (!toast) return;
    toast.classList.add('removing');
    setTimeout(function() { toast.remove(); }, 300);
  }
  
  window.chunkedCloseToast = removeToast;
  
  function isDownloadableUrl(pathname) {
    return CONFIG.downloadable.some(function(ext) {
      return pathname.toLowerCase().endsWith(ext);
    });
  }
  
  function fetchChunkedAsset(assetPath, onProgress) {
    return fetch('/chunked-assets.json?v=' + VERSION)
      .then(function(r) { return r.json(); })
      .then(function(manifest) {
        var asset = manifest.assets.find(function(a) {
          return a.originalPath === assetPath || ('/' + a.originalPath) === assetPath;
        });
        if (!asset) {
          return fetch(assetPath).then(function(r) { return r.blob(); });
        }
        return fetchAndAssembleChunks(asset, onProgress);
      });
  }
  
  function fetchAndAssembleChunks(asset, onProgress) {
    var chunkedPath = asset.chunkedPath;
    return fetch('/' + chunkedPath + '/meta.json?v=' + VERSION)
      .then(function(r) { return r.json(); })
      .then(function(meta) {
        var chunks = [];
        var loaded = 0;
        var promises = [];
        
        for (var i = 0; i < meta.totalChunks; i++) {
          (function(idx) {
            promises.push(
              fetch('/' + chunkedPath + '/part_' + idx + '.zst?v=' + VERSION)
                .then(function(r) { return r.arrayBuffer(); })
                .then(function(buf) {
                  chunks[idx] = buf;
                  loaded++;
                  if (onProgress) {
                    var percent = Math.round((loaded / meta.totalChunks) * 100);
                    onProgress(percent, loaded, meta.totalChunks);
                  }
                  return { loaded: loaded, total: meta.totalChunks };
                })
            );
          })(i);
        }
        
        return Promise.all(promises).then(function() {
          var totalSize = chunks.reduce(function(sum, c) { return sum + c.byteLength; }, 0);
          var combined = new Uint8Array(totalSize);
          var offset = 0;
          chunks.forEach(function(c) {
            combined.set(new Uint8Array(c), offset);
            offset += c.byteLength;
          });
          return new Blob([combined], { type: meta.mimeType });
        });
      });
  }
  
  function downloadFile(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  function startDownload(pathname, fileName) {
    log('Starting download:', fileName);
    
    // Use custom handler if registered (e.g. DownloadManager with react-toastify)
    if (customDownloadHandler) {
      customDownloadHandler(pathname, fileName);
      return;
    }
    
    var toastId = showToast({
      title: 'Downloading ' + fileName,
      message: 'Connecting...',
      showProgress: true,
      closable: false
    });
    
    function onProgress(percent, loaded, total) {
      updateToast(toastId, {
        message: percent + '%',
        progress: percent
      });
    }
    
    fetchChunkedAsset(pathname, onProgress)
      .then(function(blob) {
        downloadFile(blob, fileName);
        updateToast(toastId, {
          title: fileName,
          message: 'Download complete!',
          progress: 100,
          type: 'success',
          autoClose: 5000
        });
      })
      .catch(function(error) {
        console.error('Download failed:', error);
        updateToast(toastId, {
          title: fileName,
          message: 'Download failed',
          type: 'error',
          autoClose: 5000
        });
      });
  }
  
  function handleDownloadableNavigation() {
    // Handle if page was loaded with downloadable URL
    var pathname = window.location.pathname;
    if (!isDownloadableUrl(pathname)) return;
    
    var fileName = pathname.split('/').pop() || 'download';
    log('Downloadable file detected on page load:', fileName);
    
    history.replaceState(null, '', '/');
    startDownload(pathname, fileName);
  }
  
  // Intercept clicks on downloadable links to prevent navigation
  function setupDownloadLinkInterceptor() {
    document.addEventListener('click', function(e) {
      var target = e.target;
      
      // Find closest <a> tag
      while (target && target.tagName !== 'A') {
        target = target.parentElement;
      }
      
      if (!target || !target.href) return;
      
      var url;
      try {
        url = new URL(target.href);
      } catch (err) {
        return;
      }
      
      // Only handle same-origin links
      if (url.origin !== window.location.origin) return;
      
      var pathname = url.pathname;
      if (!isDownloadableUrl(pathname)) return;
      
      // Prevent navigation
      e.preventDefault();
      e.stopPropagation();
      
      var fileName = pathname.split('/').pop() || 'download';
      log('Download link clicked:', fileName);
      
      startDownload(pathname, fileName);
    }, true); // Use capture phase
    
    log('Download link interceptor installed');
  }
`;
}
