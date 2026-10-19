// OCR (فاز ۵): استخراج متن از عکس و PDF در مرورگر با Tesseract.js (رایگان).
// خروجی قابل ویرایش است و می‌تواند به استودیوی صوت برای همگام‌سازی فرستاده شود.
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let results = [];

  function setProgress(p, msg) {
    $('bar').style.width = Math.round(p * 100) + '%';
    $('status').textContent = msg;
  }

  function selectedLangs() {
    const v = [...document.querySelectorAll('#langs input:checked')].map((i) => i.value).join('+');
    return v || 'fas';
  }

  // هر صفحهٔ PDF به یک تصویر (canvas) تبدیل می‌شود
  async function pdfPages(file) {
    const pdfjs = window.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const c = document.createElement('canvas');
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      out.push({ label: file.name + ' — صفحه ' + i, src: c });
    }
    return out;
  }

  function renderResults() {
    $('results').innerHTML = results.length ? results.map((r, i) => `
      <div class="page"><h2>${esc(r.label)}</h2><textarea data-i="${i}">${esc(r.text)}</textarea></div>`).join('')
      : '<p class="muted">هنوز متنی استخراج نشده است.</p>';
    $('results').querySelectorAll('textarea').forEach((t) => {
      t.oninput = () => { results[+t.dataset.i].text = t.value; };
    });
    $('btnTxt').disabled = !results.length;
    $('btnToStudio').disabled = !results.length;
  }

  $('btnRun').onclick = async () => {
    const files = [...$('files').files];
    if (!files.length) { $('msg').textContent = 'ابتدا فایل انتخاب کنید.'; return; }
    if (!window.Tesseract) { $('msg').textContent = 'کتابخانهٔ OCR بارگذاری نشد. اتصال اینترنت را بررسی کنید.'; return; }
    $('btnRun').disabled = true;
    $('msg').textContent = '';
    results = [];
    renderResults();
    try {
      const items = [];
      for (const f of files) {
        if (f.type === 'application/pdf') items.push(...await pdfPages(f));
        else items.push({ label: f.name, src: f });
      }
      setProgress(0, 'بارگذاری زبان‌ها (اولین بار ممکن است چند دقیقه طول بکشد)…');
      const worker = await Tesseract.createWorker(selectedLangs(), 1);
      for (let i = 0; i < items.length; i++) {
        setProgress(i / items.length, 'در حال خواندن ' + (i + 1) + ' از ' + items.length + '…');
        const { data } = await worker.recognize(items[i].src);
        results.push({ label: items[i].label, text: data.text.trim() });
        renderResults();
      }
      await worker.terminate();
      setProgress(1, 'تمام شد.');
    } catch (e) {
      $('msg').textContent = 'خطا: ' + e.message;
    }
    $('btnRun').disabled = false;
  };

  $('btnTxt').onclick = () => {
    const txt = results.map((r) => '--- ' + r.label + ' ---\n' + r.text).join('\n\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
    a.download = 'ocr.txt';
    a.click();
  };

  // خط‌های متن به استودیوی صوت می‌روند (از طریق localStorage)
  $('btnToStudio').onclick = () => {
    const lines = results.flatMap((r) => r.text.split('\n')).map((s) => s.trim()).filter(Boolean);
    localStorage.setItem('coreader-ocr-lines', lines.join('\n'));
    $('msg').textContent = lines.length + ' خط ذخیره شد. در استودیوی صوت بارگذاری می‌شود.';
  };
})();