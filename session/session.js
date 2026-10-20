import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { mountSourceSearch } from './source-search.js';
import { setOcrContext, initSessionOcr } from './ocr-session.js';

const cfg = window.COREADER_SUPABASE;
const sb = createClient(cfg.url, cfg.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const redirectUrl = () => location.origin + location.pathname;
const stLabel = (s) => ({ open: 'باز', doing: 'در حال انجام', done: 'انجام‌شده' }[s] || s);

let me = null;
let room = null;
let names = {};
let chans = [];
const seenMsg = new Set();
let taskList = [];

function show(view) {
  ['viewLogin', 'viewHome', 'viewRoom'].forEach((v) => $(v).classList.toggle('hidden', v !== view));
}

async function loadNames(ids) {
  const need = [...new Set(ids)].filter((id) => id && !names[id]);
  if (!need.length) return;
  const { data } = await sb.from('profiles').select('id,display_name').in('id', need);
  (data || []).forEach((p) => { names[p.id] = p.display_name; });
}
const nm = (id) => names[id] || 'کاربر';

// ---------- ورود ----------
$('btnEmail').onclick = async () => {
  const email = $('loginEmail').value.trim();
  if (!email) return;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl() } });
  $('loginMsg').textContent = error ? 'خطا: ' + error.message : 'پیوند ورود به ایمیل شما فرستاده شد.';
};
document.querySelectorAll('[data-oauth]').forEach((b) => {
  b.onclick = async () => {
    const { error } = await sb.auth.signInWithOAuth({
      provider: b.dataset.oauth, options: { redirectTo: redirectUrl() }
    });
    if (error) $('loginMsg').textContent = 'خطا: ' + error.message;
  };
});
$('btnSignOut').onclick = async () => { await sb.auth.signOut(); location.href = location.pathname; };

// ---------- ورود با تلگرام ----------
async function tgLogin() {
  $('loginMsg').textContent = '';
  const r = await fetch('/api/session-login/start', { method: 'POST' }).then((x) => x.json()).catch(() => ({ ok: false }));
  if (!r.ok) { $('loginMsg').textContent = 'ورود با تلگرام در دسترس نیست: ' + (r.error || 'خطای سرور'); return; }
  $('tgBox').classList.remove('hidden');
  $('tgCode').textContent = r.code;
  $('tgLink').href = r.link;
  pollTgLogin(r.code, Date.now());
}
async function pollTgLogin(code, started) {
  if (Date.now() - started > 5 * 60 * 1000) { $('tgState').textContent = 'کد منقضی شد. دوباره شروع کنید.'; return; }
  const j = await fetch('/api/session-login/status?code=' + encodeURIComponent(code)).then((x) => x.json()).catch(() => ({ ok: false }));
  if (j.status === 'ok') {
    $('tgState').textContent = 'در حال ورود…';
    const { error } = await sb.auth.verifyOtp({ token_hash: j.token_hash, type: j.type });
    if (error) $('tgState').textContent = 'خطا در ورود: ' + error.message;
    return;
  }
  if (j.status === 'pending') {
    $('tgState').textContent = 'منتظر تأیید در تلگرام…';
    setTimeout(() => pollTgLogin(code, started), 2000);
    return;
  }
  $('tgState').textContent = 'این کد دیگر معتبر نیست. دوباره شروع کنید.';
}
$('btnTg').onclick = tgLogin;

// ---------- تماس صوتی/تصویری (Jitsi) ----------
$('btnCall').onclick = () => {
  if (!room) return;
  const name = encodeURIComponent('coreader-session-' + room.id);
  $('callBox').innerHTML = '<iframe src="https://meet.jit.si/' + name + '#config.prejoinPageEnabled=false" ' +
    'allow="camera; microphone; display-capture; autoplay; fullscreen" ' +
    'style="width:100%;height:420px;border:0;border-radius:10px;margin-top:8px"></iframe>';
};
$('btnCallClose').onclick = () => { $('callBox').innerHTML = ''; };

