# Swedbank Robur Technology A — Live Tracker

A free, mobile-first web app that estimates the **intraday** performance of
Swedbank Robur Technology A by tracking its disclosed underlying holdings in
real time, instead of waiting for the official NAV (which only updates once
a day).

---

## ⚠️ Read this before you trust the numbers

This is an **estimate**, not a replication of the fund, for reasons that are
structural, not a shortcut I took:

- **No free source publishes the fund's full live portfolio.** The best
  public disclosure anywhere (Avanza, Nordnet, Morningstar, the fund
  company itself) is a **top-holdings snapshot** — for this fund, the top
  10 positions, refreshed roughly monthly, covering **~45-55% of assets**.
  This app fetches that top-10 list automatically, normalizes those
  weights to sum to 100% *so it can compute a %*, and always shows you the
  real disclosed coverage so the number is never presented as more precise
  than it is.
- **Yahoo Finance has no official free API.** This app uses its widely
  relied-upon but undocumented `v8/finance/chart` endpoint. It can change
  shape, rate-limit, or disappear without notice — that's why every layer
  here (client cache, edge cache, exponential backoff, "stale" badges)
  exists.
- **Company name → ticker mapping is a maintained lookup table, not
  scraped.** The factsheet gives company names in Swedish-formatted text,
  not ISO ticker symbols, and no free source gives you both together for
  this fund. `functions/api/holdings.js` maps ~30 recurring large-cap
  names (Nvidia, Broadcom, Microsoft, TSMC, etc.) to tickers. If the fund
  rotates into a genuinely new top-10 name that's never appeared before,
  it'll be silently excluded from the estimate until you add it to the
  list — see `NAME_TO_TICKER` in that file.

If you need the fund's actual daily NAV, always use the number your bank
or Swedbank Robur itself publishes. This app is for watching the intraday
direction, not for anything transactional.

---

## Architecture

```
index.html            Mobile-first UI shell
css/styles.css         Dark theme, CSS variables, responsive layout

js/
  app.js               Orchestration: polling loop, visibility handling,
                        backoff. Imports everything else.
  holdings.js           Client-side holdings cache + fetch orchestration
  marketData.js          Live quote fetch + per-symbol caching + market-open check
  calculator.js           Pure math: weighted-average estimate, gainers/losers
  exchangeRates.js          FX conversion (USD/EUR/TWD → SEK)
  chart.js                   Dependency-free canvas line chart
  ui.js                        All DOM reads/writes
  cache.js                      localStorage wrapper with TTL + stale-read support

functions/api/
  holdings.js    Cloudflare Pages Function: fetches + PDF-parses the fund's
                 public factsheet, resolves names → tickers, edge-caches 12h
  quotes.js      Proxies Yahoo Finance per-symbol, edge-caches 10s
  fx.js          Proxies Frankfurter (ECB rates), edge-caches 1h

package.json     Declares the `unpdf` dependency used by functions/api/holdings.js
```

Data flow: `app.js` → `holdings.js` (portfolio) + `marketData.js` (prices) +
`exchangeRates.js` (FX) → `calculator.js` (the math) → `ui.js` + `chart.js`
(render). Nothing is hardcoded except the ticker-resolution lookup table
described above — holdings, weights, prices, and FX all come from live
fetches with cache fallbacks.

---

## Deploying it yourself (I can't push this live for you)

I don't have access to your Cloudflare account, so here's the fastest path —
about 2 minutes either way:

### Option A — Cloudflare dashboard + GitHub (no CLI needed)
1. Push this folder to a new GitHub repo.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect
   to Git** → pick the repo.
3. Build settings: **Framework preset: None**, **Build command: (leave
   empty)**, **Build output directory: `/`**. Cloudflare will detect
   `package.json` and install `unpdf` automatically for the Functions.
4. Deploy. Your app will be live at `<project>.pages.dev`.

### Option B — Wrangler CLI
```bash
npm install
npx wrangler login
npm run deploy
```

### Local dev
```bash
npm install
npm run dev
```
This runs Pages + Functions locally (via `wrangler pages dev`) so
`/api/holdings`, `/api/quotes`, and `/api/fx` all work exactly as they will
in production.

No environment variables, API keys, or paid services are required — every
upstream API used here (Frankfurter, the FundConnect factsheet, Yahoo's
chart endpoint) is free and keyless.

---

## Performance notes

- No frameworks, no bundler, no build step — the entire client bundle is
  the plain JS/CSS above, loaded as native ES modules.
- All three API routes are cached at Cloudflare's edge (`caches.default`)
  so concurrent visitors share responses instead of each triggering a
  fresh upstream call.
- The client additionally caches holdings (24h), quotes (10s), and FX
  (1h) in `localStorage`, so a page reload doesn't re-fetch everything.
- Polling pauses via the Page Visibility API whenever the tab is hidden,
  and backs off exponentially (30s → 1m → 2m → capped at 5m) after
  repeated upstream failures instead of retrying every 15s indefinitely.

---

## Extending it later

The module boundaries were drawn with the roadmap in mind:

- **Multiple funds / comparisons** — `holdings.js` and `calculator.js`
  already key everything off an ISIN parameter; add a fund switcher in
  `ui.js` and a second entry in `functions/api/holdings.js`'s source
  config.
- **Historical estimated performance** — `chart.js` already timestamps
  every point; swap its `sessionStorage` backing for `localStorage` (or a
  Cloudflare KV-backed endpoint) to persist across days.
- **PWA install** — add a `manifest.json` + a minimal service worker;
  the app has no build step to complicate this.
- **Dark mode / configurable refresh** — `styles.css` already isolates
  every color in `:root` variables; `app.js`'s `REFRESH_INTERVAL_MS` is a
  single constant to expose as a user setting.
- **Push notifications on threshold crossings** — `calculator.js`'s
  return value already has everything needed (`estimatedChangePct`); wire
  it to the Notifications API or a Cloudflare Worker + Web Push in
  `app.js`'s `refreshCycle()`.
