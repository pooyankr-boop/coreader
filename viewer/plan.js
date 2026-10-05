/* plan.js - the entrance view.
 *
 * The first thing the tour shows.  A single photograph of the entrance hall
 * seen from the front door, with the rest of the house readable through its
 * doorways.  Four openings are real and get a hotspot; the small left arch
 * shows a chair and candles, not a bed, so it is left unlabelled rather than
 * given a room it is not.
 *
 * A hotspot is a ring you do not read: hover it and the room's own photograph
 * rises out of its opening, larger than the ring, pulsing, and drifts right to
 * left inside its frame.  Click and you are in the room.
 */

var PLAN = {
  src: 'img/plan-entrance.jpg',
  /* Eleven rings, one per room, ordered by walking depth so the painting order
   * is right when two of them touch.  None of them overlap.
   *
   * MEASURED, not guessed.  The blue tile of the arch was found by scanning for
   * saturated blue in the middle third; the red room light by scanning for
   * red-minus-blue; the staircase by finding the column with the highest
   * vertical contrast.  Every ring was then checked against a drawn overlay.
   * x/y are percent of the frame, r is percent of the short side.
   *
   * ponytail: five of these sit on floor or panelling rather than on a doorway,
   * because the photograph has no opening there.  The floor rings are the ones
   * the brief asked for by position; they are smaller and paler so they do not
   * claim a door that is not in the picture.  Move them when a second entrance
   * photograph exists.
   *
   * `cellar` is the tiled arch - the passage under the stair in the fiction -
   * but the photograph shows solid panelling where the stairs meet the wall, so
   * it is marked `off`: drawn, so the plan admits the place exists, but with no
   * card and no link until its view is built.
   *
   * Twelve rings, one per room that is reachable FROM THIS PHOTOGRAPH.
   * `boudoir` is deliberately not one of them: it lives inside the entrance
   * hall, so it has its own pink hotspot there and nowhere else.  A highlight
   * that answers the hover on the wrong view is the thing this plan was built
   * to stop having.
   *
   * `entrance-hall` sits on the floor at the bottom centre (56, 88) - the
   * warmest patch of floor in the photograph, measured, which is where you are
   * standing.  The ring has to be on the floor you are standing on. */
  spots: [
    { id: 'attic',         x: 50.0, y: 11.5, r: 2.4 },
    { id: 'kitchen',       x: 59.7, y: 32.8, r: 2.4 },
    { id: 'cellar',        x: 48.4, y: 38.0, r: 5.6,
      /* the tiled arch under the stair now leads to the other tour */
      href: '../tour/index.html',
      title: 'زیرزمین — تور خانهٔ زیرزمینی',
      image: '../tour/rooms/konj.jpg' },
    { id: 'bedroom',       x: 34.0, y: 45.0, r: 3.4 },
    { id: 'dining-cabin',  x: 70.0, y: 47.0, r: 2.8 },
    { id: 'water-closet',  x: 60.5, y: 50.0, r: 2.6 },
    { id: 'dining-outer',  x: 74.0, y: 66.0, r: 2.6 },
    { id: 'drawing-room',  x: 17.0, y: 50.0, r: 8.0 },
    { id: 'library',       x: 82.0, y: 50.0, r: 8.0 },
    { id: 'entrance-hall', x: 56.0, y: 88.0, r: 6.2 },
    { id: 'study',         x: 92.0, y: 84.0, r: 4.4 },
    { id: 'dressing-room', x:  8.0, y: 86.0, r: 4.8 }
  ]
};

var P = { on: false, hot: [], spark: null, sparkSvg: null, sparkMx: 0, sparkMy: 0 };

function planSpots() {
  return PLAN.spots.map(function (s) { return s.id; });
}

/* Is there a room to go to?  A spot with no stop is decoration. */
function planRoom(id) {
  return (P.man.stops || []).filter(function (r) { return r.id === id; })[0] || null;
}

function showPlan() {
  P.on = true;
  var el = $('plan');
  el.className = 'plan on';
  $('room').className = 'room';
  $('list').className = 'list off';
  closePanel();
  closeSide();
  var img = $('pimg');
  if (!img.getAttribute('src')) img.src = res(PLAN.src);
  renderPlanSpots();
}

