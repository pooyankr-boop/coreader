// telegram/bot-core.js — هسته مشترک ربات (بدون side-effect در require)
// استفاده: telegram/bot.js (polling) و api/index.js در Vercel (webhook/cron)
// قابلیت‌ها:
//  /start — خوش‌آمد + کیبورد دکمه‌ها
//  /app — مینی‌اپ (نیازمند sitePublic با HTTPS)
//  /search <عبارت> — جست‌وجو + کارت تصویری اثر
//  /book <slug> — کارت تصویری اثر با دکمه‌ها
//  /card <slug> — پست اشتراک‌گذاری آماده فوروارد
//  /daily — اثر تصادفی روز
//  /quiz — مسابقه حدس اثر (نظرسنجی)
//  /tour — تورهای مجازی
//  /manifest <slug> — مانیفست IIIF اثر
//  /projects — پروژه‌های IIIF + حاشیه‌های گروه
//  /hashiye <project> <متن> [#برچسب] — افزودن حاشیه به پروژه
//  /topics — تاپیک‌های گروه
//  /link 123456 — اتصال کد پنل کاربری به تلگرام
//  /id — شناسه گفت‌وگو
//  پیام آزاد = جست‌وجو
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CFG = (() => {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (e) {}
  // روی هاست (Render/Vercel/…) فایل کانفیگ gitignore است؛ env جایگزین می‌شود
  const env = (k) => process.env[k] || '';
  const envTopics = {};
  ['chat', 'quiz', 'frames', 'tashkil'].forEach(k => { const v = env('TELEGRAM_TOPIC_' + k.toUpperCase()); if (v) envTopics[k] = +v; });
  return Object.assign(c, {
    botToken: env('BOT_TOKEN') || c.botToken,
    channel: env('TELEGRAM_CHANNEL') || c.channel,
    channelId: env('TELEGRAM_CHANNEL_ID') ? +env('TELEGRAM_CHANNEL_ID') : c.channelId,
    group: env('TELEGRAM_GROUP') || c.group,
    groupId: env('TELEGRAM_GROUP_ID') ? +env('TELEGRAM_GROUP_ID') : c.groupId,
    groupLink: env('TELEGRAM_GROUP_LINK') || c.groupLink,
    topics: Object.assign({}, c.topics, envTopics),
  });
})();
const TOKEN = process.env.BOT_TOKEN || CFG.botToken || '';
if (!TOKEN || TOKEN.includes('PUT_YOUR')) {
  console.error('BOT_TOKEN missing. Set env BOT_TOKEN or telegram/config.json');
  process.exit(1);
}
// SITE: پایه محلی برای API سرور (روی همین ماشین). PUBLIC: آدرس عمومی برای
// دکمه‌های وب/مینی‌اپ — مینی‌اپ تلگرام فقط با HTTPS عمومی باز می‌شود.
const SITE = (process.env.SITE_BASE || CFG.siteBase || ('http://localhost:' + (process.env.PORT || 8081))).replace(/\/$/, '');
function cleanPublic(u) {
  // مقدار نمونه (YOUR-DOMAIN/example) یعنی «هنوز ست نشده» — مثل ست‌نبودن رفتار کن
  if (!u || /YOUR-DOMAIN|example\.(com|org|net)/i.test(u)) return '';
  return String(u).replace(/\/$/, '');
}
const PUBLIC = cleanPublic(process.env.SITE_PUBLIC_URL || CFG.sitePublic || process.env.RENDER_EXTERNAL_URL) || SITE;
const HAS_PUBLIC_HTTPS = /^https:\/\//i.test(PUBLIC);
// آدرس صفحات GitHub Pages (همان فایل‌های استاتیک؛ همیشه HTTPS)
const GH_PAGES = (process.env.GITHUB_PAGES_URL || 'https://pooyankr-boop.github.io/coreader').replace(/\/$/, '');
const WEBAPP = PUBLIC + '/telegram/webapp/';
const DATA = path.join(ROOT, 'data');
try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) {}

