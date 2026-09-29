// catalog.js — museum home page logic
(function(){
'use strict';
var _books=[], _filter='iiif';

function init(){
  loadTheme();
  // Read filter from URL query param or hash
  var params=new URLSearchParams(location.search);
  var qf=params.get('filter');
  var hash=location.hash.slice(1);
  var f=qf||hash;
  if(f && /^(all|iiif|museum|local)$/.test(f)){
    _filter=f;
    document.querySelectorAll('.filter-tab').forEach(function(t){
      t.classList.toggle('on', t.dataset.filter===_filter);
    });
  }
  fetch('books-index.json').then(function(r){return r.json()}).then(function(list){
    // Merge custom books from localStorage, but only if slug not already in index (index has better metadata)
    var custom=JSON.parse(localStorage.getItem('coreader-custom-books')||'[]');
    var indexSlugs={};list.forEach(function(b){indexSlugs[b.slug]=1});
    // Drop any custom book whose manifestUrl matches an index book (same source — use index version)
    custom=custom.filter(function(c){return !indexSlugs[c.slug] && !Object.keys(indexSlugs).some(function(k){return list.find(function(b){return b.manifestUrl===c.manifestUrl})})});
    _books=list.concat(custom);
    document.getElementById('skeletonGrid').style.display='none';
    document.getElementById('grid').style.display='';
    render();
  }).catch(function(){
    document.getElementById('skeletonGrid').style.display='none';
    document.getElementById('grid').style.display='';
    document.getElementById('grid').innerHTML='<div class="empty">خطا در بارگذاری فهرست کتاب‌ها</div>';
  });
  document.querySelectorAll('.filter-tab').forEach(function(t){
    t.addEventListener('click',function(){
      document.querySelectorAll('.filter-tab').forEach(function(x){x.classList.remove('on')});
      t.classList.add('on'); _filter=t.dataset.filter; render();
    });
  });
  document.getElementById('searchInput').addEventListener('input',function(){render()});
}

function render(){
  var q=(document.getElementById('searchInput').value||'').trim().toLowerCase();
  var list=_books.filter(function(b){
    if(_filter!=='all' && b.source!==_filter) return false;
    if(!q) return true;
    return (b.title||'').toLowerCase().indexOf(q)>=0 || (b.author||'').toLowerCase().indexOf(q)>=0;
  });
  var grid=document.getElementById('grid');
  if(!list.length){ grid.innerHTML='<div class="empty">کتابی یافت نشد</div>'; return; }
  var progress={};
  try{progress=JSON.parse(localStorage.getItem('coreader-progress')||'{}')}catch(e){}
  grid.innerHTML=list.map(function(b,i){
    var pg=progress[b.slug]||0;
    var pct=b.pages?Math.min(100,Math.round(pg/b.pages*100)):0;
    var pbar=pct>0?'<div class="card-progress"><div class="card-progress-bar" style="width:'+pct+'%"></div></div><div class="card-progress-text">'+pct+'% خوانده شده</div>':'';
    var coverSrc=b.cover?('books/'+b.slug+'/'+b.cover):'';
    if(!coverSrc && b.thumbnail){var t0=Array.isArray(b.thumbnail)?b.thumbnail[0]:b.thumbnail; coverSrc=t0;}
    var coverImg=coverSrc?'<img class="card-cover" src="'+coverSrc+'" alt="'+(b.title||'')+'" loading="lazy" onerror="this.remove()">':'';
    var fallback='<div class="card-cover-fallback"><span class="book-icon">📖</span><span class="book-title-fa">'+(b.title||'')+'</span></div>';
    var slides='';
    if(b.thumbnail){
      var thumbs=Array.isArray(b.thumbnail)?b.thumbnail:[b.thumbnail];
      slides=thumbs.slice(0,5).map(function(url,si){
        return '<div class="slide'+(si===0?' active':'')+'"><img src="'+url+'" alt="" loading="lazy"></div>';
      }).join('');
    }
    var slideshow=slides?'<div class="card-slideshow">'+slides+'</div>':'';
    var badge=b.source==='iiif'?'<span class="source-badge iiif">IIIF</span>':(b.source==='museum'?'<span class="source-badge museum">موزه</span>':'<span class="source-badge local">ذخیره‌شده</span>');
    var provider=b.provider?' · '+b.provider:'';
    var href=(b.source==='local'?'reader/reader.html?book=':'viewer/viewer.html?book=')+encodeURIComponent(b.slug);
    return '<a class="card" href="'+href+'" style="animation-delay:'+(i*0.05)+'s" data-slug="'+b.slug+'">'+
      '<div class="card-cover-wrap">'+coverImg+fallback+slideshow+      '<div class="card-cover-title">'+(b.title||'')+'</div></div>'+
      '<div class="card-body">'+
      '<h2>'+b.title+'</h2>'+
      '<div class="author">'+(b.author||'ناشناس')+'</div>'+
      '<div class="meta">'+badge+'<span>'+b.pages+' صفحه'+provider+'</span></div>'+
      pbar+'</div></a>';
  }).join('');
  initSlideshows();
}

var _slideIntervals={};
function initSlideshows(){
  document.querySelectorAll('.card').forEach(function(card){
    var slug=card.dataset.slug;
    var ss=card.querySelector('.card-slideshow');
    if(!ss) return;
    var slides=ss.querySelectorAll('.slide');
    if(slides.length<2) return;
    var idx=0;
    card.addEventListener('mouseenter',function(){
      _slideIntervals[slug]=setInterval(function(){
        slides[idx].classList.remove('active');
        idx=(idx+1)%slides.length;
        slides[idx].classList.add('active');
      },2000);
    });
    card.addEventListener('mouseleave',function(){
      clearInterval(_slideIntervals[slug]);
      slides.forEach(function(s){s.classList.remove('active')});
      if(slides[0]) slides[0].classList.add('active');
    });
  });
}
function loadTheme(){var t=localStorage.getItem('coreader-theme');if(t)document.body.className=t;updateThemeDots()}
function setTheme(cls){document.body.className=cls;localStorage.setItem('coreader-theme',cls);updateThemeDots()}
function updateThemeDots(){var cur=document.body.className||'';document.querySelectorAll('.theme-dot').forEach(function(d){d.classList.toggle('on',d.dataset.theme===cur)})}
window.setTheme=setTheme;
window.openAddModal=function(){document.getElementById('addOverlay').classList.add('on')};
window.closeAddModal=function(){document.getElementById('addOverlay').classList.remove('on')};
window.switchTab=function(name){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.toggle('on',t.dataset.tab===name)});
  document.querySelectorAll('.tabpane').forEach(function(p){p.classList.toggle('on',p.id==='tab-'+name)});
  // Toggle save buttons
  var iiifBtn=document.getElementById('bSaveIiif');
  var localBtn=document.getElementById('bSaveLocal');
  if(iiifBtn&&localBtn){iiifBtn.style.display=name==='iiif'?'':'none';localBtn.style.display=name==='local'?'':'none';}
};

