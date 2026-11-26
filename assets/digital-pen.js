/**
 * CoReader Digital Pen & Persian Handwriting Suite
 * سیستم جامع قلم نوری، تشخیص دست‌خط فارسی و حاشیه‌نویسی دیجیتال
 * پشتیبانی از انواع قلم‌ها، سرقلم‌های خطاطی سنتی (نی با زاویه قط)، روان‌نویس، هایلایتر، مداد و دست‌خط‌های فارسی
 */
(function(window, document){
  'use strict';

  // بارگذاری خودکار استایل در صورت عدم وجود
  if (!document.getElementById('digitalPenCSS')) {
    var link = document.createElement('link');
    link.id = 'digitalPenCSS';
    link.rel = 'stylesheet';
    // تشخیص مسیر نسبی درست برای assets
    var isSubdir = window.location.pathname.indexOf('/books/') !== -1 || window.location.pathname.indexOf('/reader/') !== -1;
    link.href = (isSubdir ? '../assets/' : 'assets/') + 'digital-pen.css?v=1';
    document.head.appendChild(link);
  }

  // پالت‌های رنگ سنتی ایرانی و کالیگرافی
  var COLORS = [
    { name: 'مرکب دودی (مشکی)', val: '#1a1612' },
    { name: 'شنجرف (قرمز تصحیح)', val: '#b82e2e' },
    { name: 'لاجوردی (آبی ایرانی)', val: '#1b4f8a' },
    { name: 'زرین / زعفرانی', val: '#c29124' },
    { name: 'یشمی (سبز)', val: '#246b42' }
  ];

  // سرقلم‌ها و ابزارهای نوشتاری
  var NIBS = [
    { id: 'qalam', name: 'قلم نی خطاطی', icon: '✒️', desc: 'سرقلم تراشیده با زاویه ۶۵ درجه سنتی نستعلیق' },
    { id: 'pen', name: 'روان‌نویس دیجیتال', icon: '🖊️', desc: 'نوک ساچمه‌ای روان با حساسیت فشار' },
    { id: 'highlighter', name: 'ماژیک هایلایتر', icon: '🖍️', desc: 'سرقلم پهن شفاف برای نشانه‌گذاری و حاشیه' },
    { id: 'pencil', name: 'مداد گرافیت', icon: '✏️', desc: 'بافت نرم مدادی با شیب و فشار' },
    { id: 'brush', name: 'قلم‌مو / براش', icon: '🖌️', desc: 'تغییر دینامیک پهنای خط با فشار دست' },
    { id: 'eraser', name: 'پاک‌کن قلم', icon: '🧹', desc: 'پاک کردن خطوط دست‌خط' }
  ];

  // وضعیت سراسری سیستم قلم نوری
  var state = {
    activeNib: 'qalam',
    color: '#1a1612',
    width: 4,
    qalamAngle: 65, // زاویه قط قلم نی
    autoRecognizeDelay: 600, // میلی‌ثانیه بعد از برداشتن قلم
    hwrOpen: false,
    onPageInkActive: false,
    padStrokes: [], // برای ارسال به API گوگل: [ [ [x], [y], [t] ], ... ]
    padPoints: [], // نقاط برای رسم: [ {x, y, p, t}, ... ]
    padUndoStack: [],
    pageInkData: {}, // { [pageNum]: [ strokeObjects... ] }
    currentPageInk: [],
    targetInput: null,
    lastCandidates: [],
    hwrTimer: null
  };

  /**
   * استخراج موقعیت و محاسبه فشار قلم / لمس با شبیه‌سازی دینامیک سرعت (Velocity Pressure)
   * برای ایجاد حس طبیعی خطاطی فارسی در موبایل و صفحات لمسی
   */
  function getPointFromEvent(e, canvas, lastPt) {
    var rect = canvas.getBoundingClientRect();
    var cx = e.clientX, cy = e.clientY;
    if (e.touches && e.touches[0]) {
      cx = e.touches[0].clientX;
      cy = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches[0]) {
      cx = e.changedTouches[0].clientX;
      cy = e.changedTouches[0].clientY;
    }
    var x = cx - rect.left;
    var y = cy - rect.top;
    var t = Date.now();
    var p = 0.5;

    // اگر قلم نوری دارای سنسور سخت‌افزاری فشار باشد
    if (e.pointerType === 'pen' && typeof e.pressure === 'number' && e.pressure > 0 && e.pressure !== 0.5) {
      p = e.pressure;
    } else if (lastPt) {
      // شبیه‌سازی خوشنویسی در لمس و موبایل: سرعت بالا = نازک و کشیده، حرکت آرام = ضخیم‌تر
      var dx = x - lastPt.x;
      var dy = y - lastPt.y;
      var dt = Math.max(1, t - lastPt.t);
      var dist = Math.sqrt(dx * dx + dy * dy);
      var speed = dist / dt; // پیکسل بر میلی‌ثانیه
      var targetP = 0.88 - Math.min(0.58, speed * 0.22);
      p = (lastPt.p || 0.5) * 0.35 + targetP * 0.65; // هموارسازی برای حرکت طبیعی دست
    }
    return {
      x: x,
      y: y,
      p: Math.max(0.2, Math.min(1.0, p)),
      t: t
    };
  }

  /* ==========================================================================
     ۱. توابع ترسیم هندسی سرقلم‌ها (Calligraphic Engine)
     ========================================================================== */

  /**
   * ترسیم سرقلم نی سنتی خطاطی (Chisel Qalam-Ney)
   * شبیه‌سازی فیزیکی تراش قلم نی با زاویه قط (حدود ۶۵ درجه)
   */
  function drawQalamStroke(ctx, p0, p1, width, color) {
    var angleRad = (state.qalamAngle * Math.PI) / 180;
    var pressure = Math.max(0.18, Math.min(1.0, p1.p || 0.5));
    var halfW = (width * pressure * 1.6) / 2;
    var dx = halfW * Math.cos(angleRad);
    var dy = -halfW * Math.sin(angleRad);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(p0.x - dx, p0.y - dy);
    ctx.lineTo(p0.x + dx, p0.y + dy);
    ctx.lineTo(p1.x + dx, p1.y + dy);
    ctx.lineTo(p1.x - dx, p1.y - dy);
    ctx.closePath();
    ctx.fill();

    // نیش انتهایی گرد/نرم برای جلوگیری از بریدگی‌های تیز در زوایای تند
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, Math.max(0.8, halfW * 0.25), 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * ترسیم روان‌نویس با هموارسازی انحنا
   */
  function drawPenStroke(ctx, p0, p1, width, color) {
    var pressure = Math.max(0.2, Math.min(1.0, p1.p || 0.5));
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1, width * pressure);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  /**
   * ترسیم هایلایتر پهن نیمه‌شفاف
   */
  function drawHighlighterStroke(ctx, p0, p1, width, color) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(14, width * 3.5);
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * ترسیم مداد گرافیت با بافت نرم
   */
  function drawPencilStroke(ctx, p0, p1, width, color) {
    var pressure = Math.max(0.15, Math.min(1.0, p1.p || 0.4));
    ctx.save();
    ctx.globalAlpha = Math.min(0.85, 0.25 + pressure * 0.6);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, width * 0.75 * pressure);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * ترسیم قلم‌مو / براش با نوسان ضخامت
   */
  function drawBrushStroke(ctx, p0, p1, width, color) {
    var pressure = Math.max(0.1, Math.min(1.0, p1.p || 0.5));
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.5, width * pressure * 2.2);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  /**
   * ترسیم پاک‌کن
   */
  function drawEraserStroke(ctx, p0, p1, width) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = Math.max(12, width * 3.5);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * تابع کلی ترسیم یک قطعه خط بر حسب سرقلم انتخابی
   */
  function renderSegment(ctx, p0, p1, nibId, width, color) {
    switch (nibId) {
      case 'qalam':
        drawQalamStroke(ctx, p0, p1, width, color);
        break;
      case 'pen':
        drawPenStroke(ctx, p0, p1, width, color);
        break;
      case 'highlighter':
        drawHighlighterStroke(ctx, p0, p1, width, color);
        break;
      case 'pencil':
        drawPencilStroke(ctx, p0, p1, width, color);
        break;
      case 'brush':
        drawBrushStroke(ctx, p0, p1, width, color);
        break;
      case 'eraser':
        drawEraserStroke(ctx, p0, p1, width);
        break;
      default:
        drawPenStroke(ctx, p0, p1, width, color);
    }
  }

  /* ==========================================================================
     ۲. موتور تشخیص دست‌خط فارسی (Handwriting-to-Text Recognition Engine)
     ========================================================================== */

  /**
   * فراخوانی وب‌سرویس تشخیص دست‌خط با پشتیبانی بومی خط فارسی (fa)
   */
  function recognizePadInk(callback) {
    if (!state.padStrokes.length) return;
    var pad = document.getElementById('hwPadCanvas');
    if (!pad) return;

    var width = pad.width || 600;
    var height = pad.height || 200;

    var payload = {
      options: 'enable_pre_space',
      requests: [{
        writing_area_width: width,
        writing_area_height: height,
        ink: state.padStrokes,
        language: 'fa'
      }]
    };

    var statusEl = document.getElementById('hwStatus');
    if (statusEl) statusEl.textContent = 'در حال خواندن دست‌خط...';

    fetch('https://inputtools.google.com/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(res){ return res.json(); })
    .then(function(data){
      if (statusEl) statusEl.textContent = 'آماده';
      if (Array.isArray(data) && data[0] === 'SUCCESS' && data[1] && data[1][0] && data[1][0][1]) {
        var words = data[1][0][1];
        state.lastCandidates = words;
        renderCandidates(words);
        if (typeof callback === 'function') callback(words);
      } else {
        if (statusEl) statusEl.textContent = 'شناسایی نشد (دوباره بنویسید)';
      }
    })
    .catch(function(err){
      console.warn('HWR network notice:', err);
      if (statusEl) statusEl.textContent = 'حالت آفلاین (امکان درج مستقیم دستخط)';
    });
  }

  /**
   * نمایش گزینه‌های پیشنهادی در نوار بالای پد
   */
  function renderCandidates(words) {
    var bar = document.getElementById('hwCandidatesBar');
    if (!bar) return;
    bar.innerHTML = '';
    if (!words || !words.length) {
      bar.innerHTML = '<span class="hw-candidate-hint">با قلم نوری روی خط بنویسید تا کلمه فوراً تشخیص داده شود...</span>';
      return;
    }

    words.forEach(function(word, idx){
      var btn = document.createElement('button');
      btn.className = 'hw-candidate-pill' + (idx === 0 ? ' primary' : '');
      btn.textContent = word;
      btn.title = 'کلیک برای درج در متن';
      btn.onclick = function(){
        insertRecognizedText(word);
        clearPadCanvas();
      };
      bar.appendChild(btn);
    });
  }

  /**
   * درج متن شناسایی‌شده در مکان مکان‌نما (Cursor) در متن کتاب
   */
  function insertRecognizedText(text) {
    if (!text) return;
    // بررسی وضعیت فوکوس ادیتور
    var sel = window.getSelection();
    if (sel && sel.rangeCount) {
      var range = sel.getRangeAt(0);
      // اطمینان از اینکه سلکشن درون متن کتاب است
      var container = range.commonAncestorContainer;
      var inEditable = false;
      var cur = container.nodeType === 3 ? container.parentNode : container;
      while (cur && cur !== document.body) {
        if (cur.isContentEditable || cur.classList.contains('ps-txt')) {
          inEditable = true;
          break;
        }
        cur = cur.parentNode;
      }

      if (inEditable) {
        range.deleteContents();
        var node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.setEndAfter(node);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        // درج در صفحهٔ جاری
        appendCurrentPageText(text);
      }
    } else {
      appendCurrentPageText(text);
    }

    // ذخیره تغییرات متن
    if (typeof window.saveUserEdits === 'function') {
      window.saveUserEdits();
    }
  }

  /**
   * افزودن به انتهای متن صفحه فعلی در صورت نبودن فوکوس مستقیم
   */
  function appendCurrentPageText(text) {
    var curPg = document.getElementById('pg_' + (window.curPage || 1));
    var txtEl = curPg && curPg.querySelector('.ps-txt');
    if (txtEl) {
      txtEl.focus();
      document.execCommand('insertText', false, text);
    }
  }

  /* ==========================================================================
     ۳. رابط کاربری پد دست‌خط (#hwPadModal)
     ========================================================================== */

  function buildHwPadDOM() {
    if (document.getElementById('hwPadModal')) return;

    var modal = document.createElement('div');
    modal.id = 'hwPadModal';
    modal.setAttribute('role', 'region');
    modal.setAttribute('aria-label', 'پد دست‌خط و قلم نوری');

    modal.innerHTML = 
      '<div class="hw-drag-pill" id="hwDragPill" title="کشیدن برای کوچک/بزرگ‌کردن پد در موبایل"></div>' +
      '<div class="hw-header" id="hwPadHeader">' +
        '<div class="hw-title">' +
          '<span>✍️ پد دست‌خط و قلم دیجیتال</span>' +
          '<span class="hw-status" id="hwStatus">آماده نوشتن</span>' +
        '</div>' +
        '<div class="hw-controls">' +
          '<button class="hw-icon-btn" id="hwBtnMin" title="کوچک‌کردن / بزرگ‌کردن پد">▾</button>' +
          '<button class="hw-icon-btn" id="hwBtnHelp" title="راهنمای قلم">❓</button>' +
          '<button class="hw-icon-btn" id="hwBtnClose" title="بستن پد (Esc)">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="hw-candidates-bar" id="hwCandidatesBar">' +
        '<span class="hw-candidate-hint">با قلم نوری روی خط بنویسید تا کلمه فوراً تشخیص داده شود...</span>' +
      '</div>' +
      '<div class="hw-canvas-wrap" id="hwCanvasWrap">' +
        '<div class="hw-guideline-top"></div>' +
        '<div class="hw-guideline"></div>' +
        '<canvas class="hw-canvas" id="hwPadCanvas"></canvas>' +
      '</div>' +
      '<div class="hw-nib-bar" id="hwNibBar">' +
        NIBS.map(function(n){
          return '<button class="hw-nib-btn' + (n.id === state.activeNib ? ' active' : '') + '" data-nib="' + n.id + '" title="' + n.desc + '">' +
            n.icon + ' ' + n.name + '</button>';
        }).join('') +
        '<span class="hw-sep"></span>' +
        COLORS.map(function(c, i){
          return '<div class="hw-color-dot' + (i === 0 ? ' active' : '') + '" data-color="' + c.val + '" style="background:' + c.val + '" title="' + c.name + '"></div>';
        }).join('') +
        '<input type="color" id="hwColorPicker" value="' + state.color + '" title="رنگ سفارشی جوهر" style="width:24px;height:24px;border:none;cursor:pointer;background:none;padding:0">' +
        '<span class="hw-sep"></span>' +
        '<span class="hw-slider-label">ضخامت:</span>' +
        '<input type="range" class="hw-slider" id="hwWidthSlider" min="1" max="24" value="' + state.width + '" title="ضخامت سرقلم">' +
      '</div>' +
      '<div class="hw-actions-bar">' +
        '<div class="hw-act-group">' +
          '<button class="hw-act-btn primary" id="hwBtnCommit" title="تشخیص و درج در متن">✓ درج متن</button>' +
          '<button class="hw-act-btn" id="hwBtnSpace" title="افزودن فاصله">␣ فاصله</button>' +
          '<button class="hw-act-btn" id="hwBtnBack" title="پاک‌کردن آخرین حرف">⌫ پاک‌کردن</button>' +
          '<button class="hw-act-btn" id="hwBtnEnter" title="سطر تازه">↵ سطر نو</button>' +
          '<button class="hw-act-btn" id="hwBtnUndo" title="لغو آخرین خط قلم">↩ لغو خط</button>' +
          '<button class="hw-act-btn danger" id="hwBtnClear" title="پاک‌کردن بوم">🧹 پاک بوم</button>' +
        '</div>' +
        '<div class="hw-act-group">' +
          '<button class="hw-diacritic-btn" data-char="َ" title="فتحه">َ</button>' +
          '<button class="hw-diacritic-btn" data-char="ُ" title="ضمه">ُ</button>' +
          '<button class="hw-diacritic-btn" data-char="ِ" title="کسره">ِ</button>' +
          '<button class="hw-diacritic-btn" data-char="ّ" title="تشدید">ّ</button>' +
          '<button class="hw-diacritic-btn" data-char="ْ" title="سکون">ْ</button>' +
          '<button class="hw-diacritic-btn" data-char="ً" title="تنوین نصب">ً</button>' +
          '<button class="hw-diacritic-btn" data-char="،" title="ویرگول فارسی">،</button>' +
          '<button class="hw-diacritic-btn" data-char="؛" title="نقطه‌ویرگول">؛</button>' +
          '<button class="hw-diacritic-btn" data-char="؟" title="علامت سؤال">؟</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    bindHwPadEvents();
  }

  function resizePadCanvas() {
    var canvas = document.getElementById('hwPadCanvas');
    var wrap = document.getElementById('hwCanvasWrap');
    if (!canvas || !wrap) return;
    var rect = wrap.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    redrawPadStrokes();
  }

  function clearPadCanvas() {
    var canvas = document.getElementById('hwPadCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    state.padStrokes = [];
    state.padPoints = [];
    state.padUndoStack = [];
    var statusEl = document.getElementById('hwStatus');
    if (statusEl) statusEl.textContent = 'آماده نوشتن';
  }

  function redrawPadStrokes() {
    var canvas = document.getElementById('hwPadCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    state.padUndoStack.forEach(function(stroke){
      if (!stroke.points || stroke.points.length < 2) return;
      for (var i = 1; i < stroke.points.length; i++) {
        renderSegment(ctx, stroke.points[i - 1], stroke.points[i], stroke.nib, stroke.width, stroke.color);
      }
    });
  }

  function bindHwPadEvents() {
    var canvas = document.getElementById('hwPadCanvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');

    // جلوگیری از اسکرول و پرش صفحه هنگام نوشتن روی موبایل و تبلت
    canvas.addEventListener('touchstart', function(e){
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', function(e){
      e.preventDefault();
    }, { passive: false });

    // Pointer Events با پشتیبانی بومی قلم دیجیتال (Stylus / Pen) و شبیه‌سازی لمس
    canvas.addEventListener('pointerdown', function(e){
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch(err){}
      state.isDrawing = true;

      // تشخیص استفاده از انتهای پاک‌کن قلم نوری
      var isEraserTip = e.pointerType === 'pen' && (e.buttons === 32 || e.button === 5);
      var effectiveNib = isEraserTip ? 'eraser' : state.activeNib;

      var pt = getPointFromEvent(e, canvas, null);
      state.padPoints = [pt];
      state.currentHwrStroke = [[Math.round(pt.x)], [Math.round(pt.y)], [0]];
      clearTimeout(state.hwrTimer);
    });

    canvas.addEventListener('pointermove', function(e){
      if (!state.isDrawing) return;
      e.preventDefault();
      var lastPt = state.padPoints[state.padPoints.length - 1];
      var pt = getPointFromEvent(e, canvas, lastPt);

      if (lastPt) {
        var isEraserTip = e.pointerType === 'pen' && (e.buttons === 32 || e.button === 5);
        var effectiveNib = isEraserTip ? 'eraser' : state.activeNib;
        renderSegment(ctx, lastPt, pt, effectiveNib, state.width, state.color);
      }
      state.padPoints.push(pt);

      if (state.currentHwrStroke) {
        var t0 = state.padPoints[0].t;
        state.currentHwrStroke[0].push(Math.round(pt.x));
        state.currentHwrStroke[1].push(Math.round(pt.y));
        state.currentHwrStroke[2].push(Math.round(pt.t - t0));
      }
    });

    function finishPadStroke(e){
      if (!state.isDrawing) return;
      state.isDrawing = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch(err){}

      if (state.padPoints.length > 1) {
        state.padUndoStack.push({
          nib: state.activeNib,
          color: state.color,
          width: state.width,
          points: state.padPoints.slice()
        });
      }

      if (state.currentHwrStroke && state.currentHwrStroke[0].length > 1) {
        state.padStrokes.push(state.currentHwrStroke);
      }
      state.currentHwrStroke = null;
      state.padPoints = [];

      // زمان‌بندی خودکار تشخیص بعد از بلند شدن قلم
      clearTimeout(state.hwrTimer);
      state.hwrTimer = setTimeout(function(){
        recognizePadInk();
      }, state.autoRecognizeDelay);
    }

    canvas.addEventListener('pointerup', finishPadStroke);
    canvas.addEventListener('pointercancel', finishPadStroke);

    // دکمه‌های سرقلم‌ها
    document.querySelectorAll('#hwNibBar .hw-nib-btn').forEach(function(btn){
      btn.onclick = function(){
        document.querySelectorAll('#hwNibBar .hw-nib-btn').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        state.activeNib = btn.getAttribute('data-nib');
      };
    });

    // دکمه‌های رنگی
    document.querySelectorAll('#hwNibBar .hw-color-dot').forEach(function(dot){
      dot.onclick = function(){
        document.querySelectorAll('#hwNibBar .hw-color-dot').forEach(function(d){ d.classList.remove('active'); });
        dot.classList.add('active');
        state.color = dot.getAttribute('data-color');
      };
    });
    var colorPicker = document.getElementById('hwColorPicker');
    if (colorPicker) {
      colorPicker.oninput = function(e){
        state.color = e.target.value;
        document.querySelectorAll('#hwNibBar .hw-color-dot').forEach(function(d){ d.classList.remove('active'); });
      };
    }

    // اسلایدر ضخامت قلم
    var widthSlider = document.getElementById('hwWidthSlider');
    if (widthSlider) {
      widthSlider.oninput = function(e){ state.width = +e.target.value; };
    }

    // دکمه‌های عملیاتی
    document.getElementById('hwBtnCommit').onclick = function(){
      if (state.lastCandidates.length) {
        insertRecognizedText(state.lastCandidates[0]);
        clearPadCanvas();
      } else {
        recognizePadInk(function(words){
          if (words && words.length) {
            insertRecognizedText(words[0]);
            clearPadCanvas();
          }
        });
      }
    };

    document.getElementById('hwBtnSpace').onclick = function(){ insertRecognizedText(' '); };
    document.getElementById('hwBtnEnter').onclick = function(){ insertRecognizedText('\n'); };
    document.getElementById('hwBtnBack').onclick = function(){
      document.execCommand('delete', false, null);
    };
    document.getElementById('hwBtnClear').onclick = clearPadCanvas;
    document.getElementById('hwBtnUndo').onclick = function(){
      state.padUndoStack.pop();
      state.padStrokes.pop();
      redrawPadStrokes();
      if (state.padStrokes.length) recognizePadInk();
      else {
        var bar = document.getElementById('hwCandidatesBar');
        if (bar) bar.innerHTML = '<span class="hw-candidate-hint">آماده نوشتن...</span>';
      }
    };

    // اعراب‌گذاری سریع با قلم
    document.querySelectorAll('.hw-diacritic-btn').forEach(function(btn){
      btn.onclick = function(){
        var ch = btn.getAttribute('data-char');
        if (ch) insertRecognizedText(ch);
      };
    });

    // بستن پد
    document.getElementById('hwBtnClose').onclick = function(){
      toggleHandwritingPad(false);
    };

    // کنترل کوچک‌کردن و بازکردن کشوی زیرین در موبایل (Bottom Sheet)
    var header = document.getElementById('hwPadHeader');
    var padModal = document.getElementById('hwPadModal');
    var btnMin = document.getElementById('hwBtnMin');
    var dragPill = document.getElementById('hwDragPill');

    function toggleMinimize(forceMin) {
      if (!padModal) return;
      var isMin = forceMin !== undefined ? forceMin : !padModal.classList.contains('minimized');
      if (isMin) {
        padModal.classList.add('minimized');
        if (btnMin) btnMin.textContent = '▴';
      } else {
        padModal.classList.remove('minimized');
        if (btnMin) btnMin.textContent = '▾';
        setTimeout(resizePadCanvas, 60);
      }
    }
    if (btnMin) {
      btnMin.onclick = function(e){
        e.stopPropagation();
        toggleMinimize();
      };
    }
    if (dragPill) {
      dragPill.onclick = function(e){
        e.stopPropagation();
        toggleMinimize();
      };
    }

    // ژست لمسی سوایپ در هدر یا دستگیره برای بستن / باز کردن کشوی موبایل
    var touchStartY = 0;
    var isMobileSheet = function(){ return window.innerWidth <= 900; };
    header.addEventListener('touchstart', function(e){
      if (e.target.tagName === 'BUTTON') return;
      if (e.touches && e.touches[0]) {
        touchStartY = e.touches[0].clientY;
      }
    }, { passive: true });
    header.addEventListener('touchend', function(e){
      if (e.target.tagName === 'BUTTON') return;
      if (e.changedTouches && e.changedTouches[0] && isMobileSheet()) {
        var diffY = e.changedTouches[0].clientY - touchStartY;
        if (diffY > 35) {
          toggleMinimize(true);
        } else if (diffY < -30) {
          toggleMinimize(false);
        }
      }
    }, { passive: true });

    // جابجایی پد با درگ ماوس در دسکتاپ
    var isDragging = false, dragX = 0, dragY = 0;
    header.addEventListener('pointerdown', function(e){
      if (e.target.tagName === 'BUTTON' || e.target.id === 'hwDragPill') return;
      if (isMobileSheet()) return;
      isDragging = true;
      dragX = e.clientX - padModal.offsetLeft;
      dragY = e.clientY - padModal.offsetTop;
      try { header.setPointerCapture(e.pointerId); } catch(err){}
    });
    header.addEventListener('pointermove', function(e){
      if (!isDragging || isMobileSheet()) return;
      padModal.style.left = (e.clientX - dragX + padModal.offsetWidth / 2) + 'px';
      padModal.style.top = (e.clientY - dragY) + 'px';
      padModal.style.bottom = 'auto';
    });
    function stopDrag(){ isDragging = false; }
    header.addEventListener('pointerup', stopDrag);
    header.addEventListener('pointercancel', stopDrag);

    // دکمه راهنما
    document.getElementById('hwBtnHelp').onclick = function(){
      alert('راهنمای قلم دیجیتال و دست‌خط فارسی:\n' +
        '• با قلم نوری یا لمس روی کادر بنویسید؛ کلمه خودکار شناسایی و پیشنهاد می‌شود.\n' +
        '• در موبایل، پد به عنوان کشوی زیرین باز می‌شود و با کشیدن به پایین یا دکمه ▾ کوچک می‌شود.\n' +
        '• سرقلم‌های مختلف (قلم نی خطاطی، روان‌نویس، هایلایتر، مداد و پاک‌کن) را انتخاب کنید.\n' +
        '• کلید ␣ فاصله، ⌫ پاک‌کردن، و نشانه‌های اعراب در پایین پد در دسترسند.\n' +
        '• کلید میانبر: Alt+P برای باز و بسته کردن پد دست‌خط.');
    };
  }

  function toggleHandwritingPad(show) {
    buildHwPadDOM();
    var modal = document.getElementById('hwPadModal');
    if (!modal) return;
    if (show === undefined) show = !modal.classList.contains('on');

    state.hwrOpen = show;
    var btn = document.getElementById('btnToggleHwPad');
    var topBtn = document.getElementById('bHandwriting');
    var fabBtn = document.getElementById('penFabMainBtn');

    if (show) {
      modal.classList.remove('minimized');
      var btnMin = document.getElementById('hwBtnMin');
      if (btnMin) btnMin.textContent = '▾';
      modal.classList.add('on');
      setTimeout(resizePadCanvas, 60);
      if (btn) btn.classList.add('active');
      if (topBtn) topBtn.classList.add('active');
      if (fabBtn) fabBtn.classList.add('active');
    } else {
      modal.classList.remove('on');
      clearTimeout(state.hwrTimer);
      if (btn) btn.classList.remove('active');
      if (topBtn) topBtn.classList.remove('active');
      if (fabBtn) fabBtn.classList.remove('active');
    }
  }

  /* ==========================================================================
     ۴. لایه حاشیه‌نگاری و اصلاح مستقیم روی متن صفحه (On-Page Ink Layer)
     ========================================================================== */

  /**
   * راه‌اندازی بوم‌های ترسیم مستقیم بر روی صفحات کتاب
   */
  function initOnPageInkLayer() {
    var pages = document.querySelectorAll('.ps');
    pages.forEach(function(pgEl){
      var pgNum = +pgEl.id.replace('pg_', '');
      var txtEl = pgEl.querySelector('.ps-txt');
      if (!txtEl) return;

      var container = pgEl.querySelector('.page-ink-container');
      if (!container) {
        container = document.createElement('div');
        container.className = 'page-ink-container';
        container.innerHTML = '<div class="page-ink-margin-guide"></div><canvas class="page-ink-canvas"></canvas>';
        txtEl.parentNode.style.position = 'relative';
        txtEl.parentNode.appendChild(container);

        var canvas = container.querySelector('.page-ink-canvas');
        setupPageCanvas(canvas, pgNum, txtEl);
      }
    });
  }

  function setupPageCanvas(canvas, pgNum, txtEl) {
    function resizeCanvas() {
      var rect = txtEl.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      var ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      redrawPageInk(pgNum, ctx);
    }

    // ناظر تغییر اندازه
    var ro = new ResizeObserver(resizeCanvas);
    ro.observe(txtEl);

    var ctx = canvas.getContext('2d');
    var isDrawingPage = false;
    var currentStrokePoints = [];

    // جلوگیری از اسکرول و پرش صفحه هنگام ترسیم مستقیم با لمس یا قلم در موبایل
    canvas.addEventListener('touchstart', function(e){
      if (state.onPageInkActive) e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', function(e){
      if (state.onPageInkActive) e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('pointerdown', function(e){
      if (!state.onPageInkActive) return;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch(err){}
      isDrawingPage = true;

      var pt = getPointFromEvent(e, canvas, null);
      currentStrokePoints = [pt];
    });

    canvas.addEventListener('pointermove', function(e){
      if (!isDrawingPage) return;
      e.preventDefault();
      var lastPt = currentStrokePoints[currentStrokePoints.length - 1];
      var pt = getPointFromEvent(e, canvas, lastPt);

      if (lastPt) {
        var isEraserTip = e.pointerType === 'pen' && (e.buttons === 32 || e.button === 5);
        var effectiveNib = isEraserTip ? 'eraser' : state.activeNib;
        renderSegment(ctx, lastPt, pt, effectiveNib, state.width, state.color);
      }
      currentStrokePoints.push(pt);
    });

    function finishPageStroke(e){
      if (!isDrawingPage) return;
      isDrawingPage = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch(err){}

      if (currentStrokePoints.length > 1) {
        if (!state.pageInkData[pgNum]) state.pageInkData[pgNum] = [];
        state.pageInkData[pgNum].push({
          nib: state.activeNib,
          color: state.color,
          width: state.width,
          points: currentStrokePoints.slice()
        });
        if (typeof window.saveUserEdits === 'function') window.saveUserEdits();
      }
      currentStrokePoints = [];
    }

    canvas.addEventListener('pointerup', finishPageStroke);
    canvas.addEventListener('pointercancel', finishPageStroke);
  }

  function redrawPageInk(pgNum, ctx) {
    if (!ctx) {
      var pgEl = document.getElementById('pg_' + pgNum);
      var canvas = pgEl && pgEl.querySelector('.page-ink-canvas');
      if (canvas) ctx = canvas.getContext('2d');
    }
    if (!ctx) return;

    var strokes = state.pageInkData[pgNum];
    if (!strokes || !strokes.length) return;

    strokes.forEach(function(stroke){
      if (!stroke.points || stroke.points.length < 2) return;
      for (var i = 1; i < stroke.points.length; i++) {
        renderSegment(ctx, stroke.points[i - 1], stroke.points[i], stroke.nib, stroke.width, stroke.color);
      }
    });
  }

  /**
   * جعبه ابزار شناور حاشیه‌نویسی روی صفحه (#pageInkPalette)
   */
  function buildPageInkPaletteDOM() {
    if (document.getElementById('pageInkPalette')) return;

    var pal = document.createElement('div');
    pal.id = 'pageInkPalette';
    pal.innerHTML =
      '<div class="pip-header">' +
        '<span>✒️ حاشیه‌نگاری مستقیم روی صفحه</span>' +
        '<button class="hw-icon-btn" id="pipClose" title="بستن">✕</button>' +
      '</div>' +
      '<div class="pip-row">' +
        NIBS.map(function(n){
          return '<button class="pip-btn' + (n.id === state.activeNib ? ' active' : '') + '" data-nib="' + n.id + '" title="' + n.name + '">' + n.icon + '</button>';
        }).join('') +
      '</div>' +
      '<div class="pip-row">' +
        COLORS.map(function(c, i){
          return '<div class="hw-color-dot' + (i === 0 ? ' active' : '') + '" data-color="' + c.val + '" style="background:' + c.val + '" title="' + c.name + '"></div>';
        }).join('') +
        '<input type="color" id="pipColorPicker" value="' + state.color + '" style="width:20px;height:20px;border:none;cursor:pointer;background:none;padding:0">' +
      '</div>' +
      '<div class="pip-row">' +
        '<button class="pip-btn" id="pipUndo" title="لغو خط آخر">↩ لغو</button>' +
        '<button class="pip-btn" id="pipClearPage" title="پاک‌کردن حواشی این صفحه">🗑️ پاک این صفحه</button>' +
        '<button class="pip-btn" id="pipHwrConvert" title="تبدیل دستخط صفحه به متن">🔤 تبدیل به متن</button>' +
      '</div>';

    document.body.appendChild(pal);

    // رویدادهای پالت شناور
    document.getElementById('pipClose').onclick = function(){ toggleOnPageInk(false); };
    pal.querySelectorAll('.pip-btn[data-nib]').forEach(function(btn){
      btn.onclick = function(){
        pal.querySelectorAll('.pip-btn[data-nib]').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        state.activeNib = btn.getAttribute('data-nib');
        // همگام با پد
        var padNibBtn = document.querySelector('#hwNibBar .hw-nib-btn[data-nib="' + state.activeNib + '"]');
        if (padNibBtn) padNibBtn.click();
      };
    });
    pal.querySelectorAll('.hw-color-dot').forEach(function(dot){
      dot.onclick = function(){
        pal.querySelectorAll('.hw-color-dot').forEach(function(d){ d.classList.remove('active'); });
        dot.classList.add('active');
        state.color = dot.getAttribute('data-color');
      };
    });
    document.getElementById('pipColorPicker').oninput = function(e){
      state.color = e.target.value;
      pal.querySelectorAll('.hw-color-dot').forEach(function(d){ d.classList.remove('active'); });
    };

    document.getElementById('pipUndo').onclick = function(){
      var pg = window.curPage || 1;
      if (state.pageInkData[pg] && state.pageInkData[pg].length) {
        state.pageInkData[pg].pop();
        var pgEl = document.getElementById('pg_' + pg);
        var canvas = pgEl && pgEl.querySelector('.page-ink-canvas');
        if (canvas) {
          var ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          redrawPageInk(pg, ctx);
        }
        if (typeof window.saveUserEdits === 'function') window.saveUserEdits();
      }
    };

    document.getElementById('pipClearPage').onclick = function(){
      if (!confirm('آیا تمام دست‌خط‌ها و حاشیه‌های این صفحه پاک شوند؟')) return;
      var pg = window.curPage || 1;
      state.pageInkData[pg] = [];
      var pgEl = document.getElementById('pg_' + pg);
      var canvas = pgEl && pgEl.querySelector('.page-ink-canvas');
      if (canvas) {
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      if (typeof window.saveUserEdits === 'function') window.saveUserEdits();
    };

    document.getElementById('pipHwrConvert').onclick = function(){
      var pg = window.curPage || 1;
      var strokes = state.pageInkData[pg];
      if (!strokes || !strokes.length) {
        alert('ابتدا روی صفحه با قلم بنویسید.');
        return;
      }
      // تبدیل نقاط به قالب ارسالی به HWR
      var hwrStrokes = strokes.map(function(s){
        var xs = s.points.map(function(p){ return Math.round(p.x); });
        var ys = s.points.map(function(p){ return Math.round(p.y); });
        var ts = s.points.map(function(p, i){ return i * 20; });
        return [xs, ys, ts];
      });

      var pad = document.getElementById('hwPadCanvas') || { width: 800, height: 600 };
      fetch('https://inputtools.google.com/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          options: 'enable_pre_space',
          requests: [{ writing_area_width: 800, writing_area_height: 600, ink: hwrStrokes, language: 'fa' }]
        })
      })
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (Array.isArray(data) && data[0] === 'SUCCESS' && data[1] && data[1][0] && data[1][0][1]) {
          var cand = data[1][0][1];
          var choice = prompt('متن شناسایی‌شده از صفحه:\nیکی از موارد را انتخاب یا ویرایش کنید:', cand[0]);
          if (choice) {
            insertRecognizedText(choice);
          }
        } else {
          alert('متن دست‌خط صفحه شناسایی نشد.');
        }
      })
      .catch(function(){ alert('خطا در ارتباط با سرویس تشخیص دست‌خط.'); });
    };
  }

  function toggleOnPageInk(active) {
    buildPageInkPaletteDOM();
    initOnPageInkLayer();
    var pal = document.getElementById('pageInkPalette');
    if (!pal) return;

    if (active === undefined) active = !state.onPageInkActive;
    state.onPageInkActive = active;

    var btn = document.getElementById('btnToggleOnPageInk');
    var fabInkBtn = document.getElementById('fabItemInk');

    if (active) {
      document.body.classList.add('ink-mode-active');
      pal.classList.add('on');
      if (btn) btn.classList.add('active');
      if (fabInkBtn) fabInkBtn.classList.add('active');
    } else {
      document.body.classList.remove('ink-mode-active');
      pal.classList.remove('on');
      if (btn) btn.classList.remove('active');
      if (fabInkBtn) fabInkBtn.classList.remove('active');
    }
  }

  /* ==========================================================================
     ۵. دکمه شناور موبایل (#penMobileFab) و اتصال به نوار ابزار و قلم‌های فارسی
     ========================================================================== */

  /**
   * دکمه شناور موبایل (#penMobileFab) برای دسترسی فوری به قلم، پد و ویرایشگر در صفحات لمسی
   */
  function buildMobileFabDOM() {
    if (document.getElementById('penMobileFab')) return;

    var fab = document.createElement('div');
    fab.id = 'penMobileFab';
    fab.className = 'pen-mobile-fab';
    fab.setAttribute('role', 'toolbar');
    fab.setAttribute('aria-label', 'منوی قلم نوری موبایل');

    fab.innerHTML = 
      '<div class="fab-menu" id="penFabMenu">' +
        '<button class="fab-item-btn" id="fabItemPad" title="پد دست‌خط فارسی با قلم نوری">' +
          '<span class="fab-item-icon">📝</span> پد دست‌خط' +
        '</button>' +
        '<button class="fab-item-btn" id="fabItemInk" title="حاشیه‌نگاری مستقیم روی متن کتاب">' +
          '<span class="fab-item-icon">✒️</span> قلم روی متن' +
        '</button>' +
        '<button class="fab-item-btn" id="fabItemEdit" title="ویرایش متن صفحه جاری">' +
          '<span class="fab-item-icon">✏️</span> ویرایش متن' +
        '</button>' +
      '</div>' +
      '<button class="fab-main-btn" id="penFabMainBtn" title="قلم دیجیتال و دست‌خط" aria-label="منوی قلم دیجیتال">' +
        '✍️' +
      '</button>';

    document.body.appendChild(fab);

    var mainBtn = document.getElementById('penFabMainBtn');
    if (mainBtn) {
      mainBtn.onclick = function(e){
        e.stopPropagation();
        fab.classList.toggle('open');
      };
    }

    document.addEventListener('pointerdown', function(e){
      if (fab && !fab.contains(e.target)) {
        fab.classList.remove('open');
      }
    }, true);

    var itemPad = document.getElementById('fabItemPad');
    if (itemPad) {
      itemPad.onclick = function(e){
        e.stopPropagation();
        fab.classList.remove('open');
        toggleHandwritingPad(true);
      };
    }

    var itemInk = document.getElementById('fabItemInk');
    if (itemInk) {
      itemInk.onclick = function(e){
        e.stopPropagation();
        fab.classList.remove('open');
        toggleOnPageInk(true);
      };
    }

    var itemEdit = document.getElementById('fabItemEdit');
    if (itemEdit) {
      itemEdit.onclick = function(e){
        e.stopPropagation();
        fab.classList.remove('open');
        if (typeof window.ctxEditText === 'function') {
          window.ctxEditText();
        }
      };
    }
  }

  function enhanceEditToolbar() {
    buildMobileFabDOM();

    // نوار ابزار اصلی بالای صفحه (در صورت وجود)
    var topToolbar = document.querySelector('.toolbar') || document.getElementById('toolbar');
    if (topToolbar && !document.getElementById('bHandwriting')) {
      var btnTopHw = document.createElement('button');
      btnTopHw.id = 'bHandwriting';
      btnTopHw.className = 'btn-handwriting';
      btnTopHw.innerHTML = '✍️ قلم';
      btnTopHw.title = 'دست‌خط و قلم دیجیتال (Alt+P)';
      btnTopHw.onclick = function(){ toggleHandwritingPad(); };
      topToolbar.appendChild(btnTopHw);
    }

    var toolbar = document.getElementById('editToolbar');
    if (!toolbar) return;

    // ۱. افزودن فونت‌ها و سبک‌های دست‌خط فارسی به سلکتور قلم
    var fontSelect = document.getElementById('editFont');
    if (fontSelect && !fontSelect.hasAttribute('data-pen-enhanced')) {
      fontSelect.setAttribute('data-pen-enhanced', 'true');
      var handwritingGroup = document.createElement('optgroup');
      handwritingGroup.label = '✍️ دست‌خط و خطاطی فارسی';
      handwritingGroup.innerHTML = 
        '<option value="\'Noto Nastaliq Urdu Local\',\'Noto Nastaliq Urdu\',\'Iran Nastaliq\',serif">✒️ نستعلیق سنتی</option>' +
        '<option value="\'Aref Ruqaa Local\',\'Aref Ruqaa\',serif">✍️ دست‌نویس رقعی</option>' +
        '<option value="\'Dastnevis\',cursive,sans-serif">🖊️ دست‌نویس خودکاری</option>' +
        '<option value="\'Shakasteh Beta\',serif">🎨 شکسته نستعلیق</option>' +
        '<option value="\'Reem Kufi Local\',\'Reem Kufi\',sans-serif">🏛️ خط کوفی مدرن</option>' +
        '<option value="\'Lalezar Local\',\'Lalezar\',sans-serif">🖋️ خط عنوان / لاله زار</option>';
      fontSelect.insertBefore(handwritingGroup, fontSelect.firstChild);
    }

    // ۲. افزودن دکمه‌های قلم نوری و حاشیه‌نویسی
    if (!document.getElementById('btnToggleHwPad')) {
      var sep = document.createElement('span');
      sep.className = 'edit-sep';

      var btnHw = document.createElement('button');
      btnHw.id = 'btnToggleHwPad';
      btnHw.className = 'pen-tool-btn';
      btnHw.innerHTML = '✍️ پد دست‌خط';
      btnHw.title = 'باز کردن پد دست‌خط با قلم نوری (Alt+P)';
      btnHw.onclick = function(){ toggleHandwritingPad(); };

      var btnPageInk = document.createElement('button');
      btnPageInk.id = 'btnToggleOnPageInk';
      btnPageInk.className = 'pen-tool-btn';
      btnPageInk.innerHTML = '✒️ حاشیه‌نویسی مستقیم';
      btnPageInk.title = 'نوشتن و تصحیح مستقیم با قلم روی صفحه کتاب';
      btnPageInk.onclick = function(){ toggleOnPageInk(); };

      // درج قبل از دکمه بستن
      var closeBtn = toolbar.querySelector('.edit-close');
      if (closeBtn) {
        toolbar.insertBefore(sep, closeBtn);
        toolbar.insertBefore(btnHw, closeBtn);
        toolbar.insertBefore(btnPageInk, closeBtn);
      } else {
        toolbar.appendChild(sep);
        toolbar.appendChild(btnHw);
        toolbar.appendChild(btnPageInk);
      }
    }

    // ۳. افزودن به منوی کلیک راست (ctxMenu)
    var ctxMenu = document.getElementById('ctxMenu');
    // اگر این دو آیتم از قبل در HTML منو هستند، دوباره اضافه نمی‌شوند (جلوگیری از تکرار)
    var hasHwInMenu = ctxMenu && ctxMenu.querySelector('[onclick*="togglePad"]');
    var hasInkInMenu = ctxMenu && ctxMenu.querySelector('[onclick*="toggleOnPageInk"]');
    if (ctxMenu && !hasHwInMenu && !hasInkInMenu && !document.getElementById('ctxItemHwPad')) {
      var itemHw = document.createElement('div');
      itemHw.id = 'ctxItemHwPad';
      itemHw.className = 'ctx-item';
      itemHw.innerHTML = '✍️ نوشتن با قلم نوری (دست‌خط)';
      itemHw.onclick = function(){
        if (typeof window._closeCtx === 'function') window._closeCtx();
        toggleHandwritingPad(true);
      };
      var itemPageInk = document.createElement('div');
      itemPageInk.id = 'ctxItemPageInk';
      itemPageInk.className = 'ctx-item';
      itemPageInk.innerHTML = '✒️ حاشیه‌نگاری مستقیم با قلم روی متن';
      itemPageInk.onclick = function(){
        if (typeof window._closeCtx === 'function') window._closeCtx();
        toggleOnPageInk(true);
      };

      // درج در کنار ویرایش متن
      var editTextItem = ctxMenu.querySelector('[onclick*="ctxEditText()"]');
      if (editTextItem && editTextItem.nextSibling) {
        ctxMenu.insertBefore(itemHw, editTextItem.nextSibling);
        ctxMenu.insertBefore(itemPageInk, itemHw.nextSibling);
      } else {
        ctxMenu.appendChild(itemHw);
        ctxMenu.appendChild(itemPageInk);
      }
    }
  }

  // کلیدهای میانبر صفحه‌کلید
  document.addEventListener('keydown', function(e){
    // Alt + P یا Ctrl + Alt + P: باز و بسته‌کردن پد دست‌خط
    if ((e.altKey && (e.key === 'p' || e.key === 'P' || e.key === 'ح')) ||
        (e.ctrlKey && e.altKey && (e.key === 'p' || e.key === 'P'))) {
      e.preventDefault();
      toggleHandwritingPad();
    }
    // Esc: بستن پد یا پالت قلم
    if (e.key === 'Escape') {
      if (state.hwrOpen) toggleHandwritingPad(false);
      if (state.onPageInkActive) toggleOnPageInk(false);
    }
  });

  // پایش تغییرات DOM برای اطمینان از تزریق به نوار ابزار و صفحات
  var initObserver = new MutationObserver(function(){
    enhanceEditToolbar();
    if (state.onPageInkActive) initOnPageInkLayer();
  });
  initObserver.observe(document.body, { childList: true, subtree: true });

  // راه‌اندازی اولیه
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      enhanceEditToolbar();
      buildHwPadDOM();
    });
  } else {
    enhanceEditToolbar();
    buildHwPadDOM();
  }

  /* ==========================================================================
     ۶. صادرات متدها برای اتصال به سامانه ذخیره‌سازی کتاب (saveUserEdits / loadUserEdits)
     ========================================================================== */

  var DigitalPen = {
    togglePad: toggleHandwritingPad,
    toggleOnPageInk: toggleOnPageInk,
    setNib: function(nib){ state.activeNib = nib; },
    setColor: function(c){ state.color = c; },
    setWidth: function(w){ state.width = w; },
    exportEdits: function(){
      return JSON.parse(JSON.stringify(state.pageInkData));
    },
    importEdits: function(data){
      if (!data || typeof data !== 'object') return;
      state.pageInkData = data;
      initOnPageInkLayer();
      Object.keys(state.pageInkData).forEach(function(pg){
        redrawPageInk(+pg);
      });
    }
  };

  window.DigitalPen = DigitalPen;

})(window, document);
