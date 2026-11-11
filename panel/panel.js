/* panel.js — پنل کاربری: مدیریت جامع کاتالوگ، ورود، قاب‌ها، متن‌ها، پروژه IIIF، اشتراک، پشتیبان */
(function(){
'use strict';

function lsGet(k,d){ try{var v=localStorage.getItem(k); return v?JSON.parse(v):d;}catch(e){return d;} }
function lsSet(k,v){ try{localStorage.setItem(k,JSON.stringify(v));return true;}catch(e){return false;} }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function toFA(n){ return String(n).replace(/[0-9]/g, function(d){ return '۰۱۲۳۴۵۶۷۸۹'[d]; }); }
function apiBase(){ return ''; } // same-origin (serve.js)

// فیلتر و نرمال‌سازی جستجوی فارسی
function foldFa(s){
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0640\u200C\u200D]/g, '')
    .replace(/[\u064A\u0649]/g, '\u06CC').replace(/\u0643/g, '\u06A9')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627').replace(/\u06C0/g, '\u0647')
    .replace(/[\u0660-\u0669]/g, function(d){ return String(d.charCodeAt(0) - 0x0660); })
    .replace(/[\u06F0-\u06F9]/g, function(d){ return String(d.charCodeAt(0) - 0x06F0); });
}

// نمایش پیام Toast
function showToast(msg, isErr){
  var t = document.getElementById('catToast');
  if(!t) return;
  t.textContent = msg;
  t.style.borderColor = isErr ? '#ef4444' : 'var(--gold)';
  t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 3500);
}

/* ---------- navigation + font ---------- */
var panes = {
  catalog: 'pane-catalog',
  frames: 'pane-frames',
  texts: 'pane-texts',
  iiif: 'pane-iiif',
  share: 'pane-share',
  backup: 'pane-backup'
};

document.getElementById('navChips').addEventListener('click', function(e){
  var b = e.target.closest('.chip'); if(!b) return;
  document.querySelectorAll('#navChips .chip').forEach(function(c){ c.classList.remove('on'); });
  b.classList.add('on');
  var activeKey = b.dataset.p;
  Object.keys(panes).forEach(function(k){
    var el = document.getElementById(panes[k]);
    if(el) el.hidden = (k !== activeKey);
  });
  if(activeKey === 'catalog'){
    renderCatalogCards();
  }
});

/* ==========================================================================
   بخش مدیریت کارتهای کاتالوگ (CRUD: حذف، اضافه، ویرایش و همگام‌سازی)
   ========================================================================== */
var _catAllBooks = [];
var _catFiltered = [];
var _catPage = 1;
var _CAT_PAGE_SIZE = 24;

// بارگذاری کاتالوگ از سرور یا فایل لوکال و ترکیب با تغییرات کاربر
async function loadCatalogData(){
  var rawList = [];
  var srvStatus = document.getElementById('catSyncStatus');
  if(srvStatus) srvStatus.textContent = 'در حال خواندن کاتالوگ…';

  try {
    // ابتدا تلاش برای دریافت از API سرور
    var r = await fetch(apiBase() + '/api/catalog/books');
    if(r.ok){
      var res = await r.json();
      if(res.ok && Array.isArray(res.books)){
        rawList = res.books;
        if(srvStatus) srvStatus.textContent = '🟢 متصل به سرور محلی (فایل books-index.json)';
      }
    }
  } catch(e){}

  if(!rawList.length){
    // فال‌بک به فایل مستقیم books-index.json
    try {
      var r2 = await fetch('../books-index.json');
      if(r2.ok){
        rawList = await r2.json();
        if(srvStatus) srvStatus.textContent = '🟡 حالت آفلاین / فایل‌محور';
      }
    } catch(e){
      console.warn('Fallback load failed:', e);
    }
  }

  // ادغام با تغییرات ذخیره‌شده در localStorage
  var deleted = lsGet('coreader-catalog-deleted', []);
  var delMap = {};
  deleted.forEach(function(s){ delMap[s] = 1; });

  var overrides = lsGet('coreader-catalog-overrides', {});
  var custom = lsGet('coreader-custom-books', []);

  // 1. حذف موارد نشان‌گذاری شده
  var merged = rawList.filter(function(b){ return !delMap[b.slug]; });

  // 2. اعمال ویرایش‌ها روی کارت‌های موجود
  merged = merged.map(function(b){
    if(overrides[b.slug]){
      return Object.assign({}, b, overrides[b.slug], { _isEdited: true });
    }
    return b;
  });

  // 3. افزودن کارت‌های سفارشی که در لیست اصلی نیستند
  var existingSlugs = {};
  merged.forEach(function(b){ existingSlugs[b.slug] = 1; });
  custom.forEach(function(c){
    if(!delMap[c.slug] && !existingSlugs[c.slug]){
      var item = overrides[c.slug] ? Object.assign({}, c, overrides[c.slug]) : c;
      item._isCustom = true;
      merged.unshift(item);
    }
  });

  _catAllBooks = merged;
  updateCatalogStats();
  filterAndRenderCatalog();
}

// به‌روزرسانی کارت‌های آمار بالای پنل
function updateCatalogStats(){
  var total = _catAllBooks.length;
  var iiif = 0, museum = 0, local = 0, bierah = 0, custom = 0;
  var overrides = lsGet('coreader-catalog-overrides', {});

  _catAllBooks.forEach(function(b){
    if(b.source === 'iiif') iiif++;
    else if(b.source === 'museum') museum++;
    else if(b.source === 'local') local++;

    if(b.section === 'bierah' || b.source === 'against-nature') bierah++;
    if(b._isCustom || b.source === 'community' || overrides[b.slug]) custom++;
  });

  var elTot = document.getElementById('catStatTotal'); if(elTot) elTot.textContent = toFA(total);
  var elI = document.getElementById('catStatIiif'); if(elI) elI.textContent = toFA(iiif);
  var elM = document.getElementById('catStatMuseum'); if(elM) elM.textContent = toFA(museum);
  var elL = document.getElementById('catStatLocal'); if(elL) elL.textContent = toFA(local);
  var elB = document.getElementById('catStatBierah'); if(elB) elB.textContent = toFA(bierah);
  var elC = document.getElementById('catStatCustom'); if(elC) elC.textContent = toFA(custom);
}

