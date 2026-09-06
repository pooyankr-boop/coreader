// src/build/annotate.js
// Two jobs:
//  1) Wrap known glossary terms (curated, hand-authored, PLUS any
//     per-book reviewed candidates) in each page's text as
//     <span class="anno anno-{cat}" data-cat="{cat}" data-text="{gloss}">
//     for the reader's tooltip and right-click annotation menu.
//  2) Flag *candidate* rare words per book (not in the curated glossary,
//     not in the common-Persian reference list) for a human or a later AI
//     pass to gloss — written to candidates.json rather than guessed at,
//     because a wrong invented gloss is worse than an honest "needs review".

const fs = require('fs');
const path = require('path');

const rawGlossary = require('./data/glossary.json');
const commonWords = new Set(require('./data/common-fa-words.json'));
const commonClassical = new Set(require('./data/common-classical-words.json'));

const CATS = ['arabic', 'poem', 'quran', 'hist', 'word', 'person', 'event'];
const DEFAULT_CAT = 'word';

// Normalize the curated glossary into {term: {cat, gloss}} once.
const curatedGlossary = {};
Object.keys(rawGlossary).forEach((k) => {
  if (k === '_note') return;
  const v = rawGlossary[k];
  curatedGlossary[k] = typeof v === 'string' ? { cat: DEFAULT_CAT, gloss: v } : v;
});

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Renders page text with BOTH the curated glossary and any per-book
// reviewed glosses (candidates.json entries with a gloss filled in)
// wrapped as annotation spans. Longest-term-first matching so multi-word
// phrases win over any single word they contain.
function annotatePageHtml(rawText, bookGlosses) {
  const combined = Object.assign({}, curatedGlossary, bookGlosses || {});
  const terms = Object.keys(combined).sort((a, b) => b.length - a.length);
  const escaped = escapeHtml(rawText);
  if (!terms.length) return escaped;
  const re = new RegExp('(' + terms.map(escapeRegex).join('|') + ')', 'g');
  return escaped.replace(re, (m) => {
    const entry = combined[m];
    const cat = CATS.includes(entry.cat) ? entry.cat : DEFAULT_CAT;
    return `<span class="anno anno-${cat}" data-cat="${cat}" data-text="${escapeAttr(entry.gloss)}">${m}</span>`;
  });
}

// Normalize for the rarity check AND the search index — MUST stay
// identical to the reader's own normW (src/reader/reader.js), including
// the phonetic homophone folding, or search queries silently miss pages:
// the index would be built with one normalization and queried with
// another (this was a real, confirmed bug — e.g. "احدیت" not matching
// because ح was folded to ه on the query side but not the index side).
function normalize(w) {
  var s = w.toLowerCase()
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, '')
    .replace(/ـ/g, '')
    .replace(/[إأآءٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[ئىي]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ةه]/g, 'ه')
    .replace(/[^\u0621-\u06FE0-9a-zA-Z]/g, '');
  return s.replace(/[ثصس]/g, 'س').replace(/[ذضظز]/g, 'ز').replace(/[طت]/g, 'ت').replace(/[قغ]/g, 'ق').replace(/[حه]/g, 'ه');
}

// Build a book-wide candidate list: words not already glossed, not common
// (colloquial OR ordinary-classical-formal), appearing a modest number of
// times. Very high-frequency words (even if absent from a colloquial
// reference) are almost always just ordinary formal-register words used
// repeatedly — not rarities — so the useful signal is "uncommon AND used
// sparingly", not "uncommon", full stop.
const MIN_COUNT = 2, MAX_COUNT = 15, MAX_CANDIDATES = 250;

function buildCandidates(pages) {
  const counts = new Map(); // normalized -> {count, sample, sampleWord, page}
  const glossaryNorm = new Set(Object.keys(curatedGlossary).map(normalize));

  pages.forEach(({ page, raw }) => {
    const words = raw.split(/\s+/).filter(Boolean);
    words.forEach((wRaw) => {
      const w = wRaw.replace(/^[^\u0621-\u06FE]+|[^\u0621-\u06FE]+$/g, '');
      if (w.length < 3) return;
      const n = normalize(w);
      if (!n || commonWords.has(w) || commonWords.has(n)) return;
      if (commonClassical.has(w) || commonClassical.has(n)) return;
      if (glossaryNorm.has(n)) return;
      if (!counts.has(n)) counts.set(n, { count: 0, word: w, page });
      counts.get(n).count++;
    });
  });

  const candidates = [];
  for (const [n, info] of counts) {
    if (info.count >= MIN_COUNT && info.count <= MAX_COUNT) {
      candidates.push({ term: info.word, count: info.count, firstPage: info.page, cat: DEFAULT_CAT, gloss: null });
    }
  }
  // Rarest-but-not-unique first — closest to what a reader would actually
  // need explained, rather than words that just happen to be uncommon in
  // colloquial speech but common throughout this particular book.
  candidates.sort((a, b) => a.count - b.count);
  return candidates.slice(0, MAX_CANDIDATES);
}

// Load human/AI-reviewed glosses (candidates.json entries with a gloss
// filled in) as {term: {cat, gloss}}, WITHOUT touching the shared curated
// glossary.json.
function loadBookGlosses(bookDir) {
  const extra = {};
  const candPath = path.join(bookDir, 'candidates.json');
  if (fs.existsSync(candPath)) {
    const cands = JSON.parse(fs.readFileSync(candPath, 'utf8'));
    cands.forEach((c) => {
      if (c.gloss) extra[c.term] = { cat: CATS.includes(c.cat) ? c.cat : DEFAULT_CAT, gloss: c.gloss };
    });
  }
  return extra;
}

module.exports = { annotatePageHtml, buildCandidates, loadBookGlosses, normalize, escapeHtml, CATS };
