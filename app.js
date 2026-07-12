/* ============================================================
   Daily — a personal PWA dashboard (weather · finance · digest)
   All data from keyless free APIs. Vanilla JS, no build step.
   ============================================================ */

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/* ---------------- tiny helpers ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Escape untrusted strings before putting them in innerHTML (defense against
// a compromised/MITM'd third-party API injecting markup).
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const store = {
  get: (k, d = null) => {
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
    catch { return d; }
  },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ---------------- state ---------------- */
const state = {
  city: store.get("default_city", "Przemyśl"),
  coords: store.get("coords", null),        // { lat, lon, name, country }
  units: store.get("temp_unit", "celsius"), // celsius | fahrenheit
};

const degSym = () => (state.units === "fahrenheit" ? "°F" : "°C");

/* ============================================================
   TABS
   ============================================================ */
const tabLoaded = {};
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    $$(".tab-content").forEach((s) => s.classList.toggle("active", s.id === target));
    window.scrollTo({ top: 0 });
    // lazy-load a tab's data the first time it's opened
    if (!tabLoaded[target]) {
      tabLoaded[target] = true;
      if (target === "finance") loadFinance();
      if (target === "digest") loadDigest();
    }
    // notes re-render every open so deadlines/overdue state stay fresh
    if (target === "notes") renderNotes();
  });
});

/* ============================================================
   WEATHER  (Open-Meteo — keyless)
   ============================================================ */
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

// WMO weather-code → { emoji (day/night), label }
const WMO = {
  0:  { d: "☀️", n: "🌙", t: "Ясно" },
  1:  { d: "🌤️", n: "🌙", t: "Переважно ясно" },
  2:  { d: "⛅", n: "☁️", t: "Мінлива хмарність" },
  3:  { d: "☁️", n: "☁️", t: "Похмуро" },
  45: { d: "🌫️", n: "🌫️", t: "Туман" },
  48: { d: "🌫️", n: "🌫️", t: "Паморозь" },
  51: { d: "🌦️", n: "🌧️", t: "Легка мряка" },
  53: { d: "🌦️", n: "🌧️", t: "Мряка" },
  55: { d: "🌧️", n: "🌧️", t: "Густа мряка" },
  56: { d: "🌧️", n: "🌧️", t: "Крижана мряка" },
  57: { d: "🌧️", n: "🌧️", t: "Крижана мряка" },
  61: { d: "🌦️", n: "🌧️", t: "Невеликий дощ" },
  63: { d: "🌧️", n: "🌧️", t: "Дощ" },
  65: { d: "🌧️", n: "🌧️", t: "Сильний дощ" },
  66: { d: "🌧️", n: "🌧️", t: "Крижаний дощ" },
  67: { d: "🌧️", n: "🌧️", t: "Крижаний дощ" },
  71: { d: "🌨️", n: "🌨️", t: "Невеликий сніг" },
  73: { d: "🌨️", n: "🌨️", t: "Сніг" },
  75: { d: "❄️", n: "❄️", t: "Сильний сніг" },
  77: { d: "🌨️", n: "🌨️", t: "Снігова крупа" },
  80: { d: "🌦️", n: "🌧️", t: "Короткочасні зливи" },
  81: { d: "🌧️", n: "🌧️", t: "Зливи" },
  82: { d: "⛈️", n: "⛈️", t: "Сильні зливи" },
  85: { d: "🌨️", n: "🌨️", t: "Снігопад" },
  86: { d: "❄️", n: "❄️", t: "Сильний снігопад" },
  95: { d: "⛈️", n: "⛈️", t: "Гроза" },
  96: { d: "⛈️", n: "⛈️", t: "Гроза з градом" },
  99: { d: "⛈️", n: "⛈️", t: "Гроза з градом" },
};
const wmo = (code, isDay = true) => {
  const w = WMO[code] || { d: "❓", n: "❓", t: "—" };
  return { icon: isDay ? w.d : w.n, label: w.t };
};

async function geocode(name) {
  const url = `${GEO_URL}?name=${encodeURIComponent(name)}&count=1&language=uk&format=json`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.results || !data.results.length) throw new Error("Місто не знайдено");
  const r = data.results[0];
  return { lat: r.latitude, lon: r.longitude, name: r.name, country: r.country_code || "" };
}