// فیلتر و جستجوی کارتها
function filterAndRenderCatalog(){
  var qInput = document.getElementById('catSearchInput');
  var q = foldFa((qInput ? qInput.value : '').trim());
  var fSource = document.getElementById('catFilterSource') ? document.getElementById('catFilterSource').value : 'all';
  var fSection = document.getElementById('catFilterSection') ? document.getElementById('catFilterSection').value : 'all';

  var overrides = lsGet('coreader-catalog-overrides', {});

  _catFiltered = _catAllBooks.filter(function(b){
    // فیلتر منبع
    if(fSource !== 'all'){
      if(fSource === 'community'){
        if(!b._isCustom && b.source !== 'community' && !overrides[b.slug]) return false;
      } else if(b.source !== fSource){
        return false;
      }
    }

    // فیلتر بخش
    if(fSection !== 'all'){
      var bSec = (b.section === 'bierah' || b.source === 'against-nature') ? 'bierah' : 'raah';
      if(bSec !== fSection) return false;
    }

    // جستجوی متن
    if(q){
      var t = foldFa(b.title || '');
      var a = foldFa(b.author || '');
      var p = foldFa(b.provider || '');
      var s = foldFa(b.slug || '');
      if(t.indexOf(q) < 0 && a.indexOf(q) < 0 && p.indexOf(q) < 0 && s.indexOf(q) < 0){
        return false;
      }
    }
    return true;
  });

  _catPage = 1;
  renderCatalogCards();
}

// رندر کارت‌های کاتالوگ به همراه صفحه‌بندی
function renderCatalogCards(){
  var container = document.getElementById('catCardsContainer');
  var matchEl = document.getElementById('catMatchCount');
  if(!container) return;

  var totalFound = _catFiltered.length;
  if(matchEl){
    matchEl.textContent = 'نمایش ' + toFA(totalFound) + ' اثر از کل ' + toFA(_catAllBooks.length) + ' کارت کاتالوگ';
  }

  if(!totalFound){
    container.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;background:var(--cream);border-radius:16px;border:1px dashed var(--border)">'
      + '<div style="font-size:36px;margin-bottom:10px">🔍</div>'
      + '<b>اثری با این مشخصات یافت نشد.</b>'
      + '<div class="kv" style="margin-top:6px">می‌توانید عبارت جستجو را تغییر دهید یا کارت جدیدی بیفزایید.</div>'
      + '</div>';
    renderPagination(0);
    return;
  }

  var start = (_catPage - 1) * _CAT_PAGE_SIZE;
  var end = Math.min(start + _CAT_PAGE_SIZE, totalFound);
  var pageItems = _catFiltered.slice(start, end);

  container.innerHTML = pageItems.map(function(b){
    var coverSrc = b.coverThumb || b.cover || (Array.isArray(b.thumbnail) ? b.thumbnail[0] : b.thumbnail);
    var fullCover = '';
    if(coverSrc){
      if(coverSrc.startsWith('http') || coverSrc.startsWith('/')) fullCover = coverSrc;
      else if(coverSrc.startsWith('books/') || coverSrc.startsWith('img/')) fullCover = '../' + coverSrc;
      else fullCover = '../books/' + b.slug + '/' + coverSrc;
    }

    var kindTag = b.source === 'iiif' ? '<span class="cat-tag iiif">📜 نسخه خطی</span>' :
                  b.source === 'museum' ? '<span class="cat-tag museum">🏛️ شیء موزه‌ای</span>' :
                  b.source === 'local' ? '<span class="cat-tag local">📖 کتاب متنی</span>' :
                  b.source === 'against-nature' ? '<span class="cat-tag tour">🏰 رمان بیراه</span>' :
                  '<span class="cat-tag custom">👤 اثر کاربری</span>';

    var secTag = (b.section === 'bierah' || b.source === 'against-nature') ?
                 '<span class="cat-tag bierah">بیراه</span>' :
                 '<span class="cat-tag raah">راه</span>';

    var editTag = b._isEdited ? '<span class="cat-tag edited">ویرایش‌شده</span>' :
                  b._isCustom ? '<span class="cat-tag custom">جدید</span>' : '';

    var targetUrl = '#';
    if(b.source === 'against-nature') targetUrl = '../viewer/tour.html';
    else if(b.source === 'local') targetUrl = '../reader/reader.html?book=' + encodeURIComponent(b.slug);
    else targetUrl = '../viewer/viewer.html?book=' + encodeURIComponent(b.slug);

    return '<div class="cat-card-item" data-slug="' + esc(b.slug) + '">'
      + '<div class="cat-card-thumb">'
      + (fullCover ? '<img src="' + esc(fullCover) + '" loading="lazy" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';"><div class="thumb-fallback" style="display:none">📜</div>' : '<div class="thumb-fallback">📜</div>')
      + '</div>'
      + '<div class="cat-card-content">'
      + '  <div>'
      + '    <h4 class="cat-card-title" title="' + esc(b.title) + '">' + esc(b.title) + '</h4>'
      + '    <div class="cat-card-author" title="' + esc(b.author || '') + '">' + esc(b.author || 'پدیدآورنده نامشخص') + '</div>'
      + '    <div class="cat-card-meta">'
      +        kindTag + secTag + editTag
      + '      <span style="margin-right:auto">' + (b.pages ? toFA(b.pages) + ' برگ' : '') + '</span>'
      + '    </div>'
      + '    <div class="kv" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(b.provider || '') + '">' + esc(b.provider || 'منبع عمومی') + '</div>'
      + '  </div>'
      + '  <div class="cat-card-actions">'
      + '    <button class="btn sm" data-action="edit" data-slug="' + esc(b.slug) + '">✏️ ویرایش</button>'
      + '    <button class="btn sm danger" data-action="del" data-slug="' + esc(b.slug) + '" title="حذف از کاتالوگ">🗑️ حذف</button>'
      + '    <a class="btn sm ghost" href="' + esc(targetUrl) + '" target="_blank" title="مشاهده اثر در کتابخوان">👁️ مشاهده</a>'
      + '  </div>'
      + '</div>'
      + '</div>';
  }).join('');

  // رویدادهای دکمه‌های هر کارت
  container.querySelectorAll('[data-action="edit"]').forEach(function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      openEditModal(btn.dataset.slug);
    };
  });

  container.querySelectorAll('[data-action="del"]').forEach(function(btn){
    btn.onclick = function(e){
      e.stopPropagation();
      deleteCard(btn.dataset.slug);
    };
  });

  renderPagination(totalFound);
}

// ساخت دکمه‌های صفحه‌بندی
function renderPagination(total){
  var pag = document.getElementById('catPagination');
  if(!pag) return;
  var totalPages = Math.ceil(total / _CAT_PAGE_SIZE);
  if(totalPages <= 1){
    pag.innerHTML = '';
    return;
  }

  var html = '<button class="btn sm ghost" id="catPrevPage" ' + (_catPage <= 1 ? 'disabled' : '') + '>صفحه قبل</button>';
  html += '<span class="page-info">صفحه ' + toFA(_catPage) + ' از ' + toFA(totalPages) + '</span>';
  html += '<button class="btn sm ghost" id="catNextPage" ' + (_catPage >= totalPages ? 'disabled' : '') + '>صفحه بعد</button>';

  pag.innerHTML = html;

  var btnPrev = document.getElementById('catPrevPage');
  var btnNext = document.getElementById('catNextPage');
  if(btnPrev) btnPrev.onclick = function(){ if(_catPage > 1){ _catPage--; renderCatalogCards(); window.scrollTo({top: 300, behavior: 'smooth'}); } };
  if(btnNext) btnNext.onclick = function(){ if(_catPage < totalPages){ _catPage++; renderCatalogCards(); window.scrollTo({top: 300, behavior: 'smooth'}); } };
}

