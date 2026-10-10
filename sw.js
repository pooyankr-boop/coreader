// coreader service worker
// - HTML / JS / CSS / JSON: network-first (always fresh; falls back to cache when offline)
// - images, fonts, PDFs: cache-first
// v8: the old worker pre-cached a blank "<!DOCTYPE html>" for the site root and served
// every static file cache-first, which kept stale copies of pages after an update.
var CACHE = 'coreader-v9';

self.addEventListener('install', function(e) {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.filter(function(n) { return n !== CACHE; })
                              .map(function(n) { return caches.delete(n); }));
    }).then(function() { return self.clients.claim(); })
  );
});

function isAsset(url) {
  return /\.(?:jpe?g|png|gif|webp|svg|ico|woff2?|ttf|otf|pdf)$/i.test(url.pathname);
}

self.addEventListener('fetch', function(e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/proxy-manifest' || url.pathname === '/proxy-image' || url.pathname === '/cache-manifest') return;
  if (req.headers.has('range')) return;

  if (isAsset(url)) {
    e.respondWith(
      caches.match(req).then(function(hit) {
        if (hit) return hit;
        return fetch(req).then(function(resp) {
          if (resp && resp.status === 200 && resp.type === 'basic') {
            var clone = resp.clone();
            caches.open(CACHE).then(function(c) { c.put(req, clone); });
          }
          return resp;
        });
      })
    );
    return;
  }

  e.respondWith(
    fetch(req).then(function(resp) {
      if (resp && resp.status === 200 && resp.type === 'basic') {
        var clone = resp.clone();
        caches.open(CACHE).then(function(c) { c.put(req, clone); });
      }
      return resp;
    }).catch(function() {
      return caches.match(req).then(function(hit) {
        return hit || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      });
    })
  );
});
