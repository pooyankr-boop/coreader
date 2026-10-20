-- patch-006: پخش زنده نشست با Jitsi (گذرواژه اختیاری)
-- در Supabase → SQL Editor → New query اجرا شود (یک بار؛ قابل اجرای مجدد است).

alter table public.sessions add column if not exists stream_password_hash text;

-- مالک نشست پخش را روشن/خاموش می‌کند و گذرواژهٔ اختیاری تعیین می‌کند
create or replace function public.set_live(p_session uuid, p_live boolean, p_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.sessions where id = p_session and owner_id = auth.uid()) then
    raise exception 'only the owner can change live state';
  end if;
  update public.sessions set
    is_live = p_live,
    stream_password_hash = case when p_live and coalesce(p_password, '') <> ''
      then encode(digest(p_password, 'sha256'), 'hex') else null end
  where id = p_session;
  return p_live;
end $$;

-- فهرست پخش‌های زنده (فقط اطلاعات عمومی؛ بدون اتاق و بدون هش گذرواژه)
create or replace function public.live_sessions()
returns table(id uuid, title text, book_slug text, visibility text, has_password boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.title, s.book_slug, s.visibility, (s.stream_password_hash is not null)
  from public.sessions s
  where s.is_live = true
  order by s.created_at desc;
$$;

-- دریافت نام اتاق Jitsi فقط وقتی مجاز باشد:
-- گذرواژه درست باشد، یا نشست عمومی باشد، یا کاربر عضو نشست خصوصی بدون گذرواژه باشد
create or replace function public.live_room(p_session uuid, p_password text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare s public.sessions%rowtype;
begin
  select * into s from public.sessions where id = p_session and is_live = true;
  if not found then raise exception 'این پخش فعال نیست'; end if;
  if s.stream_password_hash is not null then
    if encode(digest(coalesce(p_password, ''), 'sha256'), 'hex') <> s.stream_password_hash then
      raise exception 'گذرواژه نادرست است';
    end if;
  elsif s.visibility <> 'public' then
    if not exists (select 1 from public.session_members where session_id = p_session and user_id = auth.uid()) then
      raise exception 'این نشست خصوصی است؛ با کد دعوت وارد شوید';
    end if;
  end if;
  return 'coreader-session-' || s.id::text;
end $$;