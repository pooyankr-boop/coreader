// استودیوی صوت (فاز ۴ — نسخهٔ محلی): موج‌نمایش، پخش، و همگام‌سازی خط‌های متن با زمان‌های صدا.
// فایل صوتی فقط روی دستگاه شما می‌ماند؛ خروجی JSON را دانلود می‌کنید.
(function () {
  const $ = (id) => document.getElementById(id);
  const audio = new Audio();
  let buf = null, waveImg = null, lines = [], marks = [], ptr = 0, fileName = '';

  const fmt = (s) => {
    if (!isFinite(s)) s = 0;
    const m = Math.floor(s / 60), sec = (s % 60).toFixed(1).padStart(4, '0');
    return String(m).padStart(2, '0') + ':' + sec;
  };

  // ---------- بارگذاری و موج‌نمایش ----------
  $('file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    fileName = f.name;
    $('fileName').textContent = f.name;
    if (audio.src) URL.revokeObjectURL(audio.src);
    audio.src = URL.createObjectURL(f);
    ['btnPlay', 'btnBack5', 'btnFwd5', 'btnMark', 'btnExport', 'btnSuggest'].forEach((id) => { $(id).disabled = false; });
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      buf = await ctx.decodeAudioData(await f.arrayBuffer());
      ctx.close();
      drawWaveImage();
      render();
    } catch (err) {
      $('fileName').textContent = 'این فایل قابل خواندن نیست: ' + err.message;
    }
  };

  function drawWaveImage() {
    const c = $('wave');
    const w = c.clientWidth || 800, h = c.clientHeight || 160;
    c.width = w; c.height = h;
    waveImg = document.createElement('canvas');
    waveImg.width = w; waveImg.height = h;
    const g = waveImg.getContext('2d');
    const data = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    g.fillStyle = '#8a5a3b';
    for (let x = 0; x < w; x++) {
      let mx = 0;
      const start = x * step;
      for (let j = 0; j < step; j++) {
        const v = Math.abs(data[start + j] || 0);
        if (v > mx) mx = v;
      }
      const bh = Math.max(1, mx * h);
      g.fillRect(x, (h - bh) / 2, 1, bh);
    }
  }

  function render() {
    const c = $('wave');
    if (!waveImg) return;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(waveImg, 0, 0, c.width, c.height);
    const d = audio.duration || (buf && buf.duration) || 1;
    g.fillStyle = '#2563eb';
    marks.forEach((m) => g.fillRect((m.t / d) * c.width, 0, 2, c.height));
    g.fillStyle = '#dc2626';
    g.fillRect((audio.currentTime / d) * c.width, 0, 2, c.height);
    $('timeLbl').textContent = fmt(audio.currentTime) + ' / ' + fmt(d);
  }

  audio.ontimeupdate = render;
  audio.onseeked = render;
  audio.onloadedmetadata = render;

  $('wave').onclick = (e) => {
    const d = audio.duration;
    if (!d) return;
    audio.currentTime = (e.offsetX / $('wave').clientWidth) * d;
  };

  // ---------- پخش ----------
  const togglePlay = () => {
    if (!audio.src) return;
    if (audio.paused) audio.play(); else audio.pause();
    $('btnPlay').textContent = audio.paused ? '▶ پخش' : '❚❚ توقف';
  };
  $('btnPlay').onclick = togglePlay;
  $('btnBack5').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 5); };
  $('btnFwd5').onclick = () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); };

  // ---------- خط‌ها و نشانه‌ها ----------
  $('btnStart').onclick = () => {
    lines = $('lines').value.split('\n').map((s) => s.trim()).filter(Boolean);
    marks = [];
    ptr = 0;
    renderMarks();
    render();
  };

  function markNext() {
    if (!audio.src) return;
    if (!lines.length) { $('nextLbl').textContent = 'ابتدا متن خطوط را وارد و «شروع» را بزنید.'; return; }
    if (ptr >= lines.length) { $('nextLbl').textContent = 'همهٔ خط‌ها نشانه‌گذاری شده‌اند.'; return; }
    marks.push({ t: audio.currentTime, line: ptr, text: lines[ptr] });
    ptr++;
    marks.sort((a, b) => a.t - b.t);
    renderMarks();
    render();
  }
  $('btnMark').onclick = markNext;

  function renderMarks() {
    $('nextLbl').textContent = lines.length
      ? (ptr < lines.length ? 'خط بعدی: ' + lines[ptr] : 'همهٔ خط‌ها نشانه‌گذاری شده‌اند.')
      : '';
    $('markList').innerHTML = marks.map((m, i) => `
      <div class="mark">
        <span class="t">${fmt(m.t)}</span>
        <span class="x">${escapeHtml(m.text)}</span>
        <button class="ghost" data-seek="${i}">پخش</button>
        <button class="ghost" data-del="${i}">حذف</button>
      </div>`).join('') || '<p class="muted">هنوز نشانه‌ای ثبت نشده است.</p>';
    $('markList').querySelectorAll('button[data-seek]').forEach((b) => {
      b.onclick = () => { audio.currentTime = marks[+b.dataset.seek].t; audio.play(); };
    });
    $('markList').querySelectorAll('button[data-del]').forEach((b) => {
      b.onclick = () => {
        marks.splice(+b.dataset.del, 1);
        ptr = marks.length ? Math.max(...marks.map((m) => m.line)) + 1 : 0;
        renderMarks();
        render();
      };
    });
  }

  // ---------- خروجی ----------
  $('btnExport').onclick = () => {
    const out = {
      audio: fileName,
      duration: audio.duration || 0,
      lines: lines,
      markers: marks.map((m) => ({ time: +m.t.toFixed(3), line: m.line, text: m.text }))
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (fileName || 'sync') + '.sync.json';
    a.click();
  };

  // ---------- میانبرها ----------
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.key === 'm' || e.key === 'M') markNext();
  });

  // پیشنهاد خودکار نشانه‌ها: مکث‌های بلند صدا را پیدا می‌کند و خط‌ها را بین آن‌ها پخش می‌کند
  function suggestMarkers() {
    if (!buf) { $('nextLbl').textContent = 'ابتدا فایل صوتی را انتخاب کنید.'; return; }
    if (!lines.length) { $('nextLbl').textContent = 'ابتدا متن خطوط را وارد و «شروع» را بزنید.'; return; }
    const data = buf.getChannelData(0), sr = buf.sampleRate, step = 0.05, win = Math.floor(sr * step);
    const env = [];
    let max = 0;
    for (let i = 0; i + win <= data.length; i += win) {
      let s = 0;
      for (let j = 0; j < win; j++) s += data[i + j] * data[i + j];
      const r = Math.sqrt(s / win);
      env.push(r);
      if (r > max) max = r;
    }
    const thr = max * 0.03;
    const gaps = [];
    let start = -1;
    env.forEach((r, k) => {
      if (r < thr) { if (start < 0) start = k; }
      else if (start >= 0) {
        const len = (k - start) * step;
        if (len >= 0.3) gaps.push({ from: start * step, to: k * step, len: len });
        start = -1;
      }
    });
    const chosen = gaps.sort((a, b) => b.len - a.len).slice(0, lines.length - 1).sort((a, b) => a.from - b.from);
    const times = [0].concat(chosen.map((g) => (g.from + g.to) / 2));
    const d = buf.duration;
    while (times.length < lines.length) times.push((d * times.length) / lines.length);
    marks = lines.map((text, i) => ({ t: times[i], line: i, text: text })).sort((a, b) => a.t - b.t);
    ptr = lines.length;
    renderMarks();
    $('nextLbl').textContent = 'پیشنهاد خودکار: ' + gaps.length + ' مکث پیدا شد. زمان‌ها را بررسی و در صورت نیاز جابه‌جا کنید.';
    render();
  }
  $('btnSuggest').onclick = suggestMarkers;

  // خط‌های آماده از OCR (اگر از صفحهٔ OCR فرستاده شده باشند)
  const ocrLines = localStorage.getItem('coreader-ocr-lines');
  if (ocrLines) $('lines').value = ocrLines;

  window.addEventListener('resize', () => { if (buf) { drawWaveImage(); render(); } });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
