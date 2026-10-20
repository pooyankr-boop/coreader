// session/ocr-session.js — تولید متن با OCR داخل نشست (مانیفست یا PDF)، ذخیره در جدول ocr_pages برای جستجو.
import { ENGINES, LANG_CODES, availability, recognize, releaseOcr, parseManifest, fetchJson, pageRange, embeddedText, fetchImageBlob, pdfPages, normFa } from './ocr-engine.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let ctx = { room: null, user: null, sb: null };
let manifest = null;
let results = [];

function setStatus(p, msg) {
  $('ocrgBar').style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
  $('ocrgStatus').textContent = msg;
}
function renderResults() {
  $('ocrgOut').innerHTML = results.length ? results.map((r, i) => `
    <div style="margin-bottom:12px">
      <b>${esc(r.label)}</b> <span class="tag">${esc(r.source)}</span>
      <textarea data-i="${i}" style="width:100%;min-height:110px;margin-top:6px">${esc(r.text)}</textarea>
    </div>`).join('') : '<p class="muted">هنوز متنی تولید نشده است.</p>';
  $('ocrgOut').querySelectorAll('textarea').forEach((t) => {
    t.oninput = () => { results[+t.dataset.i].text = t.value; };
  });
  $('btnOcrSave').disabled = !results.length;
}
function pageSpec() { return $('ocrgPageMode').value === 'all' ? 'همه' : $('ocrgPages').value; }
function updLangSum() {
  const picked = [...document.querySelectorAll('#ocrgLangs input:checked')].map((i) => i.parentElement.textContent.trim());
  $('ocrgLangSum').textContent = 'زبان: ' + (picked.length ? picked.join('، ') : 'انتخاب نشده');
}
const engineName = (id) => (ENGINES.find((e) => e.id === id) || { name: id }).name;

async function loadManifestInfo() {
  if (!ctx.room || !ctx.room.manifest_url) { setStatus(0, 'این نشست مانیفست ندارد. ابتدا مانیفست را از جستجو یا فیلد مانیفست ثبت کنید.'); return; }
  try {
    manifest = parseManifest(await fetchJson(ctx.room.manifest_url));
    setStatus(0, 'مانیفست: ' + manifest.label + ' — ' + manifest.pages.length + ' صفحه. برای انتخاب صفحه‌ها بنویسید (مثلاً 1-5,8) یا «همه».');
  } catch (e) { setStatus(0, 'خطا: ' + e.message); }
}

async function runOcr() {
  const engine = $('ocrgEngine').value;
  const langs = [...document.querySelectorAll('#ocrgLangs input:checked')].map((i) => i.value);
  const src = $('ocrgSource').value;
  results = []; renderResults();
  $('btnOcrRun').disabled = true;
  try {
    const items = [];
    if (src === 'manifest') {
      if (!ctx.room || !ctx.room.manifest_url) throw new Error('این نشست مانیفست ندارد.');
      if (!manifest) manifest = parseManifest(await fetchJson(ctx.room.manifest_url));
      pageRange(pageSpec(), manifest.pages.length).forEach((i) => {
        items.push({ label: manifest.label + ' — ' + manifest.pages[i].label, page: i + 1, pageObj: manifest.pages[i] });
      });
    } else {
      const f = $('ocrgPdf').files[0];
      if (!f) throw new Error('ابتدا فایل PDF را انتخاب کنید.');
      setStatus(0, 'تبدیل صفحه‌های PDF به تصویر…');
      const pages = await pdfPages(f);
      pageRange(pageSpec(), pages.length).forEach((i) => {
        items.push({ label: f.name + ' — صفحه ' + (i + 1), page: i + 1, canvas: pages[i].src });
      });
    }
    if (!items.length) throw new Error('صفحه‌ای برای خواندن انتخاب نشده است.');
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      setStatus(k / items.length, 'صفحه ' + (k + 1) + ' از ' + items.length + ' — ' + engineName(engine));
      let text, source;
      if (it.pageObj) {
        text = await embeddedText(it.pageObj);
        source = 'متن موجود در مانیفست';
        if (!text) {
          if (!it.pageObj.img) throw new Error('تصویر صفحهٔ ' + it.page + ' پیدا نشد.');
          text = await recognize(engine, await fetchImageBlob(it.pageObj.img), langs);
          source = engineName(engine);
        }
      } else {
        text = await recognize(engine, it.canvas, langs);
        source = engineName(engine);
      }
      results.push({ label: it.label, page: it.page, text: text, source: source });
      renderResults();
    }
    setStatus(1, 'تمام شد: ' + results.length + ' صفحه. متن را بررسی و سپس ذخیره کنید.');
  } catch (e) {
    setStatus(0, 'خطا: ' + e.message);
  } finally {
    await releaseOcr();
    $('btnOcrRun').disabled = false;
  }
}

async function saveOcr() {
  if (!ctx.room || !ctx.user) { setStatus(0, 'برای ذخیره ابتدا وارد شوید.'); return; }
  const rows = results.filter((r) => r.text && r.text.trim()).map((r) => ({
    session_id: ctx.room.id, source: r.label, page_no: r.page, body: r.text, norm: normFa(r.text), created_by: ctx.user.id
  }));
  if (!rows.length) { setStatus(0, 'متنی برای ذخیره نیست.'); return; }
  const { error } = await ctx.sb.from('ocr_pages').insert(rows);
  setStatus(error ? 0 : 1, error ? 'خطا: ' + error.message : rows.length + ' صفحه در نشست ذخیره شد و قابل جستجو است.');
}

export function setOcrContext(room, user, sb) {
  ctx = { room: room, user: user, sb: sb };
  manifest = null;
  results = [];
  renderResults();
  setStatus(0, '');
}

export async function initSessionOcr() {
  const av = await availability();
  $('ocrgEngine').innerHTML = ENGINES.map((e) => {
    const off = e.cloud && !av[e.id];
    return `<option value="${e.id}"${off ? ' disabled' : ''}>${esc(e.name)}${off ? ' — کلید روی سرور تنظیم نشده' : ''}</option>`;
  }).join('');
  $('ocrgLangs').innerHTML = LANG_CODES.map(([v, t]) =>
    `<label style="font-size:13px"><input type="checkbox" value="${v}"${v === 'fas' ? ' checked' : ''}> ${esc(t)}</label>`).join('');
  $('ocrgSource').onchange = () => { $('ocrgPdf').style.display = $('ocrgSource').value === 'pdf' ? '' : 'none'; };
  $('ocrgPdf').style.display = 'none';
  $('ocrgLoad').onclick = loadManifestInfo;
  $('ocrgLangs').onchange = updLangSum;
  updLangSum();
  $('ocrgPageMode').onchange = () => { const custom = $('ocrgPageMode').value === 'custom'; $('ocrgPages').style.display = custom ? '' : 'none'; if (!custom) $('ocrgPages').value = 'همه'; };
  $('btnOcrRun').onclick = runOcr;
  $('btnOcrSave').onclick = saveOcr;
  $('btnOcrSave').disabled = true;
  renderResults();
}