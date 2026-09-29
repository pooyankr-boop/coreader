// src/build/serve.js — static file server with IIIF manifest proxy
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'site');
const PORT = process.env.PORT || 8083;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
};

// Proxy IIIF manifests from QDL/BL (Cloudflare-protected), LOC, and museum
// image servers that block cross-origin browser fetch (WAF / no CORS).
const PROXY_HOSTS = ['www.qdl.qa', 'bl.digirati.io', 'www.loc.gov',
  'ids.si.edu', 'iiif.harvardartmuseums.org', 'nrs.harvard.edu',
  'ids.lib.harvard.edu', 'mps.lib.harvard.edu',
  'api.artic.edu', 'www.artic.edu',
  'manifests.collections.yale.edu', 'images.collections.yale.edu',
  'iiif.vam.ac.uk', 'framemark.vam.ac.uk',
  'www.metmuseum.org', 'api.metmuseum.org', 'images.metmuseum.org', 'openaccess-cdn.clevelandart.org', 'worldhistory.org', 'commons.wikimedia.org', 'upload.wikimedia.org', 'iiif.britishmuseum.org', 'iiif.vam.ac.uk', 'framemark.vam.ac.uk'];
const { execFile } = require('child_process');

// loc.gov serves /resource/* only to browsers that pass the Cloudflare
// challenge — Node https gets 403. Route those through headless Chrome.
function locBrowserFetch(targetUrl, res) {
  execFile(process.execPath, [path.join(__dirname, 'loc_fetch.js'), targetUrl],
    { maxBuffer: 64 * 1024 * 1024, timeout: 120000 },
    (err, stdout, stderr) => {
      if (err) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('LOC fetch failed: ' + (stderr || err.message).slice(0, 300));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      });
      res.end(stdout);
    });
}

function proxyFetch(targetUrl, res, depth) {
  if (depth > 5) { res.writeHead(508); res.end('Too many redirects'); return; }
  const mod = targetUrl.startsWith('https') ? https : http;
  var isImage = /(jpg|jpeg|png|webp|gif|svg)(\?|$)/i.test(targetUrl);
  var headers = isImage 
    ? { 'Accept': 'image/*,*/*;q=0.8', 'User-Agent': 'Mozilla/5.0' }
    : { 'Accept': 'application/ld+json, application/json', 'User-Agent': 'Mozilla/5.0' };
  mod.get(targetUrl, {
    headers: headers,
    timeout: 15000
  }, (proxyRes) => {
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      let loc = proxyRes.headers.location;
      if (!loc.startsWith('http')) loc = new URL(loc, targetUrl).href;
      return proxyFetch(loc, res, depth + 1);
    }
    // For images, pass through binary; for JSON, accumulate as string
    var isImage = /(jpg|jpeg|png|webp|gif|svg)(\?|$)/i.test(targetUrl);
    if (isImage) {
      res.writeHead(proxyRes.statusCode || 200, {
        'Content-Type': proxyRes.headers['content-type'] || 'image/jpeg',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      });
      proxyRes.pipe(res);
    } else {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600'
        });
        res.end(data);
      });
    }
  }).on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('Proxy error: ' + err.message);
  }).on('timeout', function() { this.destroy(); res.writeHead(504); res.end('Proxy timeout'); });
}

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);

  // Proxy route
  if (urlPath === '/proxy-manifest') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const target = params.get('url');
    if (!target) { res.writeHead(400); res.end('Missing url'); return; }
    try {
      const host = new URL(target).hostname;
      if (!PROXY_HOSTS.some(h => host.endsWith(h))) { res.writeHead(403); res.end('Host not allowed'); return; }
      if (host.endsWith('loc.gov')) { locBrowserFetch(target, res); return; }
          // Smithsonian ids.si.edu blocks Node fetch (WAF) — use headless Chrome
          if (host.endsWith('ids.si.edu')) {
            // Manifests need browser (WAF); images work with plain fetch
            if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(target)) { proxyFetch(target, res, 0); return; }
            locBrowserFetch(target, res); return;
          }
          if (host.endsWith('images.metmuseum.org')) {
            // Met blocks cross-origin for images, proxy through
            proxyFetch(target, res, 0); return;
          }
          if (host.endsWith('artic.edu') && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(target)) {
            // Art Institute has Cloudflare — use browser fetch
            locBrowserFetch(target, res); return;
          }
          proxyFetch(target, res, 0);
    } catch(e) { res.writeHead(400); res.end('Bad url'); }
    return;
  }

  // Cache an IIIF manifest into site/books/<slug>/manifest.json (add-book flow)
  if (urlPath === '/cache-manifest' && req.method === 'POST') {
    const slug = new URL(req.url, 'http://localhost').searchParams.get('slug');
    if (!slug || !/^[\w\u0600-\u06FF-]+$/.test(slug)) { res.writeHead(400); res.end('Bad slug'); return; }
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { JSON.parse(body); }
      catch(e) { res.writeHead(400); res.end('Not JSON'); return; }
      const dir = path.join(ROOT, 'books', slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'manifest.json'), body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: 'books/' + slug + '/manifest.json' }));
    });
    return;
  }
  if (urlPath === '/cache-manifest') { res.writeHead(405); res.end('POST only'); return; }

  // Proxy route for direct image access
  if (urlPath === '/proxy-image') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    let target = params.get('url');
    if (!target) { res.writeHead(400); res.end('Missing url'); return; }
    const doFetch = (url, depth) => {
      if (depth > 5) { res.writeHead(502); res.end('Too many redirects'); return; }
      try {
        const host = new URL(url).hostname;
        if (!PROXY_HOSTS.some(h => host.endsWith(h))) { res.writeHead(403); res.end('Host not allowed'); return; }
        const lib = url.startsWith('https') ? https : require('http');
        const proxyReq = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*,*/*;q=0.8', 'Referer': 'https://www.harvardartmuseums.org/' } }, (proxyRes) => {
          if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
            proxyRes.resume();
            const next = new URL(proxyRes.headers.location, url).href;
            doFetch(next, depth + 1);
            return;
          }
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });
        proxyReq.on('error', (e) => { res.writeHead(500); res.end('Proxy error: ' + e.message); });
        proxyReq.setTimeout(30000, () => { res.writeHead(504); res.end('Gateway timeout'); proxyReq.destroy(); });
      } catch (e) { res.writeHead(500); res.end(e.message); }
    };
    doFetch(target, 0);
    return;
  }

  let filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`coreader preview: http://localhost:${PORT}`));
