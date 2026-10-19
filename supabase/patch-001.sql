-- patch-001: ورود مستقیم به نشست عمومی (بدون کد دعوت)
-- در Supabase → SQL Editor → New query اجرا شود (یک بار).

create or replace function public.join_public_session(sid uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.sessions where id = sid and visibility = 'public') then
    raise exception 'session is not public';
  end if;
  insert into public.session_members(session_id, user_id, role)
  values (sid, auth.uid(), 'member') on conflict do nothing;
  return sid;
end $$;