function hidePlan() {
  P.on = false;
  var el = $('plan');
  el.className = 'plan';
  hideCard();
  renderPlanSpots();
}

/* ---------- the rings ---------- */

function renderPlanSpots() {
  var sc = $('plan');
  if (!sc) return;
  // Clear by one sweep, not by index: removing while walking a live NodeList
  // skips elements, and the skipped ring stays on the photograph forever.
  var old = sc.querySelectorAll('.ph');
  for (var i = old.length - 1; i >= 0; i--) {
    if (old[i].parentNode) old[i].parentNode.removeChild(old[i]);
  }
  if (!P.on) return;
  PLAN.spots.forEach(function (s) {
    var room = planRoom(s.id);
    var el = document.createElement('button');
    el.className = 'ph';
    el.type = 'button';
    el.setAttribute('data-room', s.id);
    el.setAttribute('aria-label', room ? room.title : s.id);
    el.style.left = s.x + '%';
    el.style.top = s.y + '%';
    /* --k is the VISIBLE radius in vh; CSS doubles the element to 4x so the
     * gradient's falloff fades to nothing before the box ends, which is what
     * leaves the mark without a rim. */
    el.style.setProperty('--k', s.r + 'vh');
    /* `off` is a spot that is drawn but not yet wired: no card on hover and no
     * navigation on click.  It is not `dim` - `dim` means "no room behind this
     * opening", and the cellar has a room; it means "the view and the link are
     * still to be built", which is a different promise from a missing room. */
    if (s.href) {
      /* a door into the other tour: card on hover, navigate on click */
      el.setAttribute('aria-label', s.title || s.id);
      el.addEventListener('mouseenter', function () { showCard(s, { title: s.title, image: s.image }); sparkOn(); });
      el.addEventListener('focus', function () { showCard(s, { title: s.title, image: s.image }); });
      el.addEventListener('mouseleave', hideCard);
      el.addEventListener('blur', hideCard);
      el.addEventListener('click', function () { location.href = s.href; });
    } else if (s.off) {
      el.className = 'ph off';
      el.setAttribute('aria-disabled', 'true');
    } else if (room) {
      el.addEventListener('mouseenter', function () { showCard(s, room); sparkOn(); });
      el.addEventListener('focus', function () { showCard(s, room); });
      el.addEventListener('mouseleave', hideCard);
      el.addEventListener('blur', hideCard);
      el.addEventListener('click', function () { go('#' + s.id); });
    } else {
      // no room behind this opening yet - visible, but not a promise
      el.className = 'ph dim';
      el.setAttribute('aria-disabled', 'true');
    }
    sc.appendChild(el);
  });
  sparkBuild();
  // one listener on the stage, not one per ring: eleven rings each tracking the
  // pointer is eleven chances to leak one when the plan is re-rendered
  if (!sparkMove._wired) {
    var stage = $('stage') || document;
    stage.addEventListener('mousemove', sparkMove, { passive: true });
    sparkMove._wired = true;
  }
}

/* ---------- the hover card ---------- */

function showCard(s, room) {
  var card = $('thumb');
  var img = $('timg');
  img.src = res(room.image);
  img.alt = room.title;
  /* The card is sized off the VIEWPORT, not off the ring.  Sized from the ring
   * it would be 90px across on the small rings and show a photograph of
   * nothing; sized from the viewport every ring answers with a frame you can
   * actually see, and the twelve rings stay comparable to each other. */
  var w = Math.max(260, Math.min(560, window.innerWidth * 0.34));
  var h = Math.max(165, w * 0.6);
  card.style.width = w + 'px';
  card.style.height = h + 'px';
  startScan();
  // keep the card inside the frame: the two big openings sit at 15% and 84.5%,
  // so a card centred on them would hang off the edge
  var cx = s.x, cy = s.y;
  var halfW = w / 2 / window.innerWidth * 100;
  var halfH = h / 2 / window.innerHeight * 100;
  cx = Math.min(Math.max(cx, halfW), 100 - halfW);
  cy = Math.min(Math.max(cy, halfH), 100 - halfH);
  card.style.left = cx + '%';
  card.style.top = cy + '%';
  // centre with margins: transform is the pulse's alone
  card.style.marginLeft = (-w / 2) + 'px';
  card.style.marginTop = (-h / 2) + 'px';
  card.className = 'thumb on';

  var gl = $('glow'), g2 = $('glow2');
  var gsz = Math.max(150, w * 0.55);
  [gl, g2].forEach(function (g, k) {
    if (!g) return;
    var ox = k === 0 ? -w * 0.28 : w * 0.28;
    var gr = gsz / 2;
    var px = Math.min(Math.max(s.x + ox, gr / window.innerWidth * 100),
                       100 - gr / window.innerWidth * 100);
    var py = Math.min(Math.max(s.y, gr / window.innerHeight * 100),
                       100 - gr / window.innerHeight * 100);
    g.style.width = gsz + 'px';
    g.style.height = gsz + 'px';
    g.style.left = px + '%';
    g.style.top = py + '%';
    g.style.transform = 'translate(-50%,-50%)';
    g.className = 'glow on';
  });
}

