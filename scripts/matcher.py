"""Сопоставление названий бань из прошлых сезонов со справочником текущего сезона.

Названия пишут по-разному: «Ебург, Сандуны 1р» / «Екатеринбург, Сандуны 1р», «Дубай, Movenpick» / «Movenpick»
(регион в отдельной колонке), «Волковские-Тарусские» / «Тарусско-Волковские». Поэтому сравниваем наборы слов
с учётом редкости слова, обрезанных окончаний и региона бани. Разряды и номера («1р», «баня 5») должны совпадать.
"""
import re, difflib
from collections import Counter

ALIAS = {"ебург": "екатеринбург", "спб": "санкт петербург", "питер": "санкт петербург", "мск": "москва",
         "нино": "нижний новгород", "кениг": "калининград", "амстер": "амстердам"}
STOP = {"бани", "баня", "бань", "сауна", "частная", "частный", "лен", "обл", "область", "и", "на", "в", "the"}
norm = lambda s: re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", str(s or "").lower().replace("ё", "е"))).strip()
stem = lambda w: w[:5] if len(w) > 5 else w


def words(s):
    out = []
    for w in norm(s).split():
        out += ALIAS.get(w, w).split()
    return [w for w in out if w not in STOP]


def tokens(s): return frozenset(stem(w) for w in words(s) if not re.search(r"\d", w))
def digits(s): return frozenset(w for w in words(s) if re.search(r"\d", w))


class Matcher:
    def __init__(self, catalog):
        """catalog: список (название, регион, страна)."""
        self.exact = {norm(n): n for n, _, _ in catalog}
        self.name_tok = {n: tokens(n) for n, _, _ in catalog}
        self.ctx_tok = {n: tokens(n) | tokens(r) | tokens(c) for n, r, c in catalog}
        self.dig = {n: digits(n) for n, _, _ in catalog}
        self.df = Counter(w for t in self.name_tok.values() for w in t)

    def _w(self, s): return sum(1 / self.df[x] if self.df.get(x) else 1 for x in s)

    def _digits_ok(self, a, n):
        b = self.dig[n]
        return not (a and b) or a == b

    def match(self, name):
        k = norm(name)
        if k in self.exact: return self.exact[k]
        a, ad = tokens(name), digits(name)
        for m in difflib.get_close_matches(k, self.exact.keys(), n=3, cutoff=0.88):
            if self._digits_ok(ad, self.exact[m]): return self.exact[m]
        if not a: return None
        best, best_sc = None, 0
        for n, b in self.name_tok.items():
            if not b or not self._digits_ok(ad, n): continue
            inter = a & b
            if not inter: continue
            sym = self._w(inter) / self._w(a | b)
            # регион/страна бани тоже считаются: «Дубай, Movenpick» ↔ Movenpick (ОАЭ, Дубай)
            cover = self._w(a & self.ctx_tok[n]) / self._w(a)
            rare = any(self.df[x] <= 3 for x in inter)
            sc = max(sym, cover * 0.9 if rare else 0)
            if sc > best_sc: best, best_sc = n, sc
        return best if best_sc >= 0.6 else None
