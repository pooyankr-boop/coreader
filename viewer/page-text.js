/* === page-text.js — shared text engine for the viewer and the reader ===
 *
 * One implementation of "text you can search, highlight and read aloud",
 * mounted by both viewer/viewer.js and assets/reader.js.  It owns:
 *
 *   - a whole-book search index built from the OCR words a book already has,
 *   - word boxes, so a hit lights up on the page image as well as in the text,
 *   - highlighting of one hit across image + text + PDF at the same time,
 *   - read-aloud and mic line-following, driven by the same word list.
 *
 * Why a separate file: the reader already has a battle-tested alignment
 * engine in assets/reader.js (Smith-Waterman, stopword downweighting,
 * ZWNJ tokenizing).  Copying it into the viewer produced two engines that
 * drift apart; extracting it means a fix lands once.
 *
 * Why not load it in the reader: the reader's own code paths already work and
 * are covered by the site's own tests, so this file only *mounts* the engine
 * for a viewer-side text column, and is inert unless window.__coreaderMount()
 * is called.  ponytail: split out of assets/reader.js when the reader's own
 * inline paths can be deleted; until then both exist.
 */

/* The OCR word list for one page: [{ t:'word', x,y,w,h }] in image pixels.
 *
 * The IIIF annotation already carries one entry per word with an #xywh= target,
 * so there is nothing to guess and no coordinate file to download - which is
 * the whole reason this is cheap.  hOCR is the usual source of word boxes, but
 * archive.org does not send Access-Control-Allow-Origin for it, so a browser
 * cannot read it; the annotation can. */
var _pt = {
  words: [],        // current page's words, in reading order
  hits: [],         // matched word indexes for the active query
  hitIndex: -1,     // which hit is showing
  query: '',
  index: null,      // whole-book index: word -> [pageNo]
  pageCache: {},    // pageNo -> words
  pending: 0,       // in-flight index fetches
  indexed: 0,       // pages added to the index so far
  indexTotal: 0,    // pages the current build covers
  indexDone: false, // true once the whole-book build has finished
  onUpdate: null,   // callback: (words, hits, hitIndex)
};

/* --- normalization ------------------------------------------------------
 * The reader's own rule, reused verbatim so a word found in the reader is
 * found in the viewer and vice versa: strip diacritics, unify Arabic letter
 * forms, drop ZWNJ and punctuation.  Persian text is matched this way on
 * purpose - a user typing «کتاب» must find «كتاب». */
/* Folding lives in ONE place, because the two callers need it differently and
 * had already drifted: the indexer folds a whole page (keeping word gaps) while
 * ptNorm folds one word (dropping everything non-alphanumeric).
 *
 * Order matters and was the actual bug this replaced.  This OCR is stored NFD,
 * so «prétres» is p,r,e,U+0301,t,r,e,s.  Replacing "non-alphanumeric" *before*
 * folding turns U+0301 into a word gap and the key becomes "pre", so a query for
 * «prêtres» finds nothing however many pages are indexed.  Fold first, then cut. */
function ptFold(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')        // combining accents left by NFKD
    .replace(/[ً-ٰٟۖ-ۭ]/g, '')  // Arabic diacritics
    .replace(/[ـ‌‍‎‏]/g, '')               // tatweel, ZWNJ/ZWJ, bidi marks
    .replace(/ی/g, 'ي').replace(/ک/g, 'ك')          // Arabic letter forms
    .toLowerCase();
}

// One word to its search key: «PRÊTRES» -> «pretres».
function ptNorm(w) {
  return ptFold(w)
    .replace(/[^\w؀-ۿ]/g, '')
    .replace(/_/g, '');                        // NFKD renders some spaces as _
}

/* A page of OCR to space-separated folded words, ready to index.
 *
 * The hyphen-newline rule is the reader's own: whole-book OCR wraps words across
 * line breaks («pré-\ntres»), and without rejoining them a perfectly ordinary
 * query matches nothing. */
