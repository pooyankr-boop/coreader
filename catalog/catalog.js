// catalog.js — Enhanced Museum & Persian Manuscript Library Logic
(function(){
'use strict';

var _books = [];
var _filter = 'all';
var _section = 'raah';
var _viewMode = 'grid';
var _sortMode = 'default';
var _currentQvSlug = null;
var _slideIntervals = {};

/* === Remote images: a small queue ===
 * A browser keeps ~6 connections per origin, and the remote thumbnails go through this
 * origin's /proxy-image. When they were all requested at once, the slow ones (archive.org
 * can take 30s+) held every connection and even the local cover files at the end of the
 * list waited behind them. Remote images now load two at a time, newest-visible first;
 * what the user hovers jumps the queue. Local files are never queued. */
var _imgQ = [], _imgActive = 0, _IMG_CONC = 2, _imgObserver = null;
function queueImage(img, src, urgent){
  if(!img || !src || img.dataset.q) return;
  img.dataset.q = '1';
  var job = { img: img, src: src };
  if(urgent) _imgQ.unshift(job); else _imgQ.push(job);   // newest first: what scrolled into view last is what the user is looking at
  pumpImages();
}
function pumpImages(){
  while(_imgActive < _IMG_CONC && _imgQ.length){
    var job = _imgQ.shift();
    if(!job.img.isConnected) continue;            // the grid was re-rendered meanwhile
    _imgActive++;
    (function(j){
      var finished = false, timer = null;
      function done(){ if(finished) return; finished = true; clearTimeout(timer); _imgActive--; pumpImages(); }
      timer = setTimeout(done, 20000);            // a hung request must not hold a slot forever
      j.img.addEventListener('load', done, { once: true });
      j.img.addEventListener('error', done, { once: true });
      j.img.src = j.src;
    })(job);
  }
}
function initRemoteCovers(){
  _imgQ.length = 0;
  if(_imgObserver){ _imgObserver.disconnect(); _imgObserver = null; }
  var imgs = document.querySelectorAll('img.card-cover[data-rsrc]');
  if(!imgs.length) return;
  if(!('IntersectionObserver' in window)){ Array.prototype.forEach.call(imgs, function(im){ queueImage(im, im.dataset.rsrc, false); }); return; }
  _imgObserver = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(!e.isIntersecting) return;
      _imgObserver.unobserve(e.target);
      queueImage(e.target, e.target.dataset.rsrc, false);
    });
  }, { rootMargin: '500px 0px' });
  Array.prototype.forEach.call(imgs, function(im){ _imgObserver.observe(im); });
}
/* A cover that fails must never reload the page (it used to: location.reload() after 2s,
 * which restarted every request and looped on a slow proxy). Remote covers get one retry,
 * then the card shows its ornament. */
window.coverFail = function(img){
  var wrap = img.parentElement, fb = wrap && wrap.querySelector('.card-cover-fallback');
  if(img.dataset.rsrc && !img.dataset.retried){
    img.dataset.retried = '1';
    setTimeout(function(){ if(img.isConnected) img.src = img.dataset.rsrc + (img.dataset.rsrc.indexOf('?') >= 0 ? '&' : '?') + 'retry=1'; }, 4000);
    return;
  }
  img.style.display = 'none';
  if(fb) fb.style.display = 'flex';
};


function toFA(n){
  return String(n).replace(/[0-9]/g, function(d){ return '۰۱۲۳۴۵۶۷۸۹'[d]; });
}

function sectionOf(b){
  return b.section === 'bierah' ? 'bierah' : 'raah';
}

/* ---- safe helpers ---- */
// esc(): full HTML escape for text/attribute context. Titles, authors and
// notes come from third-party IIIF manifests and from files the user drops
// in, so anything built into HTML here is untrusted.
function lsGet(key, fallback){
  try { var v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch(e){ return fallback; }
}
function esc(s){
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// richText(): escape, but keep the harmless <i>/<em>/<b> some museum titles carry on purpose.
function richText(s){
  return esc(s).replace(/&lt;(\/?)(i|em|b)&gt;/gi, '<$1$2>');
}
// plainText(): for attributes (alt/title) - strip tags first, then escape.
function plainText(s){
  return esc(String(s == null ? '' : s).replace(/<[^>]*>/g, ''));
}
// jsAttr(): a value inside a single-quoted JS string inside an HTML attribute.
function jsAttr(s){
  return esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}
function lsSet(key, val){
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch(e){ return false; }
}
// foldFa(): search normalisation - Arabic/Persian yeh & kaf, diacritics, ZWNJ,
// kashida, digit forms, alef variants. Without it a query typed with an Arabic
// yeh never matches a Persian title.
function foldFa(s){
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0640\u200C\u200D]/g, '')
    .replace(/[\u064A\u0649]/g, '\u06CC').replace(/\u0643/g, '\u06A9')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627').replace(/\u06C0/g, '\u0647')
    .replace(/[\u0660-\u0669]/g, function(d){ return String(d.charCodeAt(0) - 0x0660); })
    .replace(/[\u06F0-\u06F9]/g, function(d){ return String(d.charCodeAt(0) - 0x06F0); });
}
function itemHref(src, slug){
  if(src === 'against-nature') return 'viewer/tour.html';
  if(src === 'local') return 'reader/reader.html?book=' + encodeURIComponent(slug);
  return 'viewer/viewer.html?book=' + encodeURIComponent(slug);
}
// proxyBase(): relative proxy root so file:// and GitHub-Pages subpaths keep working.
// '/proxy-image' absolute breaks on subpath deploys; use current origin-relative base.
function proxyBase(){
  try {
    if(location.protocol === 'file:') return '';
    var base = location.pathname.replace(/\/[^\/]*$/, '').replace(/\/(catalog|reader|viewer|tour)$/, '');
    if(base === '/') base = '';
    return base;
  } catch(e){ return ''; }
}

