// src/build/serve.js — static file server with IIIF manifest proxy
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'site');
const PORT = process.env.PORT || 8081;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
};

// Proxy IIIF manifests from QDL/BL (Cloudflare-protected) and LOC
const PROXY_HOSTS = ['www.qdl.qa', 'bl.digirati.io', 'www.loc.gov'];
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
  mod.get(targetUrl, {
    headers: { 'Accept': 'application/ld+json, application/json', 'User-Agent': 'Mozilla/5.0' },
    timeout: 15000
  }, (proxyRes) => {
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      let loc = proxyRes.headers.location;
      if (!loc.startsWith('http')) loc = new URL(loc, targetUrl).href;
      return proxyFetch(loc, res, depth + 1);
    }
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
