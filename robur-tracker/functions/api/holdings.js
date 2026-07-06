/**
 * GET /api/holdings?isin=SE0000538944
 * ---------------------------------------------------------------------------
 * Fetches the fund's disclosed "top holdings" from Yahoo Finance's
 * quoteSummary API (topHoldings module).
 *
 * WHY THIS REPLACED THE PDF-BASED VERSION:
 * The previous version downloaded the fund's FundConnect factsheet PDF and
 * used `unpdf` (a serverless PDF.js build) to extract and parse its text.
 * That is genuine CPU-bound work - decoding a PDF and running text
 * extraction - and the Workers **Free** plan caps CPU time at ~10ms per
 * request. That's very likely why this endpoint was returning 502s: the
 * parse alone could easily exceed the whole budget before it even got to
 * fetching quotes. Cloudflare does NOT count time spent waiting on fetch()
 * calls toward that limit - only actual code execution does - so an
 * approach that's mostly "wait for a small JSON response, then read a few
 * fields off it" fits comfortably where PDF decoding cannot.
 *
 * Yahoo Finance carries this exact fund under its own symbol, confirmed to
 * correspond to ISIN SE0000538944, and its quoteSummary "topHoldings"
 * module already reports the disclosed top-10 with ticker + name + weight
 * directly - so the old NAME_TO_TICKER guessing table is gone too.
 *
 * WHY THE COOKIE+CRUMB DANCE:
 * Yahoo's quoteSummary endpoint (unlike the /v8/finance/chart endpoint
 * quotes.js uses) requires a session cookie and a matching "crumb" token,
 * or it responds with an "Invalid Cookie" error. Both are fetched fresh
 * below: a throwaway request to fc.yahoo.com for the cookie, then a
 * request to Yahoo's own getcrumb endpoint using that cookie. This is
 * two small network round-trips (not CPU time), plus trivial JSON parsing.
 *
 * A HONEST CAVEAT:
 * This cookie/crumb handshake is an unofficial, undocumented mechanism
 * that Yahoo has changed before and can change again - the same category
 * of fragility quotes.js's own comments deliberately avoided by picking
 * the /v8/finance/chart endpoint instead of /v7/finance/quote. If this
 * starts 502ing again, check the error message in the response body first
 * (it will say which of the three fetches failed) before assuming it's a
 * CPU-limit issue again.
 * ---------------------------------------------------------------------------
 */

const YAHOO_FUND_SYMBOL = '0P00000LCG.ST'; // Swedbank Robur Technology A, ISIN SE0000538944
const CACHE_TTL_SECONDS = 12 * 60 * 60; // 12h edge cache; client also caches 24h

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const { cookie, crumb } = await getCookieAndCrumb();

    const summaryUrl =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${YAHOO_FUND_SYMBOL}` +
      `?modules=topHoldings&crumb=${encodeURIComponent(crumb)}`;

    const res = await fetch(summaryUrl, {
      headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Yahoo quoteSummary fetch failed: ${res.status}`);

    const data = await res.json();
    const raw = data?.quoteSummary?.result?.[0]?.topHoldings?.holdings;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error('Yahoo returned no top holdings - response shape may have changed');
    }

    const holdings = raw
      .map((h) => ({
        name: h.holdingName,
        ticker: h.symbol,
        weightPct: (h.holdingPercent?.raw ?? 0) * 100,
      }))
      .filter((h) => h.ticker && h.weightPct > 0);

    if (holdings.length === 0) throw new Error('Parsed zero usable holdings from Yahoo response');

    const parsed = {
      asOfDate: new Date().toISOString().slice(0, 10),
      fetchedAt: new Date().toISOString(),
      holdings,
    };

    const response = new Response(JSON.stringify(parsed), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
        'Access-Control-Allow-Origin': '*',
      },
    });
    await cache.put(cacheKey, response.clone());
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: `Holdings fetch failed: ${err.message}` }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Yahoo's quoteSummary endpoint requires a session cookie plus a matching
 * "crumb" token. Both are obtained fresh on every cold (uncached) request:
 * a throwaway request to fc.yahoo.com to receive a session cookie, then a
 * request to Yahoo's own getcrumb endpoint using that cookie.
 */
async function getCookieAndCrumb() {
  const cookieRes = await fetch('https://fc.yahoo.com', {
    redirect: 'manual',
    headers: { 'User-Agent': UA },
  });
  const setCookie = cookieRes.headers.get('set-cookie');
  if (!setCookie) throw new Error('Yahoo did not return a session cookie');
  const cookie = setCookie.split(';')[0];

  const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: cookie },
    signal: AbortSignal.timeout(8000),
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 50 || crumb.includes('<')) {
    throw new Error('Yahoo did not return a usable crumb');
  }
  return { cookie, crumb };
}