function init(){
  loadAppTheme();
  loadSavedViewMode();

  // Read URL params or hash
  var params = new URLSearchParams(location.search);
  var qf = params.get('filter') || location.hash.slice(1);
  if(qf && /^(all|iiif|museum|local|tour|against-nature)$/.test(qf)){
    _filter = (qf === 'against-nature') ? 'tour' : qf;
  }

  // Pre-fill search from ?q= param (e.g., from tour artwork clicks)
  var qs_q = params.get('q');
  if(qs_q){
    var sInput = document.getElementById('searchInput');
    if(sInput){
      sInput.value = decodeURIComponent(qs_q);
      var clearBtn = document.getElementById('searchClearBtn');
      if(clearBtn) clearBtn.style.display = 'block';
      sInput.dispatchEvent(new Event('input'));
    }
  }

  // Section choice
  var qs = params.get('section');
  var stored = null;
  try { stored = localStorage.getItem('coreader-section'); } catch(e){}
  _section = (qs === 'bierah' || qs === 'raah') ? qs : (stored === 'bierah' || stored === 'raah' ? stored : 'raah');
  setSectionChrome(_section);

  // Search input events
  var searchInput = document.getElementById('searchInput');
  if(searchInput){
    searchInput.addEventListener('input', function(){
      var val = searchInput.value.trim();
      var clearBtn = document.getElementById('searchClearBtn');
      if(clearBtn) clearBtn.style.display = val ? 'block' : 'none';
      render();
    });
  }

  // Keyboard shortcut for search (/ or Ctrl+K)
  document.addEventListener('keydown', function(e){
    var ae = document.activeElement;
    var typing = !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable));
    if((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key === 'k')){
      e.preventDefault();
      if(searchInput){ searchInput.focus(); searchInput.select(); }
    } else if(e.key === 'Escape'){
      closeAllModals();
    }
  });

  showCatalog();
}

// === Theme Engine ===
/* The reading theme (coreader-theme: night, sepia, ...) and the site theme
 * used to share one key, so opening a book overwrote the site's theme and
 * vice versa. They are separate now, and the site opens on شب و آبسیدین. */
function loadAppTheme(){
  var t = localStorage.getItem('coreader-app-theme');
  if (!t){
    var old = localStorage.getItem('coreader-theme') || '';
    t = /^theme-/.test(old) ? old : 'theme-dark';
  }
  setAppTheme(t, true);   // remember what opened, not only what was clicked
}

window.setAppTheme = function(themeClass, save){
  if (!document.querySelector('.theme-pill[data-theme="' + themeClass + '"]')) themeClass = 'theme-dark';
  if(save !== false){
    try { localStorage.setItem('coreader-app-theme', themeClass); } catch(e){}
  }
  document.body.className = document.body.className.replace(/\btheme-\w+\b/g, '').trim();
  document.body.classList.add(themeClass);
  document.querySelectorAll('.theme-pill').forEach(function(pill){
    pill.classList.toggle('active', pill.dataset.theme === themeClass);
  });
};

// === Section Switcher (راه / بیراه) ===
function setSectionChrome(sec){
  _section = sec;
  try { localStorage.setItem('coreader-section', sec); } catch(e){}

  var secBtnRaah = document.getElementById('secBtnRaah');
  var secBtnBierah = document.getElementById('secBtnBierah');
  if(secBtnRaah) secBtnRaah.classList.toggle('active', sec === 'raah');
  if(secBtnBierah) secBtnBierah.classList.toggle('active', sec === 'bierah');

  var tourBtn = document.getElementById('tourHeaderBtn');
  var tourText = document.getElementById('tourBtnText');
  if(tourBtn && tourText){
    if(sec === 'bierah'){
      tourText.textContent = 'تور مجازی خانهٔ دِزِ اِسِنت';
      tourBtn.href = 'viewer/tour.html';
    } else {
      tourText.textContent = 'تور مجازی زیرزمین نفایس';
      tourBtn.href = 'tour/index.html';
    }
  }

  var titleEl = document.getElementById('siteTitle');
  var subEl = document.getElementById('siteSubtitle');
  if(sec === 'bierah'){
    if(titleEl) titleEl.textContent = 'کتابخانه و تالار بیراه (À rebours)';
    if(subEl) subEl.textContent = 'مجموعهٔ نفیس کتب کمیاب، نسخه‌های لاتین و آثار هنری دِزِ اِسِنت در رمان بیراه با استانداردهای IIIF';
    document.title = 'بیراه — موزه و کتابخانه رمان بیراه';
  } else {
    if(titleEl) titleEl.textContent = 'کتابخوانهٔ نسخ خطی و اوراق فارسی';
    if(subEl) subEl.textContent = 'مرور، خوانش، مقابله و حاشیه‌نویسی نفایس خطی و آثار موزه‌ای ایران از کتابخانه‌های سراسر جهان';
    document.title = 'کتابخوانهٔ نسخ خطی و اوراق فارسی';
  }
}

window.chooseSection = function(sec){
  setSectionChrome(sec);
  filterCatalogBySection();
};

window.toggleSection = function(){
  chooseSection(_section === 'bierah' ? 'raah' : 'bierah');
};

