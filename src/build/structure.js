// src/build/structure.js
// Turns raw source text into a structured book: pages + detected chapters.
//
// Two input modes:
//  - a single continuous .txt file  -> split into virtual pages by word count
//  - a directory of page_NNN.txt files (one file per real printed page,
//    e.g. from OCR or a pre-paginated source) -> pages map 1:1 to files,
//    which keeps correspondence with a source PDF's page numbers intact.

const fs = require('fs');
const path = require('path');

const WORDS_PER_VIRTUAL_PAGE = 200;

// Headings that mark a new chapter/section in classical Persian prose.
// A line is treated as a heading if it's short and starts with one of
// these (optionally followed by an ordinal word or Persian/Arabic digits).
//
// NOTE: this deliberately does NOT use \b after the heading word. JS's \b
// is defined only in terms of ASCII \w ([A-Za-z0-9_]) — Persian/Arabic
// letters aren't \w, so \b never matches at a boundary between two
// Persian letters (or between a Persian letter and a space). That silently
// broke chapter detection entirely (every book fell through to the "no
// chapters" placeholder). The fix: require whatever follows the heading
// word to NOT be another Persian/Arabic letter, via a lookahead — that's
// the actual condition "start of a distinct word" means here.
const HEADING_WORDS = [
  'باب', 'فصل', 'مقاله', 'خطبه', 'گفتار', 'بخش', 'قسمت',
  'دیباچه', 'ديباچه', 'مقدمه', 'خاتمه', 'ذکر', 'ذكر', 'حکایت', 'حكايت'
];
const HEADING_RE = new RegExp(
  '^(' + HEADING_WORDS.join('|') + ')(?![\\u0621-\\u06FE]).{0,80}$'
);

function isHeadingLine(line) {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  return HEADING_RE.test(t);
}

// OCR page-text files very often carry the printed page number as their
// own first line (an artifact of the scan, not book content) — strip a
// leading line that is only a number (optionally with a BOM before it).
function stripLeadingPageNumber(text) {
  return text.replace(/^\uFEFF?\s*\d+\s*\n+/, '');
}

function splitIntoVirtualPages(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const pages = [];
  for (let i = 0; i < words.length; i += WORDS_PER_VIRTUAL_PAGE) {
    pages.push(words.slice(i, i + WORDS_PER_VIRTUAL_PAGE).join(' '));
  }
  return pages;
}

// Some digitized texts already carry their own explicit page-break marker
// convention, e.g. "=== صفحه 12 ===" or "--- page 12 ---". Pretending
// those don't exist and chopping by a flat word count ignores real page
// boundaries the source already has AND leaves marker lines sitting mid-
// page in the output (confirmed: a client-uploaded book showed
// "=== صفحه 1 === 1 بسم..." as literal reading text). If a consistent
// marker pattern is found, split on it and use it as the real pagination
// instead of guessing.
const PAGE_MARKER_RE = /^[=\-*_]{2,}\s*(?:صفحه|page)\s*\d+\s*[=\-*_]{2,}$/im;
function splitByExplicitMarkers(text) {
  if (!PAGE_MARKER_RE.test(text)) return null;
  const parts = text.split(new RegExp(PAGE_MARKER_RE.source, 'gim'))
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : null;
}
function splitIntoPages(text) {
  return splitByExplicitMarkers(text) || splitIntoVirtualPages(text);
}

function detectChapters(pages) {
  // pages: array of raw page text (1-indexed conceptually, array is 0-indexed)
  const chapters = [];
  pages.forEach((pageText, idx) => {
    const pageNum = idx + 1;
    pageText.split('\n').forEach((line) => {
      if (isHeadingLine(line)) {
        chapters.push({ title: line.trim(), startPage: pageNum });
      }
    });
  });
  // De-duplicate consecutive identical headings that fell on adjacent pages
  return chapters.filter((c, i) => i === 0 || c.title !== chapters[i - 1].title);
}

// Load from a directory of page_*.txt files (sorted numerically), OR a
// single .txt file (paginated virtually by word count).
function loadSource(inputPath) {
  const stat = fs.statSync(inputPath);
  let rawPages;
  if (stat.isDirectory()) {
    const files = fs.readdirSync(inputPath)
      .filter((f) => /^page[_-]?\d+\.txt$/i.test(f))
      .sort((a, b) => {
        const na = parseInt(a.match(/\d+/)[0], 10);
        const nb = parseInt(b.match(/\d+/)[0], 10);
        return na - nb;
      });
    if (!files.length) {
      throw new Error('No page_NNN.txt files found in directory: ' + inputPath);
    }
    rawPages = files.map((f) => stripLeadingPageNumber(fs.readFileSync(path.join(inputPath, f), 'utf8')));
  } else {
    const text = fs.readFileSync(inputPath, 'utf8');
    rawPages = splitIntoPages(text).map(stripLeadingPageNumber);
  }
  const chapters = detectChapters(rawPages);
  return {
    pages: rawPages.map((raw, i) => ({ page: i + 1, raw })),
    chapters: chapters.length ? chapters : [{ title: '(بدون فصل‌بندی تشخیص‌داده‌شده)', startPage: 1 }],
  };
}

module.exports = { loadSource, isHeadingLine, splitIntoVirtualPages, splitIntoPages, detectChapters };
