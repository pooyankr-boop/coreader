/* save-frame.js — دکمه 📌 قاب در ویور: ذخیره قاب جاری در پنل کاربری */
(function(){
'use strict';
function lsGet(k,d){ try{var v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch(e){return d;} }
function lsSet(k,v){ try{localStorage.setItem(k,JSON.stringify(v));return true;}catch(e){return false;} }
window.saveFrameToPanel=function(){
  try{
    var slug=(new URLSearchParams(location.search).get('book'))||document.title;
    var page=(document.getElementById('pgInput')&&document.getElementById('pgInput').value)||'1';
    var imgUrl='';
    // بهترین حدس برای تصویر جاری: canvas OSD یا اولین thumb
    var cv=document.querySelector('#osd-container canvas, .openseadragon-canvas canvas, canvas');
    if(cv){ try{ imgUrl=cv.toDataURL('image/jpeg',0.85); }catch(e){ imgUrl=''; } }
    if(!imgUrl){
      var im=document.querySelector('.side-panel img, #imagePanel img');
      if(im) imgUrl=im.src||'';
    }
    var title=prompt('عنوان قاب (مثلاً: تذهیب آغازین):',document.title+' — ص '+page)||('قاب ص '+page);
    var fr=lsGet('coreader-frames',[]);
    fr.unshift({img:imgUrl,title:title,book:slug,page:String(page),link:location.href,at:Date.now()});
    if(!lsSet('coreader-frames',fr)){ alert('فضای مرورگر پر است؛ قاب ذخیره نشد.'); return; }
    if(confirm('📌 قاب در پنل کاربری ذخیره شد. بازکردن پنل؟')) location.href='../panel/panel.html';
  }catch(e){ alert('خطا در ذخیره قاب.'); }
};
})();