// === Fetch and Build Catalog ===
function showCatalog(){
  fetch('books-index.json')
    .then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(list){
      var custom = [];
      try { custom = lsGet('coreader-custom-books', []); } catch(e){}
      var indexSlugs = {};
      list.forEach(function(b){ indexSlugs[b.slug] = 1; });
      custom = custom.filter(function(c){
        return !indexSlugs[c.slug] && !list.some(function(b){ return b.manifestUrl && b.manifestUrl === c.manifestUrl; });
      });

      window._allRawBooks = list.concat(custom);
      filterCatalogBySection();
    })
    .catch(function(err){
      console.warn('[catalog] fetch books-index failed:', err);
      // Fallback: check custom books from localStorage
      var custom = [];
      try { custom = lsGet('coreader-custom-books', []); } catch(e){}
      if(custom.length){
        window._allRawBooks = custom;
        filterCatalogBySection();
      } else {
        document.getElementById('skeletonGrid').style.display = 'none';
        var grid = document.getElementById('grid');
        grid.style.display = '';
        grid.innerHTML = '<div class="empty-state">' +
          '<div class="empty-icon">⚠️</div>' +
          '<div class="empty-title">خطا در دریافت فهرست کتاب‌ها</div>' +
          '<div class="empty-desc">در صورت مشاهده این پیام در مرورگر با آدرس file://، لطفاً پروژه را از طریق وب‌سرور محلی اجرا نمایید.</div>' +
          '<button class="empty-btn" onclick="location.reload()">تلاش دوباره</button>' +
          '</div>';
      }
    });
}

function filterCatalogBySection(){
  var raw = window._allRawBooks || [];
  _books = raw.filter(function(b){
    return b.source === 'against-nature' || sectionOf(b) === _section;
  });

  updateBadgesAndStats();
  document.getElementById('skeletonGrid').style.display = 'none';
  document.getElementById('grid').style.display = '';
  render();
}

function updateBadgesAndStats(){
  var total = _books.length;
  var iiifCount = 0, museumCount = 0, localCount = 0, tourCount = 0;

  _books.forEach(function(b){
    if(b.source === 'iiif') iiifCount++;
    else if(b.source === 'museum') museumCount++;
    else if(b.source === 'local') localCount++;
    else if(b.source === 'against-nature') tourCount++;
  });

  var bAll = document.getElementById('badgeAll'); if(bAll) bAll.textContent = toFA(total);
  var bIiif = document.getElementById('badgeIiif'); if(bIiif) bIiif.textContent = toFA(iiifCount);
  var bMus = document.getElementById('badgeMuseum'); if(bMus) bMus.textContent = toFA(museumCount);
  var bLoc = document.getElementById('badgeLocal'); if(bLoc) bLoc.textContent = toFA(localCount);
  var bTour = document.getElementById('badgeTour'); if(bTour) bTour.textContent = toFA(tourCount);

  var sTot = document.getElementById('statTotal'); if(sTot) sTot.textContent = toFA(total);
  var sI = document.getElementById('statIiif'); if(sI) sI.textContent = toFA(iiifCount);
  var sM = document.getElementById('statMuseum'); if(sM) sM.textContent = toFA(museumCount);

  // Update active filter pill
  document.querySelectorAll('.filter-pill').forEach(function(p){
    p.classList.toggle('active', p.dataset.filter === _filter);
  });
}

// === Filtering, Sorting, View Modes ===
window.setFilter = function(f){
  _filter = f;
  document.querySelectorAll('.filter-pill').forEach(function(p){
    p.classList.toggle('active', p.dataset.filter === f);
  });
  render();
};

window.changeSort = function(s){
  _sortMode = s;
  render();
};

function loadSavedViewMode(){
  var m = 'grid';
  try { m = localStorage.getItem('coreader-view-mode') || m; } catch(e){}
  if(!/^(grid|list|showcase)$/.test(m)) m = 'grid';
  setViewMode(m, false);
}

window.setViewMode = function(mode, save){
  _viewMode = mode;
  if(save !== false){
    try { localStorage.setItem('coreader-view-mode', mode); } catch(e){}
  }
  var grid = document.getElementById('grid');
  if(grid){
    grid.className = 'grid ' + (mode === 'list' ? 'view-list' : (mode === 'showcase' ? 'view-showcase' : ''));
  }
  document.querySelectorAll('.view-btn').forEach(function(btn){
    btn.classList.toggle('active', btn.id === ('view' + mode.charAt(0).toUpperCase() + mode.slice(1) + 'Btn'));
  });
};

window.clearSearch = function(){
  var inp = document.getElementById('searchInput');
  if(inp){ inp.value = ''; }
  var btn = document.getElementById('searchClearBtn');
  if(btn) btn.style.display = 'none';
  render();
};

