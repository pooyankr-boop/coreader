// استودیوی صوت: موج‌نمایش، پخش، همگام‌سازی خط‌ها، برش و خروجی WAV.
// API عمومی برای studio-cloud.js از طریق window.CoreaderStudio.
(function () {
  const $ = (id) => document.getElementById(id);
  const audio = new Audio();
  let buf = null, waveImg = null, lines = [], marks = [], ptr = 0, fileName = '';

  const fmt = (s) => {
    if (!isFinite(s)) s = 0;
    const m = Math.floor(s / 60), sec = (s % 60).toFixed(1).padStart(4, '0');
    return String(m).padStart(2, '0') + ':' + sec;
  };
  const dur = () => (buf ? buf.duration : (audio.duration || 0));

  function setEnabled(on) {
    ['btnPlay', 'btnBack5', 'btnFwd5', 'btnMark', 'btnExport', 'btnSuggest', 'btnWav'].forEach((id) => { $(id).disabled = !on; });
  }

  // بارگذاری صوت از Blob (فایل محلی یا فایل نشست)
  function loadBlob(blob, name) {
    fileName = name || 'audio';
    $('fileName').textContent = fileName;
    if (audio.src) URL.revokeObjectURL(audio.src);
    audio.src = URL.createObjectURL(blob);
    setEnabled(true);
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    return blob.arrayBuffer()
      .then((ab) => ctx.decodeAudioData(ab))
      .then((b) => {
        buf = b;
        ctx.close();
        drawWaveImage();
        render();
        $('trimEnd').value = b.duration.toFixed(2);
        $('trimStart').value = '0';
      })
      .catch((err) => { $('fileName').textContent = 'این فایل قابل خواندن نیست: ' + err.message; });
  }
  $('file').onchange = (e) => { const f = e.target.files[0]; if (f) loadBlob(f, f.name); };

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
    const d = dur() || 1;
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

  // پخش
  const togglePlay = () => {
    if (!audio.src) return;
    if (audio.paused) audio.play(); else audio.pause();
    $('btnPlay').textContent = audio.paused ? '▶ پخش' : '❚❚ توقف';
  };
  $('btnPlay').onclick = togglePlay;
  $('btnBack5').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 5); };
  $('btnFwd5').onclick = () => { audio.currentTime = Math.min(dur(), audio.currentTime + 5); };

  // خط‌ها و نشانه‌ها
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

  // پیشنهاد خودکار نشانه‌ها از روی مکث‌های صدا
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

  // خروجی JSON همگام‌سازی
  function getSync() {
    return {
      audio: fileName,
      duration: dur(),
      lines: lines.slice(),
      markers: marks.map((m) => ({ time: +m.t.toFixed(3), line: m.line, text: m.text }))
    };
  }
  function setSync(sync) {
    if (!sync) return;
    lines = (sync.lines || []).slice();
    $('lines').value = lines.join('\n');
    marks = (sync.markers || []).map((m) => ({ t: m.time, line: m.line, text: m.text })).sort((a, b) => a.t - b.t);
    ptr = marks.length ? Math.max(...marks.map((m) => m.line)) + 1 : 0;
    renderMarks();
    render();
  }
  $('btnExport').onclick = () => {
    const blob = new Blob([JSON.stringify(Object.assign({ audio: fileName }, getSync()), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (fileName || 'sync') + '.sync.json';
    a.click();
  };

  // برش: WAV با ۱۶ بیت و نشانه‌های داخل بازه
  function trim(start, end) {
    const sr = buf.sampleRate, ch = buf.numberOfChannels;
    const s0 = Math.max(0, Math.floor(start * sr)), s1 = Math.min(buf.length, Math.floor(end * sr));
    const n = Math.max(0, s1 - s0);
    const bytes = n * ch * 2;
    const ab = new ArrayBuffer(44 + bytes);
    const v = new DataView(ab);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, bytes, true);
    const chans = [];
    for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    let off = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) {
        const x = Math.max(-1, Math.min(1, chans[c][s0 + i]));
        v.setInt16(off, x < 0 ? x * 0x8000 : x * 0x7FFF, true);
        off += 2;
      }
    }
    const blob = new Blob([ab], { type: 'audio/wav' });
    const markers = marks
      .filter((m) => m.t >= start && m.t <= end)
      .map((m) => ({ time: +(m.t - start).toFixed(3), line: m.line, text: m.text }));
    return { blob: blob, markers: markers };
  }
  $('btnWav').onclick = () => {
    if (!buf) return;
    const start = +$('trimStart').value || 0, end = +$('trimEnd').value || dur();
    const r = trim(start, end);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(r.blob);
    a.download = (fileName || 'audio').replace(/\.[^.]+$/, '') + '-trim.wav';
    a.click();
  };

  // میانبرها
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.key === 'm' || e.key === 'M') markNext();
  });
  window.addEventListener('resize', () => { if (buf) { drawWaveImage(); render(); } });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // خط‌های آماده از OCR
  const ocrLines = localStorage.getItem('coreader-ocr-lines');
  if (ocrLines) $('lines').value = ocrLines;

  window.CoreaderStudio = {
    loadBlob: loadBlob,
    setSync: setSync,
    getSync: getSync,
    trim: trim,
    duration: dur,
    lines: () => lines.slice()
  };
})();