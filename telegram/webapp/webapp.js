/* webapp.js — مینی‌اپ: جست‌وجو، اثر، تور، ذخیره‌ها، اتصال پنل */
(function(){
'use strict';
var tg = (window.Telegram && Telegram.WebApp) ? Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); }
function siteBase(){
  // telegram/webapp/ -> root
  var p = location.pathname.replace(/\/telegram\/webapp\/?$/, '');
  return location.origin + (p === '/' ? '' : p);
}
var SITE = siteBase();
var BOOKS = [], filter = 'all', tab = 'lib', query = '';
var sel = null;

function lsGet(k, d){ try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function foldFa(s){
  return String(s || '').toLowerCase()
    .replace(/[ً-ٰٟـ‌‍]/g, '')
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[آأإٱ]/g, 'ا');
}
function coverOf(b){
  if (b.cover) return SITE + '/books/' + b.slug + '/' + (b.coverThumb || b.cover);
  var t = Array.isArray(b.thumbnail) ? b.thumbnail[0] : b.thumbnail;
  if (!t) return '';
  if (/^https?:/.test(t)) return SITE + '/proxy-image?url=' + encodeURIComponent(t);
  return t;
}
function openUrl(u){
  if (tg && tg.openLink) tg.openLink(u);
  else location.href = u;
}
function itemHref(b){
  if (b.source === 'against-nature') return SITE + '/viewer/tour.html';
  if (b.source === 'local') return SITE + '/reader/reader.html?book=' + encodeURIComponent(b.slug);
  return SITE + '/viewer/viewer.html?book=' + encodeURIComponent(b.slug);
}

async function load(){
  try {
    var r = await fetch(SITE + '/books-index.json');
    var j = await r.json();
    BOOKS = j.books || j || [];
  } catch (e) { BOOKS = []; }
  document.getElementById('wCount').textContent = BOOKS.length + ' اثر';
  render();
}

function matches(b){
  if (filter === 'iiif' && b.source !== 'iiif') return false;
  if (filter === 'museum' && b.source !== 'museum') return false;
  if (filter === 'tour' && !(b.source === 'against-nature' || b.source === 'tour')) return false;
  if (!query) return true;
  var f = foldFa(query);
  return foldFa((b.title || '') + ' ' + (b.author || '') + ' ' + (b.provider || '')).includes(f);
}