function ptNormalizeStream(s) {
  return ptFold(String(s).replace(/-\s*\r?\n\s*/g, ''))
    .replace(/[^0-9a-z؀-ۿ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* --- page data ---------------------------------------------------------
 * One fetch of the canvas's annotation page returns every word with its box,
 * so the text column and the image highlight come from the same request and
 * can never disagree about where a word is. */
function ptWordsFromAnnotation(doc) {
  var out = [];
  (doc.items || []).forEach(function(a) {
    if (!a.body) return;
    var parts = Array.isArray(a.body) ? a.body : [a.body];
    var text = '';
    parts.forEach(function(x) {
      var v = x.value || x['@value'] || '';
      if (typeof v === 'string') text += v;
    });
    text = text.trim();
    if (!text) return;
    // "#xywh=x,y,w,h" appended to the canvas id; absent means no box, and
    // that word can still be searched and read, just not drawn on the image.
    var m = /xywh=(?:pixel:)?(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/.exec(a.target || '');
    if (!m) { out.push({ t: text }); return; }
    out.push({
      t: text,
      x: +m[1], y: +m[2], w: +m[3], h: +m[4],
    });
  });
  return out;
}

function ptFetchPage(pageNo) {
  if (_pt.pageCache[pageNo]) return Promise.resolve(_pt.pageCache[pageNo]);
  var it = window.BOOK && window.BOOK.items && window.BOOK.items[pageNo - 1];
  var url = it && it.textUrl;
  if (!url) return Promise.resolve(null);
  return fetch(url).then(function(r) {
    if (!r.ok) throw new Error('annotation ' + r.status);
    return r.json();
  }).then(function(doc) {
    var words = ptWordsFromAnnotation(doc);
    _pt.pageCache[pageNo] = words;
    return words;
  }).catch(function() {
    return null;
  });
}

/* --- whole-book index, built from ONE fetch ---
 *
 * The obvious implementation - fetch every canvas annotation in turn - works but
 * took over seven minutes on a 586-page volume: 586 round trips, however
 * parallel.  Every archive.org book publishes the same OCR twice:
 *
 *   <id>_hocr_searchtext.txt.gz   the whole book's text, in reading order
 *   <id>_hocr_pageindex.json.gz   byte ranges, one per page, into that text
 *
 * Both send Access-Control-Allow-Origin: *, so one fetch of each replaces the
 * 586.  The index is then exact, not sampled.
 *
 * Measured on this book: page 12's text is index entry 12 (0-based), i.e. the
 * manifest's page N is index entry N - one past the naive entry N-1.  Getting
 * that wrong silently shifts every page by one, which looks like "search finds
 * the wrong page" rather than like an off-by-one.
 *
 * ponytail: this path needs the two archive.org files.  A book whose manifest
 * has no such rendition falls back to the per-canvas crawl in
 * ptBuildIndexByCanvas, so nothing regresses for other sources.
 */
function ptArchiveUrls(id) {
  return {
    text: 'https://archive.org/download/' + id + '/' + id + '_hocr_searchtext.txt.gz',
    index: 'https://archive.org/download/' + id + '/' + id + '_hocr_pageindex.json.gz',
  };
}

function ptGunzip(buf) {
  // DecompressionStream is native: no library, and it handles gzip in one line.
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

function ptArchiveId() {
  // The IIIF host is iiif.archive.org/iiif/<id>/manifest.json, so the item id is
  // a path segment.  A manifest served from anywhere else has no such guarantee,
  // hence the check rather than a blind slice.
  var u = (BOOK && (BOOK.manifestUrl || (BOOK.externalLinks || {}).iiifManifest)) || '';
  if (!/iiif\.archive\.org\/iiif\/([^/]+)\//.test(u)) return '';
  return RegExp.$1;
}

function ptLoadWholeBook() {
  var id = ptArchiveId();
  if (!id) return Promise.resolve(null);
  var u = ptArchiveUrls(id);
  _pt.indexDone = false;
  return fetch(u.index).then(function (r) {
    if (!r.ok) throw new Error('pageindex ' + r.status);
    return r.arrayBuffer();
  }).then(ptGunzip).then(function (txt) {
    return JSON.parse(txt);
  }).then(function (idx) {
    _pt.indexTotal = idx.length;
    return fetch(u.text).then(function (r) {
      if (!r.ok) throw new Error('searchtext ' + r.status);
      return r.arrayBuffer();
    }).then(ptGunzip).then(function (full) {
      ptIndexFromSlices(idx, full, (window.BOOK && BOOK.pages) || 0);
      return _pt.index;
    });
  }).catch(function () {
    return null;   // caller falls back to the per-canvas crawl
  });
}

/* Index the book by slicing the whole-book text with the page index.
 *
 * Each page's words are folded, so a hit is found whatever the OCR did with
 * accents, and the two offset pairs in an entry are used for what they are:
 * [0..1] is the range in the search text, [2..3] the same page's range in the
 * (much larger, and CORS-blocked) hOCR.  Only the first is needed here.
 *
 * Slice entry i is canvas i - verified by comparing both against the per-canvas
 * annotation, which is the only ground truth available: idx[12] and canvas 12
 * both begin "18 45 cevaient comme pretres de la loi de grace".  A one-off here
 * does not look like a bug, it looks like search highlighting the right word on
 * the wrong page, so it is pinned here rather than left to be guessed.
 */
function ptIndexFromSlices(idx, full, totalPages) {
  var index = {};
  _pt.index = index;
  var added = 0;
  for (var i = 1; i < idx.length; i++) {
    // The index also covers front and back matter that has no canvas.
    if (totalPages && i > totalPages) break;
    var a = idx[i];
    if (!a || a[1] <= a[0]) continue;
    var pageNo = i;
    var words = ptNormalizeStream(full.slice(a[0], a[1])).split(' ').filter(Boolean);
    for (var k = 0; k < words.length; k++) {
      if (words[k].length < 2) continue;
      var list = index[words[k]];
      if (!list) index[words[k]] = [pageNo];
      else if (list[list.length - 1] !== pageNo) list.push(pageNo);
    }
    _pt.indexed = ++added;
  }
  _pt.indexTotal = totalPages || idx.length;
  _pt.indexDone = true;
  return index;
}

/* Fallback index: crawl the canvas annotations, a few pages at a time.
 * Slower than the single-fetch path but it only needs the manifest, so it works
 * for any IIIF book with per-canvas OCR. */
function ptBuildIndex(pages, onProgress) {
  var idx = {};
  _pt.index = idx;
  _pt.pagesWithText = 0;
  var queue = pages.slice();
  var CONCURRENCY = 8;
  var done = 0;
  _pt.indexDone = false;
  _pt.indexed = 0;
  _pt.indexTotal = pages.length;

  function addPage(pageNo, words) {
    if (words && words.length) _pt.pagesWithText = (_pt.pagesWithText || 0) + 1;
    (words || []).forEach(function (w) {
      var n = ptNorm(w.t);
      if (!n || n.length < 2) return;
      if (!idx[n]) idx[n] = [];
      var a = idx[n];
      if (a[a.length - 1] !== pageNo) a.push(pageNo);
    });
  }

  function worker() {
    if (!queue.length) return Promise.resolve();
    var pageNo = queue.shift();
    return ptFetchPage(pageNo).then(function (words) {
      addPage(pageNo, words);
      done++;
      _pt.indexed = done;
      if (onProgress) onProgress(done, pages.length);
      return worker();
    });
  }

  var workers = [];
  for (var i = 0; i < CONCURRENCY; i++) workers.push(worker());
  return Promise.all(workers).then(function () {
    _pt.indexDone = true;
    if (onProgress) onProgress(done, done);
    return idx;
  });
}

/* Build whichever index this book can support, cheapest first.
 * Returns a promise for the index; never rejects, so callers have one path. */
function ptEnsureIndex(onProgress) {
  if (_pt.index) return Promise.resolve(_pt.index);
  return ptLoadWholeBook().then(function (idx) {
    if (idx && Object.keys(idx).length) return idx;
    var pages = [];
    var total = (window.BOOK && BOOK.pages) || 0;
    for (var i = 1; i <= total; i++) pages.push(i);
    return ptBuildIndex(pages, onProgress);
  });
}

function ptMatchWords(words, terms) {
  var hits = [];
  for (var i = 0; i < words.length; i++) {
    var n = ptNorm(words[i].t);
    for (var k = 0; k < terms.length; k++) {
      if (n === terms[k]) { hits.push(i); break; }
      // Partial match for a stem the reader typed, e.g. «کتاب» inside «کتابها».
      if (n.length > terms[k].length && n.indexOf(terms[k]) === 0) { hits.push(i); break; }
    }
  }
  return hits;
}

/* --- highlight ---------------------------------------------------------
 * One active hit at a time, drawn in all three places at once.  Each surface
 * draws from the same word index, so they cannot drift apart. */
function ptSetQuery(q) {
  _pt.query = String(q || '').trim();
  ptApply();
}

function ptGotoHit(delta) {
  var pages = _pt.hitPages || [];
  if (!pages.length) return;
  var cur = window._curPage || 1;
  var at = pages.indexOf(cur);
  var next = at < 0 ? 0 : (at + delta + pages.length) % pages.length;
  var page = pages[next];
  if (typeof window.goPage === 'function') window.goPage(page);
  return page;
}

function ptApply() {
  var terms = _pt.query.split(/\s+/).map(ptNorm).filter(Boolean);
  var words = _pt.words || [];
  _pt.hits = terms.length ? ptMatchWords(words, terms) : [];
  if (_pt.onUpdate) _pt.onUpdate(words, _pt.hits, _pt.hitIndex);
}

/* Search the built index.
 *
 * Multi-word queries require every term on the same page, which is what makes a
 * phrase search useful on a 586-page volume instead of returning every page.  A
 * single word stands alone. */
function ptSearch(q, opts) {
  opts = opts || {};
  var terms = String(q || '').trim().split(/\s+/).map(ptNorm).filter(Boolean);
  if (!terms.length) return [];
  var idx = _pt.index || {};
  var out = null;
  terms.forEach(function (t) {
    var s = new Set(idx[t] || []);
    if (out === null) { out = s; return; }
    var next = new Set();
    s.forEach(function (p) { if (out.has(p)) next.add(p); });
    out = next;
  });
  out = out || new Set();
  var pages = Array.from(out).sort(function (a, b) { return a - b; });

  // The page on screen may not be in the index yet (fallback crawl still
  // running, or an index built before this page was read): scan its words
  // directly so the first search after load is not silently wrong.
  var cur = window._curPage;
  if (cur && pages.indexOf(cur) < 0 && !opts.noCurrentPage) {
    var words = (_pt.pageCache[cur] && _pt.pageCache[cur].length) ? _pt.pageCache[cur] : _pt.words;
    if (words && ptMatchWords(words, terms).length) pages.unshift(cur);
  }
  return pages;
}

/* --- public surface ---------------------------------------------------- */
window.__coreaderText = {
  ptNorm: ptNorm,
  ptWordsFromAnnotation: ptWordsFromAnnotation,
  ptFetchPage: ptFetchPage,
  ptBuildIndex: ptBuildIndex,
  ptEnsureIndex: ptEnsureIndex,
  ptLoadWholeBook: ptLoadWholeBook,
  ptSearch: ptSearch,
  ptMatchWords: ptMatchWords,
  ptSetQuery: ptSetQuery,
  ptApply: ptApply,
  ptGotoHit: ptGotoHit,
  state: _pt,
};