let BOOKS = [];
try {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'books-index.json'), 'utf8'));
  BOOKS = idx.books || idx || [];
} catch (e) { console.error('books-index not loaded', e.message); }

const api = (m, p, _nokb) => fetch('https://api.telegram.org/bot' + TOKEN + '/' + m, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p)
}).then(r => r.json()).then(j => {
  // اگر تلگرام دکمه URL را رد کرد (دامنه نامعتبر/داخلی)، یک‌بار بدون دکمه تلاش کن
  if (j && !j.ok && /button/i.test(j.description || '') && p && p.reply_markup && !_nokb) {
    const q = Object.assign({}, p);
    delete q.reply_markup;
    return api(m, q, true);
  }
  return j;
});

function foldFa(s) {
  return String(s || '').toLowerCase()
    .replace(/[ً-ٰٟٖ-٭ٰـ‌‍]/g, '')
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[آأإٱ]/g, 'ا');
}
function searchBooks(q, n) {
  const f = foldFa(q);
  return BOOKS.filter(b => foldFa((b.title || '') + ' ' + (b.author || '') + ' ' + (b.provider || '')).includes(f)).slice(0, n || 5);
}
function bookPath(b) {
  if (b.source === 'against-nature') return '/viewer/tour.html';
  if (b.source === 'local') return '/reader/reader.html?book=' + encodeURIComponent(b.slug);
  return '/viewer/viewer.html?book=' + encodeURIComponent(b.slug);
}
function itemLink(b) { return (HAS_PUBLIC_HTTPS ? PUBLIC : SITE) + bookPath(b); }
// همان صفحه روی GitHub Pages
function ghLink(b) { return GH_PAGES + bookPath(b); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// دستور + آرگومان‌ها؛ پسوند @botname در گروه‌ها حذف می‌شود
function parseCmd(text) {
  const parts = String(text || '').trim().split(/\s+/);
  const cmd = (parts[0] || '').split('@')[0];
  return { cmd, args: parts.slice(1), raw: parts.slice(1).join(' ') };
}
function threadOf(msg) {
  return msg && msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {};
}
// کاور محلی اثر (برای آپلود) یا URL ریموت (ارسال مستقیم).
// روی Vercel کاورهای لوکال در باندل تابع نیستند → فقط ریموت.
function coverLocal(b) {
  if (process.env.VERCEL) return null;
  try {
    if (!b.cover) return null;
    const p = path.join(ROOT, 'books', b.slug, b.coverThumb || b.cover);
    if (fs.existsSync(p) && fs.statSync(p).size < 9 * 1024 * 1024) return p;
  } catch (e) {}
  return null;
}
function coverRemote(b) {
  const t = Array.isArray(b.thumbnail) ? b.thumbnail[0] : b.thumbnail;
  return (t && /^https?:/.test(t)) ? t : null;
}
function bookCaption(b) {
  return '📖 <b>' + esc(b.title || '') + '</b>\n' + esc(b.author || b.provider || '') +
    '\n📄 ' + esc(String(b.pages || '?')) + ' برگ · ' + esc(b.source || '');
}
function bookKeyboard(b) {
  // تلگرام URL داخلی/HTTP را رد می‌کند؛ پس دکمه سایت فقط با HTTPS عمومی، و دکمه GitHub همیشه (HTTPS)
  const links = [];
  if (HAS_PUBLIC_HTTPS) links.push({ text: '🌐 باز کردن در سایت', url: itemLink(b) });
  links.push({ text: '🐙 باز کردن از GitHub', url: ghLink(b) });
  return { inline_keyboard: [
    links,
    [{ text: '📣 کارت اشتراک', callback_data: 'card:' + b.slug },
     { text: '📜 مانیفست', callback_data: 'man:' + b.slug }]
  ] };
}
// ارسال کارت اثر: عکس (لوکال/ریموت) + کپشن + دکمه‌ها؛ در غیر این صورت متن.
// هر مرحله با try/catch جداست تا یک خطا کل پاسخ را نبلعد (و لاگ می‌شود).
async function sendBook(chatId, b, extra, head) {
  const caption = (head ? head + '\n\n' : '') + bookCaption(b);
  const kb = bookKeyboard(b);
  const base = Object.assign({ chat_id: chatId, parse_mode: 'HTML', reply_markup: kb }, extra || {});
  const local = coverLocal(b);
  if (local) {
    try {
      const ext = path.extname(local).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const buildFd = (withKb) => {
        const fd = new FormData();
        fd.append('chat_id', String(chatId));
        fd.append('caption', caption.replace(/<[^>]+>/g, '').slice(0, 1024));
        fd.append('parse_mode', 'HTML');
        if (withKb) fd.append('reply_markup', JSON.stringify(kb));
        if (extra && extra.message_thread_id) fd.append('message_thread_id', String(extra.message_thread_id));
        fd.append('photo', new Blob([fs.readFileSync(local)], { type: mime }), 'cover' + ext);
        return fd;
      };
      const postFd = (fd) => fetch('https://api.telegram.org/bot' + TOKEN + '/sendPhoto', { method: 'POST', body: fd }).then(x => x.json());
      let r = await postFd(buildFd(true));
      if (!r.ok && /button/i.test(r.description || '')) r = await postFd(buildFd(false));
      if (r.ok) return r;
      console.error('[bot] sendPhoto-local failed:', JSON.stringify(r).slice(0, 200));
    } catch (e) { console.error('[bot] sendPhoto-local error:', e.message); }
  }
  const remote = coverRemote(b);
  if (remote) {
    try {
      const r = await api('sendPhoto', Object.assign({ photo: remote, caption: caption.slice(0, 1024) }, base));
      if (r.ok) return r;
      console.error('[bot] sendPhoto-remote failed:', JSON.stringify(r).slice(0, 200));
    } catch (e) { console.error('[bot] sendPhoto-remote error:', e.message); }
  }
  return api('sendMessage', Object.assign({ text: caption + '\n🔗 <a href="' + itemLink(b) + '">بازکردن در سایت</a> · <a href="' + ghLink(b) + '">GitHub</a>', disable_web_page_preview: false }, base));
}
// موارد مشابه: لینک کلیک‌پذیر (نه فقط کد slug)
function similarLinks(hits) {
  return hits.map(h => '📖 <a href="' + itemLink(h) + '">' + esc(h.title) + '</a> · <a href="' + ghLink(h) + '">GitHub</a> — ' + esc(h.author || '') + '\n<code>/book ' + esc(h.slug) + '</code>').join('\n\n');
}

const MAIN_KEYBOARD = { keyboard: [
  [{ text: '🔍 جست‌وجو' }, { text: '🎲 اثر روز' }],
  [{ text: '🧩 مسابقه' }, { text: '🗺️ تورها' }],
  [{ text: '📱 مینی‌اپ' }, { text: '📜 پروژه‌ها' }]
], resize_keyboard: true };

async function linkCode(code, tgUser) {
  const r = await fetch(SITE + '/api/auth/telegram-link', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: String(code), telegramUser: tgUser })
  }).then(x => x.json()).catch(() => ({ ok: false }));
  return r;
}
async function serverManifests() {
  try {
    const ms = await fetch(SITE + '/api/manifests').then(x => x.json());
    const counts = await fetch(SITE + '/api/annotations').then(x => x.json()).catch(() => ({}));
    return { ok: true, manifests: Array.isArray(ms) ? ms : [], counts: counts || {} };
  } catch (e) { return { ok: false }; }
}