async function loadWeather(coords) {
  const hero = $("#weather-hero");
  hero.classList.add("skeleton");

  try {
    const c = coords || state.coords || (await geocode(state.city));
    state.coords = c;
    store.set("coords", c);

    const fUrl = `${FORECAST_URL}?latitude=${c.lat}&longitude=${c.lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,pressure_msl` +
      `&hourly=temperature_2m,weather_code,is_day` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max` +
      `&timezone=auto&forecast_days=7&temperature_unit=${state.units}` +
      `&wind_speed_unit=${state.units === "fahrenheit" ? "mph" : "ms"}`;

    const aUrl = `${AIR_URL}?latitude=${c.lat}&longitude=${c.lon}&current=european_aqi&timezone=auto`;

    const [wRes, aRes] = await Promise.all([
      fetch(fUrl),
      fetch(aUrl).catch(() => null),
    ]);
    const w = await wRes.json();
    const air = aRes && aRes.ok ? await aRes.json() : null;

    store.set("weather_cache", { c, w, air, ts: Date.now() });
    renderWeather(c, w, air);
  } catch (err) {
    console.error(err);
    const cache = store.get("weather_cache");
    if (cache) {
      renderWeather(cache.c, cache.w, cache.air);
      toast("Немає з'єднання — показано збережені дані");
    } else {
      hero.classList.remove("skeleton");
      hero.innerHTML = `<p class="msg err">${esc(err.message || "Не вдалося завантажити погоду")}</p>`;
    }
  }
}

function renderWeather(c, w, air) {
  const hero = $("#weather-hero");
  hero.classList.remove("skeleton");

  $("#city-name").textContent = c.country ? `${c.name}, ${c.country}` : c.name;
  $("#weather-date").textContent = new Date().toLocaleDateString("uk-UA", {
    weekday: "long", day: "numeric", month: "long",
  });

  const cur = w.current;
  const today = w.daily;
  const { icon, label } = wmo(cur.weather_code, cur.is_day === 1);
  const hi = Math.round(today.temperature_2m_max[0]);
  const lo = Math.round(today.temperature_2m_min[0]);

  hero.innerHTML = `
    <span class="hero-icon">${icon}</span>
    <span class="hero-temp">${Math.round(cur.temperature_2m)}°</span>
    <span class="hero-meta">
      <div class="hero-desc">${label}</div>
      <div class="hero-feels">Відчувається ${Math.round(cur.apparent_temperature)}${degSym()}</div>
      <div class="hero-range"><span class="hi">↑${hi}°</span> <span class="lo">↓${lo}°</span></div>
    </span>`;

  // stats
  const windUnit = state.units === "fahrenheit" ? "миль/год" : "м/с";
  const sr = new Date(today.sunrise[0]).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  const ss = new Date(today.sunset[0]).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  const aqi = air && air.current ? air.current.european_aqi : null;
  const aqiInfo = aqiBand(aqi);

  $("#weather-stats").innerHTML = `
    ${stat("Вологість", `${cur.relative_humidity_2m}<small>%</small>`)}
    ${stat("Вітер", `${Math.round(cur.wind_speed_10m)} <small>${windUnit}</small>`)}
    ${stat("Схід / захід", `🌅 ${sr} · 🌇 ${ss}`)}
    ${stat("Якість повітря", aqi == null
      ? "—"
      : `<span class="aqi-pill" style="background:${aqiInfo.bg};color:${aqiInfo.fg}">${aqi} · ${aqiInfo.label}</span>`)}
  `;

  // hourly — next 12 hours from now
  const now = Date.now();
  const times = w.hourly.time.map((t) => new Date(t).getTime());
  let start = times.findIndex((t) => t >= now);
  if (start < 0) start = 0;
  const hours = [];
  for (let i = start; i < start + 12 && i < times.length; i++) {
    const iso = w.hourly.is_day ? w.hourly.is_day[i] === 1 : true;
    const hw = wmo(w.hourly.weather_code[i], iso);
    hours.push(`
      <div class="hour ${i === start ? "now" : ""}">
        <div class="h-time">${i === start ? "Зараз" : new Date(times[i]).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}</div>
        <div class="h-ico">${hw.icon}</div>
        <div class="h-temp">${Math.round(w.hourly.temperature_2m[i])}°</div>
      </div>`);
  }
  $("#weather-hourly").innerHTML = hours.join("");

  // 7-day
  const days = today.time.map((t, i) => {
    const dw = wmo(today.weather_code[i], true);
    const name = i === 0 ? "Сьогодні" : new Date(t).toLocaleDateString("uk-UA", { weekday: "short" });
    const pop = today.precipitation_probability_max[i];
    return `
      <div class="day">
        <span class="d-name">${name}</span>
        <span class="d-ico">${dw.icon}</span>
        <span class="d-pop">${pop ? "💧" + pop + "%" : ""}</span>
        <span class="d-temp">${Math.round(today.temperature_2m_max[i])}° <span class="lo">${Math.round(today.temperature_2m_min[i])}°</span></span>
      </div>`;
  });
  $("#weather-daily").innerHTML = days.join("");
}

const stat = (k, v) => `<div class="stat"><div class="stat-k">${k}</div><div class="stat-v">${v}</div></div>`;

function aqiBand(aqi) {
  if (aqi == null) return { label: "—", bg: "transparent", fg: "var(--text)" };
  if (aqi <= 20) return { label: "добра", bg: "rgba(52,211,153,.2)", fg: "#34d399" };
  if (aqi <= 40) return { label: "задовільна", bg: "rgba(163,230,53,.2)", fg: "#a3e635" };
  if (aqi <= 60) return { label: "помірна", bg: "rgba(251,191,36,.2)", fg: "#fbbf24" };
  if (aqi <= 80) return { label: "погана", bg: "rgba(248,113,113,.2)", fg: "#f87171" };
  if (aqi <= 100) return { label: "дуже погана", bg: "rgba(217,70,239,.2)", fg: "#d946ef" };
  return { label: "небезпечна", bg: "rgba(153,27,27,.35)", fg: "#fca5a5" };
}

/* weather events */
$("#city-search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#city-search-input").value.trim();
  if (!q) return;
  try {
    const c = await geocode(q);
    $("#city-search-input").value = "";
    await loadWeather(c);
    toast(`Погода: ${c.name}`);
  } catch (err) {
    toast(err.message || "Місто не знайдено");
  }
});

$("#geo-btn").addEventListener("click", () => {
  if (!navigator.geolocation) return toast("Геолокація недоступна");
  toast("Визначаю місцезнаходження…");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const c = { lat: pos.coords.latitude, lon: pos.coords.longitude, name: "Моє місце", country: "" };
      // reverse-geocode for a nice name
      try {
        const r = await fetch(`${GEO_URL}?latitude=${c.lat}&longitude=${c.lon}&count=1&language=uk`).then((x) => x.json());
        if (r.results && r.results[0]) { c.name = r.results[0].name; c.country = r.results[0].country_code || ""; }
      } catch {}
      await loadWeather(c);
    },
    () => toast("Не вдалося отримати місцезнаходження"),
    { timeout: 8000 }
  );
});

/* ============================================================
   FINANCE  (Frankfurter + НБУ + CoinGecko — keyless)
   ============================================================ */
const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest";
const NBU_URL = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange";
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price";

const CURRENCIES = ["USD", "EUR", "PLN", "UAH", "GBP", "CZK"];
const CUR_META = {
  USD: { flag: "🇺🇸", name: "Долар США" },
  EUR: { flag: "🇪🇺", name: "Євро" },
  PLN: { flag: "🇵🇱", name: "Злотий" },
  UAH: { flag: "🇺🇦", name: "Гривня" },
  GBP: { flag: "🇬🇧", name: "Фунт" },
  CZK: { flag: "🇨🇿", name: "Крона" },
};
// table of "how many X per 1 USD"
let usdRates = null;

const CRYPTO = [
  { id: "bitcoin", sym: "BTC", emoji: "₿", name: "Bitcoin" },
  { id: "ethereum", sym: "ETH", emoji: "Ξ", name: "Ethereum" },
  { id: "solana", sym: "SOL", emoji: "◎", name: "Solana" },
  { id: "the-open-network", sym: "TON", emoji: "💎", name: "Toncoin" },
];

async function fetchUsdRates() {
  const [fiat, nbu] = await Promise.all([
    fetch(`${FRANKFURTER_URL}?from=USD&to=EUR,PLN,GBP,CZK`).then((r) => r.json()),
    fetch(`${NBU_URL}?valcode=USD&json`).then((r) => r.json()).catch(() => null),
  ]);
  const rates = { USD: 1, ...fiat.rates };
  if (Array.isArray(nbu) && nbu[0]) rates.UAH = nbu[0].rate;
  return rates;
}

async function loadFinance() {
  const list = $("#currency-list");
  list.innerHTML = skeletonCards(4);
  $("#crypto-list").innerHTML = skeletonCards(4);
  try {
    usdRates = await fetchUsdRates();
    store.set("rates_cache", { rates: usdRates, ts: Date.now() });
    renderRates();
    setupConverter();
    $("#finance-updated").textContent = "Оновлено " + new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  } catch (err) {
    console.error(err);
    const cache = store.get("rates_cache");
    if (cache) { usdRates = cache.rates; renderRates(); setupConverter(); toast("Показано збережені курси"); }
    else list.innerHTML = `<p class="msg err">Не вдалося завантажити курси</p>`;
  }
  loadCrypto();
}

function renderRates() {
  // show USD→EUR/PLN/UAH/GBP style pairs
  const pairs = [["USD", "UAH"], ["USD", "PLN"], ["EUR", "PLN"], ["EUR", "UAH"]];
  $("#currency-list").innerHTML = pairs.map(([a, b]) => {
    const rate = usdRates[b] / usdRates[a];
    if (!isFinite(rate)) return "";
    return currencyCard(`${CUR_META[a].flag}${CUR_META[b].flag}`, `${a} → ${b}`, `1 ${a} = `, rate.toFixed(2) + " " + b);
  }).join("");
}

async function loadCrypto() {
  try {
    const ids = CRYPTO.map((c) => c.id).join(",");
    const data = await fetch(`${COINGECKO_URL}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`).then((r) => r.json());
    store.set("crypto_cache", { data, ts: Date.now() });
    renderCrypto(data);
  } catch (err) {
    const cache = store.get("crypto_cache");
    if (cache) renderCrypto(cache.data);
    else $("#crypto-list").innerHTML = `<p class="msg err">Не вдалося завантажити крипту</p>`;
  }
}

function renderCrypto(data) {
  $("#crypto-list").innerHTML = CRYPTO.map((c) => {
    const d = data[c.id];
    if (!d) return "";
    const price = d.usd;
    const chg = d.usd_24h_change || 0;
    const cls = chg >= 0 ? "up" : "down";
    const arrow = chg >= 0 ? "▲" : "▼";
    const priceStr = price >= 1 ? price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : price.toPrecision(3);
    return `
      <div class="currency-card">
        <div class="cc-left">
          <span class="cc-emoji">${c.emoji}</span>
          <div><div class="cc-pair">${c.sym}</div><div class="cc-name">${c.name}</div></div>
        </div>
        <div class="cc-right">
          <div class="cc-rate">$${priceStr}</div>
          <div class="cc-delta ${cls}">${arrow} ${Math.abs(chg).toFixed(2)}%</div>
        </div>
      </div>`;
  }).join("");
}

function currencyCard(emoji, pair, prefix, value) {
  return `
    <div class="currency-card">
      <div class="cc-left">
        <span class="cc-emoji">${emoji}</span>
        <div><div class="cc-pair">${pair}</div><div class="cc-name">${prefix}</div></div>
      </div>
      <div class="cc-right"><div class="cc-rate">${value}</div></div>
    </div>`;
}

const skeletonCards = (n) =>
  Array.from({ length: n }, () => `<div class="currency-card skeleton" style="height:64px"></div>`).join("");

/* converter */
let convReady = false;
function setupConverter() {
  const from = $("#conv-from");
  const to = $("#conv-to");
  if (!convReady) {
    const opts = CURRENCIES.map((c) => `<option value="${c}">${CUR_META[c].flag} ${c}</option>`).join("");
    from.innerHTML = opts;
    to.innerHTML = opts;
    from.value = "USD";
    to.value = "UAH";
    [from, to, $("#conv-amount")].forEach((el) => el.addEventListener("input", convert));
    $("#conv-swap").addEventListener("click", () => {
      const t = from.value; from.value = to.value; to.value = t; convert();
    });
    convReady = true;
  }
  convert();
}

function convert() {
  if (!usdRates) return;
  const amt = parseFloat($("#conv-amount").value) || 0;
  const from = $("#conv-from").value;
  const to = $("#conv-to").value;
  const rate = usdRates[to] / usdRates[from];
  if (!isFinite(rate)) { $("#conv-result").textContent = "—"; return; }
  $("#conv-result").textContent = (amt * rate).toLocaleString("uk-UA", { maximumFractionDigits: 2 });
  $("#conv-rate").textContent = `1 ${from} = ${rate.toFixed(4)} ${to}`;
}

$("#finance-refresh").addEventListener("click", () => { loadFinance(); toast("Оновлюю…"); });

/* ============================================================
   DIGEST  (Wikipedia "on this day" + quote of the day)
   ============================================================ */
const QUOTES = [
  { t: "Найкращий час посадити дерево був 20 років тому. Другий найкращий час — сьогодні.", a: "Народна мудрість" },
  { t: "Ми є те, що ми робимо постійно. Досконалість — це не дія, а звичка.", a: "Аристотель" },
  { t: "Успіх — це рух від невдачі до невдачі без втрати ентузіазму.", a: "Вінстон Черчилль" },
  { t: "Хто хоче — шукає можливості, хто не хоче — шукає причини.", a: "Народна мудрість" },
  { t: "Дорогу здолає той, хто йде.", a: "Латинське прислів'я" },
  { t: "Роби, що можеш, з тим, що маєш, там, де ти є.", a: "Теодор Рузвельт" },
  { t: "Найтемніша година — перед світанком.", a: "Англійське прислів'я" },
  { t: "Знання — це сила.", a: "Френсіс Бекон" },
  { t: "Мрій великими мріями, бо тільки великі мрії мають силу рухати серця людей.", a: "Марк Аврелій" },
  { t: "Життя — це те, що з тобою трапляється, поки ти будуєш інші плани.", a: "Джон Леннон" },
  { t: "Терпіння і труд усе перетруть.", a: "Народна мудрість" },
  { t: "Не бійся йти повільно, бійся стояти на місці.", a: "Китайське прислів'я" },
];

function dayOfYear(d = new Date()) {
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
}

async function loadDigest() {
  const now = new Date();
  $("#digest-date").textContent = now.toLocaleDateString("uk-UA", { day: "numeric", month: "long" });

  // quote of the day (deterministic, works offline)
  const q = QUOTES[dayOfYear() % QUOTES.length];
  $("#quote-text").textContent = q.t;
  $("#quote-author").textContent = "— " + q.a;

  // on this day
  const list = $("#events-list");
  list.innerHTML = `<div class="event skeleton" style="height:70px"></div>`.repeat(4);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  try {
    const data = await fetch(`https://uk.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`).then((r) => r.json());
    store.set("events_cache", { data, key: mm + dd });
    renderEvents(data);
  } catch {
    const cache = store.get("events_cache");
    if (cache && cache.key === mm + dd) renderEvents(cache.data);
    else list.innerHTML = `<p class="msg err">Не вдалося завантажити події</p>`;
  }
}

