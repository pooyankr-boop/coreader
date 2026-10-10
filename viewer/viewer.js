// viewer.js — IIIF viewer engine
(function(){
'use strict';

var BOOK=null, _osd=null, _curPage=1, _rotating=0;
var _annos=[], _bookmarks=[], _bookmarks2=[], _rawManifest=null;
/* Page text for local books.  loadText assigns it in its fetch handler and
 * renderText, goPage, search and pageSpeechText all read it - but it was never
 * declared, so under 'use strict' every read threw ReferenceError.  That is
 * what turned a local book into the whole-page error screen and what made
 * reading a page with no OCR words die in pageSpeechText. */
var _texts=[];
var _ttsOn=false, _ttsVoice=null, _ttsUtterance=null;
var _ttsPlaying=false, _ttsEngine='browser', _ttsOffsets=[], _ttsStartIdx=0;
var _ttsAudio=null, _ttsChunks=[], _ttsChunkIdx=0, _ttsFellBack=false;
var _ttsVoices=[], _ttsLang='';
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
  // Load ganjoor text immediately (don't wait for manifest)
  preloadGanjoorText(slug);
  loadBook(slug);
}

// Preload ganjoor text in parallel with manifest fetch
var _preloadedGanjoor = null;
function preloadGanjoorText(slug){
  if(typeof loadGanjoorText !== 'function') return;
  loadGanjoorText(slug, function(){
    if(_ganjoor){
      _preloadedGanjoor = _ganjoor;
      console.log('[viewer] ganjoor preloaded:', _ganjoor.length, 'chapters');
      // Render immediately since we don't have BOOK yet
      if(document.getElementById('textContent')){
        renderGanjoorText();
      }
    }
  });
}

function loadBook(slug){
  // Try local book first
  fetch('../books/'+encodeURIComponent(slug)+'/book.json').then(function(r){
    if(r.ok) return r.json();
    return fetch('../books/'+encodeURIComponent(slug)+'/manifest.json?_='+Date.now()).then(function(r2){
      if(r2.ok) return r2.json().then(function(m){
        // Attach the books-index entry so externalLinks/manifestUrl survive
        // the direct-cache path (same as the index path below).
        return fetch('../books-index.json').then(function(r){return r.json()}).then(function(list){
          m._entry=list.find(function(b){return b.slug===slug})||null; return m;
        }).catch(function(){ return m; });
      });
      throw new Error('not-local');
    });
  }).catch(function(e){
    // For IIIF/custom books: fetch from books-index and resolve manifest
    return fetch('../books-index.json').then(function(r){return r.json()}).then(function(list){
      var custom=JSON.parse(localStorage.getItem('coreader-custom-books')||'[]');
      var all=list.concat(custom);
      var entry=all.find(function(b){return b.slug===slug});
      if(entry && entry.manifestUrl){
        // Proxy QDL/BL/LOC manifests through local server (Cloudflare blocks direct fetch)
        var manifestUrl = entry.manifestUrl;
        // 'books/...' is relative to site root; this page lives in /viewer/
        if(/^books\//.test(manifestUrl)) manifestUrl = '../' + manifestUrl;
        // Check if it's a direct image URL (jpg, png, etc.) — handle as single-image book
        var isDirectImage = /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(manifestUrl);
        // vam.ac.uk, framemark.vam.ac.uk and images.metmuseum.org all answer with
        // Access-Control-Allow-Origin: * (verified), so they fetch fine straight
        // from GitHub Pages — proxying them only produced 404s there.
        var needsProxy = /qdl\.qa|digirati\.io|loc\.gov|ids\.si\.edu|harvardartmuseums\.org|harvard\.edu|artic\.edu|collections\.yale\.edu/.test(manifestUrl);
        if(isDirectImage){
          // Route through proxy when the host blocks cross-origin fetch
          var imgSrc = needsProxy ? '/proxy-image?url=' + encodeURIComponent(manifestUrl) : manifestUrl;
          // Create a minimal book entry with the direct image
          return normalizeBook({
            source: 'iiif',
            title: entry.title || slug,
            pages: 1,
            items: [{num: 1, images: [{id: imgSrc, width: null, height: null}]}],
            _entry: entry
          }, slug);
        }
        var fetchUrl = needsProxy ? '/proxy-manifest?url=' + encodeURIComponent(manifestUrl) : manifestUrl;
        // Don't block - fetch with timeout
        return Promise.race([
          fetchManifest(fetchUrl).then(function(r){
            return r.json();
          }).then(function(data){data._entry=entry;return data;}),
          new Promise(function(_, reject){ setTimeout(function(){ reject(new Error('manifest timeout')); }, 15000); })
        ]).catch(function(){
          // If manifest fails, create a minimal book entry
          return { source: 'iiif', title: entry.title || slug, pages: entry.pages || 100, _entry: entry };
        });
      }
      throw new Error('Book not found');
    });
  }).then(function(data){
    BOOK=normalizeBook(data, slug);
    window.BOOK=BOOK; // export for ganjoor-text.js
    // Rewrite remote image URLs from WAF-blocked museum image servers
    // through the local proxy so <img>/OSD can load them.
    // Only hosts that actually refuse cross-origin reads belong here. vam.ac.uk,
    // framemark.vam.ac.uk and images.metmuseum.org send ACAO:*, and plain <img>
    // never needs CORS at all, so proxying them broke GitHub Pages for no gain.
    var IMG_PROXY_HOSTS=['si.edu','ids.lib.harvard.edu','nrs.harvard.edu','harvardartmuseums.org','www.artic.edu','images.collections.yale.edu'];
var IMAGE_PROXY_PATTERN=/https?:\/\/(?!localhost)/i;
    (BOOK.items||[]).forEach(function(it){
      (it.images||[]).forEach(function(im){
        if(!im.id) return;
        // Cached manifests may use relative image paths — resolve against
        // books/<slug>/.  '../' counts as already resolved: the direct-image
        // branch above rewrote manifestUrl to '../books/<file>.jpg', this test
        // did not recognise that as a path, a second '../books/<slug>/' got
        // prepended, and every library book came back 404.
        if(!/^https?:|^\/|^data:|^\.\.\//.test(im.id)){
          im.id='../books/'+encodeURIComponent(slug)+'/'+im.id;
        }
        for(var k=0;k<IMG_PROXY_HOSTS.length;k++){
          if(im.id.indexOf(IMG_PROXY_HOSTS[k])>=0 && im.id.indexOf('proxy-manifest')<0 && im.id.indexOf('proxy-image')<0){
            // Use /proxy-image for direct images, /proxy-manifest for manifest URLs
            im.id='/proxy-image?url='+encodeURIComponent(im.id);
            break;
          }
        }
      });
    });
        _rawManifest=data;
        setupOsd();
        renderMeta();
        renderIiifToc(data);
            // If ganjoor was preloaded, use it
            if(_preloadedGanjoor && !BOOK.hasText){
              _ganjoor = _preloadedGanjoor;
              BOOK.hasText = true;
              renderGanjoorText();
            }
            loadText(slug);
            setTimeout(annotateGlossary,500);
    loadAnnos(slug);
    loadBookmarks(slug);
    loadAllChanges();
    goPage(1);
    buildThumbStrip();
  }).catch(function(e){
    console.error('[viewer] loadBook failed:', e);
    document.body.innerHTML='<div style="text-align:center;padding:60px;color:#c0392b">خطا: '+escapeHtml(e.message)+'<br><a href="../">بازگشت</a></div>';
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
  'Local Reference':'مرجع محلی','Creator':'پدیدآور','Work title':'عنوان اثر','Published':'ناشر','Date':'تاریخ','Extent':'تعداد اوراق','Type':'نوع','Format':'قالب','Language':'زبان','Identifier':'شناسه',
  'Dimensions':'ابعاد','Media type':'نوع رسانه','Description':'توضیحات','Catalogue Identifier':'شناسهٔ فهرست',
  'Holding institution':'مؤسسهٔ نگهدارنده','Call number':'شمارهٔ تماس','URN':'ناشناس (URN)','Digital Object Identifier':'شناسهٔ دیجیتال (DOI)',
  'Digitised by':'دیجیتال‌سازی','Usage terms':'شرایط استفاده','RAQ_ID':'شناسهٔ RAQ','Link to catalogue record':'پیوند به فهرست',
  'Place':'مکان','Associated names':'نام‌های مرتبط','Physical description':'توصیف فیزیکی','Shelf mark':'شمارهٔ قفسه','Class mark':'شمارهٔ رده‌ای'
};
function translateMetaLabel(label){
  if(META_LABELS[label]) return META_LABELS[label];
  var lower=String(label).toLowerCase();
  for(var k in META_LABELS){ if(k.toLowerCase()===lower) return META_LABELS[k]; }
  return label;
}
// Normalize any IIIF metadata value shape to plain text
// "x" | ["x", {@value}] | [{en:["x"]}, ...] | {en:["x"]} | {@value}
function metaVal(v){
  if(v==null) return '';
  if(typeof v==='string') return v;
  if(typeof v==='number'||typeof v==='boolean') return String(v);
  if(Array.isArray(v)){
    if(!v.length) return '';
    // Array of multilingual alternatives for ONE value → pick preferred language
    var allLangMaps=v.every(function(x){return x&&typeof x==='object'&&!Array.isArray(x);});
    if(allLangMaps){
      // IIIF v2 multilingual: [{@language:"en",@value:"..."}, ...] → pick preferred language
      var isTranslated=v.some(function(x){return x['@language']!=null;});
      if(v[0]['@value']!=null && isTranslated){
        var plang=['en','fa','per','@en','@fa'];
        for(var a=0;a<plang.length;a++){
          for(var b=0;b<v.length;b++){
            if(v[b]['@language']===plang[a] && v[b]['@value']!=null) return String(v[b]['@value']);
          }
        }
        return String(v[0]['@value']||'');
      }
      // Language maps {en:["x"], de:["y"]} → pick preferred language
      var pref=['en','@en','fa','@fa','per','@per'];
      for(var i=0;i<v.length;i++){
        for(var j=0;j<pref.length;j++){
          if(v[i][pref[j]]!=null){ var p=metaVal(v[i][pref[j]]); if(p) return p; }
        }
      }
      // Untagged array of {@value} → separate values, join them
      if(v[0]['@value']!=null){
        var uj=[];for(var u=0;u<v.length;u++){var uv=String(v[u]['@value']||'');if(uv&&uj.indexOf(uv)<0)uj.push(uv);}return uj.join('؛ ');
      }
      return metaVal(v[0])||'';
    }
    // Array of separate values (notes, identifiers) → join all
    var parts=[];
    for(var k=0;k<v.length;k++){ var q=metaVal(v[k]); if(q && parts.indexOf(q)<0) parts.push(q); }
    return parts.join('؛ ');
  }
  if(v['@value']!=null) return String(v['@value']);
  return iiifLabel(v)||'';
}
function extractIiifMetadata(data){
  var meta=[];var seen={};
  if(data.metadata && data.metadata.length){
    data.metadata.forEach(function(m){
      var label=m.label||'';
      // Handle array-of-objects label (IIIF v2 multilingual)
      if(Array.isArray(label)){
        var en=label.find(function(l){return l['@language']==='en'});
        var fa=label.find(function(l){return l['@language']==='fa'||l['@language']==='per'});
        label=(en||fa||label[0]||{})['@value']||'';
      }
      // Handle language-map label (IIIF v3: {en:["..."]})
      if(label && typeof label==='object') label=iiifLabel(label);
      var val=metaVal(m.value);
      // Strip HTML tags for display
      if(typeof val==='string') val=val.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#?\w+;/g,'').trim();
      if(!label || !val || val==='') return;
      // Merge rows sharing the same label (notes/identifiers repeat)
      var lk=String(label).toLowerCase();
      if(seen[lk]!=null){ meta[seen[lk]].value+='؛ '+val; }
      else { seen[lk]=meta.length; meta.push({label:translateMetaLabel(label),rawLabel:label,value:val}); }
    });
  }
  return meta;
}
// Normalize any IIIF label shape to plain text
// "x" | ["x"] | [{@language,@value}] | {en:["x"]} | {@en:["x"]}
function iiifLabel(v){
  if(v==null) return '';
  if(typeof v==='string') return v;
  if(Array.isArray(v)){
    if(!v.length) return '';
    if(typeof v[0]==='string') return v.join(' ');
    if(v[0] && v[0]['@value']) return v.map(function(x){return x&&x['@value']||''}).join(' ').trim();
    return iiifLabel(v[0]);
  }
  if(typeof v==='object'){
    var pref=['en','@en','fa','@fa','per','@per'],i;
    for(i=0;i<pref.length;i++){ if(Array.isArray(v[pref[i]]) && v[pref[i]].length) return iiifLabel(v[pref[i]]); }
    var keys=Object.keys(v);
    for(i=0;i<keys.length;i++){ if(Array.isArray(v[keys[i]]) && v[keys[i]].length) return iiifLabel(v[keys[i]]); }
    if(v['@value']) return String(v['@value']);
    return '';
  }
  return String(v);
}
/* Manifest-level resources the info panel did not show at all.
 *
 * A IIIF manifest may carry `homepage`, `rendering` and `seeAlso`, each an
 * object or an array of them, in v2 (@id) or v3 (id) shape.  archive.org is
 * the extreme case: an 18-entry `rendering` list holding the PDF, the
 * animated GIF and the OCR text, plus a `seeAlso` list of metadata dumps.
 * The panel used to show four hard-coded viewers and dropped all of it, so
 * a bierah book looked empty next to a foreign viewer.  Collect it once, in
 * one shape, so the panel and the split view can both ask for it.
 *
 * `rendering` and `seeAlso` are kept apart on purpose: rendering is a
 * different *representation* of the book (an image, a PDF, plain text) and is
 * the part worth showing inside the site, while seeAlso is a related resource
 * (a metadata dump, a torrent) that has no in-site viewer. */
function linkVal(v){ return (v && (v.id || v['@id'])) || ''; }
function linkList(v){
  if(!v) return [];
  var arr = Array.isArray(v) ? v : [v];
  var out = [];
  arr.forEach(function(x){
    if(!x) return;
    var url = linkVal(x);
    if(!url || !/^https?:\/\//.test(url)) return;   // a relative path has no outside viewer
    out.push({
      url: url,
      label: iiifLabel(x.label) || url.split('/').pop(),
      format: x.format || ''
    });
  });
  return out;
}

/* Which representations can the site actually show beside the image?
 *
 * `format` decides this, not the file name: a PDF and an animated GIF both
 * render in a browser frame, but a .torrent or a .gz does not.  Anything we
 * cannot embed gets listed as a plain link instead - which is what the request
 * asked for, rather than a broken embed or a silent drop. */
var IN_SITE_TYPES=[
  {key:'pdf',    mime:/pdf/i,                 label:'PDF'},
  {key:'gif',    mime:/gif|video/i,           label:'ویدیو / GIF'},
  // text/plain only: text/html is a web page (an art museum's "Full record"
  // link), not this book's text, and putting it in the text column would show
  // an unrelated site where the page's own words belong.
  // text/plain here is archive.org's whole-book OCR dump (3.5MB, no page
  // breaks), so it gets its own kind and its own column: it is not this page's
  // text and must not be shown as if it were.
  {key:'textfile', mime:/^text\/plain/i,      label:'متن کتاب'},
  {key:'image',  mime:/^image\/(?!vnd\.djvu)/i, label:'تصویر'}
];
function renderingKind(r){
  var f=r.format||'';
  for(var i=0;i<IN_SITE_TYPES.length;i++){
    if(IN_SITE_TYPES[i].mime.test(f)) return IN_SITE_TYPES[i].key;
  }
  return '';
}
/* The whole-book plain-text rendition, for pages whose own OCR annotation is
 * empty.  archive.org's `*_djvu.txt` has no page separator at all (verified: no
 * form feed, no control characters), so it cannot be cut into pages and must
 * never be presented as though it were this page's words.  It is offered once,
 * in the panel, as a separate column. */
function textRendering(){
  var list=(BOOK&&BOOK.renderingLinks)||[];
  for(var i=0;i<list.length;i++){
    if(/^text\/plain/i.test(list[i].format||'')) return list[i];
  }
  return null;
}

// Can this page carry its own text?  A canvas whose annotation URL is present
// but empty (front matter, blank leaves) counts as no: this book has three such
// pages, and the reader must be told "no text on this page", not shown nothing.
function pageTextUrl(){
  var it=BOOK && BOOK.items && BOOK.items[_curPage-1];
  return (it && it.textUrl) || '';
}

/* Where the text column should look, in order of what is actually trustworthy:
 *   1. the canvas's own OCR annotation,
 *   2. a local book that already had its text,
 *   3. nothing - and say so.
 * The whole-book text file is deliberately not in this list: it cannot be
 * aligned to a page, and putting 3.5MB of book text under one page image is
 * worse than an honest "no text on this page". */
function loadPageText(){
  if(!BOOK) return;
  if(typeof _ganjoor!=='undefined' && _ganjoor) return;
  if(BOOK.hasText && _texts.length) return;
  if(BOOK.localPages && BOOK.localPages.length) return;
  if(BOOK.source!=='iiif') return;

  var host=document.getElementById('textContent');
  if(!host) return;
  var want=_curPage;
  var url=pageTextUrl();
  // No annotation for this page: the column will say so.  The whole-book
  // plain text is deliberately not fetched here - it has no page separator, so
  // it cannot be cut to this page, and it is offered separately in the panel.
  if(!url) return;

  fetchPageText(url).then(function(res){
    if(want!==_curPage) return;
    // res is {txt, words}: one request feeds both the text column and the
    // image highlight, so the two can never disagree about the page's words.
    _iiifPageText=(res.txt && res.txt.trim()) ? res.txt : '';
    ptAdoptWords(want, res.words);
    renderText();
  }).catch(function(){
    // A failed fetch must not blank a page that already rendered text.
    // Marking the page as settled also stops the read-aloud wait in
    // ttsAwait() from polling for words that never arrive.
    var T=window.__coreaderText;
    if(T && T.state) T.state.wordsPage=want;
    if(want===_curPage && !host.innerText.trim()) host.innerHTML=splitMsg('دریافت متن ممکن نشد');
  });
}

function normalizeBook(data, slug){
  var entry=data._entry||null;
  // Handle both book.json (local) and manifest.json (IIIF)
  var b={slug:slug, title:(entry&&entry.title)||iiifLabel(data.label)||iiifLabel(data.title)||slug, author:(entry&&entry.author)||'', pages:0, items:[], chapters:[], hasText:false, source:'local', iiifMeta:[], isMuseum:!!(entry&&entry.source==='museum')};
  // Copy externalLinks from books-index entry
  if(entry && entry.externalLinks) b.externalLinks=entry.externalLinks;
  else if(entry && entry.manifestUrl) b.externalLinks={iiifManifest:entry.manifestUrl};
  if(entry && entry.manifestUrl) b.manifestUrl=entry.manifestUrl;
  // Reconstruct remote manifest URL from raw IIIF manifest @id (for cached books missing iiifManifest)
  if(data && data['@id'] && /^https?:\/\//.test(data['@id']) && !b.externalLinks.iiifManifest){
    b.externalLinks = b.externalLinks || {};
    b.externalLinks.iiifManifest = data['@id'];
    b.manifestUrl = data['@id'];
  }
  // Detect IIIF manifest by presence of items/sequences/@context
  if(data['@context'] && data['@context'].indexOf('iiif')>=0){
    b.source='iiif';
  } else if(data.items || data.sequences){
    b.source='iiif';
  }
  if(data.author) b.author=b.author||iiifLabel(data.author);
  if(data.summary) b.summary=iiifLabel(data.summary);
  if(data.provider && data.provider[0]){
    b.provider=iiifLabel(data.provider[0].label);
  }
  // Copy language from books-index entry so TTS/STT can use it
  if(entry && entry.language) b.language = entry.language;
  // Extract IIIF metadata
  if(b.source==='iiif'){
    b.iiifMeta=extractIiifMetadata(data);
    b.homepageLinks=linkList(data.homepage);
    b.renderingLinks=linkList(data.rendering);
    b.seeAlsoLinks=linkList(data.seeAlso);
    // Use IIIF metadata for author if not set
    if(!b.author){
      var authorMeta=b.iiifMeta.find(function(m){return m.rawLabel==='Author'});
      if(authorMeta) b.author=authorMeta.value;
    }
    // Use description as summary
    if(data.date && !b.date){
      var dl=iiifLabel(data.date);
      if(dl) b.date=dl;
    }
    if(data.description && !b.summary){
      b.summary=typeof data.description==='string'?data.description:(Array.isArray(data.description)?data.description.join(' '):iiifLabel(data.description));
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
      // Handle both annotation-based and direct image items
      var imgs = [];
      if(item.items){
        item.items.forEach(function(body){
          if(body.items){
            body.items.forEach(function(anno){
              if(anno.body){
                var bdy = Array.isArray(anno.body) ? anno.body : [anno.body];
                bdy.forEach(function(bodyItem){
                  if(bodyItem.type === 'Image'){
                    imgs.push(bodyItem);
                  } else if(bodyItem['@type'] === 'Image'){
                    imgs.push(bodyItem);
                  } else if(bodyItem.resource && bodyItem.resource.type === 'Image'){
                    imgs.push(bodyItem.resource);
                  }
                });
              }
            });
          }
        });
      }
      // Also handle items[].images array (our simplified format)
      if(item.images && item.images.length){
        item.images.forEach(function(img){
          imgs.push(img);
        });
      }
      /* The canvas points at its own OCR text (archive.org ships one
       * AnnotationPage per page).  Keeping the URL here means the side text
       * pane fetches exactly the page on screen - no page-number guessing and
       * no need to download the whole book. */
      var annoUrl = item.annotations && item.annotations[0] && (item.annotations[0].id || item.annotations[0]['@id']);
      return {num: item.num || i+1, canvasId: item.id || item.canvasId || 'canvas'+i, images: imgs, textUrl: annoUrl || ''};
    });
    b.pages=b.items.length;
  }
  // IIIF manifest v2 (sequences[0].canvases)
  if(data.sequences && data.sequences[0] && data.sequences[0].canvases){
      var canvases=data.sequences[0].canvases;
      b.items=canvases.map(function(c,i){
        var page={num:i+1, canvasId:c['@id']||c.id, images:[], label:c.label||''};
        if(c.images){
          c.images.forEach(function(anno){
            var res=anno.resource||anno.body;
            if(res){
              var imgObj={id:res['@id']||res.id, service:res.service, width:res.width, height:res.height};
              page.images.push(imgObj);
            }
          });
        }
        return page;
      });
      b.pages=b.items.length;
  }
  // Local book format
  if(data.pages && data.pages.length){
    b.pages=data.pages.length;
    b.localPages=data.pages;
    b.hasText=true;
    // Generate tile source from pdf or simple image
    b.items=data.pages.map(function(p,i){
      return {num:p.page||i+1, localHtml:p.html||p.text||''};
    });
  }
  // Simple direct-image format (single image)
  else if(data.items && data.items.length && data.items[0].images && data.items[0].images[0].id){
    b.pages = data.pages || data.items.length;
    b.items = data.items.map(function(item, i){
      var imgs = item.images.map(function(img){
        return {id: img.id, width: img.width, height: img.height, service: img.service};
      });
      return {num: item.num || i+1, canvasId: item.canvasId || 'img'+i, images: imgs};
    });
  }
  // Chapters
  if(data.chapters) b.chapters=data.chapters;
  delete data._entry;
  return b;
}

// === OpenSeadragon ===
// QDL (iiif.qdl.qa, behind Cloudflare) intermittently refuses large CORS
// image requests: measured 0/8 and 21/36 success at full/full (1.6 MB)
// under load, but 8/8 and 35/36 at full/1200, and 12/12 with 3 retries.
// So: percent-encode the raw space in the URL, fetch it ourselves with
// retries, and hand OSD a same-origin blob URL. OSD never re-fetches, so
// its CORS draw always succeeds. ponytail: the blob holds the whole page in
// memory (a 4800x6900 jpeg ~1.6 MB) — switch to a size-capped IIIF request
// (`/full/2400,`) if a 1208-page book ever opens many pages at once.
function loadImageRetry(url, attempts, cb){
  var n=0;
  (function attempt(){
    var im=new Image();
    im.crossOrigin='anonymous';
    im.onload=function(){
      if(!im.naturalWidth){ return setTimeout(attempt, 400); }
      cb(im);
    };
    im.onerror=function(){
      if(++n>=attempts){ cb(null); return; }
      setTimeout(attempt, 400*n);
    };
    im.src=url;
  })();
}
function toBlobUrl(im, cb){
  try{
    var c=document.createElement('canvas');
    c.width=im.naturalWidth; c.height=im.naturalHeight;
    c.getContext('2d').drawImage(im,0,0);
    if(c.toBlob){ c.toBlob(function(b){ cb(b?URL.createObjectURL(b):null); }, 'image/jpeg', 0.92); }
    else cb(null);
  }catch(e){ cb(null); }
}

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
    rtl:true,
    crossOriginPolicy:'Anonymous',
    ajaxWithCredentials:false,
    timeout:120000,
    imageLoaderLimit:6,
    tileRetryMax:3,
    tileRetryDelay:2000
  };
  // OpenSeadragon IIIF: pass info.json URL directly
  if(tileSource.type==='iiif'){
    osdOpts.tileSources=tileSource.infoUrl;
  } else if(tileSource.type==='image' && tileSource.url && !/^data:/.test(tileSource.url)){
    // Retry ourselves and hand OSD a blob: same-origin, so its canvas draw
    // can never be blocked by the remote host's CORS headers.
    loadImageRetry(tileSource.url, 3, function(im){
      if(!im){
        container.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted)">تصویر قابل بارگذاری نیست</div>';
        return;
      }
      var w=im.naturalWidth, h=im.naturalHeight;
      toBlobUrl(im, function(blobUrl){
        if(!blobUrl){
          osdOpts.tileSources={type:'image', url:tileSource.url, width:w, height:h};
        } else {
          osdOpts.tileSources={type:'image', url:blobUrl, width:w, height:h};
        }
        _osd=OpenSeadragon(osdOpts); osdBindHighlight();
      });
    });
    return;
  } else if(tileSource.type==='image' && tileSource.width && tileSource.height){
    osdOpts.tileSources={type:'image', url:tileSource.url, width:tileSource.width, height:tileSource.height};
  } else if(tileSource.type==='image'){
    // Unknown dimensions — measure via Image() first, otherwise OSD
    // guesses the tile source type and fails ("Unable to load TileSource").
    var probe=new Image();
    probe.onload=function(){
      osdOpts.tileSources={type:'image', url:tileSource.url, width:probe.naturalWidth, height:probe.naturalHeight};
      _osd=OpenSeadragon(osdOpts); osdBindHighlight();
    };
    probe.onerror=function(){
      container.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted)">تصویر قابل بارگذاری نیست</div>';
    };
    probe.src=tileSource.url;
    return;
  } else {
    osdOpts.tileSources=tileSource.url;
  }
  _osd=OpenSeadragon(osdOpts); osdBindHighlight();
  osdBindHighlight();
}

