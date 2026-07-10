const QUOTE_SUMMARY_URL = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/';
const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const CACHE_TTL_SECONDS = 15 * 60;
const HOLDINGS_CACHE_TTL_SECONDS = 12 * 60 * 60;
const SAFE_SYMBOL = /^[A-Za-z0-9.^=_-]{1,32}$/;
const USER_AGENT =
  'Mozilla/5.0 (compatible; FundScope/2.0; +https://github.com/LiquifyCD/Robur-Tech-A-Tracker)';

/**
 * Convert either a decimal weight (0.10) or a percentage weight (10) to
 * percentage points. A provider-formatted percentage wins when available.
 */
export function normaliseWeightPct(value, formatted = null) {
  if (typeof formatted === 'string' && formatted.includes('%')) {
    const parsed = Number(formatted.replace('%', '').replace(',', '.').trim());
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) return parsed;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric <= 1) return numeric * 100;
  if (numeric <= 100) return numeric;
  return null;
}

export function calculateContribution(dayChangePct, weightPct) {
  if (!Number.isFinite(dayChangePct) || !Number.isFinite(weightPct)) return null;
  return (dayChangePct * weightPct) / 100;
}

function stableNumber(value) {
  return Number(value.toFixed(12));
}

export function parseHoldings(payload) {
  const raw = payload?.quoteSummary?.result?.[0]?.topHoldings?.holdings;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((holding) => ({
      name: String(holding?.holdingName || holding?.symbol || '').trim(),
      ticker: String(holding?.symbol || '').trim(),
      weightPct: normaliseWeightPct(holding?.holdingPercent?.raw, holding?.holdingPercent?.fmt),
    }))
    .filter((holding) => holding.name && holding.ticker && holding.weightPct != null && holding.weightPct > 0);
}

export function parseDailyQuote(result, requestedSymbol, now = Date.now()) {
  const meta = result?.meta;
  if (!meta) return null;

  const closes = (result?.indicators?.quote?.[0]?.close || []).filter(
    (value) => Number.isFinite(Number(value)) && Number(value) > 0
  );
  const current = Number(meta.regularMarketPrice ?? closes.at(-1));
  const previous = Number(meta.previousClose ?? (closes.length > 1 ? closes.at(-2) : meta.chartPreviousClose));
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;

  const marketTimeSeconds = Number(meta.regularMarketTime);
  const asOf = Number.isFinite(marketTimeSeconds)
    ? new Date(marketTimeSeconds * 1000).toISOString()
    : null;
  const ageHours = asOf ? Math.max(0, (now - new Date(asOf).getTime()) / 3_600_000) : null;

  return {
    requestedSymbol,
    resolvedSymbol: meta.symbol || requestedSymbol,
    price: current,
    previousClose: previous,
    currency: meta.currency || null,
    dayChangePct: ((current - previous) / previous) * 100,
    asOf,
    ageHours,
    stale: ageHours == null || ageHours > 120,
    marketState: meta.marketState || null,
    exchange: meta.fullExchangeName || meta.exchangeName || null,
  };
}

export function buildContributionSummary(holdings, quoteResults, metadata = {}) {
  const quotes = quoteResults instanceof Map
    ? quoteResults
    : new Map(Object.entries(quoteResults || {}));

  const items = holdings.map((holding) => {
    const result = quotes.get(holding.ticker);
    const quote = result?.quote || result || null;
    if (!quote || !Number.isFinite(quote.dayChangePct)) {
      return {
        ...holding,
        status: 'missing',
        reason: result?.reason || 'Dagsdata saknas hos dataleverantören.',
        dayChangePct: null,
        contributionPctPoints: null,
        dataAsOf: null,
        resolvedTicker: result?.resolvedSymbol || null,
      };
    }

    return {
      ...holding,
      status: quote.stale ? 'stale' : 'available',
      reason: quote.stale ? 'Senaste dagsdata är äldre än fem dygn.' : null,
      dayChangePct: quote.dayChangePct,
      contributionPctPoints: calculateContribution(quote.dayChangePct, holding.weightPct),
      dataAsOf: quote.asOf,
      resolvedTicker: quote.resolvedSymbol || holding.ticker,
      currency: quote.currency,
      marketState: quote.marketState,
    };
  });

  const withContribution = items.filter((item) => Number.isFinite(item.contributionPctPoints));
  const winners = withContribution
    .filter((item) => item.contributionPctPoints > 0)
    .sort((a, b) => b.contributionPctPoints - a.contributionPctPoints);
  const losers = withContribution
    .filter((item) => item.contributionPctPoints < 0)
    .sort((a, b) => a.contributionPctPoints - b.contributionPctPoints);
  const unchanged = withContribution.filter((item) => item.contributionPctPoints === 0);
  const unavailable = items.filter((item) => !Number.isFinite(item.contributionPctPoints));
  const positivePctPoints = stableNumber(winners.reduce((sum, item) => sum + item.contributionPctPoints, 0));
  const negativePctPoints = stableNumber(losers.reduce((sum, item) => sum + item.contributionPctPoints, 0));

  const dates = items
    .map((item) => item.dataAsOf && new Date(item.dataAsOf).getTime())
    .filter(Number.isFinite);

  return {
    items,
    winners,
    losers,
    unchanged,
    unavailable,
    summary: {
      positivePctPoints,
      negativePctPoints,
      netPctPoints: stableNumber(positivePctPoints + negativePctPoints),
      disclosedCoveragePct: holdings.reduce((sum, holding) => sum + holding.weightPct, 0),
      calculatedCoveragePct: withContribution.reduce((sum, item) => sum + item.weightPct, 0),
      holdingsCount: holdings.length,
      availableCount: withContribution.length,
    },
    latestDataAt: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    ...metadata,
  };
}

