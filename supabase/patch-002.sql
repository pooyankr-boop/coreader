-- patch-002 (قابل اجرای مجدد): مانیفست نشست و حاشیه‌های صفحه
-- در Supabase → SQL Editor → New query اجرا شود. اگر قبلاً نیمه‌کاره اجرا شده، باز هم بدون مشکل اجرا می‌شود.

alter table public.sessions add column if not exists manifest_url text;

create table if not exists public.annotations (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  page int not null check (page >= 1),
  body text not null check (char_length(body) between 1 and 2000),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists annotations_session_idx on public.annotations(session_id, page);

alter table public.annotations enable row level security;

drop policy if exists "annotations: member read" on public.annotations;
create policy "annotations: member read" on public.annotations for select to authenticated
  using (public.is_member(session_id));

drop policy if exists "annotations: member insert" on public.annotations;
create policy "annotations: member insert" on public.annotations for insert to authenticated
  with check (created_by = auth.uid() and public.is_member(session_id));

drop policy if exists "annotations: own delete" on public.annotations;
create policy "annotations: own delete" on public.annotations for delete to authenticated
  using (created_by = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'annotations'
  ) then
    alter publication supabase_realtime add table public.annotations;
  end if;
end $$;
