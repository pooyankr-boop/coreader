// src/build/serve.js — static file server with IIIF manifest proxy
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PORT = process.env.PORT || 8081;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2'
};

// Proxy IIIF manifests from QDL/BL (Cloudflare-protected) and LOC
// Allow-list shared with the Vercel serverless API (proxy-hosts.json).
const PROXY_HOSTS = require('./proxy-hosts.json');
PROXY_HOSTS.splice(0, PROXY_HOSTS.length, ...new Set(PROXY_HOSTS)); // drop duplicate entries
// A suffix match without a dot boundary let 'notiiif.vam.ac.uk' through.
function hostAllowed(h) { return PROXY_HOSTS.some(a => h === a || h.endsWith('.' + a)); }
// Never follow a redirect into the local machine / private network.
function isPrivateHost(h) {
  h = String(h || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || /^(fc|fd|fe80)/.test(h);
}
function redirectBlocked(loc, res) {
  try { if (isPrivateHost(new URL(loc).hostname)) { res.writeHead(403); res.end('Redirect to private host blocked'); return true; } }
  catch (e) { res.writeHead(502); res.end('Bad redirect'); return true; }
  return false;
}
const { execFile } = require('child_process');

// loc.gov serves /resource/* only to browsers that pass the Cloudflare
// challenge — Node https gets 403. Route those through headless Chrome.
function locBrowserFetch(targetUrl, res) {
  // src/build/loc_fetch.js is referenced but missing from the repo; fail clearly instead of a confusing exec error
  if (!fs.existsSync(path.join(__dirname, 'loc_fetch.js'))) {
    res.writeHead(501, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('loc.gov proxy unavailable: loc_fetch.js is missing');
    return;
  }
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
  const req = mod.get(targetUrl, {
    headers: { 'Accept': 'application/ld+json, application/json', 'User-Agent': 'Mozilla/5.0' },
    timeout: 15000
  }, (proxyRes) => {
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
      let loc = proxyRes.headers.location;
      if (!loc.startsWith('http')) loc = new URL(loc, targetUrl).href;
      if (redirectBlocked(loc, res)) return;
      return proxyFetch(loc, res, depth + 1);
    }
    let data = '';
    proxyRes.on('data', chunk => { if (data.length < 30 * 1024 * 1024) data += chunk; });
    proxyRes.on('end', () => {
      if (res.writableEnded) return;
      res.writeHead(proxyRes.statusCode || 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      });
      res.end(data);
    });
  });
  req.on('error', (err) => {
    if (res.writableEnded) return;
    try { res.writeHead(502, { 'Content-Type': 'text/plain' }); } catch (e) { return; }
    res.end('Proxy error: ' + String(err.message || err).slice(0, 200));
  });
  req.on('timeout', function() {
    try { this.destroy(); } catch (e) {}
    if (res.writableEnded) return;
    try { res.writeHead(504); } catch (e) { return; }
    res.end('Proxy timeout');
  });
}