function hideCard() {
  stopScan();
  var card = $('thumb');
  if (card) card.className = 'thumb';
  var gl = $('glow'), g2 = $('glow2');
  [gl, g2].forEach(function (g) { if (g) g.className = 'glow'; });
  // the light follows the pointer out of the ring too
  sparkOff();
}


/* ---------- the room scan ----------
 *
 * The photograph is walked, not slid.
 *
 * The CSS version failed, and it failed in a way worth writing down: a single
 * translateX keyframe always starts at 0, so on a hover that began while the
 * animation was already mid-cycle the first frame the user saw was the image
 * at its far edge - parked outside the frame.  It could not start "from
 * wherever it is", because a CSS animation has no memory of the last one.
 *
 * So the walk is JS.  One requestAnimationFrame loop, a zoom that eases in from
 * 1.0, a pan across the image, and when the pan reaches either end the zoom
 * eases back out and the pan starts again - the other way if the last run was
 * going right, the same way if not.  Every leg is on its own clock, so the
 * motion never repeats exactly.
 *
 * ponytail: zoom and pan are two separate lerps rather than one path.  That
 * means the corner of the frame is not perfectly pinned during a reversal - a
 * fraction of a pixel for a few frames.  Fix it if it becomes visible.
 */
var SCAN = { raf: 0, t0: 0, zoom: 1, dur: 5, dir: 1, leg: 'in', legT: 0 };

function scanState() {
  return { z: SCAN.zoom, d: SCAN.dir, l: SCAN.leg };
}

function startScan() {
  stopScan();
  var img = $('timg');
  if (!img) return;
  // reduced motion gets a still frame in the middle of the picture, which is the
  // one thing the old broken version could not promise
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    applyScan(img, 0, 0, 1.1);
    return;
  }
  // begin from the middle of the photograph, zoomed IN: starting at the edge is
  // what made the old version look broken
  SCAN.zoom = 1.03;
  SCAN.dur = 4.5 + Math.random() * 2.5;
  SCAN.dir = Math.random() < 0.5 ? 1 : -1;
  SCAN.leg = 'in';
  SCAN.legT = 0;
  SCAN.t0 = performance.now();
  applyScan(img, 0, 0, SCAN.zoom);
  SCAN.raf = requestAnimationFrame(scanTick);
}

function stopScan() {
  if (SCAN.raf) cancelAnimationFrame(SCAN.raf);
  SCAN.raf = 0;
}

function applyScan(img, tx, ty, z) {
  // px, not %: scanTick measures the card and the image in pixels
  img.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) scale(' + z.toFixed(3) + ')';
}

/* One leg = one eased move.  'in' and 'out' change the zoom; 'pan' walks the
 * frame across the image; each leg picks a fresh random direction and a fresh
 * random duration so the loop is never the same twice.
 *
 * The pan is computed in PIXELS, not in percentages, and that is the whole fix
 * for "the photograph sometimes starts outside the frame".  A percentage here
 * is a percentage of the <img>'s own width, and the <img> is 2.4x the card, so
 * 30% of it is 72% of the card - the frame slides off the picture and shows
 * background.  Measuring the card and the image lets the walk stay inside the
 * two rectangles that actually have to overlap.
 *
 * Max pan is how far the image can move while its right edge (or left) still
 * covers the card.  Any more and the card shows empty space; any less and the
 * walk is not a walk. */