async function handle(msg) {
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const tgUser = { id: msg.from.id, first_name: msg.from.first_name, username: msg.from.username };
  const th = threadOf(msg);
  const send = (t, extra) => api('sendMessage', Object.assign({ chat_id: chatId, text: t, parse_mode: 'HTML', disable_web_page_preview: false }, th, extra || {}));
  const { cmd, args, raw } = parseCmd(text);

  // دکمه‌های کیبورد اصلی
  if (text === '🎲 اثر روز') return handle({ ...msg, text: '/daily' });
  if (text === '🗺️ تورها') return handle({ ...msg, text: '/tour' });
  if (text === '🧩 مسابقه') return handle({ ...msg, text: '/quiz' });
  if (text === '📱 مینی‌اپ') return handle({ ...msg, text: '/app' });
  if (text === '📜 پروژه‌ها') return handle({ ...msg, text: '/projects' });
  if (text === '🔍 جست‌وجو') return send('🔍 نام اثر، مؤلف یا موزه را بفرستید. مثال:\n<code>حافظ</code> یا <code>/search شاهنامه</code>');

  if (cmd === '/start') {
    // دکمه وب‌اپ فقط وقتی که واقعاً باز می‌شود؛ در غیر این صورت دکمه مرده است
    const kb = HAS_PUBLIC_HTTPS
      ? { inline_keyboard: [[{ text: '📱 بازکردن مینی‌اپ', web_app: { url: WEBAPP } }]] }
      : undefined;
    await api('sendMessage', Object.assign({ chat_id: chatId,
      text: '📜 به <b>کتابخانه نسخ خطی coreader</b> خوش آمدید!\n\n'
      + '🔍 نام اثر یا مؤلف را بفرستید تا کارت تصویری‌اش را بگیرید.\n'
      + '🧩 با «مسابقه» حدس اثر بازی کنید و با «پروژه‌ها» در حاشیه‌نویسی IIIF شریک شوید.\n'
      + (HAS_PUBLIC_HTTPS ? '' : '📱 مینی‌اپ پس از انتشار سایت روی HTTPS فعال می‌شود (/app).\n')
      + '🔗 اتصال پنل کاربری: در سایت <b>پنل ← کد تلگرامی</b> بگیرید و بفرستید:\n<code>/link 123456</code>\n'
      + 'کانال: @coreader_fa · گروه: @coreader_club',
      parse_mode: 'HTML', reply_markup: kb || MAIN_KEYBOARD }, th));
    if (kb) return api('sendMessage', Object.assign({ chat_id: chatId, text: 'دکمه‌های سریع 👇', reply_markup: MAIN_KEYBOARD }, th));
    return;
  }
  if (cmd === '/link') {
    const code = (args[0] || '').trim();
    if (!code) return send('کد را این‌طور بفرستید: <code>/link 123456</code>');
    const r = await linkCode(code, tgUser);
    return send(r.ok ? '✅ حساب تلگرام شما به پنل کاربری وصل شد، ' + esc(r.user.name) + '!' : '⚠️ کد معتبر نیست. دوباره از پنل کد بگیرید.');
  }
  if (cmd === '/tour') {
    return send('🗺️ <b>تورهای مجازی</b>\n\n🌌 <a href="' + PUBLIC + '/tour/index.html">تور زیرزمین (نستعلیق)</a>\n🏠 <a href="' + PUBLIC + '/viewer/tour.html">تور خانه د اسنت (نسخ فارسی)</a>');
  }
  if (cmd === '/id') {
    return send('🆔 شناسه این گفت‌وگو:\n<code>' + chatId + '</code>\nنوع: ' + (msg.chat.type || '?') + '\nعنوان: ' + esc(msg.chat.title || msg.chat.username || '-'));
  }
  if (cmd === '/app') {
    if (HAS_PUBLIC_HTTPS) {
      return api('sendMessage', Object.assign({ chat_id: chatId, text: '📱 <b>مینی‌اپ کتابخانه</b>\n\nجست‌وجو، مطالعه، تور و پنل — داخل تلگرام:', parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '📖 بازکردن مینی‌اپ', web_app: { url: WEBAPP } }]] } }, th));
    }
    return send('⚠️ مینی‌اپ فقط وقتی باز می‌شود که سایت روی <b>HTTPS عمومی</b> باشد.\nآدرس فعلی ربات: <code>' + esc(PUBLIC) + '</code>\n\nراه‌اندازی روی دامنه:\n<code>node telegram/bot-setup.js https://YOUR-DOMAIN</code>\n\nتا آن زمان همه امکانات (جست‌وجو، کارت اثر، مسابقه، حاشیه) همین‌جا در ربات کار می‌کند ✅');
  }
  if (cmd === '/ping') {
    let srv = 'fail';
    try { const r = await fetch(SITE + '/books-index.json').then(x => x.json()); srv = 'ok (' + ((r.books || r).length || 0) + ' اثر)'; }
    catch (e) { srv = 'fail: ' + e.message.slice(0, 80); }
    const up = Math.round((Date.now() - STARTED) / 60000);
    return send('🏓 ربات زنده است\n⏱️ آپتایم: ' + up + ' دقیقه\n📚 فهرست: ' + BOOKS.length + ' اثر\n🖥️ سرور سایت: ' + esc(srv) + '\n📱 مینی‌اپ: ' + (HAS_PUBLIC_HTTPS ? 'فعال ✅' : 'نیازمند HTTPS عمومی ⚠️') + '\n🕗 پست روزانه: ساعت ۸ صبح تهران ' + (dailyOn ? 'فعال ✅' : 'خاموش'));
  }
  if (cmd === '/topics') {
    const t = CFG.topics || {};
    const names = Object.keys(t);
    if (!names.length) return send('هنوز تاپیکی ساخته نشده. روی سرور اجرا کنید:\n<code>node telegram/setup-topics.js</code>');
    return send('🗂️ <b>تاپیک‌های گروه:</b>\n' + names.map(k => '• ' + esc(k) + ' (id: <code>' + t[k] + '</code>)').join('\n'));
  }
  if (cmd === '/daily') {
    const b = BOOKS[Math.floor(Math.random() * BOOKS.length)];
    if (!b) return send('فهرست خالی است.');
    return sendBook(chatId, b, th, '🎲 <b>اثر امروز</b>');
  }
  if (cmd === '/quiz') {
    if (BOOKS.length < 4) return send('فهرست برای مسابقه کافی نیست.');
    const pool = BOOKS.slice();
    const pick = [];
    while (pick.length < 4 && pool.length) pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    const answer = pick[0];
    const options = pick.map(b => String(b.title || b.slug).slice(0, 100));
    // بر زدن جای گزینه‌ها
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    const correct = order.indexOf(0);
    // اول عکس (بدون اسم اثر!) تا حدس واقعی باشد، بعد نظرسنجی
    const qPhoto = coverLocal(answer) || coverRemote(answer);
    if (coverLocal(answer)) {
      try {
        const ext = path.extname(coverLocal(answer)).toLowerCase();
        const fd = new FormData();
        fd.append('chat_id', String(chatId));
        fd.append('caption', '🧩 مسابقه حدس اثر\nاین تصویر متعلق به کدام اثر است؟ گزینه درست را بزنید 👇');
        if (th.message_thread_id) fd.append('message_thread_id', String(th.message_thread_id));
        fd.append('photo', new Blob([fs.readFileSync(coverLocal(answer))], { type: 'image/jpeg' }), 'quiz' + ext);
        await fetch('https://api.telegram.org/bot' + TOKEN + '/sendPhoto', { method: 'POST', body: fd }).then(x => x.json());
      } catch (e) { console.error('[bot] quiz photo error:', e.message); }
    } else if (coverRemote(answer)) {
      try { await api('sendPhoto', Object.assign({ chat_id: chatId, photo: qPhoto, caption: '🧩 مسابقه حدس اثر\nاین تصویر متعلق به کدام اثر است؟ گزینه درست را بزنید 👇' }, th)); }
      catch (e) { console.error('[bot] quiz photo error:', e.message); }
    } else {
      await send('🧩 مسابقه حدس اثر\nاثر «' + esc(answer.author || '') + '» با ' + esc(String(answer.pages || '?')) + ' برگ — کدام است؟');
    }
    const r = await api('sendPoll', Object.assign({ chat_id: chatId,
      question: '🧩 این اثر کدام است؟',
      options: order.map(i => options[i]),
      type: 'quiz', correct_option_id: correct, is_anonymous: false,
      explanation: 'پاسخ درست: ' + answer.title
    }, th));
    if (!r.ok) return send('⚠️ خطا در ساخت نظرسنجی.');
    // کارت اثر بعد از اتمام؟ بلافاصله با لینک مطالعه بفرست
    await sendBook(chatId, answer, th, '📖 <b>پاسخ و مطالعه بیشتر:</b>');
    return r;
  }
  if (cmd === '/manifest') {
    const slug = (args[0] || '').trim();
    const b = BOOKS.find(x => x.slug === slug);
    if (!b) return send('اثر پیدا نشد. slug را از /search بگیرید.');
    try {
      const bj = JSON.parse(fs.readFileSync(path.join(ROOT, 'books', slug, 'book.json'), 'utf8'));
      const m = bj.manifest || bj.manifestUrl || '(manifest.json داخلی)';
      return send('📜 مانیفست <b>' + esc(b.title) + '</b>:\n<code>' + esc(m) + '</code>\n\nبرای ساخت حاشیه و مانیفست غنی: سایت ← پنل کاربری ← پروژه IIIF');
    } catch (e) { return send('مانیفست محلی برای این اثر ذخیره نشده است.'); }
  }
  if (cmd === '/book' || cmd === '/card') {
    const slug = (args[0] || '').trim();
    const b = BOOKS.find(x => x.slug === slug);
    if (!b) return send('پیدا نشد. مثال: <code>/book ' + esc((BOOKS[0] && BOOKS[0].slug) || 'slug') + '</code>');
    const head = cmd === '/card' ? '📣 <b>کارت اشتراک</b> — فوروارد کنید 👇' : null;
    return sendBook(chatId, b, th, head);
  }
  if (cmd === '/search') {
    if (!raw) return send('مثال: <code>/search حافظ</code>');
    const hits = searchBooks(raw);
    if (!hits.length) return send('چیزی پیدا نشد برای: ' + esc(raw));
    await sendBook(chatId, hits[0], th, '🔍 نتیجه برای <b>' + esc(raw) + '</b>');
    if (hits.length > 1) {
      return send('— موارد مشابه (برای بازشدن روی اسم بزنید):\n' + similarLinks(hits.slice(1, 4)));
    }
    return;
  }
  if (cmd === '/projects') {
    const s = await serverManifests();
    if (!s.ok) return send('⚠️ سرور سایت در دسترس نیست. (ربات باید به ' + esc(SITE) + ' دسترسی داشته باشد)');
    const lines = s.manifests.slice(0, 10).map(m => {
      const pid = m.id || m.project || '';
      const n = (s.counts[pid] != null ? s.counts[pid] : 0);
      return '📜 <b>' + esc(m.project || pid) + '</b> · 💬 ' + n + ' حاشیه\n<code>/hashiye ' + esc(pid) + ' متن شما #برچسب</code>';
    });
    return send((lines.length ? '📜 <b>پروژه‌های IIIF:</b>\n\n' + lines.join('\n\n') : 'هنوز پروژه‌ای روی سرور نیست. در پنل کاربری بسازید.')
      + '\n\n💡 حاشیه شما با نام تلگرامی‌تان ذخیره و در پنل نمایش داده می‌شود.');
  }
  if (cmd === '/hashiye') {
    const pid = (args[0] || '').trim();
    let rest = raw.slice(pid.length).trim();
    if (!pid || !rest) return send('مثال:\n<code>/hashiye prj-xxx این برگ تذهیب زیبایی دارد #تذهیب</code>');
    let tag = '';
    const tm = rest.match(/#(\S+)\s*$/);
    if (tm) { tag = tm[1]; rest = rest.slice(0, tm.index).trim(); }
    try {
      const r = await fetch(SITE + '/api/annotate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: pid, text: rest, tag, by: tgUser.first_name || tgUser.username || 'کاربر تلگرام' })
      }).then(x => x.json());
      if (r.ok) return send('✅ حاشیه شما ثبت شد! (پروژه <code>' + esc(pid) + '</code> · مجموع ' + r.count + ' حاشیه)');
      return send('⚠️ پروژه پیدا نشد. فهرست: /projects');
    } catch (e) { return send('⚠️ سرور سایت در دسترس نیست.'); }
  }
  // پیام آزاد = جست‌وجو
  if (text.length >= 2 && !text.startsWith('/')) {
    const hits = searchBooks(text);
    if (!hits.length) return send('چیزی پیدا نشد. از «🎲 اثر روز» یک اثر تصادفی ببینید یا عبارت دیگری بفرستید.');
    await sendBook(chatId, hits[0], th);
    if (hits.length > 1) {
      return send('— موارد مشابه (برای بازشدن روی اسم بزنید):\n' + similarLinks(hits.slice(1, 4)));
    }
    return;
  }
  return send('دستور نامشخص. /start را ببینید.');
}