// ---------- پخش زنده (Jitsi) ----------
// ---------- ناحیه روی تصویر صفحه ----------
let regionMode = false, regionDrag = null, pendingRect = null;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function drawRegions() {
  const wrap = document.getElementById('pageWrap');
  if (!wrap) return;
  const pageNo = curPage + 1;
  $('regionLayer').innerHTML = annos.filter((a) => a.page === pageNo && a.x != null).map((a, i) =>
    '<div class="rbox" title="' + esc(a.body) + '" style="left:' + (a.x * 100) + '%;top:' + (a.y * 100) + '%;width:' + (a.w * 100) + '%;height:' + (a.h * 100) + '%"><span>' + (i + 1) + '</span></div>').join('');
  drawDraft();
  if (wrap.dataset.bound) return;
  wrap.dataset.bound = '1';
  wrap.addEventListener('pointerdown', (e) => {
    if (!regionMode) return;
    const r = wrap.getBoundingClientRect();
    regionDrag = { r: r, x0: clamp01((e.clientX - r.left) / r.width), y0: clamp01((e.clientY - r.top) / r.height) };
    wrap.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!regionDrag) return;
    const x = clamp01((e.clientX - regionDrag.r.left) / regionDrag.r.width);
    const y = clamp01((e.clientY - regionDrag.r.top) / regionDrag.r.height);
    pendingRect = { x: Math.min(regionDrag.x0, x), y: Math.min(regionDrag.y0, y), w: Math.abs(x - regionDrag.x0), h: Math.abs(y - regionDrag.y0) };
    drawDraft();
  });
  wrap.addEventListener('pointerup', () => {
    if (!regionDrag) return;
    regionDrag = null;
    if (pendingRect && pendingRect.w > 0.01 && pendingRect.h > 0.01) {
      $('regionForm').classList.remove('hidden');
      $('regionInfo').textContent = 'ناحیهٔ انتخاب‌شده روی صفحهٔ ' + (curPage + 1);
      $('regionText').focus();
    } else { pendingRect = null; drawDraft(); }
  });
}
function drawDraft() {
  const d = $('regionDraft');
  if (!d) return;
  d.innerHTML = pendingRect
    ? '<div class="rbox draft" style="left:' + (pendingRect.x * 100) + '%;top:' + (pendingRect.y * 100) + '%;width:' + (pendingRect.w * 100) + '%;height:' + (pendingRect.h * 100) + '%"></div>'
    : '';
}
function hideRegionForm() { $('regionForm').classList.add('hidden'); $('regionText').value = ''; }
$('btnRegion').onclick = () => {
  regionMode = !regionMode;
  $('btnRegion').textContent = regionMode ? 'پایان کشیدن ناحیه' : 'کشیدن ناحیه روی صفحه';
  if (!regionMode) { pendingRect = null; hideRegionForm(); drawDraft(); }
};
$('btnRegionSave').onclick = async () => {
  const body = $('regionText').value.trim();
  if (!body || !pendingRect || !room) return;
  const r = pendingRect;
  const { error } = await sb.from('annotations').insert({
    session_id: room.id, page: curPage + 1, body: body, created_by: me.id, x: r.x, y: r.y, w: r.w, h: r.h
  });
  if (error) { $('roomErr').textContent = error.message; return; }
  pendingRect = null; hideRegionForm(); drawDraft();
};
$('btnRegionCancel').onclick = () => { pendingRect = null; hideRegionForm(); drawDraft(); };
// ---------- فایل‌های صوتی نشست و جستجوی عمیق OCR ----------
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normQ = (s) => (window.CoreaderOcrNorm ? window.CoreaderOcrNorm(s) : String(s).trim().toLowerCase());
function snippet(body, q) {
  const raw = q.trim();
  const at = body.indexOf(raw);
  const start = Math.max(0, (at >= 0 ? at : 0) - 60);
  const text = body.slice(start, start + 200);
  return (start > 0 ? '…' : '') + esc(text).replace(new RegExp(escapeRe(esc(raw)), 'gi'), (m) => '<mark>' + m + '</mark>') + '…';
}
async function loadMedia() {
  if (!room) return;
  const { data, error } = await sb.from('session_media')
    .select('id,file_name,size,created_by,created_at,storage_path')
    .eq('session_id', room.id).order('created_at', { ascending: false });
  if (error) { $('mediaList').textContent = error.message; return; }
  const list = data || [];
  await loadNames(list.map((m) => m.created_by));
  $('mediaList').innerHTML = list.length ? list.map((m) => `
    <div class="task">
      <div><b>${esc(m.file_name)}</b> <span class="tag">${((m.size || 0) / 1048576).toFixed(1)} MB</span></div>
      <div class="st">${esc(nm(m.created_by))} · ${new Date(m.created_at).toLocaleString('fa-IR')}</div>
      <div class="row" style="margin-top:6px">
        <button class="ghost" data-play="${m.id}">پخش</button>
        <a class="ghost" href="/session/studio.html?media=${m.id}" style="padding:9px 14px;border-radius:12px;border:1px solid var(--border);color:var(--accent);text-decoration:none">ویرایش و همگام‌سازی</a>
      </div>
      <div id="p-${m.id}"></div>
    </div>`).join('') : '<p class="muted">هنوز فایل صوتی نیست.</p>';
  $('mediaList').querySelectorAll('button[data-play]').forEach((b) => {
    b.onclick = async () => {
      const item = list.find((m) => m.id === b.dataset.play);
      const { data: u, error: e } = await sb.storage.from('session-media').createSignedUrl(item.storage_path, 3600);
      if (e) { $('roomErr').textContent = e.message; return; }
      $('p-' + item.id).innerHTML = '<audio controls preload="none" style="width:100%;margin-top:8px" src="' + u.signedUrl + '"></audio>';
    };
  });
}
$('btnMediaUpload').onclick = async () => {
  const file = $('mediaFile').files[0];
  if (!file || !room) { $('roomErr').textContent = 'ابتدا یک فایل صوتی انتخاب کنید.'; return; }
  $('btnMediaUpload').disabled = true;
  try {
    const ext = ((file.name.split('.').pop() || 'mp3').replace(/[^a-z0-9]/gi, '') || 'mp3').toLowerCase();
    const path = room.id + '/' + Date.now() + '.' + ext;
    const up = await sb.storage.from('session-media').upload(path, file, { contentType: file.type || 'audio/mpeg' });
    if (up.error) throw up.error;
    const { error } = await sb.from('session_media').insert({
      session_id: room.id, storage_path: path, file_name: file.name, mime: file.type, size: file.size, created_by: me.id
    });
    if (error) throw error;
    $('mediaFile').value = '';
    await loadMedia();
  } catch (e) { $('roomErr').textContent = 'بارگذاری ناموفق بود: ' + e.message; }
  $('btnMediaUpload').disabled = false;
};
$('btnOcrSearch').onclick = async () => {
  const q = $('ocrQuery').value.trim();
  if (!q || !room) return;
  const { data, error } = await sb.rpc('search_ocr', { p_session: room.id, p_query: normQ(q) });
  if (error) { $('ocrResults').innerHTML = '<p class="err">' + esc(error.message) + '</p>'; return; }
  const rows = data || [];
  $('ocrResults').innerHTML = rows.length
    ? '<p class="muted">' + rows.length + ' نتیجه</p>' + rows.map((r) => `
        <div class="task"><div class="st">${esc(r.source || '')} · صفحهٔ ${r.page_no || '?'}</div>
        <div>${snippet(r.body, q)}</div></div>`).join('')
    : '<p class="muted">نتیجه‌ای پیدا نشد.</p>';
};
$('btnCatalogSession').onclick = async () => {
  if (!room || !me) return;
  const { error } = await sb.from('catalog_items').insert({
    kind: 'manuscript', title: room.title, source: 'نشست', source_url: location.origin + '/session/?s=' + room.id,
    iiif_manifest: room.manifest_url || null, visible: false, submitted_by: me.id, session_id: room.id
  });
  $('roomErr').textContent = error ? 'خطا: ' + error.message : 'این نشست به‌عنوان پیش‌نویس به کاتالوگ اضافه شد.';
};
function paintLive() {
  $('btnLive').textContent = room && room.is_live ? 'پایان پخش زنده' : 'شروع پخش زنده';
}
$('btnLive').onclick = async () => {
  if (!room) return;
  const turnOn = !room.is_live;
  const pw = $('livePw').value.trim();
  const { error } = await sb.rpc('set_live', { p_session: room.id, p_live: turnOn, p_password: turnOn ? pw : null });
  if (error) { $('roomErr').textContent = error.message; return; }
  room.is_live = turnOn;
  paintLive();
  $('liveState').textContent = turnOn
    ? 'پخش زنده فعال است' + (pw ? ' (با گذرواژه)' : ' (بدون گذرواژه)') + '. برای پخش، روی «تماس» بزنید تا اتاق باز شود؛ بینندگان از فهرست نشست‌های زنده وارد می‌شوند.'
    : 'پخش زنده متوقف شد.';
};