function renderEvents(data) {
  const events = (data.events || [])
    .sort((a, b) => b.year - a.year)
    .slice(0, 8);
  if (!events.length) { $("#events-list").innerHTML = `<p class="msg">Немає подій</p>`; return; }
  $("#events-list").innerHTML = events.map((e) => `
    <div class="event">
      <span class="ev-year">${esc(e.year)}</span>
      <span class="ev-text">${esc(e.text)}</span>
    </div>`).join("");
}

$("#digest-refresh").addEventListener("click", () => { loadDigest(); toast("Оновлюю…"); });

/* ============================================================
   NOTES  (local to-dos with deadlines — stored in localStorage)
   ============================================================ */
const NOTES_KEY = "notes_v1";
const getNotes = () => store.get(NOTES_KEY, []);
const saveNotes = (n) => store.set(NOTES_KEY, n);

// Format a stored deadline into a short Ukrainian label like "до 23:00, сьогодні".
function fmtDue(iso) {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((midnight(d) - midnight(now)) / 864e5);
  let day;
  if (dayDiff === 0) day = "сьогодні";
  else if (dayDiff === 1) day = "завтра";
  else if (dayDiff === -1) day = "вчора";
  else day = d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" });
  return `до ${time}, ${day}`;
}

function noteCard(n) {
  const overdue = n.due && !n.done && new Date(n.due).getTime() < Date.now();
  return `
    <div class="note ${n.done ? "done" : ""} ${overdue ? "overdue" : ""}" data-id="${esc(n.id)}">
      <button class="note-check" data-act="toggle" aria-label="Позначити виконаним">${n.done ? "✓" : ""}</button>
      <div class="note-body">
        <div class="note-text">${esc(n.text)}</div>
        ${n.due ? `<div class="note-due">🕑 ${esc(fmtDue(n.due))}</div>` : ""}
      </div>
      <button class="note-del" data-act="del" aria-label="Видалити">✕</button>
    </div>`;
}

