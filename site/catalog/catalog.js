// catalog.js — museum home page logic
(function(){
'use strict';
var _books=[], _filter='all';

function init(){
  loadTheme();
  fetch('books-index.json').then(function(r){return r.json()}).then(function(list){
    // Merge custom books from localStorage
    var custom=JSON.parse(localStorage.getItem('coreader-custom-books')||'[]');
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
    var coverSrc=b.cover?(b.source==='local'?'books/'+b.slug+'/'+b.cover:'books/'+b.slug+'/cover.webp'):'';
    var coverEl=coverSrc?'<img class="card-cover" src="'+coverSrc+'" alt="'+(b.title||'')+'" loading="lazy" onerror="this.style.display=\'none\'">':'<div class="card-cover" style="display:flex;align-items:center;justify-content:center;font-size:48px;opacity:.3">📖</div>';
    var badge=b.source==='iiif'?'<span class="source-badge iiif">IIIF</span>':'<span class="source-badge local">محلی</span>';
    var provider=b.provider?' · '+b.provider:'';
    var href=(b.source==='iiif'?'viewer/viewer.html?book=':'reader/reader.html?book=')+encodeURIComponent(b.slug);
    return '<a class="card" href="'+href+'" style="animation-delay:'+(i*0.05)+'s">'+
      coverEl+'<div class="card-body">'+
      '<h2>'+b.title+'</h2>'+
      '<div class="author">'+(b.author||'ناشناس')+'</div>'+
      '<div class="meta">'+badge+'<span>'+b.pages+' صفحه'+provider+'</span></div>'+
      pbar+'</div></a>';
  }).join('');
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
  // Generic: try fetching as JSON, check if it's a IIIF manifest
  return fetch(u).then(function(r){
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }).then(function(data){
    if(data['@context'] && data['@context'].indexOf('iiif')>=0) return u;
    if(data.items || data.sequences) return u;
    throw new Error('URL is not a IIIF manifest');
  });
}

// IIIF manifest fetch
window.fetchIiifManifest=function(){
  var inputUrl=document.getElementById('iiifUrl').value.trim();
  if(!inputUrl){alert('آدرس را وارد کنید');return}
  var log=document.getElementById('addLog');
  log.classList.add('on');log.textContent='در حال تحلیل آدرس...\n';
  resolveManifestUrl(inputUrl).then(function(manifestUrl){
    if(manifestUrl!==inputUrl) log.textContent+='آدرس مانیفست: '+manifestUrl+'\n';
    log.textContent+='در حال دریافت manifest...\n';
    return fetch(manifestUrl).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(m){
      var label=m.label||'';if(Array.isArray(label))label=label.join(' ');
      var summary=m.summary||'';if(Array.isArray(summary))summary=summary.join(' ');
      var prov=m.provider&&m.provider[0]?m.provider[0].label:'';if(Array.isArray(prov))prov=Array.isArray(prov)?prov.join(' '):prov;
      var pages=(m.items||[]).length;
      if(!pages && m.sequences && m.sequences[0]) pages=(m.sequences[0].canvases||[]).length;
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
      externalLinks.iiifManifest=manifestUrl;
      log.textContent+='عنوان: '+label+'\nتعداد صفحات: '+pages+'\nمنبع: '+prov+'\n\n✓ manifest معتبر است.\n';
      window._pendingManifest={url:manifestUrl,data:m,label:label,summary:summary,provider:prov,pages:pages,externalLinks:externalLinks};
      document.getElementById('bSaveIiif').disabled=false;
    });
  }).catch(function(e){
    log.textContent+='خطا: '+e.message+'\n\nلینک‌های پشتیبانی شده:\n'+
          '• https://digital.bodleian.ox.ac.uk/objects/<uuid>/\n'+
          '• https://digital.bodleian.ox.ac.uk/objects/<uuid>/surfaces/<id>/\n'+
          '• https://iiif.bodleian.ox.ac.uk/iiif/manifest/<uuid>.json\n'+
          '• https://eap.bl.uk/archive-file/<id>\n'+
          '• https://www.digitale-sammlungen.de/iiif/...manifest\n'+
          '• هر آدرس manifest IIIF مستقیم\n';
  });
};
window.saveIiifBook=function(){
  var pm=window._pendingManifest;if(!pm)return;
  var slug=(pm.label||'iiif').replace(/[^\w\u0600-\u06FF]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'iiif-'+Date.now();
  // Save to localStorage
  var custom=JSON.parse(localStorage.getItem('coreader-custom-books')||'[]');
  custom.push({
    slug:slug,title:pm.label,author:pm.summary||'ناشناس',
    source:'iiif',provider:pm.provider||'IIIF',
    manifestUrl:pm.url,pages:pm.pages,cover:'',
    externalLinks:pm.externalLinks||{iiifManifest:pm.url}
  });
  localStorage.setItem('coreader-custom-books',JSON.stringify(custom));
  var log=document.getElementById('addLog');
  log.textContent+='\n✓ کتاب «'+pm.label+'» ذخیره شد.\n';
  window._pendingManifest=null;document.getElementById('bSaveIiif').disabled=true;
  // Reload page to show new book
  setTimeout(function(){location.reload()},1000);
};

// Local file upload
var _txtFile=null,_pdfFiles=[];
window.onTxtChosen=function(files){_txtFile=files[0]||null;document.getElementById('txtFileList').textContent=_txtFile?_txtFile.name:''};
window.onPdfChosen=function(files){_pdfFiles=Array.from(files);document.getElementById('pdfFileList').innerHTML=_pdfFiles.map(function(f){return '<div>📄 '+f.name+'</div>'}).join('')};

window.saveLocalBook=function(){
  var title=(document.getElementById('fTitle').value||'').trim();
  var author=(document.getElementById('fAuthor').value||'').trim();
  if(!title){alert('عنوان کتاب را وارد کنید');return}
  if(!_txtFile && !_pdfFiles.length){alert('یک فایل متنی یا PDF انتخاب کنید');return}
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

