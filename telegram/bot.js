// telegram/bot.js — اجرای polling ربات + زمان‌بند روزانه (لوکال/سرور همیشه‌روشن)
// روی هاست خواب‌آلود به‌جای این فایل از وب‌هوک استفاده کنید (DEPLOY-fa.md بخش ۵).
const fs = require('fs');
const path = require('path');
const core = require('./bot-core.js');
const WEBHOOK = process.env.TELEGRAM_WEBHOOK === '1';
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
setInterval(async () => {
  try {
    if (core.tehranHM() !== '08:00') return;
    const st = core.dailyState();
    const today = core.tehranDate();
    if (st.date === today) return;
    fs.writeFileSync(path.join(core.DATA, 'daily.json'), JSON.stringify({ date: today }));
    await core.postDaily();
  } catch (e) { console.error('[bot] daily error:', e.message); }
}, 60000);
// WEBHOOK_MODE: روی هاست، آپدیت‌ها از مسیر وب‌هوک می‌آیند (poll لازم نیست)
if (WEBHOOK) {
  console.log('[bot] webhook mode: updates via ' + core.HOOK_PATH);
} else {
  poll();
}
module.exports = { handleUpdate: core.handleUpdate, HOOK_PATH: core.HOOK_PATH, postDaily: core.postDaily };
