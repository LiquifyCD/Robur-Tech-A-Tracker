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
- **Yahoo Finance has no official free API.** This app uses two of its
  widely relied-upon but undocumented endpoints: `v8/finance/chart` for
  live quotes, and `v10/finance/quoteSummary` (topHoldings module) for the
  fund's disclosed top-10 holdings. Both can change shape, rate-limit, or
  disappear without notice — that's why every layer here (client cache,
  edge cache, exponential backoff, "stale" badges) exists. The
  quoteSummary endpoint additionally requires a session cookie + "crumb"
  token, fetched fresh on every cold request (see `getCookieAndCrumb` in
  `functions/api/holdings.js`) — this is the single most likely thing to
  break if Yahoo changes its anti-bot handshake again.
- **Ticker symbols come directly from Yahoo**, since its topHoldings data
  already reports each position's ticker alongside its name and weight —
  no separate name→ticker mapping needed.

If you need the fund's actual daily NAV, always use the number your bank
or Swedbank Robur itself publishes. This app is for watching the intraday
direction, not for anything transactional.

---

## Architecture

```
index.html            Mobile-first UI shell
css/styles.css         Dark theme, CSS variables, responsive layout
manifest.json          Web app manifest — enables standalone (no browser
                        chrome) launch when added to a phone's home screen
icons/                 App icons used by manifest.json and iOS home-screen

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
  holdings.js    Handler logic: fetches disclosed top-10 holdings from
                 Yahoo Finance's quoteSummary API, edge-caches 12h
  quotes.js      Proxies Yahoo Finance per-symbol, edge-caches 10s
  fx.js          Proxies Frankfurter (ECB rates), edge-caches 1h

src/index.js
  Worker entry point — routes /api/holdings, /api/quotes, /api/fx to the
  handlers above and falls through to the static assets binding (public/)
  for everything else. See the file's own header comment for why this
  exists instead of relying on functions/ file-based routing directly.
```

Data flow: `app.js` → `holdings.js` (portfolio) + `marketData.js` (prices) +
`exchangeRates.js` (FX) → `calculator.js` (the math) → `ui.js` + `chart.js`
(render). Nothing is hardcoded except the ticker-resolution lookup table
described above — holdings, weights, prices, and FX all come from live
fetches with cache fallbacks.

---

## Installing it on your phone (standalone mode)

`manifest.json` + the iOS meta tags in `index.html` mean that when you add
the page to your Home Screen, it opens as its own app — no address bar, no
Safari search bar, no browser chrome.

- **iPhone (Safari):** open the site → Share → **Add to Home Screen**.
- **Android (Chrome):** open the site → ⋮ menu → **Add to Home screen** /
  **Install app**.

If you skip this step and just bookmark the page instead, the browser UI
will still show — standalone mode only kicks in once it's launched from the
home-screen icon.

---

## Deploying it yourself (I can't push this live for you)

This project is a **Workers project with static assets** (see
`wrangler.jsonc`: `main: src/index.js` + an `assets` binding pointing at
`public/`) — not a classic Cloudflare Pages project. It used to be plain
Pages Functions, but that only works when the project is deployed *as a
Pages project*; a plain Worker deploy ignores the `functions/` folder
entirely, which caused `/api/holdings` and `/api/quotes` to 404. `src/index.js`
now manually routes those three `/api/*` paths to the same handler logic
that still lives in `functions/api/*.js`.

### Option A — Wrangler CLI (recommended)
```bash
npm install
npx wrangler login
npm run deploy
```
This deploys the Worker (static assets + API routes together) in one step.
Your app will be live at `<project-name>.<your-subdomain>.workers.dev`.

### Option B — Cloudflare dashboard + GitHub
1. Push this folder to a GitHub repo.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Workers →
   Connect to Git** (not "Pages" — this project's config is Worker-style,
   so the Pages Git-integration flow won't pick up `wrangler.jsonc`'s
   `main`/`assets` settings correctly).
3. Point it at this repo/folder. Cloudflare will detect `package.json` and
   `wrangler.jsonc`; there are no runtime dependencies to install.
4. Deploy.

### Local dev
```bash
npm install
npm run dev
```
This runs Pages + Functions locally (via `wrangler pages dev`) so
`/api/holdings`, `/api/quotes`, and `/api/fx` all work exactly as they will
in production.

No environment variables, API keys, or paid services are required — every
upstream API used here (Frankfurter, and Yahoo's chart + quoteSummary
endpoints) is free and keyless.

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
- **Deliberately low CPU-per-request:** the Workers **Free** plan caps CPU
  time at ~10ms per request (waiting on `fetch()` doesn't count against
  that, only actual code execution does). `holdings.js` used to
  PDF-parse a factsheet server-side, which is real CPU work and could
  exceed that budget; it now just reads a few fields off a small JSON
  response instead, specifically to stay well inside the Free plan.

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
- **PWA install** — done — see "Installing it on your phone" above.
- **Dark mode / configurable refresh** — `styles.css` already isolates
  every color in `:root` variables; `app.js`'s `REFRESH_INTERVAL_MS` is a
  single constant to expose as a user setting.
- **Push notifications on threshold crossings** — `calculator.js`'s
  return value already has everything needed (`estimatedChangePct`); wire
  it to the Notifications API or a Cloudflare Worker + Web Push in
  `app.js`'s `refreshCycle()`.