// === Main Render Logic ===
function render(){
  var searchInput = document.getElementById('searchInput');
  var q = foldFa((searchInput ? searchInput.value : '').trim());
  var matchBadge = document.getElementById('searchMatchCount');

  var list = _books.filter(function(b){
    var sourceMatches = (_filter === 'all') ? true :
                        (_filter === 'tour') ? (b.source === 'against-nature') :
                        (b.source === _filter);
    if(!sourceMatches) return false;
    if(!q) return true;

    var title = foldFa(b.title);
    var author = foldFa(b.author);
    var provider = foldFa(b.provider);
    var slug = foldFa(b.slug);
    return title.indexOf(q) >= 0 || author.indexOf(q) >= 0 || provider.indexOf(q) >= 0 || slug.indexOf(q) >= 0;
  });

  if(q){
    if(matchBadge){
      matchBadge.style.display = 'inline-block';
      matchBadge.textContent = toFA(list.length) + ' مورد یافته شد';
    }
  } else {
    if(matchBadge) matchBadge.style.display = 'none';
  }

  // Sort
  if(_sortMode === 'title'){
    list.sort(function(a, b){ return (a.title || '').localeCompare(b.title || '', 'fa'); });
  } else if(_sortMode === 'pages-desc'){
    list.sort(function(a, b){ return (b.pages || 0) - (a.pages || 0); });
  } else if(_sortMode === 'pages-asc'){
    list.sort(function(a, b){ return (a.pages || 0) - (b.pages || 0); });
  } else if(_sortMode === 'provider'){
    list.sort(function(a, b){ return (a.provider || '').localeCompare(b.provider || '', 'fa'); });
  }

  /* Saved books go last, in the default order only, and only where they can
   * actually appear: in "all" (which also holds the library's own works) and in
   * the saved-books filter itself.  Under a source filter they are already the
   * whole list, and under any sort the reader has asked for an order, so
   * bucketing them at the foot would be second-guessing the sort button.
   * Stable sort, so their order among themselves is the index order. */
  if(_sortMode === 'default' && (_filter === 'all' || _filter === 'local')){
    list = list.filter(function(b){ return b.source !== 'local'; })
      .concat(list.filter(function(b){ return b.source === 'local'; }));
  }

  var grid = document.getElementById('grid');
  if(!list.length){
    grid.innerHTML = '<div class="empty-state">' +
      '<div class="empty-icon">🔍</div>' +
      '<div class="empty-title">اثری مطابق جست‌وجو یافت نشد</div>' +
      '<div class="empty-desc">می‌توانید عبارت دیگری را جست‌وجو کنید یا فیلترهای اعمال‌شده را تغییر دهید.</div>' +
      '<button class="empty-btn" onclick="clearSearch();setFilter(\'all\')">نمایش همه آثار</button>' +
      '</div>';
    return;
  }

  var progress = {};
  var favs = [];
  try { progress = lsGet('coreader-progress', {}); } catch(e){}
  try { favs = lsGet('coreader-favs', []); } catch(e){}
  var favSlugs = {};
  favs.forEach(function(f){ if(f.slug) favSlugs[f.slug] = 1; });

  grid.innerHTML = list.map(function(b, i){
    var pg = progress[b.slug] || 0;
    var pct = b.pages ? Math.min(100, Math.round(pg / b.pages * 100)) : 0;
    var pbar = pct > 0 ?
      '<div class="card-progress"><div class="card-progress-bar" style="width:' + pct + '%"></div></div>' +
      '<div class="card-progress-text"><span>پیشرفت مطالعه</span><span>' + toFA(pct) + '٪</span></div>' : '';

    var coverSrc = b.cover ? ('books/' + b.slug + '/' + (b.coverThumb || b.cover)) : '';
    if(!coverSrc && b.thumbnail){
      var t0 = Array.isArray(b.thumbnail) ? b.thumbnail[0] : b.thumbnail;
      coverSrc = t0;
    }
    // Remote thumbnails (archive.org, framemark.vam.ac.uk, thumb.wikimedia.org)
    // are slow and intermittently hang for 30s+. Route them through the local
    // proxy so the browser never waits on a cross-origin server, and add a
    // loading placeholder so the card does not jump straight to error text.
    var coverProxy = '';
    if(coverSrc && /^https?:\/\//.test(coverSrc) && coverSrc.indexOf('/proxy-image')<0){
      coverProxy = proxyBase() + '/proxy-image?url=' + encodeURIComponent(coverSrc);
    }
    var coverImgSrc = coverProxy || coverSrc || '';
    var coverImg = '';
    if(coverProxy){
      // remote: no src yet - initRemoteCovers() loads it through the queue when it nears the viewport
      coverImg = '<img class="card-cover" data-rsrc="' + esc(coverProxy) + '" alt="' + plainText(b.title || '') + '" decoding="async" onerror="coverFail(this)">';
    } else if(coverImgSrc){
      coverImg = '<img class="card-cover" src="' + esc(coverImgSrc) + '" alt="' + plainText(b.title || '') + '" loading="lazy" decoding="async" onerror="coverFail(this)">';
    }

    var fallback = '<div class="card-cover-fallback" style="' + (coverSrc ? 'display:none' : '') + '">' +
      '<div class="fallback-ornament">📜</div>' +
      '<div class="fallback-title">' + esc(b.title || '') + '</div>' +
      '</div>';

    // Slideshow
    var slides = '';
    if(b.thumbnail){
      var thumbs = Array.isArray(b.thumbnail) ? b.thumbnail : [b.thumbnail];
      if(thumbs.length >= 2){
        slides = thumbs.slice(0, 5).map(function(url, si){
          var su = url;
          if(/^https?:\/\//.test(url) && url.indexOf('/proxy-image')<0){
            su = proxyBase() + '/proxy-image?url=' + encodeURIComponent(url);
          }
          return '<div class="slide' + (si === 0 ? ' active' : '') + '"><img data-src="' + esc(su) + '" alt="" decoding="async" onerror="this.parentElement.remove()"></div>';
        }).join('');
      }
    }
    // A card with one picture has nothing to slide through.  It says so with a
    // class, and the hover moves the picture instead (see .card-zoom in the css).
    var slideshow = slides ? '<div class="card-slideshow">' + slides + '</div>' : '';
    var hoverClass = slides ? 'has-slides' : 'card-zoom';

    var badgeClass = (b.source === 'iiif') ? 'iiif' : (b.source === 'museum' ? 'museum' : (b.source === 'against-nature' ? 'tour' : 'local'));
    var badgeLabel = (b.source === 'iiif') ? 'IIIF' : (b.source === 'museum' ? 'موزه' : (b.source === 'against-nature' ? 'تور' : 'ذخیره'));

    var href = (b.source === 'against-nature') ? 'viewer/tour.html' :
               (b.source === 'local') ? ('reader/reader.html?book=' + encodeURIComponent(b.slug)) :
               ('viewer/viewer.html?book=' + encodeURIComponent(b.slug));

    var isFav = favSlugs[b.slug];

    return '<div class="card ' + hoverClass + '" data-slug="' + b.slug + '" style="animation-delay:' + Math.min(0.5, i * 0.03) + 's">' +
      '<div class="card-cover-wrap">' +
        coverImg + fallback + slideshow +
        '<div class="card-badges-top">' +
          '<span class="source-badge ' + badgeClass + '">' + badgeLabel + '</span>' +
          '<button onclick="toggleCardFavorite(\'' + jsAttr(b.slug) + '\', event)" style="background:rgba(0,0,0,0.5);border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;color:' + (isFav ? '#f59e0b' : '#ffffff') + ';font-size:14px" title="نشان کردن">' + (isFav ? '★' : '☆') + '</button>' +
        '</div>' +
        '<div class="card-quick-actions">' +
          '<a href="' + href + '" class="quick-action-btn">📖 مطالعه</a>' +
          '<button class="quick-action-btn" onclick="openQuickView(\'' + jsAttr(b.slug) + '\', event)">👁️ جزئیات</button>' +
        '</div>' +
      '</div>' +
      '<a href="' + href + '" class="card-body" style="text-decoration:none;color:inherit">' +
        '<h2 class="card-title">' + richText(b.title || 'بدون عنوان') + '</h2>' +
        '<div class="card-author">' + esc(b.author || 'ناشناس') + '</div>' +
        '<div class="card-meta-row">' +
          '<span class="card-provider" title="' + esc(b.provider || 'نسخه خطی') + '">' + esc(b.provider || 'نسخه خطی') + '</span>' +
          '<span class="card-pages">' + toFA(b.pages || 1) + ' صفحه</span>' +
        '</div>' +
        pbar +
      '</a>' +
    '</div>';
  }).join('');

  initRemoteCovers();
  initSlideshows();
}

