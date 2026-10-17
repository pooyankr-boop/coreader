// telegram/setup-topics.js — ساخت تاپیک‌های گروه (یک‌بار اجرا)
// پیش‌نیاز: گروه حالت Forum (Topics) فعال باشد + ربات ادمین.
// اجرا: node telegram/setup-topics.js
const fs = require('fs');
const path = require('path');

const cfgPath = path.join(__dirname, 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const TOKEN = cfg.botToken;
const GROUP = cfg.groupId || cfg.group;
const apiRaw = (m, p) => fetch('https://api.telegram.org/bot' + TOKEN + '/' + m, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p)
}).then(r => r.json());
// تلاش مجدد خودکار (۳ بار با ۲۰ ثانیه فاصله) برای قطعی‌های موقت اینترنت
async function api(m, p, tries) {
  tries = tries || 3;
  for (let i = 1; i <= tries; i++) {
    try { return await apiRaw(m, p); }
    catch (e) {
      console.log('retry ' + i + '/' + tries + ' for ' + m + ': ' + (e.cause ? e.cause.code : e.message));
      if (i === tries) throw e;
      await new Promise(r => setTimeout(r, 20000));
    }
  }
}

const TOPICS = [
  { key: 'tashkil', name: '✍️ رونویسی و حاشیه', icon: '✍️' },
  { key: 'quiz', name: '🧩 مسابقه حدس اثر', icon: '🧩' },
  { key: 'frames', name: '🖼️ قاب من', icon: '🖼️' },
  { key: 'chat', name: '💬 گفت‌وگو', icon: '💬' },
];

(async () => {
  const g = await api('getChat', { chat_id: GROUP });
  console.log('group:', g.ok ? (g.result.title + ' / is_forum=' + g.result.is_forum) : JSON.stringify(g).slice(0, 200));
  if (!g.ok) process.exit(1);
  if (!g.result.is_forum) {
    console.log('راهنما: در تنظیمات گروه → Topics را فعال کنید (Group Settings › Topics › Enable) و دوباره اجرا کنید.');
    process.exit(2);
  }
  cfg.topics = cfg.topics || {};
  for (const t of TOPICS) {
    if (cfg.topics[t.key]) { console.log('exists:', t.key, cfg.topics[t.key]); continue; }
    const r = await api('createForumTopic', { chat_id: GROUP, name: t.name, icon_color: 0x6FB9F0 });
    if (r.ok) {
      cfg.topics[t.key] = r.result.message_thread_id;
      console.log('created:', t.key, '→', r.result.message_thread_id);
      await api('sendMessage', { chat_id: GROUP, message_thread_id: r.result.message_thread_id,
        text: '👋 به تاپیک «' + t.name + '» خوش آمدید!\n\n' +
        (t.key === 'tashkil' ? 'رونویسی برگ‌ها و حاشیه‌ها را این‌جا بفرستید؛ با <code>/hashiye project-id متن #برچسب</code> مستقیم در پروژه IIIF ثبت می‌شود. فهرست پروژه‌ها: /projects' :
         t.key === 'quiz' ? 'هر روز یک مسابقه حدس اثر این‌جا برگزار می‌شود. شروع: /quiz' :
         t.key === 'frames' ? 'کارت‌های ساخته‌شده در پنل (📣 اشتراک‌گذاری) را این‌جا با هشتگ #قاب_من بفرستید؛ بهترین‌ها در کانال بازنشر می‌شود.' :
         'گفت‌وگوی آزاد درباره نسخ، موزه‌ها و تورها.') ,
        parse_mode: 'HTML' });
    } else {
      console.log('FAIL:', t.key, JSON.stringify(r).slice(0, 200));
      if (String(r.description || '').includes('rights')) {
        console.log('راهنما: Group Settings → Administrators → coreader_robot → گزینه «Manage Topics» را فعال کنید (ادمین‌بودن کافی نیست)، بعد دوباره اجرا کنید.');
      }
    }
  }
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  console.log('config.topics saved.');
})();
