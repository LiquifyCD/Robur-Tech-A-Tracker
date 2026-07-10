const SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const CACHE_TTL_SECONDS = 15 * 60;
const USER_AGENT =
  'Mozilla/5.0 (compatible; FundScope/2.0; +https://github.com/LiquifyCD/Robur-Tech-A-Tracker)';

export const FEATURED_FUNDS = [
  {
    symbol: '0P00000LCG.ST',
    name: 'Swedbank Robur Technology A',
    exchange: 'Stockholm',
    currency: 'SEK',
    isin: 'SE0000538944',
    type: 'MUTUALFUND',
  },
  {
    symbol: '0P0001P0J4.ST',
    name: 'Swedbank Robur Sverige J',
    exchange: 'Stockholm',
    currency: 'SEK',
    isin: null,
    type: 'MUTUALFUND',
  },
  {
    symbol: '0P00000LCZ.ST',
    name: 'Swedbank Robur Exportfond A',
    exchange: 'Stockholm',
    currency: 'SEK',
    isin: null,
    type: 'MUTUALFUND',
  },
];

/** Convert the upstream payload into the deliberately small public contract. */
export function normaliseSearchResults(payload) {
  const seen = new Set();
  return (payload?.quotes || [])
    .filter((quote) => quote?.quoteType === 'MUTUALFUND')
    .map((quote) => ({
      symbol: String(quote.symbol || '').trim(),
      name: String(quote.longname || quote.shortname || quote.symbol || '').trim(),
      exchange: String(quote.exchDisp || quote.exchange || '').trim() || null,
      currency: quote.currency || null,
      isin: null,
      type: 'MUTUALFUND',
    }))
    .filter((fund) => fund.symbol && fund.name && !seen.has(fund.symbol) && seen.add(fund.symbol))
    .slice(0, 12);
}

export async function onRequestGet({ request, ctx }) {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').trim();

  if (query.length > 80) return json({ error: 'Search query is too long.' }, 400);
  if (!query) {
    return json({ funds: FEATURED_FUNDS, query: '', provider: providerMeta() }, 200, 3600);
  }
  if (query.length < 2) return json({ funds: [], query, provider: providerMeta() });

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const upstream = new URL(SEARCH_URL);
    upstream.searchParams.set('q', query);
    upstream.searchParams.set('quotesCount', '16');
    upstream.searchParams.set('newsCount', '0');
    upstream.searchParams.set('enableFuzzyQuery', 'false');

    const response = await fetch(upstream, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Search provider returned ${response.status}`);

    const funds = normaliseSearchResults(await response.json());
    const featuredMatch = FEATURED_FUNDS.find(
      (fund) => fund.isin === query.toUpperCase() || fund.symbol === query.toUpperCase()
    );
    if (featuredMatch && !funds.some((fund) => fund.symbol === featuredMatch.symbol)) {
      funds.unshift(featuredMatch);
    }

    const result = json({ funds, query, provider: providerMeta() }, 200, CACHE_TTL_SECONDS);
    ctx?.waitUntil(cache.put(cacheKey, result.clone()));
    return result;
  } catch (error) {
    return json(
      {
        error: 'Fund search is temporarily unavailable.',
        detail: error.message,
        funds: FEATURED_FUNDS.filter((fund) =>
          `${fund.name} ${fund.symbol} ${fund.isin || ''}`.toLowerCase().includes(query.toLowerCase())
        ),
        query,
        provider: providerMeta('unavailable'),
      },
      502
    );
  }
}

function providerMeta(status = 'available') {
  return {
    id: 'yahoo-finance-unofficial',
    label: 'Yahoo Finance',
    status,
    terms: 'Unofficial, undocumented endpoint; availability and permitted use may change.',
  };
}

function json(body, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
