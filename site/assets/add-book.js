// src/catalog/add-book.js — client-side "add a new book" pipeline.
//
// Runs entirely in the browser (no backend): accepts a plain text file,
// or one/more PDFs (text-layer extracted via pdf.js; image-only pages
// OCR'd via Tesseract.js), does a best-effort merge when multiple PDFs
// are given, runs the SAME glossary/candidate/search-index logic as the
// Node build (kept in manual sync with src/build/structure.js and
// annotate.js — see the comments marking each mirrored section), and
// writes the result straight into the project via the File System Access
// API (Chrome/Edge only) so no local Node command is required.
//
// Honest scope note: OCR-ing many image-only PDF pages in-browser is
// slow (Tesseract.js runs via WASM on the main thread's Web Worker) and
// works best for shorter texts or a handful of image pages. For a large
// scanned book, src/ocr/ocr_pdf.py (native Tesseract) is faster and more
// reliable — this tool exists so a site visitor with no local Python/
// Node setup can still add something,not to replace that pipeline.

(function () {
'use strict';

var GLOSSARY = null, COMMON_WORDS = null, COMMON_CLASSICAL = null;
var CATS = ['arabic', 'poem', 'quran', 'hist', 'word', 'person', 'event'];

function loadRefData(){
  if (GLOSSARY) return Promise.resolve();
  return Promise.all([
    fetch('assets/glossary.json').then(function(r){ return r.json(); }),
    fetch('assets/common-fa-words.json').then(function(r){ return r.json(); }),
    fetch('assets/common-classical-words.json').then(function(r){ return r.json(); }),
  ]).then(function(res){
    var raw = res[0];
    GLOSSARY = {};
    Object.keys(raw).forEach(function(k){
      if (k === '_note') return;
      var v = raw[k];
      GLOSSARY[k] = typeof v === 'string' ? { cat: 'word', gloss: v } : v;
    });
    COMMON_WORDS = new Set(res[1]);
    COMMON_CLASSICAL = new Set(res[2]);
  });
}

// ===== mirrors src/build/structure.js =====
var HEADING_WORDS = ['باب', 'فصل', 'مقاله', 'خطبه', 'گفتار', 'بخش', 'قسمت',
  'دیباچه', 'ديباچه', 'مقدمه', 'خاتمه', 'ذکر', 'ذكر', 'حکایت', 'حكايت'];
// See structure.js for why this can't use \b — it doesn't work across a
// Persian/Arabic letter boundary in JS regex (not \w), so a lookahead
// against "another Persian letter follows" is used instead.
var HEADING_RE = new RegExp('^(' + HEADING_WORDS.join('|') + ')(?![\\u0621-\\u06FE]).{0,80}$');
function isHeadingLine(line){ var t = line.trim(); return !!t && t.length <= 90 && HEADING_RE.test(t); }
var WORDS_PER_VIRTUAL_PAGE = 200;
function splitIntoVirtualPages(text){
  var words = text.split(/\s+/).filter(Boolean);
  var pages = [];
  for (var i = 0; i < words.length; i += WORDS_PER_VIRTUAL_PAGE) pages.push(words.slice(i, i + WORDS_PER_VIRTUAL_PAGE).join(' '));
  return pages;
}
function stripLeadingPageNumber(text){ return text.replace(/^\uFEFF?\s*\d+\s*\n+/, ''); }
function detectChapters(pages){
  var chapters = [];
  pages.forEach(function(pageText, idx){
    pageText.split('\n').forEach(function(line){
      if (isHeadingLine(line)) chapters.push({ title: line.trim(), startPage: idx + 1 });
    });
  });
  return chapters.filter(function(c, i){ return i === 0 || c.title !== chapters[i-1].title; });
}

// ===== mirrors src/build/annotate.js =====
function escapeHtml(s){ return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escapeAttr(s){ return escapeHtml(s).replace(/"/g, '&quot;'); }
function escapeRegex(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function normalize(w){
  var s = w.toLowerCase()
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, '')
    .replace(/ـ/g, '').replace(/[إأآءٱ]/g, 'ا').replace(/ؤ/g, 'و').replace(/[ئىي]/g, 'ی')
    .replace(/ك/g, 'ک').replace(/[ةه]/g, 'ه').replace(/[^\u0621-\u06FE0-9a-zA-Z]/g, '');
  return s.replace(/[ثصس]/g, 'س').replace(/[ذضظز]/g, 'ز').replace(/[طت]/g, 'ت').replace(/[قغ]/g, 'ق').replace(/[حه]/g, 'ه');
}
function annotatePageHtml(rawText, bookGlosses){
  var combined = Object.assign({}, GLOSSARY, bookGlosses || {});
  var terms = Object.keys(combined).sort(function(a, b){ return b.length - a.length; });
  var escaped = escapeHtml(rawText);
  if (!terms.length) return escaped;
  var re = new RegExp('(' + terms.map(escapeRegex).join('|') + ')', 'g');
  return escaped.replace(re, function(m){
    var entry = combined[m];
    var cat = CATS.indexOf(entry.cat) >= 0 ? entry.cat : 'word';
    return '<span class="anno anno-' + cat + '" data-cat="' + cat + '" data-text="' + escapeAttr(entry.gloss) + '">' + m + '</span>';
  });
}
var MIN_COUNT = 2, MAX_COUNT = 15, MAX_CANDIDATES = 250;
function buildCandidates(pages){
  var counts = {};
  var glossaryNorm = {}; Object.keys(GLOSSARY).forEach(function(k){ glossaryNorm[normalize(k)] = 1; });
  pages.forEach(function(p){
    p.raw.split(/\s+/).filter(Boolean).forEach(function(wRaw){
      var w = wRaw.replace(/^[^\u0621-\u06FE]+|[^\u0621-\u06FE]+$/g, '');
      if (w.length < 3) return;
      var n = normalize(w);
      if (!n || COMMON_WORDS.has(w) || COMMON_WORDS.has(n) || COMMON_CLASSICAL.has(w) || COMMON_CLASSICAL.has(n) || glossaryNorm[n]) return;
      if (!counts[n]) counts[n] = { count: 0, word: w, page: p.page };
      counts[n].count++;
    });
  });
  var candidates = [];
  Object.keys(counts).forEach(function(n){
    var info = counts[n];
    if (info.count >= MIN_COUNT && info.count <= MAX_COUNT) candidates.push({ term: info.word, count: info.count, firstPage: info.page, cat: 'word', gloss: null });
  });
  candidates.sort(function(a, b){ return a.count - b.count; });
  return candidates.slice(0, MAX_CANDIDATES);
}

// ===== mirrors src/build/search-index.js =====
function buildSearchIndex(pages){
  var index = {};
  pages.forEach(function(p){
    var seen = {};
    p.raw.split(/\s+/).filter(Boolean).forEach(function(wRaw){
      var n = normalize(wRaw);
      if (n.length < 2 || seen[n]) return;
      seen[n] = 1;
      if (!index[n]) index[n] = [];
      index[n].push(p.page);
    });
  });
  return index;
}

// ===== PDF extraction: text layer first, OCR fallback =====
function extractPdfPages(file, onProgress){
  return file.arrayBuffer().then(function(buf){
    return pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  }).then(function(doc){
    var pages = [];
    function step(i){
      if (i > doc.numPages) return pages;
      return doc.getPage(i).then(function(page){
        return page.getTextContent().then(function(tc){
          var text = tc.items.map(function(it){ return it.str; }).join(' ').trim();
          if (text.length > 20){
            pages.push(text);
            onProgress(i, doc.numPages, 'text');
            return step(i + 1);
          }
          // No usable embedded text -> render + OCR this page
          var viewport = page.getViewport({ scale: 2 });
          var canvas = document.createElement('canvas');
          canvas.width = viewport.width; canvas.height = viewport.height;
          return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise.then(function(){
            onProgress(i, doc.numPages, 'ocr-start');
            return Tesseract.recognize(canvas, 'fas').then(function(result){
              pages.push((result.data.text || '').trim());
              onProgress(i, doc.numPages, 'ocr-done');
              return step(i + 1);
            });
          });
        });
      });
    }
    return step(1);
  });
}

// ===== Best-effort merge of multiple extracted sources =====
// Real scholarly collation (aligning content across differently-paginated
// editions, judging which variant reading is correct) needs either a
// human editor or an LLM call — not something to fake client-side. This
// does the honest, useful subset: if sources share the same page count,
// pair pages 1:1 and keep whichever page's text is longer (a coarse but
// real proxy for "more complete OCR"); when page counts differ, sources
// are kept only as separately-viewable PDFs (see pdfSources) rather than
// silently guessed together.
function mergeSources(sourcesPages){
  if (sourcesPages.length === 1) return sourcesPages[0];
  var lengths = sourcesPages.map(function(s){ return s.length; });
  var sameCount = lengths.every(function(l){ return l === lengths[0]; });
  if (!sameCount) return sourcesPages[0]; // longest/first upload wins as reading text
  var merged = [];
  for (var i = 0; i < lengths[0]; i++){
    var best = sourcesPages[0][i];
    for (var s = 1; s < sourcesPages.length; s++){
      if ((sourcesPages[s][i] || '').length > (best || '').length) best = sourcesPages[s][i];
    }
    merged.push(best || '');
  }
  return merged;
}

// ===== Orchestration =====
function slugify(title){
  return title.trim().toLowerCase()
    .replace(/[^\u0621-\u06FEa-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'book-' + Date.now();
}

function buildBookFromPages(rawPageTexts, meta){
  var pages = rawPageTexts.map(function(raw, i){ return { page: i + 1, raw: stripLeadingPageNumber(raw) }; });
  var chapters = detectChapters(pages.map(function(p){ return p.raw; }));
  var htmlPages = pages.map(function(p){ return { page: p.page, html: annotatePageHtml(p.raw, {}) }; });
  var candidates = buildCandidates(pages);
  var searchIndex = buildSearchIndex(pages);
  var book = {
    slug: meta.slug, title: meta.title, author: meta.author || 'ناشناس',
    chapters: chapters.length ? chapters : [{ title: '(بدون فصل‌بندی تشخیص‌داده‌شده)', startPage: 1 }],
    pages: htmlPages, searchIndex: searchIndex,
    pdfSources: meta.pdfSources || [], hasPdf: !!(meta.pdfSources && meta.pdfSources.length),
    candidateCount: candidates.length,
  };
  return { book: book, candidates: candidates };
}

// ===== File System Access API — write directly into the project =====
async function writeTextFile(dirHandle, name, text){
  var fh = await dirHandle.getFileHandle(name, { create: true });
  var w = await fh.createWritable();
  await w.write(text);
  await w.close();
}
async function writeBinaryFile(dirHandle, name, blobOrFile){
  var fh = await dirHandle.getFileHandle(name, { create: true });
  var w = await fh.createWritable();
  await w.write(blobOrFile);
  await w.close();
}

async function saveToProject(result, pdfFiles, log){
  if (!window.showDirectoryPicker){
    throw new Error('این قابلیت فقط در Chrome/Edge پشتیبانی می‌شود.');
  }
  log('در انتظار انتخاب پوشهٔ ریشهٔ پروژه (coreader)...');
  var root = await window.showDirectoryPicker();

  var booksDir = await root.getDirectoryHandle('books', { create: true });
  var bookDir = await booksDir.getDirectoryHandle(result.book.slug, { create: true });
  await writeTextFile(bookDir, 'book.json', JSON.stringify(result.book));
  await writeTextFile(bookDir, 'candidates.json', JSON.stringify(result.candidates, null, 2));

  var pdfMeta = [];
  for (var i = 0; i < pdfFiles.length; i++){
    var fname = 'pdf_' + (i + 1) + '.pdf';
    await writeBinaryFile(bookDir, fname, pdfFiles[i]);
    pdfMeta.push({ id: 'pdf_' + (i + 1), label: pdfFiles[i].name.replace(/\.pdf$/i, ''), filename: fname });
  }
  if (pdfMeta.length) await writeTextFile(bookDir, 'pdf-sources.json', JSON.stringify(pdfMeta, null, 2));
  log('books/' + result.book.slug + '/ نوشته شد');

  // Also update site/ directly, so the book is browsable immediately
  // without needing to run `node src/build/cli.js site`.
  var siteDir = await root.getDirectoryHandle('site', { create: true });
  var siteBooksDir = await siteDir.getDirectoryHandle('books', { create: true });
  var siteBookDir = await siteBooksDir.getDirectoryHandle(result.book.slug, { create: true });
  await writeTextFile(siteBookDir, 'book.json', JSON.stringify(result.book));
  for (var j = 0; j < pdfFiles.length; j++){
    await writeBinaryFile(siteBookDir, 'pdf_' + (j + 1) + '.pdf', pdfFiles[j]);
  }
  var assetsDir = await siteDir.getDirectoryHandle('assets', { create: true });
  var templateText;
  try {
    templateText = await (await (await assetsDir.getFileHandle('reader-template.html')).getFile()).text();
  } catch (e) {
    throw new Error('site/assets/reader-template.html یافت نشد — یک‌بار `node src/build/cli.js site` را اجرا کنید تا ساخته شود.');
  }
  var shell = templateText
    .replace('<title>کتاب</title>', '<title>' + result.book.title + '</title>')
    .replace('</head>', "<script>window.BOOK_URL='book.json';</script></head>");
  await writeTextFile(siteBookDir, 'index.html', shell);
  log('site/books/' + result.book.slug + '/ نوشته شد');

  var indexFh = await siteDir.getFileHandle('books-index.json', { create: true });
  var indexText = '';
  try { indexText = await (await indexFh.getFile()).text(); } catch (e) {}
  var catalog = [];
  try { catalog = JSON.parse(indexText) || []; } catch (e) { catalog = []; }
  catalog = catalog.filter(function(c){ return c.slug !== result.book.slug; });
  catalog.push({
    slug: result.book.slug, title: result.book.title, author: result.book.author,
    pages: result.book.pages.length, hasPdf: pdfMeta.length > 0, candidateCount: result.candidates.length,
  });
  await writeTextFile(siteDir, 'books-index.json', JSON.stringify(catalog, null, 2));
  log('books-index.json به‌روزرسانی شد ✓');
}

window.coreaderAddBook = {
  loadRefData: loadRefData,
  extractPdfPages: extractPdfPages,
  mergeSources: mergeSources,
  buildBookFromPages: buildBookFromPages,
  saveToProject: saveToProject,
  slugify: slugify,
};
})();
