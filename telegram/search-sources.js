// telegram/search-sources.js — جستجوی منابع باز و موزه‌ها با فیلتر.
// پیش‌فرض: کتاب، دست‌نوشته، شیء موزه‌ای و نقاشی؛ برای اشیا و نقاشی‌ها فقط آثار تا ۱۹۵۰ (اسناد اداری و گزارش‌ها حذف می‌شوند).
const UA = 'coreader/1.0 (open reading site)';
const DEFAULT_KINDS = ['book', 'manuscript', 'object', 'painting'];
const HISTORIC_TO = '1950';

async function getJson(url, ms) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms || 12000), headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const yearNum = (y) => { const m = String(y || '').match(/\d{3,4}/); return m ? +m[0] : null; };

// ---- منابع با API عمومی ----
async function internetArchive(q, o) {
  let expr = '(title:(' + q + ') OR creator:(' + q + ') OR subject:(' + q + ')) AND (mediatype:texts OR mediatype:image)';
  expr += ' AND NOT subject:(catalog OR catalogue OR report OR minutes OR newsletter OR thesis)';
  if (o.yearFrom || o.yearTo) expr += ' AND year:[' + (o.yearFrom || '1') + ' TO ' + (o.yearTo || '2100') + ']';
  const url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(expr) +
    '&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=language&fl[]=mediatype&fl[]=subject&rows=' + o.limit + '&page=1&output=json';
  const j = await getJson(url);
  return ((j.response && j.response.docs) || []).map((d) => {
    const subj = [].concat(d.subject || []).join(' ').toLowerCase();
    return {
      source: 'Internet Archive', kind: /manuscript|دست/.test(subj) ? 'manuscript' : (d.mediatype === 'image' ? 'object' : 'book'),
      title: d.title, author: [].concat(d.creator || [])[0] || '', year: String(d.year || ''),
      lang: [].concat(d.language || [])[0] || '', url: 'https://archive.org/details/' + d.identifier,
      iiif: 'https://iiif.archive.org/iiif/' + d.identifier + '/manifest.json', pdf: ''
    };
  });
}
async function openLibrary(q, o) {
  const j = await getJson('https://openlibrary.org/search.json?q=' + encodeURIComponent(q) +
    '&limit=' + o.limit + '&fields=key,title,author_name,first_publish_year,language,ia');
  return (j.docs || []).map((x) => ({
    source: 'Open Library', kind: 'book', title: x.title, author: (x.author_name || [])[0] || '',
    year: String(x.first_publish_year || ''), lang: (x.language || [])[0] || '',
    url: 'https://openlibrary.org' + x.key, iiif: x.ia && x.ia[0] ? 'https://iiif.archive.org/iiif/' + x.ia[0] + '/manifest.json' : '', pdf: ''
  }));
}
async function gutenberg(q, o) {
  const j = await getJson('https://gutendex.com/books/?search=' + encodeURIComponent(q), 20000);
  return (j.results || []).slice(0, o.limit).map((b) => ({
    source: 'Project Gutenberg', kind: 'book', title: b.title, author: ((b.authors || [])[0] || {}).name || '',
    year: '', lang: (b.languages || [])[0] || '', url: 'https://www.gutenberg.org/ebooks/' + b.id,
    iiif: '', pdf: (b.formats || {})['application/pdf'] || ''
  }));
}
async function wikisource(q, lang, o) {
  const j = await getJson('https://' + lang + '.wikisource.org/w/api.php?action=query&list=search&srlimit=' + o.limit + '&format=json&srsearch=' + encodeURIComponent(q));
  return ((j.query && j.query.search) || []).map((s) => ({
    source: 'Wikisource (' + lang + ')', kind: 'book', title: s.title, author: '', year: '', lang: lang,
    url: 'https://' + lang + '.wikisource.org/wiki/' + encodeURIComponent(s.title.replace(/ /g, '_')), iiif: '', pdf: ''
  }));
}
async function met(q, o) {
  const s = await getJson('https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=' + encodeURIComponent(q));
  const ids = (s.objectIDs || []).slice(0, 8);
  const items = await Promise.all(ids.map((id) => getJson('https://collectionapi.metmuseum.org/public/collection/v1/objects/' + id, 8000).catch(() => null)));
  return items.filter(Boolean).map((x) => ({
    source: 'The Met', kind: /paint/i.test(x.objectName || '') ? 'painting' : 'object', title: x.title,
    author: x.artistDisplayName || '', year: x.objectDate || String(x.objectBeginDate || ''), lang: '',
    url: x.objectURL, iiif: '', pdf: '', image: x.primaryImageSmall || '', rights: x.isPublicDomain ? 'public domain' : ''
  }));
}
async function cleveland(q, o) {
  const j = await getJson('https://openaccess-api.clevelandart.org/api/artworks/?has_image=1&limit=' + Math.min(o.limit, 10) + '&q=' + encodeURIComponent(q));
  return (j.data || []).map((x) => ({
    source: 'Cleveland Museum of Art', kind: /paint/i.test(x.type || '') ? 'painting' : 'object', title: x.title,
    author: (x.creators && x.creators[0] && x.creators[0].description) || '', year: x.creation_date || '', lang: '',
    url: x.url, iiif: '', pdf: '', image: (x.images && x.images.web && x.images.web.url) || '', rights: x.share_license || ''
  }));
}
async function vam(q, o) {
  const j = await getJson('https://api.vam.ac.uk/v2/objects/search?has_image=1&page_size=' + Math.min(o.limit, 10) + '&q=' + encodeURIComponent(q));
  return (j.records || []).map((x) => ({
    source: 'V&A', kind: /painting/i.test(x.objectType || '') ? 'painting' : 'object', title: x._primaryTitle || x.objectType,
    author: (x._primaryMaker && x._primaryMaker.name) || '', year: x._primaryDate || '', lang: '',
    url: 'https://collections.vam.ac.uk/item/' + x.systemNumber, iiif: 'https://iiif.vam.ac.uk/' + x.systemNumber + '/manifest.json', pdf: ''
  }));
}
async function loc(q, o) {
  const j = await getJson('https://www.loc.gov/search/?q=' + encodeURIComponent(q) + '&fo=json&c=' + o.limit + '&at=results');
  return (j.results || []).map((x) => ({
    source: 'Library of Congress', kind: /manuscript/i.test((x.online_format || []).join(' ')) ? 'manuscript' : 'book',
    title: x.title, author: '', year: String(x.date || ''), lang: (x.language || [])[0] || '', url: x.url,
    iiif: '', pdf: ''
  }));
}

