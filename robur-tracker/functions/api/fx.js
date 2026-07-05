/**
 * GET /api/fx?base=SEK&symbols=USD,EUR,TWD
 * ---------------------------------------------------------------------------
 * Proxies the free, keyless Frankfurter exchange-rate API
 * (https://www.frankfurter.dev) so the browser never needs to talk to a
 * third-party domain directly (avoids CORS and lets us set our own
 * cache headers).
 *
 * Frankfurter is backed by the European Central Bank's daily reference
 * rates - fine for converting daily stock returns into SEK, since FX
 * moves far more slowly than the equities we're tracking.
 *
 * Cached at Cloudflare's edge for 1 hour: FX doesn't need to be fresher
 * than that for this use case, and it keeps our usage of the upstream
 * API minimal per the "Efficient API usage" requirement.
 * ---------------------------------------------------------------------------
 */

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const base = url.searchParams.get('base') || 'SEK';
  const symbols = url.searchParams.get('symbols') || '';

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const upstreamUrl = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(base)}${
      symbols ? `&symbols=${encodeURIComponent(symbols)}` : ''
    }`;
    const upstreamRes = await fetch(upstreamUrl);
    if (!upstreamRes.ok) {
      return jsonError(`Upstream FX provider returned ${upstreamRes.status}`, 502);
    }
    const data = await upstreamRes.json();

    const response = new Response(
      JSON.stringify({ date: data.date, base: data.base, rates: data.rates }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
    await cache.put(cacheKey, response.clone());
    return response;
  } catch (err) {
    return jsonError(`FX proxy failed: ${err.message}`, 502);
  }
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
