// src/reader/reader.js
// Generic reader runtime shared by every book. Each book's index.html sets
// window.BOOK_URL to its book.json before loading this file.
//
// This carries forward every validated fix from the earlier single-book
// prototype (samt_alali.html):
//  - phonetic normalization + homophone folding for archaic spelling
//  - Smith-Waterman local alignment (not literal word matching) so ASR
//    noise/dropped words don't break tracking
//  - stopword downweighting (prevents false long-range jumps on filler
//    words like و/را/که)
//  - separate "live" (interim, tight window) vs "final" (wider, stricter)
//    alignment modes, tuned against real recorded reading sessions
//  - ZWNJ-aware tokenization (splits نیم‌فاصله compounds so ASR's
//    word-boundary guesses can actually align)
//  - session logging + audio capture for further tuning

(function () {
'use strict';

var BOOK = null;
var curPage = 1, annoOn = true;

function toFA(n){return String(n).replace(/[0-9]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'[d]})}

// ===== Load book =====
fetch(window.BOOK_URL || 'book.json').then(function(r){return r.json()}).then(function(book){
  BOOK = book;
  document.getElementById('bookTitle').textContent = book.title;
  document.getElementById('bookMeta').textContent = 'تألیف: ' + (book.author || 'ناشناس');
  buildToc();
  buildPages();
  updNav();
  goPg(1);
  loadSettings();
  loadUserEdits();
  loadTtsSettings();
  populateTtsVoices();
  if (book.hasPdf) document.getElementById('bPdf').style.display = '';
}).catch(function(err){
  document.getElementById('tc').innerHTML = '<p style="color:red">خطا در بارگذاری کتاب: ' + err.message + '</p>';
});

function buildToc(){
  var tocEl = document.getElementById('toc');
  tocEl.innerHTML = '';
  BOOK.chapters.forEach(function(ch){
    var item = document.createElement('div');
    item.className = 'toc-item';
    item.dataset.startPage = ch.startPage;
    var title = document.createElement('a');
    title.className = 'toc-title';
    title.textContent = ch.title;
    title.href = '#pg_' + ch.startPage;
    title.onclick = function(e){ e.preventDefault(); goPg(ch.startPage); };
    var pg = document.createElement('a');
    pg.className = 'toc-pg';
    pg.textContent = 'صفحهٔ ' + toFA(ch.startPage);
    pg.href = '#pg_' + ch.startPage;
    pg.onclick = function(e){ e.preventDefault(); goPg(ch.startPage); };
    item.appendChild(title);
    item.appendChild(pg);
    tocEl.appendChild(item);
  });
}

function buildPages(){
  var tc = document.getElementById('tc');
  tc.innerHTML = '';
  BOOK.pages.forEach(function(p){
    var s = document.createElement('div'); s.className = 'ps'; s.id = 'pg_' + p.page;
    s.innerHTML = '<div class="ps-hdr"><span class="ps-num">صفحه ' + toFA(p.page) +
      '</span>' + (BOOK.hasPdf ? '<a class="ps-link" onclick="openPdfAt(' + p.page + ')">PDF</a>' : '') +
      '</div><div class="ps-txt">' + p.html + '</div>';
    tc.appendChild(s);
  });
  setTimeout(function(){
    if (!window.IntersectionObserver) return;
    var observer = new IntersectionObserver(function(entries){
      for (var i = 0; i < entries.length; i++){
        if (entries[i].isIntersecting){
          var pg = +entries[i].target.id.replace('pg_', '');
          if (pg && pg !== curPage){ curPage = pg; updNav(); hlToc(); }
        }
      }
    }, { rootMargin: '-20% 0px -70% 0px' });
    document.querySelectorAll('.ps').forEach(function(s){ observer.observe(s); });
  }, 0);
}

function goPg(n){
  curPage = n;
  var el = document.getElementById('pg_' + n);
  if (el && el.scrollIntoView) el.scrollIntoView();
  updNav(); hlToc();
}
function updNav(){
  document.getElementById('pgLabel').textContent = 'صفحه ' + toFA(curPage) + ' از ' + toFA(BOOK ? BOOK.pages.length : 0);
}
function hlToc(){
  var items = document.querySelectorAll('.toc-item');
  items.forEach(function(item, i){
    var sp = +item.dataset.startPage;
    var next = items[i + 1] ? +items[i + 1].dataset.startPage : Infinity;
    item.classList.toggle('cur', curPage >= sp && curPage < next);
  });
}
function toggleSidebar(){ document.getElementById('sb').classList.toggle('off'); }

// ===== Settings (theme, font, size, line-height) — persisted globally,
// not per-book, since reading preferences carry across books =====
function openSettings(){ document.getElementById('setOverlay').classList.add('on'); document.getElementById('setPanel').classList.add('on'); }
function closeSettings(){ document.getElementById('setOverlay').classList.remove('on'); document.getElementById('setPanel').classList.remove('on'); }
function applySetting(k, v){
  var r = document.documentElement;
  if (k === 'font'){ r.style.setProperty('--ff', v); }
  else if (k === 'fs'){ r.style.setProperty('--fs', v + 'px'); document.getElementById('setFsV').textContent = toFA(v); }
  else if (k === 'lh'){ r.style.setProperty('--lh', v / 10); document.getElementById('setLhV').textContent = (v / 10).toFixed(1); }
  localStorage.setItem('coreader-settings', JSON.stringify({
    font: document.getElementById('setFont').value,
    fs: document.getElementById('setFs').value,
    lh: document.getElementById('setLh').value,
  }));
}
function loadSettings(){
  var s; try { s = JSON.parse(localStorage.getItem('coreader-settings')); } catch (e) {}
  if (!s) return;
  if (s.font){ document.documentElement.style.setProperty('--ff', s.font); document.getElementById('setFont').value = s.font; }
  if (s.fs){ document.documentElement.style.setProperty('--fs', s.fs + 'px'); document.getElementById('setFs').value = s.fs; document.getElementById('setFsV').textContent = toFA(s.fs); }
  if (s.lh){ document.documentElement.style.setProperty('--lh', s.lh / 10); document.getElementById('setLh').value = s.lh; document.getElementById('setLhV').textContent = (s.lh / 10).toFixed(1); }
}
function setTheme(t){
  document.body.className = t || '';
  document.querySelectorAll('.theme-btn').forEach(function(b){ b.classList.toggle('on', b.dataset.theme === t); });
  localStorage.setItem('coreader-theme', t || '');
}
(function(){ var t = localStorage.getItem('coreader-theme'); if (t) setTheme(t); })();

// ===== Tooltip — rich, hover-triggered, category-badged =====
var CAT_LABELS = { arabic: 'عربی', poem: 'شعر و نظم', quran: 'آیه و حدیث', hist: 'تاریخ',
  word: 'لغت کهن', person: 'شخصیت', event: 'واقعه' };
var tooltipTimer = null;
function showTooltip(el){
  var tt = document.getElementById('tt');
  if (!el || !annoOn){ tt.classList.remove('on'); return; }
  var cat = el.dataset.cat || 'word';
  // Lead with the annotated word itself (what the reader actually pointed
  // at), category as a small badge, then the explanation — previously the
  // category badge was the most prominent element, which is backwards.
  var html = '<div class="tt-word">' + el.textContent + '</div>';
  html += '<span class="tt-cat tc-' + cat + '">' + (CAT_LABELS[cat] || cat) + '</span>';
  if (el.dataset.title) html += '<div class="tt-t">' + el.dataset.title + '</div>';
  html += '<div class="tt-b">' + (el.dataset.text || el.getAttribute('title') || '') + '</div>';
  if (el.dataset.extra) html += '<div class="tt-e">' + el.dataset.extra + '</div>';
  tt.innerHTML = html;
  tt.classList.add('on');
  var r = el.getBoundingClientRect(), vpW = window.innerWidth, vpH = window.innerHeight;
  var tw = Math.min(560, vpW - 20);
  tt.style.width = tw + 'px';
  var th = tt.offsetHeight || 200;
  var x = r.left, y = r.top - th - 12;
  if (y < 10) y = r.bottom + 12;
  if (x + tw > vpW - 10) x = vpW - tw - 10;
  if (x < 10) x = 10;
  if (y + th > vpH - 10) y = vpH - th - 10;
  tt.style.left = x + 'px'; tt.style.top = y + 'px';
}
function hideTooltip(){
  document.getElementById('tt').classList.remove('on');
  if (tooltipTimer){ clearTimeout(tooltipTimer); tooltipTimer = null; }
}
function showTooltipAuto(el){
  showTooltip(el);
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(hideTooltip, 15000);
}
document.addEventListener('mouseover', function(e){
  var a = e.target.closest && e.target.closest('.anno');
  if (a && annoOn) showTooltip(a); else if (!e.target.closest || !e.target.closest('.tt')) hideTooltip();
});
function toggleAnno(){
  annoOn = !annoOn;
  document.getElementById('bAnno').classList.toggle('on', annoOn);
  document.body.classList.toggle('annos-off', !annoOn);
}

// ===== Progress bar =====
window.addEventListener('scroll', function(){
  var max = document.documentElement.scrollHeight - window.innerHeight;
  document.getElementById('pbar').style.width = (max > 0 ? window.scrollY / max * 100 : 0) + '%';
}, { passive: true });

// ===== Keyboard shortcuts =====
function navPg(d){ if (BOOK) goPg(Math.max(1, Math.min(BOOK.pages.length, curPage + d))); }
document.addEventListener('keydown', function(e){
  if (e.target && (e.target.tagName === 'INPUT' || e.target.isContentEditable)) return;
  if (e.key === 'ArrowRight') navPg(-1);
  else if (e.key === 'ArrowLeft') navPg(1);
  else if (e.key === 'Escape'){ closeSettings(); closeEncPanel(); document.getElementById('ctxMenu').setAttribute('data-open', 'false'); }
});

// ===== Search =====
function searchBook(q){
  var resultsEl = document.getElementById('searchResults');
  q = q.trim();
  if (!q){ resultsEl.innerHTML = ''; return; }
  var terms = q.split(/\s+/).map(normW).filter(Boolean);
  if (!terms.length){ resultsEl.innerHTML = ''; return; }
  var idx = BOOK.searchIndex;
  var pageSets = terms.map(function(t){ return new Set(idx[t] || []); });
  var common = [...pageSets[0]].filter(function(p){ return pageSets.every(function(s){ return s.has(p); }); });
  common.sort(function(a,b){ return a-b; });
  if (!common.length){ resultsEl.innerHTML = '<div style="padding:8px;color:#999">نتیجه‌ای یافت نشد</div>'; return; }
  resultsEl.innerHTML = common.slice(0, 30).map(function(pg){
    var page = BOOK.pages.find(function(p){ return p.page === pg; });
    var plain = page ? page.html.replace(/<[^>]+>/g, '') : '';
    var snippetStart = Math.max(0, plain.indexOf(q.split(/\s+/)[0]) - 40);
    var snippet = plain.slice(snippetStart, snippetStart + 120);
    return '<a onclick="goPg(' + pg + ')">' +
      'صفحه ' + toFA(pg) + ' — ' + snippet + '…</a>';
  }).join('');
}

// ===== PDF panel — supports multiple PDF sources (editions/scans) per
// book, switchable via a dropdown, so more than one witness of a text can
// be viewed (and, per the reader's design, compared) on the same page =====
var pdfDoc = null, curPdf = 1, pdfSc = 1.3, pdfPendingPage = null;
var curPdfSrc = 0, pdfDocCache = {};
function showPdfErr(msg){ document.getElementById('pdfErr').textContent = msg; document.getElementById('pdfErr').style.display = 'block'; document.getElementById('pdfC').style.display = 'none'; }
function hidePdfErr(){ document.getElementById('pdfErr').style.display = 'none'; document.getElementById('pdfC').style.display = 'block'; }
function pdfSources(){ return (BOOK && BOOK.pdfSources && BOOK.pdfSources.length) ? BOOK.pdfSources : (BOOK && BOOK.hasPdf ? [{ id: 'pdf_1', label: BOOK.title, filename: 'source.pdf' }] : []); }
function buildPdfSourceSelect(){
  var srcs = pdfSources();
  var sel = document.getElementById('pdfSrcSel');
  if (srcs.length <= 1){ sel.style.display = 'none'; return; }
  sel.style.display = '';
  sel.innerHTML = srcs.map(function(s, i){ return '<option value="' + i + '">' + s.label + '</option>'; }).join('');
  sel.value = curPdfSrc;
}
function switchPdfSource(idx){
  curPdfSrc = +idx;
  document.getElementById('pdfSrcSel').value = curPdfSrc;
  if (pdfDocCache[curPdfSrc]){ pdfDoc = pdfDocCache[curPdfSrc]; document.getElementById('pdfMax').textContent = pdfDoc.numPages; pdfRender(1); }
  else loadPdf();
}
function loadPdf(){
  var srcs = pdfSources();
  var src = srcs[curPdfSrc];
  if (!src){ showPdfErr('این کتاب نسخهٔ PDF ندارد.'); return; }
  hidePdfErr(); document.getElementById('pdfMax').textContent = '...';
  fetch(src.filename).then(function(r){ if (!r.ok) throw 0; return r.arrayBuffer(); })
    .then(function(buf){ return pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise; })
    .then(function(doc){ pdfDoc = doc; pdfDocCache[curPdfSrc] = doc; document.getElementById('pdfMax').textContent = doc.numPages; pdfRender(pdfPendingPage || 1); pdfPendingPage = null; })
    .catch(function(){ showPdfErr('فایل «' + src.filename + '» در کنار book.json یافت نشد.'); });
}
function pdfRender(n){
  if (!pdfDoc || n < 1 || n > pdfDoc.numPages) return;
  curPdf = n; document.getElementById('pdfIn').value = n;
  pdfDoc.getPage(n).then(function(p){
    var v = p.getViewport({ scale: pdfSc });
    var c = document.getElementById('pdfC'); c.width = v.width; c.height = v.height;
    p.render({ canvasContext: c.getContext('2d'), viewport: v }).promise.then(function(){
      updatePdfHighlightPosition();
    });
  });
}
function pdfGoto(n){ if (n >= 1 && n <= (pdfDoc ? pdfDoc.numPages : 1)) pdfRender(n); }
function pdfNav(d){ pdfGoto(curPdf + d); }
function pdfZoom(d){ pdfSc = Math.max(.5, Math.min(3, pdfSc + d)); document.getElementById('pdfZL').textContent = Math.round(pdfSc * 100) + '%'; pdfRender(curPdf); }
function openPdfAt(n){ pdfPendingPage = n; showMode('pdf'); }
function showMode(m){
  document.getElementById('pdfWrap').classList.toggle('on', m === 'pdf');
  document.getElementById('bPdf').classList.toggle('on', m === 'pdf');
  document.body.classList.toggle('pdf-open', m === 'pdf');
  if (m === 'pdf'){
    buildPdfSourceSelect();
    if (!pdfDoc) loadPdf(); else { pdfRender(pdfPendingPage || curPdf); pdfPendingPage = null; }
    syncPdfHighlight();
  }
}
function closePdf(){ showMode('text'); }

// خط‌بَر ↔ PDF sync: turns the PDF to the page being read, and draws an
// approximate horizontal highlight band at how far through the page's
// words the reader currently is. This is a proportional estimate, not a
// word-exact box — OCR here only produced plain text, not per-word
// coordinates, so an exact box isn't available; the band still gives a
// real, useful "you are roughly here" cue while following along.
function updatePdfHighlightPosition(){
  var hl = document.getElementById('pdfHl');
  if (!recording || !micWords.length || curPdf !== curPage){ hl.style.display = 'none'; return; }
  var canvas = document.getElementById('pdfC');
  if (!canvas || !canvas.height) { hl.style.display = 'none'; return; }
  var frac = micIdx / micWords.length;
  var bandH = Math.max(28, canvas.height * 0.045);
  var top = Math.min(canvas.height - bandH, Math.max(0, frac * canvas.height - bandH / 2));
  hl.style.display = 'block';
  hl.style.top = top + 'px';
  hl.style.height = bandH + 'px';
}
function syncPdfHighlight(){
  if (!document.body.classList.contains('pdf-open') || !recording) return;
  if (pdfDoc && curPdf !== curPage){ pdfGoto(curPage); return; } // pdfRender's own callback updates the band once the new page is drawn
  updatePdfHighlightPosition();
}

// ===== Right-click context menu: add/edit/delete annotation, edit text,
// diacritics toolbar =====
var ctxAnnoEl = null, ctxSel = null, ctxRange = null;
document.addEventListener('contextmenu', function(e){
  var inText = e.target.closest && e.target.closest('.ps-txt,.anno,.ps');
  if (!inText) return;
  e.preventDefault();
  ctxSel = window.getSelection().toString().trim();
  var sel = window.getSelection();
  ctxRange = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  ctxAnnoEl = e.target.closest('.anno');
  var ctxMenu = document.getElementById('ctxMenu');
  ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';
  ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 340) + 'px';
  ctxMenu.setAttribute('data-open', 'true');
}, true);
document.addEventListener('mousedown', function(e){
  var ctxMenu = document.getElementById('ctxMenu');
  if (e.button !== 2 && !ctxMenu.contains(e.target)) ctxMenu.setAttribute('data-open', 'false');
}, true);

function ctxAddAnno(){
  document.getElementById('ctxMenu').setAttribute('data-open', 'false');
  if (!ctxSel){ alert('ابتدا متن را انتخاب کنید'); return; }
  var title = prompt('عنوان حاشیه (اختیاری):') || '';
  var text = prompt('متن حاشیه:');
  if (!text) return;
  var cat = prompt('دسته (arabic/poem/quran/hist/word/person/event):', 'word') || 'word';
  var span = document.createElement('span');
  span.className = 'anno anno-' + cat;
  span.dataset.cat = cat; span.dataset.title = title; span.dataset.text = text;
  span.textContent = ctxSel;
  try {
    ctxRange.deleteContents();
    ctxRange.insertNode(span);
  } catch (ex){
    var pgEl = document.getElementById('pg_' + curPage);
    var txtEl = pgEl && pgEl.querySelector('.ps-txt');
    if (!txtEl) return;
    var idx = txtEl.innerHTML.indexOf(ctxSel);
    if (idx < 0){ alert('متن یافت نشد'); return; }
    txtEl.innerHTML = txtEl.innerHTML.slice(0, idx) + span.outerHTML + txtEl.innerHTML.slice(idx + ctxSel.length);
  }
  saveUserEdits();
}
function ctxEditAnno(){
  document.getElementById('ctxMenu').setAttribute('data-open', 'false');
  if (!ctxAnnoEl){ alert('روی حاشیه راست‌کلیک کنید'); return; }
  var title = prompt('عنوان جدید:', ctxAnnoEl.dataset.title || '');
  if (title === null) return;
  var text = prompt('متن جدید:', ctxAnnoEl.dataset.text || '');
  if (text === null) return;
  var cat = prompt('دسته:', ctxAnnoEl.dataset.cat || 'word') || ctxAnnoEl.dataset.cat;
  ctxAnnoEl.dataset.title = title; ctxAnnoEl.dataset.text = text; ctxAnnoEl.dataset.cat = cat;
  ctxAnnoEl.className = 'anno anno-' + cat;
  saveUserEdits();
}
function ctxDeleteAnno(){
  document.getElementById('ctxMenu').setAttribute('data-open', 'false');
  if (!ctxAnnoEl){ alert('روی حاشیه راست‌کلیک کنید'); return; }
  if (!confirm('حذف حاشیه؟')) return;
  var parent = ctxAnnoEl.parentNode;
  while (ctxAnnoEl.firstChild) parent.insertBefore(ctxAnnoEl.firstChild, ctxAnnoEl);
  parent.removeChild(ctxAnnoEl);
  ctxAnnoEl = null;
  saveUserEdits();
}
var editingText = false;
function ctxEditText(){
  document.getElementById('ctxMenu').setAttribute('data-open', 'false');
  var pgEl = document.getElementById('pg_' + curPage);
  var txtEl = pgEl && pgEl.querySelector('.ps-txt');
  if (!txtEl) return;
  if (editingText){
    editingText = false;
    txtEl.contentEditable = 'false';
    txtEl.style.outline = 'none'; txtEl.style.background = 'none';
    saveUserEdits();
  } else {
    editingText = true;
    txtEl.contentEditable = 'true';
    txtEl.style.outline = '2px dashed var(--accent)'; txtEl.style.background = 'var(--hover)';
    txtEl.focus();
  }
}
function ctxToggleTashkil(){
  document.getElementById('ctxMenu').setAttribute('data-open', 'false');
  document.getElementById('tashkilBar').classList.toggle('on');
}
function toggleTashkilBar(){ document.getElementById('tashkilBar').classList.remove('on'); }
function insertTashkil(ch){
  var sel = window.getSelection();
  if (!sel.rangeCount) return;
  var range = sel.getRangeAt(0);
  var node = document.createTextNode(ch);
  range.insertNode(node);
  range.setStartAfter(node); range.setEndAfter(node);
  sel.removeAllRanges(); sel.addRange(range);
}

// ===== Persistence — per-book local edits (annotations + text fixes),
// stored client-side since this is a static site with no backend =====
function editsKey(){ return 'coreader-edits-' + (BOOK ? BOOK.slug : 'unknown'); }
function saveUserEdits(){
  try {
    var edits = { textEdits: {} };
    document.querySelectorAll('.ps').forEach(function(pgEl){
      var pg = +pgEl.id.replace('pg_', '');
      var txtEl = pgEl.querySelector('.ps-txt');
      if (!txtEl) return;
      var orig = BOOK.pages.find(function(p){ return p.page === pg; });
      if (orig && txtEl.innerHTML !== orig.html) edits.textEdits[pg] = txtEl.innerHTML;
    });
    localStorage.setItem(editsKey(), JSON.stringify(edits));
  } catch (e) {}
}
function loadUserEdits(){
  try {
    var edits = JSON.parse(localStorage.getItem(editsKey()));
    if (!edits || !edits.textEdits) return;
    Object.keys(edits.textEdits).forEach(function(pg){
      var pgEl = document.getElementById('pg_' + pg);
      var txtEl = pgEl && pgEl.querySelector('.ps-txt');
      if (txtEl) txtEl.innerHTML = edits.textEdits[pg];
    });
  } catch (e) {}
}
setInterval(function(){ if (!editingText) saveUserEdits(); }, 30000);
window.addEventListener('beforeunload', function(){ saveUserEdits(); });

// ===== Dictionary/encyclopedia lookup — link-only by design =====
// An earlier version of this feature tried to fetch and parse third-party
// dictionary pages' raw HTML (through public CORS proxies) to show an
// inline snippet. That was unreliable: proxies go down or rate-limit, and
// scraping arbitrary/changing site markup with regex produced wrong or
// garbled "definitions" often enough to be a real, reported bug. This
// version does not try to reproduce anyone else's content — it just
// reliably deep-links to each real reference site's own search results.
var encSources = [
  { name: 'واژه‌یاب', icon: '📖', desc: 'معنی و مترادف', fn: function(w){ return 'https://vajehyab.com/?q=' + encodeURIComponent(w); } },
  { name: 'لغت‌نامه دهخدا', icon: '📗', desc: 'لغت‌نامه جامع', fn: function(w){ return 'https://vajehyab.com/dehkhoda/' + encodeURIComponent(w); } },
  { name: 'فرهنگ معین', icon: '📘', desc: 'فرهنگ لغت', fn: function(w){ return 'https://vajehyab.com/moein/' + encodeURIComponent(w); } },
  { name: 'فرهنگ عمید', icon: '📙', desc: 'فرهنگ فارسی', fn: function(w){ return 'https://vajehyab.com/amid/' + encodeURIComponent(w); } },
  { name: 'ویکی‌واژه', icon: '🌐', desc: 'واژه‌نامه', fn: function(w){ return 'https://fa.wiktionary.org/wiki/' + encodeURIComponent(w); } },
  { name: 'گنجور', icon: '📜', desc: 'شعر و ادبیات', fn: function(w){ return 'https://ganjoor.net/search?s=' + encodeURIComponent(w); } },
];
function doEncSearch(word){
  if (!word) word = document.getElementById('encLeftInput').value;
  if (!word) return;
  document.getElementById('encLeftWord').textContent = word;
  document.getElementById('encLeftInput').value = word;
  document.getElementById('encLeftResults').innerHTML = encSources.map(function(s){
    return '<a class="enc-link" href="' + s.fn(word) + '" target="_blank" rel="noopener">' +
      '<span class="enc-title">' + s.icon + ' ' + s.name + '</span>' +
      '<span class="enc-desc">' + s.desc + ' ↗</span></a>';
  }).join('');
  document.getElementById('encLeft').classList.add('on');
  document.body.classList.add('enc-open');
}
function closeEncPanel(){
  document.getElementById('encLeft').classList.remove('on');
  document.body.classList.remove('enc-open');
}
function ctxSearchEnc(){
  document.getElementById('ctxMenu').setAttribute('data-open', 'false');
  var word = ctxSel || document.getElementById('encLeftInput').value;
  if (!word){ document.getElementById('encLeft').classList.add('on'); document.body.classList.add('enc-open'); document.getElementById('encLeftInput').focus(); return; }
  doEncSearch(word);
}

// ===================================================================
// ===== خوانش صوتی (TTS) — reads the page aloud with synced highlight
// Two engines, both free and requiring zero signup/key:
//  - "browser" (default, zero-config): the Web Speech API's
//    speechSynthesis, using native word-boundary events for exact
//    highlighting. Quality depends entirely on whatever Persian voice (if
//    any) the visitor's OS/browser ships — this varies a lot, and many
//    systems have none at all.
//  - "google" (better quality, still free): the public endpoint behind
//    Google Translate's own "listen" button. Unofficial/undocumented —
//    no key, no quota dashboard, no guarantee — so any failure falls
//    back to the browser engine automatically. Its one real constraint
//    is a short per-request text limit, so the page text is split into
//    word-boundary chunks played back to back; word-level sync for this
//    path is a proportional estimate from each chunk's audio playback
//    position (no word-boundary timing is available from a plain audio
//    response), same honest approach as the PDF highlight band.
// ===================================================================
var ttsOn = false, ttsPlaying = false, ttsVoices = [], ttsOffsets = [];
var ttsEngine = 'browser';
var ttsAudio = null;

function toggleTts(){
  if (recording){ document.getElementById('micStatus').textContent = 'ابتدا خط‌بَر را متوقف کنید'; return; }
  ttsOn = !ttsOn;
  document.getElementById('ttsBar').classList.toggle('on', ttsOn);
  document.getElementById('bTts').classList.toggle('on', ttsOn);
  if (!ttsOn) stopTts();
}

function loadTtsSettings(){
  var s = null;
  try { s = JSON.parse(localStorage.getItem('coreader-tts-settings')); } catch (e) {}
  if (s) ttsEngine = s.engine || 'browser';
  document.getElementById('setTtsEngine').value = ttsEngine;
  document.getElementById('googleTtsNote').style.display = ttsEngine === 'google' ? '' : 'none';
}
function saveTtsSettings(){
  localStorage.setItem('coreader-tts-settings', JSON.stringify({ engine: ttsEngine }));
}
function setTtsEngine(v){
  ttsEngine = v;
  document.getElementById('googleTtsNote').style.display = v === 'google' ? '' : 'none';
  saveTtsSettings();
}

function populateTtsVoices(){
  if (!window.speechSynthesis) return;
  var sel = document.getElementById('ttsVoiceSel');
  var voices = window.speechSynthesis.getVoices();
  var fa = voices.filter(function(v){ return v.lang && v.lang.toLowerCase().indexOf('fa') === 0; });
  var list = fa.length ? fa : voices;
  ttsVoices = list;
  sel.innerHTML = list.map(function(v, i){ return '<option value="' + i + '">' + v.name + ' (' + v.lang + ')</option>'; }).join('');
  if (!fa.length && voices.length && ttsEngine === 'browser'){
    document.getElementById('ttsStatus').textContent = 'صدای فارسی در این مرورگر نصب نیست — گزینهٔ Google را در تنظیمات امتحان کنید';
  }
}
if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = populateTtsVoices;

function updateTtsPlayBtn(){ document.getElementById('ttsPlayBtn').textContent = ttsPlaying ? '⏸️' : '▶️'; }

function setTtsRate(v){
  document.getElementById('ttsRateLabel').textContent = (+v).toFixed(1) + '×';
  if (ttsAudio) ttsAudio.playbackRate = +v;
}

function toggleTtsPlay(){
  if (ttsEngine === 'google') toggleTtsPlayGoogle();
  else toggleTtsPlayBrowser();
}

// ---- browser engine ----
function buildTtsTextFromMicWords(){
  var parts = [], offsets = [], pos = 0;
  micWords.forEach(function(w){
    var t = w.el.textContent;
    offsets.push({ start: pos, end: pos + t.length });
    parts.push(t);
    pos += t.length + 1;
  });
  return { text: parts.join(' '), offsets: offsets };
}
function findMicWordIndexForOffset(charIndex){
  for (var i = 0; i < ttsOffsets.length; i++){
    if (charIndex >= ttsOffsets[i].start && charIndex < ttsOffsets[i].end + 1) return i;
  }
  return -1;
}
function ttsHighlightAndMaybeAnno(idx){
  highlightAt(idx);
  smoothScrollTo(idx);
  var annoEl = findAnnoNear(idx);
  if (annoEl && annoEl !== lastAnnoEl && annoOn){ showTooltipAuto(annoEl); lastAnnoEl = annoEl; }
}
function startTtsBrowserForPage(){
  if (!window.speechSynthesis){ document.getElementById('ttsStatus').textContent = 'مرورگر شما از خوانش صوتی پشتیبانی نمی‌کند'; return; }
  buildMicIndex(curPage);
  if (!micWords.length) return;
  var built = buildTtsTextFromMicWords();
  ttsOffsets = built.offsets;
  var utter = new SpeechSynthesisUtterance(built.text);
  var voice = ttsVoices[+document.getElementById('ttsVoiceSel').value] || null;
  if (voice) utter.voice = voice;
  utter.lang = voice ? voice.lang : 'fa-IR';
  utter.rate = +document.getElementById('ttsRate').value || 1;
  utter.onboundary = function(e){
    if (e.name && e.name !== 'word') return;
    var idx = findMicWordIndexForOffset(e.charIndex);
    if (idx >= 0) ttsHighlightAndMaybeAnno(idx);
  };
  utter.onend = function(){
    if (!ttsOn) return;
    if (curPage < BOOK.pages.length){ goPg(curPage + 1); startTtsBrowserForPage(); }
    else { ttsPlaying = false; updateTtsPlayBtn(); document.getElementById('ttsStatus').textContent = 'پایان کتاب'; }
  };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
  ttsPlaying = true; updateTtsPlayBtn();
  document.getElementById('ttsStatus').textContent = 'در حال خواندن...';
}
function toggleTtsPlayBrowser(){
  if (!window.speechSynthesis){ document.getElementById('ttsStatus').textContent = 'مرورگر شما از خوانش صوتی پشتیبانی نمی‌کند'; return; }
  if (ttsPlaying){
    window.speechSynthesis.pause();
    ttsPlaying = false; updateTtsPlayBtn();
    document.getElementById('ttsStatus').textContent = 'مکث شد';
  } else if (window.speechSynthesis.paused){
    window.speechSynthesis.resume();
    ttsPlaying = true; updateTtsPlayBtn();
    document.getElementById('ttsStatus').textContent = 'در حال خواندن...';
  } else {
    startTtsBrowserForPage();
  }
}

// ---- Google Translate TTS engine (free, no signup/key needed) ----
// Uses the public (unofficial, undocumented) endpoint behind Google
// Translate's own "listen" button. No official API, no key, no quota
// dashboard — which also means no guarantee: it can be slow, rate-limited,
// or change without notice. Treated accordingly: any failure falls back
// to the always-available browser engine rather than leaving playback
// just stuck. Its one real constraint is a short per-request text limit,
// so the page is split into word-boundary chunks and played back to back.
var GOOGLE_TTS_MAX_CHARS = 190;
function buildGoogleChunks(){
  var chunks = [];
  var curText = '', curStart = 0, curLen = 0;
  micWords.forEach(function(w, i){
    var t = w.el.textContent;
    var addLen = t.length + 1;
    if (curLen && curLen + addLen > GOOGLE_TTS_MAX_CHARS){
      chunks.push({ text: curText, start: curStart, end: i });
      curText = ''; curStart = i; curLen = 0;
    }
    curText += (curText ? ' ' : '') + t;
    curLen += addLen;
  });
  if (curText) chunks.push({ text: curText, start: curStart, end: micWords.length });
  return chunks;
}
function googleTtsUrl(text){
  return 'https://translate.google.com/translate_tts?ie=UTF-8&q=' + encodeURIComponent(text) + '&tl=fa&client=tw-ob';
}
var googleChunks = [], googleChunkIdx = 0, googleFellBack = false;
function startTtsGoogleForPage(){
  buildMicIndex(curPage);
  if (!micWords.length) return;
  googleChunks = buildGoogleChunks();
  googleChunkIdx = 0;
  document.getElementById('ttsStatus').textContent = 'در حال خواندن... (Google)';
  playGoogleChunk();
}
function playGoogleChunk(){
  if (googleChunkIdx >= googleChunks.length){
    if (!ttsOn) return;
    if (curPage < BOOK.pages.length){ goPg(curPage + 1); startTtsGoogleForPage(); }
    else { ttsPlaying = false; updateTtsPlayBtn(); document.getElementById('ttsStatus').textContent = 'پایان کتاب'; }
    return;
  }
  var chunk = googleChunks[googleChunkIdx];
  if (ttsAudio){ try { ttsAudio.pause(); } catch (e) {} }
  ttsAudio = new Audio(googleTtsUrl(chunk.text));
  ttsAudio.playbackRate = +document.getElementById('ttsRate').value || 1;
  ttsAudio.ontimeupdate = function(){
    if (!ttsAudio.duration) return;
    var span = chunk.end - chunk.start;
    var idx = Math.min(chunk.end - 1, chunk.start + Math.floor((ttsAudio.currentTime / ttsAudio.duration) * span));
    ttsHighlightAndMaybeAnno(idx);
  };
  ttsAudio.onended = function(){ googleChunkIdx++; playGoogleChunk(); };
  ttsAudio.onerror = function(){
    if (googleFellBack) return; // avoid a fallback loop if the browser engine also has no Persian voice
    googleFellBack = true;
    document.getElementById('ttsStatus').textContent = 'سرویس رایگان گوگل در دسترس نیست — بازگشت به صدای مرورگر';
    ttsEngine = 'browser';
    document.getElementById('setTtsEngine').value = 'browser';
    document.getElementById('googleTtsNote').style.display = 'none';
    saveTtsSettings();
    startTtsBrowserForPage();
  };
  var p = ttsAudio.play();
  if (p && p.catch) p.catch(function(){ ttsAudio.onerror(); });
  ttsPlaying = true; updateTtsPlayBtn();
}
function toggleTtsPlayGoogle(){
  if (ttsPlaying && ttsAudio){
    ttsAudio.pause(); ttsPlaying = false; updateTtsPlayBtn();
    document.getElementById('ttsStatus').textContent = 'مکث شد';
  } else if (ttsAudio && ttsAudio.paused && !ttsAudio.ended){
    ttsAudio.play(); ttsPlaying = true; updateTtsPlayBtn();
    document.getElementById('ttsStatus').textContent = 'در حال خواندن...';
  } else {
    googleFellBack = false;
    startTtsGoogleForPage();
  }
}

function stopTts(){
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (ttsAudio){ try { ttsAudio.pause(); } catch (e) {} ttsAudio = null; }
  ttsPlaying = false;
  updateTtsPlayBtn();
  if (!recording && micWords.length){
    micWords.forEach(function(w){ w.el.className = w.isAnno ? 'anno anno-' + (w.el.dataset.cat || 'word') : 'wl'; });
  }
  document.getElementById('ttsStatus').textContent = 'آماده خوانش...';
  hideTooltip();
}

// ===================================================================
// ===== خط‌بَر (line tracker) — validated engine =====
// ===================================================================
var micOn = false, recording = false, recognition = null;
var micWords = [], micIdx = 0, spokenBuf = [], locked = false, lastAnnoEl = null;

function toggleMic(){
  micOn = !micOn;
  document.getElementById('micBar').classList.toggle('on', micOn);
  document.getElementById('bMic').classList.toggle('on', micOn);
  if (!micOn) stopMic();
}

function normW(w){
  var s = w.toLowerCase()
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, '')
    .replace(/ـ/g, '')
    .replace(/[إأآءٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[ئىي]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ةه]/g, 'ه')
    .replace(/[^\u0621-\u06FE0-9a-zA-Z]/g, '');
  s = s.replace(/[ثصس]/g, 'س').replace(/[ذضظز]/g, 'ز').replace(/[طت]/g, 'ت').replace(/[قغ]/g, 'ق').replace(/[حه]/g, 'ه');
  return s;
}
function editDist(a, b){
  if (a === b) return 0;
  var la = a.length, lb = b.length;
  if (!la) return lb; if (!lb) return la;
  var d = []; for (var i = 0; i <= la; i++) d[i] = [i]; for (var j = 0; j <= lb; j++) d[0][j] = j;
  for (var i = 1; i <= la; i++) for (var j = 1; j <= lb; j++){ var c = a[i-1] === b[j-1] ? 0 : 1; d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+c); }
  return d[la][lb];
}
function wordSim(a, b){ if (!a || !b) return 0; if (a === b) return 1; var m = Math.max(a.length, b.length); if (!m) return 1; return 1 - editDist(a, b) / m; }

function buildMicIndex(pg){
  var pgEl = document.getElementById('pg_' + pg); if (!pgEl) return;
  var txtEl = pgEl.querySelector('.ps-txt'); if (!txtEl) return;
  micWords = []; micIdx = 0; spokenBuf = []; locked = false; lastAnnoEl = null;
  function processNode(node){
    if (node.nodeType === 3){
      var text = node.textContent;
      if (!text.trim()) return;
      var frag = document.createDocumentFragment();
      text.split(/(\s+)/).forEach(function(w){
        if (/^\s+$/.test(w)){ frag.appendChild(document.createTextNode(w)); return; }
        if (!w) return;
        w.split('\u200c').forEach(function(part, pi){
          if (pi > 0) frag.appendChild(document.createTextNode('\u200c'));
          if (!part) return;
          var span = document.createElement('span'); span.className = 'wl'; span.textContent = part;
          frag.appendChild(span);
          micWords.push({ el: span, n: normW(part) });
        });
      });
      node.parentNode.replaceChild(frag, node);
    } else if (node.nodeType === 1 && node.classList){
      if (node.classList.contains('anno')){
        // Multi-word annotation phrases (e.g. "رضی الله عنه") used to
        // become ONE fused token — normW strips the spaces, so a 3-word
        // spoken phrase had to align against one long merged string,
        // which wordSim scores poorly even for an exact reading. Split
        // per word (same as plain text) so each word aligns on its own;
        // all of them still point at the same `el`, so highlighting and
        // the tooltip trigger still act on the whole phrase as one unit.
        var annoWords = node.textContent.split(/\s+/).filter(Boolean);
        annoWords.forEach(function(aw){
          aw.split('\u200c').forEach(function(part){
            if (!part) return;
            micWords.push({ el: node, n: normW(part), isAnno: true });
          });
        });
      } else {
        Array.from(node.childNodes).forEach(processNode);
      }
    }
  }
  Array.from(txtEl.childNodes).forEach(processNode);
}

var STOPW = {'و':1,'را':1,'به':1,'از':1,'در':1,'كه':1,'که':1,'بر':1,'ان':1,'اين':1,
  'با':1,'تا':1,'بي':1,'بی':1,'هم':1,'يا':1,'چون':1,'است':1,'بود':1,'مر':1,'آن':1};

function alignBuffer(spoken, startFrom, ahead, behind){
  var winStart = Math.max(0, startFrom - (behind || 5));
  var winEnd = Math.min(micWords.length, startFrom + (ahead || 80));
  var page = micWords.slice(winStart, winEnd);
  var n = spoken.length, m = page.length;
  if (!n || !m) return null;
  var H = []; for (var i = 0; i <= n; i++) H[i] = new Array(m + 1).fill(0);
  var best = 0, bi = 0, bj = 0;
  for (var i = 1; i <= n; i++){
    for (var j = 1; j <= m; j++){
      var sw = spoken[i-1], pw = page[j-1].n;
      var sim = wordSim(sw, pw);
      var isStop = STOPW[sw] || STOPW[pw];
      var sub;
      if (sim >= 0.75) sub = isStop ? 0.5 : 2;
      else if (sim >= 0.4) sub = isStop ? 0.2 : 1;
      else sub = -1;
      var v = Math.max(0, H[i-1][j-1] + sub, H[i-1][j] - 1, H[i][j-1] - 1);
      H[i][j] = v;
      if (v > best){ best = v; bi = i; bj = j; }
    }
  }
  if (best <= 0) return null;
  return { pageIndex: winStart + bj - 1, matchedSpoken: bi, score: best };
}

function tryAdvance(buf, live, wide){
  var micIdxBefore = micIdx;
  if (!micWords.length || !buf.length) return { moved: false, res: null, micIdxBefore: micIdxBefore, micIdxAfter: micIdx, curWord: null };
  // Adaptive recovery: after several consecutive final chunks fail to
  // advance (reader skipped a paragraph, long noise, a page-turn overlap,
  // etc.), widen the search window a lot for one attempt instead of
  // staying stuck in the normal, narrower window forever.
  var ahead = live ? 15 : (wide ? 220 : 60), behind = live ? 2 : (wide ? 25 : 10);
  var res = alignBuffer(buf, micIdx, ahead, behind);
  var minConf = live ? 1 : Math.max(2, Math.ceil(buf.length * 0.3));
  var ratio = live ? 0.3 : (wide ? 0.85 : 0.7); // wide recovery needs stronger evidence, since it can jump far
  var pass = res && res.matchedSpoken >= minConf && res.score >= res.matchedSpoken * ratio && res.pageIndex >= micIdx - behind;
  if (!pass) return { moved: false, res: res, micIdxBefore: micIdxBefore, micIdxAfter: micIdx, minConf: minConf, ratio: ratio, curWord: null };
  micIdx = Math.min(res.pageIndex + 1, micWords.length);
  locked = true;
  highlightAt(micIdx - 1);
  smoothScrollTo(micIdx - 1);
  syncPdfHighlight();
  var curWordText = micWords[micIdx - 1] ? micWords[micIdx - 1].el.textContent : null;
  var annoEl = findAnnoNear(micIdx - 1);
  if (annoEl){ if (annoEl !== lastAnnoEl && annoOn){ showTooltipAuto(annoEl); lastAnnoEl = annoEl; } }
  else { lastAnnoEl = null; }
  var out = { moved: true, res: res, micIdxBefore: micIdxBefore, micIdxAfter: micIdx, minConf: minConf, ratio: ratio, curWord: curWordText };
  if (micIdx >= micWords.length && micWords.length > 0){
    if (curPage < BOOK.pages.length){ goPg(curPage + 1); buildMicIndex(curPage); syncPdfHighlight(); }
    else { document.getElementById('micStatus').textContent = 'پایان کتاب!'; stopMic(); }
  }
  return out;
}

function highlightAt(idx){
  // Multiple micWords entries can share the same .el (a multi-word
  // annotation phrase is now split per-word for alignment — see
  // buildMicIndex). Group by element so a phrase doesn't flicker between
  // highlighted/unhighlighted as the loop passes its other word-entries.
  var hlEl = (idx >= 0 && idx < micWords.length) ? micWords[idx].el : null;
  var seen = new Set();
  for (var i = 0; i < micWords.length; i++){
    var w = micWords[i];
    if (seen.has(w.el)) continue;
    seen.add(w.el);
    if (w.el === hlEl) w.el.className = w.isAnno ? 'anno anno-highlight' : 'wl wl-yellow';
    else w.el.className = w.isAnno ? 'anno anno-' + (w.el.dataset.cat || 'word') : 'wl';
  }
}
function findAnnoNear(idx){
  if (idx < 0 || idx >= micWords.length) return null;
  for (var off = 0; off <= 3; off++){
    for (var d = -off; d <= off; d += (off === 0 ? 1 : 2 * off)){
      var check = idx + d;
      if (check < 0 || check >= micWords.length) continue;
      var w = micWords[check];
      if (w.isAnno) return w.el;
    }
  }
  return null;
}
function smoothScrollTo(idx){
  if (idx < 0 || idx >= micWords.length) return;
  var el = micWords[idx].el;
  var rect = el.getBoundingClientRect(); var vpH = window.innerHeight;
  if (rect.top > vpH * 0.2 && rect.bottom < vpH * 0.8) return;
  if (rect.top > vpH * 0.8) window.scrollBy({ top: vpH * 0.5, behavior: 'smooth' });
  if (rect.bottom < vpH * 0.2) window.scrollBy({ top: -vpH * 0.5, behavior: 'smooth' });
}

// ---- session logging (for further tuning) ----
var sessionLog = [], sessionT0 = 0, mediaRecorder = null, audioChunks = [], micStream = null;
function logEvt(o){ o.t = Math.round(performance.now() - sessionT0); sessionLog.push(o); }
function startSessionLogging(){
  sessionLog = []; sessionT0 = performance.now(); audioChunks = [];
  document.getElementById('dlLog').style.display = 'none';
  document.getElementById('dlAudio').style.display = 'none';
  logEvt({ type: 'start', page: curPage, pageWords: micWords.map(function(w){ return w.el.textContent; }),
    pageWordsNorm: micWords.map(function(w){ return w.n; }),
    annoIdx: micWords.map(function(w, i){ return w.isAnno ? i : null; }).filter(function(x){ return x !== null; }),
    ua: navigator.userAgent });
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream){
      micStream = stream;
      var mime = ''; try { if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus'; } catch (e) {}
      mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorder.ondataavailable = function(e){ if (e.data && e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.start(1000);
    }).catch(function(err){ logEvt({ type: 'audio-error', err: String(err) }); });
  }
}
function stopSessionLogging(){
  if (!sessionLog.length) return;
  logEvt({ type: 'stop', micIdx: micIdx, total: micWords.length });
  if (mediaRecorder && mediaRecorder.state !== 'inactive'){
    mediaRecorder.onstop = function(){
      var blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      var url = URL.createObjectURL(blob);
      var a = document.getElementById('dlAudio'); a.href = url; a.download = 'session_audio.webm'; a.style.display = '';
    };
    try { mediaRecorder.stop(); } catch (e) {}
  }
  if (micStream){ micStream.getTracks().forEach(function(t){ t.stop(); }); micStream = null; }
  var jb = new Blob([JSON.stringify(sessionLog, null, 1)], { type: 'application/json' });
  var jurl = URL.createObjectURL(jb);
  var b = document.getElementById('dlLog'); b.href = jurl; b.download = 'session_log.json'; b.style.display = '';
}

var missStreak = 0;
function processFinal(text){
  var words = text.split(/\s+/).filter(function(w){ return w.length > 0; }).map(normW).filter(Boolean);
  if (!words.length) return;
  spokenBuf = spokenBuf.concat(words).slice(-16);
  var wide = missStreak >= 3;
  var r = tryAdvance(spokenBuf, false, wide);
  missStreak = r.moved ? 0 : missStreak + 1;
  logEvt({ type: 'final', raw: text, norm: words, bufLen: spokenBuf.length, res: r.res, moved: r.moved, wide: wide,
    micIdxBefore: r.micIdxBefore, micIdxAfter: r.micIdxAfter, curWord: r.curWord, minConf: r.minConf, ratio: r.ratio });
  var pct = Math.round(micIdx / (micWords.length || 1) * 100);
  var latest = text.split(/\s+/).slice(-4).join(' ');
  var hint = r.moved ? '' : (wide ? ' … (جست‌وجوی گسترده)' : ' …');
  document.getElementById('micStatus').textContent = toFA(pct) + '٪ ← ' + latest + hint;
}
function processInterim(text){
  var words = text.split(/\s+/).filter(function(w){ return w.length > 0; }).map(normW).filter(Boolean);
  if (!words.length) return;
  var tempBuf = spokenBuf.concat(words).slice(-16);
  var r = tryAdvance(tempBuf, locked);
  logEvt({ type: 'interim', raw: text, norm: words, bufLen: tempBuf.length, live: locked, res: r.res, moved: r.moved,
    micIdxBefore: r.micIdxBefore, micIdxAfter: r.micIdxAfter, curWord: r.curWord, minConf: r.minConf, ratio: r.ratio });
  var pct = Math.round(micIdx / (micWords.length || 1) * 100);
  var latest = text.split(/\s+/).slice(-4).join(' ');
  document.getElementById('micStatus').textContent = (r.moved ? toFA(pct) + '٪ ← ' : '...') + latest;
}

function toggleRecording(){
  if (recording){ stopMic(); return; }
  if (ttsPlaying || ttsOn){ document.getElementById('micStatus').textContent = 'ابتدا خوانش صوتی را متوقف کنید'; return; }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'){
    document.getElementById('micStatus').textContent = 'نیاز به HTTPS یا localhost'; return;
  }
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR){ document.getElementById('micStatus').textContent = 'مرورگر پشتیبانی نمی‌کند (از Chrome استفاده کنید)'; return; }
  buildMicIndex(curPage);
  if (!micWords.length){ document.getElementById('micStatus').textContent = 'خطا در آماده‌سازی صفحه'; return; }
  recording = true; spokenBuf = []; locked = false; lastAnnoEl = null;
  lastResultTime = Date.now(); restartAttempts = 0;
  startSessionLogging();
  document.getElementById('micBtn').classList.add('recording');
  document.getElementById('micStatus').textContent = 'در حال گوش دادن...';
  startRecognitionEngine();
  startWatchdog();
}

