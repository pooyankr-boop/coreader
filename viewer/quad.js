/* quad() turns four clicked corners into the seven numbers the engine needs.
 * Kept as a separate file so it can be tested without a browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.quad = factory();
})(this, function () {
  'use strict';

  /* Four clicked points -> x, y, w, h, tilt, rise, lift.
   *
   * The order of the clicks does NOT matter.  A person clicking the corners
   * of a frame goes clockwise, or counter-clockwise, or starts from any
   * corner.  A version that read them as tl, tr, br, bl in click order turned
   * the vertical gap between two corners into rise and lift, and reported
   * lift=0.724 for a frame whose edges are almost level - a rhombus, not a
   * keystone.  So the corners are sorted here, from the points themselves:
   * the two highest are the top edge, the two lowest the bottom edge, and
   * within each edge the left point comes first.
   *
   * Every value is a fraction of the frame's own size, never of the page, so
   * the numbers hold whatever size the picture is displayed at.
   *
   * tilt : the keystone.  The far edge of a frame on a receding wall is
   *        shorter, so the top and bottom edges have different lengths.
   *        Positive when the top edge is the wider of the two.
   * rise : how far the top edge climbs toward its high end, over the frame
   *        width.  Zero for a level top edge.
   * lift : the same for the bottom edge.
   *
   * Returns '' when there are not four corners, or when they cannot be a
   * frame: a partial placement must never be used, because a painting in the
   * wrong place is worse than no painting.
   */
  return function quad(o) {
    var c = o && o.c;
    if (!c || c.length < 4) return '';

    // Sort by y ascending.  y grows downward, so pts[0] is the HIGHEST of the four
    // and pts[3] the lowest: the top edge is the first two, the bottom edge the
    // last two.  Within each edge, sort by x so the left point comes first.
    var pts = c.slice(0, 4).slice().sort(function (a, b) { return a[1] - b[1]; });
    var top = pts.slice(0, 2).sort(function (a, b) { return a[0] - b[0]; });
    var bot = pts.slice(2).sort(function (a, b) { return a[0] - b[0]; });
    var tl = top[0], tr = top[1];
    var bl = bot[0], br = bot[1];

    // Once sorted, pts[0] is the highest and pts[3] the lowest, so a real
    // frame always has pts[0].y < pts[3].y.  Comparing anything else can be
    // negative for a tilted frame and refuses a good one.
    if (pts[0][1] >= pts[3][1]) return '';

    var xs = c.map(function (p) { return p[0]; });
    var ys = c.map(function (p) { return p[1]; });

    // w and h are the widest and tallest spans, so a frame seen at an angle
    // still gets its full extent instead of the average of two short sides
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);

    // the widest and tallest spans, so a frame seen at an angle keeps its
    // full extent instead of being averaged down to its two short sides.
    // Built from min/max, so a right-to-left drag cannot give a negative size.
    var w = maxX - minX;
    var h = maxY - minY;
    if (!(w > 0) || !(h > 0)) return '';

    var topW = Math.abs(tr[0] - tl[0]);
    var botW = Math.abs(br[0] - bl[0]);
    var meanW = (topW + botW) / 2;
    if (!meanW) return '';

    var tilt = (topW - botW) / meanW;

    // rise and lift are the SLOPE of each edge, and a slope is rise over run.
    //
    // The run is the frame's WIDTH, because the top edge runs left-to-right:
    // it climbs by N pixels across the frame's own width.  Dividing by the
    // height instead is what produced rise = 1.19 on a frame 34 px wide,
    // which would tilt it 50 degrees off vertical.  Cross-checked against the
    // reader's own clicks on entrance-hall: four frames of four different
    // sizes all came out at about 15% of their own height once read that way,
    // which is what a row of prints on one wall actually looks like.
    //
    // The SIGN follows the engine, not intuition.  The CSS is
    //   matrix3d(1,0,0,0, --tilt,1,0,0, 0,--rise,1,0, 0,--lift,0,1)
    // where element 5 is m21, so y' = rise*x + y: a POSITIVE rise pushes the
    // right side DOWN.  Since y grows downward, an edge that climbs toward
    // the right has tr.y < tl.y and comes out negative.
    var rise = (tr[1] - tl[1]) / w;
    var lift = (br[1] - bl[1]) / w;

    // x and y are the CENTRE of the frame: that is what the red marker showed
    // on screen, and the engine places the image with translate(-50%,-50%).
    var x = minX + w / 2;
    var y = minY + h / 2;

    return {
      x: +x.toFixed(3), y: +y.toFixed(3),
      w: +w.toFixed(3), h: +h.toFixed(3),
      // the four corners as percentages of the frame's own box, corner 1 at
      // the top-left of the box.  A keystone is exactly these four points;
      // deriving slopes from them and adding those back onto a centre line
      // collapsed a level wall to zero area, because on a flat wall rise and
      // lift come out equal.
      tl: [+((tl[0] - minX) / w * 100).toFixed(3), +((tl[1] - minY) / h * 100).toFixed(3)],
      tr: [+((tr[0] - minX) / w * 100).toFixed(3), +((tr[1] - minY) / h * 100).toFixed(3)],
      br: [+((br[0] - minX) / w * 100).toFixed(3), +((br[1] - minY) / h * 100).toFixed(3)],
      bl: [+((bl[0] - minX) / w * 100).toFixed(3), +((bl[1] - minY) / h * 100).toFixed(3)],
      // kept for the record and for the tests: what the three numbers say
      tilt: +tilt.toFixed(4),
      rise: +rise.toFixed(4),
      lift: +lift.toFixed(4)
    };
  };
});