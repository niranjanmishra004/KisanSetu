/* KisanSetu — API Layer (currently mock-backed).
   Every function returns a Promise like fetch(). Swap bodies for
   real Laravel endpoints later without touching callers. */
import {
  MOCK_CROPS,
  MOCK_MARKET_PRICES,
  MOCK_PRICE_HISTORY,
  MOCK_FARMERS,
  MOCK_ALERTS,
  setMockAlerts,
  LOCATIONS,
  DEMO_USER,
  DEMO_LOCATION,
} from "../data/mockData.js";

const ALERTS_KEY = "kisansetu_alerts";
const LOCATION_KEY = "kisansetu_location";

function delay(ms = 120) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* =====================================================================
   Live Market Price API — "Indian Market Price" (FastAPI)
   ---------------------------------------------------------------------
   The market pages are now backed by a real price service. Calls go to a
   same-origin route `/api/market` — proxied to the hosted FastAPI app by
   the Vite dev server (vite.config.js `server.proxy`) and, in production,
   by the Vercel function `api/market.js`. This avoids the Render API's
   CORS restrictions so the browser can read live data directly.

   The upstream base can still be overridden at build/dev time with the
   VITE_MARKET_API_BASE env var when you need to point elsewhere (e.g.
   http://127.0.0.1:8000 to hit a local backend).

    Every lookup is wrapped so that if the API is unreachable (offline,
    Render cold-start, proxy down, non-JSON fallback page) we transparently
    fall back to the demo MOCK data — the app never breaks and no page
    needs to know which source answered. Only an affirmative miss from the
    API itself (404 / empty list for a non-mandi crop) hides that crop
    rather than showing a fake price. Flip USE_LIVE_MARKET_API to
    false to force pure demo mode.
   ===================================================================== */
const MARKET_API_BASE =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_MARKET_API_BASE) ||
  "/api/market";

const USE_LIVE_MARKET_API = true;
const MARKET_CACHE_TTL_MS = 10 * 60 * 1000; // client-side reuse window
const marketCache = new Map();

/** Current state (from the saved location), used for the live ?state= filter. */
function currentState() {
  try {
    const loc = JSON.parse(localStorage.getItem("kisansetu_location") || "null");
    return (loc && loc.state) || "";
  } catch {
    return "";
  }
}

function marketCacheKey(name, state, live) {
  return `${(name || "").trim().toLowerCase()}|${(state || "").trim().toLowerCase()}|${live ? 1 : 0}`;
}

function marketCacheGet(name, state, live) {
  const k = marketCacheKey(name, state, live);
  const hit = marketCache.get(k);
  if (hit && Date.now() - hit.t < MARKET_CACHE_TTL_MS) return hit.v;
  if (hit) marketCache.delete(k);
  return undefined;
}

function marketCacheSet(name, state, live, value) {
  marketCache.set(marketCacheKey(name, state, live), { t: Date.now(), v: value });
}

/** URL-safe slug for backend product names, e.g. "Raw Honey" -> "raw-honey". */
export function slugifyProductName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097F\u0980-\u09FF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

/**
 * Build a synthetic crop object for a backend product that has no entry in
 * the local MOCK_CROPS directory (e.g. honey, egg, red-cabbage variants).
 * Falls back gracefully in every language via i18n (cropName -> crop.name).
 */
export function backendRecordToCrop(live) {
  const productName = live.product_name || live.matched_commodity || "Unknown";
  const id = slugifyProductName(productName) || `backend-${live.id || "item"}`;
  return {
    id,
    name: productName,
    local: live.hindi_name || productName,
    category: "Other",
    units: ["kg", "quintal", "tonne"],
    aliases: [productName.toLowerCase(), id],
    backend: true,
    productName,
    hindiName: live.hindi_name || null,
    bengaliName: live.bengali_name || null,
  };
}

/**
 * GET /products?name=… (+ optional state/live) and return ALL ProductPrice
 * objects (not just the first). Same three-way result contract as the
 * single-item helper, but with an array:
 *  - array     → the API affirmatively returned prices (may be empty → miss).
 *  - null      → affirmative miss (404 with JSON body / empty list).
 *  - undefined → transport failure (outage). Callers fall back to demo data.
 * Transport failures are NOT cached, so the next lookup retries the API.
 */
