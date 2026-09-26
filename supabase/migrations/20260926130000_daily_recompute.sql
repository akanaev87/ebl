-- Ежедневный пересчёт таблицы в 00:05 МСК: закрытая в воскресенье в 22:59 неделя получает очки за места,
-- даже если в понедельник никто ничего не засчитывал.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'ebl-daily-recompute',
  '5 21 * * *',   -- 21:05 UTC = 00:05 МСК
  $$ select net.http_post(
       url := 'https://yeerkfdgmhcmvdqzaoio.supabase.co/functions/v1/recompute',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb) $$
);