// بازکردن مدال برای افزودن کارت جدید
function openAddModal(){
  document.getElementById('catModalTitle').textContent = '➕ افزودن کارت اثر جدید به کاتالوگ';
  document.getElementById('cardEditOriginalSlug').value = '';
  document.getElementById('cardInpTitle').value = '';
  document.getElementById('cardInpAuthor').value = '';
  document.getElementById('cardInpSource').value = 'iiif';
  document.getElementById('cardInpSection').value = 'raah';
  document.getElementById('cardInpProvider').value = '';
  document.getElementById('cardInpSlug').value = '';
  document.getElementById('cardInpSlug').disabled = false;
  document.getElementById('cardInpPages').value = '';
  document.getElementById('cardInpDate').value = '';
  document.getElementById('cardInpCover').value = '';
  document.getElementById('cardInpManifest').value = '';
  document.getElementById('cardInpLink').value = '';
  document.getElementById('cardInpDesc').value = '';

  updateCardModalPreview();
  document.getElementById('catModal').classList.add('open');
}

// بازکردن مدال برای ویرایش یک کارت موجود
function openEditModal(slug){
  var item = _catAllBooks.find(function(b){ return b.slug === slug; });
  if(!item) return;

  document.getElementById('catModalTitle').textContent = '✏️ ویرایش کارت: ' + (item.title || slug);
  document.getElementById('cardEditOriginalSlug').value = item.slug;
  document.getElementById('cardInpTitle').value = item.title || '';
  document.getElementById('cardInpAuthor').value = item.author || '';
  document.getElementById('cardInpSource').value = item.source || 'iiif';
  document.getElementById('cardInpSection').value = (item.section === 'bierah' || item.source === 'against-nature') ? 'bierah' : 'raah';
  document.getElementById('cardInpProvider').value = item.provider || '';
  document.getElementById('cardInpSlug').value = item.slug;
  document.getElementById('cardInpSlug').disabled = true; // شناسه کارت‌های موجود قفل می‌شود
  document.getElementById('cardInpPages').value = item.pages || '';
  document.getElementById('cardInpDate').value = item.date || '';
  document.getElementById('cardInpCover').value = item.cover || item.coverThumb || '';
  document.getElementById('cardInpManifest').value = item.manifestUrl || '';
  document.getElementById('cardInpLink').value = (item.externalLinks && item.externalLinks.digitalObject) || '';
  document.getElementById('cardInpDesc').value = item.desc || item.description || '';

  updateCardModalPreview();
  document.getElementById('catModal').classList.add('open');
}

function closeCardModal(){
  var m = document.getElementById('catModal');
  if(m) m.classList.remove('open');
}

// پیش‌نمایش زنده در مدال
function updateCardModalPreview(){
  var title = (document.getElementById('cardInpTitle').value || '').trim() || 'عنوان اثر';
  var author = (document.getElementById('cardInpAuthor').value || '').trim() || 'پدیدآورنده';
  var provider = (document.getElementById('cardInpProvider').value || '').trim() || 'موسسه / کتابخانه';
  var source = document.getElementById('cardInpSource').value;
  var coverUrl = (document.getElementById('cardInpCover').value || '').trim();

  document.getElementById('cardPreviewTitle').textContent = title;
  document.getElementById('cardPreviewAuthor').textContent = author;
  document.getElementById('cardPreviewMeta').textContent = provider + ' · ' + (source === 'iiif' ? 'نسخه خطی' : source === 'museum' ? 'شیء موزه' : 'کتاب متنی');

  var thumbEl = document.getElementById('cardPreviewThumb');
  if(coverUrl){
    var displayUrl = coverUrl;
    if(!displayUrl.startsWith('http') && !displayUrl.startsWith('/')){
      displayUrl = '../' + displayUrl;
    }
    thumbEl.innerHTML = '<img src="' + esc(displayUrl) + '" alt="" onerror="this.onerror=null;this.parentElement.innerHTML=\'<span class=\\\'thumb-fallback\\\'>📜</span>\';">';
  } else {
    thumbEl.innerHTML = '<span class="thumb-fallback">📜</span>';
  }
}

// تولید خودکار شناسه slug از عنوان انگلیسی یا فارسی
document.getElementById('cardInpTitle').addEventListener('input', function(){
  var origSlug = document.getElementById('cardEditOriginalSlug').value;
  if(!origSlug){ // فقط در حالت ایجاد کارت جدید
    var slugInp = document.getElementById('cardInpSlug');
    if(!slugInp.dataset.manual){
      var t = document.getElementById('cardInpTitle').value.trim();
      var autoSlug = t.toLowerCase().replace(/[^\w\u0600-\u06FF]+/g, '-').replace(/^-+|-+$/g, '');
      if(autoSlug) slugInp.value = autoSlug.slice(0, 50);
    }
  }
  updateCardModalPreview();
});

document.getElementById('cardInpSlug').addEventListener('input', function(){
  this.dataset.manual = 'true';
});

['cardInpAuthor', 'cardInpProvider', 'cardInpSource', 'cardInpCover'].forEach(function(id){
  var el = document.getElementById(id);
  if(el){
    el.addEventListener('input', updateCardModalPreview);
    el.addEventListener('change', updateCardModalPreview);
  }
});

