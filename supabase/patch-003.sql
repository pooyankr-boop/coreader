-- patch-003: قفل «اثر روز» (یک بار در روز)
-- در Supabase → SQL Editor → New query اجرا شود (یک بار؛ قابل اجرای مجدد است).

create table if not exists public.daily_posts (
  day date primary key,
  claimed_at timestamptz not null default now()
);

-- RLS فعال و بدون policy: فقط کلید service_role (سمت سرور) به این جدول دسترسی دارد.
alter table public.daily_posts enable row level security;
