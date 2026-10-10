/* Translation layer.
 *
 * One small button opens a panel: source language, target language, which
 * engine, the colour of the translated lines, and how visible they are.
 *
 * What this does that the first version did not:
 *
 *   1. It translates units, not fragments. The old layer walked text nodes and
 *      handed each one to the engine on its own, so a clause the page had
 *      split across spans came back word by word. Now the page is broken into
 *      its block-level lines and each whole line goes at once, which is what
 *      gives the engine enough context to write a sentence.
 *   2. A translated line sits under the line it belongs to instead of being
 *      painted over the original, so both stay readable and comparable. The
 *      font is inherited from the text box; only the colour is a setting.
 *   3. It is more than one engine. Google's public endpoint is the best of the
 *      free, keyless ones - checked on the same literary sentence, where it
 *      gave «سکوت کامل در کتابخانه حاکم بود و هر صفحه طوری ورق می‌زد که انگار
 *      روحی در دام افتاده بود» against MyMemory's flatter wording - so it is
 *      the default. MyMemory stays because it is a genuinely different engine
 *      with its own translation memory, and the automatic mode falls through
 *      to it when Google refuses.
 *   4. "جدا کردن" lifts every translated line out of the text into a panel
 *      that follows the pointer, and puts them back under the lines on request.
 *
 * Nothing in the live page is replaced, which is why turning a page or
 * re-rendering the text cannot lose anything.
 *
 *   TR.open()     show the panel
 *   TR.run()      translate whatever container this page resolves to
 *   TR.refresh()  re-translate after the page changed (auto while a layer is up)
 *   TR.detach(on) move the layer out of the text / put it back
 *   TR.text(q)    translate one string with the chosen engine
 */