// ---------- ضبط صدا (روی دستگاه) ----------
let recorder = null, recChunks = [];
$('btnRec').onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    recChunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(recChunks, { type: recorder.mimeType || 'audio/webm' });
      const url = URL.createObjectURL(blob);
      $('recOut').innerHTML = '<audio controls src="' + url + '"></audio> <a download="session-record.webm" href="' + url + '">دانلود فایل</a>';
      stream.getTracks().forEach((t) => t.stop());
    };
    recorder.start();
    $('btnRec').disabled = true;
    $('btnRecStop').disabled = false;
  } catch (e) { $('roomErr').textContent = 'ضبط صدا ممکن نشد: ' + e.message; }
};
$('btnRecStop').onclick = () => {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  $('btnRec').disabled = false;
  $('btnRecStop').disabled = true;
};

// ---------- گفتار به متن (فارسی) کنار هر فیلد متنی ----------
function attachDictation(field) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ghost';
  btn.textContent = '🎤';
  btn.title = 'گفتار به متن (فارسی)';
  const lang = document.createElement('select');
  lang.className = 'ghost';
  lang.style.flex = '0 0 auto';
  lang.innerHTML = [['fa-IR', 'فارسی'], ['en-US', 'English'], ['ar-SA', 'العربية'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch']]
    .map(([v, t]) => '<option value="' + v + '">' + t + '</option>').join('');
  let rec = null;
  btn.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = lang.value;
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (const r of e.results) {
        if (r.isFinal) field.value += (field.value ? ' ' : '') + r[0].transcript.trim();
      }
    };
    rec.onend = () => { rec = null; btn.textContent = '🎤'; };
    rec.onerror = () => { rec = null; btn.textContent = '🎤'; };
    rec.start();
    btn.textContent = '⏹';
  };
  field.insertAdjacentElement('afterend', btn);
  btn.insertAdjacentElement('afterend', lang);
}
document.querySelectorAll('[data-dictation]').forEach(attachDictation);

