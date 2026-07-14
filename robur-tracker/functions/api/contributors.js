const QUOTE_SUMMARY_URL = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/';
const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const ROBUR_HOLDINGS_URL = 'https://tmsapi.auxality.systems/dataaccess/RoburConnection/fundWithHoldings';
const CACHE_TTL_SECONDS = 15 * 60;
const HOLDINGS_CACHE_TTL_SECONDS = 12 * 60 * 60;
const MAX_QUOTED_HOLDINGS = 44;
const SAFE_SYMBOL = /^[A-Za-z0-9.^=_-]{1,32}$/;
const SAFE_ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const USER_AGENT =
  'Mozilla/5.0 (compatible; FundScope/2.0; +https://github.com/LiquifyCD/Robur-Tech-A-Tracker)';

const ROBUR_TICKERS = new Map(Object.entries({
  'advanced micro devices inc': 'AMD',
  'alphabet inc': 'GOOGL',
  'amazon.com inc': 'AMZN',
  'amphenol corp': 'APH',
  'analog devices inc': 'ADI',
  'apple inc': 'AAPL',
  'applied materials inc': 'AMAT',
  'arista networks inc': 'ANET',
  'asml holding nv': 'ASML.AS',
  'be semiconductor industries nv': 'BESI.AS',
  'bentley systems inc': 'BSY',
  'broadcom inc': 'AVGO',
  'cadence design systems inc': 'CDNS',
  'chroma ate inc': '2360.TW',
  'cloudflare inc': 'NET',
  'credo technology group holding ltd': 'CRDO',
  'datadog inc': 'DDOG',
  'delta electronics inc': '2308.TW',
  'fortinet': 'FTNT',
  'intel corp': 'INTC',
  'keysight technologies inc': 'KEYS',
  'kioxia holdings corp': '285A.T',
  'kla-tencor corp': 'KLAC',
  'lam research corp': 'LRCX',
  'lumentum holdings inc': 'LITE',
  'manhattan associates inc': 'MANH',
  'marvell technology inc': 'MRVL',
  'meta platforms inc': 'META',
  'micron technology inc': 'MU',
  'microsoft corp': 'MSFT',
  'mongodb inc': 'MDB',
  'motorola solutions inc': 'MSI',
  'netflix inc': 'NFLX',
  'nvidia corp': 'NVDA',
  'oracle corp': 'ORCL',
  'palantir technologies inc': 'PLTR',
  'qualcomm inc': 'QCOM',
  'rambus inc': 'RMBS',
  'seagate technology plc': 'STX',
  'servicenow': 'NOW',
  'snowflake inc': 'SNOW',
  'spotify technology s.a': 'SPOT',
  'taiwan semiconductor manufacturing company, ltd.': '2330.TW',
  'veeva systems inc': 'VEEV',
}));

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

export function calculateCurrencyAdjustedChange(localChangePct, fxChangePct) {
  if (!Number.isFinite(localChangePct) || !Number.isFinite(fxChangePct)) return null;
  return (((1 + localChangePct / 100) * (1 + fxChangePct / 100)) - 1) * 100;
}

function stableNumber(value) {
  return Number(value.toFixed(12));
}

export function parseHoldings(payload) {
  const raw = payload?.quoteSummary?.result?.[0]?.topHoldings?.holdings;
  if (!Array.isArray(raw)) return [];

  return dedupeHoldings(raw
    .map((holding) => ({
      name: String(holding?.holdingName || holding?.symbol || '').trim(),
      ticker: String(holding?.symbol || '').trim(),
      weightPct: normaliseWeightPct(holding?.holdingPercent?.raw, holding?.holdingPercent?.fmt),
    }))
    .filter((holding) => holding.name && holding.ticker && holding.weightPct != null && holding.weightPct > 0));
}

export function isHoldingsStale(asOf, now = Date.now()) {
  const timestamp = new Date(asOf).getTime();
  return !Number.isFinite(timestamp) || now - timestamp > 45 * 24 * 60 * 60 * 1000;
}