// === Hover Slideshows ===
// A slide whose image fails to load is dropped rather than shown as an empty
// frame: archive.org returns 500 for some individual page renders of an
// otherwise fine book, and without this the card sits on a blank rectangle for
// a full 1.8s before moving on.  If too few slides survive, the card stops being
// a slideshow card and falls back to the zoom - which is exactly the behaviour
// of a one-page book, and needs no second code path.
function initSlideshows(){
  document.querySelectorAll('.card').forEach(function(card){
    var slug = card.dataset.slug;
    var ss = card.querySelector('.card-slideshow');
    if(!ss) return;

    Array.prototype.forEach.call(ss.querySelectorAll('.slide img'), function(img){
      img.addEventListener('error', function(){
        var s = img.closest('.slide');
        if(s) s.remove();
      });
    });

    var slides = function(){ return Array.prototype.slice.call(ss.querySelectorAll('.slide')); };
    if(slides().length < 2) return dropSlideshow(card, ss);

    var live = slides();
    var idx = 0;

    function ready(sl){ var im = sl.querySelector('img'); return !!(im && im.complete && im.naturalWidth > 0); }
    // The slide images are not requested until the card is hovered (or focused); they load
    // at the front of the queue, and the cover stays visible until the first one is ready.
    function loadSlides(){
      if(card.dataset.slidesLoading) return;
      card.dataset.slidesLoading = '1';
      Array.prototype.forEach.call(ss.querySelectorAll('.slide img[data-src]'), function(im){
        im.addEventListener('load', function(){
          var sl = im.closest('.slide'); if(!sl) return;
          card.classList.add('slides-ready');
          var act = ss.querySelector('.slide.active');
          if(!act || !ready(act)){ if(act) act.classList.remove('active'); sl.classList.add('active'); }
        }, { once: true });
        queueImage(im, im.dataset.src, true);
      });
    }
    card.addEventListener('focusin', loadSlides);
    card.addEventListener('mouseenter', function(){
      loadSlides();
      clearInterval(_slideIntervals[slug]);
      _slideIntervals[slug] = setInterval(function(){
        // re-query every tick: a slide can vanish under us mid-show
        live = slides();
        if(live.length < 2){ dropSlideshow(card, ss); return; }
        var n = live.length, cur = idx % n, next = -1;
        for(var k = 1; k < n; k++){ var c = (cur + k) % n; if(ready(live[c])){ next = c; break; } }
        if(next >= 0){
          live[cur].classList.remove('active');
          idx = next;
          live[next].classList.add('active');
        }
      }, 1800);
    });

    card.addEventListener('mouseleave', function(){
      clearInterval(_slideIntervals[slug]);
      live = slides();
      live.forEach(function(s){ s.classList.remove('active'); });
      if(live[0]) live[0].classList.add('active');
    });
  });
}

/* The slideshow is off for good: take it out of the DOM and tell the card it
 * is a one-picture card, so the css hands the hover to the zoom. */
function dropSlideshow(card, ss){
  clearInterval(_slideIntervals[card.dataset.slug]);
  if(ss && ss.parentNode) ss.parentNode.removeChild(ss);
  card.classList.remove('has-slides');
  card.classList.add('card-zoom');
}

