/* === translate.js - translate the text box with free engines / AI models ===
 *
 * Mounted automatically on:
 *   - the viewer's text pane  (#pane-text > #textContent)
 *   - the reader's text area  (#tc)
 *
 * What it does
 *   - Adds a "ترجمه" button to the text box. It opens a small panel: pick a model,
 *     the target language (and optionally the source language), then translate the
 *     whole page. "نمایش متن اصلی" puts the original text back exactly.
 *   - Works on the DOM, not on the render functions: every block of text is a "run"
 *     that is swapped for a <span class="tr-out"> and can be swapped back, so
 *     the host code keeps working and nothing is saved in translated form.
 *   - A MutationObserver translates the next page automatically (optional).
 *
 * Engines (all checked to be reachable from a browser page):
 *   google      Google Translate, batched GET, no key
 *   mymemory    MyMemory, no key, ~5000 chars/day per IP
 *   chrome      Chrome's on-device Translator API (only for language pairs it ships)
 *   puter:*     free AI models through Puter.js - free Puter account, sign-in popup
 *   or          OpenRouter ":free" models - needs the user's own free API key
 *   gem:*       Gemini API free tier   - needs the user's own free API key
 *
 * Text is only ever sent to the engine the user picked (never for "chrome").
 */
(function () {
  'use strict';
  if (window.CoreaderTranslate) return;

  /* ------------------------------------------------------------------ data */
  var LANGS = [
    ['fa', 'فارسی', 'Persian'], ['en', 'انگلیسی', 'English'], ['ar', 'عربی', 'Arabic'],
    ['fr', 'فرانسوی', 'French'], ['de', 'آلمانی', 'German'], ['es', 'اسپانیایی', 'Spanish'],
    ['it', 'ایتالیایی', 'Italian'], ['ru', 'روسی', 'Russian'], ['tr', 'ترکی استانبولی', 'Turkish'],
    ['zh-CN', 'چینی', 'Chinese (Simplified)'], ['ja', 'ژاپنی', 'Japanese'], ['ko', 'کره‌ای', 'Korean'],
    ['hi', 'هندی', 'Hindi'], ['ur', 'اردو', 'Urdu'], ['he', 'عبری', 'Hebrew'], ['nl', 'هلندی', 'Dutch'],
    ['pt', 'پرتغالی', 'Portuguese'], ['pl', 'لهستانی', 'Polish'], ['uk', 'اوکراینی', 'Ukrainian'],
    ['sv', 'سوئدی', 'Swedish']
  ];
  var LANG_EN = {}, LANG_FA = {};
  LANGS.forEach(function (l) { LANG_EN[l[0]] = l[2]; LANG_FA[l[0]] = l[1]; });

  var PUTER_MODELS = [
    ['gpt-5.4-nano', 'GPT-5.4 Nano'], ['gpt-5-nano', 'GPT-5 Nano'], ['gpt-5.4-mini', 'GPT-5.4 Mini'],
    ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite'], ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
    ['claude-haiku-5-5', 'Claude Haiku 5.5'], ['deepseek-v4.1-flash', 'DeepSeek V4.1 Flash'],
    ['mistral-small-2603', 'Mistral Small'], ['glm-5.3-flash', 'GLM 5.3 Flash'], ['gemma-4-31b-it', 'Gemma 4 31B']
  ];
  var GEMINI_MODELS = [['gemini-2.5-flash', 'Gemini 2.5 Flash'], ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite']];

  var PREF_KEY = 'coreader-translate-prefs';
  var DEFAULTS = { model: 'auto', target: 'en', source: 'auto', auto: true, orModel: '', keys: {} };

  /* --------------------------------------------------------------- helpers */
  function loadPrefs() {
    var p = {};
    try { p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) {}
    var o = {}; for (var k in DEFAULTS) o[k] = (k in p) ? p[k] : DEFAULTS[k];
    if (!o.keys || typeof o.keys !== 'object') o.keys = {};
    return o;
  }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {} }
  var prefs = loadPrefs();

  function toFA(n) { return String(n).replace(/[0-9]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function decodeEntities(s) { var t = document.createElement('textarea'); t.innerHTML = s; return t.value; }
  function hasLetters(s) { try { return /\p{L}/u.test(s); } catch (e) { return /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u0590-\u06FF\u0750-\u077F]/.test(s); } }
  function chromeCode(c) { return String(c).split('-')[0]; }

  var ABORT = { aborted: true };
  function errMsg(e) {
    if (!e) return 'خطای نامشخص';
    if (typeof e === 'string') return e;
    if (e.error && (e.error.message || typeof e.error === 'string')) return e.error.message || e.error;
    if (e.message) return e.message;
    try { return JSON.stringify(e).slice(0, 160); } catch (x) { return 'خطای نامشخص'; }
  }
  function netError(what) { var e = new Error('اتصال به ' + what + ' برقرار نشد (اینترنت قطع است یا سرویس مسدود است).'); e.retryable = true; return e; }
  function httpError(what, status, body) {
    var m;
    if (status === 429) m = what + ': تعداد درخواست‌ها زیاد است؛ کمی صبر کنید یا مدل دیگری انتخاب کنید.';
    else if (status === 401 || status === 403) m = what + ': دسترسی رد شد (کلید نامعتبر یا مسدود).';
    else m = what + ': خطای سرور (' + status + ')' + (body ? ' ' + String(body).slice(0, 120) : '');
    var e = new Error(m); e.status = status; e.retryable = (status === 429 || status >= 500); e.auth = (status === 401 || status === 403);
    return e;
  }

  /* ------------------------------------------------- language detection */
  function scriptLang(text) {
    var s = String(text || '');
    function c(re) { var m = s.match(re); return m ? m.length : 0; }
    var arab = c(/[\u0600-\u06FF\u0750-\u077F]/g), lat = c(/[A-Za-z\u00C0-\u024F]/g), cyr = c(/[\u0400-\u04FF]/g),
      heb = c(/[\u0590-\u05FF]/g), kana = c(/[\u3040-\u30FF]/g), han = c(/[\u4E00-\u9FFF]/g),
      hang = c(/[\uAC00-\uD7AF]/g), deva = c(/[\u0900-\u097F]/g);
    var best = Math.max(arab, lat, cyr, heb, kana, han, hang, deva);
    if (!best) return '';
    if (best === arab) {
      var fa = c(/[\u067E\u0686\u0698\u06AF\u06A9\u06CC]/g), ur = c(/[\u0679\u0688\u0691\u06BA\u06BE\u06C1\u06D2]/g);
      if (ur / arab > 0.02) return 'ur';
      return (fa / arab > 0.08) ? 'fa' : 'ar';
    }
    if (best === cyr) return 'ru';
    if (best === heb) return 'he';
    if (best === kana) return 'ja';
    if (best === han) return 'zh-CN';
    if (best === hang) return 'ko';
    if (best === deva) return 'hi';
    return 'latin';
  }
  function resolveSource(texts) {
    if (prefs.source && prefs.source !== 'auto') return Promise.resolve({ code: prefs.source, reliable: true });
    var sample = texts.join(' ').slice(0, 2000), d = scriptLang(sample);
    if (d && d !== 'latin') return Promise.resolve({ code: d, reliable: true });
    var LD = window.LanguageDetector;
    if (LD && LD.availability) {
      return LD.availability().then(function (a) {
        if (a !== 'available') return { code: 'en', reliable: false };
        return LD.create().then(function (det) { return det.detect(sample); }).then(function (r) {
          return (r && r[0] && r[0].confidence > 0.5) ? { code: r[0].detectedLanguage, reliable: true } : { code: 'en', reliable: false };
        });
      }).catch(function () { return { code: 'en', reliable: false }; });
    }
    return Promise.resolve({ code: d === 'latin' ? 'en' : '', reliable: false });
  }

  /* ----------------------------------------------------------- LLM helpers */
  function llmSystem(ctx) {
    var src = ctx.srcReliable && ctx.src ? LANG_EN[ctx.src] || ctx.src : 'the source language (detect it)';
    return 'You are an expert translator of classical manuscripts and literary texts. Translate every segment from ' + src +
      ' into ' + (LANG_EN[ctx.tgt] || ctx.tgt) + '. Keep the meaning faithful and poetic lines as separate lines. ' +
      'Never add notes, explanations or quotation marks. Keep numbers and proper names. ' +
      'If a segment is already in the target language, return it unchanged. ' +
      'The user message contains segments, each starting with a marker such as [[1]]. ' +
      'Reply with the same markers in the same order, each followed by its translation, and nothing else.';
  }
  function llmUser(batch) {
    return batch.map(function (t, i) { return '[[' + (i + 1) + ']] ' + String(t).replace(/\s*\n+\s*/g, ' '); }).join('\n');
  }
  function llmParse(out, n) {
    var res = new Array(n), re = /\[\[(\d+)\]\]\s*([\s\S]*?)(?=\n?\[\[\d+\]\]|$)/g, m;
    out = String(out || '').replace(/^```[a-z]*\n?|```$/g, '');
    while ((m = re.exec(out))) {
      var i = parseInt(m[1], 10) - 1;
      if (i >= 0 && i < n && m[2].trim()) res[i] = m[2].trim();
    }
    if (n === 1 && res[0] == null && out.trim() && !/\[\[\d+\]\]/.test(out)) res[0] = out.trim();
    return res;
  }

  /* --------------------------------------------------------------- engines */
  var Engines = {};

  Engines.google = {
    label: 'Google Translate', concurrency: 3, maxItems: 40, maxEncoded: 4800,
    cost: function (t) { return encodeURIComponent(t).length + 3; },
    translate: function (batch, ctx) {
      var sl = (ctx.srcReliable && ctx.src) ? ctx.src : 'auto';
      var eps = ['https://translate.googleapis.com/translate_a/t?client=gtx&dt=t', 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex'];
      var lastErr = null;
      function tryEp(i) {
        if (i >= eps.length) return Promise.reject(lastErr || netError('Google Translate'));
        var url = eps[i] + '&sl=' + encodeURIComponent(sl) + '&tl=' + encodeURIComponent(ctx.tgt) + '&' +
          batch.map(function (q) { return 'q=' + encodeURIComponent(q); }).join('&');
        return fetch(url).then(function (r) {
          if (!r.ok) { lastErr = httpError('Google Translate', r.status); return tryEp(i + 1); }
          return r.json().then(function (j) {
            if (typeof j === 'string') j = [j];
            if (!Array.isArray(j)) j = [j];
            var out = j.map(function (x) { return Array.isArray(x) ? x[0] : x; });
            if (out.length !== batch.length) { lastErr = new Error('Google Translate: پاسخ ناقص بود.'); return tryEp(i + 1); }
            return out.map(function (s) { return typeof s === 'string' ? s : null; });
          });
        }, function () { lastErr = netError('Google Translate'); return tryEp(i + 1); });
      }
      return tryEp(0);
    }
  };

  function splitSentences(text, max) {
    if (text.length <= max) return [text];
    var parts = text.match(/[^.!?؟۔。\n]+[.!?؟۔。]*\s*/g) || [text], out = [], cur = '';
    parts.forEach(function (p) {
      while (p.length > max) { if (cur) { out.push(cur); cur = ''; } out.push(p.slice(0, max)); p = p.slice(max); }
      if ((cur + p).length > max) { out.push(cur); cur = p; } else cur += p;
    });
    if (cur) out.push(cur);
    return out;
  }

  Engines.mymemory = {
    label: 'MyMemory', concurrency: 2, maxItems: 1, maxEncoded: 1e9,
    cost: function () { return 1; },
    translate: function (batch, ctx) {
      var src = ctx.src && ctx.src !== 'latin' ? ctx.src : 'en';
      if (src === ctx.tgt) return Promise.resolve(batch.slice());
      function one(text) {
        var pieces = splitSentences(text, 440), out = [];
        return pieces.reduce(function (p, piece) {
          return p.then(function () {
            var url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(piece) + '&langpair=' + encodeURIComponent(src + '|' + ctx.tgt);
            return fetch(url).then(function (r) {
              if (!r.ok) throw httpError('MyMemory', r.status);
              return r.json();
            }, function () { throw netError('MyMemory'); }).then(function (j) {
              var t = j && j.responseData && j.responseData.translatedText;
              if (j && (Number(j.responseStatus) === 429 || j.quotaFinished || /MYMEMORY WARNING/i.test(String(t || '')))) {
                var q = new Error('سهمیهٔ روزانهٔ MyMemory تمام شده است؛ مدل دیگری انتخاب کنید.'); q.fatal = true; throw q;
              }
              if (!j || Number(j.responseStatus) !== 200 || typeof t !== 'string') throw new Error('MyMemory: ' + String((j && j.responseDetails) || 'پاسخ نامعتبر').slice(0, 120));
              out.push(decodeEntities(t));
            });
          });
        }, Promise.resolve()).then(function () { return out.join(' '); });
      }
      return Promise.all(batch.map(one));
    }
  };

  var chromeCache = {};
  Engines.chrome = {
    label: 'مترجم داخلی Chrome', concurrency: 1, maxItems: 1, maxEncoded: 1e9,
    cost: function () { return 1; },
    availability: function (src, tgt) {
      if (!('Translator' in self)) return Promise.resolve('unsupported');
      if (!src) return Promise.resolve('unknown');
      return Translator.availability({ sourceLanguage: chromeCode(src), targetLanguage: chromeCode(tgt) }).catch(function () { return 'unavailable'; });
    },
    translate: function (batch, ctx) {
      var src = ctx.src && ctx.src !== 'latin' ? ctx.src : '';
      if (!src) return Promise.reject(Object.assign(new Error('برای مترجم داخلی، زبان مبدأ را دستی انتخاب کنید.'), { fatal: true }));
      var key = chromeCode(src) + '>' + chromeCode(ctx.tgt);
      var p = chromeCache[key];
      if (!p) {
        p = Engines.chrome.availability(src, ctx.tgt).then(function (a) {
          if (a === 'unsupported') throw Object.assign(new Error('این مرورگر مترجم داخلی ندارد (Chrome ۱۳۸ به بعد لازم است).'), { fatal: true });
          if (a === 'unavailable' || a === 'unknown') throw Object.assign(new Error('مترجم داخلی از ' + (LANG_FA[src] || src) + ' به ' + (LANG_FA[ctx.tgt] || ctx.tgt) + ' پشتیبانی نمی‌کند؛ مدل دیگری انتخاب کنید.'), { fatal: true });
          return Translator.create({
            sourceLanguage: chromeCode(src), targetLanguage: chromeCode(ctx.tgt),
            monitor: function (m) { m.addEventListener('downloadprogress', function (e) { ctx.status('دانلود مدل زبان: ' + toFA(Math.round(e.loaded * 100)) + '٪'); }); }
          });
        });
        chromeCache[key] = p;
        p.catch(function () { delete chromeCache[key]; });
      }
      return p.then(function (tr) { return tr.translate(batch[0]); }).then(function (s) { return [s]; });
    }
  };

  /* ---- Puter (free AI models, free Puter account) ---- */
  var puterLoad = null;
  function loadPuter() {
    if (window.puter) return Promise.resolve(window.puter);
    if (puterLoad) return puterLoad;
    puterLoad = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'https://js.puter.com/v2/'; s.async = true;
      var t = setTimeout(function () { rej(new Error('بارگذاری Puter ممکن نشد (اینترنت یا مسدودکنندهٔ تبلیغ).')); }, 20000);
      s.onload = function () { clearTimeout(t); if (window.puter) { try { window.puter.quiet = true; } catch (e) {} res(window.puter); } else rej(new Error('Puter بارگذاری شد ولی آماده نیست.')); };
      s.onerror = function () { clearTimeout(t); rej(new Error('بارگذاری Puter ممکن نشد (اینترنت یا مسدودکنندهٔ تبلیغ).')); };
      document.head.appendChild(s);
    });
    puterLoad.catch(function () { puterLoad = null; });
    return puterLoad;
  }
  function puterText(r) {
    if (typeof r === 'string') return r;
    var c = r && r.message && r.message.content;
    if (Array.isArray(c)) return c.map(function (x) { return (x && (x.text || x.content)) || (typeof x === 'string' ? x : ''); }).join('');
    if (typeof c === 'string') return c;
    if (r && r.text) return r.text;
    return r && r.toString ? String(r) : '';
  }
  var puterIds = null;
  function needLogin(msg) { var e = new Error(msg); e.fatal = true; e.needLogin = true; return e; }
  Engines.puter = {
    label: 'Puter AI', concurrency: 2, maxItems: 25, maxEncoded: 3200,
    cost: function (t) { return t.length + 8; },
    isSignedIn: function () { return loadPuter().then(function (p) { return Promise.resolve(p.auth.isSignedIn()); }); },
    signIn: function () { return loadPuter().then(function (p) { return Promise.resolve(p.auth.signIn()); }); },
    translate: function (batch, ctx) {
      var model = ctx.modelId;
      return loadPuter().then(function (p) {
        return Promise.resolve(p.auth.isSignedIn()).then(function (ok) {
          if (ok) return p;
          if (!ctx.interactive) throw needLogin('برای استفاده از مدل‌های Puter ابتدا از پنل ترجمه وارد حساب رایگان Puter شوید.');
          return Promise.resolve(p.auth.signIn()).then(function () { return p; }, function () { throw needLogin('ورود به Puter انجام نشد (پنجرهٔ ورود بسته یا مسدود شد). دکمهٔ «ورود به Puter» را بزنید.'); });
        });
      }).then(function (p) {
        var ids = puterIds ? Promise.resolve(puterIds) : Promise.resolve(p.ai.listModels()).then(function (l) { puterIds = l.map(function (m) { return m.id || m; }); return puterIds; }).catch(function () { return null; });
        return ids.then(function (list) {
          if (list && list.indexOf(model) < 0) { var e = new Error('مدل «' + model + '» فعلاً در Puter موجود نیست؛ مدل دیگری انتخاب کنید.'); e.fatal = true; throw e; }
          return p.ai.chat([{ role: 'system', content: llmSystem(ctx) }, { role: 'user', content: llmUser(batch) }], { model: model });
        });
      }).then(function (r) { return llmParse(puterText(r), batch.length); }, function (e) {
        if (e && (e.fatal || e.needLogin)) throw e;
        var m = errMsg(e), x = new Error('Puter: ' + m);
        if (/insufficient|funds|limit|quota|credit|payment/i.test(m)) { x.fatal = true; x.message = 'Puter: سهمیهٔ رایگان این مدل تمام شده است؛ مدل ارزان‌تر (Nano/Flash) یا مدل دیگری را امتحان کنید.'; }
        throw x;
      });
    }
  };

  /* ---- OpenRouter (free models, user's own free key) ---- */
  var orModels = null;
  function loadOrModels() {
    if (orModels) return Promise.resolve(orModels);
    return fetch('https://openrouter.ai/api/v1/models').then(function (r) { if (!r.ok) throw httpError('OpenRouter', r.status); return r.json(); })
      .then(function (j) {
        orModels = (j.data || []).filter(function (m) { return /:free$/.test(m.id); })
          .map(function (m) { return [m.id, m.name || m.id]; }).sort(function (a, b) { return a[1] < b[1] ? -1 : 1; });
        return orModels;
      }, function (e) { if (e && e.message) throw e; throw netError('OpenRouter'); });
  }
  Engines.or = {
    label: 'OpenRouter', concurrency: 1, maxItems: 20, maxEncoded: 2800,
    cost: function (t) { return t.length + 8; },
    translate: function (batch, ctx) {
      var key = prefs.keys.or;
      if (!key) return Promise.reject(Object.assign(new Error('کلید OpenRouter را در پنل وارد کنید.'), { fatal: true }));
      if (!prefs.orModel) return Promise.reject(Object.assign(new Error('یک مدل OpenRouter انتخاب کنید.'), { fatal: true }));
      return fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key, 'X-Title': 'Coreader' },
        body: JSON.stringify({ model: prefs.orModel, temperature: 0, messages: [{ role: 'system', content: llmSystem(ctx) }, { role: 'user', content: llmUser(batch) }] })
      }).then(function (r) {
        return r.text().then(function (t) {
          var j = null; try { j = JSON.parse(t); } catch (e) {}
          if (!r.ok || (j && j.error)) { var he = httpError('OpenRouter', r.status || 500, (j && j.error && j.error.message) || t); if (he.auth) he.fatal = true; throw he; }
          var c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          return llmParse(c, batch.length);
        });
      }, function (e) { if (e && e.status) throw e; throw netError('OpenRouter'); });
    }
  };

  /* ---- Gemini API (free tier, user's own free key) ---- */
  Engines.gem = {
    label: 'Gemini', concurrency: 1, maxItems: 25, maxEncoded: 3500,
    cost: function (t) { return t.length + 8; },
    translate: function (batch, ctx) {
      var key = prefs.keys.gem;
      if (!key) return Promise.reject(Object.assign(new Error('کلید Gemini را در پنل وارد کنید.'), { fatal: true }));
      return fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(ctx.modelId) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: llmSystem(ctx) }] },
          contents: [{ role: 'user', parts: [{ text: llmUser(batch) }] }],
          generationConfig: { temperature: 0 }
        })
      }).then(function (r) {
        return r.text().then(function (t) {
          var j = null; try { j = JSON.parse(t); } catch (e) {}
          if (!r.ok) { var he = httpError('Gemini', r.status, j && j.error && j.error.message); if (he.auth || r.status === 400) he.fatal = true; throw he; }
          var parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
          return llmParse((parts || []).map(function (p) { return p.text || ''; }).join(''), batch.length);
        });
      }, function (e) { if (e && e.status) throw e; throw netError('Gemini'); });
    }
  };

  /* Menu entries -> { chain, modelId } */
  function resolveModel(id) {
    if (id === 'auto') return { chain: ['google', 'mymemory'], modelId: '' };
    if (id.indexOf('puter:') === 0) return { chain: ['puter'], modelId: id.slice(6) };
    if (id.indexOf('gem:') === 0) return { chain: ['gem'], modelId: id.slice(4) };
    return { chain: [id in Engines ? id : 'google'], modelId: '' };
  }

  /* ----------------------------------------------------------- batch runner */
  var cache = {};
  function ckey(eid, ctx, t) { return eid + '|' + (ctx.modelId || (eid === 'or' ? prefs.orModel : '')) + '|' + (ctx.srcReliable ? ctx.src : 'auto') + '|' + ctx.tgt + '|' + t; }

  function makeBatches(texts, eng) {
    var out = [], cur = [], size = 0;
    texts.forEach(function (t) {
      var c = eng.cost(t);
      if (cur.length && (cur.length >= eng.maxItems || size + c > eng.maxEncoded)) { out.push(cur); cur = []; size = 0; }
      cur.push(t); size += c;
    });
    if (cur.length) out.push(cur);
    return out;
  }
  function withRetry(fn, ctx) {
    var n = 0;
    function go() {
      return fn().catch(function (e) {
        if (e === ABORT || ctx.aborted()) throw ABORT;
        if (e && e.retryable && !e.fatal && n < 2) { n++; return sleep(900 * n).then(go); }
        throw e;
      });
    }
    return go();
  }
  function runEngine(eid, items, ctx, onItem) {
    var eng = Engines[eid], byText = {}, order = [];
    items.forEach(function (it) {
      var k = ckey(eid, ctx, it.text), hit = cache[k];
      if (hit != null) { onItem(it.idx, hit); return; }
      if (!byText[it.text]) { byText[it.text] = []; order.push(it.text); }
      byText[it.text].push(it.idx);
    });
    var total = order.length, done = 0, failed = null, missing = [];
    function deliver(text, out) {
      if (out == null) { missing.push(text); return; }
      cache[ckey(eid, ctx, text)] = out;
      byText[text].forEach(function (i) { onItem(i, out); });
      done++; ctx.progress(done, total);
    }
    function runTasks(batches, limit) {
      var next = 0;
      function worker() {
        if (next >= batches.length || failed) return Promise.resolve();
        var b = batches[next++];
        if (ctx.aborted()) return Promise.reject(ABORT);
        return withRetry(function () { return eng.translate(b, ctx); }, ctx).then(function (res) {
          b.forEach(function (t, j) { deliver(t, res[j]); });
        }).catch(function (e) { if (e === ABORT) throw e; failed = e; }).then(worker);
      }
      var ws = []; for (var i = 0; i < Math.min(limit, batches.length); i++) ws.push(worker());
      return Promise.all(ws);
    }
    ctx.progress(0, total);
    return runTasks(makeBatches(order, eng), eng.concurrency).then(function () {
      if (failed) throw failed;
      if (!missing.length) return;
      var retry = missing.slice(); missing = [];
      return runTasks(retry.map(function (t) { return [t]; }), eng.concurrency).then(function () { if (failed) throw failed; });
    });
  }
  function runChain(chain, items, ctx, onItem) {
    var done = {}, remaining = items.slice(), lastErr = null, i = 0;
    function step() {
      if (!remaining.length) return Promise.resolve();
      if (i >= chain.length) return Promise.reject(lastErr || new Error('ترجمه کامل نشد.'));
      var eid = chain[i++];
      return runEngine(eid, remaining, ctx, function (idx, t) { done[idx] = 1; onItem(idx, t); }).then(function () {
        remaining = remaining.filter(function (x) { return !done[x.idx]; });
        if (remaining.length && i < chain.length) return step();
        if (remaining.length) return Promise.reject(new Error('بخشی از متن ترجمه نشد.'));
      }, function (e) {
        if (e === ABORT) throw e;
        lastErr = e; remaining = remaining.filter(function (x) { return !done[x.idx]; });
        if (e && (e.needLogin || (e.fatal && chain.length === 1))) throw e;
        if (i < chain.length) ctx.status(Engines[eid].label + ' پاسخ نداد؛ تلاش با ' + Engines[chain[i]].label + '…');
        return step();
      });
    }
    return step();
  }

  /* ------------------------------------------------------------ DOM runs */
  var INLINE = { A: 1, B: 1, I: 1, U: 1, S: 1, EM: 1, STRONG: 1, MARK: 1, SPAN: 1, SMALL: 1, SUB: 1, SUP: 1, FONT: 1, ABBR: 1, CITE: 1, BDI: 1, BDO: 1, DEL: 1, INS: 1, Q: 1, TIME: 1 };
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1, BUTTON: 1, SVG: 1, CANVAS: 1, IFRAME: 1, CODE: 1 };
  var BLOCK_SEL = 'p,div,li,ul,ol,table,tr,td,th,h1,h2,h3,h4,h5,h6,blockquote,section,article,pre,br,hr';

  function skipEl(n) {
    if (SKIP[n.tagName]) return true;
    if (n.classList && (n.classList.contains('tr-out') || n.classList.contains('notranslate'))) return true;
    if (n.hasAttribute('data-notranslate') || n.getAttribute('translate') === 'no') return true;
    return false;
  }
  function collectRuns(root) {
    var out = [];
    (function walk(parent) {
      var run = [];
      function flush() {
        if (!run.length) return;
        var txt = run.map(function (n) { return n.textContent; }).join('');
        if (hasLetters(txt)) out.push({ nodes: run, text: txt.replace(/^\s+|\s+$/g, ''), lead: (txt.match(/^\s*/) || [''])[0], trail: (txt.match(/\s*$/) || [''])[0] });
        run = [];
      }
      Array.prototype.slice.call(parent.childNodes).forEach(function (n) {
        if (n.nodeType === 3) { run.push(n); return; }
        if (n.nodeType !== 1) return;
        if (skipEl(n)) { flush(); return; }
        if (n.tagName === 'BR') { flush(); return; }
        if (INLINE[n.tagName] && !n.querySelector(BLOCK_SEL)) { run.push(n); return; }
        flush(); walk(n);
      });
      flush();
    })(root);
    return out;
  }

  /* ---------------------------------------------------------------- mount */
  var instances = [];

  function mount(opts) {
    var container = opts.container, btn = opts.button;
    var inst = { container: container, records: [], token: 0, on: false, running: false, ctl: null, observer: null, timer: null, internal: false };
    instances.push(inst);

    /* ---- panel ---- */
    var panel = el('div', { class: 'tr-panel', role: 'dialog', 'aria-label': 'ترجمهٔ متن', 'data-notranslate': '', hidden: '' });
    var selModel = el('select', { class: 'tr-model', 'aria-label': 'مدل ترجمه' });
    var selTarget = el('select', { class: 'tr-target', 'aria-label': 'زبان مقصد' });
    var selSource = el('select', { class: 'tr-source', 'aria-label': 'زبان متن' });
    var chkAuto = el('input', { type: 'checkbox', class: 'tr-auto' });
    var extras = el('div', { class: 'tr-extras' });
    var status = el('div', { class: 'tr-status', role: 'status', 'aria-live': 'polite' });
    var bar = el('div', { class: 'tr-progress', hidden: '' }, [el('div', { class: 'tr-progress-in' })]);
    var goBtn = el('button', { type: 'button', class: 'tr-go', text: 'ترجمهٔ این صفحه' });
    var origBtn = el('button', { type: 'button', class: 'tr-orig', text: 'نمایش متن اصلی' });
    var stopBtn = el('button', { type: 'button', class: 'tr-stop', text: 'توقف', hidden: '' });

    function group(sel, label, items) {
      var g = el('optgroup', { label: label });
      items.forEach(function (it) { g.appendChild(el('option', { value: it[0], text: it[1] })); });
      sel.appendChild(g);
    }
    group(selModel, 'پیشنهادی', [['auto', 'خودکار (Google ← MyMemory)']]);
    group(selModel, 'مترجم آنلاین — بدون هیچ تنظیمی', [['google', 'Google Translate'], ['mymemory', 'MyMemory (سهمیهٔ روزانهٔ کم)']]);
    if ('Translator' in self) group(selModel, 'روی همین دستگاه — بدون ارسال متن', [['chrome', 'مترجم داخلی Chrome (چند زبان)']]);
    group(selModel, 'هوش مصنوعی رایگان — Puter (ورود رایگان یک‌باره)', PUTER_MODELS.map(function (m) { return ['puter:' + m[0], m[1]]; }));
    group(selModel, 'هوش مصنوعی با کلید رایگان خودتان', [['or', 'OpenRouter — مدل‌های رایگان']].concat(GEMINI_MODELS.map(function (m) { return ['gem:' + m[0], m[1] + ' (Gemini)']; })));
    LANGS.forEach(function (l) { selTarget.appendChild(el('option', { value: l[0], text: l[1] })); });
    selSource.appendChild(el('option', { value: 'auto', text: 'تشخیص خودکار' }));
    LANGS.forEach(function (l) { selSource.appendChild(el('option', { value: l[0], text: l[1] })); });

    selModel.value = prefs.model; if (selModel.value !== prefs.model) { selModel.value = 'auto'; prefs.model = 'auto'; }
    selTarget.value = prefs.target; selSource.value = prefs.source; chkAuto.checked = !!prefs.auto;

    function row(label, ctl) { return el('label', { class: 'tr-row' }, [el('span', { text: label }), ctl]); }
    panel.appendChild(el('div', { class: 'tr-title' }, [el('span', { text: '🌐 ترجمهٔ متن' }), el('button', { type: 'button', class: 'tr-x', 'aria-label': 'بستن', text: '✕', onclick: closePanel })]));
    panel.appendChild(row('مدل', selModel));
    panel.appendChild(extras);
    panel.appendChild(row('به زبان', selTarget));
    panel.appendChild(row('از زبان', selSource));
    panel.appendChild(el('label', { class: 'tr-check' }, [chkAuto, el('span', { text: 'صفحه‌های بعدی هم خودکار ترجمه شوند' })]));
    panel.appendChild(el('div', { class: 'tr-actions' }, [goBtn, origBtn, stopBtn]));
    panel.appendChild(bar);
    panel.appendChild(status);
    panel.appendChild(el('div', { class: 'tr-note', text: 'متن این صفحه برای ترجمه به سرویس انتخاب‌شده فرستاده می‌شود (به‌جز مترجم داخلی Chrome). ترجمه ذخیره نمی‌شود و متن اصلی دست‌نخورده می‌ماند.' }));
    document.body.appendChild(panel);

    function setStatus(t, kind) { status.textContent = t || ''; status.className = 'tr-status' + (kind ? ' tr-' + kind : ''); }
    function setProgress(done, total) {
      if (!total) { bar.hidden = true; return; }
      bar.hidden = false; bar.firstChild.style.width = Math.round(100 * done / total) + '%';
      setStatus('در حال ترجمه… ' + toFA(done) + ' از ' + toFA(total));
    }
    function updateButton() {
      if (!btn) return;
      btn.classList.toggle('tr-on', inst.on);
      btn.setAttribute('aria-pressed', inst.on ? 'true' : 'false');
    }
    function setRunning(v) { inst.running = v; goBtn.disabled = v; stopBtn.hidden = !v; if (!v) bar.hidden = true; }

    /* ---- extras (depends on chosen model) ---- */
    function keyBox(kind, label, link) {
      var inp = el('input', { type: 'password', class: 'tr-key', placeholder: 'کلید API', autocomplete: 'off', value: prefs.keys[kind] || '' });
      inp.addEventListener('change', function () { prefs.keys[kind] = inp.value.trim(); savePrefs(); });
      extras.appendChild(el('div', { class: 'tr-sub' }, [el('span', { text: label }), inp]));
      extras.appendChild(el('div', { class: 'tr-hint' }, [el('a', { href: link, target: '_blank', rel: 'noopener', text: 'دریافت کلید رایگان' }), ' — کلید فقط در مرورگر شما ذخیره می‌شود.']));
    }
    function refreshExtras() {
      extras.textContent = '';
      var m = prefs.model;
      if (m === 'mymemory') extras.appendChild(el('div', { class: 'tr-hint', text: 'حدود ۵۰۰۰ نویسه در روز برای هر IP؛ برای صفحه‌های پرحجم Google بهتر است.' }));
      else if (m === 'chrome') {
        var line = el('div', { class: 'tr-hint', text: 'بررسی پشتیبانی…' }); extras.appendChild(line);
        var src = prefs.source !== 'auto' ? prefs.source : '';
        if (!src) line.textContent = 'برای این مترجم «از زبان» را دستی انتخاب کنید. فارسی در Chrome پشتیبانی نمی‌شود؛ بیشتر برای عربی، فرانسوی، آلمانی و… مناسب است.';
        else Engines.chrome.availability(src, prefs.target).then(function (a) {
          line.textContent = ({
            available: 'این جفت زبان آمادهٔ استفاده است.', downloadable: 'این جفت زبان پشتیبانی می‌شود؛ بار اول مدل زبان دانلود می‌شود.',
            downloading: 'مدل زبان در حال دانلود است.', unavailable: 'Chrome این جفت زبان را پشتیبانی نمی‌کند؛ مدل دیگری انتخاب کنید.',
            unsupported: 'این مرورگر مترجم داخلی ندارد.', unknown: ''
          })[a] || '';
        });
      } else if (m.indexOf('puter:') === 0) {
        var st = el('span', { class: 'tr-who', text: 'وضعیت ورود: بررسی نشده' });
        var inBtn = el('button', { type: 'button', class: 'tr-signin', text: 'ورود به Puter (رایگان)', onclick: function () {
          st.textContent = 'در حال باز کردن پنجرهٔ ورود…';
          Engines.puter.signIn().then(function () { st.textContent = 'وضعیت ورود: وارد شده‌اید ✓'; }, function (e) { st.textContent = 'ورود انجام نشد: ' + errMsg(e); });
        } });
        var chk = el('button', { type: 'button', class: 'tr-signin', text: 'بررسی وضعیت', onclick: function () {
          st.textContent = 'در حال بررسی…';
          Engines.puter.isSignedIn().then(function (ok) { st.textContent = ok ? 'وضعیت ورود: وارد شده‌اید ✓' : 'وضعیت ورود: هنوز وارد نشده‌اید'; }, function (e) { st.textContent = errMsg(e); });
        } });
        extras.appendChild(el('div', { class: 'tr-sub' }, [inBtn, chk]));
        extras.appendChild(el('div', { class: 'tr-hint' }, [st]));
        extras.appendChild(el('div', { class: 'tr-hint', text: 'این مدل‌ها با حساب رایگان Puter کار می‌کنند؛ مصرف از سهمیهٔ خود شما کسر می‌شود (نه از ما).' }));
      } else if (m === 'or') {
        keyBox('or', 'کلید OpenRouter', 'https://openrouter.ai/keys');
        var orSel = el('select', { class: 'tr-ormodel', 'aria-label': 'مدل OpenRouter' }, [el('option', { value: '', text: 'در حال بارگذاری فهرست مدل‌ها…' })]);
        extras.appendChild(el('label', { class: 'tr-row' }, [el('span', { text: 'مدل رایگان' }), orSel]));
        loadOrModels().then(function (list) {
          orSel.textContent = '';
          list.forEach(function (x) { orSel.appendChild(el('option', { value: x[0], text: x[1] })); });
          if (!prefs.orModel || !list.some(function (x) { return x[0] === prefs.orModel; })) prefs.orModel = list.length ? list[0][0] : '';
          orSel.value = prefs.orModel; savePrefs();
        }, function (e) { orSel.textContent = ''; orSel.appendChild(el('option', { value: '', text: 'فهرست بارگذاری نشد' })); setStatus(errMsg(e), 'err'); });
        orSel.addEventListener('change', function () { prefs.orModel = orSel.value; savePrefs(); });
      } else if (m.indexOf('gem:') === 0) keyBox('gem', 'کلید Gemini', 'https://aistudio.google.com/apikey');
    }

    selModel.addEventListener('change', function () { prefs.model = selModel.value; savePrefs(); refreshExtras(); setStatus(''); });
    selTarget.addEventListener('change', function () { prefs.target = selTarget.value; savePrefs(); refreshExtras(); });
    selSource.addEventListener('change', function () { prefs.source = selSource.value; savePrefs(); refreshExtras(); });
    chkAuto.addEventListener('change', function () { prefs.auto = chkAuto.checked; savePrefs(); });

    /* ---- panel open / close / position ---- */
    function place() {
      if (!btn) return;
      var r = btn.getBoundingClientRect(), w = Math.min(340, window.innerWidth - 16);
      panel.style.width = w + 'px';
      var left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
      var top = r.bottom + 6, maxH = window.innerHeight - top - 10;
      if (maxH < 280) { top = Math.max(8, window.innerHeight - 290 - 10); maxH = window.innerHeight - top - 10; }
      panel.style.left = left + 'px'; panel.style.top = top + 'px'; panel.style.maxHeight = maxH + 'px';
    }
    function openPanel() { refreshExtras(); panel.hidden = false; place(); if (btn) btn.setAttribute('aria-expanded', 'true'); }
    function closePanel() { panel.hidden = true; if (btn) btn.setAttribute('aria-expanded', 'false'); }
    inst.closePanel = closePanel; inst.openPanel = openPanel;
    if (btn) {
      btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); if (panel.hidden) openPanel(); else closePanel(); });
    }
    document.addEventListener('mousedown', function (e) { if (!panel.hidden && !panel.contains(e.target) && !(btn && btn.contains(e.target))) closePanel(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) closePanel(); });
    window.addEventListener('resize', function () { if (!panel.hidden) place(); });

    /* ---- restore ---- */
    function restoreAll() {
      inst.internal = true;
      inst.records.forEach(function (r) {
        var p = r.span.parentNode;
        if (!p) return;
        r.nodes.forEach(function (n) { p.insertBefore(n, r.span); });
        p.removeChild(r.span);
      });
      inst.records = [];
      if (inst.observer) inst.observer.takeRecords();
      inst.internal = false;
      container.classList.remove('tr-translated');
    }
    function cancelRun() { inst.token++; if (inst.ctl) inst.ctl.aborted = true; inst.ctl = null; }

    /* ---- translate (viewport-driven) ----
     * The host may keep a whole book in the container (the viewer does), so only the
     * runs near the visible area are translated; scrolling translates the rest. */
    function findScroller() {
      for (var p = container; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        var cs = getComputedStyle(p);
        if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 4) return p;
      }
      return null;
    }
    function viewRect() {
      var sc = findScroller();
      if (sc) { var r = sc.getBoundingClientRect(); return { top: Math.max(0, r.top), bottom: Math.min(window.innerHeight, r.bottom) }; }
      return { top: 0, bottom: window.innerHeight };
    }
    function runRect(run) {
      var n = run.nodes[0];
      if (n.nodeType === 3) { var rg = document.createRange(); rg.selectNodeContents(n); return rg.getBoundingClientRect(); }
      return n.getBoundingClientRect();
    }
    var MAX_PASS = 150;
    function pickRuns(all) {
      var v = viewRect(), h = Math.max(240, v.bottom - v.top), lo = v.top - h * 1.2, hi = v.bottom + h * 1.2, picked = [], far = 0, capped = false;
      for (var i = 0; i < all.length; i++) {
        var r = runRect(all[i]);
        if (!r.width && !r.height) { far++; continue; }
        if (r.bottom >= lo && r.top <= hi) { if (picked.length < MAX_PASS) picked.push(all[i]); else { capped = true; far++; } }
        else far++;
      }
      return { picked: picked, far: far, capped: capped };
    }

    function translateNow(interactive) {
      if (inst.running && !interactive) { inst.again = true; return Promise.resolve(); }
      cancelRun(); inst.again = false;
      var token = inst.token, ctl = { aborted: false }; inst.ctl = ctl;
      var all = collectRuns(container);
      if (!all.length) {
        if (interactive) setStatus(inst.records.length ? 'همهٔ متن این بخش ترجمه شده است.' : 'متنی برای ترجمه پیدا نشد.');
        setRunning(false); return Promise.resolve();
      }
      var pk = pickRuns(all), runs = pk.picked;
      if (!runs.length) {
        if (interactive) setStatus(inst.records.length ? 'بخش‌های نمایان ترجمه شده‌اند؛ با اسکرول بقیه ترجمه می‌شود.' : 'متنی در محدودهٔ دید نیست؛ به بخش متن بروید یا اسکرول کنید.');
        if (interactive) { inst.on = true; updateButton(); }
        setRunning(false); return Promise.resolve();
      }
      var sel = resolveModel(prefs.model), texts = runs.map(function (r) { return r.text; }), applied = 0;
      if (interactive) { inst.on = true; updateButton(); }
      setRunning(true); setStatus('در حال آماده‌سازی…');
      return resolveSource(texts).then(function (src) {
        if (token !== inst.token) throw ABORT;
        if (src.code === prefs.target && src.reliable) { setStatus('زبان متن با زبان مقصد یکی است.'); return; }
        var ctx = {
          src: src.code, srcReliable: src.reliable, tgt: prefs.target, modelId: sel.modelId, interactive: !!interactive,
          aborted: function () { return ctl.aborted || token !== inst.token; },
          status: function (t) { if (token === inst.token) setStatus(t); },
          progress: function (d, t) { if (token === inst.token) setProgress(d, t); }
        };
        var items = runs.map(function (r, i) { return { idx: i, text: r.text }; });
        function apply(idx, tr) {
          if (token !== inst.token) return;
          var run = runs[idx], first = run.nodes[0];
          if (!first || !first.parentNode) return;
          var span = el('span', { class: 'tr-out', dir: 'auto', lang: prefs.target, title: run.text.slice(0, 400) });
          span.textContent = run.lead + tr + run.trail;
          inst.internal = true;
          first.parentNode.insertBefore(span, first);
          run.nodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
          inst.records.push({ span: span, nodes: run.nodes });
          if (inst.observer) inst.observer.takeRecords();
          inst.internal = false;
          applied++;
        }
        return runChain(sel.chain, items, ctx, apply).then(function () {
          if (token !== inst.token) return;
          inst.on = true; container.classList.add('tr-translated'); updateButton();
          setStatus('ترجمه انجام شد (' + toFA(applied) + ' بخش).' + (pk.far ? ' با اسکرول، بخش‌های بعدی هم ترجمه می‌شوند.' : ''), 'ok');
          if (pk.capped) inst.again = true;
        });
      }).catch(function (e) {
        if (e === ABORT) return;
        if (inst.records.length) { inst.on = true; container.classList.add('tr-translated'); } else inst.on = false;
        updateButton();
        setStatus(errMsg(e), 'err'); inst.again = false;
        if (e && e.needLogin) { refreshExtras(); if (panel.hidden) openPanel(); }
      }).then(function () {
        if (token !== inst.token) return;
        setRunning(false);
        if (inst.again && inst.on) { inst.again = false; setTimeout(function () { translateNow(false); }, 60); }
      });
    }

    goBtn.addEventListener('click', function () { prefs.auto = chkAuto.checked; savePrefs(); translateNow(true); });
    origBtn.addEventListener('click', function () { cancelRun(); setRunning(false); restoreAll(); inst.on = false; updateButton(); setStatus('متن اصلی نمایش داده شد.'); });
    stopBtn.addEventListener('click', function () { cancelRun(); setRunning(false); inst.again = false; setStatus('متوقف شد.'); });

    /* ---- follow scrolling and page changes ---- */
    var scrollT = null;
    function onScroll(e) {
      if (!inst.on) return;
      var t = e && e.target;
      if (t && t !== document && t.nodeType === 1 && !(t.contains(container) || container.contains(t))) return;
      clearTimeout(scrollT);
      scrollT = setTimeout(function () { translateNow(false); }, 250);
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    inst.observer = new MutationObserver(function () {
      if (inst.internal || !inst.on) return;
      clearTimeout(inst.timer);
      inst.timer = setTimeout(function () {
        var alive = inst.records.some(function (r) { return r.span.isConnected; });
        if (inst.records.length && !alive) {            // the host replaced the content: a new page
          inst.records = []; container.classList.remove('tr-translated');
          if (!prefs.auto) { inst.on = false; updateButton(); setStatus('صفحه عوض شد؛ برای ترجمه دوباره «ترجمهٔ این صفحه» را بزنید.'); return; }
        } else {
          inst.records = inst.records.filter(function (r) { return r.span.isConnected; });
          if (!prefs.auto) return;
        }
        if (collectRuns(container).length) translateNow(false);
      }, 350);
    });
    inst.observer.observe(container, { childList: true, subtree: true });

    /* never let a translation leak into edited text */
    container.addEventListener('focusin', function (e) {
      if (inst.on && e.target && e.target.isContentEditable) {
        cancelRun(); setRunning(false); restoreAll(); inst.on = false; updateButton();
        setStatus('برای ویرایش، متن اصلی برگردانده شد.');
      }
    });

    updateButton();
    inst.translate = translateNow;
    inst.restore = function () { origBtn.click(); };
    inst.panel = panel;
    return inst;
  }

  /* ------------------------------------------------------- auto-mount hosts */
  function toolbarButton(id) {
    var anchor = document.getElementById('bSettings');
    var b = el('button', { type: 'button', id: id, text: '🌐 ترجمه', title: 'ترجمهٔ متن این صفحه با مدلهای رایگان' });
    if (anchor) { b.className = anchor.className; anchor.parentNode.insertBefore(b, anchor.nextSibling); }
    else { b.className = 'tr-btn tr-float'; document.body.appendChild(b); }
    return b;
  }
  /* If a toolbar button already exists (added by HTML), use it directly.
     Otherwise fall back to inserting after bSettings or to a floating button. */
  function getToolbarButton(id) {
    var existing = document.getElementById(id);
    if (existing) return existing;
    return toolbarButton(id);
  }
  /* The toolbar fills up and scrolls sideways, so a button appended to it can
     sit outside the screen. This one goes on the text box itself — at the top
     edge, centred, over its own container — where it cannot be missed. */
  /* The text box is usually taller than the window, so a button pinned to its
     top edge leaves with the first scroll. This one follows the reading area
     instead: it stays just inside the top of the box, wherever the box is. */
  function pinButton(btn, container) {
    if (!btn || !container) return;
    var queued = false;
    function place() {
      queued = false;
      var r = container.getBoundingClientRect();
      if (!r.width) return;
      /* fixed, so the numbers are the window's: just inside the top edge of
         the box, and inside the window when the box has scrolled past it */
      /* the page's own toolbar is fixed over the top of the window (z-index 900):
         stay below it, or the button hides behind it and clicks land on its buttons */
      var tb = document.querySelector('.toolbar'), tbBottom = 0;
      if (tb) { var tbr = tb.getBoundingClientRect(), tbs = getComputedStyle(tb); if (tbr.height && tbs.display !== 'none' && tbs.visibility !== 'hidden') tbBottom = tbr.bottom; }
      var minTop = Math.max(8, tbBottom + 8);
      var top = Math.max(minTop, Math.min(window.innerHeight - 34, r.top + 6));
      btn.style.top = Math.round(top) + 'px';
      btn.style.left = Math.round(Math.max(46, Math.min(window.innerWidth - 46, r.left + r.width / 2))) + 'px';
      btn.style.visibility = (r.bottom < minTop + 24 || r.top > window.innerHeight) ? 'hidden' : '';
    }
    function schedule() { if (!queued) { queued = true; requestAnimationFrame(place); } }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    /* the box changes size without a scroll/resize: the viewer's text pane is moved into the
       split column when opened, and the toolbar can collapse - re-place the button then */
    if (window.ResizeObserver) { try { new ResizeObserver(schedule).observe(container); } catch (e) {} }
    document.addEventListener('click', function () { setTimeout(schedule, 150); }, true);
    place();
  }
  function inBoxButton(container, id) {
    var b = el('button', { type: 'button', id: id, class: 'tr-btn tr-inbox',
                           text: '🌐 ترجمه', title: 'ترجمهٔ متن این صفحه با مدل‌های رایگان' });
    var host = (container && container.parentNode) || document.body;
    var cs = getComputedStyle(host);
    if (cs.position === 'static') host.style.position = 'relative';
    host.appendChild(b);
    return b;
  }
  function mountHosts() {
    var tc = document.getElementById('textContent');
    if (tc && tc.closest('#pane-text')) {
      // Viewer: try toolbar button first, fall back to pane header or pinned
      var tb = getToolbarButton('bTranslate');
      var head = document.querySelector('#pane-text > div');
      if (tb && tb.offsetParent !== null) {
        // Toolbar button is visible — use it
        mount({ container: tc, button: tb });
      } else if (head) {
        var hb = el('button', { type: 'button', class: 'tr-btn', id: 'trToggle', text: '🌐 ترجمه', title: 'ترجمهٔ متن این صفحه' });
        head.appendChild(hb);
        mount({ container: tc, button: hb });
      }
      return;
    }
    var rc = document.getElementById('tc') || document.querySelector('.ps-txt');
    if (rc) {
      var rb = getToolbarButton('bTranslate');
      if (!rb || rb === document.getElementById('bTranslate')) {
        // Already in toolbar — use it directly
        mount({ container: rc, button: rb });
      } else {
        // Fallback: create inline button
        mount({ container: rc, button: rb });
        pinButton(rb, rc);
      }
    }
  }

  window.CoreaderTranslate = {
    mount: mount, collectRuns: collectRuns, scriptLang: scriptLang, Engines: Engines, LANGS: LANGS,
    instances: instances, prefs: function () { return prefs; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountHosts); else mountHosts();
})();
