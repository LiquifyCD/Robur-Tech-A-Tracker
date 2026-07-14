# Fondkoll

Fondkoll is a Swedish-language, mobile-first fund tracker for finding, following, and comparing mutual funds. It runs as a Cloudflare Worker with static assets, requires no client framework, and keeps personal watchlists on the user's device.

## Product capabilities

- Search by fund name, provider symbol, or ISIN when the provider recognises it.
- Open shareable fund URLs such as `/?fund=0P00000LCG.ST`.
- View the latest reported daily value, value date, currency, source, delay state, and freshness state.
- See a partial, currency-adjusted estimate since the latest NAV and which disclosed top holdings contributed most positively and negatively.
- Explore 1 month, 3 months, year-to-date, 1 year, 5 years, or the maximum available history.
- Save a local watchlist without an account.
- Compare up to three funds on a normalized percentage scale.
- Continue to show explicitly stale cached fund data when the provider is unavailable.
- Install the responsive web app on iPhone, iPad, Android, or desktop.
- Follow the device's light or dark appearance automatically, including matching browser theme colors and chart contrast.
- Respect iPhone notch and Home Screen safe areas without placing content behind fixed navigation.
- Navigate with keyboard landmarks, focus indicators, a skip link, live status messages, and reduced-motion support.

## Accuracy model

Fondkoll deliberately separates three concepts:

1. **Reported fund value** — a daily value supplied by the data provider. It is delayed and may be a NAV proxy, not a live tradable price.
2. **Calculated return** — computed only from the first and last actual observations in the selected period.
3. **Missing data** — omitted. The application never interpolates or invents prices, FX rates, or dates.

Weekend and market-holiday gaps are expected for daily funds. Data is marked stale when the latest real observation is more than 120 hours old. A previously cached response is clearly labelled if a refresh fails.

The holdings contribution panel is deliberately secondary to the reported fund value. Each holding is measured from the latest NAV date. Foreign holdings compound the local asset return with a matching currency-pair return into the fund currency before applying `adjusted change % × fund weight % / 100`. The result is never scaled to compensate for undisclosed or unavailable holdings and does not claim to reproduce official NAV. Coverage, timestamps, delayed data, FX adjustments, and unavailable holdings are explicit.

## Data provider and licensing assessment

The current adapter uses Yahoo Finance's undocumented search and chart endpoints. They provide broad international mutual-fund coverage and require no app credential, but Yahoo does not publish a service-level agreement or stable public documentation for these endpoints. Availability, response shape, coverage, permitted use, and redistribution rights may change.

Yahoo's published API terms restrict automated collection outside expressly permitted APIs and prohibit circumvention and excessive load. This project therefore:

- requests only small JSON responses;
- validates and limits query/symbol input;
- filters results to mutual funds;
- caches search and history responses at the edge for 15 minutes;
- identifies the source and its unofficial status in both API responses and the interface;
- does not scrape HTML or use user credentials; the holdings endpoint does require Yahoo's public session cookie/crumb handshake and is therefore more brittle than the chart endpoint;
- recommends a licensed market-data agreement before public, commercial, or high-volume production use.

Review the current [Yahoo API terms](https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apitnc/index.html) before deployment. A production owner remains responsible for confirming that their use and jurisdiction are permitted.