// Chrome's continuous recognition is known to silently die sometimes
// (no onend fires, no onerror fires — it just stops delivering results)
// or to throw "already started" from onend's restart race. Previously
// that error was swallowed and the mic bar was left showing "recording"
// with a fully dead engine underneath, indistinguishable from it working
// — the most likely explanation for reports that خط‌بَر "doesn't work".
// Fix: build the recognition object in one place so both the initial
// start and every restart go through identical, defended logic, and add
// a watchdog that notices when results stop arriving and forces a real
// restart instead of trusting the browser's own recovery.
var lastResultTime = 0, restartAttempts = 0, watchdogTimer = null;
function startRecognitionEngine(){
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (recognition){ try { recognition.onend = null; recognition.abort(); } catch (x) {} }
  recognition = new SR();
  recognition.lang = 'fa-IR'; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
  recognition.onresult = function(e){
    lastResultTime = Date.now(); restartAttempts = 0;
    var final = '', interim = '';
    for (var i = e.resultIndex; i < e.results.length; i++){
      if (e.results[i].isFinal) final += e.results[i][0].transcript + ' ';
      else interim += e.results[i][0].transcript;
    }
    if (final.trim()) processFinal(final.trim());
    if (interim.trim()) processInterim(interim.trim());
  };
  recognition.onerror = function(e){
    if (e.error === 'not-allowed'){ document.getElementById('micStatus').textContent = 'اجازه میکروفون داده نشد'; stopMic(); return; }
    if (e.error !== 'no-speech' && e.error !== 'aborted') document.getElementById('micStatus').textContent = 'خطا: ' + e.error + ' — تلاش دوباره...';
  };
  recognition.onend = function(){
    if (!recording) return;
    // A short delay avoids the common "recognition has already started"
    // race when the browser fires onend and we restart in the same tick.
    setTimeout(function(){
      if (!recording) return;
      restartAttempts++;
      if (restartAttempts > 5){
        document.getElementById('micStatus').textContent = 'موتور تشخیص گفتار قطع شد — دوباره روی 🎤 بزنید';
        stopMic();
        return;
      }
      startRecognitionEngine();
    }, 250);
  };
  try { recognition.start(); lastResultTime = Date.now(); }
  catch (x) { /* likely "already started" from a fast repeat call — the watchdog will catch a truly dead engine */ }
}
function startWatchdog(){
  clearInterval(watchdogTimer);
  watchdogTimer = setInterval(function(){
    if (!recording){ clearInterval(watchdogTimer); return; }
    // 10s with zero results while actively recording almost always means
    // the engine died silently — force a real restart rather than wait.
    if (Date.now() - lastResultTime > 10000){
      document.getElementById('micStatus').textContent = 'اتصال قطع شد، در حال اتصال دوباره...';
      startRecognitionEngine();
      lastResultTime = Date.now();
    }
  }, 4000);
}
function stopMic(){
  recording = false;
  clearInterval(watchdogTimer);
  stopSessionLogging();
  if (recognition){ try { recognition.abort(); } catch (x) {} recognition = null; }
  document.getElementById('micBtn').classList.remove('recording');
  document.getElementById('micStatus').textContent = 'آماده خط‌بَر...';
  micWords.forEach(function(w){ w.el.className = w.isAnno ? 'anno anno-' + (w.el.dataset.cat || 'word') : 'wl'; });
  micWords = []; micIdx = 0; spokenBuf = []; locked = false; lastAnnoEl = null; missStreak = 0;
  hideTooltip();
  var pdfHl = document.getElementById('pdfHl'); if (pdfHl) pdfHl.style.display = 'none';
}

