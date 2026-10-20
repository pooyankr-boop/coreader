// session/source-search.js — ابزار جستجوی منابع با فیلتر (برای صفحهٔ نشست و افزودن کتاب به کاتالوگ).
// پیش‌فرض: کتاب، دست‌نوشته، شیء موزه‌ای و نقاشی تاریخی.
const STYLE = `
.ss{font-family:inherit}
.ss .bar{display:flex;gap:8px;flex-wrap:wrap}
.ss .bar input{flex:1 1 260px}
.ss details{margin:10px 0;border:1px dashed var(--border);border-radius:12px;padding:10px 12px;background:var(--bg2)}
.ss summary{cursor:pointer;color:var(--accent);font-weight:600}
.ss .grid{display:grid;gap:8px 14px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-top:10px}
.ss label{font-size:13px;color:var(--muted);display:flex;gap:6px;align-items:center}
.ss .res{border:1px solid var(--border);border-radius:14px;padding:12px 14px;margin:8px 0;background:var(--card)}
.ss .res b{font-size:15px}
.ss .tag{display:inline-block;font-size:12px;padding:2px 8px;border-radius:999px;background:var(--bg2);color:var(--muted);border:1px solid var(--border);margin-inline-end:4px}
.ss .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.ss .acts a,.ss .acts button{font-size:13px;padding:7px 12px;border-radius:10px}
.ss .prov a{display:inline-block;margin:4px 6px 0 0;font-size:13px;color:var(--accent)}
.ss .warn{color:var(--muted);font-size:12px;margin-top:6px}
`;
function ensureStyle() {
  if (document.getElementById('ss-style')) return;
  const st = document.createElement('style');
  st.id = 'ss-style';
  st.textContent = STYLE;
  document.head.appendChild(st);
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND_LABEL = { book: 'کتاب', manuscript: 'دست‌نوشته', object: 'شیء موزه‌ای', painting: 'نقاشی' };
const SOURCES = ['Internet Archive', 'Open Library', 'Project Gutenberg', 'Wikisource fa', 'Wikisource en', 'The Met', 'Cleveland Museum of Art', 'V&A', 'Library of Congress'];
const LANGS = [['', 'همه'], ['fa', 'فارسی'], ['ar', 'عربی'], ['en', 'انگلیسی'], ['fr', 'فرانسوی'], ['de', 'آلمانی'], ['la', 'لاتین'], ['el', 'یونانی'], ['sa', 'سانسکریت'], ['ur', 'اردو'], ['he', 'عبری']];

// mount(el, { actions: [{id, label, when?(item)}], onAction(actionId, item) })
export function mountSourceSearch(el, opts) {
  ensureStyle();
  const actions = (opts && opts.actions) || [];
  const onAction = (opts && opts.onAction) || (() => {});
  let items = [];
  el.classList.add('ss');
  el.innerHTML = `
    <div class="bar">
      <input type="text" class="q" placeholder="نام کتاب، نویسنده، موضوع یا شیء">
      <button type="button" class="go">جستجو</button>
    </div>
    <details>
      <summary>فیلترها و تنظیمات پیشرفته</summary>
      <div class="grid">
        <div><b class="muted">نوع اثر</b><br>
          ${Object.keys(KIND_LABEL).map((k) => `<label><input type="checkbox" class="kind" value="${k}" checked> ${KIND_LABEL[k]}</label>`).join('')}
        </div>
        <div><b class="muted">منبع</b><br>
          ${SOURCES.map((s) => `<label><input type="checkbox" class="src" value="${esc(s)}" checked> ${esc(s)}</label>`).join('')}
        </div>
        <div>
          <label>زبان <select class="lang">${LANGS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
          <label>از سال <input type="number" class="yf" placeholder="مثلاً 800" style="width:100px"></label>
          <label>تا سال <input type="number" class="yt" placeholder="مثلاً 1950" style="width:100px"></label>
          <label><input type="checkbox" class="historic" checked> فقط آثار تاریخی (اشیا و نقاشی تا ۱۹۵۰)</label>
          <label><input type="checkbox" class="iiif"> فقط دارای IIIF</label>
          <label><input type="checkbox" class="pdf"> فقط دارای PDF</label>
          <label>تعداد نتیجه در هر منبع <select class="limit"><option>12</option><option>20</option><option>25</option></select></label>
        </div>
      </div>
    </details>
    <div class="status muted"></div>
    <div class="results"></div>
    <div class="prov"></div>`;
  const $ = (sel) => el.querySelector(sel);
  const $$ = (sel) => [...el.querySelectorAll(sel)];

  function filters() {
    const val = (sel) => $(sel).value.trim();
    return {
      kinds: $$('.kind:checked').map((c) => c.value),
      sources: $$('.src:checked').map((c) => c.value),
      lang: val('.lang'), yearFrom: val('.yf'), yearTo: val('.yt'),
      historic: $('.historic').checked ? '1' : '0',
      iiif: $('.iiif').checked ? '1' : '0', pdf: $('.pdf').checked ? '1' : '0',
      limit: $('.limit').value
    };
  }

  async function run() {
    const q = $('.q').value.trim();
    if (!q) return;
    $('.status').textContent = 'در حال جستجو در منابع…';
    $('.results').innerHTML = '';
    const f = filters();
    const params = new URLSearchParams({ q, kinds: f.kinds.join(','), sources: f.sources.join(','), lang: f.lang,
      yearFrom: f.yearFrom, yearTo: f.yearTo, historic: f.historic, iiif: f.iiif, pdf: f.pdf, limit: f.limit });
    const r = await fetch('/api/search?' + params.toString()).then((x) => x.json())
      .catch(() => ({ results: [], providers: [], errors: { all: 'اتصال به سرور ناموفق بود' } }));
    items = r.results || [];
    const errs = Object.entries(r.errors || {}).map(([k, v]) => k + ': ' + v);
    $('.status').textContent = items.length + ' نتیجه' + (errs.length ? ' — منابعی پاسخ ندادند: ' + errs.join(' · ') : '');
    $('.results').innerHTML = items.map((it, i) => `
      <div class="res">
        <b>${esc(it.title || 'بی‌عنوان')}</b>
        <span class="tag">${esc(KIND_LABEL[it.kind] || it.kind)}</span>
        <span class="tag">${esc(it.source)}</span>
        ${it.year ? `<span class="tag">${esc(it.year)}</span>` : ''}
        ${it.lang ? `<span class="tag">${esc(it.lang)}</span>` : ''}
        ${it.iiif ? '<span class="tag">IIIF</span>' : ''}
        ${it.pdf ? '<span class="tag">PDF</span>' : ''}
        <div class="muted">${esc(it.author || '')}</div>
        <div class="acts">
          <a href="${esc(it.url)}" target="_blank" rel="noopener">منبع</a>
          ${actions.filter((a) => !a.when || a.when(it)).map((a) => `<button type="button" class="ghost" data-i="${i}" data-a="${a.id}">${esc(a.label)}</button>`).join('')}
        </div>
      </div>`).join('') || '<p class="muted">نتیجه‌ای پیدا نشد. فیلترها را کم‌سخت‌تر کنید.</p>';
    $$('.results button[data-a]').forEach((b) => {
      b.onclick = () => onAction(b.dataset.a, items[+b.dataset.i]);
    });
    $('.prov').innerHTML = '<div class="muted">جستجوی مستقیم در سایت منبع (بدون API عمومی):</div>' +
      (r.providers || []).map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>`).join('');
  }

  $('.go').onclick = run;
  $('.q').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
}