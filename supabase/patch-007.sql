-- patch-007: ناحیه (مستطیل) روی تصویر صفحه برای حاشیه‌ها
-- مختصات به‌صورت کسری از اندازهٔ تصویر (۰ تا ۱) ذخیره می‌شوند.
-- در Supabase → SQL Editor اجرا شود (قابل اجرای مجدد است).

alter table public.annotations add column if not exists x double precision;
alter table public.annotations add column if not exists y double precision;
alter table public.annotations add column if not exists w double precision;
alter table public.annotations add column if not exists h double precision;