// Normalize any IIIF label shape to plain text:
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
    var pref=['en','@en','fa','@fa','per','@per'];
    var i,k;
    for(i=0;i<pref.length;i++){ if(Array.isArray(v[pref[i]]) && v[pref[i]].length) return iiifLabel(v[pref[i]]); }
    var keys=Object.keys(v);
    for(i=0;i<keys.length;i++){ k=keys[i]; if(Array.isArray(v[k]) && v[k].length) return iiifLabel(v[k]); }
    if(v['@value']) return String(v['@value']);
    return '';
  }
  return String(v);
}
window.iiifLabel=iiifLabel;

// Resolve any URL to a IIIF manifest URL
function resolveManifestUrl(inputUrl){
  var u=inputUrl.trim();
  // Remove hash fragments only (preserve query params for EAP manifests)
  u=u.split('#')[0];
  // Already a manifest URL
  if(u.indexOf('/iiif/manifest/')>=0 && u.match(/\.json$/)) return Promise.resolve(u);
  // Bodleian object URL: /objects/<uuid>/ or /objects/<uuid>/surfaces/<id>/
  var bodObj=u.match(/digital\.bodleian\.ox\.ac\.uk\/objects\/([a-f0-9-]+)/);
  if(bodObj) return Promise.resolve('https://iiif.bodleian.ox.ac.uk/iiif/manifest/'+bodObj[1]+'.json');
  // Bodleian info.json → manifest
  var bodInfo=u.match(/iiif\.bodleian\.ox\.ac\.uk\/iiif\/info\/([a-f0-9-]+)\/info\.json/);
  if(bodInfo) return Promise.resolve('https://iiif.bodleian.ox.ac.uk/iiif/manifest/'+bodInfo[1]+'.json');
  // BSB manifest URL
  if(u.indexOf('digitale-sammlungen.de/iiif/')>=0 && u.match(/manifest$/)) return Promise.resolve(u);
  // EAP (British Library) archive-file URL → manifest
  var eapMatch=u.match(/eap\.bl\.uk\/archive-file\/([A-Za-z0-9-]+)(?:\/|$|\?)/);
  if(eapMatch) return Promise.resolve('https://eap.bl.uk/archive-file/'+eapMatch[1]+'/manifest?manifest=https://eap.bl.uk/archive-file/'+eapMatch[1]+'/manifest');
  // Library of Congress — manifest URL itself
  var locMan=u.match(/loc\.gov\/(?:item|resource)\/[A-Za-z0-9._:-]+\/manifest\.json/);
  if(locMan) return Promise.resolve(u);
  // LOC item page → manifest (verified: item manifests are CORS-readable)
  var locItem=u.match(/loc\.gov\/item\/([A-Za-z0-9._-]+)\/?$/);
  if(locItem) return Promise.resolve('https://www.loc.gov/item/'+locItem[1]+'/manifest.json');
  // LOC resource page (e.g. gdcwdl.wdl_NNNNN) → resource manifest (LOC's own IIIF link)
  var locRes=u.match(/(loc\.gov\/resource\/[A-Za-z0-9._:-]+)\/?$/);
  if(locRes) return Promise.resolve('https://www.'+locRes[1]+'/manifest.json');
  // LOC handle (hdl.loc.gov/loc.wdl/wdl.NNNNN) → resource manifest
  var locHdl=u.match(/hdl\.loc\.gov\/loc\.wdl\/wdl\.(\d+)/);
  if(locHdl) return Promise.resolve('https://www.loc.gov/resource/gdcwdl.wdl_'+locHdl[1]+'/manifest.json');
  // Generic: try fetching as JSON, check if it's a IIIF manifest
  return fetchManifestJson(u).then(function(data){
    if(data['@context'] && data['@context'].indexOf('iiif')>=0) return u;
    if(data.items || data.sequences) return u;
    throw new Error('URL is not a IIIF manifest');
  });
}

