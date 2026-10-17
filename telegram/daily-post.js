// telegram/daily-post.js — پست خودکار «اثر روز» در کانال (+ بازنشر در تاپیک گروه)
// اجرا: node telegram/daily-post.js  (مثلاً با cron روزانه)
// آدرس عمومی از sitePublic کانفیگ یا SITE_PUBLIC_URL خوانده می‌شود.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const TOKEN = cfg.botToken;
const SITE_RAW = (process.env.SITE_PUBLIC_URL || cfg.sitePublic || cfg.siteBase || 'http://localhost:8081');
const SITE = (/YOUR-DOMAIN|example\.(com|org|net)/i.test(SITE_RAW) ? cfg.siteBase || 'http://localhost:8081' : SITE_RAW).replace(/\/$/, '');
const HTTPS = /^https:\/\//i.test(SITE);
const api = (m, p) => fetch('https://api.telegram.org/bot' + TOKEN + '/' + m, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p)
}).then(r => r.json());
const apiForm = (m, form) => fetch('https://api.telegram.org/bot' + TOKEN + '/' + m, { method: 'POST', body: form }).then(r => r.json());

(async () => {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'books-index.json'), 'utf8'));
  const books = idx.books || idx || [];
  // اثر روز: چرخش بر اساس تاریخ تا همه اعضا یک اثر مشترک ببینند
  const day = Math.floor(Date.now() / 86400000);
  const b = books[day % books.length];
  if (!b) throw new Error('empty index');
  const link = SITE + (b.source === 'local'
    ? '/reader/reader.html?book=' + encodeURIComponent(b.slug)
    : '/viewer/viewer.html?book=' + encodeURIComponent(b.slug));
  const webappUrl = SITE + '/telegram/webapp/';
  const caption = '🎲 <b>اثر امروز</b>\n\n📖 <b>' + b.title + '</b>\n' + (b.author || b.provider || '') +
    '\n📄 ' + (b.pages || '?') + ' برگ' +
    '\n\n🔗 <a href="' + link + '">بازکردن در کتابخوان</a>' +
    (HTTPS ? '\n📱 <a href="' + webappUrl + '">مینی‌اپ تلگرام</a>' : '');
  const kbRow2 = HTTPS
    ? [{ text: '📱 مینی‌اپ', web_app: { url: webappUrl } }]
    : [{ text: '📱 مینی‌اپ', url: webappUrl }];
  // دکمه URL با آدرس غیر-HTTPS توسط تلگرام رد می‌شود؛ روی لوکال فقط متن می‌فرستیم
  const kb = HTTPS ? { inline_keyboard: [[{ text: '📖 بازکردن', url: link }], kbRow2] } : undefined;
  // اگر کاور محلی دارد، عکس بفرست
  let coverPath = b.cover ? path.join(ROOT, 'books', b.slug, b.coverThumb || b.cover) : null;
  let posted = null;
  if (coverPath && fs.existsSync(coverPath) && fs.statSync(coverPath).size < 9 * 1024 * 1024) {
    const fd = new FormData();
    fd.append('chat_id', cfg.channel);
    fd.append('caption', caption.replace(/<[^>]+>/g, '').slice(0, 1024));
    fd.append('parse_mode', 'HTML');
    const blob = new Blob([fs.readFileSync(coverPath)]);
    fd.append('photo', blob, 'cover.jpg');
    if (kb) fd.append('reply_markup', JSON.stringify(kb));
    let r = await apiForm('sendPhoto', fd);
    if (!r.ok && /button/i.test(JSON.stringify(r))) {
      const fd2 = new FormData();
      fd2.append('chat_id', cfg.channel);
      fd2.append('caption', caption.replace(/<[^>]+>/g, '').slice(0, 1024));
      fd2.append('parse_mode', 'HTML');
      fd2.append('photo', blob, 'cover.jpg');
      r = await apiForm('sendPhoto', fd2);
    }
    console.log('channel sendPhoto:', r.ok ? 'OK' : JSON.stringify(r).slice(0, 300));
    posted = r;
  } else {
    const payload = { chat_id: cfg.channel, text: caption, parse_mode: 'HTML' };
    if (kb) payload.reply_markup = kb;
    const r = await api('sendMessage', payload);
    console.log('channel sendMessage:', r.ok ? 'OK' : JSON.stringify(r).slice(0, 300));
    posted = r;
  }
  // بازنشر در تاپیک «قاب من» گروه (اگر تاپیک ساخته شده باشد)
  const thread = cfg.topics && cfg.topics.frames;
  if (thread) {
    const fwd = posted && posted.ok && posted.result && posted.result.message_id
      ? await api('forwardMessage', { chat_id: cfg.groupId || cfg.group, message_thread_id: thread, from_chat_id: cfg.channel, message_id: posted.result.message_id })
      : await api('sendMessage', Object.assign({ chat_id: cfg.groupId || cfg.group, message_thread_id: thread, text: caption + '\n\n#قاب_من', parse_mode: 'HTML' }, kb ? { reply_markup: kb } : {}));
    console.log('group topic repost:', fwd.ok ? 'OK' : JSON.stringify(fwd).slice(0, 300));
  } else {
    console.log('group repost skipped: no topics (run node telegram/setup-topics.js)');
  }
})();