// ذخیره کارت (چه جدید و چه ویرایش‌شده)
async function saveCard(){
  var origSlug = document.getElementById('cardEditOriginalSlug').value;
  var title = (document.getElementById('cardInpTitle').value || '').trim();
  var author = (document.getElementById('cardInpAuthor').value || '').trim();
  var source = document.getElementById('cardInpSource').value;
  var section = document.getElementById('cardInpSection').value;
  var provider = (document.getElementById('cardInpProvider').value || '').trim();
  var slug = (document.getElementById('cardInpSlug').value || '').trim();
  var pages = parseInt(document.getElementById('cardInpPages').value, 10) || 0;
  var date = (document.getElementById('cardInpDate').value || '').trim();
  var cover = (document.getElementById('cardInpCover').value || '').trim();
  var manifestUrl = (document.getElementById('cardInpManifest').value || '').trim();
  var link = (document.getElementById('cardInpLink').value || '').trim();
  var desc = (document.getElementById('cardInpDesc').value || '').trim();

  if(!title){
    alert('لطفاً عنوان اثر را وارد نمایید.');
    return;
  }
  if(!slug){
    alert('شناسه یکتا (slug) الزامی است.');
    return;
  }

  var itemData = {
    slug: slug,
    title: title,
    author: author,
    source: source,
    section: section,
    provider: provider,
    pages: pages,
    cover: cover,
    manifestUrl: manifestUrl,
    date: date,
    desc: desc,
    externalLinks: link ? { digitalObject: link } : {}
  };

  if(origSlug){
    // ویرایش کارت موجود
    var overrides = lsGet('coreader-catalog-overrides', {});
    overrides[origSlug] = Object.assign({}, overrides[origSlug] || {}, itemData);
    lsSet('coreader-catalog-overrides', overrides);

    // به‌روزرسانی در آرایه جاری
    var idx = _catAllBooks.findIndex(function(b){ return b.slug === origSlug; });
    if(idx >= 0){
      _catAllBooks[idx] = Object.assign({}, _catAllBooks[idx], itemData, { _isEdited: true });
    }
    showToast('کارت «' + title + '» با موفقیت ویرایش شد.');
  } else {
    // افزودن کارت جدید
    var custom = lsGet('coreader-custom-books', []);
    // حذف نسخه قبلی با همین slug در صورت وجود
    custom = custom.filter(function(c){ return c.slug !== slug; });
    custom.unshift(itemData);
    lsSet('coreader-custom-books', custom);

    itemData._isCustom = true;
    _catAllBooks.unshift(itemData);
    showToast('کارت جدید «' + title + '» با موفقیت به کاتالوگ اضافه شد.');
  }

  // تلاش برای ارسال تغییرات به سرور محلی
  try {
    await fetch(apiBase() + '/api/catalog/item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: itemData })
    });
  } catch(e){}

  closeCardModal();
  updateCatalogStats();
  filterAndRenderCatalog();
}

// حذف کارت با تاییدیه
async function deleteCard(slug){
  var item = _catAllBooks.find(function(b){ return b.slug === slug; });
  var title = item ? item.title : slug;

  if(!confirm('آیا مطمئن هستید که می‌خواهید کارت «' + title + '» را از کاتالوگ حذف کنید؟')){
    return;
  }

  // ثبت در لیست اسلاگ‌های حذف‌شده
  var deleted = lsGet('coreader-catalog-deleted', []);
  if(deleted.indexOf(slug) < 0){
    deleted.push(slug);
    lsSet('coreader-catalog-deleted', deleted);
  }

  // پاک کردن از کارت‌های سفارشی و overrides در صورت وجود
  var custom = lsGet('coreader-custom-books', []);
  custom = custom.filter(function(c){ return c.slug !== slug; });
  lsSet('coreader-custom-books', custom);

  var overrides = lsGet('coreader-catalog-overrides', {});
  if(overrides[slug]){
    delete overrides[slug];
    lsSet('coreader-catalog-overrides', overrides);
  }

  // حذف از لیست حافظه
  _catAllBooks = _catAllBooks.filter(function(b){ return b.slug !== slug; });

  // ارسال درخواست حذف به سرور
  try {
    await fetch(apiBase() + '/api/catalog/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: slug })
    });
  } catch(e){}

  showToast('کارت «' + title + '» حذف شد.');
  updateCatalogStats();
  filterAndRenderCatalog();
}

