/* Tour of the house of Des Esseintes.
 *
 * One page, one manifest, no framework - the same slot the museum section uses
 * (source: 'against-nature' in books-index.json) so the existing reader needs
 * no change.  The tour degrades on purpose: a stop with no room picture still
 * opens and shows its text and its hung artworks, and a painting whose scan
 * fails shows a caption instead of a broken box.
 *
 * No alert()/confirm()/prompt() anywhere - the desktop webview throws on those.
 */
(function () {
  'use strict';

  var MANIFEST = '../books/contre-nature/manifest.json';
  var mem = { man: null, list: [], open: null, base: '' };

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* Manifest-relative resolution.  The manifest lives in books/contre-nature/
   * and the page may sit at any depth (viewer/, or the site root after deploy),
   * so every path in the manifest is joined against the manifest's own folder -
   * the same rule a IIIF canvas resource uses.  A leading '/' would break the
   * GitHub Pages subpath, and a page-relative path would break the root. */
  function res(p) {
    if (!p) return '';
    if (/^(https?:)?\/\//.test(p) || p.charAt(0) === '/') return p;
    return mem.base + p;
  }

  /* A failed image must leave a readable gap, never a torn icon. */
  function imgOr(src, alt, holder, missing) {
    var i = new Image();
    i.alt = alt || '';
    i.loading = 'lazy';
    i.decoding = 'async';
    if (src) i.src = src;
    i.onerror = function () {
      if (missing) { holder.textContent = ''; holder.appendChild(el('span', null, missing)); }
    };
    return i;
  }

  /* ---------- the list of rooms ---------- */

  function allStops() {
    if (!mem.man) return [];
    return (mem.man.stops || []).concat(mem.man.memories || []);
  }

  function roomCard(s) {
    var a = document.createElement('a');
    a.className = 'room';
    a.href = '#' + s.id;
    a.setAttribute('data-id', s.id);

    var t = el('div', 'thumb');
    if (s.image) {
      var i = new Image();
      i.alt = '';
      i.loading = 'lazy';
      i.src = res(s.image);
      i.onerror = function () { t.textContent = ''; t.appendChild(el('span', 'none', 'تصویر اتاق هنوز ساخته نشده')); };
      t.appendChild(i);
    } else {
      t.appendChild(el('span', 'none', 'تصویر اتاق هنوز ساخته نشده'));
    }
    a.appendChild(t);

    var m = el('div', 'meta');
    var n = 0, ix = allStops().findIndex(function (x) { return x.id === s.id; });
    if (ix >= 0) n = ix + 1;
    m.appendChild(el('div', 'n', n ? ('ایستگاه ' + n) : 'یادگار'));
    m.appendChild(el('h2', null, s.title));
    if (s.quote) m.appendChild(el('div', 'q', s.quote.replace(/\s+/g, ' ')));

    var tags = el('div', 'tags');
    if (s.artworkCount) tags.appendChild(el('span', 'tag', s.artworkCount + ' تابلو'));
    if (s.hasOpenImages) tags.appendChild(el('span', 'tag', s.hasOpenImages + ' تصویر باز'));
    if (s.review) {
      var r = el('span', 'tag review ' + reviewClass(s.review), reviewText(s.review));
      r.title = s.review;
      tags.appendChild(r);
    }
    if (tags.childNodes.length) m.appendChild(tags);
    a.appendChild(m);
    return a;
  }

  /* The review string is English build data; the badge is Persian, because the
   * reader must never see "redo" on a page that is otherwise Persian.
   * "carry-over" is its own state: the row was written for an earlier picture
   * and nobody has re-read the installed one, so it must not show green. */
  function reviewClass(r) {
    if (/^ok\b/.test(r)) return 'ok';
    if (/^carry-over\b/.test(r)) return 'none';
    if (/^unverified/.test(r)) return 'none';
    return 'redo';
  }
  function reviewText(r) {
    if (/^ok\b/.test(r)) return 'بازبینی‌شده';
    if (/^carry-over\b/.test(r)) return 'بازبینی‌نشده — از عکس قبلی';
    if (/^unverified/.test(r)) return 'بازبینی‌نشده';
    if (/^unchecked/.test(r)) return 'بازبینی‌نشده';
    return 'نیاز به بازتولید';
  }

  function renderList() {
    var box = $('tour');
    box.textContent = '';
    if (!mem.man) { box.appendChild(el('p', 'empty', 'مانیفست بارگذاری نشد.')); return; }

    var stops = mem.man.stops || [], mems = mem.man.memories || [];

    if (stops.length) {
      stops.forEach(function (s) { box.appendChild(roomCard(s)); });
    }
    if (mems.length) {
      var h = el('h3', 'sec', 'یادگارها — خارج از خانهٔ فونتنی');
      h.style.gridColumn = '1 / -1';
      box.appendChild(h);
      mems.forEach(function (s) { box.appendChild(roomCard(s)); });
    }
  }

  /* ---------- one room ---------- */

  /* A painting opens a reader.  The tour's promise is that a reserved frame is
   * not decoration: clicking one shows the real scan with the novel's line
   * about it.  Same pattern as the museum section, no dialog, no alert(). */
  function openArt(aid) {
    var list = allStops();
    var found = null, room = null;
    for (var i = 0; i < list.length; i++) {
      var hit = (list[i].artworks || []).filter(function (x) { return x.id === aid; })[0];
      if (hit) { found = hit; room = list[i]; break; }
    }
    if (!found) return;

    var box = $('artView');
    var im = $('aIm');
    var holder = $('aHolder');
    holder.textContent = '';
    im.hidden = false;
    im.alt = found.title || '';
    im.src = res(found.image);
    im.onerror = function () {
      im.hidden = true;
      holder.textContent = found.noOpenImage || 'تصویر این تابلو در دسترس نیست.';
    };
    $('aTitle').textContent = found.title || 'بی‌نام';
    $('aMeta').textContent = [found.titleFa, found.artist, found.medium]
      .filter(Boolean).join(' — ');
    $('aRoom').textContent = 'در اتاق: ' + room.title;
    $('aPlace').textContent = found.placement
      ? ('جای‌گذاری در اتاق (عینِ متن رمان): ' + found.placement) : '';
    $('aLic').textContent = found.license ? ('مجوز: ' + found.license) : '';
    var q = $('aQuote');
    q.textContent = '';
    if (found.quote) {
      q.appendChild(document.createTextNode('«' + found.quote + '»'));
      q.appendChild(el('span', 'src', '— از متن رمان'));
    }
    var lnk = $('aLink');
    if (found.imagePage) {
      lnk.hidden = false; lnk.href = found.imagePage;
    } else { lnk.hidden = true; }
    box.hidden = false;
  }

  function artCard(a) {
    var c = el('div', 'art');
    // placement is the novel's own phrase, kept verbatim; only the label is ours
    if (a.placement) {
      var pl = el('div', 'pl');
      pl.appendChild(el('span', 'lb', 'جای‌گذاری در اتاق: '));
      pl.appendChild(el('q', null, a.placement));
      c.appendChild(pl);
    }

    var im = el('div', 'im');
    var why = a.noOpenImage
      ? a.noOpenImage
      : 'تصویر این تابلو در دسترس نیست.';
    im.appendChild(imgOr(res(a.image), a.title, im, why));
    // the whole card is the button
    im.classList.add('clickable');
    im.setAttribute('role', 'button');
    im.setAttribute('tabindex', '0');
    im.setAttribute('aria-label', 'گشودن ' + (a.title || 'تابلو'));
    im.addEventListener('click', function () { openArt(a.id); });
    im.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openArt(a.id); }
    });
    c.appendChild(im);

    var b = el('div', 'bd');
    b.appendChild(el('h4', null, a.title || 'بی‌نام'));
    if (a.titleFa) b.appendChild(el('p', 'fa', a.titleFa));
    if (a.artist) b.appendChild(el('p', 'by', a.artist));
    if (a.medium) b.appendChild(el('p', 'by', a.medium));
    if (a.quote) b.appendChild(el('p', 'qt', '«' + a.quote + '»'));
    if (a.license) b.appendChild(el('span', 'lic', 'مجوز: ' + a.license));
    if (a.imagePage) {
      var l = document.createElement('a');
      l.href = a.imagePage; l.target = '_blank'; l.rel = 'noopener noreferrer';
      l.textContent = 'دیدن در موزه';
      b.appendChild(l);
    }
    c.appendChild(b);
    return c;
  }

  function bookCard(b) {
    var c = el('div', 'book');
    var im = el('div', 'cov');
    if (b.cover) {
      var i = new Image();
      i.alt = b.titleFa || b.title || '';
      i.src = res(b.cover);
      i.onerror = function () {
        im.textContent = '';
        im.appendChild(el('span', 'nocov', 'بدون کاور'));
      };
      im.appendChild(i);
    } else {
      // an empty frame, never a placeholder image pretending to be the cover
      // an empty frame must not claim to hold a cover; say what is missing
      im.appendChild(el('span', 'nocov', 'بدون کاور'));
      im.title = b.noCoverReason || '';
    }
    c.appendChild(im);

    var bd = el('div', 'bbd');
    bd.appendChild(el('h4', null, b.titleFa || b.title || 'بی‌نام'));
    var sub = [];
    if (b.author) sub.push(b.author);
    if (b.chapter) sub.push('فصل ' + b.chapter);
    if (sub.length) bd.appendChild(el('p', 'by', sub.join(' · ')));
    // a blank line would read as a bug; the novel simply does not describe
    // every volume's binding, and that is worth saying out loud
    if (b.physical) bd.appendChild(el('p', 'phys', b.physical));
    else bd.appendChild(el('p', 'phys none', 'رمان شکل و جلد این کتاب را توصیف نمی‌کند.'));
    if (b.contents && b.contents.length) {
      bd.appendChild(el('p', 'cont', 'درون: ' + b.contents.join('، ')));
    }
    // the empty frame above already says 'بدون کاور'; repeating it in the
    // tag line read as two separate facts about one book
    bd.appendChild(el('p', 'btags', b.real ? 'جلد واقعی' : 'بازسازی'));
    // and with the reason gone from the tag line it would live only in a
    // tooltip, so put it on the page where the missing cover is
    if (!b.cover && b.noCoverReason)
      bd.appendChild(el('p', 'why', b.noCoverReason));
    if (b.note) bd.appendChild(el('p', 'bnote', b.note));
    c.appendChild(bd);
    return c;
  }

  function specList(s) {
    var ul = el('ul');
    if (s.palette) ul.appendChild(el('li', null, 'پالت: ' + s.palette));
    if (s.furniture) ul.appendChild(el('li', null, 'اثاث: ' + s.furniture));
    if (s.facesOnto) ul.appendChild(el('li', null, 'رو به: ' + s.facesOnto));
    ul.appendChild(el('li', null, 'توقف ' + (mem.open + 1) + ' از ' + allStops().length));
    return ul;
  }

  function openRoom(id) {
    var list = allStops();
    var ix = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { ix = i; break; }
    if (ix < 0) { closeView(); return; }
    mem.open = ix;
    var s = list[ix];

    $('vTitle').textContent = s.title;
    $('vEn').textContent = s.titleEn || '';
    document.title = s.title + ' — درون‌سویی';

    var stage = $('vStage');
    stage.textContent = '';
    if (s.image) {
      var i = new Image();
      i.alt = s.title;
      i.src = res(s.image);
      i.onerror = function () {
        stage.textContent = '';
        stage.appendChild(el('div', 'noimg', 'تصویر این اتاق هنوز ساخته نشده. متن و تابلوهایش در ادامه آمده.'));
      };
      stage.appendChild(i);
    } else {
      stage.appendChild(el('div', 'noimg', 'تصویر این اتاق هنوز ساخته نشده. متن و تابلوهایش در ادامه آمده.'));
    }

    var cap = $('vCap');
    cap.textContent = s.title + (s.titleEn ? ' — ' + s.titleEn : '') +
      (s.artworkCount ? '  ·  ' + s.artworkCount + ' تابلو، ' + s.hasOpenImages + ' تصویر باز.' : '  ·  بی‌تابلو.');

    // the review badge, also on the room page: one look must show the state
    var note = $('vReview');
    if (s.review) {
      note.hidden = false;
      note.className = 'review ' + reviewClass(s.review);
      note.textContent = reviewText(s.review);
      note.title = s.review;
    } else {
      note.hidden = true;
    }

    var q = $('vQuote');
    q.textContent = '';
    if (s.quote) {
      q.appendChild(document.createTextNode('«' + s.quote + '»'));
      q.appendChild(el('span', 'src', '— از متن رمان'));
    } else {
      q.appendChild(el('span', 'src', 'رمان برای این اتاق نقل‌قول جداگانه‌ای ندارد.'));
    }

    var art = $('vArt');
    art.textContent = '';
    $('vArtHead').textContent = s.artworkCount ? ('تابلوهای این اتاق (' + s.artworkCount + ')') : 'تابلوهای این اتاق';
    if (s.artworks && s.artworks.length) {
      s.artworks.forEach(function (a) { art.appendChild(artCard(a)); });
    } else {
      art.appendChild(el('p', 'empty', 'رمان برای این اتاق هیچ اثر هنری نام نمی‌برد — و همین خودش بخشی از توصیف است.'));
    }

    var sb = $('vSpecBody');
        sb.textContent = '';
        sb.appendChild(specList(s));

        // the shelves.  The novel gives two orders and they matter: the religious
        // shelf runs in the sequence ch.12 lists, the profane one in ch.14.
        var bk = $('vBooks');
        bk.textContent = '';
        if (s.books && s.books.length) {
          $('vBooksHead').textContent = 'کتاب‌های این اتاق (' + s.bookCount +
            ') — ' + s.booksWithCover + ' کاور واقعی';
          var prof = s.books.filter(function (b) { return b.shelf === 'profane'; });
          var rel  = s.books.filter(function (b) { return b.shelf !== 'profane'; });
          if (rel.length) {
            bk.appendChild(el('h3', 'shelfhead', 'قفسهٔ مذهبی — به ترتیب فصل ۱۲ (' + rel.length + ')'));
            var rw = el('div', 'shelf');
            rel.forEach(function (b) { rw.appendChild(bookCard(b)); });
            bk.appendChild(rw);
          }
          if (prof.length) {
            bk.appendChild(el('h3', 'shelfhead', 'قفسهٔ دنیایی — به ترتیب فصل ۱۴ (' + prof.length + ')'));
            var pw = el('div', 'shelf');
            prof.forEach(function (b) { pw.appendChild(bookCard(b)); });
            bk.appendChild(pw);
          }
        } else {
          $('vBooksHead').textContent = '';
          bk.appendChild(el('p', 'empty', 'رمان برای این اتاق کتابی نام نمی‌برد.'));
        }

        var prev = $('vPrev'), next = $('vNext');
    if (ix > 0) { prev.href = '#' + list[ix - 1].id; prev.textContent = '→ ' + list[ix - 1].title; prev.style.visibility = 'visible'; }
    else { prev.textContent = ''; prev.style.visibility = 'hidden'; }
    if (ix < list.length - 1) { next.href = '#' + list[ix + 1].id; next.textContent = list[ix + 1].title + ' ←'; next.style.visibility = 'visible'; }
    else { next.textContent = ''; next.style.visibility = 'hidden'; }

    $('view').hidden = false;
    window.scrollTo(0, 0);
  }

  function closeView() {
    $('view').hidden = true;
    mem.open = null;
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }

  /* A deep link may name a painting as well as a room: #room/artwork.
   * Without this a shared link to a scan silently landed on the room list. */
  function route() {
    var raw = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!raw) { closeView(); return; }
    var parts = raw.split('/');
    openRoom(parts[0]);
    if (parts[1]) openArt(parts[1]);
  }

  /* ---------- boot ---------- */

  $('vBack').addEventListener('click', closeView);
  $('aBack').addEventListener('click', function () {
    $('artView').hidden = true;
    // return to the room behind the painting, not to the list of all rooms
    if (location.hash.indexOf('/') > 0) history.replaceState(null, '', '#' + location.hash.split('/')[0]);
  });
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('artView').hidden) { $('artView').hidden = true; return; }
    if (!$('view').hidden) closeView();
  });

  // cache-bust: the tour is a static file that changes while it is being
  // written, and the browser was holding on to a stale manifest for minutes
  fetch(MANIFEST + '?v=' + Date.now())
    .then(function (r) { if (!r.ok) throw new Error(r.status + ' ' + MANIFEST); return r.json(); })
    .then(function (m) {
      mem.base = MANIFEST.replace(/[^/]+$/, '');
      mem.man = m; renderList(); route();
    })
    .catch(function (e) {
      var box = $('tour');
      box.textContent = '';
      box.appendChild(el('p', 'empty', 'مانیفست تور بارگذاری نشد: ' + e.message));
      // rethrow in dev so the real line is visible instead of a swallowed message
      if (location.search.indexOf('debug') >= 0) throw e;
    });
})();
