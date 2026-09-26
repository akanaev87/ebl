"""Геокодинг бань через Nominatim (OSM). Кэширует всё в geocache.json, результат — prototype/data/coords.json.
precision: exact — нашли саму баню; city — город из названия; region — центр региона; country — центр страны."""
import json, math, re, time, pathlib, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
DATA = ROOT.parent / "prototype" / "data"
CACHE_F = ROOT / "geocache.json"
cache = json.loads(CACHE_F.read_text()) if CACHE_F.exists() else {}
UA = "EBL-prototype/0.1 (bath league map; contact a.kanaev)"

def q(query):
    if query in cache: return cache[query]
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": query, "format": "jsonv2", "limit": 1, "accept-language": "ru"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=20) as r:
                res = json.load(r)
            break
        except Exception as e:
            print("err", query, e); time.sleep(5); res = None
    time.sleep(1.1)
    hit = [float(res[0]["lat"]), float(res[0]["lon"]), res[0].get("category", ""), res[0].get("type", "")] if res else None
    cache[query] = hit
    CACHE_F.write_text(json.dumps(cache, ensure_ascii=False))
    return hit

def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))

def region_name(r):
    r = re.sub(r"\bобл\.?$", "область", r.strip())
    r = re.sub(r"\bресп\.?\b", "республика", r)
    return r

JUNK = re.compile(r"\b(вр|нр|\d+\s?р|частная|частный|хуитнес|баня\s?\d+|\d+)\b", re.I)
baths = json.loads((DATA / "baths.json").read_text())
# сначала бани, где были в 2026, потом с историей, потом остальное
baths.sort(key=lambda b: (not b["v26"], not b["hist"]))
prev = json.loads((DATA / "coords.json").read_text()) if (DATA / "coords.json").exists() else {}
out = {int(k): v for k, v in prev.items()}
for i, b in enumerate(baths):
    country = b["country"] or ("Россия" if not b["region"] else "")
    region = region_name(b["region"]) if b["region"] else ""
    parts = [p.strip() for p in b["name"].split(",") if p.strip()]
    base = None
    # грубая точка: регион/страна (для Москвы и СПб регион = город)
    for query, prec in [(", ".join(x for x in (region, country) if x), "region"), (country, "country")]:
        if query and (hit := q(query)): base = (hit, prec); break
    # город из первой части названия, если есть запятая
    if len(parts) > 1 and not JUNK.fullmatch(parts[0]):
        hit = q(", ".join(x for x in (parts[0], region, country) if x))
        if hit and (not base or km(hit, base[0]) < 800): base = (hit, "city")
    # сама баня
    clean = JUNK.sub(" ", b["name"]).replace(",", " ")
    clean = re.sub(r"\s+", " ", clean).strip()
    exact = None
    if len(clean) > 3 and not b["name"].lower().startswith("частн"):
        ctx = parts[0] if len(parts) > 1 else (region or country)
        for query in [f"{clean}, {ctx}"]:
            hit = q(query)
            if hit and base and km(hit, base[0]) < (60 if base[1] == "city" else 250) and hit[2] not in ("boundary", "place"):
                exact = hit; break
    pick = (exact, "exact") if exact else base
    if pick: out[b["id"]] = [round(pick[0][0], 5), round(pick[0][1], 5), pick[1]]
    if i % 25 == 0:
        print(i, b["name"], "->", pick[1] if pick else None, flush=True)
        (DATA / "coords.json").write_text(json.dumps(out))
(DATA / "coords.json").write_text(json.dumps(out))
from collections import Counter
print("done", Counter(v[2] for v in out.values()), "missing", len(baths) - len(out))