// === Quick View Modal ===
window.openQuickView = function(slug, e){
  if(e){ e.preventDefault(); e.stopPropagation(); }
  var book = _books.find(function(b){ return b.slug === slug; });
  if(!book) return;

  _currentQvSlug = slug;
  document.getElementById('qvTitle').textContent = book.title || '';
  document.getElementById('qvAuthor').textContent = book.author || 'ناشناس';
  document.getElementById('qvProvider').textContent = book.provider || 'نامشخص';
  document.getElementById('qvPages').textContent = toFA(book.pages || 1);
  document.getElementById('qvSource').textContent = (book.source === 'iiif') ? 'نسخه خطی IIIF' : (book.source === 'museum' ? 'شیء موزه' : 'کتاب محلی');

  var href = (book.source === 'against-nature') ? 'viewer/tour.html' :
             (book.source === 'local') ? ('reader/reader.html?book=' + encodeURIComponent(book.slug)) :
             ('viewer/viewer.html?book=' + encodeURIComponent(book.slug));
  document.getElementById('qvOpenBtn').href = href;

  var coverSrc = book.cover ? ('books/' + book.slug + '/' + book.cover) : '';
  if(!coverSrc && book.thumbnail){
    var t0 = Array.isArray(book.thumbnail) ? book.thumbnail[0] : book.thumbnail;
    coverSrc = t0;
  }
  var qvImg = document.getElementById('qvCoverImg');
  if(coverSrc) qvImg.src = coverSrc; else qvImg.removeAttribute('src');

  // Thumbs gallery (proxy + lazy, same as cards — raw remote URLs cause CORS slowness)
  var thumbsRow = document.getElementById('qvThumbsRow');
  thumbsRow.innerHTML = '';
  if(book.thumbnail){
    var thumbs = Array.isArray(book.thumbnail) ? book.thumbnail : [book.thumbnail];
    thumbs.slice(0, 6).forEach(function(u){
      var img = document.createElement('img');
      img.className = 'qv-thumb';
      img.loading = 'lazy';
      img.decoding = 'async';
      var proxied = (/^https?:\/\//.test(u) && u.indexOf('/proxy-image')<0) ? (proxyBase() + '/proxy-image?url=' + encodeURIComponent(u)) : u;
      img.dataset.src = proxied;
      img.src = proxied;
      img.onerror = function(){ this.style.display='none'; };
      img.onclick = function(){ document.getElementById('qvCoverImg').src = this.dataset.src || this.src; };
      thumbsRow.appendChild(img);
    });
  }

  updateQvFavBtn();
  document.getElementById('quickViewOverlay').classList.add('on');
};

window.closeQuickView = function(){
  document.getElementById('quickViewOverlay').classList.remove('on');
  _currentQvSlug = null;
};

function updateQvFavBtn(){
  if(!_currentQvSlug) return;
  var favs = lsGet('coreader-favs', []);
  var isFav = favs.some(function(f){ return f.slug === _currentQvSlug; });
  var btn = document.getElementById('qvFavBtn');
  if(btn){
    btn.textContent = isFav ? '★ حذف از نشانه‌ها' : '☆ نشان کردن اثر';
    btn.style.color = isFav ? '#f59e0b' : 'inherit';
  }
}

window.toggleQvFavorite = function(){
  if(!_currentQvSlug) return;
  var book = _books.find(function(b){ return b.slug === _currentQvSlug; });
  if(!book) return;
  toggleCardFavorite(book.slug);
  updateQvFavBtn();
};

window.toggleCardFavorite = function(slug, e){
  if(e){ e.preventDefault(); e.stopPropagation(); }
  var book = _books.find(function(b){ return b.slug === slug; });
  if(!book) return;

  var favs = lsGet('coreader-favs', []);
  var idx = favs.findIndex(function(f){ return f.slug === slug; });
  if(idx >= 0){
    favs.splice(idx, 1);
  } else {
    favs.push({
      slug: slug,
      title: book.title,
      author: book.author,
      provider: book.provider,
      cover: book.cover || (Array.isArray(book.thumbnail) ? book.thumbnail[0] : book.thumbnail),
      source: book.source,
      time: Date.now()
    });
  }
  // A full browser rejects the write and used to abort half-way, leaving a
  // favourite that could not be removed.
  if(!lsSet('coreader-favs', favs)){ alert('فضای ذخیره‌سازی مرورگر پر است؛ نشان ذخیره نشد.'); return; }
  render();
};

// === Bookmarks Drawer ===
window.openFavsDrawer = function(){
  var favs = lsGet('coreader-favs', []);
  var listEl = document.getElementById('favsDrawerList');
  if(!favs.length){
    listEl.innerHTML = '<div style="color:var(--muted);text-align:center;padding:24px 0">اثری نشان نشده است</div>';
  } else {
    listEl.innerHTML = favs.map(function(f, i){
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid var(--border);border-radius:12px;background:var(--cream)">' +
        '<div style="overflow:hidden;margin-inline-end:8px">' +
        '<a href="' + esc(itemHref(f.source, f.slug)) + '" style="font-weight:700;color:var(--text);text-decoration:none;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + richText(f.title) + '</a>' +
        '<div style="font-size:11px;color:var(--muted)">' + esc(f.author || '') + '</div>' +
        '</div>' +
        '<button onclick="removeFavItem(' + i + ')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px">✕</button>' +
        '</div>';
    }).join('');
  }
  document.getElementById('favsDrawerOverlay').classList.add('on');
};

window.closeFavsDrawer = function(){
  document.getElementById('favsDrawerOverlay').classList.remove('on');
};

window.removeFavItem = function(i){
  var favs = lsGet('coreader-favs', []);
  favs.splice(i, 1);
  try { localStorage.setItem('coreader-favs', JSON.stringify(favs)); } catch(e){ alert('فضای ذخیره‌سازی پر است؛ حذف انجام نشد.'); return; }
  openFavsDrawer();
  render();
};

function closeAllModals(){
  document.querySelectorAll('.modal-overlay').forEach(function(m){ m.classList.remove('on'); });
}

// === Add Book Modal ===
window.openAddModal = function(){
  document.getElementById('addOverlay').classList.add('on');
};
window.closeAddModal = function(){
  document.getElementById('addOverlay').classList.remove('on');
};

window.switchAddTab = function(name){
  document.querySelectorAll('.modal-tab').forEach(function(t){ t.classList.toggle('active', t.dataset.tab === name); });
  document.querySelectorAll('.modal-pane').forEach(function(p){ p.classList.toggle('active', p.id === ('tab-' + name)); });
  var iiifBtn = document.getElementById('bSaveIiif');
  var localBtn = document.getElementById('bSaveLocal');
  if(iiifBtn) iiifBtn.style.display = (name === 'iiif') ? '' : 'none';
  if(localBtn) localBtn.style.display = (name === 'local') ? '' : 'none';
};

// IIIF Normalizer
function iiifLabel(v){
  if(v == null) return '';
  if(typeof v === 'string') return v;
  if(Array.isArray(v)){
    if(!v.length) return '';
    if(typeof v[0] === 'string') return v.join(' ');
    if(v[0] && v[0]['@value']) return v.map(function(x){ return x && x['@value'] || ''; }).join(' ').trim();
    return iiifLabel(v[0]);
  }
  if(typeof v === 'object'){
    var pref = ['fa', '@fa', 'per', '@per', 'en', '@en'];
    for(var i = 0; i < pref.length; i++){
      if(Array.isArray(v[pref[i]]) && v[pref[i]].length) return iiifLabel(v[pref[i]]);
    }
    var keys = Object.keys(v);
    for(var k = 0; k < keys.length; k++){
      if(Array.isArray(v[keys[k]]) && v[keys[k]].length) return iiifLabel(v[keys[k]]);
    }
    if(v['@value']) return String(v['@value']);
    return '';          // an unrecognised object must not print as "[object Object]"
  }
  return String(v);
}

function resolveManifestUrl(inputUrl){
  var u = inputUrl.trim().split('#')[0];
  if(u.indexOf('/iiif/manifest/') >= 0 && u.match(/\.json$/)) return Promise.resolve(u);
  var bodObj = u.match(/digital\.bodleian\.ox\.ac\.uk\/objects\/([a-f0-9-]+)/);
  if(bodObj) return Promise.resolve('https://iiif.bodleian.ox.ac.uk/iiif/manifest/' + bodObj[1] + '.json');
  var eapMatch = u.match(/eap\.bl\.uk\/archive-file\/([A-Za-z0-9-]+)/);
  if(eapMatch) return Promise.resolve('https://eap.bl.uk/archive-file/' + eapMatch[1] + '/manifest?manifest=https://eap.bl.uk/archive-file/' + eapMatch[1] + '/manifest');
  var locItem = u.match(/loc\.gov\/item\/([A-Za-z0-9._-]+)\/?$/);
  if(locItem) return Promise.resolve('https://www.loc.gov/item/' + locItem[1] + '/manifest.json');
  return Promise.resolve(u);
}

/* IIIF v3: provider is a list of Agents ({label:{en:[..]}}); v2: attribution is a string, a
   language map or a list of them. Either way the result is plain text. */
function manifestProvider(m){
  var p = Array.isArray(m.provider) ? m.provider[0] : m.provider;
  var t = p ? iiifLabel(p.label != null ? p.label : p) : '';
  if(!t){ var a = m.attribution; t = a ? iiifLabel(Array.isArray(a) ? a[0] : a) : ''; }
  return String(t).replace(/^Provided by\s+/i, '').trim();
}

window.fetchIiifManifest = function(){
  var url = (document.getElementById('iiifUrl').value || '').trim();
  var log = document.getElementById('addLog');
  if(!url){
    log.style.display = 'block';
    log.textContent = 'لطفاً آدرس مانیفست را وارد فرمایید.\n';
    return;
  }
  log.style.display = 'block';
  log.textContent = 'در حال بررسی آدرس...\n';

  resolveManifestUrl(url).then(function(manUrl){
    log.textContent += 'دریافت داده‌های اثر از: ' + manUrl + '\n';
    return fetch(manUrl).catch(function(err){
      /* a library that sends no CORS header: try the local preview server's proxy; if there is
         none (published site, file://) report the original network error, not a proxy 404 */
      if(location.protocol === 'file:') throw err;
      return fetch('/proxy-manifest?url=' + encodeURIComponent(manUrl)).then(function(pr){
        if(!pr.ok) throw err;
        return pr;
      }, function(){ throw err; });
    }).then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(m){
      var label = iiifLabel(m.label) || 'نسخه خطی بدون عنوان';
      var summary = iiifLabel(m.summary);
      var prov = manifestProvider(m);
      var pages = (m.items || []).length;
      if(!pages && m.sequences && m.sequences[0]) pages = (m.sequences[0].canvases || []).length;

      var thumbs = [];
      if(m.thumbnail){
        var tu = (typeof m.thumbnail === 'string') ? m.thumbnail : (m.thumbnail.id || m.thumbnail['@id']);
        if(tu) thumbs.push(tu);
      }
      (m.items || []).slice(0, 4).forEach(function(it){
        var ap = it.items && it.items[0], an = ap && ap.items && ap.items[0], b = an && an.body;
        var img = Array.isArray(b) ? b[0] : b;
        if(img && img.id && thumbs.indexOf(img.id) < 0) thumbs.push(img.id);
      });

      log.textContent += '\n✓ عنوان اثر: ' + label + '\nتعداد صفحات: ' + pages + '\nارائه‌دهنده: ' + (prov || 'نامشخص') + '\nمانیفست معتبر است.';
      window._pendingManifest = {
        url: manUrl,
        data: m,
        label: label,
        summary: summary,
        provider: prov,
        pages: pages,
        thumbnail: thumbs
      };
      document.getElementById('bSaveIiif').disabled = false;
    });
  }).catch(function(e){
    log.textContent += 'خطا: ' + e.message + '\nلطفاً از اتصال اینترنت یا فعال بودن سرور پراکسی مطمئن شوید.';
  });
};