async function handleCallback(q) {
  const [kind, slug] = String(q.data || '').split(':');
  const b = BOOKS.find(x => x.slug === slug);
  if (!b) { await api('answerCallbackQuery', { callback_query_id: q.id, text: 'پیدا نشد.' }); return; }
  if (kind === 'man') {
    await api('answerCallbackQuery', { callback_query_id: q.id });
    try {
      const bj = JSON.parse(fs.readFileSync(path.join(ROOT, 'books', slug, 'book.json'), 'utf8'));
      const m = bj.manifest || bj.manifestUrl || '(manifest.json داخلی)';
      await api('sendMessage', { chat_id: q.message.chat.id, text: '📜 مانیفست ' + b.title + ':\n' + m + '\n\nپنل ← پروژه IIIF', message_thread_id: q.message.message_thread_id });
    } catch (e) {
      await api('sendMessage', { chat_id: q.message.chat.id, text: 'مانیفست محلی برای این اثر ذخیره نشده است.' });
    }
    return;
  }
  if (kind === 'card') {
    await api('answerCallbackQuery', { callback_query_id: q.id, text: 'کارت اشتراک ارسال شد 📣' });
    await sendBook(q.message.chat.id, b, threadOf(q.message), '📣 <b>کارت اشتراک</b> — فوروارد کنید 👇');
    return;
  }
  await api('answerCallbackQuery', { callback_query_id: q.id });
}