async function enter(user) {
  me = user;
  const m = user.user_metadata || {};
  const name = m.full_name || m.user_name || m.preferred_username || (user.email || '').split('@')[0] || 'کاربر';
  $('who').textContent = name;
  $('btnSignOut').classList.remove('hidden');
  await sb.from('profiles').upsert({ id: user.id, display_name: name }, { onConflict: 'id', ignoreDuplicates: true });
  names[user.id] = name;
  const pending = new URLSearchParams(location.search).get('s');
  if (pending) {
    try { return await openSession(pending); } catch (e) { $('createMsg').textContent = e.message; }
  }
  renderHome();
}

// ---------- فهرست نشست‌ها ----------
async function renderHome() {
  show('viewHome');
  const { data, error } = await sb.from('sessions')
    .select('id,title,book_slug,visibility,owner_id,created_at')
    .order('created_at', { ascending: false }).limit(100);
  if (error) { $('createMsg').textContent = error.message; return; }
  const { data: mem } = await sb.from('session_members').select('session_id').eq('user_id', me.id);
  const mine = new Set((mem || []).map((x) => x.session_id));
  const list = $('sessionList');
  list.innerHTML = (data && data.length) ? data.map((s) => `
    <a data-id="${s.id}" data-public="${s.visibility === 'public'}" data-member="${mine.has(s.id)}">
      <b>${esc(s.title)}</b>
      <span class="tag">${s.visibility === 'public' ? 'عمومی' : 'خصوصی'}</span>
      ${mine.has(s.id) ? '<span class="tag">عضو</span>' : ''}
      ${s.book_slug ? `<span class="muted"> · ${esc(s.book_slug)}</span>` : ''}
    </a>`).join('') : '<p class="muted">نشستی نیست.</p>';
  list.querySelectorAll('a').forEach((a) => {
    a.onclick = () => openFromList(a.dataset.id, a.dataset.public === 'true', a.dataset.member === 'true');
  });
}

