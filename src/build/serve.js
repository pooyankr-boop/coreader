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
const PROXY_HOSTS = ['www.qdl.qa', 'bl.digirati.io', 'www.loc.gov', 'iiif.vam.ac.uk', 'collections.vam.ac.uk', 'openaccess-cdn.clevelandart.org', 'images.metmuseum.org', 'nrs.harvard.edu', 'ids.lib.harvard.edu', 'mps.lib.harvard.edu', 'harvardartmuseums.org', 'ids.si.edu', 'www.artic.edu', 'media.getty.edu', 'iiif.bnf.fr', 'gallica.bnf.fr', 'wellcomecollection.org', 'iiif.oregon.edu', 'media.art.thewalters.org', 'media.britishmuseum.org', 'api.bl.uk', 'iiif.maximillian-mueller.de', 'iiif.ku.edu', 'iiif.lib.harvard.edu', 'iiif.harvardartmuseums.org', 'digi.ub.rug.nl', 'iiif.library.utoronto.ca', 'iiif.leidenuniv.nl', 'iiif.library.ox.ac.uk', 'iiif.library.jhu.edu', 'iiif.library.nd.edu', 'iiif.library.usc.edu', 'iiif.library.yale.edu', 'iiif.library.princeton.edu', 'iiif.library.columbia.edu', 'iiif.library.chicago.edu', 'iiif.library.duke.edu', 'iiif.library.emory.edu', 'iiif.library.georgetown.edu', 'iiif.library.ndl.gov', 'iiif.library.virginia.edu', 'iiif.library.wisc.edu', 'iiif.library.brown.edu', 'iiif.library.cornell.edu', 'iiif.library.stanford.edu', 'iiif.library.caltech.edu', 'iiif.library.upenn.edu', 'iiif.library.utexas.edu', 'iiif.library.ufl.edu', 'iiif.library.ucla.edu', 'iiif.library.usf.edu', 'iiif.library.vanderbilt.edu', 'iiif.library.tamu.edu', 'iiif.library.okstate.edu', 'iiif.library.illinois.edu', 'iiif.library.psu.edu', 'iiif.library.msu.edu', 'iiif.library.rutgers.edu', 'iiif.library.neu.edu', 'iiif.library.gwu.edu', 'iiif.library.bu.edu', 'iiif.library.bc.edu', 'iiif.library.rochester.edu', 'iiif.library.wustl.edu', 'iiif.library.virginia.edu', 'iiif.library.rice.edu', 'iiif.library.tulane.edu', 'iiif.library.fsu.edu', 'iiif.library.sc.edu', 'iiif.library.uky.edu', 'iiif.library.auburn.edu', 'iiif.library.missouri.edu', 'iiif.library.ku.edu', 'iiif.library.iastate.edu', 'iiif.library.nd.edu', 'iiif.library.okstate.edu', 'iiif.library.vt.edu', 'iiif.library.uga.edu', 'iiif.library.gatech.edu', 'iiif.library.clemson.edu', 'iiif.library.lsu.edu', 'iiif.library.tamu.edu', 'iiif.library.arizona.edu', 'iiif.library.asu.edu', 'iiif.library.nau.edu', 'iiif.library.nmhu.edu', 'iiif.library.nmsu.edu', 'iiif.library.unm.edu', 'iiif.library.unlv.edu', 'iiif.library.unr.edu', 'iiif.library.usu.edu', 'iiif.library.weber.edu', 'iiif.library.byu.edu', 'iiif.library.uwyo.edu', 'iiif.library.csu.edu', 'iiif.library.mines.edu', 'iiif.library.colostate.edu', 'iiif.library.du.edu', 'iiif.library.cudenver.edu', 'iiif.library.msudenver.edu', 'iiif.library.nmsu.edu', 'iiif.library.nmhu.edu', 'iiif.library.su.edu', 'iiif.library.unm.edu', 'iiif.library.unlv.edu', 'iiif.library.unr.edu', 'iiif.library.usu.edu', 'iiif.library.weber.edu', 'iiif.library.byu.edu', 'iiif.library.uwyo.edu', 'iiif.library.csu.edu', 'iiif.library.mines.edu', 'iiif.library.colostate.edu', 'iiif.library.du.edu', 'iiif.library.cudenver.edu', 'iiif.library.msudenver.edu'];
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

  // Image proxy — fetch and relay binary images from external hosts
  if (urlPath === '/proxy-image') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const imgUrl = params.get('url');
    if (!imgUrl) { res.writeHead(400); res.end('Missing url'); return; }
    function proxyImg(targetUrl, depth) {
      if (depth > 5) { res.writeHead(508); res.end('Too many redirects'); return; }
      const mod = targetUrl.startsWith('https') ? https : http;
      mod.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.harvard.edu/'
        },
        timeout: 25000
      }, (proxyRes) => {
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
          let loc = proxyRes.headers.location;
          if (!loc.startsWith('http')) loc = new URL(loc, targetUrl).href;
          return proxyImg(loc, depth + 1);
        }
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*'
        });
        // Stream chunks directly — never buffer binary into a string
        const chunks = [];
        proxyRes.on('data', chunk => chunks.push(chunk));
        proxyRes.on('end', () => {
          let data = Buffer.concat(chunks);
          // Transcode corrupted Harvard images: nrs.harvard.edu / ids.lib.harvard.edu
          // return JPEG data with \xfd in place of \xff (marker bytes), which browsers
          // reject as invalid JPEG. Replace every 0xfd with 0xff to produce a valid stream.
          if (data.length > 0 && data[0] === 0xfd) {
            const out = Buffer.alloc(data.length);
            for (let i = 0; i < data.length; i++) {
              out[i] = data[i] === 0xfd ? 0xff : data[i];
            }
            data = out;
          }
          res.end(data);
        });
      }).on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Proxy error: ' + err.message.slice(0, 200));
      });
    }
    proxyImg(imgUrl, 0);
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