const STARTED = Date.now();
const WEBHOOK_MODE = process.env.TELEGRAM_WEBHOOK === '1';
// مسیر مخفی وب‌هوک از هش توکن ساخته می‌شود (بدون env اضافه؛ بدون توکن حدس‌زدنی نیست)
const HOOK_PATH = '/telegram/hook/' + crypto.createHash('sha256').update(TOKEN).digest('hex').slice(0, 16);
function dispatch(fn, label, msg) {
  fn(msg).catch(e => {
    console.error('[bot]', label, 'error:', e.message, '| chat:', msg && msg.chat && msg.chat.id, '| text:', String(msg && (msg.text || '')).slice(0, 60));
    // در گفت‌وگوی خصوصی خطا را به کاربر هم بگو؛ در گروه شلوغ نکن
    if (msg && msg.chat && msg.chat.type === 'private') {
      api('sendMessage', { chat_id: msg.chat.id, text: '⚠️ خطایی رخ داد؛ دوباره تلاش کنید. (/ping برای بررسی وضعیت)' }).catch(() => {});
    }
  });
}
async function handleUpdate(u) {
  if (!u) return;
  if (u.callback_query) {
    dispatch(handleCallback, 'cb', u.callback_query);
  } else if (u.message && u.message.web_app_data) {
    dispatch(handleWebAppData, 'webdata', u.message);
  } else if (u.message) {
    dispatch(handle, 'handle', u.message);
  }
  // channel_post عمداً نادیده گرفته می‌شود (ربات در کانال پست نمی‌خواند)
}
async function handleWebAppData(msg) {
  const chatId = msg.chat.id;
  let d = {};
  try { d = JSON.parse(msg.web_app_data.data || '{}'); } catch (e) {}
  if (d.action === 'share' && d.title) {
    return api('sendMessage', Object.assign({ chat_id: chatId, parse_mode: 'HTML',
      text: '📜 <b>' + esc(d.title) + '</b>\n' + esc(d.text || '') + (d.link ? '\n🔗 <a href="' + d.link + '">بازکردن</a>' : '') }, threadOf(msg)));
  }
  if (d.action === 'link' && d.code) {
    const tgUser = { id: msg.from.id, first_name: msg.from.first_name, username: msg.from.username };
    const r = await linkCode(String(d.code), tgUser);
    return api('sendMessage', { chat_id: chatId, text: r.ok ? '✅ حساب شما به پنل وصل شد!' : '⚠️ کد معتبر نیست.' });
  }
}
let dailyOn = true;
function tehranHM(d) {
  try {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false });
    return f.format(d || new Date());
  } catch (e) { return ''; }
}
function tehranDate(d) {
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' });
    return f.format(d || new Date());
  } catch (e) { return new Date().toISOString().slice(0, 10); }
}
function dailyState() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'daily.json'), 'utf8')); }
  catch (e) { return {}; }
}
// قفل روزانهٔ ارسال: در Supabase (جدول daily_posts) تا با راه‌اندازی مجدد یا دیپلوی پاک نشود.
// اگر SUPABASE_SERVICE_KEY ست نباشد (لوکال)، از daily.json استفاده می‌شود.
const SB_URL = (process.env.SUPABASE_URL || 'https://adchcwdrtmyxczdlcqou.supabase.co').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
async function claimDaily(day) {
  if (SB_KEY) {
    const r = await fetch(SB_URL + '/rest/v1/daily_posts', {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ day: day })
    });
    if (!r.ok) throw new Error('daily claim HTTP ' + r.status);
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  }
  if (dailyState().date === day) return false;
  fs.writeFileSync(path.join(DATA, 'daily.json'), JSON.stringify({ date: day }));
  return true;
}
async function releaseDaily(day) {
  if (SB_KEY) {
    await fetch(SB_URL + '/rest/v1/daily_posts?day=eq.' + day, {
      method: 'DELETE', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }
    }).catch(() => {});
    return;
  }
  fs.writeFileSync(path.join(DATA, 'daily.json'), JSON.stringify({ date: '' }));
}
// ورودی اصلی: فقط یک بار در روز ارسال می‌کند، حتی اگر چند بار صدا زده شود یا ربات راه‌اندازی مجدد شود
async function postDaily() {
  const day = tehranDate();
  if (!(await claimDaily(day))) return { skipped: 'already', day: day };
  try {
    await postDailyInner();
    return { ok: true, day: day };
  } catch (e) {
    await releaseDaily(day);   // شکست ارسال: قفل امروز آزاد می‌شود تا بار بعد دوباره تلاش شود
    throw e;
  }
}
async function postDailyInner() {
  if (!BOOKS.length) return;
  const day = Math.floor(Date.now() / 86400000);
  const b = BOOKS[day % BOOKS.length];
  const chatId = CFG.channelId || CFG.channel;
  const r = await sendBook(chatId, b, null, '🎲 <b>اثر امروز</b>');
  console.log('[bot] daily posted:', r && r.ok ? 'OK' : 'FAIL');
  if (!r || !r.ok) throw new Error('daily send failed: ' + ((r && r.description) || 'no response'));
  // بازنشر در تاپیک «قاب من»
  const thread = CFG.topics && CFG.topics.frames;
  if (thread && r && r.ok && r.result && r.result.message_id) {
    try {
      await api('forwardMessage', { chat_id: CFG.groupId || CFG.group, message_thread_id: thread, from_chat_id: chatId, message_id: r.result.message_id });
    } catch (e) { console.error('[bot] daily repost error:', e.message); }
  }
}
module.exports = { CFG, TOKEN, SITE, PUBLIC, HAS_PUBLIC_HTTPS, WEBAPP, DATA, BOOKS, HOOK_PATH, MAIN_KEYBOARD, STARTED,
  api, handle, handleCallback, handleWebAppData, handleUpdate, sendBook, postDaily, linkCode, serverManifests,
  tehranHM, tehranDate, dailyState };