const CONNECTORS = {
  'Internet Archive': internetArchive, 'Open Library': openLibrary, 'Project Gutenberg': gutenberg,
  'Wikisource fa': (q, o) => wikisource(q, 'fa', o), 'Wikisource en': (q, o) => wikisource(q, 'en', o),
  'The Met': met, 'Cleveland Museum of Art': cleveland, 'V&A': vam, 'Library of Congress': loc
};

// ---- منابع موزه‌ای فعلی کتابخانه که API عمومی ندارند: جستجوی مستقیم در سایت خودشان ----
const MANUAL = [
  { name: 'Smithsonian (Freer/Sackler)', url: 'https://www.si.edu/search/collection-images?edan_q=' },
  { name: 'Getty Museum', url: 'https://www.getty.edu/search/?q=' },
  { name: 'Hermitage', url: 'https://www.hermitagemuseum.org/wps/portal/hermitage/digital-collection/search?q=' },
  { name: 'Bodleian Digital Library', url: 'https://digital.bodleian.ox.ac.uk/search/?q=' },
  { name: 'Bayerische Staatsbibliothek (digitale-sammlungen)', url: 'https://www.digitale-sammlungen.de/en/search?query=' },
  { name: 'Qatar Digital Library', url: 'https://www.qdl.qa/en/search/site/' }
];

function normalizeOptions(o) {
  o = o || {};
  const kinds = (o.kinds && o.kinds.length ? o.kinds : DEFAULT_KINDS);
  const sources = o.sources && o.sources.length ? o.sources : Object.keys(CONNECTORS);
  return {
    kinds: kinds, sources: sources, lang: (o.lang || '').toLowerCase(),
    yearFrom: o.yearFrom || '', yearTo: o.yearTo || '',
    iiif: !!o.iiif, pdf: !!o.pdf, limit: Math.min(Math.max(+o.limit || 12, 5), 25),
    historicOnly: o.historicOnly !== false
  };
}

function passes(item, o) {
  if (o.kinds.indexOf(item.kind) === -1) return false;
  if (o.iiif && !item.iiif) return false;
  if (o.pdf && !item.pdf) return false;
  if (o.lang && item.lang && item.lang.toLowerCase().indexOf(o.lang) === -1) return false;
  const y = yearNum(item.year);
  if (o.yearFrom && y !== null && y < +o.yearFrom) return false;
  if (o.yearTo && y !== null && y > +o.yearTo) return false;
  // اشیا و نقاشی‌ها: پیش‌فرض فقط آثار تاریخی (تا ۱۹۵۰)
  if (o.historicOnly && (item.kind === 'object' || item.kind === 'painting') && y !== null && y > +HISTORIC_TO) return false;
  return true;
}

async function search(q, options) {
  const o = normalizeOptions(options);
  const names = o.sources.filter((n) => CONNECTORS[n]);
  const settled = await Promise.allSettled(names.map((n) => CONNECTORS[n](q, o)));
  const results = [];
  const errors = {};
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') results.push(...r.value.filter((it) => passes(it, o)));
    else errors[names[i]] = (r.reason && r.reason.message) || 'خطا';
  });
  const providers = MANUAL.map((m) => ({ name: m.name, url: m.url + encodeURIComponent(q), manual: true }));
  return { results: results.slice(0, o.limit * names.length), providers: providers, errors: errors };
}

module.exports = { search, sources: () => Object.keys(CONNECTORS), manual: () => MANUAL };