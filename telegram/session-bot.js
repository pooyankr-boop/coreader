// telegram/session-bot.js — دستورهای ربات برای نشست‌های coreader (حاشیه و وظایف از داخل گروه)
// کارها با کلید service_role روی Supabase انجام می‌شود؛ کلید فقط در متغیر محیطی Render است.
// چون حساب تلگرام به حساب Supabase وصل نیست، نویسنده ردیف‌ها «مالک نشست» است و نام فرستنده در متن می‌آید.
const SB_URL = (process.env.SUPABASE_URL || 'https://adchcwdrtmyxczdlcqou.supabase.co').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SITE = (process.env.SITE_PUBLIC_URL || 'https://coreader-ez70.onrender.com').replace(/\/$/, '');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function rest(method, p, body, prefer) {
  const h = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
  if (prefer) h.Prefer = prefer;
  const r = await fetch(SB_URL + '/rest/v1/' + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(method + ' ' + p.split('?')[0] + ' HTTP ' + r.status + ' ' + t.slice(0, 120));
  return t ? JSON.parse(t) : null;
}

async function linkedSession(chatId) {
  const links = await rest('GET', 'bot_links?chat_id=eq.' + chatId + '&select=session_id');
  if (!links.length) return null;
  const rows = await rest('GET', 'sessions?id=eq.' + links[0].session_id + '&select=id,title,owner_id,invite_code');
  return rows[0] || null;
}

const HELP = [
  'دستورهای نشست:',
  '/s_link کد_دعوت — وصل کردن این گروه به یک نشست',
  '/s_info — نشست وصل‌شده و لینک آن',
  '/s_note شماره_صفحه متن — ثبت حاشیه برای صفحه',
  '/s_task متن #هشتگ — ثبت وظیفه',
  '/s_tasks — فهرست وظایف باز',
  '/s_done شماره — علامت انجام‌شد به وظیفه'
].join('\n');

// برمی‌گرداند true اگر پیام یک دستور نشست بود (تا ربات ادامه ندهد)
async function handle(msg, api) {
  if (!SB_KEY || !msg || !msg.text || msg.text[0] !== '/') return false;
  const m = msg.text.match(/^\/(s_\w+)(?:@\S+)?(?:\s+([\s\S]*))?$/i);
  if (!m) return false;
  const cmd = m[1].toLowerCase();
  const arg = (m[2] || '').trim();
  const chat = msg.chat.id;
  const who = (msg.from && (msg.from.first_name || msg.from.username)) || 'کاربر';
  const say = (t) => api('sendMessage', { chat_id: chat, text: t, parse_mode: 'HTML', disable_web_page_preview: true });
  const sessionLink = (s) => SITE + '/session/?s=' + s.id;

  try {
    if (cmd === 's_help') { await say(esc(HELP)); return true; }

    if (cmd === 's_link') {
      if (!arg) { await say('نمونه: /s_link کد_دعوت'); return true; }
      const found = await rest('GET', 'sessions?invite_code=eq.' + encodeURIComponent(arg) + '&select=id,title,owner_id,invite_code');
      if (!found.length) { await say('نشستی با این کد دعوت پیدا نشد.'); return true; }
      await rest('POST', 'bot_links?on_conflict=chat_id', { chat_id: chat, session_id: found[0].id, linked_by: who },
        'resolution=merge-duplicates,return=minimal');
      await say('این گروه به نشست «' + esc(found[0].title) + '» وصل شد.\n<a href="' + sessionLink(found[0]) + '">باز کردن نشست</a>');
      return true;
    }

    const s = await linkedSession(chat);
    if (!s) { await say('این گروه هنوز به نشستی وصل نیست. با /s_link کد_دعوت وصل کنید.'); return true; }

    if (cmd === 's_info') {
      await say('نشست: <b>' + esc(s.title) + '</b>\n<a href="' + sessionLink(s) + '">باز کردن نشست</a>');
      return true;
    }

    if (cmd === 's_note') {
      const mm = arg.match(/^(\d+)\s+([\s\S]+)$/);
      if (!mm) { await say('نمونه: /s_note 12 متن حاشیه'); return true; }
      await rest('POST', 'annotations', { session_id: s.id, page: +mm[1], body: '[' + who + '] ' + mm[2].trim(), created_by: s.owner_id });
      await say('حاشیه برای صفحهٔ ' + mm[1] + ' ثبت شد.');
      return true;
    }

    if (cmd === 's_task') {
      if (!arg) { await say('نمونه: /s_task بررسی حاشیهٔ صفحه ۱۲ #حاشیه'); return true; }
      const tags = [...arg.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((x) => x[1]);
      const title = ('[' + who + '] ' + arg.replace(/#[\p{L}\p{N}_]+/gu, '')).replace(/\s+/g, ' ').trim();
      const rows = await rest('POST', 'tasks', { session_id: s.id, title, tags, created_by: s.owner_id }, 'return=representation');
      await say('وظیفهٔ #' + rows[0].id + ' ثبت شد.');
      return true;
    }

    if (cmd === 's_tasks') {
      const rows = await rest('GET', 'tasks?session_id=eq.' + s.id + '&status=neq.done&select=id,title,tags,status&order=id');
      if (!rows.length) { await say('وظیفهٔ بازی وجود ندارد.'); return true; }
      await say(rows.map((t) => '#' + t.id + ' ' + esc(t.title) + (t.status === 'doing' ? ' (در حال انجام)' : '') +
        (t.tags && t.tags.length ? ' ' + t.tags.map((g) => '#' + esc(g)).join(' ') : '')).join('\n'));
      return true;
    }

    if (cmd === 's_done') {
      const id = parseInt(arg, 10);
      if (!id) { await say('نمونه: /s_done 3'); return true; }
      const rows = await rest('PATCH', 'tasks?id=eq.' + id + '&session_id=eq.' + s.id, { status: 'done' }, 'return=representation');
      await say(rows.length ? 'وظیفهٔ #' + id + ' انجام‌شد ثبت شد.' : 'وظیفه‌ای با این شماره در این نشست نیست.');
      return true;
    }
  } catch (e) {
    console.error('[session-bot]', cmd, e.message);
    await say('خطا: ' + esc(e.message));
    return true;
  }
  return false;
}

module.exports = { handle };