async function fetchBackendPrices(name, { state = "", live = true } = {}) {
  if (!USE_LIVE_MARKET_API) return null;
  const cached = marketCacheGet(name, state, live);
  if (cached !== undefined) return cached;
  const params = new URLSearchParams({ name });
  if (state) params.set("state", state);
  if (!live) params.set("live", "false");
  // NOTE: no trailing slash before the `?` — Vercel's edge router does not
  // match `/api/market/products/` (trailing slash) to the
  // `api/market/[...path]` function and returns its own 404.
  let items = null;
  let transportError = false;
  try {
    const res = await fetch(`${MARKET_API_BASE}/products?${params.toString()}`);
    if (!res.ok) {
      // 404 needs a closer look: the upstream API reports "no such product"
      // as 404 + JSON (`{"detail": …}`) — that is an affirmative miss, hide
      // the crop. But a 404 with a non-JSON body means the proxy route
      // itself is missing (Vercel's HTML 404 page) — that is an outage, so
      // fall back to demo data instead of blanking the page.
      // Any other status (502/5xx from the proxy, etc.) = outage → fallback.
      if (res.status === 404) {
        const text = await res.text();
        try {
          JSON.parse(text);
          items = null;
        } catch {
          transportError = true;
        }
      } else transportError = true;
    } else if (!(res.headers.get("content-type") || "").includes("application/json")) {
      // Wrong content type (e.g. the SPA's index.html served for an
      // unproxied /api/* path) — treat as outage, not as "no data".
      transportError = true;
    } else {
      const data = await res.json();
      items = Array.isArray(data) && data.length ? data : null;
    }
  } catch {
    transportError = true; // offline / cold-start / CORS / bad JSON
  }
  if (transportError) return undefined;
  marketCacheSet(name, state, live, items);
  return items;
}

/** Live lookup that retries without the state filter if the state scope was empty. */
async function fetchBackendPricesBest(name, state, opts = {}) {
  if (!state) return fetchBackendPrices(name, { state: "", ...opts });
  const scoped = await fetchBackendPrices(name, { state, ...opts });
  // Non-empty scoped result wins. Empty/miss/error falls back to All-India
  // so a state with no mandi data still shows the national average instead
  // of hiding the crop. Transport failures on BOTH scopes stay undefined
  // so callers can fall back to demo data.
  if (Array.isArray(scoped) && scoped.length) return scoped;
  return fetchBackendPrices(name, { state: "", ...opts });
}

/** Single-item variant of the state-fallback lookup (first record only). */
async function fetchBackendPriceBest(name, state, opts = {}) {
  const items = await fetchBackendPricesBest(name, state, opts);
  if (items === undefined) return undefined;
  if (!items) return null;
  return items[0] || null;
}

/** Map a backend ProductPrice onto the shape the existing pages already use. */
function liveToPrice(live, mock) {
  const modal = Number(live.market_price_per_kg);
  const unit = live.unit || "kg";
  return {
    min: live.min_price_per_kg != null ? Number(live.min_price_per_kg) : modal,
    max: live.max_price_per_kg != null ? Number(live.max_price_per_kg) : modal,
    modal,
    unit,
    market:
      live.matched_commodity
        ? `${live.matched_commodity} · Mandi`
        : mock ? mock.market : "Wholesale Mandi",
    state: mock ? mock.state : "",
    district: mock ? mock.district : "",
    source:
      live.source === "live"
        ? "Live · Agmarknet"
        : live.source === "cache"
          ? "Agmarknet · cached"
          : "Static",
    updatedMinsAgo: mock ? mock.updatedMinsAgo : 0,
    trendPct: mock ? mock.trendPct : 0,
    trendDir: mock ? mock.trendDir : "stable",
    live: true,
    arrivalDate: live.arrival_date,
    marketsCount: live.markets_count,
    matchedCommodity: live.matched_commodity,
    // Backend identity — used to deduplicate merged lists (Market page shows
    // one card per backend product, not per local crop). Never displayed.
    productName: live.product_name,
    backendId: live.id ?? null,
  };
}

/**
 * Map one backend record to a {crop, price} row. The first record for a
 * known local crop reuses the local crop object (keeps translations,
 * category and stable `/crop?crop=<id>` links); every other record becomes
 * a synthetic crop so no backend product is silently dropped.
 */
function backendRowFor(live, localCrop, mock) {
  if (localCrop) return { crop: localCrop, price: liveToPrice(live, mock) };
  const crop = backendRecordToCrop(live);
  return { crop, price: liveToPrice(live, undefined) };
}

