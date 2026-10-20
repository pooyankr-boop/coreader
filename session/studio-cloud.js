// استودیوی صوت — بخش نشست: بارگذاری فایل از باکت خصوصی، ذخیرهٔ برش و همگام‌سازی در نشست.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const cfg = window.COREADER_SUPABASE;
const sb = createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const $ = (id) => document.getElementById(id);
const S = () => window.CoreaderStudio;
const mediaId = new URLSearchParams(location.search).get('media');
let me = null, media = null;

function say(t) { $('cloudState').textContent = t; }

async function init() {
  const { data } = await sb.auth.getSession();
  me = data.session ? data.session.user : null;
  if (!me) {
    say('برای کار روی فایل‌های نشست، از صفحهٔ نشست وارد شوید. فایل‌های محلی بدون ورود کار می‌کنند.');
    return;
  }
  if (!mediaId) {
    say('برای باز کردن فایل نشست، از فهرست «فایل‌های صوتی نشست» روی ویرایش بزنید.');
    return;
  }
  say('در حال بارگذاری فایل نشست…');
  const { data: m, error } = await sb.from('session_media').select('*').eq('id', mediaId).single();
  if (error || !m) { say('این فایل پیدا نشد یا دسترسی ندارید.'); return; }
  media = m;
  const { data: u, error: ue } = await sb.storage.from('session-media').createSignedUrl(m.storage_path, 3600);
  if (ue) { say('خطا در دریافت فایل: ' + ue.message); return; }
  const blob = await fetch(u.signedUrl).then((r) => r.blob());
  await S().loadBlob(blob, m.file_name);
  if (m.sync) S().setSync(m.sync);
  $('trimEnd').value = S().duration().toFixed(2);
  say('فایل نشست: ' + m.file_name);
}

$('btnSaveSync').onclick = async () => {
  if (!media) { say('هیچ فایل نشستی باز نیست.'); return; }
  const { error } = await sb.from('session_media').update({ sync: S().getSync() }).eq('id', media.id);
  say(error ? 'خطا: ' + error.message : 'همگام‌سازی در نشست ذخیره شد.');
};

$('btnSaveTrim').onclick = async () => {
  if (!me || !media) { say('برای ذخیرهٔ برش، فایل نشست باز باشد.'); return; }
  const start = +$('trimStart').value || 0;
  const end = +$('trimEnd').value || S().duration();
  if (end <= start) { say('زمان پایان باید بعد از زمان شروع باشد.'); return; }
  const r = S().trim(start, end);
  const name = media.file_name.replace(/\.[^.]+$/, '') + '-برش.wav';
  const path = media.session_id + '/' + Date.now() + '.wav';
  const up = await sb.storage.from('session-media').upload(path, r.blob, { contentType: 'audio/wav' });
  if (up.error) { say('خطا در آپلود: ' + up.error.message); return; }
  const { error } = await sb.from('session_media').insert({
    session_id: media.session_id, storage_path: path, file_name: name, mime: 'audio/wav',
    size: r.blob.size, sync: { lines: S().lines(), markers: r.markers }, created_by: me.id
  });
  say(error ? 'خطا: ' + error.message : 'نسخهٔ برش‌خورده در نشست ذخیره شد: ' + name);
};

init();