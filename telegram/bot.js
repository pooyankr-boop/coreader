// telegram/bot.js — اجرای polling ربات + زمان‌بند روزانه (لوکال/سرور همیشه‌روشن)
// روی هاست خواب‌آلود به‌جای این فایل از وب‌هوک استفاده کنید (DEPLOY-fa.md بخش ۵).
const core = require('./bot-core.js');
const WEBHOOK = process.env.TELEGRAM_WEBHOOK === '1';
// همگام‌سازی فهرست دستورها و دکمه منوی ربات هنگام راه‌اندازی (دوباره دستی نیاز نیست)
const MENU_COMMANDS = [
  { command: 'start', description: 'شروع و راهنما' },
  { command: 'app', description: 'بازکردن کتابخوان' },
  { command: 'search', description: 'جست‌وجو: /search متن' },
  { command: 'book', description: 'کتاب مشخص: /book slug' },
  { command: 'daily', description: 'اثر روز' },
  { command: 'quiz', description: 'مسابقه یا پرسش از آثار' },
  { command: 'hashiye', description: 'حاشیه روی اثر' },
  { command: 'link', description: 'اتصال حساب: /link کد' },
  { command: 's_help', description: 'راهنمای نشست' },
  { command: 's_link', description: 'وصل کردن گروه به نشست' },
  { command: 's_info', description: 'نشست وصل‌شده' },
  { command: 's_note', description: 'حاشیه: /s_note صفحه متن' },
  { command: 's_task', description: 'ثبت وظیفه با #هشتگ' },
  { command: 's_tasks', description: 'وظایف باز' },
  { command: 's_done', description: 'انجام‌شد: /s_done شماره' }
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

// اثر روز: از ۸ صبح تهران، اگر امروز هنوز ارسال نشده، ارسال می‌کند.
// قفل «یک بار در روز» داخل postDaily (Supabase) است، پس راه‌اندازی مجدد یا چند نمونه هم دوباره ارسال نمی‌کند.
let lastDoneDay = '';
setInterval(async () => {
  try {
    if (core.tehranHM() < '08:00') return;
    const today = core.tehranDate();
    if (lastDoneDay === today) return;
    const r = await core.postDaily();
    lastDoneDay = today;
    console.log('[bot] daily:', r && r.skipped ? 'already posted today' : 'posted');
  } catch (e) { console.error('[bot] daily error:', e.message); }
}, 60000);

// WEBHOOK_MODE: روی هاست، آپدیت‌ها از مسیر وب‌هوک می‌آیند (poll لازم نیست)
if (WEBHOOK) {
  console.log('[bot] webhook mode: updates via ' + core.HOOK_PATH);
} else {
  poll();
}
module.exports = { handleUpdate: core.handleUpdate, HOOK_PATH: core.HOOK_PATH, postDaily: core.postDaily };
