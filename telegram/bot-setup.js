// telegram/bot-setup.js — تنظیمات یک‌باره ربات (دستورات، توضیح، منوی مینی‌اپ)
// اجرا: node telegram/bot-setup.js [SITE_PUBLIC_URL]
// مثال: node telegram/bot-setup.js https://coreader.example.com
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const TOKEN = cfg.botToken;
// آرگومان اول = آدرس عمومی؛ اگر داده نشد و sitePublic در کانفیگ هست همان استفاده می‌شود
const SITE = process.argv[2] || cfg.sitePublic || cfg.siteBase || 'http://localhost:8081';
if (/YOUR-DOMAIN|example\.(com|org|net)/i.test(SITE) && !process.argv.includes('--delete-webhook')) {
  console.log('SITE is still a placeholder (' + SITE + '). Commands updated below; for webapp/menu pass a real URL:');
  console.log('  node telegram/bot-setup.js https://YOUR-DOMAIN');
}
if (process.argv[2] && /^https:\/\//i.test(process.argv[2]) && !cfg.sitePublic) {
  cfg.sitePublic = process.argv[2].replace(/\/$/, '');
  fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(cfg, null, 2));
  console.log('sitePublic saved:', cfg.sitePublic);
}
const api = (m, p) => fetch('https://api.telegram.org/bot' + TOKEN + '/' + m, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p)
}).then(r => r.json());

(async () => {
  if (process.argv.includes('--delete-webhook')) {
    console.log('deleteWebhook:', JSON.stringify(await api('deleteWebhook', { drop_pending_updates: false })));
    return;
  }
  const me = await api('getMe', {});
  console.log('bot:', me.ok && me.result.username);

  const commands = [
    { command: 'start', description: 'شروع و راهنما' },
    { command: 'app', description: 'بازکردن مینی‌اپ کتابخانه' },
    { command: 'search', description: 'جست‌وجو: /search حافظ' },
    { command: 'book', description: 'کارت اثر: /book slug' },
    { command: 'card', description: 'کارت اشتراک: /card slug' },
    { command: 'daily', description: 'اثر تصادفی امروز' },
    { command: 'quiz', description: 'مسابقه حدس اثر' },
    { command: 'tour', description: 'تورهای مجازی' },
    { command: 'manifest', description: 'مانیفست IIIF اثر' },
    { command: 'projects', description: 'پروژه‌های IIIF گروه' },
    { command: 'hashiye', description: 'حاشیه روی پروژه: /hashiye id متن' },
    { command: 'topics', description: 'تاپیک‌های گروه' },
    { command: 'link', description: 'اتصال پنل: /link 123456' },
    { command: 'id', description: 'شناسه گفت‌وگو' },
    { command: 'ping', description: 'بررسی سلامت ربات' },
  ];
  console.log('setMyCommands:', (await api('setMyCommands', { commands })).ok);
  console.log('setMyDescription:', (await api('setMyDescription', {
    description: 'کتابخانه نسخ خطی و اوراق فارسی: جست‌وجو، مطالعه IIIF، تور مجازی، حاشیه‌نویسی و پنل کاربری.'
  })).ok);
  console.log('setMyShortDescription:', (await api('setMyShortDescription', {
    short_description: 'نسخ خطی فارسی، موزه، تور مجازی و حاشیه‌نویسی IIIF'
  })).ok);

  // دکمه منوی مینی‌اپ + وب‌هوک — فقط با URL عمومی واقعی (نه placeholder) کار می‌کند
  if (/^https:\/\//.test(SITE) && !/YOUR-DOMAIN|example\.(com|org|net)/i.test(SITE)) {
    const url = SITE.replace(/\/$/, '') + '/telegram/webapp/';
    console.log('webapp url:', url);
    console.log('setChatMenuButton:', JSON.stringify(await api('setChatMenuButton', {
      menu_button: { type: 'web_app', text: 'کتابخانه', web_app: { url } }
    })));
    const crypto = require('crypto');
    const hook = SITE.replace(/\/$/, '') + '/telegram/hook/' + crypto.createHash('sha256').update(TOKEN).digest('hex').slice(0, 16);
    const wh = await api('setWebhook', { url: hook, allowed_updates: ['message', 'callback_query'] });
    console.log('setWebhook:', wh.ok ? ('OK → ' + hook) : JSON.stringify(wh).slice(0, 200));
    if (wh.ok) console.log('IMPORTANT: on hosting set TELEGRAM_WEBHOOK=1 (and stop local polling bot); locally run node telegram/bot.js with webhook deleted: delete via Bot API deleteWebhook or re-run without https.');
  } else {
    console.log('skip menu button: SITE is not public https:', SITE);
    console.log('hint: node telegram/bot-setup.js https://YOUR-PUBLIC-DOMAIN');
  }

  // بررسی دسترسی به کانال/گروه
  for (const chat of [cfg.channel, cfg.groupId || cfg.group]) {
    if (!chat) continue;
    try {
      const c = await api('getChat', { chat_id: chat });
      console.log('getChat', chat, c.ok ? ('OK: ' + c.result.title + ' / ' + c.result.type) : ('FAIL: ' + JSON.stringify(c)));
    } catch (e) { console.log('getChat', chat, 'ERR', e.message); }
  }
})();
