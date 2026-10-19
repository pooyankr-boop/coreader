-- ==========================================================
-- coreader · بخش «نشست» — فاز ۱ (Supabase / Postgres)
-- این فایل را در Supabase → SQL Editor اجرا کنید.
-- ==========================================================

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'کاربر',
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  book_slug text,
  owner_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('public','private')),
  invite_code text unique default encode(gen_random_bytes(6),'hex'),
  is_live boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.session_members (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','editor','member')),
  joined_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  tags text[] not null default '{}',
  status text not null default 'open' check (status in ('open','doing','done')),
  assignee uuid references auth.users(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists messages_session_idx on public.messages(session_id, created_at);
create index if not exists tasks_session_idx on public.tasks(session_id, status);

create or replace function public.is_member(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.session_members where session_id = sid and user_id = auth.uid());
$$;

create or replace function public.join_session(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.sessions%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into s from public.sessions where invite_code = code;
  if not found then raise exception 'invalid invite'; end if;
  insert into public.session_members(session_id, user_id, role)
  values (s.id, auth.uid(), 'member') on conflict do nothing;
  return s.id;
end $$;

create or replace function public.create_session(p_title text, p_book text, p_visibility text)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.sessions(title, book_slug, owner_id, visibility)
  values (p_title, p_book, auth.uid(), coalesce(p_visibility,'private'))
  returning id into sid;
  insert into public.session_members(session_id, user_id, role) values (sid, auth.uid(), 'owner');
  return sid;
end $$;

alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.session_members enable row level security;
alter table public.messages enable row level security;
alter table public.tasks enable row level security;

create policy "profiles: read all auth" on public.profiles for select to authenticated using (true);
create policy "profiles: own write" on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "sessions: read public or member" on public.sessions for select to authenticated
  using (visibility = 'public' or public.is_member(id));
create policy "sessions: owner update" on public.sessions for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "sessions: owner delete" on public.sessions for delete to authenticated
  using (owner_id = auth.uid());

create policy "members: read own session" on public.session_members for select to authenticated
  using (public.is_member(session_id));
create policy "members: leave" on public.session_members for delete to authenticated
  using (user_id = auth.uid());

create policy "messages: member read" on public.messages for select to authenticated
  using (public.is_member(session_id));
create policy "messages: member write" on public.messages for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(session_id));

create policy "tasks: member read" on public.tasks for select to authenticated
  using (public.is_member(session_id));
create policy "tasks: member write" on public.tasks for insert to authenticated
  with check (created_by = auth.uid() and public.is_member(session_id));
create policy "tasks: member update" on public.tasks for update to authenticated
  using (public.is_member(session_id)) with check (public.is_member(session_id));

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.tasks;
