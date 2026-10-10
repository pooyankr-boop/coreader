/* === voice.js — the reader's speech engine, shared with the viewer ===
 *
 * Read-aloud and mic line-following, extracted verbatim from the reader's
 * assets/reader.js so both pages run the *same* implementation.  The reader's
 * alignment is a tuned Smith-Waterman variant with stopword downweighting and
 * ZWNJ tokenizing; copying it into the viewer produced two engines that drift.
 *
 * Mounted, not loaded blind: nothing here runs until
 *   window.__coreaderVoice = { onWord, onPage, getWords }
 * is set by the page.  The reader keeps using its own inline copies for now;
 * ponytail: switch the reader over once its inline paths are deleted, so this
 * file is the only implementation in the repo.
 *
 * The viewer uses it with the OCR word list from page-text.js, so a spoken word
 * matches the same word the search highlight sits on - one word list, three
 * surfaces (image, text, PDF).
 */
(function () {
  'use strict';

  var STOPW = {'و':1,'را':1,'به':1,'از':1,'در':1,'كه':1,'که':1,'بر':1,'ان':1,'اين':1,
    'با':1,'تا':1,'بي':1,'بی':1,'هم':1,'يا':1,'چون':1,'است':1,'بود':1,'مر':1,'آن':1,
    'the':1,'a':1,'an':1,'of':1,'and':1,'to':1,'in':1,'is':1,'de':1,'la':1,'le':1,
    'les':1,'des':1,'du':1,'et':1,'que':1,'qui':1,'en':1,'un':1,'une':1,'pour':1};

  /* Levenshtein, used only for a word-pair similarity score.  Small inputs
   * (single words), so the naive table is the right size of tool. */
  function editDist(a, b) {
    if (a === b) return 0;
    var la = a.length, lb = b.length;
    if (!la) return lb;
    if (!lb) return la;
    var d = [];
    for (var i = 0; i <= la; i++) d[i] = [i];
    for (var j = 0; j <= lb; j++) d[0][j] = j;
    for (var i = 1; i <= la; i++) {
      for (var j = 1; j <= lb; j++) {
        var c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      }
    }
    return d[la][lb];
  }

  function wordSim(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    var m = Math.max(a.length, b.length);
    if (!m) return 1;
    return 1 - editDist(a, b) / m;
  }

  var V = {
    words: [],        // [{n: normalized, el: element|null}]
    idx: 0,
    buf: [],
    speaking: false,
    mic: false,
    rec: null,
    keepalive: null,
    host: null,       // {onWord, onPage, getWords, lang}
  };

  /* Build the word list for the text currently on screen.
   *
   * The viewer has no per-page DOM to walk into (its text is one flat column),
   * so it passes words in through host.getWords().  The reader's own DOM walk is
   * not duplicated here - it keeps calling buildMicIndex itself and handing the
   * result over. */
  /* Build the word list, normalizing here rather than trusting the caller.
   *
   * alignBuffer scores pairs by reading w.n, so a word without it scores zero
   * against everything and the tracker can never lock on - silently, because a
   * search for "no match" looks the same as a search that found nothing yet.
   * The viewer's OCR words carry only {t, x, y, w, h}, so without this line the
   * mic worked nowhere it was not handed a pre-normalized list. */
  function setWords(list) {
    V.words = (list || []).map(function (w) {
      return { n: w.n || normOf(w.t), el: w.el || null, box: w.box || w, t: w.t || '' };
    });
    V.idx = 0;
    V.buf = [];
  }

  /* One normalizer for the whole project.
   *
   * This used to be a second, near-copy of the reader's rule, and it dropped the
   * letter «ê» entirely: 'PRÊTRES' came out as 'prtres'.  The OCR is NFD, so «ê»
   * is the letter «e» plus U+0302, and cutting "not a word character" before
   * folding accents removes the mark *and* the letter it was attached to.  Call
   * ptFold from page-text.js instead - one rule, so a word the mic cannot hear
   * and a word search cannot find cannot diverge again.
   *
   * Falls back to a local copy if the engine is not mounted, so this file still
   * works on its own. */
  function normOf(w) {
    if (typeof ptFold === 'function') return ptFold(w).replace(/[^\w\u0600-\u06FF']/g, '');
    return String(w == null ? '' : w)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[ً-ٰٟۖ-ۭ]/g, '')
      .replace(/[ـ‌‍‎‏]/g, '')
      .replace(/ی/g, 'ي').replace(/ک/g, 'ك')
      .replace(/[^\w؀-ۿ']/g, '')
      .toLowerCase();
  }

  /* Local alignment of a spoken chunk against the window of text ahead of the
   * cursor.  Scoring rewards a distinctive word far more than a stopword, which
   * is what stops the tracker jumping on «و» every other word. */
  function alignBuffer(spoken, startFrom, ahead, behind) {
    var winStart = Math.max(0, startFrom - (behind || 5));
    var winEnd = Math.min(V.words.length, startFrom + (ahead || 80));
    var page = V.words.slice(winStart, winEnd);
    var n = spoken.length, m = page.length;
    if (!n || !m) return null;
    var H = [];
    for (var i = 0; i <= n; i++) H[i] = new Array(m + 1).fill(0);
    var best = 0, bi = 0, bj = 0;
    for (var i = 1; i <= n; i++) {
      for (var j = 1; j <= m; j++) {
        var sw = spoken[i - 1], pw = page[j - 1].n;
        var sim = wordSim(sw, pw);
        var isStop = STOPW[sw] || STOPW[pw];
        var sub;
        if (sim >= 0.75) sub = isStop ? 0.5 : 2;
        else if (sim >= 0.4) sub = isStop ? 0.2 : 1;
        else sub = -1;
        var v = Math.max(0, H[i - 1][j - 1] + sub, H[i - 1][j] - 1, H[i][j - 1] - 1);
        H[i][j] = v;
        if (v > best) { best = v; bi = i; bj = j; }
      }
    }
    if (best <= 0) return null;
    return { pageIndex: winStart + bj - 1, matchedSpoken: bi, score: best };
  }

  function advance(buf, live, wide) {
    if (!V.words.length || !buf.length) return false;
    // Adaptive recovery: after a few misses the reader has skipped a paragraph
    // or the page turned, so widen the window once instead of staying stuck.
    var ahead = live ? 15 : (wide ? 220 : 60);
    var behind = live ? 2 : (wide ? 25 : 10);
    var res = alignBuffer(buf, V.idx, ahead, behind);
    var distinctive = buf.filter(function (w) { return !STOPW[w]; }).length;
    var minConf = live ? 2 : Math.max(2, Math.ceil(buf.length * 0.3));
    var ratio = live ? 0.3 : (wide ? 0.85 : 0.7);
    if (!(res && distinctive > 0 && res.matchedSpoken >= minConf &&
          res.score >= res.matchedSpoken * ratio && res.pageIndex >= V.idx)) return false;
    V.idx = Math.min(res.pageIndex + 1, V.words.length);
    emit();
    return true;
  }

  function emit() {
    var w = V.words[V.idx - 1];
    if (V.host && V.host.onWord) V.host.onWord(V.idx - 1, w);
    if (V.host && V.host.onPage) V.host.onPage(V.idx, V.words.length);
  }

  /* --- read aloud ------------------------------------------------------ */
  function speakFrom(wordIndex) {
    if (!window.speechSynthesis) return;
    V.speaking = true;
    var i = wordIndex == null ? V.idx : wordIndex;
    if (i < 0) i = 0;
    var w = V.words[i];
    if (!w) { stop(); return; }
    V.idx = i;
    emit();
    var u = new SpeechSynthesisUtterance(w.t || w.n);
    u.lang = (V.host && V.host.lang) || 'fa-IR';
    u.rate = (V.host && V.host.rate) || 1;
    var voices = window.speechSynthesis.getVoices() || [];
    var want = new RegExp('^' + u.lang.slice(0, 2), 'i');
    var match = voices.filter(function (v) { return want.test(v.lang); })[0];
    if (match) u.voice = match;
    u.onend = function () { if (V.speaking) speakFrom(V.idx + 1); };
    u.onerror = function () { if (V.speaking) speakFrom(V.idx + 1); };
    window.speechSynthesis.cancel();
    // Chrome drops an utterance queued immediately after cancel().
    setTimeout(function () {
      if (V.speaking) window.speechSynthesis.speak(u);
    }, 80);
  }

  function toggleSpeak() {
    if (V.speaking) { stop(); return false; }
    refresh();
    speakFrom(V.idx);
    return true;
  }

  /* --- mic: follow the spoken line ------------------------------------- */
  function toggleMic() {
    if (V.mic) { stopMic(); return false; }
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;                 // caller reports "not supported"
    refresh();
    V.mic = true;
    V.rec = new SR();
    V.rec.lang = (V.host && V.host.lang) || 'fa-IR';
    V.rec.continuous = true;
    V.rec.interimResults = true;
    V.rec.maxAlternatives = 3;
    var misses = 0;
    V.rec.onresult = function (e) {
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        var said = e.results[i][0].transcript.trim();
        if (!said) continue;
        V.buf = V.buf.concat(said.split(/\s+/).map(normOf).filter(Boolean));
        // A long buffer means the listener is behind: match with a wide window.
        if (V.buf.length > 24) V.buf = V.buf.slice(-24);
        if (advance(V.buf, false, V.buf.length > 8)) {
          misses = 0;
          V.buf = [];
        } else if (++misses > 6 && V.buf.length > 4) {
          // Recovery: the reader skipped ahead, so allow a wide jump once.
          if (advance(V.buf, false, true)) { misses = 0; V.buf = []; }
          else V.buf = V.buf.slice(-6);
        }
      }
    };
    V.rec.onend = function () { if (V.mic) { try { V.rec.start(); } catch (err) {} } };
    V.rec.onerror = function () {};
    try { V.rec.start(); } catch (e) { V.mic = false; V.rec = null; return null; }
    return true;
  }

  function stopMic() {
    V.mic = false;
    if (V.rec) { try { V.rec.stop(); } catch (e) {} V.rec = null; }
  }

  function stop() {
    V.speaking = false;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (V.keepalive) { clearInterval(V.keepalive); V.keepalive = null; }
  }

  /* Re-read the host's current words.  Called on every page change so the
   * tracker never holds the previous page's vocabulary. */
  function refresh() {
    if (V.host && V.host.getWords) {
      var list = V.host.getWords();
      if (list && list.length) setWords(list);
    }
  }

  window.__coreaderVoice = {
    setWords: setWords,
    refresh: refresh,
    toggleSpeak: toggleSpeak,
    speakFrom: speakFrom,
    toggleMic: toggleMic,
    stop: stop,
    stopMic: stopMic,
    normOf: normOf,
    align: alignBuffer,
    editDist: editDist,
    wordSim: wordSim,
    state: V,
    mount: function (host) { V.host = host; },
  };
})();