/**
 * Direct backend search for an arbitrary user query (e.g. "honey", "egg").
 * Returns ONE row per backend product — never just the first — so the full
 * 411-product catalog is reachable even though the local directory only
 * lists 19 crops. Single network request per query (no 411-request fan-out).
 *
 * Returns [] for affirmative misses AND for transport failures (callers keep
 * showing local results so the page never goes blank on outage).
 */
export async function searchBackendProducts(query, { state = "", live = true } = {}) {
  const q = (query || "").trim();
  if (!q || !USE_LIVE_MARKET_API) return [];
  const st = state !== undefined ? state : currentState();
  const items = await fetchBackendPricesBest(q, st, { live });
  if (!Array.isArray(items) || !items.length) return [];
  return items.map((item) => {
    const slug = slugifyProductName(item.product_name);
    const local = MOCK_CROPS.find((c) => c.id === slug || c.name.toLowerCase() === String(item.product_name || "").toLowerCase());
    if (local) return { crop: local, price: liveToPrice(item, MOCK_MARKET_PRICES[local.id]) };
    const crop = backendRecordToCrop(item);
    return { crop, price: liveToPrice(item, undefined) };
  });
}

/** Deduplicate merged price rows by backend identity, falling back to crop id. */
export function dedupePriceRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r || !r.crop || !r.price) continue;
    const backendKey = r.price.productName
      ? `backend:${String(r.price.productName).toLowerCase()}`
      : r.price.backendId != null
        ? `backend-id:${r.price.backendId}`
        : null;
    const key = backendKey || `crop:${r.crop.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export async function getAllCrops() {
  await delay();
  return MOCK_CROPS;
}

export async function searchCrops(query) {
  await delay(80);
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  return MOCK_CROPS.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.local.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      (c.aliases || []).some((a) => a.includes(q) || q.includes(a))
  );
}

export async function getCropById(cropId) {
  await delay();
  const local = MOCK_CROPS.find((c) => c.id === cropId);
  if (local) return local;
  // Backend-only product (e.g. "raw-honey", "green-cabbage"): synthesize a
  // crop from the live catalog so /crop?crop=<id> deep-links keep working.
  // No network on outage → null (callers show "not found", never a crash).
  if (!USE_LIVE_MARKET_API || !cropId) return null;
  try {
    const nameGuess = String(cropId).replace(/-/g, " ");
    const items = await fetchBackendPricesBest(nameGuess, "");
    if (Array.isArray(items)) {
      const slug = slugifyProductName(cropId);
      const exact =
        items.find((it) => slugifyProductName(it.product_name) === slug) ||
        items.find((it) => slugifyProductName(it.product_name) === slugifyProductName(nameGuess)) ||
        items[0];
      if (exact) {
        const synth = backendRecordToCrop(exact);
        // Keep the requested id stable so links/keys don't shift when the
        // backend returns a slightly different product_name casing.
        if (synth.id !== cropId) synth.aliases = [...(synth.aliases || []), synth.id];
        synth.id = cropId;
        return synth;
      }
    }
  } catch {
    /* offline → fall through to null */
  }
  return null;
}

export async function getCropPrice(cropId, state) {
  const crop = MOCK_CROPS.find((c) => c.id === cropId);
  if (USE_LIVE_MARKET_API && crop) {
    // Use the passed state as-is ("" = All India). Only fall back to the saved
    // location's state when no state was provided at all (undefined).
    const st = state !== undefined ? state : currentState();
    const live = await fetchBackendPriceBest(crop.name, st);
    if (live === undefined) {
      // Outage (not an affirmative miss): show demo data, badged as such,
      // so the page never goes blank. Affirmative misses (null) stay hidden
      // rather than showing a fake price.
      await delay();
      const mock = MOCK_MARKET_PRICES[cropId];
      return mock ? { cropId, ...mock, live: false } : null;
    }
    if (live) return { cropId, ...liveToPrice(live, MOCK_MARKET_PRICES[cropId]) };
    return null;
  }
  if (USE_LIVE_MARKET_API && !crop && cropId) {
    // Backend-only product id (synthetic crop): look it up by name and pick
    // the exact product when the backend returns several matches.
    const st = state !== undefined ? state : currentState();
    const nameGuess = String(cropId).replace(/-/g, " ");
    const items = await fetchBackendPricesBest(nameGuess, st);
    if (items === undefined) return null; // outage → hide, Market keeps locals
    if (Array.isArray(items) && items.length) {
      const slug = slugifyProductName(cropId);
      const exact =
        items.find((it) => slugifyProductName(it.product_name) === slug) || items[0];
      if (exact) return { cropId, ...liveToPrice(exact, undefined) };
    }
    return null;
  }
  await delay();
  const mock = MOCK_MARKET_PRICES[cropId];
  return mock ? { cropId, ...mock } : null;
}

export async function getAllPrices(state) {
  const st = state !== undefined ? state : currentState();
  if (USE_LIVE_MARKET_API) {
    const nested = await Promise.all(
      MOCK_CROPS.map(async (c) => {
        const mock = MOCK_MARKET_PRICES[c.id];
        const lives = await fetchBackendPricesBest(c.name, st);
        // Every backend record becomes a row so multi-match products are
        // never truncated to data[0]. The exact product-name match (when
        // present) keeps the familiar local card; otherwise the first
        // record is representative (e.g. Green Cabbage price on the Cabbage
        // card) and the rest become synthetic variant cards.
        if (Array.isArray(lives) && lives.length) {
          const exactIdx = lives.findIndex(
            (live) =>
              String(live.product_name || "").toLowerCase() === c.name.toLowerCase()
          );
          const ordered =
            exactIdx > 0
              ? [lives[exactIdx], ...lives.slice(0, exactIdx), ...lives.slice(exactIdx + 1)]
              : lives;
          return ordered.map((live, idx) =>
            idx === 0
              ? { crop: c, price: liveToPrice(live, mock) }
              : backendRowFor(live, null, undefined)
          );
        }
        // Affirmative miss (null) → hide the crop. Outage (undefined) →
        // demo fallback so the grid never goes blank.
        if (lives === undefined && mock) return [{ crop: c, price: { ...mock, live: false } }];
        return [];
      })
    );
    return dedupePriceRows(nested.flat().filter((r) => r && r.price));
  }
  await delay();
  return MOCK_CROPS.map((c) => ({ crop: c, price: MOCK_MARKET_PRICES[c.id] })).filter(
    (p) => p.price
  );
}

/**
 * Market-page query: local directory rows (already includes multi-record
 * variants) PLUS direct backend matches for the raw user query. This is how
 * the 392 products outside the 19-crop directory become visible — one extra
 * request per search, deduplicated, never a 411-request fan-out.
 */
export async function searchAllPrices(query, state) {
  const st = state !== undefined ? state : currentState();
  const q = (query || "").trim().toLowerCase();
  const base = await getAllPrices(st);
  if (!q) return base;
  const needle = q;
  const localHits = base.filter(
    ({ crop }) =>
      crop.name.toLowerCase().includes(needle) ||
      (crop.local || "").toLowerCase().includes(needle) ||
      crop.id.toLowerCase().includes(needle) ||
      (crop.aliases || []).some((a) => String(a).toLowerCase().includes(needle) || needle.includes(String(a).toLowerCase()))
  );
  const backendHits = await searchBackendProducts(query, { state: st });
  return dedupePriceRows([...localHits, ...backendHits]);
}

/**
 * Autocomplete source: local directory hits first, then backend-only extras
 * (deduplicated). Callers keep their intentional `slice(0, N)` preview limit;
 * the full list stays reachable via the Market page search.
 */
export async function searchCropsLive(query, { state = "" } = {}) {
  const q = (query || "").trim();
  if (!q) return [];
  const local = await searchCrops(q);
  const backendRows = await searchBackendProducts(q, { state });
  const backendCrops = backendRows.map((r) => r.crop);
  const seen = new Set(local.map((c) => c.id));
  const extras = backendCrops.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  return [...local, ...extras];
}

export async function getPriceHistory(cropId, rangeDays = 30, state) {
  const full = MOCK_PRICE_HISTORY[cropId] || [];
  await delay(40);
  // Anchor the demo history to the current (possibly live) modal price so the
  // chart and the price card always tell the same story.
  const mockBase = MOCK_MARKET_PRICES[cropId]?.modal || 1;
  const live = await getCropPrice(cropId, state);
  const base = (live && live.modal) || mockBase;
  if (!full.length) {
    // Backend-only product (no demo curve): synthesize a flat curve around
    // the live price so the chart still renders instead of going blank.
    const days = Math.max(1, Math.min(365, Number(rangeDays) || 30));
    const today = new Date();
    const points = [];
    for (let i = days; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      points.push({ date: d.toISOString().slice(0, 10), price: Math.round(base * 100) / 100 });
    }
    return points.slice(Math.max(0, points.length - rangeDays));
  }
  const ratio = base / mockBase;
  const scaled =
    ratio === 1 ? full : full.map((p) => ({ ...p, price: Math.round(p.price * ratio * 100) / 100 }));
  return scaled.slice(Math.max(0, scaled.length - rangeDays));
}

export async function getNearbyFarmers(cropId, filters = {}) {
  await delay(150);
  let list = MOCK_FARMERS.filter((f) => !cropId || f.crop === cropId);
  // Backend variant ids (e.g. "red-cabbage", "raw-honey") have no demo
  // sellers of their own: fall back to the base local crop's sellers so the
  // table shows nearby options instead of going empty.
  if (cropId && !list.length && String(cropId).includes("-")) {
    const base = MOCK_CROPS.find((c) => String(cropId).endsWith(c.id) || String(cropId).includes(c.id));
    if (base) list = MOCK_FARMERS.filter((f) => f.crop === base.id);
  }
  if (filters.maxDistance) list = list.filter((f) => f.distanceKm <= filters.maxDistance);
  if (filters.verifiedOnly) list = list.filter((f) => f.verified);
  if (filters.maxPrice) list = list.filter((f) => f.price <= filters.maxPrice);
  return list.sort((a, b) => a.distanceKm - b.distanceKm);
}

function persistAlerts(list) {
  try {
    localStorage.setItem(ALERTS_KEY, JSON.stringify(list));
  } catch {
    /* private mode */
  }
}

function readStoredAlerts() {
  try {
    const saved = JSON.parse(localStorage.getItem(ALERTS_KEY) || "null");
    if (Array.isArray(saved)) setMockAlerts(saved);
  } catch {
    /* corrupted storage: keep defaults */
  }
}

export async function getAlerts() {
  await delay();
  readStoredAlerts();
  return MOCK_ALERTS;
}

export async function createAlert(data) {
  await delay(200);
  const alert = { id: Date.now(), active: true, ...data };
  const next = [alert, ...MOCK_ALERTS];
  setMockAlerts(next);
  persistAlerts(next);
  return alert;
}

export async function deleteAlert(id) {
  await delay(120);
  const next = MOCK_ALERTS.filter((a) => a.id !== id);
  setMockAlerts(next);
  persistAlerts(next);
  return { success: true };
}

export async function toggleAlert(id) {
  await delay(100);
  const next = MOCK_ALERTS.map((a) => (a.id === id ? { ...a, active: !a.active } : a));
  setMockAlerts(next);
  persistAlerts(next);
  return next.find((a) => a.id === id);
}

export async function getLocations() {
  await delay(60);
  return LOCATIONS;
}

export async function detectLocation() {
  // Real browser geolocation + free reverse-geocoding (BigDataCloud, no key).
  // Throws a coded error so callers can explain the exact cause:
  // NO_API (needs HTTPS/localhost), DENIED (permission blocked),
  // UNAVAILABLE (no GPS fix and no network location either),
  // LOOKUP (GPS worked but place-name lookup failed — carries coords).
  let pos = null;
  try {
    pos = await new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        const e = new Error("geolocation-unavailable");
        e.code = "NO_API";
        reject(e);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        resolve,
        (err) => {
          const e = new Error("geolocation-failed");
          e.code = err && err.code === 1 ? "DENIED" : "UNAVAILABLE";
          reject(e);
        },
        {
          timeout: 10000,
          maximumAge: 60000,
        }
      );
    });
  } catch (err) {
    // Device can't get a GPS fix (typical Linux desktop): fall back to
    // network-based (IP) location instead of giving up.
    if (err && err.code === "UNAVAILABLE") return await ipFallbackLocation(err);
    throw err;
  }
  const { latitude, longitude } = pos.coords;
  // Place-name services, tried in order. If all fail, throw LOOKUP carrying
  // the raw coords so the caller can still save the real position.
  const services = [reverseBigDataCloud, reverseNominatim];
  for (const svc of services) {
    try {
      const loc = await svc(latitude, longitude);
      if (loc) return { ...loc, latitude, longitude };
    } catch {
      /* try next service */
    }
  }
  const e = new Error("reverse-geocode-failed");
  e.code = "LOOKUP";
  e.coords = { latitude, longitude };
  throw e;
}

async function fetchJson(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error("bad-response");
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function reverseBigDataCloud(lat, lng) {
  const data = await fetchJson(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
  );
  const city = data.city || data.locality || "";
  const locality = data.locality || data.city || "";
  if (!city && !locality) throw new Error("empty-result");
  return {
    locality,
    district: city,
    state: data.principalSubdivision || "",
  };
}

async function reverseNominatim(lat, lng) {
  const data = await fetchJson(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=en&zoom=14`
  );
  const a = data.address || {};
  const locality =
    a.suburb || a.neighbourhood || a.village || a.hamlet || a.town || a.city || "";
  const district = a.county || a.state_district || a.city_district || a.city || locality;
  const state = a.state || "";
  if (!locality && !district) throw new Error("empty-result");
  return { locality: locality || district, district: district || locality, state };
}

