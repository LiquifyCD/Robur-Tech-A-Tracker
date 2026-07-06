/**
 * holdings.js
 * ---------------------------------------------------------------------------
 * Retrieves the fund's disclosed portfolio holdings.
 *
 * IMPORTANT HONESTY NOTE (surfaced in the UI too, see ui.js):
 * No free public source publishes Swedbank Robur Technology A's FULL,
 * live portfolio. The best available free disclosure is the fund's
 * "top holdings" factsheet, published periodically (monthly-ish) and
 * covering roughly 45-55% of assets by weight. This module fetches that
 * disclosure, normalizes the disclosed weights to sum to 100% *for
 * calculation purposes only*, and always reports the true disclosed
 * coverage % alongside the estimate so nobody mistakes this for a full
 * replication of the fund.
 *
 * Retrieval flow:
 *   1. Try the local 24h cache.
 *   2. If missing/expired, call our Cloudflare Pages Function /api/holdings,
 *      which scrapes the fund's public factsheet server-side (avoids CORS
 *      and keeps scraping logic off the client).
 *   3. If that fails, fall back to the last successfully cached holdings,
 *      however old, and flag the response as stale so the UI can warn
 *      the user with the actual "as of" date.
 *   4. If there is no cache at all (first-ever load with no network),
 *      fall back to a small bundled seed list so the app is never empty.
 * ---------------------------------------------------------------------------
 */

import { cache } from './cache.js';

const CACHE_KEY = 'holdings';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours, per spec
const FUND_ISIN = 'SE0000538944'; // Swedbank Robur Technology A SEK

// Bundled seed data, used ONLY if there is no cache and the live fetch
// fails on a brand-new install (e.g. first load with no connectivity).
// This mirrors a real disclosed top-10 list so the app is functional,
// but is intentionally dated far in the past so the UI's "stale" warning
// always fires until a real fetch succeeds.
const SEED_HOLDINGS = {
  asOfDate: '2000-01-01',
  fetchedAt: null,
  source: 'bundled-seed',
  holdings: [
    { name: 'NVIDIA Corp', ticker: 'NVDA', country: 'USA', sector: 'IT', weightPct: 9.27 },
    { name: 'Broadcom Inc', ticker: 'AVGO', country: 'USA', sector: 'IT', weightPct: 8.42 },
    { name: 'Microsoft Corp', ticker: 'MSFT', country: 'USA', sector: 'IT', weightPct: 7.78 },
    { name: 'Taiwan Semiconductor Manufacturing', ticker: 'TSM', country: 'Taiwan', sector: 'IT', weightPct: 4.76 },
    { name: 'Apple', ticker: 'AAPL', country: 'USA', sector: 'IT', weightPct: 4.71 },
    { name: 'KLA Corp', ticker: 'KLAC', country: 'USA', sector: 'IT', weightPct: 4.55 },
    { name: 'Analog Devices', ticker: 'ADI', country: 'USA', sector: 'IT', weightPct: 4.33 },
    { name: 'Applied Materials', ticker: 'AMAT', country: 'USA', sector: 'IT', weightPct: 3.80 },
    { name: 'Micron Technology', ticker: 'MU', country: 'USA', sector: 'IT', weightPct: 2.92 },
    { name: 'Advanced Micro Devices', ticker: 'AMD', country: 'USA', sector: 'IT', weightPct: 2.51 },
  ],
};

/**
 * Normalize an array of {weightPct, ...} holdings so weights sum to 100,
 * while keeping the original disclosed weight around for display/coverage
 * math. Returns a new array; does not mutate input.
 */
function normalize(holdings) {
  const disclosedTotal = holdings.reduce((sum, h) => sum + h.weightPct, 0);
  return holdings.map((h) => ({
    ...h,
    disclosedWeightPct: h.weightPct,
    normalizedWeightPct: disclosedTotal > 0 ? (h.weightPct / disclosedTotal) * 100 : 0,
  }));
}

function buildPayload(raw, source) {
  const holdings = normalize(raw.holdings);
  const disclosedCoveragePct = raw.holdings.reduce((sum, h) => sum + h.weightPct, 0);
  return {
    isin: FUND_ISIN,
    asOfDate: raw.asOfDate,
    fetchedAt: raw.fetchedAt || new Date().toISOString(),
    source,
    disclosedCoveragePct,
    holdings,
  };
}

/**
 * Ask our serverless function for the latest disclosed holdings.
 */
async function fetchFromServer() {
  const res = await fetch(`/api/holdings?isin=${FUND_ISIN}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Holdings request failed: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.holdings) || data.holdings.length === 0) {
    throw new Error('Holdings response was empty');
  }
  return buildPayload(data, 'live');
}

/**
 * Main entry point. Returns the best available holdings payload and never
 * throws - callers always get *something* to render, annotated with how
 * fresh/trustworthy it is.
 *
 * @param {{forceRefresh?: boolean}} [options]
 * @returns {Promise<{payload: object, stale: boolean, error: string|null}>}
 */
export async function getHoldings(options = {}) {
  const { forceRefresh = false } = options;

  if (!forceRefresh) {
    const cached = cache.get(CACHE_KEY);
    if (cached && !cached.stale) {
      return { payload: cached.value, stale: false, error: null };
    }
  }

  try {
    const payload = await fetchFromServer();
    cache.set(CACHE_KEY, payload, CACHE_TTL_MS);
    return { payload, stale: false, error: null };
  } catch (err) {
    console.warn('[holdings] live fetch failed, falling back to cache', err);
    const stale = cache.get(CACHE_KEY, { allowStale: true });
    if (stale) {
      return { payload: stale.value, stale: true, error: err.message };
    }
    // Absolute last resort.
    return { payload: buildPayload(SEED_HOLDINGS, 'bundled-seed'), stale: true, error: err.message };
  }
}

/**
 * Kick off a background refresh without blocking the caller. Used by
 * app.js to implement the "check for updated holdings every 24h" loop
 * while the app stays open across a day boundary.
 */
export function scheduleBackgroundRefresh(onUpdated) {
  setInterval(async () => {
    const result = await getHoldings({ forceRefresh: true });
    if (!result.error) onUpdated(result);
  }, CACHE_TTL_MS);
}
