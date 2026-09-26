#!/bin/sh
# Коммитит свежие данные и выкладывает prototype/ на GitHub Pages (ветка gh-pages).
set -e
cd "$(dirname "$0")/.."
git add -A
git diff --cached --quiet || git commit -q -m "Обновление данных $(date +%Y-%m-%d)"
git push -q origin main
git subtree push --prefix prototype origin gh-pages
echo "Готово: https://akanaev87.github.io/ebl/ (обновится через ~1 минуту)"
