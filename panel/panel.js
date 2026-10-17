/* panel.js — پنل کاربری: ورود، قاب‌ها، متن‌ها، پروژه IIIF، اشتراک، پشتیبان */
(function(){
'use strict';
function lsGet(k,d){ try{var v=localStorage.getItem(k); return v?JSON.parse(v):d;}catch(e){return d;} }
function lsSet(k,v){ try{localStorage.setItem(k,JSON.stringify(v));return true;}catch(e){return false;} }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function apiBase(){ return ''; } // same-origin (serve.js). روی GitHub Pages فقط حالت محلی.

/* ---------- navigation + font ---------- */
var panes={frames:'pane-frames',texts:'pane-texts',iiif:'pane-iiif',share:'pane-share',backup:'pane-backup'};
document.getElementById('navChips').addEventListener('click',function(e){
  var b=e.target.closest('.chip'); if(!b) return;
  document.querySelectorAll('#navChips .chip').forEach(function(c){c.classList.remove('on');});
  b.classList.add('on');
  Object.keys(panes).forEach(function(k){ document.getElementById(panes[k]).hidden = (k!==b.dataset.p); });
});
document.getElementById('fontChips').addEventListener('click',function(e){
  var b=e.target.closest('.chip'); if(!b) return;
  document.querySelectorAll('#fontChips .chip').forEach(function(c){c.classList.remove('on');});
  b.classList.add('on');
  document.body.classList.remove('font-house','font-nastaliq','font-naskh');
  if(b.dataset.f==='house') document.body.classList.add('font-house');
  if(b.dataset.f==='under') document.body.classList.add('font-nastaliq');
  if(b.dataset.f==='naskh') document.body.classList.add('font-naskh');
  lsSet('coreader-panel-font', b.dataset.f);
});

/* ---------- auth: local + server + telegram ---------- */
var user = lsGet('coreader-user', null);
function renderAuth(){
  var box=document.getElementById('authBox');
  if(user){
    box.innerHTML='<div style="display:flex;gap:10px;align-items:center"><div class="avatar">'+esc((user.name||'ک')[0])+'</div><div><b>'+esc(user.name||'کاربر')+'</b><div class="kv">'+esc(user.method==='telegram'?'ورود با تلگرام':'حساب محلی')+' · '+esc(user.id||'')+'</div></div></div>'
    +'<div class="btn-row"><button class="btn ghost" id="btnLogout">خروج</button></div>';
    document.getElementById('btnLogout').onclick=function(){ user=null; lsSet('coreader-user',null); renderAuth(); };
    return;
  }
  box.innerHTML='<input class="inp" id="loginName" placeholder="نام نمایشی (مثلاً: سارا)">'
    +'<div class="btn-row"><button class="btn primary" id="btnLocalLogin">ورود محلی</button>'
    +'<button class="btn" id="btnTgCode">کد تلگرامی</button></div>'
    +'<div id="tgCodeBox" style="font-size:12px;line-height:2"></div>'
    +'<div class="kv">کد تلگرامی را در ربات وارد کنید تا حساب‌تان به تلگرام وصل شود. بدون سرور هم همه امکانات محلی کار می‌کند.</div>';
  document.getElementById('btnLocalLogin').onclick=function(){
    var n=(document.getElementById('loginName').value||'').trim()||'کاربر مهمان';
    user={id:'local-'+Date.now().toString(36),name:n,method:'local',created:Date.now()};
    lsSet('coreader-user',user); serverLogin(); renderAuth();
  };
  document.getElementById('btnTgCode').onclick=async function(){
    var n=(document.getElementById('loginName').value||'').trim()||'کاربر مهمان';
    var code=Math.floor(100000+Math.random()*900000);
    lsSet('coreader-tg-code',{code:code,name:n,at:Date.now()});
    document.getElementById('tgCodeBox').innerHTML='کد اتصال شما: <div class="login-code">'+code+'</div>در ربات بفرستید: <b dir="ltr">/link '+code+'</b>';
    try{ await fetch(apiBase()+'/api/auth/request-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code,name:n})}); }catch(e){}
  };
}
async function serverLogin(){
  try{
    if(!user) return;
    await fetch(apiBase()+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(user)});
  }catch(e){}
}
// اگر ربات تلگرام لینک را تایید کرده باشد (poll کوتاه)
async function pollTgLink(){
  var c=lsGet('coreader-tg-code',null); if(!c||user) return;
  try{
    var r=await fetch(apiBase()+'/api/auth/check-code?code='+encodeURIComponent(c.code));
    if(!r.ok) return;
    var j=await r.json();
    if(j&&j.user){ user=j.user; lsSet('coreader-user',user); renderAuth(); }
  }catch(e){}
}

/* ---------- frames ---------- */
function getFrames(){ return lsGet('coreader-frames',[]); }
function renderFrames(){
  var g=document.getElementById('framesGrid'); var fr=getFrames();
  if(!fr.length){ g.innerHTML='<div class="kv">هنوز قابی ذخیره نشده. در ویور روی «📌 ذخیره قاب» بزنید.</div>'; return; }
  g.innerHTML=fr.map(function(f,i){
    return '<div class="saved-item"><img src="'+esc(f.img)+'" loading="lazy" alt="">'
    +'<div class="sb2"><b>'+esc(f.title||'قاب '+(i+1))+'</b><div class="kv">'+esc(f.book||'')+' · ص '+esc(f.page||'?')+'</div>'
    +'<div class="btn-row"><a class="btn" href="'+esc(f.link||'#')+'">بازکردن</a>'
    +'<button class="btn ghost" data-share="'+i+'">اشتراک</button>'
    +'<button class="btn ghost" data-del="'+i+'">✕</button></div></div></div>';
  }).join('');
  g.querySelectorAll('[data-del]').forEach(function(b){ b.onclick=function(){ var a=getFrames(); a.splice(+b.dataset.del,1); lsSet('coreader-frames',a); renderFrames(); }; });
  g.querySelectorAll('[data-share]').forEach(function(b){ b.onclick=function(){ selectForShare({kind:'frame',index:+b.dataset.share}); }; });
}
document.getElementById('btnAddFrame').onclick=function(){
  var u=prompt('URL تصویر قاب:'); if(!u) return;
  var t=prompt('عنوان قاب:')||'قاب دستی';
  var fr=getFrames(); fr.unshift({img:u,title:t,at:Date.now(),link:u}); lsSet('coreader-frames',fr); renderFrames();
};
document.getElementById('btnClearFrames').onclick=function(){ if(confirm('همه قاب‌ها پاک شود؟')){ lsSet('coreader-frames',[]); renderFrames(); } };

/* ---------- texts ---------- */
function getTexts(){ return lsGet('coreader-texts',[]); }
function renderTexts(){
  var g=document.getElementById('textsGrid'); var tx=getTexts();
  g.innerHTML=tx.length?tx.map(function(t,i){
    return '<div class="saved-item"><div class="sb2"><b>'+esc(t.title)+'</b><div>'+esc(t.body).slice(0,180)+'</div>'
    +(t.link?'<a href="'+esc(t.link)+'">پیوند اثر</a>':'')
    +'<div class="btn-row"><button class="btn ghost" data-share-t="'+i+'">اشتراک</button><button class="btn ghost" data-del-t="'+i+'">✕</button></div></div></div>';
  }).join(''):'<div class="kv">متنی ذخیره نشده است.</div>';
  g.querySelectorAll('[data-del-t]').forEach(function(b){ b.onclick=function(){ var a=getTexts(); a.splice(+b.dataset.delT,1); lsSet('coreader-texts',a); renderTexts(); }; });
  g.querySelectorAll('[data-share-t]').forEach(function(b){ b.onclick=function(){ selectForShare({kind:'text',index:+b.dataset.shareT}); }; });
}
document.getElementById('btnSaveText').onclick=function(){
  var t=(document.getElementById('txtTitle').value||'').trim(), b=(document.getElementById('txtBody').value||'').trim(), l=(document.getElementById('txtLink').value||'').trim();
  if(!t||!b){ alert('عنوان و متن لازم است.'); return; }
  var tx=getTexts(); tx.unshift({title:t,body:b,link:l,at:Date.now()}); lsSet('coreader-texts',tx);
  document.getElementById('txtTitle').value=''; document.getElementById('txtBody').value=''; renderTexts();
};

/* ---------- IIIF projects ---------- */
function getPrjs(){ return lsGet('coreader-iiif-projects',[]); }
function renderPrjs(){
  var box=document.getElementById('prjList'); var ps=getPrjs();
  box.innerHTML=ps.length?ps.map(function(p,i){
    return '<div class="anno-row"><b>'+esc(p.name)+'</b> <span class="kv">· '+(p.annos||[]).length+' حاشیه</span><div class="kv" dir="ltr">'+esc(p.manifest||'')+'</div>'
    +'<div class="btn-row"><button class="btn" data-open-p="'+i+'">بازکردن</button><a class="btn" href="iiif-editor.html?prj='+esc(p.id)+'">✏️ ادیتور</a><a class="btn ghost" href="iiif-editor.html?prj='+esc(p.id)+'#tools">🌐 ابزارها</a><button class="btn ghost" data-exp-p="'+i+'">⬇ مانیفست IIIF</button><button class="btn ghost" data-del-p="'+i+'">✕</button></div></div>';
  }).join(''):'<div class="kv">پروژه‌ای نیست. یکی بسازید.</div>';
  box.querySelectorAll('[data-del-p]').forEach(function(b){ b.onclick=function(){ var a=getPrjs(); a.splice(+b.dataset.delP,1); lsSet('coreader-iiif-projects',a); renderPrjs(); document.getElementById('prjDetail').innerHTML=''; }; });
  box.querySelectorAll('[data-exp-p]').forEach(function(b){ b.onclick=function(){ exportManifest(+b.dataset.expP); }; });
  box.querySelectorAll('[data-open-p]').forEach(function(b){ b.onclick=function(){ openProject(+b.dataset.openP); }; });
}
document.getElementById('btnCreatePrj').onclick=function(){
  var n=(document.getElementById('prjName').value||'').trim(), m=(document.getElementById('prjManifest').value||'').trim();
  if(!n){ alert('نام پروژه لازم است.'); return; }
  var ps=getPrjs(); var p={id:'prj-'+Date.now().toString(36),name:n,manifest:m,annos:[],created:Date.now()};
  ps.unshift(p); lsSet('coreader-iiif-projects',ps); renderPrjs(); openProject(0);
};
function openProject(i){
  var ps=getPrjs(); var p=ps[i]; if(!p) return;
  var d=document.getElementById('prjDetail');
  d.innerHTML='<div class="anno-row"><b>افزودن حاشیه به: '+esc(p.name)+'</b>'
    +'<label class="lbl">برگ / کانوس (شماره یا URL)</label><input class="inp" id="anCanvas" placeholder="1">'
    +'<label class="lbl">ناحیه (x,y,w,h به درصد — مثلاً 10,20,30,15)</label><input class="inp" id="anXywh" placeholder="10,20,30,15" dir="ltr">'
    +'<label class="lbl">رونویسی / متن فارسی</label><textarea class="inp" id="anText" rows="2"></textarea>'
    +'<label class="lbl">ترجمه / توضیح (اختیاری)</label><input class="inp" id="anTr">'
    +'<label class="lbl">برچسب</label><input class="inp" id="anTag" placeholder="تذهیب، حاشیه، مهر، …">'
    +'<div class="btn-row"><button class="btn primary" id="btnAddAnno">افزودن حاشیه</button><button class="btn" id="btnExpMan">⬇ خروجی مانیفست v3</button><button class="btn" id="btnGroupAnnos">💬 حاشیه‌های گروه</button></div>'
    +'<div id="groupAnnos" style="margin-top:8px"></div>'
    +'<div id="annoList" style="margin-top:10px;display:flex;flex-direction:column;gap:8px"></div></div>';
  function drawAnnos(){
    document.getElementById('annoList').innerHTML=(p.annos||[]).map(function(a,j){
      return '<div class="anno-row">🖋️ '+esc(a.text||'')+' <span class="kv">['+esc(a.xywh||'')+' · '+esc(a.tag||'بدون برچسب')+']</span>'
      +(a.translation?'<div class="kv">ترجمه: '+esc(a.translation)+'</div>':'')
      +'<div class="btn-row"><button class="btn ghost" data-adel="'+j+'">حذف</button></div></div>';
    }).join('')||'<div class="kv">حاشیه‌ای نیست.</div>';
    document.querySelectorAll('[data-adel]').forEach(function(b){ b.onclick=function(){ p.annos.splice(+b.dataset.adel,1); ps[i]=p; lsSet('coreader-iiif-projects',ps); renderPrjs(); openProject(i); }; });
  }
  drawAnnos();
  document.getElementById('btnAddAnno').onclick=function(){
    var a={canvas:(document.getElementById('anCanvas').value||'1').trim(),xywh:(document.getElementById('anXywh').value||'').trim(),text:document.getElementById('anText').value,translation:document.getElementById('anTr').value,tag:document.getElementById('anTag').value,by:(user&&user.name)||'کاربر',at:new Date().toISOString()};
    p.annos=p.annos||[]; p.annos.push(a); ps[i]=p; lsSet('coreader-iiif-projects',ps); renderPrjs(); openProject(i);
  };
  document.getElementById('btnExpMan').onclick=function(){ exportManifest(i); };
  document.getElementById('btnGroupAnnos').onclick=async function(){
    var box=document.getElementById('groupAnnos'); box.innerHTML='<div class="kv">در حال دریافت از سرور…</div>';
    try{
      var r=await fetch(apiBase()+'/api/annotations?project='+encodeURIComponent('urn:coreader:'+p.id));
      if(!r.ok) throw new Error('srv');
      var arr=await r.json();
      if(!arr.length){ box.innerHTML='<div class="kv">هنوز حاشیه گروهی نیست. در گروه بفرستید:<br><code dir="ltr">/hashiye '+esc(p.id)+' متن شما #برچسب</code></div>'; return; }
      box.innerHTML=arr.map(function(a,j){
        return '<div class="anno-row">💬 '+esc(a.text||'')+' <span class="kv">· '+esc(a.by||'')+(a.tag?' · #'+esc(a.tag):'')+'</span></div>';
      }).join('')+'<div class="btn-row"><button class="btn primary" id="btnMergeAnnos">➕ افزودن همه به پروژه</button></div>';
      document.getElementById('btnMergeAnnos').onclick=function(){
        p.annos=p.annos||[];
        arr.forEach(function(a){ p.annos.push({canvas:'1',xywh:'',text:a.text||'',translation:'',tag:a.tag||'گروه',by:a.by||'گروه',at:new Date(a.at||Date.now()).toISOString()}); });
        ps[i]=p; lsSet('coreader-iiif-projects',ps); renderPrjs(); openProject(i);
      };
    }catch(e){ box.innerHTML='<div class="kv">⚠️ سرور در دسترس نیست (serve.js باید روشن باشد).</div>'; }
  };
}
function buildManifest(p){
  var canvases={};
  (p.annos||[]).forEach(function(a){ (canvases[a.canvas]=canvases[a.canvas]||[]).push(a); });
  var items=Object.keys(canvases).map(function(c,idx){
    return { id:(p.manifest||'urn:coreader:'+p.id)+'#canvas/'+encodeURIComponent(c), type:'Canvas', label:{fa:[String(c)]},
      annotations:[{ id:'urn:coreader:'+p.id+':list:'+idx, type:'AnnotationPage',
        items: canvases[c].map(function(a,j){ return { id:'urn:coreader:'+p.id+':anno:'+idx+'-'+j, type:'Annotation', motivation:'commenting',
          creator:{type:'Person',name:a.by}, created:a.at,
          body:[{type:'TextualBody',value:a.text||'',language:'fa'},{type:'TextualBody',value:(a.translation||''),language:'fa',purpose:'commenting'}],
          target:(p.manifest||'urn:coreader:'+p.id)+'#canvas/'+encodeURIComponent(c)+(a.xywh?('#xywh='+a.xywh):''),
          tag:a.tag||'' } }) }] };
  });
  return { '@context':'http://iiif.io/api/presentation/3/context.json', id:'urn:coreader:'+p.id, type:'Manifest',
    label:{fa:[p.name]}, summary:{fa:['پروژه غنی‌سازی نسخ فارسی و اشیاء موزه‌ای — ساخته‌شده در پنل کاربری coreader']},
    requiredStatement:{label:{fa:['پدیدآورنده']},value:{fa:[(user&&user.name)||'کاربر coreader']}},
    items: items.length?items:[{id:'urn:coreader:'+p.id+'#canvas/1',type:'Canvas',label:{fa:['برگ ۱']}}] };
}
function exportManifest(i){
  var ps=getPrjs(); var p=ps[i]; if(!p) return;
  var m=buildManifest(p);
  var blob=new Blob([JSON.stringify(m,null,2)],{type:'application/json'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=p.id+'-manifest.json'; a.click();
  // تلاش برای ذخیره روی سرور
  fetch(apiBase()+'/api/manifests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:p,manifest:m,user:user})}).catch(function(){});
}

/* ---------- share ---------- */
var shareSel=null;
function selectForShare(s){
  shareSel=s;
  document.querySelectorAll('#navChips .chip').forEach(function(c){c.classList.toggle('on',c.dataset.p==='share');});
  Object.keys(panes).forEach(function(k){ document.getElementById(panes[k]).hidden=(k!=='share'); });
  // پیش‌پرکردن فیلدهای ویرایش با مقادیر قاب/متن
  var d=shareData();
  document.getElementById('shareTitle').value=d.title||'';
  document.getElementById('shareSub').value=d.text||'';
  document.getElementById('shareCaption').value=defaultCaption(d);
  renderSharePreview();
}
function shareData(){
  if(!shareSel) return {title:'کتابخانه نسخ خطی coreader',img:null,text:'مرور، خوانش و حاشیه‌نویسی نفایس خطی فارسی'};
  if(shareSel.kind==='frame'){ var f=getFrames()[shareSel.index]; return {title:f.title,img:f.img,text:(f.book||'')+' · ص '+(f.page||''),link:f.link}; }
  var t=getTexts()[shareSel.index]; return {title:t.title,img:null,text:t.body,link:t.link};
}
// ویرایش‌های کاربر روی کارت (خالی = خودکار)
function shareEdits(){
  return {
    title:(document.getElementById('shareTitle').value||'').trim(),
    sub:(document.getElementById('shareSub').value||'').trim(),
    caption:document.getElementById('shareCaption').value,
    fit:document.getElementById('shareFit').value||'cover'
  };
}
function effShare(){
  var d=shareData(), e=shareEdits();
  return { title:e.title||d.title, text:(e.sub!==''?e.sub:d.text), img:d.img, link:d.link, fit:e.fit, caption:e.caption };
}
function renderSharePreview(){
  var d=effShare(); var theme=document.getElementById('shareTheme').value;
  document.getElementById('sharePreview').innerHTML='<div class="share-card '+esc(theme)+'">'
    +(d.img?'<img class="sc-cover" style="object-fit:'+esc(d.fit)+(d.fit==='contain'?';background:#000':'')+'" src="'+esc(d.img)+'">':'')
    +'<div class="sc-body"><p class="sc-title">'+esc(d.title)+'</p><div class="sc-sub">'+esc(d.text||'').slice(0,220)+'</div>'
    +'<div class="sc-brand">📜 coreader · نسخ خطی و اوراق فارسی'+(shareSel?'':' (نمونه)')+'</div></div></div>';
}
document.getElementById('shareTheme').onchange=renderSharePreview;
['shareTitle','shareSub','shareFit','shareCaption'].forEach(function(id){
  document.getElementById(id).addEventListener('input',renderSharePreview);
  document.getElementById(id).addEventListener('change',renderSharePreview);
});
document.getElementById('btnRenderCard').onclick=function(){
  var d=effShare(); var theme=document.getElementById('shareTheme').value;
  var cv=document.getElementById('shareCanvas'); var ctx=cv.getContext('2d');
  var bgc = theme==='naskh' ? '#f6efdd' : '#14100c';
  ctx.fillStyle=bgc; ctx.fillRect(0,0,1080,1350);
  function drawText(){
    ctx.fillStyle = theme==='naskh' ? '#5b3413' : '#f6d47c'; ctx.textAlign='center';
    ctx.font=(theme==='house'?'64px "Noto Naskh Arabic", "Scheherazade New", serif':'60px "Noto Nastaliq Urdu", serif');
    wrapFa(ctx,d.title,540,theme==='house'?880:860,70,900);
    ctx.fillStyle = theme==='naskh' ? '#7c5a2e' : '#cbbfa7'; ctx.font='30px "Scheherazade New", "Noto Naskh Arabic", serif';
    wrapFa(ctx,(d.text||'').slice(0,160),540,1050,44,880);
    ctx.fillStyle = theme==='naskh' ? '#a08c5f' : '#9c8f76'; ctx.font='24px Vazirmatn'; ctx.fillText('coreader · نسخ خطی و اوراق فارسی',540,1280);
    var url=cv.toDataURL('image/png');
    document.getElementById('sharePreview').innerHTML+='<div class="btn-row"><a class="btn primary" download="coreader-share.png" href="'+url+'">⬇ دانلود کارت (1080×1350)</a></div><img src="'+url+'" style="margin-top:10px">';
  }
  if(d.img){
    var im=new Image(); im.crossOrigin='anonymous';
    im.onload=function(){
      if(d.fit==='contain'){
        // کل تصویر دیده شود: پس‌زمینه تار از خودش + تصویر کامل وسط
        ctx.save(); ctx.filter='blur(40px) brightness(.5)'; ctx.drawImage(im,0,0,1080,760); ctx.restore();
        var r=Math.min(1080/im.width,760/im.height), w=im.width*r, h=im.height*r;
        ctx.drawImage(im,(1080-w)/2,(760-h)/2,w,h);
      } else {
        var r2=Math.max(1080/im.width,760/im.height), w2=im.width*r2, h2=im.height*r2;
        ctx.drawImage(im,(1080-w2)/2,(760-h2)/2,w2,h2);
      }
      drawText();
    };
    im.onerror=drawText; im.src=d.img;
  }
  else drawText();
};
function wrapFa(ctx,text,cx,y,lh,maxW){
  var words=String(text||'').split(/\s+/); var line='',yy=y;
  words.forEach(function(w){ var t=line?line+' '+w:w; if(ctx.measureText(t).width>maxW&&line){ ctx.fillText(line,cx,yy); line=w; yy+=lh; } else line=t; });
  if(line) ctx.fillText(line,cx,yy);
}
function defaultCaption(d){ d=d||shareData(); return '📜 '+d.title+'\n\n'+(d.text||'')+'\n\n— via coreader · نسخ خطی و اوراق فارسی\n'+(d.link||location.origin+location.pathname.replace(/panel\/.*/,'') ); }
function captionText(){ var c=(document.getElementById('shareCaption').value||'').trim(); if(c) return c; return defaultCaption(effShare()); }
document.getElementById('btnCopyCaption').onclick=function(){
  var t=captionText();
  if(navigator.clipboard) navigator.clipboard.writeText(t).then(function(){alert('کپشن کپی شد.');});
  else { prompt('کپشن:',t); }
};
function openShare(url){ window.open(url,'_blank'); }
document.getElementById('btnShareTg').onclick=function(){ openShare('https://t.me/share/url?url='+encodeURIComponent(location.href)+'&text='+encodeURIComponent(captionText())); };
document.getElementById('btnShareWa').onclick=function(){ openShare('https://wa.me/?text='+encodeURIComponent(captionText())); };
document.getElementById('btnShareX').onclick=function(){ openShare('https://twitter.com/intent/tweet?text='+encodeURIComponent(captionText())); };

/* ---------- backup / sync ---------- */
document.getElementById('btnExport').onclick=function(){
  var data={user:user,frames:getFrames(),texts:getTexts(),projects:getPrjs(),favs:lsGet('coreader-favs',[]),at:new Date().toISOString()};
  var blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='coreader-backup.json'; a.click();
};
document.getElementById('btnImport').onclick=function(){ document.getElementById('importFile').click(); };
document.getElementById('importFile').onchange=function(e){
  var f=e.target.files[0]; if(!f) return;
  var r=new FileReader(); r.onload=function(){
    try{
      var j=JSON.parse(r.result);
      if(j.frames) lsSet('coreader-frames',j.frames);
      if(j.texts) lsSet('coreader-texts',j.texts);
      if(j.projects) lsSet('coreader-iiif-projects',j.projects);
      if(j.favs) lsSet('coreader-favs',j.favs);
      renderFrames(); renderTexts(); renderPrjs(); alert('بازیابی شد.');
    }catch(err){ alert('فایل معتبر نیست.'); }
  }; r.readAsText(f);
};
document.getElementById('btnSync').onclick=async function(){
  var log=document.getElementById('syncLog'); log.textContent='در حال همگام‌سازی…';
  try{
    var payload={user:user,frames:getFrames(),texts:getTexts(),projects:getPrjs(),at:Date.now()};
    var r=await fetch(apiBase()+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!r.ok) throw new Error('server '+r.status);
    var j=await r.json();
    log.textContent='✅ همگام شد: '+j.saved+' قلم روی سرور.';
  }catch(e){ log.textContent='⚠️ سرور در دسترس نیست (حالت آفلاین/استاتیک). پشتیبان JSON را نگه دارید.'; }
};

/* ---------- init ---------- */
renderAuth(); renderFrames(); renderTexts(); renderPrjs(); renderSharePreview();
setInterval(pollTgLink,4000);
var pf=lsGet('coreader-panel-font',null);
if(pf){ document.body.classList.remove('font-house','font-nastaliq','font-naskh'); if(pf!=='ui') document.body.classList.add(pf==='house'?'font-house':pf==='under'?'font-nastaliq':'font-naskh'); }
})();