/* Hook a freshly built OpenSeadragon up to the highlight layer.
 *
 * OSD is constructed in three places (blob URL, probed dimensions, plain source),
 * so the handlers live in one function that each of them calls: attaching them at
 * only one construction site left the other two images unable to zoom a highlight.
 * 'animation' covers zoom, pan and rotation in one event, and 'open' covers the
 * page whose image arrives after the words do. */
function osdBindHighlight(){
  if(!_osd || _osd.__hlBound) return;
  _osd.__hlBound=true;
  _osd.addHandler('animation', function(){ hlPaint(); });
  _osd.addHandler('open', function(){ hlPaint(); hlMarkText(); });
}

function getTileSource(item){
  if(item.images && item.images.length){
    var img=item.images[0];
    // Hosts that block cross-origin info.json (Cloudflare / no CORS):
        // fall through to the direct image URL.
            var BLOCKED_HOSTS=['www.artic.edu','harvardartmuseums.org','metmuseum.org','ids.si.edu'];
    // Check service at top level or in resource
    var svc=img.service;
    if(!svc && img.resource) svc=img.resource.service;
    if(svc){
      if(Array.isArray(svc)) svc=svc[0];
      var svcId=svc && (svc['@id']||svc.id);
      if(svcId){
        var blocked=false;
        try{blocked=BLOCKED_HOSTS.indexOf(new URL(svcId).hostname)>=0;}catch(e){}
        if(!blocked){
          return {type:'iiif', infoUrl:svcId.replace(/\/$/,'')+'/info.json', baseUrl:svcId};
        }
      }
    }
    // Image URL: check item.images[0].id, or resource.@id
    var imgUrl=img.id || img['@id'];
    var w=img.width, h=img.height;
    if(img.resource && img.resource['@id']){
      imgUrl=img.resource['@id'];
      w=w||img.resource.width;
      h=h||img.resource.height;
    }
    if(imgUrl){
                  // For direct images without known dimensions, return without size info
                  // so setupOsd will probe via Image() element
                  // QDL filenames contain a literal space ("Add MS 23570_0001.jp2");
                  // percent-encode it so the URL is well-formed for fetch()/OSD.
                  // Never encode our own /proxy-image?url=... — encodeURI escapes the
                  // '%' of an already-encoded query string, the proxy then receives a
                  // still-encoded URL, and new URL() throws and kills serve.js.
                                    // encodeURI re-escapes the '%' of a URL that is already
                                    // percent-encoded - Wikimedia, the Internet Archive and most
                                    // IIIF image servers all send them that way - so %2C became
                                    // %252C, the host answered 404, and the plate never loaded.
                                    // Escape only what is neither unreserved, reserved, nor
                                    // already an escape: a literal space still needs it (QDL
                                    // file names have them), an existing %2C does not.
                                    if(imgUrl.indexOf('/proxy-image?url=')<0){
                                      imgUrl=imgUrl.replace(/[^A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]/g,
                                        function(ch){ return encodeURIComponent(ch); });
                                    }
                                    return {type:'image', url:imgUrl, width:null, height:null};
            }
  }
  // Also check item.num for label
  return {type:'image',url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" fill="#f0ebe3"><text x="200" y="300" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#8c8577">صفحه '+item.num+'</text></svg>')};
}

// Open a plain-image page the same way setupOsd does for page 1: fetch with
// retries, hand OSD a same-origin blob. Going straight to _osd.open(url) left
// QDL pages past page 1 fetched-but-never-painted, so the view froze on page 1.
function openImagePage(ts, container){
  loadImageRetry(ts.url, 3, function(im){
    if(!im){
      if(container) container.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted)">تصویر قابل بارگذاری نیست</div>';
      return;
    }
    var w=im.naturalWidth, h=im.naturalHeight;
    toBlobUrl(im, function(blobUrl){
      _osd.open(blobUrl?{type:'image', url:blobUrl, width:w, height:h}
                :{type:'image', url:ts.url, width:w, height:h});
    });
  });
}
function goToPageImage(pageIdx){
  if(!_osd || !BOOK.items[pageIdx]) return;
  var item=BOOK.items[pageIdx];
  var ts=getTileSource(item);
  if(ts.type==='iiif'){
    _osd.open(ts.infoUrl);
  } else if(ts.type==='image' && ts.width && ts.height){
    // Pass tile source object with dimensions for OSD to render correctly
    _osd.open({type:'image', url:ts.url, width:ts.width, height:ts.height});
  } else if(ts.type==='image' && !/^data:/.test(ts.url)){
    openImagePage(ts, document.getElementById('osd-container'));
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
    return !!(item.images[0].id); // QDL: direct image URL
  });
  if(!hasThumbs) return;
  var strip=document.createElement('div');
  strip.className='thumb-strip';
  strip.id='thumbStrip';
  BOOK.items.forEach(function(item,i){
    var thumbUrl='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="80" fill="#f0ebe3"><text x="30" y="45" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#8c8577">'+(i+1)+'</text></svg>');
    if(item.images&&item.images.length){
      var svc=item.images[0].service;
      if(svc){
        if(Array.isArray(svc))svc=svc[0];
        var svcId=svc&&((svc['@id'])||svc.id);
        if(svcId) thumbUrl=svcId+'/full/60,/0/default.jpg';
      } else if(item.images[0].id){
        // QDL: replace /full/full/ with /full/60,/ for thumbnail
        thumbUrl=item.images[0].id.replace(/\/full\/full\//,'/full/60,/');
      }
    }
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
  window._curPage=n;
  document.getElementById('pgInput').value=n;
    document.getElementById('pgTotal').textContent='از '+toFA(BOOK.pages);
  goToPageImage(n-1);
  if(_ganjoor && typeof renderGanjoorChunk === 'function') {
    // If this page has a chunk, show it. Otherwise keep the ganjoor text view.
    var chunk = typeof getChunkForPage === 'function' ? getChunkForPage(n) : null;
    if (chunk) { renderGanjoorChunk(n); }
    // else: keep whatever ganjoor text was last rendered (don't overwrite with renderText)
  } else if(_ganjoor) {
    // ganjoor loaded but full rendering not available — show inline fallback
    _fallbackRenderGanjoorText();
  } else {
    renderText();
  }
  renderAnnos();
  updateProgress();
  /* Fetch this page's text whenever the text is on screen *somewhere* - not
   * only when the compare column is open.
   *
   * Without the first branch the book opens on a page whose text was never
   * requested: the reader saw "متن صفحه موجود نیست" until they turned a page,
   * which is the bug this was reported as.  A reader-facing text node exists
   * for every book, so page 1 must fetch its own text like any other page. */
  if(BOOK && BOOK.source==='iiif' && !(typeof _ganjoor!=='undefined' && _ganjoor)
     && !(BOOK.hasText && _texts.length) && !(BOOK.localPages && BOOK.localPages.length)
     && pageTextUrl()){
    _iiifPageText=null;
    loadPageText();
  }
}
function nextPage(){goPage(_curPage+1)}
function prevPage(){goPage(_curPage-1)}
function toFA(n){return String(n).replace(/[0-9]/g,function(d){return '۰۱۲۳۴۵۶۷۸۹'[d]})}

// === Ganjoor inline fallback (works even if ganjoor-text.js fails to load) ===
function _fallbackRenderGanjoorText(){
  var el=document.getElementById('textContent');
  if(!el||!_ganjoor||!_ganjoor.length) return;
  try{
    var ch=_ganjoor[0], poem=ch.poems[0];
    var h='<div class="g-chapters">';
    _ganjoor.forEach(function(c,i){h+='<button class="g-ch-btn'+(i===0?' on':'')+'">'+c.chapter+'</button>';});
    h+='</div><div class="g-poems">';
    ch.poems.forEach(function(p,i){
      var label=p.id==='dibache'?'دیباچه':'حکایت '+(i+1);
      h+='<button class="g-poem-btn'+(i===0?' on':'')+'">'+label+'</button>';
    });
    h+='</div><div class="g-text">';
    poem.lines.forEach(function(line){
      h+='<div class="g-line">'+line+'</div>';
    });
    h+='</div>';
    el.innerHTML=h;
    console.log('[viewer] inline ganjoor rendered:',el.innerHTML.length,'chars');
  }catch(e){console.error('[viewer] inline render error:',e);}
}
// === Text ===
function loadText(slug){
  // Try ganjoor text first for IIIF books
  if(BOOK && BOOK.source === 'iiif'){
    if(typeof loadGanjoorText === 'function'){
      loadGanjoorText(slug, function(){
        if(_ganjoor){
          BOOK.hasText = true;
          renderGanjoorText();
        } else {
          BOOK.hasText = false;
          renderText();
        }
      });
    } else {
      // Fallback: load ganjoor text inline (external file didn't load)
      var url = '../books/' + encodeURIComponent(slug) + '/ganjoor_golestan.json?_=' + Date.now();
      fetch(url).then(function(r){
        if(!r.ok) throw new Error('HTTP '+r.status);
        return r.json();
      }).then(function(d){
        console.log('[viewer] ganjoor fallback loaded', d.length, 'chapters');
        _ganjoor = d;
        if(typeof buildPageMap === 'function') buildPageMap();
        BOOK.hasText = true;
        if(typeof renderGanjoorText === 'function') renderGanjoorText();
        else _fallbackRenderGanjoorText();
      }).catch(function(e){
        console.error('[viewer] ganjoor fallback failed:', e);
        BOOK.hasText = false;
        renderText();
      });
    }
    return;
  }
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

// OCR text fetched for the page on screen.  Kept apart from _texts so a local
// or ganjoor book is never disturbed by it.
var _iiifPageText=null;

function renderText(){
  var el=document.getElementById('textContent');
  if(typeof _ganjoor!=='undefined' && _ganjoor) return; // ganjoor handles its own text
  // OCR for the page on screen: its own annotation first, then the book's
  // single plain-text rendition when there is no per-page split.
  if(BOOK.source==='iiif' && _iiifPageText!=null){
    var got=_iiifPageText;
    var words=(window.__coreaderText&&window.__coreaderText.state.words)||[];
    el.innerHTML = got && got.trim()
      ? '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">صفحهٔ '+toFA(_curPage)+'</div>'+
        (words.length?splitWordsHtml(words):splitTextHtml(got))
      : noPageTextHtml();
    hlMarkText();
    return;
  }
  if(!BOOK.hasText || !_texts.length){
    // An IIIF book reaches here on its very first render, before the page's own
    // annotation has arrived.  Say what is true right now - this page is being
    // read - instead of the flat "no text" the reader used to land on.
    el.innerHTML = (BOOK.source==='iiif' && pageTextUrl())
      ? noPageTextHtml(true)
      : '<p style="color:var(--muted);font-size:13px;text-align:center">متن صفحه موجود نیست</p>';
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
  if(BOOK.language) rows+='<div class="meta-row"><span class="label">زبان:</span> <span class="value">'+BOOK.language+'</span></div>';
  if(BOOK.date) rows+='<div class="meta-row"><span class="label">تاریخ:</span> <span class="value">'+BOOK.date+'</span></div>';
  // For museum books, also show secondary links from seeAlso ( provenance, collections )
  if(BOOK.isMuseum && BOOK.seeAlsoLinks && BOOK.seeAlsoLinks.length){
    rows+='<div style="margin-top:12px">';
    rows+='<h3 style="font-size:12px;color:var(--muted);margin-bottom:6px">منابع و مجموعه‌ها</h3>';
    rows+='<ul style="list-style:none;padding:0;margin:0">';
    BOOK.seeAlsoLinks.forEach(function(r){
      rows+='<li class="mv-link-row"><a href="'+r.url+'" target="_blank" rel="noopener">'+r.label+'</a></li>';
    });
    rows+='</ul></div>';
  }
  rows+='<div class="meta-row"><span class="label">تعداد صفحات:</span> <span class="value">'+toFA(BOOK.pages)+'</span></div>';
  // Show all IIIF metadata
  if(BOOK.iiifMeta && BOOK.iiifMeta.length){
    rows+='<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">';
    rows+='<h3 style="font-size:13px;color:var(--accent);margin-bottom:8px">'+(BOOK.isMuseum?'اطلاعات شیء موزه‌ای':'اطلاعات نسخهٔ خطی')+'</h3>';
    BOOK.iiifMeta.forEach(function(m){
      if(m.rawLabel==='Title'||m.rawLabel==='Homepage'||m.rawLabel==='Catalogue Description') return;
      rows+='<div class="meta-row"><span class="label">'+m.label+':</span> <span class="value" style="font-size:12px">'+m.value+'</span></div>';
    });
    rows+='</div>';
  }
  /* The manifest's own resources.
   *
   * This block used to hard-code four foreign viewers and print the manifest
   * JSON link, so a book whose manifest lists a PDF, an animated GIF and the
   * OCR text - which is every archive.org book here - showed none of it.  The
   * manifest already carries the links; the panel just has to read them.
   *
   * Split by what the site can do with each one:
   *   - viewable here (image / PDF / text / GIF) get a button that opens the
   *     side-by-side compare window,
   *   - everything else falls through to a plain link list at the bottom,
   *     which is where a torrent or a metadata dump belongs.
   */
  var elinks=BOOK.externalLinks||{};
  var absManifest=BOOK.manifestUrl||'';
  // Resolve an absolute manifest URL for third-party viewers:
  // local 'books/...' cache path -> remote iiifManifest link when available
  var remoteManifest=elinks.iiifManifest||'';
  if(/^books\//.test(absManifest) && remoteManifest) absManifest=remoteManifest;

  var viewable=(BOOK.renderingLinks||[]).filter(function(r){ return renderingKind(r); });
  var otherLinks=(BOOK.renderingLinks||[]).filter(function(r){ return !renderingKind(r); });

  /* ---- view inside the site ---- */
  if(viewable.length){
    rows+='<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">';
    rows+='<h3 style="font-size:13px;color:var(--accent);margin-bottom:8px">نمایش در سایت</h3>';
    rows+='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">';
    viewable.forEach(function(r,i){
      rows+='<button class="mv-chip" onclick="openSplitView(\''+renderingKind(r)+'\',\''+r.url.replace(/'/g,'%27')+'\')">'+r.label+'</button>';
    });
    rows+='</div>';
    // The compare window: 2 or 3 resizable columns beside the image.
    rows+='<div class="mv-split-opts">';
    rows+='<button class="mv-mode" onclick="setSplitLayout(2)">دو بخش: عکس + متن</button>';
    rows+='<button class="mv-mode" onclick="setSplitLayout(3)">سه بخش: عکس + PDF + متن</button>';
    rows+='</div>';
    // Text beside the image, when this book has page text at all.
    if(hasPageText()){
      rows+='<button class="mv-mode mv-primary" onclick="toggleSplitPane(\'text\')">نمایش متن کنار عکس</button>';
    }
    rows+='</div>';
  }

  /* ---- the resource lists ---- */
  function linkListBlock(title, list, note){
    if(!list || !list.length) return;
    rows+='<div style="margin-top:12px">';
    rows+='<h3 style="font-size:12px;color:var(--muted);margin-bottom:6px">'+title+'</h3>';
    if(note) rows+='<div style="font-size:11px;color:var(--muted);margin-bottom:6px">'+note+'</div>';
    rows+='<ul style="list-style:none;padding:0;margin:0">';
    list.forEach(function(r){
      rows+='<li class="mv-link-row"><a href="'+r.url+'" target="_blank" rel="noopener">'+r.label+'</a>'+
            (r.format?'<span class="mv-fmt">'+r.format+'</span>':'')+'</li>';
    });
    rows+='</ul></div>';
  }
  linkListBlock('صفحهٔ منبع', BOOK.homepageLinks);
  linkListBlock('قالب‌های دیگر', otherLinks, 'این قالب‌ها درون سایت نمایش داده نمی‌شوند؛ برای دیدنشان باز کنید:');
  linkListBlock('منابع مرتبط', BOOK.seeAlsoLinks);

  /* ---- third-party viewers: kept, because a foreign IIIF viewer is still
     the fastest way to read a book the local pipeline cannot open ---- */
  if(remoteManifest || /^https?:\/\//.test(absManifest)){
    var mv=remoteManifest||absManifest;
    var enc=encodeURIComponent(mv);
    var isMuseum=(BOOK.source==='museum');
    rows+='<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">';
    rows+='<h3 style="font-size:13px;color:var(--accent);margin-bottom:8px">نمایش در ویوورهای دیگر</h3>';
    if(elinks.digitalObject) rows+='<div class="meta-row"><a href="'+elinks.digitalObject+'" target="_blank" rel="noopener" style="font-size:12px">شیء دیجیتال (سایت مجموعه)</a></div>';
    rows+='<div class="meta-row"><a href="https://projectmirador.org/manifests/'+enc+'" target="_blank" rel="noopener" style="font-size:12px">نمایش در Mirador</a></div>';
    rows+='<div class="meta-row"><a href="https://universalviewer.io/manifests/'+enc+'" target="_blank" rel="noopener" style="font-size:12px">نمایش در Universal Viewer</a></div>';
    rows+='<div class="meta-row"><a href="https://triiiceratops.org/viewer/?iiif-content='+enc+'" target="_blank" rel="noopener" style="font-size:12px">کتاب‌خوان Triiiceratops</a></div>';
    rows+='<div class="meta-row"><a href="https://tify.rocks/?manifest='+enc+'" target="_blank" rel="noopener" style="font-size:12px">نمایش در TIFY</a></div>';
    rows+='<div class="meta-row"><a href="https://samvera-labs.github.io/clover-iiif/docs/viewer/demo?iiif-content='+enc+'" target="_blank" rel="noopener" style="font-size:12px">نمایش در Clover</a></div>';
    if(!isMuseum) rows+='<div class="meta-row"><a href="https://hadro.github.io/flipbook/?manifest='+enc+'" target="_blank" rel="noopener" style="font-size:12px">مشاهده در Flipbook</a></div>';
    rows+='<div class="meta-row"><a href="'+mv+'" target="_blank" rel="noopener" style="font-size:12px">مانیفست IIIF (JSON)</a></div>';
    rows+='</div>';
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

/* === Side-by-side compare window ===
 *
 * The text tab used to live in the side panel, so reading a page meant looking
 * away from it.  The request: the text sits *beside* the image in a window the
 * reader can drag between 2 and 3 columns, and a book with text opens its text
 * the same way an image opens.
 *
 * Everything here is one column per `kind` in the SPLIT state, resized by
 * pointer drag on the divider, so "two columns" and "three columns" are the
 * same code with a different column list rather than two layouts to keep in
 * sync.  Page text comes from the canvas's own OCR annotation (one fetch per
 * page, already in the manifest), which is why no OCR guesswork is needed.
 */

// Which kinds are available for this book, in the order they make sense:
// image first (always on screen), then text, then the document renditions.
var _split = { on:false, cols:[], kinds:{}, home:null };

/* Is there any text for this book, in any of the three shapes the site has?
 *   - ganjoor: the linear books, whose text ganjoor-text.js renders,
 *   - local / IIIF with its own texts: what renderText() already serves,
 *   - IIIF with a plain-text rendition or per-canvas OCR annotations.
 * Getting this wrong in either direction is user-visible: too strict and the
 * compare button cannot open the text of a book that has text; too loose and it
 * opens an empty column on a museum plate. */
function hasPageText(){
  if(!BOOK) return false;
  if(typeof _ganjoor!=='undefined' && _ganjoor) return true;
  if(BOOK.hasText && _texts.length) return true;
  if(BOOK.localPages && BOOK.localPages.length) return true;
  if(textRendering()) return true;
  return !!(BOOK.items && BOOK.items.some(function(it){ return it.textUrl; }));
}

window.openSplitView=function(kind,url){
  _split.kinds[kind]=url;
  // Keep at most two extra columns beside the viewer: the reader picks the
  // second one from the panel, and the viewer itself is always the first
  // section, so "three sections" means viewer + text + one rendition.
  var want=['text'];
  if(kind!=='text' && want.indexOf(kind)<0) want.push(kind);
  _split.cols=want.filter(function(k){ return k!=='text'||hasPageText(); });
  _split.on=_split.cols.length>0;
  renderSplit();
};

window.setSplitLayout=function(n){
  // n=2 -> viewer + text, n=3 -> viewer + text + one document rendition.
  var cols=['text'];
  var doc=null;
  ['pdf','gif','image','textfile'].some(function(k){ if(!doc && _split.kinds[k]) doc=k; });
  if(n===3 && doc) cols.push(doc);
  _split.cols=cols.filter(function(k){ return k!=='text'||hasPageText(); });
  _split.on=_split.cols.length>0;
  renderSplit();
};

// The text column is a toggle, so the toolbar button and the panel button are
// the same action.
window.toggleSplitPane=function(kind){
  if(kind!=='text') return;
  var at=_split.cols.indexOf('text');
  if(at>=0) _split.cols.splice(at,1);
  else {
    // Nothing to show: say so in the panel instead of opening an empty column.
    if(!hasPageText()) return;
    _split.cols.unshift('text');
  }
  _split.on=_split.cols.length>0;
  renderSplit();
};

// Render the whole compare window.  Called on open, on layout change and on
// page change, so there is exactly one place that decides what the columns are.
function renderSplit(){
  var host=document.getElementById('splitWrap');
  if(!host) return;
  if(!_split.on || !_split.cols.length){
    // Never innerHTML='' while #pane-text is in here: it was *moved* out of the
    // side panel, and wiping the host would destroy the node that renderText()
    // and ganjoor-text.js both write into - the text would then be gone for
    // good, including for local books that never asked for a compare window.
    restoreTextPane();
    host.innerHTML='';
    host.dataset.sig='';
    host.classList.remove('on');
    if(_osd) setTimeout(function(){_osd.viewport.goHome(true)},60);
    return;
  }
  host.classList.add('on');

  var panesArr=_split.cols.map(function(k){
    return '<div class="split-pane" data-kind="'+k+'">'+splitHead(k)+'<div class="split-body" id="splitBody_'+k+'"></div></div>';
  });
  // RTL lays the wrap's children right-to-left: the FIRST child sits at the
  // side panel, the LAST child at the image.  So the column dividers go
  // BETWEEN their panes and div0 (the image/column boundary) goes LAST.
  // Concatenating "all dividers + all panes" parked both handles in one strip
  // against the side panel, where no boundary exists, and left both real
  // pane boundaries without a handle.
  var html='';
  for(var i=0;i<panesArr.length;i++){
    if(i>0) html+='<div class="split-divider" data-gap="'+i+'"></div>';
    html+=panesArr[i];
  }
  html+='<div class="split-divider" data-gap="0"></div>';

  // Rebuilding innerHTML would orphan the moved node, so only rebuild when the
  // column list actually changed; otherwise just refill the existing columns.
  var sig=_split.cols.join(',');
  if(host.dataset.sig!==sig){
    restoreTextPane();
    host.innerHTML=html;
    host.dataset.sig=sig;
    bindSplitDividers();
  }
  _split.cols.forEach(function(k){ splitFill(k); });
  if(_osd) setTimeout(function(){_osd.viewport.goHome(true)},60);
}

// Put #pane-text back where it started.  _split.home is recorded on the first
// move so the node returns to the same pane it came from.
function restoreTextPane(){
  var pane=document.getElementById('pane-text');
  if(pane && _split.home && pane.parentNode!==_split.home){
    _split.home.appendChild(pane);
    pane.classList.remove('on');
    pane.style.display='';
  }
}

function splitHead(k){
  var names={text:'متن صفحه',textfile:'متن کتاب',pdf:'PDF',gif:'ویدیو / GIF',image:'تصویر'};
  var title=names[k]||k;
  // Both buttons: open the rendition on its own, and take the column away.
  // Without the second one a column opened by mistake could only be closed by
  // opening something else over it.
  var right='<button class="split-x" onclick="closeSplitCol(\''+k+'\')" title="بستن این بخش">✕</button>';
  if(k!=='text'){
    right+='<a class="split-x" href="'+_split.kinds[k]+'" target="_blank" rel="noopener" title="باز کردن کامل">↗</a>';
  }

  return '<div class="split-head"><span>'+title+'</span><span class="split-tools">'+right+'</span></div>';
}

// Drop one column.  The text column has its own toolbar toggle, so it shares
// that action to keep the two in step.
window.closeSplitCol=function(kind){
  var at=_split.cols.indexOf(kind);
  if(at<0) return;
  if(kind==='text') return toggleSplitPane('text');
  _split.cols.splice(at,1);
  _split.on=_split.cols.length>0;
  renderSplit();
};

// Fill one non-image column.  The image column is the existing OSD canvas, so
// 'image' here only labels it.
function splitFill(kind){
  var el=document.getElementById('splitBody_'+kind);
  if(!el) return;
  if(kind==='text') return fillTextColumn(el);
  var u=_split.kinds[kind];
  if(kind==='pdf'){
    el.innerHTML='<iframe class="split-frame" src="'+u+'" title="PDF"></iframe>';
  } else if(kind==='textfile'){
    // A .txt cannot be framed, and a 3.5MB file should not be fetched by a
    // page turn: link to it and let the reader open it deliberately.
    el.innerHTML=splitMsg('این فایل متن کل کتاب است و صفحه‌به‌صفحه نیست'+
      '<br><a class="split-x" href="'+u+'" target="_blank" rel="noopener" style="display:inline-block;margin-top:8px">باز کردن متن کامل</a>');
  } else if(kind==='gif' || kind==='image'){
    el.innerHTML='<img class="split-img" src="'+u+'" alt="">';
  } else {
    el.innerHTML=splitMsg('این قالب درون سایت نمایش داده نمی‌شود');
  }
}

/* The text column.
 *
 * It hosts the *existing* #pane-text node, moved rather than copied.  That node
 * is what renderText() writes into and what ganjoor-text.js (725 lines of
 * verse mapping, TTS and side-margin cards) expects to find under
 * #textContent - a second copy would give the reader two texts and break every
 * one of those lookups.  Moving it keeps all of it working unchanged.
 *
 * A book whose pages carry their own OCR gets that text written into the same
 * node, so switching pages reuses renderText()'s path instead of a parallel one.
 */
function fillTextColumn(el){
  var pane=document.getElementById('pane-text');
  if(pane){
    if(!_split.home) _split.home=pane.parentNode;   // remember where it came from
    el.innerHTML='';
    el.appendChild(pane);          // moves it
    pane.classList.remove('on');    // its own .sp-pane{display:none} would hide it here
    pane.style.display='block';
    loadPageText();
    return;
  }
  // No pane to move (defensive): fall back to fetching straight into the column.
  var url=pageTextUrl();
  if(!url){ el.innerHTML=splitMsg('برای این اثر متنی موجود نیست'); return; }
  el.innerHTML=splitMsg('در حال دریافت متن…');
  var want=_curPage;
  fetchPageText(url).then(function(txt){
    if(want!==_curPage) return;
    el.innerHTML=txt?splitTextHtml(txt):splitMsg('متن این صفحه خالی است');
  }).catch(function(){ if(want===_curPage) el.innerHTML=splitMsg('دریافت متن ممکن نشد'); });
}

// Put the page's OCR text into #textContent, but only when this book has no
// text of its own already there.
//
// The three shapes that already own #textContent are ganjoor (211k characters
// of a linear-script book, rendered by ganjoor-text.js) and a local book with
// `texts`.  Writing an "no text" message into that node would destroy what was
// already there, which is exactly what happened before this guard: opening the
// compare window on the Golestan blanked it.

function splitMsg(t){ return '<div class="split-msg">'+t+'</div>'; }

/* Why the text column is empty.
 * Three different reasons look identical if you only print "no text": the
 * annotation has not arrived, this page genuinely has no words (front matter,
 * blank leaves - three of them in this volume), or the book has no per-page text
 * at all.  The reader can act on the first and the third, so say which. */
function noPageTextHtml(loading){
  var hasUrl=!!pageTextUrl();
  if(loading) return '<div style="color:var(--muted);font-size:12px;text-align:center;padding:14px">در حال دریافت متن صفحه…</div>';
  if(hasUrl) return '<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:18px 12px;line-height:2">'+
    'این صفحه متنی ندارد<br><span style="font-size:11px;opacity:.75">صفحات آغازین یا برگهٔ سفید</span></div>';
  return '<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:18px 12px;line-height:2">'+
    'متن این اثر صفحه‌به‌صفحه موجود نیست<br>'+
    '<span style="font-size:11px;opacity:.75">برای متن کامل، فایل متنی یا PDF را از پنل اطلاعات باز کنید</span></div>';
}

// Archive.org OCR is a run of double-spaced words with no punctuation runs and
// hard-wrapped lines.  Presenting it verbatim is unreadable, so it is
// re-flowed: paragraphs on blank lines, joined lines within a paragraph, and
// single spaces.  No wording is changed - only whitespace.
function splitTextHtml(txt){
  var paras=String(txt).replace(/\r/g,'').split(/\n[ \t]*\n+/);
  var html='';
  paras.forEach(function(p){
    var line=p.replace(/\n/g,' ').replace(/\s{2,}/g,' ').trim();
    // dir=auto, because this OCR is usually Latin script sitting in an RTL
    // column: without it every line starts past the left edge and reads as
    // one clipped word per row.  It also keeps Persian OCR correct.
    if(line) html+='<p dir="auto">'+escapeHtml(line)+'</p>';
  });
  return html || splitMsg('متنی یافت نشد');
}

/* Render the page's words as spans, so a search hit can be marked by index in
 * the text exactly where it is boxed on the image.  The plain-text fallback is
 * kept for a page whose annotation had no words at all. */
function splitWordsHtml(words){
  if(!words || !words.length) return '';
  var hits={};
  var T=window.__coreaderText;
  if(T && T.state.query){
    (T.state.hits||[]).forEach(function(i){ hits[i]=1; });
  }
  var html='';
  words.forEach(function(w,i){
    var t=escapeHtml(w.t);
    html+='<span class="pt-w'+(hits[i]?' sr-hit':'')+'" data-pt-word="'+i+'">'+t+'</span> ';
  });
  return '<p dir="auto" class="pt-words">'+html+'</p>';
}

function lsJSON(k,d){try{var v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}}
// Manifest fetch: direct first, then the local proxy. A host that is not on
// the needsProxy list can still refuse a cross-origin read, and without the
// fallback the book simply never opens.
function fetchManifest(u){
  if(location.protocol === 'file:' || u.indexOf('/proxy-manifest') === 0) return fetch(u);
  var abs;
  try { abs = new URL(u, location.href).href; } catch(e) { abs = u; }
  return fetch(u).then(function(r){
    if(!r.ok) throw new Error('manifest fetch failed: ' + r.status);
    return r;
  }).catch(function(){
    return fetch('/proxy-manifest?url=' + encodeURIComponent(abs));
  });
}
function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fetchPageText(url){
  var T=window.__coreaderText;
  return fetch(url).then(function(r){
    if(!r.ok) throw new Error('text '+r.status);
    return r.json();
  }).then(function(d){
    var out=[];
    (d.items||[]).forEach(function(a){
      var b=a.body;
      if(!b) return;
      var parts=Array.isArray(b)?b:[b];
      parts.forEach(function(x){
        var v=x.value || x['@value'] || '';
        if(typeof v==='string' && v.trim()) out.push(v.trim());
      });
    });
    var words=T ? T.ptWordsFromAnnotation(d) : [];
    return {txt:out.join('\n\n'), words:words};
  });
}

/* Hand this page's words to the shared engine, and repaint the highlight.
 * Called on every page change, so the boxes always belong to the page shown. */
function ptAdoptWords(pageNo, words){
  var T=window.__coreaderText;
  if(!T) return;
  T.state.words=words||[];
  // Which page these words belong to. Without it a reader arriving on the next
  // canvas cannot tell "the annotation for this page is still in flight" from
  // "this page has no text", and would skip pages that do have text.
  T.state.wordsPage=pageNo;
  T.state.hitPages=_searchPages;
  // The mic aligns against this word list, so it has to follow the page too -
  // otherwise it would keep matching yesterday's vocabulary and jump nowhere.
  var voice=window.__coreaderVoice;
  if(voice){
    voice.setWords(T.state.words);
    // The mic host carries the recognition language; refresh it per page so
    // line-following listens in the language the current page is written in.
    var lg=detectLanguage((T.state.words||[]).map(function(w){return w.t;}).join(' '));
    voice.mount(micHost(lg));
    if(voice.state && voice.state.mic && voice.state.rec){
      try{ voice.state.rec.lang=lg; }catch(e){}
    }
  }
  if(T.state.query) T.ptApply();
  // hlPaint creates the layer on first use, so it is called unconditionally:
  // guarding on _hlLayer meant the very first page never drew a box, because
  // nothing had created the layer yet.
  hlPaint();
}

// Pointer drag on a divider.  The dragged column gets an explicit percentage
// and its neighbour absorbs the rest, so the row never overflows.  OSD is
// re-fitted on every step because the viewer pane changes width underneath it.
// Pointer drag on a divider.  The first divider moves the boundary between the
// viewer and the column group (the wrap's own flex-basis); any later divider
// moves the boundary between two columns.  The moved side is the one the reader
// drags toward, so the percentage is measured from the drag point rather than
// from the pane that happens to sit on a given side.
function bindSplitDividers(){
  var host=document.getElementById('splitWrap');
  if(!host) return;
  Array.prototype.forEach.call(host.querySelectorAll('.split-divider'), function(div){
    var gap=parseInt(div.dataset.gap,10);
    div.addEventListener('mousedown', function(e){
      e.preventDefault();
      var panes=host.querySelectorAll('.split-pane');
      // gap 0: the wrap.  gap n: panes[n-1] and panes[n].
      var moved = gap===0 ? host : panes[gap-1];
      if(!moved) return;
      // Measure both gaps against the wrap's RIGHT edge: in RTL the wrap is
      // packed against the fixed side panel, so that edge never moves while
      // the dragged boundary does.  gap 0 resizes the wrap inside the row
      // (denominator = row width), gap n resizes a pane inside the wrap
      // (denominator = wrap width) - one numerator, two denominators.
      var row=host.parentNode.getBoundingClientRect();
      var hostBox=host.getBoundingClientRect();
      var hostR=hostBox.right, hostW=hostBox.width;
      document.body.style.cursor='col-resize';
      document.body.style.userSelect='none';
      function move(ev){
        var pct=(hostR-ev.clientX)/(gap===0?row.width:hostW)*100;
        pct=Math.max(20,Math.min(80,pct));
        moved.style.flex='0 0 '+pct+'%';
        moved.style.maxWidth='none';
        if(_osd) _osd.viewport.goHome(true);
      }
      function up(){
        document.removeEventListener('mousemove',move);
        document.removeEventListener('mouseup',up);
        document.body.style.cursor='';
        document.body.style.userSelect='';
        if(_osd) _osd.viewport.goHome(true);
      }
      document.addEventListener('mousemove',move);
      document.addEventListener('mouseup',up);
    });
  });
}

// === Annotations ===
function loadAnnos(slug){
  try{_annos=JSON.parse(localStorage.getItem('coreader-anno-'+slug)||'[]')}catch(e){_annos=[]}
  window._annos=_annos;
}
function saveAnnos(slug){
  localStorage.setItem('coreader-anno-'+BOOK.slug,JSON.stringify(_annos));
}
function renderAnnos(){
  var el=document.getElementById('annoList');
  var pageAnnos=_annos.filter(function(a){return a.page===_curPage});
  if(!pageAnnos.length){el.innerHTML='<li style="color:var(--muted);font-size:13px;text-align:center;padding:16px">هنوز حاشیه‌ای ثبت نشده</li>';return}
  el.innerHTML=pageAnnos.map(function(a,i){
    return '<li class="anno-item"><div class="anno-head"><span class="anno-page">صفحهٔ '+toFA(a.page)+'</span><span class="anno-del" onclick="delAnnotation('+i+')">✕</span></div><div>'+escapeHtml(a.text)+'</div></li>';
  }).join('');
}
window.addAnnotation=function(){
  var input=document.getElementById('annoInput');
  var text=input.value.trim();
  if(!text) return;
  _annos.push({page:_curPage,text:text,time:Date.now()});
  window._annos=_annos; saveAnnos(); input.value=''; renderAnnos();
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
    return '<div class="bm-item" onclick="goPage('+bm.page+')"><span>صفحهٔ '+toFA(bm.page)+(bm.label?' — '+escapeHtml(bm.label):'')+'</span><span class="bm-del" onclick="event.stopPropagation();delBookmark('+i+')">✕</span></div>';
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
/* Search across the whole book.
 *
 * This used to scan _texts, which is always empty for a live IIIF book:
 * loadText() returns early for those and leaves BOOK.hasText false, so the
 * search button did nothing at all on exactly the books that have OCR - the
 * silent no-op this was reported as.  The index now comes from the per-canvas
 * annotations, which are the same fetch the text column already uses.
 *
 * A book with no annotations anywhere (the 9 bierah volumes with a locally
 * cached manifest) says so plainly instead of pretending it searched. */
var _searchPages=[], _searchIdxBuilding=false;

window.doSearch=function(){
  var el=document.getElementById('searchResults');
  var input=document.getElementById('searchInput');
  var q=(input?input.value:'').trim();
  var T=window.__coreaderText;
  if(!q){el.innerHTML='';_searchPages=[];return}
  if(!T){
    el.innerHTML='<p style="color:var(--muted);font-size:13px">موتور جستجو بارگذاری نشد</p>';
    return;
  }
  if(!hasSearchableText()){
    el.innerHTML=_noTextMsg();
    return;
  }
  // No index yet: build it, then search.  Progress is shown because the
  // whole-book fetch is real network work and a silent wait reads as broken.
  if(!T.state.index && !_searchIdxBuilding){
    _searchIdxBuilding=true;
    el.innerHTML='<p style="color:var(--muted);font-size:13px">در حال آماده‌سازی نمایهٔ جستجو…</p>';
    T.ptEnsureIndex().then(function(idx){
      _searchIdxBuilding=false;
      // An empty index is not "your search found nothing" - it is "this volume
      // has no OCR".  Saying otherwise sends the user off to retype the query.
      if(idx && !Object.keys(idx).length){
        el.innerHTML=_noTextMsg();
        return;
      }
      renderSearchResults(q);
    });
    return;
  }
  renderSearchResults(q);
};

// The page on screen is searched even before the index is finished, so the
// first keystroke on a freshly opened book is not silently wrong.
function renderSearchResults(q){
  var el=document.getElementById('searchResults');
  var T=window.__coreaderText;
  var pages=T.ptSearch(q);
  _searchPages=pages;
  T.state.hitPages=pages;
  T.ptSetQuery(q);
  if(!pages.length){
    el.innerHTML='<p style="color:var(--muted);font-size:13px">نتیجه‌ای یافت نشد</p>';
    return;
  }
  var html=pages.slice(0,80).map(function(pg){
    return '<div class="search-result" onclick="goPage('+pg+')">'+
      '<span class="sr-page">صفحهٔ '+toFA(pg)+'</span></div>';
  }).join('');
  var more=pages.length>80?'<p style="color:var(--muted);font-size:12px;padding:6px 8px">'+
    toFA(pages.length-80)+' نتیجهٔ دیگر</p>':'';
  el.innerHTML='<div style="padding:4px 8px;color:var(--muted);font-size:12px">'+
    toFA(pages.length)+' صفحه</div>'+html+more;
}

/* Does this book have any per-page OCR at all?
 * Checked before promising a search, so the honest answer is the one shown. */
/* The honest answer for a volume with no OCR layer.
 *
 * Two different things land here and they must not read the same: a painting
 * has no text by nature, while a text volume whose OCR is missing or broken
 * upstream is missing data we expected.  The second one is worth saying out
 * loud, because "no results" would blame the reader's spelling. */
function _noTextMsg(){
  var isPainting = !!(BOOK && (BOOK.pages || 0) <= 3 &&
    !BOOK.hasText && !(BOOK.items && BOOK.items.some(function(it){ return it.textUrl; })));
  return '<p style="color:var(--muted);font-size:13px;line-height:1.9">'+
    'متن این کتاب قابل جست‌وجو نیست.<br>'+
    '<span style="font-size:12px;opacity:.8">'+
    (isPainting
      ? 'این اثر تصویری است و لایهٔ متنی ندارد.'
      : 'لایهٔ متنِ صفحه‌به‌صفحه در این نسخه موجود نیست.')+
    '</span></p>';
}

function hasSearchableText(){
  if(!BOOK) return false;
  if(BOOK.hasText && _texts.length) return true;
  if(typeof _ganjoor!=='undefined' && _ganjoor) return true;
  return !!(BOOK.items && BOOK.items.some(function(it){ return it.textUrl; }));
}

/* Exposed for the test harness only.
 *
 * viewer.js is one IIFE, so nothing inside it can be reached or driven from a
 * test: the checks could observe the rendered DOM but never the values that
 * produced it, which is how a highlight that painted nothing looked identical to
 * one that painted correctly.  ponytail: replace this with a proper module once
 * the viewer has more than one page that needs these; until then a single
 * read-only handle is smaller than splitting the file up. */
window.__coreaderViewer = { paint: hlPaint, project: hlProject, layer: hlEnsureLayer,
  osd: function(){ return _osd; },
  // how many pages the last search matched, so a check can tell an empty
  // result from a book with no text without reading the message
  searchPages: function(){ return _searchPages.length; } };

/* === Highlight: one hit, drawn on the image and in the text ===
 *
 * The OCR word list carries each word's box in image pixels, so a hit is drawn
 * with OpenSeadragon's own overlay in viewport coordinates - it stays glued to
 * the scan through zoom, pan and rotation, which a CSS box over the canvas
 * cannot do.  The text column gets a <mark> on the same word index, so the two
 * are two views of one fact rather than two independent searches.
 */
var _hlLayer=null, _hlActive=-1;

function hlEnsureLayer(){
  var c=document.getElementById('osd-container');
  if(!c) return null;
  if(!_hlLayer){
    _hlLayer=document.createElement('div');
    _hlLayer.className='ocr-hl-layer';
    _hlLayer.id='ocrHlLayer';
    c.appendChild(_hlLayer);
  }
  return _hlLayer;
}

/* Project a word box from image pixels to on-screen pixels.
 *
 * Goes through the viewport rather than the tile source, so zoom and rotation
 * are applied exactly once - by OSD, which owns the transform.
 *
 * Two steps, because in OpenSeadragon 4.1.1 imageToViewerElementCoordinates
 * returns a rect whose x and y are both null for every input tried (a plain Rect,
 * a bare object, and one from imageToViewportRectangle).  Measured in the browser
 * against a 2350x3673 page: imageToViewportRectangle returned a usable rect while
 * the viewer-element step did not.  So the conversion is composed by hand from
 * the two working halves instead, and the result is scaled by the container size
 * rather than by OSD's own pixelRatio handling.
 *
 * ponytail: this is a workaround for one library version, not a general
 * coordinate system.  Drop it when OSD is upgraded and the single call works. */
function hlProject(box){
  if(!_osd || !_osd.viewport) return null;
  var vp;
  try {
    vp=_osd.viewport.imageToViewportRectangle(
      new OpenSeadragon.Rect(box.x, box.y, box.w, box.h));
  } catch(e){ return null; }
  if(!vp || !isFinite(vp.x) || !isFinite(vp.y)) return null;
  // Viewport units span the world box, so the scale from viewport to pixels is
  // container width over the visible bounds' width.  getBounds(true) is the
  // visible region in viewport units and getContainerSize the element the boxes
  // live in; there is no getContentBounds in this version.
  var size=_osd.viewport.getContainerSize();
  var bounds=_osd.viewport.getBounds(true);
  if(!size || !size.x || !bounds || !bounds.width) return null;
  var scale=size.x/bounds.width;
  return {x:vp.x*scale, y:vp.y*scale, w:vp.width*scale, h:vp.height*scale};
}
/* Repaint every hit box.
 *
 * Called on page change, after a new search, and from OSD's animation handler -
 * a box positioned in image pixels must follow zoom and rotation, and OSD's
 * animation frame is the only signal that fires for both.  It is cheap because
 * the box list is rebuilt only when the viewport has actually changed.
 *
 * ponytail: repainting every animation frame would be the obvious design; the
 * guard below makes it cheap enough instead, because a 500-word page would
 * otherwise rebuild its box list 60 times a second while zooming. */
function hlPaint(){
  var layer=hlEnsureLayer();
  var T=window.__coreaderText;
  if(!layer || !T) return;
  var words=T.state.words||[], hits=T.state.hits||[];
  if(!hits.length){ layer.innerHTML=''; return; }
  // Only the viewport is required: imageToViewerElementCoordinates converts from
  // image pixels using the current transform alone.  Requiring a loaded world
  // item as well meant the boxes stayed invisible whenever the paint happened
  // before OSD finished opening the tile source - which is the common case, since
  // the OCR text arrives faster than the image.
  if(!_osd || !_osd.viewport) return;
  var host=document.getElementById('osd-container');
  var out='';
  hits.forEach(function(i,ord){
    var box=words[i];
    if(!box || box.x==null) return;          // word has no box: text-only
    var p=hlProject(box);
    if(!p || p.w<1) return;
    out+='<div class="ocr-hl'+(ord===T.state.hitIndex?' on':'')+'" style="left:'+
      p.x+'px;top:'+p.y+'px;width:'+p.w+'px;height:'+p.h+'px"></div>';
  });
  layer.innerHTML=out;
}

// Step through hits; page turns when the next hit is on another page.
window.nextHit=function(){
  var T=window.__coreaderText;
  if(!T) return;
  var pages=_searchPages;
  if(!pages || !pages.length) return;
  var cur=window._curPage||1;
  var at=pages.indexOf(cur);
  var next=at<0?0:(at+1)%pages.length;
  window.goPage(pages[next]);
  _searchCur=pages[next];
  syncHitOnPage();
};
window.prevHit=function(){
  var T=window.__coreaderText;
  if(!T) return;
  var pages=_searchPages;
  if(!pages || !pages.length) return;
  var cur=window._curPage||1;
  var at=pages.indexOf(cur);
  var next=at<0?pages.length-1:(at-1+pages.length)%pages.length;
  window.goPage(pages[next]);
  syncHitOnPage();
};
var _searchCur=0;

// After a page turn the page's own words are loaded; pick the hit on this page
// and let the text column scroll to it.
function syncHitOnPage(){
  var T=window.__coreaderText;
  if(!T) return;
  setTimeout(function(){
    T.ptApply();
    hlPaint();
    hlMarkText();
  }, 260);
}

// Mark the matching word in the text column and bring it into view.
function hlMarkText(){
  var host=document.getElementById('textContent');
  var T=window.__coreaderText;
  if(!host || !T) return;
  var marks=host.querySelectorAll('mark.sr-hit');
  Array.prototype.forEach.call(marks,function(m){ m.classList.remove('sr-hit'); });
  var words=T.state.words||[], hits=T.state.hits||[];
  if(!hits.length) return;
  hits.forEach(function(i){
    var w=host.querySelector('[data-pt-word="'+i+'"]');
    if(w){
      w.classList.add('sr-hit');
      if(i===hits[T.state.hitIndex]) w.classList.add('sr-hit-on');
    }
  });
  var first=host.querySelector('mark.sr-hit-on')||host.querySelector('.sr-hit');
  if(first && first.scrollIntoView) first.scrollIntoView({block:'center'});
}

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
  if(_ttsOn) populateTtsVoices(detectLanguage(pageSpeechText()));
  var bTts=document.getElementById('bTts');
  if(bTts) bTts.classList.toggle('on',_ttsOn);
  // Switch to text pane when turning on TTS
  if(_ttsOn) switchPane('text');
  if(!_ttsOn) stopTts();
};
window.toggleTtsPlay=function(){
  // The second press stops, whether the page is speaking through the browser
  // or playing back as Google audio.
  if(_ttsAudio && !_ttsAudio.ended){stopTts();return}
  if(window.speechSynthesis.speaking){stopTts();return}
  ttsStartReading();
};
/* Plain text of the page on screen, from whichever source this book has.
 * Prefers the OCR words the highlight engine already holds, because those are
 * the same words the text column shows and the same ones the mic aligns to. */
/* Detect the language of text by character ranges:
 *   - 'fa' if any Arabic-script char (U+0600-U+06FF) is found
 *   - 'ar' if text has no Persian/Arabic vowels but has Arabic script
 *   - otherwise return the first word of available IIIF language metadata,
 *     or 'en' as last resort
 * This is called lazily on first TTS/STT use so we don't scan every page. */
/* Detect language from text content.
 *
 * Strategy: character-range scoring.  Each language has a distinctive set of
 * Unicode code points.  We scan the first 600 chars and score each language
 * by how many "diagnostic" chars it contains.  The highest score wins.
 * If no language wins and the text is pure ASCII Latin, fall back to 'en'.
 *
 * Languages supported: fa (Persian/Arabic), fr (French), en (English), de
 * (German), es (Spanish), it (Italian), pt (Portuguese), nl (Dutch), tr
 * (Turkish).  Others default to 'en'. */
/* Map the index's human language labels ('فارسی', 'عربی/فارسی', 'Persian'...)
 * to BCP-47 tags.  Returning the raw label was the bug that put a Persian
 * voice on foreign books: u.lang='فارسی' is not a tag, so the browser fell
 * back to its default voice regardless of the text. */
function bookLangTag(){
  var l=(BOOK && BOOK.language)||'';
  if(!l) return null;
  if(l.indexOf('فارسی')>=0 || /^persian$/i.test(l)) return 'fa-IR';
  if(l.indexOf('عربی')>=0) return 'ar-SA';
  if(l.indexOf('عبری')>=0) return 'he-IL';
  return null;
}
function detectLanguage(text){
  var bookTag=bookLangTag();
  if(!text) return bookTag||'en-US';
  // Fast path: Persian/Arabic script.  The script alone cannot tell fa from ar
  // (same letters), so book metadata breaks the tie; no metadata -> Persian,
  // which is what this library mostly holds.
  for(var i=0;i<text.length&&i<300;i++){
    var c=text.charCodeAt(i);
    if(c>=0x0600&&c<=0x06FF) return (bookTag==='ar-SA') ? 'ar-SA' : 'fa-IR';
  }
  // Latin-script languages
  var sample=text.slice(0,600);
  var scores={};
  // French: e with acute/grave/circumflex, a Grave, c cedilla, u grave, i caret, e diaeresis
  scores.fr=0;
  // English: no distinctive chars — we fall through to default
  // German: ä ö ü ß Ä Ö Ü
  scores.de=0;
  // Spanish: ñ á é í ó ú ü
  scores.es=0;
  // Italian: not distinctive enough, falls to en
  scores.it=0;
  // Portuguese: Ã Õ À É Ó Ç
  scores.pt=0;
  // Dutch: not distinctive enough
  scores.nl=0;
  // Turkish: ş ç ğ ı ö ü Ş Ç Ğ ı Ö Ü
  scores.tr=0;

  for(var i=0;i<sample.length;i++){
    var c=sample.charCodeAt(i);
    // French: e-acute/grave/circumflex/diaeresis, a-circumflex, o-circumflex, u-circumflex, c-cedilla
    var FRENCH_CHARS=[0x00E9,0x00E8,0x00EA,0x00EB,0x00E2,0x00EE,0x00EF,0x00E4,0x00F4,0x00F8,0x00FC,0x00E7,0x00C9,0x00C8,0x00CA,0x00CB,0x00C2,0x00CE,0x00D4,0x00DC,0x00C7];
    if(FRENCH_CHARS.indexOf(c)>=0)scores.fr++;
    // German
    if(c===0x00E4||c===0x00F6||c===0x00FC||c===0x00DF)scores.de++;
    if(c===0x00C4||c===0x00D6||c===0x00DC)scores.de++;
    // Spanish
    if(c===0x00F1)scores.es++;
    if(c===0x00E1||c===0x00E9||c===0x00ED||c===0x00F3||c===0x00FA)scores.es++;
    // Portuguese
    if(c===0x00C3||c===0x00D5||c===0x00C0||c===0x00C9||c===0x00D3||c===0x00C7)scores.pt++;
    if(c===0x00E3||c===0x00F5||c===0x00E0||c===0x00E9||c===0x00F3||c===0x00E7)scores.pt++;
    // Turkish
    if(c===0x015F||c===0x0131||c===0x00F6||c===0x00FC||c===0x011F||c===0x015E||c===0x0130||c===0x00D6||c===0x00DC)scores.tr++;
    if(c===0x015E||c===0x0130||c===0x00D6||c===0x00DC)scores.tr++;
  }
  // Pick the highest scorer
  var best='en', bestScore=0;
  var langs=['fr','de','es','pt','tr'];
  langs.forEach(function(lg){
    if(scores[lg]>bestScore){bestScore=scores[lg];best=lg;}
  });
  // If French scored but very low, it might just be a proper name - require a
  // threshold; below it the text says nothing, so fall back to metadata.
  if(bestScore<2) return bookTag||'en-US';
  var tagMap={fr:'fr-FR',en:'en-US',de:'de-DE',es:'es-ES',pt:'pt-BR',tr:'tr-TR'};
  return tagMap[best]||bookTag||'en-US';
}

function pageSpeechText(){
  var T=window.__coreaderText;
  var words=T && (T.state.words||[]).filter(function(w){return w.t;});
  if(words && words.length) return words.map(function(w){return w.t;}).join(' ');
  var pageData=_texts.find(function(p){return p.page===_curPage});
  // Local books carry their text as `html` (loadText normalizes every source
  // into {page, html}); reading `text` alone returned '' for all of them, so
  // the read-aloud button did nothing on a saved book.
  if(pageData) return (pageData.text||pageData.html||'').replace(/<[^>]+>/g,'');
  var shown=document.getElementById('textContent');
  return shown ? (shown.innerText||'') : '';
}

window.setTtsRate=function(v){
  document.getElementById('ttsRateLabel').textContent=parseFloat(v).toFixed(1)+'×';
};
/* The voice menu.
 *
 * Chrome hands the voice list over asynchronously: the first getVoices() is
 * empty and "voiceschanged" fires later with the real list.  The reader fills
 * its menu in three places (boot, engine change, voiceschanged); the viewer
 * filled it nowhere, so #ttsVoiceSel stayed empty while 22 voices sat behind
 * getVoices() - and speakPage's `vsel.value=lang` could not help, because the
 * options are indexed voices, not language tags.
 *
 * The reader's own pick (by voiceURI) survives a rebuild; without a pick the
 * first voice of the detected language is selected. */
function populateTtsVoices(lang){
  if(lang) _ttsLang=lang;
  if(!window.speechSynthesis) return;
  var sel=document.getElementById('ttsVoiceSel');
  if(!sel) return;
  var voices=window.speechSynthesis.getVoices()||[];
  if(!voices.length) return;   // still empty: voiceschanged will call us again
  _ttsVoices=voices;
  sel.innerHTML=voices.map(function(v,i){
    return '<option value="'+i+'">'+v.name+' ('+v.lang+')</option>';
  }).join('');
  sel.onchange=function(){
    var v=_ttsVoices[+sel.value];
    _ttsVoice=v ? v.voiceURI : null;
  };
  var keep=-1, i;
  if(_ttsVoice){
    for(i=0;i<voices.length;i++){ if(voices[i].voiceURI===_ttsVoice){ keep=i; break; } }
  }
  if(keep<0 && _ttsLang){
    var base=String(_ttsLang).split('-')[0].toLowerCase();
    for(i=0;i<voices.length;i++){
      if(String(voices[i].lang||'').toLowerCase().indexOf(base)===0){ keep=i; break; }
    }
  }
  sel.value=String(keep<0 ? 0 : keep);
}
function selectedTtsVoice(){
  var sel=document.getElementById('ttsVoiceSel');
  return (sel && _ttsVoices[+sel.value]) || null;
}
if(window.speechSynthesis){
  window.speechSynthesis.addEventListener('voiceschanged', function(){
    populateTtsVoices(_ttsLang);
  });
}
/* --- does the read continue? --------------------------------------------
 * speakPage() reads exactly one page. What happens at the end of it lives
 * here, and both engines (browser speechSynthesis, Google audio) go through
 * the same three steps: turn the page, decide whether that page can be read,
 * and only then start it again.
 *
 * _ttsGen makes "stop" mean stop. Cancelling an utterance makes Chrome fire
 * onend on the utterance it just discarded, so an unguarded continuation
 * would turn the page and start reading aloud the moment the reader pressed
 * stop. stopTts() bumps the generation before cancelling; every captured
 * callback checks it.
 *
 * ttsTextState() is what makes it go to the next page's *text*: a page with
 * no text is stepped over, and an annotation still being fetched is waited
 * for instead of being mistaken for an empty page. */
var _ttsGen=0;
var _ttsAudio=null;

/* 1 = this page has something to read, -1 = nothing to read here,
 * 0 = the page's annotation has been requested but has not arrived yet. */
function ttsTextState(p){
  if(p!==_curPage) return -1;
  var T=window.__coreaderText;
  if(T && T.state && T.state.wordsPage===p){
    return (T.state.words && T.state.words.length) ? 1 : -1;
  }
  var d=_texts.find(function(x){return x.page===p;});
  if(d) return ((d.text||d.html||'').replace(/<[^>]+>/g,'').trim()) ? 1 : -1;
  // Ganjoor renders its own text into the column and never fills _texts or
  // the OCR word list, so the column itself is the only honest answer here.
  if(typeof _ganjoor!=='undefined' && _ganjoor){
    var el=document.getElementById('textContent');
    return (el && (el.innerText||'').trim()) ? 1 : -1;
  }
  if(BOOK && BOOK.source==='iiif'){
    if(!pageTextUrl()) return -1;   // this canvas carries no annotation at all
    return 0;
  }
  return -1;
}
function ttsFinish(msg){
  var s=document.getElementById('ttsStatus');
  if(s) s.textContent=msg;
}
/* Page `from` has been read. The reader turned away by hand -> leave them
 * alone; the book ended -> say so; otherwise turn the page and wait for its
 * text. */
function ttsContinue(gen, from){
  if(gen!==_ttsGen) return;
  if(_curPage!==from){ ttsFinish('آماده خوانش'); return; }
  var total=(BOOK && BOOK.pages)||0;
  if(from>=total){ ttsFinish('پایان کتاب'); return; }
  goPage(from+1);
  ttsAwait(from+1, gen, 0);
}
function ttsAwait(p, gen, tries){
  if(gen!==_ttsGen || _curPage!==p) return;
  var s=ttsTextState(p);
  if(s===1){ speakPage(); return; }
  if(s===-1){ ttsContinue(gen, p); return; }
  // 0: wait for the annotation. ~6s is far past any real annotation fetch,
  // so what is left is a page that never answers - step over it.
  if(tries>=40){ ttsContinue(gen, p); return; }
  setTimeout(function(){ ttsAwait(p, gen, tries+1); }, 150);
}
/* Entry point for the play button: start here, or move on if this page has
 * nothing to read. */
function ttsStartReading(){
  var gen=++_ttsGen;
  var s=ttsTextState(_curPage);
  if(s===1){ speakPage(); return; }
  if(s===0){ ttsAwait(_curPage, gen, 0); return; }
  ttsContinue(gen, _curPage);
}

function speakPage(){
  // The page's words come from the OCR annotation, which is the only text source
  // a live IIIF book has: _texts stays empty for these books, so reading from it
  // meant the button silently did nothing on exactly the books that have text.
  var text=pageSpeechText();
  if(!text.trim()) return;
  // Auto-detect language for TTS from the text itself, then make sure the
  // menu offers that language's voices.  `vsel.value=lang` was the bug: the
  // options are indexed voices, so assigning a BCP-47 tag emptied the
  // selection instead of choosing a voice.
  var lang=detectLanguage(text);
  populateTtsVoices(lang);
  // Show annotations for this page
  showPageAnnotationsForPage(_curPage);
  // Auto-show inline .anno tooltips sequentially
  showInlineAnnoTooltips();
  var engine=document.getElementById('setTtsEngine').value;
  if(engine==='google'){
    speakGoogle(text);
  } else {
    speakBrowser(text);
  }
}
function speakBrowser(text){
  var u=new SpeechSynthesisUtterance(text);
  var lang=detectLanguage(text);
  var voice=selectedTtsVoice();
  // The chosen voice wins over the detected language: setting u.lang alone
  // lets the browser pick its own default, which is why changing the menu
  // had no audible effect.
  if(voice){ u.voice=voice; u.lang=voice.lang||lang; }
  else u.lang=lang||'fa-IR';
  u.rate=parseFloat(document.getElementById('ttsRate').value)||1;
  // Captured now: by the time this fires the reader may have stopped us or
  // moved somewhere else, and neither must restart the read.
  var gen=_ttsGen, pg=_curPage;
  u.onend=function(){
    if(gen!==_ttsGen) return;
    ttsContinue(gen, pg);
  };
  u.onerror=function(){
    if(gen!==_ttsGen) return;
    ttsFinish('خطا در خوانش');
  };
  window.speechSynthesis.speak(u);
  document.getElementById('ttsStatus').textContent='در حال خوانش...';
}
function speakGoogle(text){
  var chunks=[];var maxLen=200;
  for(var i=0;i<text.length;i+=maxLen) chunks.push(text.substring(i,i+maxLen));
  document.getElementById('ttsStatus').textContent='در حال خوانش...';
  var idx=0;
  var gen=_ttsGen, pg=_curPage;
  function playNext(){
    if(gen!==_ttsGen || !_ttsOn) return;
    if(idx>=chunks.length){ _ttsAudio=null; ttsContinue(gen, pg); return; }
    var i=idx;
    var slang=(detectLanguage(chunks[i])||'fa').split('-')[0];
    var url='https://translate.google.com/translate_tts?ie=UTF-8&tl='+slang+'&client=tw-ob&q='+encodeURIComponent(chunks[i]);
    var a=new Audio(url);
    // `idx` advances only when this chunk is really over. It used to move
    // both here and in onended, which skipped every other chunk of the page.
    a.onended=function(){ idx=i+1; playNext(); };
    a.onerror=function(){
      if(gen!==_ttsGen) return;
      // The endpoint is unavailable: finish the page with the browser engine
      // instead of re-requesting it for every page that follows.
      var sel=document.getElementById('setTtsEngine'); if(sel) sel.value='browser';
      _ttsAudio=null;
      speakBrowser(chunks.slice(i).join(' '));
    };
    _ttsAudio=a;
    a.play();
  }
  playNext();
}
// Show annotation tooltips during TTS for saved text books
var _annoOverlayTimer = null;
function showPageAnnotationsForPage(pg) {
  var old = document.getElementById('annoTtsOverlay');
  if (old) old.remove();
  var annos = _annos;
  if (!annos || !annos.length) return;
  var pageAnnos = annos.filter(function(a) { return a.page == pg; });
  if (!pageAnnos.length) return;
  var textEl = document.getElementById('textContent');
  if (!textEl) return;
  var box = document.createElement('div');
  box.id = 'annoTtsOverlay';
  box.style.cssText = 'position:absolute;right:8px;top:8px;max-width:280px;z-index:100;pointer-events:none;';
  pageAnnos.forEach(function(a) {
    var tip = document.createElement('div');
    tip.style.cssText = 'background:rgba(45,45,45,.92);color:#f5e6c8;border:1px solid rgba(212,168,83,.4);border-radius:8px;padding:8px 12px;margin-bottom:6px;font-size:12px;line-height:1.7;direction:rtl;box-shadow:0 2px 12px rgba(0,0,0,.3);animation:annoSlideIn .4s ease-out;pointer-events:auto;';
    tip.textContent = '📝 ' + a.text;
    box.appendChild(tip);
  });
  textEl.style.position = 'relative';
  textEl.appendChild(box);
  if (_annoOverlayTimer) clearTimeout(_annoOverlayTimer);
  _annoOverlayTimer = setTimeout(function() {
    if (box.parentNode) {
      box.style.transition = 'opacity 1.5s';
      box.style.opacity = '0';
      setTimeout(function() { if (box.parentNode) box.remove(); }, 1500);
    }
  }, 8000);
}
// Side-margin annotation tooltips (adapted from 888)
var _sideTtR = [], _sideTtL = [];
var SIDE_TT_FADE_MS = 5000, SIDE_TT_MAX = 4;
function _buildSideTtHtml(el) {
  var cat = el.dataset.cat || 'word';
  var h = '<button class="at-dismiss" onclick="dismissSideTt(this)">✕</button>';
  h += '<div class="at-word">' + el.textContent + '</div>';
  h += '<span class="at-cat tc-' + cat + '">' + (CAT_LABELS[cat] || cat) + '</span>';
  if (el.dataset.title) h += '<div class="at-title">' + el.dataset.title + '</div>';
  h += '<div class="at-text">' + (el.dataset.text || el.getAttribute('title') || '') + '</div>';
  if (el.dataset.extra) h += '<div class="at-extra">' + el.dataset.extra + '</div>';
  return h;
}
var CAT_LABELS = { word: 'واژه', arabic: 'عربی', name: 'نام', place: 'مکان', book: 'کتاب', concept: 'مفهوم', poem: 'شعر', hist: 'تاریخ', quran: 'قرآن', person: 'شخص', event: 'رویداد' };
function showSideTt(el) {
  if (!el) return;
  var pgEl = el.closest('.g-reading-box') || el.closest('.ps') || el.closest('.text-content') || el.closest('#textContent');
  if (!pgEl) return;
  pgEl.style.position = 'relative';
  var annos = pgEl.querySelectorAll('.anno');
  var myIdx = Array.prototype.indexOf.call(annos, el);
  var side = myIdx % 2 === 0 ? 'r' : 'l';
  var list = side === 'r' ? _sideTtR : _sideTtL;
  for (var i = 0; i < list.length; i++) {
    if (list[i].srcEl === el) {
      clearTimeout(list[i].timer);
      list[i].el.classList.remove('fading');
      list[i].el.classList.add('visible');
      list[i].timer = setTimeout(function() { _fadeSideTt(list[i].el); }, SIDE_TT_FADE_MS);
      return;
    }
  }
  var card = document.createElement('div');
  card.className = 'side-tt side-' + side;
  card.innerHTML = _buildSideTtHtml(el);
  pgEl.appendChild(card);
  var elRect = el.getBoundingClientRect();
  var pgRect = pgEl.getBoundingClientRect();
  var top = elRect.top - pgRect.top + pgEl.scrollTop - 10;
  top = Math.max(0, Math.min(top, pgRect.height - 140));
  card.style.top = top + 'px';
  requestAnimationFrame(function() { card.classList.add('visible'); });
  var timer = setTimeout(function() { _fadeSideTt(card); }, SIDE_TT_FADE_MS);
  list.push({ el: card, srcEl: el, timer: timer });
  if (list.length > SIDE_TT_MAX) { var old = list.shift(); _fadeSideTt(old.el); }
}
function _fadeSideTt(card) {
  if (!card || !card.parentNode) return;
  card.classList.remove('visible');
  card.classList.add('fading');
  setTimeout(function() { if (card.parentNode) card.parentNode.removeChild(card); }, 900);
}
window.dismissSideTt = function(btn) {
  var card = btn.closest('.side-tt');
  if (card) _fadeSideTt(card);
};
function clearAllSideTt() {
  _sideTtR.concat(_sideTtL).forEach(function(item) { clearTimeout(item.timer); _fadeSideTt(item.el); });
  _sideTtR = []; _sideTtL = [];
}
// Auto-show annotations during TTS for saved text books
var _inlineAnnoTimer = null;
function showInlineAnnoTooltips() {
  var textEl = document.getElementById('textContent');
  if (!textEl) return;
  var annos = textEl.querySelectorAll('.anno[data-text], .anno[data-title]');
  if (!annos.length) return;
  if (_inlineAnnoTimer) clearInterval(_inlineAnnoTimer);
  // Show all annotations as side-tt cards at once
  for (var i = 0; i < annos.length; i++) {
    (function(el, delay) {
      setTimeout(function() { showSideTt(el); }, delay);
    })(annos[i], i * 300);
  }
  // Re-show as TTS continues
  var idx = 0;
  _inlineAnnoTimer = setInterval(function() {
    if (!window.speechSynthesis || !window.speechSynthesis.speaking) {
      clearInterval(_inlineAnnoTimer);
      _inlineAnnoTimer = null;
      return;
    }
    if (idx < annos.length) {
      showSideTt(annos[idx]);
      idx++;
    }
  }, SIDE_TT_FADE_MS + 1000);
}
function hideInlineAnnoTooltip() {
  clearAllSideTt();
}
function stopTts(){
  // Bump the generation BEFORE cancelling: cancel() makes Chrome fire onend
  // on the utterance it just discarded, and that callback must not turn the
  // page and start reading the next one.
  _ttsGen++;
  if(_ttsAudio){ try{ _ttsAudio.pause(); }catch(e){} _ttsAudio=null; }
  window.speechSynthesis.cancel();
  document.getElementById('ttsStatus').textContent='آماده خوانش';
  var old = document.getElementById('annoTtsOverlay');
  if (old) old.remove();
  if (_annoOverlayTimer) { clearTimeout(_annoOverlayTimer); _annoOverlayTimer = null; }
  if (_inlineAnnoTimer) { clearInterval(_inlineAnnoTimer); _inlineAnnoTimer = null; }
  clearAllSideTt();
}
window.setTtsEngine=function(v){_ttsEngine=v};
window._showSideTt=showSideTt;

// === UI toggles ===
window.toggleToc=toggleToc;window.goHome=function(){location.href='../'};
window.nextPage=nextPage;
window.prevPage=prevPage;
window.goPage=goPage;
window.loadBook=loadBook;
window.togglePanel=function(){
  var p=document.getElementById('sidePanel');
  var ov=document.getElementById('panelOverlay');
  var isMobile=window.innerWidth<=900;
  if(isMobile){
    p.classList.toggle('open');
    if(ov) ov.classList.toggle('open', p.classList.contains('open'));
  }else{
    p.classList.toggle('collapsed');
  }
  document.getElementById('bPanel').classList.toggle('on');
  setTimeout(function(){if(_osd)_osd.viewport.goHome(true)},350);
};
window.switchPane=function(name){
  document.querySelectorAll('.sp-tab').forEach(function(t){t.classList.toggle('on',t.dataset.pane===name)});
  document.querySelectorAll('.sp-pane').forEach(function(p){p.classList.toggle('on',p.id==='pane-'+name)});
  // Safety: if switching to text and ganjoor loaded but content empty, re-render
  if(name==='text' && typeof _ganjoor!=='undefined' && _ganjoor && typeof renderGanjoorText==='function'){
    var el=document.getElementById('textContent');
    if(el && !el.querySelector('.g-chapters')){
      renderGanjoorText();
    }
  }
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
// Wrapped: localStorage throws QuotaExceededError once progress/notes/text
// caches fill up, and an uncaught throw here aborted page navigation.
function _lsSet(k,v){try{localStorage.setItem(k,v);return true;}catch(e){return false;}}
function updateProgress(){
  var progress={};
  try{progress=JSON.parse(localStorage.getItem('coreader-progress')||'{}')}catch(e){}
  progress[BOOK.slug]=_curPage;
  if(!_lsSet('coreader-progress',JSON.stringify(progress))){
    // Drop this book's entry and retry once — the blob grows one key per book
    // opened, so a single stale entry usually frees enough room.
    try{
      delete progress[BOOK.slug];
      _lsSet('coreader-progress',JSON.stringify(progress));
    }catch(e){}
  }
}

// === Theme ===
function loadTheme(){var t=localStorage.getItem('coreader-theme');if(t)document.body.className=t;document.querySelectorAll('.theme-btn').forEach(function(b){b.classList.toggle('on',b.dataset.theme===(document.body.className||''))})}


/* --- Ask box: one dialog for the whole page -----------------------------
 *
 * alert(), prompt() and confirm() are blocked in the desktop webview - they
 * throw rather than showing anything, and a throw inside a context-menu handler
 * kills the action silently, with no console error and no visual change.  That
 * is why most of this menu was present but did nothing.
 *
 * So the native calls are shimmed once, here, and the existing handlers keep
 * their original code: they ask for a question the way they always did, and the
 * shim answers it inline.
 *
 * The prompt shim is async, so a handler written as
 *     var t = prompt('x'); if (!t) return;
 * cannot work unchanged - it would read an unresolved Promise.  Rather than
 * rewrite every handler into callbacks, ctxPrompt() resolves synchronously
 * against a value the box sets later, and ctxAwait() lets a handler opt into
 * the real async answer when it needs one.
 *
 * ponytail: this is a shim, not a port of the reader's menu.  When the viewer
 * handlers are rewritten as async functions, delete the shim and call ask()
 * directly; until then one shim fixes eighteen call sites. */
var _askState = { open: false, kind: '', value: null, resolve: null, textarea: null };

function askBox(kind, message, def, opts){
  opts = opts || {};
  var box = document.getElementById('askBox');
  if(!box) return Promise.resolve(kind==='alert' ? undefined : (kind==='confirm' ? false : def));
  return new Promise(function(resolve){
    _askState.open=true; _askState.kind=kind; _askState.resolve=resolve;
    document.getElementById('askMsg').textContent = message || '';
    document.getElementById('askTitle').textContent = opts.title ||
      (kind==='alert' ? 'توجه' : kind==='confirm' ? 'تایید' : 'ورودی');
    var input = document.getElementById('askInput');
    var wantsInput = (kind==='prompt');
    input.style.display = wantsInput ? '' : 'none';
    input.value = def == null ? '' : def;
    document.getElementById('askOk').textContent = opts.ok || (kind==='confirm' ? 'بله' : 'تایید');
    var cancel = document.getElementById('askCancel');
    // An alert has no way out but OK, so a cancel button would be a lie.
    cancel.style.display = (kind==='alert') ? 'none' : '';
    cancel.textContent = opts.cancel || 'انصراف';
    box.setAttribute('data-open','true');
    if(wantsInput) setTimeout(function(){ input.focus(); input.select(); }, 30);
  });
}

function _askClose(value){
  var box = document.getElementById('askBox');
  if(box) box.setAttribute('data-open','false');
  var st = _askState;
  // Read the resolver before clearing it.  Clearing first and calling after made
  // every answer resolve undefined, so every action that asked a question returned
  // early and did nothing - with the box visibly opening and closing, which looks
  // like it worked.
  var resolve = st.resolve;
  st.open=false;
  st.resolve=null;
  if(resolve) resolve(value);
}

// Wire the buttons here rather than with inline onclick, so the markup stays
// free of behaviour and the handlers survive a re-render of the box.
(function bindAskBox(){
  var box = document.getElementById('askBox');
  if(!box || box.dataset.bound === '1') return;
  box.dataset.bound = '1';
  document.getElementById('askOk').addEventListener('click', _askOk);
  document.getElementById('askCancel').addEventListener('click', function(){ _askClose(null); });
  // Clicking the backdrop dismisses, which is what a modal is expected to do -
  // but a typed-but-unsubmitted answer is discarded, so only the cancel path runs.
  box.querySelector('.ask-backdrop').addEventListener('click', function(){ _askClose(null); });
})();

// Enter confirms, Escape cancels: the two keys a dialog is expected to answer to.
document.addEventListener('keydown', function(e){
  var box = document.getElementById('askBox');
  if(!box || box.getAttribute('data-open')!=='true') return;
  if(e.key==='Enter'){ e.preventDefault(); _askOk(); }
  else if(e.key==='Escape'){ e.preventDefault(); _askClose(null); }
});
function _askOk(){
  var kind = _askState.kind;
  // The textarea, when one is up, is the field the user is actually typing in.
  if(kind==='prompt') _askClose(_askState.textarea
    ? _askState.textarea.value
    : document.getElementById('askInput').value);
  else if(kind==='confirm') _askClose(true);
  else _askClose(undefined);
}

/* Same box, but multi-line, for page-length text.  The ask input is a single
 * line, and typing a page of OCR into it is unusable - so this swaps in a
 * textarea for the duration of the question and puts the plain input back after.
 * ponytail: two inputs rather than a styled contenteditable, which would drag in
 * caret handling and paste sanitising for no gain here. */
function ctxAskTextarea(message, value){
  var box=document.getElementById('askBox');
  if(!box) return Promise.resolve(value);
  var input=document.getElementById('askInput');
  var area=document.createElement('textarea');
  area.className='ask-input ask-area';
  area.dir='auto';
  area.value=value||'';
  input.style.display='none';
  input.parentNode.insertBefore(area, input.nextSibling);
  _askState.textarea=area;
  return askBox('prompt', message, value).then(function(answer){
    area.remove();
    input.style.display='';
    _askState.textarea=null;
    return answer;
  });
}

/* The real async answer, for handlers that can await. */
function ctxAsk(kind, message, def, opts){
  return askBox(kind, message, def, opts);
}

// === Context Menu for IIIF viewer ===
var ctxSel='',ctxRange=null,ctxAnnoEl=null;

/* Snapshot the selection on right-button DOWN, not on contextmenu.
 *
 * The default action of a right-button press collapses the selection to a caret,
 * and contextmenu fires after it - so reading the selection in contextmenu loses
 * exactly the text the user just selected.  mousedown runs first, so the text is
 * still there; the snapshot is cloned because a live Range follows the selection
 * as it collapses. */
document.addEventListener('mousedown',function(e){
  if(e.button!==2) return;
  var sel=window.getSelection();
  if(!sel || sel.rangeCount===0) return;
  var txt=sel.toString().trim();
  if(txt){ ctxSel=txt; ctxRange=sel.getRangeAt(0).cloneRange(); }
},true);

document.addEventListener('contextmenu',function(e){
  var inImage=e.target.closest&&e.target.closest('.image-panel,#osd-container');
  var inText=e.target.closest&&e.target.closest('.text-content,.sp-pane');
  if(!inImage&&!inText) return;
  e.preventDefault();
  // Re-read only if there is still a live selection; otherwise keep the snapshot,
  // which is the only copy of text the user is still holding.
  var sel=window.getSelection();
  var live=sel&&sel.rangeCount>0?sel.toString().trim():'';
  if(live){ ctxSel=live; ctxRange=sel.getRangeAt(0).cloneRange(); }
  if(!ctxRange||!ctxRange.startContainer||!ctxRange.startContainer.isConnected) _ctxRebuildRange();
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
// second renderText removed — was broken subagent artifact
async function ctxEditTextIiif(){_closeCtx();if(!BOOK)return;
  var existing=loadIiifText(BOOK.slug,_curPage);
  // A whole page of OCR does not fit on one line, so this one asks in a textarea.
  var text=await ctxAskTextarea("متن صفحهٔ "+toFA(_curPage)+"\n(برای افزودن متن OCR یا تایپ متن)",existing||"");
  if(text===null)return;
  saveIiifText(BOOK.slug,_curPage,text);
  renderText();
  _toast("متن ذخیره شد ✓")
}

// === Glossary Annotation ===
var _glossary=null;
function loadGlossary(){
  if(_glossary)return;
  fetch("/assets/glossary.json").then(function(r){return r.json()}).then(function(g){_glossary=g}).catch(function(){})
}
function annotateGlossary(){
  if(!_glossary)return;
  // --- Ganjoor text: annotate .g-word spans inside .g-line ---
  var gLines=document.querySelectorAll("#textContent .g-line");
  if(gLines.length){
    gLines.forEach(function(lineEl){
      var words=lineEl.querySelectorAll(".g-word");
      words.forEach(function(wEl){
        var txt=wEl.textContent.trim();
        if(!txt)return;
        Object.keys(_glossary).forEach(function(key){
          if(!txt.includes(key))return;
          var def=_glossary[key];
          var cat=def.cat||"word";
          var gloss=def.gloss||def.definition||def;
          if(typeof gloss!=="string")gloss=JSON.stringify(gloss);
          // Only wrap if not already annotated
          if(wEl.classList.contains("anno"))return;
          wEl.classList.add("anno","anno-word");
          wEl.setAttribute("data-cat",cat);
          wEl.setAttribute("data-title",key);
          wEl.setAttribute("data-text",gloss);
          wEl.style.borderBottom="1.5px dotted var(--accent,#8b5e3c)";
        });
      });
    });
    return;
  }
  // --- Regular IIIF text: annotate .text-content ---
  var el=document.getElementById("textContent");
  if(!el)return;
  var textEl=el.querySelector(".text-content");
  if(!textEl)return;
  var html=textEl.innerHTML;
  Object.keys(_glossary).forEach(function(word){
    var def=_glossary[word];
    var cat=def.cat||"word";
    var gloss=def.gloss||def.definition||(typeof def==="string"?def:"");
    if(!gloss)return;
    var re=new RegExp("(" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
    html=html.replace(re, "<span class=\"anno anno-word\" data-cat=\"" + cat + "\" data-title=\"" + word.replace(/"/g, "&quot;") + "\" data-text=\"" + gloss.replace(/"/g, "&quot;") + "\">$1</span>");
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
document.addEventListener("mouseover",function(e){
  var anno=e.target.closest&&(e.target.closest(".anno")||e.target.closest(".anno-item"));
  if(!anno)return;
  var text=anno.dataset.text||"";
  var title=anno.dataset.title||"";
  if(!text&&!title)return;
  showSideTt(anno);
});
document.addEventListener("mouseout",function(e){
  // Side-tt cards auto-fade, no action needed
});

function _closeCtx(){document.getElementById('ctxMenu').setAttribute('data-open','false')}

/* Re-find the selected text in the DOM when the stored Range has gone stale.
 *
 * The text column is re-rendered on every page change and after every search, so
 * a Range captured before either of those points at detached nodes and silently
 * highlights nothing.  Locating the text again is what makes the action survive a
 * re-render; if it cannot be found, say so rather than highlighting the wrong
 * words. */
function _ctxRebuildRange(){
  ctxRange=null;
  if(!ctxSel || ctxSel.length<2) return null;
  var host=document.getElementById('textContent');
  if(!host) return null;
  // Word spans are the search engine's own markup and the most common target, so
  // try them before walking raw text nodes.
  var spans=host.querySelectorAll('.pt-words span, .g-word');
  for(var i=0;i<spans.length;i++){
    if((spans[i].textContent||'')===ctxSel){
      ctxRange=document.createRange();
      ctxRange.selectNodeContents(spans[i]);
      return ctxRange;
    }
  }
  var walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT,null);
  var n;
  while(n=walker.nextNode()){
    var at=n.nodeValue.indexOf(ctxSel);
    if(at>=0){
      ctxRange=document.createRange();
      ctxRange.setStart(n,at);
      ctxRange.setEnd(n,at+ctxSel.length);
      return ctxRange;
    }
  }
  return null;
}

/* Context-menu actions.
 *
 * All of these are async because they ask the user something, and asking means
 * showing the inline ask box and waiting for the answer - the native dialogs are
 * blocked in this webview, so there is nothing to wait on if you use them.  A
 * handler that asks a question synchronously cannot work here at all: it would
 * have to either block forever or invent an answer, and inventing one silently
 * writes the wrong data.
 *
 * The selection is captured at click time, before the menu closes, because
 * closing a menu can clear the DOM selection - and an empty selection is
 * indistinguishable from the user changing their mind. */
function _ctxNeed(sel, msg){
  if(sel) return true;
  return ctxAsk('alert', msg || 'ابتدا متن را انتخاب کنید', '');
}

window.ctxAddAnno=async function(){
  _closeCtx();
  if(!await _ctxNeed(ctxSel)) return;
  var title=await ctxAsk('prompt','عنوان حاشیه (اختیاری):','');
  if(title===null) return;
  var text=await ctxAsk('prompt','متن حاشیه:','');
  if(!text) return;
  var cat=await ctxAsk('prompt','دسته (arabic/poem/quran/hist/word/person/event):','word');
  if(cat===null) return;
  _annos.push({page:_curPage,text:text,title:title,cat:cat,selectedText:ctxSel,time:Date.now()});
  saveAnnos();renderAnnos();
  _toast('حاشیه افزوده شد ✓');
};

window.ctxEditAnno=async function(){
  _closeCtx();
  if(!await _ctxNeed(ctxSel)) return;
  var ann=_annos.find(function(a){return a.selectedText===ctxSel});
  if(!ann){ await ctxAsk('alert','حاشیه‌ای برای این متن یافت نشد'); return; }
  var title=await ctxAsk('prompt','عنوان جدید:',ann.title||'');
  if(title===null) return;
  var text=await ctxAsk('prompt','متن جدید:',ann.text||'');
  if(text===null) return;
  ann.title=title; ann.text=text;
  saveAnnos(BOOK.slug); renderAnnos();
  _toast('ویرایش شد ✓');
};

window.ctxDeleteAnno=async function(){
  _closeCtx();
  if(!await _ctxNeed(ctxSel)) return;
  var idx=-1;
  _annos.forEach(function(a,i){ if(a.selectedText===ctxSel) idx=i; });
  if(idx<0){ await ctxAsk('alert','حاشیه‌ای یافت نشد'); return; }
  // Deleting is destructive, so it is the one action that must be confirmed by a
  // real answer, not a default: null means the user cancelled.
  var okTo=await ctxAsk('confirm','حذف حاشیه؟','');
  if(okTo!==true) return;
  _annos.splice(idx,1); saveAnnos(BOOK.slug); renderAnnos();
  _toast('حذف شد ✓');
};

window.ctxEditText=function(){
  _closeCtx();
  if(!ctxSel){ ctxAsk('alert','ابتدا متن را انتخاب کنید'); return; }
  _toast('ویرایش متن برای این نسخه در دسترس نیست');
};

window.ctxAddNote=async function(){
  _closeCtx();
  if(!await _ctxNeed(ctxSel)) return;
  var note=await ctxAsk('prompt','یادداشت شما:','');
  if(!note) return;
  var notes=JSON.parse(localStorage.getItem('coreader-notes')||'[]');
  notes.push({text:ctxSel,note:note,page:_curPage,book:BOOK.title,time:Date.now()});
  localStorage.setItem('coreader-notes',JSON.stringify(notes));
  _toast('یادداشت ذخیره شد ✓');
};

window.ctxHighlight=async function(){
  _closeCtx();
  if(!ctxSel){ ctxAsk('alert','ابتدا متن را انتخاب کنید'); return; }
  if(!ctxRange) _ctxRebuildRange();
  if(!ctxRange){ ctxAsk('alert','این متن دیگر در صفحه نیست'); return; }
  var color=await ctxAsk('prompt','رنگ هایلایت:','#ffe08a');
  if(color===null) return;
  // Skip anything already highlighted: wrapping a second time nests marks inside
  // marks and each repeat adds a layer, so a re-applied colour never showed up.
  var span=document.createElement('span');
  span.className='user-highlight';
  span.style.cssText='background:'+color+';border-radius:3px;padding:1px 2px;';
  try{
    ctxRange.surroundContents(span);
    _toast('هایلایت شد ✓');
    return;
  }catch(e){
    // surroundContents throws when the range crosses element boundaries, which is
    // the normal case here: the text is one span per OCR word.
  }
  // Fall back to wrapping each text node the range touches, from last to first so
  // that earlier offsets stay valid as the DOM changes underneath them.
  var nodes=[];
  var walker=document.createTreeWalker(ctxRange.commonAncestorContainer,NodeFilter.SHOW_TEXT,null);
  var n; while(n=walker.nextNode()){ if(ctxRange.intersectsNode(n)) nodes.push(n); }
  var wrapped=0;
  for(var i=nodes.length-1;i>=0;i--){
    var tn=nodes[i];
    if(!tn.parentNode || tn.nodeValue.trim()==='') continue;
    if(tn.parentNode.classList && tn.parentNode.classList.contains('user-highlight')) continue;
    var s2=document.createElement('span');
    s2.className='user-highlight';
    s2.style.cssText=span.style.cssText;
    tn.parentNode.insertBefore(s2,tn);
    s2.appendChild(tn);
    wrapped++;
  }
  // No toast for zero: "highlighted" over nothing is exactly the lie this whole
  // menu was full of.
  if(wrapped) _toast('هایلایت شد ✓');
  else ctxAsk('alert','چیزی برای هایلایت کردن نبود');
};

window.ctxAddFavorite=function(){
  _closeCtx();
  if(!ctxSel){ ctxAsk('alert','ابتدا متن را انتخاب کنید'); return; }
  var favs=JSON.parse(localStorage.getItem('coreader-favs')||'[]');
  favs.push({text:ctxSel,page:_curPage,book:BOOK.title,time:Date.now()});
  localStorage.setItem('coreader-favs',JSON.stringify(favs));
  _toast('⭐ افزودن شد');
};

window.ctxBookmark=function(){
  _closeCtx();
  addBookmark('');
  _toast('🔖 نشانه ذخیره شد');
};

window.ctxCopyWithSource=function(){
  _closeCtx();
  if(!ctxSel){ ctxAsk('alert','ابتدا متن را انتخاب کنید'); return; }
  var src='— «'+BOOK.title+'» صفحهٔ '+toFA(_curPage);
  // The clipboard is unavailable on http and without a user gesture chain, so a
  // rejection must not look like a success toast.
  if(!navigator.clipboard) { _toast('کپی در این مرورگر در دسترس نیست'); return; }
  navigator.clipboard.writeText(ctxSel+'\n'+src)
    .then(function(){ _toast('کپی شد ✓'); })
    .catch(function(){ _toast('کپی ناموفق بود'); });
};

window.ctxShareAnno=function(){
  _closeCtx();
  if(!ctxSel) return;
  var text=ctxSel+'\n— «'+BOOK.title+'» صفحهٔ '+toFA(_curPage);
  if(navigator.share) navigator.share({title:BOOK.title,text:text});
  else ctxCopyWithSource();
};

window.ctxSearchEnc=function(){
  _closeCtx();
  if(!ctxSel) return;
  window.open('https://en.wiktionary.org/wiki/'+encodeURIComponent(ctxSel.split(/\s+/)[0]),'_blank');
};

window.ctxToggleTashkil=function(){
  _closeCtx();
  toggleTashkilBar();
};

function toggleTashkilBar(){
  var bar=document.getElementById('tashkilBar');
  if(!bar){
    bar=document.createElement('div');
    bar.id='tashkilBar';
    bar.className='tashkil-bar';
    var chars=[{c:'َ',n:'فتحه'},{c:'ُ',n:'ضمه'},{c:'ِ',n:'کسره'},{c:'ّ',n:'تشدید'},{c:'ْ',n:'سکون'}];
    // data-char, not an inline onclick: the harakat are combining marks, and
    // embedding one inside an HTML attribute literal is exactly the escaping
    // trap the rest of this file already documents once.
    bar.innerHTML=chars.map(function(x,i){
      return '<button type="button" data-i="'+i+'" title="'+x.n+'">'+x.c+'</button>';
    }).join('');
    bar.addEventListener('click', function(e){
      var b=e.target.closest('button[data-i]');
      if(!b) return;
      insertTashkil(chars[+b.dataset.i].c);
    });
    document.body.appendChild(bar);
  }
  bar.style.display=bar.style.display==='none'?'flex':'none';
  if(bar.style.display==='flex'){
    var sel=window.getSelection();
    if(sel.rangeCount){
      var r=sel.getRangeAt(0).getBoundingClientRect();
      bar.style.left=Math.max(8,Math.min(r.left,window.innerWidth-260))+'px';
      bar.style.top=Math.max(8,r.bottom+6)+'px';
    }
  }
}
window.toggleTashkilBar=toggleTashkilBar;

function insertTashkil(ch){var sel=window.getSelection();if(!sel.rangeCount)return;
  var range=sel.getRangeAt(0);var node=document.createTextNode(ch);
  range.insertNode(node);range.setStartAfter(node);range.setEndAfter(node);
  sel.removeAllRanges();sel.addRange(range)}
function applyEditStyle(cmd,val){document.execCommand(cmd,false,val||null)}

function _toast(msg){var t=document.createElement('div');t.textContent=msg;
  t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:8px 20px;border-radius:8px;z-index:99999;font-size:14px';
  document.body.appendChild(t);setTimeout(function(){t.remove()},1500)}


// === Dictionary / Encyclopedia Lookup ===
var encSources = [
  { name: 'واژه‌یاب', icon: '📖', desc: 'معنی و مترادف', fn: function(w){ return 'https://vajehyab.com/?q=' + encodeURIComponent(w); } },
  { name: 'لغت‌نامه دهخدا', icon: '📗', desc: 'لغت‌نامه جامع', fn: function(w){ return 'https://vajehyab.com/dehkhoda/' + encodeURIComponent(w); } },
  { name: 'فرهنگ معین', icon: '📘', desc: 'فرهنگ لغت', fn: function(w){ return 'https://vajehyab.com/moein/' + encodeURIComponent(w); } },
  { name: 'فرهنگ عمید', icon: '📙', desc: 'فرهنگ فارسی', fn: function(w){ return 'https://vajehyab.com/amid/' + encodeURIComponent(w); } },
  { name: 'ویکی‌واژه', icon: '🌐', desc: 'واژه‌نامه آزاد', fn: function(w){ return 'https://fa.wiktionary.org/wiki/' + encodeURIComponent(w); } },
  { name: 'گنجور', icon: '📜', desc: 'شعر و ادب پارسی', fn: function(w){ return 'https://ganjoor.net/search?s=' + encodeURIComponent(w); } },
];
function openEncPanel(word){
  var el=document.getElementById('encLeft');
  if(!el) return;
  el.classList.add('on');
  if(word) doEncSearch(word);
}
function closeEncPanel(){
  var el=document.getElementById('encLeft');
  if(el) el.classList.remove('on');
}
function doEncSearch(word){
  if(!word){
    var inp=document.getElementById('encLeftInput');
    word=inp?inp.value.trim():'';
  }
  if(!word) return;
  var clean=word.split(/\s+/)[0].replace(/[،؛.!؟«»()\[\]]/g,'');
  var wEl=document.getElementById('encLeftWord'); if(wEl) wEl.textContent=clean;
  var iEl=document.getElementById('encLeftInput'); if(iEl) iEl.value=clean;
  var rEl=document.getElementById('encLeftResults');
  if(rEl){
    rEl.innerHTML=encSources.map(function(s){
      return '<a class="enc-link" href="'+s.fn(clean)+'" target="_blank" rel="noopener">'+
        '<div class="enc-row"><span class="enc-title">'+s.icon+' '+s.name+'</span><span class="enc-desc">'+s.desc+'</span></div>'+
        '<span class="enc-arrow">↗</span></a>';
    }).join('');
    /* A IIIF book's text is whatever language the plate was set in, so the
     * lookup has to follow it: the lexicon picks the edition by script and
     * answers in Persian either way. */
    if(window.LX) LX.render(rEl, clean);
  }
}
window.openEncPanel=openEncPanel;
window.closeEncPanel=closeEncPanel;
window.doEncSearch=doEncSearch;

// === Theme & Custom Colors ===
window.setThemeColor=function(val){
  document.documentElement.style.setProperty('--bg', val);
  document.body.style.background=val;
  var rgb=parseInt(val.replace('#',''), 16);
  var r=(rgb>>16)&255, g=(rgb>>8)&255, b=rgb&255;
  var lum=0.2126*r + 0.7152*g + 0.0722*b;
  var fg=lum<128 ? '#e0d0c0' : '#2a2620';
  document.documentElement.style.setProperty('--text', fg);
  try{ localStorage.setItem('coreader-custom-theme-color', val); }catch(e){}
  var lbl=document.getElementById('setThemeColorV');
  if(lbl) lbl.textContent=val;
};

// === Missing function implementations ===
if(!window.toggleGanjoorTTS) window.toggleGanjoorTTS=function(){if(typeof toggleGRead==='function')toggleGRead();else _toast('خوانش صوتی برای این نسخه متصل نیست')};
if(!window.toggleGanjoorMic) window.toggleGanjoorMic=function(){if(typeof toggleGMic==='function')toggleGMic();else _toast('خط‌بر صوتی برای این نسخه متصل نیست')};
window.toggleAnno=function(){document.getElementById('sidePanel').classList.toggle('collapsed')};
window.openPdfAt=function(pg){
  if(BOOK&&BOOK.hasPdf){
    window.location.href='../reader/reader.html?book='+encodeURIComponent(BOOK.slug)+'&page='+(pg||_curPage);
  } else {
    _toast('این اثر فایل PDF مستقل ندارد');
  }
};
/* Mic line-following, from the reader's engine.
 *
 * For a poetry book the ganjoor engine still has the better dictionary, so it
 * keeps priority.  Everything else — every scanned book — uses the extracted
 * engine, which aligns the mic's transcript against the same OCR word list the
 * text column shows.  Before this, a scanned book got a toast saying the feature
 * was "only for poems and synced texts", which was true and also the reason it
 * was useless on the books people open it for. */
/* Mic line-following UI.  voice.js does the alignment; this side owns the
 * panel and the word paint.  The host callbacks were empty before - the
 * transcript moved an index and nothing ever showed for it - and there was
 * no panel at all, so the button looked dead even when recognition ran. */
function micHighlight(idx){
  var host=document.getElementById('textContent');
  if(!host) return;
  var cur=host.querySelector('.pt-w.mic-cur');
  if(cur) cur.classList.remove('mic-cur');
  var prev=host.querySelector('.pt-w.mic-prev');
  if(prev) prev.classList.remove('mic-prev');
  var el=host.querySelector('[data-pt-word="'+idx+'"]');
  if(el){
    el.classList.add('mic-cur');
    el.scrollIntoView({block:'center', behavior:'smooth'});
    var pe=host.querySelector('[data-pt-word="'+(idx-1)+'"]');
    if(pe) pe.classList.add('mic-prev');
  }
  var st=document.getElementById('micStatus');
  if(st && el){
    var total=((window.__coreaderText&&window.__coreaderText.state.words)||[]).length;
    st.textContent=el.textContent+' \u2014 '+toFA(idx+1)+'\u200cم از '+toFA(total);
  }
}
function micHost(lang){
  return {
    lang: lang,
    getWords: function(){ return (window.__coreaderText&&window.__coreaderText.state.words)||[]; },
    onWord: function(idx){ micHighlight(idx); },
    onPage: function(){}
  };
}
/* Panel and microphone are two separate controls, like the reader's panel:
 * toggleMic() only opens and closes the bar (closing always stops the mic),
 * while toggleRecording() - the round button inside the bar - starts and stops
 * listening on its own, so the bar can stay open while listening is paused.
 * Opening still starts listening in one click; that one-click behaviour is the
 * viewer's, everything else follows the reader's panel. */
function micIsListening(){
  var voice=window.__coreaderVoice;
  return !!(voice && voice.state && voice.state.mic);
}
function micSetRecordingUI(on){
  var btn=document.getElementById('micBtn');
  if(btn) btn.classList.toggle('recording', !!on);
}
function micSetStatus(text){
  var st=document.getElementById('micStatus');
  if(st) st.textContent=text;
}
/* Returns true when the microphone is listening afterwards. */
function micStart(){
  var voice=window.__coreaderVoice;
  var words=(window.__coreaderText&&window.__coreaderText.state.words)||[];
  if(!voice){ _toast('\u062e\u0637\u200c\u0628\u0631 \u0635\u0648\u062a\u06cc \u062f\u0631 \u0627\u06cc\u0646 \u0645\u0631\u0648\u0631\u06af\u0631 \u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u0646\u0645\u06cc\u200c\u0634\u0648\u062f'); return false; }
  if(!words.length){
    _toast('\u0627\u06cc\u0646 \u0635\u0641\u062d\u0647 \u0645\u062a\u0646\u06cc \u0646\u062f\u0627\u0631\u060c \u062e\u0637\u200c\u0628\u0631 \u0635\u0648\u062a\u06cc \u06a9\u0627\u0631 \u0646\u0645\u06cc\u200c\u06a9\u0646\u062f');
    return false;
  }
  // Recognition listens in the language of the text on screen - same rule the
  // TTS button uses, so the two never disagree about what language this is.
  var lang=detectLanguage(pageSpeechText());
  voice.mount(micHost(lang));
  voice.setWords(words);
  var started=voice.toggleMic();
  if(started===null){
    _toast('\u062e\u0637\u200c\u0628\u0631 \u0635\u0648\u062a\u06cc \u062f\u0631 \u0627\u06cc\u0646 \u0645\u0631\u0648\u0631\u06af\u0631 \u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u0646\u0645\u06cc\u200c\u0634\u0648\u062f');
    return false;
  }
  micSetRecordingUI(true);
  micSetStatus('\u062f\u0631 \u062d\u0627\u0644 \u06af\u0648\u0634 \u062f\u0627\u062f\u0646 \u2014 '+lang+'...');
  return true;
}
function micStop(){
  var voice=window.__coreaderVoice;
  if(voice && voice.state && voice.state.mic) voice.toggleMic();
  micSetRecordingUI(false);
  micSetStatus('\u0622\u0645\u0627\u062f\u0647 \u062e\u0637\u200c\u0628\u0631...');
}
window.toggleRecording=function(){
  if(typeof window.toggleGanjoorMic==='function' && _ganjoor){
    window.toggleGanjoorMic();
    return;
  }
  if(micIsListening()) micStop();
  else micStart();
};
window.toggleMic=function(){
  if(typeof window.toggleGanjoorMic==='function' && _ganjoor){
    window.toggleGanjoorMic();
    return;
  }
  if(!window.__coreaderVoice){ _toast('\u062e\u0637\u200c\u0628\u0631 \u0635\u0648\u062a\u06cc \u062f\u0631 \u0627\u06cc\u0646 \u0645\u0631\u0648\u0631\u06af\u0631 \u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u0646\u0645\u06cc\u200c\u0634\u0648\u062f'); return; }
  var micBar=document.getElementById('micBar');
  var bMic=document.getElementById('bMic');
  var open=!(micBar && micBar.classList.contains('on'));
  if(!open){
    // Closing the bar must never leave the microphone running behind it.
    micStop();
    if(micBar) micBar.classList.remove('on');
    if(bMic) bMic.classList.remove('on');
    return;
  }
  if(!micStart()) return;
  if(micBar) micBar.classList.add('on');
  if(bMic) bMic.classList.add('on');
};
/* Test hook: voice.js emits through the host; a headless check drives the same
 * entry point instead of faking recognition results. */
window.__coreaderViewerMic={ highlight:micHighlight, host:micHost, detect:detectLanguage };

window.toggleMagnifier=function(){
  _magOn=!_magOn;
  document.getElementById('bMag').classList.toggle('on',_magOn);
  var mag=document.getElementById('magnifier');
  if(_magOn){
    mag.style.display='block';
    var canvas=document.getElementById('magCanvas');
    canvas.width=_magSize; canvas.height=_magSize;
    _initMagMouse();
  } else {
    mag.style.display='none';
  }
};
window.showFavPanel=function(){
  var p=document.getElementById('favPanel');
  if(p){ p.classList.toggle('on'); if(p.classList.contains('on')) showFavTab('favs'); }
};
window.exportLocalData=function(){
  var data={};
  for(var i=0;i<localStorage.length;i++){
    var k=localStorage.key(i);
    if(k&&k.indexOf('coreader-')===0){
      data[k]=localStorage.getItem(k);
    }
  }
  var blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='coreader-backup-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  _toast('پشتیبان‌گیری انجام شد ✓');
};
window.importLocalData=async function(file){
  if(!file) return;
  // Importing overwrites everything, so this is the one place a guessed "yes"
  // would destroy data: the answer has to come back for real.
  if(await ctxAsk('confirm','داده‌های فعلی با اطلاعات این فایل جایگزین می‌شوند. مایل به ادامه هستید؟','')!==true) return;
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var data=JSON.parse(e.target.result);
      var count=0;
      Object.keys(data).forEach(function(k){
        if(k.indexOf('coreader-')===0){
          localStorage.setItem(k, data[k]);
          count++;
        }
      });
      _toast(toFA(count)+' مورد با موفقیت بازیابی شد ✓');
      setTimeout(function(){location.reload()},1000);
    }catch(err){
      ctxAsk('alert','فایل پشتیبان نامعتبر است: '+(err.message||err),'');
    }
  };
  reader.readAsText(file);
};

// === OSD zoom controls ===
window.zoomIn=function(){if(_osd)_osd.viewport.zoomBy(1.3,true)};
window.zoomOut=function(){if(_osd)_osd.viewport.zoomBy(0.77,true)};
window.exportAnnotations=function(){
  var favs=lsJSON('coreader-favs',[]);
  var notes=lsJSON('coreader-notes',[]);
  var hl=lsJSON('coreader-highlights',[]);
  var bm=lsJSON('coreader-bookmarks',[]);
  var s=['# خروجی حاشیه‌نویسی‌ها و یادداشت‌های کتابخانه CoReader',''];
  if(favs.length){
    s.push('## ⭐ علاقه‌مندی‌ها','');
    favs.forEach(function(f){s.push('- **'+f.book+'** صفحهٔ '+toFA(f.page),'  > '+f.text,'')});
  }
  if(notes.length){
    s.push('## 🗒️ یادداشت‌ها','');
    notes.forEach(function(n){s.push('- **'+n.book+'** صفحهٔ '+toFA(n.page),'  > '+n.text,'  📝 '+n.note,'')});
  }
  if(hl.length){
    s.push('## 🖍️ هایلایت‌ها','');
    hl.forEach(function(h){s.push('- **'+h.book+'** صفحهٔ '+toFA(h.page),'  > '+h.text,'')});
  }
  var blob=new Blob([s.join('\n')],{type:'text/markdown;charset=utf-8'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='coreader-export.md';
  a.click();

};

/* ============================================================
 * Image adjustment tools
 * ============================================================ */
var _adj = { brightness:1, contrast:1, saturation:1, hue:0, blur:0, invert:false };

window.toggleAdjustPanel = function(){
  var p = document.getElementById('adjustPanel');
  var o = document.getElementById('adjustOverlay');
  if(!p) return;
  var on = p.style.display === 'block';
  p.style.display = on ? 'none' : 'block';
  o.style.display = on ? 'none' : 'block';
};

window.applyFilters = function(){
  _adj.brightness = parseFloat(document.getElementById('adjBrightness').value);
  _adj.contrast  = parseFloat(document.getElementById('adjContrast').value);
  _adj.saturation = parseFloat(document.getElementById('adjSaturation').value);
  _adj.hue       = parseInt(document.getElementById('adjHue').value, 10);
  _adj.blur      = parseFloat(document.getElementById('adjBlur').value);
  _adj.invert    = document.getElementById('adjInvert').checked;
  // Update labels
  var $ = function(id){ return document.getElementById(id); };
  if($('adjBrightnessVal')) $('adjBrightnessVal').textContent = _adj.brightness.toFixed(1);
  if($('adjContrastVal'))   $('adjContrastVal').textContent  = _adj.contrast.toFixed(1);
  if($('adjSaturationVal')) $('adjSaturationVal').textContent = _adj.saturation.toFixed(1);
  if($('adjHueVal'))        $('adjHueVal').textContent       = toFA(_adj.hue);
  if($('adjBlurVal'))       $('adjBlurVal').textContent      = toFA(_adj.blur);
  // Apply CSS filter to OSD container
  var parts = [];
  if(_adj.brightness !== 1) parts.push('brightness(' + _adj.brightness + ')');
  if(_adj.contrast  !== 1) parts.push('contrast(' + _adj.contrast  + ')');
  if(_adj.saturation !== 1) parts.push('saturate(' + _adj.saturation + ')');
  if(_adj.hue       !== 0) parts.push('hue-rotate(' + _adj.hue + 'deg)');
  if(_adj.blur      !== 0) parts.push('blur(' + _adj.blur + 'px)');
  if(_adj.invert)        parts.push('invert(1)');
  var filterStr = parts.length ? parts.join(' ') : 'none';
  var c = document.getElementById('osd-container');
  if(c) c.style.filter = filterStr;
  else {
    // Fallback: apply to all images in container
    var imgs = document.querySelectorAll('#osd-container img, .osd-canvas-wrap');
    imgs.forEach(function(img){ img.style.filter = filterStr; });
  }
};

window.resetAdjustments = function(){
  _adj = { brightness:1, contrast:1, saturation:1, hue:0, blur:0, invert:false };
  var $ = function(id){ return document.getElementById(id); };
  if($('adjBrightness')) $('adjBrightness').value = 1;
  if($('adjContrast'))   $('adjContrast').value   = 1;
  if($('adjSaturation')) $('adjSaturation').value = 1;
  if($('adjHue'))        $('adjHue').value        = 0;
  if($('adjBlur'))       $('adjBlur').value       = 0;
  if($('adjInvert'))     $('adjInvert').checked   = false;
  applyFilters();
};

/* Load saved adjustments on book open */
function loadAdjustments(){
  if(!BOOK) return;
  try {
    var raw = localStorage.getItem('coreader-adj-' + BOOK.slug);
    if(raw) _adj = JSON.parse(raw);
  } catch(e){}
  var $ = function(id){ return document.getElementById(id); };
  if($('adjBrightness')) $('adjBrightness').value = _adj.brightness;
  if($('adjContrast'))   $('adjContrast').value   = _adj.contrast;
  if($('adjSaturation')) $('adjSaturation').value = _adj.saturation;
  if($('adjHue'))        $('adjHue').value        = _adj.hue;
  if($('adjBlur'))       $('adjBlur').value       = _adj.blur;
  if($('adjInvert'))     $('adjInvert').checked   = _adj.invert;
  applyFilters();
}

/* ============================================================
 * Presentation / drawing tools
 *
 * Screen-space overlay: canvas is position:fixed at viewport size, so stroke
 * coordinates are plain clientX/clientY - no OSD viewport math, and marks stay
 * put while the book pans/zooms underneath (presentation marks, not book
 * annotations).  Lazy binding: the canvas tag sits AFTER the scripts in
 * viewer.html, so an init IIFE at eval time found null and no listener ever
 * bound - tools changed the cursor and did nothing else.  Bind on first
 * setTool instead, when the DOM is certainly whole.
 * ============================================================ */
var _tool = 'cursor';
var _penColor = '#e04b4b';
var _penWidth = 3;
var _strokes = [];        // persisted marks: {type:'pen'|'hl'|'arrow', ...}
var _drawState = null;    // stroke in progress
var _presBound = false;
var _laserDot = null;

function _presCanvas(){ return document.getElementById('presCanvas'); }

function _sizeCanvas(){
  var cv=_presCanvas(); if(!cv) return null;
  var w=window.innerWidth, h=window.innerHeight;
  if(cv.width!==w||cv.height!==h){ cv.width=w; cv.height=h; }
  cv.style.width=w+'px'; cv.style.height=h+'px';
  return cv;
}

function _drawStroke(ctx, s){
  if(s.type==='arrow'){
    ctx.globalAlpha=1; ctx.strokeStyle=s.color||_penColor; ctx.lineWidth=s.w||_penWidth;
    ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.beginPath(); ctx.moveTo(s.x1,s.y1); ctx.lineTo(s.x2,s.y2); ctx.stroke();
    var a=Math.atan2(s.y2-s.y1, s.x2-s.x1), hl=12;
    ctx.beginPath();
    ctx.moveTo(s.x2,s.y2); ctx.lineTo(s.x2-hl*Math.cos(a-0.45), s.y2-hl*Math.sin(a-0.45));
    ctx.moveTo(s.x2,s.y2); ctx.lineTo(s.x2-hl*Math.cos(a+0.45), s.y2-hl*Math.sin(a+0.45));
    ctx.stroke();
    return;
  }
  var pts=s.pts; if(!pts||pts.length<2) return;
  ctx.lineCap='round'; ctx.lineJoin='round';
  if(s.type==='hl'){ ctx.globalAlpha=0.4; ctx.strokeStyle='#ffeb3b'; ctx.lineWidth=s.w||18; }
  else { ctx.globalAlpha=1; ctx.strokeStyle=s.color||_penColor; ctx.lineWidth=s.w||_penWidth; }
  ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
  for(var i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
  ctx.stroke();
  ctx.globalAlpha=1;
}

function _redrawCanvas(){
  var cv=_sizeCanvas(); if(!cv) return;
  var ctx=cv.getContext('2d');
  ctx.clearRect(0,0,cv.width,cv.height);
  for(var i=0;i<_strokes.length;i++) _drawStroke(ctx,_strokes[i]);
  if(_drawState) _drawStroke(ctx,_drawState);   // live preview while dragging
}

window.setTool=function(tool){
  _tool=tool;
  ['bCursor','bArrow','bPen','bHighlighter','bLaser'].forEach(function(id){
    var b=document.getElementById(id);
    if(b) b.classList.toggle('on', id.slice(1).toLowerCase()===tool);
  });
  var cv=_presCanvas(); if(!cv) return;
  _ensurePresBinding();
  cv.className='tool-'+tool;
  cv.style.display = tool==='cursor' ? 'none' : 'block';
  cv.style.pointerEvents = (tool==='cursor'||tool==='laser') ? 'none' : 'auto';
  if(tool!=='laser' && _laserDot){ _laserDot.remove(); _laserDot=null; }
  _redrawCanvas();
};

function _ensurePresBinding(){
  if(_presBound) return;
  var cv=_presCanvas(); if(!cv) return;
  _presBound=true;
  cv.addEventListener('mousedown', function(e){
    if(_tool==='cursor'||_tool==='laser') return;
    e.preventDefault();
    var p={x:e.clientX,y:e.clientY};
    if(_tool==='arrow') _drawState={type:'arrow',x1:p.x,y1:p.y,x2:p.x,y2:p.y,color:_penColor,w:_penWidth};
    else if(_tool==='pen') _drawState={type:'pen',pts:[p],color:_penColor,w:_penWidth};
    else if(_tool==='highlighter') _drawState={type:'hl',pts:[p],w:18};
    _redrawCanvas();
  });
  cv.addEventListener('mousemove', function(e){
    if(!_drawState) return;
    if(_drawState.type==='arrow'){ _drawState.x2=e.clientX; _drawState.y2=e.clientY; }
    else _drawState.pts.push({x:e.clientX,y:e.clientY});
    _redrawCanvas();
  });
  var finish=function(){
    if(!_drawState) return;
    var keep = _drawState.type==='arrow'
      ? (Math.abs(_drawState.x2-_drawState.x1)+Math.abs(_drawState.y2-_drawState.y1) > 6)
      : _drawState.pts.length>1;
    if(keep){ _strokes.push(_drawState); if(_strokes.length>200) _strokes.shift(); }
    _drawState=null;
    _redrawCanvas();
  };
  cv.addEventListener('mouseup', finish);
  cv.addEventListener('mouseleave', finish);
  // Laser: pointer-events:none on the canvas, so the dot follows on document.
  document.addEventListener('mousemove', function(e){
    if(_tool!=='laser') return;
    if(!_laserDot){ _laserDot=document.createElement('div'); _laserDot.className='laser-dot'; document.body.appendChild(_laserDot); }
    _laserDot.style.left=e.clientX+'px';
    _laserDot.style.top=e.clientY+'px';
  });
  window.addEventListener('resize', function(){ _redrawCanvas(); });
}

window.clearCanvas=function(){
  _strokes=[]; _drawState=null; _redrawCanvas();
  if(_laserDot){ _laserDot.remove(); _laserDot=null; }
};

/* Test/automation hook - the strokes array and tool state are file-private. */
window.__coreaderPres={
  strokes:function(){ return _strokes; },
  tool:function(){ return _tool; }
};

/* ============================================================
 * Save / load all per-book changes
 * ============================================================ */
window.saveAllChanges = function(){
  if(!BOOK) { _toast('کتابی بارگذاری نشده است'); return; }
  var key = 'coreader-all-' + BOOK.slug;
  var data = {
    adj: _adj,
    arrows: _strokes,
    page: window._curPage || 1,
    savedAt: new Date().toISOString()
  };
  try {
    localStorage.setItem(key, JSON.stringify(data));
    _toast('همه تغییرات ذخیره شد ✓');
  } catch(e){
    _toast('خطا در ذخیره‌سازی');
  }
};

window.loadAllChanges = function(){
  if(!BOOK) return;
  var key = 'coreader-all-' + BOOK.slug;
  try {
    var raw = localStorage.getItem(key);
    if(!raw) return;
    var data = JSON.parse(raw);
    if(data.adj){
      _adj = data.adj;
      var $ = function(id){ return document.getElementById(id); };
      if($('adjBrightness')) $('adjBrightness').value = _adj.brightness;
      if($('adjContrast'))   $('adjContrast').value   = _adj.contrast;
      if($('adjSaturation')) $('adjSaturation').value = _adj.saturation;
      if($('adjHue'))        $('adjHue').value        = _adj.hue;
      if($('adjBlur'))       $('adjBlur').value       = _adj.blur;
      if($('adjInvert'))     $('adjInvert').checked   = _adj.invert;
      applyFilters();
    }
    if(data.arrows) _strokes = data.arrows;
    if(data.page) goPage(data.page);
    _redrawCanvas();
  } catch(e){}
};


window.showFavTab=function(tab){
  document.querySelectorAll('.fav-tab').forEach(function(t){
    t.classList.toggle('on',
      tab==='favs'?t.textContent.indexOf('علاقه')>=0:
      tab==='notes'?t.textContent.indexOf('یادداشت')>=0:
      tab==='highlights'?t.textContent.indexOf('هایلایت')>=0:
      t.textContent.indexOf('نشانه')>=0
    );
  });
  var storageKey=(tab==='favs')?'coreader-favs':
                 (tab==='notes')?'coreader-notes':
                 (tab==='highlights')?'coreader-highlights':
                 'coreader-bookmarks';
  var list=JSON.parse(localStorage.getItem(storageKey)||'[]');
  var el=document.getElementById('favList');
  if(!list.length){
    el.innerHTML='<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px 0">موردی ثبت نشده است</div>';
    return;
  }
  el.innerHTML=list.map(function(f,i){
    return '<div class="fav-card" style="padding:10px 12px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;background:var(--cream,rgba(0,0,0,.03));font-size:13px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
      '<span style="color:var(--accent);font-weight:600;font-size:12px">'+(f.book?f.book+' · ':'')+'صفحهٔ '+toFA(f.page||1)+'</span>'+
      '<button onclick="delFavItem(\''+storageKey+'\','+i+')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px">✕</button>'+
      '</div>'+
      '<div style="line-height:1.6">'+((f.text||f.note||'').substring(0,200))+'</div>'+
      (f.note&&f.text?'<div style="margin-top:4px;font-size:12px;color:var(--accent-dark)">📝 '+f.note+'</div>':'')+
      '</div>';
  }).join('');
};
window.delFavItem=function(key,idx){
  var list=JSON.parse(localStorage.getItem(key)||'[]');
  list.splice(idx,1);
  localStorage.setItem(key,JSON.stringify(list));
  var tab=key==='coreader-favs'?'favs':key==='coreader-notes'?'notes':key==='coreader-highlights'?'highlights':'bookmarks';
  showFavTab(tab);
  _toast('حذف شد ✓');
};

// The context-menu actions above are already window properties.  Only the three
// that still live as plain functions need exporting, and ctxSearchEnc keeps its
// encyclopedia-panel behaviour rather than the reader's plain search.
window.applyEditStyle=applyEditStyle;
window.ctxSearchEnc=function(){_closeCtx();if(ctxSel)openEncPanel(ctxSel);};
window.ctxEditTextIiif=ctxEditTextIiif;window.annotateGlossary=annotateGlossary;window.loadGlossary=loadGlossary;

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
