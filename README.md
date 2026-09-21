# KisanSetu / Market Price Tracker

> Know your market. Know your price.

React 19 + Vite + `react-router-dom` app, mobile-first, for an Indian
agricultural market-price tracker. **All pages are open — no login, no
signup.** **Live market prices** come from the FastAPI backend
(Agmarknet-backed); alerts, price-history shapes and the
location directory are local demo data. Prices served from the demo
fallback (backend unreachable) carry no live-source badge.

## Run

```bash
cd frontend-react
npm install
npm run dev     # → http://localhost:5173/
npm run lint    # oxlint
npm run build   # → dist/
npm run preview # serve the production build locally
```

Deploys as a static Vite site. The same-origin `/api/market` proxy
(`api/market/[...path].js`) forwards to the live backend so the browser
never hits CORS limits, and SPA rewrites send everything else to
`index.html` (see `vercel.json`; mirrored at the repo root and inside
`frontend-react/` — only the set matching the Vercel project's Root
Directory is active). Internet is needed for CDNs (Bootstrap Icons 1.11.3,
Fraunces + IBM Plex + Noto Sans Devanagari/Bengali fonts) and for the live
price API.

## Design

Market-ledger aesthetic, hand-rolled CSS (no UI framework):
forest green + mustard accents on warm paper, Fraunces serif headlines,
IBM Plex Sans body, tabular mono numerals like a real mandi price board.
Shared navbar/footer/location modal live in `frontend-react/src/components/`.
Icons are Bootstrap Icons (SVG) — no emojis in the UI.

## Pages (`frontend-react/src/pages/`)

| Route | Purpose |
| ----- | ------- |
| `/` | Home: hero, crop search with autocomplete, location flow, quick actions, trending crops, how-it-works |
| `/market` | All crops with **live** price + trend; search, state filter, sort |
| `/crop?crop=tomato` | Crop detail: quantity calculator (kg/quintal/tonne), price range, min/avg/max, Chart.js history (7d–1y), price-alert modal |

## Features

- **Live market prices** — `getCropPrice` / `getAllPrices`
  (`frontend-react/src/lib/api.js`) hit `GET /products/?name=&state=`; state
  filter comes from the saved location or the explicit `?state=` param
  ("" = All India). Crops with no live entry are hidden rather than showing
  a fake price. Searching surfaces the backend's full catalog (multi-match
  variants and products outside the 19-crop directory); the Market grid
  streams rows in per crop (`getAllPricesProgressive`) and reuses last
  visit's prices from `localStorage` (`getCachedPrices`/`storePrices`) while
  refreshing, so cold starts don't blank the page. `warmMarketApi()` wakes
  the free-tier backend on app boot.
- **Price history charts** — `getPriceHistory` rescales the stored 365-day curve to
  the live modal price and slices 7/30/90/180/365-day ranges (Chart.js line).
- **Price alerts** — rules created per crop (`above` / `below` / `percent_up` /
  `percent_down`); the Alerts page evaluates them against live prices and posts
  one news item per genuine hit, expiring after 7 days. No demo seeding — an
  empty feed means nothing has triggered. Percent rules use price history this
  app actually observed from the live backend (no history yet → the rule waits).
- **Location flow** — browser geolocation → BigDataCloud / Nominatim reverse-geocode
  → `ipapi.co` IP fallback → manual State→District→Town picker with an
  **"Other town / village"** free-text fallback; saved to `localStorage`.
- **Language selector in the navbar** — English / हिन्दी / বাংলা. Translates the
  whole UI including crop, category and unit names
  (`frontend-react/src/lib/i18n.jsx`); choice persists in `localStorage`.

## Data: what is live vs local

**Live (FastAPI backend)** — source code at
**https://github.com/Aditya-das-4707-e/farmer_api**, hosted at
`https://farmer-api-ooi2.onrender.com`
(Swagger UI at `https://farmer-api-ooi2.onrender.com/docs`):

- `getCropPrice(cropId, state)` / `getAllPrices(state)` call
  `GET /api/market/products/?name=<Crop>&state=<State>` and map the response
  (`market_price_per_kg`, `min/max_price_per_kg`, `matched_commodity`,
  `arrival_date`, `markets_count`, `source: live|cache|static`) onto the price
  cards. Source is badged per card: **Live · Agmarknet / Agmarknet · cached /
  Static**. Crops with no live entry are hidden — never a fake price.