// Manual resync: while خط‌بَر is recording, click any word to jump the
// tracker there directly — the practical fix for when tracking drifts and
// waiting for the algorithm to self-correct would take too long.
document.addEventListener('click', function(e){
  if (!recording) return;
  var el = e.target.closest && e.target.closest('.wl,.anno');
  if (!el) return;
  var idx = -1;
  for (var i = 0; i < micWords.length; i++){ if (micWords[i].el === el){ idx = i; break; } }
  if (idx < 0) return;
  e.preventDefault();
  micIdx = idx + 1;
  spokenBuf = []; locked = true; missStreak = 0;
  highlightAt(idx);
  smoothScrollTo(idx);
  syncPdfHighlight();
  document.getElementById('micStatus').textContent = 'موقعیت به‌صورت دستی تنظیم شد ✓';
});

// Expose the handful of functions referenced from inline HTML onclick attrs
window.goPg = goPg; window.toggleSidebar = toggleSidebar; window.toggleAnno = toggleAnno;
window.searchBook = searchBook; window.openPdfAt = openPdfAt; window.showMode = showMode;
window.closePdf = closePdf; window.pdfNav = pdfNav; window.pdfZoom = pdfZoom; window.pdfGoto = pdfGoto;
window.switchPdfSource = switchPdfSource;
window.toggleMic = toggleMic; window.toggleRecording = toggleRecording;
window.getCurPage = function(){ return curPage; };
window.openSettings = openSettings; window.closeSettings = closeSettings;
window.applySetting = applySetting; window.setTheme = setTheme;
window.ctxAddAnno = ctxAddAnno; window.ctxEditAnno = ctxEditAnno; window.ctxDeleteAnno = ctxDeleteAnno;
window.ctxEditText = ctxEditText; window.ctxToggleTashkil = ctxToggleTashkil;
window.toggleTashkilBar = toggleTashkilBar; window.insertTashkil = insertTashkil;
window.doEncSearch = doEncSearch; window.closeEncPanel = closeEncPanel; window.ctxSearchEnc = ctxSearchEnc;
window.toggleTts = toggleTts; window.toggleTtsPlay = toggleTtsPlay; window.setTtsRate = setTtsRate;
window.setTtsEngine = setTtsEngine; window.toggleTtsPlayGoogle = toggleTtsPlayGoogle;
})();
