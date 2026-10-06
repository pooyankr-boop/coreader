/* Rooms, views, pulsing hotspots, book shelves, paintings.
 *
 * The room-view logic is carried over from the Yaran tour engine
 * (yaran/js/tour.js): a double-buffered cross-fade, a preloader that blocks
 * input until the next view has decoded, and fixCover() - the object-fit:cover
 * correction.  That last one is the reason for the port.  A hotspot's x/y are
 * percentages of the picture, and the picture is cropped to fill the screen, so
 * the ring has to follow the crop or it drifts off the wall.  Yaran had already
 * solved it; re-deriving it would only produce a worse copy.
 *
 * Left out on purpose: the game screen, the search box, the floor-plan map, the
 * audio injector, theme save/restore.  None of them exist here.
 *
 * No alert()/confirm()/prompt() anywhere - the desktop webview throws on those.
 */
'use strict';

var ART = '../books/contre-nature/art/';

/* The manifest stores the path as "art/<file>.jpg", so prefixing ART blindly
 * produced "art/art/<file>.jpg" and the image silently failed to load.  One
 * normaliser, used everywhere, so there is no second place to get it wrong. */
function artURL(p) {
  if (!p) return '';
  return /^art\//.test(p) ? ART + p.slice(4) : ART + p;
}
var COVER = '../books/contre-nature/book/';
var VIEWS = '../books/contre-nature/views/';
var MANIFEST = '../books/contre-nature/manifest.json';

// hero, then the two close views, named as they are on disk; the arrow keys
// walk this ring.  The names are the manifest's, not invented here.
var ORDER = ['hero', 'left', 'right'];

var V = {
  man: null,
  room: null,
  view: 'hero',
  layer: 'a',
  busy: false,
  open: null,
  sideOpen: false
};

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

/* ---------- boot ---------- */

function boot() {
  // cache-bust: this file changes while it is being written, and the browser
  // held a stale manifest for minutes
  fetch(MANIFEST + '?v=' + Date.now())
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (m) {
      V.man = m;
  P.man = m;                       // plan.js reads the same stops
      V.base = MANIFEST.replace(/[^/]+$/, '');
      collectViews();
      atmosphere();
      wire();
      route();
    })
    .catch(function (e) {
      var s = $('list');
      s.textContent = '';
      var p = document.createElement('p');
      p.className = 'warn';
      p.textContent = 'مانیفست تور بارگذاری نشد: ' + e.message;
      s.appendChild(p);
    });
}

