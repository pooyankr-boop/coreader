// src/build/search-index.js
// Lightweight inverted index for client-side search — no external search
// library, keeps the reader small and fast. Maps each normalized word to
// the pages it appears on; the client does the AND-intersection + ranking
// (see src/reader/reader.js searchBook()).

const { normalize } = require('./annotate');

function buildSearchIndex(pages) {
  const index = {}; // normalized word -> Set of page numbers
  pages.forEach(({ page, raw }) => {
    const words = raw.split(/\s+/).filter(Boolean);
    const seenOnPage = new Set();
    words.forEach((wRaw) => {
      const n = normalize(wRaw);
      if (n.length < 2) return;
      if (seenOnPage.has(n)) return; // count each word once per page
      seenOnPage.add(n);
      if (!index[n]) index[n] = [];
      index[n].push(page);
    });
  });
  return index;
}

module.exports = { buildSearchIndex };
