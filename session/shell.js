// session/shell.js — هدر و تم یکسان با کاتالوگ برای همهٔ صفحه‌های نشست.
// تم در localStorage با همان کلید کاتالوگ (coreader-app-theme) ذخیره می‌شود.
(function () {
  var KEY = 'coreader-app-theme';
  var THEMES = [
    ['theme-gold', '#f8f5ee', '#c99738', 'زرین و عاجی'],
    ['theme-lapis', '#0b1524', '#d4af37', 'لاجورد و کهربا'],
    ['theme-sepia', '#f4ecda', '#8a5a3b', 'کهن و پاپیروس'],
    ['theme-dark', '#101216', '#38bdf8', 'شب و آبسیدین'],
    ['theme-emerald', '#091712', '#10b981', 'زمردین'],
    ['theme-light', '#ffffff', '#cbd5e1', 'روشن مینیمال']
  ];
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  function apply(t) {
    if (!THEMES.some(function (x) { return x[0] === t; })) t = 'theme-gold';
    document.body.className = (document.body.className || '').replace(/\btheme-\w+\b/g, '').trim();
    document.body.classList.add(t);
    document.querySelectorAll('.theme-pill').forEach(function (p) { p.classList.toggle('active', p.dataset.theme === t); });
  }
  window.setAppTheme = function (t) { try { localStorage.setItem(KEY, t); } catch (e) {} apply(t); };

  var path = location.pathname;
  var links = [['/', 'کاتالوگ'], ['/session/', 'نشست'], ['/session/live.html', 'نشست‌های زنده'],
    ['/session/studio.html', 'استودیوی صوت'], ['/session/ocr.html', 'OCR'], ['/session/tutorial.html', 'آموزش']];
  var nav = links.map(function (l) {
    var active = (l[0] === '/') ? (path === '/' || path === '/index.html') : (path.indexOf(l[0]) === 0);
    return '<a class="nav-link' + (active ? ' active' : '') + '" href="' + l[0] + '">' + l[1] + '</a>';
  }).join('');
  var pills = THEMES.map(function (t) {
    return '<div class="theme-pill" data-theme="' + t[0] + '" style="background:' + t[1] + ';border-color:' + t[2] +
      '" onclick="setAppTheme(\'' + t[0] + '\')" title="' + t[3] + '"></div>';
  }).join('');
  var host = document.getElementById('siteHeader');
  if (host) {
    host.innerHTML = '<header class="site-header"><div class="header-top-bar">' +
      '<a class="site-brand" href="/">کتابخوانه</a>' +
      '<nav class="site-nav">' + nav + '</nav>' +
      '<div class="header-actions"><span id="who" class="muted"></span>' +
      '<button id="btnSignOut" class="ghost hidden">خروج</button>' +
      '<div class="theme-palette" title="انتخاب تم رنگی">' + pills + '</div></div>' +
      '</div></header>';
  }
  apply(saved || 'theme-gold');
})();