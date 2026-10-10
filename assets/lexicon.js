/* Lexicon: meanings inside the menu, not just links out.
 *
 * The dictionary panel used to be link-only on purpose — an earlier version
 * scraped third-party dictionary HTML through public CORS proxies and got
 * definitions wrong often enough to be reported. This version reads two
 * structured sources instead, both free, both with CORS:
 *
 *   fa.wiktionary.org  action API, prop=extracts  -> Persian senses, sectioned
 *                                                    by part of speech
 *   en.wiktionary.org  REST /api/rest_v1/page/definition/<word>
 *                                          -> any language, grouped by
 *                                             language and part of speech
 *
 * No scraping, no proxy, no key. Anything not found says so rather than
 * guessing.
 */
(function () {
  'use strict';

  var FA_API = 'https://fa.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&origin=*&redirects=1&titles=';
  var EN_API = 'https://en.wiktionary.org/api/rest_v1/page/definition/';

  var POS_FA = {
    'اسم': 'اسم', 'مصدر': 'مصدر', 'فعل': 'فعل', 'صفت': 'صفت', 'قید': 'قید',
    'ضمیر': 'ضمیر', 'حرف اضافه': 'حرف اضافه', 'حرف ربط': 'حرف ربط',
    'اسم خاص': 'اسم خاص', 'عدد': 'عدد', 'حرف تعیین': 'حرف تعیین',
    'ندای تحسیر': 'ندای تحسیر', 'پیشوند': 'پیشوند', 'پسوند': 'پسوند',
    'ترکیب': 'ترکیب', 'عبارت': 'عبارت', 'نشانه': 'نشانه'
  };
  var POS_EN = {
    'Noun': 'اسم', 'Proper noun': 'اسم خاص', 'Verb': 'فعل', 'Adjective': 'صفت',
    'Adverb': 'قید', 'Pronoun': 'ضمیر', 'Preposition': 'حرف اضافه',
    'Conjunction': 'حرف ربط', 'Determiner': 'حرف تعیین', 'Numeral': 'عدد',
    'Interjection': 'ندای تحسیر', 'Particle': 'ندای تعلق', 'Phrase': 'عبارت',
    'Initialism': 'اختصار', 'Abbreviation': 'اختصار', 'Suffix': 'پسوند',
    'Prefix': 'پیشوند', 'Participle': 'اسم مفعول', 'Gerund': 'مصدر',
    'Article': 'حرف تعریف', 'Classifier': 'واژهٔ شمارش'
  };

  // What language is this word in? Script first, then the letters that only
  // one of the two Arabic-script languages uses.
  function detectLang(text) {
    var w = String(text || '').trim();
    if (!w) return '';
    if (/[؀-ۿ]/.test(w)) {
      if (/[پچژگ]/.test(w)) return 'fa';
      if (/[ؤإأآة]/.test(w) && !/[پچژگ]/.test(w)) return 'ar';
      return 'fa';
    }
    if (/[一-鿿]/.test(w)) return 'zh';
    if (/[぀-ヿ]/.test(w)) return 'ja';
    if (/[Ѐ-ӿ]/.test(w)) return 'ru';
    if (/[a-zA-Z]/.test(w)) return 'en';
    return '';
  }

  function stripHtml(html) {
    var box = document.createElement('div');
    box.innerHTML = String(html || '');
    box.querySelectorAll('style,script').forEach(function (n) { n.parentNode.removeChild(n); });
    // usage labels and etymology notes are noise inside a definition
    box.querySelectorAll('.usage-label-se, .ib-content, .reference, sup').forEach(function (n) { n.parentNode.removeChild(n); });
    return (box.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function norm(w) {
    return String(w || '')
      .replace(/[ً-ْٰ]/g, '')   // harakat: they stop a lookup from matching
      .replace(/[ـ]/g, '')           // tatweel
      .replace(/[«»"'()،,.:؛?؟!]/g, '')
      .replace(/ی/g, 'ي').replace(/ک/g, 'ك')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normLight(w) {
    return String(w || '')
      .replace(/[ً-ْٰ]/g, '')
      .replace(/[«»"'()،,.:؛?؟!]/g, '')
      .trim();
  }

  function getJSON(url) {
    return fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /* Persian Wiktionary: the extract is MediaWiki sections, so a part of
   * speech is a heading and each line under it is one sense. That is markup,
   * not someone's page layout, which is why parsing it is safe. */
  function fromFa(word) {
    return getJSON(FA_API + encodeURIComponent(normLight(word))).then(function (data) {
      var pages = data && data.query && data.query.pages;
      if (!pages) return null;
      var key = Object.keys(pages)[0];
      var page = pages[key];
      if (!page || !page.extract || page.missing !== undefined) return null;
      /* The extract is the whole entry, so it also carries the apparatus:
       * etymology, pronunciation, source lists, cross-reference headings.
       * Only a part-of-speech heading may start a sense list. */
      var NOT_POS = {
        'ریشه‌شناسی': 1, 'ریشه لغت': 1, 'واژه‌شناسی': 1, 'آوایش': 1, 'املای دیگر': 1,
        'هجی': 1, 'ویژگی‌ها': 1, 'کاربرد': 1, 'نمونه': 1, 'ترادف': 1, 'مترادف': 1,
        'متضاد': 1, 'هم‌خانواده': 1, 'واژه‌های هم‌آوا': 1, 'جستارهای وابسته': 1,
        'منابع': 1, 'منبع': 1, 'یادکرد': 1, 'برگردان‌ها': 1, 'پانویس': 1, 'منابع و پانویس': 1
      };
      var groups = [], cur = null;
      String(page.extract).split('\n').forEach(function (raw) {
        var line = raw.trim();
        if (!line) return;
        var h3 = line.match(/^===\s*(.+?)\s*===$/);
        if (h3) {
          var pos = h3[1].replace(/(لازم|متعدی|گذرا)/g, '').trim();
          cur = NOT_POS[pos] ? null : { pos: POS_FA[pos] || pos, senses: [] };
          if (cur) groups.push(cur);
          return;
        }
        // any other heading level (==، ====، =) is apparatus, not a meaning
        if (/^=/.test(line) || /^#/.test(line) || /^[({]/.test(line) ||
            /^\{\{/.test(line) || /^-/.test(line) || /^<\/?/.test(line)) return;
        if (cur) cur.senses.push({ text: line, examples: [] });
      });
      groups = groups.filter(function (g) { return g.senses.length; });
      return groups.length ? { lang: 'fa', source: 'fa.wiktionary', groups: groups } : null;
    });
  }

  /* English Wiktionary's REST endpoint is the structured one: it covers every
   * language it has an entry for, grouped by language and part of speech. */
  function fromEn(word) {
    return getJSON(EN_API + encodeURIComponent(encodeURIComponent(normLight(word)))).then(function (data) {
      if (!data) return null;
      var groups = [];
      Object.keys(data).forEach(function (langKey) {
        (data[langKey] || []).forEach(function (entry) {
          var senses = (entry.definitions || []).map(function (d) {
            var text = stripHtml(d.definition);
            var examples = (d.examples || []).map(function (e) { return stripHtml(e); }).filter(Boolean);
            return text ? { text: text, examples: examples } : null;
          }).filter(Boolean);
          if (senses.length) {
            groups.push({ pos: entry.partOfSpeech || '', lang: entry.language || langKey, senses: senses });
          }
        });
      });
      return groups.length ? { lang: 'other', source: 'en.wiktionary', groups: groups } : null;
    });
  }

  /* The Persian entry is what a reader of these books wants; the English one
   * is the fallback and the way in for foreign words. */
  function senses(word) {
    var lang = detectLang(word);
    var first = (lang === 'fa' || lang === 'ar') ? fromFa(word) : fromEn(word);
    var second = (lang === 'fa' || lang === 'ar') ? fromEn(word) : fromFa(word);
    return first.then(function (a) {
      if (a) return a;
      return second.then(function (b) { return b; });
    });
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function style() {
    if (document.getElementById('lx-style')) return;
    var css = document.createElement('style');
    css.id = 'lx-style';
    css.textContent =
      '.lx{font-family:inherit;line-height:1.9}' +
      '.lx-head{font-size:11px;color:var(--muted);letter-spacing:.04em;margin:2px 0 6px}' +
      '.lx-group{margin:0 0 12px}' +
      '.lx-pos{display:inline-block;font-size:11px;padding:1px 9px;border-radius:20px;' +
      'background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent);margin-bottom:4px}' +
      '.lx-senses{margin:2px 0 0;padding-inline-start:20px}' +
      '.lx-senses li{margin:2px 0;font-size:13.5px;color:var(--text)}' +
      '.lx-ex{display:block;font-size:12px;color:var(--muted);font-style:italic;margin-top:1px}' +
      '.lx-none{font-size:12.5px;color:var(--muted);padding:6px 0}' +
      '.lx-more{font-size:11px;color:var(--accent);background:none;border:none;cursor:pointer;padding:0;margin-inline-start:6px}' +
      '.lx-err{font-size:12px;color:var(--muted)}';
    document.head.appendChild(css);
  }

  /* Fill a container: senses first, the old outbound links stay underneath.
   * The word itself and every sense go through esc() — dictionary content is
   * somebody else's text. */
  function render(target, word, limit) {
    if (!target) return Promise.resolve(null);
    style();
    var max = limit || 6;
    var box = document.createElement('div');
    box.className = 'lx';
    box.innerHTML = '<div class="lx-none">در حال جست‌وجوی واژه…</div>';
    target.insertBefore(box, target.firstChild);

    return senses(word).then(function (res) {
      if (!res) {
        box.innerHTML = '<div class="lx-none">معنی‌ای در واژه‌نامه پیدا نشد؛ پیوندهای پایین هنوز کار می‌کنند.</div>';
        return null;
      }
      /* A plate set in English, French or German is looked up in that
       * language's entry, and a Persian reader should not have to read the
       * answer in the source language: the senses go through the same
       * translator the page uses. */
      var toPersian = (window.TR && TR.text) ? toPersianSenses(res) : Promise.resolve(res);
      return toPersian.then(function (r2) { return renderGroups(target, box, word, r2, max); });
    }).catch(function (e) {
      box.innerHTML = '<div class="lx-err">واژه‌نامه در دسترس نیست؛ پیوندهای پایین را امتحان کنید.</div>';
      return null;
    });
  }

  function inArabicScript(s) {
    return /[\u0600-\u06FF\u0750-\u077F]/.test(s);
  }
  /* A Persian entry is not only Persian: a word carries English, Italian and
   * German sections too, and those senses have to be Persian as well. Only
   * what is not already in the script is sent to the translator, and each
   * block keeps the language it was written in. */
  function toPersianSenses(res) {
    var jobs = [];
    res.groups.forEach(function (g) {
      g.senses.forEach(function (s) { if (!inArabicScript(s.text)) jobs.push(s); });
    });
    if (!jobs.length) return Promise.resolve(res);
    var texts = jobs.map(function (s) { return s.text; });
    var sl = res.lang === 'fa' ? 'en' : res.lang;
    return TR.text(texts.join('\n'), sl, 'fa').then(function (out) {
      var lines = String(out || '').split('\n');
      for (var i = 0; i < jobs.length && i < lines.length; i++) {
        if (lines[i] && lines[i] !== texts[i]) jobs[i].text = lines[i];
      }
      res.persian = true;
      return res;
    }, function () { return res; });
  }

  function renderGroups(target, box, word, res, max) {
      var html = '<div class="lx-head">' + esc(res.source === 'fa.wiktionary' ? 'واژه‌نامهٔ فارسی' : 'ویکی‌واژه') +
        (res.persian ? ' · ترجمهٔ معانی به فارسی' : '') + '</div>';
      var n = 0;
      res.groups.forEach(function (g) {
        var shown = [];
        for (var i = 0; i < g.senses.length && n < max; i++, n++) shown.push(g.senses[i]);
        if (!shown.length) return;
        html += '<div class="lx-group">' +
          (g.pos ? '<div class="lx-pos">' + esc(g.pos) + (g.lang && res.lang !== 'fa' ? ' · ' + esc(g.lang) : '') + '</div>' : '') +
          '<ol class="lx-senses">' +
          shown.map(function (s) {
            return '<li>' + esc(s.text) +
              (s.examples && s.examples.length ? '<span class="lx-ex">' + esc(s.examples[0]) + '</span>' : '') +
              '</li>';
          }).join('') +
          '</ol></div>';
      });
      var rest = 0;
      res.groups.forEach(function (g) { rest += g.senses.length; });
      rest -= n;
      if (rest > 0) html += '<div class="lx-none">' + rest + ' معنی دیگر در پیوندهای پایین</div>';
      box.innerHTML = html;
      return res;
  }

  window.LX = { detect: detectLang, senses: senses, render: render, norm: norm };
})();
