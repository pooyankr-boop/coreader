// session/ocr-engine.js — موتورهای OCR مشترک (صفحهٔ OCR و بخش نشست).
// Tesseract در مرورگر اجرا می‌شود؛ Google و Azure از سرور و با کلیدهای محیطی.
export const ENGINES = [
  { id: 'tesseract', name: 'Tesseract (مرورگر، رایگان)', cloud: false },
  { id: 'tesseract-best', name: 'Tesseract (داده‌های بهتر، فارسی)', cloud: false },
  { id: 'google', name: 'Google Cloud Vision', cloud: true },
  { id: 'azure', name: 'Azure AI Vision Read', cloud: true }
];
export const LANG_CODES = [
  ['fas', 'فارسی'], ['prs', 'دری (مدل فارسی)'], ['ara', 'عربی'], ['eng', 'انگلیسی'], ['fra', 'فرانسوی'],
  ['deu', 'آلمانی'], ['lat', 'لاتین'], ['grc', 'یونانی'], ['san', 'سانسکریت'], ['urd', 'اردو'], ['heb', 'عبری']
];
const CLOUD_LANG = { fas: 'fa', prs: 'fa', ara: 'ar', eng: 'en', fra: 'fr', deu: 'de', san: 'sa', grc: 'el', lat: 'la', urd: 'ur', heb: 'he' };

let worker = null, workerKey = '';
export async function releaseOcr() {
  if (worker) { try { await worker.terminate(); } catch (e) {} worker = null; workerKey = ''; }
}
export async function availability() {
  try { return await fetch('/api/ocr/engines').then((r) => r.json()); }
  catch (e) { return { tesseract: true, google: false, azure: false }; }
}
// پیش‌پردازش برای Tesseract: خاکستری‌سازی، کشش کنتراست و بزرگ‌نمایی تصاویر کوچک
async function preprocessForOcr(input) {
  const bmp = input instanceof Blob ? await createImageBitmap(input) : input;
  const w0 = bmp.width, h0 = bmp.height;
  const scale = Math.max(1, Math.min(2.5, 2200 / Math.max(w0, h0)));
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0, w, h);
  const im = g.getImageData(0, 0, w, h), d = im.data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.round((d[i] - lo) * 255 / span);
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return c;
}
export async function recognize(engine, input, langCodes) {
  if (engine.indexOf('tesseract') === 0) {
    if (!window.Tesseract) throw new Error('کتابخانهٔ Tesseract بارگذاری نشده است.');
    const best = engine === 'tesseract-best';
    const codes = (langCodes && langCodes.length ? langCodes : ['fas']).map((c) => (c === 'prs' ? 'fas' : c));
    const langs = codes.filter((v, i, a) => a.indexOf(v) === i).join('+');
    const key = langs + (best ? '|best' : '');
    if (!worker || workerKey !== key) {
      await releaseOcr();
      worker = await Tesseract.createWorker(langs, 1, best ? { langPath: 'https://tessdata.projectnaptha.com/4.0.0_best' } : {});
      await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      workerKey = key;
    }
    const prepared = await preprocessForOcr(input);
    const { data } = await worker.recognize(prepared);
    return data.text.trim();
  }
  const blob = input instanceof Blob ? input : await new Promise((res) => input.toBlob(res, 'image/png'));
  const lang = CLOUD_LANG[(langCodes || [])[0]] || 'fa';
  const r = await fetch('/api/ocr?engine=' + engine + '&lang=' + lang, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'خطای OCR');
  return j.text.trim();
}

// ---- مانیفست IIIF ----
const lbl = (v) => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  const a = Object.values(v)[0];
  return Array.isArray(a) ? (a[0] || '') : (a || '');
};
function imageOf(res) {
  const svc = res && (Array.isArray(res.service) ? res.service[0] : res.service);
  const base = svc && (svc['@id'] || svc.id);
  if (base) return base.replace(/\/$/, '') + '/full/2000,/0/default.jpg';
  return (res && (res['@id'] || res.id)) || '';
}
export function parseManifest(j) {
  const pages = [];
  if (j.sequences && j.sequences[0]) {
    j.sequences[0].canvases.forEach((c, i) => pages.push({
      label: lbl(c.label) || ('صفحه ' + (i + 1)),
      img: imageOf(c.images && c.images[0] && c.images[0].resource),
      other: (c.otherContent || []).map((o) => o['@id']).filter(Boolean)
    }));
  } else if (j.items) {
    j.items.forEach((c, i) => {
      const body = c.items && c.items[0] && c.items[0].items && c.items[0].items[0] && c.items[0].items[0].body;
      pages.push({ label: lbl(c.label) || ('صفحه ' + (i + 1)), img: imageOf(body), other: (c.annotations || []).map((a) => a.id).filter(Boolean) });
    });
  }
  return { label: lbl(j.label) || 'مانیفست', pages: pages };
}
export async function fetchJson(url) {
  try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {}
  const r2 = await fetch('/proxy-manifest?url=' + encodeURIComponent(url));
  if (!r2.ok) throw new Error('خواندن مانیفست ناموفق بود (HTTP ' + r2.status + ')');
  return r2.json();
}
function textFromPage(j) {
  return (j.items || j.resources || []).map((a) => {
    const b = a.body || a.resource || {};
    if (typeof b.value === 'string') return b.value;
    if (typeof b.chars === 'string') return b.chars;
    return '';
  }).filter(Boolean).join('\n').trim();
}
export async function embeddedText(p) {
  const parts = [];
  for (const u of p.other) {
    try { const t = textFromPage(await fetchJson(u)); if (t) parts.push(t); } catch (e) {}
  }
  return parts.join('\n').trim();
}
export async function fetchImageBlob(url) {
  try { const r = await fetch(url); if (r.ok) return await r.blob(); } catch (e) {}
  const r2 = await fetch('/proxy-image?url=' + encodeURIComponent(url));
  if (!r2.ok) throw new Error('دریافت تصویر ناموفق (HTTP ' + r2.status + ')');
  return r2.blob();
}

// ---- PDF: هر صفحه به تصویر ----
export async function pdfPages(file) {
  const pdfjs = window.pdfjsLib;
  if (!pdfjs) throw new Error('کتابخانهٔ PDF بارگذاری نشده است.');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    out.push({ src: c });
  }
  return out;
}

// ---- انتخاب صفحه‌ها: «همه»، «3»، «1-5»، «2,7,9-11» ----
export function pageRange(spec, n) {
  const s = (spec || '').trim();
  if (!s || s === 'همه') return Array.from({ length: n }, (_, i) => i);
  const out = [];
  s.split(',').forEach((part) => {
    const p = part.trim();
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) if (i >= 1 && i <= n) out.push(i - 1); }
    else if (/^\d+$/.test(p)) { const i = +p; if (i >= 1 && i <= n) out.push(i - 1); }
  });
  return [...new Set(out)].sort((a, b) => a - b);
}

// ---- یکسان‌سازی فارسی برای جستجو ----
export function normFa(s) {
  return String(s)
    .replace(/[\u200c\u200d\u0640\u064b-\u065f\u0670]/g, '')
    .replace(/\u064a/g, '\u06cc').replace(/\u0643/g, '\u06a9')
    .replace(/\u0629/g, '\u0647').replace(/\u06c0/g, '\u0647')
    .replace(/[\u0622\u0623\u0625]/g, '\u0627')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}