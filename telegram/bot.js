// telegram/bot.js — اجرای polling ربات + زمان‌بند روزانه (لوکال/سرور همیشه‌روشن)
// روی هاست خواب‌آلود به‌جای این فایل از وب‌هوک استفاده کنید (DEPLOY-fa.md بخش ۵).
const core = require('./bot-core.js');
const WEBHOOK = process.env.TELEGRAM_WEBHOOK === '1';
// همگام‌سازی فهرست دستورها و دکمه منوی ربات هنگام راه‌اندازی (دوباره دستی نیاز نیست)
const MENU_COMMANDS = [
  { command: 'start', description: '🏛️ شروع و منوی اصلی' },
  { command: 'app', description: '📱 بازکردن مینی‌اپ کتابخوان' },
  { command: 'search', description: '🔍 جست‌وجوی هوشمند آثار' },
  { command: 'daily', description: '🎲 اثر تصادفی روز' },
  { command: 'quiz', description: '🧩 مسابقه حدس نسخه خطی' },
  { command: 'catalog', description: '📚 کاتالوگ جامع کتابخوانه' },
  { command: 'sessions', description: '👥 تالار کارگاه‌ها و نشست‌ها' },
  { command: 'live', description: '🔴 نشست‌های زنده فعال' },
  { command: 'tour', description: '🗺️ تورهای مجازی سه‌بعدی' },
  { command: 'projects', description: '📜 پروژه‌های IIIF و حاشیه‌نگاری' },
  { command: 'book', description: '📖 مشاهده اثر: /book slug' },
  { command: 'hashiye', description: '📝 ثبت حاشیه: /hashiye' },
  { command: 'link', description: '🔑 اتصال به پنل: /link کد' },
  { command: 'help', description: '❓ راهنمای جامع دستورها' },
  { command: 's_help', description: '👥 راهنمای نشست‌های گروهی' }
];
async function syncBotMenu() {
  try {
    const a = await core.api('setMyCommands', { commands: MENU_COMMANDS });
    console.log('[bot] setMyCommands:', a.ok);
    if (core.HAS_PUBLIC_HTTPS) {
      const b = await core.api('setChatMenuButton', { menu_button: {
        type: 'web_app', text: 'کتابخوان',
        web_app: { url: core.PUBLIC.replace(/\/$/, '') + '/telegram/webapp/' } } });
      console.log('[bot] setChatMenuButton:', b.ok);
    }
  } catch (e) { console.error('[bot] menu sync failed:', e.message); }
}
syncBotMenu();

let offset = 0;
let backoff = 500;
async function poll() {
  try {
    const r = await fetch('https://api.telegram.org/bot' + core.TOKEN + '/getUpdates?timeout=30&offset=' + offset).then(x => x.json());
    backoff = 500;
    if (r.ok && r.result) {
      for (const u of r.result) {
        offset = u.update_id + 1;
        core.handleUpdate(u);
      }
    } else if (r.error_code === 409) {
      // وب‌هوک فعال است؛ polling بی‌فایده است — عقب‌نشینی طولانی
      if (!poll._w) { poll._w = 1; console.error('[bot] webhook active, polling paused (409). Stop this process or delete webhook.'); }
      backoff = 300000;
    }
  } catch (e) { console.error('poll', e.message); }
  setTimeout(poll, backoff);
}
console.log('coreader bot polling… site=' + core.SITE + ' public=' + core.PUBLIC + (core.HAS_PUBLIC_HTTPS ? ' (webapp OK)' : ' (webapp needs https)'));

// سازوکار آماده‌باش و بیدارباش صبحگاهی (از ۰۷:۴۵ صبح تهران؛ ربع ساعت قبل از ۸)
// این فرآیند از به خواب رفتن سرور جلوگیری می‌کند تا پست رأس ساعت ۸ بدون وقفه ارسال شود.
let lastDoneDay = '';
setInterval(async () => {
  try {
    const hm = core.tehranHM();
    const today = core.tehranDate();

    // ربع ساعت قبل از هشت صبح (۰۷:۴۵ تا ۰۸:۰۰): پینگ آماده‌باش و گرم نگه‌داشتن سرور
    if (hm >= '07:45' && hm < '08:00') {
      try {
        await fetch(core.SITE + '/api/wake-daily').catch(() => {});
      } catch (e) {}
    }

    // ارسال پست روزانه رأس ساعت ۸ صبح به بعد
    if (hm >= '08:00') {
      if (lastDoneDay === today) return;
      const r = await core.postDaily();
      lastDoneDay = today;
      console.log('[bot] daily:', r && r.skipped ? 'already posted today' : 'posted');
    }
  } catch (e) { console.error('[bot] daily timer error:', e.message); }
}, 60000);

// WEBHOOK_MODE: روی هاست، آپدیت‌ها از مسیر وب‌هوک می‌آیند (poll لازم نیست)
if (WEBHOOK) {
  console.log('[bot] webhook mode: updates via ' + core.HOOK_PATH);
} else {
  poll();
}
module.exports = { handleUpdate: core.handleUpdate, HOOK_PATH: core.HOOK_PATH, postDaily: core.postDaily };
