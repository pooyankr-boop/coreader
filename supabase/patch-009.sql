-- patch-009: کاتالوگ در پایگاه داده + نقش مدیر
-- در Supabase → SQL Editor اجرا شود (قابل اجرای مجدد است).

alter table public.profiles add column if not exists role text not null default 'user';

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'book' check (kind in ('book','manuscript','object','painting','other')),
  title text not null,
  author text,
  language text,
  year text,
  source text,
  source_url text,
  iiif_manifest text,
  pdf_url text,
  cover text,
  visible boolean not null default false,
  submitted_by uuid references auth.users(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.catalog_items enable row level security;

drop policy if exists "catalog: public read visible" on public.catalog_items;
create policy "catalog: public read visible" on public.catalog_items for select
  using (visible = true);

drop policy if exists "catalog: read own" on public.catalog_items;
create policy "catalog: read own" on public.catalog_items for select to authenticated
  using (submitted_by = auth.uid());

drop policy if exists "catalog: propose" on public.catalog_items;
create policy "catalog: propose" on public.catalog_items for insert to authenticated
  with check (submitted_by = auth.uid() and visible = false);

drop policy if exists "catalog: admin all" on public.catalog_items;
create policy "catalog: admin all" on public.catalog_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- برای تعیین مدیر (یک بار، با شناسهٔ کاربر خودتان از Authentication → Users):
-- update public.profiles set role = 'admin' where id = 'YOUR-USER-UUID';