export async function onRequestGet({ request, ctx }) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || '').trim();
  if (!SAFE_SYMBOL.test(symbol)) return json({ error: 'A valid fund symbol is required.' }, 400);

  const cache = caches.default;
  const responseCacheKey = new Request(
    `${url.origin}${url.pathname}?symbol=${encodeURIComponent(symbol)}`,
    request
  );
  const cached = await cache.match(responseCacheKey);
  if (cached) return cached;

  try {
    const holdingsPayload = await getHoldings(symbol, url.origin, cache, ctx);
    if (!holdingsPayload.holdings.length) {
      return json(
        {
          error: 'Innehavsdata saknas för den här fonden.',
          code: 'HOLDINGS_UNAVAILABLE',
          symbol,
        },
        404
      );
    }

    const settled = await Promise.all(
      holdingsPayload.holdings.map(async (holding) => {
        try {
          const quote = await fetchHoldingQuote(holding.ticker, symbol);
          return [
            holding.ticker,
            quote
              ? { quote }
              : { reason: 'Ingen användbar dagskurs hittades för innehavets ticker.' },
          ];
        } catch (error) {
          return [holding.ticker, { reason: `Dagsdata kunde inte hämtas: ${error.message}` }];
        }
      })
    );

    const contributionData = buildContributionSummary(
      holdingsPayload.holdings,
      new Map(settled),
      {
        fundSymbol: symbol,
        holdingsAsOf: holdingsPayload.asOf,
        holdingsFetchedAt: holdingsPayload.fetchedAt,
        calculatedAt: new Date().toISOString(),
        source: {
          id: 'yahoo-finance-unofficial',
          label: 'Yahoo Finance',
          delayed: true,
          scope: 'Redovisade toppinnehav, inte hela fondportföljen',
        },
      }
    );

    const response = json(contributionData, 200, CACHE_TTL_SECONDS);
    ctx?.waitUntil(cache.put(responseCacheKey, response.clone()));
    return response;
  } catch (error) {
    return json(
      {
        error: 'Bidragsdata är tillfälligt otillgänglig.',
        detail: error.message,
        symbol,
      },
      502
    );
  }
}

async function getHoldings(symbol, origin, cache, ctx) {
  const cacheKey = new Request(
    `${origin}/api/_holdings-cache?symbol=${encodeURIComponent(symbol)}`
  );
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  const { cookie, crumb } = await getCookieAndCrumb();
  const upstream =
    `${QUOTE_SUMMARY_URL}${encodeURIComponent(symbol)}` +
    `?modules=topHoldings&crumb=${encodeURIComponent(crumb)}`;
  const response = await fetch(upstream, {
    headers: { Accept: 'application/json', Cookie: cookie, 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Holdings provider returned ${response.status}`);

  const holdings = parseHoldings(await response.json());
  const payload = {
    holdings,
    asOf: null,
    fetchedAt: new Date().toISOString(),
  };
  if (holdings.length) {
    const cachedResponse = json(payload, 200, HOLDINGS_CACHE_TTL_SECONDS);
    ctx?.waitUntil(cache.put(cacheKey, cachedResponse));
  }
  return payload;
}

async function getCookieAndCrumb() {
  const cookieResponse = await fetch('https://fc.yahoo.com', {
    redirect: 'manual',
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(8_000),
  });
  const cookie = cookieResponse.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Holdings provider did not return a session cookie');

  const crumbResponse = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { Cookie: cookie, 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(8_000),
  });
  const crumb = (await crumbResponse.text()).trim();
  if (!crumbResponse.ok || !crumb || crumb.length > 50 || crumb.includes('<')) {
    throw new Error('Holdings provider did not return a usable session token');
  }
  return { cookie, crumb };
}

async function fetchHoldingQuote(rawSymbol, fundSymbol) {
  const candidates = quoteCandidates(rawSymbol, fundSymbol);
  for (const candidate of candidates) {
    const response = await fetch(
      `${CHART_URL}${encodeURIComponent(candidate)}?range=5d&interval=1d`,
      {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(8_000),
      }
    );
    if (!response.ok) continue;
    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    const parsed = parseDailyQuote(result, rawSymbol);
    if (parsed) return parsed;
  }
  return null;
}

function quoteCandidates(rawSymbol, fundSymbol) {
  const symbol = String(rawSymbol || '').trim();
  const candidates = [symbol];
  if (symbol.includes(' ')) {
    const dashed = symbol.replace(/\s+/g, '-');
    if (fundSymbol.endsWith('.ST')) candidates.push(`${dashed}.ST`);
    candidates.push(dashed);
  }
  return [...new Set(candidates.filter(Boolean))];
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