function render(){
  var g = document.getElementById('wGrid');
  if (tab === 'tours') {
    g.style.display = 'block'; g.innerHTML = '';
    g.innerHTML =
      '<a class="w-tour" data-open="' + SITE + '/tour/index.html"><b>🌌 تور زیرزمین</b><small>هفت اتاق · نستعلیق ایرانی · لمسی</small></a>' +
      '<a class="w-tour" data-open="' + SITE + '/viewer/tour.html"><b>🏠 تور خانه د اسنت</b><small>نسخ فارسی · فضای نمادین</small></a>' +
      '<div class="w-sec"><h3>🗺️ پیشنهاد</h3><p>تور را در حالت افقی گوشی ببینید؛ روی نقطه‌های طلایی بزنید تا اثرش در کتابخوان باز شود.</p></div>';
    bindOpen(g); return;
  }
  if (tab === 'saved') {
    var fr = lsGet('coreader-frames', []), tx = lsGet('coreader-texts', []);
    g.style.display = 'block'; g.innerHTML =
      '<div class="w-sec"><h3>🖼️ قاب‌ها (' + fr.length + ')</h3><p>' + (fr.length ? fr.slice(0, 5).map(function(f){ return '• ' + esc(f.title); }).join('<br>') : 'هنوز قابی ذخیره نشده. در سایت روی 📌 قاب بزنید.') + '</p></div>' +
      '<div class="w-sec"><h3>📝 متن‌ها (' + tx.length + ')</h3><p>' + (tx.length ? tx.slice(0, 5).map(function(t){ return '• ' + esc(t.title); }).join('<br>') : 'متنی نیست.') + '</p></div>' +
      '<div class="w-sec"><h3>👤 اتصال پنل</h3><p>کد اتصال را از مینی‌اپ به ربات بفرستید تا حساب‌تان لینک شود.</p><div class="w-row" style="margin-top:8px"><button class="w-btn primary" id="wLinkBtn">🔗 دریافت کد اتصال</button></div><p id="wLinkOut"></p></div>';
    var lb = document.getElementById('wLinkBtn');
    if (lb) lb.onclick = function(){
      var c = lsGet('coreader-tg-code', null);
      if (!c || Date.now() - c.at > 10 * 60 * 1000) { c = { code: Math.floor(100000 + Math.random() * 900000), at: Date.now() }; lsSet('coreader-tg-code', c); }
      document.getElementById('wLinkOut').innerHTML = 'کد شما: <b>' + c.code + '</b>';
      if (tg && tg.sendData) tg.sendData(JSON.stringify({ action: 'link', code: c.code }));
    };
    return;
  }
  if (tab === 'me') {
    var u = lsGet('coreader-user', null);
    g.style.display = 'block';
    g.innerHTML = '<div class="w-sec"><h3>👤 حساب</h3><p>' + (u ? ('<b>' + esc(u.name) + '</b> · ' + esc(u.method || '')) : 'مهمان — در سایت وارد شوید یا کد تلگرامی بگیرید.') + '</p>'
      + '<div class="w-row" style="margin-top:8px"><button class="w-btn" id="wGoPanel">بازکردن پنل کامل</button></div></div>'
      + '<div class="w-sec"><h3>✈️ کانال و گروه</h3><p>کانال: @coreader_fa<br>گروه: باشگاه رونویسی و مسابقه حدس اثر</p><div class="w-row" style="margin-top:8px"><button class="w-btn" id="wGoChan">کانال</button><button class="w-btn" id="wGoGrp">گروه</button></div></div>';
    document.getElementById('wGoPanel').onclick = function(){ openUrl(SITE + '/panel/panel.html'); };
    document.getElementById('wGoChan').onclick = function(){ openUrl('https://t.me/coreader_fa'); };
    var gg = document.getElementById('wGoGrp');
    if (gg) gg.onclick = function(){ openUrl('https://t.me/coreader_club'); };
    return;
  }
  // lib
  g.style.display = ''; g.innerHTML = '';
  var list = BOOKS.filter(matches).slice(0, 60);
  if (!list.length) { g.innerHTML = '<div class="w-sec"><p>چیزی پیدا نشد.</p></div>'; return; }
  list.forEach(function(b, i){
    var d = document.createElement('div');
    d.className = 'w-card';
    d.innerHTML = (coverOf(b) ? '<img loading="lazy" src="' + esc(coverOf(b)) + '" alt="">' : '<div style="aspect-ratio:3/4;display:flex;align-items:center;justify-content:center;font-size:34px">📜</div>')
      + '<div class="t">' + esc(b.title || '') + '</div><div class="a">' + esc(b.author || b.provider || '') + '</div>';
    d.onclick = function(){ openSheet(b); };
    g.appendChild(d);
  });
}
function bindOpen(root){
  root.querySelectorAll('[data-open]').forEach(function(a){
    a.onclick = function(e){ e.preventDefault(); openUrl(a.dataset.open); };
  });
}
function openSheet(b){
  sel = b;
  document.getElementById('wsCover').src = coverOf(b);
  document.getElementById('wsTitle').textContent = b.title || '';
  document.getElementById('wsMeta').textContent = (b.author || b.provider || '') + ' · ' + (b.pages || '?') + ' برگ';
  document.getElementById('wSheet').hidden = false;
}
document.getElementById('wSheetX').onclick = function(){ document.getElementById('wSheet').hidden = true; };
document.getElementById('wSheet').onclick = function(e){ if (e.target.id === 'wSheet') e.currentTarget.hidden = true; };
document.getElementById('wsOpen').onclick = function(){ if (sel) openUrl(itemHref(sel)); };
document.getElementById('wsSave').onclick = function(){
  if (!sel) return;
  var fr = lsGet('coreader-frames', []);
  fr.unshift({ img: coverOf(sel), title: sel.title, book: sel.slug, page: '1', link: itemHref(sel), at: Date.now() });
  lsSet('coreader-frames', fr);
  if (tg && tg.showToast) tg.showToast('ذخیره شد ⭐');
};
document.getElementById('wsShare').onclick = function(){
  if (!sel) return;
  var payload = { action: 'share', title: sel.title, text: (sel.author || sel.provider || ''), link: itemHref(sel) };
  if (tg && tg.sendData) tg.sendData(JSON.stringify(payload));
  else if (navigator.share) navigator.share({ title: sel.title, url: itemHref(sel) });
};
document.getElementById('wQ').addEventListener('input', function(e){ query = e.target.value.trim(); if (tab !== 'lib') setTab('lib'); render(); });
document.getElementById('wFilters').addEventListener('click', function(e){
  var b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('#wFilters button').forEach(function(x){ x.classList.remove('on'); });
  b.classList.add('on'); filter = b.dataset.f; if (tab !== 'lib') setTab('lib'); render();
});
document.querySelector('.w-tabs').addEventListener('click', function(e){
  var b = e.target.closest('button'); if (!b) return;
  setTab(b.dataset.t);
});
function setTab(t){
  tab = t;
  document.querySelectorAll('.w-tabs button').forEach(function(x){ x.classList.toggle('on', x.dataset.t === t); });
  render();
}
document.getElementById('wDaily').onclick = function(){
  if (!BOOKS.length) return;
  openSheet(BOOKS[Math.floor(Math.random() * BOOKS.length)]);
};
load();
})();