process.on('uncaughtException', (err) => {
  console.error('[serve] uncaughtException (kept alive):', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[serve] unhandledRejection (kept alive):', err && err.message);
});

// روی هاست آنلاین (Render/Liara/...) ربات با همین پروسس بالا می‌آید تا نیازی به
// سرویس دوم نباشد: کافی است BOT_TOKEN در متغیرهای محیطی ست شود.
if (process.env.BOT_TOKEN && !process.env.NO_BOT) {
  try {
    require('../../telegram/bot.js');
    console.log('[serve] telegram bot started in-process');
  } catch (e) { console.error('[serve] bot failed to start:', e.message); }
}

http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { res.writeHead(400); res.end('Bad request'); return; }

  // Proxy route
  if (urlPath === '/proxy-manifest') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const target = params.get('url');
    if (!target) { res.writeHead(400); res.end('Missing url'); return; }
    try {
      const host = new URL(target).hostname;
      if (!hostAllowed(host)) { res.writeHead(403); res.end('Host not allowed'); return; }
      if (host.endsWith('loc.gov')) { locBrowserFetch(target, res); return; }
      proxyFetch(target, res, 0);
    } catch(e) { res.writeHead(400); res.end('Bad url'); }
    return;
  }

  // Cache an IIIF manifest into site/books/<slug>/manifest.json (add-book flow)
  if (urlPath === '/cache-manifest' && req.method === 'POST') {
    const slug = new URL(req.url, 'http://localhost').searchParams.get('slug');
    if (!slug || !/^[\w\u0600-\u06FF-]+$/.test(slug)) { res.writeHead(400); res.end('Bad slug'); return; }
    // refuse cross-site POSTs (a web page you visit must not be able to write into books/)
    try { const o = req.headers.origin; if (o && new URL(o).host !== req.headers.host) { res.writeHead(403); res.end('Cross-origin blocked'); return; } }
    catch (e) { res.writeHead(403); res.end('Bad origin'); return; }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 30 * 1024 * 1024) { res.writeHead(413); res.end('Too large'); req.destroy(); } });
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

  // ---- Telegram webhook (حالت هاست: آپدیت‌ها به‌جای polling از این‌جا می‌آیند) ----
  // مسیر دقیق HOOK_PATH از هش توکن ساخته می‌شود؛ بدون BOT_TOKEN همیشه 404.
  if (urlPath.startsWith('/telegram/hook/')) {
    const token = process.env.BOT_TOKEN || '';
    if (!token) { res.writeHead(404); res.end('no bot'); return; }
    const crypto = require('crypto');
    const expect = '/telegram/hook/' + crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
    if (urlPath !== expect) { res.writeHead(404); res.end('nope'); return; }
    let ubody = '';
    req.on('data', c => { ubody += c; if (ubody.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      try {
        const u = JSON.parse(ubody || '{}');
        const bot = require('../../telegram/bot.js');
        if (bot && bot.handleUpdate) bot.handleUpdate(u);
      } catch (e) { console.error('[serve] webhook update error:', e.message); }
    });
    return;
  }

  // ---- coreader user API: auth + sync + annotations + manifests + telegram ----
  // ذخیره سبک فایل‌محور در data/ (بدون دیتابیس). برای استقرار بزرگ‌تر، همین
  // قرارداد REST را می‌توان به Postgres وصل کرد.
  if (urlPath.startsWith('/api/')) {
    const DATA = path.join(ROOT, 'data');
    try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) {}
    const readJ = (f, fb) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return fb; } };
    const writeJ = (f, v) => { fs.writeFileSync(path.join(DATA, f), JSON.stringify(v, null, 2)); };
    const sendJ = (o, code) => { res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(o)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return; }
    let abody = '';
    const done = (fn) => {
      if (req.method === 'GET') return fn('');
      req.on('data', c => { abody += c; if (abody.length > 10 * 1024 * 1024) { res.writeHead(413); res.end('Too large'); req.destroy(); } });
      req.on('end', () => fn(abody));
    };
    // POST /api/auth/request-code {code,name} — پنل کد را نگه می‌دارد تا ربات تایید کند
    if (urlPath === '/api/auth/request-code') return done((b) => {
      try {
        const j = JSON.parse(b || '{}');
        if (!j.code) return sendJ({ ok: false }, 400);
        const codes = readJ('tg-codes.json', {});
        codes[String(j.code)] = { name: j.name || 'کاربر', at: Date.now(), linked: null };
        writeJ('tg-codes.json', codes);
        return sendJ({ ok: true });
      } catch (e) { return sendJ({ ok: false }, 400); }
    });
    // GET /api/auth/check-code?code= — پنل هر چند ثانیه poll می‌کند
    if (urlPath === '/api/auth/check-code') {
      const code = new URL(req.url, 'http://localhost').searchParams.get('code');
      const codes = readJ('tg-codes.json', {});
      const c = codes[String(code)];
      if (c && c.linked) return sendJ({ user: c.linked });
      return sendJ({});
    }
    // POST /api/auth/login — ثبت/به‌روزرسانی کاربر
    if (urlPath === '/api/auth/login') return done((b) => {
      try {
        const u = JSON.parse(b || '{}');
        if (!u.id) return sendJ({ ok: false }, 400);
        const users = readJ('users.json', {});
        users[String(u.id)] = { id: u.id, name: u.name || 'کاربر', method: u.method || 'local', at: Date.now() };
        writeJ('users.json', users);
        return sendJ({ ok: true });
      } catch (e) { return sendJ({ ok: false }, 400); }
    });
    // POST /api/auth/telegram-link {code, telegramUser} — ربات صدا می‌زند
    if (urlPath === '/api/auth/telegram-link') return done((b) => {
      try {
        const j = JSON.parse(b || '{}');
        const codes = readJ('tg-codes.json', {});
        const c = codes[String(j.code)];
        if (!c) return sendJ({ ok: false, error: 'bad-code' }, 404);
        const user = { id: 'tg-' + (j.telegramUser && j.telegramUser.id), name: (j.telegramUser && (j.telegramUser.first_name || j.telegramUser.username)) || c.name, method: 'telegram', tg: j.telegramUser, created: Date.now() };
        c.linked = user;
        writeJ('tg-codes.json', codes);
        const users = readJ('users.json', {});
        users[user.id] = user;
        writeJ('users.json', users);
        return sendJ({ ok: true, user });
      } catch (e) { return sendJ({ ok: false }, 400); }
    });
    // POST /api/sync — همگام‌سازی قاب‌ها/متن‌ها/پروژه‌ها
    if (urlPath === '/api/sync') return done((b) => {
      try {
        const j = JSON.parse(b || '{}');
        const uid = (j.user && j.user.id) || 'anon';
        const store = readJ('sync.json', {});
        store[String(uid)] = { user: j.user || null, frames: j.frames || [], texts: j.texts || [], projects: j.projects || [], at: Date.now() };
        writeJ('sync.json', store);
        const n = (j.frames || []).length + (j.texts || []).length + (j.projects || []).length;
        return sendJ({ ok: true, saved: n });
      } catch (e) { return sendJ({ ok: false }, 400); }
    });
    // POST /api/manifests — ذخیره مانیفست ساخته‌شده در پنل
    if (urlPath === '/api/manifests' && req.method === 'POST') return done((b) => {
      try {
        const j = JSON.parse(b || '{}');
        if (!j.manifest) return sendJ({ ok: false }, 400);
        const ms = readJ('manifests.json', []);
        ms.unshift({ id: j.manifest.id || ('urn:coreader:' + Date.now()), project: (j.project && j.project.name) || '', user: (j.user && j.user.name) || '', manifest: j.manifest, at: Date.now() });
        writeJ('manifests.json', ms.slice(0, 200));
        return sendJ({ ok: true });
      } catch (e) { return sendJ({ ok: false }, 400); }
    });
    // GET /api/manifests — فهرست مانیفست‌های مفید برای غنی‌سازی نسخ
    if (urlPath === '/api/manifests' && req.method === 'GET') {
      return sendJ(readJ('manifests.json', []));
    }
    // POST /api/annotate {project, text, tag, by} — حاشیه‌گذاری جمعی (ربات/گروه)
    if (urlPath === '/api/annotate' && req.method === 'POST') return done((b) => {
      try {
        const j = JSON.parse(b || '{}');
        if (!j.project || !j.text) return sendJ({ ok: false, error: 'project+text required' }, 400);
        const all = readJ('annotations.json', {});
        const pid = String(j.project);
        all[pid] = all[pid] || [];
        const anno = { text: String(j.text).slice(0, 2000), tag: String(j.tag || '').slice(0, 60), by: String(j.by || 'کاربر تلگرام').slice(0, 80), at: Date.now() };
        all[pid].push(anno);
        writeJ('annotations.json', all);
        return sendJ({ ok: true, count: all[pid].length });
      } catch (e) { return sendJ({ ok: false }, 400); }
    });
    // GET /api/annotations?project= — حاشیه‌های یک پروژه
    if (urlPath === '/api/annotations' && req.method === 'GET') {
      const pid = new URL(req.url, 'http://localhost').searchParams.get('project');
      const all = readJ('annotations.json', {});
      if (pid) return sendJ(all[String(pid)] || []);
      const counts = {};
      Object.keys(all).forEach(k => { counts[k] = all[k].length; });
      return sendJ(counts);
    }
    // POST /api/telegram/send {chatId,text} — ارسال از سایت به تلگرام (توکن روی سرور)
    if (urlPath === '/api/telegram/send') return done(async (b) => {
      // فقط با هدر x-send-secret برابر SEND_SECRET (بدون این متغیر، این مسیر بسته است)
      const want = process.env.SEND_SECRET || '';
      if (!want || req.headers['x-send-secret'] !== want) return sendJ({ ok: false, error: 'forbidden' }, 403);
      try {
        const j = JSON.parse(b || '{}');
        let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'telegram', 'config.json'), 'utf8')); } catch (e) {}
        const botToken = process.env.BOT_TOKEN || cfg.botToken || '';
        const chatId = j.chatId || process.env.TELEGRAM_CHANNEL_ID || cfg.channelId || cfg.channel || '';
        if (!botToken) return sendJ({ ok: false, error: 'no-bot-token' }, 501);
        if (!chatId) return sendJ({ ok: false, error: 'no-chat-id' }, 501);
        const tgRes = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: String(j.text || '').slice(0, 4000), parse_mode: 'HTML' })
        });
        return sendJ({ ok: tgRes.ok });
      } catch (e) { return sendJ({ ok: false }, 500); }
    });
    // GET /api/cron-daily — «اثر روز» را (اگر امروز پست نشده) می‌فرستد.
    // روی Render پلن رایگان cron داخلی نیست؛ یک سرویس پینگ رایگان
    // (مثل cron-job.org) این آدرس را روزی یک‌بار ساعت ۰۴:۳۰ UTC صدا می‌زند.
    // امنیت: اگر CRON_SECRET ست باشد، کلید باید در کوئری `key` بیاید.
    if (urlPath === '/api/cron-daily') {
      const secret = process.env.CRON_SECRET || '';
      let q = '';
      try { q = new URL(req.url, 'http://localhost').searchParams.get('key') || ''; } catch (e) {}
      if (secret && q !== secret) { res.writeHead(403); res.end('bad key'); return; }
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      let st = {};
      try { st = JSON.parse(fs.readFileSync(path.join(DATA, 'daily.json'), 'utf8')); } catch (e) {}
      // bot-core کاملاً به توکن نیاز دارد و در نبودش process.exit می‌کند؛ اینجا هرگز آن را نصب نکن
      if (!process.env.BOT_TOKEN && !fs.existsSync(path.join(ROOT, 'telegram', 'config.json'))) {
        res.writeHead(501, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'no-bot-token' })); return;
      }
      try {
        const bot = require('../../telegram/bot-core.js');
        // قفل روزانه داخل postDaily (Supabase) است؛ اینجا نیازی به daily.json نیست
        bot.postDaily().then((r) => console.log('[serve] daily:', r && r.skipped ? 'already posted today' : 'posted')).catch((err) => {
          console.error('[serve] daily post failed:', err && err.message);
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message })); }
      return;
    }
    if (urlPath === '/api/session-login/start' && req.method === 'POST') {
      require('../../telegram/session-login.js').startLogin()
        .then((j) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); })
        .catch((e) => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message })); });
      return;
    }
    if (urlPath === '/api/session-login/status' && req.method === 'GET') {
      const code = new URL(req.url, 'http://localhost').searchParams.get('code') || '';
      require('../../telegram/session-login.js').statusLogin(code)
        .then((j) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); })
        .catch((e) => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message })); });
      return;
    }
    if (urlPath === '/api/ocr/engines' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(require('../../telegram/ocr-engines.js').status()));
      return;
    }
    if (urlPath === '/api/ocr' && req.method === 'POST') {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => { size += c.length; if (size <= 15 * 1024 * 1024) chunks.push(c); });
      req.on('end', async () => {
        if (size > 15 * 1024 * 1024) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'too large' })); return; }
        try {
          const sp = new URL(req.url, 'http://localhost').searchParams;
          const text = await require('../../telegram/ocr-engines.js').run(sp.get('engine') || 'google', Buffer.concat(chunks), sp.get('lang') || 'fa');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, text: text }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }    res.writeHead(404); res.end('Unknown api'); return;
  }

  // Image proxy — fetch and relay binary images from external hosts
  if (urlPath === '/proxy-image') {
      const params = new URL(req.url, 'http://localhost').searchParams;
      // get() already percent-decodes once. If the client double-encoded the
      // URL, decode again — the old code passed the encoded string to https.get()
      // and the resulting Invalid URL throw killed the whole server process.
      let imgUrl = params.get('url');
      if (!imgUrl) { res.writeHead(400); res.end('Missing url'); return; }
      if (/%3A%2F%2F/i.test(imgUrl)) { try { imgUrl = decodeURIComponent(imgUrl); } catch (e) {} }
      let imgHost = '';
      try { imgHost = new URL(imgUrl).hostname; }
      catch (e) { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('Bad url'); return; }
      if (!PROXY_HOSTS.some(h => imgHost === h || imgHost.endsWith('.' + h))) {
        res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('Host not allowed'); return;
      }
      function proxyImg(targetUrl, depth) {
      if (depth > 5) { res.writeHead(508); res.end('Too many redirects'); return; }
      const mod = targetUrl.startsWith('https') ? https : http;
      const req = mod.get(targetUrl, {
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
          if (redirectBlocked(loc, res)) return;
          return proxyImg(loc, depth + 1);
        }
        const chunks = [];
        let _capped = false;
        proxyRes.on('data', chunk => { if (!_capped) { chunks.push(chunk); if (chunks.length > 60) _capped = true; } });
        proxyRes.on('end', () => {
          if (res.writableEnded) return;
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
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(data);
        });
      });
      req.on('error', (err) => {
        if (res.writableEnded) return;
        try { res.writeHead(502, { 'Content-Type': 'text/plain' }); } catch (e) { return; }
        res.end('Proxy error: ' + String(err.message || err).slice(0, 200));
      });
      req.on('timeout', function() {
        try { this.destroy(); } catch (e) {}
        if (res.writableEnded) return;
        try { res.writeHead(504); } catch (e) { return; }
        res.end('Proxy timeout');
      });
    }
    proxyImg(imgUrl, 0);
    return;
  }

  let filePath = path.join(ROOT, urlPath);
  if ((filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) || urlPath.indexOf('\0') >= 0 || /(^|\/)\.git(\/|$)/.test(urlPath)) { res.writeHead(403); res.end('Forbidden'); return; }
  // The gateway tokens live in these files: readable from this machine, never over the network.
  // telegram/config.json holds the bot token for the same reason.
  if (/(^|\/)(llm|tts)-config\.json$/i.test(urlPath) || /(^|\/)telegram\/config\.json$/i.test(urlPath)) {
    const ra = req.socket.remoteAddress || '';
    if (!(ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1')) { res.writeHead(403); res.end('Forbidden'); return; }
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found: ' + urlPath); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`coreader preview: http://localhost:${PORT}`));