The application no longer performs FX conversion. Values stay in the reporting currency supplied by the fund-data source, avoiding false precision. If FX conversion is reintroduced, official reference rates such as the [ECB's daily information-only rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html) or a documented provider such as [Frankfurter](https://frankfurter.dev/) should be attributed and date-aligned with each fund observation.

## Architecture

```text
public/
  index.html             Accessible application shell and four main views
  css/styles.css         Design system, desktop/iPhone layouts, safe areas
  js/app.js              Navigation, search, fund loading, watchlist, comparison
  js/fundApi.js          Client API adapter with fresh/stale cache fallback
  js/fundStore.js        Local-only watchlist, comparison, and last-fund state
  js/format.js           Swedish date, percent, and currency presentation
  js/chart.js            Dependency-free history and normalized comparison chart
  js/cache.js            Namespaced localStorage TTL wrapper
  sw.js                  Offline application-shell cache
  manifest.json          Installable PWA metadata

functions/api/
  funds.js               Validated mutual-fund discovery endpoint
  fund.js                Validated historical fund-value endpoint and parser
  contributors.js        Top-holdings weights, daily quotes, contribution calculation

src/index.js             Worker routing, static assets, and security headers
test/                    Data, calculation, date/currency, PWA, and UI contracts
scripts/check.mjs        JavaScript syntax and JSON validation
```

The public API contract is provider-shaped at the edge and provider-neutral in the browser. The UI consumes normalized fields (`fund`, `latest`, `period`, `history`, and `source`) rather than Yahoo's response shape. A licensed provider can replace the two server-side adapters without rewriting the interface or local state.

## API routes

### `GET /api/funds?q=<query>`

Returns up to 12 mutual-fund matches. Empty queries return a small featured list. Query length is capped at 80 characters.

### `GET /api/fund?symbol=<symbol>&range=<range>`

Returns normalized fund metadata, last reported value, period statistics, actual history points, and source metadata. Allowed ranges are `1mo`, `3mo`, `6mo`, `ytd`, `1y`, `2y`, `5y`, `10y`, and `max`. Symbols are validated against a restricted character set.

Errors use JSON and do not expose secrets. Successful upstream responses are edge-cached for 15 minutes with a stale-if-error allowance.

### `GET /api/contributors?symbol=<symbol>&navAsOf=<ISO-date>&currency=<ISO-4217>`

Returns disclosed top holdings with normalized weights, movement since the supplied latest NAV date, currency-adjusted contribution in percentage points, positive/negative/net summaries, coverage, source, and timestamps. A weight supplied as either `0.10` or `10` is normalized to 10%. Missing or stale holding/FX quotes remain explicit and are excluded. Partial coverage is never scaled to 100%. Holdings metadata is cached for 12 hours and the calculated response for 15 minutes.

## Local development

Requirements: a current Node.js LTS release and npm.

```bash
npm install
npm run dev
```

Open the URL printed by Wrangler (normally `http://localhost:8787`). No environment variables, API keys, accounts, or paid services are required for the current adapter.

## Verification

```bash
npm run check
npm test
npm run build
```

Or run all gates:

```bash
npm run verify
```

The automated suite covers:

- fund response parsing and missing-value handling;
- daily and period return calculations;
- stale-date classification;
- Swedish date, percentage, and currency presentation;
- normalized comparison series;
- holding-weight normalization, contribution arithmetic, sorting, coverage, and missing-data preservation;
- mutual-fund-only search normalization and deduplication;
- responsive navigation, iPhone safe-area, reduced-motion, PWA, and security-header contracts.

The UI has also been manually exercised with the local Worker at desktop size and at a 390 × 844 iPhone viewport: fund loading, dynamic search, selection of a second fund, shareable URL changes, local saving, two-fund comparison, mobile bottom navigation, and console-error checks.

## Deployment

The repository is configured as a Cloudflare Worker with a static-assets binding:

```bash
npm run deploy
```

Deployment changes external state and is intentionally not part of verification. Confirm the provider terms and Cloudflare account settings before deploying.

## Security and privacy

- A strict Content Security Policy limits scripts, styles, images, and connections to the same origin.
- Framing, camera, microphone, geolocation, payment, and content-type sniffing are disabled or restricted.
- Search and symbol inputs are length/character validated server-side.
- No credentials or secrets are used or committed.
- Favorites, comparison selections, and the most recent fund are stored only in browser `localStorage`.
- Search text is sent to the Worker and then to the data provider; the app does not create a user profile.

## Known limitations and next steps

- A single unlicensed/undocumented provider remains the largest reliability and legal-risk constraint.
- ISIN is displayed only when known locally; provider search may resolve an ISIN without returning it in the result metadata.
- Top holdings may be shown when the unofficial provider supplies them, but full portfolios, sectors, regions, fees, risk scores, benchmarks, and official documents still require a licensed or official source.
- Comparisons do not yet align share classes by fee, accumulation policy, hedging, or benchmark.
- “Any fund” means any mutual fund covered by the configured provider, not every registered fund worldwide.

The strongest next improvement is a licensed provider adapter that supplies stable ISIN metadata, official NAV dates, fees, risk, benchmark, and holdings. That decision may introduce credentials or cost and should be made by the repository owner before implementation.

## Disclaimer

Fondkoll is an informational software project, not financial advice. Verify all values, dates, fees, and fund identity with the fund company or distributor before making a financial decision.