export function parseRoburHoldings(payload, fundCurrency = 'SEK') {
  const raw = Array.isArray(payload?.holdings) ? payload.holdings : [];
  const equities = raw
    .map((holding) => {
      const name = String(holding?.name || '').trim();
      const weightPct = officialWeightPct(holding?.weight);
      return {
        name,
        ticker: ROBUR_TICKERS.get(normaliseName(name)) || null,
        weightPct,
        kind: 'equity',
        country: holding?.country || null,
      };
    })
    .filter((holding) => holding.name && holding.weightPct != null && holding.weightPct > 0);
  const cashWeightPct = (payload?.sectors || [])
    .filter((sector) => /kassa|bank account/i.test(`${sector?.sector_SE || ''} ${sector?.sector_EN || ''}`))
    .reduce((sum, sector) => sum + (officialWeightPct(sector?.weight) || 0), 0);
  if (cashWeightPct > 0) {
    equities.push({
      name: 'Kassa och övrigt',
      ticker: `CASH:${fundCurrency}`,
      weightPct: cashWeightPct,
      kind: 'cash',
      currency: fundCurrency,
      country: null,
    });
  }
  return dedupeHoldings(equities);
}

function officialWeightPct(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : null;
}

export function dedupeHoldings(holdings) {
  const unique = new Map();
  for (const holding of holdings || []) {
    const key = holding.ticker || normaliseName(holding.name);
    if (!key) continue;
    const current = unique.get(key);
    if (!current || holding.weightPct > current.weightPct) unique.set(key, holding);
  }
  return [...unique.values()];
}

