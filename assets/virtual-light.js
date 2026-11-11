/* ==========================================================================
   virtual-light.js — آزمایشگاه شبیه‌ساز انواع نور و طیف‌های سنتی و مدرن
   Virtual Lighting Lab & Relighting Engine for IIIF & Manuscripts
   ========================================================================== */
(function(){
'use strict';

if(window.CoreaderVirtualLight) return;

// نمایه انواع نورها (Lighting Profiles)
var LIGHT_PROFILES = {
  // ۱. نورهای سنتی و کهن
  candle: {
    id: 'candle',
    name: 'شمع مومی',
    cat: 'trad',
    icon: '🕯️',
    desc: 'دمای ۱۸۰۰K، هاله طلایی و سوسوزن',
    color: '#ff9c38',
    highlightColor: 'rgba(255, 175, 75, 0.45)',
    filter: 'sepia(0.55) saturate(1.8) brightness(0.95) contrast(1.15)',
    flicker: true,
    blend: 'screen'
  },
  oil_lamp: {
    id: 'oil_lamp',
    name: 'چراغ روغنی / پیه‌سوز',
    cat: 'trad',
    icon: '🪔',
    desc: 'دمای ۲۲۰۰K، نفوذ کهربایی عمیق',
    color: '#ffa633',
    highlightColor: 'rgba(255, 190, 90, 0.4)',
    filter: 'sepia(0.4) saturate(1.5) brightness(1.0) contrast(1.1)',
    flicker: true,
    blend: 'screen'
  },
  torch: {
    id: 'torch',
    name: 'مشعل و آتش',
    cat: 'trad',
    icon: '🔥',
    desc: 'دمای ۲۴۰۰K، پرتو پرانرژی و شعاع پهن',
    color: '#ff6200',
    highlightColor: 'rgba(255, 130, 40, 0.5)',
    filter: 'sepia(0.65) saturate(2.2) brightness(0.9) contrast(1.25)',
    flicker: true,
    blend: 'screen'
  },
  lantern: {
    id: 'lantern',
    name: 'فانوس قدیمی',
    cat: 'trad',
    icon: '🏮',
    desc: 'نور هدایت‌شده گرم و زرین',
    color: '#ffd073',
    highlightColor: 'rgba(255, 215, 120, 0.35)',
    filter: 'sepia(0.25) saturate(1.3) brightness(1.05) contrast(1.05)',
    flicker: false,
    blend: 'screen'
  },

  // ۲. نورهای مرئی مدرن
  incandescent: {
    id: 'incandescent',
    name: 'تنگستن / رشته‌ای',
    cat: 'modern',
    icon: '💡',
    desc: '۲۷۰۰K زرد گرم خانگی و یکدست',
    color: '#ffeed1',
    highlightColor: 'rgba(255, 240, 210, 0.35)',
    filter: 'sepia(0.18) saturate(1.15) brightness(1.05)',
    flicker: false,
    blend: 'screen'
  },
  daylight: {
    id: 'daylight',
    name: 'نور طبیعی روز',
    cat: 'modern',
    icon: '☀️',
    desc: '۵۵۰۰K سفید خنثی با بالاترین وفاداری',
    color: '#ffffff',
    highlightColor: 'rgba(255, 255, 255, 0.3)',
    filter: 'brightness(1.02) contrast(1.02)',
    flicker: false,
    blend: 'screen'
  },
  fluorescent: {
    id: 'fluorescent',
    name: 'فلورسنت / مهتابی',
    cat: 'modern',
    icon: '🏢',
    desc: '۴۰۰۰K سفید اداری با ته‌رنگ ملایم',
    color: '#eaf4ff',
    highlightColor: 'rgba(230, 245, 255, 0.3)',
    filter: 'hue-rotate(185deg) saturate(0.9) brightness(1.04)',
    flicker: false,
    blend: 'screen'
  },
  led_spot: {
    id: 'led_spot',
    name: 'چراغ‌قوه استودیو LED',
    cat: 'modern',
    icon: '🔦',
    desc: '۶۵۰۰K سرد، تیز و پرکنتراست',
    color: '#d4ebff',
    highlightColor: 'rgba(215, 240, 255, 0.45)',
    filter: 'brightness(1.12) contrast(1.18) saturate(1.05)',
    flicker: false,
    blend: 'screen'
  },
  raking: {
    id: 'raking',
    name: 'نور مایل (Raking Light)',
    cat: 'modern',
    icon: '📐',
    desc: 'آشکارسازی برجستگی کاغذ و ترک‌ها',
    color: '#fff5ea',
    highlightColor: 'rgba(255, 235, 205, 0.55)',
    filter: 'contrast(1.75) brightness(0.9) saturate(0.65)',
    flicker: false,
    blend: 'overlay'
  },

  // ۳. تصویربرداری طیفی و آزمایشگاهی مرمت
  infrared: {
    id: 'infrared',
    name: 'مادون قرمز (IR)',
    cat: 'spectral',
    icon: '🔴',
    desc: 'نمایش جوهر کربنی زیر تذهیب و لایه‌ها',
    color: '#ffffff',
    highlightColor: 'rgba(255, 255, 255, 0.5)',
    filter: 'grayscale(1) contrast(1.7) brightness(1.18)',
    flicker: false,
    blend: 'screen'
  },
  ultraviolet: {
    id: 'ultraviolet',
    name: 'فرابنفش (UV Wood)',
    cat: 'spectral',
    icon: '🟣',
    desc: 'فلورسانس رنگدانه‌ها و ردیابی مرمت‌ها',
    color: '#4e14ff',
    highlightColor: 'rgba(130, 70, 255, 0.55)',
    filter: 'hue-rotate(240deg) saturate(3.8) contrast(1.45) brightness(0.85)',
    flicker: false,
    blend: 'screen'
  },
  xray: {
    id: 'xray',
    name: 'اشعه ایکس (X-Ray)',
    cat: 'spectral',
    icon: '🩻',
    desc: 'رادیوگرافی عبوری و بافت درونی متریال',
    color: '#e0f4ff',
    highlightColor: 'rgba(200, 240, 255, 0.4)',
    filter: 'invert(1) grayscale(1) contrast(2.3) brightness(0.88)',
    flicker: false,
    blend: 'screen'
  },
  negative: {
    id: 'negative',
    name: 'نگاتیو عکاسی',
    cat: 'spectral',
    icon: '🎞️',
    desc: 'معکوس رنگ برای خوانش خطوط کم‌رنگ',
    color: '#ffffff',
    highlightColor: 'rgba(255, 255, 255, 0.4)',
    filter: 'invert(1) hue-rotate(180deg) contrast(1.2)',
    flicker: false,
    blend: 'screen'
  },
  forensic_green: {
    id: 'forensic_green',
    name: 'تک‌رنگ جرم‌شناسی',
    cat: 'spectral',
    icon: '🟢',
    desc: 'طیف ۵۳۰nm برای تمایز انواع مرکب',
    color: '#00ff66',
    highlightColor: 'rgba(0, 255, 100, 0.4)',
    filter: 'grayscale(1) sepia(1) hue-rotate(85deg) saturate(3.5) contrast(1.6)',
    flicker: false,
    blend: 'screen'
  }
};

// وضعیت جاری سیستم نور (پیش‌فرض باز کردن اثر: همواره خاموش است)
var _state = {
  enabled: false,
  profile: 'candle',
  interactiveTorch: true, // نور متحرک با موس/لمس
  locked: false,           // تثبیت / قفل در نقطه دلخواه
  intensity: 120,         // درصد شدت (30 - 250)
  radius: 380,            // شعاع پرتو به پیکسل (100 - 850)
  ambient: 60,            // درصد تاریکی محیط اطراف (0 - 95)
  diffusion: 45,          // نرمی حاشیه نور (10 - 85)
  flickerEnabled: true,   // سوسو زدن شعله
  scope: 'image',         // 'image' (اولویت اول: کادر عکس IIIF) | 'text' (ریدر و پنل) | 'all' (کل صفحه)
  torchPos: { x: 0.5, y: 0.5 } // موقعیت نسبی نور (درصد)
};

// خواندن تنظیمات ذخیره شده (پیش‌فرض هنگام باز کردن همواره خاموش می‌ماند)
try {
  var saved = localStorage.getItem('coreader-virtual-light');
  if(saved){
    var parsed = JSON.parse(saved);
    Object.assign(_state, parsed);
    // اثر با باز شدن در ویوور و ریدر همواره با نور خاموش شروع می‌شود
    _state.enabled = false;
  }
} catch(e){}

function saveState(){
  try {
    localStorage.setItem('coreader-virtual-light', JSON.stringify({
      enabled: _state.enabled,
      profile: _state.profile,
      interactiveTorch: _state.interactiveTorch,
      locked: _state.locked,
      intensity: _state.intensity,
      radius: _state.radius,
      ambient: _state.ambient,
      diffusion: _state.diffusion,
      flickerEnabled: _state.flickerEnabled,
      scope: _state.scope
    }));
  } catch(e){}
}

/* ==========================================================================
   رابط کاربری و ساخت المان‌های DOM
   ========================================================================== */
var _elements = {
  btn: null,
  panel: null,
  layerDark: null,
  layerLight: null,
  torchCursor: null,
  targetContainer: null
};

// تشخیص اینکه آیا تارگت اسکرول‌شونده است (مانند ریدر) یا کادر مشخص بدون اسکرول (مانند ویوور IIIF)
function isViewportTarget(){
  if(document.getElementById('imagePanel') || document.getElementById('osd-container')) {
    return false;
  }
  if(document.getElementById('stage') || document.querySelector('.stage')) {
    return false;
  }
  return true;
}

// پیدا کردن کانتینر اصلی بر اساس Scope انتخابی
function getTargetContainer(){
  if(isViewportTarget()){
    // در ریدر و صفحات اسکرول‌شونده، نور باید مستقل از اسکرول روی ویوپورت قرار گیرد
    return document.body;
  }
  if(_state.scope === 'text'){
    var textEl = document.getElementById('tc') || document.getElementById('textContent') || document.querySelector('.reader-content');
    if(textEl) return textEl;
  } else if(_state.scope === 'all'){
    var appBody = document.querySelector('.app') || document.body;
    if(appBody) return appBody;
  }
  // پیش‌فرض و اولویت اول: کادر عکس ویوور IIIF و صحنه تور
  var osd = document.getElementById('imagePanel') ||
            document.getElementById('osd-container') ||
            document.getElementById('stage') ||
            document.querySelector('.stage');
  if(osd) return osd;
  return document.body;
}

// ساخت و تزریق لایه‌های نوری در کانتینر
function ensureLightLayers(){
  var container = getTargetContainer();
  if(!container) return;
  _elements.targetContainer = container;

  var isVp = isViewportTarget();

  // اطمینان از موقعیت نسبی کانتینر در حالت غیر ویوپورت
  if(!isVp){
    var pos = window.getComputedStyle(container).position;
    if(pos === 'static'){
      container.style.position = 'relative';
    }
  }

  // لایه ۱: تاریکی محیطی (Multiply Ambient)
  if(!_elements.layerDark || !_elements.layerDark.isConnected || _elements.layerDark.parentNode !== container){
    if(_elements.layerDark && _elements.layerDark.parentNode) _elements.layerDark.parentNode.removeChild(_elements.layerDark);
    var dark = document.createElement('div');
    dark.className = 'vlight-layer' + (isVp ? ' is-fixed' : '');
    dark.id = 'vlightLayerDark';
    container.appendChild(dark);
    _elements.layerDark = dark;
  } else {
    _elements.layerDark.classList.toggle('is-fixed', isVp);
  }

  // لایه ۲: درخشش پرتو نور (Screen / Specular Highlight)
  if(!_elements.layerLight || !_elements.layerLight.isConnected || _elements.layerLight.parentNode !== container){
    if(_elements.layerLight && _elements.layerLight.parentNode) _elements.layerLight.parentNode.removeChild(_elements.layerLight);
    var light = document.createElement('div');
    light.className = 'vlight-highlight-layer' + (isVp ? ' is-fixed' : '');
    light.id = 'vlightLayerLight';
    container.appendChild(light);
    _elements.layerLight = light;
  } else {
    _elements.layerLight.classList.toggle('is-fixed', isVp);
  }

  // لایه ۳: نشانگر حلقه نور متحرک
  if(!_elements.torchCursor || !_elements.torchCursor.isConnected || _elements.torchCursor.parentNode !== container){
    if(_elements.torchCursor && _elements.torchCursor.parentNode) _elements.torchCursor.parentNode.removeChild(_elements.torchCursor);
    var cur = document.createElement('div');
    cur.className = 'vlight-torch-cursor' + (isVp ? ' is-fixed' : '');
    cur.id = 'vlightTorchCursor';
    container.appendChild(cur);
    _elements.torchCursor = cur;
  } else {
    _elements.torchCursor.classList.toggle('is-fixed', isVp);
  }

  // رویدادهای جابجایی موس و لمس روی کانتینر
  bindPointerEvents(container);
}

// گوش‌دادن به حرکت موس و لمس
function bindPointerEvents(container){
  if(container._vlightBound) return;
  container._vlightBound = true;

  function handleMove(clientX, clientY){
    if(!_state.enabled || !_state.interactiveTorch || _state.locked) return;
    var isVp = isViewportTarget();

    var px, py;
    if(isVp){
      px = clientX;
      py = clientY;
      _state.pixelPos = { x: px, y: py };
      _state.torchPos.x = Math.max(0, Math.min(1, px / Math.max(1, window.innerWidth)));
      _state.torchPos.y = Math.max(0, Math.min(1, py / Math.max(1, window.innerHeight)));
    } else {
      var rect = container.getBoundingClientRect();
      if(rect.width <= 0 || rect.height <= 0) return;
      px = clientX - rect.left;
      py = clientY - rect.top;
      _state.pixelPos = { x: px, y: py };
      _state.torchPos.x = Math.max(0, Math.min(1, px / rect.width));
      _state.torchPos.y = Math.max(0, Math.min(1, py / rect.height));
    }

    // جابجایی نشانگر شناور
    if(_elements.torchCursor){
      _elements.torchCursor.style.left = px + 'px';
      _elements.torchCursor.style.top = py + 'px';
      if(_state.enabled && _state.interactiveTorch){
        _elements.torchCursor.style.display = 'block';
      }
    }

    renderLightEffect();
  }

  container.addEventListener('pointermove', function(e){
    handleMove(e.clientX, e.clientY);
  });

  // شنونده Capture روی window برای تضمین عدم قطع حرکت حتی با اسکرول یا توقف انتشار
  window.addEventListener('pointermove', function(e){
    if(!_state.enabled || !_state.interactiveTorch || _state.locked) return;
    if(isViewportTarget()){
      handleMove(e.clientX, e.clientY);
    } else {
      var rect = container.getBoundingClientRect();
      if(rect.width <= 0 || rect.height <= 0) return;
      if(e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom){
        handleMove(e.clientX, e.clientY);
      }
    }
  }, { passive: true, capture: true });

  container.addEventListener('touchmove', function(e){
    if(e.touches && e.touches[0]){
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });

  window.addEventListener('touchmove', function(e){
    if(isViewportTarget() && e.touches && e.touches[0]){
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });

  container.addEventListener('pointerenter', function(){
    if(_state.enabled && _state.interactiveTorch && _elements.torchCursor){
      _elements.torchCursor.style.display = 'block';
    }
  });

  container.addEventListener('pointerleave', function(){
    if(_elements.torchCursor && !_state.locked && !isViewportTarget()){
      _elements.torchCursor.style.display = 'none';
    }
  });

  // دوبار کلیک جهت قفل/تثبیت نور در این نقطه
  window.addEventListener('dblclick', function(e){
    if(!_state.enabled) return;
    var target = e.target;
    if(target && (target.closest('.vlight-panel') || target.closest('button') || target.closest('input') || target.closest('a'))) return;

    _state.locked = !_state.locked;
    var chk = document.getElementById('vlightChkLock');
    if(chk) chk.checked = _state.locked;
    if(_elements.torchCursor){
      _elements.torchCursor.classList.toggle('pinned', _state.locked);
      _elements.torchCursor.style.display = _state.locked ? 'block' : 'none';
    }
    renderLightEffect();
    saveState();
  });
}

// ساخت و تزریق پنل تنظیمات نور
function createControlPanel(){
  if(document.getElementById('vlightPanel')) return;

  var panel = document.createElement('div');
  panel.className = 'vlight-panel';
  panel.id = 'vlightPanel';

  panel.innerHTML = `
    <div class="vlight-header">
      <div class="vlight-title">
        <span>💡</span>
        <span>تنظیم انواع نور و طیف‌سنجی</span>
      </div>
      <button class="vlight-close" id="vlightCloseBtn" title="بستن پنل">✕</button>
    </div>
    <div class="vlight-body">
      <!-- تب دسته‌بندی نورها -->
      <div class="vlight-cat-tabs">
        <button class="vlight-cat-tab active" data-cat="all">همه</button>
        <button class="vlight-cat-tab" data-cat="trad">🕯️ سنتی</button>
        <button class="vlight-cat-tab" data-cat="modern">💡 مدرن</button>
        <button class="vlight-cat-tab" data-cat="spectral">🔬 طیف‌سنجی</button>
      </div>

      <!-- شبکه کارت‌های نور -->
      <div class="vlight-grid" id="vlightGrid"></div>

      <!-- تنظیمات شدت و شعاع پرتو -->
      <div>
        <div class="vlight-section-title">
          <span>تنظیمات فیزیکی پرتو نور</span>
          <span id="vlightProfileName" style="font-size:11px;color:var(--gold)">شمع مومی</span>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px">
          <div class="vlight-slider-row">
            <div class="vlight-slider-meta">
              <span>شدت نور (Intensity)</span>
              <span class="val" id="vlightValIntensity">${_state.intensity}٪</span>
            </div>
            <input type="range" id="vlightSliderIntensity" min="30" max="250" step="5" value="${_state.intensity}">
          </div>

          <div class="vlight-slider-row">
            <div class="vlight-slider-meta">
              <span>شعاع پرتو نور (Radius)</span>
              <span class="val" id="vlightValRadius">${_state.radius}px</span>
            </div>
            <input type="range" id="vlightSliderRadius" min="100" max="850" step="10" value="${_state.radius}">
          </div>

          <div class="vlight-slider-row">
            <div class="vlight-slider-meta">
              <span>تاریکی محیط اطراف (Ambient Darkness)</span>
              <span class="val" id="vlightValAmbient">${_state.ambient}٪</span>
            </div>
            <input type="range" id="vlightSliderAmbient" min="0" max="95" step="5" value="${_state.ambient}">
          </div>

          <div class="vlight-slider-row">
            <div class="vlight-slider-meta">
              <span>نرمی لبه و پخش نور (Diffusion)</span>
              <span class="val" id="vlightValDiffusion">${_state.diffusion}٪</span>
            </div>
            <input type="range" id="vlightSliderDiffusion" min="10" max="85" step="5" value="${_state.diffusion}">
          </div>
        </div>
      </div>

      <!-- سوئیچ‌های تعاملی -->
      <div class="vlight-switches">
        <label class="vlight-switch-label">
          <span>🔦 منبع نور متحرک (دنبال کردن موس و لمس)</span>
          <input type="checkbox" id="vlightChkInteractive" ${_state.interactiveTorch ? 'checked' : ''}>
        </label>
        <label class="vlight-switch-label">
          <span>📌 قفل / تثبیت نور در نقطه جاری (دوبار کلیک یا کلید P)</span>
          <input type="checkbox" id="vlightChkLock" ${_state.locked ? 'checked' : ''}>
        </label>
        <label class="vlight-switch-label">
          <span>✨ شبیه‌سازی سوسوزدن شعله (Flicker)</span>
          <input type="checkbox" id="vlightChkFlicker" ${_state.flickerEnabled ? 'checked' : ''}>
        </label>
      </div>

      <!-- انتخاب دامنه اثر (Scope) -->
      <div>
        <div class="vlight-section-title">
          <span>دامنه اثر نور</span>
        </div>
        <div class="vlight-scope-row">
          <button class="vlight-scope-btn ${_state.scope === 'image' ? 'active' : ''}" data-scope="image">🖼️ کادر تصویر IIIF</button>
          <button class="vlight-scope-btn ${_state.scope === 'text' ? 'active' : ''}" data-scope="text">📖 متن و ریدر</button>
          <button class="vlight-scope-btn ${_state.scope === 'all' ? 'active' : ''}" data-scope="all">🌐 کل صفحه</button>
        </div>
      </div>
    </div>
    <div class="vlight-footer">
      <button class="vlight-btn" id="vlightResetBtn">بازنشانی پیش‌فرض</button>
      <button class="vlight-btn primary" id="vlightToggleEnableBtn">
        ${_state.enabled ? 'خاموش کردن نور ✕' : 'روشن کردن نور 💡'}
      </button>
    </div>
  `;

  document.body.appendChild(panel);
  _elements.panel = panel;

  // رندر کارت‌های انتخاب نور
  renderProfileCards('all');

  // رویدادهای کنترلی
  bindPanelEvents(panel);
}

// ساخت کارت‌های انواع نور در پنل
function renderProfileCards(category){
  var grid = document.getElementById('vlightGrid');
  if(!grid) return;

  category = category || _state._lastCat || 'all';
  _state._lastCat = category;

  var keys = Object.keys(LIGHT_PROFILES);
  if(category !== 'all'){
    keys = keys.filter(function(k){ return LIGHT_PROFILES[k].cat === category; });
  }

  grid.innerHTML = keys.map(function(k){
    var p = LIGHT_PROFILES[k];
    var active = (_state.enabled && _state.profile === k) ? 'active' : '';
    return `
      <div class="vlight-card ${active}" data-pid="${p.id}">
        <span class="vlight-card-icon">${p.icon}</span>
        <div class="vlight-card-info">
          <span class="vlight-card-name">${p.name}</span>
          <span class="vlight-card-desc">${p.desc}</span>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('.vlight-card').forEach(function(card){
    card.onclick = function(){
      grid.querySelectorAll('.vlight-card').forEach(function(c){ c.classList.remove('active'); });
      card.classList.add('active');
      setProfile(card.dataset.pid);
    };
  });
}

// تنظیم رویدادهای المان‌های پنل
function bindPanelEvents(panel){
  document.getElementById('vlightCloseBtn').onclick = togglePanel;

  // تب‌های دسته‌بندی
  panel.querySelectorAll('.vlight-cat-tab').forEach(function(tab){
    tab.onclick = function(){
      panel.querySelectorAll('.vlight-cat-tab').forEach(function(t){ t.classList.remove('active'); });
      tab.classList.add('active');
      renderProfileCards(tab.dataset.cat);
    };
  });

  // اسلایدرها
  var sIntensity = document.getElementById('vlightSliderIntensity');
  var sRadius = document.getElementById('vlightSliderRadius');
  var sAmbient = document.getElementById('vlightSliderAmbient');
  var sDiffusion = document.getElementById('vlightSliderDiffusion');

  sIntensity.oninput = function(){
    _state.intensity = parseInt(this.value, 10);
    document.getElementById('vlightValIntensity').textContent = _state.intensity + '٪';
    renderLightEffect(); saveState();
  };
  sRadius.oninput = function(){
    _state.radius = parseInt(this.value, 10);
    document.getElementById('vlightValRadius').textContent = _state.radius + 'px';
    renderLightEffect(); saveState();
  };
  sAmbient.oninput = function(){
    _state.ambient = parseInt(this.value, 10);
    document.getElementById('vlightValAmbient').textContent = _state.ambient + '٪';
    renderLightEffect(); saveState();
  };
  sDiffusion.oninput = function(){
    _state.diffusion = parseInt(this.value, 10);
    document.getElementById('vlightValDiffusion').textContent = _state.diffusion + '٪';
    renderLightEffect(); saveState();
  };

  // چک‌باکس‌ها
  document.getElementById('vlightChkInteractive').onchange = function(){
    _state.interactiveTorch = this.checked;
    if(!this.checked){
      _state.torchPos = { x: 0.5, y: 0.5 };
      if(_elements.torchCursor) _elements.torchCursor.style.display = 'none';
    }
    renderLightEffect(); saveState();
  };

  document.getElementById('vlightChkLock').onchange = function(){
    _state.locked = this.checked;
    if(_elements.torchCursor){
      _elements.torchCursor.classList.toggle('pinned', _state.locked);
      _elements.torchCursor.style.display = _state.locked ? 'block' : 'none';
    }
    renderLightEffect(); saveState();
  };

  document.getElementById('vlightChkFlicker').onchange = function(){
    _state.flickerEnabled = this.checked;
    updateFlicker(); saveState();
  };

  // دکمه‌های دامنه اثر (Scope)
  panel.querySelectorAll('.vlight-scope-btn').forEach(function(btn){
    btn.onclick = function(){
      panel.querySelectorAll('.vlight-scope-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      setScope(btn.dataset.scope);
    };
  });

  // بازنشانی
  document.getElementById('vlightResetBtn').onclick = resetSettings;

  // روشن/خاموش
  document.getElementById('vlightToggleEnableBtn').onclick = function(){
    toggleLight(!_state.enabled);
  };
}

// دکمه در نوار ابزار
function injectToolbarButton(){
  var tb = document.getElementById('toolbar') || document.querySelector('.toolbar');
  if(!tb) return;

  var existing = document.getElementById('bVirtualLight');
  if(existing){
    _elements.btn = existing;
    existing.onclick = togglePanel;
    updateButtonState();
    return;
  }

  var btn = document.createElement('button');
  btn.id = 'bVirtualLight';
  btn.className = 'btn-vlight';
  btn.title = 'تنظیم انواع نورهای سنتی و مدرن، شمع، مشعل، مادون‌قرمز، فرابنفش، اشعه ایکس و نور متحرک (کلید L)';
  btn.innerHTML = '<span>💡</span><span>تنظیم نور</span>';
  btn.onclick = togglePanel;

  var ref = document.getElementById('bAdjust') || document.getElementById('bMag') || document.getElementById('bSettings') || tb.children[tb.children.length - 2];
  if(ref && ref.parentNode === tb){
    tb.insertBefore(btn, ref);
  } else {
    tb.appendChild(btn);
  }
  _elements.btn = btn;
  updateButtonState();
}

function updateButtonState(){
  var btn = _elements.btn || document.getElementById('bVirtualLight') || document.getElementById('lightBtn');
  if(!btn) return;
  _elements.btn = btn;
  btn.classList.toggle('active', !!_state.enabled);
  var p = LIGHT_PROFILES[_state.profile] || LIGHT_PROFILES.candle;
  if(btn.id === 'bVirtualLight'){
    btn.innerHTML = '<span>' + (p.icon || '💡') + '</span><span>' + (_state.enabled ? p.name : 'تنظیم نور') + '</span>';
  }
}

/* ==========================================================================
   موتور پردازش و رندر نور (Lighting Core Engine)
   ========================================================================== */
function setProfile(profileId){
  if(!LIGHT_PROFILES[profileId]) return;
  _state.profile = profileId;
  var p = LIGHT_PROFILES[profileId];

  var nameEl = document.getElementById('vlightProfileName');
  if(nameEl) nameEl.textContent = p.name;

  if(!_state.enabled){
    toggleLight(true);
  } else {
    renderLightEffect();
    updateButtonState();
    renderProfileCards();
    saveState();
  }
}

function setScope(scope){
  // پیش از تغییر کانتینر، تمام فیلترهای هدف قبلی را پاک می‌کنیم
  applyBaseFilterToTarget('');

  _state.scope = scope;
  // جداسازی لایه‌ها از کانتینر پیشین و اتصال به کانتینر جدید
  if(_elements.layerDark && _elements.layerDark.parentNode) _elements.layerDark.parentNode.removeChild(_elements.layerDark);
  if(_elements.layerLight && _elements.layerLight.parentNode) _elements.layerLight.parentNode.removeChild(_elements.layerLight);
  if(_elements.torchCursor && _elements.torchCursor.parentNode) _elements.torchCursor.parentNode.removeChild(_elements.torchCursor);
  _elements.layerDark = null;
  _elements.layerLight = null;
  _elements.torchCursor = null;

  ensureLightLayers();
  renderLightEffect();
  saveState();
}

function toggleLight(enable){
  _state.enabled = (typeof enable === 'boolean') ? enable : !_state.enabled;

  var toggleBtn = document.getElementById('vlightToggleEnableBtn');
  if(toggleBtn){
    toggleBtn.textContent = _state.enabled ? 'خاموش کردن نور ✕' : 'روشن کردن نور 💡';
    toggleBtn.classList.toggle('is-off', !_state.enabled);
  }

  ensureLightLayers();
  renderLightEffect();
  updateButtonState();
  renderProfileCards();
  saveState();
}

function togglePanel(){
  createControlPanel();
  ensureLightLayers();
  var p = _elements.panel;
  if(!p) return;
  p.classList.toggle('open');
}

function resetSettings(){
  _state.profile = 'candle';
  _state.intensity = 120;
  _state.radius = 380;
  _state.ambient = 60;
  _state.diffusion = 45;
  _state.interactiveTorch = true;
  _state.locked = false;
  _state.flickerEnabled = true;
  _state.scope = 'image';
  _state.torchPos = { x: 0.5, y: 0.5 };

  var sIntensity = document.getElementById('vlightSliderIntensity'); if(sIntensity) sIntensity.value = _state.intensity;
  var sRadius = document.getElementById('vlightSliderRadius'); if(sRadius) sRadius.value = _state.radius;
  var sAmbient = document.getElementById('vlightSliderAmbient'); if(sAmbient) sAmbient.value = _state.ambient;
  var sDiffusion = document.getElementById('vlightSliderDiffusion'); if(sDiffusion) sDiffusion.value = _state.diffusion;

  var vIntensity = document.getElementById('vlightValIntensity'); if(vIntensity) vIntensity.textContent = _state.intensity + '٪';
  var vRadius = document.getElementById('vlightValRadius'); if(vRadius) vRadius.textContent = _state.radius + 'px';
  var vAmbient = document.getElementById('vlightValAmbient'); if(vAmbient) vAmbient.textContent = _state.ambient + '٪';
  var vDiffusion = document.getElementById('vlightValDiffusion'); if(vDiffusion) vDiffusion.textContent = _state.diffusion + '٪';

  var chkInt = document.getElementById('vlightChkInteractive'); if(chkInt) chkInt.checked = true;
  var chkLock = document.getElementById('vlightChkLock'); if(chkLock) chkLock.checked = false;
  var chkFli = document.getElementById('vlightChkFlicker'); if(chkFli) chkFli.checked = true;

  if(_elements.torchCursor) _elements.torchCursor.classList.remove('pinned');

  renderProfileCards('all');
  renderLightEffect();
  updateButtonState();
  saveState();
}

// به‌روزرسانی سوسوزدن شمع/مشعل
function updateFlicker(){
  var p = LIGHT_PROFILES[_state.profile] || LIGHT_PROFILES.candle;
  var shouldFlicker = _state.enabled && _state.flickerEnabled && p.flicker;
  if(_elements.layerLight){
    _elements.layerLight.classList.toggle('vlight-flickering', shouldFlicker);
  }
}

// رندرینگ فیزیکی و بصری نور روی المان‌های مورد نظر
function renderLightEffect(){
  ensureLightLayers();
  var p = LIGHT_PROFILES[_state.profile] || LIGHT_PROFILES.candle;

  if(!_state.enabled){
    // ۱. مخفی‌سازی کامل و قطع لایه‌های نوری
    if(_elements.layerDark){
      _elements.layerDark.classList.remove('active');
      _elements.layerDark.style.display = 'none';
      _elements.layerDark.style.background = '';
      _elements.layerDark.style.opacity = '';
    }
    if(_elements.layerLight){
      _elements.layerLight.classList.remove('active');
      _elements.layerLight.classList.remove('vlight-flickering');
      _elements.layerLight.style.display = 'none';
      _elements.layerLight.style.background = '';
      _elements.layerLight.style.opacity = '';
      _elements.layerLight.style.mixBlendMode = '';
    }
    if(_elements.torchCursor){
      _elements.torchCursor.style.display = 'none';
      _elements.torchCursor.classList.remove('pinned');
    }
    // ۲. بازگردانی کامل و ۱۰۰٪ فیلترهای بصری به حالت اولیه
    applyBaseFilterToTarget('');
    updateFlicker();
    return;
  }

  // ۱. فعال‌سازی لایه‌ها
  if(_elements.layerDark){
    _elements.layerDark.style.display = 'block';
    _elements.layerDark.classList.add('active');
  }
  if(_elements.layerLight){
    _elements.layerLight.style.display = 'block';
    _elements.layerLight.classList.add('active');
  }

  // ۲. محاسبه مختصات منبع نور
  var isVp = isViewportTarget();
  var r = _state.radius;
  var diff = _state.diffusion; // درصد شیب ملایم
  var innerStop = Math.max(0, Math.round(r * (100 - diff) / 100));
  var outerStop = r;

  var darkAlpha = (_state.ambient / 100).toFixed(2);
  var lightAlpha = Math.min(1.0, (_state.intensity / 180)).toFixed(2);

  var posX, posY;
  if(isVp){
    // در ریدر: موقعیت دقیق ماوس روی ویوپورت
    posX = (_state.pixelPos && typeof _state.pixelPos.x === 'number') ? _state.pixelPos.x + 'px' : Math.round(_state.torchPos.x * window.innerWidth) + 'px';
    posY = (_state.pixelPos && typeof _state.pixelPos.y === 'number') ? _state.pixelPos.y + 'px' : Math.round(_state.torchPos.y * window.innerHeight) + 'px';
  } else {
    // در ویوور: موقعیت درصدی داخل کادر تصویر
    var cx = Math.round(_state.torchPos.x * 100);
    var cy = Math.round(_state.torchPos.y * 100);
    posX = cx + '%';
    posY = cy + '%';
  }

  // لایه ۱: تاریکی محیطی اطراف با گرادیان بیضوی چندمرحله‌ای نرم (Soft Multi-stop Radial Gradient)
  if(_elements.layerDark){
    var midStop = Math.round((innerStop + outerStop) / 2);
    var midDarkAlpha = (darkAlpha * 0.55).toFixed(2);
    var darkGrad = 'radial-gradient(circle ' + outerStop + 'px at ' + posX + ' ' + posY + ', ' +
                   'rgba(0,0,0,0) ' + innerStop + 'px, ' +
                   'rgba(12,9,6,' + midDarkAlpha + ') ' + midStop + 'px, ' +
                   'rgba(10,8,6,' + darkAlpha + ') ' + outerStop + 'px)';
    _elements.layerDark.style.background = darkGrad;
  }

  // لایه ۲: پرتو درخشان منبع نور با افت نور کاملاً طبیعی
  if(_elements.layerLight){
    _elements.layerLight.style.mixBlendMode = p.blend || 'screen';

    var highlightGrad = '';
    if(p.id === 'raking'){
      // نور مایل (RTI): شبیه‌سازی نور جهت‌دار تند با گرادیان خطی متحرک نسبت به موقعیت موس
      var angle = Math.round(Math.atan2((_state.torchPos.y - 0.5), (_state.torchPos.x - 0.5)) * 180 / Math.PI) + 90;
      highlightGrad = 'linear-gradient(' + angle + 'deg, ' + p.highlightColor + ' 0%, rgba(0,0,0,0) 70%)';
    } else {
      var midHighStop = Math.round(outerStop * 0.45);
      highlightGrad = 'radial-gradient(circle ' + outerStop + 'px at ' + posX + ' ' + posY + ', ' +
                      p.highlightColor + ' 0%, ' +
                      p.highlightColor.replace(/[\d\.]+\)$/, '0.22)') + ' ' + midHighStop + 'px, ' +
                      'rgba(0,0,0,0) ' + outerStop + 'px)';
    }

    _elements.layerLight.style.background = highlightGrad;
    _elements.layerLight.style.opacity = lightAlpha;
  }

  // ۳. اعمال فیلتر طیفی پایه به هدف انتخابی (کادر تصویر / متن / کل صفحه)
  var combinedFilter = p.filter || '';
  if(_state.intensity !== 100 && combinedFilter){
    var bFactor = (_state.intensity / 100).toFixed(2);
    combinedFilter += ' brightness(' + bFactor + ')';
  }
  applyBaseFilterToTarget(combinedFilter);

  // ۴. سوسوزدن
  updateFlicker();
}

// اعمال فیلتر بر اساس دامنه انتخاب‌شده (Scope)
function applyBaseFilterToTarget(filterStr){
  var scope = _state.scope;

  var osdEl = document.getElementById('osd-container') ||
              document.querySelector('.openseadragon-container') ||
              document.getElementById('roomImg') ||
              document.querySelector('.stage img') ||
              document.querySelector('.plan img');
  var textEl = document.getElementById('textContent') || document.getElementById('tc') || document.querySelector('.reader-content');
  var appBody = document.querySelector('.app') || document.body;

  // ۱. پاکسازی کامل و جامع هرگونه فیلتر از تمامی المان‌های تصویر، متن و کانتینرها
  if(osdEl) osdEl.style.filter = '';
  var osdInner = document.querySelector('.openseadragon-container');
  if(osdInner && osdInner !== osdEl) osdInner.style.filter = '';
  var imgPanel = document.getElementById('imagePanel');
  if(imgPanel && imgPanel !== osdEl) imgPanel.style.filter = '';
  var stageEl = document.getElementById('stage') || document.querySelector('.stage');
  if(stageEl && stageEl !== osdEl) stageEl.style.filter = '';
  var imgwrap = document.getElementById('imgwrap');
  if(imgwrap) imgwrap.style.filter = '';
  if(textEl) textEl.style.filter = '';
  if(appBody && appBody !== osdEl) appBody.style.filter = '';
  if(document.body && document.body !== osdEl) document.body.style.filter = '';

  var allImgs = document.querySelectorAll('#imagePanel img, #osd-container img, .osd-canvas-wrap img, .main img, #roomImg, .stage img, .plan img, #pimg, #bgA, #bgB, .openseadragon-canvas canvas, #tc img, .reader-content img');
  allImgs.forEach(function(el){ el.style.filter = ''; });

  if(!filterStr || !_state.enabled){
    // اگر در ویوور IIIF هستیم، اجازه دهیم تابع اصلی ویوور فیلترهای استاندارد خود اثر را بازنشانی کند
    if(typeof window.applyFilters === 'function'){
      try { window.applyFilters(); } catch(e){}
    }
    return;
  }

  // ۲. در زمان روشن بودن نور:
  if(scope === 'image'){
    var extra = '';
    if(window._adj){
      var parts = [];
      if(window._adj.brightness !== 1) parts.push('brightness(' + window._adj.brightness + ')');
      if(window._adj.contrast  !== 1) parts.push('contrast(' + window._adj.contrast  + ')');
      if(window._adj.saturation !== 1) parts.push('saturate(' + window._adj.saturation + ')');
      if(window._adj.hue       !== 0) parts.push('hue-rotate(' + window._adj.hue + 'deg)');
      if(window._adj.blur      !== 0) parts.push('blur(' + window._adj.blur + 'px)');
      if(window._adj.invert)        parts.push('invert(1)');
      extra = parts.join(' ');
    }
    var finalFilter = (filterStr + ' ' + extra).trim();
    if(osdEl) osdEl.style.filter = finalFilter;
    else {
      var imgs = document.querySelectorAll('#imagePanel img, .main img, #roomImg');
      imgs.forEach(function(im){ im.style.filter = finalFilter; });
    }
  } else if(scope === 'text'){
    if(textEl) textEl.style.filter = filterStr;
  } else if(scope === 'all'){
    if(appBody) appBody.style.filter = filterStr;
  }
}

// گوش‌به‌زنگ کلیدهای میانبر صفحه‌کلید
document.addEventListener('keydown', function(e){
  var ae = document.activeElement;
  var isTyping = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
  if(isTyping) return;

  if(e.key === 'l' || e.key === 'L'){
    if(e.shiftKey){
      e.preventDefault();
      togglePanel();
    } else {
      e.preventDefault();
      toggleLight(!_state.enabled);
    }
  } else if(e.key === 'p' || e.key === 'P'){
    if(_state.enabled){
      e.preventDefault();
      _state.locked = !_state.locked;
      var chk = document.getElementById('vlightChkLock');
      if(chk) chk.checked = _state.locked;
      if(_elements.torchCursor) _elements.torchCursor.classList.toggle('pinned', _state.locked);
      renderLightEffect();
      saveState();
    }
  } else if(e.key === '[' && _state.enabled){
    e.preventDefault();
    _state.intensity = Math.max(30, _state.intensity - 10);
    var sl = document.getElementById('vlightSliderIntensity'); if(sl) sl.value = _state.intensity;
    var vl = document.getElementById('vlightValIntensity'); if(vl) vl.textContent = _state.intensity + '٪';
    renderLightEffect(); saveState();
  } else if(e.key === ']' && _state.enabled){
    e.preventDefault();
    _state.intensity = Math.min(250, _state.intensity + 10);
    var sl2 = document.getElementById('vlightSliderIntensity'); if(sl2) sl2.value = _state.intensity;
    var vl2 = document.getElementById('vlightValIntensity'); if(vl2) vl2.textContent = _state.intensity + '٪';
    renderLightEffect(); saveState();
  }
});

/* ==========================================================================
   راه‌اندازی اولیه و اتصال به محیط
   ========================================================================== */
function init(){
  injectToolbarButton();
  ensureLightLayers();
  if(_state.enabled){
    renderLightEffect();
    updateButtonState();
  }
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

setTimeout(init, 1200);

window.CoreaderVirtualLight = {
  toggle: toggleLight,
  setProfile: setProfile,
  setScope: setScope,
  togglePanel: togglePanel,
  getState: function(){ return Object.assign({}, _state); },
  getProfiles: function(){ return LIGHT_PROFILES; }
};

})();