async function openFromList(id, isPublic, isMember) {
  try {
    if (!isMember) {
      if (!isPublic) return;
      const { error } = await sb.rpc('join_public_session', { sid: id });
      if (error) throw error;
    }
    await openSession(id);
  } catch (e) { $('createMsg').textContent = e.message; }
}

$('btnCreate').onclick = async () => {
  const title = $('newTitle').value.trim();
  if (!title) return;
  const { data, error } = await sb.rpc('create_session', {
    p_title: title,
    p_book: $('newBook').value.trim() || null,
    p_visibility: $('newVis').value
  });
  if (error) { $('createMsg').textContent = error.message; return; }
  await openSession(data);
};

$('btnJoin').onclick = async () => {
  const code = $('joinCode').value.trim();
  if (!code) return;
  const { data, error } = await sb.rpc('join_session', { code });
  if (error) { $('joinMsg').textContent = 'کد نامعتبر است.'; return; }
  await openSession(data);
};

// ---------- اتاق نشست ----------
async function openSession(id) {
  const { data: s, error } = await sb.from('sessions').select('*').eq('id', id).single();
  if (error || !s) throw new Error('دسترسی به این نشست ندارید (کد دعوت لازم است).');
  room = s;
  seenMsg.clear();
  show('viewRoom');
  $('roomTitle').textContent = s.title;
  $('roomMeta').textContent = (s.visibility === 'public' ? 'عمومی' : 'خصوصی') +
    (s.book_slug ? ' · اثر: ' + s.book_slug : '') + ' · کد دعوت: ' + s.invite_code;
  $('roomErr').textContent = '';
  curPage = 0; manifest = null; annos = [];
  paintLive();
  loadMedia();
  setOcrContext(room, me, sb);
  await Promise.all([loadMembers(), loadMessages(), loadTasks(), loadManifest(), loadAnnotations()]);
  subscribe();
  history.replaceState(null, '', '?s=' + id);
}

$('btnBack').onclick = () => {
  chans.forEach((c) => sb.removeChannel(c));
  chans = []; room = null;
  history.replaceState(null, '', location.pathname);
  renderHome();
};

async function loadMembers() {
  const { data } = await sb.from('session_members').select('user_id,role').eq('session_id', room.id);
  await loadNames((data || []).map((m) => m.user_id));
  $('members').innerHTML = (data || []).map((m) =>
    `${esc(nm(m.user_id))} <span class="tag">${m.role === 'owner' ? 'مالک' : 'عضو'}</span>`).join('<br>');
}

async function loadMessages() {
  const { data, error } = await sb.from('messages')
    .select('id,body,user_id,created_at').eq('session_id', room.id)
    .order('created_at', { ascending: true }).limit(300);
  if (error) { $('roomErr').textContent = error.message; return; }
  await loadNames((data || []).map((m) => m.user_id));
  $('chat').innerHTML = '';
  (data || []).forEach(appendMessage);
  scrollChat();
}