function normaliseName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Retained for the provider-adapter contract and previous-close unit coverage.
export function parseDailyQuote(result, requestedSymbol, now = Date.now()) {
  const meta = result?.meta;
  if (!meta) return null;
  const closes = (result?.indicators?.quote?.[0]?.close || [])
    .filter((value) => Number.isFinite(Number(value)) && Number(value) > 0);
  const current = Number(meta.regularMarketPrice ?? closes.at(-1));
  const previous = Number(meta.previousClose ?? (closes.length > 1 ? closes.at(-2) : meta.chartPreviousClose));
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;

  const marketTimeSeconds = Number(meta.regularMarketTime);
  const asOf = Number.isFinite(marketTimeSeconds) ? new Date(marketTimeSeconds * 1000).toISOString() : null;
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

export function parseQuoteSinceNav(result, requestedSymbol, navAsOf, now = Date.now()) {
  const meta = result?.meta;
  const navTime = new Date(navAsOf).getTime();
  if (!meta || !Number.isFinite(navTime)) return null;

  const closes = result?.indicators?.quote?.[0]?.close || [];
  const points = (result?.timestamp || [])
    .map((seconds, index) => ({ t: Number(seconds) * 1000, value: Number(closes[index]) }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.value) && point.value > 0);
  const navDate = new Date(navTime).toISOString().slice(0, 10);
  const baseline = points.filter((point) => new Date(point.t).toISOString().slice(0, 10) <= navDate).at(-1);
  if (!baseline) return null;

  const marketTimeSeconds = Number(meta.regularMarketTime);
  const livePrice = Number(meta.regularMarketPrice);
  const latestPoint = points.at(-1);
  const current = Number.isFinite(livePrice) && livePrice > 0 ? livePrice : latestPoint?.value;
  const currentTime = Number.isFinite(marketTimeSeconds) ? marketTimeSeconds * 1000 : latestPoint?.t;
  if (!Number.isFinite(current) || !Number.isFinite(currentTime)) return null;

  const asOf = new Date(currentTime).toISOString();
  const ageHours = Math.max(0, (now - currentTime) / 3_600_000);
  return {
    requestedSymbol,
    resolvedSymbol: meta.symbol || requestedSymbol,
    price: current,
    baselinePrice: baseline.value,
    baselineAsOf: new Date(baseline.t).toISOString(),
    currency: meta.currency || null,
    dayChangePct: ((current - baseline.value) / baseline.value) * 100,
    asOf,
    ageHours,
    stale: ageHours > 120,
    marketState: meta.marketState || null,
    exchange: meta.fullExchangeName || meta.exchangeName || null,
  };
}

export function buildContributionSummary(holdings, quoteResults, metadata = {}, fxResults = {}) {
  const quotes = quoteResults instanceof Map ? quoteResults : new Map(Object.entries(quoteResults || {}));
  const fxQuotes = fxResults instanceof Map ? fxResults : new Map(Object.entries(fxResults || {}));
  const fundCurrency = metadata.fundCurrency || metadata.baseline?.currency || null;

  const items = holdings.map((holding) => {
    const result = quotes.get(holding.ticker || normaliseName(holding.name));
    const quote = result?.quote || result || null;
    if (!quote || !Number.isFinite(quote.dayChangePct)) {
      return {
        ...holding,
        status: 'missing',
        reason: result?.reason || 'Dagsdata saknas hos dataleverantören.',
        localDayChangePct: null,
        dayChangePct: null,
        contributionPctPoints: null,
        dataAsOf: null,
        baselineAsOf: null,
        resolvedTicker: null,
        fxPair: null,
        fxChangePct: null,
        fxDataAsOf: null,
      };
    }

    const baseItem = {
      ...holding,
      localDayChangePct: quote.dayChangePct,
      dataAsOf: quote.asOf,
      baselineAsOf: quote.baselineAsOf || null,
      resolvedTicker: quote.resolvedSymbol || holding.ticker,
      currency: quote.currency,
      marketState: quote.marketState,
      fxPair: null,
      fxChangePct: null,
      fxDataAsOf: null,
    };

    if (quote.stale) {
      return {
        ...baseItem,
        status: 'stale',
        reason: 'Senaste kursdata är äldre än fem dygn och ingår inte i uppskattningen.',
        dayChangePct: null,
        contributionPctPoints: null,
      };
    }

    let adjustedChangePct = quote.dayChangePct;
    if (fundCurrency) {
      if (!quote.currency) {
        return {
          ...baseItem,
          status: 'missing-currency',
          reason: 'Innehavets valuta saknas och bidraget kan inte räknas till fondens valuta.',
          dayChangePct: null,
          contributionPctPoints: null,
        };
      }
      if (quote.currency !== fundCurrency) {
        const pair = `${quote.currency}${fundCurrency}=X`;
        const fxResult = fxQuotes.get(pair);
        const fxQuote = fxResult?.quote || fxResult || null;
        if (!fxQuote || !Number.isFinite(fxQuote.dayChangePct)) {
          return {
            ...baseItem,
            fxPair: pair,
            status: 'missing-fx',
            reason: fxResult?.reason || `Valutadata för ${quote.currency}/${fundCurrency} saknas; innehavet ingår inte i uppskattningen.`,
            dayChangePct: null,
            contributionPctPoints: null,
          };
        }
        if (fxQuote.stale) {
          return {
            ...baseItem,
            fxPair: pair,
            fxChangePct: fxQuote.dayChangePct,
            fxDataAsOf: fxQuote.asOf,
            status: 'stale-fx',
            reason: `Valutakursen ${quote.currency}/${fundCurrency} är äldre än fem dygn och ingår inte i uppskattningen.`,
            dayChangePct: null,
            contributionPctPoints: null,
          };
        }
        adjustedChangePct = calculateCurrencyAdjustedChange(quote.dayChangePct, fxQuote.dayChangePct);
        baseItem.fxPair = pair;
        baseItem.fxChangePct = fxQuote.dayChangePct;
        baseItem.fxDataAsOf = fxQuote.asOf;
      }
    }

    return {
      ...baseItem,
      status: 'available',
      reason: null,
      dayChangePct: adjustedChangePct,
      contributionPctPoints: calculateContribution(adjustedChangePct, holding.weightPct),
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
  const disclosedCoveragePct = stableNumber(holdings.reduce((sum, holding) => sum + holding.weightPct, 0));
  const calculatedCoveragePct = stableNumber(withContribution.reduce((sum, item) => sum + item.weightPct, 0));
  const dates = items
    .flatMap((item) => [item.dataAsOf, item.fxDataAsOf])
    .map((date) => date && new Date(date).getTime())
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
      disclosedCoveragePct,
      undisclosedWeightPct: stableNumber(Math.max(0, 100 - disclosedCoveragePct)),
      calculatedCoveragePct,
      uncalculatedWeightPct: stableNumber(Math.max(0, 100 - calculatedCoveragePct)),
      isPartial: calculatedCoveragePct < 99.5,
      scaledToFullPortfolio: false,
      holdingsCount: holdings.length,
      availableCount: withContribution.length,
      foreignCurrencyCount: items.filter((item) => item.fxPair).length,
      currencyAdjustedCount: withContribution.filter((item) => item.fxPair).length,
    },
    latestDataAt: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    ...metadata,
  };
}

export async function onRequestGet({ request, ctx }) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || '').trim();
  const isin = (url.searchParams.get('isin') || '').trim().toUpperCase();
  const navAsOf = (url.searchParams.get('navAsOf') || '').trim();
  const fundCurrency = (url.searchParams.get('currency') || '').trim().toUpperCase();
  if (!SAFE_SYMBOL.test(symbol)) return json({ error: 'A valid fund symbol is required.' }, 400);
  if (isin && !SAFE_ISIN.test(isin)) return json({ error: 'A valid ISIN is required.' }, 400);
  if (!Number.isFinite(new Date(navAsOf).getTime())) return json({ error: 'A valid latest NAV date is required.' }, 400);
  if (!/^[A-Z]{3}$/.test(fundCurrency)) return json({ error: 'A valid three-letter fund currency is required.' }, 400);

  const cache = caches.default;
  const responseCacheKey = new Request(
    `${url.origin}${url.pathname}?symbol=${encodeURIComponent(symbol)}&isin=${encodeURIComponent(isin)}&navAsOf=${encodeURIComponent(navAsOf)}&currency=${fundCurrency}`,
    request
  );
  const cached = await cache.match(responseCacheKey);
  if (cached) return cached;

  try {
    const holdingsPayload = await getHoldings(symbol, isin, fundCurrency, url.origin, cache, ctx);
    if (!holdingsPayload.holdings.length) {
      return json({ error: 'Innehavsdata saknas för den här fonden.', code: 'HOLDINGS_UNAVAILABLE', symbol }, 404);
    }

    const quotedTickers = new Set(holdingsPayload.holdings
      .filter((holding) => holding.ticker && holding.kind !== 'cash')
      .sort((a, b) => b.weightPct - a.weightPct)
      .slice(0, MAX_QUOTED_HOLDINGS)
      .map((holding) => holding.ticker));
    const settled = await Promise.all(holdingsPayload.holdings.map(async (holding) => {
      if (!holding.ticker || holding.kind === 'cash') {
        return [holding.ticker || normaliseName(holding.name), {
          reason: holding.kind === 'cash'
            ? 'Kassa och övrigt kan inte prissättas tillförlitligt som en enskild marknadsposition.'
            : 'Innehavet saknar en entydig noterad ticker och ingår inte i uppskattningen.',
        }];
      }
      if (!quotedTickers.has(holding.ticker)) {
        return [holding.ticker, { reason: 'Innehavet ryms inte inom datakällans säkra anropsgräns och ingår inte i uppskattningen.' }];
      }
      try {
        const quote = await fetchHoldingQuote(holding.ticker, symbol, navAsOf);
        return [holding.ticker, quote ? { quote } : { reason: 'Ingen användbar kurs hittades sedan senaste NAV.' }];
      } catch (error) {
        return [holding.ticker, { reason: `Kursdata kunde inte hämtas: ${error.message}` }];
      }
    }));

    const quoteMap = new Map(settled);
    const fxPairs = [...new Set(settled
      .map(([, result]) => result?.quote?.currency)
      .filter((currency) => currency && currency !== fundCurrency)
      .map((currency) => `${currency}${fundCurrency}=X`))];
    const fxSettled = await Promise.all(fxPairs.map(async (pair) => {
      try {
        const quote = await fetchChartQuote(pair, pair, navAsOf);
        return [pair, quote ? { quote } : { reason: `Ingen användbar valutadata hittades för ${pair}.` }];
      } catch (error) {
        return [pair, { reason: `Valutadata kunde inte hämtas: ${error.message}` }];
      }
    }));

    const contributionData = buildContributionSummary(
      holdingsPayload.holdings,
      quoteMap,
      {
        fundSymbol: symbol,
        fundCurrency,
        baseline: { navAsOf, currency: fundCurrency },
        holdingsAsOf: holdingsPayload.asOf,
        holdingsStale: isHoldingsStale(holdingsPayload.asOf),
        holdingsFetchedAt: holdingsPayload.fetchedAt,
        calculatedAt: new Date().toISOString(),
        source: {
          id: holdingsPayload.source.id,
          label: holdingsPayload.source.label,
          delayed: true,
          scope: holdingsPayload.source.scope,
        },
      },
      new Map(fxSettled)
    );

    const response = json(contributionData, 200, CACHE_TTL_SECONDS);
    ctx?.waitUntil(cache.put(responseCacheKey, response.clone()));
    return response;
  } catch (error) {
    return json({ error: 'Bidragsdata är tillfälligt otillgänglig.', detail: error.message, symbol }, 502);
  }
}

