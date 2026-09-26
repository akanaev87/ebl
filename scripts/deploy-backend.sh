#!/bin/sh
# Выкладка серверной части в Supabase: схема, данные из таблицы, edge-функции, первый пересчёт.
# Перед первым запуском: supabase login; supabase secrets set TELEGRAM_BOT_TOKEN=... --project-ref <ref>
# Запуск: scripts/deploy-backend.sh <project-ref>
set -e
REF="${1:?Укажи project ref: scripts/deploy-backend.sh abcdefghijklmnop}"
cd "$(dirname "$0")/.."
python3 scripts/seed.py
supabase link --project-ref "$REF"
supabase db push --include-seed
supabase functions deploy tg-login --project-ref "$REF" --no-verify-jwt
supabase functions deploy recompute --project-ref "$REF" --no-verify-jwt
curl -s -X POST "https://$REF.supabase.co/functions/v1/recompute"; echo