function appendMessage(m) {
  if (seenMsg.has(m.id)) return;
  seenMsg.add(m.id);
  const t = new Date(m.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  const d = document.createElement('div');
  d.className = 'msg';
  d.innerHTML = `<b>${esc(nm(m.user_id))}</b> <span class="muted">${t}</span>
    <div>${esc(m.body).replace(/#([\p{L}\p{N}_]+)/gu, '<span class="tag">#$1</span>')}</div>`;
  $('chat').appendChild(d);
}

function sys(text) {
  const d = document.createElement('div');
  d.className = 'msg sys';
  d.textContent = text;
  $('chat').appendChild(d);
  scrollChat();
}
function scrollChat() { const c = $('chat'); c.scrollTop = c.scrollHeight; }

async function loadTasks() {
  const { data } = await sb.from('tasks').select('*').eq('session_id', room.id).order('id');
  await loadNames((data || []).flatMap((t) => [t.created_by, t.assignee]));
  taskList = data || [];
  renderTasks();
}

function renderTasks() {
  const box = $('tasks');
  box.innerHTML = taskList.length ? taskList.map((t) => `
    <div class="task">
      <div><b>#${t.id}</b> ${esc(t.title)}</div>
      <div>${(t.tags || []).map((g) => `<span class="tag">#${esc(g)}</span>`).join('')}</div>
      <div class="st">${stLabel(t.status)} · ${esc(nm(t.created_by))}</div>
      <div class="row" style="margin-top:6px">
        ${['open', 'doing', 'done'].filter((x) => x !== t.status)
          .map((x) => `<button class="ghost" data-tid="${t.id}" data-st="${x}">${stLabel(x)}</button>`).join('')}
      </div>
    </div>`).join('') : '<p class="muted">وظیفه‌ای نیست.</p>';
  box.querySelectorAll('button[data-tid]').forEach((b) => {
    b.onclick = () => setTaskStatus(+b.dataset.tid, b.dataset.st);
  });
}

async function setTaskStatus(id, st) {
  const { error } = await sb.from('tasks').update({ status: st }).eq('id', id);
  if (error) $('roomErr').textContent = error.message;
}

function subscribe() {
  chans.forEach((c) => sb.removeChannel(c));
  chans = [];
  chans.push(sb.channel('msg-' + room.id).on('postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'messages', filter: 'session_id=eq.' + room.id },
    async (p) => { await loadNames([p.new.user_id]); appendMessage(p.new); scrollChat(); }
  ).subscribe());
  chans.push(sb.channel('task-' + room.id).on('postgres_changes',
    { event: '*', schema: 'public', table: 'tasks', filter: 'session_id=eq.' + room.id },
    () => loadTasks()
  ).subscribe());
  chans.push(sb.channel('anno-' + room.id).on('postgres_changes',
    { event: '*', schema: 'public', table: 'annotations', filter: 'session_id=eq.' + room.id },
    () => loadAnnotations()
  ).subscribe());
  chans.push(sb.channel('sess-' + room.id).on('postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'sessions', filter: 'id=eq.' + room.id },
    async (p) => {
      room.title = p.new.title; room.manifest_url = p.new.manifest_url;
      $('roomTitle').textContent = room.title;
      if (!manifest || manifest.src !== room.manifest_url) loadManifest();
    }
  ).subscribe());
}

// ---------- مانیفست و حاشیه ----------
let curPage = 0;
let manifest = null;   // { label, canvases:[{label,img}], src }
let annos = [];

function lbl(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  const a = Object.values(v)[0];
  return Array.isArray(a) ? (a[0] || '') : (a || '');
}

function parseManifest(j, src) {
  const pick = (svc) => (Array.isArray(svc) ? svc[0] : svc);
  const imgFrom = (res) => {
    const svc = pick(res && res.service);
    const base = svc && (svc['@id'] || svc.id);
    if (base) return base.replace(/\/$/, '') + '/full/900,/0/default.jpg';
    return (res && (res['@id'] || res.id)) || '';
  };
  let canvases = [];
  if (j.sequences && j.sequences[0]) {          // IIIF v2
    canvases = j.sequences[0].canvases.map((c, i) => ({
      label: lbl(c.label) || ('صفحه ' + (i + 1)),
      img: imgFrom(c.images && c.images[0] && c.images[0].resource)
    }));
  } else if (j.items) {                         // IIIF v3
    canvases = j.items.map((c, i) => {
      const body = c.items && c.items[0] && c.items[0].items && c.items[0].items[0] && c.items[0].items[0].body;
      return { label: lbl(c.label) || ('صفحه ' + (i + 1)), img: imgFrom(body) };
    });
  }
  return { label: lbl(j.label) || 'بدون عنوان', canvases, src };
}

async function fetchManifest(url) {
  // ابتدا مستقیم؛ اگر سرور مقصد CORS نداشت، از پروکسی داخلی سرور استفاده می‌شود
  try {
    const r = await fetch(url);
    if (r.ok) return await r.json();
  } catch (e) { /* ادامه با پروکسی */ }
  const r2 = await fetch('/proxy-manifest?url=' + encodeURIComponent(url));
  if (!r2.ok) throw new Error('HTTP ' + r2.status);
  return await r2.json();
}

async function loadManifest() {
  $('mfOwner').classList.toggle('hidden', room.owner_id !== me.id);
  $('mfUrl').value = room.manifest_url || '';
  if (!room.manifest_url) {
    manifest = null;
    $('mfInfo').textContent = 'هنوز مانیفستی ثبت نشده است.';
    $('mfPages').innerHTML = ''; $('pagePreview').innerHTML = ''; $('pageTitle').textContent = '';
    renderAnnotations();
    return;
  }
  $('mfInfo').textContent = 'در حال خواندن مانیفست…';
  try {
    manifest = parseManifest(await fetchManifest(room.manifest_url), room.manifest_url);
    if (curPage >= manifest.canvases.length) curPage = 0;
    $('mfInfo').textContent = manifest.label + ' — ' + manifest.canvases.length + ' صفحه';
    $('mfPages').innerHTML = manifest.canvases.map((c, i) =>
      `<button class="ghost" data-i="${i}" style="padding:4px 8px;margin:2px">${i + 1}</button>`).join('');
    $('mfPages').querySelectorAll('button').forEach((b) => { b.onclick = () => showPage(+b.dataset.i); });
    showPage(curPage);
  } catch (e) {
    manifest = null;
    $('mfInfo').textContent = 'خواندن مانیفست ناموفق بود: ' + e.message;
    $('mfPages').innerHTML = ''; $('pagePreview').innerHTML = '';
  }
}

function showPage(i) {
  if (!manifest) return;
  curPage = i;
  const c = manifest.canvases[i];
  $('pagePreview').innerHTML = c && c.img
    ? `<div class="pw" id="pageWrap"><img src="${esc(c.img)}" alt="${esc(c.label)}"><div id="regionLayer"></div><div id="regionDraft"></div></div>`
    : '<p class="muted">تصویر این صفحه پیدا نشد.</p>';
  $('pageTitle').textContent = (c ? c.label : '') + ' (' + (i + 1) + ')';
  renderAnnotations();
}

async function loadAnnotations() {
  const { data, error } = await sb.from('annotations')
    .select('id,page,body,created_by,created_at,x,y,w,h')
    .eq('session_id', room.id).order('created_at', { ascending: true });
  if (error) { $('roomErr').textContent = error.message; return; }
  annos = data || [];
  await loadNames(annos.map((a) => a.created_by));
  renderAnnotations();
}

function renderAnnotations() {
  drawRegions();
  const pageNo = curPage + 1;
  $('annoPage').textContent = manifest ? 'حاشیه‌های صفحهٔ ' + pageNo : 'ابتدا مانیفست را ثبت کنید.';
  const list = annos.filter((a) => a.page === pageNo);
  $('annoList').innerHTML = list.length ? list.map((a) => `
    <div class="task">
      <div>${esc(a.body)}</div>
      <div class="st">${esc(nm(a.created_by))} · ${new Date(a.created_at).toLocaleString('fa-IR')}</div>
      ${a.created_by === me.id ? `<button class="ghost" data-del="${a.id}">حذف</button>` : ''}
    </div>`).join('') : '<p class="muted">حاشیه‌ای برای این صفحه نیست.</p>';
  $('annoList').querySelectorAll('button[data-del]').forEach((b) => {
    b.onclick = async () => {
      const { error } = await sb.from('annotations').delete().eq('id', +b.dataset.del);
      if (error) $('roomErr').textContent = error.message;
    };
  });
}

$('btnAnno').onclick = async () => {
  const body = $('annoInput').value.trim();
  if (!body || !manifest) return;
  const { error } = await sb.from('annotations').insert({
    session_id: room.id, page: curPage + 1, body, created_by: me.id
  });
  if (error) $('roomErr').textContent = error.message;
  else $('annoInput').value = '';
};

$('btnMf').onclick = async () => {
  const url = $('mfUrl').value.trim();
  if (!/^https?:\/\//.test(url)) { $('roomErr').textContent = 'آدرس مانیفست باید با http یا https شروع شود.'; return; }
  const { error } = await sb.from('sessions').update({ manifest_url: url }).eq('id', room.id);
  if (error) { $('roomErr').textContent = error.message; return; }
  room.manifest_url = url; curPage = 0;
  await loadManifest();
};

$('btnTitle').onclick = async () => {
  const t = prompt('عنوان جدید نشست:', room.title);
  if (!t || !t.trim() || t.trim() === room.title) return;
  const { error } = await sb.from('sessions').update({ title: t.trim() }).eq('id', room.id);
  if (error) { $('roomErr').textContent = error.message; return; }
  room.title = t.trim();
  $('roomTitle').textContent = room.title;
};

// ---------- ارسال و دستورها ----------
async function sendInput() {
  const raw = $('msgInput').value.trim();
  if (!raw) return;
  $('msgInput').value = '';
  $('roomErr').textContent = '';
  if (raw.startsWith('/')) return runCommand(raw);
  const { error } = await sb.from('messages').insert({ session_id: room.id, user_id: me.id, body: raw });
  if (error) $('roomErr').textContent = error.message;
}
$('btnSend').onclick = sendInput;
$('msgInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInput(); }
});

async function runCommand(line) {
  const [cmd, ...rest] = line.split(/\s+/);
  const arg = rest.join(' ').trim();
  if (cmd === '/task') {
    if (!arg) return sys('نمونه: /task بررسی حاشیهٔ صفحه ۱۲ #حاشیه #صفحه۱۲');
    const tags = [...arg.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]);
    const title = arg.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim() || arg;
    const { error } = await sb.from('tasks').insert({ session_id: room.id, title, tags, created_by: me.id });
    if (error) sys('خطا: ' + error.message);
    return;
  }
  if (cmd === '/doing' || cmd === '/done' || cmd === '/open') {
    const id = parseInt(arg, 10);
    if (!id) return sys('نمونه: ' + cmd + ' 3');
    const st = cmd === '/doing' ? 'doing' : cmd === '/done' ? 'done' : 'open';
    const { error } = await sb.from('tasks').update({ status: st }).eq('id', id);
    if (error) sys('خطا: ' + error.message);
    return;
  }
  if (cmd === '/invite') return sys('کد دعوت: ' + room.invite_code);
  if (cmd === '/help') return sys('دستورها: /task متن #هشتگ · /doing شماره · /done شماره · /open شماره · /invite · /help');
  sys('دستور ناشناخته است. /help را بزنید.');
}

// ---------- شروع ----------
async function init() {
  if (!cfg || !cfg.url) { $('loginMsg').textContent = 'تنظیمات Supabase پیدا نشد.'; show('viewLogin'); return; }
  const { data } = await sb.auth.getSession();
  if (data.session) await enter(data.session.user);
  else show('viewLogin');
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'SIGNED_IN' && session && (!me || me.id !== session.user.id)) enter(session.user);
    if (ev === 'SIGNED_OUT') { me = null; show('viewLogin'); }
  });
}
mountSourceSearch($('homeSearch'), {
  actions: [
    { id: 'session', label: 'ساخت نشست با این منبع' },
    { id: 'catalog', label: 'افزودن به کاتالوگ (پیش‌نویس)' }
  ],
  onAction: async (id, x) => {
    if (!me) { $('createMsg').textContent = 'برای این کار ابتدا وارد شوید.'; return; }
    if (id === 'session') {
      const { data: sid, error } = await sb.rpc('create_session', { p_title: x.title || 'نشست جدید', p_book: null, p_visibility: 'private' });
      if (error) { $('createMsg').textContent = error.message; return; }
      if (x.iiif) await sb.from('sessions').update({ manifest_url: x.iiif }).eq('id', sid);
      openSession(sid);
    } else if (id === 'catalog') {
      const { error } = await sb.from('catalog_items').insert({
        kind: x.kind || 'book', title: x.title || 'بی‌عنوان', author: x.author || null, language: x.lang || null,
        year: x.year || null, source: x.source, source_url: x.url, iiif_manifest: x.iiif || null,
        pdf_url: x.pdf || null, visible: false, submitted_by: me.id
      });
      $('createMsg').textContent = error ? 'خطا: ' + error.message : 'به‌عنوان پیش‌نویس به کاتالوگ اضافه شد.';
    }
  }
});
initSessionOcr();
init();
