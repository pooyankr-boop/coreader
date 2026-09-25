// coreader service worker — cache-first for static assets, network-first for data
var CACHE = 'coreader-v3';

self.addEventListener('install', function(e) {
  // Don't fail install on missing assets — use individual puts
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      return Promise.allSettled([
        c.put('./', new Response('<!DOCTYPE html>', {headers:{'Content-Type':'text/html'}})),
        c.put('viewer/viewer.html', fetch('viewer/viewer.html').then(function(r){return r;}).catch(function(){})),
        c.put('viewer/viewer.css', fetch('viewer/viewer.css').then(function(r){return r;}).catch(function(){})),
        c.put('viewer/viewer.js', fetch('viewer/viewer.js').then(function(r){return r;}).catch(function(){})),
        c.put('viewer/ganjoor-text.js', fetch('viewer/ganjoor-text.js').then(function(r){return r;}).catch(function(){})),
      ]);
    }).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE; })
             .map(function(n) { return caches.delete(n); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);
  // Network-first for books-index.json (dynamic data)
  if (url.pathname.endsWith('books-index.json')) {
    e.respondWith(
      fetch(e.request).then(function(r) {
        var clone = r.clone();
        caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        return r;
      }).catch(function() {
        return caches.match(e.request);
      })
    );
    return;
  }
  // Network-first for JSON data files (ganjoor, book.json, manifest)
  if (url.pathname.endsWith('.json') && url.pathname.indexOf('/books/') >= 0) {
    e.respondWith(
      fetch(e.request).then(function(r) {
        if (r.ok) {
          var clone = r.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return r;
      }).catch(function() {
        return caches.match(e.request);
      })
    );
    return;
  }
  // Cache-first for everything else (HTML, CSS, JS, fonts, images)
  e.respondWith(
    caches.match(e.request).then(function(r) {
      if (r) return r;
      return fetch(e.request).then(function(resp) {
        if (!resp || resp.status !== 200 || resp.type !== 'basic') return resp;
        var clone = resp.clone();
        caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        return resp;
      });
    })
  );
});
