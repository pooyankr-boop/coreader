// One-time processing script: converts the raw hermitdave/FrequencyWords
// Persian frequency list into a filtered common-word JSON array used by
// the annotation "rarity" heuristic (src/build/annotate.js).
//
// Note on source: this frequency list is derived from OpenSubtitles
// (movie/TV dialogue), so it's a *colloquial, modern* reference — which is
// actually useful here: classical/literary/Arabic-loan vocabulary almost
// never appears in film dialogue, so absence from this list is a decent
// (if coarse) signal that a word may need a gloss for a classical text.
// It will also flag some ordinary *formal* modern words that just don't
// come up in dialogue — those get reviewed and dropped, not published,
// by annotate.js's curated-glossary-first logic.
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'fa_50k_raw.txt'), 'utf8');
const words = [];
for (const line of raw.split('\n')) {
  const parts = line.trim().split(' ');
  if (parts.length < 2) continue;
  const w = parts[0];
  if (!/^[\u0600-\u06FF]+$/.test(w)) continue;
  if (w.length < 2) continue;
  words.push(w);
  if (words.length >= 7000) break;
}
fs.writeFileSync(
  path.join(__dirname, 'common-fa-words.json'),
  JSON.stringify(words)
);
fs.unlinkSync(path.join(__dirname, 'fa_50k_raw.txt'));
console.log('Wrote', words.length, 'common words to common-fa-words.json');
