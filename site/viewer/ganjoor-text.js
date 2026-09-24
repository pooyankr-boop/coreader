// ganjoor-text.js — Ganjoor text for IIIF viewer
// All UI text in Persian (Farsi)
var _ganjoor = null, _gPageMap = {}, _gPageLines = {}, _gFolios = [];
var _gSpeaking = false, _gMicActive = false, _gFlatLine = -1, _gReadingActive = false, _gLastMode = 'tts';
var _gGRecognition = null, _gKeepalive = null;
var _gCh = 0, _gPoem = 0;

// Scroll helper: only scroll within .sp-content, never bubble to body
function scrollInPanel(el, block) {
  if (!el) return;
  var c = document.querySelector('.sp-content');
  if (!c) { el.scrollIntoView({ behavior: 'smooth', block: block || 'center' }); return; }
  var top = el.offsetTop;
  var p = el.offsetParent;
  while (p && p !== c) { top += p.offsetTop; p = p.offsetParent; }
  var target = block === 'start' ? top - 4 : top - c.clientHeight / 2 + el.clientHeight / 2;
  c.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

// ── Load Ganjoor JSON ──
function loadGanjoorText(slug, cb) {
  var url = '../books/' + encodeURIComponent(slug) + '/ganjoor_golestan.json?_=' + Date.now();
  fetch(url).then(function(r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(d) {
    _ganjoor = d;
    _gFlatLine = 0;
    _gCh = 0;
    _gPoem = 0;
    buildPageMap();
    console.log('[ganjoor] loaded', d.length, 'chapters');
    if (cb) cb();
  }).catch(function(e) {
    console.log('[ganjoor] no text:', e.message || e);
    _ganjoor = null;
    if (cb) cb();
  });
}

// ── Flat index helpers ──
function flatIndex(ch, poem, line) {
  var fi = 0;
  for (var ci = 0; ci < ch; ci++)
    _ganjoor[ci].poems.forEach(function(p) { fi += p.lines.length; });
  if (poem > 0)
    fi += _ganjoor[ch].poems.slice(0, poem).reduce(function(s, p) { return s + p.lines.length; }, 0);
  return fi + line;
}
function flatTotal() {
  return _ganjoor.reduce(function(s, ch) {
    return s + ch.poems.reduce(function(s2, p) { return s2 + p.lines.length; }, 0);
  }, 0);
}
function flatToLoc(fi) {
  var acc = 0;
  for (var ci = 0; ci < _ganjoor.length; ci++)
    for (var pi = 0; pi < _ganjoor[ci].poems.length; pi++) {
      var len = _ganjoor[ci].poems[pi].lines.length;
      if (acc + len > fi) return { ch: ci, poem: pi, line: fi - acc };
      acc += len;
    }
  return { ch: 0, poem: 0, line: 0 };
}

// ── Page Mapping (BSB folio-aware, chapter-proportional) ──
function buildPageMap() {
  _gPageMap = {}; _gPageLines = {}; _gFolios = [];
  if (!_ganjoor) return;
  var total = flatTotal();
  if (!total) return;
  var items = (typeof BOOK !== 'undefined' && window.BOOK && window.BOOK.items) ? window.BOOK.items : [];
  if (items.length) {
    items.forEach(function(item, i) {
      var label = item.label || '';
      if (/^Vorderdeckel|Spiegel|Hinterdeckel|Rückdeckel|Rückwärtiger/i.test(label)) return;
      _gFolios.push({ idx: i, page: i + 1, label: label });
    });
  }
  if (!_gFolios.length) {
    var count = items.length || 355;
    for (var i = 0; i < count; i++)
      _gFolios.push({ idx: i, page: i + 1, label: '' });
  }
  var numFolios = _gFolios.length;
  // Chapter-proportional distribution
  var chStart = 0;
  _ganjoor.forEach(function(ch, ci) {
    var chLines = ch.poems.reduce(function(s, p) { return s + p.lines.length; }, 0);
    var chStartFolio = Math.floor(chStart * numFolios / total);
    var chEndFolio = Math.floor((chStart + chLines) * numFolios / total);
    for (var fi = chStart; fi < chStart + chLines; fi++) {
      var relIdx = fi - chStart;
      var folioIdx = chLines > 1 ?
        Math.min(chStartFolio + Math.floor(relIdx * (chEndFolio - chStartFolio + 1) / chLines), numFolios - 1) :
        chStartFolio;
      var pg = _gFolios[folioIdx].page;
      _gPageMap[fi] = pg;
      if (!_gPageLines[pg]) _gPageLines[pg] = [];
      _gPageLines[pg].push(fi);
    }
    chStart += chLines;
  });
}
function findPageForLine(fi) { return _gPageMap[fi] || 1; }
function getLinesForPage(pg) { return _gPageLines[pg] || null; }

// ── Render text with chapter/poem navigation ──
function renderGanjoorText() {
  var el = document.getElementById('textContent');
  if (!el || !_ganjoor || !_ganjoor.length) return;
  if (!_gFolios.length && window.BOOK && window.BOOK.items && window.BOOK.items.length)
    buildPageMap();

  var h = '';
  // Chapter navigation buttons (scroll to section)
  h += '<div class="g-chapters">';
  _ganjoor.forEach(function(ch, ci) {
    h += '<button class="g-ch-btn' + (ci === _gCh ? ' on' : '') +
      '" onclick="scrollGChapter(' + ci + ')">' + ch.chapter + '</button>';
  });
  h += '</div>';

  // Full reading box with ALL text
  h += '<div class="g-reading-box">';
  var flatIdx = 0;
  _ganjoor.forEach(function(ch, ci) {
    h += '<div class="g-chapter-section" id="g-ch-' + ci + '">';
    h += '<div class="g-chapter-heading">' + ch.chapter + '</div>';
    ch.poems.forEach(function(poem, pi) {
      h += '<div class="g-poem-section" id="g-po-' + ci + '-' + pi + '">';
      if (poem.title) h += '<div class="g-poem-title">' + poem.title + '</div>';
      poem.lines.forEach(function(line) {
        var cls = 'g-line';
        if (flatIdx === _gFlatLine) cls += ' active';
        h += '<div class="' + cls + '" data-flat="' + flatIdx +
          '" onclick="onGLineClick(' + flatIdx + ')">' + wrapWords(line) + '</div>';
        flatIdx++;
      });
      h += '</div>';
    });
    h += '</div>';
  });
  h += '</div>';

  el.innerHTML = h;
  // Scroll to active line
  var active = el.querySelector('.g-line.active');
  if (active) scrollInPanel(active);
  showGanjoorButtons();
  updateBottomBarState();
}

function wrapWords(text) {
  return text.split(/(\s+)/).map(function(w) {
    if (/^\s+$/.test(w)) return w;
    return '<span class="g-word">' + w + '</span>';
  }).join('');
}

// ── Chapter/Poem navigation (scroll to section) ──
function scrollGChapter(ci) {
  _gCh = ci; _gPoem = 0;
  var sec = document.getElementById('g-ch-' + ci);
  if (sec) scrollInPanel(sec, "start");
}
function switchGChapter(ci) {
  _gCh = ci;
  _gPoem = 0;
  _gFlatLine = flatIndex(ci, 0, 0);
  highlightActiveLine(_gFlatLine);
  var sec = document.getElementById('g-ch-' + ci);
  if (sec) scrollInPanel(sec, "start");
  var pg = findPageForLine(_gFlatLine);
  if (pg && typeof goPage === 'function') goPage(pg);
}

function switchGPoem(pi) {
  _gPoem = pi;
  _gFlatLine = flatIndex(_gCh, pi, 0);
  highlightActiveLine(_gFlatLine);
  var sec = document.getElementById('g-po-' + _gCh + '-' + pi);
  if (sec) scrollInPanel(sec, "start");
  var pg = findPageForLine(_gFlatLine);
  if (pg && typeof goPage === 'function') goPage(pg);
}

// ── Click text line → navigate OSD ──
function onGLineClick(flatIdx) {
  var readingActive = _gReadingActive;
  if (readingActive) {
    // Stop current speech/recognition but don't fully stop — resume from clicked line
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (_gGRecognition) { try { _gGRecognition.stop(); } catch(e) {} }
    if (_gKeepalive) { clearInterval(_gKeepalive); _gKeepalive = null; }
    _gSpeaking = false;
    _gMicActive = false;
  }
  _gFlatLine = flatIdx;
  var loc = flatToLoc(flatIdx);
  _gCh = loc.ch;
  _gPoem = loc.poem;
  var pg = findPageForLine(flatIdx);
  highlightActiveLine(flatIdx);
  if (pg && pg !== _curPage && typeof goPage === 'function') goPage(pg);
  // Resume reading/mic from clicked line
  if (readingActive) {
    if (_gLastMode === 'mic') {
      startGMic();
    } else {
      startGReadFrom(flatIdx);
    }
  }
}

// ── Highlight active line & scroll into view ──
function highlightActiveLine(flatIdx) {
  document.querySelectorAll('#textContent .g-line').forEach(function(el) {
    el.classList.toggle('active', parseInt(el.dataset.flat) === flatIdx);
  });
  var active = document.querySelector('#textContent .g-line[data-flat="' + flatIdx + '"]');
  if (active) {
    // Scroll only within .sp-content, not the whole page
    var container = document.querySelector('.sp-content');
    if (container) {
      var offset = active.offsetTop - container.offsetTop;
      var target = offset - container.clientHeight / 2 + active.clientHeight / 2;
      container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
    } else {
      scrollInPanel(active);
    }
  }
}

// ── Bottom bar (g-bottom-bar) ──
function updateBottomBarState() {
  var bar = document.getElementById('gBottomBar');
  if (!bar) return;
  if (!_ganjoor) { bar.style.display = 'none'; return; }
  // Only show when TTS or mic is active
  if (!_gSpeaking && !_gMicActive) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  bar.innerHTML =
    '<button class="g-bar-btn' + (_gSpeaking ? ' playing' : '') +
      '" onclick="toggleGRead()" id="gBarPlayBtn">' + (_gSpeaking ? '⏸' : '▶') + '</button>' +
    '<select id="gBarVoice" class="g-bar-voice" onclick="event.stopPropagation()" onchange="event.stopPropagation()"></select>' +
    '<div class="g-bar-rate"><input type="range" id="gBarRate" min="0.5" max="2" step="0.1" value="1" oninput="setGBarRate(this.value)">' +
      '<span id="gBarRateLabel">۱.۰×</span></div>' +
    '<div class="g-bar-sep"></div>' +
    '<button class="g-bar-btn mic' + (_gMicActive ? ' active' : '') +
      '" onclick="toggleGMic()" id="gBarMicBtn">' + (_gMicActive ? '⏹' : '🎤') + '</button>' +
    '<button class="g-bar-btn stop" onclick="stopAllReading()" id="gBarStopBtn" title="توقف">⏹</button>' +
    '<span class="g-bar-status" id="gBarStatus">' +
      (_gSpeaking ? 'در حال خوانش...' : _gMicActive ? 'در حال خط‌بر...' : '') + '</span>';
  populateVoiceSelect('gBarVoice');
}
function populateVoiceSelect(id) {
  var sel = document.getElementById(id);
  if (!sel) return;
  var voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  var fa = voices.filter(function(v) { return /fa|ar/.test(v.lang); });
  var list = fa.length ? fa : voices;
  sel.innerHTML = list.length ? list.map(function(v) {
    return '<option value="' + v.name + '">' + v.name + ' (' + v.lang + ')</option>';
  }).join('') : '<option>صدای مرورگر</option>';
}
function setGBarRate(v) {
  var lbl = document.getElementById('gBarRateLabel');
  if (lbl) lbl.textContent = parseFloat(v).toFixed(1) + '×';
}
function getGSpeedRate() {
  var sel = document.getElementById('gBarRate');
  return sel ? (parseFloat(sel.value) || 1) : 1;
}

// ── TTS: Browser SpeechSynthesis with word-level highlighting ──
function toggleGRead() {
  if (_gSpeaking) {
    // Pause — don't close bar
    _gSpeaking = false;
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (_gKeepalive) { clearInterval(_gKeepalive); _gKeepalive = null; }
    clearAnnotationOverlay();
    updateGBarButtons();
    return;
  }
  if (_gMicActive) toggleGMic();
  startGRead();
}
function startGRead() {
  _gSpeaking = true;
  _gReadingActive = true;
  _gLastMode = 'tts';
  // Resume from current position if set, otherwise chapter start
  if (_gFlatLine < 0 || _gFlatLine === undefined) {
    _gFlatLine = flatIndex(_gCh, _gPoem, 0);
  }
  updateBottomBarState();
  updateGBarButtons();
  highlightActiveLine(_gFlatLine);
  var el = document.getElementById('textContent');
  var active = el && el.querySelector('.g-line.active');
  if (active) scrollInPanel(active);
  speakLine(_gFlatLine);
}
function startGReadFrom(fi) {
  _gFlatLine = fi;
  var loc = flatToLoc(fi);
  _gCh = loc.ch;
  _gPoem = loc.poem;
  startGRead();
}

function speakLine(fi) {
  if (!_gSpeaking || !_ganjoor) { stopAllReading(); return; }
  var total = flatTotal();
  if (fi >= total) { stopAllReading(); return; }
  _gFlatLine = fi;
  highlightActiveLine(fi);
  var pg = findPageForLine(fi);
  if (pg && pg !== _curPage && typeof goPage === 'function') goPage(pg);
  // Auto-show annotations for this page during TTS/mic
  showPageAnnotations(pg);
  var loc = flatToLoc(fi);
  if (loc.ch !== _gCh || loc.poem !== _gPoem) {
    _gCh = loc.ch;
    _gPoem = loc.poem;
    var sec = document.getElementById('g-ch-' + _gCh);
    if (sec) scrollInPanel(sec, "start");
    highlightActiveLine(fi);
  }
  var lineText = _ganjoor[loc.ch].poems[loc.poem].lines[loc.line];
  if (!lineText) { stopAllReading(); return; }
  highlightSpeakingWords(fi, lineText);
  // Use browser SpeechSynthesis (delay after cancel for Chrome)
  var u = new SpeechSynthesisUtterance(lineText);
  u.lang = 'fa-IR';
  u.rate = getGSpeedRate();
  // Pick Persian voice
  var voices = speechSynthesis.getVoices();
  var sel = document.getElementById('gBarVoice');
  var voiceName = sel && sel.value;
  if (voiceName) {
    var match = voices.find(function(v) { return v.name === voiceName; });
    if (match) u.voice = match;
  } else {
    var faVoice = voices.find(function(v) { return /delaram|farid|fa-IR|persian/i.test(v.name); });
    if (faVoice) u.voice = faVoice;
  }
  u.onend = function() {
    if (_gSpeaking) speakLine(fi + 1);
  };
  u.onerror = function(e) {
    console.log('[ganjoor] TTS error:', e.error, 'line:', fi);
    if (e.error !== 'canceled' && _gSpeaking) speakLine(fi + 1);
  };
  speechSynthesis.cancel();
  // Chrome needs delay after cancel before speak
  setTimeout(function() {
    if (!_gSpeaking) return;
    speechSynthesis.speak(u);
    // Chrome keepalive
    if (_gKeepalive) clearInterval(_gKeepalive);
    _gKeepalive = setInterval(function() {
      if (!speechSynthesis.speaking || !_gSpeaking) { clearInterval(_gKeepalive); _gKeepalive = null; return; }
      speechSynthesis.pause(); speechSynthesis.resume();
    }, 10000);
  }, 80);
}

// Auto-show annotation tooltip for an .anno element
var _gAnnoTooltip = null;
function showAnnoTooltipForElement(el) {
  if (!el) return;
  var text = el.dataset.text || '';
  var title = el.dataset.title || '';
  var cat = el.dataset.cat || '';
  if (!text && !title) return;
  if (!_gAnnoTooltip) {
    _gAnnoTooltip = document.createElement('div');
    _gAnnoTooltip.className = 'anno-tooltip';
    _gAnnoTooltip.style.cssText = 'position:fixed;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:12px;max-width:250px;z-index:10000;box-shadow:0 4px 16px rgba(0,0,0,.15);color:var(--text);line-height:1.6;direction:rtl;';
    document.body.appendChild(_gAnnoTooltip);
  }
  _gAnnoTooltip.innerHTML = (title ? '<strong>' + title + '</strong><br>' : '') +
    (cat ? '<span style="display:inline-block;background:var(--accent);color:#fff;border-radius:4px;padding:0 6px;font-size:10px;margin-left:4px">' + cat + '</span> ' : '') + text;
  _gAnnoTooltip.style.display = 'block';
  var rect = el.getBoundingClientRect();
  _gAnnoTooltip.style.left = Math.min(rect.left, window.innerWidth - 260) + 'px';
  _gAnnoTooltip.style.top = (rect.bottom + 6) + 'px';
  // Auto-hide after 5 seconds
  if (_gAnnoTooltip._hideTimer) clearTimeout(_gAnnoTooltip._hideTimer);
  _gAnnoTooltip._hideTimer = setTimeout(function() {
    if (_gAnnoTooltip) _gAnnoTooltip.style.display = 'none';
  }, 5000);
}
function hideAnnoTooltip() {
  if (_gAnnoTooltip) _gAnnoTooltip.style.display = 'none';
}

function highlightSpeakingWords(flatIdx, text) {
  var lineEl = document.querySelector('#textContent .g-line[data-flat="' + flatIdx + '"]');
  if (!lineEl) return;
  var words = lineEl.querySelectorAll('.g-word');
  if (!words.length) return;
  var rate = getGSpeedRate();
  var totalChars = text.replace(/\s+/g, '').length || 1;
  var charRate = 5 * rate;
  var totalMs = (totalChars / charRate) * 1000;
  var elapsed = 0;
  words.forEach(function(w) {
    var wLen = (w.textContent || '').replace(/\s+/g, '').length;
    var wDur = (wLen / totalChars) * totalMs;
    (function(wEl, delay) {
      setTimeout(function() {
        if (!_gSpeaking) return;
        words.forEach(function(ww) { ww.classList.remove('speaking'); });
        wEl.classList.add('speaking');
        // Auto-show annotation tooltip if this word has one
        var annoEl = wEl.closest('.anno') || wEl.querySelector('.anno') || wEl;
        if (annoEl && annoEl.classList && annoEl.classList.contains('anno')) {
          showAnnoTooltipForElement(annoEl);
        }
      }, delay);
    })(w, elapsed);
    elapsed += wDur;
  });
}


// ── Mic (خط‌بر): speech recognition line-follow ──
function toggleGMic() {
  if (_gMicActive) {
    // Pause mic — don't close bar
    _gMicActive = false;
    if (_gGRecognition) { try { _gGRecognition.stop(); } catch(e) {} _gGRecognition = null; }
    clearAnnotationOverlay();
    updateGBarButtons();
    return;
  }
  if (_gSpeaking) toggleGRead();
  startGMic();
}
function startGMic() {
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('تشخیص گفتار پشتیبانی نمی‌شود'); return; }
  _gMicActive = true;
  _gReadingActive = true;
  _gLastMode = 'mic';
  _gFlatLine = flatIndex(_gCh, _gPoem, 0);
  updateBottomBarState();
  highlightActiveLine(_gFlatLine);
  var el = document.getElementById('textContent');
  var active = el && el.querySelector('.g-line.active');
  if (active) scrollInPanel(active);
  _gGRecognition = new SR();
  _gGRecognition.lang = 'fa-IR';
  _gGRecognition.continuous = true;
  _gGRecognition.interimResults = true;
  _gGRecognition.maxAlternatives = 3;
  var spokenBuf = '';
  var lastMatched = -1;
  _gGRecognition.onresult = function(e) {
    for (var i = e.resultIndex; i < e.results.length; i++) {
      var alts = [];
      for (var a = 0; a < e.results[i].length; a++)
        alts.push(e.results[i][a].transcript.trim());
      if (e.results[i].isFinal) {
        spokenBuf += ' ' + alts[0];
        var matched = matchSpokenToText(spokenBuf.trim(), lastMatched);
        if (matched >= 0) {
          lastMatched = matched;
          _gFlatLine = matched;
          var loc = flatToLoc(matched);
          if (loc.ch !== _gCh || loc.poem !== _gPoem) {
            _gCh = loc.ch;
            _gPoem = loc.poem;
            var sec = document.getElementById('g-ch-' + _gCh);
            if (sec) scrollInPanel(sec, "start");
          }
          highlightActiveLine(matched);
          var pg = findPageForLine(matched);
          if (pg && pg !== _curPage && typeof goPage === 'function') goPage(pg);
          showPageAnnotations(pg);
          // Auto-show annotation tooltips for .anno elements in matched line
          var lineEl = document.querySelector('#textContent .g-line[data-flat="' + matched + '"]');
          if (lineEl) {
            var annoEls = lineEl.querySelectorAll('.anno[data-text], .anno[data-title]');
            if (annoEls.length) showAnnoTooltipForElement(annoEls[0]);
          }
          updateBottomBarState();
        }
        spokenBuf = '';
      } else {
        highlightPartialWords(alts[0]);
      }
    }
  };
  _gGRecognition.onerror = function(e) {
    if (e.error !== 'no-speech') console.log('[ganjoor] Mic:', e.error);
  };
  _gGRecognition.onend = function() {
    if (_gMicActive) try { _gGRecognition.start(); } catch (e) {}
  };
  try { _gGRecognition.start(); } catch (e) { _gMicActive = false; updateBottomBarState(); }
}

function matchSpokenToText(spoken, startFlat) {
  var total = flatTotal();
  var norm = function(s) { return s.replace(/[^\w\s\u0600-\u06FF]/g, '').replace(/\s+/g, ' ').trim().toLowerCase(); };
  var sn = norm(spoken);
  if (!sn) return -1;
  var sw = sn.split(' ');
  var bestIdx = -1, bestScore = 0;
  var searchRadius = 50;
  var start = Math.max(0, startFlat >= 0 ? startFlat + 1 : 0);
  var end = Math.min(start + searchRadius, total);
  for (var i = start; i < end; i++) {
    var loc = flatToLoc(i);
    var ln = norm(_ganjoor[loc.ch].poems[loc.poem].lines[loc.line]);
    var lw = ln.split(' ');
    var score = 0;
    // Exact containment — highest score
    if (sn.indexOf(ln) >= 0 || ln.indexOf(sn) >= 0) {
      score = 100;
    } else {
      // Word overlap with partial matching
      var matchCount = 0;
      for (var w = 0; w < sw.length; w++) {
        for (var l = 0; l < lw.length; l++) {
          if (sw[w].length >= 2 && lw[l].length >= 2) {
            // Exact word match
            if (sw[w] === lw[l]) { matchCount += 1.0; break; }
            // Partial: one contains the other
            if (sw[w].indexOf(lw[l]) >= 0 || lw[l].indexOf(sw[w]) >= 0) { matchCount += 0.7; break; }
            // Levenshtein-like: share 70%+ characters
            var shared = 0;
            for (var c = 0; c < sw[w].length; c++) {
              if (lw[l].indexOf(sw[w][c]) >= 0) shared++;
            }
            if (shared / Math.max(sw[w].length, lw[l].length) > 0.7) { matchCount += 0.5; break; }
          }
        }
      }
      score = (matchCount / Math.max(sw.length, lw.length)) * 90;
    }
    // Distance penalty — prefer closer lines
    var distPenalty = 1 - ((i - start) / searchRadius) * 0.3;
    score *= distPenalty;
    if (score > bestScore && score > 40) { bestScore = score; bestIdx = i; }
  }
  // Fallback: search backward from start (in case user read past)
  if (bestIdx < 0 && startFlat > 0) {
    for (var j = Math.max(0, startFlat - 10); j < startFlat; j++) {
      var loc2 = flatToLoc(j);
      var ln2 = norm(_ganjoor[loc2.ch].poems[loc2.poem].lines[loc2.line]);
      var lw2 = ln2.split(' ');
      var mc2 = 0;
      for (var w2 = 0; w2 < sw.length; w2++) {
        for (var l2 = 0; l2 < lw2.length; l2++) {
          if (sw[w2] === lw2[l2] || (sw[w2].length >= 2 && lw2[l2].length >= 2 && (sw[w2].indexOf(lw2[l2]) >= 0 || lw2[l2].indexOf(sw[w2]) >= 0))) {
            mc2++; break;
          }
        }
      }
      var sc2 = (mc2 / Math.max(sw.length, lw2.length)) * 80;
      if (sc2 > 50) { bestIdx = j; bestScore = sc2; break; }
    }
  }
  return bestIdx;
}

function highlightPartialWords(transcript) {
  var lineEl = document.querySelector('#textContent .g-line.active');
  if (!lineEl) return;
  var spokenWords = transcript.split(/\s+/);
  lineEl.querySelectorAll('.g-word').forEach(function(w) {
    var t = w.textContent.trim().toLowerCase();
    w.classList.toggle('partial-match', spokenWords.some(function(sw) {
      return t.indexOf(sw) >= 0 || sw.indexOf(t) >= 0;
    }));
  });
}

// ── Page change watcher (300ms) — bidirectional nav ──
(function() {
  var last = 0;
  setInterval(function() {
    if (typeof _curPage === 'undefined' || _curPage === last) return;
    last = _curPage;
    if (_ganjoor && !_gSpeaking && !_gMicActive) {
      var lines = getLinesForPage(_curPage);
      if (lines && lines.length) {
        var fi = lines[0];
        var loc = flatToLoc(fi);
        if (loc.ch !== _gCh || loc.poem !== _gPoem) {
          _gCh = loc.ch;
          _gPoem = loc.poem;
          var sec = document.getElementById('g-ch-' + _gCh);
          if (sec) scrollInPanel(sec, "start");
        }
        _gFlatLine = fi;
        highlightActiveLine(fi);
      }
    }
  }, 300);
})();

// ── Bridge functions for viewer.js goPage() compatibility ──
function getChunkForPage(pg) {
  if (!_ganjoor || !_gPageLines[pg]) return null;
  return { chunk: true };
}
function renderGanjoorChunk(pg) {
  if (!_ganjoor) return;
  var el = document.getElementById('textContent');
  if (el && !el.querySelector('.g-chapters')) renderGanjoorText();
  var lines = getLinesForPage(pg);
  if (lines && lines.length) {
    var fi = lines[0];
    var loc = flatToLoc(fi);
    if (loc.ch !== _gCh || loc.poem !== _gPoem) {
      _gCh = loc.ch;
      _gPoem = loc.poem;
      var sec = document.getElementById('g-ch-' + _gCh);
      if (sec) scrollInPanel(sec, "start");
    }
    _gFlatLine = fi;
    highlightActiveLine(fi);
  }
}

// ── Unified stop ──
function stopAllReading() {
  _gSpeaking = false;
  _gMicActive = false;
  _gReadingActive = false;
  if (_gKeepalive) { clearInterval(_gKeepalive); _gKeepalive = null; }
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (_gGRecognition) { try { _gGRecognition.stop(); } catch (e) {} _gGRecognition = null; }
  document.querySelectorAll('#textContent .g-word.speaking').forEach(function(el) { el.classList.remove('speaking'); });
  document.querySelectorAll('#textContent .g-line.active').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('#textContent .g-word.partial-match').forEach(function(el) { el.classList.remove('partial-match'); });
  clearAnnotationOverlay();
  hideAnnoTooltip();
  updateBottomBarState();
}

// ── Toolbar wrappers ──
window.toggleGanjoorTTS = function() { toggleGRead(); };
window.toggleGanjoorMic = function() { toggleGMic(); };

// ── Show/hide toolbar buttons ──
function showGanjoorButtons() {
  var bt = document.getElementById('bGanjoorTTS');
  var bm = document.getElementById('bGanjoorMic');
  if (bt) bt.style.display = '';
  if (bm) bm.style.display = '';
}
function hideGanjoorButtons() {
  var bt = document.getElementById('bGanjoorTTS');
  var bm = document.getElementById('bGanjoorMic');
  if (bt) bt.style.display = 'none';
  if (bm) bm.style.display = 'none';
}

// ── Auto-show annotations during TTS/mic ──
var _gLastAnnoPage = -1;
var _gAnnoTimer = null;
function showPageAnnotations(pg) {
  // Remove existing annotation overlay
  var old = document.getElementById('gAnnoOverlay');
  if (old) old.remove();
  _gLastAnnoPage = pg;
  // Get annotations for this page from viewer.js
  var annos = window._annos;
  console.log('[ganjoor] showPageAnnotations: pg=', pg, 'annos=', annos ? annos.length : 'null', 'window._annos=', typeof window._annos);
  if (!annos || !annos.length) return;
  var pageAnnos = annos.filter(function(a) { return a.page == pg; });
  console.log('[ganjoor] pageAnnos for page', pg, ':', pageAnnos.length);
  if (!pageAnnos.length) return;
  // Create floating overlay
  var box = document.createElement('div');
  box.id = 'gAnnoOverlay';
  box.style.cssText = 'position:absolute;right:8px;top:8px;max-width:280px;z-index:100;pointer-events:none;';
  pageAnnos.forEach(function(a) {
    var tip = document.createElement('div');
    tip.style.cssText = 'background:rgba(45,45,45,.92);color:#f5e6c8;border:1px solid rgba(212,168,83,.4);border-radius:8px;padding:8px 12px;margin-bottom:6px;font-size:12px;line-height:1.7;direction:rtl;box-shadow:0 2px 12px rgba(0,0,0,.3);animation:annoSlideIn .4s ease-out;pointer-events:auto;';
    tip.textContent = '📝 ' + a.text;
    box.appendChild(tip);
  });
  // Find reading box container
  var readingBox = document.querySelector('.g-reading-box');
  if (readingBox) {
    readingBox.style.position = 'relative';
    readingBox.appendChild(box);
  }
  // Auto-fade after 8 seconds
  if (_gAnnoTimer) clearTimeout(_gAnnoTimer);
  _gAnnoTimer = setTimeout(function() {
    if (box.parentNode) {
      box.style.transition = 'opacity 1.5s';
      box.style.opacity = '0';
      setTimeout(function() { if (box.parentNode) box.remove(); }, 1500);
    }
  }, 8000);
}
function clearAnnotationOverlay() {
  if (_gAnnoTimer) { clearTimeout(_gAnnoTimer); _gAnnoTimer = null; }
  var old = document.getElementById('gAnnoOverlay');
  if (old) old.remove();
  _gLastAnnoPage = -1;
}

function updateGBarButtons() {
  var readBtn = document.getElementById('gBarReadBtn');
  var micBtn = document.getElementById('gBarMicBtn');
  if (readBtn) readBtn.textContent = _gSpeaking ? '⏸' : '🔊';
  if (micBtn) micBtn.textContent = _gMicActive ? '⏹' : '🎤';
}

// ── Persian numeral helper ──
function toFANumeral(n) {
  var fa = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
  return String(n).split('').map(function(d) { return fa[parseInt(d)]; }).join('');
}

// ── Init ──
document.addEventListener('DOMContentLoaded', function() {
  if (window.speechSynthesis) {
    speechSynthesis.onvoiceschanged = function() { populateVoiceSelect('gBarVoice'); };
  }
});