function scanTick(now) {
  var img = $('timg'), card = $('thumb');
  if (!img || !card || !/on/.test(card.className)) { SCAN.raf = 0; return; }
  var t = (now - SCAN.t0) / 1000;
  /* Smootherstep, not easeInOut.
   *
   * easeInOut is fastest at its midpoint, and that slope is where the visible
   * jump came from: a sample landing near the midpoint moved several times
   * further than the ones beside it, which reads as a hitch even though every
   * frame is small.  Smootherstep (6t^5 - 15t^4 + 10t^3) has zero slope at
   * both ends AND at the middle, so the motion accelerates and decelerates in
   * two soft halves and no single frame stands out.
   *
   * ponytail: it costs one more power than easeInOut and it is not C1 at the
   * seam between two legs.  The seam is invisible because the value and the
   * slope are continuous there by construction. */
  var ease = function (x) { return x * x * x * (x * (x * 6 - 15) + 10); };

  var cw = card.offsetWidth, iw = img.offsetWidth;
  if (!cw || !iw) { SCAN.raf = requestAnimationFrame(scanTick); return; }
  // slack = how much the image overhangs the card, before any zoom
  var slack = Math.max(0, iw - cw);
  var maxPan = slack / 2;                    // centre the frame at the extremes
  var z = SCAN.zoom;

  /* The legs are long and the zoom band is narrow.  The first version moved
   * through this in about nine seconds with a 1.22 -> 1.95 scale, and it read as
   * a jump rather than a walk: the eye tracks the frame edge, so a fast scale
   * change is felt before it is seen.  Each leg is now roughly twice as long
   * and the zoom moved by a third of a stop, which was still too much: the
   * brief came back asking for less again.  It now runs 1.03 -> 1.11, an eight
   * percent band, so the walk opens almost at rest and the picture is being
   * walked rather than pushed.  What carries the sense of movement is the pan,
   * which is why the photograph is 3.4x the card: at this zoom there has to be
   * room left to walk into. */
  if (SCAN.leg === 'in') {
    var k = Math.min(1, t / SCAN.dur);
    SCAN.zoom = 1.03 + (1.11 - 1.03) * ease(k);
    applyScan(img, 0, 0, SCAN.zoom);
    if (k >= 1) { SCAN.leg = 'pan'; SCAN.dur = 11 + Math.random() * 9; SCAN.t0 = now; }
  } else if (SCAN.leg === 'pan') {
    var k2 = Math.min(1, t / SCAN.dur);
    // a fresh direction for THIS run: the brief asks for the scroll to reverse
    // at random, not to continue in whatever direction the last one ended
    if (k2 < 1 && SCAN.legT === 0) {
      SCAN.legT = 1;
      SCAN.dir = Math.random() < 0.5 ? 1 : -1;
    }
    /* The pan is a FRACTION OF THE CARD, not of the zoomed slack.
     *
     * Deriving it from the slack is arithmetically correct - it is the only way
     * to stay inside the picture - but at a mild zoom it leaves almost nothing:
     * at 1.42 on a 462px card the whole pan is 95px, a fifth of the frame, and
     * the room appears not to move at all.  At the 1.95 the first version used
     * it was 320px, which is a walk.
     *
     * So the two are decoupled: the zoom stays mild (a fast scale change is
     * what the eye reads as a jump) and the pan takes as much of the slack as
     * the CURRENT zoom allows, spread over the whole card width.  The clamp
     * below is what actually keeps the frame on the photograph; the fraction is
     * only how much of that allowance to use.
     *
     * ponytail: at the mildest zoom the pan cannot reach a full card width,
     * because the image is not that much wider than the frame.  That is the
     * photograph, not the maths: there is nowhere further to go. */
    var allow = Math.max(0, slack / Math.max(1, SCAN.zoom) - cw);
    var room = Math.min(allow, cw * 0.42);
    applyScan(img, SCAN.dir * room * ease(k2), 0, SCAN.zoom);
    if (k2 >= 1) { SCAN.leg = 'out'; SCAN.legT = 0; SCAN.dur = 4.2 + Math.random() * 2.4; SCAN.t0 = now; }
  } else {
    var k3 = Math.min(1, t / SCAN.dur);
    SCAN.zoom = 1.11 - (1.11 - 1.0) * ease(k3);
    // drift back toward the middle as it zooms out: the frame ends up centred,
    // never parked against an edge
    applyScan(img, SCAN.dir * maxPan * (1 - k3) * 0.9, 0, SCAN.zoom);
    if (k3 >= 1) { SCAN.leg = 'in'; SCAN.legT = 0; SCAN.dur = 4.5 + Math.random() * 2.5; SCAN.t0 = now; }
  }
  SCAN.raf = requestAnimationFrame(scanTick);
}


