const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const CACHE_TTL_SECONDS = 15 * 60;
const ALLOWED_RANGES = new Set(['1mo', '3mo', '6mo', 'ytd', '1y', '2y', '5y', '10y', 'max']);
const SAFE_SYMBOL = /^[A-Za-z0-9.^=_-]{1,32}$/;
const USER_AGENT =
  'Mozilla/5.0 (compatible; FundScope/2.0; +https://github.com/LiquifyCD/Robur-Tech-A-Tracker)';

export function parseFundChart(result, now = Date.now()) {
  if (!result?.meta || !Array.isArray(result.timestamp)) {
    throw new Error('The data provider returned an unexpected response.');
  }

  const values = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
  const points = result.timestamp
    .map((seconds, index) => ({ t: seconds * 1000, v: Number(values[index]) }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.v) && point.v > 0);

  if (!points.length) throw new Error('No reported fund values were returned for this period.');

  const first = points[0];
  const latest = points.at(-1);
  const previous = points.at(-2) || latest;
  const ageHours = Math.max(0, (now - latest.t) / 3_600_000);
  const stale = ageHours > 120;

  return {
    fund: {
      symbol: result.meta.symbol,
      name: result.meta.longName || result.meta.shortName || result.meta.symbol,
      currency: result.meta.currency || null,
      exchange: result.meta.fullExchangeName || result.meta.exchangeName || null,
      instrumentType: result.meta.instrumentType || 'MUTUALFUND',
      timezone: result.meta.exchangeTimezoneName || null,
    },
    latest: {
      value: latest.v,
      asOf: new Date(latest.t).toISOString(),
      previousValue: previous.v,
      dayChangePct: percentChange(previous.v, latest.v),
      ageHours,
      stale,
      status: stale ? 'stale' : 'reported',
    },
    period: {
      startValue: first.v,
      endValue: latest.v,
      changePct: percentChange(first.v, latest.v),
      high: Math.max(...points.map((point) => point.v)),
      low: Math.min(...points.map((point) => point.v)),
      points: points.length,
    },
    history: points,
    source: {
      id: 'yahoo-finance-unofficial',
      label: 'Yahoo Finance',
      delayed: true,
      valueType: 'Reported fund value / NAV proxy',
      terms: 'Unofficial, undocumented endpoint; verify values with the fund company before acting.',
    },
  };
}

export function percentChange(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null;
  return ((to - from) / from) * 100;
}

export async function onRequestGet({ request, ctx }) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || '').trim();
  const range = ALLOWED_RANGES.has(url.searchParams.get('range')) ? url.searchParams.get('range') : '1y';

  if (!SAFE_SYMBOL.test(symbol)) return json({ error: 'A valid fund symbol is required.' }, 400);

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}${url.pathname}?symbol=${encodeURIComponent(symbol)}&range=${range}`, request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const upstream = `${CHART_URL}${encodeURIComponent(symbol)}?range=${range}&interval=1d&events=div%2Csplits`;
    const response = await fetch(upstream, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Fund data provider returned ${response.status}`);
    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    if (!result) throw new Error(payload?.chart?.error?.description || 'Fund was not found.');

    const output = json({ ...parseFundChart(result), range }, 200, CACHE_TTL_SECONDS);
    ctx?.waitUntil(cache.put(cacheKey, output.clone()));
    return output;
  } catch (error) {
    return json({ error: 'Fund data is temporarily unavailable.', detail: error.message }, 502);
  }
}

function json(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': maxAge ? `public, max-age=${maxAge}, stale-if-error=86400` : 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
