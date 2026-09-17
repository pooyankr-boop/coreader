// src/reader/reader.js
// Generic reader runtime shared by every book. Each book's index.html sets
// window.BOOK_URL to its book.json before loading this file.
//
// This carries forward every validated fix from the earlier single-book
// prototype (samt_alali.html):
//  - phonetic normalization + homophone folding for archaic spelling
//  - Smith-Waterman local alignment (not literal word matching) so ASR
//    noise/dropped words don't break tracking
//  - stopword downweighting (prevents false long-range jumps on filler
//    words like و/را/که)
//  - separate "live" (interim, tight window) vs "final" (wider, stricter)
//    alignment modes, tuned against real recorded reading sessions
//  - ZWNJ-aware tokenization (splits نیم‌فاصله compounds so ASR's
//    word-boundary guesses can actually align)
//  - session logging + audio capture for further tuning

(function () {
'use strict';

var BOOK = null;
var curPage = 1, annoOn = true;

function toFA(n){return String(n).replace(/[0-9]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'[d]})}
// Lighten color by percentage (0-100)
// Normalize word for search (remove diacritics, convert to Persian)
function normW(w){
  return w
    .replace(/[\u064B-\u065F]/g, '') // Remove Arabic diacritics
    .replace(/[\u0650-\u065F\u064B-\u064F\u0610-\u061A]/g, '') // Remove all diacritics
    .replace(/ی/g, 'ي').replace(/ک/g, 'ك') // Standard Persian forms
    .replace(/[ـًٌٍَُِْٰ\u200C\u200F]/g, '') // Remove zero-width and other marks
    .replace(/[^آ-یA-Za-z0-9]/g, '') // Keep only Persian/Arabic letters and numbers
    .toLowerCase();
}
// Darken color by percentage (0-100)
function darkenColor(hex, percent){
  // Remove # if present
  hex = hex.replace(/^#/, '');
  // Parse r, g, b
  var r = parseInt(hex.slice(0,2), 16);
  var g = parseInt(hex.slice(2,4), 16);
  var b = parseInt(hex.slice(4,6), 16);
  // Convert to darken
  r = Math.round(r * (100 - percent) / 100);
  g = Math.round(g * (100 - percent) / 100);
  b = Math.round(b * (100 - percent) / 100);
  // Ensure within bounds
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  // Return hex
  return '#' + [r,g,b].map(function(c){
    return ('0' + c.toString(16)).slice(-2);
  }).join('');
}
// Build search index from book pages
function buildSearchIndex(){
  if (!BOOK || !BOOK.pages) return;
  var index = {};
  BOOK.pages.forEach(function(p){
    // Extract text from HTML (remove tags)
    var txt = p.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    var words = txt.split(/[\s،؛:.,!?]/).filter(Boolean);
    words.forEach(function(w){
      var nw = normW(w);
      if (!nw || nw.length < 2) return;
      if (!index[nw]) index[nw] = [];
      if (!index[nw].includes(p.page)) index[nw].push(p.page);
    });
  });
  BOOK.searchIndex = index;
  console.log('[coreader] search index built:', Object.keys(index).length, 'unique words');
}
function lightenColor(hex, percent){
  // Remove # if present
  hex = hex.replace(/^#/, '');
  // Convert to RGB
  var r = parseInt(hex.substr(0,2), 16);
  var g = parseInt(hex.substr(2,2), 16);
  var b = parseInt(hex.substr(4,2), 16);
  // Calculate lightness
  r = Math.min(255, Math.floor(r + (255 - r) * (percent / 100)));
  g = Math.min(255, Math.floor(g + (255 - g) * (percent / 100)));
  b = Math.min(255, Math.floor(b + (255 - b) * (percent / 100)));
  // Convert back to hex
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// ===== Load book =====
console.log('[coreader] loading book.json from', window.BOOK_URL || 'book.json');
fetch(window.BOOK_URL || 'book.json').then(function(r){return r.json()}).then(function(book){
  console.log('[coreader] book loaded:', book.title, 'pages:', book.pages ? book.pages.length : 'NONE');
  BOOK = book;
  document.getElementById('bookTitle').textContent = book.title;
  document.getElementById('bookMeta').textContent = 'تألیف: ' + (book.author || 'ناشناس');
  buildToc();
  buildPages();
  updNav();
  goPg(1);
  loadSettings();
  loadHighlightSettings();
  loadFontWeightSettings();
  loadMagSettings();
  loadColorSettings();
  loadThemeColor();
  // Load text width from localStorage
  (function(){
    var tw = localStorage.getItem('coreader-tw');
    if (tw){
      document.querySelector('.tc').style.maxWidth = tw + 'px';
      document.getElementById('setTw').value = tw;
      document.getElementById('setTwV').textContent = toFA(tw);
    }
  })();
  loadUserEdits();
  loadTtsSettings();
  populateTtsVoices();
  loadAutoTheme();
  if (book.hasPdf) document.getElementById('bPdf').style.display = '';
  console.log('[coreader] book setup complete');
}).catch(function(err){
  console.error('[coreader] book load error:', err);
  document.getElementById('tc').innerHTML = '<p style="color:red">خطا در بارگذاری کتاب: ' + (err && err.message ? err.message : String(err)) + '</p>';
});

function buildToc(){
  var tocEl = document.getElementById('toc');
  tocEl.innerHTML = '';
  BOOK.chapters.forEach(function(ch){
    var item = document.createElement('div');
    item.className = 'toc-item';
    item.dataset.startPage = ch.startPage;
    var title = document.createElement('a');
    title.className = 'toc-title';
    title.textContent = ch.title;
    title.href = '#pg_' + ch.startPage;
    title.onclick = function(e){ e.preventDefault(); goPg(ch.startPage); };
    var pg = document.createElement('a');
    pg.className = 'toc-pg';
    pg.textContent = 'صفحهٔ ' + toFA(ch.startPage);
    pg.href = '#pg_' + ch.startPage;
    pg.onclick = function(e){ e.preventDefault(); goPg(ch.startPage); };
    item.appendChild(title);
    item.appendChild(pg);
    tocEl.appendChild(item);
  });
}

function buildPages(){
  var tc = document.getElementById('tc');
  tc.innerHTML = '';
  BOOK.pages.forEach(function(p){
    var s = document.createElement('div'); s.className = 'ps'; s.id = 'pg_' + p.page;
    s.innerHTML = '<div class="ps-hdr"><span class="ps-num">صفحه ' + toFA(p.page) +
      '</span>' + (BOOK.hasPdf ? '<a class="ps-link" onclick="openPdfAt(' + p.page + ')">PDF</a>' : '') +
      '</div><div class="ps-txt">' + p.html + '</div>';
    tc.appendChild(s);
  });
  setTimeout(function(){
    if (!window.IntersectionObserver) return;
    var observer = new IntersectionObserver(function(entries){
      for (var i = 0; i < entries.length; i++){
        if (entries[i].isIntersecting){
          var pg = +entries[i].target.id.replace('pg_', '');
          if (pg && pg !== curPage){ curPage = pg; updNav(); hlToc(); saveReadingProgress(); }
        }
      }
    }, { rootMargin: '-20% 0px -70% 0px' });
    document.querySelectorAll('.ps').forEach(function(s){ observer.observe(s); });
  }, 0);
}

function goPg(n){
  curPage = n;
  var el = document.getElementById('pg_' + n);
  if (el && el.scrollIntoView) el.scrollIntoView();
  updNav(); hlToc();
  // Sync PDF if open
  if (pdfDoc && document.getElementById('pdfWrap').classList.contains('on')){
    pdfGoto(n);
  }
  clearMarginAnnos(); // clear margin annotations on page change
  // Clear highlight overlays
  var sl = document.getElementById('hlSlide');
  if (sl) sl.classList.remove('active');
  hideNeighbors();
  // Close edit toolbar on page change
  var et = document.getElementById('editToolbar');
  if (et) et.classList.remove('on');
  editingText = false;
  // Feature 3: Save reading progress
  saveReadingProgress();
}
function updNav(){
  var inp = document.getElementById('pgInput');
  var tot = document.getElementById('pgTotal');
  var total = BOOK ? BOOK.pages.length : 0;
  if (inp) inp.value = curPage;
  if (tot) tot.textContent = 'از ' + toFA(total);
}
function hlToc(){
  var items = document.querySelectorAll('.toc-item');
  items.forEach(function(item, i){
    var sp = +item.dataset.startPage;
    var next = items[i + 1] ? +items[i + 1].dataset.startPage : Infinity;
    item.classList.toggle('cur', curPage >= sp && curPage < next);
  });
}
function toggleSidebar(){ document.getElementById('sb').classList.toggle('off'); }

// ===== Settings (theme, font, size, line-height) — persisted globally,
// not per-book, since reading preferences carry across books =====
function openSettings(){ document.getElementById('setOverlay').classList.add('on'); document.getElementById('setPanel').classList.add('on'); }
function closeSettings(){ document.getElementById('setOverlay').classList.remove('on'); document.getElementById('setPanel').classList.remove('on'); }
function applySetting(k, v){
  var r = document.documentElement;
  if (k === 'font'){ r.style.setProperty('--ff', v); }
  else if (k === 'fs'){ r.style.setProperty('--fs', v + 'px'); document.getElementById('setFsV').textContent = toFA(v); }
  else if (k === 'tw'){
    document.querySelector('.tc').style.maxWidth = v + 'px';
    document.getElementById('setTwV').textContent = toFA(v);
    localStorage.setItem('coreader-tw', v);
    return;
  }
  else if (k === 'lh'){ r.style.setProperty('--lh', v / 10); document.getElementById('setLhV').textContent = (v / 10).toFixed(1); }
  else if (k === 'hlColor'){
    r.style.setProperty('--hl-color', v);
    document.getElementById('setHlColor').value = v;
    document.querySelectorAll('.hl-preset').forEach(function(b){ b.classList.toggle('on', b.dataset.color === v); });
    saveHighlightSettings(); return;
  }
  else if (k === 'hlOpacity'){
    r.style.setProperty('--hl-opacity', v);
    document.getElementById('setHlOpacityV').textContent = (+v).toFixed(2);
    saveHighlightSettings(); return;
  }
  else if (k === 'hlGlow'){
    r.style.setProperty('--hl-glow', v);
    document.getElementById('setHlGlowV').textContent = toFA(v);
    saveHighlightSettings(); return;
  }
  else if (k === 'hlSpeed'){
    r.style.setProperty('--hl-speed', v);
    document.getElementById('setHlSpeedV').textContent = (+v).toFixed(1);
    saveHighlightSettings(); return;
  }
  else if (k === 'fw'){
    r.style.setProperty('--fw', v);
    saveFontWeightSettings(); return;
  }
  else if (k === 'magSize'){
    MAG_W = Math.min(1600, Math.max(400, +v)); MAG_H = Math.round(MAG_W * 461 / 1600);
    var lens = document.getElementById('magLens');
    if (lens){ lens.style.width = MAG_W + 'px'; lens.style.height = MAG_H + 'px'; }
    document.getElementById('setMagSizeV').textContent = toFA(MAG_W);
    saveMagSettings(); return;
  }
  else if (k === 'magZoom'){
    MAG_SCALE = +v;
    document.getElementById('setMagZoomV').textContent = (+v).toFixed(1) + '×';
    saveMagSettings(); return;
  }
  else if (k === 'magAutoFollow'){
      toggleMagAutoFollow();
      return;
    }
  else if (k === 'fgColor'){
    document.documentElement.style.setProperty('--fg-color', v);
    document.body.style.setProperty('--fg-color', v);
    document.getElementById('setFgColorV').textContent = v;
    localStorage.setItem('coreader-fg-color', v);
    return;
  }
  else if (k === 'glassOpacity'){
    var alpha = v / 100;
    // Update all theme glass-bg values — preserve RGB from computed style
    var rootStyle = getComputedStyle(document.documentElement);
    var rootBg = rootStyle.getPropertyValue('--glass-bg').trim();
    var rootRgb = rootBg.replace(/^rgba?\s*\(\s*/, '').replace(/\s*\)\s*$/, '').split(/\s*,\s*/).slice(0,3);
    document.documentElement.style.setProperty('--glass-bg', 'rgba(' + rootRgb.join(',') + ',' + alpha + ')');
    
    var bodyStyle = getComputedStyle(document.body);
    var bodyBg = bodyStyle.getPropertyValue('--glass-bg').trim();
    if (bodyBg) {
      var bodyRgb = bodyBg.replace(/^rgba?\s*\(\s*/, '').replace(/\s*\)\s*$/, '').split(/\s*,\s*/).slice(0,3);
      document.body.style.setProperty('--glass-bg', 'rgba(' + bodyRgb.join(',') + ',' + alpha + ')');
    }
    document.getElementById('setGlassOpacityV').textContent = toFA(v) + '٪';
    localStorage.setItem('coreader-glass-opacity', v);
    return;
  }
  else if (k === 'autoTheme'){
    var enabled = document.getElementById('setAutoTheme').checked;
    localStorage.setItem('coreader-auto-theme', enabled ? '1' : '0');
    if (enabled) checkAutoTheme();
    return;
  }
  localStorage.setItem('coreader-settings', JSON.stringify({
    font: document.getElementById('setFont').value,
    fs: document.getElementById('setFs').value,
    lh: document.getElementById('setLh').value,
  }));
}
function loadSettings(){
  var s; try { s = JSON.parse(localStorage.getItem('coreader-settings')); } catch (e) {}
  if (!s) return;
  if (s.font){ document.documentElement.style.setProperty('--ff', s.font); document.getElementById('setFont').value = s.font; }
  if (s.fs){ document.documentElement.style.setProperty('--fs', s.fs + 'px'); document.getElementById('setFs').value = s.fs; document.getElementById('setFsV').textContent = toFA(s.fs); }
  if (s.lh){ document.documentElement.style.setProperty('--lh', s.lh / 10); document.getElementById('setLh').value = s.lh; document.getElementById('setLhV').textContent = (s.lh / 10).toFixed(1); }
}
function loadColorSettings(){
  // Load fgColor
  var fgColor = localStorage.getItem('coreader-fg-color');
  if (fgColor){
    document.documentElement.style.setProperty('--fg-color', fgColor);
    document.body.style.setProperty('--fg-color', fgColor);
    document.getElementById('setFgColor').value = fgColor;
    document.getElementById('setFgColorV').textContent = fgColor;
  }
  // Load glassOpacity
  var glassOpacity = localStorage.getItem('coreader-glass-opacity');
  if (glassOpacity){
    var alpha = glassOpacity / 100;
    var rootStyle = getComputedStyle(document.documentElement);
    var rootBg = rootStyle.getPropertyValue('--glass-bg').trim();
    var rootRgb = rootBg.replace(/rgba?\s*\(/, '').replace(/\s*\)/, '').split(',').slice(0,3);
    document.documentElement.style.setProperty('--glass-bg', 'rgba(' + rootRgb.join(',') + ',' + alpha + ')');
    var bodyBg = getComputedStyle(document.body).getPropertyValue('--glass-bg').trim();
    if (bodyBg){
      var bodyRgb = bodyBg.replace(/rgba?\s*\(/, '').replace(/\s*\)/, '').split(',').slice(0,3);
      document.body.style.setProperty('--glass-bg', 'rgba(' + bodyRgb.join(',') + ',' + alpha + ')');
    }
    document.getElementById('setGlassOpacity').value = glassOpacity;
    document.getElementById('setGlassOpacityV').textContent = toFA(glassOpacity) + '٪';
  }
}
function saveHighlightSettings(){
  localStorage.setItem('coreader-highlight-settings', JSON.stringify({
    color: document.getElementById('setHlColor').value,
    opacity: document.getElementById('setHlOpacity').value,
    glow: document.getElementById('setHlGlow').value,
    speed: document.getElementById('setHlSpeed').value,
  }));
}
function loadHighlightSettings(){
  var s; try { s = JSON.parse(localStorage.getItem('coreader-highlight-settings')); } catch (e) {}
  if (!s) return;
  var r = document.documentElement;
  if (s.color){ r.style.setProperty('--hl-color', s.color); document.getElementById('setHlColor').value = s.color; document.querySelectorAll('.hl-preset').forEach(function(b){ b.classList.toggle('on', b.dataset.color === s.color); }); }
  if (s.opacity){ r.style.setProperty('--hl-opacity', s.opacity); document.getElementById('setHlOpacity').value = s.opacity; document.getElementById('setHlOpacityV').textContent = (+s.opacity).toFixed(2); }
  if (s.glow){ r.style.setProperty('--hl-glow', s.glow); document.getElementById('setHlGlow').value = s.glow; document.getElementById('setHlGlowV').textContent = toFA(s.glow); }
  if (s.speed){ r.style.setProperty('--hl-speed', s.speed); document.getElementById('setHlSpeed').value = s.speed; document.getElementById('setHlSpeedV').textContent = (+s.speed).toFixed(1); }
}
function saveFontWeightSettings(){
  localStorage.setItem('coreader-fontweight-settings', JSON.stringify({
    fw: document.getElementById('setFw').value,
  }));
}
function loadFontWeightSettings(){
  var s; try { s = JSON.parse(localStorage.getItem('coreader-fontweight-settings')); } catch (e) {}
  if (!s || !s.fw) return;
  document.documentElement.style.setProperty('--fw', s.fw);
  document.getElementById('setFw').value = s.fw;
}
function saveMagSettings(){
  localStorage.setItem('coreader-mag-settings', JSON.stringify({
    size: MAG_W, zoom: MAG_SCALE, autoFollow: magAutoFollow
  }));
}
function loadMagSettings(){
  var s; try { s = JSON.parse(localStorage.getItem('coreader-mag-settings')); } catch (e) {}
  if (!s) return;
  if (s.size){ MAG_W = Math.min(1600, Math.max(400, +s.size)); MAG_H = Math.round(MAG_W * 461 / 1600); }
  if (s.zoom) MAG_SCALE = Math.min(5, Math.max(1, +s.zoom));
  if (s.autoFollow !== undefined) magAutoFollow = s.autoFollow;
  document.getElementById('setMagSize').value = MAG_W;
  document.getElementById('setMagSizeV').textContent = toFA(MAG_W);
  document.getElementById('setMagZoom').value = MAG_SCALE;
  document.getElementById('setMagZoomV').textContent = (+MAG_SCALE).toFixed(1) + '×';
  document.getElementById('setMagAutoFollow').checked = magAutoFollow;
}
function setTheme(t){
  document.body.className = t || '';
  document.querySelectorAll('.theme-btn').forEach(function(b){ b.classList.toggle('on', b.dataset.theme === t); });
  localStorage.setItem('coreader-theme', t || '');
}
(function(){ var t = localStorage.getItem('coreader-theme'); if (t) setTheme(t); })();

// ===== Feature 2: Glass opacity on load =====
(function(){
  var v = localStorage.getItem('coreader-glass-opacity');
  if (v){
    var alpha = v / 100;
    document.documentElement.style.setProperty('--glass-bg', 'rgba(250,248,245,' + alpha + ')');
    document.body.style.setProperty('--glass-bg', 'rgba(250,248,245,' + alpha + ')');
    var inp = document.getElementById('setGlassOpacity');
    if (inp){ inp.value = v; document.getElementById('setGlassOpacityV').textContent = toFA(v) + '٪'; }
  }
})();

// ===== Feature 3: Reading progress persistence =====
function saveReadingProgress(){
  if (!BOOK) return;
  try {
    var prog = JSON.parse(localStorage.getItem('coreader-progress') || '{}');
    prog[BOOK.slug] = curPage;
    localStorage.setItem('coreader-progress', JSON.stringify(prog));
  } catch(e){}
}

// ===== Feature 6: Auto night/day mode =====
var autoThemeTimer = null;
function checkAutoTheme(){
  var h = new Date().getHours();
  var theme = (h >= 18 || h < 7) ? 'dark' : '';
  setTheme(theme);
}
function loadAutoTheme(){
  var enabled = localStorage.getItem('coreader-auto-theme') === '1';
  var inp = document.getElementById('setAutoTheme');
  if (inp) inp.checked = enabled;
  if (enabled){
    checkAutoTheme();
    autoThemeTimer = setInterval(checkAutoTheme, 300000); // every 5 minutes
  }
}

// ===== Custom theme color =====
function setThemeColor(color){
  // Remove any existing theme classes
  document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
  // Set custom background color
  document.documentElement.style.setProperty('--bg', color);
  document.body.style.setProperty('--bg', color);
  // Derive card, side, hover colors from theme
  // Use HSL conversion for light/dark variants
  var r = parseInt(color.slice(1,3), 16);
  var g = parseInt(color.slice(3,5), 16);
  var b = parseInt(color.slice(5,7), 16);
  // Calculate brightness
  var brightness = (r * 299 + g * 587 + b * 114) / 1000;
  var isDark = brightness < 128;
  
  // Card color: 12% lighter than bg
  var card = lightenColor(color, isDark ? 8 : 12);
  // Side color: 4% lighter than bg  
  var side = lightenColor(color, isDark ? 2 : 4);
  // Hover color: intermediate between bg and card
  var hover = lightenColor(color, isDark ? 4 : 6);
  // Accent colors: choose contrasting colors
  var accent = isDark ? '#c49a6c' : '#8b4513';
  var accent2 = isDark ? '#a07848' : '#6b3410';
  // Border color: 18% darker than bg for light, 8% lighter for dark
  var border = darkenColor(color, isDark ? 8 : 18);
  // Tooltip background: accent color
  var ttBg = accent;
  // Tooltip foreground: contrasting text
  var ttFg = isDark ? '#f5e6d3' : '#fff9f0';
  // Link color: accent2
  var link = accent2;
  // Glass border: semi‑transparent border
  var glassBorder = 'rgba(' + r + ',' + g + ',' + b + ',' + '0.45)';
  // Glow spread for highlights
  var glowSpread = '0 0 12px rgba(' + 
    parseInt(accent.slice(1,3), 16) + ',' +
    parseInt(accent.slice(3,5), 16) + ',' +
    parseInt(accent.slice(5,7), 16) + ',.35)';
  
  // Apply ALL theme variables
  var vars = {
    '--card': card,
    '--side': side,
    '--hover': hover,
    '--accent': accent,
    '--accent2': accent2,
    '--border': border,
    '--tt-bg': ttBg,
    '--tt-fg': ttFg,
    '--link': link,
    '--glass-border': glassBorder,
    '--glow-spread': glowSpread
  };
  
  Object.keys(vars).forEach(function(key){
    document.documentElement.style.setProperty(key, vars[key]);
    document.body.style.setProperty(key, vars[key]);
  });
  
  // Adjust glass-bg RGB to match theme
  var alpha = (localStorage.getItem('coreader-glass-opacity') || 72) / 100;
  document.documentElement.style.setProperty('--glass-bg', 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')');
  document.body.style.setProperty('--glass-bg', 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')');
  
  document.getElementById('setThemeColorV').textContent = color;
  localStorage.setItem('coreader-theme-color', color);
}
function loadThemeColor(){
  var themeColor = localStorage.getItem('coreader-theme-color');
  if (themeColor && themeColor.match(/^#[0-9A-Fa-f]{6}$/)){
    // Apply theme color with stored opacity
    var opacity = localStorage.getItem('coreader-glass-opacity') || 72;
    var alpha = opacity / 100;
    var r = parseInt(themeColor.slice(1,3), 16);
    var g = parseInt(themeColor.slice(3,5), 16);
    var b = parseInt(themeColor.slice(5,7), 16);
    document.documentElement.style.setProperty('--bg', themeColor);
    document.body.style.setProperty('--bg', themeColor);
    document.documentElement.style.setProperty('--glass-bg', 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')');
    document.body.style.setProperty('--glass-bg', 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')');
    var el = document.getElementById('setThemeColorV');
    if (el) el.textContent = themeColor;
  } else {
    // Default theme color
    localStorage.setItem('coreader-theme-color', '#faf8f5');
    setThemeColor('#faf8f5');
  }
}

// ===== Annotation display: tooltips (normal) / persistent margin cards (recording/TTS) =====
var CAT_LABELS = { arabic: 'عربی', poem: 'شعر و نظم', quran: 'آیه و حدیث', hist: 'تاریخ',
  word: 'لغت کهن', person: 'شخصیت', event: 'واقعه' };
var activeMarginCards = []; // { el, marginEl, side }
var CARD_STACK_OFFSET = 76; // px shift up per stack level

function isPersistMode(){ return recording || ttsOn; }

function clearMarginAnnos(){
  activeMarginCards.forEach(function(c){
    if (c.marginEl && c.marginEl.parentNode) c.marginEl.parentNode.removeChild(c.marginEl);
    c.el._marginEl = null;
  });
  activeMarginCards = [];
  document.querySelectorAll('.anno-tooltip').forEach(function(t){
    if (t.parentNode) t.parentNode.removeChild(t);
  });
}

function showMarginAnno(el){
  if (!el || !annoOn) return;
  if (isPersistMode()){
    // Clean up any leftover tooltip
    if (el._tooltipEl){ if (el._tooltipEl.parentNode) el._tooltipEl.parentNode.removeChild(el._tooltipEl); el._tooltipEl = null; }
    showPersistentMarginAnno(el);
  } else {
    showTooltip(el);
  }
}

// --- Normal mode: floating tooltip on hover ---
function showTooltip(el){
  if (el._tooltipEl && el._tooltipEl.parentNode) return;
  var cat = el.dataset.cat || 'word';
  var tt = document.createElement('div');
  tt.className = 'anno-tooltip';
  var html = '<div class="at-word">' + el.textContent + '</div>';
  html += '<span class="am-cat tc-' + cat + '">' + (CAT_LABELS[cat] || cat) + '</span>';
  if (el.dataset.title) html += '<div class="at-title">' + el.dataset.title + '</div>';
  html += '<div class="at-text">' + (el.dataset.text || el.getAttribute('title') || '') + '</div>';
  if (el.dataset.extra) html += '<div class="at-extra">' + el.dataset.extra + '</div>';
  tt.innerHTML = html;
  document.body.appendChild(tt);
  el._tooltipEl = tt;
  var elRect = el.getBoundingClientRect();
  var ttW = 280;
  var left = elRect.left + elRect.width / 2 - ttW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - ttW - 8));
  tt.style.left = left + 'px';
  tt.style.top = (elRect.top - 8) + 'px';
  requestAnimationFrame(function(){
    if (!tt.parentNode) return;
    var ttRect = tt.getBoundingClientRect();
    if (ttRect.top < 4) tt.style.top = (elRect.bottom + 8) + 'px';
  });
}

// --- Recording/TTS mode: persistent margin cards with stacking ---
function showPersistentMarginAnno(el){
  if (el._marginEl && el._marginEl.parentNode) return;
  var cat = el.dataset.cat || 'word';
  var pgEl = el.closest('.ps');
  if (!pgEl) return;
  var margin = document.createElement('div');
  margin.className = 'anno-margin anno-margin-entering';
  var html = '<div class="am-word">' + el.textContent + '</div>';
  html += '<span class="am-cat tc-' + cat + '">' + (CAT_LABELS[cat] || cat) + '</span>';
  if (el.dataset.title) html += '<div class="am-title">' + el.dataset.title + '</div>';
  html += '<div class="am-text">' + (el.dataset.text || el.getAttribute('title') || '') + '</div>';
  if (el.dataset.extra) html += '<div class="am-extra">' + el.dataset.extra + '</div>';
  margin.innerHTML = html;
  margin.style.cursor = 'pointer';
  var side;
  margin.addEventListener('click', function(){
    if (margin.parentNode) margin.parentNode.removeChild(margin);
    el._marginEl = null;
    var idx = -1;
    for (var i = 0; i < activeMarginCards.length; i++){
      if (activeMarginCards[i].marginEl === margin){ idx = i; break; }
    }
    if (idx >= 0) activeMarginCards.splice(idx, 1);
    repositionStack(side);
  });
  pgEl.style.position = 'relative';
  pgEl.appendChild(margin);
  el._marginEl = margin;
  var annos = pgEl.querySelectorAll('.anno');
  var myIdx = Array.prototype.indexOf.call(annos, el);
  side = myIdx % 2 === 0 ? 'r' : 'l';
  margin.classList.add('anno-margin-' + side);
  var pgRect = pgEl.getBoundingClientRect();
  var elRect = el.getBoundingClientRect();
  var top = elRect.top - pgRect.top + pgEl.scrollTop - 10;
  top = Math.max(0, Math.min(top, pgRect.height - 120));
  margin.style.top = top + 'px';
  activeMarginCards.push({ el: el, marginEl: margin, side: side });
  setTimeout(function(){ margin.classList.remove('anno-margin-entering'); }, 300);
  repositionStack(side);
}

function repositionStack(side){
  var cards = activeMarginCards.filter(function(c){ return c.side === side && c.marginEl.parentNode; });
  var count = cards.length;
  for (var i = 0; i < count; i++){
    var card = cards[i];
    if (count > 1 && i < count - 1){
      var stackDepth = count - 1 - i;
      card.marginEl.classList.add('anno-margin-stacked');
      card.marginEl.style.transform = 'translateY(-' + (stackDepth * CARD_STACK_OFFSET) + 'px) scale(' + Math.max(0.75, 1 - stackDepth * 0.06) + ')';
    } else {
      card.marginEl.classList.remove('anno-margin-stacked');
      card.marginEl.style.transform = '';
    }
  }
}

document.addEventListener('mouseover', function(e){
  var a = e.target.closest && e.target.closest('.anno');
  if (a && annoOn) showMarginAnno(a);
});
document.addEventListener('mouseout', function(e){
  var a = e.target.closest && e.target.closest('.anno');
  if (!a || !annoOn || isPersistMode()) return;
  var related = e.relatedTarget;
  if (related && related.closest && related.closest('.anno') === a) return;
  if (a._tooltipEl){
    if (a._tooltipEl.parentNode) a._tooltipEl.parentNode.removeChild(a._tooltipEl);
    a._tooltipEl = null;
  }
});
function toggleAnno(){
  annoOn = !annoOn;
  document.getElementById('bAnno').classList.toggle('on', annoOn);
  document.body.classList.toggle('annos-off', !annoOn);
  if (!annoOn) clearMarginAnnos();
}

// ===== Progress bar =====
window.addEventListener('scroll', function(){
  var max = document.documentElement.scrollHeight - window.innerHeight;
  document.getElementById('pbar').style.width = (max > 0 ? window.scrollY / max * 100 : 0) + '%';
}, { passive: true });

// ===== Keyboard shortcuts =====
function navPg(d){ if (BOOK) goPg(Math.max(1, Math.min(BOOK.pages.length, curPage + d))); }
document.addEventListener('keydown', function(e){
  if (e.target && (e.target.tagName === 'INPUT' || e.target.isContentEditable)) return;
  if (e.key === 'ArrowRight') navPg(-1);
  else if (e.key === 'ArrowLeft') navPg(1);
  else if (e.key === 'Escape'){ closeSettings(); closeEncPanel(); document.getElementById('ctxMenu').setAttribute('data-open', 'false'); }
});

// ===== Search =====
function searchBook(q){
  var resultsEl = document.getElementById('searchResults');
  q = q.trim();
  if (!q){ resultsEl.innerHTML = ''; return; }
  var terms = q.split(/\s+/).map(normW).filter(Boolean);
  if (!terms.length){ resultsEl.innerHTML = ''; return; }
  var idx = BOOK.searchIndex;
  var pageSets = terms.map(function(t){ return new Set(idx[t] || []); });
  var common = [...pageSets[0]].filter(function(p){ return pageSets.every(function(s){ return s.has(p); }); });
  common.sort(function(a,b){ return a-b; });
  if (!common.length){ resultsEl.innerHTML = '<div style="padding:8px;color:#999">نتیجه‌ای یافت نشد</div>'; return; }
  resultsEl.innerHTML = common.slice(0, 30).map(function(pg){
    var page = BOOK.pages.find(function(p){ return p.page === pg; });
    var plain = page ? page.html.replace(/<[^>]+>/g, '') : '';
    var snippetStart = Math.max(0, plain.indexOf(q.split(/\s+/)[0]) - 40);
    var snippet = plain.slice(snippetStart, snippetStart + 120);
    return '<a onclick="goPg(' + pg + ')">' +
      'صفحه ' + toFA(pg) + ' — ' + snippet + '…</a>';
  }).join('');
}

// ===== PDF panel — supports multiple PDF sources (editions/scans) per
// book, switchable via a dropdown, so more than one witness of a text can
// be viewed (and, per the reader's design, compared) on the same page =====
var pdfDoc = null, curPdf = 1, pdfSc = 1.3, pdfPendingPage = null;
var curPdfSrc = 0, pdfDocCache = {};
function showPdfErr(msg){ document.getElementById('pdfErr').textContent = msg; document.getElementById('pdfErr').style.display = 'block'; document.getElementById('pdfC').style.display = 'none'; }
function hidePdfErr(){ document.getElementById('pdfErr').style.display = 'none'; document.getElementById('pdfC').style.display = 'block'; }
function pdfSources(){ return (BOOK && BOOK.pdfSources && BOOK.pdfSources.length) ? BOOK.pdfSources : (BOOK && BOOK.hasPdf ? [{ id: 'pdf_1', label: BOOK.title, filename: 'source.pdf' }] : []); }
function buildPdfSourceSelect(){
  var srcs = pdfSources();
  var sel = document.getElementById('pdfSrcSel');
  if (srcs.length <= 1){ sel.style.display = 'none'; return; }
  sel.style.display = '';
  sel.innerHTML = srcs.map(function(s, i){ return '<option value="' + i + '">' + s.label + '</option>'; }).join('');
  sel.value = curPdfSrc;
}
function switchPdfSource(idx){
  curPdfSrc = +idx;
  document.getElementById('pdfSrcSel').value = curPdfSrc;
  if (pdfDocCache[curPdfSrc]){ pdfDoc = pdfDocCache[curPdfSrc]; document.getElementById('pdfMax').textContent = pdfDoc.numPages; pdfRender(1); }
  else loadPdf();
}
function loadPdf(){
  var srcs = pdfSources();
  var src = srcs[curPdfSrc];
  if (!src){ showPdfErr('این کتاب نسخهٔ PDF ندارد.'); return; }
  hidePdfErr(); document.getElementById('pdfMax').textContent = '...';
  fetch(src.filename).then(function(r){ if (!r.ok) throw 0; return r.arrayBuffer(); })
    .then(function(buf){ return pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise; })
    .then(function(doc){ pdfDoc = doc; pdfDocCache[curPdfSrc] = doc; document.getElementById('pdfMax').textContent = doc.numPages; pdfRender(pdfPendingPage || 1); pdfPendingPage = null; })
    .catch(function(){ showPdfErr('فایل «' + src.filename + '» در کنار book.json یافت نشد.'); });
}
function pdfRender(n){
  if (!pdfDoc || n < 1 || n > pdfDoc.numPages) return;
  curPdf = n; document.getElementById('pdfIn').value = n;
  pdfDoc.getPage(n).then(function(p){
    var v = p.getViewport({ scale: pdfSc });
    var c = document.getElementById('pdfC'); c.width = v.width; c.height = v.height;
    p.render({ canvasContext: c.getContext('2d'), viewport: v }).promise.then(function(){
      updatePdfHighlightPosition();
    });
  });
}
function pdfGoto(n){ if (n >= 1 && n <= (pdfDoc ? pdfDoc.numPages : 1)){ pdfRender(n); curPdf = n; } }
function pdfNav(d){ var n = curPdf + d; pdfGoto(n); }
function pdfZoom(d){ pdfSc = Math.max(.5, Math.min(3, pdfSc + d)); document.getElementById('pdfZL').textContent = Math.round(pdfSc * 100) + '%'; pdfRender(curPdf); }
function openPdfAt(n){ pdfPendingPage = n; showMode('pdf'); }
function showMode(m){
  document.getElementById('pdfWrap').classList.toggle('on', m === 'pdf');
  document.getElementById('bPdf').classList.toggle('on', m === 'pdf');
  document.body.classList.toggle('pdf-open', m === 'pdf');
  if (m === 'pdf'){
    buildPdfSourceSelect();
    if (!pdfDoc) loadPdf(); else { pdfRender(pdfPendingPage || curPdf); pdfPendingPage = null; }
    syncPdfHighlight();
  }
}
function closePdf(){ showMode('text'); }

// PDF.js text search for word-level highlight sync
// Returns word index in page text if found, -1 otherwise
function pdfFindText(text, pageIndex, pdfDoc){
  return new Promise(function(resolve, reject){
    if(!pdfDoc || !pdfDoc.pdfDocument) { resolve(-1); return; }
    pdfDoc.pdfDocument.getPage(pageIndex).then(function(page){
      page.getTextContent().then(function(tc){
        var str = tc.items.map(function(i){ return i.str; }).join(' ');
        var idx = str.indexOf(text);
        resolve(idx >= 0 ? idx : -1);
      }).catch(function(){ resolve(-1); });
    }).catch(function(){ resolve(-1); });
  });
}

// Draw text selection highlight on PDF canvas using PDF.js text content
function drawPdfHighlight(text, pageIndex, pdfDoc){
  return new Promise(function(resolve, reject){
    if(!pdfDoc || !pdfDoc.pdfDocument) { resolve(false); return; }
    pdfDoc.pdfDocument.getPage(pageIndex).then(function(page){
      page.getTextContent().then(function(tc){
        var items = tc.items;
        var str = items.map(function(i){ return i.str; }).join(' ');
        var idx = str.indexOf(text);
        if(idx < 0) { resolve(false); return; }
        
        // Find start/end items by character position
        var charIdx = 0, startItem = -1, endItem = -1;
        for(var i=0; i<items.length; i++){
          var len = items[i].str.length;
          if(startItem < 0 && charIdx + len > idx) startItem = i;
          if(startItem >= 0 && charIdx + len >= idx + text.length) { endItem = i; break; }
          charIdx += len;
        }
        
        if(startItem < 0 || endItem < 0) { resolve(false); return; }
        
        // Get bounding boxes for start and end items
        var startBox = items[startItem].dir === 'ltr' ? items[startItem].dir === 'ttb' ? 
          {x: items[startItem].transform[4], y: items[startItem].transform[5], w: items[startItem].width, h: items[startItem].height} :
          {x: items[startItem].transform[4], y: items[startItem].transform[5], w: items[startItem].width, h: items[startItem].height} :
          {x: items[startItem].transform[4] - items[startItem].width, y: items[startItem].transform[5], w: items[startItem].width, h: items[startItem].height};
        
        var endBox = items[endItem].dir === 'ltr' ? items[endItem].transform[4] :
          {x: items[endItem].transform[4] - items[endItem].width, y: items[endItem].transform[5], w: items[endItem].width, h: items[endItem].height};
        
        // Calculate combined rectangle
        var x = Math.min(startBox.x, endBox.x);
        var y = Math.min(startBox.y, endBox.y);
        var w = (endBox.x + endBox.w) - x;
        var h = (endBox.y + endBox.h) - y;
        
        // Draw on canvas if available
        var canvas = document.getElementById('pdfC');
        var ctx = canvas ? canvas.getContext('2d') : null;
        if(ctx && canvas.width > 0){
          var scale = canvas.width / page.view[2];
          var dx = x * scale, dy = y * scale, dw = w * scale, dh = h * scale;
          ctx.fillStyle = 'rgba(255,232,0,0.5)';
          ctx.fillRect(dx, dy, dw, dh);
        }
        resolve(true);
      }).catch(function(){ resolve(false); });
    }).catch(function(){ resolve(false); });
  });
}

// خط‌بَر ↔ PDF sync: turns the PDF to the page being read, and draws an
// approximate horizontal highlight band at how far through the page's
// words the reader currently is. This is a proportional estimate, not a
// word-exact box — OCR here only produced plain text, not per-word
// coordinates, so an exact box isn't available; the band still gives a
// real, useful "you are roughly here" cue while following along.
function updatePdfHighlightPosition(){
  var hl = document.getElementById('pdfHl');
  if (!recording || !micWords.length || curPdf !== curPage){ hl.style.display = 'none'; return; }
  var canvas = document.getElementById('pdfC');
  if (!canvas || !canvas.height) { hl.style.display = 'none'; return; }
  var frac = micIdx / micWords.length;
  var bandH = Math.max(28, canvas.height * 0.045);
  var top = Math.min(canvas.height - bandH, Math.max(0, frac * canvas.height - bandH / 2));
  hl.style.display = 'block';
  hl.style.top = top + 'px';
  hl.style.height = bandH + 'px';
}
function syncPdfHighlight(){
  if (!document.body.classList.contains('pdf-open') || !recording) return;
  if (pdfDoc && curPdf !== curPage){ pdfGoto(curPage); return; }
  
  // PDF.js text search highlight logic
  if(micWords.length > 0 && micIdx < micWords.length){
    var word = micWords[micIdx];
    if(word && word.length > 0){
      // Try to find word in PDF page using PDF.js text search
      pdfFindText(word, curPdf - 1, pdfDoc).then(function(idx){
        if(idx >= 0 && pdfDoc && pdfDoc.pdfDocument){
          // Word found - draw highlight on canvas
          drawPdfHighlight(word, curPdf - 1, pdfDoc);
        } else {
          // Fallback to horizontal band
          updatePdfHighlightPosition();
        }
      });
    } else {
      updatePdfHighlightPosition();
    }
  } else {
    updatePdfHighlightPosition();
  }
}

// ===== Right-click context menu: add/edit/delete annotation, edit text,
// diacritics toolbar =====
var ctxAnnoEl = null, ctxSel = null, ctxRange = null;
document.addEventListener('contextmenu', function(e){
  var inText = e.target.closest && e.target.closest('.ps-txt,.anno,.ps');
  if (!inText) return;
  e.preventDefault();
  ctxSel = window.getSelection().toString().trim();
  var sel = window.getSelection();
  ctxRange = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  ctxAnnoEl = e.target.closest('.anno');
  var ctxMenu = document.getElementById('ctxMenu');
  ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 220) + 'px';
  ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 340) + 'px';
  ctxMenu.setAttribute('data-open', 'true');
}, true);
document.addEventListener('mousedown', function(e){
  var ctxMenu = document.getElementById('ctxMenu');
  if (e.button !== 2 && !ctxMenu.contains(e.target)) ctxMenu.setAttribute('data-open', 'false');
}, true);

function ctxAddAnno(){
  document.getElementById('ctxMenu').setAttribute('data-open', 'false');
  if (!ctxSel){ alert('ابتدا متن را انتخاب کنید'); return; }
  var title = prompt('عنوان حاشیه (اختیاری):') || '';
  var text = prompt('متن حاشیه:');
  if (!text) return;
  var cat = prompt('دسته (arabic/poem/quran/hist/word/person/event):', 'word') || 'word';
  var span = document.createElement('span');
  span.className = 'anno anno-' + cat;
  span.dataset.cat = cat; span.dataset.title = title; span.dataset.text = text;
  span.textContent = ctxSel;
  try {
    ctxRange.deleteContents();
    ctxRange.insertNode(span);
  } catch (ex){
    var pgEl = document.getElementById('pg_' + curPage);
    var txtEl = pgEl && pgEl.querySelector('.ps-txt');
    if (!txtEl) return;
    var idx = txtEl.innerHTML.indexOf(ctxSel);
    if (idx < 0){ alert('متن یافت نشد'); return; }
    txtEl.innerHTML = txtEl.innerHTML.slice(0, idx) + span.outerHTML + txtEl.innerHTML.slice(idx + ctxSel.length);
  }
  saveUserEdits();
}
function ctxEditAnno(){
  document.getElementById('ctxMenu').setAttribute('data-open', 'false');
  if (!ctxAnnoEl){ alert('روی حاشیه راست‌کلیک کنید'); return; }
  var title = prompt('عنوان جدید:', ctxAnnoEl.dataset.title || '');
  if (title === null) return;
  var text = prompt('متن جدید:', ctxAnnoEl.dataset.text || '');
  if (text === null) return;
  var cat = prompt('دسته:', ctxAnnoEl.dataset.cat || 'word') || ctxAnnoEl.dataset.cat;
  ctxAnnoEl.dataset.title = title; ctxAnnoEl.dataset.text = text; ctxAnnoEl.dataset.cat = cat;
  ctxAnnoEl.className = 'anno anno-' + cat;
  saveUserEdits();
}
function ctxDeleteAnno(){
  document.getElementById('ctxMenu').setAttribute('data-open', 'false');
  if (!ctxAnnoEl){ alert('روی حاشیه راست‌کلیک کنید'); return; }
  if (!confirm('حذف حاشیه؟')) return;
  var parent = ctxAnnoEl.parentNode;
  while (ctxAnnoEl.firstChild) parent.insertBefore(ctxAnnoEl.firstChild, ctxAnnoEl);
  parent.removeChild(ctxAnnoEl);
  ctxAnnoEl = null;
  saveUserEdits();
}
var editingText = false;
function ctxEditText(){
  _closeCtx();
  var pgEl = document.getElementById('pg_' + curPage);
  var txtEl = pgEl && pgEl.querySelector('.ps-txt');
  if (!txtEl) return;
  var toolbar = document.getElementById('editToolbar');
  if (editingText){
    editingText = false;
    txtEl.contentEditable = 'false';
    txtEl.style.outline = 'none'; txtEl.style.background = 'none';
    toolbar.classList.remove('on');
    saveUserEdits();
  } else {
    editingText = true;
    txtEl.contentEditable = 'true';
    txtEl.style.outline = '2px dashed var(--accent)'; txtEl.style.background = 'var(--hover)';
    txtEl.focus();
    toolbar.classList.add('on');
  }
}
function applyEditStyle(cmd, val){
  document.execCommand(cmd, false, val || null);
}
function ctxToggleTashkil(){
  document.getElementById('ctxMenu').setAttribute('data-open', 'false');
  document.getElementById('tashkilBar').classList.toggle('on');
}
function toggleTashkilBar(){ document.getElementById('tashkilBar').classList.remove('on'); }
function insertTashkil(ch){
  var sel = window.getSelection();
  if (!sel.rangeCount) return;
  var range = sel.getRangeAt(0);
  var node = document.createTextNode(ch);
  range.insertNode(node);
  range.setStartAfter(node); range.setEndAfter(node);
  sel.removeAllRanges(); sel.addRange(range);
}

// ===== Persistence — per-book local edits (annotations + text fixes),
// stored client-side since this is a static site with no backend =====
function editsKey(){ return 'coreader-edits-' + (BOOK ? BOOK.slug : 'unknown'); }
function saveUserEdits(){
  try {
    var edits = { textEdits: {} };
    document.querySelectorAll('.ps').forEach(function(pgEl){
      var pg = +pgEl.id.replace('pg_', '');
      var txtEl = pgEl.querySelector('.ps-txt');
      if (!txtEl) return;
      var orig = BOOK.pages.find(function(p){ return p.page === pg; });
      if (orig && txtEl.innerHTML !== orig.html) edits.textEdits[pg] = txtEl.innerHTML;
    });
    localStorage.setItem(editsKey(), JSON.stringify(edits));
  } catch (e) {}
}
function loadUserEdits(){
  try {
    var edits = JSON.parse(localStorage.getItem(editsKey()));
    if (!edits || !edits.textEdits) return;
    Object.keys(edits.textEdits).forEach(function(pg){
      var pgEl = document.getElementById('pg_' + pg);
      var txtEl = pgEl && pgEl.querySelector('.ps-txt');
      if (txtEl) txtEl.innerHTML = edits.textEdits[pg];
    });
  } catch (e) {}
}
setInterval(function(){ if (!editingText) saveUserEdits(); }, 30000);
window.addEventListener('beforeunload', function(){ saveUserEdits(); });

// ===== Dictionary/encyclopedia lookup — link-only by design =====
// An earlier version of this feature tried to fetch and parse third-party
// dictionary pages' raw HTML (through public CORS proxies) to show an
// inline snippet. That was unreliable: proxies go down or rate-limit, and
// scraping arbitrary/changing site markup with regex produced wrong or
// garbled "definitions" often enough to be a real, reported bug. This
// version does not try to reproduce anyone else's content — it just
// reliably deep-links to each real reference site's own search results.
var encSources = [
  { name: 'واژه‌یاب', icon: '📖', desc: 'معنی و مترادف', fn: function(w){ return 'https://vajehyab.com/?q=' + encodeURIComponent(w); } },
  { name: 'لغت‌نامه دهخدا', icon: '📗', desc: 'لغت‌نامه جامع', fn: function(w){ return 'https://vajehyab.com/dehkhoda/' + encodeURIComponent(w); } },
  { name: 'فرهنگ معین', icon: '📘', desc: 'فرهنگ لغت', fn: function(w){ return 'https://vajehyab.com/moein/' + encodeURIComponent(w); } },
  { name: 'فرهنگ عمید', icon: '📙', desc: 'فرهنگ فارسی', fn: function(w){ return 'https://vajehyab.com/amid/' + encodeURIComponent(w); } },
  { name: 'ویکی‌واژه', icon: '🌐', desc: 'واژه‌نامه', fn: function(w){ return 'https://fa.wiktionary.org/wiki/' + encodeURIComponent(w); } },
  { name: 'گنجور', icon: '📜', desc: 'شعر و ادبیات', fn: function(w){ return 'https://ganjoor.net/search?s=' + encodeURIComponent(w); } },
];
function doEncSearch(word){
  if (!word) word = document.getElementById('encLeftInput').value;
  if (!word) return;
  document.getElementById('encLeftWord').textContent = word;
  document.getElementById('encLeftInput').value = word;
  document.getElementById('encLeftResults').innerHTML = encSources.map(function(s){
    return '<a class="enc-link" href="' + s.fn(word) + '" target="_blank" rel="noopener">' +
      '<span class="enc-title">' + s.icon + ' ' + s.name + '</span>' +
      '<span class="enc-desc">' + s.desc + ' ↗</span></a>';
  }).join('');
  document.getElementById('encLeft').classList.add('on');
  document.body.classList.add('enc-open');
}
function closeEncPanel(){
  document.getElementById('encLeft').classList.remove('on');
  document.body.classList.remove('enc-open');
}
function ctxSearchEnc(){
  document.getElementById('ctxMenu').setAttribute('data-open', 'false');
  var word = ctxSel || document.getElementById('encLeftInput').value;
  if (!word){ document.getElementById('encLeft').classList.add('on'); document.body.classList.add('enc-open'); document.getElementById('encLeftInput').focus(); return; }
  doEncSearch(word);
}

// ===== Share annotation (Feature 8) =====
function ctxShareAnno(){
  _closeCtx();
  if (!ctxAnnoEl){
    // If no annotation element was right-clicked, try to share the current selection
    if (!ctxSel){ alert('روی حاشیه راست‌کلیک کنید'); return; }
  }
  var annoEl = ctxAnnoEl;
  if (!annoEl){
    // Generate a shareable link based on current page and selection
    var url = new URL(location.href);
    url.searchParams.set('book', BOOK ? BOOK.slug : '');
    url.searchParams.set('page', curPage);
    navigator.clipboard.writeText(url.toString()).then(function(){
      alert('لینک صفحه کپی شد ✓');
    });
    return;
  }
  // Find or create an ID for this annotation
  if (!annoEl.id){
    annoEl.id = 'anno-' + Math.random().toString(36).substr(2, 9);
  }
  var url = new URL(location.href);
  url.searchParams.set('book', BOOK ? BOOK.slug : '');
  url.searchParams.set('page', curPage);
  url.searchParams.set('anno', annoEl.id);
  navigator.clipboard.writeText(url.toString()).then(function(){
    alert('لینک حاشیه کپی شد ✓');
  });
}

// ===== PDF export with annotations (Feature 10) =====
function exportAnnotationsPdf(){
  var title = BOOK ? BOOK.title : 'کتاب';
  var notes = JSON.parse(localStorage.getItem('coreader-notes') || '[]');
  var highlights = JSON.parse(localStorage.getItem('coreader-highlights') || '[]');
  var favs = JSON.parse(localStorage.getItem('coreader-favs') || '[]');

  var html = '<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8">' +
    '<title>خروجی حاشیه‌ها — ' + title + '</title>' +
    '<style>@import url("https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;700&display=swap");' +
    'body{font-family:"Vazirmatn",sans-serif;direction:rtl;padding:40px;max-width:800px;margin:0 auto;color:#222;line-height:2}' +
    'h1{color:#8b4513;border-bottom:2px solid #d4a853;padding-bottom:8px}' +
    'h2{color:#8b4513;margin-top:32px;border-bottom:1px solid #eee;padding-bottom:4px}' +
    '.item{background:#faf8f5;border:1px solid #e8e2d6;border-radius:8px;padding:12px 16px;margin:8px 0}' +
    '.item .text{font-size:16px}' +
    '.item .meta{font-size:12px;color:#888;margin-top:4px}' +
    '.item .note{font-size:14px;color:#555;margin-top:4px}' +
    '.hl{background:#ffe08a;border-radius:3px;padding:1px 3px}' +
    '</style></head><body>' +
    '<h1>' + title + '</h1>' +
    '<p style="color:#888;font-size:14px">تاریخ: ' + new Date().toLocaleDateString('fa-IR') + '</p>';

  if (favs.length){
    html += '<h2>⭐ علاقه‌مندی‌ها (' + favs.length + ')</h2>';
    favs.forEach(function(f){
      html += '<div class="item"><div class="text">' + (f.text||'').replace(/</g,'&lt;') + '</div>' +
        '<div class="meta">' + (f.book||'') + (f.page ? ' — صفحهٔ ' + f.page : '') + '</div></div>';
    });
  }

  if (highlights.length){
    html += '<h2>🖍️ هایلایت‌ها (' + highlights.length + ')</h2>';
    highlights.forEach(function(h){
      html += '<div class="item"><div class="text"><span class="hl">' + (h.text||'').replace(/</g,'&lt;') + '</span></div>' +
        '<div class="meta">' + (h.book||'') + (h.page ? ' — صفحهٔ ' + h.page : '') + '</div></div>';
    });
  }

  if (notes.length){
    html += '<h2>🗒️ یادداشت‌ها (' + notes.length + ')</h2>';
    notes.forEach(function(n){
      html += '<div class="item"><div class="text">' + (n.text||'').replace(/</g,'&lt;') + '</div>' +
        '<div class="note">📝 ' + (n.note||'').replace(/</g,'&lt;') + '</div>' +
        '<div class="meta">' + (n.book||'') + (n.page ? ' — صفحهٔ ' + n.page : '') + '</div></div>';
    });
  }

  if (!favs.length && !highlights.length && !notes.length){
    html += '<p style="text-align:center;color:#999;padding:40px">هنوز حاشیه‌ای ثبت نشده است.</p>';
  }

  html += '<script>window.print();<\/script></body></html>';

  var w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

// ===== LocalStorage export/import (Feature 12) =====
function exportLocalData(){
  var data = {};
  for (var i = 0; i < localStorage.length; i++){
    var k = localStorage.key(i);
    if (k && k.indexOf('coreader-') === 0){
      data[k] = localStorage.getItem(k);
    }
  }
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'coreader-backup-' + new Date().toISOString().slice(0,10) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function importLocalData(file){
  if (!file) return;
  if (!confirm('داده‌های فعلی بازنویسی می‌شوند. ادامه می‌دهید؟')) return;
  var reader = new FileReader();
  reader.onload = function(e){
    try {
      var data = JSON.parse(e.target.result);
      Object.keys(data).forEach(function(k){
        if (k.indexOf('coreader-') === 0) localStorage.setItem(k, data[k]);
      });
      alert('داده‌ها بازیابی شد — صفحه رفرش می‌شود');
      location.reload();
    } catch (err){
      alert('خطا در خواندن فایل: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ===== URL-based annotation sharing — Feature 8 =====
(function(){
  var p = new URLSearchParams(location.search);
  var annoId = p.get('anno');
  if (!annoId) return;
  var pg = +p.get('page') || 1;
  // Wait for book to load then navigate and highlight
  var wait = setInterval(function(){
    if (BOOK){ clearInterval(wait); goPg(pg); setTimeout(function(){
      var el = document.getElementById(annoId);
      if (el){
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.outline = '3px solid var(--accent)';
        el.style.outlineOffset = '2px';
        el.style.borderRadius = '3px';
        setTimeout(function(){ el.style.outline = ''; el.style.outlineOffset = ''; }, 4000);
      }
    }, 500); }
  }, 100);
  setTimeout(function(){ clearInterval(wait); }, 10000);
})();

// ===== Context menu: note, highlight, favorite, copy-with-source =====
function _closeCtx(){ document.getElementById('ctxMenu').setAttribute('data-open', 'false'); }

function ctxAddNote(){
  _closeCtx();
  if (!ctxSel){ alert('ابتدا متن را انتخاب کنید'); return; }
  var note = prompt('یادداشت شما:');
  if (!note) return;
  var notes = JSON.parse(localStorage.getItem('coreader-notes') || '[]');
  notes.push({ text: ctxSel, note: note, page: curPage, book: BOOK.title, time: Date.now() });
  localStorage.setItem('coreader-notes', JSON.stringify(notes));
  alert('یادداشت ذخیره شد ✓');
}

function ctxHighlight(){
  _closeCtx();
  if (!ctxSel){ alert('ابتدا متن را انتخاب کنید'); return; }
  if (!ctxRange) return;
  var color = prompt('رنگ هایلایت (مثل #ffe08a یا #a5d6a7):', '#ffe08a') || '#ffe08a';
  var span = document.createElement('span');
  span.className = 'user-highlight';
  span.style.cssText = 'background:' + color + ';border-radius:3px;padding:1px 2px;';
  try { ctxRange.surroundContents(span); } catch(e){}
  // Save to localStorage with color
  var hl = JSON.parse(localStorage.getItem('coreader-highlights') || '[]');
  hl.push({ text: ctxSel, page: curPage, book: BOOK.title, color: color, time: Date.now() });
  localStorage.setItem('coreader-highlights', JSON.stringify(hl));
}

function ctxAddFavorite(){
  _closeCtx();
  if (!ctxSel){ alert('ابتدا متن را انتخاب کنید'); return; }
  var color = prompt('رنگ هایلایت (مثل #ffe08a یا #a5d6a7):', '#ffe08a') || '#ffe08a';
  var favs = JSON.parse(localStorage.getItem('coreader-favs') || '[]');
  if (favs.some(function(f){ return f.text === ctxSel && f.book === BOOK.title; })){
    alert('این متن قبلاً اضافه شده است'); return;
  }
  favs.push({ text: ctxSel, page: curPage, book: BOOK.title, author: BOOK.author || '', color: color, time: Date.now() });
  localStorage.setItem('coreader-favs', JSON.stringify(favs));
  alert('به علاقه‌مندی‌ها اضافه شد ⭐');
}

function ctxCopyWithSource(){
  _closeCtx();
  if (!ctxSel){ alert('ابتدا متن را انتخاب کنید'); return; }
  var source = '— «' + BOOK.title + '»، صفحهٔ ' + toFA(curPage);
  var full = ctxSel + '\n' + source;
  navigator.clipboard.writeText(full).then(function(){
    // Brief visual feedback
    var toast = document.createElement('div');
    toast.textContent = 'کپی شد ✓';
    toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:8px 20px;border-radius:8px;z-index:99999;font-size:14px;animation:fade-slide-up .4s ease';
    document.body.appendChild(toast);
    setTimeout(function(){ toast.remove(); }, 1500);
  });
}

// ===== Bookmarks (Feature 4) =====
function ctxBookmark(){
  _closeCtx();
  if (!BOOK) return;
  var bookmarks = JSON.parse(localStorage.getItem('coreader-bookmarks') || '[]');
  var exists = bookmarks.some(function(b){ return b.page === curPage && b.book === BOOK.title; });
  if (exists){ alert('این صفحه قبلاً نشانه شده است'); return; }
  bookmarks.push({ page: curPage, book: BOOK.title, title: BOOK.title, time: Date.now() });
  localStorage.setItem('coreader-bookmarks', JSON.stringify(bookmarks));
  var toast = document.createElement('div');
  toast.textContent = '🔖 نشانه ذخیره شد';
  toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:8px 20px;border-radius:8px;z-index:99999;font-size:14px;animation:fade-slide-up .4s ease';
  document.body.appendChild(toast);
  setTimeout(function(){ toast.remove(); }, 1500);
}

// ===== Export annotations as Markdown (Feature 5) =====
function exportAnnotations(){
  var sections = [];
  var favs = JSON.parse(localStorage.getItem('coreader-favs') || '[]');
  var notes = JSON.parse(localStorage.getItem('coreader-notes') || '[]');
  var highlights = JSON.parse(localStorage.getItem('coreader-highlights') || '[]');
  var bookmarks = JSON.parse(localStorage.getItem('coreader-bookmarks') || '[]');

  sections.push('# خروجی حاشیه‌نویسی‌ها');
  sections.push('');

  if (favs.length){
    sections.push('## ⭐ علاقه‌مندی‌ها');
    sections.push('');
    favs.forEach(function(f){
      sections.push('- **' + (f.book || '') + '** — صفحهٔ ' + toFA(f.page || 1));
      sections.push('  > ' + (f.text || ''));
      if (f.note) sections.push('  📝 ' + f.note);
      sections.push('');
    });
  }

  if (notes.length){
    sections.push('## 🗒️ یادداشت‌ها');
    sections.push('');
    notes.forEach(function(n){
      sections.push('- **' + (n.book || '') + '** — صفحهٔ ' + toFA(n.page || 1));
      sections.push('  > ' + (n.text || ''));
      if (n.note) sections.push('  📝 ' + n.note);
      sections.push('');
    });
  }

  if (highlights.length){
    sections.push('## 🖍️ هایلایت‌ها');
    sections.push('');
    highlights.forEach(function(h){
      sections.push('- **' + (h.book || '') + '** — صفحهٔ ' + toFA(h.page || 1));
      sections.push('  > ' + (h.text || ''));
      sections.push('');
    });
  }

  if (bookmarks.length){
    sections.push('## 🔖 نشانه‌ها');
    sections.push('');
    bookmarks.forEach(function(b){
      sections.push('- **' + (b.book || '') + '** — صفحهٔ ' + toFA(b.page || 1));
      sections.push('');
    });
  }

  if (!sections.length || sections.length <= 1){
    alert('داده‌ای برای خروجی وجود ندارد');
    return;
  }

  var md = sections.join('\n');
  var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'coreader-annotations.md';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===== Favorites / Notes panel =====
function showFavPanel(){
  document.getElementById('favPanel').classList.add('on');
  showFavTab('favs');
}
function showFavTab(tab){
  document.querySelectorAll('.fav-tab').forEach(function(b, i){
    b.classList.toggle('on', (tab === 'favs' && i === 0) || (tab === 'notes' && i === 1) || (tab === 'highlights' && i === 2) || (tab === 'bookmarks' && i === 3));
  });
  var list = document.getElementById('favList');
  var key = tab === 'bookmarks' ? 'coreader-bookmarks' : 'coreader-' + tab;
  var data = JSON.parse(localStorage.getItem(key) || '[]');
  if (!data.length){
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted-foreground,#999)">خالی</div>';
    return;
  }
  list.innerHTML = data.map(function(item, i){
    var meta = (item.book || '') + (item.page ? ' — صفحهٔ ' + toFA(item.page) : '');
    var note = item.note ? '<div style="margin-top:4px;font-size:12px;opacity:.8">📝 ' + item.note + '</div>' : '';
    var colorSwatch = item.color ? '<span style="display:inline-block;width:12px;height:12px;background:' + item.color + ';border-radius:3px;margin-inline-start:4px;vertical-align:middle"></span>' : '';
    var textPreview = (item.text || item.title || '').substring(0, 200) + ((item.text || item.title || '').length > 200 ? '…' : '');
    var timeStr = item.time ? '<span style="margin-inline-start:6px;opacity:.6">' + new Date(item.time).toLocaleDateString('fa') + '</span>' : '';
    return '<div class="fav-item" onclick="goToFav(' + (item.page || 1) + ')">' +
      '<button class="fav-del" onclick="event.stopPropagation();delFav(\'' + tab + '\',' + i + ')">✕</button>' +
      '<div>' + colorSwatch + textPreview + '</div>' +
      note +
      '<div class="fav-meta">' + meta + timeStr + '</div></div>';
  }).join('');
}
function goToFav(page){
  document.getElementById('favPanel').classList.remove('on');
  goPg(page);
}
function delFav(tab, idx){
  var data = JSON.parse(localStorage.getItem('coreader-' + tab) || '[]');
  data.splice(idx, 1);
  localStorage.setItem('coreader-' + tab, JSON.stringify(data));
  showFavTab(tab);
}

// ===== خوانش صوتی (TTS) — reads the page aloud with synced highlight
// Two engines, both free and requiring zero signup/key:
//  - "browser" (default, zero-config): the Web Speech API's
//    speechSynthesis, using native word-boundary events for exact
//    highlighting. Quality depends entirely on whatever Persian voice (if
//    any) the visitor's OS/browser ships — this varies a lot, and many
//    systems have none at all.
//  - "google" (better quality, still free): the public endpoint behind
//    Google Translate's own "listen" button. Unofficial/undocumented —
//    no key, no quota dashboard, no guarantee — so any failure falls
//    back to the browser engine automatically. Its one real constraint
//    is a short per-request text limit, so the page text is split into
//    word-boundary chunks played back to back; word-level sync for this
//    path is a proportional estimate from each chunk's audio playback
//    position (no word-boundary timing is available from a plain audio
//    response), same honest approach as the PDF highlight band.
// ===================================================================
var ttsOn = false, ttsPlaying = false, ttsVoices = [], ttsOffsets = [];
var ttsEngine = 'browser';
var ttsAudio = null;
var ttsStartIdx = 0; // index to start TTS from (for click-to-start)

function toggleTts(){
  if (recording){ document.getElementById('micStatus').textContent = 'ابتدا خط‌بَر را متوقف کنید'; return; }
  ttsOn = !ttsOn;
  document.getElementById('ttsBar').classList.toggle('on', ttsOn);
  document.getElementById('bTts').classList.toggle('on', ttsOn);
  if (!ttsOn) stopTts();
}

function loadTtsSettings(){
  var s = null;
  try { s = JSON.parse(localStorage.getItem('coreader-tts-settings')); } catch (e) {}
  if (s) ttsEngine = s.engine || 'browser';
  document.getElementById('setTtsEngine').value = ttsEngine;
  document.getElementById('googleTtsNote').style.display = ttsEngine === 'google' ? '' : 'none';
}
function saveTtsSettings(){
  localStorage.setItem('coreader-tts-settings', JSON.stringify({ engine: ttsEngine }));
}
function setTtsEngine(v){
  ttsEngine = v;
  document.getElementById('googleTtsNote').style.display = v === 'google' ? '' : 'none';
  saveTtsSettings();
}

function populateTtsVoices(){
  if (!window.speechSynthesis) return;
  var sel = document.getElementById('ttsVoiceSel');
  var voices = window.speechSynthesis.getVoices();
  var fa = voices.filter(function(v){ return v.lang && v.lang.toLowerCase().indexOf('fa') === 0; });
  var list = fa.length ? fa : voices;
  ttsVoices = list;
  sel.innerHTML = list.map(function(v, i){ return '<option value="' + i + '">' + v.name + ' (' + v.lang + ')</option>'; }).join('');
  if (!fa.length && voices.length && ttsEngine === 'browser'){
    document.getElementById('ttsStatus').textContent = 'صدای فارسی در این مرورگر نصب نیست — گزینهٔ Google را در تنظیمات امتحان کنید';
  }
}
if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = populateTtsVoices;

function updateTtsPlayBtn(){ document.getElementById('ttsPlayBtn').textContent = ttsPlaying ? '⏸️' : '▶️'; }

function setTtsRate(v){
  document.getElementById('ttsRateLabel').textContent = (+v).toFixed(1) + '×';
  if (ttsAudio) ttsAudio.playbackRate = +v;
}

function toggleTtsPlay(){
  if (ttsEngine === 'google') toggleTtsPlayGoogle();
  else toggleTtsPlayBrowser();
}

// ---- browser engine ----
function buildTtsTextFromMicWords(startIdx){
  var parts = [], offsets = [], pos = 0;
  var s = startIdx || 0;
  for (var i = s; i < micWords.length; i++){
    var t = micWords[i].el.textContent;
    offsets.push({ start: pos, end: pos + t.length, wordIdx: i });
    parts.push(t);
    pos += t.length + 1;
  }
  return { text: parts.join(' '), offsets: offsets, startIdx: s };
}
function findMicWordIndexForOffset(charIndex){
  for (var i = 0; i < ttsOffsets.length; i++){
    if (charIndex >= ttsOffsets[i].start && charIndex < ttsOffsets[i].end + 1) return ttsOffsets[i].wordIdx || i;
  }
  return -1;
}
function ttsHighlightAndMaybeAnno(idx){
  highlightAt(idx);
  smoothScrollTo(idx);
  var annoEl = findAnnoNear(idx);
  if (annoEl && annoEl !== lastAnnoEl && annoOn){ showMarginAnno(annoEl); lastAnnoEl = annoEl; }
}
function startTtsBrowserForPage(){
  if (!window.speechSynthesis){ document.getElementById('ttsStatus').textContent = 'مرورگر شما از خوانش صوتی پشتیبانی نمی‌کند'; return; }
  buildMicIndex(curPage);
  if (!micWords.length) return;
  var built = buildTtsTextFromMicWords(ttsStartIdx);
  ttsOffsets = built.offsets;
  var utter = new SpeechSynthesisUtterance(built.text);
  var voice = ttsVoices[+document.getElementById('ttsVoiceSel').value] || null;
  if (voice) utter.voice = voice;
  utter.lang = voice ? voice.lang : 'fa-IR';
  utter.rate = +document.getElementById('ttsRate').value || 1;
  utter.onboundary = function(e){
    if (e.name && e.name !== 'word') return;
    var idx = findMicWordIndexForOffset(e.charIndex);
    if (idx >= 0) ttsHighlightAndMaybeAnno(idx);
  };
  utter.onend = function(){
    if (!ttsOn) return;
    if (curPage < BOOK.pages.length){ ttsStartIdx = 0; goPg(curPage + 1); startTtsBrowserForPage(); }
    else { ttsPlaying = false; updateTtsPlayBtn(); document.getElementById('ttsStatus').textContent = 'پایان کتاب'; clearHighlights(); }
  };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
  ttsPlaying = true; updateTtsPlayBtn();
  document.getElementById('ttsStatus').textContent = 'در حال خواندن...';
}
function toggleTtsPlayBrowser(){
  if (!window.speechSynthesis){ document.getElementById('ttsStatus').textContent = 'مرورگر شما از خوانش صوتی پشتیبانی نمی‌کند'; return; }
  if (ttsPlaying){
    window.speechSynthesis.pause();
    ttsPlaying = false; updateTtsPlayBtn();
    document.getElementById('ttsStatus').textContent = 'مکث شد';
  } else if (window.speechSynthesis.paused){
    window.speechSynthesis.resume();
    ttsPlaying = true; updateTtsPlayBtn();
    document.getElementById('ttsStatus').textContent = 'در حال خواندن...';
  } else {
    startTtsBrowserForPage();
  }
}

// ---- Google Translate TTS engine (free, no signup/key needed) ----
// Uses the public (unofficial, undocumented) endpoint behind Google
// Translate's own "listen" button. No official API, no key, no quota
// dashboard — which also means no guarantee: it can be slow, rate-limited,
// or change without notice. Treated accordingly: any failure falls back
// to the always-available browser engine rather than leaving playback
// just stuck. Its one real constraint is a short per-request text limit,
// so the page is split into word-boundary chunks and played back to back.
var GOOGLE_TTS_MAX_CHARS = 190;
function buildGoogleChunks(){
  var chunks = [];
  var curText = '', curStart = ttsStartIdx, curLen = 0;
  for (var i = ttsStartIdx; i < micWords.length; i++){
    var t = micWords[i].el.textContent;
    var addLen = t.length + 1;
    if (curLen && curLen + addLen > GOOGLE_TTS_MAX_CHARS){
      chunks.push({ text: curText, start: curStart, end: i });
      curText = ''; curStart = i; curLen = 0;
    }
    curText += (curText ? ' ' : '') + t;
    curLen += addLen;
  }
  if (curText) chunks.push({ text: curText, start: curStart, end: micWords.length });
  return chunks;
}
function googleTtsUrl(text){
  // Try multiple Google TTS endpoints for reliability
  return 'https://translate.google.com/translate_tts?ie=UTF-8&q=' + encodeURIComponent(text) + '&tl=fa&client=gtx';
}
var googleChunks = [], googleChunkIdx = 0, googleFellBack = false;
function startTtsGoogleForPage(){
  buildMicIndex(curPage);
  if (!micWords.length) return;
  googleChunks = buildGoogleChunks();
  googleChunkIdx = 0;
  document.getElementById('ttsStatus').textContent = 'در حال خواندن... (Google)';
  playGoogleChunk();
}
function playGoogleChunk(){
  if (googleChunkIdx >= googleChunks.length){
    if (!ttsOn) return;
    if (curPage < BOOK.pages.length){ ttsStartIdx = 0; goPg(curPage + 1); startTtsGoogleForPage(); }
    else { ttsPlaying = false; updateTtsPlayBtn(); document.getElementById('ttsStatus').textContent = 'پایان کتاب'; clearHighlights(); }
    return;
  }
  var chunk = googleChunks[googleChunkIdx];
  if (ttsAudio){ try { ttsAudio.pause(); } catch (e) {} }
  ttsAudio = new Audio(googleTtsUrl(chunk.text));
  ttsAudio.playbackRate = +document.getElementById('ttsRate').value || 1;
  ttsAudio.ontimeupdate = function(){
    if (!ttsAudio.duration) return;
    var span = chunk.end - chunk.start;
    var idx = Math.min(chunk.end - 1, chunk.start + Math.floor((ttsAudio.currentTime / ttsAudio.duration) * span));
    ttsHighlightAndMaybeAnno(idx);
  };
  ttsAudio.onended = function(){ googleChunkIdx++; playGoogleChunk(); };
  ttsAudio.onerror = function(){
    if (googleFellBack) return; // avoid a fallback loop
    googleFellBack = true;
    // Try alternative Google TTS endpoint before falling back
    if (!ttsAudio._triedAlt){
      ttsAudio._triedAlt = true;
      ttsAudio.src = 'https://translate.google.com/translate_tts?ie=UTF-8&q=' + encodeURIComponent(chunk.text) + '&tl=fa&client=dict-chrome-ex';
      var p = ttsAudio.play();
      if (p && p.catch) p.catch(function(){ ttsAudio.onerror(); });
      return;
    }
    document.getElementById('ttsStatus').textContent = 'سرویس Google در دسترس نیست — بازگشت به صدای مرورگر';
    ttsEngine = 'browser';
    document.getElementById('setTtsEngine').value = 'browser';
    document.getElementById('googleTtsNote').style.display = 'none';
    saveTtsSettings();
    startTtsBrowserForPage();
  };
  var p = ttsAudio.play();
  if (p && p.catch) p.catch(function(){ ttsAudio.onerror(); });
  ttsPlaying = true; updateTtsPlayBtn();
}
function toggleTtsPlayGoogle(){
  if (ttsPlaying && ttsAudio){
    ttsAudio.pause(); ttsPlaying = false; updateTtsPlayBtn();
    document.getElementById('ttsStatus').textContent = 'مکث شد';
  } else if (ttsAudio && ttsAudio.paused && !ttsAudio.ended){
    ttsAudio.play(); ttsPlaying = true; updateTtsPlayBtn();
    document.getElementById('ttsStatus').textContent = 'در حال خواندن...';
  } else {
    googleFellBack = false;
    startTtsGoogleForPage();
  }
}

function clearHighlights(){
  if (micWords.length){
    micWords.forEach(function(w){ w.el.className = w.isAnno ? 'anno anno-' + (w.el.dataset.cat || 'word') : 'wl'; });
  }
  var sl = document.getElementById('hlSlide');
  if (sl) sl.classList.remove('active');
  hideNeighbors();
}

function stopTts(){
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (ttsAudio){ try { ttsAudio.pause(); } catch (e) {} ttsAudio = null; }
  ttsPlaying = false; ttsStartIdx = 0; _magGroup = -1;
  updateTtsPlayBtn();
  if (micWords.length){
    micWords.forEach(function(w){ w.el.className = w.isAnno ? 'anno anno-' + (w.el.dataset.cat || 'word') : 'wl'; });
  }
  // Clear highlight overlays
  var sl = document.getElementById('hlSlide');
  if (sl) sl.classList.remove('active');
  hideNeighbors();
  document.getElementById('ttsStatus').textContent = 'آماده خوانش...';
  clearMarginAnnos();
}

// ===================================================================
// ===== خط‌بَر (line tracker) — validated engine =====
// ===================================================================
var micOn = false, recording = false, recognition = null;
var micWords = [], micIdx = 0, spokenBuf = [], locked = false, lastAnnoEl = null;
// SpeechRecognition re-emits a changing interim transcript several times
// before it becomes final.  Keep its identity separately: otherwise each
// redraw of the same phrase can move the reader forward again.
var lastInterimKey = '';

function toggleMic(){
  micOn = !micOn;
  document.getElementById('micBar').classList.toggle('on', micOn);
  document.getElementById('bMic').classList.toggle('on', micOn);
  if (!micOn) stopMic();
}

function normW(w){
  var s = w.toLowerCase()
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, '')
    .replace(/ـ/g, '')
    .replace(/[إأآءٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[ئىي]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ةه]/g, 'ه')
    .replace(/[^\u0621-\u06FE0-9a-zA-Z]/g, '');
  s = s.replace(/[ثصس]/g, 'س').replace(/[ذضظز]/g, 'ز').replace(/[طت]/g, 'ت').replace(/[قغ]/g, 'ق').replace(/[حه]/g, 'ه');
  return s;
}
function editDist(a, b){
  if (a === b) return 0;
  var la = a.length, lb = b.length;
  if (!la) return lb; if (!lb) return la;
  var d = []; for (var i = 0; i <= la; i++) d[i] = [i]; for (var j = 0; j <= lb; j++) d[0][j] = j;
  for (var i = 1; i <= la; i++) for (var j = 1; j <= lb; j++){ var c = a[i-1] === b[j-1] ? 0 : 1; d[i][j] = Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+c); }
  return d[la][lb];
}
function wordSim(a, b){ if (!a || !b) return 0; if (a === b) return 1; var m = Math.max(a.length, b.length); if (!m) return 1; return 1 - editDist(a, b) / m; }

function buildMicIndex(pg){
  var pgEl = document.getElementById('pg_' + pg); if (!pgEl) return;
  var txtEl = pgEl.querySelector('.ps-txt'); if (!txtEl) return;
  micWords = []; micIdx = 0; spokenBuf = []; locked = false; lastAnnoEl = null;
  function processNode(node){
    if (node.nodeType === 3){
      var text = node.textContent;
      if (!text.trim()) return;
      var frag = document.createDocumentFragment();
      text.split(/(\s+)/).forEach(function(w){
        if (/^\s+$/.test(w)){ frag.appendChild(document.createTextNode(w)); return; }
        if (!w) return;
        w.split('\u200c').forEach(function(part, pi){
          if (pi > 0) frag.appendChild(document.createTextNode('\u200c'));
          if (!part) return;
          var span = document.createElement('span'); span.className = 'wl'; span.textContent = part;
          frag.appendChild(span);
          var normalized = normW(part);
          if (normalized) micWords.push({ el: span, n: normalized });
        });
      });
      node.parentNode.replaceChild(frag, node);
    } else if (node.nodeType === 1 && node.classList){
      if (node.classList.contains('anno')){
        // Multi-word annotation phrases (e.g. "رضی الله عنه") used to
        // become ONE fused token — normW strips the spaces, so a 3-word
        // spoken phrase had to align against one long merged string,
        // which wordSim scores poorly even for an exact reading. Split
        // per word (same as plain text) so each word aligns on its own;
        // all of them still point at the same `el`, so highlighting and
        // the tooltip trigger still act on the whole phrase as one unit.
        var annoWords = node.textContent.split(/\s+/).filter(Boolean);
        annoWords.forEach(function(aw){
          aw.split('\u200c').forEach(function(part){
            if (!part) return;
            micWords.push({ el: node, n: normW(part), isAnno: true });
          });
        });
      } else {
        Array.from(node.childNodes).forEach(processNode);
      }
    }
  }
  Array.from(txtEl.childNodes).forEach(processNode);
}

var STOPW = {'و':1,'را':1,'به':1,'از':1,'در':1,'كه':1,'که':1,'بر':1,'ان':1,'اين':1,
  'با':1,'تا':1,'بي':1,'بی':1,'هم':1,'يا':1,'چون':1,'است':1,'بود':1,'مر':1,'آن':1};

function alignBuffer(spoken, startFrom, ahead, behind){
  var winStart = Math.max(0, startFrom - (behind || 5));
  var winEnd = Math.min(micWords.length, startFrom + (ahead || 80));
  var page = micWords.slice(winStart, winEnd);
  var n = spoken.length, m = page.length;
  if (!n || !m) return null;
  var H = []; for (var i = 0; i <= n; i++) H[i] = new Array(m + 1).fill(0);
  var best = 0, bi = 0, bj = 0;
  for (var i = 1; i <= n; i++){
    for (var j = 1; j <= m; j++){
      var sw = spoken[i-1], pw = page[j-1].n;
      var sim = wordSim(sw, pw);
      var isStop = STOPW[sw] || STOPW[pw];
      var sub;
      if (sim >= 0.75) sub = isStop ? 0.5 : 2;
      else if (sim >= 0.4) sub = isStop ? 0.2 : 1;
      else sub = -1;
      var v = Math.max(0, H[i-1][j-1] + sub, H[i-1][j] - 1, H[i][j-1] - 1);
      H[i][j] = v;
      if (v > best){ best = v; bi = i; bj = j; }
    }
  }
  if (best <= 0) return null;
  return { pageIndex: winStart + bj - 1, matchedSpoken: bi, score: best };
}

function tryAdvance(buf, live, wide){
  var micIdxBefore = micIdx;
  if (!micWords.length || !buf.length) return { moved: false, res: null, micIdxBefore: micIdxBefore, micIdxAfter: micIdx, curWord: null };
  // Adaptive recovery: after several consecutive final chunks fail to
  // advance (reader skipped a paragraph, long noise, a page-turn overlap,
  // etc.), widen the search window a lot for one attempt instead of
  // staying stuck in the normal, narrower window forever.
  var ahead = live ? 15 : (wide ? 220 : 60), behind = live ? 2 : (wide ? 25 : 10);
  var res = alignBuffer(buf, micIdx, ahead, behind);
  var distinctive = buf.filter(function(w){ return !STOPW[w]; }).length;
  var minConf = live ? 2 : Math.max(2, Math.ceil(buf.length * 0.3));
  var ratio = live ? 0.3 : (wide ? 0.85 : 0.7);
  var pass = res && distinctive > 0 && res.matchedSpoken >= minConf &&
    res.score >= res.matchedSpoken * ratio && res.pageIndex >= micIdx;
  if (!pass) return { moved: false, res: res, micIdxBefore: micIdxBefore, micIdxAfter: micIdx, minConf: minConf, ratio: ratio, curWord: null };
  micIdx = Math.min(res.pageIndex + 1, micWords.length);
  locked = true;
  highlightAt(micIdx - 1);
  smoothScrollTo(micIdx - 1);
  syncPdfHighlight();
  var curWordText = micWords[micIdx - 1] ? micWords[micIdx - 1].el.textContent : null;
  var annoEl = findAnnoNear(micIdx - 1);
  if (annoEl){ if (annoEl !== lastAnnoEl && annoOn){ showMarginAnno(annoEl); lastAnnoEl = annoEl; } }
  else { lastAnnoEl = null; }
  var out = { moved: true, res: res, micIdxBefore: micIdxBefore, micIdxAfter: micIdx, minConf: minConf, ratio: ratio, curWord: curWordText };
  if (micIdx >= micWords.length && micWords.length > 0){
    if (curPage < BOOK.pages.length){ goPg(curPage + 1); buildMicIndex(curPage); syncPdfHighlight(); }
    else { document.getElementById('micStatus').textContent = 'پایان کتاب!'; stopMic(); }
  }
  return out;
}

var micLevel = 0;
function updateMicLevel(){
  // If we have a real mic stream, read volume from an AnalyserNode
  if (micStream){
    try {
      if (!updateMicLevel._actx){
        var ac = new (window.AudioContext || window.webkitAudioContext)();
        var src = ac.createMediaStreamSource(micStream);
        var an = ac.createAnalyser(); an.fftSize = 256;
        src.connect(an);
        updateMicLevel._actx = ac; updateMicLevel._an = an;
      }
      var an = updateMicLevel._an;
      var buf = new Uint8Array(an.fftSize);
      an.getByteTimeDomainData(buf);
      var sum = 0;
      for (var i = 0; i < buf.length; i++){ var v = (buf[i] - 128) / 128; sum += v * v; }
      micLevel = Math.min(1, Math.sqrt(sum / buf.length) * 3);
    } catch(e){ micLevel = 0; }
  } else {
    // Simulated: inverse of missStreak — active speaking = high level
    micLevel = missStreak <= 1 ? 0.7 : missStreak <= 3 ? 0.4 : 0.15;
  }
  document.documentElement.style.setProperty('--mic-level', micLevel);
}
function highlightAt(idx){
  // Multiple micWords entries can share the same .el (a multi-word
  // annotation phrase is now split per-word for alignment — see
  // buildMicIndex). Group by element so a phrase doesn't flicker between
  // highlighted/unhighlighted as the loop passes its other word-entries.
  var hlEl = (idx >= 0 && idx < micWords.length) ? micWords[idx].el : null;
  var prevEl = (idx > 0 && idx < micWords.length) ? micWords[idx - 1].el : null;
  var nextEl = (idx >= 0 && idx + 1 < micWords.length) ? micWords[idx + 1].el : null;
  var seen = new Set();
  for (var i = 0; i < micWords.length; i++){
    var w = micWords[i];
    if (seen.has(w.el)) continue;
    seen.add(w.el);
    if (w.el === hlEl) w.el.className = w.isAnno ? 'anno anno-highlight' : 'wl wl-yellow';
    else if (!w.isAnno && prevEl && w.el === prevEl) w.el.className = 'wl wl-yellow-prev';
    else if (!w.isAnno && nextEl && w.el === nextEl) w.el.className = 'wl wl-yellow-next';
    else w.el.className = w.isAnno ? 'anno anno-' + (w.el.dataset.cat || 'word') : 'wl';
  }

  // Smooth sliding highlight overlay
  var slide = document.getElementById('hlSlide');
  if (slide && hlEl){
    var r = hlEl.getBoundingClientRect();
    var pad = 4;
    slide.style.top = (r.top - pad) + 'px';
    slide.style.left = (r.left - pad) + 'px';
    slide.style.width = (r.width + pad * 2) + 'px';
    slide.style.height = (r.height + pad * 2) + 'px';
    slide.classList.add('active');
    // Neighbor overlays
    slideNeighborhood(hlEl, prevEl, nextEl);
  } else if (slide) {
    slide.classList.remove('active');
    hideNeighbors();
  }

  if (magAutoFollow && magOn && hlEl && (recording || ttsPlaying)){
    followMagnifier(hlEl);
  }
}

// Render magnified content at a specific page coordinate (without moving the lens)
function _renderMagAt(pageX, pageY){
  var tc = document.querySelector('.tc');
  if (!tc) return;
  var tcRect = tc.getBoundingClientRect();
  renderMagnifierSource(pageX - tcRect.left, pageY - tcRect.top);
}

// Neighbor highlight overlays (prev/next words — fainter)
var _nbrPrev = null, _nbrNext = null;
function getOrCreateNeighbor(id){
  var el = document.getElementById(id);
  if (!el){
    el = document.createElement('div');
    el.id = id;
    el.className = 'hl-slide-neighbor';
    document.body.appendChild(el);
  }
  return el;
}
function positionNeighbor(el, targetEl){
  if (!targetEl){ el.classList.remove('active'); return; }
  var r = targetEl.getBoundingClientRect();
  var pad = 2;
  el.style.top = (r.top - pad) + 'px';
  el.style.left = (r.left - pad) + 'px';
  el.style.width = (r.width + pad * 2) + 'px';
  el.style.height = (r.height + pad * 2) + 'px';
  el.classList.add('active');
}
function slideNeighborhood(hlEl, prevEl, nextEl){
  if (!_nbrPrev) _nbrPrev = getOrCreateNeighbor('hlNbrPrev');
  if (!_nbrNext) _nbrNext = getOrCreateNeighbor('hlNbrNext');
  positionNeighbor(_nbrPrev, prevEl);
  positionNeighbor(_nbrNext, nextEl);
}
function hideNeighbors(){
  if (_nbrPrev) _nbrPrev.classList.remove('active');
  if (_nbrNext) _nbrNext.classList.remove('active');
}
function findAnnoNear(idx){
  if (idx < 0 || idx >= micWords.length) return null;
  for (var off = 0; off <= 3; off++){
    for (var d = -off; d <= off; d += (off === 0 ? 1 : 2 * off)){
      var check = idx + d;
      if (check < 0 || check >= micWords.length) continue;
      var w = micWords[check];
      if (w.isAnno) return w.el;
    }
  }
  return null;
}
function smoothScrollTo(idx){
  if (idx < 0 || idx >= micWords.length) return;
  var el = micWords[idx].el;
  var rect = el.getBoundingClientRect(); var vpH = window.innerHeight;
  if (rect.top > vpH * 0.2 && rect.bottom < vpH * 0.8) return;
  if (rect.top > vpH * 0.8) window.scrollBy({ top: vpH * 0.5, behavior: 'smooth' });
  if (rect.bottom < vpH * 0.2) window.scrollBy({ top: -vpH * 0.5, behavior: 'smooth' });
}

// ---- session logging (for further tuning) ----
var sessionLog = [], sessionT0 = 0, mediaRecorder = null, audioChunks = [], micStream = null;
function logEvt(o){ o.t = Math.round(performance.now() - sessionT0); sessionLog.push(o); }
function startSessionLogging(){
  sessionLog = []; sessionT0 = performance.now(); audioChunks = [];
  document.getElementById('dlLog').style.display = 'none';
  document.getElementById('dlAudio').style.display = 'none';
  logEvt({ type: 'start', page: curPage, pageWords: micWords.map(function(w){ return w.el.textContent; }),
    pageWordsNorm: micWords.map(function(w){ return w.n; }),
    annoIdx: micWords.map(function(w, i){ return w.isAnno ? i : null; }).filter(function(x){ return x !== null; }),
    ua: navigator.userAgent });
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream){
      micStream = stream;
      var mime = ''; try { if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus'; } catch (e) {}
      mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorder.ondataavailable = function(e){ if (e.data && e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.start(1000);
    }).catch(function(err){
      logEvt({ type: 'audio-error', err: String(err) });
      // Show error to user so they know mic recording failed
      document.getElementById('micStatus').textContent = 'خطای میکروفون: ' + (err.message || err) + ' — خط‌بر بدون ضبط صدا ادامه می‌یابد';
    });
  }
}
function stopSessionLogging(){
  if (!sessionLog.length) return;
  logEvt({ type: 'stop', micIdx: micIdx, total: micWords.length });
  if (mediaRecorder && mediaRecorder.state !== 'inactive'){
    mediaRecorder.onstop = function(){
      var blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      var url = URL.createObjectURL(blob);
      var a = document.getElementById('dlAudio'); a.href = url; a.download = 'session_audio.webm'; a.style.display = '';
    };
    try { mediaRecorder.stop(); } catch (e) {}
  }
  if (micStream){ micStream.getTracks().forEach(function(t){ t.stop(); }); micStream = null; }
  var jb = new Blob([JSON.stringify(sessionLog, null, 1)], { type: 'application/json' });
  var jurl = URL.createObjectURL(jb);
  var b = document.getElementById('dlLog'); b.href = jurl; b.download = 'session_log.json'; b.style.display = '';
}

var missStreak = 0;
function processFinal(text){
  var words = text.split(/\s+/).filter(function(w){ return w.length > 0; }).map(normW).filter(Boolean);
  if (!words.length) return;
  var overlap = 0;
  for (var k = Math.min(spokenBuf.length, words.length); k > 0; k--){
    var same = true;
    for (var q = 0; q < k; q++){
      if (spokenBuf[spokenBuf.length - k + q] !== words[q]){ same = false; break; }
    }
    if (same){ overlap = k; break; }
  }
  words = words.slice(overlap);
  lastInterimKey = '';
  if (!words.length) return;
  spokenBuf = spokenBuf.concat(words).slice(-16);
  var wide = missStreak >= 3;
  var r = tryAdvance(spokenBuf, false, wide);
  missStreak = r.moved ? 0 : missStreak + 1;
  logEvt({ type: 'final', raw: text, norm: words, bufLen: spokenBuf.length, res: r.res, moved: r.moved, wide: wide,
    micIdxBefore: r.micIdxBefore, micIdxAfter: r.micIdxAfter, curWord: r.curWord, minConf: r.minConf, ratio: r.ratio });
  var pct = Math.round(micIdx / (micWords.length || 1) * 100);
  var latest = text.split(/\s+/).slice(-4).join(' ');
  var hint = r.moved ? '' : (wide ? ' … (جست‌وجوی گسترده)' : ' …');
  document.getElementById('micStatus').textContent = toFA(pct) + '٪ ← ' + latest + hint;
  updateMicLevel();
}
function processInterim(text){
  var words = text.split(/\s+/).filter(function(w){ return w.length > 0; }).map(normW).filter(Boolean);
  if (!words.length) return;
  var interimKey = words.join(' ');
  if (interimKey === lastInterimKey) return;
  lastInterimKey = interimKey;
  var tempBuf = spokenBuf.concat(words).slice(-16);
  var r = tryAdvance(tempBuf, true, false);
  logEvt({ type: 'interim', raw: text, norm: words, bufLen: tempBuf.length, live: locked, res: r.res, moved: r.moved,
    micIdxBefore: r.micIdxBefore, micIdxAfter: r.micIdxAfter, curWord: r.curWord, minConf: r.minConf, ratio: r.ratio });
  var pct = Math.round(micIdx / (micWords.length || 1) * 100);
  var latest = text.split(/\s+/).slice(-4).join(' ');
  document.getElementById('micStatus').textContent = (r.moved ? toFA(pct) + '٪ ← ' : '...') + latest;
  updateMicLevel();
}

function toggleRecording(){
  if (recording){ stopMic(); return; }
  if (ttsPlaying || ttsOn){ document.getElementById('micStatus').textContent = 'ابتدا خوانش صوتی را متوقف کنید'; return; }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'){
    document.getElementById('micStatus').textContent = 'نیاز به HTTPS یا localhost'; return;
  }
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR){ document.getElementById('micStatus').textContent = 'مرورگر پشتیبانی نمی‌کند (از Chrome استفاده کنید)'; return; }
  buildMicIndex(curPage);
  if (!micWords.length){ document.getElementById('micStatus').textContent = 'خطا در آماده‌سازی صفحه'; return; }
  recording = true; spokenBuf = []; locked = false; lastAnnoEl = null; lastInterimKey = '';
  lastResultTime = Date.now(); restartAttempts = 0;
  startSessionLogging();
  document.getElementById('micBtn').classList.add('recording');
  document.getElementById('micStatus').textContent = 'در حال گوش دادن...';
  startRecognitionEngine();
  startWatchdog();
}

// Chrome's continuous recognition is known to silently die sometimes
// (no onend fires, no onerror fires — it just stops delivering results)
// or to throw "already started" from onend's restart race. Previously
// that error was swallowed and the mic bar was left showing "recording"
// with a fully dead engine underneath, indistinguishable from it working
// — the most likely explanation for reports that خط‌بَر "doesn't work".
// Fix: build the recognition object in one place so both the initial
// start and every restart go through identical, defended logic, and add
// a watchdog that notices when results stop arriving and forces a real
// restart instead of trusting the browser's own recovery.
var lastResultTime = 0, restartAttempts = 0, watchdogTimer = null;
function startRecognitionEngine(){
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (recognition){ try { recognition.onend = null; recognition.abort(); } catch (x) {} }
  recognition = new SR();
  recognition.lang = 'fa-IR'; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
  recognition.onresult = function(e){
    lastResultTime = Date.now(); restartAttempts = 0;
    var final = '', interim = '';
    for (var i = e.resultIndex; i < e.results.length; i++){
      if (e.results[i].isFinal) final += e.results[i][0].transcript + ' ';
      else interim += e.results[i][0].transcript;
    }
    if (final.trim()) processFinal(final.trim());
    if (interim.trim()) processInterim(interim.trim());
  };
  recognition.onerror = function(e){
    if (e.error === 'not-allowed'){ document.getElementById('micStatus').textContent = 'اجازه میکروفون داده نشد'; stopMic(); return; }
    if (e.error !== 'no-speech' && e.error !== 'aborted') document.getElementById('micStatus').textContent = 'خطا: ' + e.error + ' — تلاش دوباره...';
  };
  recognition.onend = function(){
    if (!recording) return;
    // A short delay avoids the common "recognition has already started"
    // race when the browser fires onend and we restart in the same tick.
    setTimeout(function(){
      if (!recording) return;
      restartAttempts++;
      if (restartAttempts > 5){
        document.getElementById('micStatus').textContent = 'موتور تشخیص گفتار قطع شد — دوباره روی 🎤 بزنید';
        stopMic();
        return;
      }
      startRecognitionEngine();
    }, 250);
  };
  try { recognition.start(); lastResultTime = Date.now(); }
  catch (x) { /* likely "already started" from a fast repeat call — the watchdog will catch a truly dead engine */ }
}
function startWatchdog(){
  clearInterval(watchdogTimer);
  watchdogTimer = setInterval(function(){
    if (!recording){ clearInterval(watchdogTimer); return; }
    // 10s with zero results while actively recording almost always means
    // the engine died silently — force a real restart rather than wait.
    if (Date.now() - lastResultTime > 10000){
      document.getElementById('micStatus').textContent = 'اتصال قطع شد، در حال اتصال دوباره...';
      startRecognitionEngine();
      lastResultTime = Date.now();
    }
  }, 4000);
}
function stopMic(){
  recording = false; _magGroup = -1;
  clearInterval(watchdogTimer);
  stopSessionLogging();
  if (recognition){ try { recognition.abort(); } catch (x) {} recognition = null; }
  document.getElementById('micBtn').classList.remove('recording');
  document.getElementById('micStatus').textContent = 'آماده خط‌بَر...';
  micWords.forEach(function(w){ w.el.className = w.isAnno ? 'anno anno-' + (w.el.dataset.cat || 'word') : 'wl'; });
  // Clear highlight overlays
  var sl = document.getElementById('hlSlide');
  if (sl) sl.classList.remove('active');
  hideNeighbors();
  micWords = []; micIdx = 0; spokenBuf = []; locked = false; lastAnnoEl = null; missStreak = 0; lastInterimKey = '';
  clearMarginAnnos();
  var pdfHl = document.getElementById('pdfHl'); if (pdfHl) pdfHl.style.display = 'none';
}

// Manual resync: click any word to jump tracker there — works for both
// خط‌بَر (recording) and خوانش (TTS) modes.
document.addEventListener('click', function(e){
  if (!recording && !ttsPlaying) return;
  var el = e.target.closest && e.target.closest('.wl,.anno');
  if (!el) return;
  var idx = -1;
  for (var i = 0; i < micWords.length; i++){ if (micWords[i].el === el){ idx = i; break; } }
  if (idx < 0) return;
  e.preventDefault();

  if (recording){
    micIdx = idx + 1;
    spokenBuf = []; locked = true; missStreak = 0;
    highlightAt(idx);
    smoothScrollTo(idx);
    syncPdfHighlight();
    document.getElementById('micStatus').textContent = 'موقعیت به‌صورت دستی تنظیم شد ✓';
  } else if (ttsPlaying){
    // TTS click-to-start: restart reading from clicked word
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (ttsAudio){ try { ttsAudio.pause(); } catch(e){} ttsAudio = null; }
    ttsPlaying = false;
    ttsStartIdx = idx;
    smoothScrollTo(idx);
    updateTtsPlayBtn();
    // Clear highlight overlays
    var sl = document.getElementById('hlSlide');
    if (sl) sl.classList.remove('active');
    hideNeighbors();
    // Restart TTS from clicked word
    if (ttsEngine === 'google'){
      googleFellBack = false;
      startTtsGoogleForPage();
    } else {
      startTtsBrowserForPage();
    }
  }
});

// ===== Toolbar toggle =====
var toolbarVisible = true;
function toggleToolbar(){
  toolbarVisible = !toolbarVisible;
  var tb = document.getElementById('toolbar');
  var btn = document.getElementById('toolbarToggle');
  tb.classList.toggle('hide', !toolbarVisible);
  btn.classList.toggle('active', toolbarVisible);
  btn.textContent = toolbarVisible ? '✕' : '☰';
}

// ===== Magnifier (ذره‌بین) — DOM-clone + CSS transform approach =====
var magOn = false, magDragging = false, magOffX = 0, magOffY = 0;
var MAG_W = 1600, MAG_H = 461, MAG_SCALE = 2;
var magAutoFollow = false; // follow current word during TTS/خط‌بَر
var _magGroup = -1; // last 3-line group the magnifier was positioned for
var magClone = null, magCloneSrc = '', magHandleDownHandler = null, magMouseUpHandler = null;

function toggleMagnifier(){
  magOn = !magOn;
  document.getElementById('magnifier').classList.toggle('on', magOn);
  document.getElementById('bMag').classList.toggle('on', magOn);
  if (magOn) startMagnifier(); else stopMagnifier();
}

function startMagnifier(){
  var mag = document.getElementById('magnifier');
  var lens = document.getElementById('magLens');
  _magGroup = -1; // reset group tracking

  // Apply dynamic size from settings
  lens.style.width = MAG_W + 'px';
  lens.style.height = MAG_H + 'px';

  // Style the lens for CSS-based magnification
  lens.style.overflow = 'hidden';
  lens.style.position = 'relative';
  lens.innerHTML = '';

  // Create magnified content container
  var content = document.createElement('div');
  content.id = 'magContent';
  content.style.cssText = 'position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none;width:'+document.querySelector('.tc').offsetWidth+'px;';
  lens.appendChild(content);

  // Position lens at bottom of screen initially
  mag.style.left = Math.max(10, (window.innerWidth - MAG_W) / 2) + 'px';
  mag.style.top = (window.innerHeight - MAG_H - 10) + 'px';

  var handle = document.getElementById('magHandle');
  magHandleDownHandler = function(e){
    if (magAutoFollow && (recording || ttsPlaying)) return;
    magDragging = true;
    var r = mag.getBoundingClientRect();
    magOffX = e.clientX - r.left;
    magOffY = e.clientY - r.top;
    e.preventDefault();
  };
  handle.addEventListener('mousedown', magHandleDownHandler);
  document.addEventListener('mousemove', magMoveHandler);
  magMouseUpHandler = function(){ magDragging = false; };
  document.addEventListener('mouseup', magMouseUpHandler);

  // Initial clone
  updateMagClone();
}

function updateMagClone(){
  var content = document.getElementById('magContent');
  if (!content) return;
  var tc = document.querySelector('.tc');
  if (!tc) return;

  // Clone the full text column content (includes annotations, images, everything)
  var html = tc.innerHTML;
  if (html !== magCloneSrc){
    magCloneSrc = html;
    content.innerHTML = html;
  }
  var cs = getComputedStyle(tc);
  content.style.fontFamily = cs.fontFamily;
  content.style.fontSize = cs.fontSize;
  content.style.lineHeight = cs.lineHeight;
  content.style.fontWeight = cs.fontWeight;
  content.style.direction = cs.direction;
  content.style.textAlign = cs.textAlign;
  content.style.color = cs.color;
  content.style.boxSizing = cs.boxSizing;
  content.style.padding = cs.padding;
  content.style.width = tc.offsetWidth + 'px';
}

var magMoveRAF = 0;
function magMoveHandler(e){
  if (!magOn) return;
  if (magAutoFollow && (recording || ttsPlaying)) return; // locked during auto-follow
  if (magDragging){
    var mag = document.getElementById('magnifier');
    mag.style.left = (e.clientX - magOffX) + 'px';
    mag.style.top = (e.clientY - magOffY) + 'px';
    return;
  }

  // Throttle to animation frame
  if (magMoveRAF) return;
  magMoveRAF = requestAnimationFrame(function(){
    magMoveRAF = 0;
    moveMagLens(e.clientX, e.clientY);
  });
}

function followMagnifier(target){
  var mag = document.getElementById('magnifier');
  var tc = document.querySelector('.tc');
  if (!mag || !tc) return;
  var targetRect = target.getBoundingClientRect();
  var tcRect = tc.getBoundingClientRect();
  var srcX = targetRect.left - tcRect.left + targetRect.width / 2;
  var srcY = targetRect.top - tcRect.top + targetRect.height / 2;
  mag.style.left = Math.max(10, (window.innerWidth - MAG_W) / 2) + 'px';
  mag.style.top = Math.max(10, window.innerHeight - MAG_H - 10) + 'px';
  renderMagnifierSource(srcX, srcY);
  var lineHeight = parseFloat(getComputedStyle(tc).lineHeight) || 48;
  var groupIdx = Math.floor(srcY / lineHeight / 3);
  if (groupIdx === _magGroup) return;
  _magGroup = groupIdx;
  var visibleCenter = Math.max(80, (window.innerHeight - MAG_H - 10) / 2);
  var targetScroll = window.scrollY + targetRect.top + targetRect.height / 2 - visibleCenter;
  window.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
}

function moveMagLens(cx, cy){
  var mag = document.getElementById('magnifier');
  var content = document.getElementById('magContent');
  if (!content) return;

  // Position lens below cursor
  mag.style.left = Math.max(0, Math.min(window.innerWidth - MAG_W, cx - MAG_W / 2)) + 'px';
  mag.style.top = (cy + 30) + 'px';

  // Refresh clone if content changed
  updateMagClone();

  // Get cursor position relative to text column
  var tc = document.querySelector('.tc');
  if (!tc) return;
  var tcRect = tc.getBoundingClientRect();

  // Source region (what's under cursor in original)
  var srcX = cx - tcRect.left;
  var srcY = cy - tcRect.top;

  renderMagnifierSource(srcX, srcY);
}

function renderMagnifierSource(srcX, srcY){
  var content = document.getElementById('magContent');
  if (!content) return;
  updateMagClone();
  content.style.transform = 'scale(' + MAG_SCALE + ')';
  content.style.left = (MAG_W / 2 - srcX * MAG_SCALE) + 'px';
  content.style.top = (MAG_H / 2 - srcY * MAG_SCALE) + 'px';
}

// Smooth version for auto-follow — same logic, CSS transition handles animation
function moveMagLensSmooth(cx, cy){
  moveMagLens(cx, cy);
}

function stopMagnifier(){
  document.removeEventListener('mousemove', magMoveHandler);
  if (magMouseUpHandler) document.removeEventListener('mouseup', magMouseUpHandler);
  var handle = document.getElementById('magHandle');
  if (handle && magHandleDownHandler) handle.removeEventListener('mousedown', magHandleDownHandler);
  magMouseUpHandler = null;
  magHandleDownHandler = null;
  if (magMoveRAF){ cancelAnimationFrame(magMoveRAF); magMoveRAF = 0; }
  magDragging = false;
  magCloneSrc = '';
}

// Expose the handful of functions referenced from inline HTML onclick attrs
window.goPg = goPg; window.toggleSidebar = toggleSidebar; window.toggleAnno = toggleAnno;
window.searchBook = searchBook; window.openPdfAt = openPdfAt; window.showMode = showMode;
window.closePdf = closePdf; window.pdfNav = pdfNav; window.pdfZoom = pdfZoom; window.pdfGoto = pdfGoto;
window.switchPdfSource = switchPdfSource;
window.toggleMic = toggleMic; window.toggleRecording = toggleRecording;
window.getCurPage = function(){ return curPage; };
window.openSettings = openSettings; window.closeSettings = closeSettings;
window.applySetting = applySetting; window.setTheme = setTheme;
window.ctxAddAnno = ctxAddAnno; window.ctxEditAnno = ctxEditAnno; window.ctxDeleteAnno = ctxDeleteAnno;
window.ctxEditText = ctxEditText; window.ctxToggleTashkil = ctxToggleTashkil; window.applyEditStyle = applyEditStyle;
window.toggleTashkilBar = toggleTashkilBar; window.insertTashkil = insertTashkil;
window.doEncSearch = doEncSearch; window.closeEncPanel = closeEncPanel; window.ctxSearchEnc = ctxSearchEnc;
window.ctxAddNote = ctxAddNote; window.ctxHighlight = ctxHighlight; window.ctxAddFavorite = ctxAddFavorite; window.ctxCopyWithSource = ctxCopyWithSource;
window.ctxBookmark = ctxBookmark; window.exportAnnotations = exportAnnotations;
window.ctxShareAnno = ctxShareAnno;
window.showFavPanel = showFavPanel; window.showFavTab = showFavTab; window.delFav = delFav; window.goToFav = goToFav;
window.exportAnnotationsPdf = exportAnnotationsPdf;
window.exportLocalData = exportLocalData; window.importLocalData = importLocalData;
window.toggleTts = toggleTts; window.toggleTtsPlay = toggleTtsPlay; window.setTtsRate = setTtsRate;
window.setTtsEngine = setTtsEngine; window.toggleTtsPlayGoogle = toggleTtsPlayGoogle;
window.toggleMagnifier = toggleMagnifier;
window.toggleToolbar = toggleToolbar;
})();
