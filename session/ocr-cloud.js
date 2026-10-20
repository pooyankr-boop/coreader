import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const cfg = window.COREADER_SUPABASE;
const sb = createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const $ = (id) => document.getElementById(id);

// یکسان‌سازی فارسی برای جستجو: حذف نیم‌فاصله و اعراب، یکسان‌کردن ی/ک/ه/ا
export function normFa(s) {
  return String(s)
    .replace(/[\u200c\u200d\u0640\u064b-\u065f\u0670]/g, '')
    .replace(/\u064a/g, '\u06cc').replace(/\u0643/g, '\u06a9')
    .replace(/\u0629/g, '\u0647').replace(/\u06c0/g, '\u0647')
    .replace(/[\u0622\u0623\u0625]/g, '\u0627')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
window.CoreaderOcrNorm = normFa;

const params = new URLSearchParams(location.search);
if (params.get('s')) $('ocrSession').value = params.get('s');

(async () => {
  const { data } = await sb.auth.getSession();
  window.CoreaderOcrUser = data.session ? data.session.user : null;
  $('btnSaveSession').title = window.CoreaderOcrUser ? '' : 'ابتدا از صفحهٔ نشست وارد شوید';
})();

$('btnSaveSession').onclick = async () => {
  const sid = $('ocrSession').value.trim();
  const res = window.CoreaderOcr ? window.CoreaderOcr.getResults() : [];
  if (!sid || !res.length) { $('msg').textContent = 'شناسهٔ نشست و حداقل یک نتیجهٔ OCR لازم است.'; return; }
  if (!window.CoreaderOcrUser) { $('msg').textContent = 'ابتدا از صفحهٔ نشست وارد شوید.'; return; }
  const rows = res.map((r, i) => ({
    session_id: sid, source: r.label, page_no: i + 1, body: r.text,
    norm: normFa(r.text), created_by: window.CoreaderOcrUser.id
  }));
  const { error } = await sb.from('ocr_pages').insert(rows);
  $('msg').textContent = error ? 'خطا: ' + error.message : rows.length + ' صفحه در نشست ذخیره شد و قابل جستجو است.';
};