function res(p) {
  if (!p) return '';
  /* '../' is already a path out of this directory (the cross-tour door card
   * points at the other tour's rooms); prepending V.base would mangle it. */
  if (/^(https?:)?\/\//.test(p) || p.charAt(0) === '/' || /^\.\.\//.test(p)) return p;
  return V.base + p;
}

function wire() {
  // The written "all rooms" link is gone from the bar; this corner is it now,
  // and it is the only way back out of a room without using the keyboard.
  $('about').addEventListener('click', function (e) { e.preventDefault(); showList(); });
  dockInit();
  document.addEventListener('mousemove', dockWake, { passive: true });
  document.addEventListener('touchstart', dockWake, { passive: true });
  document.addEventListener('keydown', dockWake);
  $('scrim').addEventListener('click', function (e) {
    if (e.target.closest('.hs') || e.target.closest('.panel')) return;
    closePanel();
    // clicking outside the list closes it too
    if (V.sideOpen && !$('side').contains(e.target)) closeSide();
  });
  // the list lives behind one highlight on the left edge and opens on it alone
  $('sideTab').addEventListener('click', function (e) {
    e.stopPropagation();
    V.sideOpen ? closeSide() : openSide();
  });
  $('side').addEventListener('click', function (e) {
    var a = e.target.closest('.ac');
    if (a) return showArt(a.getAttribute('data-art'));
  });
  // the scan, at full size - the image itself is the button
  $('panel').addEventListener('click', function (e) {
    var im = $('panel').querySelector('.pi');
    if (im && (e.target.closest('.pi') || e.target.closest('.panel'))) {
      openFull(im.getAttribute('data-full') || im.src, im.alt || '');
    }
  });
  $('light').addEventListener('click', function (e) {
    if (e.target === $('light') || e.target.closest('#lightX')) closeFull();
  });
  document.addEventListener('keydown', function (e) {
    if (!V.room) return;
    if (e.key === 'ArrowRight') { setView(step(1)); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { setView(step(-1)); e.preventDefault(); }
    else if (e.key === 'Escape') {
      if ($('light').className.indexOf('in') >= 0) closeFull();
      else if (V.sideOpen) closeSide();
      else closePanel();
    }
  });
  window.addEventListener('hashchange', route);
}

/* The list is hidden with the attribute and faded in with a class: the attribute
 * takes it out of the hit test, the class animates.  Doing it the other way round
 * leaves an invisible panel swallowing clicks over the room. */
function openSide() {
  V.sideOpen = true;
  $('side').hidden = false;
  requestAnimationFrame(function () { $('side').classList.add('on'); });
  $('sideTab').classList.add('on');
}
function closeSide() {
  V.sideOpen = false;
  $('side').classList.remove('on');
  $('sideTab').classList.remove('on');
  var s = $('side');
  // wait out the .22s slide before hiding, or it vanishes mid-animation
  setTimeout(function () { if (!V.sideOpen) s.hidden = true; }, 220);
}

/* ---------- routing ---------- */

function route() {
  var raw = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (!raw) return showList();
  var p = raw.split('/');
  openRoom(p[0]);
  if (p[1]) setTimeout(function () { showArt(p[1]); }, 80);
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

/* The corner and the empty hash both land here.  Since the plan was made, the
 * list of rooms is gone: the entrance view IS the first screen, and a room is
 * reached by clicking its own doorway in the photograph. */
function showList() {
  V.room = null;
  V.view = 'hero';
  V.busy = false;
  closePanel();
  closeSide();
  showPlan();
}

/* ---------- one room ---------- */

function openRoom(id) {
  var s = (V.man.stops || []).filter(function (r) { return r.id === id; })[0];
  if (!s) return showList();
  V.room = s;
  V.view = 'hero';
  V.busy = false;

  $('room').className = 'room on';
  $('list').className = 'list off';
  hidePlan();                        // the entrance view gives way to the room
  closeSide();                       // a new room starts with a closed list

  var a = $('bgA'), b = $('bgB');
  a.className = 'bg'; b.className = 'bg';
  a.src = VIEWS + id + '--hero.jpg';
  a.classList.add('on');
  V.layer = 'a';

  render();
  document.title = s.title + ' — درون‌سویی';
}

/* ---------- views ---------- */

function setView(view) {
  if (V.busy || view === V.view || !V.room) return;
  if (!VIEWS_.has(V.room.id + ':' + view)) return;
  V.busy = true;
  var a = $('bgA'), b = $('bgB');
  var show = V.layer === 'a' ? b : a;
  var hide = V.layer === 'a' ? a : b;
  var img = new Image();
  img.onload = function () {
    V.view = view;
    show.src = VIEWS + V.room.id + '--' + view + '.jpg';
    show.classList.add('on');
    hide.classList.remove('on');
    V.layer = V.layer === 'a' ? 'b' : 'a';
    V.busy = false;
    render();
  };
  img.onerror = function () { V.busy = false; };
  img.src = VIEWS + V.room.id + '--' + view + '.jpg';
}

function step(dir) {
  var i = ORDER.indexOf(V.view);
  if (i < 0) return 'hero';
  return ORDER[(i + dir + ORDER.length) % ORDER.length];
}

// which close views exist for the current room, read off the manifest
var VIEWS_ = new Set();
function collectViews() {
  (V.man.stops || []).forEach(function (s) {
    ORDER.forEach(function (k) {
      if (k === 'hero' || (s.views || []).indexOf(k) >= 0) VIEWS_.add(s.id + ':' + k);
    });
  });
}

/* ---------- hotspots ---------- */

/* fixCover: a hotspot's x/y are percentages of the picture, not of the screen.
 * The picture fills the box with object-fit:cover, so on all but one axis it is
 * cropped; the ring has to follow that crop.  Ported unchanged from Yaran. */
function fixCover(hx, hy) {
  var img = $('bgA').classList.contains('on') ? $('bgA') : $('bgB');
  if (!img || !img.naturalWidth) return [hx, hy];
  var cw = img.clientWidth, ch = img.clientHeight;
  var nw = img.naturalWidth, nh = img.naturalHeight;
  var sc = Math.max(cw / nw, ch / nh);
  var rw = nw * sc, rh = nh * sc;
  var ox = (cw - rw) / 2, oy = (ch - rh) / 2;
  return [(ox + rw * hx / 100) * 100 / cw, (oy + rh * hy / 100) * 100 / ch];
}

function render() {
  renderHotspots();
  $('side').innerHTML = side();
  measureTyped($('side'));
}


function renderHotspots() {
  var sc = $('scrim');
  // drop the rings only; the panel is a sibling and must survive a re-render
  var rings = sc.querySelectorAll('.hs');
  for (var i = 0; i < rings.length; i++) rings[i].parentNode.removeChild(rings[i]);
  var framed = sc.querySelectorAll('img.painting');
  for (var j = 0; j < framed.length; j++) framed[j].parentNode.removeChild(framed[j]);
  closePanel();
  if (!V.room) return;
  var list = (V.room.hotspots || {})[V.view] || [];
  list.forEach(function (hs) {
    hs.room = V.room;           // the panel is built from the hotspot, not from
                                // V.room, which is null on a deep link
    var p = fixCover(hs.x, hs.y);
    var el = document.createElement('div');
    el.className = 'hs';
    el.style.left = Math.max(1, Math.min(99, p[0])) + '%';
    el.style.top = Math.max(1, Math.min(99, p[1])) + '%';
    el.title = hs.title || '';
    if (hs.r) el.style.setProperty('--r', hs.r + 'px');
    /* The pink room is the ONE hotspot in the whole tour that does not sit in
     * the entrance view: it is inside the entrance hall, on the way in.  It is
     * tagged in CSS so it can be told apart at a glance from the amber rings. */
    if (hs.pink) el.classList.add('pink');
    if (hs.kind === 'art') {
      // A picture hangs on a wall seen at an angle, so it needs a keystone:
      // the far edge shorter, the near edge taller.  fixCover only corrects
      // the crop, not the perspective, and a flat rectangle on that wall
      // reads as pasted on - worse than leaving the frame empty.
      el.classList.add('has-art');
      var im = document.createElement('img');
      im.className = 'painting';
      im.src = artURL(hs.image);
      im.alt = hs.titleFa || hs.title || '';
      im.style.left = Math.max(1, Math.min(99, p[0])) + '%';
      im.style.top = Math.max(1, Math.min(99, p[1])) + '%';
      im.style.setProperty('--w', (hs.w || 7) + '%');
      im.style.setProperty('--h', (hs.h || 12) + '%');
      // The keystone is the four measured corners, not three derived slopes.
      // The CSS sets --c1..--c4, each a "x% y%" pair in this element's own box.
      var cs = [hs.tl, hs.tr, hs.br, hs.bl];
      for (var q = 0; q < 4; q++) {
        var cc = cs[q];
        if (!cc) continue;
        im.style.setProperty('--c' + (q + 1), cc[0] + '% ' + cc[1] + '%');
      }
      if (hs.tilt != null) im.style.setProperty('--tilt', hs.tilt);
      if (hs.rise != null) im.style.setProperty('--rise', hs.rise);
      if (hs.lift != null) im.style.setProperty('--lift', hs.lift);
      sc.appendChild(im);
    }
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      /* `goesTo`, not `room`: eleven lines above, hs.room is ASSIGNED to the
     * room currently on screen, so a doorway hotspot carrying `room` had its
     * destination overwritten with an object and the hash became
     * "#[object Object]".  The two meanings needed separate names. */
    /* A doorway hotspot GOES THROUGH on click.  Every other kind opens a
       * panel first - a shelf lists books, a painting opens full screen, and
       * neither is a place you can walk into.  The pink room is the one
       * hotspot that is a room, so the ring is the door: one click and you are
       * in it.  Showing a panel with a link inside meant the click appeared to
       * do nothing, which is what the brief reported. */
      if (hs.kind === 'room') { go('#' + hs.goesTo); return; }
      toggle(hs, el);
    });
    sc.appendChild(el);
  });
}

function toggle(hs, el) {
  if (V.open === el) return closePanel();
  V.open = el;
  var prev = $('scrim').querySelector('.hs.sel');
  if (prev) prev.classList.remove('sel');
  el.classList.add('sel');
  var p = $('panel');
  p.className = 'panel in';
  if (hs.kind === 'room') {
    /* Unreachable in practice: renderHotspots sends a `room` click straight to
     * go().  Kept as the fallback for a keyboard Enter on a ring whose click
     * handler was replaced, and because it costs nothing. */
    p.innerHTML = '<div class="pnl"><div class="pt">' +
      (hs.titleFa || hs.title || '') + '</div>' +
      '<p class="pd">' + esc(hs.note || '') + '</p>' +
      '<a class="go" href="#' + hs.goesTo + '">' +
      esc((V.man.stops.filter(function (r) { return r.id === hs.goesTo; })[0] || {}).title || hs.goesTo) +
      '</a></div>';
    measureTyped(p);
    placePanel(p, el);
    return;
  }
  p.innerHTML = hs.kind === 'shelf' ? shelfHTML(hs) : artHTML(hs);
  measureTyped(p);
  placePanel(p, el);
}

/* Put the panel beside the ring and keep it inside the viewport.  Extracted
 * because the room panel needs it too, and a second copy of these four lines
 * would drift. */
function placePanel(p, el) {
  var w = p.offsetWidth || 300, hh = p.offsetHeight || 200;
  var left = Math.min(Math.max(8, parseFloat(el.style.left) * 0.01 * window.innerWidth + 24),
                      window.innerWidth - w - 8);
  var top = Math.min(Math.max(8, parseFloat(el.style.top) * 0.01 * window.innerHeight - hh / 2),
                     window.innerHeight - hh - 60);
  p.style.left = Math.max(8, left) + 'px';
  p.style.top = Math.max(8, top) + 'px';
}

function closePanel() {
  V.open = null;
  var p = $('panel');
  p.className = 'panel';
  p.textContent = '';
  var s = $('scrim').querySelector('.hs.sel');
  if (s) s.classList.remove('sel');
}

/* ---------- panel content ---------- */

function artHTML(hs) {
  // The picture is the button: a panel thumbnail is not the scan, and the
  // reader asked for the scan itself at full size.  Clicking the image opens it
  // - no written button, because the image already says what it does.
  var url = artURL(hs.image);
  var h = '<img class="pi" alt="" src="' + esc(url) +
      '" data-full="' + esc(url) + '">';
  h += typedHTML(hs.titleFa || hs.title || '', 't1');
  return h;
}

/* A shelf opens the catalogue of that shelf's books.  Only the ones we can
 * actually open are links - a link that opens nothing is worse than no link.
 * `cover` is a local scan; `iiifManifest` is a remote IIIF manifest that the
 * viewer resolves from books-index.json, so either one makes a book openable.
 *
 * No count line, no "viewer" button, no note: the names are the whole panel,
 * and they type themselves in one after another. */
function shelfHTML(hs) {
  // The books live on the stop, not on the hotspot: a shelf hotspot carries
  // only kind/shelf/title/x/y/r, so V.room and hs.room are both null here and
  // the list has to be found by walking the stops for the one that owns this
  // shelf.  ponytail: the manifest could put a `books` ref on the hotspot;
  // until it does, find it here.
  var bs = shelfBooks(hs.shelf);
  var open_ = bs.filter(function (b) { return b.cover || b.iiifManifest; });
  var h = '';
  open_.forEach(function (b, i) {
    // 60ms apart: long enough to read as typing, short enough that six books
    // are not finished before the eye has moved to the next hotspot.
    h += '<a class="go" href="viewer.html?book=' + encodeURIComponent(b.id) +
      '" style="animation-delay:' + (i * 0.06).toFixed(2) + 's">' +
      typedHTML(b.titleFa || b.title, 'bk') + '</a>';
  });
  return h;
}

/* Every book the manifest puts on one shelf, whatever stop holds it. */
function shelfBooks(shelf) {
  var out = [];
  (V.man && V.man.stops || []).forEach(function (s) {
    (s.books || []).forEach(function (b) {
      if (b.shelf === shelf) out.push(b);
    });
  });
  out.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  return out;
}


/* ---------- the full-size scan ---------- */

/* A panel is 330px wide; the scan is not that small.  Clicking the picture
 * opens it over the room, with the novel's line about it underneath.  No
 * dialog(): the desktop webview throws on that. */
function openFull(src, cap) {
  var box = $('light');
  var im = $('lightIm');
  im.src = src;
  im.alt = cap || '';
  $('lightCap').textContent = cap || '';
  box.className = 'light in';
  im.focus();
}

function closeFull() { $('light').className = 'light'; }


/* Which paintings are actually placed in this room?  An artwork with no
 * coordinates has nothing to sit on, so it must not be listed as if it did. */
function pinned(room, artId) {
  var hs = room.hotspots || {};
  return Object.keys(hs).some(function (v) {
    return (hs[v] || []).some(function (h) { return h.art === artId; });
  });
}

/* ---------- the side list ---------- */

/* Reachable only through the left tab, so its contents are the room's index:
 * a painting that has not found its frame yet, and the books.  Book names
 * type themselves in, staggered, because a list that appears all at once is a
 * wall of text and one that types is a list being read. */
function side() {
  var s = V.room;
  if (!s) return '';
  var h = '', i = 0;
  function step() { return (i++ * 0.05).toFixed(2); }
  // 50ms apart: six books finish in half a second, which reads as a list being
  // read rather than a list being printed one letter at a time.
  function artStyle(a) {
    var n = String(a.titleFa || a.title || '').length + 1;
    return '--n:' + n + ';animation-delay:' + step() + 's';
  }
  // A painting belongs in its frame, and a thumbnail in a menu reads as a
  // sticker pasted on the wall.  One with no coordinates yet stays listed here.
  var loose = (s.artworks || []).filter(function (a) { return !pinned(s, a.id); });
  if (loose.length) {
    loose.forEach(function (a) {
      h += '<button class="ac" type="button" data-art="' + esc(a.id) + '">' +
        typedHTML(a.titleFa || a.title, 'bk', artStyle(a)) + '</button>';
    });
  }
  if (s.books && s.books.length) {
    s.books.forEach(function (b) {
      // A book opens on a local scan OR on a remote IIIF manifest the viewer
      // resolves from books-index.json.  Testing only `cover` hid every IIIF
      // book from this list, which is why Fredegarius was visible in one list
      // and dead in the other.
      var openable = b.cover || b.iiifManifest;
      var style = artStyle(b);
      var img = b.cover
        ? '<img alt="" src="' + COVER + esc(b.cover.split('/').pop()) + '">'
        : '<span class="nc"></span>';
      h += openable
        ? '<a class="bc" href="viewer.html?book=' + encodeURIComponent(b.id) + '">' +
            img + typedHTML(b.titleFa || b.title, 'bk', style) + '</a>'
        : '<span class="bc no">' + img + typedHTML(b.titleFa || b.title, 'bk', style) + '</span>';
    });
  }
  return h;
}

/* ---------- one painting ---------- */

function showArt(id) {
  var room = null, art = null;
  (V.man.stops || []).forEach(function (s) {
    (s.artworks || []).forEach(function (a) { if (a.id === id) { art = a; room = s; } });
  });
  if (!art) return;
  if (room.id !== V.room.id) {
    openRoom(room.id);
  }
  // the list must be open for the chosen painting to read as chosen
  openSide();
  var btn = $('side').querySelector('.ac[data-art="' + id + '"]');
  if (btn) btn.classList.add('on');
  // a painting has no ring of its own - its position on the wall is not known -
  // so it opens as a panel anchored on the room, not on a hotspot
  V.open = null;
  var p = $('panel');
  p.className = 'panel in';
  p.innerHTML = artHTML({
    image: art.image, titleFa: art.titleFa, title: art.title,
    artist: art.artist, medium: art.medium, placement: art.placement
  });
  p.style.left = (window.innerWidth - (p.offsetWidth || 300) - 14) + 'px';
  p.style.top = '80px';
  if (art.quote) {
    p.insertAdjacentHTML('beforeend',
      '<p class="note">«' + esc(art.quote) + '»</p>');
  }
  var ring = $('scrim').querySelector('.hs');
  if (ring) ring.classList.add('sel');
}

/* ---------- the atmosphere: one SVG, built once ---------- */

/* Dust, smoke, ghost light and the wandering threads, all as SVG primitives.
 * Built once at boot and never touched again - the layer is identical in every
 * room, and rebuilding it per room would restart every animation on each
 * navigation, which reads as a flicker.
 *
 * ponytail: the threads are drawn across the whole frame rather than between
 * the actual hotspots.  Anchoring a thread to a hotspot needs the hotspot's
 * live pixel position, which changes with the crop; add it when the plan view
 * lands and the anchors become fixed. */
function atmosphere() {
  var svg = $('atmos');
  if (!svg || svg.childNodes.length) return;      // already built
  var NS = 'http://www.w3.org/2000/svg';
  var out = [];
  function el(tag, attrs) {
    var n = document.createElementNS(NS, tag), k;
    for (k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  // deterministic, so a reload draws the same room rather than a new one
  function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  var defs = el('defs', {});
  // one blur for the light and the smoke; a filter per element would be dozens
  defs.appendChild(el('filter', { id: 'soft', x: '-40%', y: '-40%', width: '180%', height: '180%' }));
  defs.appendChild(el('feGaussianBlur', { stdDeviation: '26' }));
  svg.appendChild(defs);

  /* The threads: hairlines that cross the frame.
   *
   * They are BUILT INVISIBLE and lit by a JS ticker, not by a CSS animation.
   * A CSS animation on each thread would need 22 independent, mutually
   * uncoordinated begin offsets, and any two of them overlapping would read as
   * one thick line - the brief is one, two or three at a time, chosen at
   * random, on fractional-second timers.  One rAF ticker can guarantee that,
   * because it is the only thing deciding who is lit.
   *
   * They are also stored with their own life span so a thread can go dark and
   * stay dark, which a looping animation cannot do. */
  /* Pale, desaturated tints.  The saturated originals (#c9702f orange, #b47fd8
   * violet) were drawn at a thin width over a warm photograph, where they read
   * as coloured lines ON TOP of the room rather than as light in the air. */
  var THREADS = ['#e8c9a8', '#bcd2e8', '#e8dcb8', '#c8dcc0', '#dcc4e0'];
  for (var i = 0; i < 22; i++) {
    var y1 = 40 + rnd(i) * 540, x1 = rnd(i + 40) * 1000;
    var y2 = 40 + rnd(i + 80) * 540, x2 = rnd(i + 120) * 1000;
    var bend = 30 + rnd(i + 160) * 120;
    var p = el('path', {
      class: 'thr',
      d: 'M' + x1.toFixed(1) + ',' + y1.toFixed(1) +
         ' Q' + ((x1 + x2) / 2).toFixed(1) + ',' + (y1 + bend * (rnd(i + 200) > .5 ? 1 : -1)).toFixed(1) +
         ' ' + x2.toFixed(1) + ',' + y2.toFixed(1),
      stroke: THREADS[i % THREADS.length]
    });
    /* No opacity attribute here: the stylesheet reads `opacity:var(--lit,0)`,
     * and a presentation attribute would be dead weight. */
    p.style.setProperty('--lit', '0');
    svg.appendChild(p);
  }
  threadTicker();

  /* the ghost light: two ellipses on two different rhythms, so the beam
   * breathes instead of pulsing.  Slightly off-centre - a light dead in the
   * middle of a room photograph reads as a lens flare. */
  var g = el('g', { filter: 'url(#soft)' });
  [['slow', 690, 150, 300, 210], ['fast', 300, 470, 190, 140],
   ['slow', 150, 300, 200, 150], ['fast', 850, 240, 170, 130],
   ['slow', 500, 80, 240, 120]
  ].forEach(function (e, i) {
    var c = el('ellipse', { class: 'glowell ' + e[0], cx: e[1], cy: e[2], rx: e[3], ry: e[4] });
    c.style.animationDelay = (-i * 4) + 's';
    g.appendChild(c);
  });
  svg.appendChild(g);

  /* the smoke: three slow blobs.  Blurred once, far below the eye. */
  var s = el('g', { filter: 'url(#soft)' });
  [['smoke', 250, 520, 300, 130], ['smoke s2', 720, 470, 340, 150],
   ['smoke s3', 480, 250, 250, 110], ['smoke s2', 120, 400, 280, 120],
   ['smoke', 880, 540, 260, 120], ['smoke s3', 620, 140, 300, 130]]
    .forEach(function (e) {
      s.appendChild(el('ellipse', { class: e[0], cx: e[1], cy: e[2], rx: e[3], ry: e[4] }));
    });
  svg.appendChild(s);

  /* The dust: 74 UPWARD specks, plus 46 that hang or sink.
   *
   * The count, size and colour of the rising field are exactly as the brief
   * sent them back: 74, r between 0.3 and 0.85, one warm off-white.  What was
   * added is a second field, not a bigger one - the same specks at the same
   * size, split so that a third of the field drifts downward and a third
   * hangs almost still.
   *
   * One direction reads as weather; two read as air.  A room with only rising
   * dust is a room with a draught in it.  The motes are all still built here,
   * once, and their direction is a CSS custom property: `moteUp` is unchanged,
   * `moteDown` mirrors the translate, and `moteHang` kills the travel and
   * leaves only the opacity, which is what a speck that is not going anywhere
   * looks like.
   *
   * ponytail: mirroring with a negative translate rather than a second
   * keyframe block means the two fields cannot drift out of step - one
   * definition of the motion, used two ways. */
  var d = el('g', {});
  for (var j = 0; j < 120; j++) {
    var mode = j < 74 ? 'up' : (j < 102 ? 'down' : 'hang');
    var m = el('circle', {
      class: 'mote ' + (mode === 'up' ? '' : 'mote' + mode),
      cx: (rnd(j + 300) * 1000).toFixed(1),
      cy: (rnd(j + 340) * 620).toFixed(1),
      r: (0.3 + rnd(j + 380) * 0.55).toFixed(2),
      fill: '#e8ddc9'
    });
    m.style.animationDuration = (14 + rnd(j + 500) * 20).toFixed(1) + 's';
    m.style.animationDelay = (-rnd(j + 540) * 30).toFixed(1) + 's';
    d.appendChild(m);
  }
  svg.appendChild(d);

  /* The haze.
   *
   * The brief asks for the amount of mist to be set differently at random on
   * each visit, from low to high.  That has to be stored, not recomputed: a
   * value re-rolled on every page load would change while the user is reading
   * the page, which is the one thing "on each visit" must not mean.  One key in
   * sessionStorage, so a reload inside one visit keeps its weather and the next
   * visit draws a new sky.
   *
   * Four bands rather than one: one band at a high value is a white wash over
   * the photograph, four bands at different strengths read as depth.
   */
  var HAZE = parseFloat(sessionStorage.getItem('tk-haze')) ;
  if (isNaN(HAZE)) {
    HAZE = Math.random();
    try { sessionStorage.setItem('tk-haze', String(HAZE)); } catch (e) {}
  }
  svg.setAttribute('data-haze', HAZE.toFixed(3));
  var hz = el('g', { class: 'haze', opacity: (HAZE * 0.55).toFixed(2) });
  [['hz1', 500, 560, 620, 190], ['hz2', 260, 340, 460, 150],
   ['hz3', 780, 400, 520, 170], ['hz4', 480, 130, 700, 130]
  ].forEach(function (e, i) {
    var c = el('ellipse', {
      class: e[0], cx: e[1], cy: e[2], rx: e[3], ry: e[4],
      style: 'animation-delay:' + (-i * 3.7).toFixed(1) + 's'
    });
    hz.appendChild(c);
  });
  svg.appendChild(hz);
}


/* ---------- the control dock ----------
 *
 * Auto-hide with a pin.  It hides 1.6s after the pointer leaves the whole
 * screen and comes straight back when the pointer returns, so it never sits
 * over a photograph without a reason.  Pin it and mouseleave stops hiding it,
 * because a control that reappears on hover is a control you cannot aim at.
 *
 * The cross closes it for the rest of the visit and leaves a three-bar handle
 * in the same corner.  Closing is remembered in sessionStorage, like the pin:
 * it is a decision made once, not a thing to undo by moving the mouse, and it
 * must survive a reload inside the same visit.  A closed dock ignores mousemove
 * entirely - otherwise the very first flick of the pointer would bring back the
 * thing the reader just dismissed.
 */
var DOCK = {
  KEY: 'dk-pin',
  CLOSE_KEY: 'dk-closed',
  pinned: false,
  closed: false,
  t: 0
};

function dockInit() {
  try {
    DOCK.pinned = sessionStorage.getItem(DOCK.KEY) === '1';
    DOCK.closed = sessionStorage.getItem(DOCK.CLOSE_KEY) === '1';
  } catch (e) {}
  var d = $('dock');
  if (!d) return;
  if (DOCK.pinned) { d.classList.add('pin'); $('dkPin').classList.add('on'); }
  else dockArm();

  $('dkHome').addEventListener('click', function () { go(''); });
  $('dkOpen').addEventListener('click', function () { dockShow(); });
  $('dkClose').addEventListener('click', function () {
    DOCK.closed = true;
    try { sessionStorage.setItem(DOCK.CLOSE_KEY, '1'); } catch (e) {}
    $('dock').classList.add('hide');
    $('dkOpen').classList.add('on');
    clearTimeout(DOCK.t);
  });
  $('dkPin').addEventListener('click', function () {
    DOCK.pinned = !DOCK.pinned;
    try { sessionStorage.setItem(DOCK.KEY, DOCK.pinned ? '1' : '0'); } catch (e) {}
    $('dkPin').classList.toggle('on', DOCK.pinned);
    $('dock').classList.toggle('pin', DOCK.pinned);
    if (DOCK.pinned) clearTimeout(DOCK.t);
    else dockArm();
  });
  if (DOCK.closed) dockHide();
}

/* Hide after the pointer has been off the page for a moment.  The listener is
 * on document, not on the dock, because the dock is usually not what the
 * pointer is over. */
function dockArm() {
  var d = $('dock');
  if (!d || DOCK.pinned || DOCK.closed) return;
  clearTimeout(DOCK.t);
  DOCK.t = setTimeout(dockHide, 1600);
}

/* One place that hides the dock, so "closed for the visit" and "out of the way
 * for now" cannot disagree about which classes are on it. */
function dockHide() {
  var d = $('dock');
  if (!d || DOCK.pinned) return;
  d.classList.add('hide');
}

function dockShow() {
  var d = $('dock');
  if (!d) return;
  DOCK.closed = false;
  try { sessionStorage.removeItem(DOCK.CLOSE_KEY); } catch (e) {}
  $('dkOpen').classList.remove('on');
  d.classList.remove('hide');
  if (!DOCK.pinned) d.classList.add('pin');
  else clearTimeout(DOCK.t);
}

function dockWake() {
  if (DOCK.closed) return;
  var d = $('dock');
  if (!d || DOCK.pinned) return;
  d.classList.remove('hide');
  dockArm();
}

/* ---------- the thread ticker ----------
 *
 * Every few seconds - on a fractional-second timer, so the beat never lands on
 * the same fraction twice - one, two or three threads are lit for a moment and
 * then go dark and stay dark.  Three at once is the cap the brief sets, and it
 * is enforced here rather than trusted to chance.
 *
 * The delays are fractional because a whole-second tick makes the whole layer
 * look like a metronome: every thread would blink on the same beat.
 */
var THREADS_STATE = { list: [], q: [], raf: 0, next: 0 };

function threadTicker() {
  var svg = $('atmos');
  if (!svg) return;
  var all = svg.querySelectorAll('.thr');
  if (!all.length) return;
  if (THREADS_STATE.list.length) return;      // atmosphere() builds once, but be sure
  for (var i = 0; i < all.length; i++) {
    THREADS_STATE.list.push({ el: all[i], until: 0 });
  }

  function tick(now) {
    if (!now) now = performance.now();
    /* "the SAME threads as before, a few times"
     *
     * The first version picked a fresh random subset from the whole pool on
     * every blink, so no thread ever appeared twice - which is not what a
     * returning thread looks like.  It now keeps a short QUEUE: a thread that
     * blinks goes to the back of the queue, and the next blink takes from the
     * front.  Every thread therefore comes round in turn, and only after all
     * twenty-two have shown does the order reshuffle.  A thread is therefore
     * recognisably the same line you saw before, which is the whole point of a
     * wandering thread. */
    if (now > THREADS_STATE.next) {
      var take = 1 + Math.floor(Math.random() * 3);   // 1, 2 or 3
      for (var n = 0; n < take && THREADS_STATE.q.length; n++) {
        var k = THREADS_STATE.q.shift();
        if (k === undefined) break;
        var life = 420 + Math.random() * 900;          // "a fraction of a second"
        THREADS_STATE.list[k].until = now + life;
        /* 0.14 to 0.46: the brief asks for at least HALF transparent, and the
         * line is also now 0.9px of near-white, so a dim value is enough to
         * see it and nothing here can ever read as a stroke. */
        lit(THREADS_STATE.list[k].el, 0.14 + Math.random() * 0.32);
        THREADS_STATE.q.push(k);                      // back of the queue
      }
      // queue exhausted: reshuffle, so the order is not the same every cycle
      if (!THREADS_STATE.q.length) {
        for (var r = 0; r < THREADS_STATE.list.length; r++) THREADS_STATE.q.push(r);
        for (var s2 = THREADS_STATE.q.length - 1; s2 > 0; s2--) {
          var j2 = Math.floor(Math.random() * (s2 + 1));
          var tmp = THREADS_STATE.q[s2]; THREADS_STATE.q[s2] = THREADS_STATE.q[j2];
          THREADS_STATE.q[j2] = tmp;
        }
      }
      THREADS_STATE.next = now + 3400 + Math.random() * 5200;
    }
    for (var m = 0; m < THREADS_STATE.list.length; m++) {
      var th = THREADS_STATE.list[m];
      if (th.until > now) continue;
      // past its life: dark again, and it stays dark until the queue deals it
      if (th.lit !== 0) lit(th.el, 0);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function lit(el, v) {
    el._lit = v;
    /* --lit, not the opacity attribute.
     *
     * THE reason the threads were never visible: the stylesheet carried
     * `.thr{opacity:0}` as its "unlit" default, and a declaration in a rule
     * beats a presentation attribute on the element.  The ticker wrote
     * `setAttribute('opacity', 0.7)` sixty times a second and the browser
     * painted every one of them at exactly zero.  The ticker was right and
     * the lines were invisible, for as long as that rule existed.
     *
     * `opacity:var(--lit,0)` has the same resting value and no such conflict:
     * with no --lit set, the fallback is 0; the moment the ticker writes one,
     * the declaration resolves to it. */
    el.style.setProperty('--lit', String(v));
  }
}
/* ---------- the type-in ---------- */

/* A book name types itself in, then the caret retires.  One animation per line,
 * driven by a --n step count and a --w width, so no timer is needed per letter.
 * `--n` has to exceed the character count or steps() clips the text short. */
/* One character at a time, with a caret.  The box is sized in ch units, which
 * is one step too wide in a Persian serif - "0" is wider than a Persian glyph,
 * so the animation would end 20px past the last letter and the last letters
 * would flash and vanish.  The only honest way to size a box to a word is to
 * measure the word, which needs the element, so this returns the markup and the
 * widths are filled in by measureTyped() once the DOM has it. */
function typedHTML(text, cls, style) {
  var n = String(text).length + 1;
  return '<span class="' + cls + ' typed" data-len="' + n + '" style="' +
    (style || '--n:' + n) + '">' + esc(text) + '</span>';
}

/* Fill --w for every typed name.  One canvas, one pass, no reflow: the text is
 * measured off-screen and the width is written as a real pixel value, so the
 * animation ends exactly on the last letter and not one pixel past it.
 * ponytail: this measures the font as loaded, so a font that arrives late (web
 * font swap) leaves --w stale by a few pixels.  Re-measure on document.fonts
 * .ready when that matters; here the fonts are local and load first paint. */
function measureTyped(root) {
  if (!root) return;
  var c = document.createElement('canvas');
  var g = c.getContext('2d');
  var els = root.querySelectorAll('.typed[data-len]');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    g.font = getComputedStyle(el).font;
    var w = g.measureText(el.textContent).width;
    // +2px so the final glyph's own advance is not clipped by sub-pixel rounding
    el.style.setProperty('--w', (w + 2).toFixed(1) + 'px');
  }
}

/* ---------- go ---------- */

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// The typed widths are measured in the font as it renders.  A web font that
// swaps in later would leave every name a few pixels too short, so measure once
// more when the font set settles.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(function () {
    measureTyped($('side'));
    measureTyped($('panel'));
  });
}