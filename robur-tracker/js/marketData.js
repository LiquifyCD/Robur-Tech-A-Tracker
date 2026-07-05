/**
 * marketData.js
 * ---------------------------------------------------------------------------
 * Retrieves live/delayed market prices for the fund's underlying holdings.
 *
 * All requests go through our own /api/quotes Cloudflare Pages Function,
 * which proxies Yahoo Finance's public (unofficial) quote endpoint. Doing
 * this server-side avoids browser CORS restrictions and lets us cache
 * responses for a few seconds so multiple visitors don't multiply our
 * request volume to Yahoo.
 *
 * NOTE ON RELIABILITY: Yahoo Finance does not offer an official free API.
 * The endpoint used here is widely relied upon but undocumented and can
 * change shape, rate-limit, or go down without notice. Every function in
 * this module is written to degrade gracefully rather than throw when
 * that happens - see marketData.getQuotes()'s try/catch and app.js's
 * exponential backoff.
 * ---------------------------------------------------------------------------
 */

import { cache } from './cache.js';

const QUOTE_CACHE_TTL_MS = 10 * 1000; // short - these are meant to be "live"
const CACHE_KEY_PREFIX = 'quote:';
const MAX_SYMBOLS_PER_REQUEST = 25; // keep proxy URLs/requests small

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Fetch quotes for a batch of ticker symbols via our proxy function.
 * @param {string[]} symbols
 * @returns {Promise<Object<string, object>>} map of symbol -> quote
 */
async function fetchBatch(symbols) {
  const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`);
  if (!res.ok) throw new Error(`Quotes request failed: ${res.status}`);
  const data = await res.json();
  return data.quotes || {};
}

/**
 * Get quotes for a full list of symbols, using per-symbol caching so a
 * transient failure for one batch doesn't wipe out data we already have
 * for other symbols. Returns both the quotes and which symbols (if any)
 * could not be refreshed live this round.
 *
 * @param {string[]} symbols
 * @returns {Promise<{quotes: Object<string, object>, failedSymbols: string[], allStale: boolean}>}
 */
export async function getQuotes(symbols) {
  const uniqueSymbols = Array.from(new Set(symbols));
  const batches = chunk(uniqueSymbols, MAX_SYMBOLS_PER_REQUEST);
  const quotes = {};
  const failedSymbols = [];

  for (const batch of batches) {
    try {
      const result = await fetchBatch(batch);
      for (const symbol of batch) {
        const q = result[symbol];
        if (!q) {
          failedSymbols.push(symbol);
          continue;
        }
        quotes[symbol] = q;
        cache.set(CACHE_KEY_PREFIX + symbol, q, QUOTE_CACHE_TTL_MS);
      }
    } catch (err) {
      console.warn('[marketData] batch fetch failed, using cache for', batch, err);
      failedSymbols.push(...batch);
    }
  }

  // Fill in anything that failed this round from cache (possibly stale).
  let allStale = true;
  for (const symbol of failedSymbols) {
    const cached = cache.get(CACHE_KEY_PREFIX + symbol, { allowStale: true });
    if (cached) {
      quotes[symbol] = { ...cached.value, stale: true };
    }
  }
  for (const symbol of uniqueSymbols) {
    if (quotes[symbol] && !quotes[symbol].stale) allStale = false;
  }

  return { quotes, failedSymbols, allStale: uniqueSymbols.length > 0 && allStale };
}

/**
 * Determine whether the relevant market is currently open, based on the
 * marketState field Yahoo returns per-quote ("REGULAR", "PRE", "POST",
 * "CLOSED"). If we have no quotes yet, fall back to a simple NYSE/NASDAQ
 * hours check (9:30-16:00 America/New_York, Mon-Fri) since the vast
 * majority of this fund's holdings trade there.
 *
 * @param {Object<string, object>} quotes
 */
export function isMarketOpen(quotes) {
  const states = Object.values(quotes)
    .map((q) => q.marketState)
    .filter(Boolean);

  if (states.length > 0) {
    return states.some((s) => s === 'REGULAR');
  }

  // Fallback: approximate US market hours check.
  const now = new Date();
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = nyTime.getDay(); // 0 = Sunday
  if (day === 0 || day === 6) return false;
  const minutes = nyTime.getHours() * 60 + nyTime.getMinutes();
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}
