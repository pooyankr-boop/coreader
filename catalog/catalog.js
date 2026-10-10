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

function init(){
  loadAppTheme();
  loadSavedViewMode();

  // Read URL params or hash
  var params = new URLSearchParams(location.search);
  var qf = params.get('filter') || location.hash.slice(1);
  if(qf && /^(all|iiif|museum|local|tour|against-nature)$/.test(qf)){
    _filter = (qf === 'against-nature') ? 'tour' : qf;
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
      try { custom = JSON.parse(localStorage.getItem('coreader-custom-books') || '[]'); } catch(e){}
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
      try { custom = JSON.parse(localStorage.getItem('coreader-custom-books') || '[]'); } catch(e){}
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
  try { progress = JSON.parse(localStorage.getItem('coreader-progress') || '{}'); } catch(e){}
  try { favs = JSON.parse(localStorage.getItem('coreader-favs') || '[]'); } catch(e){}
  var favSlugs = {};
  favs.forEach(function(f){ if(f.slug) favSlugs[f.slug] = 1; });

  grid.innerHTML = list.map(function(b, i){
    var pg = progress[b.slug] || 0;
    var pct = b.pages ? Math.min(100, Math.round(pg / b.pages * 100)) : 0;
    var pbar = pct > 0 ?
      '<div class="card-progress"><div class="card-progress-bar" style="width:' + pct + '%"></div></div>' +
      '<div class="card-progress-text"><span>پیشرفت مطالعه</span><span>' + toFA(pct) + '٪</span></div>' : '';

    var coverSrc = b.cover ? ('books/' + b.slug + '/' + b.cover) : '';
    if(!coverSrc && b.thumbnail){
      var t0 = Array.isArray(b.thumbnail) ? b.thumbnail[0] : b.thumbnail;
      coverSrc = t0;
    }

    var coverImg = coverSrc ?
      '<img class="card-cover" src="' + esc(coverSrc) + '" alt="' + plainText(b.title || '') + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' : '';

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
          return '<div class="slide' + (si === 0 ? ' active' : '') + '"><img src="' + url + '" alt="" loading="lazy"></div>';
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

    card.addEventListener('mouseenter', function(){
      clearInterval(_slideIntervals[slug]);
      _slideIntervals[slug] = setInterval(function(){
        // re-query every tick: a slide can vanish under us mid-show
        live = slides();
        if(live.length < 2){ dropSlideshow(card, ss); return; }
        live[idx % live.length].classList.remove('active');
        idx = (idx + 1) % live.length;
        live[idx].classList.add('active');
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

  // Thumbs gallery
  var thumbsRow = document.getElementById('qvThumbsRow');
  thumbsRow.innerHTML = '';
  if(book.thumbnail){
    var thumbs = Array.isArray(book.thumbnail) ? book.thumbnail : [book.thumbnail];
    thumbs.slice(0, 6).forEach(function(u){
      var img = document.createElement('img');
      img.className = 'qv-thumb';
      img.src = u;
      img.onclick = function(){ document.getElementById('qvCoverImg').src = u; };
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
  var favs = JSON.parse(localStorage.getItem('coreader-favs') || '[]');
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

  var favs = JSON.parse(localStorage.getItem('coreader-favs') || '[]');
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
  var favs = JSON.parse(localStorage.getItem('coreader-favs') || '[]');
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
  var favs = JSON.parse(localStorage.getItem('coreader-favs') || '[]');
  favs.splice(i, 1);
  localStorage.setItem('coreader-favs', JSON.stringify(favs));
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
    return fetch(manUrl).then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(m){
      var label = iiifLabel(m.label) || 'نسخه خطی بدون عنوان';
      var summary = iiifLabel(m.summary);
      var prov = iiifLabel(Array.isArray(m.provider) ? m.provider[0] : m.provider) || String(m.attribution || '').replace(/^Provided by\s+/i, '');
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

  var custom = JSON.parse(localStorage.getItem('coreader-custom-books') || '[]');
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

  var custom = JSON.parse(localStorage.getItem('coreader-custom-books') || '[]');
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
      pdfSources: pdfSources || []
    };

    var localBooks = JSON.parse(localStorage.getItem('coreader-local-books') || '{}');
    localBooks[slug] = bookData;
    localStorage.setItem('coreader-local-books', JSON.stringify(localBooks));

    custom.push({
      slug: slug,
      title: title,
      author: author || 'ناشناس',
      source: 'local',
      pages: pages.length || (pdfSources ? 10 : 1),
      cover: '',
      section: _section || 'raah'
    });
    localStorage.setItem('coreader-custom-books', JSON.stringify(custom));

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
