/* iiif-editor.js — ادیتور فارسی IIIF: رونویسی، مقابله، حاشیه، خروجی
   الگو: Minna de Honkoku (رونویسی جمعی، وضعیت، diff، ترجمه، API باز) */
(function(){
'use strict';
function $(id){ return document.getElementById(id); }
function lsGet(k,d){ try{var v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch(e){return d;} }
function lsSet(k,v){ try{localStorage.setItem(k,JSON.stringify(v));return true;}catch(e){return false;} }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function apiBase(){ return location.pathname.indexOf('/panel/')>=0 ? location.pathname.split('/panel/')[0] : ''; }

var pages=[]; // {img, thumb, label, text, tr, tag, status}
var cur=0, prjId=null, manifestUrl='';
var viewer=null, fallbackImg=null;

/* ---------- manifest parsing (v2/v3) ---------- */
function imgOfV3(canvas){
  try{
    var body=canvas.items[0].items[0].body;
    if(body.service){ var s=Array.isArray(body.service)?body.service[0]:body.service; var id=s.id||s['@id']; if(id) return id.replace(/\/$/,'')+'/full/max/0/default.jpg'; }
    if(body.id) return body.id;
  }catch(e){}
  return null;
}
function parseManifest(m){
  var out=[];
  var seq=(m.sequences&&m.sequences[0]&&m.sequences[0].canvases)||m.items||[];
  seq.forEach(function(c,i){
    var img=null,thumb=null,label='برگ '+(i+1);
    if(c.images){ // v2
      try{ var r=c.images[0].resource; img=r.service?(r.service['@id']+'/full/full/0/default.jpg'):(r['@id']||r.id); thumb=r.service?(r.service['@id']+'/full/!200,200/0/default.jpg'):img; }catch(e){}
      label=(c.label)||label;
    } else { // v3
      img=imgOfV3(c);
      try{ thumb=(c.thumbnail&&c.thumbnail[0]&&c.thumbnail[0].id)||img; }catch(e){ thumb=img; }
      try{ var l=c.label; label=(l&&((l.fa&&l.fa[0])||(l.en&&l.en[0])))||label; }catch(e){}
    }
    if(img) out.push({img:img,thumb:thumb||img,label:String(label),text:'',tr:'',tag:'',status:'raw',flag:false,regions:[],
      cw:(c.width||0),ch:(c.height||0)});
  });
  return out;
}
async function fetchManifest(url){
  var r=await fetch(url);
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}
async function loadManifest(url){
  manifestUrl=url;
  var m;
  try{ m=await fetchManifest(url); }
  catch(e){
    // تلاش دوم از پروکسی همین سایت (رفع CORS برای هاست‌های مجاز)
    m=await fetchManifest(apiBase()+'/proxy-manifest?url='+encodeURIComponent(url));
  }
  pages=parseManifest(m);
  if(!pages.length) throw new Error('canvas');
  cur=0; regionMode(false); bookView=false; rotation=0;
  $('edFilterBar').hidden=false;
  prefillMeta(m); loadExtras();
  renderThumbs(); renderPage(); fillCollate(); renderTools(); renderMeta(); renderRanges(); renderSteps();
  // اگر پروژه پنل لینک شده، متن‌های ذخیره‌شده را بگذار
  if(prjId){ var ps=lsGet('coreader-iiif-projects',[]); var p=ps.filter(function(x){return x.id===prjId;})[0];
    if(p&&p.annos){ p.annos.forEach(function(a){ var i=pages.findIndex(function(pg){return pg.label===String(a.canvas);}) ;
      if(i<0 && /^\d+$/.test(a.canvas)) i=(+a.canvas)-1;
      if(i>=0&&pages[i]){ pages[i].text=a.text||pages[i].text; pages[i].tr=a.translation||pages[i].tr; pages[i].tag=a.tag||pages[i].tag; pages[i].status='review'; } }); renderPage(); } }
  loadGroup();
}

/* ---------- image view ---------- */
function showImage(){
  var box=$('edImgBox');
  var src=pages[cur]?pages[cur].img:'';
  if(window.OpenSeadragon && src){
    try{
      if(viewer){ viewer.destroy(); viewer=null; }
      $('osd').innerHTML='';
      viewer=OpenSeadragon({element:$('osd'),tileSources:{type:'image',url:src},showNavigator:true,rtl:true});
      if(fallbackImg){ fallbackImg.remove(); fallbackImg=null; }
      return;
    }catch(e){}
  }
  if(viewer){ try{viewer.destroy();}catch(e){} viewer=null; }
  if(!fallbackImg){ fallbackImg=document.createElement('img'); fallbackImg.className='osd-fallback'; fallbackImg.alt=''; box.appendChild(fallbackImg); }
  fallbackImg.src=src||'';
}

/* ---------- page UI ---------- */
function pageVisible(p){
  var f=$('edFilter')?$('edFilter').value:'all';
  if(f==='todo') return !(p.text||'').trim();
  if(f==='review') return p.status==='review';
  if(f==='done') return p.status==='done';
  if(f==='flag') return !!p.flag;
  return true;
}
function renderThumbs(){
  var t=$('edThumbs'); t.hidden=false;
  var html='';
  pages.forEach(function(p,i){
    if(!pageVisible(p)) return;
    html+='<span style="position:relative;flex-shrink:0;display:inline-block">'
      +'<img data-i="'+i+'" src="'+esc(p.thumb)+'" class="'+(i===cur?'on':'')+'" loading="lazy" alt="'+esc(p.label)+'" style="'+(p.flag?'border-color:#e5484d':'')+'">'
      +(p.flag?'<span style="position:absolute;top:2px;left:2px;font-size:14px">🚩</span>':'')
      +((p.text||'').trim()?'<span style="position:absolute;bottom:2px;right:2px;font-size:12px">✅</span>':'')
      +'</span>';
  });
  t.innerHTML=html||'<span class="kv">برگی با این فیلتر نیست.</span>';
  t.querySelectorAll('img').forEach(function(im){ im.onclick=function(){ saveSilent(); cur=+im.dataset.i; renderThumbs(); renderPage(); }; });
}
function renderPage(){
  var p=pages[cur]; if(!p) return;
  $('edPageNo').textContent=(cur+1)+' / '+pages.length+' · '+p.label;
  $('edText').value=p.text||''; $('edTr').value=p.tr||''; $('edTag').value=p.tag||'';
  document.querySelectorAll('#edStatus .st').forEach(function(b){ b.classList.toggle('on',b.dataset.s===(p.status||'raw')); });
  $('edFlag').textContent=p.flag?'🚩 پرچم‌دار':'🏳️ پرچم';
  showImage(); progress(); renderRegions(); renderRgList();
}
function progress(){
  var done=pages.filter(function(p){return (p.text||'').trim();}).length;
  $('edProgBar').style.width=(pages.length?Math.round(done/pages.length*100):0)+'%';
  $('edProgTx').textContent=done+' از '+pages.length+' برگ رونویسی شده';
}
function saveSilent(){
  var p=pages[cur]; if(!p) return;
  p.text=$('edText').value; p.tr=$('edTr').value; p.tag=$('edTag').value;
  persist();
}
function persist(){
  if(!prjId) return;
  var ps=lsGet('coreader-iiif-projects',[]);
  var i=ps.findIndex(function(x){return x.id===prjId;});
  if(i<0) return;
  ps[i].annos=pages.filter(function(p){return (p.text||'').trim();}).map(function(p,ix){
    return {canvas:p.label,xywh:'',text:p.text,translation:p.tr,tag:p.tag||'ادیتور',by:'ادیتور',at:new Date().toISOString()};
  });
  ps[i].manifest=manifestUrl||ps[i].manifest;
  lsSet('coreader-iiif-projects',ps);
}
$('edSave').onclick=function(){ saveSilent(); progress(); if(window.Telegram) return; toast('ذخیره شد ✅'); };
function toast(t){ var d=document.createElement('div'); d.textContent=t; d.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#000;color:#fff;padding:8px 16px;border-radius:10px;z-index:99'; document.body.appendChild(d); setTimeout(function(){d.remove();},1500); }
$('edPrev').onclick=function(){ if(cur>0){saveSilent();cur--;renderThumbs();renderPage();} };
$('edNext').onclick=function(){ if(cur<pages.length-1){saveSilent();cur++;renderThumbs();renderPage();} };
document.querySelectorAll('#edStatus .st').forEach(function(b){ b.onclick=function(){ document.querySelectorAll('#edStatus .st').forEach(function(x){x.classList.remove('on');}); b.classList.add('on'); if(pages[cur]) pages[cur].status=b.dataset.s; }; });

/* ---------- collation (مقابله) ---------- */
function fillCollate(){
  var opts=pages.map(function(p,i){return '<option value="'+i+'">'+(i+1)+' · '+esc(p.label)+'</option>';}).join('');
  $('colA').innerHTML=opts; $('colB').innerHTML=opts;
  if(pages[1]) $('colB').value='1';
}
function wordDiff(a,b){
  var A=String(a||'').split(/\s+/).filter(Boolean), B=String(b||'').split(/\s+/).filter(Boolean);
  var n=A.length,m=B.length,dp=[];
  for(var i=0;i<=n;i++){dp.push([]);for(var j=0;j<=m;j++)dp[i].push(0);}
  for(i=n-1;i>=0;i--)for(j=m-1;j>=0;j--)dp[i][j]=A[i]===B[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
  var outA='',outB='';i=0;j=0;
  while(i<n&&j<m){ if(A[i]===B[j]){outA+=esc(A[i])+' ';outB+=esc(B[j])+' ';i++;j++;} else if(dp[i+1][j]>=dp[i][j+1]){outA+='<span class="diff-del">'+esc(A[i])+'</span> ';i++;} else {outB+='<span class="diff-ins">'+esc(B[j])+'</span> ';j++;} }
  while(i<n){outA+='<span class="diff-del">'+esc(A[i])+'</span> ';i++;}
  while(j<m){outB+='<span class="diff-ins">'+esc(B[j])+'</span> ';j++;}
  return [outA,outB];
}
$('colGo').onclick=function(){
  var A=pages[+$('colA').value],B=pages[+$('colB').value];
  if(!A||!B) return;
  var d=wordDiff(A.text,B.text);
  $('colOut').innerHTML='<div class="collate-grid"><div><img src="'+esc(A.img)+'"><div style="margin-top:6px">'+(d[0]||'<span class="kv">رونویسی نشده</span>')+'</div></div>'
    +'<div><img src="'+esc(B.img)+'"><div style="margin-top:6px">'+(d[1]||'<span class="kv">رونویسی نشده</span>')+'</div></div></div>'
    +'<div class="kv" style="margin-top:6px">قرمز = فقط در برگ اول · سبز = فقط در برگ دوم</div>';
};

/* ---------- group annotations ---------- */
async function loadGroup(){
  var box=$('edGroup');
  if(!prjId){ box.textContent='پس از اتصال پروژه، این‌جا نمایش داده می‌شود.'; return; }
  box.textContent='در حال دریافت…';
  try{
    var r=await fetch(apiBase()+'/api/annotations?project='+encodeURIComponent('urn:coreader:'+prjId));
    var arr=await r.json();
    if(!arr.length){ box.innerHTML='حاشیه گروهی نیست.'; return; }
    box.innerHTML=arr.map(function(a){return '<div style="margin-bottom:6px">💬 '+esc(a.text||'')+' <span class="kv">· '+esc(a.by||'')+'</span></div>';}).join('');
  }catch(e){ box.textContent='سرور در دسترس نیست.'; }
}

/* ---------- metadata / ranges / presentation state ---------- */
var edMeta={label:'',summary:'',rights:'',rows:[]};
var ranges=[]; // {title,a,b} 1-based
var steps=[];  // {page,note}
var lastManifest=null;
function faLabel(l,fb){
  try{ if(!l) return fb; if(typeof l==='string') return l; if(l.fa&&l.fa[0]) return l.fa[0]; if(l.en&&l.en[0]) return l.en[0]; var k=Object.keys(l)[0]; return (l[k]&&l[k][0])||fb; }catch(e){ return fb; }
}
function faMeta(md){
  var out=[];
  try{ (md||[]).forEach(function(e){ out.push([faLabel(e.label,''),faLabel(e.value,'')]); }); }catch(e){}
  return out;
}
function prefillMeta(m){
  lastManifest=m;
  edMeta.label=faLabel(m.label,''); edMeta.summary=faLabel(m.summary,'');
  edMeta.rights=faLabel(m.rights||m.license,''); edMeta.rows=faMeta(m.metadata);
  $('mdLabel').value=edMeta.label; $('mdSummary').value=edMeta.summary; $('mdRights').value=edMeta.rights;
}
function renderMeta(){
  $('mdRows').innerHTML=edMeta.rows.map(function(r,i){
    return '<div class="meta-row"><input class="inp" data-mk="'+i+'" value="'+esc(r[0])+'" placeholder="کلید"><input class="inp" data-mv="'+i+'" value="'+esc(r[1])+'" placeholder="مقدار"><button class="btn ghost" data-mdel="'+i+'">✕</button></div>';
  }).join('');
  $('mdRows').querySelectorAll('[data-mk]').forEach(function(inp){ inp.oninput=function(){ edMeta.rows[+inp.dataset.mk][0]=inp.value; }; });
  $('mdRows').querySelectorAll('[data-mv]').forEach(function(inp){ inp.oninput=function(){ edMeta.rows[+inp.dataset.mv][1]=inp.value; }; });
  $('mdRows').querySelectorAll('[data-mdel]').forEach(function(b){ b.onclick=function(){ edMeta.rows.splice(+b.dataset.mdel,1); renderMeta(); }; });
}
$('mdLabel').oninput=function(){ edMeta.label=this.value; };
$('mdSummary').oninput=function(){ edMeta.summary=this.value; };
$('mdRights').oninput=function(){ edMeta.rights=this.value; };
$('mdAddRow').onclick=function(){ edMeta.rows.push(['','']); renderMeta(); };
function renderRanges(){
  $('rnList').innerHTML=ranges.length?ranges.map(function(r,i){
    return '<div class="anno-row">📚 '+esc(r.title)+' <span class="kv">برگ '+r.a+' تا '+r.b+'</span> <button class="btn ghost" data-rgo="'+i+'">رفتن</button> <button class="btn ghost" data-rdel="'+i+'">✕</button></div>';
  }).join(''):'<div class="kv">فهرستی نیست. مثلاً: دیباچه — 1-3</div>';
  $('rnList').querySelectorAll('[data-rgo]').forEach(function(b){ b.onclick=function(){ saveSilent(); cur=Math.max(0,(ranges[+b.dataset.rgo].a|0)-1); renderThumbs(); renderPage(); }; });
  $('rnList').querySelectorAll('[data-rdel]').forEach(function(b){ b.onclick=function(){ ranges.splice(+b.dataset.rdel,1); saveExtras(); renderRanges(); }; });
}
$('rnAdd').onclick=function(){
  var t=$('rnTitle').value.trim(), s=$('rnSpan').value.trim().match(/(\d+)\s*-\s*(\d+)/);
  if(!t||!s){ toast('عنوان و بازه (مثل 3-10) لازم است'); return; }
  ranges.push({title:t,a:+s[1],b:+s[2]}); $('rnTitle').value=''; $('rnSpan').value='';
  saveExtras(); renderRanges();
};
function renderSteps(){
  $('prSteps').innerHTML=steps.length?steps.map(function(s,i){
    return '<div class="anno-row">🎬 گام '+(i+1)+' · برگ '+(s.page+1)+' — '+esc((s.note||'').slice(0,60))+' <button class="btn ghost" data-pdel="'+i+'">✕</button></div>';
  }).join(''):'<div class="kv">گامی نیست. برگ جاری را اضافه کنید.</div>';
  $('prSteps').querySelectorAll('[data-pdel]').forEach(function(b){ b.onclick=function(){ steps.splice(+b.dataset.pdel,1); saveExtras(); renderSteps(); }; });
}
$('prAdd').onclick=function(){ steps.push({page:cur,note:($('edText').value||'').slice(0,300)}); saveExtras(); renderSteps(); toast('به پرزنتیشن اضافه شد ✅'); };
var prIdx=0;
$('prPlay').onclick=function(){ if(!steps.length){ toast('اول گام اضافه کنید'); return; } prIdx=0; showPr(); $('presentOverlay').hidden=false; };
function showPr(){
  var s=steps[prIdx]; if(!s) return;
  $('presentImg').src=pages[s.page]?pages[s.page].img:'';
  $('presentNote').textContent=s.note||'';
  $('prCount').textContent=(prIdx+1)+' / '+steps.length;
}
$('prPrev').onclick=function(){ prIdx=(prIdx-1+steps.length)%steps.length; showPr(); };
$('prNext').onclick=function(){ prIdx=(prIdx+1)%steps.length; showPr(); };
$('prClose').onclick=function(){ $('presentOverlay').hidden=true; };
function saveExtras(){
  try{ lsSet('ed-extra-'+(prjId||'noid'),{meta:edMeta,ranges:ranges,steps:steps}); }catch(e){}
  persist();
}
function loadExtras(){
  var x=lsGet('ed-extra-'+(prjId||'noid'),null);
  if(x){ edMeta=x.meta||edMeta; ranges=x.ranges||[]; steps=x.steps||[];
    $('mdLabel').value=edMeta.label||''; $('mdSummary').value=edMeta.summary||''; $('mdRights').value=edMeta.rights||''; }
  else { ranges=[]; steps=[]; }
}

/* ---------- flags + filter ---------- */
$('edFlag').onclick=function(){ var p=pages[cur]; if(!p) return; p.flag=!p.flag; $('edFlag').textContent=p.flag?'🚩 پرچم‌دار':'🏳️ پرچم'; renderThumbs(); persist(); };
$('edFilter').onchange=renderThumbs;

/* ---------- search + highlight ---------- */
$('edSearch').addEventListener('input',function(){
  var q=this.value.trim(); var box=$('edSearchOut');
  if(q.length<2){ box.innerHTML=''; return; }
  var hits=[];
  pages.forEach(function(p,i){ if((p.text||'').indexOf(q)>=0) hits.push(i); });
  box.innerHTML=hits.length?('یافت شد در '+hits.length+' برگ: '+hits.slice(0,20).map(function(i){return '<button class="btn ghost" data-goto="'+i+'">'+(i+1)+'</button>';}).join(' ')):'یافت نشد.';
  box.querySelectorAll('[data-goto]').forEach(function(b){ b.onclick=function(){ saveSilent(); cur=+b.dataset.goto; renderThumbs(); renderPage(); }; });
});

/* ---------- views: book / rotate / fullscreen ---------- */
var bookView=false, rotation=0;
function setOsdRotation(){
  if(viewer&&viewer.viewport){ try{ viewer.viewport.setRotation(rotation); }catch(e){} }
  if(fallbackImg) fallbackImg.style.transform='rotate('+rotation+'deg)';
  renderRegions();
}
$('btnView').onclick=function(){
  bookView=!bookView;
  $('btnView').textContent=bookView?'📖 تک‌برگ':'📖 دوبرگه';
  $('btnView').classList.toggle('on',bookView);
  renderPage();
};
$('btnRot').onclick=function(){ rotation=(rotation+90)%360; setOsdRotation(); };
$('btnFs').onclick=function(){
  var box=$('edImgBox');
  if(document.fullscreenElement) document.exitFullscreen();
  else if(box.requestFullscreen) box.requestFullscreen();
};
var _showImageOrig=showImage;
showImage=function(){
  var box=$('edImgBox');
  if(bookView){
    if(viewer){ try{viewer.destroy();}catch(e){} viewer=null; }
    $('osd').innerHTML='';
    if(fallbackImg){ fallbackImg.remove(); fallbackImg=null; }
    if(box._bookEl){ box._bookEl.remove(); box._bookEl=null; }
    var a=pages[cur], b=pages[cur+1];
    var tmp=document.createElement('div');
    tmp.style.cssText='position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr;gap:4px;background:#000';
    tmp.innerHTML='<img class="osd-fallback" src="'+esc(a?a.img:'')+'"><img class="osd-fallback" src="'+esc(b?b.img:'')+'">';
    box.appendChild(tmp); box._bookEl=tmp;
    $('regionLayer').innerHTML='';
    return;
  }
  if(box._bookEl){ box._bookEl.remove(); box._bookEl=null; }
  _showImageOrig();
  setOsdRotation();
};

/* ---------- region annotations (ناحیه‌ای) ---------- */
var regionModeOn=false, pendingRect=null, osdTracker=null;
function regionMode(on){
  regionModeOn=on;
  $('btnRegionMode').classList.toggle('on',on);
  $('edImgBox').style.cursor=on?'crosshair':'';
  if(viewer){ try{ viewer.setMouseNavEnabled(!on); }catch(e){} }
}
$('btnRegionMode').onclick=function(){ regionMode(!regionModeOn); };
function imgPctFromOsdPixel(px){
  try{
    var vp=viewer.viewport.pointFromPixel(px,true);
    var item=viewer.world.getItemAt(0), b=item.getBounds(true);
    return {x:(vp.x-b.x)/b.width*100, y:(vp.y-b.y)/b.height*100};
  }catch(e){ return null; }
}
function osdRectToScreen(r){
  try{
    var item=viewer.world.getItemAt(0), b=item.getBounds(true);
    var r1=viewer.viewport.viewportToViewerElementRectangle(new OpenSeadragon.Rect(b.x+r.x/100*b.width, b.y+r.y/100*b.height, r.w/100*b.width, r.h/100*b.height));
    return {l:r1.x,t:r1.y,w:r1.width,h:r1.height};
  }catch(e){ return null; }
}
function attachDraw(){
  if(!viewer||!window.OpenSeadragon||osdTracker) return;
  try{
    osdTracker=new OpenSeadragon.MouseTracker({
      element:viewer.element,
      pressHandler:function(e){
        if(!regionModeOn) return;
        var p=imgPctFromOsdPixel(e.position); if(!p) return;
        pendingRect={x0:p.x,y0:p.y,x:p.x,y:p.y,w:0,h:0};
      },
      dragHandler:function(e){
        if(!regionModeOn||!pendingRect) return;
        var p=imgPctFromOsdPixel(e.position); if(!p) return;
        pendingRect.x=Math.min(pendingRect.x0,p.x); pendingRect.y=Math.min(pendingRect.y0,p.y);
        pendingRect.w=Math.abs(p.x-pendingRect.x0); pendingRect.h=Math.abs(p.y-pendingRect.y0);
        var s=osdRectToScreen(pendingRect), d=$('regionDraw');
        if(s){ d.style.display='block'; d.style.left=s.l+'px'; d.style.top=s.t+'px'; d.style.width=s.w+'px'; d.style.height=s.h+'px'; }
      },
      releaseHandler:function(){
        if(!regionModeOn||!pendingRect) return;
        if(pendingRect.w>1&&pendingRect.h>1){
          $('rgXywh').textContent=Math.round(pendingRect.x)+','+Math.round(pendingRect.y)+','+Math.round(pendingRect.w)+','+Math.round(pendingRect.h);
        } else pendingRect=null;
        $('regionDraw').style.display='none';
      }
    });
  }catch(e){}
}
(function(){
  var box=$('edImgBox'), start=null;
  function pct(e){
    var r=box.getBoundingClientRect();
    var cx=(e.touches&&e.touches[0]?e.touches[0].clientX:e.clientX), cy=(e.touches&&e.touches[0]?e.touches[0].clientY:e.clientY);
    return {x:(cx-r.left)/r.width*100, y:(cy-r.top)/r.height*100};
  }
  box.addEventListener('pointerdown',function(e){ if(!regionModeOn||viewer) return; start=pct(e); pendingRect={x0:start.x,y0:start.y,x:start.x,y:start.y,w:0,h:0}; e.preventDefault(); });
  box.addEventListener('pointermove',function(e){
    if(!regionModeOn||!start||viewer) return;
    var p=pct(e);
    pendingRect.x=Math.min(start.x,p.x); pendingRect.y=Math.min(start.y,p.y);
    pendingRect.w=Math.abs(p.x-start.x); pendingRect.h=Math.abs(p.y-start.y);
    var d=$('regionDraw'), r=box.getBoundingClientRect();
    d.style.display='block';
    d.style.left=(pendingRect.x/100*r.width)+'px'; d.style.top=(pendingRect.y/100*r.height)+'px';
    d.style.width=(pendingRect.w/100*r.width)+'px'; d.style.height=(pendingRect.h/100*r.height)+'px';
  });
  box.addEventListener('pointerup',function(){
    if(!regionModeOn||!pendingRect) { start=null; return; }
    if(pendingRect.w>1&&pendingRect.h>1) $('rgXywh').textContent=Math.round(pendingRect.x)+','+Math.round(pendingRect.y)+','+Math.round(pendingRect.w)+','+Math.round(pendingRect.h);
    else pendingRect=null;
    $('regionDraw').style.display='none'; start=null;
  });
})();
function renderRegions(){
  var layer=$('regionLayer'); layer.innerHTML='';
  if(bookView) return; // در نمای دوبرگه، ناحیه‌ها فقط در نمای تک‌برگ
  var p=pages[cur]; if(!p) return;
  if(viewer&&window.OpenSeadragon){
    try{ viewer.clearOverlays(); }catch(e){}
    (p.regions||[]).forEach(function(r){
      try{
        var item=viewer.world.getItemAt(0), b=item.getBounds(true);
        var d=document.createElement('div');
        d.className='region-box'; d.title=(r.text||'')+' #'+(r.tag||'');
        d.style.borderColor=tagColor(r.tag);
        viewer.addOverlay({element:d,location:new OpenSeadragon.Rect(b.x+r.x/100*b.width,b.y+r.y/100*b.height,r.w/100*b.width,r.h/100*b.height)});
        d.onclick=function(){ toast('#'+(r.tag||'ناحیه')+': '+(r.text||'').slice(0,120)); };
      }catch(e){}
    });
    return;
  }
  (p.regions||[]).forEach(function(r){
    var d=document.createElement('div');
    d.className='region-box'; d.title=(r.text||'');
    d.style.cssText+=';left:'+r.x+'%;top:'+r.y+'%;width:'+r.w+'%;height:'+r.h+'%;border-color:'+tagColor(r.tag);
    d.onclick=function(){ toast('#'+(r.tag||'ناحیه')+': '+(r.text||'').slice(0,120)); };
    layer.appendChild(d);
  });
}
function tagColor(t){
  var h=0; String(t||'').split('').forEach(function(c){ h=(h*31+c.charCodeAt(0))%360; });
  return 'hsl('+h+',70%,55%)';
}
function renderRgList(){
  var p=pages[cur];
  $('rgList').innerHTML=(p&&(p.regions||[]).length)?p.regions.map(function(r,i){
    return '<div class="anno-row">▭ '+esc((r.text||'').slice(0,80))+' <span class="kv">['+Math.round(r.x)+','+Math.round(r.y)+','+Math.round(r.w)+','+Math.round(r.h)+' · '+(r.mot||'')+' #'+esc(r.tag||'')+']</span> <button class="btn ghost" data-rgdel="'+i+'">✕</button></div>';
  }).join(''):'<div class="kv">ناحیه‌ای برای این برگ ثبت نشده.</div>';
  $('rgList').querySelectorAll('[data-rgdel]').forEach(function(b){ b.onclick=function(){ pages[cur].regions.splice(+b.dataset.rgdel,1); renderRegions(); renderRgList(); persist(); }; });
}
$('rgAdd').onclick=function(){
  if(!pendingRect){ toast('اول روی تصویر مستطیل بکشید'); return; }
  var p=pages[cur]; p.regions=p.regions||[];
  p.regions.push({x:pendingRect.x,y:pendingRect.y,w:pendingRect.w,h:pendingRect.h,
    text:$('rgText').value,mot:$('rgMot').value,tag:$('rgTag').value});
  pendingRect=null; $('rgXywh').textContent='—'; $('rgText').value='';
  renderRegions(); renderRgList(); persist(); regionMode(false);
  toast('ناحیه ثبت شد ✅');
};
$('rgClear').onclick=function(){ pendingRect=null; $('rgXywh').textContent='—'; $('regionDraw').style.display='none'; };
var _showImagePlus=showImage;
showImage=function(){
  _showImagePlus();
  osdTracker=null;
  if(viewer){
    attachDraw();
    try{ viewer.addHandler('open',function(){ renderRegions(); }); }catch(e){}
    try{ viewer.addHandler('animation-finish',function(){ renderRegions(); }); }catch(e){}
  }
};

/* ---------- export (with regions + structures + metadata) ---------- */
function buildWA(){
  var out=[];
  pages.forEach(function(p,i){
    if((p.text||'').trim()) out.push({ '@context':'http://www.w3.org/ns/anno.jsonld', id:'urn:coreader:ed:t'+Date.now()+i, type:'Annotation', motivation:'transcribing',
      creator:{type:'Person',name:'ادیتور فارسی'}, created:new Date().toISOString(),
      body:[{type:'TextualBody',value:p.text,language:'fa',purpose:'transcribing'},{type:'TextualBody',value:p.tr||'',language:'fa'}],
      target:p.img });
    (p.regions||[]).forEach(function(r,j){
      var cw=p.cw||1000, ch=p.ch||1000;
      var xywh=Math.round(r.x/100*cw)+','+Math.round(r.y/100*ch)+','+Math.round(r.w/100*cw)+','+Math.round(r.h/100*ch);
      out.push({ '@context':'http://www.w3.org/ns/anno.jsonld', id:'urn:coreader:ed:r'+Date.now()+i+'_'+j, type:'Annotation', motivation:r.mot||'commenting',
        creator:{type:'Person',name:'ادیتور فارسی'}, created:new Date().toISOString(),
        body:[{type:'TextualBody',value:r.text||'',language:'fa'},{type:'TextualBody',value:'#'+(r.tag||''),purpose:'tagging'}],
        target:p.img+'#xywh='+xywh });
    });
  });
  return out;
}
function dl(name,obj){
  var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'})); a.download=name; a.click();
}
$('edExport').onclick=function(){
  var mid='urn:coreader:ed-'+Date.now();
  var items=pages.map(function(p,i){
    var annos=[];
    if((p.text||'').trim()) annos.push({id:mid+':t'+i,type:'Annotation',motivation:'transcribing',
      body:[{type:'TextualBody',value:p.text,language:'fa'},{type:'TextualBody',value:p.tr||'',language:'fa'}],target:mid+':c'+i});
    (p.regions||[]).forEach(function(r,j){
      var cw=p.cw||1000, ch=p.ch||1000;
      annos.push({id:mid+':r'+i+'_'+j,type:'Annotation',motivation:r.mot||'commenting',
        body:{type:'TextualBody',value:r.text||'',language:'fa'},target:mid+':c'+i+'#xywh='+Math.round(r.x/100*cw)+','+Math.round(r.y/100*ch)+','+Math.round(r.w/100*cw)+','+Math.round(r.h/100*ch)});
    });
    var c={id:mid+':c'+i,type:'Canvas',label:{fa:[p.label]},annotations:[{id:mid+':list'+i,type:'AnnotationPage',items:annos}]};
    if(p.cw) c.width=p.cw; if(p.ch) c.height=p.ch;
    return c;
  });
  var m={'@context':'http://iiif.io/api/presentation/3/context.json',id:mid,type:'Manifest',
    label:{fa:[edMeta.label||'رونویسی فارسی — ادیتور coreader']}};
  if(edMeta.summary) m.summary={fa:[edMeta.summary]};
  if(edMeta.rights) m.rights=edMeta.rights;
  if(edMeta.rows.length) m.metadata=edMeta.rows.filter(function(r){return r[0]||r[1];}).map(function(r){return {label:{fa:[r[0]]},value:{fa:[r[1]]}};});
  m.items=items;
  if(ranges.length) m.structures=ranges.map(function(r,i){var s0=Math.max(0,r.a-1);return {id:mid+':range'+i,type:'Range',label:{fa:[r.title]},
    items:pages.slice(s0,Math.min(pages.length,r.b)).map(function(_,k){return mid+':c'+(s0+k);})};});
  dl('fa-manifest.json',m);
  fetch(apiBase()+'/api/manifests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:{name:edMeta.label||'ادیتور فارسی'},manifest:m})}).catch(function(){});
  toast('مانیفست ساخته و روی سرور ذخیره شد ✅');
};
$('edExportWA').onclick=function(){ dl('annotations.json',buildWA()); toast('حاشیه‌ها دانلود شد ✅'); };

/* ---------- official tools (deep links to current content) ---------- */
function pageCanvasUrl(){
  var p=pages[cur];
  return (p&&p.img?p.img:'')||manifestUrl;
}
function copyManifest(){
  var t=manifestUrl||'';
  if(!t){ toast('اول مانیفست را بارگذاری کنید'); return; }
  if(navigator.clipboard) navigator.clipboard.writeText(t).then(function(){ toast('نشانی مانیفست کپی شد ✅'); });
  else prompt('نشانی مانیفست:',t);
}
var TOOLS=[
  {n:'Mirador 3',d:'مقایسه چندپنجره‌ای، زوم عمیق، حاشیه (با پلاگین) — استاندارد نمایش IIIF',
   deep:function(){ return 'https://projectmirador.org/demo/?manifest='+encodeURIComponent(manifestUrl); }},
  {n:'Universal Viewer',d:'کتاب، گالری، AV و جاسازی با دیپ‌لینک (مثل یوتیوب)',
   deep:function(){ return 'https://universalviewer.io/uv.html#?manifest='+encodeURIComponent(manifestUrl); }},
  {n:'Annona — نمایشگر تصویر',d:'نمایش حاشیه‌ها و روایت تصویری (استوری‌برد)',
   deep:function(){ return 'https://ncsu-libraries.github.io/annona/imageviewer/?iiif-content='+encodeURIComponent(manifestUrl); }},
  {n:'Annona — استوری‌برد',d:'نمایش مرحله‌ای چند مانیفست (مثل پرزنتیشن همین‌جا)',
   deep:function(){ return 'https://ncsu-libraries.github.io/annona/storyboard/?iiif-content='+encodeURIComponent(manifestUrl); }},
  {n:'Annona — فهرست (Range)',d:'نمایش ساختاری ranges مانیفست',
   deep:function(){ return 'https://ncsu-libraries.github.io/annona/range/?iiif-content='+encodeURIComponent(manifestUrl); }},
  {n:'Digirati Manifest Editor',d:'ویرایش متادیتا، ranges، حاشیه، نمایشگاه — نشانی را Paste کنید',
   home:'https://manifest-editor.digirati.services/', guide:'https://manifest-editor-docs.netlify.app/docs/getting-started'},
  {n:'Theseus',d:'پیش‌نمایش سریع و سبک مانیفست',home:'https://theseusviewer.org/'},
  {n:'Clover IIIF',d:'نمایشگر جدید Samvera',home:'https://samvera-labs.github.io/clover-iiif/'},
  {n:'Recogito',d:'حاشیه‌گذاری متن و تصویر (نیازمند حساب رایگان)',home:'https://recogito.pelagios.org/'},
  {n:'FromThePage',d:'رونویسی جمعی اسناد (نیازمند حساب)',home:'https://fromthepage.com/'},
  {n:'Annonatate',d:'ساخت حاشیه IIIF',home:'https://annonatate.fly.dev/'},
  {n:'Goobi Viewer',d:'نمایشگر Intranda',home:'https://www.intranda.com/en/digiverso/goobi-viewer/goobi-viewer-overview/'},
  {n:'みんなで翻刻',d:'رونویسی جمعی ژاپنی — الگوی این ادیتور',home:'https://app.honkoku.org/'},
  {n:'فهرست ابزارهای IIIF',d:'دایرکتوری رسمی همه ابزارها',home:'https://iiif.io/get-started/tools/'}
];
function renderTools(){
  $('toolList').innerHTML=TOOLS.map(function(t,i){
    var hasM=!!manifestUrl;
    var open=t.deep?(hasM?t.deep():t.home||'#'):(t.home||'#');
    return '<div class="tool-link"><div><b>'+esc(t.n)+'</b><small>'+esc(t.d)
      +(t.guide?' · <a target="_blank" rel="noopener" href="'+esc(t.guide)+'">راهنمای رسمی</a>':'')+'</small></div>'
      +'<span style="display:flex;gap:6px;flex-shrink:0">'
      +'<a class="btn" target="_blank" rel="noopener" href="'+esc(open)+'">بازکردن'+(hasM&&t.deep?' با محتوای جاری':'')+'</a>'
      +'<button class="btn ghost" data-copy="'+i+'">کپی نشانی</button>'
      +'</span></div>';
  }).join('');
  $('toolList').querySelectorAll('[data-copy]').forEach(function(b){ b.onclick=copyManifest; });
}

/* ---------- tutorial (guided tour like Digirati guide) ---------- */
var TUTS=[
  {sel:'#edManifest',t:'۱. بارگذاری مانیفست',d:'نشانی مانیفست IIIF نسخه را بچسبانید و «بارگذاری» را بزنید. اگر خطای CORS گرفتید، ادیتور خودش از پروکسی همین سایت تلاش می‌کند. دکمه «نمونه بودلیان» یک مانیفست واقعی محلی را می‌آورد.'},
  {sel:'#edThumbs',t:'۲. ناوبری برگ‌ها',d:'نوار بندانگشتی همه برگ‌هاست. ✅ یعنی رونویسی‌شده، 🚩 یعنی پرچم‌دار (نیازمند توجه). با فیلتر، فقط برگ‌های خام/در حال بررسی/تأییدشده/پرچم‌دار را ببینید.'},
  {sel:'#edText',t:'۳. رونویسی فارسی',d:'متن برگ را با قلم شهرزاد بنویسید، ترجمه و برچسب را اضافه کنید و وضعیت را مشخص کنید: خام ← بررسی ← تأیید (مثل گردش‌کار honkoku). «ذخیره برگ» حافظه محلی و پروژه پنل را به‌روز می‌کند.'},
  {sel:'#btnRegionMode',t:'۴. حاشیه ناحیه‌ای',d:'«▭ ناحیه» را فعال کنید و روی تصویر مستطیل بکشید؛ بعد متن، نوع (رونویسی/توضیح/برچسب/هایلایت) و برچسب را ثبت کنید. ناحیه‌ها با xywh استاندارد در خروجی می‌آیند (مثل Annonatate و Mirador).'},
  {sel:'#edCollateCard',t:'۵. مقابله دو نسخه',d:'دو برگ (مثلاً از دو نسخه مختلف یک اثر) را انتخاب و «مقایسه» را بزنید: تصویرها کنار هم و تفاوت متن‌ها قرمز/سبز نشان داده می‌شود.'},
  {sel:'#rnTitle',t:'۶. فهرست (Ranges)',d:'بخش‌های کتاب (دیباچه، باب اول…) را با بازه برگ تعریف کنید؛ در خروجی مانیفست، structures استاندارد ساخته می‌شود (مثل Range Editor در Digirati).'},
  {sel:'#prAdd',t:'۷. پرزنتیشن',d:'برگ‌های مهم را به ترتیب به پرزنتیشن اضافه کنید و «اجرا» را بزنید: نمایش مرحله‌ای تمام‌صفحه با یادداشت (مثل Annona Storyboard و Exhibition ادیتور Digirati).'},
  {sel:'#edExport',t:'۸. خروجی',d:'«مانیفست IIIF v3» شامل متن‌ها، ناحیه‌ها، فراداده و فهرست را می‌سازد و روی سرور هم ذخیره می‌کند؛ «Web Annotations» حاشیه‌های استاندارد W3C را جدا می‌دهد.'},
  {sel:'#tools',t:'۹. ابزارهای رسمی',d:'همین مانیفست و برگ جاری را مستقیم در Mirador، Universal Viewer و Annona باز کنید؛ برای بقیه دکمه «کپی نشانی» را بزنید و Paste کنید.'}
];
var tutIdx=-1;
function tutShow(){
  document.querySelectorAll('.tut-ring').forEach(function(e){e.classList.remove('tut-ring');});
  var s=TUTS[tutIdx];
  $('tutTitle').textContent=s.t; $('tutText').textContent=s.d;
  $('tutCount').textContent=(tutIdx+1)+' / '+TUTS.length;
  var el=document.querySelector(s.sel);
  if(el){ el.scrollIntoView({behavior:'smooth',block:'center'}); el.classList.add('tut-ring'); }
  $('tutOverlay').hidden=false;
}
$('btnTut').onclick=function(){ tutIdx=0; tutShow(); };
$('tutNext').onclick=function(){ tutIdx++; if(tutIdx>=TUTS.length){ tutEnd(); } else tutShow(); };
function tutEnd(){ tutIdx=-1; $('tutOverlay').hidden=true; document.querySelectorAll('.tut-ring').forEach(function(e){e.classList.remove('tut-ring');}); }
$('tutClose').onclick=tutEnd;
$('tutOverlay').addEventListener('click',function(e){ if(e.target.id==='tutOverlay') tutEnd(); });

/* ---------- static guide (Digirati-style manual, condensed) ---------- */
$('guideBody').innerHTML=[
  ['۱. بازکردن نسخه','نشانی مانیفست را در نوار بالا بدهید و «بارگذاری» را بزنید. نسخه‌های v2 و v3 پشتیبانی می‌شوند. اگر مستقیم باز نشد، از پروکسی همین سایت عبور داده می‌شود.'],
  ['۲. رونویسی','هر برگ: متن فارسی، ترجمه/توضیح، برچسب و وضعیت. با «ذخیره برگ» در پروژه پنل هم ذخیره می‌شود. نوار پیشرفت بالای کارت، درصد برگ‌های رونویسی‌شده را نشان می‌دهد.'],
  ['۳. ناحیه‌ها','حالت «▭ ناحیه» + کشیدن مستطیل + ثبت متن/نوع/برچسب. رنگ هر ناحیه از برچسبش ساخته می‌شود. در خروجی، انتخاب‌گر استاندارد <code dir="ltr">xywh</code> می‌گیرند.'],
  ['۴. پرچم و فیلتر','برگ مشکوک را 🚩 کنید و بعداً با فیلتر فقط پرچم‌دارها را مرور کنید (همان ایده Canvas Flags در Digirati).'],
  ['۵. جست‌وجو','در همه رونویسی‌ها بگردید و با یک کلیک به برگ بروید.'],
  ['۶. مقابله','دو برگ را کنار هم بگذارید؛ تصویرها و تفاوت کلمه‌به‌کلمه متن‌ها را ببینید — مناسب مقابله دو نسخه خطی یک اثر.'],
  ['۷. فهرست و پرزنتیشن','بخش‌ها (ranges) فهرست مندرجات می‌سازند؛ گام‌ها نمایش مرحله‌ای تمام‌صفحه می‌سازند. هر دو در مانیفست خروجی استاندارد ذخیره می‌شوند.'],
  ['۸. حاشیه گروه','اگر پروژه از پنل لینک شده باشد، حاشیه‌هایی که اعضا با <code dir="ltr">/hashiye</code> در تلگرام فرستاده‌اند این‌جا دیده می‌شود.'],
  ['۹. خروجی و ابزارها','مانیفست v3 و Web Annotations را دانلود یا روی سرور ذخیره کنید؛ بعد همان مانیفست را در Mirador/UV/Annona باز کنید یا نشانی‌اش را در Digirati/Recogito/FromThePage بگذارید.']
].map(function(g){ return '<p><b>'+g[0]+'.</b> '+g[1]+'</p>'; }).join('');

/* ---------- load bar ---------- */
$('edLoad').onclick=async function(){
  var u=$('edManifest').value.trim(); if(!u){toast('نشانی مانیفست را بدهید');return;}
  try{ await loadManifest(u); toast('بارگذاری شد ✅'); }
  catch(e){ toast('خطا در بارگذاری مانیفست ⚠️'); }
};
$('edSample').onclick=function(){ $('edManifest').value=location.origin+location.pathname.replace(/\/panel\/.*$/,'/')+'books/all-souls-college-ms-288/manifest.json'; toast('مانیفست نمونه بارگذاری شد؛ دکمه بارگذاری را بزنید'); };

/* ---------- init ---------- */
(function init(){
  var q=new URLSearchParams(location.search);
  prjId=q.get('prj');
  var mu=q.get('manifest');
  if(prjId){ var ps=lsGet('coreader-iiif-projects',[]); var p=ps.filter(function(x){return x.id===prjId;})[0];
    if(p&&p.manifest){ mu=mu||p.manifest; } }
  renderTools();
  if(mu){ $('edManifest').value=mu; loadManifest(mu).catch(function(){ toast('خطا در بارگذاری ⚠️'); }); }
})();
})();