- State filter: explicit `?state=` param wins (`""` = All India); otherwise the
  saved location's state; retries the state-scoped query without the state
  before giving up. Same-origin `/api/market` avoids CORS:
  - dev → Vite proxy (`frontend-react/vite.config.js` `server.proxy`) →
    `MARKET_API_TARGET` (`https://farmer-api-ooi2.onrender.com`).
  - prod (Vercel) → serverless `api/market/[...path].js` → same upstream
    (edge cache `max-age=60, s-maxage=300, stale-while-revalidate=600`).
  - override: `VITE_MARKET_API_BASE` env (e.g. `http://127.0.0.1:8000`); hard
    offline switch: `USE_LIVE_MARKET_API = false` in `src/lib/api.js`.
  - client caches lookups 10 min (`MARKET_CACHE_TTL_MS`).
- `getPriceHistory(cropId, days, state)` re-anchors the stored 365-day curve to
  the **live** modal price so the chart and the price card always match.

| Endpoint | Use |
| -------- | --- |
| `GET /products/?name=<crop>` | Plural-tolerant search over 411 products (e.g. `?name=rice`), Hindi + Bengali names included |
| `GET /products/?name=<crop>&state=<State>` | State-scoped live Agmarknet average |
| `GET /products/?name=<crop>&live=false` | Force static fallback price |
| `GET /cache/stats` / `POST /cache/refresh` | Inspect / refresh the 6h in-memory cache |

Live = all-India Agmarknet modal average via `data.gov.in` (resource
`9ef84268-d588-465a-a308-a864a43d0070`), converted Rs/quintal → Rs/kg with
`arrival_date`, `markets_count`, min/max and `matched_commodity`; non-mandi
goods (ghee, paneer, honey, milk, oils, pickles…) return
`source: static_fallback`. Requires `DATA_GOV_IN_API_KEY` for live data
(copy `.env.example` → `.env`); without a key it serves static prices.
Run locally: `uvicorn main:app --host 0.0.0.0 --port 8000`.

**Local (`frontend-react/src/data/mockData.js` + `localStorage`):**

- Crop directory (19 crops, local names + aliases), 36 states/UTs → 787
  districts → 4,100+ towns, demo farmer listings, default alert rules,
  price-history shapes.
- `localStorage`: alert rules (`kisansetu_alerts`), triggered news
  (`kisansetu_news`, 7-day TTL), saved location (`kisansetu_location`),
  language (`kisansetu_lang`), last loaded prices (`kisansetu_prices_v1`).

## Structure

- `frontend-react/src/App.jsx` — router (`BrowserRouter`, `Layout` outlet, redirects for removed auth routes)
- `frontend-react/src/components/` — `chrome.jsx` (`Navbar`/`Footer`/`LocationModal`), `Layout.jsx`,
  `LocationSelects.jsx`, `PriceChart.jsx` (Chart.js line), `bits.jsx` (trend icon, verified badge)
- `frontend-react/src/pages/` — `Home`, `Market`, `CropDetail`, `Alerts`, `NotFound`
- `frontend-react/src/lib/api.js` — data layer (live market API + local mock fallbacks/reference data)
- `frontend-react/src/lib/i18n.jsx` — EN/HI/BN dictionaries, crop/category/unit translators and `LanguageProvider`
- `frontend-react/src/css/` — `theme.css` (design tokens) + `style.css` (market-ledger theme)
- `api/market/[...path].js` + `frontend-react/vite.config.js` + `vercel.json` — same-origin API proxy + SPA rewrites

## Language

The navbar has a **Language** selector (English / हिन्दी / বাংলা). It translates the
entire UI — headings, buttons, labels, crop names, categories, units, and form
validation messages — via `frontend-react/src/lib/i18n.jsx`. The choice persists in
`localStorage` (`kisansetu_lang`). Noto Sans Devanagari + Noto Sans Bengali are loaded in
`index.html` so Hindi/Bengali text renders correctly.

## Notes

- Live prices come from Agmarknet-backed data via the FastAPI service. Crops
  with no live entry are hidden rather than showing a fake price; when the
  API itself is unreachable (offline, cold start) the grid falls back to
  demo numbers so the page never goes blank.
- Farmer listings, alert defaults and location directory are still local demo data.
- Place names that really contain "Mandi" (e.g. Ramganj Mandi) are real locations, not branding.
