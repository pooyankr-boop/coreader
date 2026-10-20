import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const cfg = window.COREADER_SUPABASE;
const sb = createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function loadList() {
  const { data, error } = await sb.rpc('live_sessions');
  if (error) { $('err').textContent = 'خواندن فهرست ناموفق بود: ' + error.message; return; }
  $('err').textContent = '';
  $('list').innerHTML = (data && data.length) ? data.map((s) => `
    <div class="item">
      <b>${esc(s.title)}</b>
      ${s.book_slug ? `<span class="muted">${esc(s.book_slug)}</span>` : ''}
      <span class="tag">${s.visibility === 'public' ? 'عمومی' : 'خصوصی'}</span>
      ${s.has_password ? '<span class="tag">گذرواژه دارد</span>' : ''}
      <button data-id="${s.id}" data-pw="${s.has_password}" data-title="${esc(s.title)}">تماشا</button>
    </div>`).join('') : '<p class="muted">در حال حاضر پخش زنده‌ای نیست.</p>';
  $('list').querySelectorAll('button[data-id]').forEach((b) => {
    b.onclick = () => watch(b.dataset.id, b.dataset.pw === 'true', b.dataset.title);
  });
}

async function watch(id, needsPassword, title) {
  let pw = '';
  if (needsPassword) {
    pw = prompt('گذرواژهٔ این پخش را وارد کنید:') || '';
    if (!pw) return;
  }
  const { data, error } = await sb.rpc('live_room', { p_session: id, p_password: pw });
  if (error) { $('err').textContent = error.message; return; }
  $('err').textContent = '';
  $('playerTitle').textContent = title;
  $('player').src = 'https://meet.jit.si/' + encodeURIComponent(data) +
    '#config.prejoinPageEnabled=false&config.startWithAudioMuted=true&config.startWithVideoMuted=true';
  $('playerCard').style.display = '';
  $('playerCard').scrollIntoView({ behavior: 'smooth' });
}

loadList();
setInterval(loadList, 20000);