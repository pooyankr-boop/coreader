-- patch-004: اتصال گروه‌های تلگرام به نشست (برای دستورهای s_*)
-- در Supabase → SQL Editor → New query اجرا شود (یک بار؛ قابل اجرای مجدد است).

create table if not exists public.bot_links (
  chat_id bigint primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  linked_by text,
  created_at timestamptz not null default now()
);

-- RLS فعال و بدون policy: فقط کلید service_role (سمت سرور/ربات) دسترسی دارد.
alter table public.bot_links enable row level security;