// همگام‌سازی کامل کارت‌های کاتالوگ با سرور
async function syncCatalogWithServer(){
  var statusEl = document.getElementById('catSyncStatus');
  if(statusEl) statusEl.textContent = 'در حال ذخیره و همگام‌سازی با سرور…';

  try {
    var payload = { books: _catAllBooks.map(function(b){
      var copy = Object.assign({}, b);
      delete copy._isEdited;
      delete copy._isCustom;
      return copy;
    })};

    var r = await fetch(apiBase() + '/api/catalog/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if(!r.ok) throw new Error('HTTP ' + r.status);
    var j = await r.json();
    if(j.ok){
      showToast('✅ کاتالوگ با موفقیت روی سرور (books-index.json) ذخیره و همگام شد.');
      if(statusEl) statusEl.textContent = '🟢 همگام شد: ' + toFA(j.count) + ' اثر در فایل books-index.json';
    } else {
      throw new Error(j.error || 'خطا در ذخیره');
    }
  } catch(err){
    showToast('⚠️ ذخیره روی سرور ممکن نشد؛ تغییرات در حافظه محلی مرورگر نگهداری می‌شوند.', true);
    if(statusEl) statusEl.textContent = '⚠️ سرور پاسخ نداد — تغییرات محلی معتبرند';
  }
}

// دریافت خروجی کاتالوگ به صورت JSON
function exportCatalogJson(){
  var blob = new Blob([JSON.stringify(_catAllBooks, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'coreader-catalog-export-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  showToast('فایل JSON کاتالوگ دانلود شد.');
}

// بارگذاری کاتالوگ از فایل JSON
function importCatalogJson(file){
  if(!file) return;
  var reader = new FileReader();
  reader.onload = function(e){
    try {
      var arr = JSON.parse(e.target.result);
      if(!Array.isArray(arr)){
        alert('فایل بارگذاری‌شده حاوی آرایه معتبر کاتالوگ نیست.');
        return;
      }
      if(!confirm('آیا می‌خواهید ' + arr.length + ' کارت از فایل JSON وارد کاتالوگ شوند؟')){
        return;
      }
      _catAllBooks = arr;
      // پاک‌سازی حذف‌های قبلی
      lsSet('coreader-catalog-deleted', []);
      lsSet('coreader-catalog-overrides', {});
      lsSet('coreader-custom-books', arr.filter(function(x){ return x._isCustom || x.source === 'community'; }));
      syncCatalogWithServer();
      updateCatalogStats();
      filterAndRenderCatalog();
      showToast('کاتالوگ از فایل با موفقیت بازیابی شد.');
    } catch(err){
      alert('خطا در خواندن فایل JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// بازنشانی کاتالوگ به نسخه اولیه پیش‌فرض
async function resetCatalogToDefault(){
  if(!confirm('آیا مطمئن هستید که می‌خواهید تمام کارت‌های حذف‌شده و ویرایش‌شده را به حالت پیش‌فرض اولیه بازگردانید؟')){
    return;
  }
  lsSet('coreader-catalog-deleted', []);
  lsSet('coreader-catalog-overrides', {});
  lsSet('coreader-custom-books', []);

  try {
    await fetch(apiBase() + '/api/catalog/reset', { method: 'POST' });
  } catch(e){}

  await loadCatalogData();
  showToast('کاتالوگ به تنظیمات پیش‌فرض بازگردانی شد.');
}

// تنظیم رویدادهای نوار ابزار کاتالوگ
document.getElementById('btnOpenAddModal').onclick = openAddModal;
document.getElementById('btnCloseCatModal').onclick = closeCardModal;
document.getElementById('btnCancelCatModal').onclick = closeCardModal;
document.getElementById('btnSaveCard').onclick = saveCard;

document.getElementById('catSearchInput').addEventListener('input', filterAndRenderCatalog);
document.getElementById('catFilterSource').addEventListener('change', filterAndRenderCatalog);
document.getElementById('catFilterSection').addEventListener('change', filterAndRenderCatalog);

document.getElementById('btnSyncCatalog').onclick = syncCatalogWithServer;
document.getElementById('btnExportCatalogJson').onclick = exportCatalogJson;
document.getElementById('btnImportCatalogJson').onclick = function(){
  document.getElementById('catImportFile').click();
};
document.getElementById('catImportFile').onchange = function(e){
  importCatalogJson(e.target.files[0]);
};
document.getElementById('btnResetCatalog').onclick = resetCatalogToDefault;

// بستن مدال با کلیک روی پس‌زمینه
document.getElementById('catModal').addEventListener('click', function(e){
  if(e.target === this) closeCardModal();
});


/* ==========================================================================
   بخش‌های کاربری: ورود، قاب‌ها، متن‌ها، IIIF، اشتراک، پشتیبان
   ========================================================================== */

/* ---------- auth: local + server + telegram ---------- */
var user = lsGet('coreader-user', null);
function renderAuth(){
  var box = document.getElementById('authBox');
  if(!box) return;
  if(user){
    box.innerHTML = '<div style="display:flex;gap:10px;align-items:center"><div class="avatar">' + esc((user.name||'ک')[0]) + '</div><div><b>' + esc(user.name||'کاربر') + '</b><div class="kv">' + esc(user.method === 'telegram' ? 'ورود با تلگرام' : 'حساب محلی') + ' · ' + esc(user.id || '') + '</div></div></div>'
      + '<div class="btn-row"><button class="btn ghost sm" id="btnLogout">خروج از حساب</button></div>';
    document.getElementById('btnLogout').onclick = function(){ user = null; lsSet('coreader-user', null); renderAuth(); };
    return;
  }
  box.innerHTML = '<input class="inp" id="loginName" placeholder="نام نمایشی (مثلاً: سارا)">'
    + '<div class="btn-row"><button class="btn primary sm" id="btnLocalLogin">ورود محلی</button>'
    + '<button class="btn sm" id="btnTgCode">کد تلگرامی</button></div>'
    + '<div id="tgCodeBox" style="font-size:12px;line-height:2"></div>'
    + '<div class="kv">کد تلگرامی را در ربات وارد کنید تا حساب‌تان به تلگرام وصل شود. بدون سرور هم همه امکانات محلی کار می‌کند.</div>';

  document.getElementById('btnLocalLogin').onclick = function(){
    var n = (document.getElementById('loginName').value || '').trim() || 'کاربر مهمان';
    user = { id: 'local-' + Date.now().toString(36), name: n, method: 'local', created: Date.now() };
    lsSet('coreader-user', user); serverLogin(); renderAuth();
  };
  document.getElementById('btnTgCode').onclick = async function(){
    var n = (document.getElementById('loginName').value || '').trim() || 'کاربر مهمان';
    var code = Math.floor(100000 + Math.random() * 900000);
    lsSet('coreader-tg-code', { code: code, name: n, at: Date.now() });
    document.getElementById('tgCodeBox').innerHTML = 'کد اتصال شما: <div class="login-code">' + code + '</div>در ربات بفرستید: <b dir="ltr">/link ' + code + '</b>';
    try { await fetch(apiBase() + '/api/auth/request-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code, name: n }) }); } catch(e){}
  };
}

async function serverLogin(){
  try {
    if(!user) return;
    await fetch(apiBase() + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(user) });
  } catch(e){}
}

async function pollTgLink(){
  var c = lsGet('coreader-tg-code', null); if(!c || user) return;
  try {
    var r = await fetch(apiBase() + '/api/auth/check-code?code=' + encodeURIComponent(c.code));
    if(!r.ok) return;
    var j = await r.json();
    if(j && j.user){ user = j.user; lsSet('coreader-user', user); renderAuth(); }
  } catch(e){}
}

/* ---------- frames ---------- */
function getFrames(){ return lsGet('coreader-frames', []); }
function renderFrames(){
  var g = document.getElementById('framesGrid'); if(!g) return;
  var fr = getFrames();
  if(!fr.length){ g.innerHTML = '<div class="kv">هنوز قابی ذخیره نشده. در ویور روی «📌 ذخیره قاب» بزنید.</div>'; return; }
  g.innerHTML = fr.map(function(f, i){
    return '<div class="saved-item"><img src="' + esc(f.img) + '" loading="lazy" alt="">'
      + '<div class="sb2"><b>' + esc(f.title || 'قاب ' + (i + 1)) + '</b><div class="kv">' + esc(f.book || '') + ' · ص ' + esc(f.page || '?') + '</div>'
      + '<div class="btn-row"><a class="btn sm" href="' + esc(f.link || '#') + '">بازکردن</a>'
      + '<button class="btn ghost sm" data-share="' + i + '">اشتراک</button>'
      + '<button class="btn ghost sm danger" data-del="' + i + '">✕</button></div></div></div>';
  }).join('');
  g.querySelectorAll('[data-del]').forEach(function(b){ b.onclick = function(){ var a = getFrames(); a.splice(+b.dataset.del, 1); lsSet('coreader-frames', a); renderFrames(); }; });
  g.querySelectorAll('[data-share]').forEach(function(b){ b.onclick = function(){ selectForShare({ kind: 'frame', index: +b.dataset.share }); }; });
}

document.getElementById('btnAddFrame').onclick = function(){
  var u = prompt('URL تصویر قاب:'); if(!u) return;
  var t = prompt('عنوان قاب:') || 'قاب دستی';
  var fr = getFrames(); fr.unshift({ img: u, title: t, at: Date.now(), link: u }); lsSet('coreader-frames', fr); renderFrames();
};
document.getElementById('btnClearFrames').onclick = function(){ if(confirm('همه قاب‌ها پاک شود؟')){ lsSet('coreader-frames', []); renderFrames(); } };

/* ---------- texts ---------- */
function getTexts(){ return lsGet('coreader-texts', []); }
function renderTexts(){
  var g = document.getElementById('textsGrid'); if(!g) return;
  var tx = getTexts();
  g.innerHTML = tx.length ? tx.map(function(t, i){
    return '<div class="saved-item"><div class="sb2"><b>' + esc(t.title) + '</b><div>' + esc(t.body).slice(0, 180) + '</div>'
      + (t.link ? '<a href="' + esc(t.link) + '" style="font-size:12px;color:var(--accent)">پیوند اثر</a>' : '')
      + '<div class="btn-row"><button class="btn ghost sm" data-share-t="' + i + '">اشتراک</button><button class="btn ghost sm danger" data-del-t="' + i + '">✕</button></div></div></div>';
  }).join('') : '<div class="kv">متنی ذخیره نشده است.</div>';
  g.querySelectorAll('[data-del-t]').forEach(function(b){ b.onclick = function(){ var a = getTexts(); a.splice(+b.dataset.delT, 1); lsSet('coreader-texts', a); renderTexts(); }; });
  g.querySelectorAll('[data-share-t]').forEach(function(b){ b.onclick = function(){ selectForShare({ kind: 'text', index: +b.dataset.shareT }); }; });
}

document.getElementById('btnSaveText').onclick = function(){
  var t = (document.getElementById('txtTitle').value || '').trim(), b = (document.getElementById('txtBody').value || '').trim(), l = (document.getElementById('txtLink').value || '').trim();
  if(!t || !b){ alert('عنوان و متن لازم است.'); return; }
  var tx = getTexts(); tx.unshift({ title: t, body: b, link: l, at: Date.now() }); lsSet('coreader-texts', tx);
  document.getElementById('txtTitle').value = ''; document.getElementById('txtBody').value = ''; renderTexts();
  showToast('متن ذخیره شد.');
};

/* ---------- IIIF projects ---------- */
function getPrjs(){ return lsGet('coreader-iiif-projects', []); }
function renderPrjs(){
  var box = document.getElementById('prjList'); if(!box) return;
  var ps = getPrjs();
  box.innerHTML = ps.length ? ps.map(function(p, i){
    return '<div class="anno-row"><b>' + esc(p.name) + '</b> <span class="kv">· ' + (p.annos || []).length + ' حاشیه</span><div class="kv" dir="ltr">' + esc(p.manifest || '') + '</div>'
      + '<div class="btn-row"><button class="btn sm" data-open-p="' + i + '">بازکردن</button><a class="btn sm" href="iiif-editor.html?prj=' + esc(p.id) + '">✏️ ادیتور</a><button class="btn sm" data-add-to-cat="' + i + '">➕ افزودن به کاتالوگ</button><button class="btn ghost sm" data-exp-p="' + i + '">⬇ مانیفست</button><button class="btn ghost sm danger" data-del-p="' + i + '">✕</button></div></div>';
  }).join('') : '<div class="kv">پروژه‌ای نیست. یکی بسازید.</div>';

  box.querySelectorAll('[data-del-p]').forEach(function(b){ b.onclick = function(){ var a = getPrjs(); a.splice(+b.dataset.delP, 1); lsSet('coreader-iiif-projects', a); renderPrjs(); document.getElementById('prjDetail').innerHTML = ''; }; });
  box.querySelectorAll('[data-exp-p]').forEach(function(b){ b.onclick = function(){ exportManifest(+b.dataset.expP); }; });
  box.querySelectorAll('[data-open-p]').forEach(function(b){ b.onclick = function(){ openProject(+b.dataset.openP); }; });
  box.querySelectorAll('[data-add-to-cat]').forEach(function(b){ b.onclick = function(){ addProjectToCatalog(+b.dataset.addToCat); }; });
}

// افزودن پروژه IIIF به عنوان کارت کاتالوگ
function addProjectToCatalog(i){
  var ps = getPrjs(); var p = ps[i]; if(!p) return;
  openAddModal();
  document.getElementById('cardInpTitle').value = p.name || '';
  document.getElementById('cardInpSource').value = 'iiif';
  document.getElementById('cardInpSection').value = 'raah';
  document.getElementById('cardInpManifest').value = p.manifest || '';
  document.getElementById('cardInpSlug').value = (p.id || 'prj-' + Date.now()).replace(/[^\w-]/g, '');
  document.getElementById('cardInpDesc').value = 'پروژه حاشیه‌نگاری و رونویسی IIIF فارسی (' + (p.annos || []).length + ' حاشیه)';
  updateCardModalPreview();
}

document.getElementById('btnCreatePrj').onclick = function(){
  var n = (document.getElementById('prjName').value || '').trim(), m = (document.getElementById('prjManifest').value || '').trim();
  if(!n){ alert('نام پروژه لازم است.'); return; }
  var ps = getPrjs(); var p = { id: 'prj-' + Date.now().toString(36), name: n, manifest: m, annos: [], created: Date.now() };
  ps.unshift(p); lsSet('coreader-iiif-projects', ps); renderPrjs(); openProject(0);
  document.getElementById('prjName').value = ''; document.getElementById('prjManifest').value = '';
};

function openProject(i){
  var ps = getPrjs(); var p = ps[i]; if(!p) return;
  var d = document.getElementById('prjDetail'); if(!d) return;
  d.innerHTML = '<div class="anno-row"><b>افزودن حاشیه به: ' + esc(p.name) + '</b>'
    + '<label class="lbl">برگ / کانوس (شماره یا URL)</label><input class="inp" id="anCanvas" placeholder="1">'
    + '<label class="lbl">ناحیه (x,y,w,h به درصد — مثلاً 10,20,30,15)</label><input class="inp" id="anXywh" placeholder="10,20,30,15" dir="ltr">'
    + '<label class="lbl">رونویسی / متن فارسی</label><textarea class="inp" id="anText" rows="2"></textarea>'
    + '<label class="lbl">ترجمه / توضیح (اختیاری)</label><input class="inp" id="anTr">'
    + '<label class="lbl">برچسب</label><input class="inp" id="anTag" placeholder="تذهیب، حاشیه، مهر، …">'
    + '<div class="btn-row"><button class="btn primary sm" id="btnAddAnno">افزودن حاشیه</button><button class="btn sm" id="btnExpMan">⬇ خروجی مانیفست v3</button><button class="btn sm" id="btnGroupAnnos">💬 حاشیه‌های گروه</button></div>'
    + '<div id="groupAnnos" style="margin-top:8px"></div>'
    + '<div id="annoList" style="margin-top:10px;display:flex;flex-direction:column;gap:8px"></div></div>';

  function drawAnnos(){
    document.getElementById('annoList').innerHTML = (p.annos || []).map(function(a, j){
      return '<div class="anno-row">🖋️ ' + esc(a.text || '') + ' <span class="kv">[' + esc(a.xywh || '') + ' · ' + esc(a.tag || 'بدون برچسب') + ']</span>'
        + (a.translation ? '<div class="kv">ترجمه: ' + esc(a.translation) + '</div>' : '')
        + '<div class="btn-row"><button class="btn ghost sm danger" data-adel="' + j + '">حذف</button></div></div>';
    }).join('') || '<div class="kv">حاشیه‌ای نیست.</div>';
    document.querySelectorAll('[data-adel]').forEach(function(b){ b.onclick = function(){ p.annos.splice(+b.dataset.adel, 1); ps[i] = p; lsSet('coreader-iiif-projects', ps); renderPrjs(); openProject(i); }; });
  }
  drawAnnos();

  document.getElementById('btnAddAnno').onclick = function(){
    var a = { canvas: (document.getElementById('anCanvas').value || '1').trim(), xywh: (document.getElementById('anXywh').value || '').trim(), text: document.getElementById('anText').value, translation: document.getElementById('anTr').value, tag: document.getElementById('anTag').value, by: (user && user.name) || 'کاربر', at: new Date().toISOString() };
    p.annos = p.annos || []; p.annos.push(a); ps[i] = p; lsSet('coreader-iiif-projects', ps); renderPrjs(); openProject(i);
  };
  document.getElementById('btnExpMan').onclick = function(){ exportManifest(i); };
  document.getElementById('btnGroupAnnos').onclick = async function(){
    var box = document.getElementById('groupAnnos'); box.innerHTML = '<div class="kv">در حال دریافت از سرور…</div>';
    try {
      var r = await fetch(apiBase() + '/api/annotations?project=' + encodeURIComponent('urn:coreader:' + p.id));
      if(!r.ok) throw new Error('srv');
      var arr = await r.json();
      if(!arr.length){ box.innerHTML = '<div class="kv">هنوز حاشیه گروهی نیست. در گروه بفرستید:<br><code dir="ltr">/hashiye ' + esc(p.id) + ' متن شما #برچسب</code></div>'; return; }
      box.innerHTML = arr.map(function(a){
        return '<div class="anno-row">💬 ' + esc(a.text || '') + ' <span class="kv">· ' + esc(a.by || '') + (a.tag ? ' · #' + esc(a.tag) : '') + '</span></div>';
      }).join('') + '<div class="btn-row"><button class="btn primary sm" id="btnMergeAnnos">➕ افزودن همه به پروژه</button></div>';
      document.getElementById('btnMergeAnnos').onclick = function(){
        p.annos = p.annos || [];
        arr.forEach(function(a){ p.annos.push({ canvas: '1', xywh: '', text: a.text || '', translation: '', tag: a.tag || 'گروه', by: a.by || 'گروه', at: new Date(a.at || Date.now()).toISOString() }); });
        ps[i] = p; lsSet('coreader-iiif-projects', ps); renderPrjs(); openProject(i);
      };
    } catch(e){ box.innerHTML = '<div class="kv">⚠️ سرور در دسترس نیست (serve.js باید روشن باشد).</div>'; }
  };
}

function buildManifest(p){
  var canvases = {};
  (p.annos || []).forEach(function(a){ (canvases[a.canvas] = canvases[a.canvas] || []).push(a); });
  var items = Object.keys(canvases).map(function(c, idx){
    return { id: (p.manifest || 'urn:coreader:' + p.id) + '#canvas/' + encodeURIComponent(c), type: 'Canvas', label: { fa: [String(c)] },
      annotations: [{ id: 'urn:coreader:' + p.id + ':list:' + idx, type: 'AnnotationPage',
        items: canvases[c].map(function(a, j){ return { id: 'urn:coreader:' + p.id + ':anno:' + idx + '-' + j, type: 'Annotation', motivation: 'commenting',
          creator: { type: 'Person', name: a.by }, created: a.at,
          body: [{ type: 'TextualBody', value: a.text || '', language: 'fa' }, { type: 'TextualBody', value: (a.translation || ''), language: 'fa', purpose: 'commenting' }],
          target: (p.manifest || 'urn:coreader:' + p.id) + '#canvas/' + encodeURIComponent(c) + (a.xywh ? ('#xywh=' + a.xywh) : ''),
          tag: a.tag || '' }; }) }] };
  });
  return { '@context': 'http://iiif.io/api/presentation/3/context.json', id: 'urn:coreader:' + p.id, type: 'Manifest',
    label: { fa: [p.name] }, summary: { fa: ['پروژه غنی‌سازی نسخ فارسی و اشیاء موزه‌ای — ساخته‌شده در پنل کاربری coreader'] },
    requiredStatement: { label: { fa: ['پدیدآورنده'] }, value: { fa: [(user && user.name) || 'کاربر coreader'] } },
    items: items.length ? items : [{ id: 'urn:coreader:' + p.id + '#canvas/1', type: 'Canvas', label: { fa: ['برگ ۱'] } }] };
}

function exportManifest(i){
  var ps = getPrjs(); var p = ps[i]; if(!p) return;
  var m = buildManifest(p);
  var blob = new Blob([JSON.stringify(m, null, 2)], { type: 'application/json' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = p.id + '-manifest.json'; a.click();
  fetch(apiBase() + '/api/manifests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: p, manifest: m, user: user }) }).catch(function(){});
}

/* ---------- share ---------- */
var shareSel = null;
function selectForShare(s){
  shareSel = s;
  document.querySelectorAll('#navChips .chip').forEach(function(c){ c.classList.toggle('on', c.dataset.p === 'share'); });
  Object.keys(panes).forEach(function(k){ var el = document.getElementById(panes[k]); if(el) el.hidden = (k !== 'share'); });
  var d = shareData();
  document.getElementById('shareTitle').value = d.title || '';
  document.getElementById('shareSub').value = d.text || '';
  document.getElementById('shareCaption').value = defaultCaption(d);
  renderSharePreview();
}

function shareData(){
  if(!shareSel) return { title: 'کتابخانه نسخ خطی coreader', img: null, text: 'مرور، خوانش و حاشیه‌نویسی نفایس خطی فارسی' };
  if(shareSel.kind === 'frame'){ var f = getFrames()[shareSel.index]; return { title: f.title, img: f.img, text: (f.book || '') + ' · ص ' + (f.page || ''), link: f.link }; }
  var t = getTexts()[shareSel.index]; return { title: t.title, img: null, text: t.body, link: t.link };
}

function shareEdits(){
  return {
    title: (document.getElementById('shareTitle').value || '').trim(),
    sub: (document.getElementById('shareSub').value || '').trim(),
    caption: document.getElementById('shareCaption').value,
    fit: document.getElementById('shareFit').value || 'cover'
  };
}

function effShare(){
  var d = shareData(), e = shareEdits();
  return { title: e.title || d.title, text: (e.sub !== '' ? e.sub : d.text), img: d.img, link: d.link, fit: e.fit, caption: e.caption };
}

function renderSharePreview(){
  var previewEl = document.getElementById('sharePreview'); if(!previewEl) return;
  var d = effShare(); var theme = document.getElementById('shareTheme').value;
  previewEl.innerHTML = '<div class="share-card ' + esc(theme) + '">'
    + (d.img ? '<img class="sc-cover" style="object-fit:' + esc(d.fit) + (d.fit === 'contain' ? ';background:#000' : '') + '" src="' + esc(d.img) + '">' : '')
    + '<div class="sc-body"><p class="sc-title">' + esc(d.title) + '</p><div class="sc-sub">' + esc(d.text || '').slice(0, 220) + '</div>'
    + '<div class="sc-brand">📜 coreader · نسخ خطی و اوراق فارسی' + (shareSel ? '' : ' (نمونه)') + '</div></div></div>';
}

document.getElementById('shareTheme').onchange = renderSharePreview;
['shareTitle', 'shareSub', 'shareFit', 'shareCaption'].forEach(function(id){
  var el = document.getElementById(id);
  if(el){
    el.addEventListener('input', renderSharePreview);
    el.addEventListener('change', renderSharePreview);
  }
});

document.getElementById('btnRenderCard').onclick = function(){
  var d = effShare(); var theme = document.getElementById('shareTheme').value;
  var cv = document.getElementById('shareCanvas'); var ctx = cv.getContext('2d');
  var bgc = theme === 'naskh' ? '#f6efdd' : '#14100c';
  ctx.fillStyle = bgc; ctx.fillRect(0, 0, 1080, 1350);

  function drawText(){
    ctx.fillStyle = theme === 'naskh' ? '#5b3413' : '#f6d47c'; ctx.textAlign = 'center';
    ctx.font = (theme === 'house' ? '64px "Noto Naskh Arabic", "Scheherazade New", serif' : '60px "Noto Nastaliq Urdu", serif');
    wrapFa(ctx, d.title, 540, theme === 'house' ? 880 : 860, 70, 900);
    ctx.fillStyle = theme === 'naskh' ? '#7c5a2e' : '#cbbfa7'; ctx.font = '30px "Scheherazade New", "Noto Naskh Arabic", serif';
    wrapFa(ctx, (d.text || '').slice(0, 160), 540, 1050, 44, 880);
    ctx.fillStyle = theme === 'naskh' ? '#a08c5f' : '#9c8f76'; ctx.font = '24px Vazirmatn'; ctx.fillText('coreader · نسخ خطی و اوراق فارسی', 540, 1280);
    var url = cv.toDataURL('image/png');
    document.getElementById('sharePreview').innerHTML += '<div class="btn-row"><a class="btn primary" download="coreader-share.png" href="' + url + '">⬇ دانلود کارت (1080×1350)</a></div><img src="' + url + '" style="margin-top:10px">';
  }

  if(d.img){
    var im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = function(){
      if(d.fit === 'contain'){
        ctx.save(); ctx.filter = 'blur(40px) brightness(.5)'; ctx.drawImage(im, 0, 0, 1080, 760); ctx.restore();
        var r = Math.min(1080 / im.width, 760 / im.height), w = im.width * r, h = im.height * r;
        ctx.drawImage(im, (1080 - w) / 2, (760 - h) / 2, w, h);
      } else {
        var r2 = Math.max(1080 / im.width, 760 / im.height), w2 = im.width * r2, h2 = im.height * r2;
        ctx.drawImage(im, (1080 - w2) / 2, (760 - h2) / 2, w2, h2);
      }
      drawText();
    };
    im.onerror = drawText; im.src = d.img;
  } else {
    drawText();
  }
};

function wrapFa(ctx, text, cx, y, lh, maxW){
  var words = String(text || '').split(/\s+/); var line = '', yy = y;
  words.forEach(function(w){ var t = line ? line + ' ' + w : w; if(ctx.measureText(t).width > maxW && line){ ctx.fillText(line, cx, yy); line = w; yy += lh; } else line = t; });
  if(line) ctx.fillText(line, cx, yy);
}

function defaultCaption(d){ d = d || shareData(); return '📜 ' + d.title + '\n\n' + (d.text || '') + '\n\n— via coreader · نسخ خطی و اوراق فارسی\n' + (d.link || location.origin + location.pathname.replace(/panel\/.*/, '')); }
function captionText(){ var c = (document.getElementById('shareCaption').value || '').trim(); if(c) return c; return defaultCaption(effShare()); }

document.getElementById('btnCopyCaption').onclick = function(){
  var t = captionText();
  if(navigator.clipboard) navigator.clipboard.writeText(t).then(function(){ showToast('کپشن فارسی کپی شد.'); });
  else { prompt('کپشن:', t); }
};

function openShare(url){ window.open(url, '_blank'); }
document.getElementById('btnShareTg').onclick = function(){ openShare('https://t.me/share/url?url=' + encodeURIComponent(location.href) + '&text=' + encodeURIComponent(captionText())); };
document.getElementById('btnShareWa').onclick = function(){ openShare('https://wa.me/?text=' + encodeURIComponent(captionText())); };
document.getElementById('btnShareX').onclick = function(){ openShare('https://twitter.com/intent/tweet?text=' + encodeURIComponent(captionText())); };

/* ---------- backup / sync ---------- */
document.getElementById('btnExport').onclick = function(){
  var data = {
    user: user,
    catalogOverrides: lsGet('coreader-catalog-overrides', {}),
    catalogDeleted: lsGet('coreader-catalog-deleted', []),
    customBooks: lsGet('coreader-custom-books', []),
    frames: getFrames(),
    texts: getTexts(),
    projects: getPrjs(),
    favs: lsGet('coreader-favs', []),
    at: new Date().toISOString()
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'coreader-backup.json'; a.click();
};

document.getElementById('btnImport').onclick = function(){ document.getElementById('importFile').click(); };
document.getElementById('importFile').onchange = function(e){
  var f = e.target.files[0]; if(!f) return;
  var r = new FileReader(); r.onload = function(){
    try {
      var j = JSON.parse(r.result);
      if(j.catalogOverrides) lsSet('coreader-catalog-overrides', j.catalogOverrides);
      if(j.catalogDeleted) lsSet('coreader-catalog-deleted', j.catalogDeleted);
      if(j.customBooks) lsSet('coreader-custom-books', j.customBooks);
      if(j.frames) lsSet('coreader-frames', j.frames);
      if(j.texts) lsSet('coreader-texts', j.texts);
      if(j.projects) lsSet('coreader-iiif-projects', j.projects);
      if(j.favs) lsSet('coreader-favs', j.favs);
      renderFrames(); renderTexts(); renderPrjs();
      loadCatalogData();
      showToast('اطلاعات با موفقیت بازیابی شد.');
    } catch(err){ alert('فایل معتبر نیست.'); }
  }; r.readAsText(f);
};

document.getElementById('btnSync').onclick = async function(){
  var log = document.getElementById('syncLog'); if(log) log.textContent = 'در حال همگام‌سازی…';
  try {
    var payload = { user: user, frames: getFrames(), texts: getTexts(), projects: getPrjs(), at: Date.now() };
    var r = await fetch(apiBase() + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if(!r.ok) throw new Error('server ' + r.status);
    var j = await r.json();
    if(log) log.textContent = '✅ همگام شد: ' + j.saved + ' قلم روی سرور.';
    showToast('همگام‌سازی با موفقیت انجام شد.');
  } catch(e){
    if(log) log.textContent = '⚠️ سرور در دسترس نیست (حالت آفلاین/استاتیک). پشتیبان JSON را نگه دارید.';
  }
};

/* ---------- init ---------- */
renderAuth();
loadCatalogData();
renderFrames();
renderTexts();
renderPrjs();
renderSharePreview();
setInterval(pollTgLink, 4000);
document.body.classList.remove('font-house', 'font-nastaliq', 'font-naskh');

})();