window.saveIiifBook = function(){
  var pm = window._pendingManifest;
  if(!pm) return;
  var title = pm.label || 'کتاب IIIF';
  var slug = title.replace(/[^\w\u0600-\u06FF]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || ('iiif-' + Date.now());

  var custom = lsGet('coreader-custom-books', []);
  if(custom.some(function(b){ return b.slug === slug; })) slug += '-' + Date.now();

  var kindEl = document.getElementById('iiifKind');
  var kind = (kindEl && kindEl.value === 'museum') ? 'museum' : 'iiif';

  var entry = {
    slug: slug,
    title: title,
    author: pm.summary || 'ناشناس',
    source: kind,
    provider: pm.provider || 'IIIF',
    manifestUrl: pm.url,
    pages: pm.pages || 1,
    cover: '',
    thumbnail: pm.thumbnail || [],
    section: _section || 'raah'
  };

  custom.push(entry);
  localStorage.setItem('coreader-custom-books', JSON.stringify(custom));

  var log = document.getElementById('addLog');
  log.textContent += '\n\n✓ اثر «' + title + '» با موفقیت به کتابخانه افزوده شد!';
  setTimeout(function(){ location.reload(); }, 1000);
};

// Local files upload
var _txtFile = null, _pdfFiles = [];
window.onTxtChosen = function(files){
  _txtFile = files[0] || null;
  document.getElementById('txtFileList').textContent = _txtFile ? ('✓ فایل متنی: ' + _txtFile.name) : '';
};
window.onPdfChosen = function(files){
  _pdfFiles = Array.from(files);
  document.getElementById('pdfFileList').innerHTML = _pdfFiles.map(function(f){
    return '<div>📄 ' + f.name + '</div>';
  }).join('');
};

window.saveLocalBook = function(){
  var title = (document.getElementById('fTitle').value || '').trim();
  var author = (document.getElementById('fAuthor').value || '').trim();
  var log = document.getElementById('addLog');
  log.style.display = 'block';

  if(!title || (!_txtFile && !_pdfFiles.length)){
    log.textContent = (!title ? 'عنوان کتاب را وارد فرمایید.\n' : '') +
      (!_txtFile && !_pdfFiles.length ? 'یک فایل متنی یا PDF انتخاب فرمایید.\n' : '');
    return;
  }

  log.textContent = 'در حال پردازش و استخراج محتوا...\n';
  var slug = title.replace(/[^\w\u0600-\u06FF]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || ('local-' + Date.now());

  var custom = lsGet('coreader-custom-books', []);
  if(custom.some(function(b){ return b.slug === slug; })) slug += '-' + Date.now();

  function finish(pages, pdfSources){
    var bookData = {
      slug: slug,
      title: title,
      author: author || 'ناشناس',
      chapters: [],
      pages: pages,
      searchIndex: [],
      candidateCount: 0,
      cover: '',
      hasPdf: pdfSources && pdfSources.length > 0,
      // NOTE: dataUrl های PDF در localStorage ذخیره نمی‌شوند (QuotaExceeded).
      // فقط متا ذخیره می‌شود؛ فایل اصلی در session نگه داشته شده و از طریق
      // پنل کاربری/IIIF قابل بارگذاری مجدد است.
      pdfSources: (pdfSources || []).map(function(p){ return { id: p.id, label: p.label, filename: p.filename }; })
    };

    var localBooks = lsGet('coreader-local-books', {});
    localBooks[slug] = bookData;
    if(!lsSet('coreader-local-books', localBooks)){
      try {
        // تلاش دوم: حذف قدیمی‌ترین کتاب محلی برای آزادسازی فضا
        var keys = Object.keys(localBooks);
        if(keys.length > 1){ delete localBooks[keys[0]]; }
        if(!lsSet('coreader-local-books', localBooks)){
          log.textContent = '⚠️ فضای مرورگر پر است. کتاب متنی ذخیره شد اما PDF حجیم فقط در همین نشست قابل مشاهده است.\nبرای ذخیره دائمی از «پنل کاربری → پشتیبان‌گیری» استفاده کنید.';
        }
      } catch(e){ log.textContent = '⚠️ فضای مرورگر پر است.'; }
    }
    // نگهداری dataUrl فقط در حافظه (نه localStorage) برای مشاهده PDF در همین نشست
    try { window._localPdfBlobs = window._localPdfBlobs || {}; (pdfSources||[]).forEach(function(p){ if(p.dataUrl) window._localPdfBlobs[slug+':'+p.id] = p.dataUrl; }); } catch(e){}

    custom.push({
      slug: slug,
      title: title,
      author: author || 'ناشناس',
      source: 'local',
      pages: pages.length || (pdfSources ? 10 : 1),
      cover: '',
      section: _section || 'raah'
    });
    if(!lsSet('coreader-custom-books', custom)){
      log.textContent += '\n⚠️ فهرست سفارشی ذخیره نشد (فضای مرورگر پر است).';
      return;
    }

    log.textContent += '\n✓ کتاب «' + title + '» با موفقیت ذخیره شد.';
    setTimeout(function(){ location.reload(); }, 1000);
  }

  if(_txtFile){
    var reader = new FileReader();
    reader.onload = function(e){
      var text = e.target.result.replace(/\r\n?/g, '\n');
      var raw = text.split(/\f|\n{3,}/);
      if(raw.length <= 1){
        raw = [];
        var chunk = 3000;
        for(var pos = 0; pos < text.length;){
          var end = Math.min(pos + chunk, text.length);
          // stop at a line break if there is one in the second half, else at a
          // space: a fixed chunk cuts words in half
          if(end < text.length){
            var cut = text.lastIndexOf('\n', end);
            if(cut <= pos + chunk * 0.5) cut = text.lastIndexOf(' ', end);
            if(cut > pos) end = cut;
          }
          raw.push(text.substring(pos, end));
          pos = end;
        }
      }
      var pages = raw.filter(function(t){ return t.trim(); }).map(function(t, i){
        return {
          page: i + 1,
          html: '<div class="page-content"><p>' + esc(t.trim()).replace(/\n/g, '<br>') + '</p></div>'
        };
      });
      if(_pdfFiles.length) processPdfs(pages); else finish(pages, null);
    };
    reader.readAsText(_txtFile);
  } else {
    processPdfs([]);
  }

  function processPdfs(existingPages){
    var pdfSources = [];
    var done = 0;
    _pdfFiles.forEach(function(f, idx){
      var r = new FileReader();
      r.onload = function(ev){
        var dataUrl = ev.target.result;
        pdfSources.push({
          id: 'pdf_' + (idx + 1),
          label: f.name,
          filename: 'pdf_' + (idx + 1) + '.pdf',
          dataUrl: dataUrl
        });
        done++;
        if(done === _pdfFiles.length){
          var pgs = existingPages;
          if(!pgs.length){
            for(var p = 1; p <= 20; p++){
              pgs.push({ page: p, html: '<div class="page-content"><p>صفحه ' + p + ' (نسخه تصویری PDF)</p></div>' });
            }
          }
          finish(pgs, pdfSources);
        }
      };
      r.readAsDataURL(f);
    });
  }
};

document.addEventListener('DOMContentLoaded', init);
})();
