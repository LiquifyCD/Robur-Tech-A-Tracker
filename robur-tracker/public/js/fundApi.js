import { cache } from './cache.js';

const FUND_TTL_MS = 15 * 60 * 1000;

async function requestJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || body.error || `Request failed (${response.status})`);
  return body;
}

export async function searchFunds(query = '') {
  return requestJson(`/api/funds?q=${encodeURIComponent(query.trim())}`);
}

export async function getFund(symbol, range = '1y', options = {}) {
  const key = `fund:${symbol}:${range}`;
  if (!options.forceRefresh) {
    const fresh = cache.get(key);
    if (fresh && !fresh.stale) return { data: fresh.value, cached: true, stale: false };
  }

  try {
    const data = await requestJson(`/api/fund?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`);
    cache.set(key, data, FUND_TTL_MS);
    return { data, cached: false, stale: false };
  } catch (error) {
    const fallback = cache.get(key, { allowStale: true });
    if (fallback) return { data: fallback.value, cached: true, stale: true, error };
    throw error;
  }
}

export async function getContributors(symbol, options = {}) {
  const key = `contributors:${symbol}`;
  if (!options.forceRefresh) {
    const fresh = cache.get(key);
    if (fresh && !fresh.stale) return { data: fresh.value, cached: true, stale: false };
  }

  try {
    const data = await requestJson(`/api/contributors?symbol=${encodeURIComponent(symbol)}`);
    cache.set(key, data, FUND_TTL_MS);
    return { data, cached: false, stale: false };
  } catch (error) {
    const fallback = cache.get(key, { allowStale: true });
    if (fallback) return { data: fallback.value, cached: true, stale: true, error };
    throw error;
  }
}
