// loc_fetch.js — fetch a www.loc.gov URL through headless Chrome.
//
// Cloudflare challenge-protects loc.gov's /resource/* endpoints: plain
// fetch() (browser), Node https, curl and headless-without-profile all get
// "Just a moment...". A real Chrome with a persistent profile solves the
// challenge once, reuses the cf_clearance cookie afterwards.
//
// Usage: node src/build/loc_fetch.js <url>
// stdout = response body (manifest JSON). exit 1 = challenge not solved in time.
'use strict';
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => { try { require('fs').accessSync(p); return true; } catch (e) { return false; } });

const PROFILE = path.join(__dirname, '..', '..', 'node_modules', '.cache', 'loc-profile');
const url = process.argv[2];
if (!url || !CHROME) { console.error('usage: node loc_fetch.js <url>'); process.exit(2); }

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    // Headed (positioned offscreen) — Cloudflare is far more likely to pass a
    // real window than headless; HEADLESS=1 forces headless mode.
    headless: process.env.HEADLESS === '1' ? 'new' : false,
    userDataDir: PROFILE,
    // strip puppeteer's automation fingerprints — Cloudflare Turnstile
    // otherwise loops forever on the challenge page
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--no-first-run', '--disable-gpu', '--lang=en-US',
           '--disable-blink-features=AutomationControlled',
           '--window-size=600,400', '--window-position=4000,4000'],
  });
  try {
    const page = await browser.newPage();
    // soften the obvious automation flag
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const state = () => page.evaluate(() => {
      const t = document.body ? document.body.innerText : '';
      if (!t) return 'empty';
      // challenge / mid-verification markers — keep waiting
      if (/Just a moment|security verification|Verifying you are human|Checking your browser|Attention Required/i.test(t)) return 'challenge';
      return t.length > 50 ? 'ok' : 'empty';
    }).catch(() => 'error');
    const waitFor = async (secs) => {
      for (let i = 0; i < secs * 2; i++) { if (await state() === 'ok') return true; await sleep(500); }
      return (await state()) === 'ok';
    };
    // Turnstile frame is an OOPIF — it exists (page.frames() lists it) but the
    // host <iframe> isn't reachable from page JS (shadow DOM). Resolve owner
    // node + quads through CDP (pierces shadow roots), click by coordinates.
    const clickTurnstile = async () => {
      let quad = null;
      try {
        const client = await page.createCDPSession();
        const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
        const stack = [root]; let node = null;
        while (stack.length) {
          const n = stack.pop();
          if (n.nodeName === 'IFRAME') { node = n; break; }
          (n.children || []).forEach(c => stack.push(c));
          (n.shadowRoots || []).forEach(c => stack.push(c));
        }
        if (node && node.nodeId) {
          const q = await client.send('DOM.getContentQuads', { nodeId: node.nodeId });
          quad = (q.quads || []).find(a => a && a.length === 8 && (a[2] - a[0]) > 40 && (a[5] - a[1]) > 40);
        }
        await client.detach();
      } catch (e) { console.error('loc_fetch: cdp quad error ' + e.message); }
      if (!quad) { console.error('loc_fetch: turnstile frame quad not found'); return false; }
      const cx = quad[0] + 30, cy = (quad[1] + quad[5]) / 2;
      await page.mouse.move(quad[0] + 15, cy, { steps: 8 });
      await sleep(250);
      await page.mouse.click(cx, cy);
      console.error('loc_fetch: clicked turnstile at ' + Math.round(cx) + ',' + Math.round(cy));
      return true;
    };

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    let ok = await waitFor(8);                 // some challenges auto-solve
    if (!ok) { await clickTurnstile(); ok = await waitFor(40); }
    if (!ok) {                                 // one full retry
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      ok = await waitFor(6);
      if (!ok) { await clickTurnstile(); ok = await waitFor(30); }
    }
    const text = ok ? await page.evaluate(() => document.body.innerText) : null;
    if (!text) {
      // debug artifact: what did the challenge actually look like?
      try {
        const shot = path.join(PROFILE, 'last-challenge.png');
        await page.screenshot({ path: shot });
        console.error('loc_fetch: screenshot at ' + shot);
      } catch (e) {}
      console.error('loc_fetch: challenge not solved within timeout');
      process.exit(1);
    }
    process.stdout.write(text);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('loc_fetch: ' + e.message); process.exit(1); });
