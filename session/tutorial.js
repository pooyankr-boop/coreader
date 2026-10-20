// آموزش تعاملی نشست: گام‌ها، پیشرفت ذخیره‌شده در مرورگر، و پیوند به هر بخش.
(function () {
  var KEY = 'coreader-tutorial-done';
  var STEPS = [
    { title: 'ورود به سایت', link: '/session/', label: 'باز کردن نشست',
      body: '<ol><li>صفحهٔ نشست را باز کنید.</li><li>یکی از روش‌ها را انتخاب کنید: ایمیل (کد یک‌بارمصرف)، گیت‌هاب، یا <b>ورود با تلگرام</b>.</li><li>در حالت تلگرام، کد نمایش‌داده‌شده را در ربات با <code>/start login_…</code> تأیید کنید.</li></ol>',
      tip: 'ورود با تلگرام فقط روی آدرس عمومی سایت کار می‌کند، نه روی لوکال.' },
    { title: 'ساختن یک نشست', link: '/session/', label: 'ساخت نشست',
      body: '<ol><li>در صفحهٔ اصلی نشست، عنوان نشست را بنویسید.</li><li>نوع را انتخاب کنید: <b>خصوصی</b> (با کد دعوت) یا <b>عمومی</b>.</li><li>دکمهٔ ساخت را بزنید.</li></ol>',
      tip: 'نشست را با یک کد دعوت به دوستان بدهید تا وارد شوند.' },
    { title: 'دعوت اعضا و ورود با کد', link: '/session/', label: 'ورود با کد دعوت',
      body: '<ol><li>داخل نشست، کد دعوت را در بخش اطلاعات نشست ببینید.</li><li>آن را برای همکاران بفرستید.</li><li>همکار در صفحهٔ اصلی، کد را در «ورود با کد دعوت» وارد می‌کند.</li></ol>' },
    { title: 'چت و وظایف', link: '/session/', label: 'گفتگو و وظایف',
      body: '<ol><li>پیام بنویسید و Enter بزنید.</li><li>برای ثبت وظیفه: <code>/task بررسی حاشیهٔ صفحه ۱۲ #حاشیه</code>.</li><li>با <code>/doing شماره</code>، <code>/done شماره</code> و <code>/open شماره</code> وضعیت را تغییر دهید.</li><li><code>/help</code> همهٔ دستورها را نشان می‌دهد.</li></ol>',
      tip: 'هشتگ‌ها (#) برای دسته‌بندی وظایف استفاده می‌شوند.' },
    { title: 'جستجوی منابع', link: '/session/', label: 'جستجوی منابع',
      body: '<ol><li>در صفحهٔ اصلی نشست، جستجوی منابع را باز کنید.</li><li>عنوان، نویسنده یا موضوع را بنویسید.</li><li>فیلترها (نوع اثر، زبان، سال، فقط IIIF) را در «فیلترها و تنظیمات پیشرفته» تغییر دهید.</li><li>از هر نتیجه: نشست بسازید، یا آن را به کاتالوگ پیشنهاد دهید.</li></ol>',
      tip: 'پیش‌فرض جستجو کتاب، دست‌نوشته، شیء موزه‌ای و نقاشی تاریخی است.' },
    { title: 'مانیفست نشست', link: '/session/', label: 'ثبت مانیفست',
      body: '<ol><li>(فقط مالک) آدرس مانیفست IIIF را در بخش «مانیفست و حاشیه» وارد کنید.</li><li>صفحه‌ها ظاهر می‌شوند؛ شمارهٔ هر صفحه را انتخاب کنید.</li></ol>' },
    { title: 'حاشیه و انتخاب ناحیه', link: '/session/', label: 'حاشیه بنویسید',
      body: '<ol><li>یک صفحه را انتخاب کنید.</li><li>برای حاشیهٔ کلی، متن را در کادر حاشیه بنویسید.</li><li>برای حاشیهٔ یک بخش، «کشیدن ناحیه روی صفحه» را بزنید و روی تصویر بکشید.</li><li>متن را بنویسید و ثبت کنید.</li></ol>' },
    { title: 'فایل‌های صوتی', link: '/session/', label: 'بارگذاری صوت',
      body: '<ol><li>در بخش «فایل‌های صوتی نشست»، یک فایل صوتی انتخاب کنید.</li><li>بارگذاری را بزنید. فایل فقط برای اعضای نشست دیده می‌شود.</li></ol>' },
    { title: 'استودیوی صوت', link: '/session/studio.html', label: 'باز کردن استودیو',
      body: '<ol><li>از فهرست صوت‌ها، «ویرایش و همگام‌سازی» را بزنید.</li><li>با کلید M یا دکمهٔ نشانه، هر خط متن را به زمان صدا وصل کنید.</li><li>برای برش، زمان شروع و پایان را بدهید و نسخهٔ جدید را در نشست ذخیره کنید.</li></ol>',
      tip: 'کلید Space پخش و توقف را انجام می‌دهد.' },
    { title: 'تولید متن با OCR', link: '/session/', label: 'کارت OCR',
      body: '<ol><li>منبع را انتخاب کنید: مانیفست نشست یا فایل PDF.</li><li>صفحه‌ها را انتخاب کنید (همه، یا صفحه‌های سفارشی).</li><li>زبان‌ها و موتور OCR را انتخاب کنید.</li><li>شروع را بزنید، متن را بررسی و ویرایش کنید، سپس ذخیره کنید.</li></ol>',
      tip: 'برای دست‌نویس فارسی، موتور ابری دقیق‌تر است؛ Tesseract بیشتر برای متن چاپی مناسب است.' },
    { title: 'جستجوی عمیق در OCR', link: '/session/', label: 'جستجو در متن',
      body: '<ol><li>در بخش جستجوی OCR، عبارت را بنویسید.</li><li>نتیجه‌ها با منبع و شمارهٔ صفحه نمایش داده می‌شوند.</li></ol>' },
    { title: 'تماس و پخش زنده', link: '/session/', label: 'تماس',
      body: '<ol><li>دکمهٔ «شروع یا ورود به تماس» را بزنید تا اتاق Jitsi باز شود.</li><li>برای پخش زنده، «شروع پخش زنده» را بزنید؛ در صورت نیاز گذرواژه بگذارید.</li><li>در صفحهٔ نشست‌های زنده، بینندگان پخش را پیدا می‌کنند.</li></ol>',
      tip: 'پخش زنده فقط یک پرچم است؛ اتاق تماس باید باز باشد تا بیننده‌ها چیزی ببینند.' },
    { title: 'دستورهای نشست در تلگرام', link: '/session/', label: 'راهنمای ربات',
      body: '<ol><li>ربات را به گروه اضافه کنید.</li><li>با <code>/s_link کد_دعوت</code> گروه را به نشست وصل کنید.</li><li><code>/s_note 12 متن</code>، <code>/s_task متن #هشتگ</code>، <code>/s_tasks</code> و <code>/s_done شماره</code> را استفاده کنید.</li></ol>' },
    { title: 'افزودن به کاتالوگ', link: '/', label: 'کاتالوگ',
      body: '<ol><li>از هر نتیجهٔ جستجو یا از کل نشست، «افزودن به کاتالوگ» را بزنید.</li><li>آیتم به‌صورت پیش‌نویس در بخش «صحافی» دیده می‌شود.</li><li>مدیر آن را منتشر می‌کند تا برای همه قابل دیدن شود.</li></ol>' }
  ];

  var done = {};
  try { done = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { done = {}; }
  var cur = 0;

  function save() { try { localStorage.setItem(KEY, JSON.stringify(done)); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function render() {
    var n = STEPS.length, count = Object.keys(done).length;
    document.getElementById('prog').style.width = Math.round(count / n * 100) + '%';
    document.getElementById('progText').textContent = count + ' از ' + n + ' گام انجام شد';
    document.getElementById('stepList').innerHTML = STEPS.map(function (s, i) {
      var cls = (i === cur ? ' current' : '') + (done[i] ? ' done' : '');
      return '<a data-i="' + i + '" class="' + cls.trim() + '"><span class="mark">' + (done[i] ? '✓' : (i + 1)) + '</span>' + esc(s.title) + '</a>';
    }).join('');
    document.querySelectorAll('#stepList a').forEach(function (a) {
      a.onclick = function () { cur = +a.dataset.i; render(); };
    });
    var s = STEPS[cur];
    document.getElementById('stepBox').innerHTML =
      '<div class="muted">گام ' + (cur + 1) + ' از ' + n + '</div>' +
      '<div class="step-title">' + esc(s.title) + '</div>' +
      '<div class="step-body">' + s.body + '</div>' +
      (s.tip ? '<div class="tip">نکته: ' + esc(s.tip) + '</div>' : '') +
      '<div class="row" style="margin-top:12px"><a class="ghost" href="' + s.link + '">' + esc(s.label) + '</a></div>' +
      '<label class="check"><input type="checkbox" id="doneBox"' + (done[cur] ? ' checked' : '') + '> این گام را انجام دادم</label>' +
      '<div class="nav-row"><button class="ghost" id="prevBtn"' + (cur === 0 ? ' disabled' : '') + '>گام قبلی</button>' +
      '<button id="nextBtn"' + (cur === n - 1 ? ' disabled' : '') + '>گام بعدی</button></div>';
    document.getElementById('doneBox').onchange = function (e) {
      if (e.target.checked) done[cur] = true; else delete done[cur];
      save(); render();
    };
    document.getElementById('prevBtn').onclick = function () { if (cur > 0) { cur--; render(); } };
    document.getElementById('nextBtn').onclick = function () { if (cur < n - 1) { cur++; render(); } };
  }
  render();
})();