// Fetch a manifest JSON. loc.gov blocks cross-origin fetch() (Cloudflare),
// so route it through the local server proxy (headless-Chrome backed).
function isLocUrl(u){ return /^(https?:)?\/\/([^/]+\.)?loc\.gov\//.test(u) || /^\/proxy-manifest\?url=/.test(u) && /loc\.gov/.test(u); }
function fetchManifestJson(u){
  var target=isLocUrl(u)?('/proxy-manifest?url='+encodeURIComponent(u)):u;
  return fetch(target).then(function(r){
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  });
}

// IIIF manifest fetch
window.fetchIiifManifest=function(){
  var inputUrl=document.getElementById('iiifUrl').value.trim();
  var log=document.getElementById('addLog');
  if(!inputUrl){log.classList.add('on');log.textContent='آدرس را وارد کنید\n';return}
  log.classList.add('on');log.textContent='در حال تحلیل آدرس...\n';
  resolveManifestUrl(inputUrl).then(function(manifestUrl){
    if(manifestUrl!==inputUrl) log.textContent+='آدرس مانیفست: '+manifestUrl+'\n';
    log.textContent+='در حال دریافت manifest...\n';
    return fetchManifestJson(manifestUrl).then(function(m){
      var label=iiifLabel(m.label);
      var summary=iiifLabel(m.summary);
      var prov=iiifLabel(Array.isArray(m.provider)?m.provider[0]:m.provider)||String(m.attribution||'').replace(/^Provided by\s+/i,'');
      var pages=(m.items||[]).length;
      if(!pages && m.sequences && m.sequences[0]) pages=(m.sequences[0].canvases||[]).length;
      // Thumbnails for catalog card (v3 canvas.thumbnail / v2 manifest or canvas thumbnail)
      var thumbs=[];
      function pushThumb(t){
        var url=(typeof t==='string')?t:(t&&(t.id||t['@id']))||'';
        if(url.indexOf('/full/')>=0) url=url.replace(/\/full\/[^/]+\//,'/full/!400,400/');
        if(url && thumbs.indexOf(url)<0 && thumbs.length<6) thumbs.push(url);
      }
      if(m.thumbnail) pushThumb(Array.isArray(m.thumbnail)?m.thumbnail[0]:m.thumbnail);
      (m.items||[]).slice(0,6).forEach(function(it){
        if(it.thumbnail) pushThumb(Array.isArray(it.thumbnail)?it.thumbnail[0]:it.thumbnail);
        else{
          var ap=it.items&&it.items[0], an=ap&&ap.items&&ap.items[0], body=an&&an.body;
          var img=Array.isArray(body)?body[0]:body;
          if(img&&img.id&&/\/full\//.test(img.id)) pushThumb(img.id.replace(/\/full\/[^/]+\//,'/full/!400,400/'));
        }
      });
      if(!thumbs.length && m.sequences && m.sequences[0] && m.sequences[0].canvases){
        m.sequences[0].canvases.slice(0,6).forEach(function(c){
          if(c.thumbnail) pushThumb(Array.isArray(c.thumbnail)?c.thumbnail[0]:c.thumbnail);
          else{
            var res=c.images&&c.images[0]&&c.images[0].resource;
            var id=res&&(res['@id']||res.id);
            if(id&&/\/full\//.test(id)) pushThumb(id.replace(/\/full\/[^/]+\//,'/full/!400,400/'));
          }
        });
      }
      // Extract external links based on provider
      var externalLinks={};
      // Bodleian
      var bodUuid=manifestUrl.match(/manifest\/([a-f0-9-]+)\.json/);
      if(bodUuid && manifestUrl.indexOf('bodleian')>=0){
        var oid=bodUuid[1];
        externalLinks.digitalObject='https://digital.bodleian.ox.ac.uk/objects/'+oid+'/';
        externalLinks.mirador='https://iiif.bodleian.ox.ac.uk/iiif/mirador/?iiif-content='+encodeURIComponent(manifestUrl);
        externalLinks.universalViewer='https://iiif.bodleian.ox.ac.uk/iiif/viewer/?iiif-content='+encodeURIComponent(manifestUrl);
        externalLinks.embed='https://digital.bodleian.ox.ac.uk/embed/iframe/?url='+encodeURIComponent('https://digital.bodleian.ox.ac.uk/objects/'+oid+'/');
      }
      // BSB
      if(manifestUrl.indexOf('digitale-sammlungen.de')>=0){
        var bsbMatch=manifestUrl.match(/bsb(\d+)/);
        if(bsbMatch) externalLinks.digitalObject='https://api.digitale-sammlungen.de/view/'+bsbMatch[1];
      }
      // EAP
      var eapId=manifestUrl.match(/eap\.bl\.uk\/archive-file\/([A-Za-z0-9-]+)/);
      if(eapId) externalLinks.digitalObject='https://eap.bl.uk/archive-file/'+eapId[1];
      // Library of Congress
      var locId=manifestUrl.match(/loc\.gov\/item\/([A-Za-z0-9._-]+)\/manifest\.json/);
      if(locId) externalLinks.digitalObject='https://www.loc.gov/item/'+locId[1]+'/';
      externalLinks.iiifManifest=manifestUrl;
      log.textContent+='عنوان: '+label+'\nتعداد صفحات: '+pages+'\nمنبع: '+prov+'\n\n✓ manifest معتبر است.\n';
      window._pendingManifest={url:manifestUrl,data:m,label:label,summary:summary,provider:prov,pages:pages,thumbnail:thumbs,externalLinks:externalLinks};
      document.getElementById('bSaveIiif').disabled=false;
    });
  }).catch(function(e){
    log.textContent+='خطا: '+e.message+'\n\nلینک‌های پشتیبانی شده:\n'+
          '• https://digital.bodleian.ox.ac.uk/objects/<uuid>/\n'+
          '• https://digital.bodleian.ox.ac.uk/objects/<uuid>/surfaces/<id>/\n'+
          '• https://iiif.bodleian.ox.ac.uk/iiif/manifest/<uuid>.json\n'+
          '• https://eap.bl.uk/archive-file/<id>\n'+
          '• https://www.digitale-sammlungen.de/iiif/...manifest\n'+
          '• https://www.loc.gov/resource/gdcwdl.wdl_<id>/\n'+
          '• https://www.loc.gov/item/wdl_<id>/\n'+
          '• https://www.loc.gov/item/wdl_<id>/manifest.json\n'+
          '• https://hdl.loc.gov/loc.wdl/wdl.<id>\n'+
          '• هر آدرس manifest IIIF مستقیم\n';
  });
};
window.saveIiifBook=function(){
  var pm=window._pendingManifest;if(!pm)return;
  var title=iiifLabel(pm.label)||'کتاب IIIF';
  var slug=title.replace(/[^\w؀-ۿ]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'iiif-'+Date.now();
  // Save to localStorage
  var custom=JSON.parse(localStorage.getItem('coreader-custom-books')||'[]');
  if(custom.find(function(b){return b.slug===slug})) slug=slug+'-'+Date.now();
  var kindEl=document.getElementById('iiifKind');
  var kind=(kindEl&&kindEl.value==='museum')?'museum':'iiif';
  var entry={
    slug:slug,title:title,author:iiifLabel(pm.summary)||'ناشناس',
    source:kind,provider:iiifLabel(pm.provider)||'IIIF',
    manifestUrl:pm.url,pages:pm.pages,cover:'',
    thumbnail:pm.thumbnail||[],
    externalLinks:pm.externalLinks||{iiifManifest:pm.url}
  };
  var log=document.getElementById('addLog');
  // Cache manifest into site/books/<slug>/manifest.json (local server only) —
  // saved book then works offline and after deploy, without any proxy.
  fetch('/cache-manifest?slug='+encodeURIComponent(slug),{method:'POST',body:JSON.stringify(pm.data)})
    .catch(function(){return null})
    .then(function(r){ return (r&&r.ok)?r.json().catch(function(){return null}):null; })
    .then(function(j){
      if(j&&j.path) entry.manifestUrl=j.path;
      custom.push(entry);
      localStorage.setItem('coreader-custom-books',JSON.stringify(custom));
      log.textContent+='\n✓ کتاب «'+title+'» ذخیره شد'+(j&&j.path?' (مانیفست در پروژه کش شد)':'')+'.\n';
      window._pendingManifest=null;document.getElementById('bSaveIiif').disabled=true;
      setTimeout(function(){location.reload()},1200);
    });
};

// Local file upload
var _txtFile=null,_pdfFiles=[];
window.onTxtChosen=function(files){_txtFile=files[0]||null;document.getElementById('txtFileList').textContent=_txtFile?_txtFile.name:''};
window.onPdfChosen=function(files){_pdfFiles=Array.from(files);document.getElementById('pdfFileList').innerHTML=_pdfFiles.map(function(f){return '<div>📄 '+f.name+'</div>'}).join('')};

window.saveLocalBook=function(){
  var title=(document.getElementById('fTitle').value||'').trim();
  var author=(document.getElementById('fAuthor').value||'').trim();
  if(!title||(!_txtFile && !_pdfFiles.length)){
    var lg=document.getElementById('addLog');lg.classList.add('on');
    lg.textContent=(!title?'عنوان کتاب را وارد کنید\n':'')+
      (!_txtFile && !_pdfFiles.length?'یک فایل متنی یا PDF انتخاب کنید\n':'');
    return;
  }
  var log=document.getElementById('addLog');
  log.classList.add('on'); log.textContent='در حال پردازش...\n';
  var slug=title.replace(/[^\w\u0600-\u06FF]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'local-'+Date.now();
  // Check duplicate slug
  var custom=JSON.parse(localStorage.getItem('coreader-custom-books')||'[]');
  if(custom.concat(JSON.parse(localStorage.getItem('coreader-local-books')||'[]')).find(function(b){return b.slug===slug})){
    slug=slug+'-'+Date.now();
  }

  function finish(pages,pdfSources){
    var bookData={
      slug:slug,title:title,author:author||'ناشناس',
      chapters:[],pages:pages,searchIndex:[],candidateCount:0,cover:'',
      hasPdf:pdfSources&&pdfSources.length>0,
      pdfSources:pdfSources||[]
    };
    // Store book data in localStorage
    var localBooks=JSON.parse(localStorage.getItem('coreader-local-books')||'{}');
    localBooks[slug]=bookData;
    localStorage.setItem('coreader-local-books',JSON.stringify(localBooks));
    // Add to custom books list for catalog
    custom.push({
      slug:slug,title:title,author:author||'ناشناس',
      source:'local',pages:pages.length,cover:''
    });
    localStorage.setItem('coreader-custom-books',JSON.stringify(custom));
    log.textContent+='\n✓ کتاب «'+title+'» ذخیره شد ('+pages.length+' صفحه).\n';
    setTimeout(function(){location.reload()},1000);
  }

  if(_txtFile){
    var reader=new FileReader();
    reader.onload=function(e){
      var text=e.target.result;
      // Split into pages by form feed or double newline chunks
      var raw=text.split(/\f|\n{3,}/);
      if(raw.length<=1){
        // No form feeds — split by ~3000 chars
        raw=[];var chunk=3000;
        for(var i=0;i<text.length;i+=chunk) raw.push(text.substring(i,i+chunk));
      }
      var pages=raw.filter(function(t){return t.trim()}).map(function(t,i){
        return{page:i+1,html:'<div class="page-content"><p>'+t.trim().replace(/\n/g,'<br>')+'</p></div>'};
      });
      log.textContent+='متن: '+pages.length+' صفحه\n';
      // Process PDFs if any
      if(_pdfFiles.length) processPdfs(pages); else finish(pages,null);
    };
    reader.readAsText(_txtFile);
  } else {
    processPdfs([]);
  }

  function processPdfs(existingPages){
    // For PDFs, just store file names — reader loads them from /books/<slug>/
    // But since we're in browser-only mode, we store PDFs as base64 in localStorage
    var pdfSources=[];
    var done=0;
    var totalPages=existingPages.slice();
    _pdfFiles.forEach(function(f,idx){
      var r=new FileReader();
      r.onload=function(ev){
        // Store PDF as data URL (limited by localStorage ~5MB)
        var dataUrl=ev.target.result;
        if(dataUrl.length>4*1024*1024){
          log.textContent+='⚠ '+f.name+' بزرگتر از 4MB است — فقط ذخیره شد\n';
        }
        pdfSources.push({id:'pdf_'+(idx+1),label:f.name,filename:'pdf_'+(idx+1)+'.pdf',dataUrl:dataUrl});
        done++;
        if(done===_pdfFiles.length){
          // If no text file, create empty pages from PDF page count
          if(!existingPages.length && pdfSources.length){
            // Try to count pages via pdf.js
            if(typeof pdfjsLib!=='undefined'){
              pdfjsLib.getDocument({data:Uint8Array.from(atob(dataUrl.split(',')[1]),function(c){return c.charCodeAt(0)})}).promise.then(function(doc){
                var pdfPages=[];for(var i=1;i<=doc.numPages;i++) pdfPages.push({page:i,html:'<div class="page-content"><p style="color:#999">صفحه '+i+' — متن از PDF استخراج نشد</p></div>'});
                finish(pdfPages,pdfSources);
              }).catch(function(){finish([],pdfSources)});
            } else { finish([],pdfSources); }
          } else { finish(totalPages,pdfSources); }
        }
      };
      r.readAsDataURL(f);
    });
  }
};

document.addEventListener('DOMContentLoaded',init);
})();

