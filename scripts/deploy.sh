#!/bin/sh
# Коммитит свежие данные и выкладывает prototype/ на GitHub Pages (ветка gh-pages).
set -e
cd "$(dirname "$0")/.."
# GitHub Pages кэширует файлы на 10 минут: версия в ссылках, чтобы страница и скрипт всегда были из одной выкладки
v=$(date +%Y%m%d%H%M%S)
sed -i '' -E "s/(style\.css|app\.js)\?v=[0-9]+/\1?v=$v/g" prototype/index.html
git add -A
git diff --cached --quiet || git commit -q -m "Обновление данных $(date +%Y-%m-%d)"
git push -q origin main
git subtree push --prefix prototype origin gh-pages
echo "Готово: https://akanaev87.github.io/ebl/ (обновится через ~1 минуту)"
