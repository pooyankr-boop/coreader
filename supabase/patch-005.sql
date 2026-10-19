-- patch-005: ورود به نشست با تلگرام
-- در Supabase → SQL Editor → New query اجرا شود (یک بار؛ قابل اجرای مجدد است).

create table if not exists public.tg_login_codes (
  code text primary key,
  status text not null default 'pending' check (status in ('pending','confirmed','used')),
  tg_id bigint,
  tg_name text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tg_accounts (
  tg_id bigint primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- RLS فعال و بدون policy: فقط کلید service_role (سرور) دسترسی دارد.
alter table public.tg_login_codes enable row level security;
alter table public.tg_accounts enable row level security;