/* ---------- the sparkle under the pointer ----------
 *
 * A short spiral of light around the cursor, drifting IN and OUT on a very slow
 * rotation.  It is drawn in the plan layer at z-index 4 so it sits over the
 * photograph but under the card.
 *
 * ponytail: it follows the pointer through one listener on the stage rather
 * than one per ring, because eleven rings each tracking a pointer is eleven
 * chances to leak a listener.
 */
var SPARK = { r: 0, a: 0, raf: 0, mx: 0, my: 0, on: false };

function sparkBuild() {
  var svg = $('spark');
  if (!svg) return;
  // renderPlanSpots() runs on every showPlan/hidePlan, and an unguarded build
  // stacked a second set of fourteen lights on the first: twenty-eight, all
  // drawing over each other.
  if (P.spark) return;
  var NS = 'http://www.w3.org/2000/svg';
  var g = document.createElementNS(NS, 'g');
  for (var i = 0; i < 14; i++) {
    var c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', (0.0016 + (i % 3) * 0.0009).toFixed(4));
    c.setAttribute('fill', i % 3 === 0 ? '#ffd89a' : (i % 3 === 1 ? '#ffb35c' : '#cfe0ff'));
    g.appendChild(c);
  }
  svg.appendChild(g);
  P.spark = g;
  P.sparkSvg = svg;
}

function sparkMove(e) {
  P.sparkMx = e.clientX; P.sparkMy = e.clientY;
}

function sparkTick(now) {
  if (!P.spark) { SPARK.raf = 0; return; }
  if (!SPARK.on) { SPARK.raf = 0; P.spark.setAttribute('opacity', '0'); return; }
  // very slow: a full turn every ~9s, and the radius breathes by a third of it
  SPARK.a += (now - (SPARK.last || now)) / 9000 * Math.PI * 2;
  SPARK.last = now;
  sparkStep();
  SPARK.raf = requestAnimationFrame(sparkTick);
}

function sparkStep() {
  var g = P.spark;
  /* The svg's user space is 1x1 stretched over the viewport, so every number
   * here is a FRACTION OF THE SCREEN, not a pixel.  This is why the radius is
   * 0.032 and not 32: without the scale, one dot would be thirty-two screens
   * wide. */
  var base = 0.034, amp = 0.013;
  var kids = g.childNodes;
  for (var i = 0; i < kids.length; i++) {
    var ph = SPARK.a + (i / kids.length) * Math.PI * 2;
    var rr = base + Math.sin(ph * 2 + i) * amp;
    kids[i].setAttribute('cx', (P.sparkMx / window.innerWidth).toFixed(4));
    kids[i].setAttribute('cy', (P.sparkMy / window.innerHeight).toFixed(4));
    kids[i].setAttribute('r', (0.0016 + (i % 3) * 0.0009).toFixed(4));
    // the spiral: each dot rides its own orbit radius, so the ring of light
    // winds inward and outward instead of turning as a solid wheel
    kids[i].setAttribute('transform',
      'translate(' + (Math.cos(ph) * rr).toFixed(4) + ',' +
                      (Math.sin(ph) * rr * 0.74).toFixed(4) + ')');
    kids[i].setAttribute('opacity',
      (0.2 + 0.55 * Math.abs(Math.sin(ph * 1.5))).toFixed(2));
  }
  g.setAttribute('opacity', '1');
}

function sparkOn() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  SPARK.on = true;
  // place it on the pointer NOW: waiting for the first rAF left the light a
  // frame behind the cursor, which on a fast mouse is visible as a lag
  if (P.spark) { P.spark.setAttribute('opacity', '1'); sparkStep(0); }
  if (!SPARK.raf) { SPARK.last = 0; SPARK.raf = requestAnimationFrame(sparkTick); }
}

function sparkOff() {
  SPARK.on = false;
  if (P.spark) P.spark.setAttribute('opacity', '0');
}