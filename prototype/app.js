/* ЕБЛ — прототип портала. Данные бань и зачёта — выгрузка из таблицы секретаря;
   походы, отзывы и новые бани в прототипе живут в localStorage браузера. */
(async function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString("ru-RU");
  const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
  const TYPE_LABEL = { public: "Общественная", spa: "Спа / фитнес", private: "Частная", unknown: "Тип не указан" };
  const PREC_LABEL = { city: "по городу из названия", region: "по центру региона", country: "по центру страны" };

  // ---------- хранилище прототипа ----------
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem("ebl:" + k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("ebl:" + k, JSON.stringify(v)); } catch {} },
  };
  let visits = store.get("visits", []);
  let reviews = store.get("reviews", {});
  let newBaths = store.get("newBaths", []);

  // ---------- данные ----------
  const load = (f) => fetch("data/" + f).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [baseBaths, standings, coords] = await Promise.all([load("baths.json"), load("standings.json"), load("coords.json")]);
  const players = standings.map((s) => s.name);
  const baths = [...baseBaths, ...newBaths];
  const byId = new Map(baths.map((b) => [b.id, b]));
  baths.forEach(hydrate);

  function hydrate(b) {
    b.t = b.type || "unknown";
    b.n26 = Object.values(b.v26 || {}).reduce((a, x) => a + x, 0);
    b.nHist = Object.values(b.hist || {}).reduce((a, x) => a + x, 0);
    b.search = [b.name, b.region, b.country].join(" ").toLowerCase();
    const c = b.lat != null ? [b.lat, b.lng, "exact"] : coords?.[b.id];
    if (c) {
      const [lat, lng, prec] = c;
      // примерные точки разносим детерминированно, чтобы бани одного города не слипались в одну
      const spread = { exact: 0, city: 0.02, region: 0.25, country: 1.2 }[prec] ?? 0;
      const a = (b.id * 2.399963) % (2 * Math.PI), r = spread * Math.sqrt(((b.id * 7919) % 97) / 97);
      b.ll = [lat + r * Math.sin(a), lng + r * Math.cos(a) * 1.6];
      b.prec = prec;
    }
  }

  // ---------- недели чемпионата (МСК) ----------
  // W1 = 1–4 января, дальше пн–вс; вс после 22:59 МСК уходит в следующую неделю
  function weekOf(localStr) {
    const d = new Date(localStr.slice(0, 10) + "T00:00:00Z");
    const [hh, mm] = localStr.slice(11, 16).split(":").map(Number);
    if (d.getUTCDay() === 0 && (hh > 22 || (hh === 22 && mm > 59))) d.setUTCDate(d.getUTCDate() + 1);
    const start2 = Date.UTC(2026, 0, 5);
    if (d < start2) return 1;
    return Math.floor((d - start2) / 864e5 / 7) + 2;
  }
  const mskNow = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 16);
  const curWeek = weekOf(mskNow());
  $("#curWeek").textContent = "W" + curWeek;

  // ---------- вкладки ----------
  function show(view) {
    $$(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === view)));
    $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
    if (view === "map") setTimeout(() => map.invalidateSize(), 0);
    if (view === "feed") renderFeed();
    history.replaceState(null, "", "#" + view);
  }
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));

  // ---------- карта ----------
  const dark = () => document.documentElement.dataset.theme === "dark" ||
    (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  const map = L.map("map", { zoomControl: true, worldCopyJump: true }).setView([55.75, 37.62], 5);
  const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileOpts = { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' };
  L.tileLayer(TILE_URL, tileOpts).addTo(map);
  const syncTheme = () => $$(".leaflet-tile-pane").forEach((p) => p.classList.toggle("tiles-dark", dark()));
  syncTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);
  const cluster = L.markerClusterGroup({ disableClusteringAtZoom: 13, maxClusterRadius: 45, showCoverageOnHover: false });
  map.addLayer(cluster);
  const COLORS = () => { const cs = getComputedStyle(document.documentElement); return Object.fromEntries(["public", "spa", "private", "unknown"].map((t) => [t, cs.getPropertyValue("--" + t).trim()])); };

  function markerFor(b) {
    const size = b.n26 ? Math.min(12 + Math.sqrt(b.n26) * 3, 26) : 10;
    const icon = L.divIcon({
      className: "", iconSize: [size, size],
      html: `<div class="pin ${b.prec !== "exact" ? "approx" : ""} ${b.n26 >= 10 ? "hot" : ""}" style="width:${size}px;height:${size}px;background:${COLORS()[b.t]}"></div>`,
    });
    return L.marker(b.ll, { icon, title: b.name }).on("click", () => openBath(b.id));
  }

  // ---------- фильтры ----------
  const countries = [...new Set(baths.map((b) => b.country).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
  $("#fCountry").innerHTML += countries.map((c) => `<option>${esc(c)}</option>`).join("");
  $("#countryList").innerHTML = countries.map((c) => `<option value="${esc(c)}">`).join("");
  $("#regionList").innerHTML = [...new Set(baths.map((b) => b.region).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join("");
  $("#fPlayer").innerHTML += players.map((p) => `<option>${esc(p)}</option>`).join("");
  $$("#typeChips .chip").forEach((c) => c.addEventListener("click", () => { c.setAttribute("aria-pressed", String(c.getAttribute("aria-pressed") !== "true")); render(); }));
  ["#q", "#fCountry", "#fSeason", "#fPlayer"].forEach((s) => $(s).addEventListener("input", () => render()));

  let current = [];
  function render(fit) {
    const q = $("#q").value.trim().toLowerCase();
    const types = new Set($$("#typeChips .chip[aria-pressed=true]").map((c) => c.dataset.type));
    const country = $("#fCountry").value, season = $("#fSeason").value, player = $("#fPlayer").value;
    current = baths.filter((b) =>
      types.has(b.t) && (!country || b.country === country) && (!q || b.search.includes(q)) &&
      (season === "all" || (season === "2026" ? b.n26 > 0 : b.n26 === 0)) && (!player || b.v26?.[player]));
    current.sort((a, b) => b.n26 - a.n26 || a.name.localeCompare(b.name, "ru"));
    cluster.clearLayers();
    const onMap = current.filter((b) => b.ll);
    cluster.addLayers(onMap.map(markerFor));
    const noPin = current.length - onMap.length;
    $("#count").textContent = `${current.length} ${plural(current.length, "баня", "бани", "бань")}` + (noPin ? ` · ${noPin} пока без точки на карте` : "");
    const LIMIT = 300;
    $("#list").innerHTML = current.slice(0, LIMIT).map((b) => `
      <div class="item" data-id="${b.id}">
        <i class="dot ${b.t}"></i>
        <div><div class="n">${esc(b.name)}</div><div class="m">${esc([b.region, b.country].filter(Boolean).join(", ") || "регион не указан")}</div></div>
        <div class="v">${b.n26 ? b.n26 + "×" : ""}</div>
      </div>`).join("") + (current.length > LIMIT ? `<div class="item"><span></span><div class="m">…и ещё ${current.length - LIMIT}. Уточни поиск.</div></div>` : "");
    if (fit && onMap.length) map.fitBounds(L.latLngBounds(onMap.map((b) => b.ll)).pad(0.1), { maxZoom: 12 });
  }
  $("#list").addEventListener("click", (e) => { const it = e.target.closest(".item[data-id]"); if (it) openBath(+it.dataset.id, true); });
  $("#fCountry").addEventListener("change", () => render(true));
  $("#fPlayer").addEventListener("change", () => render(true));

  // ---------- карточка бани ----------
  let openId = null;
  function openBath(id, fly) {
    const b = byId.get(id); if (!b) return;
    openId = id;
    $$(".item.active").forEach((x) => x.classList.remove("active"));
    $(`.item[data-id="${id}"]`)?.classList.add("active");
    if (fly && b.ll) map.flyTo(b.ll, Math.max(map.getZoom(), b.prec === "exact" ? 14 : 10), { duration: 0.6 });
    const who = Object.entries(b.v26 || {}).sort((x, y) => y[1] - x[1]);
    const rv = reviews[id] || [];
    const avg = rv.length ? rv.reduce((a, r) => a + r.rate, 0) / rv.length : null;
    const pending = visits.filter((v) => v.bathId === id && v.status === "pending").length;
    const d = $("#drawer");
    d.innerHTML = `
      <button class="close" aria-label="Закрыть">✕</button>
      <header>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <span class="tag ${b.t === "public" ? "public" : ""}"><i class="dot ${b.t}"></i>${TYPE_LABEL[b.t]}${b.t === "public" ? " · +1 очко" : ""}</span>
          ${b.isNew ? '<span class="tag heat">новая, на модерации</span>' : ""}
          ${!b.n26 && !b.nHist && !b.isNew ? '<span class="tag heat">кандидат в ультрауникальные</span>' : ""}
        </div>
        <h2>${esc(b.name)}</h2>
        <div class="where">${esc([b.region, b.country].filter(Boolean).join(", ") || "Регион не указан")}</div>
      </header>
      <div class="body">
        <div class="stats3">
          <div><b>${b.n26}</b><span>походов 2026</span></div>
          <div><b>${who.length}</b><span>участников</span></div>
          <div><b>${avg ? fmt(avg) : "—"}</b><span>оценка</span></div>
        </div>
        ${b.prec && b.prec !== "exact" ? `<div class="approxnote">Точка примерная — ${PREC_LABEL[b.prec]}. В боевой версии любой участник сможет поставить точный пин.</div>` : ""}
        ${!b.ll ? `<div class="approxnote">Координат пока нет.</div>` : ""}
        <div>
          <h3>Кто парился в 2026</h3>
          ${who.length ? `<div class="who">${who.map(([p, n]) => `<button class="p" data-player="${esc(p)}">${esc(p)}<b>${n > 1 ? n : ""}</b></button>`).join("")}</div>` : `<div class="note">В этом сезоне ещё никто. Первый получит +1 за уникальную баню.</div>`}
          ${b.nHist ? `<div class="note" style="margin-top:6px">В прошлых сезонах: ${Object.entries(b.hist).map(([y, n]) => `${y} — ${n}`).join(", ")}</div>` : ""}
          ${pending ? `<div class="note" style="margin-top:6px">+${pending} на модерации</div>` : ""}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn primary small" id="dVisit">Я тут был</button>
          <a class="btn small" target="_blank" rel="noopener" href="https://yandex.ru/maps/?text=${encodeURIComponent(b.name + " " + (b.region || b.country || ""))}">Яндекс Карты ↗</a>
        </div>
        <div>
          <h3>Отзывы ${rv.length ? "· " + rv.length : ""}</h3>
          <div style="display:grid;gap:10px">
            ${rv.length ? rv.map((r) => `<div class="review"><div class="h"><span><b>${esc(r.author)}</b>${r.sample ? '<span class="sample">пример</span>' : ""}</span><span class="venik" title="${r.rate} из 5">${"●".repeat(r.rate)}${"○".repeat(5 - r.rate)}</span></div><p>${esc(r.text)}</p></div>`).join("") : `<div class="note">Отзывов пока нет.</div>`}
          </div>
        </div>
        <form id="rvForm" style="display:grid;gap:8px">
          <h3 style="margin:0">Оставить отзыв</h3>
          <div class="rate" id="rvRate">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-r="${n}" aria-pressed="${n === 4}">${n}</button>`).join("")}</div>
          <select id="rvAuthor" aria-label="Автор" style="padding:7px 8px;border:1px solid var(--line);border-radius:8px;background:var(--ground)">${players.map((p) => `<option>${esc(p)}</option>`).join("")}</select>
          <textarea id="rvText" placeholder="Пар, веники, купель, мужские часы, цены…" required></textarea>
          <button class="btn small" type="submit" style="justify-self:start">Опубликовать</button>
        </form>
      </div>`;
    d.hidden = false;
    $(".close", d).onclick = () => { d.hidden = true; openId = null; };
    $("#dVisit", d).onclick = () => openVisit({ bathId: id });
    $$(".p", d).forEach((x) => (x.onclick = () => openPlayer(x.dataset.player)));
    $$("#rvRate button", d).forEach((x) => (x.onclick = () => $$("#rvRate button", d).forEach((y) => y.setAttribute("aria-pressed", String(y === x)))));
    $("#rvForm", d).onsubmit = (e) => {
      e.preventDefault();
      const text = $("#rvText", d).value.trim(); if (!text) return;
      (reviews[id] ||= []).unshift({ author: $("#rvAuthor", d).value, rate: +$("#rvRate [aria-pressed=true]", d).dataset.r, text, at: Date.now() });
      store.set("reviews", reviews); toast("Отзыв опубликован"); openBath(id);
    };
  }

  // ---------- таблица ----------
  let sortKey = "total", sortDir = -1;
  const COLS = [["baths", "К-во"], ["u", "У"], ["uu", "УУ"], ["long", "Дл"], ["k", "К"], ["pub", "Общ"], ["reg", "Рег"]];
  function spark(s) {
    const weeks = Array.from({ length: 12 }, (_, i) => curWeek - 12 + i).filter((w) => w >= 1);
    const vals = weeks.map((w) => s.weekPts[w] ?? 0);
    const W = 96, H = 22, step = W / (vals.length - 1 || 1);
    const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(H - 2 - (v / 15) * (H - 4)).toFixed(1)}`);
    const last = pts[pts.length - 1].split(",");
    return `<svg class="spark" width="${W}" height="${H}" viewBox="-2 0 ${W + 4} ${H}" aria-label="очки за последние недели"><polygon points="0,${H} ${pts.join(" ")} ${W},${H}" fill="var(--accent-soft)"/><polyline points="${pts.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="1.5"/><circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="var(--heat)"/></svg>`;
  }
  const ranked = [...standings].sort((a, b) => b.total - a.total || b.baths - a.baths).map((s, i) => ({ ...s, place: i + 1 }));
  const playedWeeks = Math.max(...standings.flatMap((s) => Object.keys(s.weekPts).map(Number)));
  const totalBaths = standings.reduce((a, s) => a + s.baths, 0);
  $("#tableLead").innerHTML = `Выгрузка из таблицы секретаря Комиссии: разыграно <b class="num">${playedWeeks}</b> ${plural(playedWeeks, "неделя", "недели", "недель")}, участники сходили в баню <b class="num">${totalBaths}</b> ${plural(totalBaths, "раз", "раза", "раз")}. В боевой версии таблица пересчитывается сама после каждого подтверждённого похода.`;
  $("#podium").innerHTML = ranked.slice(0, 3).map((s) => `
    <div class="pl" data-player="${esc(s.name)}"><span class="place">${s.place} место</span><span class="name">${esc(s.name)}</span>
    <span class="pts">${fmt(s.total)}</span><span class="lbl">${s.baths} ${plural(s.baths, "баня", "бани", "бань")} · ${s.u} уникальных · ${s.reg} за регионы</span></div>`).join("");
  function renderTable() {
    const rows = [...ranked].sort((a, b) => sortDir * ((a[sortKey] ?? 0) - (b[sortKey] ?? 0)) || a.place - b.place);
    const arrow = (k) => (k === sortKey ? (sortDir < 0 ? " ↓" : " ↑") : "");
    $("#standings").innerHTML = `
      <thead><tr><th data-k="place">#${arrow("place")}</th><th class="l">Участник</th><th data-k="total">Очки${arrow("total")}</th>
      ${COLS.map(([k, l]) => `<th data-k="${k}">${l}${arrow(k)}</th>`).join("")}<th class="l">12 недель</th></tr></thead>
      <tbody>${rows.map((s) => `<tr class="${sortKey === "total" && sortDir < 0 && s.place === 16 ? "cutline" : ""}">
        <td class="pos">${s.place}</td><td class="l name" data-player="${esc(s.name)}">${esc(s.name)}</td><td class="pts">${fmt(s.total)}</td>
        ${COLS.map(([k]) => `<td>${s[k] ?? 0}</td>`).join("")}<td class="l">${spark(s)}</td></tr>`).join("")}</tbody>`;
  }
  $("#standings").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-k]");
    if (th) { sortDir = th.dataset.k === sortKey ? -sortDir : th.dataset.k === "place" ? 1 : -1; sortKey = th.dataset.k; renderTable(); return; }
    const n = e.target.closest("[data-player]"); if (n) openPlayer(n.dataset.player);
  });
  $("#podium").addEventListener("click", (e) => { const n = e.target.closest("[data-player]"); if (n) openPlayer(n.dataset.player); });
  renderTable();

  // ---------- профиль участника ----------
  function openPlayer(name) {
    const s = ranked.find((x) => x.name === name); if (!s) return;
    const weeks = Array.from({ length: curWeek }, (_, i) => i + 1);
    const maxB = Math.max(1, ...weeks.map((w) => s.weekBaths[w] ?? 0));
    const mine = baths.filter((b) => b.v26?.[name]).sort((a, b) => b.v26[name] - a.v26[name]);
    const regions = new Set(mine.map((b) => b.region && b.country + "/" + b.region).filter(Boolean));
    const ctry = new Set(mine.map((b) => b.country).filter(Boolean));
    const types = mine.reduce((a, b) => ((a[b.t] = (a[b.t] || 0) + b.v26[name]), a), {});
    $("#playerBody").innerHTML = `
      <header><h2>${esc(name)}</h2><div class="sub">${s.place} место · <b class="num">${fmt(s.total)}</b> ${plural(Math.round(s.total), "очко", "очка", "очков")} · ${s.baths} ${plural(s.baths, "баня", "бани", "бань")} за сезон</div></header>
      <div class="content">
        <div class="stats3" style="grid-template-columns:repeat(4,1fr)">
          <div><b>${s.u}</b><span>уникальных</span></div><div><b>${s.uu}</b><span>ультра</span></div>
          <div><b>${s.long}</b><span>долгих</span></div><div><b>${s.k}</b><span>за компанию</span></div>
        </div>
        <div>
          <h3>Бань по неделям</h3>
          <div class="bars">${weeks.map((w) => { const v = s.weekBaths[w] ?? 0; return `<div class="${v ? "" : "zero"}" style="height:${(v / maxB) * 100}%" title="W${w}: ${v} ${plural(v, "баня", "бани", "бань")}, ${fmt(s.weekPts[w] ?? 0)} очк. за место"></div>`; }).join("")}</div>
          <div class="axis"><span>W1</span><span>W${Math.round(curWeek / 2)}</span><span>W${curWeek}</span></div>
        </div>
        <div class="cols2">
          <div><h3>Бани сезона · ${mine.length}</h3><div class="blist">${mine.map((b) => `<div data-bath="${b.id}"><span>${esc(b.name)}</span><b>${b.v26[name] > 1 ? b.v26[name] + "×" : ""}</b></div>`).join("") || '<span class="note">Нет данных</span>'}</div></div>
          <div>
            <h3>География</h3>
            <p style="margin:0 0 8px"><b class="num">${ctry.size}</b> ${plural(ctry.size, "страна", "страны", "стран")}, <b class="num">${regions.size}</b> ${plural(regions.size, "регион", "региона", "регионов")}</p>
            <p class="note" style="margin:0 0 14px">${[...ctry].map(esc).join(", ")}</p>
            <h3>Типы бань</h3>
            ${Object.entries(types).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<div style="display:flex;align-items:center;gap:8px;font-size:14px"><i class="dot ${t}"></i>${TYPE_LABEL[t]}<span class="num" style="margin-left:auto">${n}</span></div>`).join("")}
            <button class="btn small" style="margin-top:14px" id="pOnMap">Показать на карте</button>
          </div>
        </div>
      </div>`;
    $("#playerModal").hidden = false;
    $$("#playerBody [data-bath]").forEach((x) => (x.onclick = () => { $("#playerModal").hidden = true; show("map"); openBath(+x.dataset.bath, true); }));
    $("#pOnMap").onclick = () => { $("#playerModal").hidden = true; show("map"); $("#fPlayer").value = name; $("#fSeason").value = "2026"; render(true); };
  }

  // ---------- форма похода ----------
  const vf = $("#visitForm");
  $("#vPlayer").innerHTML = players.map((p) => `<option>${esc(p)}</option>`).join("");
  let picked = null, newPin = null, pickMap = null, pickMarker = null;

  function openVisit({ bathId } = {}) {
    vf.reset();
    $("#vPlayer").value = store.get("me", players[0]);
    $("#vDate").value = mskNow();
    picked = bathId ? byId.get(bathId) : null; newPin = null;
    renderComp(); renderPicked(); calc();
    $("#visitModal").hidden = false;
  }
  $("#addVisitBtn").onclick = () => openVisit();

  function renderComp() {
    const me = $("#vPlayer").value;
    const was = new Set($$("#vComp .chip[aria-pressed=true]").map((c) => c.dataset.p));
    $("#vComp").innerHTML = players.filter((p) => p !== me).map((p) => `<button type="button" class="chip" data-p="${esc(p)}" aria-pressed="${was.has(p)}">${esc(p)}</button>`).join("");
  }
  $("#vComp").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; c.setAttribute("aria-pressed", String(c.getAttribute("aria-pressed") !== "true")); calc(); });
  $("#vPlayer").addEventListener("change", () => { store.set("me", $("#vPlayer").value); renderComp(); calc(); });
  ["#vDate", "#vDur", "#vProof", "#nbType", "#nbCountry", "#nbRegion", "#nbName"].forEach((s) => $(s).addEventListener("input", calc));

  function renderPicked() {
    const box = $("#vBathPicked");
    const isNew = picked === "new";
    $("#newBathBox").hidden = !isNew;
    $("#vBathQ").hidden = !!picked && !isNew;
    if (picked && !isNew) {
      box.hidden = false;
      box.innerHTML = `<div class="picked"><span><i class="dot ${picked.t}"></i> <b>${esc(picked.name)}</b> <span class="note">${esc([picked.region, picked.country].filter(Boolean).join(", "))}</span></span><button type="button" class="btn small">Другая</button></div>`;
      $("button", box).onclick = () => { picked = null; renderPicked(); calc(); $("#vBathQ").focus(); };
    } else box.hidden = true;
    if (isNew) setTimeout(() => {
      if (!pickMap) {
        pickMap = L.map("pickmap").setView(map.getCenter(), 5);
        L.tileLayer(TILE_URL, tileOpts).addTo(pickMap); syncTheme();
        pickMap.on("click", (e) => { newPin = [e.latlng.lat, e.latlng.lng]; (pickMarker ||= L.marker(newPin).addTo(pickMap)).setLatLng(newPin); });
      }
      pickMap.invalidateSize();
    }, 0);
  }
  $("#vBathQ").addEventListener("input", () => {
    const q = $("#vBathQ").value.trim().toLowerCase(), sg = $("#vSuggest");
    if (q.length < 2) { sg.hidden = true; return; }
    const hits = baths.filter((b) => b.search.includes(q)).sort((a, b) => b.n26 - a.n26).slice(0, 8);
    sg.innerHTML = hits.map((b) => `<button type="button" data-id="${b.id}"><span><i class="dot ${b.t}"></i> ${esc(b.name)}</span><small>${esc(b.region || b.country || "")}</small></button>`).join("") +
      `<button type="button" data-new="1"><span><b>+ Новая баня</b> «${esc($("#vBathQ").value.trim())}»</span><small>нет в справочнике</small></button>`;
    sg.hidden = false;
  });
  $("#vSuggest").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.new) { picked = "new"; $("#nbName").value = $("#vBathQ").value.trim(); }
    else picked = byId.get(+b.dataset.id);
    $("#vSuggest").hidden = true; renderPicked(); calc();
  });

  // что уже есть у участника в сезоне: бани, регионы, страны (таблица + свои подтверждённые/ожидающие походы)
  function seasonOf(player) {
    const bathIds = new Set(), regions = new Set(), countries = new Set();
    const add = (b) => { if (!b) return; bathIds.add(b.id); if (b.region) regions.add(b.country + "/" + b.region); if (b.country) countries.add(b.country); };
    baths.forEach((b) => b.v26?.[player] && add(b));
    visits.filter((v) => v.status !== "rejected" && (v.player === player || v.companions.includes(player))).forEach((v) => add(byId.get(v.bathId)));
    return { bathIds, regions, countries };
  }

  function score() {
    const player = $("#vPlayer").value, dur = +$("#vDur").value || 0, proof = $("#vProof").checked;
    const comp = $$("#vComp .chip[aria-pressed=true]").map((c) => c.dataset.p);
    const date = $("#vDate").value;
    const isNew = picked === "new";
    const b = isNew ? { t: $("#nbType").value, country: $("#nbCountry").value.trim(), region: $("#nbRegion").value.trim(), n26: 0, nHist: 0 } : picked;
    const lines = [];
    if (!b) return { lines: [["Выбери баню", null, "muted"]], total: 0 };
    if (dur < 60) return { lines: [["Меньше часа — поход не засчитывается (п. 5)", null, "muted"]], total: 0 };
    const sameDay = !isNew && visits.some((v) => v.status !== "rejected" && v.bathId === b.id && v.date.slice(0, 10) === date.slice(0, 10) && (v.player === player || v.companions.includes(player)));
    if (sameDay) return { lines: [["В эту баню сегодня уже засчитан поход — второй раз за сутки не считается", null, "muted"]], total: 0 };
    const s = seasonOf(player);
    lines.push(["Поход в баню", 1]);
    if (b.t === "public") lines.push(["Общественная баня", 1]);
    else if (b.t === "unknown") lines.push(["Тип бани не указан — общественная или нет, решит Комиссия", 0, "muted"]);
    if (isNew || !s.bathIds.has(b.id)) lines.push(["Уникальная — первая в этом году для тебя", 1]);
    if (isNew) lines.push(["Ультрауникальная — новой бани нет в справочнике 2023–2026", 1]);
    else if (!b.n26 && !b.nHist) lines.push(["Возможно, ультрауникальная — Комиссия проверит историю", 0, "muted"]);
    if (b.region && b.country && !s.regions.has(b.country + "/" + b.region)) lines.push([`Новый регион: ${b.region}`, 1]);
    if (b.country && !s.countries.has(b.country)) lines.push([`Новая страна: ${b.country}`, 1]);
    if (dur > 150 && proof) lines.push(["Долгий поход, больше 150 минут", 1]);
    else if (dur > 150) lines.push(["Больше 150 минут, но без фото с отметками засчитается как час", 0, "muted"]);
    const n = comp.length + 1;
    if (n >= 9) lines.push([`Компания ККК: ${n} участников`, 3]);
    else if (n >= 6) lines.push([`Компания КК: ${n} участников`, 2]);
    else if (n >= 3) lines.push([`Компания К: ${n} участника`, 1]);
    const total = lines.reduce((a, l) => a + (l[1] || 0), 0);
    return { lines, total, week: weekOf(date), comp, dur, proof, player, date };
  }
  function calc() {
    const date = $("#vDate").value;
    if (date) {
      const w = weekOf(date);
      $("#vWeekHint").textContent = `Время по МСК. Идёт в неделю W${w}` + (w > curWeek ? " — это будущее" : "");
    }
    const r = score();
    $("#calc").innerHTML = r.lines.map(([t, p, cls]) => `<div class="line ${cls || ""}"><span>${esc(t)}</span><span>${p == null ? "" : p ? "+" + p : "0"}</span></div>`).join("") +
      (r.total ? `<div class="line muted"><span>Плюс очки за место по итогам недели W${r.week} (15 · 12 · 10 · 8 · 6 · 4 · 2 · 1) — посчитаются в воскресенье в 23:00 МСК</span><span></span></div>
      <div class="line total"><span>Итого за поход</span><span>+${r.total}</span></div>` : "");
  }
  vf.addEventListener("submit", (e) => {
    e.preventDefault();
    const r = score();
    if (!r.total) { toast("Этот поход не даст очков — проверь баню и время"); return; }
    let bathId = picked.id;
    if (picked === "new") {
      const name = $("#nbName").value.trim();
      if (!name) { toast("Впиши название новой бани"); $("#nbName").focus(); return; }
      const nb = { id: 100000 + newBaths.length + 1, name, country: $("#nbCountry").value.trim() || null, region: $("#nbRegion").value.trim() || null,
        type: $("#nbType").value, v26: {}, hist: {}, isNew: true, ...(newPin ? { lat: newPin[0], lng: newPin[1] } : {}) };
      newBaths.push(nb); store.set("newBaths", newBaths);
      hydrate(nb); baths.push(nb); byId.set(nb.id, nb); bathId = nb.id;
    }
    visits.unshift({ id: Date.now(), player: r.player, companions: r.comp, bathId, date: r.date, week: r.week, dur: r.dur, proof: r.proof,
      photos: $("#vPhotos").files.length, lines: r.lines.filter((l) => l[1]), total: r.total, status: "pending", at: Date.now() });
    store.set("visits", visits);
    $("#visitModal").hidden = true;
    updateBadge(); render();
    toast(`Поход отправлен на модерацию: +${r.total}`);
  });

  // ---------- лента и модерация ----------
  function updateBadge() {
    const n = visits.filter((v) => v.status === "pending").length;
    $("#pendingBadge").hidden = !n; $("#pendingBadge").textContent = n;
  }
  const STATUS = { pending: "на модерации", ok: "засчитан", rejected: "отклонён" };
  function renderFeed() {
    const sec = $("#secMode").checked;
    $("#feed").innerHTML = visits.length ? visits.map((v) => {
      const b = byId.get(v.bathId);
      return `<div class="card">
        <div class="h"><span class="t">${esc(v.player)}${v.companions.length ? ` <span class="m">+ ${v.companions.map(esc).join(", ")}</span>` : ""}</span><span class="status ${v.status}">${STATUS[v.status]}</span></div>
        <div><a href="#map" data-bath="${v.bathId}" style="color:var(--accent);font-weight:600">${esc(b?.name || "баня")}</a> <span class="m">${esc([b?.region, b?.country].filter(Boolean).join(", "))}</span></div>
        <div class="m">${v.date.replace("T", " ")} МСК · W${v.week} · ${v.dur} мин${v.proof ? " · фото с отметками" + (v.photos ? ` (${v.photos})` : "") : ""} · <b class="num" style="color:var(--heat)">+${v.total}</b> <span class="note">(${v.lines.map((l) => l[0].split(":")[0].split(" — ")[0].toLowerCase()).join(", ")})</span></div>
        ${sec && v.status === "pending" ? `<div style="display:flex;gap:8px"><button class="btn small primary" data-ok="${v.id}">Засчитать</button><button class="btn small danger" data-no="${v.id}">Отклонить</button></div>` : ""}
      </div>`;
    }).join("") : `<div class="empty">Пока пусто. Нажми «+ Поход в баню» наверху — поход появится здесь со статусом «на модерации».</div>`;
  }
  $("#secMode").addEventListener("change", renderFeed);
  $("#feed").addEventListener("click", (e) => {
    const ok = e.target.dataset.ok, no = e.target.dataset.no, bl = e.target.closest("[data-bath]");
    if (ok || no) {
      const v = visits.find((x) => x.id === +(ok || no)); v.status = ok ? "ok" : "rejected";
      store.set("visits", visits); updateBadge(); renderFeed(); toast(ok ? "Засчитано" : "Отклонено");
    } else if (bl) { e.preventDefault(); show("map"); openBath(+bl.dataset.bath, true); }
  });

  // ---------- общее ----------
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => (b.closest(".modal").hidden = true)));
  $$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $$(".modal").forEach((m) => (m.hidden = true)); });
  let tt;
  function toast(msg) {
    $(".toast")?.remove(); clearTimeout(tt);
    const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.append(t);
    tt = setTimeout(() => t.remove(), 2600);
  }

  // пара примерных отзывов на самую посещаемую баню, чтобы было видно, как это выглядит
  const top = [...baths].sort((a, b) => b.n26 - a.n26)[0];
  if (top && !store.get("seeded", false)) {
    reviews[top.id] = [
      { author: "Пример", rate: 5, text: "Пример отзыва: пар держат до закрытия, веники свежие, в мужской день народу много — лучше с утра.", sample: true },
      { author: "Пример", rate: 4, text: "Пример отзыва: купель холодная, парная большая. Минус — очередь в кассу в выходные.", sample: true },
    ];
    store.set("reviews", reviews); store.set("seeded", true);
  }

  updateBadge();
  render(true);
  const h = location.hash.slice(1);
  if (["table", "feed", "rules"].includes(h)) show(h);
})();
