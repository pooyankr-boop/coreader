-- patch-008: فایل‌های صوتی نشست (باکت خصوصی)، همگام‌سازی، و OCR نشست با جستجوی عمیق
-- در Supabase → SQL Editor اجرا شود (قابل اجرای مجدد است).

insert into storage.buckets (id, name, public)
values ('session-media', 'session-media', false)
on conflict (id) do nothing;

create table if not exists public.session_media (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime text,
  size bigint,
  sync jsonb,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.session_media enable row level security;

drop policy if exists "media: member read" on public.session_media;
create policy "media: member read" on public.session_media for select to authenticated
  using (public.is_member(session_id));
drop policy if exists "media: member insert" on public.session_media;
create policy "media: member insert" on public.session_media for insert to authenticated
  with check (created_by = auth.uid() and public.is_member(session_id));
drop policy if exists "media: member update" on public.session_media;
create policy "media: member update" on public.session_media for update to authenticated
  using (public.is_member(session_id)) with check (public.is_member(session_id));
drop policy if exists "media: own delete" on public.session_media;
create policy "media: own delete" on public.session_media for delete to authenticated
  using (created_by = auth.uid());

-- فضای ذخیره: فقط اعضای نشست (پوشهٔ اول مسیر = شناسهٔ نشست)
drop policy if exists "session media read" on storage.objects;
create policy "session media read" on storage.objects for select to authenticated
  using (bucket_id = 'session-media' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "session media insert" on storage.objects;
create policy "session media insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'session-media' and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "session media delete" on storage.objects;
create policy "session media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'session-media' and owner = auth.uid());

create table if not exists public.ocr_pages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  source text,
  page_no int,
  body text not null,
  norm text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists ocr_pages_session_idx on public.ocr_pages(session_id);
alter table public.ocr_pages enable row level security;

drop policy if exists "ocr: member read" on public.ocr_pages;
create policy "ocr: member read" on public.ocr_pages for select to authenticated
  using (public.is_member(session_id));
drop policy if exists "ocr: member insert" on public.ocr_pages;
create policy "ocr: member insert" on public.ocr_pages for insert to authenticated
  with check (created_by = auth.uid() and public.is_member(session_id));
drop policy if exists "ocr: own delete" on public.ocr_pages;
create policy "ocr: own delete" on public.ocr_pages for delete to authenticated
  using (created_by = auth.uid());

-- جستجوی عمیق: در همهٔ صفحه‌های OCR یک نشست؛ عبارت ورودی باید با normalize همان سمت کلاینت باشد
create or replace function public.search_ocr(p_session uuid, p_query text)
returns table(id bigint, source text, page_no int, body text)
language sql stable security definer set search_path = public as $$
  select o.id, o.source, o.page_no, o.body
  from public.ocr_pages o
  where o.session_id = p_session
    and public.is_member(p_session)
    and o.norm like '%' || p_query || '%'
  order by o.source, o.page_no
  limit 300;
$$;