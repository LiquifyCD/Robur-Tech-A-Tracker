/**
 * GET /api/quotes?symbols=NVDA,AVGO,MSFT
 * ---------------------------------------------------------------------------
 * Proxies Yahoo Finance's unofficial "chart" endpoint to fetch current
 * price + previous close + currency for a batch of tickers.
 *
 * WHY THE "CHART" ENDPOINT AND NOT "QUOTE":
 * Yahoo's older /v7/finance/quote endpoint (real-time quote batches) now
 * requires a crumb/cookie handshake that's brittle to run from a stateless
 * edge function. The /v8/finance/chart/{symbol} endpoint that powers
 * Yahoo's own charts does NOT require that handshake and exposes
 * everything we need in its `meta` object - at the cost of one request
 * per symbol instead of one request per batch.
 *
 * This IS an unofficial, undocumented API. It can change shape or start
 * rate-limiting at any time - every field access below is defensive, and
 * marketData.js on the client falls back to cached data whenever a
 * symbol comes back empty.
 * ---------------------------------------------------------------------------
 */

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const CACHE_TTL_SECONDS = 10;

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const symbolsParam = url.searchParams.get('symbols') || '';
  const symbols = symbolsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (symbols.length === 0) {
    return jsonError('No symbols provided', 400);
  }

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const results = await Promise.allSettled(symbols.map(fetchSingleQuote));

  const quotes = {};
  results.forEach((result, i) => {
    const symbol = symbols[i];
    if (result.status === 'fulfilled' && result.value) {
      quotes[symbol] = result.value;
    }
  });

  const response = new Response(JSON.stringify({ quotes }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      'Access-Control-Allow-Origin': '*',
    },
  });

  // Only cache at the edge if we got at least something useful, so a
  // total upstream outage doesn't get cached and served for 10s to
  // everyone (better to retry on the next request in that case).
  if (Object.keys(quotes).length > 0) {
    await cache.put(cacheKey, response.clone());
  }
  return response;
}

async function fetchSingleQuote(symbol) {
  const targetUrl = `${YAHOO_BASE}${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const res = await fetch(targetUrl, {
    headers: {
      // Yahoo's edge occasionally blocks requests with no browser-like UA.
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) return null;

  const price = meta.regularMarketPrice ?? null;
  const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
  if (price == null || previousClose == null) return null;

  return {
    symbol,
    price,
    previousClose,
    currency: meta.currency || 'USD',
    marketState: meta.marketState || null,
    exchangeName: meta.exchangeName || null,
    regularMarketTime: meta.regularMarketTime || null,
  };
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