/** City-level location from the network connection (no GPS needed). */
async function ipFallbackLocation(originalError) {
  try {
    const data = await fetchJson("https://ipapi.co/json/");
    const city = data.city || "";
    if (!city) throw new Error("empty-result");
    return {
      locality: city,
      district: city,
      state: data.region || "",
      latitude: data.latitude,
      longitude: data.longitude,
      approximate: true,
    };
  } catch {
    throw originalError;
  }
}

export async function getCurrentUser(role) {
  await delay(80);
  return DEMO_USER[role] || DEMO_USER.farmer;
}

export function getSavedLocation() {
  try {
    return JSON.parse(localStorage.getItem(LOCATION_KEY) || "null") || DEMO_LOCATION;
  } catch {
    return DEMO_LOCATION;
  }
}

export function saveLocation(loc) {
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify(loc));
  } catch {
    /* ignore */
  }
}

/* ---------------- Triggered alert news (auto-expires after 7 days) ---------------- */

const NEWS_KEY = "kisansetu_news";
const NEWS_SEED_KEY = "kisansetu_news_seeded";
export const NEWS_TTL_MS = 7 * 24 * 3600 * 1000;

function readNews() {
  try {
    const saved = JSON.parse(localStorage.getItem(NEWS_KEY) || "null");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function writeNews(list) {
  try {
    localStorage.setItem(NEWS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** All live news items (anything older than 7 days is deleted first). Newest first. */
export async function getNotifications() {
  await delay();
  try {
    if (!localStorage.getItem(NEWS_SEED_KEY)) seedDemoNews();
  } catch {
    /* ignore */
  }
  const now = Date.now();
  const fresh = readNews()
    .filter((n) => now - (n.createdAt || 0) < NEWS_TTL_MS)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  writeNews(fresh);
  return fresh;
}

export async function addNotification(item) {
  await delay(80);
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: Date.now(),
    ...item,
  };
  const next = [entry, ...readNews()];
  writeNews(next);
  return entry;
}

export async function deleteNotification(id) {
  await delay(80);
  writeNews(readNews().filter((n) => n.id !== id));
  return { success: true };
}

/** One-time demo news so the feed is alive on first run. Never re-seeds. */
function seedDemoNews() {
  const now = Date.now();
  const H = 3600 * 1000;
  const demo = [
    { id: `demo-${now}-1`, createdAt: now - 2 * H, ruleId: null, crop: "tomato", condition: "above", threshold: 30, unit: "kg", price: 32, changePct: null, location: "Kolkata" },
    { id: `demo-${now}-2`, createdAt: now - 26 * H, ruleId: null, crop: "onion", condition: "percent_up", threshold: 10, unit: "%", price: 34, changePct: 12.5, location: "Kolkata" },
    { id: `demo-${now}-3`, createdAt: now - 77 * H, ruleId: null, crop: "potato", condition: "below", threshold: 20, unit: "kg", price: 19, changePct: null, location: "Kolkata" },
    { id: `demo-${now}-4`, createdAt: now - 122 * H, ruleId: null, crop: "mango", condition: "above", threshold: 40, unit: "kg", price: 44, changePct: null, location: "Kolkata" },
  ];
  writeNews(demo);
  try {
    localStorage.setItem(NEWS_SEED_KEY, "1");
  } catch {
    /* ignore */
  }
}

export { DEMO_LOCATION };