(function () {
  'use strict';

  var LANGS = [
    ['auto', 'خودکار'], ['fa', 'فارسی'], ['en', 'انگلیسی'], ['ar', 'عربی'],
    ['fr', 'فرانسوی'], ['de', 'آلمانی'], ['es', 'اسپانیایی'], ['it', 'ایتالیایی'],
    ['tr', 'ترکی'], ['ru', 'روسی'], ['zh', 'چینی'], ['ja', 'ژاپنی'],
    ['hi', 'هندی'], ['he', 'عبری'], ['pt', 'پرتغالی'], ['nl', 'هلندی'],
    ['sv', 'سوئدی'], ['pl', 'لهندی'], ['uk', 'اوکراینی'], ['id', 'اندونزیایی']
  ];
  var RTL = { fa: 1, ar: 1, he: 1, ur: 1, ps: 1, ckb: 1, yi: 1, sd: 1, ku: 1 };
  var BATCH = 40;
  var CONTAINERS = ['#textContent', '#tc', '.text-content', '.ps-txt', 'article', 'main'];

  var src = 'auto', dst = 'fa', opacity = 65, engine = 'google', color = '#8fd0a0';
  var detached = false;
  try {
    src = localStorage.getItem('coreader-tr-src') || src;
    dst = localStorage.getItem('coreader-tr-dst') || dst;
    opacity = +(localStorage.getItem('coreader-tr-op') || opacity);
    engine = localStorage.getItem('coreader-tr-engine') || engine;
    color = localStorage.getItem('coreader-tr-color') || color;
  } catch (e) {}
  var btn = null, panel = null, floatBox = null;
  var blocks = [], outs = [], source = null;
  var observer = null, refreshTimer = null, running = false, drag = null;

  function save() {
    try {
      localStorage.setItem('coreader-tr-src', src);
      localStorage.setItem('coreader-tr-dst', dst);
      localStorage.setItem('coreader-tr-op', String(opacity));
      localStorage.setItem('coreader-tr-engine', engine);
      localStorage.setItem('coreader-tr-color', color);
    } catch (e) {}
  }
  function toFA(n) { return String(n).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  /* ---------------- engines -------------------------------------------- */
  function gtx(q, sl, tl) {
    var url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=' +
      encodeURIComponent(sl) + '&tl=' + encodeURIComponent(tl) +
      '&dt=t&q=' + encodeURIComponent(q);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !j[0]) throw new Error('bad payload');
      return j[0].map(function (s) { return s && s[0] || ''; }).join('');
    });
  }
  function mymemory(q, sl, tl) {
    var url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q) +
      '&langpair=' + encodeURIComponent((sl === 'auto' ? 'en' : sl) + '|' + tl);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var t = j && j.responseData && j.responseData.translatedText;
      if (!t) throw new Error('bad payload');
      return t;
    });
  }
  var ENGINES = {
    google: { label: 'گوگل — بهترین کیفیت (پیش‌فرض)', fn: gtx },
    mymemory: { label: 'MyMemory — حافظهٔ ترجمه', fn: mymemory },
    auto: { label: 'خودکار — گوگل، و در صورت خطا MyMemory', fn: null }
  };
  function one(text, sl, tl, which) {
    var id = which || engine;
    if (id === 'auto') return gtx(text, sl, tl).catch(function () { return mymemory(text, sl, tl); });
    var e = ENGINES[id] || ENGINES.google;
    return e.fn(text, sl, tl);
  }
  /* One batch of strings in, one batch of strings out. Joined with newlines
   * because the endpoint answers one segment per line; if it answers some
   * other number, fall back to asking about them one at a time rather than
   * lining the translation up against the wrong sentences. */
  function translateBatch(list, sl, tl, which) {
    var joined = list.join('\n');
    return one(joined, sl, tl, which).then(function (out) {
      var parts = String(out).split('\n');
      if (parts.length === list.length) return parts;
      var chain = Promise.resolve([]);
      list.forEach(function (single) {
        chain = chain.then(function (acc) {
          return one(single, sl, tl, which).then(
            function (t) { acc.push(t); return acc; },
            function () { acc.push(single); return acc; });
        });
      });
      return chain;
    });
  }
  function translateAll(list, sl, tl) {
    var out = new Array(list.length);
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve(out);
      var slice = list.slice(i, i + BATCH);
      var at = i;
      i += BATCH;
      return translateBatch(slice, sl, tl).then(function (part) {
        for (var k = 0; k < slice.length; k++) out[at + k] = part[k] || slice[k];
        return next();
      }, function () {
        for (var k = 0; k < slice.length; k++) out[at + k] = slice[k];
        return next();
      });
    }
    return next();
  }

  /* ---------------- the text this page is about -------------------------- */
  function resolveContainer() {
    /* innerText is not enough: a collapsed or hidden element hands back its
     * text anyway, and a layer built on a zero-size box lands nowhere. */
    for (var i = 0; i < CONTAINERS.length; i++) {
      var el = document.querySelector(CONTAINERS[i]);
      if (!el) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 20) continue;
      if (!(el.innerText || '').trim()) continue;
      return el;
    }
    return null;
  }
  var BLOCKY = /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|SECTION|ARTICLE|FIGCAPTION|TD|TH|PRE)$/;
  /* The deepest block elements that carry text of their own: one entry per
   * line of the page, which is the unit a reader thinks in. */
  function collectBlocks(root) {
    var out = [];
    (function walk(el) {
      var direct = '', hasBlockKid = false;
      for (var i = 0; i < el.childNodes.length; i++) {
        var c = el.childNodes[i];
        if (c.nodeType === 3) direct += c.nodeValue;
      }
      var kids = [];
      for (var j = 0; j < el.children.length; j++) {
        var kid = el.children[j];
        if (kid.classList && (kid.classList.contains('tr-line') || kid.classList.contains('tr-float'))) continue;
        kids.push(kid);
        if (BLOCKY.test(kid.nodeName)) hasBlockKid = true;
      }
      if (direct.trim() && !hasBlockKid) { out.push(el); return; }
      for (var k = 0; k < kids.length; k++) walk(kids[k]);
    })(root);
    return out.filter(function (el) {
      if (el.classList && el.classList.contains('tr-line')) return false;
      return (el.textContent || '').replace(/\s+/g, ' ').trim().length > 1;
    });
  }

  /* ---------------- the layer -------------------------------------------- */
  function style() {
    if (document.getElementById('trStyle')) return;
    var s = document.createElement('style');
    s.id = 'trStyle';
    s.textContent =
      '.tr-line{font-family:inherit;font-size:.95em;line-height:1.85;color:' + color + ';' +
      'margin:1px 0 12px;padding-inline-start:10px;border-inline-start:2px solid ' + color + '44;' +
      'opacity:' + (opacity / 100) + ';transition:opacity .2s}' +
      '#trFloat{position:fixed;z-index:2147482900;display:none;width:min(360px,80vw);max-height:70vh;' +
      'overflow:auto;direction:rtl;background:rgba(20,22,27,.97);color:#e9e7e2;' +
      'border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:0 0 8px;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.5);font-size:13px;line-height:1.9}' +
      '#trFloat.on{display:block}' +
      '#trFloat .hd{position:sticky;top:0;display:flex;align-items:center;gap:8px;padding:7px 11px;' +
      'background:rgba(30,33,40,.98);border-bottom:1px solid rgba(255,255,255,.14);cursor:move;' +
      'font:600 11px/1 system-ui,sans-serif;color:#b9b5ad}' +
      '#trFloat .hd button{margin-inline-start:auto;border:none;background:transparent;color:#b9b5ad;' +
      'cursor:pointer;font-size:13px;padding:2px 5px}' +
      '#trFloat .hd button:hover{color:#e9e7e2}' +
      '#trFloat .bd{padding:8px 11px 0}' +
      '#trBtn{position:fixed;left:8px;bottom:36px;z-index:2147483000;min-width:34px;height:22px;' +
      'padding:0 8px;border-radius:11px;direction:rtl;font:600 11px/22px system-ui,sans-serif;' +
      'cursor:pointer;letter-spacing:0;background:rgba(16,18,22,.86);color:#e9e7e2;' +
      'border:1px solid rgba(255,255,255,.18)}\n' +
      '#trPanel{position:fixed;left:8px;bottom:64px;z-index:2147483001;display:none;width:252px;' +
      'direction:rtl;text-align:right;background:rgba(18,20,25,.96);color:#e9e7e2;' +
      'border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:10px 11px;' +
      'font:400 12px/1.7 system-ui,sans-serif;box-shadow:0 8px 26px rgba(0,0,0,.45)}\n' +
      '#trPanel.on{display:block}\n' +
      '#trPanel .row{display:flex;align-items:center;gap:7px;margin:6px 0}\n' +
      '#trPanel label{width:44px;color:#b9b5ad;font-size:11px}\n' +
      '#trPanel select{flex:1;min-width:0;background:#0e1014;color:#e9e7e2;border:1px solid rgba(255,255,255,.18);' +
      'border-radius:5px;padding:3px 5px;font-size:12px}\n' +
      '#trPanel input[type=range]{flex:1;min-width:0;accent-color:#7fb3ff}\n' +
      '#trPanel input[type=color]{width:32px;height:22px;padding:0;border:1px solid rgba(255,255,255,.2);' +
      'background:transparent;border-radius:5px;cursor:pointer}\n' +
      '#trPanel button{flex:1;border:1px solid rgba(255,255,255,.2);background:#1b2029;color:#e9e7e2;' +
      'border-radius:6px;padding:5px 6px;font-size:12px;cursor:pointer}\n' +
      '#trPanel button:hover{background:#252b36}\n' +
      '#trOpV{width:34px;text-align:left;color:#b9b5ad;font-size:11px}\n' +
      '#trMsg{min-height:16px;margin-top:5px;font-size:11px;color:#9fd3a8}\n';
    document.head.appendChild(s);
  }
  function paint() {
    for (var i = 0; i < outs.length; i++) {
      outs[i].style.color = color;
      outs[i].style.borderLeftColor = color + '44';
    }
  }
  function msg(text, bad) {
    var el = document.getElementById('trMsg');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = bad ? '#ff9d9d' : '#9fd3a8';
  }
  function clearOuts() {
    for (var i = 0; i < outs.length; i++) {
      if (outs[i] && outs[i].parentNode) outs[i].parentNode.removeChild(outs[i]);
    }
    outs = [];
  }

  function run() {
    if (running) return;
    source = resolveContainer();
    if (!source) { msg('متنی برای ترجمه پیدا نشد', true); return; }
    clearOuts();
    blocks = collectBlocks(source);
    var texts = blocks.map(function (el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); });
    if (!texts.length) { msg('متنی برای ترجمه پیدا نشد', true); return; }
    running = true;
    msg('در حال ترجمه…');
    translateAll(texts, src, dst).then(function (out) {
      // build against the DOM as it is now: a page turn may have replaced the
      // blocks while the request was in flight
      blocks = collectBlocks(source);
      for (var i = 0; i < blocks.length && i < out.length; i++) {
        var line = document.createElement('div');
        line.className = 'tr-line';
        line.setAttribute('lang', dst);
        line.setAttribute('dir', RTL[dst] ? 'rtl' : 'ltr');
        line.textContent = out[i];
        line.style.opacity = opacity / 100;
        blocks[i].parentNode.insertBefore(line, blocks[i].nextSibling);
        outs.push(line);
      }
      running = false;
      msg('ترجمه شد (' + toFA(outs.length) + ' سطر)');
      if (detached) detach(true);
      watch();
    }, function (e) {
      running = false;
      msg('ترجمه ناموفق: ' + (e && e.message || 'شبکه'), true);
    });
  }

  /* Follow the page: a page turn rewrites the container, and the layer has to
   * be rebuilt from what is on screen now. */
  function watch() {
    if (observer || !source || !outs.length) return;
    if (!window.MutationObserver) return;
    /* Writing the layer mutates the container it watches, so without a
     * filter the observer would see our own lines, rebuild, and re-translate
     * itself forever. Mutations that only add or remove a .tr-line are the
     * layer talking to itself, not the page turning. */
    observer = new MutationObserver(function (muts) {
      for (var m = 0; m < muts.length; m++) {
        var nodes = [].slice.call(muts[m].addedNodes).concat([].slice.call(muts[m].removedNodes));
        var own = nodes.length > 0 && nodes.every(function (n) {
          return n.nodeType === 1 && n.classList && n.classList.contains('tr-line');
        });
        if (!own) { clearTimeout(refreshTimer); refreshTimer = setTimeout(run, 700); return; }
      }
    });
    observer.observe(source, { childList: true, subtree: true, characterData: true });
  }

  /* ---------------- detach & move ---------------------------------------- */
  /* A line under each line is right for reading along, and wrong the moment
   * you want the translation beside the page instead. One button lifts every
   * translated line into a panel that follows the pointer. */
  function ensureFloat() {
    if (floatBox) return floatBox;
    floatBox = document.createElement('div');
    floatBox.id = 'trFloat';
    floatBox.innerHTML = '<div class="hd"><span>ترجمه — جابه‌جاپذیر</span>' +
      '<button type="button" title="چسباندن دوباره زیر متن" id="trReattach">↩</button></div>' +
      '<div class="bd"></div>';
    document.body.appendChild(floatBox);
    floatBox.querySelector('.hd').addEventListener('mousedown', function (e) {
      if (e.target && e.target.id === 'trReattach') return;
      var r = floatBox.getBoundingClientRect();
      drag = { x: e.clientX - r.left, y: e.clientY - r.top };
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!drag) return;
      floatBox.style.left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.x)) + 'px';
      floatBox.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.y)) + 'px';
    });
    document.addEventListener('mouseup', function () { drag = null; });
    document.getElementById('trReattach').onclick = function () {
      detach(false);
      var d = document.getElementById('trDetach');
      if (d) d.textContent = 'جدا کردن';
    };
    return floatBox;
  }
  function detach(on) {
    detached = !!on;
    var box = ensureFloat();
    var bd = box.querySelector('.bd');
    if (detached) {
      for (var i = 0; i < outs.length; i++) bd.appendChild(outs[i]);
      if (!box.style.left) { box.style.left = '12px'; box.style.top = '72px'; }
      box.classList.add('on');
      msg('لایه جدا شد و جابه‌جا می‌شود');
    } else {
      for (var j = 0; j < outs.length; j++) {
        if (blocks[j] && blocks[j].parentNode) {
          blocks[j].parentNode.insertBefore(outs[j], blocks[j].nextSibling);
        }
      }
      box.classList.remove('on');
      msg('لایه دوباره زیر متن چسبانده شد');
    }
    return detached;
  }

  function dropLayer() {
    if (observer) { observer.disconnect(); observer = null; }
    clearOuts();
    if (floatBox) floatBox.classList.remove('on');
    detached = false;
    source = null; blocks = [];
  }

  /* ---------------- panel ------------------------------------------------ */
  function opt(list, sel) {
    return list.map(function (l) {
      return '<option value="' + l[0] + '"' + (l[0] === sel ? ' selected' : '') + '>' + l[1] + '</option>';
    }).join('');
  }
  function engineList() {
    return Object.keys(ENGINES).map(function (k) { return [k, ENGINES[k].label]; });
  }
  function open() {
    style();
    if (panel) panel.classList.add('on');
  }
  function close() {
    if (panel) panel.classList.remove('on');
  }
  function build() {
    style();
    btn = document.createElement('button');
    btn.id = 'trBtn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'ترجمهٔ متن صفحه');
    btn.title = 'ترجمهٔ متن صفحه';
    btn.textContent = 'ترجمه';
    btn.onclick = function () {
      if (panel.classList.contains('on')) close();
      else open();
    };

    panel = document.createElement('div');
    panel.id = 'trPanel';
    panel.innerHTML =
      '<div class="row"><label for="trSrc">مبدأ</label><select id="trSrc">' + opt(LANGS, src) + '</select></div>' +
      '<div class="row"><label for="trDst">مقصد</label><select id="trDst">' +
        opt(LANGS.filter(function (l) { return l[0] !== 'auto'; }), dst) + '</select></div>' +
      '<div class="row"><label for="trEngine">مترجم</label><select id="trEngine">' +
        opt(engineList(), engine) + '</select></div>' +
      '<div class="row"><label for="trColor">رنگ</label>' +
        '<input type="color" id="trColor" value="' + color + '"></div>' +
      '<div class="row"><label for="trOp">شفافیت</label>' +
        '<input type="range" id="trOp" min="10" max="100" value="' + opacity + '">' +
        '<span id="trOpV">' + toFA(opacity) + '٪</span></div>' +
      '<div class="row"><button type="button" id="trGo">ترجمه</button>' +
        '<button type="button" id="trDetach">جدا کردن</button>' +
        '<button type="button" id="trDrop">حذف لایه</button></div>' +
      '<div id="trMsg"></div>';

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    document.getElementById('trSrc').onchange = function () { src = this.value; save(); };
    document.getElementById('trDst').onchange = function () { dst = this.value; save(); };
    document.getElementById('trEngine').onchange = function () { engine = this.value; save(); };
    document.getElementById('trColor').oninput = function () { color = this.value; paint(); save(); };
    document.getElementById('trOp').oninput = function () {
      opacity = +this.value;
      document.getElementById('trOpV').textContent = toFA(opacity) + '٪';
      for (var i = 0; i < outs.length; i++) outs[i].style.opacity = opacity / 100;
      save();
    };
    document.getElementById('trGo').onclick = function () { run(); };
    document.getElementById('trDetach').onclick = function () {
      if (!outs.length) { msg('پیش از جدا کردن، متن را ترجمه کنید', true); return; }
      var on = detach(!detached);
      this.textContent = on ? 'چسباندن' : 'جدا کردن';
    };
    document.getElementById('trDrop').onclick = function () {
      dropLayer();
      var d = document.getElementById('trDetach');
      if (d) d.textContent = 'جدا کردن';
      msg('');
    };
  }

  ready(build);

  window.TR = {
    open: open,
    close: close,
    run: run,
    refresh: run,
    drop: dropLayer,
    detach: detach,
    engines: engineList,
    state: function () {
      return {
        src: src, dst: dst, opacity: opacity, engine: engine, color: color,
        layer: outs.length > 0, running: running, detached: detached,
        source: source ? (source.id || source.className || source.nodeName) : null,
        parts: outs.length, blocks: blocks.length
      };
    },
    /* Exposed so a test — and the lexicon, which turns foreign senses into
     * Persian — can translate one string without a page. */
    text: function (q, sl, tl, which) {
      return translateBatch([q], sl || src, tl || dst, which).then(function (r) { return r[0]; });
    }
  };
})();
