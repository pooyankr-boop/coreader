// OCR: Tesseract (مرورگر) + Google/Azure (سرور) + مانیفست IIIF (متن موجود یا OCR تصویر هر صفحه)
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LANG_MAP = { fas: 'fa', ara: 'ar', eng: 'en', fra: 'fr', deu: 'de' };
  const ENGINE_NAME = { tesseract: 'Tesseract', google: 'Google Vision', azure: 'Azure Read' };
  let results = [];
  let manifest = null;
  let tessWorker = null, tessLangs = '';

  function setProgress(p, msg) {
    $('bar').style.width = Math.round(p * 100) + '%';
    $('status').textContent = msg;
  }
  const codes = () => [...document.querySelectorAll('#langs input:checked')].map((i) => i.value);
  const tessLangsNow = () => codes().join('+') || 'fas';
  const apiLang = () => LANG_MAP[codes()[0]] || 'fa';

  async function loadEngines() {
    let st = { tesseract: true, google: false, azure: false };
    try { st = await fetch('/api/ocr/engines').then((r) => r.json()); } catch (e) {}
    [...$('engine').options].forEach((o) => { if (o.value !== 'tesseract') o.disabled = !st[o.value]; });
    if ($('engine').selectedOptions[0].disabled) $('engine').value = 'tesseract';
    $('engineNote').textContent = (st.google || st.azure) ? '' : 'موتورهای ابری روی سرور هنوز کلید ندارند؛ فعلاً Tesseract فعال است.';
  }

  async function releaseTess() {
    if (tessWorker) { await tessWorker.terminate(); tessWorker = null; }
  }
  async function tesseract(input) {
    if (!window.Tesseract) throw new Error('کتابخانهٔ Tesseract بارگذاری نشد.');
    if (!tessWorker || tessLangs !== tessLangsNow()) {
      await releaseTess();
      tessLangs = tessLangsNow();
      tessWorker = await Tesseract.createWorker(tessLangs, 1);
    }
    const { data } = await tessWorker.recognize(input);
    return data.text.trim();
  }
  async function cloud(engine, blob) {
    const r = await fetch('/api/ocr?engine=' + engine + '&lang=' + apiLang(), {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'خطای OCR');
    return j.text.trim();
  }
  async function recognize(engine, input) {
    if (engine === 'tesseract') return tesseract(input);
    const blob = input instanceof Blob ? input : await new Promise((res) => input.toBlob(res, 'image/png'));
    return cloud(engine, blob);
  }

  // ---------- فایل‌های محلی ----------
  async function pdfPages(file) {
    const pdfjs = window.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      out.push({ label: file.name + ' — صفحه ' + i, src: c });
    }
    return out;
  }

  $('btnRun').onclick = async () => {
    const files = [...$('files').files];
    if (!files.length) { $('msg').textContent = 'ابتدا فایل انتخاب کنید.'; return; }
    const engine = $('engine').value;
    $('btnRun').disabled = true;
    results = []; renderResults();
    try {
      const items = [];
      for (const f of files) {
        if (f.type === 'application/pdf') items.push(...await pdfPages(f));
        else items.push({ label: f.name, src: f });
      }
      for (let i = 0; i < items.length; i++) {
        setProgress(i / items.length, 'در حال خواندن ' + (i + 1) + ' از ' + items.length + '…');
        const text = await recognize(engine, items[i].src);
        results.push({ label: items[i].label, text: text, source: ENGINE_NAME[engine] });
        renderResults();
      }
      setProgress(1, 'تمام شد.');
    } catch (e) { $('msg').textContent = 'خطا: ' + e.message; }
    await releaseTess();
    $('btnRun').disabled = false;
  };

  // ---------- مانیفست IIIF ----------
  const lbl = (v) => {
    if (!v) return '';
    if (typeof v === 'string') return v;
    const a = Object.values(v)[0];
    return Array.isArray(a) ? (a[0] || '') : (a || '');
  };
  // تصویر با اندازهٔ مناسب OCR (حداکثر ۲۰۰۰ پیکسل عرض)
  function imageOf(res) {
    const svc = res && (Array.isArray(res.service) ? res.service[0] : res.service);
    const base = svc && (svc['@id'] || svc.id);
    if (base) return base.replace(/\/$/, '') + '/full/2000,/0/default.jpg';
    return (res && (res['@id'] || res.id)) || '';
  }
  function parseManifest(j) {
    const pages = [];
    if (j.sequences && j.sequences[0]) {   // IIIF Presentation 2
      j.sequences[0].canvases.forEach((c, i) => {
        pages.push({
          label: lbl(c.label) || ('صفحه ' + (i + 1)),
          img: imageOf(c.images && c.images[0] && c.images[0].resource),
          other: (c.otherContent || []).map((o) => o['@id']).filter(Boolean)
        });
      });
    } else if (j.items) {                  // IIIF Presentation 3
      j.items.forEach((c, i) => {
        const body = c.items && c.items[0] && c.items[0].items && c.items[0].items[0] && c.items[0].items[0].body;
        pages.push({
          label: lbl(c.label) || ('صفحه ' + (i + 1)),
          img: imageOf(body),
          other: (c.annotations || []).map((a) => a.id).filter(Boolean)
        });
      });
    }
    return { label: lbl(j.label) || 'مانیفست', pages: pages };
  }
  async function fetchJson(url) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {}
    const r2 = await fetch('/proxy-manifest?url=' + encodeURIComponent(url));
    if (!r2.ok) throw new Error('HTTP ' + r2.status);
    return r2.json();
  }
  // متن از annotation‌های متنی IIIF (v3: body.value، v2: resource.chars)
  function textFromPage(j) {
    const list = j.items || j.resources || [];
    return list.map((a) => {
      const b = a.body || a.resource || {};
      if (typeof b.value === 'string') return b.value;
      if (typeof b.chars === 'string') return b.chars;
      return '';
    }).filter(Boolean).join('\n').trim();
  }
  async function embeddedText(p) {
    const parts = [];
    for (const u of p.other) {
      try { const t = textFromPage(await fetchJson(u)); if (t) parts.push(t); } catch (e) {}
    }
    return parts.join('\n').trim();
  }
  async function fetchImageBlob(url) {
    try { const r = await fetch(url); if (r.ok) return await r.blob(); } catch (e) {}
    const r2 = await fetch('/proxy-image?url=' + encodeURIComponent(url));
    if (!r2.ok) throw new Error('دریافت تصویر ناموفق (HTTP ' + r2.status + ')');
    return r2.blob();
  }

  $('btnManifest').onclick = async () => {
    const url = $('murl').value.trim();
    if (!/^https?:\/\//.test(url)) { $('msg').textContent = 'آدرس مانیفست باید با http یا https شروع شود.'; return; }
    try {
      manifest = parseManifest(await fetchJson(url));
      $('mfInfo').textContent = manifest.label + ' — ' + manifest.pages.length + ' صفحه';
      $('mfPages').innerHTML = manifest.pages.map((p, i) =>
        '<label style="display:inline-block;margin:3px 8px 3px 0"><input type="checkbox" data-i="' + i + '" checked> ' + (i + 1) + '</label>').join('');
      $('btnRunManifest').disabled = !manifest.pages.length;
      $('msg').textContent = '';
    } catch (e) { $('mfInfo').textContent = 'خواندن مانیفست ناموفق بود: ' + e.message; }
  };

  $('btnRunManifest').onclick = async () => {
    const idx = [...$('mfPages').querySelectorAll('input:checked')].map((i) => +i.dataset.i);
    if (!idx.length) { $('msg').textContent = 'حداقل یک صفحه انتخاب کنید.'; return; }
    const engine = $('engine').value;
    $('btnRunManifest').disabled = true;
    results = []; renderResults();
    try {
      for (let k = 0; k < idx.length; k++) {
        const p = manifest.pages[idx[k]];
        setProgress(k / idx.length, 'صفحه ' + (idx[k] + 1) + ' از ' + manifest.pages.length + '…');
        let text = await embeddedText(p);
        let source = 'متن موجود در مانیفست';
        if (!text) {
          if (!p.img) throw new Error('تصویر صفحه ' + (idx[k] + 1) + ' در مانیفست پیدا نشد.');
          text = await recognize(engine, await fetchImageBlob(p.img));
          source = ENGINE_NAME[engine];
        }
        results.push({ label: manifest.label + ' — ' + p.label, text: text, source: source });
        renderResults();
      }
      setProgress(1, 'تمام شد.');
    } catch (e) { $('msg').textContent = 'خطا: ' + e.message; }
    await releaseTess();
    $('btnRunManifest').disabled = false;
  };

  // ---------- نتیجه و خروجی ----------
  function renderResults() {
    $('results').innerHTML = results.length ? results.map((r, i) =>
      '<div style="margin-bottom:12px"><h2>' + esc(r.label) + ' <span class="muted">(' + esc(r.source) + ')</span></h2>' +
      '<textarea data-i="' + i + '">' + esc(r.text) + '</textarea></div>').join('')
      : '<p class="muted">هنوز متنی استخراج نشده است.</p>';
    $('results').querySelectorAll('textarea').forEach((t) => {
      t.oninput = () => { results[+t.dataset.i].text = t.value; };
    });
    $('btnTxt').disabled = !results.length;
    $('btnToStudio').disabled = !results.length;
  }
  $('btnTxt').onclick = () => {
    const txt = results.map((r) => '--- ' + r.label + ' ---\n' + r.text).join('\n\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
    a.download = 'ocr.txt';
    a.click();
  };
  $('btnToStudio').onclick = () => {
    const lines = results.flatMap((r) => r.text.split('\n')).map((s) => s.trim()).filter(Boolean);
    localStorage.setItem('coreader-ocr-lines', lines.join('\n'));
    $('msg').textContent = lines.length + ' خط ذخیره شد. در استودیوی صوت بارگذاری می‌شود.';
  };

  loadEngines();
})();