async function getHoldings(symbol, isin, fundCurrency, origin, cache, ctx) {
  const cacheKey = new Request(`${origin}/api/_holdings-cache?symbol=${encodeURIComponent(symbol)}&isin=${encodeURIComponent(isin)}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  if (isin) {
    try {
      const response = await fetch(`${ROBUR_HOLDINGS_URL}?isin=${encodeURIComponent(isin)}&total=1000`, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const data = await response.json();
        const holdings = parseRoburHoldings(data, fundCurrency);
        if (holdings.length) {
          const payload = {
            holdings,
            asOf: data.updated || null,
            fetchedAt: new Date().toISOString(),
            source: {
              id: 'swedbank-robur-holdings-yahoo-quotes',
              label: 'Swedbank Robur (innehav) + Yahoo Finance (kurser)',
              scope: 'Officiellt redovisade innehav och kassa/övrigt; ej uppräknat',
            },
          };
          const cachedResponse = json(payload, 200, HOLDINGS_CACHE_TTL_SECONDS);
          ctx?.waitUntil(cache.put(cacheKey, cachedResponse));
          return payload;
        }
      }
    } catch {
      // The general adapter below keeps other funds usable if this source is unavailable.
    }
  }

  const { cookie, crumb } = await getCookieAndCrumb();
  const upstream = `${QUOTE_SUMMARY_URL}${encodeURIComponent(symbol)}?modules=topHoldings&crumb=${encodeURIComponent(crumb)}`;
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
    source: {
      id: 'yahoo-finance-unofficial',
      label: 'Yahoo Finance',
      scope: 'Redovisade toppinnehav, inte hela fondportföljen',
    },
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

async function fetchHoldingQuote(rawSymbol, fundSymbol, navAsOf) {
  for (const candidate of quoteCandidates(rawSymbol, fundSymbol)) {
    const parsed = await fetchChartQuote(candidate, rawSymbol, navAsOf);
    if (parsed) return parsed;
  }
  return null;
}

async function fetchChartQuote(symbol, requestedSymbol, navAsOf) {
  const response = await fetch(`${CHART_URL}${encodeURIComponent(symbol)}?range=1mo&interval=1d`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return parseQuoteSinceNav(payload?.chart?.result?.[0], requestedSymbol, navAsOf);
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
