// telegram/session-login.js — ورود به سایت «نشست» با حساب تلگرام
// مسیر: مرورگر کد می‌گیرد → کاربر در ربات /start login_کد را می‌فرستد → مرورگر یک توکن ورود یک‌بار مصرف می‌گیرد.
// کلید service_role فقط روی سرور است. مرورگر هرگز به آن دسترسی ندارد.
const SB_URL = (process.env.SUPABASE_URL || 'https://adchcwdrtmyxczdlcqou.supabase.co').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const TG_TOKEN = process.env.BOT_TOKEN || '';
const CODE_TTL_MS = 5 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // بدون حروف مشابه (0/O، 1/I)

const adminHeaders = () => ({ apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' });

async function rest(method, p, body, prefer) {
  const h = adminHeaders();
  if (prefer) h.Prefer = prefer;
  const r = await fetch(SB_URL + '/rest/v1/' + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(method + ' ' + p.split('?')[0] + ' HTTP ' + r.status + ' ' + t.slice(0, 120));
  return t ? JSON.parse(t) : null;
}

function newCode() {
  const b = require('crypto').randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}

let botUsername = '';
async function getBotUsername() {
  if (botUsername) return botUsername;
  const r = await fetch('https://api.telegram.org/bot' + TG_TOKEN + '/getMe').then((x) => x.json());
  if (!r.ok) throw new Error('getMe failed');
  botUsername = r.result.username;
  return botUsername;
}

// مرحلهٔ ۱: ساخت کد و لینک ربات
async function startLogin() {
  if (!SB_KEY || !TG_TOKEN) throw new Error('server not configured');
  const code = newCode();
  const expires = new Date(Date.now() + CODE_TTL_MS).toISOString();
  await rest('POST', 'tg_login_codes', { code, status: 'pending', expires_at: expires });
  const user = await getBotUsername();
  return { ok: true, code, link: 'https://t.me/' + user + '?start=login_' + code, expires_at: expires };
}

// کاربر در ربات کد را تأیید می‌کند؛ اگر کد معتبر و منقضی‌نشده باشد، حساب تلگرام به کد وصل می‌شود
async function confirmLogin(code, tgUser) {
  const rows = await rest('PATCH',
    'tg_login_codes?code=eq.' + encodeURIComponent(code) + '&status=eq.pending&expires_at=gt.' + new Date().toISOString(),
    { status: 'confirmed', tg_id: tgUser.id, tg_name: tgUser.first_name || tgUser.username || 'کاربر' },
    'return=representation');
  return rows.length > 0;
}

// یک حساب Supabase برای هر کاربر تلگرام (با ایمیل داخلی؛ ایمیل واقعی لازم نیست)
async function userForTelegram(tgId, name) {
  const found = await rest('GET', 'tg_accounts?tg_id=eq.' + tgId + '&select=user_id');
  if (found.length) return { id: found[0].user_id, email: 'tg' + tgId + '@telegram.coreader.local' };
  const email = 'tg' + tgId + '@telegram.coreader.local';
  const r = await fetch(SB_URL + '/auth/v1/admin/users', {
    method: 'POST', headers: adminHeaders(),
    body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: name, provider: 'telegram', tg_id: tgId } })
  });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error('create user failed: ' + (j.msg || j.error_description || r.status));
  await rest('POST', 'tg_accounts', { tg_id: tgId, user_id: j.id });
  return { id: j.id, email };
}

// مرحلهٔ ۲: مرورگر کد را می‌فرستد؛ اگر تأیید شده باشد، توکن ورود یک‌بار مصرف برمی‌گردد
async function statusLogin(code) {
  if (!code) return { ok: false, status: 'invalid' };
  const rows = await rest('GET', 'tg_login_codes?code=eq.' + encodeURIComponent(code) + '&select=*');
  if (!rows.length) return { ok: false, status: 'invalid' };
  const row = rows[0];
  if (row.status === 'used') return { ok: false, status: 'used' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, status: 'expired' };
  if (row.status !== 'confirmed') return { ok: true, status: 'pending' };

  // برای جلوگیری از استفادهٔ دوباره، ابتدا وضعیت را «used» می‌کنیم (اگر دو درخواست هم‌زمان بیایند، فقط یکی برنده می‌شود)
  const claimed = await rest('PATCH', 'tg_login_codes?code=eq.' + encodeURIComponent(code) + '&status=eq.confirmed',
    { status: 'used' }, 'return=representation');
  if (!claimed.length) return { ok: false, status: 'used' };

  const user = await userForTelegram(row.tg_id, row.tg_name);
  const r = await fetch(SB_URL + '/auth/v1/admin/generate_link', {
    method: 'POST', headers: adminHeaders(), body: JSON.stringify({ type: 'magiclink', email: user.email })
  });
  const j = await r.json();
  const hash = j.hashed_token || (j.properties && j.properties.hashed_token);
  if (!r.ok || !hash) throw new Error('generate_link failed: ' + (j.msg || r.status));
  return { ok: true, status: 'ok', token_hash: hash, type: 'magiclink' };
}

module.exports = { startLogin, confirmLogin, statusLogin };