function renderNotes() {
  const notes = getNotes();
  const list = $("#notes-list");
  const active = notes.filter((n) => !n.done).length;
  $("#notes-sub").textContent = notes.length
    ? `${active} активних · ${notes.length} усього`
    : "Немає нотаток";

  if (!notes.length) {
    list.innerHTML = `<p class="msg">Ще немає нотаток. Додай першу вище.</p>`;
    return;
  }

  // undone first; within each group, by nearest deadline (no-deadline last), newest last
  const sorted = [...notes].sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    if (a.due && b.due) return new Date(a.due) - new Date(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    return (b.created || 0) - (a.created || 0);
  });
  list.innerHTML = sorted.map(noteCard).join("");
}

$("#note-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#note-text").value.trim();
  if (!text) return toast("Введи текст нотатки");
  const due = $("#note-due").value; // "" or "YYYY-MM-DDTHH:mm" (local time)
  const notes = getNotes();
  notes.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text,
    due: due || null,
    done: false,
    created: Date.now(),
  });
  saveNotes(notes);
  $("#note-text").value = "";
  $("#note-due").value = "";
  renderNotes();
  toast("Нотатку додано");
});

// event delegation — cards are re-rendered, so listen on the stable container
$("#notes-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.closest(".note").dataset.id;
  let notes = getNotes();
  if (btn.dataset.act === "toggle") {
    notes = notes.map((n) => (n.id === id ? { ...n, done: !n.done } : n));
  } else if (btn.dataset.act === "del") {
    notes = notes.filter((n) => n.id !== id);
  }
  saveNotes(notes);
  renderNotes();
});

/* ============================================================
   SETTINGS
   ============================================================ */
$("#city-input").value = state.city;
$("#save-city").addEventListener("click", async () => {
  const v = $("#city-input").value.trim();
  if (!v) return toast("Введи місто");
  state.city = v;
  store.set("default_city", v);
  try {
    const c = await geocode(v);
    await loadWeather(c);
    toast("Місто збережено");
  } catch (err) {
    toast(err.message || "Місто не знайдено");
  }
});

$$("#unit-toggle .seg").forEach((btn) => {
  btn.classList.toggle("active", btn.dataset.unit === state.units);
  btn.addEventListener("click", () => {
    state.units = btn.dataset.unit;
    store.set("temp_unit", state.units);
    $$("#unit-toggle .seg").forEach((b) => b.classList.toggle("active", b === btn));
    loadWeather(state.coords);
    toast("Одиниці змінено");
  });
});

$("#clear-cache").addEventListener("click", async () => {
  if ("caches" in window) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
  toast("Кеш очищено, оновлюю…");
  setTimeout(() => location.reload(), 700);
});

/* ============================================================
   INIT
   ============================================================ */
tabLoaded.weather = true;
loadWeather();
