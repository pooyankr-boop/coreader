// viewer.js — IIIF viewer engine
(function(){
'use strict';

var BOOK=null, _osd=null, _curPage=1, _rotating=0;
var _annos=[], _bookmarks=[], _bookmarks2=[], _rawManifest=null;
var _ttsOn=false, _ttsVoice=null, _ttsUtterance=null;
var _ttsPlaying=false, _ttsEngine='browser', _ttsOffsets=[], _ttsStartIdx=0;
var _ttsAudio=null, _ttsChunks=[], _ttsChunkIdx=0, _ttsFellBack=false;
var _ttsVoices=[];
var _annoOn=true;
var _lastInterimKey='', _missStreak=0, _sessionLog=[], _sessionT0=0;
var _magOn=false, _magScale=2.5, _magSize=400;

// === Init ===
function init(){
  loadGlossary();
  loadTheme();
  var params=new URLSearchParams(location.search);
  var slug=params.get('book');
  if(!slug){document.body.innerHTML='<div style="text-align:center;padding:60px;color:#999">کتابی انتخاب نشد. <a href="../">بازگشت</a></div>';return}
  document.title=slug+' — کتابخوان';
  loadBook(slug);
}

function loadBook(slug){
  // Try local book first
  fetch('../books/'+encodeURIComponent(slug)+'/book.json').then(function(r){
    if(r.ok) return r.json();
    return fetch('../books/'+encodeURIComponent(slug)+'/manifest.json').then(function(r2){
      if(r2.ok) return r2.json();
      throw new Error('not-local');
    });
  }).catch(function(e){
    // For IIIF/custom books: fetch from books-index and resolve manifest
    return fetch('../books-index.json').then(function(r){return r.json()}).then(function(list){
      var custom=JSON.parse(localStorage.getItem('coreader-custom-books')||'[]');
      var all=list.concat(custom);
      var entry=all.find(function(b){return b.slug===slug});
      if(entry && entry.manifestUrl){
        return fetch(entry.manifestUrl).then(function(r){
          if(!r.ok) throw new Error('manifest fetch failed: '+r.status);
          return r.json();
        }).then(function(data){data._entry=entry;return data;});
      }
      throw new Error('Book not found');
    });
  }).then(function(data){
    BOOK=normalizeBook(data, slug);
        _rawManifest=data;
        setupOsd();
        renderMeta();
        renderIiifToc(data);
            loadText(slug);
            setTimeout(annotateGlossary,500);
    loadAnnos(slug);
    loadBookmarks(slug);
    goPage(1);
    buildThumbStrip();
  }).catch(function(e){
    document.body.innerHTML='<div style="text-align:center;padding:60px;color:#c0392b">خطا: '+e.message+'<br><a href="../">بازگشت</a></div>';
  });
}

// Persian label map for IIIF metadata
var META_LABELS={
  'Title':'عنوان','Other Titles':'عناوین دیگر','Shelfmark':'شمارهٔ قفسه',
  'Author':'نویسنده','Language':'زبان','Date Statement':'تاریخ',
  'Materials':'مواد','Hand':'خط','Extent':'تعداد صفحات','Decoration':'تزئینات',
  'Binding':'صحافی','Record Origin':'منبع رکورد','Collection':'مجموعه',
  'Holding Institution':' مؤسسهٔ نگهدارنده','Catalogue Description':'توضیحات فهرست',
  'Homepage':'صفحهٔ اصلی','Record Created':'تاریخ ثبت',
  'Note':'یادداشت','Provenance':'سابقهٔ مالکیت','Former Owner':'مالک قبلی',
  'Subject':'موضوع','Call Number':'شمارهٔ تماس','Shelfmark/Call Number':'شمارهٔ قفسه',
  'Repository':'بایگانی','Digital Origin':'منبع دیجیتال','Rights':'حقوق',
  'Local Reference':'مرجع محلی'
};
function translateMetaLabel(label){
  return META_LABELS[label]||label;
}
function extractIiifMetadata(data){
  var meta=[];
  if(data.metadata && data.metadata.length){
    data.metadata.forEach(function(m){
      var label=m.label||'';
      var val=m.value||'';
      // Strip HTML tags for display
      if(typeof val==='string') val=val.replace(/<[^>]+>/g,'').trim();
      if(Array.isArray(val)) val=val.join(' ');
      if(label && val && val!=='') meta.push({label:translateMetaLabel(label),rawLabel:label,value:val});
    });
  }
  return meta;
}
function normalizeBook(data, slug){
  var entry=data._entry||null;
  // Handle both book.json (local) and manifest.json (IIIF)
  var b={slug:slug, title:data.label||data.title||slug, author:'', pages:0, items:[], chapters:[], hasText:false, source:'local', iiifMeta:[]};
  // Copy externalLinks from books-index entry
  if(entry && entry.externalLinks) b.externalLinks=entry.externalLinks;
  else if(entry && entry.manifestUrl) b.externalLinks={iiifManifest:entry.manifestUrl};
  // Detect IIIF manifest by presence of items/sequences/@context
  if(data['@context'] && data['@context'].indexOf('iiif')>=0){
    b.source='iiif';
  } else if(data.items || data.sequences){
    b.source='iiif';
  }
  if(data.author) b.author=typeof data.author==='string'?data.author:(Array.isArray(data.author)?data.author.join(' '):'');
  if(data.summary) b.summary=typeof data.summary==='string'?data.summary:(Array.isArray(data.summary)?data.summary.join(' '):'');
  if(data.provider && data.provider[0]){
    var p=data.provider[0].label;
    b.provider=typeof p==='string'?p:(Array.isArray(p)?p.join(' '):'');
  }
  // Extract IIIF metadata
  if(b.source==='iiif'){
    b.iiifMeta=extractIiifMetadata(data);
    // Use IIIF metadata for author if not set
    if(!b.author){
      var authorMeta=b.iiifMeta.find(function(m){return m.rawLabel==='Author'});
      if(authorMeta) b.author=authorMeta.value;
    }
    // Use description as summary
    if(data.description && !b.summary){
      b.summary=typeof data.description==='string'?data.description:(Array.isArray(data.description)?data.description.join(' '):'');
    }
    // Use thumbnail
    if(data.thumbnail){
      var th=data.thumbnail;
      if(th['@id']) b.thumbnail=th['@id'];
      else if(typeof th==='string') b.thumbnail=th;
    }
  }
  // IIIF manifest v3 (items)
  if(data.items && data.items.length){
    b.items=data.items.map(function(item,i){
      var page={num:i+1, canvasId:item.id, images:[]};
      if(item.items){
        item.items.forEach(function(body){
          if(body.items){
            body.items.forEach(function(anno){
              if(anno.body){
                var imgs=Array.isArray(anno.body)?anno.body:[anno.body];
                imgs.forEach(function(img){
                  if(img.type==='Image' || img.service) page.images.push(img);
                });
              }
            });
          }
        });
      }
      return page;
    });
    b.pages=b.items.length;
  }
  // IIIF manifest v2 (sequences[0].canvases)
  else if(data.sequences && data.sequences[0] && data.sequences[0].canvases){
    var canvases=data.sequences[0].canvases;
    b.items=canvases.map(function(c,i){
      var page={num:i+1, canvasId:c['@id']||c.id, images:[], label:c.label||''};
      if(c.images){
        c.images.forEach(function(anno){
          var res=anno.resource||anno.body;
          if(res){
            if(res.service) page.images.push({id:res['@id']||res.id, service:res.service});
            else if(res['@id']) page.images.push({id:res['@id'], service:null});
          }
        });
      }
      return page;
    });
    b.pages=b.items.length;
  }
  // Local book format
  else if(data.pages && data.pages.length){
    b.pages=data.pages.length;
    b.localPages=data.pages;
    b.hasText=true;
    // Generate tile source from pdf or simple image
    b.items=data.pages.map(function(p,i){
      return {num:p.page||i+1, localHtml:p.html||p.text||''};
    });
  }
  // Chapters
  if(data.chapters) b.chapters=data.chapters;
  delete data._entry;
  return b;
}

// === OpenSeadragon ===
function setupOsd(){
  var container=document.getElementById('osd-container');
  if(!BOOK.items.length){
    container.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted)">تصویری موجود نیست</div>';
    return;
  }
  var tileSource=getTileSource(BOOK.items[0]);
  var osdOpts={
    id:'osd-container',
    showNavigationControl:false,
    blendTime:0.3,
    animationTime:0.5,
    maxZoomPixelRatio:3,
    minZoomLevel:0.5,
    zoomPerClick:2,
    visibilityRatio:0.9,
    rtl:true
  };
  // OpenSeadragon IIIF: pass info.json URL directly
  if(tileSource.type==='iiif'){
    osdOpts.tileSources=tileSource.infoUrl;
  } else {
    osdOpts.tileSources=tileSource.url;
  }
  _osd=OpenSeadragon(osdOpts);
}

function getTileSource(item){
  if(item.images && item.images.length){
    var img=item.images[0];
    var svc=img.service;
    if(svc){
      if(Array.isArray(svc)) svc=svc[0];
      var svcId=svc && (svc['@id']||svc.id);
      if(svcId){
        return {type:'iiif', infoUrl:svcId+'/info.json', baseUrl:svcId};
      }
    }
    if(img.id){
      return {type:'image',url:img.id};
    }
  }
  return {type:'image',url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" fill="#f0ebe3"><text x="200" y="300" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#8c8577">صفحه '+item.num+'</text></svg>')};
}

function goToPageImage(pageIdx){
  if(!_osd || !BOOK.items[pageIdx]) return;
  var item=BOOK.items[pageIdx];
  var ts=getTileSource(item);
  if(ts.type==='iiif'){
    _osd.open(ts.infoUrl);
  } else {
    _osd.open(ts.url);
  }
  document.getElementById('pageLabel').textContent='صفحهٔ '+(pageIdx+1)+' از '+BOOK.pages;
  // Update thumb strip highlight
  var strip=document.getElementById('thumbStrip');
  if(strip){
    strip.querySelectorAll('.thumb-item').forEach(function(t,i){
      t.classList.toggle('active',i===pageIdx);
    });
    var active=strip.querySelector('.thumb-item.active');
    if(active) active.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'});
  }
}

function buildThumbStrip(){
  var panel=document.getElementById('imagePanel');
  if(!panel||!BOOK||!BOOK.items||!BOOK.items.length) return;
  // Remove existing strip
  var old=panel.querySelector('.thumb-strip');
  if(old) old.remove();
  // Only build for IIIF books
  var hasThumbs=BOOK.items.some(function(item){
    if(!item.images||!item.images.length) return false;
    var svc=item.images[0].service;
    if(svc){if(Array.isArray(svc))svc=svc[0];return !!(svc&&(svc['@id']||svc.id));}
    return false;
  });
  if(!hasThumbs) return;
  var strip=document.createElement('div');
  strip.className='thumb-strip';
  strip.id='thumbStrip';
  BOOK.items.forEach(function(item,i){
    var svcId=null;
    if(item.images&&item.images.length){
      var svc=item.images[0].service;
      if(svc){if(Array.isArray(svc))svc=svc[0];svcId=svc&&((svc['@id'])||svc.id);}
    }
    var thumbUrl=svcId?svcId+'/full/60,/0/default.jpg':'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="80" fill="#f0ebe3"><text x="30" y="45" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#8c8577">'+(i+1)+'</text></svg>');
    var div=document.createElement('div');
    div.className='thumb-item'+(i===(_curPage-1)?' active':'');
    div.onclick=function(){goPage(i+1);};
    var img=document.createElement('img');
    img.src=thumbUrl;
    img.alt=(i+1);
    img.loading='lazy';
    img.onerror=function(){this.style.display='none';};
    div.appendChild(img);
    var label=document.createElement('span');
    label.className='thumb-label';
    label.textContent=i+1;
    div.appendChild(label);
    strip.appendChild(div);
  });
  panel.appendChild(strip);
  // Add control buttons OUTSIDE strip (so overflow:auto doesn't clip them)
  var controls=document.createElement('div');
  controls.className='thumb-controls';
  controls.id='thumbControls';
  var collapseBtn=document.createElement('button');
  collapseBtn.className='thumb-ctrl';
  collapseBtn.textContent='✕';
  collapseBtn.title='بستن نوار';
  collapseBtn.onclick=function(){strip.classList.toggle('collapsed');collapseBtn.textContent=strip.classList.contains('collapsed')?'☰':'✕';};
  controls.appendChild(collapseBtn);
  var orientBtn=document.createElement('button');
  orientBtn.className='thumb-ctrl';
  orientBtn.textContent='↕';
  orientBtn.title='عمودی/افقی';
  orientBtn.onclick=function(){strip.classList.toggle('vertical');orientBtn.textContent=strip.classList.contains('vertical')?'↔':'↕';};
  controls.appendChild(orientBtn);
  panel.appendChild(controls);
}

// === Page navigation ===
function goPage(n){
  n=Math.max(1,Math.min(BOOK.pages,n));
  _curPage=n;
  document.getElementById('pgInput').value=n;
    document.getElementById('pgTotal').textContent='از '+toFA(BOOK.pages);
  goToPageImage(n-1);
  renderText();
  renderAnnos();
  updateProgress();
}
function nextPage(){goPage(_curPage+1)}
function prevPage(){goPage(_curPage-1)}
function toFA(n){return String(n).replace(/[0-9]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'[d]})}

// === Text ===
function loadText(slug){
  // Skip local pages.json fetch for IIIF books (no local text files)
  if(BOOK && BOOK.source === 'iiif'){
    BOOK.hasText = false;
    renderText();
    return;
  }
  fetch('../books/'+encodeURIComponent(slug)+'/pages.json').then(function(r){
    if(!r.ok) return null;
    return r.json();
  }).then(function(pages){
    if(pages && pages.length){
      _texts=pages.map(function(p){return{page:p.page||p.num,html:p.html||p.text||''}});
    } else if(BOOK.localPages && BOOK.localPages.length){
      _texts=BOOK.localPages.map(function(p){return{page:p.page,html:p.html||''}});
    }
    BOOK.hasText=_texts.length>0;
    renderText();
  }).catch(function(){
    if(BOOK.localPages && BOOK.localPages.length){
      _texts=BOOK.localPages.map(function(p){return{page:p.page,html:p.html||''}});
      BOOK.hasText=true;
    }
    renderText();
  });
}

function renderText(){
  var el=document.getElementById('textContent');
  if(!BOOK.hasText || !_texts.length){
    el.innerHTML='<p style="color:var(--muted);font-size:13px;text-align:center">متن صفحه موجود نیست</p>';
    return;
  }
  var pageData=_texts.find(function(p){return p.page===_curPage});
  if(!pageData){
    el.innerHTML='<p style="color:var(--muted);font-size:13px;text-align:center">متن این صفحه موجود نیست</p>';
    return;
  }
  el.innerHTML='<div style="font-size:11px;color:var(--muted);margin-bottom:8px">صفحهٔ '+toFA(_curPage)+'</div>'+
    '<div class="text-content">'+(pageData.html||pageData.text||'')+'</div>';
}

// === Metadata ===
function renderMeta(){
  var el=document.getElementById('metaContent');
  var rows='';
  rows+='<h3>'+BOOK.title+'</h3>';
  if(BOOK.author) rows+='<div class="meta-row"><span class="label">نویسنده:</span> <span class="value">'+BOOK.author+'</span></div>';
  if(BOOK.summary) rows+='<div class="meta-row"><span class="label">خلاصه:</span> <span class="value" style="font-size:12px">'+BOOK.summary+'</span></div>';
  if(BOOK.provider) rows+='<div class="meta-row"><span class="label">منبع:</span> <span class="value">'+BOOK.provider+'</span></div>';
  rows+='<div class="meta-row"><span class="label">تعداد صفحات:</span> <span class="value">'+toFA(BOOK.pages)+'</span></div>';
  // Show all IIIF metadata
  if(BOOK.iiifMeta && BOOK.iiifMeta.length){
    rows+='<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">';
    rows+='<h3 style="font-size:13px;color:var(--accent);margin-bottom:8px">اطلاعات نسخهٔ خطی</h3>';
    BOOK.iiifMeta.forEach(function(m){
      if(m.rawLabel==='Title'||m.rawLabel==='Homepage'||m.rawLabel==='Catalogue Description') return;
      rows+='<div class="meta-row"><span class="label">'+m.label+':</span> <span class="value" style="font-size:12px">'+m.value+'</span></div>';
    });
    rows+='</div>';
  }
  // External links section
  if(BOOK.externalLinks){
    var elinks=BOOK.externalLinks;
    var hasLinks=elinks.digitalObject||elinks.mirador||elinks.universalViewer||elinks.iiifManifest;
    if(hasLinks){
      rows+='<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">';
      rows+='<h3 style="font-size:13px;color:var(--accent);margin-bottom:8px">🔗 پیوندها</h3>';
      if(elinks.digitalObject) rows+='<div class="meta-row"><a href="'+elinks.digitalObject+'" target="_blank" rel="noopener" style="font-size:12px">📷 شیء دیجیتال (Digital Object)</a></div>';
      if(elinks.mirador) rows+='<div class="meta-row"><a href="'+elinks.mirador+'" target="_blank" rel="noopener" style="font-size:12px">🖥️ Mirador Viewer</a></div>';
      if(elinks.universalViewer) rows+='<div class="meta-row"><a href="'+elinks.universalViewer+'" target="_blank" rel="noopener" style="font-size:12px">👁️ Universal Viewer</a></div>';
      if(elinks.iiifManifest) rows+='<div class="meta-row"><a href="'+elinks.iiifManifest+'" target="_blank" rel="noopener" style="font-size:12px">📜 IIIF Manifest</a></div>';
      rows+='</div>';
    }
  }
  // Thumbnail for IIIF
  if(BOOK.thumbnail){
    rows+='<div style="margin-top:12px;text-align:center"><img src="'+BOOK.thumbnail+'" style="max-width:200px;border-radius:8px;border:1px solid var(--border)" onerror="this.style.display=\'none\'"></div>';
  }
  if(BOOK.chapters && BOOK.chapters.length){
    rows+='<div style="margin-top:16px"><h3 style="font-size:13px">فهرست مطالب</h3>';
    rows+='<ul style="list-style:none;padding:0;margin:0">';
    BOOK.chapters.forEach(function(ch){
      rows+='<li style="padding:4px 0;font-size:12px;cursor:pointer;color:var(--accent)" onclick="goPage('+(ch.startPage||1)+')">'+ch.title+'</li>';
    });
    rows+='</ul></div>';
  }
  el.innerHTML=rows;
}

// === Annotations ===
function loadAnnos(slug){
  try{_annos=JSON.parse(localStorage.getItem('coreader-anno-'+slug)||'[]')}catch(e){_annos=[]}
}
function saveAnnos(slug){
  localStorage.setItem('coreader-anno-'+BOOK.slug,JSON.stringify(_annos));
}
function renderAnnos(){
  var el=document.getElementById('annoList');
  var pageAnnos=_annos.filter(function(a){return a.page===_curPage});
  if(!pageAnnos.length){el.innerHTML='<li style="color:var(--muted);font-size:13px;text-align:center;padding:16px">هنوز حاشیه‌ای ثبت نشده</li>';return}
  el.innerHTML=pageAnnos.map(function(a,i){
    return '<li class="anno-item"><div class="anno-head"><span class="anno-page">صفحهٔ '+toFA(a.page)+'</span><span class="anno-del" onclick="delAnnotation('+i+')">✕</span></div><div>'+a.text+'</div></li>';
  }).join('');
}
window.addAnnotation=function(){
  var input=document.getElementById('annoInput');
  var text=input.value.trim();
  if(!text) return;
  _annos.push({page:_curPage,text:text,time:Date.now()});
  saveAnnos(); input.value=''; renderAnnos();
};
window.delAnnotation=function(i){
  // Find actual index in full array
  var pageAnnos=_annos.filter(function(a){return a.page===_curPage});
  var target=pageAnnos[i];
  var idx=_annos.indexOf(target);
  if(idx>=0){_annos.splice(idx,1);saveAnnos();renderAnnos()}
};

// === Bookmarks ===
function loadBookmarks(slug){
  try{_bookmarks=JSON.parse(localStorage.getItem('coreader-bm-'+slug)||'[]')}catch(e){_bookmarks=[]}
}
function saveBookmarks(){localStorage.setItem('coreader-bm-'+BOOK.slug,JSON.stringify(_bookmarks))}
function renderBookmarks(){
  var el=document.getElementById('bmList');
  if(!_bookmarks.length){el.innerHTML='<p style="color:var(--muted);font-size:13px;text-align:center">نشانه‌ای ثبت نشده</p>';return}
  el.innerHTML=_bookmarks.sort(function(a,b){return a.page-b.page}).map(function(bm,i){
    return '<div class="bm-item" onclick="goPage('+bm.page+')"><span>صفحهٔ '+toFA(bm.page)+(bm.label?' — '+bm.label:'')+'</span><span class="bm-del" onclick="event.stopPropagation();delBookmark('+i+')">✕</span></div>';
  }).join('');
}
window.toggleBookmarks=function(){
  var o=document.getElementById('bmOverlay');
  var p=document.getElementById('bmPanel');
  var on=o.classList.contains('on');
  o.classList.toggle('on');p.classList.toggle('on');
  if(!on) renderBookmarks();
};
window.addBookmark=function(label){
  _bookmarks.push({page:_curPage,label:label||'',time:Date.now()});
  saveBookmarks();
};
window.delBookmark=function(i){
  _bookmarks.splice(i,1);saveBookmarks();renderBookmarks();
};

// === Search ===
window.doSearch=function(){
  var q=(document.getElementById('searchInput').value||'').trim();
  var el=document.getElementById('searchResults');
  if(!q||!_texts.length){el.innerHTML='';return}
  var results=[];
  _texts.forEach(function(p){
    var txt=(p.html||p.text||'').replace(/<[^>]+>/g,' ');
    if(txt.indexOf(q)>=0){
      var snippet=txt.substring(Math.max(0,txt.indexOf(q)-30),txt.indexOf(q)+q.length+60);
      snippet=snippet.replace(new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi'),'<mark>$1</mark>');
      results.push({page:p.page,snippet:'...'+snippet+'...'});
    }
  });
  if(!results.length){el.innerHTML='<p style="color:var(--muted);font-size:13px">نتیجه‌ای یافت نشد</p>';return}
  el.innerHTML=results.slice(0,50).map(function(r){
    return '<div class="search-result" onclick="goPage('+r.page+')"><span class="sr-page">صفحهٔ '+toFA(r.page)+'</span><div>'+r.snippet+'</div></div>';
  }).join('');
};

// === Rotation ===
window.rotateImage=function(deg){
  if(!_osd) return;
  _rotating+=deg;
  if(_osd.viewport) _osd.viewport.setRotation(_rotating);
  else if(_osd.setRotation) _osd.setRotation(_rotating);
};

// === TTS ===
window.toggleTts=function(){
  _ttsOn=!_ttsOn;
  var inline=document.getElementById('ttsInlineControls');
  if(inline) inline.style.display=_ttsOn?'block':'none';
  // Switch to text pane when turning on TTS
  if(_ttsOn) switchPane('text');
  if(!_ttsOn) stopTts();
};
window.toggleTtsPlay=function(){
  if(window.speechSynthesis.speaking){stopTts();return}
  speakPage();
};
window.setTtsRate=function(v){
  document.getElementById('ttsRateLabel').textContent=parseFloat(v).toFixed(1)+'×';
};
function speakPage(){
  if(!_texts.length) return;
  var pageData=_texts.find(function(p){return p.page===_curPage});
  if(!pageData) return;
  var text=(pageData.text||'').replace(/<[^>]+>/g,'');
  if(!text.trim()) return;
  var engine=document.getElementById('setTtsEngine').value;
  if(engine==='google'){
    speakGoogle(text);
  } else {
    speakBrowser(text);
  }
}
function speakBrowser(text){
  var u=new SpeechSynthesisUtterance(text);
  u.lang='fa-IR';
  u.rate=parseFloat(document.getElementById('ttsRate').value)||1;
  u.onend=function(){document.getElementById('ttsStatus').textContent='پایان خوانش'};
  u.onerror=function(){document.getElementById('ttsStatus').textContent='خطا در خوانش'};
  window.speechSynthesis.speak(u);
  document.getElementById('ttsStatus').textContent='در حال خوانش...';
}
function speakGoogle(text){
  var chunks=[];var maxLen=200;
  for(var i=0;i<text.length;i+=maxLen) chunks.push(text.substring(i,i+maxLen));
  document.getElementById('ttsStatus').textContent='در حال خوانش...';
  var idx=0;
  function playNext(){
    if(idx>=chunks.length||!_ttsOn){document.getElementById('ttsStatus').textContent='پایان خوانش';return}
    var url='https://translate.google.com/translate_tts?ie=UTF-8&tl=fa&client=tw-ob&q='+encodeURIComponent(chunks[idx]);
    var a=new Audio(url);
    a.onended=function(){idx++;playNext()};
    a.onerror=function(){speakBrowser(chunks[idx])};
    a.play();
    idx++;
  }
  playNext();
}
function stopTts(){window.speechSynthesis.cancel();document.getElementById('ttsStatus').textContent='آماده خوانش'}
window.setTtsEngine=function(v){_ttsEngine=v};

// === UI toggles ===
window.toggleToc=toggleToc;window.goHome=function(){location.href='../'};
window.nextPage=nextPage;
window.prevPage=prevPage;
window.goPage=goPage;
window.loadBook=loadBook;
window.togglePanel=function(){
  var p=document.getElementById('sidePanel');
  p.classList.toggle('collapsed');
  document.getElementById('bPanel').classList.toggle('on');
  setTimeout(function(){if(_osd)_osd.viewport.goHome(true)},350);
};
window.switchPane=function(name){
  document.querySelectorAll('.sp-tab').forEach(function(t){t.classList.toggle('on',t.dataset.pane===name)});
  document.querySelectorAll('.sp-pane').forEach(function(p){p.classList.toggle('on',p.id==='pane-'+name)});
};
window.toggleSearch=function(){
  document.getElementById('searchOverlay').classList.toggle('on');
  document.getElementById('searchPanel').classList.toggle('on');
};
window.openSettings=function(){
  document.getElementById('setOverlay').classList.toggle('on');
  document.getElementById('setPanel').classList.toggle('on');
};
window.closeSettings=function(){
  document.getElementById('setOverlay').classList.remove('on');
  document.getElementById('setPanel').classList.remove('on');
};
window.setTheme=function(cls){
  document.body.className=cls;
  localStorage.setItem('coreader-theme',cls);
  document.querySelectorAll('.theme-btn').forEach(function(b){b.classList.toggle('on',b.dataset.theme===cls)});
};
window.applySetting=function(key,val){
  var el=document.getElementById('textContent');
  if(key==='font'&&el) el.style.fontFamily=val;
  if(key==='fs'){var v=parseInt(val);if(el) el.style.fontSize=v+'px';var sv=document.getElementById('setFsV');if(sv) sv.textContent=toFA(v)}
  if(key==='tw'){var tw=parseInt(val);var col=document.querySelector('.sp-content');if(col) col.style.maxWidth=tw+'px';var tv=document.getElementById('setTwV');if(tv) tv.textContent=toFA(tw)}
  if(key==='lh'){var lh=parseInt(val);if(el) el.style.lineHeight=(lh/10).toFixed(1);var lv=document.getElementById('setLhV');if(lv) lv.textContent=toFA(lh/10)}
  if(key==='fw'&&el) el.style.fontWeight=val;
  if(key==='fgColor'&&el) el.style.color=val;
  if(key==='hlColor') document.documentElement.style.setProperty('--hl-color',val);
  if(key==='hlOpacity') document.documentElement.style.setProperty('--hl-opacity',val);
  if(key==='hlGlow') document.documentElement.style.setProperty('--hl-glow',val);
  if(key==='hlSpeed') document.documentElement.style.setProperty('--hl-speed',val);
  if(key==='glassOpacity') document.documentElement.style.setProperty('--glass-bg','rgba(250,248,245,'+(val/100)+')');
  if(key==='magSize'){var ms=document.getElementById('setMagSizeV');if(ms) ms.textContent=toFA(val)}
  if(key==='magZoom'){var mz=document.getElementById('setMagZoomV');if(mz) mz.textContent=val+'×'}
  if(key==='autoTheme') document.documentElement.dataset.autoTheme=val;
};
window.applyTextSize=function(v){
  document.getElementById('setFsV').textContent=toFA(v);
  document.getElementById('textContent').style.fontSize=v+'px';
};

// === Progress ===
function updateProgress(){
  var progress={};
  try{progress=JSON.parse(localStorage.getItem('coreader-progress')||'{}')}catch(e){}
  progress[BOOK.slug]=_curPage;
  localStorage.setItem('coreader-progress',JSON.stringify(progress));
}

// === Theme ===
function loadTheme(){var t=localStorage.getItem('coreader-theme');if(t)document.body.className=t;document.querySelectorAll('.theme-btn').forEach(function(b){b.classList.toggle('on',b.dataset.theme===(document.body.className||''))})}


// === Context Menu for IIIF viewer ===
var ctxSel='',ctxRange=null,ctxAnnoEl=null;

document.addEventListener('contextmenu',function(e){
  var inImage=e.target.closest&&e.target.closest('.image-panel,#osd-container');
  var inText=e.target.closest&&e.target.closest('.text-content,.sp-pane');
  if(!inImage&&!inText) return;
  e.preventDefault();
  ctxSel=window.getSelection().toString().trim();
  var sel=window.getSelection();
  ctxRange=sel.rangeCount>0?sel.getRangeAt(0):null;
  ctxAnnoEl=e.target.closest('.anno');
  var ctx=document.getElementById('ctxMenu');
  ctx.style.left=Math.min(e.clientX,window.innerWidth-220)+'px';
  ctx.style.top=Math.min(e.clientY,window.innerHeight-380)+'px';
  ctx.setAttribute('data-open','true');
});
document.addEventListener('mousedown',function(e){
  var ctx=document.getElementById('ctxMenu');
  if(e.button!==2&&!ctx.contains(e.target)) ctx.setAttribute('data-open','false');
});

// === IIIF Text Storage (OCR text per page) ===
function loadIiifText(slug,pageNum){
  try{var texts=JSON.parse(localStorage.getItem("coreader-iiif-text-"+slug)||"{}");return texts[pageNum]||""}catch(e){return ""}
}
function saveIiifText(slug,pageNum,text){
  try{var texts=JSON.parse(localStorage.getItem("coreader-iiif-text-"+slug)||"{}");texts[pageNum]=text;localStorage.setItem("coreader-iiif-text-"+slug,JSON.stringify(texts))}catch(e){}
}
function renderText(){
  var el=document.getElementById("textPane");
  if(!el)return;
  if(!el)return;
  var text=loadIiifText(BOOK?BOOK.slug:"",_curPage);
  if(text){el.innerHTML="<div class=\"text-content\">"+text.replace(/\n/g,"<br>")+"</div>"}else{el.innerHTML="<div class=\"text-content empty-text\"><p style=\"color:var(--muted);text-align:center\">متنی موجود نیست</p><p style=\"color:var(--muted);font-size:12px;text-align:center\">برای افزودن متن، روی صفحه راست‌کلیک کنید → ویرایش متن</p></div>"}
}
function ctxEditTextIiif(){_closeCtx();if(!BOOK)return;
  var existing=loadIiifText(BOOK.slug,_curPage);
  var text=prompt("متن صفحهٔ "+toFA(_curPage)+":\n(برای افزودن متن OCR یا تایپ متن)",existing||"");
  if(text===null)return;
  saveIiifText(BOOK.slug,_curPage,text);
  renderText();
  _toast("متن ذخیره شد ✓")
}

// === Glossary Annotation ===
var _glossary=null;
function loadGlossary(){
  if(_glossary)return;
  fetch("/src/build/data/glossary.json").then(function(r){return r.json()}).then(function(g){_glossary=g}).catch(function(){})
}
function annotateGlossary(){
  if(!_glossary)return;
  var el=document.getElementById("textPane");
  if(!el)return;
  var textEl=el.querySelector(".text-content");
  if(!textEl)return;
  var text=textEl.textContent;
  var html=textEl.innerHTML;
  Object.keys(_glossary).forEach(function(word){
    var def=_glossary[word];
    if(typeof def==="string")def=def;
    else if(def.definition)def=def.definition;
    else def=JSON.stringify(def);
    var re=new RegExp("("+word.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+")","gi");
    html=html.replace(re,"<span class=\"anno anno-word\" data-cat=\"word\" data-text=\""+def.replace(/"/g,"&quot;")+"\">$1</span>")
  });
  textEl.innerHTML=html;
}

// === TOC ===
function toggleToc(){document.getElementById("tocPanel").classList.toggle("open")}
function renderIiifToc(manifest){
  var el=document.getElementById("tocList");
  if(!el)return;
  var ranges=manifest.structures&&manifest.structures[0]&&manifest.structures[0].ranges;
  if(!ranges||!ranges.length){el.innerHTML="<li style=\"color:var(--muted);font-size:13px;padding:16px\">فهرست موجود نیست</li>";return}
  // Fetch each range to get labels and page numbers
  var html="";
  var done=0;
  ranges.forEach(function(r,i){
    var url=typeof r==="string"?r:"";
    if(!url){done++;return}
    fetch(url).then(function(res){return res.json()}).then(function(data){
      var label=data.label||("بخش "+(i+1));
      if(typeof label==="object")label=label[0]&&label[0]["@value"]||JSON.stringify(label);
      var canvasIds=data.canvases||[];
      var pageNum=i+1;
      // Try to find page number from first canvas label
      if(canvasIds.length&&BOOK&&BOOK.pages){
        var firstCanvas=typeof canvasIds[0]==="string"?canvasIds[0]:canvasIds[0]["@id"]||"";
        // match canvas id to our page numbers
        if(BOOK.pages.length>0)pageNum=Math.min(i+1,BOOK.pages.length);
      }
      html+="<div class=\"toc-item\" onclick=\"goPage("+pageNum+")\" data-page=\""+pageNum+"\">"+label+"</div>";
      done++;
      if(done>=ranges.length){el.innerHTML=html||"<li style=\"color:var(--muted)\">خالی</li>"}
    }).catch(function(){done++;if(done>=ranges.length)el.innerHTML=html||"<li style=\"color:var(--muted)\">خطا</li>"})
  })
}

// === Annotation hover tooltip ===
var _annoTooltip=null;
document.addEventListener("mouseover",function(e){
  var anno=e.target.closest&&(e.target.closest(".anno")||e.target.closest(".anno-item"));
  if(!anno)return;
  var text=anno.dataset.text||"";
  var title=anno.dataset.title||"";
  var cat=anno.dataset.cat||"";
  if(!text&&!title)return;
  if(!_annoTooltip){_annoTooltip=document.createElement("div");_annoTooltip.className="anno-tooltip";document.body.appendChild(_annoTooltip)}
  _annoTooltip.innerHTML=(title?"<strong>"+title+"</strong><br>":"")+(cat?"<span class=\"at-cat\">"+cat+"</span> ":"")+text;
  _annoTooltip.style.display="block";
  var rect=anno.getBoundingClientRect();
  _annoTooltip.style.left=Math.min(rect.left,window.innerWidth-250)+"px";
  _annoTooltip.style.top=(rect.bottom+6)+"px";
});
document.addEventListener("mouseout",function(e){
  var anno=e.target.closest&&e.target.closest(".anno");
  if(anno&&_annoTooltip)_annoTooltip.style.display="none";
});

function _closeCtx(){document.getElementById('ctxMenu').setAttribute('data-open','false')}

function ctxAddAnno(){
  _closeCtx();
  if(!ctxSel){alert('ابتدا متن را انتخاب کنید');return}
  var title=prompt('عنوان حاشیه (اختیاری):')||'';
  var text=prompt('متن حاشیه:');
  if(!text) return;
  _annos.push({page:_curPage,text:text,title:title,selectedText:ctxSel,time:Date.now()});
  saveAnnos();renderAnnos();
}
function ctxEditAnno(){_closeCtx();if(!ctxSel){alert('ابتدا متن را انتخاب کنید');return}var ann=_annos.find(function(a){return a.selectedText===ctxSel});if(!ann){alert('حاشیه‌ای برای این متن یافت نشد');return}var title=prompt('عنوان جدید:',ann.title||'');if(title===null)return;var text=prompt('متن جدید:',ann.text||'');if(text===null)return;ann.title=title;ann.text=text;saveAnnos(BOOK.slug);renderAnnos();_toast('ویرایش شد ✓')}
function ctxDeleteAnno(){_closeCtx();if(!ctxSel){alert('ابتدا متن را انتخاب کنید');return}var idx=-1;_annos.forEach(function(a,i){if(a.selectedText===ctxSel)idx=i});if(idx<0){alert('حاشیه‌ای یافت نشد');return}if(!confirm('حذف حاشیه؟'))return;_annos.splice(idx,1);saveAnnos(BOOK.slug);renderAnnos();_toast('حذف شد ✓')}
function ctxEditText(){_closeCtx()}
function ctxAddNote(){_closeCtx();if(!ctxSel){alert('ابتدا متن را انتخاب کنید');return}
  var note=prompt('یادداشت شما:');if(!note)return;
  var notes=JSON.parse(localStorage.getItem('coreader-notes')||'[]');
  notes.push({text:ctxSel,note:note,page:_curPage,book:BOOK.title,time:Date.now()});
  localStorage.setItem('coreader-notes',JSON.stringify(notes));_toast('یادداشت ذخیره شد ✓')}
function ctxHighlight(){_closeCtx();if(!ctxSel||!ctxRange)return;
  var color=prompt('رنگ هایلایت:','#ffe08a')||'#ffe08a';
  var span=document.createElement('span');span.className='user-highlight';
  span.style.cssText='background:'+color+';border-radius:3px;padding:1px 2px;';
  try{ctxRange.surroundContents(span)}catch(e){}}
function ctxAddFavorite(){_closeCtx();if(!ctxSel){alert('ابتدا متن را انتخاب کنید');return}
  var favs=JSON.parse(localStorage.getItem('coreader-favs')||'[]');
  favs.push({text:ctxSel,page:_curPage,book:BOOK.title,time:Date.now()});
  localStorage.setItem('coreader-favs',JSON.stringify(favs));_toast('⭐ اضافه شد')}
function ctxBookmark(){_closeCtx();addBookmark('');_toast('🔖 نشانه ذخیره شد')}
function ctxCopyWithSource(){_closeCtx();if(!ctxSel){alert('ابتدا متن را انتخاب کنید');return}
  var src='— «'+BOOK.title+'» صفحهٔ '+toFA(_curPage);
  navigator.clipboard.writeText(ctxSel+'\n'+src).then(function(){_toast('کپی شد ✓')})}
function ctxShareAnno(){_closeCtx();if(!ctxSel)return;
  var text=ctxSel+'\n— «'+BOOK.title+'» صفحهٔ '+toFA(_curPage);
  if(navigator.share)navigator.share({title:BOOK.title,text:text});
  else navigator.clipboard.writeText(text).then(function(){_toast('کپی شد ✓')})}
function ctxSearchEnc(){_closeCtx();if(!ctxSel)return;
  window.open('https://en.wiktionary.org/wiki/'+encodeURIComponent(ctxSel.split(/\s+/)[0]),'_blank')}
function ctxToggleTashkil(){_closeCtx()}
function toggleTashkilBar(){}
function insertTashkil(ch){var sel=window.getSelection();if(!sel.rangeCount)return;
  var range=sel.getRangeAt(0);var node=document.createTextNode(ch);
  range.insertNode(node);range.setStartAfter(node);range.setEndAfter(node);
  sel.removeAllRanges();sel.addRange(range)}
function applyEditStyle(cmd,val){document.execCommand(cmd,false,val||null)}
function _toast(msg){var t=document.createElement('div');t.textContent=msg;
  t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:8px 20px;border-radius:8px;z-index:99999;font-size:14px';
  document.body.appendChild(t);setTimeout(function(){t.remove()},1500)}


// === Missing function stubs (from viewer.html) ===
window.toggleAnno=function(){document.getElementById('sidePanel').classList.toggle('collapsed')};
window.openPdfAt=function(pg){};
window.toggleMic=function(){};
window.toggleMagnifier=function(){
  _magOn=!_magOn;
  document.getElementById('bMag').classList.toggle('on',_magOn);
  var mag=document.getElementById('magnifier');
  if(_magOn){
    mag.style.display='block';
    // Ensure canvas size matches lens
    var canvas=document.getElementById('magCanvas');
    canvas.width=_magSize; canvas.height=_magSize;
    _initMagMouse();
  } else {
    mag.style.display='none';
  }
};
window.showFavPanel=function(){document.getElementById('favPanel').classList.toggle('on')};
window.exportLocalData=function(){var data={progress:localStorage.getItem('coreader-progress'),theme:localStorage.getItem('coreader-theme')};var blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='coreader-backup.json';a.click()};

// === OSD zoom controls ===
window.zoomIn=function(){if(_osd)_osd.viewport.zoomBy(1.3,true)};
window.zoomOut=function(){if(_osd)_osd.viewport.zoomBy(0.77,true)};
window.exportAnnotations=function(){var favs=JSON.parse(localStorage.getItem('coreader-favs')||'[]');var notes=JSON.parse(localStorage.getItem('coreader-notes')||'[]');var hl=JSON.parse(localStorage.getItem('coreader-highlights')||'[]');var bm=JSON.parse(localStorage.getItem('coreader-bookmarks')||'[]');var s=['# خروجی حاشیه‌نویسی‌ها',''];if(favs.length){s.push('## ⭐ علاقه‌مندی‌ها','');favs.forEach(function(f){s.push('- **'+f.book+'** صفحهٔ '+toFA(f.page),'  > '+f.text,'')})}if(notes.length){s.push('## 🗒️ یادداشت‌ها','');notes.forEach(function(n){s.push('- **'+n.book+'** صفحهٔ '+toFA(n.page),'  > '+n.text,'  📝 '+n.note,'')})}if(hl.length){s.push('## 🖍️ هایلایت‌ها','');hl.forEach(function(h){s.push('- **'+h.book+'** صفحهٔ '+toFA(h.page),'  > '+h.text,'')})}var blob=new Blob([s.join('\n')],{type:'text/markdown;charset=utf-8'});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='coreader-export.md';a.click()};
window.showFavTab=function(tab){document.querySelectorAll('.fav-tab').forEach(function(t){t.classList.toggle('on',t.textContent.indexOf(tab==='favs'?'علاقه':tab==='notes'?'یادداشت':tab==='highlights'?'هایلایت':'نشانه')>=0)});var list=JSON.parse(localStorage.getItem('coreader-'+tab==='favs'?'favs':tab==='notes'?'notes':tab==='highlights'?'highlights':'bookmarks')||'[]');var el=document.getElementById('favList');if(!list.length){el.innerHTML='<p style="color:var(--muted);font-size:13px;text-align:center">خالی</p>';return}el.innerHTML=list.map(function(f,i){return '<div style="padding:8px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;font-size:13px"><div style="color:var(--accent);font-size:11px">صفحهٔ '+toFA(f.page||1)+'</div><div>'+((f.text||f.note||'').substring(0,200))+'</div></div>'}).join('')};
window.closeEncPanel=function(){};

// Expose context menu functions to window
window.ctxAddAnno=ctxAddAnno;window.ctxEditAnno=ctxEditAnno;window.ctxDeleteAnno=ctxDeleteAnno;
window.ctxEditText=ctxEditText;window.ctxToggleTashkil=ctxToggleTashkil;window.applyEditStyle=applyEditStyle;
window.toggleTashkilBar=toggleTashkilBar;window.insertTashkil=insertTashkil;
window.ctxAddNote=ctxAddNote;window.ctxHighlight=ctxHighlight;window.ctxAddFavorite=ctxAddFavorite;
window.ctxCopyWithSource=ctxCopyWithSource;window.ctxBookmark=ctxBookmark;
window.ctxShareAnno=ctxShareAnno;window.ctxSearchEnc=ctxSearchEnc;window.ctxEditTextIiif=ctxEditTextIiif;window.annotateGlossary=annotateGlossary;window.loadGlossary=loadGlossary;

// === OSD Canvas Magnifier ===
function _initMagMouse(){
  if(_magMouseBound) return;
  _magMouseBound=true;
  var container=document.getElementById('imagePanel');
  var mag=document.getElementById('magnifier');
  var canvas=document.getElementById('magCanvas');
  var ctx=canvas.getContext('2d');
  canvas.width=_magSize; canvas.height=_magSize;

  container.addEventListener('mousemove',function(e){
    if(!_magOn||!_osd) return;
    // Find OSD canvas from DOM (more reliable than _osd.canvas)
    var osdCanvas=container.querySelector('canvas');
    if(!osdCanvas) return;
    // Position magnifier near cursor
    var panelRect=container.getBoundingClientRect();
    var cx=e.clientX-panelRect.left;
    var cy=e.clientY-panelRect.top;
    mag.style.left=Math.min(e.clientX+16, window.innerWidth-_magSize-8)+'px';
    mag.style.top=Math.min(e.clientY-_magSize-16, window.innerHeight-_magSize-8)+'px';
    // If above viewport, show below cursor
    if(mag.style.top.replace('px','')<0) mag.style.top=(e.clientY+16)+'px';

    // Get OSD canvas dimensions
    var canvasW=osdCanvas.width;
    var canvasH=osdCanvas.height;
    if(!canvasW||!canvasH) return;

    // Mouse position as fraction of container
    var fracX=cx/panelRect.width;
    var fracY=cy/panelRect.height;

    // Source region: _magSize/_magScale gives true zoom (e.g. 400/2.5=160px → 2.5x zoom)
    var srcW=_magSize/_magScale;
    var srcH=_magSize/_magScale;
    var srcX=fracX*canvasW-srcW/2;
    var srcY=fracY*canvasH-srcH/2;

    // Clamp to canvas bounds
    srcX=Math.max(0,Math.min(canvasW-srcW,srcX));
    srcY=Math.max(0,Math.min(canvasH-srcH,srcY));

    try{
      ctx.clearRect(0,0,_magSize,_magSize);
      ctx.imageSmoothingEnabled=true;
      ctx.imageSmoothingQuality='high';
      ctx.drawImage(osdCanvas, srcX,srcY,srcW,srcH, 0,0,_magSize,_magSize);
    }catch(ex){}
  });
}
var _magMouseBound=false;

// === Keyboard shortcuts ===
document.addEventListener('keydown',function(e){
  if(e.target&&(e.target.tagName==='INPUT'||e.target.isContentEditable))return;
  if(e.key==='ArrowLeft') nextPage();
  else if(e.key==='ArrowRight') prevPage();
  else if(e.key==='Escape'){closeSettings();document.getElementById('searchOverlay').classList.remove('on');document.getElementById('searchPanel').classList.remove('on');document.getElementById('ctxMenu').setAttribute('data-open','false')}
  else if(e.key===' '&&e.ctrlKey){e.preventDefault();toggleTtsPlay()}
  else if(e.key==='f'||e.key==='F') toggleSearch();
  else if(e.key==='m'||e.key==='M') toggleMagnifier();
  else if(e.key==='t'||e.key==='T') toggleToc();
});

document.addEventListener('DOMContentLoaded',init);
})();
